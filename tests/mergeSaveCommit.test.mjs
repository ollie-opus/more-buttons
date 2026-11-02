import assert from 'node:assert/strict';

globalThis.chrome = {
  storage: { local: { get: async () => ({ moreButtonsIntegrations: { githubPAT: 'x' } }) } },
};
const { mergeSave } = await import('../scripts/mergeSave.js');
const { forgetWrite } = await import('../scripts/repoClient.js');

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('  ok -', name); }

const TRAILER = 'Published via More Buttons Chrome Extension';
const FILE = 'docs/drafts/onboarding-guide.md';
const b64 = s => Buffer.from(s, 'utf8').toString('base64');
let puts;
function script() {
  puts = [];
  forgetWrite(FILE);
  globalThis.fetch = async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    if (method === 'PUT') {
      const body = JSON.parse(init.body);
      if (String(url).includes(FILE)) puts.push(body);
      return new Response(JSON.stringify({ content: { sha: 'n1' }, commit: { sha: 'c1', author: { name: 'O', date: '2026-11-02T10:00:00Z' }, message: body.message } }), { status: 200 });
    }
    return new Response(JSON.stringify({ content: b64('# Doc\n'), sha: 'sha-1', encoding: 'base64' }), { status: 200 });
  };
}

function fakeForm(snapshot, values) {
  return {
    _initialSnapshot: snapshot,
    querySelectorAll: sel => (sel.startsWith('[') ? [] : values),
    querySelector: () => null,
    hasAttribute: () => false,
  };
}
const fieldSpecs = [
  { name: 'sectionTitle', type: 'scalar', label: 'Title' },
  { name: 'sectionDescription', type: 'scalar', label: 'Description' },
];
const base = { fieldSpecs, readFresh: () => ({ sectionTitle: 'Old', sectionDescription: 'D' }), build: (md, r) => md + r.sectionTitle };
const edited = () => fakeForm(
  { sectionTitle: 'Old', sectionDescription: 'D' },
  [{ name: 'sectionTitle', type: 'text', value: 'New' }, { name: 'sectionDescription', type: 'textarea', value: 'D' }],
);

await test('mergeSave commit callback receives resolved + changedLabels and the Changed: line is appended', async () => {
  script();
  let seen;
  await mergeSave({
    ...base, formEl: edited(), file: FILE,
    commit: ctx => { seen = ctx; return `Edited section '${ctx.resolved.sectionTitle}'`; },
  });
  assert.deepEqual(seen.changedLabels, ['Title']);
  assert.equal(seen.before, '# Doc\n');
  assert.ok(seen.after.startsWith('# Doc\n') && seen.after.endsWith('New'));
  assert.equal(puts[0].message, `Edited section 'New'\n\nChanged: Title\n\n${TRAILER}`);
});

await test('mergeSave callback bodyLines come before the Changed: line', async () => {
  script();
  await mergeSave({
    ...base, formEl: edited(), file: FILE,
    commit: () => ({ subject: 'Edited', bodyLines: ['Item: u-1'] }),
  });
  assert.equal(puts[0].message, `Edited\n\nItem: u-1\nChanged: Title\n\n${TRAILER}`);
});

await test('mergeSave with a string commit and no changed fields writes no Changed: line', async () => {
  script();
  const formEl = fakeForm(
    { sectionTitle: 'Old', sectionDescription: 'D' },
    [{ name: 'sectionTitle', type: 'text', value: 'Old' }, { name: 'sectionDescription', type: 'textarea', value: 'D' }],
  );
  await mergeSave({ ...base, formEl, file: FILE, build: (md, r) => md + 'x', commit: 'Edited page settings' });
  assert.equal(puts[0].message, `Edited page settings\n\n${TRAILER}`);
});

await test('mergeSave without commit keeps the default Update <label> message', async () => {
  script();
  await mergeSave({ ...base, formEl: edited(), file: FILE });
  assert.equal(puts[0].message, `Update onboarding guide\n\n${TRAILER}`);
});

console.log(`\n${passed} passed`);
