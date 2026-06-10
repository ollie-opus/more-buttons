import assert from 'node:assert/strict';
import { boxUnchanged, dimensionsChanged } from '../scripts/captureElement.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const BOX = { top: 100, left: 50, width: 200, height: 80 };

test('boxUnchanged: identical box is unchanged', () => {
  assert.equal(boxUnchanged(BOX, { ...BOX }), true);
});

test('boxUnchanged: sub-pixel jitter still counts as unchanged', () => {
  assert.equal(boxUnchanged(BOX, { top: 100.3, left: 49.7, width: 200.2, height: 79.9 }), true);
});

test('boxUnchanged: a moved box is changed even when dimensions are equal', () => {
  // Dragging opposite handles can net a pure move; dimensionsChanged misses it.
  const moved = { ...BOX, left: 60 };
  assert.equal(boxUnchanged(BOX, moved), false);
  assert.equal(dimensionsChanged(BOX, moved), false);
});

test('boxUnchanged: a resized box is changed', () => {
  assert.equal(boxUnchanged(BOX, { ...BOX, width: 220 }), false);
});

console.log(`\n${passed} passed`);
