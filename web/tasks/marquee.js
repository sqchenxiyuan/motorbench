// marquee: drag a selection rectangle around all blue dots and no red dots.
import { C, circle, rect } from '../lib/ui.js';
import { distRect, inRect, round3 } from '../lib/geom.js';

const DOT = 7;

export const marquee = {
  id: 'marquee',
  title: 'Marquee selection',
  category: 'drag',
  summary: 'Drag a selection box around all blue dots and no red ones; the gap to the nearest red dot shrinks (50 / 22 / 9 px).',
  create({ rng, level, area }) {
    const nBlue = [4, 7, 10][level - 1];
    const nRed = [4, 9, 14][level - 1];
    const gap = [50, 22, 9][level - 1];
    const pad = gap + 60;
    const bw = Math.round(rng.range(170, 420));
    const bh = Math.round(rng.range(120, 300));
    // Bounding box of the blue dots.
    const box = {
      x: Math.round(rng.range(area.x + pad, area.x + area.w - pad - bw)),
      y: Math.round(rng.range(area.y + pad, area.y + area.h - pad - bh)),
      w: bw,
      h: bh,
    };
    const dots = [];
    const free = (p) => dots.every((d) => Math.hypot(d.x - p.x, d.y - p.y) >= 2 * DOT + 4);
    const add = (blue, gen) => {
      for (let k = 0; k < 3000; k++) {
        const p = gen();
        p.x = Math.round(p.x);
        p.y = Math.round(p.y);
        if (free(p)) return dots.push({ ...p, blue });
      }
      throw new Error('could not place dots');
    };
    // Four dots pin the bounding box to exactly `box`, the rest fall inside.
    add(true, () => ({ x: box.x, y: rng.range(box.y, box.y + bh) }));
    add(true, () => ({ x: box.x + bw, y: rng.range(box.y, box.y + bh) }));
    add(true, () => ({ x: rng.range(box.x, box.x + bw), y: box.y }));
    add(true, () => ({ x: rng.range(box.x, box.x + bw), y: box.y + bh }));
    for (let i = 4; i < nBlue; i++) add(true, () => ({ x: rng.range(box.x, box.x + bw), y: rng.range(box.y, box.y + bh) }));
    // Red dots: at least `gap` away from the box; about half of them hug it closely.
    for (let i = 0; i < nRed; i++) {
      const near = i % 2 === 0;
      add(false, () => {
        for (;;) {
          const p = near
            ? { x: rng.range(box.x - gap - 28, box.x + bw + gap + 28), y: rng.range(box.y - gap - 28, box.y + bh + gap + 28) }
            : { x: rng.range(area.x + DOT, area.x + area.w - DOT), y: rng.range(area.y + DOT, area.y + area.h - DOT) };
          const d = distRect({ x: Math.round(p.x), y: Math.round(p.y) }, box);
          if (d >= gap && (!near || d <= gap + 28)) return p;
        }
      });
    }

    const st = { from: null, band: null, sel: null, drags: 0 };
    const norm = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
    const tally = (r) => {
      let tp = 0;
      let fp = 0;
      if (r) for (const d of dots) if (inRect(d, r)) d.blue ? tp++ : fp++;
      return { tp, fp, fn: nBlue - tp, jaccard: tp / (nBlue + fp) };
    };

    return {
      instruction: 'Drag a selection rectangle that contains all of the blue dots and none of the red dots. A dot is selected when its center is inside the rectangle.',
      onEvent(ev) {
        if (ev.type === 'down' && ev.button === 0) {
          st.from = { x: ev.x, y: ev.y };
          st.band = null;
          st.sel = null;
        } else if (ev.type === 'move' && st.from) st.band = norm(st.from, ev);
        else if (ev.type === 'up' && ev.button === 0 && st.from) {
          const r = norm(st.from, ev);
          st.from = null;
          st.band = null;
          st.sel = r.w >= 3 && r.h >= 3 ? r : null; // a plain click just clears the selection
          if (st.sel) st.drags++;
        }
      },
      draw(g) {
        const r = st.band || st.sel;
        const good = st.sel && tally(st.sel).jaccard === 1;
        if (r) rect(g, r, { fill: good ? 'rgba(22,163,74,0.12)' : 'rgba(37,99,235,0.10)', color: good ? C.green : C.blue, width: 1.5, dash: st.band ? [5, 4] : null });
        for (const d of dots) {
          circle(g, d.x, d.y, DOT, d.blue ? C.blue : C.red);
          if (r && inRect(d, r)) circle(g, d.x, d.y, DOT + 4, null, C.ink, 2);
        }
      },
      status() {
        const t = tally(st.sel);
        return {
          done: t.jaccard === 1,
          success: t.jaccard === 1,
          score: t.jaccard,
          metrics: { gap_px: gap, blue_selected: t.tp, blue_total: nBlue, red_selected: t.fp, jaccard: round3(t.jaccard), drags: st.drags },
        };
      },
      solution: () => {
        const m = gap / 2;
        return [{ type: 'drag', path: [[Math.round(box.x - m), Math.round(box.y - m)], [Math.round(box.x + bw + m), Math.round(box.y + bh + m)]] }];
      },
    };
  },
};
