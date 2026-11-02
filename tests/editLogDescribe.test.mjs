import assert from 'node:assert/strict';
import { componentKindLabel, uuidLineIndex, sectionTitleAt, enclosingUpdate, containerPhrase, componentCommit, reorderCommit, itemCommit, sectionParentTitle, isReorderOnly, UPDATE_BLOCK_TYPES_RE } from '../scripts/editLogDescribe.js';
let passed = 0; async function test(name, fn) { await fn(); passed++; console.log('  ok -', name); }

await test('componentKindLabel: every kind, with and without a title', () => {
  assert.equal(componentKindLabel({ kind: 'admonition', adm: { type: 'note', title: 'Before you start' } }), "Note admonition 'Before you start'");
  assert.equal(componentKindLabel({ kind: 'admonition', adm: { type: 'step', title: '' } }), 'Step admonition');
  assert.equal(componentKindLabel({ kind: 'admonition', adm: { type: 'note', title: 'Hi<span class="meta">(optional)</span>' } }), "Note admonition 'Hi'");
  assert.equal(componentKindLabel({ kind: 'codeblock', cb: { title: 'install.sh', language: 'bash' } }), "Code block 'install.sh'");
  assert.equal(componentKindLabel({ kind: 'codeblock', cb: { title: '', language: 'bash' } }), 'Code block');
  assert.equal(componentKindLabel({ kind: 'capture', cap: { lightFilename: 'login-screen-light-mode.png' } }), "Capture 'login-screen'");
  assert.equal(componentKindLabel({ kind: 'video', vid: { lightFilename: 'tour-light-mode.webm' } }), "Video 'tour'");
  assert.equal(componentKindLabel({ kind: 'image', img: { filename: 'logo.png' } }), "Image 'logo'");
  assert.equal(componentKindLabel({ kind: 'button', btn: { label: 'Get started' } }), "Button 'Get started'");
  assert.equal(componentKindLabel({ kind: 'button', btn: { label: '' } }), 'Button');
  assert.equal(componentKindLabel({ kind: 'navlinks', nav: {} }), 'Nav links');
  assert.equal(componentKindLabel({ kind: 'diagram', dia: {} }), 'Diagram');
  assert.equal(componentKindLabel({ kind: 'table', tbl: {} }), 'Data table');
  assert.equal(componentKindLabel({ kind: 'grid', grid: {} }), 'Grid');
  assert.equal(componentKindLabel({ kind: 'tabs', grp: {} }), 'Content tabs');
});
await test('componentKindLabel: null-safe', () => {
  assert.equal(componentKindLabel(null), 'Component');
  assert.equal(componentKindLabel({ kind: 'admonition' }), 'Component');
  assert.equal(componentKindLabel({ kind: 'mystery' }), 'Component');
});

const GUIDE = '# Guide\n<span data-uuid="h1" style="display:none"></span>\n\n## Setup\n<span data-uuid="s1" style="display:none"></span>\n\n!!! note "Hi"\n    <span data-uuid="a1" style="display:none"></span>\n\n    text\n\n### Deeper\n<span data-uuid="s2" style="display:none"></span>\n\n<span data-uuid="c1" style="display:none"></span>\n```bash\nls\n```\n';
await test('sectionTitleAt: innermost section; componentCommit phrases for guides carry no Item trailer', () => {
  assert.equal(uuidLineIndex(GUIDE, 'a1'), 7);
  assert.equal(uuidLineIndex(GUIDE, 'nope'), -1);
  assert.equal(sectionTitleAt(GUIDE, 'a1'), 'Setup');
  assert.equal(sectionTitleAt(GUIDE, 'c1'), 'Deeper');
  assert.equal(sectionTitleAt(GUIDE, 'nope'), '');
  assert.deepEqual(componentCommit('Edited', "Note admonition 'Hi'", GUIDE, 'a1'), { subject: "Edited Note admonition 'Hi' in 'Setup'", bodyLines: [] });
  assert.deepEqual(componentCommit('Moved', 'Code block', GUIDE, 'c1'), { subject: "Moved Code block to 'Deeper'", bodyLines: [] });
  assert.deepEqual(reorderCommit(GUIDE, 's1'), { subject: "Reordered components in 'Setup'", bodyLines: [] });
  assert.equal(sectionParentTitle(GUIDE, 's1'), 'Setup');
  assert.equal(sectionParentTitle(GUIDE, ''), 'Guide');
  assert.equal(sectionParentTitle(GUIDE, null), 'Guide');
});
await test('section miss omits the container clause', () => {
  assert.equal(containerPhrase(GUIDE, 'nope'), '');
  assert.deepEqual(componentCommit('Added', 'Diagram', GUIDE, 'nope'), { subject: 'Added Diagram', bodyLines: [] });
  assert.equal(sectionParentTitle(GUIDE, 'nope'), '');
  assert.equal(sectionParentTitle('', ''), '');
  assert.equal(sectionTitleAt(null, 'a1'), '');
});

const UPDATES = '# System updates\n\n## 2026\n\n### November 2026\n\n??? feature-release "Feature release: Checklist improvements<span class="meta">2nd November 2026</span>"\n    <span data-uuid="up1" style="display:none"></span>\n\n    Intro\n\n    !!! note "Tip"\n        <span data-uuid="n1" style="display:none"></span>\n\n        text\n';
await test('enclosingUpdate / componentCommit inside a system update: "in update" phrase + Item trailer; itemCommit helper', () => {
  assert.ok(UPDATE_BLOCK_TYPES_RE.test('improvement'));
  assert.deepEqual(enclosingUpdate(UPDATES, 'n1'), { uuid: 'up1', title: 'Checklist improvements' });
  assert.deepEqual(enclosingUpdate(UPDATES, 'up1'), { uuid: 'up1', title: 'Checklist improvements' });
  assert.deepEqual(componentCommit('Added', "Note admonition 'Tip'", UPDATES, 'n1'), { subject: "Added Note admonition 'Tip' in update 'Checklist improvements'", bodyLines: ['Item: up1'] });
  assert.deepEqual(reorderCommit(UPDATES, 'up1'), { subject: "Reordered components in update 'Checklist improvements'", bodyLines: ['Item: up1'] });
  assert.deepEqual(itemCommit("Edited update 'X'", 'up1'), { subject: "Edited update 'X'", bodyLines: ['Item: up1'] });
  assert.equal(enclosingUpdate(GUIDE, 'a1'), null);
  assert.equal(enclosingUpdate(UPDATES, 'nope'), null);
  assert.equal(enclosingUpdate(null, 'n1'), null);
});
await test('isReorderOnly', () => {
  assert.equal(isReorderOnly(['Component order']), true);
  assert.equal(isReorderOnly(['Component order', 'Title']), false);
  assert.equal(isReorderOnly([]), false);
  assert.equal(isReorderOnly(undefined), false);
});
console.log(`${passed} passed`);
