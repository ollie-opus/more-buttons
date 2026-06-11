import assert from 'node:assert/strict';
import { readFrontmatterIcon, writeFrontmatterIcon } from '../scripts/frontmatter.js';
import { buildSection, replaceSectionByUUID } from '../scripts/sections.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const NO_FM = `# Adding an Employee
<span data-uuid="T1" style="display:none"></span>

Body text.
`;

const WITH_ICON = `---
icon: lucide/user-plus
---

${NO_FM}`;

const MULTI_KEY = `---
icon: lucide/user-plus
hide:
  - toc
---

${NO_FM}`;

// ── read ─────────────────────────────────────────────────────────────────────

test('read: no frontmatter → empty string', () => {
  assert.equal(readFrontmatterIcon(NO_FM), '');
});

test('read: returns the icon value', () => {
  assert.equal(readFrontmatterIcon(WITH_ICON), 'lucide/user-plus');
});

test('read: block without an icon key → empty string', () => {
  assert.equal(readFrontmatterIcon(`---\nhide:\n  - toc\n---\n\n${NO_FM}`), '');
});

// ── write ────────────────────────────────────────────────────────────────────

test('write: creates a block when the file has none', () => {
  const out = writeFrontmatterIcon(NO_FM, 'lucide/users');
  assert.equal(out, `---\nicon: lucide/users\n---\n\n${NO_FM}`);
  assert.equal(readFrontmatterIcon(out), 'lucide/users');
});

test('write: updates an existing icon line in place', () => {
  const out = writeFrontmatterIcon(WITH_ICON, 'lucide/users');
  assert.equal(readFrontmatterIcon(out), 'lucide/users');
  assert.match(out, /^---\nicon: lucide\/users\n---\n/);
});

test('write: preserves other frontmatter keys', () => {
  const out = writeFrontmatterIcon(MULTI_KEY, 'lucide/users');
  assert.match(out, /hide:\n  - toc/);
  assert.equal(readFrontmatterIcon(out), 'lucide/users');
});

test('write: adds an icon line to a block that lacks one', () => {
  const out = writeFrontmatterIcon(`---\nhide:\n  - toc\n---\n\n${NO_FM}`, 'lucide/users');
  assert.equal(readFrontmatterIcon(out), 'lucide/users');
  assert.match(out, /hide:\n  - toc/);
});

test('write: clearing removes the line but keeps a block with other keys', () => {
  const out = writeFrontmatterIcon(MULTI_KEY, '');
  assert.equal(readFrontmatterIcon(out), '');
  assert.match(out, /^---\nhide:\n  - toc\n---\n/);
});

test('write: clearing the only key removes the whole block', () => {
  const out = writeFrontmatterIcon(WITH_ICON, '');
  assert.equal(out, NO_FM);
});

test('write: clearing a file with no frontmatter is a no-op', () => {
  assert.equal(writeFrontmatterIcon(NO_FM, ''), NO_FM);
});

// ── interplay with section edits ─────────────────────────────────────────────

test('frontmatter survives an H1 title save (replaceSectionByUUID)', () => {
  const updated = replaceSectionByUUID(WITH_ICON, 'T1', buildSection(1, 'New Title', 'T1', 'Body text.'));
  assert.match(updated, /^---\nicon: lucide\/user-plus\n---\n/);
  assert.match(updated, /# New Title/);
});

test('writeFrontmatterIcon composes after replaceSectionByUUID (the build() order)', () => {
  let updated = replaceSectionByUUID(WITH_ICON, 'T1', buildSection(1, 'New Title', 'T1', 'Body text.'));
  updated = writeFrontmatterIcon(updated, 'lucide/users');
  assert.equal(readFrontmatterIcon(updated), 'lucide/users');
  assert.match(updated, /# New Title/);
});

console.log(`\n${passed} passed`);
