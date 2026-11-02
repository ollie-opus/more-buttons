import assert from 'node:assert/strict';
import { normalizeWriteCommit, rememberCommit, recentCommits, reconcileCommits, forgetCommits, normalizeListCommit, listCommits, readRepoText, rememberWrite, currentGithubLogin, GITHUB_LOGIN_KEY, COMMITS_PAGE_SIZE } from '../scripts/repoClient.js';
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
// ── Task 3: reads ──
function installChrome(store) {
  globalThis.chrome = { storage: { local: {
    get: async (keys) => { const ks = Array.isArray(keys) ? keys : [keys]; const o = {}; for (const k of ks) if (k in store) o[k] = store[k]; return o; },
    set: async (o) => { Object.assign(store, o); },
  } } };
}
function installFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, opts) => { calls.push({ url: String(url), opts }); return handler(String(url), opts); };
  return calls;
}
const jsonRes = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

await test('normalizeListCommit: login from author, author:null falls back to commit.author.name', () => {
  const lraw = { sha: 'a1', parents: [{ sha: 'a0' }], author: null, commit: { author: { name: 'CLI Bot', date: '2026-11-01T09:00:00Z' }, message: 'fix typo' } };
  const c = normalizeListCommit(lraw, P);
  assert.equal(c.login, null); assert.equal(c.name, 'CLI Bot'); assert.equal(c.own, false); assert.equal(c.subject, 'fix typo');
  assert.equal(c.sha, 'a1'); assert.equal(c.parentSha, 'a0'); assert.equal(c.path, P);
  assert.equal(c.date, Date.parse('2026-11-01T09:00:00Z'));
  assert.equal(normalizeListCommit({ ...lraw, author: { login: 'ollie-opus' } }, P).login, 'ollie-opus');
  assert.equal(normalizeListCommit({ ...lraw, parents: [] }, P).parentSha, null);
});
await test('listCommits: builds URL, normalises, reconciles memo, 404/409 -> [], 500 rejects', async () => {
  installChrome({ moreButtonsIntegrations: { githubPAT: 'tok' } });
  assert.equal(COMMITS_PAGE_SIZE, 30);
  const lraw = { sha: 'a1', parents: [{ sha: 'a0' }], author: { login: 'ollie-opus' }, commit: { author: { name: 'Ollie', date: '2026-11-01T09:00:00Z' }, message: 'Edit draft\n\nChanged: text' } };
  const calls = installFetch(() => jsonRes(200, [lraw]));
  forgetCommits(P);
  rememberCommit(P, { ...raw, sha: 'a1' });
  rememberCommit(P, { ...raw, sha: 'keep' });
  const out = await listCommits(P, { page: 2 });
  assert.equal(out.length, 1); assert.equal(out[0].sha, 'a1'); assert.equal(out[0].login, 'ollie-opus'); assert.equal(out[0].trailers.changed, 'text');
  assert.ok(calls[0].url.includes('/commits?sha=main&path=docs%2Fdrafts%2Fx.md&per_page=30&page=2'), calls[0].url);
  assert.ok(calls[0].url.includes('&_cb='));
  assert.equal(calls[0].opts.headers.Accept, 'application/vnd.github+json');
  assert.equal(calls[0].opts.headers.Authorization, 'token tok');
  assert.equal(calls[0].opts.cache, 'no-store');
  assert.deepEqual(recentCommits(P).map(c => c.sha), ['keep']);
  installFetch(() => jsonRes(404, {})); assert.deepEqual(await listCommits(P), []);
  installFetch(() => jsonRes(409, {})); assert.deepEqual(await listCommits(P), []);
  installFetch(() => jsonRes(200, [])); assert.deepEqual(await listCommits(P), []);
  installFetch(() => jsonRes(500, {}));
  await assert.rejects(() => listCommits(P), /500/);
  forgetCommits(P);
});
await test('readRepoText with ref hits ?ref=<sha> and skips the write memo; no ref still uses memo', async () => {
  installChrome({ moreButtonsIntegrations: { githubPAT: 'tok' } });
  rememberWrite(P, 'memo');
  const calls = installFetch((url) => url.includes('ref=abc') ? jsonRes(200, 'at-sha') : jsonRes(404, ''));
  assert.equal(await readRepoText(P, { ref: 'abc' }), 'at-sha');
  assert.ok(calls[0].url.includes('?ref=abc&_cb='), calls[0].url);
  assert.equal(await readRepoText(P, { ref: 'zzz' }), '');
  // memo untouched by ref reads: a plain 404 read still reconciles to the memo
  assert.equal(await readRepoText(P), 'memo');
  assert.ok(calls[2].url.includes('?ref=main&'));
});
await test('currentGithubLogin: cache hit by token tail; miss fetches /user and stores; failure -> null, nothing stored', async () => {
  const pat = 'ghp_abcdefghijkl12345678';
  const store = { moreButtonsIntegrations: { githubPAT: pat }, [GITHUB_LOGIN_KEY]: { login: 'cached', tokenTail: pat.slice(-8) } };
  installChrome(store);
  let calls = installFetch(() => jsonRes(200, { login: 'fresh' }));
  assert.equal(await currentGithubLogin(), 'cached'); assert.equal(calls.length, 0);
  // PAT changed -> cache invalid -> refetch and store
  store.moreButtonsIntegrations = { githubPAT: 'ghp_other_token_zzzzzzzz' };
  assert.equal(await currentGithubLogin(), 'fresh');
  assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://api.github.com/user');
  assert.equal(calls[0].opts.headers.Authorization, 'token ghp_other_token_zzzzzzzz');
  assert.deepEqual(store[GITHUB_LOGIN_KEY], { login: 'fresh', tokenTail: 'zzzzzzzz' });
  // failure paths: nothing stored, null
  for (const handler of [() => jsonRes(401, {}), () => { throw new Error('net'); }, () => jsonRes(200, {})]) {
    const s2 = { moreButtonsIntegrations: { githubPAT: 'tok12345678' } };
    installChrome(s2); installFetch(handler);
    assert.equal(await currentGithubLogin(), null);
    assert.ok(!(GITHUB_LOGIN_KEY in s2));
  }
  // no PAT
  const s3 = {}; installChrome(s3); calls = installFetch(() => jsonRes(200, { login: 'x' }));
  assert.equal(await currentGithubLogin(), null); assert.equal(calls.length, 0); assert.ok(!(GITHUB_LOGIN_KEY in s3));
});
console.log(`\n${passed} passed`);
