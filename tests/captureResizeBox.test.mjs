import assert from 'node:assert/strict';
import { boxUnchanged, dimensionsChanged, nudgeBox } from '../scripts/captureElement.js';

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

test('nudgeBox: grow moves every edge outward 1px, centre unchanged', () => {
  assert.deepEqual(nudgeBox(BOX, 1), { top: 99, left: 49, width: 202, height: 82 });
});

test('nudgeBox: shrink is the inverse of grow', () => {
  assert.deepEqual(nudgeBox(BOX, -1), { top: 101, left: 51, width: 198, height: 78 });
});

test('nudgeBox: grow then shrink round-trips to the original box', () => {
  assert.deepEqual(nudgeBox(nudgeBox(BOX, 1), -1), BOX);
});

test('nudgeBox: shrink clamps at the 10px minimum and keeps the centre', () => {
  const tiny = { top: 100, left: 50, width: 11, height: 11 };
  // width/height would hit 9 — clamp to 10, offsetting 0.5 to hold the centre.
  assert.deepEqual(nudgeBox(tiny, -1), { top: 100.5, left: 50.5, width: 10, height: 10 });
  const atMin = { top: 100, left: 50, width: 10, height: 10 };
  assert.deepEqual(nudgeBox(atMin, -1), atMin);
});

console.log(`\n${passed} passed`);
