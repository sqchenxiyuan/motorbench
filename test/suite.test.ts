// Whole-suite invariants: the reference solution always scores 1, doing nothing
// always scores 0, and task instances are a pure function of (task, level, seed).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Bench } from '../src/session.ts';
import { OracleAgent } from '../src/agents/scripted.ts';
import { pool } from './helpers.ts';

let bench: Bench;
before(async () => {
  bench = await Bench.start();
});
after(() => bench.close());

const LEVELS = [1, 2, 3];

test('the catalogue has the expected tasks', () => {
  assert.equal(bench.catalogue.length, 21);
  assert.deepEqual([...new Set(bench.catalogue.map((t) => t.category))], ['pointing', 'path', 'drag', 'scroll', 'keyboard']);
});

test('the reference solution scores 1.0 on every task, level and seed', async () => {
  const specs = bench.catalogue.flatMap((t) => LEVELS.flatMap((level) => [101, 102, 103, 104].map((seed) => ({ task: t.id, level, seed }))));
  const oracle = new OracleAgent();
  const failures = (
    await pool(specs, 4, async (spec) => {
      const ep = await bench.open(spec, { privileged: true });
      try {
        await oracle.run(ep.env);
        const { status } = await ep.finish();
        const ok = status.score === 1 && status.success && status.done && ep.env.actions <= ep.info.maxActions;
        return ok ? null : `${spec.task} L${spec.level} s${spec.seed}: ${JSON.stringify(status)}`;
      } finally {
        await ep.close();
      }
    })
  ).filter(Boolean);
  assert.deepEqual(failures, []);
});

test('doing nothing scores exactly 0 on every task and level', async () => {
  const specs = bench.catalogue.flatMap((t) => LEVELS.flatMap((level) => [101, 102].map((seed) => ({ task: t.id, level, seed }))));
  const failures = (
    await pool(specs, 4, async (spec) => {
      const ep = await bench.open(spec);
      try {
        await ep.page.waitForTimeout(150);
        const { status } = await ep.finish();
        return status.score === 0 && !status.done && !status.success ? null : `${spec.task} L${spec.level} s${spec.seed}: ${JSON.stringify(status)}`;
      } finally {
        await ep.close();
      }
    })
  ).filter(Boolean);
  assert.deepEqual(failures, []);
});

test('instances depend only on (task, level, seed)', async () => {
  const describe = async (task: string, level: number, seed: number) => {
    const ep = await bench.open({ task, level, seed }, { privileged: true });
    try {
      return JSON.stringify([ep.info.instruction, await ep.env.solution!()]);
    } finally {
      await ep.close();
    }
  };
  const failures = (
    await pool(bench.catalogue, 4, async (t) => {
      const [a, b, c] = [await describe(t.id, 2, 7), await describe(t.id, 2, 7), await describe(t.id, 2, 8)];
      if (a !== b) return `${t.id}: same seed gave different instances`;
      if (a === c) return `${t.id}: different seeds gave the same instance`;
      return null;
    })
  ).filter(Boolean);
  assert.deepEqual(failures, []);
});

test('the action budget covers the reference solution with room to spare', async () => {
  for (const t of bench.catalogue) {
    const ep = await bench.open({ task: t.id, level: 3, seed: 5 }, { privileged: true });
    try {
      const n = (await ep.env.solution!()).length;
      assert.ok(ep.info.maxActions >= 2 * n, `${t.id}: budget ${ep.info.maxActions} for a ${n}-action solution`);
    } finally {
      await ep.close();
    }
  }
});
