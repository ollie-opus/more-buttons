import assert from 'node:assert/strict';
import { parseNavBlock, replaceNavBlock, renameByValue } from '../scripts/navToml.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const TOML = `site_name = "Opus KB"

nav = [
  {"Home" = "index.md"},
  {"Guides" = [
    {"Adding an Employee" = "pages/adding-employee.md"},
    {"Manager Steps" = [
      {"Approvals" = "pages/approvals.md"}
    ]}
  ]}
]

draft_nav = [
  {"Guides" = [
    {"Adding an Employee" = "pages/adding-employee.md"}
  ]}
]
`;

test('renames a top-level leaf', () => {
  const { items } = parseNavBlock(TOML, 'nav');
  const changed = renameByValue(items, 'index.md', 'Welcome');
  assert.equal(changed, 1);
  assert.equal(items[0].name, 'Welcome');
  assert.equal(items[0].value, 'index.md');
});

test('renames a nested leaf, preserving tree order', () => {
  const { items } = parseNavBlock(TOML, 'nav');
  const changed = renameByValue(items, 'pages/approvals.md', 'Approving Things');
  assert.equal(changed, 1);
  // Order intact: Home first, then Guides → [leaf, Manager Steps].
  assert.equal(items[0].name, 'Home');
  assert.equal(items[1].name, 'Guides');
  assert.equal(items[1].children[0].name, 'Adding an Employee');
  assert.equal(items[1].children[1].name, 'Manager Steps');
  assert.equal(items[1].children[1].children[0].name, 'Approving Things');
});

test('nav and draft_nav blocks rename independently on the same value', () => {
  const nav = parseNavBlock(TOML, 'nav').items;
  const draft = parseNavBlock(TOML, 'draft_nav').items;
  assert.equal(renameByValue(nav, 'pages/adding-employee.md', 'Adding Employees'), 1);
  assert.equal(renameByValue(draft, 'pages/adding-employee.md', 'Adding Employees'), 1);
  assert.equal(nav[1].children[0].name, 'Adding Employees');
  assert.equal(draft[0].children[0].name, 'Adding Employees');
});

test('returns 0 when the value is not present', () => {
  const { items } = parseNavBlock(TOML, 'nav');
  assert.equal(renameByValue(items, 'pages/nope.md', 'Whatever'), 0);
});

test('returns 0 when the name already matches (no churn → caller skips the toml write)', () => {
  const { items } = parseNavBlock(TOML, 'nav');
  assert.equal(renameByValue(items, 'pages/approvals.md', 'Approvals'), 0);
});

test('round-trips through replaceNavBlock', () => {
  const { items } = parseNavBlock(TOML, 'nav');
  renameByValue(items, 'pages/approvals.md', 'Approving Things');
  const out = replaceNavBlock(TOML, 'nav', items);
  const reread = parseNavBlock(out, 'nav').items;
  assert.equal(reread[1].children[1].children[0].name, 'Approving Things');
  // draft_nav untouched.
  assert.equal(parseNavBlock(out, 'draft_nav').items[0].children[0].name, 'Adding an Employee');
});

console.log(`\n${passed} passed`);
