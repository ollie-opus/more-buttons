import assert from 'node:assert/strict';
import { renderTree } from '../scripts/kbTree.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const nodes = [
  { kind: 'folder', label: 'Employees', children: [
    { kind: 'file', label: 'A', attrs: { 'data-kb-file': 'pages/a.md' } },
    { kind: 'file', label: 'B', attrs: { 'data-kb-file': 'pages/b.md' } },
  ] },
];

test('default render has no reorder controls (unchanged)', () => {
  const html = renderTree(nodes);
  assert.ok(!html.includes('data-kb-move-up'));
  assert.ok(!html.includes('data-kb-path'));
  assert.ok(!html.includes('mb-kb-row-line'));  // no wrapper when not reorderable
});

test('reorderable wraps row + controls in one line, controls after the row button', () => {
  const html = renderTree(nodes, { reorderable: true });
  assert.ok(html.includes('mb-kb-row-line'));
  // Inside a row line: the row button comes first, then the controls — so the
  // controls render on the same line, to the right of the row (and its pills).
  const order = /<div class="mb-kb-row-line"><button class="mb-kb-node-row"[\s\S]*?<\/button><span class="mb-kb-row-controls">/;
  assert.ok(order.test(html), 'controls are a sibling immediately after the row button, inside the line');
});

test('reorderable render adds controls and index paths', () => {
  const html = renderTree(nodes, { reorderable: true });
  assert.ok(html.includes('data-kb-move-up'));
  assert.ok(html.includes('data-kb-move-to'));
  assert.ok(html.includes('data-kb-path="0"'));     // the folder
  assert.ok(html.includes('data-kb-path="0.0"'));   // leaf A
  assert.ok(html.includes('data-kb-path="0.1"'));   // leaf B
});

test('first sibling Up disabled, last sibling Down disabled', () => {
  const html = renderTree(nodes, { reorderable: true });
  // A (0.0) is first → its Up is disabled; B (0.1) is last → its Down disabled.
  const aUp = html.match(/data-kb-path="0\.0"[\s\S]*?data-kb-move-up[^>]*>/)[0];
  assert.ok(aUp.includes('disabled'));
  const bDown = html.match(/data-kb-path="0\.1"[\s\S]*?data-kb-move-down[^>]*>/)[0];
  assert.ok(bDown.includes('disabled'));
});

console.log(`\n${passed} passed`);
