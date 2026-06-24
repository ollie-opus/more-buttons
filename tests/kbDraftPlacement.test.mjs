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

console.log(`\n${passed} passed`);
