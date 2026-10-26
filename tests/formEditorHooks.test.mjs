import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as form from '../scripts/form.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }
const src = readFileSync(fileURLToPath(new URL('../scripts/form.js', import.meta.url)), 'utf8');

// The Actions editor returns from an insert-mode recording with a DRAFT that
// differs from the saved action; the dirty baseline must be the saved values,
// not whatever the opener just painted into the form.
test('createForm accepts a caller-supplied dirty baseline', () => {
  assert.match(src, /export async function createForm\(formName, opener, \{ rootEntry = false, baseline = null \} = \{\}\)/);
  assert.match(src, /formEl\._initialSnapshot = baseline \?\? readFormValues\(formEl\);/);
});

// An in-form control (the timeline's insert bar) needs to close the overlay
// before the recorder takes over the page; only dock buttons get `cleanup`.
test('closeActiveForm is exported and safe to call with no form open', () => {
  assert.equal(typeof form.closeActiveForm, 'function');
  assert.doesNotThrow(() => form.closeActiveForm());
});

console.log(`\n${passed} passed`);
