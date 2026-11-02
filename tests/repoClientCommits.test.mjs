import assert from 'node:assert/strict';
import { normalizeWriteCommit, rememberCommit, recentCommits, reconcileCommits, forgetCommits } from '../scripts/repoClient.js';
let passed = 0; async function test(name, fn) { await fn(); passed++; console.log('  ok -', name); }
const P = 'docs/drafts/x.md';
const raw = { sha: 'c1', parents: [{ sha: 'p0' }], author: { name: 'Ollie', email: 'o@x', date: '2026-11-02T10:00:00Z' }, message: "Create draft: Onboarding\n\nPublished via More Buttons Chrome Extension" };
await test('normalizeWriteCommit: sha, parentSha, path, parsed subject/trailers, ms date, own:true, no login', () => {
  const c = normalizeWriteCommit(raw, P);
  assert.deepEqual(c, { sha: 'c1', parentSha: 'p0', path: P, subject: 'Create draft: Onboarding', body: '', trailers: {}, date: Date.parse('2026-11-02T10:00:00Z'), login: null, name: 'Ollie', own: true });
  assert.equal(normalizeWriteCommit({ ...raw, parents: [] }, P).parentSha, null);
});
await test('rememberCommit/recentCommits: per path, newest first; falsy raw ignored; reconcile drops fetched shas', () => {
  forgetCommits(P);
  rememberCommit(P, undefined);
  rememberCommit(P, raw);
  rememberCommit(P, { ...raw, sha: 'c2', author: { ...raw.author, date: '2026-11-02T10:05:00Z' } });
  assert.deepEqual(recentCommits(P).map(c => c.sha), ['c2', 'c1']);
  assert.deepEqual(recentCommits('other'), []);
  reconcileCommits(P, [{ sha: 'c1' }]);
  assert.deepEqual(recentCommits(P).map(c => c.sha), ['c2']);
});
await test('recentCommits drops entries older than the memo window', () => {
  forgetCommits(P);
  const realNow = Date.now;
  try {
    Date.now = () => 1_000_000;
    rememberCommit(P, raw);
    Date.now = () => 1_000_000 + 600001;
    assert.deepEqual(recentCommits(P), []);
  } finally { Date.now = realNow; }
});
console.log(`\n${passed} passed`);
