import assert from 'node:assert/strict';
import { slugify, titleCaseSegment, parseNavBlock, serializeNav, replaceNavBlock, insertPath, removeByValue, findPathOfValue, parseCreatedTags, parseTagRegistry, writeTagRegistry, mergeTagRegistry } from '../scripts/navToml.js';

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
test('slugify converts ampersand to "and"', () => {
  assert.equal(slugify('Access & Authorisations'), 'access-and-authorisations');
  assert.equal(slugify('A&B'), 'a-and-b');
});
test('slugify hyphenates punctuation instead of deleting it', () => {
  assert.equal(slugify('A/B Testing'), 'a-b-testing');
});
test('slugify transliterates accented characters', () => {
  assert.equal(slugify('Résumé Café'), 'resume-cafe');
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

test('insertPath merges into existing section matched by slug', () => {
  const items = [{ name: 'Guides', children: [{ name: 'Employees', children: [] }] }];
  insertPath(items, ['guides', 'employees'], 'Registering an employee', 'pages/registering-an-employee.md');
  assert.equal(items.length, 1);
  assert.equal(items[0].children.length, 1);
  assert.equal(items[0].children[0].children[0].value, 'pages/registering-an-employee.md');
});
test('insertPath creates missing sections with title-cased names', () => {
  const items = [];
  insertPath(items, ['guides', 'annual-reports'], 'Q1', 'pages/q1.md');
  assert.equal(items[0].name, 'Guides');
  assert.equal(items[0].children[0].name, 'Annual Reports');
  assert.equal(items[0].children[0].children[0].value, 'pages/q1.md');
});
test('insertPath with empty segments adds a root leaf', () => {
  const items = [];
  insertPath(items, [], 'Top', 'pages/top.md');
  assert.deepEqual(items, [{ name: 'Top', value: 'pages/top.md' }]);
});
test('insertPath replaces an existing leaf by value', () => {
  const items = [{ name: 'Old name', value: 'pages/x.md' }];
  insertPath(items, [], 'New name', 'pages/x.md');
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'New name');
});
test('removeByValue removes leaf and prunes empty parents', () => {
  const items = [{ name: 'Guides', children: [{ name: 'Employees', children: [{ name: 'R', value: 'pages/r.md' }] }] }];
  removeByValue(items, 'pages/r.md');
  assert.deepEqual(items, []);
});
test('removeByValue keeps siblings', () => {
  const items = [{ name: 'G', children: [{ name: 'A', value: 'pages/a.md' }, { name: 'B', value: 'pages/b.md' }] }];
  removeByValue(items, 'pages/a.md');
  assert.equal(items[0].children.length, 1);
  assert.equal(items[0].children[0].value, 'pages/b.md');
});
test('findPathOfValue returns segments and leaf name', () => {
  const items = [{ name: 'Guides', children: [{ name: 'Employees', children: [{ name: 'R', value: 'pages/r.md' }] }] }];
  assert.deepEqual(findPathOfValue(items, 'pages/r.md'), { segments: ['guides', 'employees'], leafName: 'R' });
});
test('findPathOfValue returns null when absent', () => {
  assert.equal(findPathOfValue([], 'pages/none.md'), null);
});

test('insertPath under a different path leaves the original (caller must removeByValue first)', () => {
  const items = [{ name: 'A', children: [{ name: 'Leaf', value: 'pages/x.md' }] }];
  insertPath(items, ['b'], 'Leaf', 'pages/x.md');
  // Not de-duplicated across paths: both the original and the new leaf exist.
  assert.equal(items.length, 2);
  assert.equal(items[0].children[0].value, 'pages/x.md');
  assert.equal(items[1].name, 'B');
  assert.equal(items[1].children[0].value, 'pages/x.md');
});
test('removeByValue removes all leaves sharing a value', () => {
  const items = [{ name: 'A', value: 'pages/x.md' }, { name: 'B', value: 'pages/x.md' }];
  removeByValue(items, 'pages/x.md');
  assert.deepEqual(items, []);
});

// ── mb_created_tags: the nav-links tag suggestion list ───────────────────────

const TOML_NO_TAGS = [
  '[project]',
  'site_name = "KB"',
  'nav = [',
  '  {"Home" = "index.md"}',
  ']',
  '',
  '[project.markdown_extensions.tables]',
].join('\n');

test('parseCreatedTags: empty list when the block is absent', () => {
  assert.deepEqual(parseCreatedTags(TOML_NO_TAGS), []);
});

test('parseTagRegistry: legacy bare strings parse as colourless entries', () => {
  const toml = TOML_NO_TAGS + '\n\n[project.extra]\nmb_created_tags = [\n  "Alpha",\n  "Beta",\n]\n';
  assert.deepEqual(parseTagRegistry(toml), [{ name: 'Alpha' }, { name: 'Beta' }]);
  assert.deepEqual(parseCreatedTags(toml), ['Alpha', 'Beta']);
});

test('parseTagRegistry: inline tables with and without colour, mixed with strings', () => {
  const toml = TOML_NO_TAGS + '\n\n[project.extra]\nmb_created_tags = [\n  { name = "System", colour = "emerald" },\n  {name="RAMS"},\n  "Legacy",\n  { name = "Odd", colour = "Sky Blue!" },\n]\n';
  assert.deepEqual(parseTagRegistry(toml), [
    { name: 'System', colour: 'emerald' }, { name: 'RAMS' }, { name: 'Legacy' }, { name: 'Odd', colour: 'skyblue' },
  ]);
  assert.deepEqual(parseCreatedTags(toml), ['System', 'RAMS', 'Legacy', 'Odd']);
});

test('parseTagRegistry: [] when the block is absent', () => {
  assert.deepEqual(parseTagRegistry(TOML_NO_TAGS), []);
});

test('writeTagRegistry: no [project.extra] table → fresh block at EOF, round-trips', () => {
  const out = writeTagRegistry(TOML_NO_TAGS, [{ name: 'System', colour: 'emerald' }, { name: 'RAMS' }]);
  assert.ok(out.startsWith(TOML_NO_TAGS), 'existing content untouched');
  assert.equal((out.match(/\[project\.extra\]/g) ?? []).length, 1);
  assert.equal((out.match(/mb_created_tags/g) ?? []).length, 1);
  assert.deepEqual(parseTagRegistry(out), [{ name: 'System', colour: 'emerald' }, { name: 'RAMS' }]);
  assert.deepEqual(parseNavBlock(out, 'nav').items, parseNavBlock(TOML_NO_TAGS, 'nav').items, 'nav untouched');
});

test('writeTagRegistry: existing [project.extra] table gets the array appended, no second header', () => {
  const toml = TOML_NO_TAGS + '\n\n[project.extra]\nmb_status_banner = ""\n\n[project.other]\nx = 1\n';
  const out = writeTagRegistry(toml, [{ name: 'System' }]);
  assert.equal((out.match(/\[project\.extra\]/g) ?? []).length, 1, 'one header only');
  assert.deepEqual(parseTagRegistry(out), [{ name: 'System' }]);
  const lines = out.split('\n');
  const arr = lines.indexOf('mb_created_tags = [');
  assert.ok(arr > lines.indexOf('mb_status_banner = ""'), 'lands after the scalars');
  assert.ok(arr < lines.indexOf('[project.other]'), 'lands before the next table');
  assert.ok(out.includes('[project.other]\nx = 1'), 'next table untouched');
});

test('writeTagRegistry: rewrites the block in place, re-emitting legacy strings as tables', () => {
  const toml = TOML_NO_TAGS + '\n\n[project.extra]\nmb_created_tags = [\n  "Alpha",\n  "Beta",\n]\nmb_status_banner = ""\n';
  const out = writeTagRegistry(toml, [{ name: 'Alpha', colour: 'red' }, { name: 'Beta' }, { name: 'Gamma' }]);
  assert.ok(out.includes('  { name = "Alpha", colour = "red" },\n  { name = "Beta" },\n  { name = "Gamma" },\n]'));
  assert.ok(!out.includes('  "Alpha",'), 'legacy string line replaced');
  assert.ok(out.endsWith('mb_status_banner = ""\n'), 'trailing scalar preserved');
  assert.equal((out.match(/mb_created_tags/g) ?? []).length, 1);
});

test('writeTagRegistry: identity when nothing changes; blanks/dupes/quotes cleaned', () => {
  const toml = writeTagRegistry(TOML_NO_TAGS, [{ name: 'System', colour: 'emerald' }]);
  assert.equal(writeTagRegistry(toml, [{ name: 'System', colour: 'emerald' }]), toml);
  const out = writeTagRegistry(TOML_NO_TAGS, [{ name: '  Sys"tem ' }, { name: '' }, { name: 'system' }]);
  assert.deepEqual(parseTagRegistry(out), [{ name: 'System' }]);
});

test('mergeTagRegistry: union keeps file order + spelling, form colours win, nothing dropped', () => {
  const file = [{ name: 'Alpha', colour: 'red' }, { name: 'Beta' }, { name: 'Elsewhere', colour: 'sky' }];
  const form = [{ name: 'beta', colour: 'blue' }, { name: 'Alpha' }, { name: 'New', colour: 'lime' }];
  assert.deepEqual(mergeTagRegistry(file, form), [
    { name: 'Alpha' },                    // form cleared the colour
    { name: 'Beta', colour: 'blue' },     // file spelling, form colour
    { name: 'Elsewhere', colour: 'sky' }, // not in form → kept as-is
    { name: 'New', colour: 'lime' },      // form-only appended
  ]);
  assert.deepEqual(mergeTagRegistry([], form), [{ name: 'beta', colour: 'blue' }, { name: 'Alpha' }, { name: 'New', colour: 'lime' }]);
});

console.log(`\n${passed} passed`);
