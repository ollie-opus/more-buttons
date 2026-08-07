import assert from 'node:assert/strict';
import { slugify, titleCaseSegment, parseNavBlock, serializeNav, replaceNavBlock, insertPath, removeByValue, findPathOfValue, parseCreatedTags, addCreatedTag } from '../scripts/navToml.js';

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

test('addCreatedTag: first tag appends a [project.extra] block at EOF', () => {
  const out = addCreatedTag(TOML_NO_TAGS, 'System');
  assert.ok(out.startsWith(TOML_NO_TAGS), 'existing content untouched');
  assert.ok(out.includes('[project.extra]'));
  assert.ok(out.includes('mb_created_tags = ['));
  assert.deepEqual(parseCreatedTags(out), ['System']);
});

test('addCreatedTag: second tag lands in the existing block', () => {
  const out = addCreatedTag(addCreatedTag(TOML_NO_TAGS, 'System'), 'Contractors');
  assert.deepEqual(parseCreatedTags(out), ['System', 'Contractors']);
  assert.equal((out.match(/mb_created_tags/g) ?? []).length, 1, 'one block only');
  assert.equal((out.match(/\[project\.extra\]/g) ?? []).length, 1, 'one header only');
});

test('addCreatedTag: an existing tag is skipped (case-insensitively), input returned as-is', () => {
  const one = addCreatedTag(TOML_NO_TAGS, 'System');
  assert.equal(addCreatedTag(one, 'System'), one);
  assert.equal(addCreatedTag(one, '  system '), one);
});

test('addCreatedTag: blank / quote-only tags are a no-op', () => {
  assert.equal(addCreatedTag(TOML_NO_TAGS, ''), TOML_NO_TAGS);
  assert.equal(addCreatedTag(TOML_NO_TAGS, '  '), TOML_NO_TAGS);
});

test('addCreatedTag: double-quotes are stripped so the toml string cannot break', () => {
  const out = addCreatedTag(TOML_NO_TAGS, 'Sys"tem');
  assert.deepEqual(parseCreatedTags(out), ['System']);
});

test('parseCreatedTags/addCreatedTag: tolerate a pre-existing hand-written block', () => {
  const toml = TOML_NO_TAGS + '\n\n[project.extra]\nmb_created_tags = [\n  "Alpha",\n  "Beta",\n]\n';
  assert.deepEqual(parseCreatedTags(toml), ['Alpha', 'Beta']);
  assert.deepEqual(parseCreatedTags(addCreatedTag(toml, 'Gamma')), ['Alpha', 'Beta', 'Gamma']);
});

test('addCreatedTag: nav blocks are untouched', () => {
  const out = addCreatedTag(TOML_NO_TAGS, 'System');
  assert.deepEqual(parseNavBlock(out, 'nav').items, parseNavBlock(TOML_NO_TAGS, 'nav').items);
});

console.log(`\n${passed} passed`);
