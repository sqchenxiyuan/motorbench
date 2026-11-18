// draw-trace: hold the left button and draw over a dashed template line.
import { C, stroke } from '../lib/ui.js';
import { Path, rdp, round1, round3 } from '../lib/geom.js';
import { CoverageTracker } from '../lib/track.js';
import { circlePts, inset, wave, zigzag } from './paths.js';

function makeTemplate(rng, level, area) {
  const box = inset(area, 60);
  if (level === 1) {
    for (;;) {
      const a = { x: Math.round(rng.range(box.x, box.x + box.w)), y: Math.round(rng.range(box.y, box.y + box.h)) };
      const b = { x: Math.round(rng.range(box.x, box.x + box.w)), y: Math.round(rng.range(box.y, box.y + box.h)) };
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d >= 300 && d <= 600) return ['line', [a, b], false];
    }
  }
  const w = rng.range(520, 760);
  const sub = { x: box.x + rng.range(0, box.w - w), y: box.y + 40, w, h: box.h - 80 };
  if (level === 2) return ['zigzag', zigzag(rng, sub, rng.int(3, 4), 120), false];
  if (rng.chance(0.5)) return ['wave', wave(rng, sub, 5), false];
  const r = rng.range(130, 210);
  const cx = box.x + rng.range(r, box.w - r);
  const cy = box.y + rng.range(r, box.h - r);
  return ['circle', circlePts(cx, cy, r, rng.range(0, 6.28)), true];
}

export const drawTrace = {
  id: 'draw-trace',
  title: 'Draw over a line',
  category: 'drag',
  summary: 'Hold the button and draw over a dashed line: straight -> zigzag -> curve/circle, tolerance 12 / 8 / 5 px.',
  create({ rng, level, area }) {
    const tol = [12, 8, 5][level - 1];
    const [kind, pts, closed] = makeTemplate(rng, level, area);
    const path = new Path(pts, closed);
    const tracker = new CoverageTracker(path, tol);
    const strokes = [];
    const st = { drawing: false, finished: false };
    const covered = () => tracker.coverage >= 0.995;

    return {
      instruction: closed
        ? 'Press and hold the left mouse button and draw over the dashed circle, all the way around. Keep your stroke on the line.'
        : 'Press and hold the left mouse button and draw over the dashed line, covering it from one end to the other. Keep your stroke on the line.',
      onEvent(ev) {
        if (st.finished) return;
        if (ev.type === 'down' && ev.button === 0) {
          st.drawing = true;
          strokes.push([{ x: ev.x, y: ev.y }]);
          tracker.feed(null, ev);
        } else if (ev.type === 'move' && st.drawing && ev.prev) {
          strokes[strokes.length - 1].push({ x: ev.x, y: ev.y });
          tracker.feed(ev.prev, ev);
        } else if (ev.type === 'up' && ev.button === 0 && st.drawing) {
          st.drawing = false;
          if (covered()) st.finished = true;
        }
      },
      draw(g) {
        stroke(g, path.pts, { color: '#e5e7eb', width: 2 * tol });
        stroke(g, path.pts, { color: C.muted, width: 2, dash: [7, 6], cap: 'butt' });
        for (const s of strokes) stroke(g, s, { color: st.finished ? C.green : C.blue, width: 3 });
      },
      status: () => ({
        done: st.finished,
        success: st.finished && tracker.accuracy >= 0.97,
        score: tracker.coverage * tracker.accuracy,
        metrics: {
          kind,
          tolerance_px: tol,
          length: Math.round(path.length),
          coverage: round3(tracker.coverage),
          precision: round3(tracker.accuracy),
          stray_ink_px: round1(tracker.off),
          strokes: strokes.length,
        },
      }),
      solution: () => [{ type: 'drag', path: rdp(path.pts, 0.5).map((p) => [Math.round(p.x), Math.round(p.y)]) }],
    };
  },
};
