// rotate: drag the handle of a dial around its centre until the dial reads a given angle.
import { C, circle, text, MONO } from '../lib/ui.js';
import { round1 } from '../lib/geom.js';

const KNOB = 12;

export const rotate = {
  id: 'rotate',
  title: 'Turn a dial',
  category: 'drag',
  summary: 'Drag a dial handle around its centre to an exact angle: steps of 15 / 5 / 1 degree.',
  create({ rng, level, area }) {
    const step = [15, 5, 1][level - 1];
    const R = [130, 110, 90][level - 1];
    const cx = Math.round(area.x + area.w / 2 + rng.range(-260, 260));
    const cy = Math.round(area.y + area.h / 2 + 30 + rng.range(-30, 30));
    const diff = (a, b) => {
      const d = Math.abs(a - b) % 360;
      return Math.min(d, 360 - d);
    };
    const start = rng.int(0, 360 / step - 1) * step;
    let target;
    do target = rng.int(0, 360 / step - 1) * step;
    while (diff(target, start) < 60);

    // Angles are in degrees, clockwise from straight up.
    const at = (deg, r) => ({ x: cx + r * Math.sin((deg * Math.PI) / 180), y: cy - r * Math.cos((deg * Math.PI) / 180) });
    const st = { angle: start, grab: false, drags: 0 };
    const value = () => (Math.round(st.angle / step) * step) % 360;
    const knob = () => at(st.angle, R);

    return {
      instruction: `Drag the dial's handle around until the dial reads ${target}°, then release it.`,
      onEvent(ev) {
        if (ev.type === 'down' && ev.button === 0) {
          const k = knob();
          if (Math.hypot(ev.x - k.x, ev.y - k.y) <= KNOB + 2) st.grab = true;
        } else if (ev.type === 'move' && st.grab) {
          // The handle follows the direction of the pointer from the centre, whatever the distance.
          if (ev.x !== cx || ev.y !== cy) st.angle = ((Math.atan2(ev.x - cx, cy - ev.y) * 180) / Math.PI + 360) % 360;
        } else if (ev.type === 'up' && ev.button === 0 && st.grab) {
          st.grab = false;
          st.drags++;
        }
      },
      draw(g) {
        const v = value();
        const ok = !st.grab && v === target;
        text(g, `${v}°`, cx, cy - R - 58, { size: 44, color: ok ? C.green : C.ink, align: 'center', weight: 700, font: MONO });
        circle(g, cx, cy, R, '#fff', C.line, 3);
        for (let d = 0; d < 360; d += 15) {
          const major = d % 90 === 0;
          const a = at(d, R - (major ? 16 : 9));
          const b = at(d, R - 3);
          g.beginPath();
          g.moveTo(a.x, a.y);
          g.lineTo(b.x, b.y);
          g.strokeStyle = major ? C.ink : C.gray;
          g.lineWidth = major ? 2.5 : 1.5;
          g.stroke();
          if (major) {
            const p = at(d, R + 22);
            text(g, String(d), p.x, p.y + 1, { size: 14, color: C.muted, align: 'center', baseline: 'middle' });
          }
        }
        const k = knob();
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(k.x, k.y);
        g.strokeStyle = ok ? C.green : C.blue;
        g.lineWidth = 4;
        g.lineCap = 'round';
        g.stroke();
        circle(g, cx, cy, 6, C.ink);
        circle(g, k.x, k.y, KNOB, '#fff', ok ? C.green : C.blue, 4);
      },
      status() {
        const err = diff(value(), target);
        const held = st.grab;
        return {
          done: !held && err === 0,
          success: !held && err === 0,
          // Linear credit that reaches zero at 45 degrees off; still holding the handle earns half.
          score: Math.max(0, 1 - err / 45) * (held ? 0.5 : 1),
          metrics: { value: value(), target, error_deg: err, step_deg: step, dial: { x: cx, y: cy, r: R }, drags: st.drags, released: !held },
        };
      },
      solution() {
        // Release well outside the dial: the further from the centre, the finer the angle control.
        let r = 3 * R;
        let far = at(target, r);
        while (r > R && (far.x < area.x + 10 || far.x > area.x + area.w - 10 || far.y < area.y + 10 || far.y > area.y + area.h - 10)) {
          r -= 10;
          far = at(target, r);
        }
        const k = knob();
        return [{ type: 'drag', path: [[Math.round(k.x), Math.round(k.y)], [Math.round(far.x), Math.round(far.y)]] }];
      },
    };
  },
};
