import assert from 'node:assert/strict';
import { holePath, nextPill, placeAround } from '../scripts/floatMenu.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const VIEW = { top: 60, bottom: 900, width: 1200 };
const SIZE = { w: 400, h: 200 };

test('a menu goes just above its thing when there is room', () => {
  assert.deepEqual(placeAround({ left: 300, top: 400, bottom: 500 }, SIZE, VIEW), { x: 300, y: 190, up: true });
});

test('with no room above it goes below', () => {
  assert.deepEqual(placeAround({ left: 300, top: 150, bottom: 250 }, SIZE, VIEW), { x: 300, y: 260, up: false });
});

test('with room on neither side it stands at the fallback, inside the view', () => {
  const box = { left: 300, top: 100, bottom: 850 };
  assert.deepEqual(placeAround(box, SIZE, VIEW, { fallbackTop: 140 }), { x: 300, y: 140, up: false });
  assert.equal(placeAround(box, SIZE, VIEW, { fallbackTop: 880 }).y, 700);
  assert.equal(placeAround(box, SIZE, VIEW, { fallbackTop: 0 }).y, 60);
});

test('it keeps inside the window sideways, and takes the left it is asked for', () => {
  assert.equal(placeAround({ left: 1000, top: 400, bottom: 500 }, SIZE, VIEW).x, 792);
  assert.equal(placeAround({ left: -50, top: 400, bottom: 500 }, SIZE, VIEW).x, 8);
  assert.equal(placeAround({ left: 300, top: 400, bottom: 500 }, SIZE, VIEW, { wantLeft: 280 }).x, 280);
});

test('a tall menu that may spill goes on the roomier side and runs past the view', () => {
  const tall = { w: 400, h: 800 };
  // More room below: it starts under the thing.
  assert.deepEqual(placeAround({ left: 300, top: 200, bottom: 260 }, tall, VIEW, { spill: true }), { x: 300, y: 270, up: false });
  // More room above: it ends over the thing, when the page reaches that far up.
  assert.deepEqual(placeAround({ left: 300, top: 700, bottom: 760 }, tall, VIEW, { spill: true, pageTop: 500 }), { x: 300, y: -110, up: true });
  // The page does not reach that far up: below, while a fair part still shows there.
  assert.equal(placeAround({ left: 300, top: 600, bottom: 660 }, tall, VIEW, { spill: true, pageTop: 0 }).y, 670);
});

test('a thing that fills the view leaves a spilling menu at the fallback', () => {
  const tall = { w: 400, h: 800 };
  assert.deepEqual(placeAround({ left: 300, top: 80, bottom: 880 }, tall, VIEW, { spill: true, fallbackTop: 120 }), { x: 300, y: 100, up: false });
});

test('nextPill is the shared arrow-key geometry', () => {
  const R = [{ left: 0, top: 0, width: 80 }, { left: 90, top: 0, width: 80 }, { left: 0, top: 40, width: 120 }];
  assert.equal(nextPill(R, 0, 'ArrowRight'), 1);
  assert.equal(nextPill(R, 1, 'ArrowDown'), 2);
  assert.equal(nextPill(R, 2, 'ArrowUp'), 0);
  assert.equal(nextPill(R, 0, 'x'), -1);
});

test('the hole a veil leaves is the box, square or with rounded corners no bigger than half a side', () => {
  assert.equal(holePath(10, 20, 100, 50), 'M10 20h100v50h-100Z');
  assert.equal(holePath(10, 20, 100, 50, 8), 'M18 20h84a8 8 0 0 1 8 8v34a8 8 0 0 1 -8 8h-84a8 8 0 0 1 -8 -8v-34a8 8 0 0 1 8 -8Z');
  assert.match(holePath(0, 0, 100, 20, 40), /^M10 0h80a10 10 /);
});

console.log(`\n${passed} passed`);
