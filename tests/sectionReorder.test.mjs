import assert from 'node:assert/strict';
import { moveSectionAmongSiblings, parseSections, buildSectionTree } from '../scripts/sections.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// h1 Title; three h2s (First carries two h3 children); blank-line separators only
// (the format guide saves actually produce — no `---` between sections).
const DOC = `# My Guide
<span data-uuid="h1" style="display:none"></span>

Intro.

## First
<span data-uuid="a" style="display:none"></span>

First body.

### A-one
<span data-uuid="a1" style="display:none"></span>

a1 body.

### A-two
<span data-uuid="a2" style="display:none"></span>

a2 body.

## Second
<span data-uuid="b" style="display:none"></span>

Second body.

## Third
<span data-uuid="c" style="display:none"></span>

Third body.
`;

const h2Titles = (md) => parseSections(md).filter(s => s.level === 2).map(s => s.title);
const uuidSet = (md) => new Set(parseSections(md).map(s => s.uuid));

test('move an h2 up swaps it with the previous h2, carrying its h3 children', () => {
  const out = moveSectionAmongSiblings(DOC, 'b', 'up'); // Second up, over First
  assert.deepEqual(h2Titles(out), ['Second', 'First', 'Third']);
  // First still owns A-one / A-two after the move.
  const { sections } = buildSectionTree(out);
  const first = sections.find(s => s.uuid === 'a');
  const kids = sections.filter(s => s.level === 3 && s.parentUuid === 'a').map(s => s.title);
  assert.deepEqual(kids, ['A-one', 'A-two']);
  assert.equal(first.label, 'Section 2'); // First is now the 2nd h2
});

test('move an h2 down is the inverse swap (same result as the neighbour moving up)', () => {
  const out = moveSectionAmongSiblings(DOC, 'a', 'down'); // First down, under Second
  assert.deepEqual(h2Titles(out), ['Second', 'First', 'Third']);
});

test('move an h3 down swaps it with its sibling h3 within the same h2', () => {
  const out = moveSectionAmongSiblings(DOC, 'a1', 'down');
  const kids = buildSectionTree(out).sections.filter(s => s.parentUuid === 'a').map(s => s.title);
  assert.deepEqual(kids, ['A-two', 'A-one']);
});

test('moving the first sibling up is a no-op', () => {
  assert.equal(moveSectionAmongSiblings(DOC, 'a', 'up'), DOC);
});

test('moving the last sibling down is a no-op', () => {
  assert.equal(moveSectionAmongSiblings(DOC, 'c', 'down'), DOC);
});

test('moving the title (h1) is a no-op', () => {
  assert.equal(moveSectionAmongSiblings(DOC, 'h1', 'up'), DOC);
  assert.equal(moveSectionAmongSiblings(DOC, 'h1', 'down'), DOC);
});

test('an unknown uuid is a no-op', () => {
  assert.equal(moveSectionAmongSiblings(DOC, 'nope', 'up'), DOC);
});

test('all section UUIDs survive a move', () => {
  const out = moveSectionAmongSiblings(DOC, 'b', 'up');
  assert.deepEqual([...uuidSet(out)].sort(), [...uuidSet(DOC)].sort());
});

test('bodies stay attached to their headings', () => {
  const out = moveSectionAmongSiblings(DOC, 'b', 'up');
  // Second's body now precedes First's body in the file.
  assert.ok(out.indexOf('Second body.') < out.indexOf('First body.'));
  // A-one body still sits after First body (h3 rode along under First).
  assert.ok(out.indexOf('First body.') < out.indexOf('a1 body.'));
});

test('output re-parses cleanly (no duplicated/blank-collapsed headings)', () => {
  const out = moveSectionAmongSiblings(DOC, 'b', 'up');
  assert.equal(parseSections(out).length, parseSections(DOC).length);
  assert.ok(!/\n\n\n\n/.test(out), 'no runaway blank-line runs at the seam');
});

test('a trailing --- separator in a section body survives a reorder', () => {
  // Second's body ends in a user-inserted separator; it must travel with Second
  // (regression: the block-tail trim used to drop trailing `---`).
  const doc = DOC.replace('Second body.', 'Second body.\n\n---');
  const out = moveSectionAmongSiblings(doc, 'b', 'up');
  assert.deepEqual(h2Titles(out), ['Second', 'First', 'Third']);
  // The separator stays inside Second (between its body and the next heading).
  const sep = out.indexOf('\n---');
  assert.ok(sep > out.indexOf('Second body.') && sep < out.indexOf('## First'),
    'separator stayed with the Second section after the move');
});

console.log(`\n${passed} passed`);
