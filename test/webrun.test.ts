// The browser-only modes of the task pages: scored runs with a scorecard, and
// practice mode. Driven with real input, against the plain static files.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { BrowserEnv } from '../src/env.ts';
import { Bench } from '../src/session.ts';
import { startServer } from '../src/server.ts';
import type { TaskServer } from '../src/server.ts';
import type { Action, TaskInfo } from '../src/types.ts';

let server: TaskServer;
let browser: Browser;
before(async () => {
  server = await startServer();
  browser = await chromium.launch();
});
after(async () => {
  await browser.close();
  await server.close();
});

/** A fresh browser profile (own localStorage) with a window larger than the 1280x800 stage. */
async function open(path: string, viewport = { width: 1500, height: 900 }): Promise<Page> {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(server.url + path);
  return page;
}
const inRun = (page: Page, task: string) =>
  page.waitForFunction((t) => (window as any).__bench?.mode === 'run' && (window as any).__bench.spec().task === t, task, { timeout: 15000 });
const scorecard = async (page: Page) => {
  await page.waitForFunction('window.__bench && window.__bench.results', undefined, { timeout: 20000 });
  return (await page.evaluate('window.__bench.results')) as any;
};
/** Solve the task on screen with real mouse and keyboard input. */
async function solve(page: Page): Promise<void> {
  const info = (await page.evaluate('window.__bench.spec()')) as TaskInfo;
  const env = new BrowserEnv(page, info, { maxActions: 500, maxScreenshots: 10 }, true);
  for (const action of (await page.evaluate('window.__bench.solution()')) as Action[]) {
    await env.act(action).catch(() => {}); // the page may navigate away as soon as the task completes
  }
}

test('a scored run moves on by itself and ends with a scorecard', async () => {
  const page = await open('/?start=quick&tasks=click,drag-drop,type-text,hotkey');
  for (const task of ['click', 'drag-drop', 'type-text', 'hotkey']) {
    await inRun(page, task);
    assert.equal(await page.locator('#live').count(), 0, 'no live score during a run');
    await solve(page);
  }
  const r = await scorecard(page);
  assert.equal(r.kind, 'motorbench-web-run');
  assert.deepEqual([r.score, r.success, r.episodes, r.attempted, r.restarts], [1, 1, 4, 4, 0]);
  assert.deepEqual(r.results.map((e: any) => [e.task, e.level, e.seed, e.score, e.endedBy]), [
    ['click', 2, 1, 1, 'task_complete'],
    ['drag-drop', 2, 1, 1, 'task_complete'],
    ['type-text', 2, 1, 1, 'task_complete'],
    ['hotkey', 2, 1, 1, 'task_complete'],
  ]);
  assert.deepEqual(r.byCategory, { pointing: { score: 1, success: 1 }, drag: { score: 1, success: 1 }, keyboard: { score: 1, success: 1 } });
  assert.match(await page.locator('#menu').innerText(), /Scorecard[\s\S]*Overall\s+100\.0/);
  await page.context().close();
});

test('a run shows the same instances as the harness, whatever the window size', async () => {
  const bench = await Bench.start(); // 1280x800, like every harness run
  const page = await open('/?start=standard&tasks=trace-outline,pan&levels=3', { width: 1700, height: 1000 });
  try {
    for (const task of ['trace-outline', 'pan']) {
      await inRun(page, task);
      const ep = await bench.open({ task, level: 3, seed: 1 }, { privileged: true });
      assert.equal(await page.evaluate('window.__bench.spec().instruction'), ep.info.instruction);
      assert.deepEqual(await page.evaluate('window.__bench.solution()'), await ep.env.solution!());
      assert.deepEqual(await page.evaluate('window.__bench.spec().viewport'), { width: 1280, height: 800 });
      await ep.close();
      await page.locator('#done').click();
    }
    await scorecard(page);
  } finally {
    await page.context().close();
    await bench.close();
  }
});

test('Done moves on with the score so far, and is not input to the task', async () => {
  const page = await open('/?start=quick&tasks=click,trace-path');
  await inRun(page, 'click');
  await page.locator('#done').click();
  await inRun(page, 'trace-path');
  // Half of the band, then Done.
  const moves = (await page.evaluate('window.__bench.solution()')) as { x: number; y: number }[];
  for (const m of moves.slice(0, Math.ceil(moves.length / 2))) await page.mouse.move(m.x, m.y, { steps: 3 });
  await page.locator('#done').click();
  const r = await scorecard(page);
  const [click, trace] = r.results;
  assert.deepEqual([click.score, click.endedBy, click.metrics.misses], [0, 'done_button', 0], 'pressing Done is not a stray click');
  assert.equal(trace.endedBy, 'done_button');
  assert.ok(trace.score > 0.2 && trace.score < 0.8, `partial trace scored ${trace.score}`);
  assert.equal(r.success, 0);
  await page.context().close();
});

test('an episode ends when its time is up', async () => {
  const page = await open('/?start=quick&tasks=hover&limit=5');
  await inRun(page, 'hover');
  const r = await scorecard(page);
  assert.deepEqual([r.results[0].endedBy, r.results[0].score], ['timeout', 0]);
  assert.ok(r.results[0].seconds >= 5 && r.results[0].seconds < 8);
  await page.context().close();
});

test('an episode cannot be played twice; reloads and unattempted episodes are reported', async () => {
  // Episodes follow the catalogue order: click, double-click, right-click.
  const page = await open('/?start=quick&tasks=click,double-click,right-click');
  await inRun(page, 'click');
  const first = page.url();
  await page.reload(); // starting over before finishing is allowed, but counted
  await inRun(page, 'click');
  await solve(page);
  await inRun(page, 'double-click');

  await page.goto(first); // back to the finished episode: sent on to the unfinished one
  await inRun(page, 'double-click');

  // The scorecard can be opened early; what was not attempted counts as zero.
  const id = new URL(page.url()).searchParams.get('run');
  await page.goto(`${server.url}/?run=${id}&results=1`);
  const early = await scorecard(page);
  // Two restarts: the reload of the first episode, and the second episode being loaded again just above.
  assert.deepEqual([early.attempted, early.episodes, early.restarts], [1, 3, 2]);
  assert.ok(Math.abs(early.score - 1 / 3) < 1e-3);
  assert.deepEqual(early.results.map((e: any) => e.endedBy), ['task_complete', 'not_attempted', 'not_attempted']);
  assert.match(await page.locator('#menu').innerText(), /2 of 3 episodes have not been attempted/);

  // The menu offers to resume.
  await page.goto(`${server.url}/`);
  await page.locator('.resume a', { hasText: 'Resume' }).click();
  await inRun(page, 'double-click');
  await page.context().close();
});

test('a run waits for a window that fits the stage; an unknown run is explained', async () => {
  const small = await open('/?start=quick&tasks=click', { width: 1100, height: 700 });
  await small.waitForFunction('window.__bench && window.__bench.error');
  assert.match(await small.locator('#instruction').innerText(), /1280×800 stage, and the window is only 1100×700/);
  await small.setViewportSize({ width: 1400, height: 900 }); // it starts by itself once the window fits
  await inRun(small, 'click');
  await small.context().close();

  const lost = await open('/?task=click&level=2&seed=1&run=nosuchrun&i=0');
  await lost.waitForFunction('window.__bench && window.__bench.error');
  assert.match(await lost.locator('#instruction').innerText(), /not stored in this browser/);
  await lost.context().close();
});

test('practice mode loads the next instance by itself; the harness mode never navigates', async () => {
  const page = await open('/?task=hotkey&level=1&seed=7&hud=1');
  await page.waitForFunction('window.__bench && window.__bench.mode === "free"');
  assert.match(await page.locator('#live').innerText(), /score 0\.000/);
  await solve(page);
  await page.waitForURL(/seed=8/, { timeout: 8000 });
  await page.waitForFunction('window.__bench && window.__bench.spec && window.__bench.spec().seed === 8');
  await page.context().close();

  const bare = await open('/?task=hotkey&level=1&seed=7');
  await bare.waitForFunction('window.__bench && window.__bench.mode === "bare"');
  await solve(bare);
  await bare.waitForTimeout(2500);
  assert.match(bare.url(), /seed=7$/);
  assert.equal(await bare.locator('#flash').isHidden(), true);
  assert.deepEqual(await bare.evaluate('(() => { const s = window.__bench.status(); return [s.done, s.score]; })()'), [true, 1]);
  await bare.context().close();
});
