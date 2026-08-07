import assert from 'node:assert/strict';
import { searchMatches } from '../scripts/kbTree.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// --- plain (no-slash) queries: leaf-label substring, unchanged behavior ---

test('plain query matches leaf label substring, case-insensitive', () => {
  assert.equal(searchMatches(['Sites', 'Edit Page'], 'edit'), true);
  assert.equal(searchMatches(['Sites', 'Edit Page'], 'PAGE'), true);
  assert.equal(searchMatches(['Sites', 'Edit Page'], 'todo'), false);
});

test('plain query does not match folder names', () => {
  assert.equal(searchMatches(['Sites', 'Edit Page'], 'sites'), false);
});

test('empty query matches everything', () => {
  assert.equal(searchMatches(['Sites', 'Edit Page'], ''), true);
  assert.equal(searchMatches(['Sites', 'Edit Page'], '   '), true);
});

// --- path (slash) queries: root-anchored prefix ---

test('directory query matches files under that directory', () => {
  assert.equal(searchMatches(['sites', 'uuid', 'todos', 'edit', 'page'], 'sites/uuid/todos'), true);
  assert.equal(searchMatches(['sites', 'uuid', 'todos', 'index'], 'sites/uuid/todos'), true);
});

test('directory query is anchored at the root', () => {
  assert.equal(searchMatches(['admin', 'sites', 'uuid', 'todos', 'x'], 'sites/uuid/todos'), false);
});

test('partial trailing segment matches', () => {
  assert.equal(searchMatches(['sites', 'uuid', 'todos'], 'sites/uu'), true);
  assert.equal(searchMatches(['sites', 'other'], 'sites/uu'), false);
});

test('leading and trailing slashes are tolerated', () => {
  assert.equal(searchMatches(['sites', 'uuid', 'todos'], 'sites/uuid/'), true);
  assert.equal(searchMatches(['sites', 'uuid', 'todos'], '/sites/uuid'), true);
});

test('humanized labels match typed slugs (spaces fold to hyphens)', () => {
  assert.equal(searchMatches(['Occ captures', 'Shot 1'], 'occ-captures/shot'), true);
  assert.equal(searchMatches(['Occ captures', 'Shot 1'], 'OCC-Captures/Shot-1'), true);
  assert.equal(searchMatches(['Occ captures', 'Shot 1'], 'occ captures/shot'), true);
});

test('deeper query than the path does not match', () => {
  assert.equal(searchMatches(['sites', 'uuid'], 'sites/uuid/todos'), false);
});

console.log(`kbTreeSearch: ${passed} passed`);
