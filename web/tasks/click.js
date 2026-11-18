// click / double-click / right-click: hit one target with the right kind of click.
import { C, circle, check } from '../lib/ui.js';
import { round1 } from '../lib/geom.js';
import { inCircle, penalty, placeCircles } from './common.js';

function make(id, kind, title, verb) {
  return {
    id,
    title,
    category: 'pointing',
    summary: `${verb} a target; smaller target and more distractors at higher levels.`,
    create({ rng, level, area }) {
      const r = [36, 18, 8][level - 1];
      const nDistractors = [0, 4, 10][level - 1];
      const radii = [r];
      for (let i = 0; i < nDistractors; i++) radii.push(Math.round(rng.range(r * 0.9, r * 1.8)));
      const [target, ...others] = placeCircles(rng, area, radii, 16);
      const st = { hit: false, misses: 0, offset: null };

      const onEvent = (ev) => {
        if (st.hit) return;
        const inside = inCircle(ev, target);
        const hit = () => {
          st.hit = true;
          st.offset = Math.hypot(ev.x - target.x, ev.y - target.y);
        };
        if (kind === 'left') {
          if (ev.type === 'click') inside ? hit() : st.misses++;
          else if (ev.type === 'context') st.misses++;
        } else if (kind === 'double') {
          // Single clicks on the target are not mistakes (a double-click starts with one),
          // but they do not complete the task either.
          if (ev.type === 'dblclick' && inside) hit();
          else if (ev.type === 'click' && !inside && ev.detail <= 1) st.misses++;
          else if (ev.type === 'context') st.misses++;
        } else {
          if (ev.type === 'context') inside ? hit() : st.misses++;
          else if (ev.type === 'click') st.misses++;
        }
      };

      return {
        instruction: `${verb} the blue circle.`,
        onEvent,
        draw(g) {
          for (const o of others) circle(g, o.x, o.y, o.r, C.gray);
          circle(g, target.x, target.y, target.r, st.hit ? C.green : C.blue);
          if (st.hit) check(g, target.x, target.y, target.r * 1.1);
        },
        status: () => ({
          done: st.hit,
          success: st.hit && st.misses === 0,
          score: st.hit ? penalty(st.misses) : 0,
          metrics: { hit: st.hit, misses: st.misses, offset_px: st.offset == null ? null : round1(st.offset), radius: r },
        }),
        solution: () => [
          { type: 'click', x: target.x, y: target.y, button: kind === 'right' ? 'right' : 'left', count: kind === 'double' ? 2 : 1 },
        ],
      };
    },
  };
}

export const click = make('click', 'left', 'Click a target', 'Click');
export const doubleClick = make('double-click', 'double', 'Double-click a target', 'Double-click');
export const rightClick = make('right-click', 'right', 'Right-click a target', 'Right-click');
