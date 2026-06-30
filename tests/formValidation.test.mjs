import assert from 'node:assert/strict';
import { fieldError } from '../scripts/formValidation.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// fieldError is the DOM-free decision half of form validation. The DOM wiring
// (painting --invalid, scroll/focus, aria) mirrors the untested createForm glue
// and is verified by hand; these lock the rules a user actually feels.

test('required + empty fails with a worded reason', () => {
  const err = fieldError({ required: true, empty: true, value: '' });
  assert.equal(err?.reason, 'required');
  assert.match(err.message, /required/i);
});

test('required + filled passes', () => {
  assert.equal(fieldError({ required: true, empty: false, value: 'x' }), null);
});

test('optional + empty passes (no false positives on blank optionals)', () => {
  assert.equal(fieldError({ required: false, empty: true, value: '' }), null);
});

test('over maxlength fails regardless of required', () => {
  const err = fieldError({ required: false, empty: false, value: 'abcdef', maxlength: 3 });
  assert.equal(err?.reason, 'maxlength');
  assert.match(err.message, /3 characters/);
});

test('at the maxlength boundary passes', () => {
  assert.equal(
    fieldError({ required: false, empty: false, value: 'abc', maxlength: 3 }),
    null,
  );
});

test('required beats maxlength when both fail (empty is the first thing to fix)', () => {
  const err = fieldError({ required: true, empty: true, value: '', maxlength: 3 });
  assert.equal(err?.reason, 'required');
});

test('null maxlength / null value is ignored (radio groups pass through)', () => {
  assert.equal(
    fieldError({ required: true, empty: false, value: null, maxlength: null }),
    null,
  );
});

console.log(`\n${passed} passed`);
