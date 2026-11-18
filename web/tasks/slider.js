// slider: drag a slider handle until the readout shows the requested value.
import { C, circle, rect, text, MONO } from '../lib/ui.js';
import { clamp } from '../lib/geom.js';

export const slider = {
  id: 'slider',
  title: 'Set a slider',
  category: 'drag',
  summary: 'Drag a slider handle to an exact value: 50 / 5 / 2.4 px per unit.',
  create({ rng, level, area }) {
    const [range, len] = [
      [10, 500],
      [100, 500],
      [100, 240],
    ][level - 1];
    const x0 = Math.round(area.x + rng.range(60, area.w - len - 60));
    const y = Math.round(area.y + rng.range(140, area.h - 80));
    const hr = 12;
    const px = (v) => Math.round(x0 + (v / range) * len);
    const value = (hx) => Math.round(((hx - x0) / len) * range);

    const start = rng.int(0, range);
    let target;
    do target = rng.int(0, range);
    while (Math.abs(target - start) < range * 0.25);
    const st = { hx: px(start), grab: null, drags: 0 };

    return {
      instruction: `Drag the slider handle until the value reads ${target}, then release it.`,
      onEvent(ev) {
        if (ev.type === 'down' && ev.button === 0 && Math.hypot(ev.x - st.hx, ev.y - y) <= hr + 2) st.grab = { dx: ev.x - st.hx };
        else if (ev.type === 'move' && st.grab) st.hx = clamp(ev.x - st.grab.dx, x0, x0 + len);
        else if (ev.type === 'up' && ev.button === 0 && st.grab) {
          st.grab = null;
          st.drags++;
        }
      },
      draw(g) {
        const v = value(st.hx);
        const ok = !st.grab && v === target;
        text(g, 'Value', x0 + len / 2, y - 92, { size: 15, color: C.muted, align: 'center' });
        text(g, String(v), x0 + len / 2, y - 44, { size: 44, color: ok ? C.green : C.ink, align: 'center', weight: 700, font: MONO });
        rect(g, { x: x0, y: y - 3, w: len, h: 6 }, { fill: C.line, radius: 3 });
        rect(g, { x: x0, y: y - 3, w: st.hx - x0, h: 6 }, { fill: ok ? C.green : C.blue, radius: 3 });
        text(g, '0', x0, y + 34, { size: 14, color: C.muted, align: 'center' });
        text(g, String(range), x0 + len, y + 34, { size: 14, color: C.muted, align: 'center' });
        circle(g, st.hx, y, hr, '#fff', ok ? C.green : C.blue, 4);
      },
      status() {
        const err = Math.abs(value(st.hx) - target);
        const held = !!st.grab;
        return {
          done: !held && err === 0,
          success: !held && err === 0,
          // Linear credit that reaches zero at an error of 10% of the range.
          score: Math.max(0, 1 - err / (0.1 * range)) * (held ? 0.5 : 1),
          metrics: { value: value(st.hx), target, error: err, range, px_per_unit: len / range, drags: st.drags, released: !held },
        };
      },
      solution: () => [{ type: 'drag', path: [[st.hx, y], [px(target), y]] }],
    };
  },
};
