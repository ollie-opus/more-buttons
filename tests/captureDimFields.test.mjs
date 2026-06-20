import assert from 'node:assert/strict';
import { captureDimFields, parseComponents, buildComponentBody } from '../scripts/components.js';
import { mergeFields } from '../scripts/formMerge.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const DIM_SPECS = [
  { name: 'dimMode', type: 'scalar', label: 'Dimension mode' },
  { name: 'dimValue', type: 'scalar', label: 'Dimension value' },
];

test('auto capture (library insert) normalizes dimValue to empty string', () => {
  const cap = { uuid: 'CAP-1', lightFilename: 'a-light-mode.png', darkFilename: 'a-dark-mode.png', dimMode: 'none', dimValue: null };
  assert.deepEqual(captureDimFields(cap), { dimMode: 'none', dimValue: '', captureTheme: 'default', captureCorner: 'disabled' });
});

test('sized capture keeps its value as a string', () => {
  const cap = { dimMode: 'height', dimValue: 120 };
  assert.deepEqual(captureDimFields(cap), { dimMode: 'height', dimValue: '120', captureTheme: 'default', captureCorner: 'disabled' });
});

test('missing capture reads as auto with empty value', () => {
  assert.deepEqual(captureDimFields(undefined), { dimMode: 'none', dimValue: '', captureTheme: 'default', captureCorner: 'disabled' });
});

test('inversed + rounded cap maps to the form-facing radio values', () => {
  const cap = { dimMode: 'height', dimValue: 80, inversed: true, rounded: true };
  assert.deepEqual(captureDimFields(cap), { dimMode: 'height', dimValue: '80', captureTheme: 'inversed', captureCorner: 'enabled' });
});

// Regression: insert an auto capture from the library, open its editor (baseline
// = captureDimFields of the inserted cap), give it a dimension, save. The fresh
// markdown still holds the untouched auto capture — this must NOT conflict.
test('giving a dimension to a freshly-inserted auto capture is only-you-changed, not a conflict', () => {
  const inserted = { uuid: 'CAP-1', lightFilename: 'a-light-mode.png', darkFilename: 'a-dark-mode.png', dimMode: 'none', dimValue: null };
  const body = buildComponentBody(null, 'Desc', [{ kind: 'capture', cap: inserted }]);
  const freshCap = parseComponents(body, /note/).components
    .find(c => c.kind === 'capture' && c.cap.uuid === 'CAP-1')?.cap;

  const snap = captureDimFields(inserted);          // baseline at form open
  const cur = { dimMode: 'height', dimValue: '500' }; // the user's edit
  const fresh = captureDimFields(freshCap);          // re-fetched markdown

  const { resolved, conflicts } = mergeFields(snap, cur, fresh, DIM_SPECS);
  assert.equal(conflicts.length, 0);
  assert.equal(resolved.dimMode, 'height');
  assert.equal(resolved.dimValue, '500');
});

console.log(`captureDimFields: ${passed} passed`);
