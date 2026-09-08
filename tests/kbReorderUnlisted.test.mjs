import assert from 'node:assert/strict';
import { createReorderState } from '../scripts/kbReorder.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const navItems = () => ([
  { name: 'Home', value: 'pages/index.md' },
  { name: 'Guides', children: [
    { name: 'Employees', children: [
      { name: 'A', value: 'pages/a.md' },
    ] },
    { name: 'Contractors', children: [
      { name: 'C', value: 'pages/c.md' },
    ] },
  ] },
  { name: 'System', children: [
    { name: 'Updates', value: 'pages/system-updates.md' },
  ] },
]);
const draftItems = () => ([
  { name: 'Guides', children: [
    { name: 'Employees', children: [
      { name: 'U', value: 'drafts/u.md' },        // U is unlisted AND drafting
    ] },
  ] },
]);
const unlistedItems = () => ([
  { name: 'Guides', children: [
    { name: 'Employees', children: [
      { name: 'U', value: 'pages/u.md' },
    ] },
    { name: 'Contractors', children: [
      { name: 'V', value: 'pages/v.md' },         // V is unlisted, no draft
    ] },
  ] },
]);
// Merged display tree: live A then unlisted U under Employees; live C then unlisted V under Contractors.
const tree = () => ([
  { name: 'Guides', children: [
    { name: 'Employees', children: [
      { name: 'A', value: 'pages/a.md' },
      { name: 'U', value: 'pages/u.md' },
    ] },
    { name: 'Contractors', children: [
      { name: 'C', value: 'pages/c.md' },
      { name: 'V', value: 'pages/v.md' },
    ] },
  ] },
]);
const mk = () => createReorderState({ tree: tree(), navItems: navItems(), draftItems: draftItems(), unlistedItems: unlistedItems() });

test('payload carries an unlistedNav array that mirrors the tree', () => {
  const { unlistedNav } = mk().buildPayload();
  const guides = unlistedNav.find(n => n.name === 'Guides');
  assert.deepEqual(guides.children.map(s => [s.name, s.children.map(l => l.value)]), [
    ['Employees', ['pages/u.md']],
    ['Contractors', ['pages/v.md']],
  ]);
});

test('moving an unlisted leaf between sections is written to unlistedNav only', () => {
  const s = mk();
  s.moveToPath('0.1.1', '0.0');                  // V: Contractors → Employees
  const { nav, draftNav, unlistedNav } = s.buildPayload();
  const uGuides = unlistedNav.find(n => n.name === 'Guides');
  assert.deepEqual(uGuides.children.map(s => [s.name, s.children.map(l => l.value)]), [
    ['Employees', ['pages/u.md', 'pages/v.md']],
  ]);
  // nav untouched in membership: A under Employees, C under Contractors, anchors kept.
  assert.equal(nav[0].name, 'Home');
  assert.equal(nav.at(-1).name, 'System');
  const nGuides = nav.find(n => n.name === 'Guides');
  assert.deepEqual(nGuides.children.map(s => [s.name, s.children.map(l => l.value)]), [
    ['Employees', ['pages/a.md']],
    ['Contractors', ['pages/c.md']],
  ]);
  // draft_nav still only knows U, exact draft value reused.
  assert.deepEqual(draftNav[0].children[0].children.map(l => l.value), ['drafts/u.md']);
});

test('a public page never leaks into unlistedNav and vice versa', () => {
  const s = mk();
  s.move('0.0.0', 'down');                       // A below U
  const { nav, unlistedNav } = s.buildPayload();
  const flat = (items) => JSON.stringify(items);
  assert.ok(!flat(unlistedNav).includes('pages/a.md'));
  assert.ok(!flat(nav).includes('pages/u.md') && !flat(nav).includes('pages/v.md'));
});

test('omitting unlistedItems yields an empty unlistedNav (back-compat)', () => {
  const s = createReorderState({ tree: tree(), navItems: navItems(), draftItems: draftItems() });
  assert.deepEqual(s.buildPayload().unlistedNav, []);
});

console.log(`\n${passed} passed`);
