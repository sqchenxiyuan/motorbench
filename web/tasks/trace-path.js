// trace-path: move the pointer along a band from its green end to its red end
// without leaving it.
import { C, circle, stroke } from '../lib/ui.js';
import { Path, rdp, round1, round3 } from '../lib/geom.js';
import { CoverageTracker } from '../lib/track.js';
import { move } from './common.js';
import { inset, snake, spiral, wave, zigzag } from './paths.js';

export const tracePath = {
  id: 'trace-path',
  title: 'Trace a path',
  category: 'path',
  summary: 'Follow a band from start to end without leaving it: wide straight segments -> thin curves.',
  create({ rng, level, area }) {
    const width = [44, 26, 14][level - 1];
    const box = inset(area, 36);
    let pts;
    let kind;
    if (level === 1) [kind, pts] = ['zigzag', zigzag(rng, box, rng.int(3, 4))];
    else if (level === 2) [kind, pts] = rng.chance(0.5) ? ['zigzag', zigzag(rng, box, rng.int(5, 6))] : ['snake', snake(rng, box)];
    else [kind, pts] = rng.chance(0.5) ? ['wave', wave(rng, box, rng.int(6, 7))] : ['spiral', spiral(rng, box)];
    if (rng.chance(0.5)) pts.reverse();

    const path = new Path(pts);
    const markR = Math.max(width / 2, 9);
    // Tracking starts once the pointer has been to the green end, so the approach is free.
    const tracker = new CoverageTracker(path, width / 2, {
      start: { ...path.start, near: Math.max(2 * width, 50) },
      discs: [
        { ...path.start, r: markR },
        { ...path.end, r: markR },
      ],
    });

    return {
      instruction:
        'Move the pointer along the band from the green end to the red end. Stay inside the band the whole way. No mouse button is needed.',
      onEvent(ev) {
        if (ev.type === 'move' && !tracker.full) tracker.feed(ev.prev, ev);
      },
      draw(g) {
        stroke(g, path.pts, { color: C.blueSoft, width });
        for (const [a, b] of tracker.runs()) stroke(g, path.slice(a, b), { color: C.blue, width, cap: 'butt' });
        circle(g, path.start.x, path.start.y, markR, C.green, '#fff', 2);
        circle(g, path.end.x, path.end.y, markR, tracker.full ? C.green : C.red, '#fff', 2);
      },
      reveal(g) {
        stroke(g, path.pts, { color: 'rgba(17,24,39,0.35)', width: 1, dash: [4, 4] });
      },
      status: () => ({
        done: tracker.full,
        success: tracker.full && tracker.accuracy >= 0.99,
        // Share of the band traced, discounted by the share of the way spent off the band.
        score: tracker.coverage * tracker.accuracy,
        metrics: {
          kind,
          width,
          length: Math.round(path.length),
          started: tracker.armed,
          coverage: round3(tracker.coverage),
          accuracy: round3(tracker.accuracy),
          off_px: round1(tracker.off),
        },
      }),
      solution: () => rdp(path.pts, 0.5).map(move),
    };
  },
};
