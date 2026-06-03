import assert from 'node:assert/strict';
import { computeArmedInsertion } from '../scripts/richTextEditor.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// computeArmedInsertion(value, caret, data, addMarkers[], offMarkers:Set)
// -> { value, selStart, selEnd } for inserting `data` at a collapsed caret with
// the armed format applied: addMarkers wrap the text; offMarkers move the
// insertion past the closing delimiter of any enclosing mark (escape).

test('arm-on bold into empty source', () => {
  assert.deepEqual(computeArmedInsertion('', 0, 't', ['**'], new Set()),
    { value: '**t**', selStart: 3, selEnd: 3 });
});
test('arm-on stacked bold+italic wraps outermost-first', () => {
  assert.deepEqual(computeArmedInsertion('', 0, 'x', ['**', '*'], new Set()),
    { value: '***x***', selStart: 4, selEnd: 4 });
});
test('arm-off bold at end of bold escapes past the closing delimiter', () => {
  // '**test**', caret at 6 (between 'test' and the closing '**'), typing 'a'
  // with bold armed-off -> insert after the close: '**test**a'
  assert.deepEqual(computeArmedInsertion('**test**', 6, 'a', [], new Set(['**'])),
    { value: '**test**a', selStart: 9, selEnd: 9 });
});
test('arm-off mid-bold still escapes past the close', () => {
  // caret at 4 (after 'te', inside bold), escape bold -> lands after close (8)
  assert.deepEqual(computeArmedInsertion('**test**', 4, 'a', [], new Set(['**'])),
    { value: '**test**a', selStart: 9, selEnd: 9 });
});
test('arm-off with no enclosing mark is a plain insert', () => {
  assert.deepEqual(computeArmedInsertion('hello', 2, 'a', [], new Set(['**'])),
    { value: 'heallo', selStart: 3, selEnd: 3 });
});
test('arm-off only escapes the named marker, not a different enclosing one', () => {
  // inside italic only; arming-off bold should not move the caret
  assert.deepEqual(computeArmedInsertion('*hi*', 1, 'a', [], new Set(['**'])),
    { value: '*ahi*', selStart: 2, selEnd: 2 });
});

console.log(`\n${passed} passed`);
