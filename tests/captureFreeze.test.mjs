import assert from 'node:assert/strict';

// captureFreeze.js reaches the repo through github.js / repoClient.js, which
// use fetch and chrome.storage. Both are faked here: a tiny in-memory repo.
const repo = new Map(); // path -> base64 (images) or text (manifest)
const puts = [];
const MANIFEST = 'docs/assets/media/occ-captures/.captures-meta.json';
const b64 = s => Buffer.from(s).toString('base64');

globalThis.chrome = { storage: { local: { get: async () => ({ moreButtonsIntegrations: { githubPAT: 't' } }), set: async () => {} }, session: { get: async () => ({}), set: async () => {} } }, runtime: { getURL: p => p } };
globalThis.FileReader = class {
  readAsDataURL(blob) { blob.arrayBuffer().then(buf => { this.result = `data:${blob.type};base64,${Buffer.from(buf).toString('base64')}`; this.onload(); }); }
};
globalThis.fetch = async (url, init = {}) => {
  const path = decodeURIComponent(String(url).split('/contents/')[1]?.split('?')[0] ?? '');
  if ((init.method ?? 'GET') === 'PUT') {
    const body = JSON.parse(init.body);
    repo.set(path, path === MANIFEST ? Buffer.from(body.content, 'base64').toString() : body.content);
    puts.push(path);
    return new Response(JSON.stringify({ content: { sha: 's' }, commit: { sha: 'c' } }), { status: 201 });
  }
  if (!repo.has(path)) return new Response('{}', { status: 404 });
  const accept = init.headers?.Accept ?? init.headers?.accept ?? '';
  if (accept.includes('raw')) {
    return new Response(path === MANIFEST ? repo.get(path) : Buffer.from(repo.get(path), 'base64'), { status: 200, headers: { 'content-type': 'image/png' } });
  }
  const content = path === MANIFEST ? b64(repo.get(path)) : repo.get(path);
  return new Response(JSON.stringify({ sha: 's', content, encoding: 'base64' }), { status: 200 });
};

const { needsFreezing, freezeCapturePick } = await import('../scripts/captureFreeze.js');

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('  ok -', name); }

const OCC = { light: 'docs/assets/media/occ-captures/sites/list-light-mode.png', dark: 'docs/assets/media/occ-captures/sites/list-dark-mode.png' };
const FROZEN = { light: 'docs/assets/media/system-update-captures/list-ab12cd34-light-mode.png', dark: 'docs/assets/media/system-update-captures/list-ab12cd34-dark-mode.png' };

await test('only picks outside the frozen folder need copying', () => {
  assert.equal(needsFreezing(OCC), true);
  assert.equal(needsFreezing(FROZEN), false);
  assert.equal(needsFreezing({ single: 'docs/assets/media/images/x.png' }), false);
  assert.equal(needsFreezing(null), false);
});

await test('a frozen pick is used as it is: nothing is read or pushed', async () => {
  assert.equal(await freezeCapturePick(FROZEN), FROZEN);
  assert.deepEqual(puts, []);
});

await test('a library pick is copied, bytes and manifest entry, under a fresh id', async () => {
  repo.set(OCC.light, b64('LIGHT'));
  repo.set(OCC.dark, b64('DARK'));
  repo.set(MANIFEST, JSON.stringify({ [OCC.light]: { resized: true, padding: 12, annotated: true, zapped: false } }));
  const out = await freezeCapturePick(OCC);
  assert.match(out.light, /^docs\/assets\/media\/system-update-captures\/list-[0-9a-f]{8}-light-mode\.png$/);
  assert.equal(out.dark, out.light.replace('-light-mode', '-dark-mode'));
  assert.equal(repo.get(out.light), b64('LIGHT'));
  assert.equal(repo.get(out.dark), b64('DARK'));
  const manifest = JSON.parse(repo.get(MANIFEST));
  assert.equal(manifest[out.light].resized, true);
  assert.equal(manifest[out.light].padding, 12);
  assert.equal(manifest[out.light].annotated, true);
  assert.ok(manifest[OCC.light], 'the original entry is untouched');
  // The originals are still there, and a second pick makes a second copy.
  assert.equal(repo.get(OCC.light), b64('LIGHT'));
  assert.notEqual((await freezeCapturePick(OCC)).light, out.light);
});

console.log(`captureFreeze: ${passed} passed`);
