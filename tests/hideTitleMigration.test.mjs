import assert from 'node:assert/strict';
import { migrateComponentIdentity } from '../scripts/github.js';
import { readHideTitle, writeHideTitle } from '../scripts/frontmatter.js';
import { parseSections, readSectionDescription } from '../scripts/sections.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const GUIDE = 'docs/drafts/some-guide.md';

// A guide carrying the legacy page-level hide-title marker (preamble <style>).
function legacyGuide() {
  const md = ['# Page Title', '<span data-uuid="H1" style="display:none"></span>', '', 'Intro.', '',
    '## Section One', '<span data-uuid="S1" style="display:none"></span>', '', 'Body.', ''].join('\n');
  return writeHideTitle(md, true);
}

test('migration: legacy page marker is removed from the preamble', () => {
  const out = migrateComponentIdentity(GUIDE, legacyGuide());
  assert.equal(readHideTitle(out), false, 'old preamble marker should be gone');
});

test('migration: H1 section gains the per-section hide marker', () => {
  const out = migrateComponentIdentity(GUIDE, legacyGuide());
  const h1 = parseSections(out).find(s => s.level === 1);
  const { hideTitle } = readSectionDescription(out, h1.uuid);
  assert.equal(hideTitle, true, 'H1 should now be hidden per-section');
});

test('migration: non-H1 sections are unaffected', () => {
  const out = migrateComponentIdentity(GUIDE, legacyGuide());
  const s1 = parseSections(out).find(s => s.uuid === 'S1');
  assert.equal(readSectionDescription(out, 'S1').hideTitle, false);
});

test('migration: idempotent — a second pass produces identical output', () => {
  const once = migrateComponentIdentity(GUIDE, legacyGuide());
  const twice = migrateComponentIdentity(GUIDE, once);
  assert.equal(twice, once);
});

test('migration: a guide without the legacy marker is left unchanged (no spurious hide)', () => {
  const md = ['# Page Title', '<span data-uuid="H1" style="display:none"></span>', '', 'Intro.', ''].join('\n');
  const out = migrateComponentIdentity(GUIDE, md);
  assert.equal(readSectionDescription(out, parseSections(out).find(s => s.level === 1).uuid).hideTitle, false);
});

test('migration: H1 UUID span stays the first non-empty line under the heading', () => {
  const out = migrateComponentIdentity(GUIDE, legacyGuide());
  const lines = out.split('\n');
  const h1Line = lines.findIndex(l => /^#\s/.test(l));
  // first non-empty line after the heading carries the UUID
  let i = h1Line + 1;
  while (lines[i] === '') i++;
  assert.match(lines[i], /data-uuid="H1"/);
});

console.log(`\n${passed} passed`);
