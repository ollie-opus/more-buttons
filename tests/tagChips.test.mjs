import assert from 'node:assert/strict';
import { addTag, removeTag, chipsOf, resolveRestricted } from '../scripts/tagChips.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

test('chipsOf: canonical split (trim, drop empties, case-insensitive dedupe)', () => {
  assert.deepEqual(chipsOf('System, RAMS,, system '), ['System', 'RAMS']);
  assert.deepEqual(chipsOf(''), []);
  assert.deepEqual(chipsOf(undefined), []);
});

test('addTag: appends and re-joins with ", "', () => {
  assert.equal(addTag('', 'System'), 'System');
  assert.equal(addTag('System', 'RAMS'), 'System, RAMS');
  assert.equal(addTag('System,RAMS', 'X'), 'System, RAMS, X');
});

test('addTag: trims; empty / whitespace / comma-only tag is a no-op', () => {
  assert.equal(addTag('System', '  RAMS '), 'System, RAMS');
  assert.equal(addTag('System', ''), 'System');
  assert.equal(addTag('System', '   '), 'System');
});

test('addTag: duplicate (case-insensitive) keeps the first spelling and position', () => {
  assert.equal(addTag('System, RAMS', 'system'), 'System, RAMS');
});

test('addTag: a comma inside the new tag can never smuggle two chips in', () => {
  assert.equal(addTag('A', 'B, C'), 'A, B C');
});

test('removeTag: removes case-insensitively, keeps the rest in order', () => {
  assert.equal(removeTag('System, RAMS, X', 'rams'), 'System, X');
  assert.equal(removeTag('System', 'System'), '');
  assert.equal(removeTag('System', 'Nope'), 'System');
});

test('resolveRestricted: known tag → the list spelling (case-insensitive, trimmed)', () => {
  assert.equal(resolveRestricted(['System', 'Managing OCC'], ' managing occ '), 'Managing OCC');
  assert.equal(resolveRestricted(['System'], 'System'), 'System');
});

test('resolveRestricted: unknown, blank, or not-yet-loaded list → null', () => {
  assert.equal(resolveRestricted(['System'], 'Nope'), null);
  assert.equal(resolveRestricted(['System'], '   '), null);
  assert.equal(resolveRestricted(null, 'System'), null);
  assert.equal(resolveRestricted([], 'System'), null);
});

console.log(`\n${passed} passed`);
