// scroll-click: scroll a long list until a given row is visible, then click it.
import { C, rect, text } from '../lib/ui.js';
import { clamp, inRect } from '../lib/geom.js';
import { penalty } from './common.js';

const ROW = 44;
const BAR_W = 14;

export const scrollClick = {
  id: 'scroll-click',
  title: 'Scroll and click',
  category: 'scroll',
  summary: 'Scroll a list (40 / 160 / 500 rows) to a named row and click it. Wheel or scrollbar drag both work.',
  create({ rng, level, area }) {
    const n = [40, 160, 500][level - 1];
    const lo = [18, 40, 120][level - 1];
    const targetIdx = rng.int(lo, n - 1);
    const panel = { x: Math.round(area.x + rng.range(40, area.w - 500)), y: area.y + 8, w: 460, h: area.h - 16 };
    const contentH = n * ROW;
    const maxTop = contentH - panel.h;
    const thumbH = Math.max(36, Math.round((panel.h * panel.h) / contentH));
    const track = { x: panel.x + panel.w - BAR_W, y: panel.y, w: BAR_W, h: panel.h };
    const st = { top: 0, hit: false, wrong: 0, grab: null, hover: null };
    const thumbY = () => track.y + (st.top / maxTop) * (track.h - thumbH);
    const visible = () => targetIdx * ROW >= st.top && (targetIdx + 1) * ROW <= st.top + panel.h;

    return {
      instruction: `Scroll the list until you find "Item ${targetIdx + 1}", then click that row.`,
      onEvent(ev) {
        if (st.hit) return;
        if (ev.type === 'wheel' && inRect(ev, panel)) st.top = clamp(st.top + ev.dy, 0, maxTop);
        else if (ev.type === 'down' && ev.button === 0 && inRect(ev, track)) {
          const ty = thumbY();
          // Grab the thumb; pressing elsewhere on the track jumps the thumb there first.
          if (ev.y < ty || ev.y > ty + thumbH) st.top = clamp(((ev.y - thumbH / 2 - track.y) / (track.h - thumbH)) * maxTop, 0, maxTop);
          st.grab = { dy: ev.y - thumbY() };
        } else if (ev.type === 'move') {
          if (st.grab) st.top = clamp(((ev.y - st.grab.dy - track.y) / (track.h - thumbH)) * maxTop, 0, maxTop);
          st.hover = inRect(ev, panel) && !inRect(ev, track) ? Math.floor((ev.y - panel.y + st.top) / ROW) : null;
        } else if (ev.type === 'up' && ev.button === 0) st.grab = null;
        else if (ev.type === 'click' && inRect(ev, panel) && !inRect(ev, track)) {
          const idx = Math.floor((ev.y - panel.y + st.top) / ROW);
          if (idx === targetIdx) st.hit = true;
          else st.wrong++;
        }
      },
      draw(g) {
        rect(g, panel, { fill: C.panel });
        g.save();
        g.beginPath();
        g.rect(panel.x, panel.y, panel.w, panel.h);
        g.clip();
        const first = Math.floor(st.top / ROW);
        for (let i = first; i < n && i * ROW < st.top + panel.h; i++) {
          const y = panel.y + i * ROW - st.top;
          const picked = st.hit && i === targetIdx;
          const fill = picked ? C.greenSoft : i === st.hover ? C.blueFaint : i % 2 ? '#f9fafb' : C.panel;
          rect(g, { x: panel.x, y, w: panel.w - BAR_W, h: ROW }, { fill });
          text(g, `Item ${i + 1}`, panel.x + 18, y + ROW / 2 + 1, { size: 17, baseline: 'middle', weight: picked ? 700 : 400 });
        }
        g.restore();
        rect(g, track, { fill: '#e5e7eb' });
        rect(g, { x: track.x + 3, y: thumbY() + 2, w: BAR_W - 6, h: thumbH - 4 }, { fill: st.grab ? C.muted : '#9ca3af', radius: 4 });
        rect(g, panel, { color: C.line, width: 2 });
      },
      status: () => ({
        done: st.hit,
        success: st.hit && st.wrong === 0,
        // Bringing the row into view without clicking it earns partial credit.
        score: st.hit ? penalty(st.wrong) : visible() ? 0.3 : 0,
        metrics: { rows: n, target_row: targetIdx + 1, clicked: st.hit, wrong_clicks: st.wrong, target_visible: visible(), scroll_top: Math.round(st.top) },
      }),
      solution() {
        const want = clamp(Math.round(targetIdx * ROW - panel.h / 2 + ROW / 2), 0, maxTop);
        const x = Math.round(panel.x + panel.w / 2);
        return [
          { type: 'scroll', x, y: Math.round(panel.y + panel.h / 2), dx: 0, dy: want - st.top },
          { type: 'click', x, y: Math.round(panel.y + targetIdx * ROW - want + ROW / 2) },
        ];
      },
    };
  },
};
