import assert from 'node:assert/strict';
import { insertDraftIntoMarkdown } from '../scripts/systemUpdates.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const UPDATE = {
  title: 'Checklist actions table on submission page',
  date: '30th July 2026',
  type: 'improvement',
  description: 'A table including checklist actions will now appear.',
  uuid: 'test-uuid-1',
};

const FRONTMATTER = `---
search:
  exclude: true
---

`;

const HEADER = '# System update drafts\n';

test('inserts after header when file has no frontmatter', () => {
  const md = insertDraftIntoMarkdown(HEADER + '\n', UPDATE);
  assert.ok(md.startsWith(HEADER), 'header stays first');
  assert.ok(md.indexOf('??? improvement') > md.indexOf(HEADER), 'block sits below header');
  assert.equal(md.match(/# System update drafts/g).length, 1, 'header not duplicated');
});

test('inserts after header when file has frontmatter', () => {
  const md = insertDraftIntoMarkdown(FRONTMATTER + HEADER + '\n', UPDATE);
  assert.ok(md.startsWith(FRONTMATTER), 'frontmatter stays at the very top');
  assert.ok(md.indexOf('??? improvement') > md.indexOf('# System update drafts'), 'block sits below header');
  assert.equal(md.match(/# System update drafts/g).length, 1, 'header not duplicated');
});

test('frontmatter but no header: header created after frontmatter', () => {
  const md = insertDraftIntoMarkdown(FRONTMATTER, UPDATE);
  assert.ok(md.startsWith('---\n'), 'frontmatter stays at the very top');
  const headerIdx = md.indexOf('# System update drafts');
  assert.ok(headerIdx > md.indexOf('exclude: true'), 'header sits below frontmatter');
  assert.ok(md.indexOf('??? improvement') > headerIdx, 'block sits below header');
});

test('empty file gets header then block', () => {
  const md = insertDraftIntoMarkdown('', UPDATE);
  assert.ok(md.startsWith(HEADER), 'header first');
  assert.ok(md.includes('??? improvement'), 'block present');
});

test('new draft lands above existing drafts', () => {
  const existing = FRONTMATTER + HEADER + '\n??? improvement "Old one<span class="meta">1st July 2026</span>"\n\n    <span data-uuid="old-uuid" style="display:none"></span>\n    Old body.\n';
  const md = insertDraftIntoMarkdown(existing, UPDATE);
  assert.ok(md.indexOf('test-uuid-1') < md.indexOf('old-uuid'), 'new draft first');
  assert.ok(md.startsWith(FRONTMATTER), 'frontmatter intact');
  assert.equal(md.match(/# System update drafts/g).length, 1, 'header not duplicated');
});

console.log(`systemUpdateDrafts: ${passed} tests passed`);
