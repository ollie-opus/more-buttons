import assert from 'node:assert/strict';

globalThis.chrome = {
  storage: { local: { get: async () => ({ moreButtonsIntegrations: { githubPAT: 'x' } }) } },
};
const { githubFetchAndPushFile, githubFetchAndPush, githubDeleteFile, fetchFileMigratingIdentity, resolveCommitMessage } = await import('../scripts/github.js');
const { recentCommits, forgetCommits, forgetWrite } = await import('../scripts/repoClient.js');

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('  ok -', name); }

const TRAILER = 'Published via More Buttons Chrome Extension';
const FILE = 'docs/drafts/system-updates.md';
const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const envelope = (content, sha = 'sha-1') => new Response(
  JSON.stringify({ content: b64(content), sha, encoding: 'base64' }), { status: 200 });
const commitObj = { sha: 'c9', parents: [{ sha: 'p1' }], author: { name: 'Ollie', date: '2026-11-02T10:00:00Z' }, message: 'x' };
const putOk = () => new Response(JSON.stringify({ content: { sha: 'n1' }, commit: commitObj }), { status: 200 });
const delOk = () => new Response(JSON.stringify({ commit: commitObj }), { status: 200 });

let sentAll, urls;
// The media-usage index sync is a fire-and-forget background write; tests look at page writes only.
const pw = () => sentAll.filter(w => !w.url.endsWith('.media-usage.json'));
function script(getBody) {
  sentAll = []; urls = [];
  forgetWrite(FILE); forgetWrite('docs/pages/system-status.md'); forgetWrite('docs/drafts/some-guide.md');
  globalThis.fetch = async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    urls.push(`${method} ${String(url).split('?')[0]}`);
    if (method === 'PUT') { sentAll.push({ ...JSON.parse(init.body), url: String(url).split('?')[0] }); return putOk(); }
    if (method === 'DELETE') { sentAll.push({ ...JSON.parse(init.body), url: String(url).split('?')[0] }); return delOk(); }
    return envelope(getBody);
  };
}
const bump = md => md + 'more\n';

await test('default message is unchanged: "Update <label>" + trailer', async () => {
  script('# Drafts\n');
  await githubFetchAndPushFile(FILE, undefined, bump);
  assert.equal(pw()[0].message, `Update system updates\n\n${TRAILER}`);
});

await test('opts.commit as a string becomes the subject, with the trailer appended', async () => {
  script('# Drafts\n');
  await githubFetchAndPushFile(FILE, undefined, bump, { commit: 'Reordered sections' });
  assert.equal(pw()[0].message, `Reordered sections\n\n${TRAILER}`);
});

await test('opts.commit as a function sees { before, after } and may return { subject, bodyLines }', async () => {
  script('# Drafts\n');
  await githubFetchAndPushFile(FILE, undefined, bump, {
    commit: ({ before, after }) => ({ subject: `Edited ${before.length}->${after.length}`, bodyLines: ['Item: u-1'] }),
  });
  assert.equal(pw()[0].message, `Edited 9->14\n\nItem: u-1\n\n${TRAILER}`);
});

await test('the PUT response commit is remembered for the path (recentCommits), own:true', async () => {
  forgetCommits(FILE);
  script('# Drafts\n');
  await githubFetchAndPushFile(FILE, undefined, bump);
  const [c] = recentCommits(FILE);
  assert.equal(c.sha, 'c9');
  assert.equal(c.own, true);
  assert.equal(c.parentSha, 'p1');
});

await test('githubDeleteFile honours opts.commit and remembers the response commit; default is "Delete <label>"', async () => {
  forgetCommits(FILE);
  script('# Drafts\n');
  await githubDeleteFile(FILE);
  assert.equal(pw()[0].message, `Delete system updates\n\n${TRAILER}`);
  assert.equal(recentCommits(FILE)[0].sha, 'c9');
  script('# Drafts\n');
  await githubDeleteFile(FILE, undefined, { commit: ({ before, after }) => `Discard draft: ${before.trim()}|${after}|` });
  assert.equal(pw()[0].message, `Discard draft: # Drafts||\n\n${TRAILER}`);
});

await test('fetchFileMigratingIdentity writes a no-op read with no PUT, and a migrated file commits as "Updated page format"', async () => {
  script('# Title\n\n## Section One\n\nbody\n');
  await fetchFileMigratingIdentity('docs/drafts/some-guide.md');
  assert.equal(pw().length, 1);
  assert.match(pw()[0].message, /^Updated page format\n\n/);
  // A no-op build over an already-identical file never PUTs.
  script('# Plain\n');
  await githubFetchAndPushFile(FILE, undefined, md => md, { commit: 'ignored' });
  assert.equal(pw().length, 0);
});

await test('githubFetchAndPush passes opts through to the system-status file', async () => {
  script('# Status\n');
  await githubFetchAndPush(undefined, bump, { commit: 'Status tweak' });
  assert.equal(pw()[0].message, `Status tweak\n\n${TRAILER}`);
  assert.ok(urls.some(u => u.startsWith('PUT') && u.endsWith('docs/pages/system-status.md')));
});

await test('githubDeleteFile of a non-UTF-8 (binary) file succeeds with and without a commit function', async () => {
  const bin = Buffer.from([0xff, 0xfe, 0x80, 0x81, 0xc3, 0x28]).toString('base64');
  script('');
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => ((init.method || 'GET') === 'GET'
    ? new Response(JSON.stringify({ content: bin, sha: 's', encoding: 'base64' }), { status: 200 })
    : orig(url, init));
  await githubDeleteFile('docs/assets/pic.png');
  assert.equal(pw()[0].message, `Delete pic.png\n\n${TRAILER}`);
  await githubDeleteFile('docs/assets/pic.png', undefined, { commit: ({ after }) => `Gone${after}` });
  assert.equal(pw()[1].message, `Gone\n\n${TRAILER}`);
});

await test('a malformed response commit never fails an accepted write', async () => {
  script('# Drafts\n');
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => ((init.method || 'GET') === 'PUT'
    ? new Response(JSON.stringify({ content: { sha: 'n' }, commit: 'garbage' }), { status: 200 })
    : orig(url, init));
  assert.equal(await githubFetchAndPushFile(FILE, undefined, bump), '# Drafts\nmore\n');
});

await test('resolveCommitMessage: string, object, function, fallback', () => {
  const ctx = { before: 'a', after: 'b' };
  assert.equal(resolveCommitMessage(undefined, ctx, 'Update x'), `Update x\n\n${TRAILER}`);
  assert.equal(resolveCommitMessage({ subject: 'S', bodyLines: ['L'] }, ctx, 'F'), `S\n\nL\n\n${TRAILER}`);
  assert.equal(resolveCommitMessage(c => c.before + c.after, ctx, 'F'), `ab\n\n${TRAILER}`);
});

console.log(`\n${passed} passed`);
