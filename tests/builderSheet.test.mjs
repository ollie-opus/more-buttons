import assert from 'node:assert/strict';
import { parseClipboardTsv, parseMulti, formatMulti } from '../scripts/builderSheet.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const TYPES = ['Cleaning & Environmental Services', 'Grounds, Landscaping & Tree Services', 'Mechanical & Electrical', '+Gas Works'];

test('parseClipboardTsv splits rows and cells and drops one trailing newline', () => {
  assert.deepEqual(parseClipboardTsv('a\tb\r\nc\td\n'), [['a', 'b'], ['c', 'd']]);
});

test('a quoted cell keeps its line breaks and doubled quotes', () => {
  assert.deepEqual(parseClipboardTsv('x\t"line 1\nline ""2"""\ty\nz'), [['x', 'line 1\nline "2"', 'y'], ['z']]);
});

test('a cell that merely starts with a quote is left as it is', () => {
  assert.deepEqual(parseClipboardTsv('"Grounds, Landscaping", +Gas Works\tb'), [['"Grounds, Landscaping", +Gas Works', 'b']]);
  assert.deepEqual(parseClipboardTsv('"unclosed\tb'), [['"unclosed', 'b']]);
});

test('parseMulti reads comma separated answers', () => {
  assert.deepEqual(parseMulti('Mechanical & Electrical, +Gas Works', TYPES), { items: ['Mechanical & Electrical', '+Gas Works'], bad: [] });
});

test('a quoted answer may contain a comma', () => {
  assert.deepEqual(parseMulti('"Grounds, Landscaping & Tree Services", +Gas Works', TYPES), { items: ['Grounds, Landscaping & Tree Services', '+Gas Works'], bad: [] });
});

test('an unquoted answer with a comma is recognised when its pieces join into one choice', () => {
  assert.deepEqual(parseMulti('+Gas Works, Grounds, Landscaping & Tree Services', TYPES), { items: ['+Gas Works', 'Grounds, Landscaping & Tree Services'], bad: [] });
});

test('a cell that is exactly one choice is that choice', () => {
  assert.deepEqual(parseMulti('Grounds, Landscaping & Tree Services', TYPES), { items: ['Grounds, Landscaping & Tree Services'], bad: [] });
});

test('spaces around commas do not count, but capitals do', () => {
  assert.deepEqual(parseMulti('  +Gas Works ,Mechanical & Electrical  ', TYPES), { items: ['+Gas Works', 'Mechanical & Electrical'], bad: [] });
  assert.deepEqual(parseMulti('+gas works', TYPES), { items: [], bad: ['+gas works'] });
});

test('unknown answers are reported, repeats dropped, empty pieces ignored', () => {
  assert.deepEqual(parseMulti('+Gas Works, Scafolding, , +Gas Works', TYPES), { items: ['+Gas Works'], bad: ['Scafolding'] });
});

test('formatMulti quotes answers that contain a comma or a quote', () => {
  assert.equal(formatMulti(['Grounds, Landscaping & Tree Services', '+Gas Works']), '"Grounds, Landscaping & Tree Services", +Gas Works');
  assert.equal(formatMulti(['Say "hi"']), '"Say ""hi"""');
  assert.equal(formatMulti([]), '');
});

test('formatMulti output parses back to the same answers', () => {
  const picked = ['Grounds, Landscaping & Tree Services', 'Cleaning & Environmental Services'];
  assert.deepEqual(parseMulti(formatMulti(picked), TYPES).items, picked);
});

console.log(`\n${passed} passed`);
