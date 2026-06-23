import assert from 'node:assert/strict';
import {
  nodeAtPath, moveSibling, detachAtPath, attachUnderPath, attachUnderSegments,
} from '../scripts/navTree.js'; // re-exported from navToml; see Step 3 note

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const fresh = () => ([
  { name: 'Guides', children: [
    { name: 'A', value: 'pages/a.md' },
    { name: 'B', value: 'pages/b.md' },
    { name: 'C', value: 'pages/c.md' },
  ] },
  { name: 'Reference', children: [
    { name: 'D', value: 'pages/d.md' },
  ] },
]);

test('nodeAtPath walks indices through children', () => {
  assert.equal(nodeAtPath(fresh(), [0, 1]).name, 'B');
  assert.equal(nodeAtPath(fresh(), [1]).name, 'Reference');
  assert.equal(nodeAtPath(fresh(), [0, 9]), null);
});

test('moveSibling swaps with the next neighbour', () => {
  const t = fresh();
  assert.equal(moveSibling(t, [0, 0], +1), true);
  assert.deepEqual(t[0].children.map(n => n.name), ['B', 'A', 'C']);
});

test('moveSibling is a no-op past the end', () => {
  const t = fresh();
  assert.equal(moveSibling(t, [0, 2], +1), false);
  assert.deepEqual(t[0].children.map(n => n.name), ['A', 'B', 'C']);
});

test('detachAtPath removes and returns the node', () => {
  const t = fresh();
  const n = detachAtPath(t, [0, 1]);
  assert.equal(n.name, 'B');
  assert.deepEqual(t[0].children.map(x => x.name), ['A', 'C']);
});

test('attachUnderPath pushes into the target section', () => {
  const t = fresh();
  const n = detachAtPath(t, [0, 1]);          // pull B out of Guides
  attachUnderPath(t, [1], n);                  // into Reference (now index 1)
  assert.deepEqual(t[1].children.map(x => x.name), ['D', 'B']);
});

test('attachUnderSegments creates missing sections title-cased', () => {
  const t = fresh();
  const n = detachAtPath(t, [0, 0]);          // pull A out
  attachUnderSegments(t, ['guides', 'contractors'], n);
  const contractors = t[0].children.find(x => x.name === 'Contractors');
  assert.ok(contractors, 'Contractors section created');
  assert.deepEqual(contractors.children.map(x => x.name), ['A']);
});

console.log(`\n${passed} passed`);
