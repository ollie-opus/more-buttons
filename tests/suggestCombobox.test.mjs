import assert from 'node:assert/strict';
import { splitLastSegment, completeLastSegment, rankSuggestions } from '../scripts/suggestCombobox.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// ── splitLastSegment ───────────────────────────────────────────────────────────

test('split: empty value → empty head and tail', () => {
  assert.deepEqual(splitLastSegment(''), { head: '', tail: '' });
});

test('split: no comma → whole value is the tail', () => {
  assert.deepEqual(splitLastSegment('Sys'), { head: '', tail: 'Sys' });
  assert.deepEqual(splitLastSegment('  Sys '), { head: '', tail: 'Sys' });
});

test('split: head keeps the comma, tail is trimmed', () => {
  assert.deepEqual(splitLastSegment('System, Con'), { head: 'System,', tail: 'Con' });
  assert.deepEqual(splitLastSegment('System,Con'), { head: 'System,', tail: 'Con' });
});

test('split: trailing comma → empty tail', () => {
  assert.deepEqual(splitLastSegment('System,'), { head: 'System,', tail: '' });
  assert.deepEqual(splitLastSegment('System, '), { head: 'System,', tail: '' });
});

test('split: only the LAST comma splits', () => {
  assert.deepEqual(splitLastSegment('a, b, C'), { head: 'a, b,', tail: 'C' });
});

// ── completeLastSegment ────────────────────────────────────────────────────────

test('complete: no comma → item replaces the whole value', () => {
  assert.equal(completeLastSegment('Con', 'Contractors'), 'Contractors');
  assert.equal(completeLastSegment('', 'Contractors'), 'Contractors');
});

test('complete: replaces only the last segment', () => {
  assert.equal(completeLastSegment('System, Con', 'Contractors'), 'System, Contractors');
});

test('complete: normalizes only the last separator to ", "', () => {
  assert.equal(completeLastSegment('System,Con', 'Contractors'), 'System, Contractors');
});

test('complete: earlier segments preserved verbatim', () => {
  assert.equal(completeLastSegment('a ,b, C', 'Cats'), 'a ,b, Cats');
});

test('complete: works from a trailing comma (empty query)', () => {
  assert.equal(completeLastSegment('System, ', 'Contractors'), 'System, Contractors');
  assert.equal(completeLastSegment('System,', 'Contractors'), 'System, Contractors');
});

// ── rankSuggestions ────────────────────────────────────────────────────────────

test('rank: prefix matches outrank substring matches, item order kept within each tier', () => {
  assert.deepEqual(rankSuggestions(['Systems', 'RAMS', 'System', 'Overview'], 'sys'), ['Systems', 'System']);
  assert.deepEqual(rankSuggestions(['RAMS', 'Systems', 'Access'], 's'), ['Systems', 'RAMS', 'Access']);
});

test('rank: empty query lists everything', () => {
  assert.deepEqual(rankSuggestions(['B', 'A'], ''), ['B', 'A']);
  assert.deepEqual(rankSuggestions(['B', 'A'], '   '), ['B', 'A']);
});

test('rank: taken items are excluded case-insensitively', () => {
  assert.deepEqual(rankSuggestions(['System', 'RAMS', 'Overview'], '', ['system', ' rams ']), ['Overview']);
  assert.deepEqual(rankSuggestions(['System'], 'sys', ['SYSTEM']), []);
});

test('rank: no items → empty', () => {
  assert.deepEqual(rankSuggestions([], 'x'), []);
  assert.deepEqual(rankSuggestions(null, 'x'), []);
});

console.log(`\n${passed} passed`);
