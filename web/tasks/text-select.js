// text-select: select an exact run of text by dragging across it.
import { C, rect, text, MONO } from '../lib/ui.js';
import { clamp, round3 } from '../lib/geom.js';

const WORDS = [
  'anchor', 'basket', 'candle', 'desert', 'engine', 'feather', 'garden', 'hammer', 'island', 'jungle', 'kitten', 'ladder',
  'marble', 'needle', 'orange', 'pepper', 'quartz', 'ribbon', 'saddle', 'timber', 'umbrella', 'velvet', 'walnut', 'yellow',
  'zipper', 'bridge', 'copper', 'dragon', 'forest', 'glacier', 'harbor', 'lantern', 'meadow', 'pocket', 'rocket', 'silver',
  'thunder', 'violin', 'window', 'planet', 'coffee', 'pencil', 'market', 'summer',
];

export const textSelect = {
  id: 'text-select',
  title: 'Select text',
  category: 'drag',
  summary: 'Drag across text to select exactly the given words: one word in large type -> a phrase -> a phrase that runs over a line break in small type.',
  create({ rng, level, area }) {
    const size = [30, 22, 16][level - 1];
    // Every character sits in a cell of fixed width, so the layout does not depend on the font.
    const cw = [18, 13, 10][level - 1];
    const lh = Math.round(size * 1.8);
    const perLine = [60, 34, 58][level - 1];
    const words = rng.shuffle(WORDS).slice(0, [6, 16, 34][level - 1]);

    // Wrap at word boundaries. A line break stands for the space between two words.
    const lines = [];
    let pos = 0;
    let cur = '';
    for (const w of words) {
      if (cur && cur.length + 1 + w.length > perLine) {
        lines.push({ start: pos, text: cur });
        pos += cur.length + 1;
        cur = w;
      } else cur = cur ? `${cur} ${w}` : w;
    }
    lines.push({ start: pos, text: cur });
    const full = words.join(' ');

    // Which words to select.
    const lineWords = lines.map((l) => l.text.split(' ').length);
    const firstWordOfLine = lines.map((_, i) => lineWords.slice(0, i).reduce((a, b) => a + b, 0));
    let w0;
    let w1; // inclusive word indices
    if (level === 1) w0 = w1 = rng.int(0, words.length - 1);
    else if (level === 2) {
      const li = rng.int(0, lines.length - 1);
      const count = Math.min(lineWords[li], rng.int(2, 3));
      w0 = firstWordOfLine[li] + rng.int(0, lineWords[li] - count);
      w1 = w0 + count - 1;
    } else {
      const li = rng.int(0, lines.length - 2); // the phrase ends on the line after this one
      w0 = firstWordOfLine[li + 1] - rng.int(1, Math.min(2, lineWords[li]));
      w1 = firstWordOfLine[li + 1] + rng.int(1, Math.min(3, lineWords[li + 1])) - 1;
    }
    const wordStart = (i) => words.slice(0, i).reduce((a, w) => a + w.length + 1, 0);
    const want = [wordStart(w0), wordStart(w1) + words[w1].length];
    const phrase = full.slice(want[0], want[1]);

    const blockW = Math.max(...lines.map((l) => l.text.length)) * cw;
    const x0 = Math.round(area.x + (area.w - blockW) / 2 + rng.range(-60, 60));
    const y0 = Math.round(area.y + (area.h - lines.length * lh) / 2 + rng.range(-40, 40));
    const caretAt = (p) => {
      const line = lines[clamp(Math.floor((p.y - y0) / lh), 0, lines.length - 1)];
      return line.start + clamp(Math.round((p.x - x0) / cw), 0, line.text.length);
    };
    const pointOf = (index) => {
      const li = lines.findIndex((l) => index >= l.start && index <= l.start + l.text.length);
      return { x: x0 + (index - lines[li].start) * cw, y: y0 + li * lh + lh / 2 };
    };

    const st = { anchor: null, live: null, sel: null, drags: 0 };
    const jaccard = (sel) => {
      if (!sel) return 0;
      const inter = Math.max(0, Math.min(sel[1], want[1]) - Math.max(sel[0], want[0]));
      return inter / (sel[1] - sel[0] + want[1] - want[0] - inter);
    };

    return {
      instruction: `Select exactly this text by dragging across it (without the quotes): "${phrase}"`,
      onEvent(ev) {
        if (ev.type === 'down' && ev.button === 0) {
          st.anchor = caretAt(ev);
          st.live = null;
          st.sel = null;
        } else if (ev.type === 'move' && st.anchor != null) {
          const c = caretAt(ev);
          st.live = c === st.anchor ? null : [Math.min(st.anchor, c), Math.max(st.anchor, c)];
        } else if (ev.type === 'up' && ev.button === 0 && st.anchor != null) {
          const c = caretAt(ev);
          st.sel = c === st.anchor ? null : [Math.min(st.anchor, c), Math.max(st.anchor, c)]; // a plain click clears the selection
          st.anchor = null;
          st.live = null;
          if (st.sel) st.drags++;
        }
      },
      draw(g) {
        const pad = 26;
        rect(g, { x: x0 - pad, y: y0 - pad + 6, w: blockW + 2 * pad, h: lines.length * lh + 2 * pad - 12 }, { fill: '#fff', color: C.line, width: 2, radius: 8 });
        const sel = st.live || st.sel;
        const exact = !st.live && st.sel && st.sel[0] === want[0] && st.sel[1] === want[1];
        lines.forEach((line, li) => {
          const top = y0 + li * lh;
          if (sel) {
            const a = Math.max(sel[0], line.start);
            const b = Math.min(sel[1], line.start + line.text.length + 1); // +1: the break after the line
            if (b > a) {
              const extra = b > line.start + line.text.length ? 0.5 : 0; // show a selected line break as half a cell
              const cols = Math.min(b, line.start + line.text.length) - a;
              rect(g, { x: x0 + (a - line.start) * cw, y: top + lh * 0.14, w: (cols + extra) * cw, h: lh * 0.72 }, { fill: exact ? 'rgba(22,163,74,0.30)' : 'rgba(37,99,235,0.28)' });
            }
          }
          for (let i = 0; i < line.text.length; i++) {
            // Each character is fitted into its own cell, so wide letters cannot run into
            // their neighbours even where no monospace font is installed.
            if (line.text[i] !== ' ') text(g, line.text[i], x0 + i * cw + cw / 2, top + lh / 2 + 1, { size, align: 'center', baseline: 'middle', font: MONO, maxWidth: cw - 0.5 });
          }
        });
      },
      status() {
        const j = jaccard(st.sel);
        return {
          done: j === 1,
          success: j === 1,
          // Overlap between what is selected and what was asked for (characters in both / characters in either).
          score: j,
          metrics: { phrase, char_px: cw, lines: lines.length, selected: st.sel ? full.slice(st.sel[0], st.sel[1]) : '', overlap: round3(j), drags: st.drags },
        };
      },
      solution() {
        const a = pointOf(want[0]);
        const b = pointOf(want[1]);
        return [{ type: 'drag', path: [[a.x, a.y], [b.x, b.y]] }];
      },
    };
  },
};
