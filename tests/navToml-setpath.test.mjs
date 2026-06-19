import assert from 'node:assert/strict';
import { parseNavBlock, setPathByValueSlug } from '../scripts/navToml.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const TOML = `draft_nav = [
  {"Guides" = [
    {"Employees" = [
      {"Registering an employee" = "drafts/registering-an-employee.md"}
    ]}
  ]}
]
`;

test('moves a leaf to a new section path, preserving its name', () => {
  const items = parseNavBlock(TOML, 'draft_nav').items;
  const r = setPathByValueSlug(items, 'registering-an-employee', ['onboarding'], {
    value: 'drafts/registering-an-employee.md',
    fallbackName: 'registering-an-employee',
  });
  assert.equal(r.changed, true);
  // Old "Guides/Employees" branch pruned (left empty), new "Onboarding" created.
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'Onboarding');
  assert.equal(items[0].children[0].name, 'Registering an employee');
  assert.equal(items[0].children[0].value, 'drafts/registering-an-employee.md');
});

test('moves a leaf to the root when newSegments is empty', () => {
  const items = parseNavBlock(TOML, 'draft_nav').items;
  const r = setPathByValueSlug(items, 'registering-an-employee', [], {
    value: 'drafts/registering-an-employee.md',
    fallbackName: 'registering-an-employee',
  });
  assert.equal(r.changed, true);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'Registering an employee');
  assert.equal(items[0].value, 'drafts/registering-an-employee.md');
});

test('no-op when already at the target path', () => {
  const items = parseNavBlock(TOML, 'draft_nav').items;
  const before = JSON.stringify(items);
  const r = setPathByValueSlug(items, 'registering-an-employee', ['guides', 'employees'], {
    value: 'drafts/registering-an-employee.md',
    fallbackName: 'registering-an-employee',
  });
  assert.equal(r.changed, false);
  assert.equal(JSON.stringify(items), before);
});

test('creates the leaf when slug is absent (self-heal)', () => {
  const items = [];
  const r = setPathByValueSlug(items, 'new-guide', ['guides'], {
    value: 'drafts/new-guide.md',
    fallbackName: 'new-guide',
  });
  assert.equal(r.changed, true);
  assert.equal(items[0].name, 'Guides');
  assert.equal(items[0].children[0].name, 'new-guide');
});

console.log(`\n${passed} passed`);
