import assert from 'node:assert/strict';
import { pageBasesUsingMedia, buildUsageTreeNodes } from '../scripts/mediaUsage.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const LIGHT = 'docs/assets/media/occ-captures/foo-light-mode.png';
const DARK = 'docs/assets/media/occ-captures/foo-dark-mode.png';
const OTHER = 'docs/assets/media/buttons/logo.png';

// ── pageBasesUsingMedia ───────────────────────────────────────────────────────
test('pageBasesUsingMedia matches a page referencing ANY candidate path', () => {
  const index = {
    'docs/pages/alpha.md': [LIGHT, DARK],
    'docs/drafts/beta.md': [DARK],          // dark half only
    'docs/pages/gamma.md': [OTHER],
  };
  const bases = pageBasesUsingMedia(index, [LIGHT, DARK]);
  assert.deepEqual([...bases].sort(), ['alpha.md', 'beta.md']);
});

test('pageBasesUsingMedia collapses live + draft entries onto one base', () => {
  const index = {
    'docs/pages/alpha.md': [LIGHT],
    'docs/drafts/alpha.md': [LIGHT],
  };
  const bases = pageBasesUsingMedia(index, [LIGHT]);
  assert.deepEqual([...bases], ['alpha.md']);
});

test('pageBasesUsingMedia returns an empty set for an unused file or empty inputs', () => {
  assert.equal(pageBasesUsingMedia({ 'docs/pages/a.md': [OTHER] }, [LIGHT]).size, 0);
  assert.equal(pageBasesUsingMedia({}, [LIGHT]).size, 0);
  assert.equal(pageBasesUsingMedia({ 'docs/pages/a.md': [LIGHT] }, []).size, 0);
});

// ── buildUsageTreeNodes ───────────────────────────────────────────────────────
const NAV = [
  { name: 'Home', value: '../index.md' },
  {
    name: 'Guides',
    children: [
      { name: 'Alpha', value: 'pages/alpha.md' },
      { name: 'Sub', children: [{ name: 'Beta', value: 'pages/beta.md' }] },
      { name: 'Delta', value: 'pages/delta.md' },
    ],
  },
  { name: 'System', children: [{ name: 'System updates', value: 'pages/system-updates.md' }] },
];
const DRAFT_NAV = [
  { name: 'Gamma', value: 'drafts/gamma.md' },
  { name: 'Alpha', value: 'drafts/alpha.md' },   // also live — must not duplicate
];

test('buildUsageTreeNodes filters leaves to the given bases and prunes emptied folders', () => {
  const nodes = buildUsageTreeNodes(NAV, DRAFT_NAV, new Set(['alpha.md', 'beta.md']));
  assert.equal(nodes.length, 1); // just Guides — Home, Delta, System, Gamma all gone
  const guides = nodes[0];
  assert.equal(guides.kind, 'folder');
  assert.equal(guides.label, 'Guides');
  assert.deepEqual(guides.children.map(c => c.label), ['Alpha', 'Sub']);
  assert.equal(guides.children[1].children[0].label, 'Beta');
});

test('buildUsageTreeNodes leaf attrs carry the nav value and label', () => {
  const nodes = buildUsageTreeNodes(NAV, [], new Set(['alpha.md']));
  const leaf = nodes[0].children[0];
  assert.equal(leaf.kind, 'file');
  assert.deepEqual(leaf.attrs, { 'data-usage-file': 'pages/alpha.md', 'data-usage-label': 'Alpha' });
});

test('buildUsageTreeNodes includes a draft-only page from draft_nav without duplicating live pages', () => {
  const nodes = buildUsageTreeNodes(NAV, DRAFT_NAV, new Set(['alpha.md', 'gamma.md']));
  const labels = [];
  const walk = (ns) => ns.forEach(n => { labels.push(n.label); if (n.children) walk(n.children); });
  walk(nodes);
  assert.deepEqual(labels.filter(l => l === 'Alpha').length, 1); // no live+draft dupe
  assert.ok(labels.includes('Gamma'));
  const gamma = nodes.find(n => n.label === 'Gamma');
  assert.equal(gamma.attrs['data-usage-file'], 'drafts/gamma.md');
});

test('buildUsageTreeNodes keeps the System section (unlike the guides tree)', () => {
  const nodes = buildUsageTreeNodes(NAV, [], new Set(['system-updates.md']));
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].label, 'System');
  assert.equal(nodes[0].children[0].attrs['data-usage-file'], 'pages/system-updates.md');
});

test('buildUsageTreeNodes returns [] when no bases match', () => {
  assert.deepEqual(buildUsageTreeNodes(NAV, DRAFT_NAV, new Set()), []);
  assert.deepEqual(buildUsageTreeNodes(NAV, DRAFT_NAV, new Set(['nope.md'])), []);
});

console.log(`\n${passed} passed`);
