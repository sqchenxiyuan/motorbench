// hover: move onto a target and stay there (without pressing a button) for one second.
import { C, circle, check } from '../lib/ui.js';
import { round3 } from '../lib/geom.js';
import { inCircle, placeCircles } from './common.js';

const DWELL_MS = 1000;

export const hover = {
  id: 'hover',
  title: 'Hover and hold',
  category: 'pointing',
  summary: 'Move onto a target and keep the pointer there for one second, no clicking.',
  create({ rng, level, area, now }) {
    const r = [36, 18, 9][level - 1];
    const [target] = placeCircles(rng, area, [r + 8]);
    target.r = r;
    const st = { since: null, best: 0, presses: 0, done: false };

    const update = () => {
      if (st.done || st.since == null) return;
      const p = (now() - st.since) / DWELL_MS;
      st.best = Math.max(st.best, Math.min(1, p));
      if (p >= 1) st.done = true;
    };
    // Repaint every frame while the ring is filling, and once more when it completes.
    const tick = () => {
      const filling = !st.done && st.since != null;
      update();
      return filling;
    };

    return {
      instruction: 'Move the pointer onto the blue circle and keep it there until the ring around it fills up. Do not press any mouse button.',
      onEvent(ev) {
        if (st.done) return;
        if (ev.type === 'down') st.presses++;
        if (ev.type !== 'move') return;
        if (inCircle(ev, target)) {
          if (st.since == null) st.since = now();
        } else {
          update();
          st.since = null;
        }
      },
      tick,
      draw(g) {
        const p = st.done ? 1 : st.since == null ? 0 : Math.min(1, (now() - st.since) / DWELL_MS);
        circle(g, target.x, target.y, r, st.done ? C.green : C.blue);
        circle(g, target.x, target.y, r + 6, null, C.line, 4);
        if (p > 0) {
          g.beginPath();
          g.arc(target.x, target.y, r + 6, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
          g.strokeStyle = st.done ? C.green : C.amber;
          g.lineWidth = 4;
          g.stroke();
        }
        if (st.done) check(g, target.x, target.y, r * 1.1);
      },
      status() {
        update();
        return {
          done: st.done,
          success: st.done && st.presses === 0,
          score: st.best * (st.presses ? 0.5 : 1),
          metrics: { dwell: round3(st.best), presses: st.presses, radius: r },
        };
      },
      solution: () => [
        { type: 'move', x: target.x, y: target.y },
        { type: 'wait', seconds: DWELL_MS / 1000 + 0.3 },
      ],
    };
  },
};
