// drag-bins: drag each token into the box with the same letter and colour.
import { C, check, circle, rect, text } from '../lib/ui.js';
import { clamp, inRect, round3 } from '../lib/geom.js';
import { placeCircles } from './common.js';

const KINDS = [
  { letter: 'A', color: '#2563eb', tint: 'rgba(37,99,235,0.10)' },
  { letter: 'B', color: '#ea580c', tint: 'rgba(234,88,12,0.10)' },
  { letter: 'C', color: '#16a34a', tint: 'rgba(22,163,74,0.10)' },
  { letter: 'D', color: '#9333ea', tint: 'rgba(147,51,234,0.10)' },
];
const R = 17; // token radius

export const dragBins = {
  id: 'drag-bins',
  title: 'Sort tokens into boxes',
  category: 'drag',
  summary: 'Drag every token into its matching box: 3 tokens / 2 boxes -> 5 / 3 -> 7 / 4, with smaller boxes.',
  create({ rng, level, area, W, H }) {
    const nKinds = [2, 3, 4][level - 1];
    const nTokens = [3, 5, 7][level - 1];
    const bw = [170, 120, 80][level - 1];
    const bh = [120, 96, 68][level - 1];

    // Boxes in a row along the bottom, in random order.
    const cell = area.w / nKinds;
    const bins = rng.shuffle(KINDS.slice(0, nKinds)).map((kind, i) => ({
      kind,
      x: Math.round(area.x + cell * i + (cell - bw) / 2 + rng.range(-cell * 0.2, cell * 0.2)),
      y: area.y + area.h - bh - 6,
      w: bw,
      h: bh,
    }));
    // Tokens scattered above them; every kind appears at least once.
    const kinds = rng.shuffle([...KINDS.slice(0, nKinds), ...Array.from({ length: nTokens - nKinds }, () => rng.pick(KINDS.slice(0, nKinds)))]);
    const field = { x: area.x + 20, y: area.y + 10, w: area.w - 40, h: area.h - bh - 110 };
    const tokens = placeCircles(rng, field, Array(nTokens).fill(R), 26).map((p, i) => ({ x: p.x, y: p.y, kind: kinds[i] }));
    const st = { grab: null, drops: 0 };

    const tally = () => {
      let correct = 0;
      let wrong = 0;
      for (const t of tokens) {
        if (st.grab && st.grab.token === t) continue; // a token still in the hand is nowhere
        const bin = bins.find((b) => inRect(t, b));
        if (bin) bin.kind === t.kind ? correct++ : wrong++;
      }
      return { correct, wrong };
    };

    return {
      instruction: 'Drag each token into the box with the same letter and colour.',
      onEvent(ev) {
        if (ev.type === 'down' && ev.button === 0) {
          // Topmost token under the pointer (later tokens are drawn on top).
          for (let i = tokens.length - 1; i >= 0; i--) {
            const t = tokens[i];
            if (Math.hypot(ev.x - t.x, ev.y - t.y) <= R) {
              tokens.push(...tokens.splice(i, 1));
              st.grab = { token: t, dx: ev.x - t.x, dy: ev.y - t.y };
              break;
            }
          }
        } else if (ev.type === 'move' && st.grab) {
          st.grab.token.x = clamp(ev.x - st.grab.dx, R, W - R);
          st.grab.token.y = clamp(ev.y - st.grab.dy, 56 + R, H - R);
        } else if (ev.type === 'up' && ev.button === 0 && st.grab) {
          st.grab = null;
          st.drops++;
        }
      },
      draw(g) {
        const { correct, wrong } = tally();
        const allDone = !st.grab && correct === nTokens;
        for (const b of bins) {
          rect(g, b, { fill: b.kind.tint, color: b.kind.color, width: 2.5, dash: [8, 6], radius: 8 });
          text(g, b.kind.letter, b.x + 10, b.y + 22, { size: 18, color: b.kind.color, weight: 700 });
        }
        for (const t of tokens) {
          circle(g, t.x, t.y, R, t.kind.color, '#fff', 2);
          text(g, t.kind.letter, t.x, t.y + 1, { size: 16, color: '#fff', align: 'center', baseline: 'middle', weight: 700 });
        }
        if (allDone) check(g, area.x + area.w / 2, area.y + 40, 44, C.green);
        else if (wrong) text(g, `${wrong} in the wrong box`, area.x + area.w / 2, area.y + 30, { size: 15, color: C.red, align: 'center', weight: 600 });
      },
      status() {
        const { correct, wrong } = tally();
        const all = !st.grab && correct === nTokens;
        return {
          done: all,
          success: all,
          // A token in the wrong box cancels half of a correctly placed one.
          score: Math.max(0, (correct - 0.5 * wrong) / nTokens),
          metrics: { tokens: nTokens, boxes: nKinds, box_px: `${bw}x${bh}`, correct, wrong, drops: st.drops, share_correct: round3(correct / nTokens) },
        };
      },
      solution() {
        // Spread the drop points inside each box so the tokens do not pile up.
        const seen = new Map();
        const drags = [];
        for (const t of tokens) {
          const bin = bins.find((b) => b.kind === t.kind);
          if (inRect(t, bin)) continue;
          const i = seen.get(bin) ?? 0;
          seen.set(bin, i + 1);
          const count = tokens.filter((o) => o.kind === t.kind).length;
          const dx = (i - (count - 1) / 2) * Math.min(24, (bw - 2 * R - 8) / Math.max(1, count - 1));
          drags.push({ type: 'drag', path: [[t.x, t.y], [Math.round(bin.x + bw / 2 + dx), Math.round(bin.y + bh / 2 + 8)]] });
        }
        return drags;
      },
    };
  },
};
