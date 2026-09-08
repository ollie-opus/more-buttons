import assert from 'node:assert/strict';
import { buildGuideTree } from '../scripts/knowledgeBaseManagement.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const nav = [
  { name: 'Guides', children: [
    { name: 'Contractors', children: [
      { name: 'Contractors Overview', value: 'pages/contractors-overview.md' },
      { name: 'Contractor & Project statuses', value: 'pages/contractor-and-project-statuses.md' },
      { name: 'Adding a new contractor', value: 'pages/adding-a-new-contractor.md' },
    ] },
  ] },
];

test('a same-location draft keeps the live position (does not drop to the bottom)', () => {
  const draftNav = [
    { name: 'Guides', children: [
      { name: 'Contractors', children: [
        { name: 'Contractors Overview', value: 'drafts/contractors-overview.md' },
      ] },
    ] },
  ];
  const tree = buildGuideTree(nav, draftNav);
  const names = tree[0].children[0].children.map(n => n.name);
  assert.deepEqual(names, [
    'Contractors Overview',
    'Contractor & Project statuses',
    'Adding a new contractor',
  ]);
});

test('a draft that genuinely moves a page renders ONLY at the draft location', () => {
  // Overview drafted under a different section → live leaf pruned, draft placed there.
  const draftNav = [
    { name: 'Guides', children: [
      { name: 'Getting started', children: [
        { name: 'Contractors Overview', value: 'drafts/contractors-overview.md' },
      ] },
    ] },
  ];
  const tree = buildGuideTree(nav, draftNav);
  const contractors = tree[0].children.find(s => s.name === 'Contractors');
  assert.deepEqual(
    contractors.children.map(n => n.name),
    ['Contractor & Project statuses', 'Adding a new contractor'],
    'live Contractors leaf removed (it moved)',
  );
  const gettingStarted = tree[0].children.find(s => s.name === 'Getting started');
  assert.deepEqual(gettingStarted.children.map(n => n.name), ['Contractors Overview']);
});

// --- unlisted_nav merges into the Guides tree ---------------------------------

const unlistedNav = [
  { name: 'Guides', children: [
    { name: 'Contractors', children: [
      { name: 'Legacy contractor form', value: 'pages/legacy-contractor-form.md' },
    ] },
  ] },
  { name: 'System', children: [
    { name: 'Hidden system page', value: 'pages/hidden-system-page.md' },
  ] },
];

test('an unlisted page (no draft) renders once at its unlisted_nav placement', () => {
  const tree = buildGuideTree(nav, [], unlistedNav);
  const contractors = tree[0].children.find(s => s.name === 'Contractors');
  assert.deepEqual(contractors.children.map(n => n.name), [
    'Contractors Overview',
    'Contractor & Project statuses',
    'Adding a new contractor',
    'Legacy contractor form',
  ]);
});

test('an unlisted page drafting in place renders ONCE, in place', () => {
  const draftNav = [
    { name: 'Guides', children: [
      { name: 'Contractors', children: [
        { name: 'Legacy contractor form', value: 'drafts/legacy-contractor-form.md' },
      ] },
    ] },
  ];
  const tree = buildGuideTree(nav, draftNav, unlistedNav);
  const contractors = tree[0].children.find(s => s.name === 'Contractors');
  const hits = contractors.children.filter(n => n.name === 'Legacy contractor form');
  assert.equal(hits.length, 1, 'no duplicate leaf');
  assert.equal(contractors.children.at(-1).name, 'Legacy contractor form');
  assert.equal(tree[0].children.length, 1, 'no extra sections invented');
});

test('an unlisted draft moved to another section renders ONLY at the draft location', () => {
  const draftNav = [
    { name: 'Guides', children: [
      { name: 'Getting started', children: [
        { name: 'Legacy contractor form', value: 'drafts/legacy-contractor-form.md' },
      ] },
    ] },
  ];
  const tree = buildGuideTree(nav, draftNav, unlistedNav);
  const contractors = tree[0].children.find(s => s.name === 'Contractors');
  assert.ok(!contractors.children.some(n => n.name === 'Legacy contractor form'), 'pruned from stale unlisted spot');
  const gettingStarted = tree[0].children.find(s => s.name === 'Getting started');
  assert.deepEqual(gettingStarted.children.map(n => n.name), ['Legacy contractor form']);
});

test('System entries in unlisted_nav stay out of the Guides tree', () => {
  const tree = buildGuideTree(nav, [], unlistedNav);
  assert.ok(!tree.some(n => n.name === 'System'));
});

test('buildGuideTree without a third argument is unchanged', () => {
  assert.deepEqual(buildGuideTree(nav, []), buildGuideTree(nav, [], []));
});

console.log(`\n${passed} passed`);
