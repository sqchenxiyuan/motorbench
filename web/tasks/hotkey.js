// hotkey: press a key, a keyboard shortcut, or a sequence of shortcuts.
import { C, rect, text } from '../lib/ui.js';
import { penalty } from './common.js';

// Keys and combinations the page can intercept in every browser (no Ctrl+W / Ctrl+T etc).
const NAMED = {
  Enter: 'Enter', Escape: 'Escape', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Space: 'Space',
  ArrowUp: 'Up Arrow', ArrowDown: 'Down Arrow', ArrowLeft: 'Left Arrow', ArrowRight: 'Right Arrow',
  Home: 'Home', End: 'End', PageUp: 'Page Up', PageDown: 'Page Down', F2: 'F2', F7: 'F7', F8: 'F8', F9: 'F9',
};
const LETTERS = ['B', 'E', 'G', 'K', 'M', 'U', 'Y'];
const WITH_SHIFT = ['Tab', 'F7', 'F8', 'F9', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
const WITH_CTRL = [...LETTERS, 'F2', 'F8', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'];

const label = (k) => NAMED[k] ?? k;
const parts = (c) => [...(c.ctrl ? ['Ctrl'] : []), ...(c.alt ? ['Alt'] : []), ...(c.shift ? ['Shift'] : []), label(c.key)];
const fmt = (c) => parts(c).join('+');
/** Key name in the harness's (Playwright-style) syntax. */
const harnessKey = (c) =>
  [...(c.ctrl ? ['Control'] : []), ...(c.alt ? ['Alt'] : []), ...(c.shift ? ['Shift'] : []), c.key.length === 1 ? `Key${c.key}` : c.key].join('+');

function single(rng) {
  return { ctrl: false, alt: false, shift: false, key: rng.pick(Object.keys(NAMED)) };
}
function combo(rng) {
  const kind = rng.pick(['ctrl', 'ctrl', 'shift', 'ctrl+shift', 'alt+shift']);
  if (kind === 'ctrl') return { ctrl: true, alt: false, shift: false, key: rng.pick(WITH_CTRL) };
  if (kind === 'shift') return { ctrl: false, alt: false, shift: true, key: rng.pick(WITH_SHIFT) };
  if (kind === 'ctrl+shift') return { ctrl: true, alt: false, shift: true, key: rng.pick(LETTERS) };
  return { ctrl: false, alt: true, shift: true, key: rng.pick(LETTERS) };
}

export const hotkey = {
  id: 'hotkey',
  title: 'Press keys and shortcuts',
  category: 'keyboard',
  summary: 'Press a single key -> a modifier shortcut -> three shortcuts in order.',
  create({ rng, level, area }) {
    let seq;
    if (level === 1) seq = [single(rng)];
    else if (level === 2) seq = [combo(rng)];
    else {
      seq = [];
      for (const make of rng.shuffle([single, combo, combo])) {
        let c;
        do c = make(rng);
        while (seq.some((o) => fmt(o) === fmt(c)));
        seq.push(c);
      }
    }
    const st = { next: 0, wrong: 0, last: null };

    const instruction =
      level === 1
        ? `Press the ${fmt(seq[0])} key.`
        : level === 2
          ? `Press the keyboard shortcut ${fmt(seq[0])}.`
          : `Press these three keyboard shortcuts in order: ${fmt(seq[0])}, then ${fmt(seq[1])}, then ${fmt(seq[2])}.`;

    return {
      instruction,
      onEvent(ev) {
        if (ev.type !== 'keydown' || ev.repeat || st.next >= seq.length) return;
        if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(ev.key)) return;
        // Letters are identified by physical key so that Shift / Alt do not change them.
        const key = /^Key[A-Z]$/.test(ev.code) ? ev.code.slice(3) : ev.key === ' ' ? 'Space' : ev.key;
        const want = seq[st.next];
        const ok = key === want.key && ev.ctrl === want.ctrl && ev.alt === want.alt && ev.shift === want.shift && !ev.meta;
        st.last = { text: fmt({ ctrl: ev.ctrl, alt: ev.alt, shift: ev.shift, key }), ok };
        if (ok) st.next++;
        else st.wrong++;
      },
      draw(g) {
        const cap = (x, y, str, state) => {
          g.font = `600 20px ${'system-ui, sans-serif'}`;
          const w = Math.max(54, g.measureText(str).width + 28);
          rect(g, { x, y, w, h: 50 }, { fill: state === 'done' ? C.greenSoft : '#fff', color: state === 'done' ? C.green : state === 'now' ? C.blue : C.line, width: state === 'now' ? 3 : 2, radius: 8 });
          text(g, str, x + w / 2, y + 26, { size: 20, align: 'center', baseline: 'middle', weight: 600 });
          return w;
        };
        const cx = area.x + area.w / 2;
        let y = area.y + area.h / 2 - (seq.length * 78) / 2;
        seq.forEach((c, i) => {
          const state = i < st.next ? 'done' : i === st.next ? 'now' : 'todo';
          const ps = parts(c);
          g.font = '600 20px system-ui, sans-serif';
          const widths = ps.map((p) => Math.max(54, g.measureText(p).width + 28));
          const total = widths.reduce((a, b) => a + b, 0) + (ps.length - 1) * 34;
          let x = cx - total / 2;
          if (seq.length > 1) text(g, `${i + 1}.`, x - 22, y + 26, { size: 18, color: C.muted, align: 'right', baseline: 'middle' });
          ps.forEach((p, k) => {
            x += cap(x, y, p, state);
            if (k < ps.length - 1) {
              text(g, '+', x + 17, y + 26, { size: 20, color: C.muted, align: 'center', baseline: 'middle' });
              x += 34;
            }
          });
          y += 78;
        });
        if (st.last) text(g, `last pressed: ${st.last.text}`, cx, y + 16, { size: 15, color: st.last.ok ? C.green : C.red, align: 'center' });
      },
      status: () => ({
        done: st.next >= seq.length,
        success: st.next >= seq.length && st.wrong === 0,
        score: (st.next / seq.length) * penalty(st.wrong),
        metrics: { expected: seq.map(fmt), completed: st.next, wrong_presses: st.wrong },
      }),
      solution: () => seq.slice(st.next).map((c) => ({ type: 'key', keys: harnessKey(c) })),
    };
  },
};
