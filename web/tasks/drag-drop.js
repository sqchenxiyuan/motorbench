// drag-drop: drag a square into a dashed box and release it there.
import { C, check, rect } from '../lib/ui.js';
import { clamp, inRect, overlapArea, round3 } from '../lib/geom.js';

const B = 56; // block size

export const dragDrop = {
  id: 'drag-drop',
  title: 'Drag and drop',
  category: 'drag',
  summary: 'Drag a square into a dashed box; the box gets tighter (36 / 12 / 4 px of slack per side).',
  create({ rng, level, area, W, H }) {
    const slack = [36, 12, 4][level - 1];
    const Z = B + 2 * slack;
    let block;
    let zone;
    for (let k = 0; k < 1000; k++) {
      block = { x: rng.int(area.x, area.x + area.w - B), y: rng.int(area.y, area.y + area.h - B), w: B, h: B };
      zone = { x: rng.int(area.x, area.x + area.w - Z), y: rng.int(area.y, area.y + area.h - Z), w: Z, h: Z };
      if (Math.hypot(block.x + B / 2 - zone.x - Z / 2, block.y + B / 2 - zone.y - Z / 2) >= 280) break;
    }
    const st = { grab: null, drops: 0 };
    const overlap = () => overlapArea(block, zone) / (B * B);
    const inside = () => overlap() > 0.9999;

    return {
      instruction: 'Drag the blue square so that it lies completely inside the dashed box, then release it.',
      onEvent(ev) {
        if (ev.type === 'down' && ev.button === 0 && inRect(ev, block)) st.grab = { dx: ev.x - block.x, dy: ev.y - block.y };
        else if (ev.type === 'move' && st.grab) {
          block.x = clamp(ev.x - st.grab.dx, 0, W - B);
          block.y = clamp(ev.y - st.grab.dy, 0, H - B);
        } else if (ev.type === 'up' && ev.button === 0 && st.grab) {
          st.grab = null;
          st.drops++;
        }
      },
      draw(g) {
        rect(g, zone, { fill: '#fff', color: C.muted, width: 2, dash: [8, 6], radius: 4 });
        const done = !st.grab && inside();
        rect(g, block, { fill: done ? C.green : C.blue, radius: 6 });
        if (done) check(g, block.x + B / 2, block.y + B / 2, B * 0.5);
      },
      status() {
        const held = !!st.grab;
        return {
          done: !held && inside(),
          success: !held && inside(),
          // Still holding the square at the end only earns half credit: it was never dropped.
          score: overlap() * (held ? 0.5 : 1),
          metrics: { slack_px: slack, overlap: round3(overlap()), drops: st.drops, released: !held },
        };
      },
      solution: () => [
        {
          type: 'drag',
          path: [
            [Math.round(block.x + B / 2), Math.round(block.y + B / 2)],
            [Math.round(zone.x + Z / 2), Math.round(zone.y + Z / 2)],
          ],
        },
      ],
    };
  },
};
