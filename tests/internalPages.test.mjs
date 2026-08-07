import assert from 'node:assert/strict';
import {
  navValueToHref,
  isInternalHrefShape,
  buildInternalTreeNodes,
  resolveInternalHref,
} from '../scripts/internalPages.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// --- navValueToHref ---

test('navValueToHref maps pages/ value to bare filename', () => {
  assert.equal(navValueToHref('pages/adding-an-asset.md'), 'adding-an-asset.md');
});
test('navValueToHref maps Home to ../index.md (docs/index.md is one level up)', () => {
  assert.equal(navValueToHref('index.md'), '../index.md');
});
test('navValueToHref maps drafts/ value to bare filename', () => {
  assert.equal(navValueToHref('drafts/upcoming.md'), 'upcoming.md');
});

// --- isInternalHrefShape ---

test('isInternalHrefShape accepts bare .md filenames', () => {
  assert.equal(isInternalHrefShape('foo.md'), true);
});
test('isInternalHrefShape accepts pages/ and relative spellings', () => {
  assert.equal(isInternalHrefShape('pages/foo.md'), true);
  assert.equal(isInternalHrefShape('./foo.md'), true);
  assert.equal(isInternalHrefShape('../index.md'), true);
});
test('isInternalHrefShape rejects absolute URLs even ending .md', () => {
  assert.equal(isInternalHrefShape('https://x.com/a.md'), false);
});
test('isInternalHrefShape rejects anchors, root paths, mailto, non-.md', () => {
  assert.equal(isInternalHrefShape('#section'), false);
  assert.equal(isInternalHrefShape('/abs.md'), false);
  assert.equal(isInternalHrefShape('mailto:a@b.com'), false);
  assert.equal(isInternalHrefShape('foo'), false);
  assert.equal(isInternalHrefShape(''), false);
});

// --- fixtures (navToml node shape) ---

const LISTED = [
  { name: 'Home', value: 'index.md' },
  { name: 'Guides', children: [
    { name: 'Employees', children: [
      { name: 'Registering an employee', value: 'pages/registering-an-employee.md' },
    ] },
    { name: 'Adding an asset', value: 'pages/adding-an-asset.md' },
  ] },
  { name: 'System', children: [
    { name: 'Overview', value: 'pages/overview.md' },
  ] },
];

const UNLISTED = [
  { name: 'Guides', children: [
    { name: 'Managing Opus Compliance Cloud', value: 'pages/managing-opus-compliance-cloud.md' },
  ] },
];

// --- buildInternalTreeNodes ---

test('buildInternalTreeNodes emits Listed and Unlisted group roots', () => {
  const nodes = buildInternalTreeNodes(LISTED, UNLISTED);
  assert.equal(nodes.length, 2);
  assert.deepEqual(nodes.map(n => n.label), ['Live pages', 'Unlisted pages']);
  assert.equal(nodes[0].kind, 'folder');
  assert.equal(nodes[0].attrs['data-kb-group'], '1');
  assert.equal(nodes[1].attrs['data-kb-group'], '1');
});
test('buildInternalTreeNodes omits Unlisted root when unlisted_nav is empty', () => {
  const nodes = buildInternalTreeNodes(LISTED, []);
  assert.deepEqual(nodes.map(n => n.label), ['Live pages']);
});
test('buildInternalTreeNodes recurses sections and keeps Home/System (no exclusions)', () => {
  const listed = buildInternalTreeNodes(LISTED, UNLISTED)[0];
  assert.deepEqual(listed.children.map(n => n.label), ['Home', 'Guides', 'System']);
  const employees = listed.children[1].children[0];
  assert.equal(employees.kind, 'folder');
  assert.equal(employees.children[0].label, 'Registering an employee');
});
test('buildInternalTreeNodes leaves carry href and display name attrs', () => {
  const listed = buildInternalTreeNodes(LISTED, UNLISTED)[0];
  const home = listed.children[0];
  assert.equal(home.kind, 'file');
  assert.deepEqual(home.attrs, { 'data-kb-file': '../index.md', 'data-kb-label': 'Home' });
  const asset = listed.children[1].children[1];
  assert.deepEqual(asset.attrs, { 'data-kb-file': 'adding-an-asset.md', 'data-kb-label': 'Adding an asset' });
});

// --- resolveInternalHref ---

test('resolveInternalHref finds a listed page by bare filename', () => {
  assert.deepEqual(resolveInternalHref('adding-an-asset.md', LISTED, UNLISTED),
    { href: 'adding-an-asset.md', label: 'Adding an asset' });
});
test('resolveInternalHref finds nested and unlisted pages', () => {
  assert.deepEqual(resolveInternalHref('registering-an-employee.md', LISTED, UNLISTED),
    { href: 'registering-an-employee.md', label: 'Registering an employee' });
  assert.deepEqual(resolveInternalHref('managing-opus-compliance-cloud.md', LISTED, UNLISTED),
    { href: 'managing-opus-compliance-cloud.md', label: 'Managing Opus Compliance Cloud' });
});
test('resolveInternalHref tolerates pages/ and ./ prefixes, normalizing the href', () => {
  assert.deepEqual(resolveInternalHref('pages/overview.md', LISTED, UNLISTED),
    { href: 'overview.md', label: 'Overview' });
  assert.deepEqual(resolveInternalHref('./overview.md', LISTED, UNLISTED),
    { href: 'overview.md', label: 'Overview' });
});
test('resolveInternalHref resolves ../index.md to Home', () => {
  assert.deepEqual(resolveInternalHref('../index.md', LISTED, UNLISTED),
    { href: '../index.md', label: 'Home' });
});
test('resolveInternalHref returns null for unknown pages and external hrefs', () => {
  assert.equal(resolveInternalHref('nope.md', LISTED, UNLISTED), null);
  assert.equal(resolveInternalHref('https://x.com/adding-an-asset.md', LISTED, UNLISTED), null);
});

console.log(`\n${passed} passed`);
