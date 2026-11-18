// pan: drag a map around until a pin sits inside the ring at the centre of the view.
import { C, circle, rect, text } from '../lib/ui.js';
import { inRect, round1 } from '../lib/geom.js';

const GRID = 100;
const PIN = 7;

export const pan = {
  id: 'pan',
  title: 'Pan a map',
  category: 'drag',
  summary: 'Drag a map to bring a pin into the ring at the centre: one short drag -> several drags -> far away with a small ring (40 / 24 / 13 px).',
  create({ rng, level, area }) {
    const ringR = [40, 24, 13][level - 1];
    const panel = { x: Math.round(area.x + (area.w - 860) / 2 + rng.range(-120, 120)), y: area.y + 44, w: 860, h: area.h - 60 };
    const centre = { x: Math.round(panel.x + panel.w / 2), y: Math.round(panel.y + panel.h / 2) };
    const far = [rng.range(150, 240), rng.range(520, 800), rng.range(1200, 1700)][level - 1];
    const dir = rng.range(0, Math.PI * 2);
    // The pin's position on the map; `off` is how far the map has been dragged.
    const pin = { x: Math.round(centre.x + far * Math.cos(dir)), y: Math.round(centre.y + far * Math.sin(dir)) };
    const off = { x: 0, y: 0 };
    const st = { grab: null, drags: 0 };
    const pinOnScreen = () => ({ x: pin.x + off.x, y: pin.y + off.y });
    const distance = () => {
      const p = pinOnScreen();
      return Math.hypot(p.x - centre.x, p.y - centre.y);
    };
    const d0 = distance();

    return {
      instruction: 'Drag the map until the red pin is inside the ring at the centre of the view, then release.',
      onEvent(ev) {
        if (ev.type === 'down' && ev.button === 0 && inRect(ev, panel)) st.grab = { x: ev.x, y: ev.y };
        else if (ev.type === 'move' && st.grab) {
          off.x += ev.x - st.grab.x;
          off.y += ev.y - st.grab.y;
          st.grab = { x: ev.x, y: ev.y };
        } else if (ev.type === 'up' && ev.button === 0 && st.grab) {
          st.grab = null;
          st.drags++;
        }
      },
      draw(g) {
        const d = distance();
        const ok = !st.grab && d <= ringR;
        rect(g, panel, { fill: '#fff' });
        g.save();
        g.beginPath();
        g.rect(panel.x, panel.y, panel.w, panel.h);
        g.clip();
        // Grid with map coordinates, so that movement is visible.
        g.beginPath();
        const gx0 = Math.floor((panel.x - off.x) / GRID) * GRID;
        const gy0 = Math.floor((panel.y - off.y) / GRID) * GRID;
        for (let x = gx0; x + off.x <= panel.x + panel.w; x += GRID) {
          g.moveTo(x + off.x, panel.y);
          g.lineTo(x + off.x, panel.y + panel.h);
        }
        for (let y = gy0; y + off.y <= panel.y + panel.h; y += GRID) {
          g.moveTo(panel.x, y + off.y);
          g.lineTo(panel.x + panel.w, y + off.y);
        }
        g.strokeStyle = '#d1d5db';
        g.lineWidth = 1;
        g.stroke();
        const lx0 = Math.floor((panel.x - off.x) / (2 * GRID)) * 2 * GRID;
        const ly0 = Math.floor((panel.y - off.y) / (2 * GRID)) * 2 * GRID;
        for (let x = lx0; x + off.x <= panel.x + panel.w; x += 2 * GRID) {
          for (let y = ly0; y + off.y <= panel.y + panel.h; y += 2 * GRID) text(g, `${x},${y}`, x + off.x + 5, y + off.y + 14, { size: 11, color: '#9ca3af' });
        }
        const p = pinOnScreen();
        circle(g, p.x, p.y, PIN, C.red, '#fff', 2);
        // Ring and cross-hair, fixed at the centre of the view.
        circle(g, centre.x, centre.y, ringR, ok ? 'rgba(22,163,74,0.15)' : null, ok ? C.green : C.ink, 2.5);
        g.beginPath();
        for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          g.moveTo(centre.x + ax * (ringR + 4), centre.y + ay * (ringR + 4));
          g.lineTo(centre.x + ax * (ringR + 14), centre.y + ay * (ringR + 14));
        }
        g.strokeStyle = ok ? C.green : C.ink;
        g.lineWidth = 2;
        g.stroke();
        // When the pin is out of view, an arrow at the edge shows where it is and how far.
        if (!inRect(p, panel)) {
          const a = Math.atan2(p.y - centre.y, p.x - centre.x);
          const reach = Math.min((panel.w / 2 - 34) / Math.abs(Math.cos(a) || 1e-9), (panel.h / 2 - 34) / Math.abs(Math.sin(a) || 1e-9));
          const tip = { x: centre.x + reach * Math.cos(a), y: centre.y + reach * Math.sin(a) };
          g.beginPath();
          g.moveTo(tip.x, tip.y);
          g.lineTo(tip.x - 18 * Math.cos(a - 0.45), tip.y - 18 * Math.sin(a - 0.45));
          g.lineTo(tip.x - 18 * Math.cos(a + 0.45), tip.y - 18 * Math.sin(a + 0.45));
          g.closePath();
          g.fillStyle = C.red;
          g.fill();
          text(g, `${Math.round(d)} px`, tip.x - 44 * Math.cos(a), tip.y - 44 * Math.sin(a) + 1, { size: 13, color: C.red, align: 'center', baseline: 'middle', weight: 600 });
        }
        g.restore();
        rect(g, panel, { color: C.line, width: 2 });
      },
      status() {
        const d = distance();
        const held = !!st.grab;
        return {
          done: !held && d <= ringR,
          success: !held && d <= ringR,
          // Share of the way to the ring that has been covered; still holding the map earns half.
          score: Math.min(1, Math.max(0, 1 - (d - ringR) / (d0 - ringR))) * (held ? 0.5 : 1),
          metrics: { ring_px: ringR, start_distance_px: Math.round(d0), distance_px: round1(d), drags: st.drags, released: !held },
        };
      },
      solution() {
        // Split the way into drags that fit inside the view, each centred on the ring.
        const p = pinOnScreen();
        const need = { x: centre.x - p.x, y: centre.y - p.y };
        const n = Math.max(1, Math.ceil(Math.max(Math.abs(need.x) / (panel.w - 120), Math.abs(need.y) / (panel.h - 120))));
        const drags = [];
        let done = { x: 0, y: 0 };
        for (let i = 1; i <= n; i++) {
          const upTo = { x: Math.round((need.x * i) / n), y: Math.round((need.y * i) / n) };
          const v = { x: upTo.x - done.x, y: upTo.y - done.y };
          done = upTo;
          const from = { x: Math.round(centre.x - v.x / 2), y: Math.round(centre.y - v.y / 2) };
          drags.push({ type: 'drag', path: [[from.x, from.y], [from.x + v.x, from.y + v.y]] });
        }
        return drags;
      },
    };
  },
};
