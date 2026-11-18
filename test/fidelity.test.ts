// The page must see exactly the input that was sent: no lost pointer positions
// (even when the browser coalesces moves), exact wheel deltas, pixel-exact screenshots.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Bench } from '../src/session.ts';

let bench: Bench;
before(async () => {
  bench = await Bench.start();
});
after(() => bench.close());

type Ev = [string, number, number, number, ...number[]];

function waypoints(n: number): [number, number][] {
  // A zigzag whose corners would be badly cut if any position were dropped.
  return Array.from({ length: n }, (_, i) => [100 + ((i * 37) % 1000), i % 2 ? 150 + ((i * 53) % 200) : 500 + ((i * 29) % 250)] as [number, number]);
}

/** Every waypoint must appear among the recorded positions, in order. */
function assertVisited(events: Ev[], pts: [number, number][]) {
  const moves = events.filter((e) => e[0] === 'm');
  let i = 0;
  for (const [x, y] of pts) {
    while (i < moves.length && !(Math.abs(moves[i][2] - x) < 0.6 && Math.abs(moves[i][3] - y) < 0.6)) i++;
    assert.ok(i < moves.length, `waypoint (${x}, ${y}) was never seen by the page`);
  }
}

test('every pointer waypoint reaches the page, in order', async () => {
  const ep = await bench.open({ task: 'trace-path', level: 1, seed: 1 }, { maxActions: 500 });
  try {
    const pts = waypoints(80);
    for (const [x, y] of pts) await ep.env.act({ type: 'move', x, y });
    const { events } = await ep.finish();
    assertVisited(events as Ev[], pts);
  } finally {
    await ep.close();
  }
});

test('no waypoint is lost when moves arrive faster than frames (coalesced events)', async () => {
  const ep = await bench.open({ task: 'trace-path', level: 1, seed: 1 });
  try {
    const pts = waypoints(300);
    // Fire everything without waiting, so the browser has to batch moves into frames.
    await Promise.all(pts.map(([x, y]) => ep.page.mouse.move(x, y)));
    await ep.page.evaluate('window.__bench.frame()');
    const { events } = await ep.finish();
    assertVisited(events as Ev[], pts);
  } finally {
    await ep.close();
  }
});

test('a drag presses at the first point and releases at the last', async () => {
  const ep = await bench.open({ task: 'draw-trace', level: 1, seed: 1 });
  try {
    await ep.env.act({ type: 'drag', path: [[200, 200], [400, 300], [300, 500]] });
    const { events } = await ep.finish();
    const ev = events as Ev[];
    const down = ev.find((e) => e[0] === 'd')!;
    const up = ev.find((e) => e[0] === 'u')!;
    assert.deepEqual(down.slice(2, 4), [200, 200]);
    assert.deepEqual(up.slice(2, 4), [300, 500]);
    const during = ev.slice(ev.indexOf(down), ev.indexOf(up)).filter((e) => e[0] === 'm');
    assert.ok(during.length >= 2 && during.every((e) => e[4] === 1), 'moves between press and release carry the button');
    assertVisited(ev, [[200, 200], [400, 300], [300, 500]]);
  } finally {
    await ep.close();
  }
});

test('wheel deltas arrive exactly as requested', async () => {
  const ep = await bench.open({ task: 'scroll-click', level: 2, seed: 1 });
  try {
    await ep.env.act({ type: 'scroll', x: 640, y: 400, dx: 0, dy: 437 });
    await ep.env.act({ type: 'scroll', dx: 0, dy: -37 });
    const { events } = await ep.finish();
    const wheels = (events as Ev[]).filter((e) => e[0] === 'w').map((e) => e[5]);
    assert.equal(wheels.length, 2);
    assert.ok(Math.abs(wheels[0] - 437) < 0.5 && Math.abs(wheels[1] + 37) < 0.5, `got ${wheels}`);
  } finally {
    await ep.close();
  }
});

test('screenshots are one pixel per CSS pixel; zoom returns 2x detail', async () => {
  const ep = await bench.open({ task: 'click', level: 3, seed: 1 });
  try {
    const size = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)];
    assert.deepEqual(size(await ep.env.screenshot()), [1280, 800]);
    assert.deepEqual(size(await ep.env.zoom([100, 200, 400, 350])), [600, 300]);
    assert.deepEqual(size(await ep.env.zoom([0, 0, 1280, 800])), [1280, 800]); // too large for 2x: falls back to 1x
    await assert.rejects(ep.env.zoom([10, 10, 5, 5]), /invalid zoom region/);
  } finally {
    await ep.close();
  }
});

test('the pointer is drawn in screenshots at its real position', async () => {
  const ep = await bench.open({ task: 'hotkey', level: 1, seed: 1 });
  try {
    const before = await ep.env.zoom([300, 600, 340, 640]);
    await ep.env.act({ type: 'move', x: 310, y: 610 });
    const after = await ep.env.zoom([300, 600, 340, 640]);
    assert.notDeepEqual(before, after);
    assert.deepEqual(ep.env.cursor(), { x: 310, y: 610 });
  } finally {
    await ep.close();
  }
});
