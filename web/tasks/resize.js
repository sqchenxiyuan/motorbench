// resize: drag the corner handles of a box until it matches a dashed outline.
import { C, rect } from '../lib/ui.js';
import { clamp, round1 } from '../lib/geom.js';

const MIN = 40; // a box cannot be made smaller than this
// Corner k -> which side it sits on: [x side, y side], 0 = left/top, 1 = right/bottom.
const CORNERS = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

export const resize = {
  id: 'resize',
  title: 'Resize a box',
  category: 'drag',
  summary: 'Drag corner handles until a box matches a dashed outline: one corner -> smaller handle and tolerance -> two corners (10 / 5 / 3 px).',
  create({ rng, level, area, W, H }) {
    const tol = [10, 5, 3][level - 1];
    const hs = [18, 13, 9][level - 1]; // handle size
    const tw = rng.int(260, 460);
    const th = rng.int(180, 340);
    const tx = rng.int(area.x + 180, area.x + area.w - 180 - tw);
    const ty = rng.int(area.y + 150, area.y + area.h - 150 - th);
    const target = { x0: tx, y0: ty, x1: tx + tw, y1: ty + th };

    // Start from the target with one corner (two opposite corners at level 3) moved away.
    const box = { ...target };
    const first = rng.int(0, 3);
    const moved = level === 3 ? [first, (first + 2) % 4] : [first];
    const shift = () => rng.pick([-1, 1]) * (level === 3 ? rng.int(40, 70) : rng.int(50, 140));
    for (const k of moved) {
      box[CORNERS[k][0] ? 'x1' : 'x0'] += shift();
      box[CORNERS[k][1] ? 'y1' : 'y0'] += shift();
    }

    const corner = (k) => ({ x: CORNERS[k][0] ? box.x1 : box.x0, y: CORNERS[k][1] ? box.y1 : box.y0 });
    // How far each edge is outside the tolerance, summed. Zero means the box matches.
    const excess = (b) => ['x0', 'y0', 'x1', 'y1'].reduce((sum, e) => sum + Math.max(0, Math.abs(b[e] - target[e]) - tol), 0);
    const maxError = () => Math.max(...['x0', 'y0', 'x1', 'y1'].map((e) => Math.abs(box[e] - target[e])));
    const excess0 = excess(box);
    const st = { grab: null, drags: 0 };

    return {
      instruction: 'Resize the blue box by dragging its corner handles until it matches the dashed outline, then release.',
      onEvent(ev) {
        if (ev.type === 'down' && ev.button === 0) {
          for (let k = 0; k < 4; k++) {
            const c = corner(k);
            if (Math.abs(ev.x - c.x) <= hs / 2 + 1 && Math.abs(ev.y - c.y) <= hs / 2 + 1) st.grab = { k, dx: ev.x - c.x, dy: ev.y - c.y };
          }
        } else if (ev.type === 'move' && st.grab) {
          const [sx, sy] = CORNERS[st.grab.k];
          const x = clamp(ev.x - st.grab.dx, 4, W - 4);
          const y = clamp(ev.y - st.grab.dy, 60, H - 4);
          if (sx) box.x1 = Math.max(x, box.x0 + MIN);
          else box.x0 = Math.min(x, box.x1 - MIN);
          if (sy) box.y1 = Math.max(y, box.y0 + MIN);
          else box.y0 = Math.min(y, box.y1 - MIN);
        } else if (ev.type === 'up' && ev.button === 0 && st.grab) {
          st.grab = null;
          st.drags++;
        }
      },
      draw(g) {
        const ok = !st.grab && excess(box) === 0;
        rect(g, { x: target.x0, y: target.y0, w: tw, h: th }, { fill: '#fff', color: C.muted, width: 2, dash: [8, 6] });
        const color = ok ? C.green : C.blue;
        rect(g, { x: box.x0, y: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0 }, { fill: ok ? 'rgba(22,163,74,0.14)' : 'rgba(37,99,235,0.12)', color, width: 2 });
        for (let k = 0; k < 4; k++) {
          const c = corner(k);
          rect(g, { x: c.x - hs / 2, y: c.y - hs / 2, w: hs, h: hs }, { fill: '#fff', color, width: 2 });
        }
      },
      status() {
        const held = !!st.grab;
        const left = excess(box);
        return {
          done: !held && left === 0,
          success: !held && left === 0,
          // Share of the initial mismatch that has been removed; still holding a handle earns half.
          score: Math.max(0, 1 - left / excess0) * (held ? 0.5 : 1),
          metrics: { tolerance_px: tol, handle_px: hs, corners_to_move: moved.length, max_edge_error_px: round1(maxError()), drags: st.drags, released: !held },
        };
      },
      solution: () =>
        moved
          .filter((k) => corner(k).x !== (CORNERS[k][0] ? target.x1 : target.x0) || corner(k).y !== (CORNERS[k][1] ? target.y1 : target.y0))
          .map((k) => ({ type: 'drag', path: [[corner(k).x, corner(k).y], [CORNERS[k][0] ? target.x1 : target.x0, CORNERS[k][1] ? target.y1 : target.y0]] })),
    };
  },
};
