// click-sequence: click numbered targets in ascending order.
import { C, circle, text } from '../lib/ui.js';
import { inCircle, penalty, placeCircles } from './common.js';

export const clickSequence = {
  id: 'click-sequence',
  title: 'Click targets in order',
  category: 'pointing',
  summary: 'Click numbered circles in ascending order (3 / 5 / 8 targets).',
  create({ rng, level, area }) {
    const n = [3, 5, 8][level - 1];
    const r = [28, 20, 13][level - 1];
    const targets = placeCircles(rng, area, Array(n).fill(r), 24);
    const st = { next: 0, errors: 0 };

    return {
      instruction: `Click the numbered circles in ascending order, from 1 to ${n}.`,
      onEvent(ev) {
        if (ev.type !== 'click' || st.next >= n) return;
        if (inCircle(ev, targets[st.next])) st.next++;
        else st.errors++;
      },
      draw(g) {
        targets.forEach((t, i) => {
          circle(g, t.x, t.y, t.r, i < st.next ? C.green : C.blue);
          text(g, String(i + 1), t.x, t.y + 1, { size: Math.round(r * 1.05), color: '#fff', align: 'center', baseline: 'middle', weight: 700 });
        });
      },
      status: () => ({
        done: st.next >= n,
        success: st.next >= n && st.errors === 0,
        score: (st.next / n) * penalty(st.errors, 0.2),
        metrics: { clicked: st.next, total: n, errors: st.errors },
      }),
      solution: () => targets.slice(st.next).map((t) => ({ type: 'click', x: t.x, y: t.y })),
    };
  },
};
