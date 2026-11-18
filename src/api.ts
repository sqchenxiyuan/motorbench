// HTTP API server: lets an agent written in any language, on any machine, run
// episodes. The server owns the browser, does all the scoring and writes the same
// result files as a local run; the client only sees screenshots and sends actions.
//
//   POST /api/runs                       declare a run (agent name + which episodes)
//   POST /api/runs/:run/episodes         open one planned episode
//   GET  /api/episodes/:id/screenshot    PNG of the screen
//   POST /api/episodes/:id/zoom          PNG of a region at 2x
//   POST /api/episodes/:id/act           one action, or { actions: [...] }
//   POST /api/episodes/:id/finish        score the episode
//   POST /api/runs/:run/finish           write the summary and the report
//
// Rules that keep scores honest: every planned episode can be attempted once, the
// score is only revealed when an episode is finished, and planned episodes that
// were never attempted count as zero.
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Bench } from './session.ts';
import type { Episode, EpisodeSpec } from './session.ts';
import { ActionError, EnvClosedError } from './env.ts';
import { failedEpisode, scoreEpisode, summarize, writeRunOutputs } from './runner.ts';
import type { SuiteSummary } from './runner.ts';
import { renderRunsIndex } from './report.ts';
import type { RunRow } from './report.ts';
import { sendFile, WEB_ROOT } from './server.ts';
import { describeEnvironment } from './types.ts';
import type { Action, EndedBy, EpisodeResult } from './types.ts';

export interface ApiServerOptions {
  /** Default 8765; 0 picks a free port. */
  port?: number;
  /** Default 127.0.0.1. Anything else requires a token (or allowUnauthenticated). */
  host?: string;
  /** If set, every /api/ request needs "Authorization: Bearer <token>". */
  token?: string;
  allowUnauthenticated?: boolean;
  /** Where run directories are written. Default "results". */
  outRoot?: string;
  viewport?: { width: number; height: number };
  /** Episodes that may be open at the same time. Default 8. */
  maxEpisodes?: number;
  /** Wall-clock limit per episode. Default 600. */
  episodeTimeoutSec?: number;
  /** An episode with no request for this long is scored and closed. Default 120. */
  idleTimeoutSec?: number;
  headed?: boolean;
  log?: (line: string) => void;
}

export interface ApiServer {
  url: string;
  bench: Bench;
  close(): Promise<void>;
}

class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface RunState {
  id: string;
  agent: string;
  agentConfig: Record<string, unknown>;
  plan: Map<string, EpisodeSpec>;
  levels: number[];
  seeds: number[];
  results: Map<string, EpisodeResult>;
  /** Keys of episodes that are open or being opened. */
  open: Set<string>;
  status: 'open' | 'finished';
  outDir: string;
  startedAt: string;
  summary?: SuiteSummary;
  finishing?: Promise<SuiteSummary>;
}

interface OpenEpisode {
  id: string;
  run: RunState;
  key: string;
  spec: EpisodeSpec;
  episode: Episode;
  started: number;
  lastSeen: number;
  /** Requests for one episode run one at a time, in arrival order. */
  chain: Promise<unknown>;
  closing: boolean;
  result?: EpisodeResult;
}

const MAX_BODY = 1024 * 1024;
const MAX_PLAN = 5000;
const key = (s: EpisodeSpec) => `${s.task}|${s.level}|${s.seed}`;
const isLoopback = (host: string) => host === '127.0.0.1' || host === 'localhost' || host === '::1';
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'body_too_large', 'request body is larger than 1 MB');
    chunks.push(chunk as Buffer);
  }
  if (!size) return {};
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json', 'request body is not valid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'invalid_body', 'request body must be a JSON object');
  return value as Record<string, unknown>;
}

export async function startApiServer(opts: ApiServerOptions = {}): Promise<ApiServer> {
  const host = opts.host ?? '127.0.0.1';
  const token = opts.token || undefined;
  if (!isLoopback(host) && !token && !opts.allowUnauthenticated) {
    throw new Error(`refusing to listen on ${host} without authentication: set a token (--token or MOTORBENCH_TOKEN), or pass --no-auth to accept anyone who can reach the port`);
  }
  const outRoot = resolve(opts.outRoot ?? 'results');
  const maxEpisodes = opts.maxEpisodes ?? 8;
  const episodeTimeoutMs = (opts.episodeTimeoutSec ?? 600) * 1000;
  const idleTimeoutMs = (opts.idleTimeoutSec ?? 120) * 1000;
  const log = opts.log ?? ((line: string) => console.log(line));

  await mkdir(outRoot, { recursive: true });
  const bench = await Bench.start({ viewport: opts.viewport, headed: opts.headed });
  const runs = new Map<string, RunState>();
  const episodes = new Map<string, OpenEpisode>();
  /** Results of closed episodes by episode id, so late requests get a clear answer. */
  const finished = new Map<string, EpisodeResult>();
  let opening = 0;

  const getRun = (id: string) => {
    const run = runs.get(id);
    if (!run) throw new HttpError(404, 'unknown_run', `no run "${id}"`);
    return run;
  };
  const getEpisode = (id: string) => {
    const ep = episodes.get(id);
    if (ep) return ep;
    if (finished.has(id)) throw new HttpError(409, 'episode_finished', 'this episode has already been scored');
    throw new HttpError(404, 'unknown_episode', `no episode "${id}"`);
  };

  function locked<T>(ep: OpenEpisode, fn: () => Promise<T>): Promise<T> {
    const next = ep.chain.then(fn, fn);
    ep.chain = next.then(
      () => {},
      () => {},
    );
    return next;
  }

  /** Score and close an episode. Call under the episode's lock. */
  async function finalize(ep: OpenEpisode, endedBy: EndedBy, error?: string): Promise<EpisodeResult> {
    if (ep.result) return ep.result;
    ep.closing = true;
    const seconds = (Date.now() - ep.started) / 1000;
    let result: EpisodeResult;
    try {
      result = await scoreEpisode(ep.episode, ep.spec, { outDir: ep.run.outDir, endedBy, error, seconds });
    } catch (err) {
      result = failedEpisode(ep.spec, `harness: ${err instanceof Error ? err.message : String(err)}`, ep.episode, seconds);
    } finally {
      await ep.episode.close();
    }
    ep.result = result;
    episodes.delete(ep.id);
    finished.set(ep.id, result);
    if (finished.size > 5000) finished.delete(finished.keys().next().value!);
    ep.run.results.set(ep.key, result);
    ep.run.open.delete(ep.key);
    await appendFile(join(ep.run.outDir, 'results.jsonl'), `${JSON.stringify(result)}\n`);
    log(`[${ep.run.id}] ${ep.spec.task} L${ep.spec.level} s${ep.spec.seed}  score ${result.score.toFixed(3)} ${result.success ? 'PASS' : 'fail'}  ${result.actions} actions  ${result.endedBy}${result.error ? `  ! ${result.error.slice(0, 100)}` : ''}`);
    return result;
  }

  /** Close an episode nobody is driving any more. A task that already ended keeps its own outcome. */
  const abandon = (ep: OpenEpisode, endedBy: EndedBy, why: string) =>
    locked(ep, () => (ep.episode.env.finished ? finalize(ep, 'agent_stopped') : finalize(ep, endedBy, why)));

  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const ep of episodes.values()) {
      if (ep.closing) continue;
      let why: string | null = null;
      if (now - ep.started > episodeTimeoutMs) why = `timed out after ${episodeTimeoutMs / 1000}s`;
      else if (now - ep.lastSeen > idleTimeoutMs) why = `no request for ${idleTimeoutMs / 1000}s`;
      if (!why) continue;
      ep.closing = true;
      abandon(ep, 'timeout', why).catch((err) => log(`sweeper: ${err instanceof Error ? err.message : String(err)}`));
    }
  }, Math.min(2000, Math.max(100, Math.min(episodeTimeoutMs, idleTimeoutMs) / 4)));
  sweeper.unref();

  // ---- handlers ----------------------------------------------------------------

  async function createRun(body: Record<string, unknown>) {
    const agent = body.agent;
    if (typeof agent !== 'string' || !agent.trim() || agent.length > 100) throw new HttpError(400, 'invalid_agent', '"agent" must be a name of 1-100 characters');
    const config = body.config ?? {};
    if (typeof config !== 'object' || Array.isArray(config) || JSON.stringify(config).length > 20000) throw new HttpError(400, 'invalid_config', '"config" must be a small JSON object');

    const wanted = body.tasks ?? ['all'];
    if (!Array.isArray(wanted) || !wanted.every((t) => typeof t === 'string')) throw new HttpError(400, 'invalid_tasks', '"tasks" must be a list of task ids, category ids or "all"');
    let tasks: string[];
    try {
      tasks = bench.resolveTasks(wanted);
    } catch (err) {
      throw new HttpError(400, 'unknown_task', (err as Error).message);
    }

    const levels = body.levels ?? [1, 2, 3];
    if (!Array.isArray(levels) || !levels.length || !levels.every((l) => isInt(l) && l >= 1 && l <= 3)) throw new HttpError(400, 'invalid_levels', '"levels" must be a list drawn from 1, 2, 3');
    const levelList = [...new Set(levels as number[])].sort((a, b) => a - b);

    const seedArg = body.seeds ?? 3;
    let seeds: number[];
    if (isInt(seedArg) && seedArg >= 1 && seedArg <= 100) seeds = Array.from({ length: seedArg }, (_, i) => i + 1);
    else if (Array.isArray(seedArg) && seedArg.length >= 1 && seedArg.length <= 100 && seedArg.every((x) => isInt(x) && x >= 0 && x < 2 ** 31)) seeds = [...new Set(seedArg as number[])];
    else throw new HttpError(400, 'invalid_seeds', '"seeds" must be a count (1-100) or a list of up to 100 non-negative integers');

    const plan = new Map<string, EpisodeSpec>();
    for (const task of tasks) for (const level of levelList) for (const seed of seeds) plan.set(key({ task, level, seed }), { task, level, seed });
    if (plan.size > MAX_PLAN) throw new HttpError(400, 'plan_too_large', `a run may have at most ${MAX_PLAN} episodes`);

    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const slug = agent.trim().replace(/[^\w.-]+/g, '_').slice(0, 40);
    const id = `${stamp}-${slug}-${randomBytes(2).toString('hex')}`;
    const run: RunState = {
      id,
      agent: agent.trim(),
      agentConfig: config as Record<string, unknown>,
      plan,
      levels: levelList,
      seeds,
      results: new Map(),
      open: new Set(),
      status: 'open',
      outDir: join(outRoot, id),
      startedAt: new Date().toISOString(),
    };
    await mkdir(run.outDir, { recursive: true });
    await writeFile(
      join(run.outDir, 'config.json'),
      JSON.stringify({ agent: run.agent, agentConfig: run.agentConfig, tasks: wanted, levels: levelList, seeds, viewport: bench.viewport, via: 'api', startedAt: run.startedAt }, null, 2),
    );
    await writeFile(join(run.outDir, 'results.jsonl'), '');
    runs.set(id, run);
    log(`[${id}] run created by "${run.agent}": ${plan.size} episodes`);
    return { id, agent: run.agent, viewport: bench.viewport, episodes: [...plan.values()], reportUrl: `/runs/${id}/report.html` };
  }

  function describeRun(run: RunState) {
    const done = [...run.results.values()];
    return {
      id: run.id,
      agent: run.agent,
      status: run.status,
      startedAt: run.startedAt,
      planned: run.plan.size,
      completed: done.length,
      open: run.open.size,
      remaining: [...run.plan.values()].filter((s) => !run.results.has(key(s)) && !run.open.has(key(s))),
      // Over the episodes finished so far. The final score also counts unattempted ones as zero.
      scoreSoFar: summarize(done, bench.catalogue).score,
      results: done,
      summary: run.summary ?? null,
      reportUrl: `/runs/${run.id}/report.html`,
    };
  }

  async function openEpisode(run: RunState, body: Record<string, unknown>) {
    const { task, level, seed } = body;
    if (typeof task !== 'string' || !isInt(level) || !isInt(seed)) throw new HttpError(400, 'invalid_episode', 'expected { "task": string, "level": integer, "seed": integer }');
    const spec: EpisodeSpec = { task, level, seed };
    const k = key(spec);
    if (run.status !== 'open') throw new HttpError(409, 'run_finished', 'this run is finished');
    if (!run.plan.has(k)) throw new HttpError(400, 'not_in_plan', `${task} level ${level} seed ${seed} is not one of this run's episodes`);
    if (run.results.has(k) || run.open.has(k)) throw new HttpError(409, 'already_attempted', 'each episode of a run can be attempted once');
    if (episodes.size + opening >= maxEpisodes) throw new HttpError(429, 'too_many_episodes', `at most ${maxEpisodes} episodes can be open at once; finish one first`);

    run.open.add(k);
    opening++;
    let episode: Episode;
    try {
      episode = await bench.open(spec);
    } catch (err) {
      run.open.delete(k);
      throw new HttpError(500, 'open_failed', err instanceof Error ? err.message : String(err));
    } finally {
      opening--;
    }
    if (run.status !== 'open') {
      run.open.delete(k);
      await episode.close();
      throw new HttpError(409, 'run_finished', 'this run is finished');
    }
    const now = Date.now();
    const ep: OpenEpisode = { id: randomBytes(12).toString('hex'), run, key: k, spec, episode, started: now, lastSeen: now, chain: Promise.resolve(), closing: false };
    episodes.set(ep.id, ep);
    return {
      id: ep.id,
      run: run.id,
      task: episode.info,
      /** Environment description plus the instruction, ready to hand to a model. */
      prompt: describeEnvironment(episode.info),
      limits: { maxActions: episode.info.maxActions, timeoutSec: episodeTimeoutMs / 1000, idleTimeoutSec: idleTimeoutMs / 1000 },
    };
  }

  /** Run fn on a live episode, one request at a time, translating environment errors. */
  async function onEpisode<T>(id: string, fn: (ep: OpenEpisode) => Promise<T>): Promise<T> {
    const ep = getEpisode(id);
    ep.lastSeen = Date.now();
    return locked(ep, async () => {
      if (ep.result || ep.closing) throw new HttpError(409, 'episode_finished', 'this episode has already been scored');
      try {
        return await fn(ep);
      } catch (err) {
        if (err instanceof HttpError) throw err;
        if (err instanceof ActionError) throw new HttpError(400, 'invalid_request', err.message);
        if (err instanceof EnvClosedError) throw new HttpError(409, 'episode_finished', 'this episode has already been scored');
        if (err instanceof Error && /screenshot budget/.test(err.message)) throw new HttpError(429, 'screenshot_budget_exhausted', 'this episode has used up its screenshot budget');
        throw err;
      } finally {
        ep.lastSeen = Date.now();
      }
    });
  }

  async function act(id: string, body: Record<string, unknown>) {
    const batch = Array.isArray(body.actions);
    const list = batch ? (body.actions as unknown[]) : [body];
    if (list.length > 500) throw new HttpError(400, 'too_many_actions', 'at most 500 actions per request');
    return onEpisode(id, async (ep) => {
      const env = ep.episode.env;
      const results = [];
      // Like a human operator would: stop the batch at the first rejected action or when the episode ends.
      for (const a of list) {
        const r = await env.act(a as Action);
        results.push(r);
        if (!r.ok || r.done) break;
      }
      return batch ? { results, done: env.done, actionsLeft: env.actionsLeft } : { ...results[0], actionsLeft: env.actionsLeft };
    });
  }

  async function finishEpisode(id: string, body: Record<string, unknown>) {
    const ep = episodes.get(id);
    if (!ep) {
      const result = finished.get(id);
      if (result) return result; // finishing twice is harmless
      throw new HttpError(404, 'unknown_episode', `no episode "${id}"`);
    }
    const info = body.agent;
    if (info !== undefined && (typeof info !== 'object' || info === null || Array.isArray(info) || JSON.stringify(info).length > 20000)) {
      throw new HttpError(400, 'invalid_agent_info', '"agent" must be a small JSON object');
    }
    ep.closing = true;
    return locked(ep, async () => {
      if (info && !ep.result) ep.episode.env.report(info as Record<string, unknown>);
      return finalize(ep, 'agent_stopped');
    });
  }

  async function closeRun(run: RunState): Promise<SuiteSummary> {
    run.status = 'finished'; // from here on no new episode can be opened
    const stillOpen = [...episodes.values()].filter((e) => e.run === run);
    await Promise.all(stillOpen.map((e) => abandon(e, 'agent_stopped', 'the run was finished while this episode was still open')));
    for (const [k, spec] of run.plan) {
      if (run.results.has(k)) continue;
      const r = failedEpisode(spec, 'not attempted');
      run.results.set(k, r);
      await appendFile(join(run.outDir, 'results.jsonl'), `${JSON.stringify(r)}\n`);
    }
    const summary = await writeRunOutputs(
      { agent: run.agent, agentConfig: run.agentConfig, startedAt: run.startedAt, viewport: bench.viewport, levels: run.levels, seeds: run.seeds, outDir: run.outDir },
      [...run.results.values()],
      bench.catalogue,
    );
    run.summary = summary;
    log(`[${run.id}] run finished: score ${(summary.score * 100).toFixed(1)}, pass ${(summary.success * 100).toFixed(1)}% over ${summary.episodes} episodes`);
    return summary;
  }

  /** Finishing a run twice (or from two requests at once) returns the same summary. */
  async function finishRun(run: RunState) {
    run.finishing ??= closeRun(run);
    return { ...(await run.finishing), reportUrl: `/runs/${run.id}/report.html` };
  }

  async function runsIndex(): Promise<string> {
    const rows: RunRow[] = [];
    for (const entry of await readdir(outRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const s = JSON.parse(await readFile(join(outRoot, entry.name, 'summary.json'), 'utf8')) as SuiteSummary;
        rows.push({ id: entry.name, agent: s.agent, score: s.score, success: s.success, episodes: s.episodes, errors: s.errors, startedAt: s.startedAt });
      } catch {
        // not a finished run
      }
    }
    return renderRunsIndex(rows);
  }

  // ---- routing -----------------------------------------------------------------

  const json = (res: ServerResponse, status: number, value: unknown) => {
    const body = JSON.stringify(value);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
  };
  const png = (res: ServerResponse, image: Buffer) => {
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': image.length, 'cache-control': 'no-store' });
    res.end(image);
  };

  function authorize(req: IncomingMessage): void {
    if (!token) return;
    const given = Buffer.from(/^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '');
    const want = Buffer.from(token);
    if (given.length !== want.length || !timingSafeEqual(given, want)) throw new HttpError(401, 'unauthorized', 'missing or wrong bearer token');
  }

  async function api(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    authorize(req);
    const m = (re: RegExp) => re.exec(path);
    const method = req.method ?? 'GET';
    let p: RegExpExecArray | null;

    if (method === 'GET' && path === '/api/health') return json(res, 200, { ok: true, openEpisodes: episodes.size, maxEpisodes, viewport: bench.viewport });
    if (method === 'GET' && path === '/api/tasks') return json(res, 200, { tasks: bench.catalogue, levels: [1, 2, 3], viewport: bench.viewport });
    if (method === 'GET' && path === '/api/runs') return json(res, 200, { runs: [...runs.values()].map((r) => ({ id: r.id, agent: r.agent, status: r.status, planned: r.plan.size, completed: r.results.size })) });
    if (method === 'POST' && path === '/api/runs') return json(res, 201, await createRun(await readJson(req)));
    if ((p = m(/^\/api\/runs\/([^/]+)$/)) && method === 'GET') return json(res, 200, describeRun(getRun(p[1])));
    if ((p = m(/^\/api\/runs\/([^/]+)\/episodes$/)) && method === 'POST') return json(res, 201, await openEpisode(getRun(p[1]), await readJson(req)));
    if ((p = m(/^\/api\/runs\/([^/]+)\/finish$/)) && method === 'POST') return json(res, 200, await finishRun(getRun(p[1])));

    if ((p = m(/^\/api\/episodes\/([^/]+)$/)) && method === 'GET') {
      const done = finished.get(p[1]);
      if (done) return json(res, 200, { id: p[1], finished: true, result: done });
      const ep = getEpisode(p[1]);
      const env = ep.episode.env;
      // No score here: it is only revealed when the episode is finished.
      return json(res, 200, { id: ep.id, run: ep.run.id, finished: false, task: ep.episode.info, done: env.done, actions: env.actions, actionsLeft: env.actionsLeft, screenshots: env.screenshots, cursor: env.cursor() });
    }
    if ((p = m(/^\/api\/episodes\/([^/]+)\/screenshot$/)) && method === 'GET') return png(res, await onEpisode(p[1], (ep) => ep.episode.env.screenshot()));
    if ((p = m(/^\/api\/episodes\/([^/]+)\/zoom$/)) && method === 'POST') {
      const region = (await readJson(req)).region;
      if (!Array.isArray(region) || region.length !== 4) throw new HttpError(400, 'invalid_request', '"region" must be [x0, y0, x1, y1]');
      return png(res, await onEpisode(p[1], (ep) => ep.episode.env.zoom(region as [number, number, number, number])));
    }
    if ((p = m(/^\/api\/episodes\/([^/]+)\/act$/)) && method === 'POST') return json(res, 200, await act(p[1], await readJson(req)));
    if ((p = m(/^\/api\/episodes\/([^/]+)\/finish$/)) && method === 'POST') return json(res, 200, await finishEpisode(p[1], await readJson(req)));

    throw new HttpError(404, 'not_found', `no such endpoint: ${method} ${path}`);
  }

  const server = createServer(async (req, res) => {
    let path = '/';
    try {
      path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
      if (path.startsWith('/api/')) return await api(req, res, path);
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed', 'only GET is supported here');
      if (path === '/runs' || path === '/runs/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(await runsIndex());
        return;
      }
      // Run reports and review screenshots, then the task pages themselves.
      const found = path.startsWith('/runs/') ? await sendFile(res, outRoot, path.slice('/runs'.length)) : await sendFile(res, WEB_ROOT, path);
      if (!found) res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    } catch (err) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (err instanceof HttpError) return json(res, err.status, { error: { code: err.code, message: err.message } });
      log(`error on ${req.method} ${path}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      json(res, 500, { error: { code: 'internal_error', message: 'internal error' } });
    }
  });
  try {
    await new Promise<void>((ok, fail) => {
      server.once('error', fail);
      server.listen(opts.port ?? 8765, host, ok);
    });
  } catch (err) {
    clearInterval(sweeper);
    await bench.close();
    throw err;
  }
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://${host.includes(':') ? `[${host}]` : host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`,
    bench,
    async close() {
      clearInterval(sweeper);
      await Promise.all([...episodes.values()].map((e) => e.episode.close()));
      episodes.clear();
      server.closeAllConnections();
      await new Promise<void>((ok) => server.close(() => ok()));
      await bench.close();
    },
  };
}
