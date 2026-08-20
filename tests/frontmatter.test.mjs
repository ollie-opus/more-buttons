import assert from 'node:assert/strict';
import { readFrontmatterIcon, writeFrontmatterIcon, readFrontmatterHide, writeFrontmatterHide, readFrontmatterTags, writeFrontmatterTags, splitTagList, readHideTitle, writeHideTitle, applyPageSettingsFrontmatter } from '../scripts/frontmatter.js';
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

// ── tags: read ─────────────────────────────────────────────────────────────────

test('tags read: no frontmatter → []', () => {
  assert.deepEqual(readFrontmatterTags(NO_FM), []);
});

test('tags read: block without a tags key → []', () => {
  assert.deepEqual(readFrontmatterTags(MULTI_KEY), []);
});

test('tags read: block-style list → values in order', () => {
  const md = `---\ntags:\n  - System\n  - Contractors\n---\n\n${NO_FM}`;
  assert.deepEqual(readFrontmatterTags(md), ['System', 'Contractors']);
});

test('tags read: tolerates inline flow style with quotes', () => {
  const md = `---\ntags: [System, "Contractors"]\n---\n\n${NO_FM}`;
  assert.deepEqual(readFrontmatterTags(md), ['System', 'Contractors']);
});

test('tags read: does not bleed into the hide list (and vice versa)', () => {
  const md = `---\ntags:\n  - System\nhide:\n  - toc\n---\n\n${NO_FM}`;
  assert.deepEqual(readFrontmatterTags(md), ['System']);
  assert.deepEqual(readFrontmatterHide(md), ['toc']);
});

test('tags read: the exact KB-repo shape round-trips', () => {
  const md = `---\ntags:\n  - System\n---\n\n${NO_FM}`;
  const out = writeFrontmatterTags(md, readFrontmatterTags(md));
  assert.equal(out, md);
});

// ── tags: write ────────────────────────────────────────────────────────────────

test('tags write: creates a block when the file has none', () => {
  const out = writeFrontmatterTags(NO_FM, ['System', 'Contractors']);
  assert.equal(out, `---\ntags:\n  - System\n  - Contractors\n---\n\n${NO_FM}`);
  assert.deepEqual(readFrontmatterTags(out), ['System', 'Contractors']);
});

test('tags write: appends the block, preserving icon and hide', () => {
  const out = writeFrontmatterTags(MULTI_KEY, ['System']);
  assert.match(out, /^---\nicon: lucide\/user-plus\nhide:\n  - toc\ntags:\n  - System\n---\n/);
  assert.equal(readFrontmatterIcon(out), 'lucide/user-plus');
  assert.deepEqual(readFrontmatterHide(out), ['toc']);
});

test('tags write: replaces an existing block-style list', () => {
  const md = `---\ntags:\n  - System\n---\n\n${NO_FM}`;
  const out = writeFrontmatterTags(md, ['Contractors', 'Safety']);
  assert.equal(out, `---\ntags:\n  - Contractors\n  - Safety\n---\n\n${NO_FM}`);
});

test('tags write: replaces an inline-flow list with block style', () => {
  const md = `---\ntags: [System, Contractors]\n---\n\n${NO_FM}`;
  const out = writeFrontmatterTags(md, ['Safety']);
  assert.equal(out, `---\ntags:\n  - Safety\n---\n\n${NO_FM}`);
});

test('tags write: trims, drops empties, dedupes case-insensitively (first spelling wins)', () => {
  const out = writeFrontmatterTags(NO_FM, [' System ', '', 'contractors', 'SYSTEM']);
  assert.deepEqual(readFrontmatterTags(out), ['System', 'contractors']);
});

test('tags write: empty list removes the key but keeps other keys', () => {
  const md = `---\nicon: lucide/x\ntags:\n  - System\n---\n\n${NO_FM}`;
  const out = writeFrontmatterTags(md, []);
  assert.deepEqual(readFrontmatterTags(out), []);
  assert.match(out, /^---\nicon: lucide\/x\n---\n/);
});

test('tags write: clearing the only key removes the whole block', () => {
  const md = `---\ntags:\n  - System\n---\n\n${NO_FM}`;
  assert.equal(writeFrontmatterTags(md, []), NO_FM);
});

test('tags write: empty list on a file with no tags key is a no-op', () => {
  assert.equal(writeFrontmatterTags(WITH_ICON, []), WITH_ICON);
  assert.equal(writeFrontmatterTags(NO_FM, []), NO_FM);
});

test('tags compose with icon + hide in build() order', () => {
  let out = writeFrontmatterIcon(NO_FM, 'lucide/users');
  out = writeFrontmatterTags(out, ['System']);
  out = writeFrontmatterHide(out, ['toc']);
  assert.equal(readFrontmatterIcon(out), 'lucide/users');
  assert.deepEqual(readFrontmatterTags(out), ['System']);
  assert.deepEqual(readFrontmatterHide(out), ['toc']);
});

// ── applyPageSettingsFrontmatter (shared by Page settings save + Create guide) ──

test('applyPageSettingsFrontmatter: writes icon, tags, hide from scratch in build() order', () => {
  const out = applyPageSettingsFrontmatter(NO_FM, {
    icon: 'lucide/users', tags: ['Using OCC', 'System'], hide: { navigation: false, toc: true, path: true },
  });
  assert.equal(readFrontmatterIcon(out), 'lucide/users');
  assert.deepEqual(readFrontmatterTags(out), ['Using OCC', 'System']);
  assert.deepEqual(readFrontmatterHide(out), ['toc', 'path']);
  // Same bytes as the hand-composed sequence the page-settings build() used to run.
  let manual = writeFrontmatterIcon(NO_FM, 'lucide/users');
  manual = writeFrontmatterTags(manual, ['Using OCC', 'System']);
  manual = writeFrontmatterHide(manual, ['toc', 'path']);
  assert.equal(out, manual);
});

test('applyPageSettingsFrontmatter: preserves unmanaged hide values in place, drops unticked managed ones', () => {
  const md = `---
hide:
  - footer
  - toc
  - navigation
---

${NO_FM}`;
  const out = applyPageSettingsFrontmatter(md, { icon: '', tags: [], hide: { navigation: false, toc: true, path: true } });
  assert.deepEqual(readFrontmatterHide(out), ['footer', 'toc', 'path']);
  assert.equal(readFrontmatterIcon(out), '');
  assert.deepEqual(readFrontmatterTags(out), []);
});

test('applyPageSettingsFrontmatter: written-for is a managed hide value (written when ticked, dropped when not, position kept)', () => {
  const on = applyPageSettingsFrontmatter(NO_FM, { icon: '', tags: [], hide: { writtenFor: true } });
  assert.deepEqual(readFrontmatterHide(on), ['written-for']);
  const off = applyPageSettingsFrontmatter(on, { icon: '', tags: [], hide: { writtenFor: false } });
  assert.deepEqual(readFrontmatterHide(off), []);
  const md = `---
hide:
  - written-for
  - footer
  - toc
---

${NO_FM}`;
  const kept = applyPageSettingsFrontmatter(md, { icon: '', tags: [], hide: { toc: true, writtenFor: true, path: true } });
  assert.deepEqual(readFrontmatterHide(kept), ['written-for', 'footer', 'toc', 'path']);
  const dropped = applyPageSettingsFrontmatter(md, { icon: '', tags: [], hide: { toc: true } });
  assert.deepEqual(readFrontmatterHide(dropped), ['footer', 'toc']);
});

test('applyPageSettingsFrontmatter: empty settings on a bare file leave it untouched', () => {
  assert.equal(applyPageSettingsFrontmatter(NO_FM, { icon: '', tags: [], hide: {} }), NO_FM);
});

// ── splitTagList ───────────────────────────────────────────────────────────────

test('splitTagList: trims, drops empties, dedupes case-insensitively', () => {
  assert.deepEqual(splitTagList('System, contractors,, System '), ['System', 'contractors']);
});

test('splitTagList: empty/nullish input → []', () => {
  assert.deepEqual(splitTagList(''), []);
  assert.deepEqual(splitTagList('  ,  , '), []);
  assert.deepEqual(splitTagList(null), []);
  assert.deepEqual(splitTagList(undefined), []);
});

test('splitTagList: single tag, no comma', () => {
  assert.deepEqual(splitTagList('System'), ['System']);
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
