import assert from 'node:assert/strict';
import {
  baseOf, valueMapByBase, leafBases, projectTree, spliceGuideBlock, slugify,
} from '../scripts/navToml.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const nav = [
  { name: 'Home', value: 'pages/index.md' },
  { name: 'Guides', children: [
    { name: 'Employees', children: [
      { name: 'Registering', value: 'pages/registering.md' },
      { name: 'Offboarding', value: 'pages/offboarding.md' },
    ] },
  ] },
  { name: 'System', children: [ { name: 'Status', value: 'pages/system-status.md' } ] },
];
const draftNav = [
  { name: 'Guides', children: [
    { name: 'Employees', children: [
      { name: 'Onboarding (draft)', value: 'drafts/onboarding.md' },
    ] },
  ] },
];

test('baseOf strips the directory', () => {
  assert.equal(baseOf('pages/registering.md'), 'registering.md');
});

test('valueMapByBase keys on filename → exact value', () => {
  const m = valueMapByBase(nav);
  assert.equal(m.get('registering.md'), 'pages/registering.md');
  assert.equal(m.get('system-status.md'), 'pages/system-status.md');
});

test('leafBases collects every leaf filename', () => {
  assert.deepEqual([...leafBases(draftNav)], ['onboarding.md']);
});

test('projectTree keeps only members, reuses exact values, prunes empties', () => {
  // edited tree: Offboarding moved above Registering, plus a draft-only leaf.
  const edited = [
    { name: 'Guides', children: [
      { name: 'Employees', children: [
        { name: 'Offboarding', value: 'pages/offboarding.md' },
        { name: 'Registering', value: 'pages/registering.md' },
        { name: 'Onboarding (draft)', value: 'drafts/onboarding.md' },
      ] },
    ] },
  ];
  const liveMap = valueMapByBase(nav);
  const projected = projectTree(edited, liveMap);
  // draft-only leaf dropped from the live projection; order preserved.
  assert.deepEqual(projected, [
    { name: 'Guides', children: [
      { name: 'Employees', children: [
        { name: 'Offboarding', value: 'pages/offboarding.md' },
        { name: 'Registering', value: 'pages/registering.md' },
      ] },
    ] },
  ]);
});

test('projectTree prunes a folder with no surviving members', () => {
  const edited = [ { name: 'Empties', children: [
    { name: 'Only draft', value: 'drafts/x.md' },
  ] } ];
  assert.deepEqual(projectTree(edited, valueMapByBase(nav)), []);
});

test('spliceGuideBlock preserves Home/System anchors in place', () => {
  const projected = [
    { name: 'Guides', children: [ { name: 'Offboarding', value: 'pages/offboarding.md' } ] },
  ];
  const out = spliceGuideBlock(nav, projected, new Set(['guides']));
  assert.deepEqual(out, [
    { name: 'Home', value: 'pages/index.md' },
    { name: 'Guides', children: [ { name: 'Offboarding', value: 'pages/offboarding.md' } ] },
    { name: 'System', children: [ { name: 'Status', value: 'pages/system-status.md' } ] },
  ]);
});

test('spliceGuideBlock appends projected when no managed node exists', () => {
  const original = [ { name: 'Home', value: 'pages/index.md' } ];
  const projected = [ { name: 'Guides', children: [ { name: 'A', value: 'pages/a.md' } ] } ];
  const out = spliceGuideBlock(original, projected, new Set(['guides']));
  assert.deepEqual(out, [
    { name: 'Home', value: 'pages/index.md' },
    { name: 'Guides', children: [ { name: 'A', value: 'pages/a.md' } ] },
  ]);
});

test('spliceGuideBlock drops an emptied managed section (projection omits it)', () => {
  // 'Guides' is managed (in editedTopSlugs) but projected has no Guides → dropped.
  const out = spliceGuideBlock(nav, [], new Set(['guides']));
  assert.deepEqual(out, [
    { name: 'Home', value: 'pages/index.md' },
    { name: 'System', children: [ { name: 'Status', value: 'pages/system-status.md' } ] },
  ]);
});

console.log(`\n${passed} passed`);
