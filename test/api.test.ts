// The HTTP API server, driven the way a remote agent would drive it.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { startApiServer } from '../src/api.ts';
import type { ApiServer } from '../src/api.ts';
import type { Action, EpisodeResult } from '../src/types.ts';

let server: ApiServer;
let outRoot: string;

before(async () => {
  outRoot = await mkdtemp(join(tmpdir(), 'motorbench-api-'));
  server = await startApiServer({ port: 0, outRoot, maxEpisodes: 3, log: () => {} });
});
after(async () => {
  await server.close();
  await rm(outRoot, { recursive: true, force: true });
});

type Json = Record<string, any>;

async function call(base: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method,
    headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('json') ? ((await res.json()) as Json) : Buffer.from(await res.arrayBuffer());
  return { status: res.status, type, data: data as Json, bytes: data as Buffer };
}
const api = (method: string, path: string, body?: unknown) => call(server.url, method, path, body);

/** The reference solution, fetched out-of-band; the API itself never exposes it. */
async function solution(task: string, level: number, seed: number): Promise<Action[]> {
  const ep = await server.bench.open({ task, level, seed }, { privileged: true });
  try {
    return await ep.env.solution!();
  } finally {
    await ep.close();
  }
}

const pngSize = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)];

test('health and catalogue', async () => {
  const health = await api('GET', '/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.ok, true);
  const tasks = await api('GET', '/api/tasks');
  assert.equal(tasks.data.tasks.length, 15);
  assert.deepEqual(tasks.data.viewport, { width: 1280, height: 800 });
});

test('a whole run: open, look, act, finish, summary, report', async () => {
  const run = await api('POST', '/api/runs', { agent: 'api test agent', tasks: ['click'], levels: [1], seeds: [5, 6], config: { model: 'none' } });
  assert.equal(run.status, 201);
  assert.deepEqual(run.data.episodes, [{ task: 'click', level: 1, seed: 5 }, { task: 'click', level: 1, seed: 6 }]);
  const runPath = `/api/runs/${run.data.id}`;

  const opened = await api('POST', `${runPath}/episodes`, { task: 'click', level: 1, seed: 5 });
  assert.equal(opened.status, 201);
  assert.equal(opened.data.task.instruction, 'Click the blue circle.');
  assert.match(opened.data.prompt, /Task: Click the blue circle\./);
  assert.ok(opened.data.task.maxActions > 0);
  const epPath = `/api/episodes/${opened.data.id}`;

  const shot = await api('GET', `${epPath}/screenshot`);
  assert.equal(shot.type, 'image/png');
  assert.deepEqual(pngSize(shot.bytes), [1280, 800]);
  const zoom = await api('POST', `${epPath}/zoom`, { region: [0, 100, 200, 200] });
  assert.deepEqual(pngSize(zoom.bytes), [400, 200]);

  // While an episode is open, nothing reveals how well it is going.
  const live = await api('GET', epPath);
  assert.equal(live.data.finished, false);
  assert.ok(!('score' in live.data) && !JSON.stringify(live.data).includes('"score"'));

  const [click] = await solution('click', 1, 5);
  const acted = await api('POST', `${epPath}/act`, click);
  assert.deepEqual({ ok: acted.data.ok, done: acted.data.done }, { ok: true, done: true });

  const result = await api('POST', `${epPath}/finish`, { agent: { tokens: 123 } });
  assert.equal(result.data.score, 1);
  assert.equal(result.data.success, true);
  assert.equal(result.data.endedBy, 'task_complete');
  assert.deepEqual(result.data.agent, { tokens: 123 });
  assert.deepEqual((await api('POST', `${epPath}/finish`, {})).data, result.data, 'finishing twice returns the same result');

  // One attempt per episode, and a scored episode takes no more input.
  assert.equal((await api('POST', `${epPath}/act`, click)).data.error.code, 'episode_finished');
  assert.equal((await api('GET', `${epPath}/screenshot`)).status, 409);
  const again = await api('POST', `${runPath}/episodes`, { task: 'click', level: 1, seed: 5 });
  assert.deepEqual([again.status, again.data.error.code], [409, 'already_attempted']);

  const status = await api('GET', runPath);
  assert.deepEqual([status.data.planned, status.data.completed, status.data.open], [2, 1, 0]);
  assert.deepEqual(status.data.remaining, [{ task: 'click', level: 1, seed: 6 }]);

  // The episode that was never attempted counts as zero.
  const summary = await api('POST', `${runPath}/finish`);
  assert.equal(summary.data.score, 0.5);
  assert.equal(summary.data.episodes, 2);
  assert.equal(summary.data.agent, 'api test agent');
  assert.deepEqual((await api('POST', `${runPath}/finish`)).data.score, 0.5);
  const late = await api('POST', `${runPath}/episodes`, { task: 'click', level: 1, seed: 6 });
  assert.deepEqual([late.status, late.data.error.code], [409, 'run_finished']);

  const lines = (await readFile(join(outRoot, run.data.id, 'results.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as EpisodeResult);
  assert.deepEqual(lines.map((r) => [r.seed, r.score, r.error]), [[5, 1, undefined], [6, 0, 'not attempted']]);

  // Report, review screenshot and index are served to browsers.
  const report = await fetch(server.url + summary.data.reportUrl);
  assert.equal(report.status, 200);
  assert.match(await report.text(), /motorbench — api test agent/);
  const image = await fetch(`${server.url}/runs/${run.data.id}/episodes/click-L1-s5/final.png`);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.match(await (await fetch(`${server.url}/runs/`)).text(), /api test agent/);
  assert.equal((await fetch(`${server.url}/`)).status, 200, 'task pages are served too');
});

test('batched actions stop at the first rejected one', async () => {
  const run = await api('POST', '/api/runs', { agent: 'batch', tasks: ['maze'], levels: [1], seeds: 1 });
  const ep = await api('POST', `/api/runs/${run.data.id}/episodes`, run.data.episodes[0]);
  const budget = ep.data.task.maxActions;
  const res = await api('POST', `/api/episodes/${ep.data.id}/act`, {
    actions: [{ type: 'move', x: 100, y: 100 }, { type: 'move', x: -5, y: 100 }, { type: 'move', x: 200, y: 200 }],
  });
  assert.equal(res.data.results.length, 2);
  assert.deepEqual(res.data.results.map((r: Json) => r.ok), [true, false]);
  assert.match(res.data.results[1].error, /outside/);
  assert.equal(res.data.actionsLeft, budget - 2);
  assert.equal(res.data.done, false);
  await api('POST', `/api/runs/${run.data.id}/finish`);
});

test('malformed input is rejected cleanly and never crashes an episode', async () => {
  const bad = async (method: string, path: string, body: unknown, status: number, code: string) => {
    const res = await api(method, path, body);
    assert.deepEqual([res.status, res.data.error?.code], [status, code], `${method} ${path} ${JSON.stringify(body)}`);
  };
  await bad('GET', '/api/nope', undefined, 404, 'not_found');
  await bad('GET', '/api/runs/nope', undefined, 404, 'unknown_run');
  await bad('GET', '/api/episodes/nope', undefined, 404, 'unknown_episode');
  await bad('POST', '/api/runs', '{not json', 400, 'invalid_json');
  await bad('POST', '/api/runs', '[1, 2]', 400, 'invalid_body');
  await bad('POST', '/api/runs', {}, 400, 'invalid_agent');
  await bad('POST', '/api/runs', { agent: 'x', tasks: ['clikc'] }, 400, 'unknown_task');
  await bad('POST', '/api/runs', { agent: 'x', levels: [4] }, 400, 'invalid_levels');
  await bad('POST', '/api/runs', { agent: 'x', seeds: 'many' }, 400, 'invalid_seeds');

  // A level-3 maze has an action budget large enough to absorb the invalid actions below.
  const run = await api('POST', '/api/runs', { agent: 'fuzz', tasks: ['maze'], levels: [3], seeds: 1 });
  await bad('POST', `/api/runs/${run.data.id}/episodes`, { task: 'click', level: 1, seed: 1 }, 400, 'not_in_plan');
  await bad('POST', `/api/runs/${run.data.id}/episodes`, { task: 'maze', level: '3', seed: 1 }, 400, 'invalid_episode');
  const ep = await api('POST', `/api/runs/${run.data.id}/episodes`, run.data.episodes[0]);
  const epPath = `/api/episodes/${ep.data.id}`;
  await bad('POST', `${epPath}/zoom`, { region: [5, 5, 1, 1] }, 400, 'invalid_request');
  await bad('POST', `${epPath}/zoom`, { region: 'all' }, 400, 'invalid_request');

  // Nonsense actions are answered with ok: false, like any other invalid action.
  const garbage: unknown[] = [
    {},
    { type: 'teleport' },
    { type: 'move' },
    { type: 'move', x: '10', y: 10 },
    { type: 'click', x: 10, y: 100, button: 'foo' },
    { type: 'click', x: 10, y: 100, count: 9 },
    { type: 'click', x: 10, y: 100, modifiers: 'ctrl' },
    { type: 'drag', path: 'x' },
    { type: 'drag', path: [[1, 2]] },
    { type: 'drag', path: [[1, 100], null] },
    { type: 'scroll', dx: 'a', dy: 1 },
    { type: 'type', text: 7 },
    { type: 'key', keys: '' },
    { type: 'key', keys: 'Enter', repeat: 'x' },
    { type: 'wait', seconds: -1 },
  ];
  for (const action of garbage) {
    const res = await api('POST', `${epPath}/act`, action);
    assert.equal(res.status, 200, JSON.stringify(action));
    assert.equal(res.data.ok, false, JSON.stringify(action));
    assert.equal(typeof res.data.error, 'string');
  }
  const mixed = await api('POST', `${epPath}/act`, { actions: [null, 5, 'click'] });
  assert.deepEqual([mixed.status, mixed.data.results.length, mixed.data.results[0].ok], [200, 1, false]);

  // Each invalid action used up one action of the budget ...
  const used = garbage.length + 1;
  assert.equal(mixed.data.actionsLeft, ep.data.task.maxActions - used);

  // ... and the episode is still alive and scores normally afterwards.
  const route = await solution('maze', 3, 1);
  const solved = await api('POST', `${epPath}/act`, { actions: route });
  assert.ok(solved.data.results.every((r: Json) => r.ok));
  assert.equal(solved.data.done, true);
  const result = await api('POST', `${epPath}/finish`, {});
  assert.deepEqual([result.data.score, result.data.endedBy, result.data.actions], [1, 'task_complete', used + route.length]);
  await api('POST', `/api/runs/${run.data.id}/finish`);
});

test('the number of open episodes is limited', async () => {
  const run = await api('POST', '/api/runs', { agent: 'crowd', tasks: ['hotkey'], levels: [1], seeds: 4 });
  const open = (i: number) => api('POST', `/api/runs/${run.data.id}/episodes`, run.data.episodes[i]);
  const first = await Promise.all([open(0), open(1), open(2)]);
  assert.deepEqual(first.map((r) => r.status), [201, 201, 201]);
  const fourth = await open(3);
  assert.deepEqual([fourth.status, fourth.data.error.code], [429, 'too_many_episodes']);
  await api('POST', `/api/episodes/${first[0].data.id}/finish`, {});
  assert.equal((await open(3)).status, 201);
  await api('POST', `/api/runs/${run.data.id}/finish`);
  assert.equal((await api('GET', '/api/health')).data.openEpisodes, 0, 'finishing a run closes its episodes');
});

test('concurrent requests to one episode are applied one at a time', async () => {
  const run = await api('POST', '/api/runs', { agent: 'burst', tasks: ['trace-path'], levels: [1], seeds: 1 });
  const ep = await api('POST', `/api/runs/${run.data.id}/episodes`, run.data.episodes[0]);
  const moves = Array.from({ length: 12 }, (_, i) => api('POST', `/api/episodes/${ep.data.id}/act`, { type: 'move', x: 100 + i * 10, y: 700 }));
  const results = await Promise.all(moves);
  assert.ok(results.every((r) => r.status === 200 && r.data.ok));
  assert.deepEqual(results.map((r) => r.data.actionsLeft).sort((a, b) => b - a), Array.from({ length: 12 }, (_, i) => ep.data.task.maxActions - 1 - i));
  const result = await api('POST', `/api/episodes/${ep.data.id}/finish`, {});
  assert.equal(result.data.actions, 12);
  await api('POST', `/api/runs/${run.data.id}/finish`);
});

test('authentication and idle episodes', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'motorbench-api2-'));
  const guarded = await startApiServer({ port: 0, outRoot: dir, token: 'open sesame', idleTimeoutSec: 1.5, log: () => {} });
  t.after(async () => {
    await guarded.close();
    await rm(dir, { recursive: true, force: true });
  });
  const auth = { authorization: 'Bearer open sesame' };
  const authed = (method: string, path: string, body?: unknown) => call(guarded.url, method, path, body, auth);

  assert.equal((await call(guarded.url, 'GET', '/api/tasks')).status, 401);
  assert.equal((await call(guarded.url, 'GET', '/api/tasks', undefined, { authorization: 'Bearer open sesamf' })).status, 401);
  assert.equal((await authed('GET', '/api/tasks')).status, 200);
  assert.equal((await fetch(`${guarded.url}/`)).status, 200, 'pages need no token');

  const run = await authed('POST', '/api/runs', { agent: 'sleepy', tasks: ['hotkey'], levels: [1], seeds: 2 });
  // One episode is solved but never finished; the other is opened and then left alone.
  const solved = await authed('POST', `/api/runs/${run.data.id}/episodes`, run.data.episodes[0]);
  const ep = await guarded.bench.open(run.data.episodes[0], { privileged: true });
  const [press] = await ep.env.solution!();
  await ep.close();
  assert.equal((await authed('POST', `/api/episodes/${solved.data.id}/act`, press)).data.done, true);
  const idle = await authed('POST', `/api/runs/${run.data.id}/episodes`, run.data.episodes[1]);

  await new Promise((r) => setTimeout(r, 3500));
  const a = await authed('GET', `/api/episodes/${solved.data.id}`);
  assert.equal(a.data.finished, true);
  assert.deepEqual([a.data.result.score, a.data.result.endedBy, a.data.result.error], [1, 'task_complete', undefined]);
  const b = await authed('GET', `/api/episodes/${idle.data.id}`);
  assert.deepEqual([b.data.result.score, b.data.result.endedBy], [0, 'timeout']);
  assert.match(b.data.result.error, /no request for 1\.5s/);
  assert.equal((await authed('POST', `/api/runs/${run.data.id}/finish`)).data.score, 0.5);
});

test('refuses to listen beyond localhost without a token', async () => {
  await assert.rejects(startApiServer({ port: 0, host: '0.0.0.0', log: () => {} }), /without authentication/);
});

test('the Python client and example agent work against the server', async (t) => {
  const run = promisify(execFile);
  try {
    await run('python3', ['--version']);
  } catch {
    return t.skip('python3 is not installed');
  }
  const { stdout } = await run(
    'python3',
    ['clients/python/example_agent.py', '--url', server.url, '--tasks', 'click,right-click,hover', '--levels', '1,3', '--seeds', '1'],
    { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, timeout: 120000 },
  );
  assert.match(stdout, /score 100\.0 {2}pass 100\.0% {2}over 6 episodes/);
  assert.match(stdout, /report: http:\/\/127\.0\.0\.1:\d+\/runs\/.*python-blue-dot.*\/report\.html/);
});
