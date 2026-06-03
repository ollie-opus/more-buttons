import assert from 'node:assert/strict';
import { applyMarker, applyLink } from '../scripts/markdownToolbarActions.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// applyMarker — wrap a non-empty selection
test('wrap whole value in bold', () => {
  assert.deepEqual(applyMarker('foo', 0, 3, '**'),
    { value: '**foo**', selStart: 2, selEnd: 5 });
});

// applyMarker — partial word only (bug #2 regression)
test('wrap only the selected part of a word', () => {
  assert.deepEqual(applyMarker('foobar', 0, 3, '**'),
    { value: '**foo**bar', selStart: 2, selEnd: 5 });
});

// applyMarker — collapsed cursor inserts markers and sits between them (bug #1)
test('collapsed cursor inserts paired markers with caret between', () => {
  assert.deepEqual(applyMarker('', 0, 0, '**'),
    { value: '****', selStart: 2, selEnd: 2 });
});
test('collapsed cursor mid-text', () => {
  // The single '*' marker is inserted twice ('a' + '*' + '*' + 'b'): two
  // single-char markers, NOT a bold '**' delimiter.
  assert.deepEqual(applyMarker('ab', 1, 1, '*'),
    { value: 'a**b', selStart: 2, selEnd: 2 });
});

// applyMarker — toggle off when markers sit OUTSIDE the selection
test('toggle off: markers immediately outside selection', () => {
  assert.deepEqual(applyMarker('**foo**', 2, 5, '**'),
    { value: 'foo', selStart: 0, selEnd: 3 });
});

// applyMarker — toggle off when markers are INSIDE the selection edges
test('toggle off: selection includes the markers', () => {
  assert.deepEqual(applyMarker('**foo**', 0, 7, '**'),
    { value: 'foo', selStart: 0, selEnd: 3 });
});

// applyMarker — sub-delimiter must NOT toggle off a longer adjacent marker (fall back to wrapping)
test('italic inside bold wraps, not toggles (outside form)', () => {
  assert.deepEqual(applyMarker('**foo**', 2, 5, '*'),
    { value: '***foo***', selStart: 3, selEnd: 6 });
});
test('italic over whole bold span wraps, not toggles (inside form)', () => {
  assert.deepEqual(applyMarker('**foo**', 0, 7, '*'),
    { value: '***foo***', selStart: 1, selEnd: 8 });
});

// applyMarker — toggle off a marker that wraps the selection THROUGH nested
// layers (the selection is just the inner word, other markers sit between it
// and the marker being toggled).
test('toggle bold off through a nested italic layer (issue 1)', () => {
  // ***test*** with only `test` selected, click Bold -> remove the bold layer,
  // leaving the italic: *test*.
  assert.deepEqual(applyMarker('***test***', 3, 7, '**'),
    { value: '*test*', selStart: 1, selEnd: 5 });
});
test('toggle bold off through a nested underline layer (issue 2)', () => {
  // **^^test^^** with only `test` selected, click Bold -> remove the outer bold
  // layer through the inner ^^underline^^: ^^test^^.
  assert.deepEqual(applyMarker('**^^test^^**', 4, 8, '**'),
    { value: '^^test^^', selStart: 2, selEnd: 6 });
});
test('toggle inner italic off leaves the outer bold', () => {
  // ***test*** with only `test` selected, click Italic -> remove just the
  // italic layer, leaving the bold: **test**.
  assert.deepEqual(applyMarker('***test***', 3, 7, '*'),
    { value: '**test**', selStart: 2, selEnd: 6 });
});

// applyMarker — a selection that straddles an existing mark's boundary is
// CLIPPED to the clean part outside that mark (markdown can't represent
// overlap, and we don't want to nest the inside part either).
test('applying a mark across a bold close clips to the outside part', () => {
  // **testing** 12345 with `ng** 12345` (7..17) selected, click Underline:
  // only the part after the bold close is underlined; the bold is left intact.
  assert.deepEqual(applyMarker('**testing** 12345', 7, 17, '^^'),
    { value: '**testing** ^^12345^^', selStart: 14, selEnd: 19 });
});
test('applying a mark across a bold open clips to the outside part', () => {
  // 12345 **testing** with `12345 **te` (0..10) selected, click Underline:
  // only the part before the bold open is underlined.
  assert.deepEqual(applyMarker('12345 **testing**', 0, 10, '^^'),
    { value: '^^12345^^ **testing**', selStart: 2, selEnd: 7 });
});
test('a mark fully inside the selection just wraps (no clip)', () => {
  assert.deepEqual(applyMarker('a **b** c', 0, 9, '^^'),
    { value: '^^a **b** c^^', selStart: 2, selEnd: 11 });
});
test('a selection cleanly inside a mark still nests', () => {
  // No boundary is crossed, so wrapping inside an existing mark is fine.
  assert.deepEqual(applyMarker('**testing**', 6, 9, '^^'),
    { value: '**test^^ing^^**', selStart: 8, selEnd: 11 });
});

// applyMarker — different markers
test('highlight marker', () => {
  assert.deepEqual(applyMarker('hi', 0, 2, '=='),
    { value: '==hi==', selStart: 2, selEnd: 4 });
});

// applyLink — splice [text](url) at the selection, caret after snippet
test('applyLink splices markdown link at caret', () => {
  assert.deepEqual(applyLink('see ', 4, 4, 'docs', 'https://x'),
    { value: 'see [docs](https://x)', selStart: 21, selEnd: 21 });
});
test('applyLink replaces a selection', () => {
  assert.deepEqual(applyLink('see here', 4, 8, 'here', 'https://x'),
    { value: 'see [here](https://x)', selStart: 21, selEnd: 21 });
});

console.log(`\n${passed} passed`);
