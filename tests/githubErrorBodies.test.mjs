import assert from 'node:assert/strict';

// github.js reads the PAT via chrome.storage at call time; a minimal stub is
// enough. fetch is swapped per test to script the contents-API responses.
globalThis.chrome = {
  storage: { local: { get: async () => ({ moreButtonsIntegrations: { githubPAT: 'x' } }) } },
};
const { githubFetchAndPushFile } = await import('../scripts/github.js');

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('  ok -', name); }

const FILE = 'docs/drafts/system-updates.md';
const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const envelope = (content, sha = 'sha-1') => new Response(
  JSON.stringify({ content: b64(content), sha, encoding: 'base64' }),
  { status: 200, headers: { 'Content-Type': 'application/json' } },
);

// Scripted fetch: GET → envelope, PUT → the response under test.
function scriptFetch(getRes, putRes) {
  globalThis.fetch = async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    return method === 'PUT' ? putRes() : getRes();
  };
}

const bump = md => md + '\nmore\n';

// ── The bug: a non-JSON error body surfaces as a JSON parse error ─────────────

await test('PUT 502 with an EMPTY body reports the HTTP status, not a json() parse error', async () => {
  scriptFetch(() => envelope('# Drafts\n'), () => new Response('', { status: 502 }));
  await assert.rejects(
    () => githubFetchAndPushFile(FILE, undefined, bump),
    err => {
      assert.doesNotMatch(err.message, /Unexpected end of JSON input/);
      assert.doesNotMatch(err.message, /Failed to execute 'json'/);
      assert.match(err.message, /502/);
      return true;
    },
  );
});

await test('PUT 503 with an HTML body reports the HTTP status, not a json() parse error', async () => {
  scriptFetch(() => envelope('# Drafts\n'), () => new Response('<!DOCTYPE html><h1>Unicorn</h1>', { status: 503 }));
  await assert.rejects(
    () => githubFetchAndPushFile(FILE, undefined, bump),
    err => {
      assert.doesNotMatch(err.message, /Unexpected token/);
      assert.match(err.message, /503/);
      return true;
    },
  );
});

// ── Existing behaviour kept: GitHub's JSON message is still surfaced ──────────

await test('PUT 422 with a JSON body still surfaces GitHub\'s message (and the status)', async () => {
  scriptFetch(
    () => envelope('# Drafts\n'),
    () => new Response(JSON.stringify({ message: 'Invalid request.\n\n"sha" wasn\'t supplied.' }), { status: 422 }),
  );
  await assert.rejects(
    () => githubFetchAndPushFile(FILE, undefined, bump),
    err => {
      assert.match(err.message, /"sha" wasn't supplied/);
      assert.match(err.message, /422/);
      return true;
    },
  );
});

// ── The GET side: a 200 whose body is not the JSON envelope ───────────────────

await test('GET 200 with an empty body reports a readable error with the status', async () => {
  scriptFetch(() => new Response('', { status: 200 }), () => { throw new Error('PUT must not run'); });
  await assert.rejects(
    () => githubFetchAndPushFile(FILE, undefined, bump),
    err => {
      assert.doesNotMatch(err.message, /Unexpected end of JSON input/);
      assert.match(err.message, /200/);
      return true;
    },
  );
});

// ── Happy path unchanged ──────────────────────────────────────────────────────

await test('PUT 200 with the normal JSON envelope resolves to the pushed markdown', async () => {
  scriptFetch(
    () => envelope('# Drafts\n'),
    () => new Response(JSON.stringify({ content: { sha: 'sha-2' } }), { status: 200 }),
  );
  const out = await githubFetchAndPushFile(FILE, undefined, bump);
  assert.equal(out, '# Drafts\n\nmore\n');
});

console.log(`\n${passed} passed`);
