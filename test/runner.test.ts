// The suite runner: output files, how episodes end, and aggregation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSuite, summarize } from '../src/runner.ts';
import { OracleAgent } from '../src/agents/scripted.ts';
import type { Agent, Env, EpisodeResult } from '../src/types.ts';

async function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'motorbench-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('a run writes results, a summary, a report and per-episode review files', async () => {
  await withDir(async (outDir) => {
    const { summary, results } = await runSuite({ agent: new OracleAgent(), tasks: ['click', 'keyboard'], levels: [1, 3], seeds: [1, 2], outDir, quiet: true });
    assert.equal(results.length, 3 * 2 * 2); // click + the two keyboard tasks
    assert.equal(summary.score, 1);
    assert.equal(summary.success, 1);
    assert.deepEqual(Object.keys(summary.byTask), ['click', 'type-text', 'hotkey']);
    assert.deepEqual(Object.keys(summary.byTask.click.byLevel), ['1', '3']);
    assert.ok(results.every((r) => r.endedBy === 'task_complete'));

    const lines = (await readFile(join(outDir, 'results.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(lines.length, results.length);
    assert.equal(JSON.parse(await readFile(join(outDir, 'summary.json'), 'utf8')).episodes, results.length);
    assert.match(await readFile(join(outDir, 'report.html'), 'utf8'), /motorbench — oracle/);
    const ep = join(outDir, results[0].dir);
    assert.ok((await stat(join(ep, 'final.png'))).size > 1000);
    const trace = JSON.parse(await readFile(join(ep, 'trace.json'), 'utf8'));
    assert.equal(trace.actions.length, results[0].actions);
    assert.ok(trace.events.length > 0);
  });
});

test('episodes end by timeout, error, budget or the agent stopping, and are still scored', async () => {
  const agent = (name: string, run: (env: Env) => Promise<void>): Agent => ({ name, run });
  // [agent, wall-clock limit in seconds, how the episode should end, expected error]
  const cases: [Agent, number, EpisodeResult['endedBy'], RegExp | null][] = [
    [agent('hangs', () => new Promise(() => {})), 2, 'timeout', /timed out after 2s/],
    // Keeps acting after the wall-clock limit: must be cut off, not crash the run.
    [agent('ignores-timeout', async (env) => { for (;;) await env.act({ type: 'wait', seconds: 0.5 }); }), 2, 'timeout', /timed out/],
    [agent('throws', async () => { throw new Error('boom'); }), 120, 'error', /boom/],
    [agent('stops', async (env) => { await env.act({ type: 'move', x: 300, y: 300 }); }), 120, 'agent_stopped', null],
    [agent('wanders', async (env) => { while (!(await env.act({ type: 'move', x: 100 + Math.random() * 20, y: 700 })).done); }), 120, 'budget', null],
  ];
  await withDir(async (outDir) => {
    for (const [a, timeoutSec, endedBy, error] of cases) {
      const { results } = await runSuite({ agent: a, tasks: ['click'], levels: [1], seeds: [1], outDir: join(outDir, a.name), timeoutSec, maxActions: 5, quiet: true });
      const r = results[0];
      assert.equal(r.endedBy, endedBy, a.name);
      assert.equal(r.score, 0, a.name);
      if (error) assert.match(r.error ?? '', error, a.name);
      else assert.equal(r.error, undefined, a.name);
    }
  });
});

test('unknown task names are rejected before anything runs', async () => {
  await withDir(async (outDir) => {
    await assert.rejects(runSuite({ agent: new OracleAgent(), tasks: ['clikc'], levels: [1], seeds: [1], outDir, quiet: true }), /unknown task or category "clikc"/);
  });
});

test('the headline score weights tasks equally, however many episodes each has', () => {
  const row = (task: string, level: number, score: number): EpisodeResult => ({
    task, level, seed: 1, category: task === 'click' ? 'pointing' : 'path', instruction: '', score, success: score === 1,
    endedBy: 'agent_stopped', actions: 2, screenshots: 0, seconds: 1, metrics: {}, dir: '',
  });
  const meta = [
    { id: 'click', title: '', category: 'pointing', summary: '' },
    { id: 'maze', title: '', category: 'path', summary: '' },
  ];
  const s = summarize([row('click', 1, 1), row('click', 2, 1), row('click', 3, 1), row('maze', 1, 0.5)], meta);
  assert.equal(s.score, 0.75);
  assert.equal(s.success, 0.5);
  assert.equal(s.byTask.click.byLevel['2'].score, 1);
  assert.equal(s.byCategory.path.score, 0.5);
});
