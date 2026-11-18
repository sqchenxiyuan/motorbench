// Key-name normalisation. Agents write keys in many dialects ("ctrl+a", "Return",
// "Page_Down", "Control+KeyA"); the browser driver wants Playwright names.

const ALIAS: Record<string, string> = {
  ctrl: 'Control', control: 'Control', control_l: 'Control', control_r: 'Control',
  shift: 'Shift', shift_l: 'Shift', shift_r: 'Shift',
  alt: 'Alt', alt_l: 'Alt', alt_r: 'Alt', option: 'Alt',
  meta: 'Meta', super: 'Meta', super_l: 'Meta', cmd: 'Meta', command: 'Meta', win: 'Meta', windows: 'Meta',
  return: 'Enter', enter: 'Enter', kp_enter: 'Enter',
  esc: 'Escape', escape: 'Escape',
  tab: 'Tab', space: 'Space', spacebar: 'Space',
  backspace: 'Backspace', delete: 'Delete', del: 'Delete', insert: 'Insert', ins: 'Insert',
  home: 'Home', end: 'End',
  pageup: 'PageUp', page_up: 'PageUp', prior: 'PageUp', pgup: 'PageUp',
  pagedown: 'PageDown', page_down: 'PageDown', next: 'PageDown', pgdn: 'PageDown',
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight',
  minus: 'Minus', equal: 'Equal', comma: 'Comma', period: 'Period', slash: 'Slash', backslash: 'Backslash',
  semicolon: 'Semicolon', apostrophe: 'Quote', grave: 'Backquote', bracketleft: 'BracketLeft', bracketright: 'BracketRight',
  capslock: 'CapsLock', caps_lock: 'CapsLock',
};

const MODIFIERS = new Set(['Control', 'Shift', 'Alt', 'Meta']);

function splitCombo(s: string): string[] {
  // "ctrl++" means Ctrl and the plus key.
  const parts = s.trim().split('+');
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === '' && i > 0) {
      if (out[out.length - 1] !== '+') out.push('+');
    } else if (parts[i] !== '') out.push(parts[i].trim());
  }
  return out.length ? out : ['+'];
}

function normalizeOne(part: string): string {
  const lower = part.toLowerCase();
  if (ALIAS[lower]) return ALIAS[lower];
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return lower.toUpperCase();
  if (/^[a-z]$/.test(lower)) return `Key${lower.toUpperCase()}`;
  if (/^[0-9]$/.test(part)) return `Digit${part}`;
  if (/^key[a-z]$/.test(lower)) return `Key${lower.slice(3).toUpperCase()}`;
  if (/^digit[0-9]$/.test(lower)) return `Digit${lower.slice(5)}`;
  return part;
}

/** "ctrl+shift+k" -> ["Control", "Shift", "KeyK"] */
export function parseKeys(combo: string): string[] {
  return splitCombo(combo).map(normalizeOne);
}

/** "ctrl+shift+k" -> "Control+Shift+KeyK" */
export function normalizeKeys(combo: string): string {
  return parseKeys(combo).join('+');
}

/** "ctrl+shift" -> ["Control", "Shift"]; anything that is not a modifier is rejected. */
export function parseModifiers(text: string | undefined | null): string[] {
  if (!text) return [];
  const keys = parseKeys(text);
  const bad = keys.find((k) => !MODIFIERS.has(k));
  if (bad) throw new Error(`not a modifier key: ${bad}`);
  return keys;
}
