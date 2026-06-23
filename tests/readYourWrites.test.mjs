import assert from 'node:assert/strict';
import { rememberWrite, forgetWrite, reconcileRead } from '../scripts/repoClient.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const P = 'docs/drafts/x.md';

test('no memo → fresh values pass through untouched', () => {
  forgetWrite(P);
  assert.deepEqual(reconcileRead(P, 'fresh', 'sha-f'), { content: 'fresh', sha: 'sha-f' });
});

test('GitHub still stale → serve the remembered write (+ its sha)', () => {
  rememberWrite(P, 'written', 'sha-w');
  // GitHub replica returns the PRE-write body — we must serve what we wrote.
  assert.deepEqual(reconcileRead(P, 'old-stale', 'sha-old'), { content: 'written', sha: 'sha-w' });
});

test('memo keeps serving across repeated stale reads (not single-shot)', () => {
  rememberWrite(P, 'written', 'sha-w');
  reconcileRead(P, 'old-stale', 'sha-old');
  assert.deepEqual(reconcileRead(P, 'old-stale', 'sha-old'), { content: 'written', sha: 'sha-w' });
});

test('GitHub caught up (fresh matches memo) → return fresh and self-clear', () => {
  rememberWrite(P, 'written', 'sha-w');
  assert.deepEqual(reconcileRead(P, 'written', 'sha-new'), { content: 'written', sha: 'sha-new' });
  // memo cleared → a later differing read is trusted (no longer masked)
  assert.deepEqual(reconcileRead(P, 'changed', 'sha-c'), { content: 'changed', sha: 'sha-c' });
});

test('forgetWrite drops the memo (used on 409 / file delete reconciliation)', () => {
  rememberWrite(P, 'written', 'sha-w');
  forgetWrite(P);
  assert.deepEqual(reconcileRead(P, 'fresh', 'sha-f'), { content: 'fresh', sha: 'sha-f' });
});

test('a delete remembered as empty serves "" while GitHub still lists the file', () => {
  rememberWrite(P, ''); // file deleted
  assert.equal(reconcileRead(P, 'still-here-on-replica').content, '');
});

console.log(`\n${passed} passed`);
