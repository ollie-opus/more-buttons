import assert from 'node:assert/strict';
import { normaliseGroup, splitBySurface, orderDockButtons } from '../scripts/dockLayout.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const b = (id, dockOrder, dockGroup, extra = {}) => ({ id, dockOrder, dockGroup, ...extra });
const ids = (groups) => groups.map((g) => g.map((x) => x.id));

test('normaliseGroup trims and nulls blanks', () => {
  assert.equal(normaliseGroup('  A '), 'A');
  assert.equal(normaliseGroup('   '), null);
  assert.equal(normaliseGroup(''), null);
  assert.equal(normaliseGroup(undefined), null);
  assert.equal(normaliseGroup(null), null);
  assert.equal(normaliseGroup(5), null);
});

test('spec example: A 1,5,6 / B 2,4 / C 3 -> A,B,C', () => {
  const btns = [b('a1', 1, 'A'), b('b2', 2, 'B'), b('c3', 3, 'C'), b('b4', 4, 'B'), b('a5', 5, 'A'), b('a6', 6, 'A')];
  assert.deepEqual(ids(orderDockButtons(btns)), [['a1', 'a5', 'a6'], ['b2', 'b4'], ['c3']]);
});

test('ungrouped bucket is last even at dockOrder 0', () => {
  const btns = [b('n', 0), b('a', 5, 'A')];
  assert.deepEqual(ids(orderDockButtons(btns)), [['a'], ['n']]);
});

test('blank/whitespace/undefined group all land in the null bucket', () => {
  const btns = [b('x', 1, ''), b('y', 2, '   '), b('z', 3, undefined), b('a', 9, 'A')];
  assert.deepEqual(ids(orderDockButtons(btns)), [['a'], ['x', 'y', 'z']]);
});

test('whitespace-padded group names share a bucket', () => {
  const btns = [b('a1', 1, 'A'), b('a2', 2, ' A ')];
  assert.deepEqual(ids(orderDockButtons(btns)), [['a1', 'a2']]);
});

test('ties keep config order', () => {
  const btns = [b('p', 1, 'A'), b('q', 1, 'A'), b('r', 1, 'A')];
  assert.deepEqual(ids(orderDockButtons(btns)), [['p', 'q', 'r']]);
});

test('missing dockOrder sorts last within its group', () => {
  const btns = [b('n', undefined, 'A'), b('s', 'x', 'A'), b('t', 3, 'A'), b('u', 1, 'A')];
  assert.deepEqual(ids(orderDockButtons(btns)), [['u', 't', 'n', 's']]);
});

test('group with only unordered buttons sorts after ordered groups, by first idx', () => {
  const btns = [b('u1', undefined, 'U'), b('a', 4, 'A'), b('v1', undefined, 'V')];
  assert.deepEqual(ids(orderDockButtons(btns)), [['a'], ['u1'], ['v1']]);
});

test('returns the original button objects', () => {
  const btn = b('a', 1, 'A');
  assert.equal(orderDockButtons([btn])[0][0], btn);
});

test('empty input -> []', () => {
  assert.deepEqual(orderDockButtons([]), []);
});

test('splitBySurface defaults to page', () => {
  const p = b('p', 1), q = b('q', 2, undefined, { surface: 'popup' }), r = b('r', 3, undefined, { surface: 'page' });
  const { page, popup } = splitBySurface([p, q, r]);
  assert.deepEqual(page, [p, r]);
  assert.deepEqual(popup, [q]);
});

console.log(`${passed} passed`);
