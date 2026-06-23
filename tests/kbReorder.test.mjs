import assert from 'node:assert/strict';
import { createReorderState } from '../scripts/kbReorder.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const navItems = () => ([
  { name: 'Home', value: 'pages/index.md' },
  { name: 'Guides', children: [
    { name: 'Employees', children: [
      { name: 'A', value: 'pages/a.md' },
      { name: 'B', value: 'pages/b.md' },
    ] },
    { name: 'Contractors', children: [
      { name: 'C', value: 'pages/c.md' },
    ] },
  ] },
]);
const draftItems = () => ([
  { name: 'Guides', children: [
    { name: 'Employees', children: [
      { name: 'D draft', value: 'drafts/d.md' },
    ] },
  ] },
]);
// Merged display tree (what the panel renders): live A,B then draft D under Employees.
const tree = () => ([
  { name: 'Guides', children: [
    { name: 'Employees', children: [
      { name: 'A', value: 'pages/a.md' },
      { name: 'B', value: 'pages/b.md' },
      { name: 'D draft', value: 'drafts/d.md' },
    ] },
    { name: 'Contractors', children: [
      { name: 'C', value: 'pages/c.md' },
    ] },
  ] },
]);

test('starts clean', () => {
  const s = createReorderState({ tree: tree(), navItems: navItems(), draftItems: draftItems() });
  assert.equal(s.isDirty(), false);
});

test('move down reorders siblings and marks dirty', () => {
  const s = createReorderState({ tree: tree(), navItems: navItems(), draftItems: draftItems() });
  s.move('0.0.0', 'down');                       // A down past B
  assert.equal(s.isDirty(), true);
  assert.deepEqual(s.getTree()[0].children[0].children.map(n => n.name), ['B', 'A', 'D draft']);
});

test('buildPayload writes nav order, drops draft-only leaf from nav', () => {
  const s = createReorderState({ tree: tree(), navItems: navItems(), draftItems: draftItems() });
  s.move('0.0.0', 'down');                       // A,B → B,A
  const { nav, draftNav } = s.buildPayload();
  const emp = nav[1].children[0];                // Home anchor at [0], Guides at [1]
  assert.equal(nav[0].name, 'Home');             // anchor preserved
  assert.deepEqual(emp.children.map(n => n.value), ['pages/b.md', 'pages/a.md']);
  // draft_nav keeps only the draft member, exact value reused.
  assert.deepEqual(draftNav[0].children[0].children.map(n => n.value), ['drafts/d.md']);
});

test('moveToSegments reparents a leaf into a new section', () => {
  const s = createReorderState({ tree: tree(), navItems: navItems(), draftItems: draftItems() });
  s.moveToSegments('0.0.0', ['guides', 'archive']);  // move A to Guides/Archive
  const { nav } = s.buildPayload();
  const archive = nav[1].children.find(n => n.name === 'Archive');
  assert.ok(archive);
  assert.deepEqual(archive.children.map(n => n.value), ['pages/a.md']);
  // A removed from Employees in nav.
  assert.deepEqual(nav[1].children[0].children.map(n => n.value), ['pages/b.md']);
});

test('sectionTargets lists folders with full-path labels', () => {
  const s = createReorderState({ tree: tree(), navItems: navItems(), draftItems: draftItems() });
  const labels = s.sectionTargets().map(t => t.label);
  assert.ok(labels.includes('Guides'));
  assert.ok(labels.includes('Guides/Employees'));
  assert.ok(labels.includes('Guides/Contractors'));
});

console.log(`\n${passed} passed`);
