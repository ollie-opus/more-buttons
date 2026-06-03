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
