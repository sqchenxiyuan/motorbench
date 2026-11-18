// maze: steer the pointer from the start cell to the goal cell without crossing a wall.
//
// A "token" follows the pointer but cannot pass through walls. When the pointer
// crosses a wall the token stays behind (one wall hit is recorded) and only picks
// the pointer up again once it comes back to the token's cell. So cutting through
// walls never makes progress.
import { C, rect, text } from '../lib/ui.js';
import { walk } from '../lib/geom.js';
import { penalty } from './common.js';

function carve(rng, cols, rows) {
  // wallR[r][c]: wall between (r,c) and (r,c+1). wallD[r][c]: wall between (r,c) and (r+1,c).
  const wallR = Array.from({ length: rows }, () => Array(cols).fill(true));
  const wallD = Array.from({ length: rows }, () => Array(cols).fill(true));
  const seen = Array.from({ length: rows }, () => Array(cols).fill(false));
  const stack = [[0, 0]];
  seen[0][0] = true;
  while (stack.length) {
    const [r, c] = stack[stack.length - 1];
    const nbrs = [
      [r - 1, c],
      [r + 1, c],
      [r, c - 1],
      [r, c + 1],
    ].filter(([y, x]) => y >= 0 && y < rows && x >= 0 && x < cols && !seen[y][x]);
    if (!nbrs.length) {
      stack.pop();
      continue;
    }
    const [y, x] = rng.pick(nbrs);
    if (y === r) wallR[r][Math.min(c, x)] = false;
    else wallD[Math.min(r, y)][c] = false;
    seen[y][x] = true;
    stack.push([y, x]);
  }
  return { wallR, wallD };
}

export const maze = {
  id: 'maze',
  title: 'Steer through a maze',
  category: 'path',
  summary: 'Guide the pointer from start to goal without crossing walls (4x3 / 6x4 / 9x6 cells).',
  create({ rng, level, area }) {
    const [cols, rows] = [
      [4, 3],
      [6, 4],
      [9, 6],
    ][level - 1];
    const cs = Math.floor(Math.min(area.w / cols, area.h / rows, [150, 120, 84][level - 1]));
    const ox = Math.round(area.x + (area.w - cols * cs) / 2);
    const oy = Math.round(area.y + (area.h - rows * cs) / 2);
    const { wallR, wallD } = carve(rng, cols, rows);
    const start = [rng.int(0, rows - 1), 0];
    const goal = [rng.int(0, rows - 1), cols - 1];

    const open = (a, b) => {
      if (a[0] === b[0] && Math.abs(a[1] - b[1]) === 1) return !wallR[a[0]][Math.min(a[1], b[1])];
      if (a[1] === b[1] && Math.abs(a[0] - b[0]) === 1) return !wallD[Math.min(a[0], b[0])][a[1]];
      return false;
    };
    const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
    const key = (c) => c[0] * cols + c[1];

    // Unique route from start to goal (breadth-first search).
    const route = (() => {
      const from = new Map([[key(start), null]]);
      const queue = [start];
      while (queue.length) {
        const cur = queue.shift();
        if (same(cur, goal)) break;
        for (const nb of [
          [cur[0] - 1, cur[1]],
          [cur[0] + 1, cur[1]],
          [cur[0], cur[1] - 1],
          [cur[0], cur[1] + 1],
        ]) {
          if (nb[0] < 0 || nb[0] >= rows || nb[1] < 0 || nb[1] >= cols) continue;
          if (from.has(key(nb)) || !open(cur, nb)) continue;
          from.set(key(nb), cur);
          queue.push(nb);
        }
      }
      const out = [];
      for (let c = goal; c; c = from.get(key(c))) out.unshift(c);
      return out;
    })();
    const routeIndex = new Map(route.map((c, i) => [key(c), i]));

    const cellAt = (p) => {
      const c = Math.floor((p.x - ox) / cs);
      const r = Math.floor((p.y - oy) / cs);
      return r >= 0 && r < rows && c >= 0 && c < cols ? [r, c] : null;
    };
    const center = (c) => ({ x: ox + c[1] * cs + cs / 2, y: oy + c[0] * cs + cs / 2 });

    const st = { token: null, attached: false, hits: 0, reached: false, furthest: 0, visited: new Set() };
    const point = (q) => {
      if (st.reached) return;
      const c = cellAt(q);
      if (!st.token) {
        if (same(c, start)) {
          st.token = start;
          st.attached = true;
          st.visited.add(key(start));
        }
        return;
      }
      if (!st.attached) {
        if (same(c, st.token)) st.attached = true;
        return;
      }
      if (same(c, st.token)) return;
      if (c && open(st.token, c)) {
        st.token = c;
        st.visited.add(key(c));
        st.furthest = Math.max(st.furthest, routeIndex.get(key(c)) ?? 0);
        if (same(c, goal)) st.reached = true;
      } else {
        st.hits++;
        st.attached = false;
      }
    };

    return {
      instruction:
        'Guide the pointer through the maze from the green start cell to the red goal cell without crossing any wall. No mouse button is needed.',
      onEvent(ev) {
        if (ev.type !== 'move') return;
        if (!ev.prev) return point(ev);
        for (const q of walk(ev.prev, ev, 1)) point(q);
      },
      draw(g) {
        rect(g, { x: ox, y: oy, w: cols * cs, h: rows * cs }, { fill: C.panel });
        const cell = (c, fill) => rect(g, { x: ox + c[1] * cs, y: oy + c[0] * cs, w: cs, h: cs }, { fill });
        for (const k of st.visited) cell([Math.floor(k / cols), k % cols], C.blueFaint);
        cell(start, C.greenSoft);
        cell(goal, st.reached ? C.greenSoft : C.redSoft);
        if (st.token && !st.reached) cell(st.token, st.attached ? C.blueSoft : '#fde68a');
        const size = Math.round(cs * 0.3);
        const s = center(start);
        const e = center(goal);
        text(g, 'START', s.x, s.y, { size: Math.min(size, 15), color: '#166534', align: 'center', baseline: 'middle', weight: 700 });
        text(g, 'GOAL', e.x, e.y, { size: Math.min(size, 15), color: st.reached ? '#166534' : '#991b1b', align: 'center', baseline: 'middle', weight: 700 });

        g.beginPath();
        g.rect(ox, oy, cols * cs, rows * cs);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (c < cols - 1 && wallR[r][c]) {
              g.moveTo(ox + (c + 1) * cs, oy + r * cs);
              g.lineTo(ox + (c + 1) * cs, oy + (r + 1) * cs);
            }
            if (r < rows - 1 && wallD[r][c]) {
              g.moveTo(ox + c * cs, oy + (r + 1) * cs);
              g.lineTo(ox + (c + 1) * cs, oy + (r + 1) * cs);
            }
          }
        }
        g.strokeStyle = C.ink;
        g.lineWidth = 4;
        g.lineCap = 'round';
        g.stroke();
        if (st.hits) text(g, `wall hits: ${st.hits}`, ox, oy - 10, { size: 15, color: C.red, weight: 600 });
      },
      status: () => ({
        done: st.reached,
        success: st.reached && st.hits === 0,
        score: (st.reached ? 1 : (0.5 * st.furthest) / (route.length - 1)) * penalty(st.hits),
        metrics: { grid: `${cols}x${rows}`, route_cells: route.length, reached: st.reached, progress_cells: st.furthest, wall_hits: st.hits },
      }),
      solution: () => route.map((c) => ({ type: 'move', ...center(c) })).map((a) => ({ ...a, x: Math.round(a.x), y: Math.round(a.y) })),
    };
  },
};
