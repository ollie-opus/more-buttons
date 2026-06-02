import assert from 'node:assert/strict';
import { slugify, titleCaseSegment, parseNavBlock, serializeNav, replaceNavBlock } from '../scripts/navToml.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

test('slugify lowercases and hyphenates spaces', () => {
  assert.equal(slugify('Registering an employee'), 'registering-an-employee');
});
test('slugify strips punctuation and collapses hyphens', () => {
  assert.equal(slugify('  Hello,  World! __ Test '), 'hello-world-test');
});
test('slugify returns empty for symbol-only input', () => {
  assert.equal(slugify('!!!'), '');
});
test('titleCaseSegment title-cases hyphenated segment', () => {
  assert.equal(titleCaseSegment('annual-reports'), 'Annual Reports');
});
test('titleCaseSegment handles single word', () => {
  assert.equal(titleCaseSegment('employees'), 'Employees');
});

const SAMPLE = `# comment line
nav = [
  {"Home" = "index.md"},
  {"Guides" = [
    {"Employees" = [
      {"Registering an employee" = "pages/registering-an-employee.md"}
    ]}
  ]}
]

draft_nav = [
  {"Guides" = [
    {"Employees" = [
      {"Registering an employee" = "pages/registering-an-employee.md"}
    ]}
  ]}
]
`;

test('parseNavBlock reads nav, not draft_nav, for key "nav"', () => {
  const { items } = parseNavBlock(SAMPLE, 'nav');
  assert.equal(items.length, 2);
  assert.equal(items[0].name, 'Home');
  assert.equal(items[0].value, 'index.md');
  assert.equal(items[1].name, 'Guides');
  assert.equal(items[1].children[0].name, 'Employees');
  assert.equal(items[1].children[0].children[0].value, 'pages/registering-an-employee.md');
});
test('parseNavBlock reads draft_nav independently', () => {
  const { items } = parseNavBlock(SAMPLE, 'draft_nav');
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'Guides');
});
test('parseNavBlock returns empty for missing key', () => {
  const { items, start } = parseNavBlock('x = 1\n', 'nav');
  assert.deepEqual(items, []);
  assert.equal(start, -1);
});
test('serializeNav round-trips through parseNavBlock', () => {
  const { items } = parseNavBlock(SAMPLE, 'nav');
  const text = `nav = ${serializeNav(items)}\n`;
  const reparsed = parseNavBlock(text, 'nav').items;
  assert.deepEqual(reparsed, items);
});
test('replaceNavBlock preserves surrounding text', () => {
  const { items } = parseNavBlock(SAMPLE, 'draft_nav');
  const out = replaceNavBlock(SAMPLE, 'draft_nav', items);
  assert.ok(out.startsWith('# comment line'));
  assert.ok(out.includes('nav = ['));
  assert.equal(parseNavBlock(out, 'nav').items.length, 2);
});
test('replaceNavBlock appends an absent block', () => {
  const base = 'nav = [\n  {"Home" = "index.md"}\n]\n';
  const out = replaceNavBlock(base, 'draft_nav', [{ name: 'A', value: 'pages/a.md' }]);
  assert.ok(out.includes('draft_nav = ['));
  assert.equal(parseNavBlock(out, 'draft_nav').items[0].value, 'pages/a.md');
});

console.log(`\n${passed} passed`);
