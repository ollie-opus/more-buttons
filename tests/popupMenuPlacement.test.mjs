import assert from 'node:assert/strict';
import { resolveMenuPlacement, resolveSubmenuFlip } from '../scripts/insertMenu.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const vp = { width: 1200, height: 700 };
const menu = { width: 220, height: 480 };
const rect = (top, left = 100, h = 24) => ({ top, bottom: top + h, left });

test('below the trigger when it fits', () => {
  assert.deepEqual(resolveMenuPlacement(rect(100), menu, vp), { x: 100, y: 128, maxHeight: null });
});
test('above the trigger when below overflows and above fits', () => {
  assert.deepEqual(resolveMenuPlacement(rect(600), menu, vp), { x: 100, y: 600 - 4 - 480, maxHeight: null });
});
test('neither side fits: pinned to the bottom edge, never past it (may cover the trigger)', () => {
  const p = resolveMenuPlacement(rect(350), menu, vp);
  assert.equal(p.y + menu.height, vp.height - 4);
  assert.equal(p.maxHeight, null);
});
test('taller than the viewport: starts at the top edge with a max height that scrolls', () => {
  const p = resolveMenuPlacement(rect(350), { width: 220, height: 900 }, vp);
  assert.equal(p.y, 4);
  assert.equal(p.maxHeight, vp.height - 8);
});
test('horizontal clamp at both edges', () => {
  assert.equal(resolveMenuPlacement(rect(100, 1150), menu, vp).x, 1200 - 220 - 4);
  assert.equal(resolveMenuPlacement(rect(100, -30), menu, vp).x, 4);
});
test('context-menu point: opens at the point, flips above it when needed', () => {
  assert.deepEqual(resolveMenuPlacement({ x: 300, y: 100 }, menu, vp), { x: 300, y: 100, maxHeight: null });
  assert.equal(resolveMenuPlacement({ x: 300, y: 650 }, menu, vp).y, 650 - 480);
  const pinned = resolveMenuPlacement({ x: 300, y: 400 }, menu, vp);
  assert.equal(pinned.y + menu.height, vp.height - 4);
});
test('submenu: rightward and hanging from the row by default', () => {
  assert.deepEqual(resolveSubmenuFlip(rect(200), { width: 210, height: 90 }, { x: 100, width: 220 }, vp), { left: false, up: false });
});
test('submenu: flips left near the right edge, flips up near the bottom edge', () => {
  const sub = { width: 210, height: 90 };
  assert.deepEqual(resolveSubmenuFlip(rect(200), sub, { x: 950, width: 220 }, vp), { left: true, up: false });
  assert.deepEqual(resolveSubmenuFlip(rect(650), sub, { x: 100, width: 220 }, vp), { left: false, up: true });
  assert.deepEqual(resolveSubmenuFlip(rect(650), sub, { x: 950, width: 220 }, vp), { left: true, up: true });
});
test('submenu: no flip when the other side would not fit either', () => {
  assert.equal(resolveSubmenuFlip(rect(200), { width: 1500, height: 90 }, { x: 950, width: 220 }, vp).left, false);
  assert.equal(resolveSubmenuFlip(rect(30), { width: 210, height: 800 }, { x: 100, width: 220 }, vp).up, false);
});

console.log(`\n${passed} passed`);
