"""Client for the motorbench HTTP API. Standard library only (Python 3.8+).

    from motorbench import Client

    client = Client("http://127.0.0.1:8765")             # token="..." if the server needs one
    run = client.start_run("my-agent", tasks=["path"], seeds=2)
    for spec in run.episodes:
        ep = run.open(spec)
        while True:
            png = ep.screenshot()                         # bytes, PNG, one pixel per screen pixel
            action = decide(ep.prompt, png)               # your model
            if action is None or ep.act(action)["done"]:
                break
        print(ep.finish()["score"])
    summary = run.finish()
    print(summary["score"], client.url(summary["reportUrl"]))
"""
import json
import urllib.error
import urllib.request


class ApiError(Exception):
    """The server rejected a request. `code` is a stable identifier such as "already_attempted"."""

    def __init__(self, status, code, message):
        super().__init__(f"{status} {code}: {message}")
        self.status = status
        self.code = code
        self.message = message


class Client:
    def __init__(self, base_url="http://127.0.0.1:8765", token=None, timeout=120):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout

    def url(self, path):
        """Absolute URL for a path the server returned (for example a report)."""
        return self.base_url + path

    def request(self, method, path, body=None, raw=False):
        data = None if body is None else json.dumps(body).encode("utf-8")
        req = urllib.request.Request(self.base_url + path, data=data, method=method)
        if data is not None:
            req.add_header("Content-Type", "application/json")
        if self.token:
            req.add_header("Authorization", f"Bearer {self.token}")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                payload = res.read()
        except urllib.error.HTTPError as err:
            try:
                detail = json.loads(err.read().decode("utf-8"))["error"]
                raise ApiError(err.code, detail["code"], detail["message"]) from None
            except (ValueError, KeyError, TypeError):
                raise ApiError(err.code, "http_error", err.reason) from None
        return payload if raw else json.loads(payload.decode("utf-8"))

    def health(self):
        return self.request("GET", "/api/health")

    def tasks(self):
        """The task catalogue: [{id, title, category, summary}, ...]."""
        return self.request("GET", "/api/tasks")["tasks"]

    def start_run(self, agent, tasks=None, levels=None, seeds=None, config=None):
        """Declare a run. `tasks` takes task ids, category ids or "all" (default: all);
        `levels` a list drawn from 1, 2, 3 (default: all three); `seeds` a count or a
        list (default: 3). `config` is recorded next to the results (model name etc.)."""
        body = {"agent": agent}
        for name, value in (("tasks", tasks), ("levels", levels), ("seeds", seeds), ("config", config)):
            if value is not None:
                body[name] = value
        return Run(self, self.request("POST", "/api/runs", body))


class Run:
    def __init__(self, client, data):
        self.client = client
        self.id = data["id"]
        self.viewport = data["viewport"]
        #: Every episode of the run: [{"task": ..., "level": ..., "seed": ...}, ...]
        self.episodes = data["episodes"]
        self.report_url = client.url(data["reportUrl"])

    def open(self, spec):
        """Open one planned episode. Each episode can be attempted once per run."""
        body = {"task": spec["task"], "level": spec["level"], "seed": spec["seed"]}
        return Episode(self.client, self.client.request("POST", f"/api/runs/{self.id}/episodes", body))

    def status(self):
        return self.client.request("GET", f"/api/runs/{self.id}")

    def finish(self):
        """Close the run and get the summary. Episodes that were never attempted count as zero."""
        return self.client.request("POST", f"/api/runs/{self.id}/finish", {})


class Episode:
    def __init__(self, client, data):
        self.client = client
        self.id = data["id"]
        self.task = data["task"]
        self.instruction = data["task"]["instruction"]
        #: Description of the environment plus the instruction, ready to hand to a model.
        self.prompt = data["prompt"]
        self.viewport = data["task"]["viewport"]
        self.max_actions = data["task"]["maxActions"]

    def screenshot(self):
        """PNG bytes of the whole screen."""
        return self.client.request("GET", f"/api/episodes/{self.id}/screenshot", raw=True)

    def zoom(self, x0, y0, x1, y1):
        """PNG bytes of a region, at up to twice the resolution."""
        return self.client.request("POST", f"/api/episodes/{self.id}/zoom", {"region": [x0, y0, x1, y1]}, raw=True)

    def act(self, action=None, **fields):
        """Perform one action: act({"type": "click", "x": 10, "y": 20}) or act(type="click", x=10, y=20).

        Returns {"ok", "done", "actionsLeft"} and, if the action was rejected, "error".
        `done` becomes true when the task has completed itself or the action budget is used up."""
        return self.client.request("POST", f"/api/episodes/{self.id}/act", action if action is not None else fields)

    def act_many(self, actions):
        """Perform several actions in one request. Stops at the first rejected action or when the episode ends."""
        return self.client.request("POST", f"/api/episodes/{self.id}/act", {"actions": list(actions)})

    def status(self):
        return self.client.request("GET", f"/api/episodes/{self.id}")

    def finish(self, agent=None):
        """Score the episode. `agent` (a small dict, e.g. token usage) is stored with the result."""
        return self.client.request("POST", f"/api/episodes/{self.id}/finish", {} if agent is None else {"agent": agent})
