import assert from 'node:assert/strict';
import { readFrontmatterIcon, writeFrontmatterIcon, readFrontmatterHide, writeFrontmatterHide, readHideTitle, writeHideTitle } from '../scripts/frontmatter.js';
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

// ── hide: read ─────────────────────────────────────────────────────────────────

test('hide read: no frontmatter → []', () => {
  assert.deepEqual(readFrontmatterHide(NO_FM), []);
});

test('hide read: block without a hide key → []', () => {
  assert.deepEqual(readFrontmatterHide(WITH_ICON), []);
});

test('hide read: block-style list → values in order', () => {
  const md = `---\nhide:\n  - navigation\n  - toc\n  - path\n---\n\n${NO_FM}`;
  assert.deepEqual(readFrontmatterHide(md), ['navigation', 'toc', 'path']);
});

test('hide read: single item alongside another key', () => {
  assert.deepEqual(readFrontmatterHide(MULTI_KEY), ['toc']);
});

test('hide read: stops at the next key', () => {
  const md = `---\nhide:\n  - navigation\nicon: lucide/x\n---\n\n${NO_FM}`;
  assert.deepEqual(readFrontmatterHide(md), ['navigation']);
});

test('hide read: tolerates inline flow style', () => {
  const md = `---\nhide: [navigation, toc]\n---\n\n${NO_FM}`;
  assert.deepEqual(readFrontmatterHide(md), ['navigation', 'toc']);
});

// ── hide: write ────────────────────────────────────────────────────────────────

test('hide write: creates a block when the file has none', () => {
  const out = writeFrontmatterHide(NO_FM, ['navigation', 'toc']);
  assert.equal(out, `---\nhide:\n  - navigation\n  - toc\n---\n\n${NO_FM}`);
  assert.deepEqual(readFrontmatterHide(out), ['navigation', 'toc']);
});

test('hide write: empty list on a file with no frontmatter is a no-op', () => {
  assert.equal(writeFrontmatterHide(NO_FM, []), NO_FM);
});

test('hide write: appends the block, preserving other keys', () => {
  const out = writeFrontmatterHide(WITH_ICON, ['navigation']);
  assert.match(out, /^---\nicon: lucide\/user-plus\nhide:\n  - navigation\n---\n/);
  assert.equal(readFrontmatterIcon(out), 'lucide/user-plus');
});

test('hide write: replaces an existing list in place', () => {
  const md = `---\nhide:\n  - toc\n---\n\n${NO_FM}`;
  const out = writeFrontmatterHide(md, ['navigation', 'path']);
  assert.deepEqual(readFrontmatterHide(out), ['navigation', 'path']);
  assert.equal(out, `---\nhide:\n  - navigation\n  - path\n---\n\n${NO_FM}`);
});

test('hide write: clearing removes the key but keeps other keys', () => {
  const out = writeFrontmatterHide(MULTI_KEY, []);
  assert.deepEqual(readFrontmatterHide(out), []);
  assert.match(out, /^---\nicon: lucide\/user-plus\n---\n/);
  assert.equal(readFrontmatterIcon(out), 'lucide/user-plus');
});

test('hide write: clearing the only key removes the whole block', () => {
  const md = `---\nhide:\n  - toc\n---\n\n${NO_FM}`;
  assert.equal(writeFrontmatterHide(md, []), NO_FM);
});

test('hide write: no-ops cleanly when there is nothing to remove', () => {
  assert.equal(writeFrontmatterHide(WITH_ICON, []), WITH_ICON);
});

// ── hide + icon: the build() composition order ───────────────────────────────────

test('hide composes with writeFrontmatterIcon (icon then hide, like build())', () => {
  let out = writeFrontmatterIcon(NO_FM, 'lucide/users');
  out = writeFrontmatterHide(out, ['navigation', 'toc']);
  assert.equal(readFrontmatterIcon(out), 'lucide/users');
  assert.deepEqual(readFrontmatterHide(out), ['navigation', 'toc']);
  assert.match(out, /^---\nicon: lucide\/users\nhide:\n  - navigation\n  - toc\n---\n/);
});

test('clearing both icon and hide drops the whole block', () => {
  const md = `---\nicon: lucide/x\nhide:\n  - toc\n---\n\n${NO_FM}`;
  let out = writeFrontmatterIcon(md, '');
  out = writeFrontmatterHide(out, []);
  assert.equal(out, NO_FM);
});

test('hide round-trips through read → write unchanged', () => {
  const md = `---\nicon: lucide/x\nhide:\n  - navigation\n  - toc\n---\n\n${NO_FM}`;
  const out = writeFrontmatterHide(md, readFrontmatterHide(md));
  assert.equal(out, md);
});

// ── hide page title (body <style> marker) ───────────────────────────────────────

const HAS_FM_AND_H1 = `---
icon: lucide/x
---

# Adding an Employee
<span data-uuid="T1" style="display:none"></span>

Body text.
`;

test('hide-title read: absent → false', () => {
  assert.equal(readHideTitle(HAS_FM_AND_H1), false);
  assert.equal(readHideTitle(NO_FM), false);
});

test('hide-title write: inserts after frontmatter, before the H1', () => {
  const out = writeHideTitle(HAS_FM_AND_H1, true);
  assert.equal(readHideTitle(out), true);
  // marker sits between the closing --- and the first heading
  assert.match(out, /---\n\n<style data-mb-hide-title>[^\n]*<\/style>\n\n# Adding an Employee/);
  // the H1 line itself is untouched (no attr_list, no inline style)
  assert.match(out, /^# Adding an Employee$/m);
});

test('hide-title write: inserts at the top when there is no frontmatter', () => {
  const out = writeHideTitle(NO_FM, true);
  assert.equal(readHideTitle(out), true);
  assert.match(out, /^<style data-mb-hide-title>[^\n]*<\/style>\n\n# Adding an Employee/);
});

test('hide-title write: enabling twice is idempotent', () => {
  const once = writeHideTitle(HAS_FM_AND_H1, true);
  assert.equal(writeHideTitle(once, true), once);
});

test('hide-title write: disabling removes the marker and restores the original', () => {
  const on = writeHideTitle(HAS_FM_AND_H1, true);
  assert.equal(writeHideTitle(on, false), HAS_FM_AND_H1);
});

test('hide-title write: disabling when absent is a no-op', () => {
  assert.equal(writeHideTitle(HAS_FM_AND_H1, false), HAS_FM_AND_H1);
});

test('hide-title SURVIVES a title rename (the key requirement)', () => {
  const hidden = writeHideTitle(HAS_FM_AND_H1, true);
  // Rename the H1 the way submitEditGuideSection does.
  const renamed = replaceSectionByUUID(hidden, 'T1', buildSection(1, 'New Title', 'T1', 'Body text.'));
  assert.equal(readHideTitle(renamed), true, 'marker must survive the rename');
  assert.match(renamed, /# New Title/);
  assert.match(renamed, /^# New Title$/m); // heading text is clean, not polluted by the marker
});

test('hide-title marker targets ONLY the H1 adjacent to the marker (not every H1)', () => {
  const out = writeHideTitle(NO_FM, true);
  // Anchored on the marker element + adjacent sibling — cannot match later H1s.
  assert.match(out, /<style data-mb-hide-title>style\[data-mb-hide-title\]\+h1\{display:none\}<\/style>/);
  assert.doesNotMatch(out, /first-of-type/); // the old, over-broad selector is gone
});

test('hide-title re-save migrates a stale (over-broad) marker selector', () => {
  const stale = `---\nicon: x\n---\n\n<style data-mb-hide-title>.md-typeset h1:first-of-type{display:none}</style>\n\n# Title\n`;
  assert.equal(readHideTitle(stale), true);
  const fixed = writeHideTitle(stale, true);
  assert.match(fixed, /style\[data-mb-hide-title\]\+h1/);
  assert.doesNotMatch(fixed, /first-of-type/);
  // exactly one marker block after migration (count opening <style> tags)
  assert.equal((fixed.match(/<style data-mb-hide-title>/g) || []).length, 1);
});

test('hide-title composes with icon + hide in build() order', () => {
  let out = writeFrontmatterIcon(NO_FM, 'lucide/users');
  out = writeFrontmatterHide(out, ['navigation']);
  out = writeHideTitle(out, true);
  assert.equal(readFrontmatterIcon(out), 'lucide/users');
  assert.deepEqual(readFrontmatterHide(out), ['navigation']);
  assert.equal(readHideTitle(out), true);
  // marker lands after the (icon+hide) frontmatter block, before the body
  assert.match(out, /---\n\n<style data-mb-hide-title>/);
});

console.log(`\n${passed} passed`);
