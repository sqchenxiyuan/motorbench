// Scoring behaviour on imperfect and adversarial play: shortcuts must not pay,
// mistakes must cost what the task says they cost, partial work earns partial credit.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Bench } from '../src/session.ts';
import type { Action } from '../src/types.ts';
import { play, seedWithKind } from './helpers.ts';
import type { Click, Drag, Move } from './helpers.ts';

let bench: Bench;
before(async () => {
  bench = await Bench.start();
});
after(() => bench.close());

const near = (actual: number, expected: number, tol = 0.011) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ~${expected}, got ${actual}`);
const metric = <T>(m: Record<string, unknown>, k: string) => m[k] as T;

// ---- trace-path ---------------------------------------------------------------

test('trace-path: a straight shortcut from start to end earns almost nothing', async () => {
  for (const [level, kind] of [[2, 'snake'], [3, 'wave'], [3, 'spiral']] as const) {
    const seed = await seedWithKind(bench, 'trace-path', level, kind);
    const st = await play(bench, 'trace-path', level, seed, (sol) => [sol[0], sol[sol.length - 1]]);
    assert.ok(st.score < 0.25, `${kind}: shortcut scored ${st.score}`);
    assert.equal(st.done, false);
  }
});

test('trace-path: going end-to-start earns next to nothing', async () => {
  const st = await play(bench, 'trace-path', 2, 3, (sol) => sol.slice().reverse());
  // Tracking only begins on arrival near the green end, so only that last stretch counts.
  assert.ok(st.score < 0.08, `score ${st.score}`);
  assert.equal(st.done, false);
});

test('trace-path: leaving the band and coming back completes but is not a pass', async () => {
  const seed = await seedWithKind(bench, 'trace-path', 2, 'snake');
  const st = await play(bench, 'trace-path', 2, seed, (sol) => {
    const moves = sol as Move[];
    // The snake's first leg is horizontal: step 150 px off it at its midpoint (towards
    // the middle of the screen), then return.
    const mid = { type: 'move' as const, x: Math.round((moves[0].x + moves[1].x) / 2), y: moves[0].y };
    const detour = { ...mid, y: mid.y + (mid.y > 428 ? -150 : 150) };
    return [moves[0], mid, detour, mid, ...moves.slice(1)];
  });
  assert.equal(st.done, true);
  assert.equal(st.success, false);
  near(metric<number>(st.metrics, 'coverage'), 1);
  assert.ok(st.score > 0.75 && st.score < 0.97, `score ${st.score}`);
});

test('trace-path: a skipped stretch is not covered, and the jump counts as off the band', async () => {
  const seed = await seedWithKind(bench, 'trace-path', 2, 'snake');
  // Snake vertices: 0 -> 1 (right), 1 -> 2 (down), 2 -> 3 (left), ... Jump from 1 straight to 3.
  const st = await play(bench, 'trace-path', 2, seed, (sol) => [sol[0], sol[1], ...sol.slice(3)]);
  assert.equal(st.done, false);
  const coverage = metric<number>(st.metrics, 'coverage');
  assert.ok(coverage > 0.4 && coverage < 0.8, `coverage ${coverage}`);
  assert.ok(metric<number>(st.metrics, 'accuracy') < 0.85);
  assert.ok(st.score < 0.6, `score ${st.score}`);
});

test('trace-path: starting a little past the green dot only loses that first stretch', async () => {
  const seed = await seedWithKind(bench, 'trace-path', 2, 'snake');
  const st = await play(bench, 'trace-path', 2, seed, (sol) => {
    const [a, b] = sol as Move[];
    const late = { type: 'move' as const, x: a.x + Math.sign(b.x - a.x) * 32, y: a.y }; // 32 px along the first leg
    return [late, ...sol.slice(1)];
  });
  assert.equal(metric<boolean>(st.metrics, 'started'), true);
  assert.equal(st.done, false);
  assert.ok(st.score > 0.97 && st.score < 1, `score ${st.score}`);
});

test('trace-path: tracing the band without ever visiting the green end earns nothing', async () => {
  const seed = await seedWithKind(bench, 'trace-path', 2, 'snake');
  const st = await play(bench, 'trace-path', 2, seed, (sol) => sol.slice(2)); // from the middle to the red end
  assert.equal(metric<boolean>(st.metrics, 'started'), false);
  assert.equal(st.score, 0);
});

// ---- trace-outline ------------------------------------------------------------

test('trace-outline: half a lap earns about half', async () => {
  const seed = await seedWithKind(bench, 'trace-outline', 1, 'circle');
  const st = await play(bench, 'trace-outline', 1, seed, (sol) => sol.slice(0, Math.ceil(sol.length / 2)));
  assert.equal(st.done, false);
  assert.ok(st.score > 0.4 && st.score < 0.6, `score ${st.score}`);
});

test('trace-outline: cutting across the shape is not a pass', async () => {
  const seed = await seedWithKind(bench, 'trace-outline', 1, 'circle');
  const st = await play(bench, 'trace-outline', 1, seed, (sol) => {
    const q = Math.floor(sol.length / 4);
    return [...sol.slice(0, q), ...sol.slice(2 * q)]; // skip a quarter of the circle via a chord
  });
  assert.equal(st.success, false);
  assert.ok(st.score < 0.8, `score ${st.score}`);
});

test('trace-outline: nothing counts until the pointer has been to the green dot', async () => {
  const distToSegment = (p: Move, a: { x: number; y: number }, b: { x: number; y: number }) => {
    const [dx, dy] = [b.x - a.x, b.y - a.y];
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  };
  for (let seed = 1; seed <= 40; seed++) {
    const ep = await bench.open({ task: 'trace-outline', level: 1, seed }, { privileged: true, maxActions: 100 });
    try {
      if ((await ep.status()).metrics.kind !== 'rectangle') continue;
      const lap = (await ep.env.solution!()) as Move[]; // start dot, four corners, start dot
      const [start, , c, d] = lap;
      // The far edge c-d, and the way to it, must stay clear of the start dot's neighbourhood.
      if (distToSegment(start, ep.env.cursor(), c) < 100 || distToSegment(start, c, d) < 100) continue;

      await ep.env.act(c);
      await ep.env.act(d);
      const before = await ep.status();
      assert.equal(before.metrics.started, false);
      assert.equal(before.score, 0);

      for (const a of lap) await ep.env.act(a);
      const { status } = await ep.finish();
      assert.equal(status.score, 1, JSON.stringify(status.metrics));
      assert.equal(status.success, true);
      return;
    } finally {
      await ep.close();
    }
  }
  assert.fail('no suitable rectangle instance found');
});

// ---- maze ---------------------------------------------------------------------

test('maze: a straight line through the walls makes no progress', async () => {
  for (const seed of [1, 2, 3]) {
    const st = await play(bench, 'maze', 3, seed, (sol) => [sol[0], sol[sol.length - 1]]);
    assert.equal(st.done, false);
    assert.ok(metric<number>(st.metrics, 'wall_hits') >= 1);
    assert.ok(st.score < 0.3, `seed ${seed}: score ${st.score}`);
  }
});

test('maze: one wall hit, then a clean run, scores 0.75', async () => {
  const st = await play(bench, 'maze', 2, 4, (sol) => {
    const start = sol[0] as Move;
    // The start cell is in the first column: leave the maze through its left wall and come back.
    return [start, { type: 'move', x: start.x - 110, y: start.y }, ...sol];
  });
  assert.equal(st.done, true);
  assert.equal(st.success, false);
  assert.equal(metric<number>(st.metrics, 'wall_hits'), 1);
  near(st.score, 0.75);
});

// ---- pointing -----------------------------------------------------------------

test('click: each stray click costs a quarter', async () => {
  const st = await play(bench, 'click', 1, 3, (sol) => {
    const hit = sol[0] as Click;
    const miss: Action = { type: 'click', x: hit.x! + 44, y: hit.y }; // radius is 36 at level 1
    return [miss, miss, hit];
  });
  assert.equal(st.done, true);
  assert.equal(st.success, false);
  near(st.score, 0.5);
});

test('click: the wrong button is a miss', async () => {
  const st = await play(bench, 'right-click', 1, 3, (sol) => {
    const hit = sol[0] as Click;
    return [{ ...hit, button: 'left' }, hit];
  });
  near(st.score, 0.75);
});

test('double-click: two slow single clicks do not count, and are not penalised', async () => {
  const st = await play(bench, 'double-click', 1, 3, async (sol, ep) => {
    const hit = sol[0] as Click;
    await ep.env.act({ ...hit, count: 1 });
    await ep.env.act({ type: 'wait', seconds: 0.9 });
    await ep.env.act({ ...hit, count: 1 });
    assert.equal((await ep.status()).done, false);
    await ep.env.act({ type: 'wait', seconds: 0.9 });
    return [hit];
  });
  assert.equal(st.score, 1);
  assert.equal(st.success, true);
});

test('click-sequence: out-of-order clicks are errors and do not advance', async () => {
  const st = await play(bench, 'click-sequence', 1, 2, (sol) => [sol[1], sol[0], sol[1]]); // 2, 1, 2 then stop
  assert.equal(st.done, false);
  near(st.score, (2 / 3) * 0.8);
});

test('hover: leaving early earns partial credit, pressing a button halves it', async () => {
  // Sweep straight across the target without stopping, then wait somewhere else.
  const early = await play(bench, 'hover', 1, 2, (sol) => {
    const m = sol[0] as Move;
    return [{ type: 'move', x: m.x - 60, y: m.y }, { type: 'move', x: m.x + 60, y: m.y }, { type: 'wait', seconds: 1.2 }];
  });
  assert.equal(early.done, false);
  assert.ok(early.score > 0 && early.score < 0.5, `score ${early.score}`);

  const pressed = await play(bench, 'hover', 1, 2, (sol) => {
    const m = sol[0] as Move;
    return [{ type: 'click', x: m.x, y: m.y }, { type: 'wait', seconds: 1.3 }];
  });
  assert.equal(pressed.done, true);
  assert.equal(pressed.success, false);
  near(pressed.score, 0.5);
});

// ---- dragging -----------------------------------------------------------------

test('drag-drop: holding the square over the box without releasing earns half', async () => {
  const st = await play(bench, 'drag-drop', 1, 2, async (sol, ep) => {
    const [[x0, y0], [x1, y1]] = (sol[0] as Drag).path;
    await ep.env.act({ type: 'move', x: x0, y: y0 });
    await ep.env.act({ type: 'mouse_down' });
    await ep.env.act({ type: 'move', x: x1, y: y1 });
    const held = await ep.status();
    assert.equal(held.done, false);
    near(held.score, 0.5);
    return [{ type: 'mouse_up' }];
  });
  assert.equal(st.score, 1);
  assert.equal(st.success, true);
});

test('drag-drop: a drop that overlaps the box only partly earns that fraction', async () => {
  const st = await play(bench, 'drag-drop', 3, 2, (sol) => {
    const [from, [x1, y1]] = (sol[0] as Drag).path;
    return [{ type: 'drag', path: [from, [x1 + 32, y1]] }]; // box is 64 px wide, square 56: 28 px hang out
  });
  assert.equal(st.done, false);
  near(st.score, 0.5, 0.02);
});

test('slider: an error of 3 units in 100 scores 0.7', async () => {
  const st = await play(bench, 'slider', 2, 2, (sol) => {
    const [from, [x1, y1]] = (sol[0] as Drag).path;
    return [{ type: 'drag', path: [from, [x1 + (x1 < 1000 ? 15 : -15), y1]] }]; // 5 px per unit
  });
  assert.equal(metric<number>(st.metrics, 'error'), 3);
  near(st.score, 0.7);
  assert.equal(st.done, false);
});

test('draw-trace: moving along the line without pressing draws nothing', async () => {
  const st = await play(bench, 'draw-trace', 2, 2, (sol) => (sol[0] as Drag).path.map(([x, y]) => ({ type: 'move', x, y }) as Action));
  assert.equal(st.score, 0);
});

test('draw-trace: several strokes are fine, stray ink lowers precision', async () => {
  const twoStrokes = await play(bench, 'draw-trace', 2, 2, (sol) => {
    const path = (sol[0] as Drag).path;
    return [
      { type: 'drag', path: path.slice(1) },
      { type: 'drag', path: path.slice(0, 2) },
    ];
  });
  assert.equal(twoStrokes.success, true);

  const stray = await play(bench, 'draw-trace', 1, 2, (sol) => {
    const [[x0, y0], [x1, y1]] = (sol[0] as Drag).path;
    const len = Math.hypot(x1 - x0, y1 - y0);
    // A second stroke of the same length, parallel to the line but 60 px away from it.
    const [nx, ny] = [(-(y1 - y0) / len) * 60, ((x1 - x0) / len) * 60];
    const inside = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v)));
    return [
      { type: 'drag', path: [[inside(x0 + nx, 1279), inside(y0 + ny, 799)], [inside(x1 + nx, 1279), inside(y1 + ny, 799)]] },
      sol[0],
    ];
  });
  assert.equal(stray.done, true);
  assert.equal(stray.success, false);
  assert.ok(stray.score > 0.4 && stray.score < 0.6, `score ${stray.score}`);
});

test('marquee: selecting everything scores blue / (blue + red)', async () => {
  const st = await play(bench, 'marquee', 2, 2, () => [{ type: 'drag', path: [[10, 70], [1270, 790]] }]);
  assert.equal(st.done, false);
  near(st.score, 7 / (7 + 9));
});

test('resize: fixing one of two corners earns about half', async () => {
  const st = await play(bench, 'resize', 3, 2, (sol) => [sol[0]]);
  assert.equal(st.done, false);
  assert.ok(st.score > 0.3 && st.score < 0.7, `score ${st.score}`);
  assert.equal(metric<number>(st.metrics, 'corners_to_move'), 2);
});

test('resize: the handle has to be grabbed, and released', async () => {
  const missed = await play(bench, 'resize', 2, 2, (sol) => {
    const [[x0, y0], to] = (sol[0] as Drag).path;
    return [{ type: 'drag', path: [[x0 + 20, y0 + 20], to] }]; // press 20 px away from the 13 px handle
  });
  assert.equal(missed.score, 0);

  const st = await play(bench, 'resize', 1, 2, async (sol, ep) => {
    const [[x0, y0], [x1, y1]] = (sol[0] as Drag).path;
    await ep.env.act({ type: 'move', x: x0, y: y0 });
    await ep.env.act({ type: 'mouse_down' });
    await ep.env.act({ type: 'move', x: x1, y: y1 });
    const held = await ep.status();
    assert.equal(held.done, false);
    near(held.score, 0.5);
    return [{ type: 'mouse_up' }];
  });
  assert.equal(st.success, true);
});

test('rotate: ten degrees off scores 1 - 10/45', async () => {
  const st = await play(bench, 'rotate', 2, 3, async (sol, ep) => {
    const m = (await ep.status()).metrics as { target: number; dial: { x: number; y: number; r: number } };
    const a = ((m.target + 10) * Math.PI) / 180; // clockwise from straight up
    const off = [Math.round(m.dial.x + 2 * m.dial.r * Math.sin(a)), Math.round(m.dial.y - 2 * m.dial.r * Math.cos(a))] as [number, number];
    return [{ type: 'drag', path: [(sol[0] as Drag).path[0], off] }];
  });
  assert.equal(metric<number>(st.metrics, 'error_deg'), 10);
  near(st.score, 1 - 10 / 45);
  assert.equal(st.done, false);
});

test('rotate: pressing anywhere but the handle does not turn the dial', async () => {
  const st = await play(bench, 'rotate', 1, 3, async (sol, ep) => {
    const { dial } = (await ep.status()).metrics as { dial: { x: number; y: number; r: number } };
    return [{ type: 'drag', path: [[dial.x, dial.y], (sol[0] as Drag).path[1]] }]; // starts at the hub
  });
  assert.equal(st.score, 0);
  assert.equal(metric<number>(st.metrics, 'drags'), 0);
});

test('reorder: one move of several earns partial credit; putting a card back changes nothing', async () => {
  const part = await play(bench, 'reorder', 3, 1, (sol) => {
    assert.ok(sol.length >= 3, 'level 3 needs several moves');
    return [sol[0]];
  });
  assert.equal(part.done, false);
  assert.ok(part.score > 0 && part.score < 1, `score ${part.score}`);
  assert.equal(metric<number>(part.metrics, 'moves'), 1);

  const same = await play(bench, 'reorder', 2, 1, (sol) => {
    const [from] = (sol[0] as Drag).path;
    return [{ type: 'drag', path: [from, [from[0] + 150, from[1] + 9], from] }]; // wander off and come back
  });
  assert.equal(same.score, 0);
  assert.equal(metric<number>(same.metrics, 'moves'), 1);
});

test('drag-bins: tokens in the wrong box cost half a token each', async () => {
  const st = await play(bench, 'drag-bins', 2, 1, (sol) => {
    const into = (sol[0] as Drag).path[1];
    return sol.map((d, i) => ({ type: 'drag', path: [(d as Drag).path[0], [into[0] - 30 + i * 15, into[1]]] }) as Action); // everything into one box
  });
  const { correct, wrong } = st.metrics as { correct: number; wrong: number };
  assert.equal(correct + wrong, 5);
  assert.ok(wrong >= 2);
  near(st.score, Math.max(0, (correct - 0.5 * wrong) / 5));
  assert.equal(st.done, false);
});

test('drag-bins: a misplaced token can be picked up again and put right', async () => {
  const st = await play(bench, 'drag-bins', 2, 1, async (sol, ep) => {
    const drags = sol as Drag[];
    const first = drags[0].path;
    const elsewhere = drags.find((d) => Math.abs(d.path[1][0] - first[1][0]) > 100)!.path[1]; // some other box
    await ep.env.act({ type: 'drag', path: [first[0], elsewhere] });
    assert.equal((await ep.status()).metrics.wrong, 1);
    return [{ type: 'drag', path: [elsewhere, first[1]] }, ...drags.slice(1)];
  });
  assert.equal(st.success, true);
  assert.equal(st.score, 1);
});

test('text-select: one character short scores (n - 1) / n; a click selects nothing', async () => {
  const short = await play(bench, 'text-select', 1, 2, (sol) => {
    const [from, [x1, y1]] = (sol[0] as Drag).path;
    return [{ type: 'drag', path: [from, [x1 - 18, y1]] }]; // characters are 18 px wide at level 1
  });
  const n = metric<string>(short.metrics, 'phrase').length;
  assert.equal(metric<string>(short.metrics, 'selected'), metric<string>(short.metrics, 'phrase').slice(0, -1));
  near(short.score, (n - 1) / n);
  assert.equal(short.done, false);

  const click = await play(bench, 'text-select', 1, 2, (sol) => {
    const [[x, y]] = (sol[0] as Drag).path;
    return [sol[0], { type: 'click', x, y }]; // the right selection, then a click that clears it
  });
  assert.equal(click.score, 1, 'the episode ends as soon as the selection is right');

  const cleared = await play(bench, 'text-select', 1, 2, (sol) => {
    const [[x0, y0], [x1, y1]] = (sol[0] as Drag).path;
    return [{ type: 'drag', path: [[x0, y0], [x1 + 36, y1]] }, { type: 'click', x: x0, y: y0 }];
  });
  assert.equal(cleared.score, 0);
});

test('text-select: selecting far too much earns little', async () => {
  const st = await play(bench, 'text-select', 3, 1, (sol) => {
    const [[, y0], [, y1]] = (sol[0] as Drag).path;
    return [{ type: 'drag', path: [[40, y0 - 200], [1240, y1 + 200]] }]; // the whole block
  });
  assert.ok(st.score > 0 && st.score < 0.2, `score ${st.score}`);
});

test('pan: part of the way earns part of the score; the map has to be released', async () => {
  const part = await play(bench, 'pan', 3, 1, (sol) => {
    assert.ok(sol.length >= 3, 'level 3 needs several drags');
    return [sol[0]];
  });
  assert.equal(part.done, false);
  assert.ok(part.score > 0.1 && part.score < 0.6, `score ${part.score}`);

  const st = await play(bench, 'pan', 1, 1, async (sol, ep) => {
    const [[x0, y0], [x1, y1]] = (sol[0] as Drag).path;
    await ep.env.act({ type: 'move', x: x0, y: y0 });
    await ep.env.act({ type: 'mouse_down' });
    await ep.env.act({ type: 'move', x: x1, y: y1 });
    near((await ep.status()).score, 0.5);
    return [{ type: 'mouse_up' }];
  });
  assert.equal(st.success, true);
});

// ---- scrolling ----------------------------------------------------------------

test('scroll-click: bringing the row into view without clicking earns 0.3', async () => {
  const st = await play(bench, 'scroll-click', 2, 2, (sol) => [sol[0]]);
  assert.equal(st.done, false);
  near(st.score, 0.3);
});

test('scroll-click: a wrong row costs a quarter', async () => {
  const st = await play(bench, 'scroll-click', 2, 2, (sol) => {
    const hit = sol[1] as Click;
    return [sol[0], { ...hit, y: hit.y! + 44 }, hit]; // rows are 44 px tall
  });
  assert.equal(st.done, true);
  near(st.score, 0.75);
});

test('scroll-click: dragging the scrollbar thumb scrolls the list', async () => {
  const st = await play(bench, 'scroll-click', 1, 2, async (sol, ep) => {
    const click = sol[1] as Click;
    const thumbX = click.x! + 230 - 7; // panel is 460 wide, scrollbar 14 px on its right edge
    await ep.env.act({ type: 'drag', path: [[thumbX, 110], [thumbX, 760]] });
    const s = await ep.status();
    assert.ok(metric<number>(s.metrics, 'scroll_top') > 500, JSON.stringify(s.metrics));
  });
  assert.equal(st.done, false);
});

// ---- keyboard -----------------------------------------------------------------

test('type-text: typing without focusing the box does nothing; a typo costs a little', async () => {
  const unfocused = await play(bench, 'type-text', 1, 2, (sol) => [sol[1]]);
  assert.equal(unfocused.score, 0);

  const typo = await play(bench, 'type-text', 2, 2, (sol) => {
    const text = (sol[1] as Extract<Action, { type: 'type' }>).text;
    return [sol[0], { type: 'type', text: `${text.slice(0, 5)}x${text.slice(6)}` }];
  });
  assert.equal(typo.done, false);
  assert.equal(metric<number>(typo.metrics, 'edit_distance'), 1);
  assert.ok(typo.score > 0.9 && typo.score < 1);
});

test('type-text level 3: appending instead of replacing is not a pass', async () => {
  const st = await play(bench, 'type-text', 3, 2, (sol) => [sol[0], sol[2]]); // click, type (no select-all)
  assert.equal(st.success, false);
  assert.ok(st.score < 0.9, `score ${st.score}`);
});

test('hotkey: a wrong shortcut costs a quarter; dialect key names are accepted', async () => {
  const st = await play(bench, 'hotkey', 2, 2, (sol) => [{ type: 'key', keys: 'ctrl+alt+q' }, sol[0]]);
  assert.equal(st.done, true);
  near(st.score, 0.75);

  const loose = await play(bench, 'hotkey', 3, 1, async (_sol, ep) => {
    // Level 3 seed 1 asks for: Ctrl+Shift+Y, Right Arrow, Ctrl+B.
    assert.match(ep.info.instruction, /Ctrl\+Shift\+Y, then Right Arrow, then Ctrl\+B/);
    return [
      { type: 'key', keys: 'ctrl+shift+y' },
      { type: 'key', keys: 'Right' },
      { type: 'key', keys: 'Control+b' },
    ];
  });
  assert.equal(loose.success, true);
});

// ---- environment --------------------------------------------------------------

test('invalid actions are reported, cost an action, and do not crash the episode', async () => {
  const ep = await bench.open({ task: 'click', level: 1, seed: 1 }, { maxActions: 4 });
  try {
    const bad = await ep.env.act({ type: 'move', x: 5000, y: 10 });
    assert.equal(bad.ok, false);
    assert.match(bad.error!, /outside/);
    assert.equal((await ep.env.act({ type: 'key', keys: 'NoSuchKey' })).ok, false);
    assert.equal((await ep.env.act({ type: 'mouse_up' })).ok, false);
    const last = await ep.env.act({ type: 'move', x: 100, y: 100 });
    assert.equal(last.ok, true);
    assert.equal(last.done, true); // budget of 4 is used up
    const over = await ep.env.act({ type: 'move', x: 120, y: 100 });
    assert.equal(over.ok, false);
    assert.match(over.error!, /budget/);
    assert.equal(ep.env.finished, 'budget');
  } finally {
    await ep.close();
  }
});
