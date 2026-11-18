import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeKeys, parseModifiers } from '../src/keys.ts';

test('key names from different dialects normalise to Playwright names', () => {
  const cases: [string, string][] = [
    ['ctrl+a', 'Control+KeyA'],
    ['Control+KeyA', 'Control+KeyA'],
    ['ctrl+shift+K', 'Control+Shift+KeyK'],
    ['Return', 'Enter'],
    ['Escape', 'Escape'],
    ['Page_Down', 'PageDown'],
    ['alt+Tab', 'Alt+Tab'],
    ['super+l', 'Meta+KeyL'],
    ['shift+F7', 'Shift+F7'],
    ['Up', 'ArrowUp'],
    ['ArrowLeft', 'ArrowLeft'],
    ['BackSpace', 'Backspace'],
    ['space', 'Space'],
    ['ctrl+1', 'Control+Digit1'],
    ['ctrl++', 'Control++'],
    ['$', '$'],
  ];
  for (const [input, want] of cases) assert.equal(normalizeKeys(input), want, input);
});

test('modifier strings', () => {
  assert.deepEqual(parseModifiers('ctrl+shift'), ['Control', 'Shift']);
  assert.deepEqual(parseModifiers(undefined), []);
  assert.throws(() => parseModifiers('ctrl+a'), /not a modifier/);
});
