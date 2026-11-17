import assert from 'node:assert/strict';
import { computeArmedInsertion, slashOpensAt, slashQuery, slashItems, listShortcutAt } from '../scripts/richTextEditor.js';

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

// Slash menu (the in-page editor): where a typed `/` opens it, what has been
// typed after it, and which rows a query leaves.
const keys = items => items.map(i => i.key);

test('slash opens at the start of the text, a line, or after a space', () => {
  assert.equal(slashOpensAt('/', 0), true);
  assert.equal(slashOpensAt('one\n/', 4), true);
  assert.equal(slashOpensAt('one /', 4), true);
});

test('slash inside a word or a URL stays text', () => {
  assert.equal(slashOpensAt('and/or', 3), false);
  assert.equal(slashOpensAt('https://x', 6), false);
  assert.equal(slashOpensAt('abc', 1), false);
});

test('slash query is the text between the slash and the caret', () => {
  assert.equal(slashQuery('a /ic b', 2, 5), 'ic');
  assert.equal(slashQuery('/', 0, 1), '');
});

test('slash query ends when the caret leaves it, the slash goes, or a line breaks', () => {
  assert.equal(slashQuery('a /ic', 2, 2), null);
  assert.equal(slashQuery('a ic', 2, 4), null);
  assert.equal(slashQuery('/a\nb', 0, 4), null);
});

test('an empty query lists every insert, in order', () => {
  assert.deepEqual(keys(slashItems('')), ['icon', 'label', 'link', 'ul', 'ol', 'hr']);
});

test('a query filters by label and by other words, label prefix first', () => {
  assert.deepEqual(keys(slashItems('li')), ['link', 'ul', 'ol', 'hr']);
  assert.deepEqual(keys(slashItems('divider')), ['hr']);
  assert.deepEqual(keys(slashItems('Num')), ['ol']);
  assert.deepEqual(keys(slashItems('zzz')), []);
});

test('a one-line editor offers no block inserts', () => {
  assert.deepEqual(keys(slashItems('', { inline: true })), ['icon', 'label', 'link']);
});

test('a restricted editor offers only its own keys', () => {
  assert.deepEqual(keys(slashItems('', { inline: true, allowed: new Set(['label', 'icon', 'clear']) })), ['icon', 'label']);
});

test('a line that is already a list offers no list rows', () => {
  assert.deepEqual(keys(slashItems('', { inList: true })), ['icon', 'label', 'link', 'hr']);
});

console.log(`\n${passed} passed`);

test('listShortcutAt: `- ` / `* ` / `1. ` at a line start make a list item', () => {
  assert.deepEqual(listShortcutAt('- ', 2), { kind: 'ul', value: '- ', selStart: 2, selEnd: 2 });
  assert.deepEqual(listShortcutAt('* hello', 2), { kind: 'ul', value: '- hello', selStart: 2, selEnd: 2 });
  assert.deepEqual(listShortcutAt('1. ', 3), { kind: 'ol', value: '1. ', selStart: 3, selEnd: 3 });
  assert.deepEqual(listShortcutAt('3) ', 3), { kind: 'ol', value: '1. ', selStart: 3, selEnd: 3 });
  assert.equal(listShortcutAt('- ', 2).kind, 'ul'); // the space a contentEditable types at a line end
  assert.deepEqual(listShortcutAt('Intro\n\n- ', 9), { kind: 'ul', value: 'Intro\n\n- ', selStart: 9, selEnd: 9 });
});

test('listShortcutAt: anywhere but a line start is left as typed', () => {
  assert.equal(listShortcutAt('a - ', 4), null);
  assert.equal(listShortcutAt('-', 1), null);
  assert.equal(listShortcutAt('1.5 ', 4), null);
  assert.equal(listShortcutAt('x 1. ', 5), null);
});
