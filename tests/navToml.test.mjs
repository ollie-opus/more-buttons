import assert from 'node:assert/strict';
import { slugify, titleCaseSegment } from '../scripts/navToml.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

test('slugify lowercases and hyphenates spaces', () => {
  assert.equal(slugify('Registering an employee'), 'registering-an-employee');
});
test('slugify strips punctuation and collapses hyphens', () => {
  assert.equal(slugify('  Hello,  World! __ Test '), 'hello-world-test');
});
test('slugify returns empty for symbol-only input', () => {
  assert.equal(slugify('!!!'), '');
});
test('titleCaseSegment title-cases hyphenated segment', () => {
  assert.equal(titleCaseSegment('annual-reports'), 'Annual Reports');
});
test('titleCaseSegment handles single word', () => {
  assert.equal(titleCaseSegment('employees'), 'Employees');
});

console.log(`\n${passed} passed`);
