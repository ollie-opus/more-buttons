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

test('moveToPath into a following sibling section does not drop the node', () => {
  // Regression: detach shifts the target's index path; resolving the target as a
  // node reference (not a re-walked index path) keeps the move correct.
  const t = [
    { name: 'Guides', children: [ { name: 'A', value: 'pages/a.md' } ] },
    { name: 'Reference', children: [ { name: 'D', value: 'pages/d.md' } ] },
  ];
  const s = createReorderState({ tree: t, navItems: JSON.parse(JSON.stringify(t)), draftItems: [] });
  s.moveToPath('0', '1');  // move Guides(0) INTO Reference(1)
  const ref = s.getTree().find(n => n.name === 'Reference');
  assert.deepEqual(ref.children.map(n => n.name), ['D', 'Guides']);
  assert.deepEqual(s.getTree().map(n => n.name), ['Reference']);
});

test('moveToPath of a sibling leaf into the following folder keeps the leaf', () => {
  const t = [ { name: 'Guides', children: [
    { name: 'X', value: 'pages/x.md' },
    { name: 'Employees', children: [ { name: 'A', value: 'pages/a.md' } ] },
  ] } ];
  const s = createReorderState({ tree: t, navItems: JSON.parse(JSON.stringify(t)), draftItems: [] });
  s.moveToPath('0.0', '0.1');  // X into Employees
  const emp = s.getTree()[0].children.find(n => n.name === 'Employees');
  assert.deepEqual(emp.children.map(n => n.name), ['A', 'X']);
  assert.deepEqual(s.getTree()[0].children.map(n => n.name), ['Employees']);
});

test('moveToPath into own descendant is a rejected no-op', () => {
  const t = [ { name: 'Guides', children: [
    { name: 'Sub', children: [ { name: 'A', value: 'pages/a.md' } ] },
  ] } ];
  const s = createReorderState({ tree: t, navItems: JSON.parse(JSON.stringify(t)), draftItems: [] });
  s.moveToPath('0', '0.0');  // Guides into its own child Sub
  assert.equal(s.isDirty(), false);
  assert.equal(s.getTree()[0].name, 'Guides');
});

test('sectionTargets lists folders with full-path labels', () => {
  const s = createReorderState({ tree: tree(), navItems: navItems(), draftItems: draftItems() });
  const labels = s.sectionTargets().map(t => t.label);
  assert.ok(labels.includes('Guides'));
  assert.ok(labels.includes('Guides/Employees'));
  assert.ok(labels.includes('Guides/Contractors'));
});

console.log(`\n${passed} passed`);
