// reorder: drag the cards of a list into ascending order.
import { C, rect, text, MONO } from '../lib/ui.js';
import { clamp } from '../lib/geom.js';

const inversions = (a) => {
  let n = 0;
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) if (a[i] > a[j]) n++;
  return n;
};

export const reorder = {
  id: 'reorder',
  title: 'Reorder a list',
  category: 'drag',
  summary: 'Drag cards into ascending order: 3 cards with one out of place -> 5 shuffled -> 7 shuffled, smaller cards.',
  create({ rng, level, area }) {
    const n = [3, 5, 7][level - 1];
    const cardH = [56, 48, 38][level - 1];
    const gap = [12, 10, 8][level - 1];
    const cardW = 320;
    const slot = cardH + gap;
    const x0 = Math.round(area.x + (area.w - cardW) / 2 + rng.range(-240, 240));
    const y0 = Math.round(area.y + (area.h - n * slot + gap) / 2);

    const values = rng.shuffle(Array.from({ length: 90 }, (_, i) => i + 10)).slice(0, n);
    const sorted = values.slice().sort((a, b) => a - b);
    let order;
    if (level === 1) {
      // One card taken out and put back somewhere else.
      const from = rng.int(0, n - 1);
      let to;
      do to = rng.int(0, n - 1);
      while (to === from);
      order = sorted.slice();
      order.splice(to, 0, ...order.splice(from, 1));
    } else {
      do order = rng.shuffle(sorted);
      while (inversions(order) < (level === 2 ? 3 : 7));
    }
    const inv0 = inversions(order);
    const st = { order, grab: null, moves: 0 };
    const dropIndex = (y) => clamp(Math.round((y - y0) / slot), 0, n - 1);

    const card = (g, x, y, v, lifted) => {
      if (lifted) {
        g.save();
        g.shadowColor = 'rgba(0,0,0,0.25)';
        g.shadowBlur = 14;
        g.shadowOffsetY = 4;
      }
      rect(g, { x, y, w: cardW, h: cardH }, { fill: '#fff', color: lifted ? C.blue : C.line, width: 2, radius: 8 });
      if (lifted) g.restore();
      for (let i = -1; i <= 1; i++) rect(g, { x: x + 16, y: y + cardH / 2 - 1 + i * 6, w: 16, h: 2 }, { fill: C.gray });
      text(g, String(v), x + cardW / 2, y + cardH / 2 + 1, { size: Math.round(cardH * 0.5), align: 'center', baseline: 'middle', weight: 700, font: MONO });
    };

    return {
      instruction: 'Drag the cards into ascending order, with the smallest number at the top.',
      onEvent(ev) {
        if (ev.type === 'down' && ev.button === 0) {
          const i = Math.floor((ev.y - y0) / slot);
          if (ev.x >= x0 && ev.x <= x0 + cardW && i >= 0 && i < n && ev.y - y0 - i * slot <= cardH) {
            st.grab = { value: st.order[i], dx: ev.x - x0, dy: ev.y - (y0 + i * slot), x: x0, y: y0 + i * slot };
          }
        } else if (ev.type === 'move' && st.grab) {
          st.grab.x = ev.x - st.grab.dx;
          st.grab.y = ev.y - st.grab.dy;
        } else if (ev.type === 'up' && ev.button === 0 && st.grab) {
          const rest = st.order.filter((v) => v !== st.grab.value);
          rest.splice(dropIndex(st.grab.y), 0, st.grab.value);
          st.order = rest;
          st.grab = null;
          st.moves++;
        }
      },
      draw(g) {
        const sortedNow = !st.grab && inversions(st.order) === 0;
        if (!st.grab) {
          st.order.forEach((v, i) => card(g, x0, y0 + i * slot, v, false));
          if (sortedNow) rect(g, { x: x0 - 8, y: y0 - 8, w: cardW + 16, h: n * slot - gap + 16 }, { color: C.green, width: 3, radius: 12 });
          return;
        }
        // The other cards make room where the dragged card would land.
        const at = dropIndex(st.grab.y);
        st.order.filter((v) => v !== st.grab.value).forEach((v, i) => card(g, x0, y0 + (i < at ? i : i + 1) * slot, v, false));
        rect(g, { x: x0, y: y0 + at * slot, w: cardW, h: cardH }, { color: C.blue, width: 2, dash: [6, 5], radius: 8 });
        card(g, st.grab.x, st.grab.y, st.grab.value, true);
      },
      status() {
        const inv = inversions(st.order);
        return {
          done: !st.grab && inv === 0,
          success: !st.grab && inv === 0,
          // Share of the initially out-of-order pairs that are now in order.
          score: Math.max(0, 1 - inv / inv0),
          metrics: { cards: n, order: st.order.slice(), out_of_order_pairs: inv, initially: inv0, moves: st.moves },
        };
      },
      solution() {
        // Selection sort: put the right card into each position from the top down.
        const cur = st.order.slice();
        const x = Math.round(x0 + cardW / 2);
        const yOf = (i) => Math.round(y0 + i * slot + cardH / 2);
        const drags = [];
        for (let i = 0; i < n; i++) {
          if (cur[i] === sorted[i]) continue;
          const j = cur.indexOf(sorted[i]);
          drags.push({ type: 'drag', path: [[x, yOf(j)], [x, yOf(i)]] });
          cur.splice(i, 0, ...cur.splice(j, 1));
        }
        return drags;
      },
    };
  },
};
