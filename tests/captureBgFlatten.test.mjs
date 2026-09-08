import assert from 'node:assert/strict';
import { compositeColorStack } from '../scripts/captureElement.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

test('empty stack falls back to opaque white', () => {
  assert.equal(compositeColorStack([]), 'rgb(255, 255, 255)');
});

test('single opaque colour passes through', () => {
  assert.equal(compositeColorStack([[30, 40, 56, 1]]), 'rgb(30, 40, 56)');
});

test('semi-transparent layer over an opaque one composites (the dark-padding bug)', () => {
  // rgba(30,40,56,.5) veil over an opaque rgb(23,32,48) page background —
  // must yield the blended OPAQUE colour, never the raw semi-transparent veil.
  assert.equal(compositeColorStack([[30, 40, 56, 0.5], [23, 32, 48, 1]]), 'rgb(27, 36, 52)');
});

test('semi-transparent layer with no opaque ancestor blends over the white base', () => {
  assert.equal(compositeColorStack([[0, 0, 0, 0.5]]), 'rgb(128, 128, 128)');
});

test('layers below an opaque one are ignored', () => {
  assert.equal(compositeColorStack([[10, 20, 30, 1], [200, 0, 0, 0.9]]), 'rgb(10, 20, 30)');
});

test('two semi-transparent layers stack in order (nearest last-applied)', () => {
  // white base → 50% black → 50% white = rgb(191.5) rounded 192? compute:
  // base 255 → over 0.5 black: 127.5 → over 0.5 white: 191.25 → round 191
  assert.equal(compositeColorStack([[255, 255, 255, 0.5], [0, 0, 0, 0.5]]), 'rgb(191, 191, 191)');
});

test('out-of-range alpha is clamped', () => {
  assert.equal(compositeColorStack([[50, 60, 70, 1.5]]), 'rgb(50, 60, 70)');
  assert.equal(compositeColorStack([[50, 60, 70, -1]]), 'rgb(255, 255, 255)');
});

console.log(`\n${passed} passed`);
