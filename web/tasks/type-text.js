// type-text: click a text box and type a given string exactly.
import { C, rect, text, MONO } from '../lib/ui.js';
import { levenshtein, round3 } from '../lib/geom.js';

const WORDS = ['garden', 'river', 'window', 'planet', 'silver', 'orange', 'coffee', 'bridge', 'pencil', 'forest', 'candle', 'market', 'rocket', 'summer', 'violin', 'harbor', 'lantern', 'meadow', 'pocket', 'thunder'];
const NAMES = ['Alice', 'Marcus', 'Priya', 'Tomas', 'Elena', 'Kenji'];
const CITIES = ['Lisbon', 'Denver', 'Osaka', 'Nairobi', 'Toronto', 'Oslo'];
const MONTHS = ['January', 'March', 'May', 'July', 'August', 'October', 'December'];
const ALNUM = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SYMBOLS = '!@#$%^&*_-+=?';

function makeTarget(rng, level) {
  const digits = (k) => Array.from({ length: k }, () => rng.int(0, 9)).join('');
  if (level === 1) return `${rng.pick(WORDS)} ${rng.pick(WORDS)}`;
  if (level === 2) {
    return rng.pick([
      () => `Invoice #${rng.int(1000, 9999)} is due on ${rng.pick(MONTHS)} ${rng.int(1, 28)}, total $${rng.int(1, 9)},${digits(3)}.${digits(2)}`,
      () => `Meet ${rng.pick(NAMES)} at ${rng.int(1, 12)}:${rng.pick(['00', '15', '30', '45'])} PM in Room ${rng.int(100, 999)}.`,
      () => `Order ${rng.int(10000, 99999)} shipped to ${rng.pick(CITIES)}; tracking ID ${rng.pick(['AX', 'QT', 'ZK'])}-${digits(4)}.`,
      () => `Reset code: ${digits(6)} (expires in ${rng.int(5, 45)} minutes)`,
    ])();
  }
  const chars = [];
  for (let i = 0; i < 12; i++) chars.push(ALNUM[rng.int(0, ALNUM.length - 1)]);
  for (let i = 0; i < 4; i++) chars.push(SYMBOLS[rng.int(0, SYMBOLS.length - 1)]);
  return rng.shuffle(chars).join('');
}

export const typeText = {
  id: 'type-text',
  title: 'Type text',
  category: 'keyboard',
  summary: 'Click a text box and type exactly: two words -> a sentence with digits/punctuation -> replace existing text with a random string.',
  create({ rng, level, area, widgets }) {
    const target = makeTarget(rng, level);
    const prefill = level === 3 ? `${rng.pick(WORDS)} ${rng.pick(WORDS)}` : '';
    const box = { x: Math.round(area.x + rng.range(40, area.w - 760)), y: Math.round(area.y + rng.range(150, area.h - 120)), w: 720, h: 48 };

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'field';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.value = prefill;
    Object.assign(input.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
    widgets.appendChild(input);
    input.addEventListener('input', () => input.classList.toggle('ok', input.value === target));

    return {
      instruction:
        level === 3
          ? `Replace the contents of the text box with exactly this text (without the surrounding quotes): "${target}"`
          : `Click the text box and type exactly this text (without the surrounding quotes): "${target}"`,
      onEvent() {},
      draw(g) {
        text(g, 'Text to type', box.x, box.y - 106, { size: 14, color: C.muted });
        rect(g, { x: box.x, y: box.y - 96, w: box.w, h: 44 }, { fill: '#e5e7eb', radius: 6 });
        text(g, target, box.x + 14, box.y - 73, { size: 20, baseline: 'middle', font: MONO });
        text(g, 'Text box', box.x, box.y - 12, { size: 14, color: C.muted });
      },
      status() {
        const d = levenshtein(input.value, target);
        const sim = 1 - d / Math.max(input.value.length, target.length);
        // Credit is measured from the starting contents, so leaving the box untouched scores 0.
        const sim0 = prefill ? 1 - levenshtein(prefill, target) / Math.max(prefill.length, target.length) : 0;
        return {
          done: input.value === target,
          success: input.value === target,
          score: Math.max(0, (sim - sim0) / (1 - sim0)),
          metrics: { target, typed: input.value, edit_distance: d, similarity: round3(sim) },
        };
      },
      solution() {
        const click = { type: 'click', x: Math.round(box.x + box.w / 2), y: Math.round(box.y + box.h / 2) };
        return level === 3 ? [click, { type: 'key', keys: 'Control+KeyA' }, { type: 'type', text: target }] : [click, { type: 'type', text: target }];
      },
    };
  },
};
