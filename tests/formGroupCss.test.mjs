import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../config/forms/formsStyling.css', import.meta.url), 'utf8');
const block = (sel) => { const i = css.indexOf(`\n${sel} {`); assert.ok(i >= 0, `${sel} rule missing`); return css.slice(i, css.indexOf('}', i)); };
let passed = 0; const test = (n, f) => { f(); passed++; console.log('  ok -', n); };

test('form group is a vertical stack, 6px to the field, 18px between groups', () => {
  const b = block('.more-buttons-form-group');
  assert.match(b, /display:\s*flex/); assert.match(b, /flex-direction:\s*column/);
  assert.match(b, /gap:\s*6px/); assert.match(b, /margin-bottom:\s*18px/);
  assert.doesNotMatch(b, /grid-template-columns/);
});
test('label is an eyebrow: 11px, 600, .06em, uppercase, label colour', () => {
  const b = block('.more-buttons-label');
  assert.match(b, /font-size:\s*0\.6875rem/); assert.match(b, /font-weight:\s*600/);
  assert.match(b, /letter-spacing:\s*\.06em|letter-spacing:\s*0\.06em/); assert.match(b, /text-transform:\s*uppercase/);
  assert.match(b, /color:\s*var\(--mb-text-label\)/);
});
test('no 160px label column survives anywhere', () => {
  assert.ok(!css.includes('160px minmax(0, 1fr)'));
});
test('the title row helper is gone (identity row replaces it)', () => {
  assert.ok(!css.includes('.mb-title-row'));
});
console.log(`${passed} passed`);
