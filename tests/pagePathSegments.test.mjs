import assert from 'node:assert/strict';
import { normalizedPagePathSegments } from '../scripts/captureElement.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// The helper backs BOTH the capture filename derivation and the media
// library's "Filter to current page" toggle — the two must agree, so these
// tests pin the normalization contract.

test('plain segments are lowercased and slugified', () => {
  assert.deepEqual(
    normalizedPagePathSegments('/Admin/Knowledge Base/todos'),
    ['admin', 'knowledge-base', 'todos']);
});

test('UUID segments collapse to "uuid"', () => {
  assert.deepEqual(
    normalizedPagePathSegments('/sites/3ee255f7-1234-4abc-9def-0123456789ab/todos'),
    ['sites', 'uuid', 'todos']);
});

test('opaque token segments collapse to "id"', () => {
  assert.deepEqual(
    normalizedPagePathSegments('/share/pLFhQgoc8NxyiYiRdGLShEMf'),
    ['share', 'id']);
});

test('empty and slash-only paths yield no segments', () => {
  assert.deepEqual(normalizedPagePathSegments('/'), []);
  assert.deepEqual(normalizedPagePathSegments(''), []);
});

test('segments that slugify to nothing are dropped', () => {
  assert.deepEqual(normalizedPagePathSegments('/admin/%%%/todos'), ['admin', 'todos']);
});

console.log(`${passed} passed`);
