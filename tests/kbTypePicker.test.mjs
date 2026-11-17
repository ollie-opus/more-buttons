import assert from 'node:assert/strict';
import { nextPill } from '../scripts/kbTypePicker.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// Three rows: 3 pills, 2 pills, 1 pill.
const R = [
  { left: 0, top: 0, width: 80 }, { left: 90, top: 0, width: 80 }, { left: 180, top: 0, width: 80 },
  { left: 0, top: 40, width: 120 }, { left: 130, top: 40, width: 120 },
  { left: 0, top: 80, width: 60 },
];

test('left and right step through the pills and wrap', () => {
  assert.equal(nextPill(R, 0, 'ArrowRight'), 1);
  assert.equal(nextPill(R, 5, 'ArrowRight'), 0);
  assert.equal(nextPill(R, 0, 'ArrowLeft'), 5);
  assert.equal(nextPill(R, 3, 'ArrowLeft'), 2);
});

test('down and up go to the nearest pill across in the next row', () => {
  assert.equal(nextPill(R, 0, 'ArrowDown'), 3);
  assert.equal(nextPill(R, 2, 'ArrowDown'), 4);
  assert.equal(nextPill(R, 4, 'ArrowDown'), 5);
  assert.equal(nextPill(R, 4, 'ArrowUp'), 2);
  assert.equal(nextPill(R, 5, 'ArrowUp'), 3);
});

test('down from the last row and up from the first stay put', () => {
  assert.equal(nextPill(R, 5, 'ArrowDown'), 5);
  assert.equal(nextPill(R, 1, 'ArrowUp'), 1);
});

test('home and end, other keys, no pills, no pill focused', () => {
  assert.equal(nextPill(R, 3, 'Home'), 0);
  assert.equal(nextPill(R, 3, 'End'), 5);
  assert.equal(nextPill(R, 3, 'Enter'), -1);
  assert.equal(nextPill([], 0, 'ArrowRight'), -1);
  assert.equal(nextPill(R, -1, 'ArrowDown'), 0);
});

console.log(`\n${passed} passed`);
