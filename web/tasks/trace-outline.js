// trace-outline: move the pointer all the way around the border of a shape,
// staying on the border band.
import { C, circle, fillPoly, stroke } from '../lib/ui.js';
import { Path, rdp, round1, round3 } from '../lib/geom.js';
import { CoverageTracker } from '../lib/track.js';
import { move } from './common.js';
import { blob, circlePts, ellipsePts, radialPolygon } from './paths.js';

function makeShape(rng, level, area) {
  const cx = area.x + area.w / 2 + rng.range(-area.w * 0.15, area.w * 0.15);
  const cy = area.y + area.h / 2 + rng.range(-20, 20);
  const R = Math.min(area.h / 2 - 50, 270); // largest radius that always fits
  if (level === 1) {
    if (rng.chance(0.5)) return ['circle', circlePts(cx, cy, rng.range(0.6 * R, 0.9 * R), rng.range(0, 6.28))];
    const w = rng.range(320, 560);
    const h = rng.range(0.9 * R, 1.6 * R);
    const x = Math.round(cx - w / 2);
    const y = Math.round(cy - h / 2);
    return ['rectangle', [{ x, y }, { x: Math.round(x + w), y }, { x: Math.round(x + w), y: Math.round(y + h) }, { x, y: Math.round(y + h) }]];
  }
  if (level === 2) {
    if (rng.chance(0.3)) return ['ellipse', ellipsePts(cx, cy, rng.range(0.85 * R, R), rng.range(0.45 * R, 0.65 * R), rng.range(-0.5, 0.5))];
    const n = rng.pick([3, 5, 6]);
    return [`polygon-${n}`, radialPolygon(cx, cy, n, [rng.range(0.75 * R, R)], rng.range(0, 6.28))];
  }
  if (rng.chance(0.5)) {
    const n = rng.pick([5, 6]);
    const outer = rng.range(0.85 * R, R);
    return [`star-${n}`, radialPolygon(cx, cy, 2 * n, [outer, outer * rng.range(0.45, 0.55)], rng.range(0, 6.28))];
  }
  return ['blob', blob(rng, cx, cy, 0.5 * R, R)];
}

export const traceOutline = {
  id: 'trace-outline',
  title: 'Trace the outline of a region',
  category: 'path',
  summary: 'Go once around the border of a shape, staying on the border band: circle/rectangle -> polygon -> star/blob.',
  create({ rng, level, area }) {
    const width = [36, 22, 12][level - 1];
    const [kind, pts] = makeShape(rng, level, area);
    const path = new Path(pts, true);
    // The lap starts (and ends) at a marked point, so that how the pointer gets to
    // the shape in the first place does not affect the score.
    const s0 = rng.range(0, path.length);
    const startPt = path.pointAt(s0);
    const markR = Math.max(width / 2, 9);
    const tracker = new CoverageTracker(path, width / 2, {
      start: { ...startPt, near: Math.max(2 * width, 50) },
      discs: [{ ...startPt, r: markR }],
    });
    const full = () => tracker.full;

    return {
      instruction:
        'Start at the green dot and move the pointer once all the way around the border of the shape, back to the green dot. Stay on the thick border band; either direction is fine. No mouse button is needed.',
      onEvent(ev) {
        if (ev.type === 'move' && !full()) tracker.feed(ev.prev, ev);
      },
      draw(g) {
        fillPoly(g, pts, '#eef2ff');
        stroke(g, pts, { color: C.blueSoft, width, closed: true });
        for (const [a, b] of tracker.runs()) stroke(g, path.slice(a, b), { color: C.blue, width, cap: 'butt' });
        circle(g, startPt.x, startPt.y, markR, C.green, '#fff', 2);
      },
      reveal(g) {
        stroke(g, pts, { color: 'rgba(17,24,39,0.35)', width: 1, dash: [4, 4], closed: true });
      },
      status: () => ({
        done: full(),
        success: full() && tracker.accuracy >= 0.99,
        score: tracker.coverage * tracker.accuracy,
        metrics: {
          kind,
          width,
          perimeter: Math.round(path.length),
          started: tracker.armed,
          coverage: round3(tracker.coverage),
          accuracy: round3(tracker.accuracy),
          off_px: round1(tracker.off),
        },
      }),
      solution() {
        // One lap from the start dot: the rest of its segment, on around, and back.
        const i = path._segAt(s0);
        const lap = [startPt, ...path.pts.slice(i + 1), ...path.pts.slice(1, i + 1), startPt];
        return rdp(lap, 0.5).map(move);
      },
    };
  },
};
