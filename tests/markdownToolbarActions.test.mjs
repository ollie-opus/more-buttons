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
