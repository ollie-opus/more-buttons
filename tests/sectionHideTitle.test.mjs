import assert from 'node:assert/strict';
import {
  readHideSectionTitle,
  writeHideSectionTitle,
  buildSection,
  readSectionDescription,
  HIDE_SECTION_TITLE_BLOCK,
} from '../scripts/sections.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// ── readHideSectionTitle ──────────────────────────────────────────────────────
test('readHideSectionTitle: false for a plain body', () => {
  assert.equal(readHideSectionTitle('Just some description.'), false);
});

test('readHideSectionTitle: true when the marker is present', () => {
  const body = `${HIDE_SECTION_TITLE_BLOCK}\n\nDescription.`;
  assert.equal(readHideSectionTitle(body), true);
});

// ── writeHideSectionTitle ─────────────────────────────────────────────────────
test('writeHideSectionTitle(true): prepends the marker before the body', () => {
  const out = writeHideSectionTitle('Body text.', true);
  assert.equal(out, `${HIDE_SECTION_TITLE_BLOCK}\n\nBody text.`);
  assert.equal(readHideSectionTitle(out), true);
});

test('writeHideSectionTitle(true): marker only, when body is empty', () => {
  assert.equal(writeHideSectionTitle('', true), HIDE_SECTION_TITLE_BLOCK);
});

test('writeHideSectionTitle(true): idempotent — no duplicate marker on re-write', () => {
  const once = writeHideSectionTitle('Body.', true);
  const twice = writeHideSectionTitle(once, true);
  assert.equal(twice, once);
});

test('writeHideSectionTitle(false): strips an existing marker', () => {
  const hidden = writeHideSectionTitle('Body.', true);
  assert.equal(writeHideSectionTitle(hidden, false), 'Body.');
});

test('writeHideSectionTitle(false): no-op on a body without the marker', () => {
  assert.equal(writeHideSectionTitle('Body.', false), 'Body.');
});

// ── the rendered marker hides exactly the preceding heading ───────────────────
test('HIDE_SECTION_TITLE_BLOCK uses a previous-sibling :has selector keyed to itself', () => {
  // The marker must hide the heading that precedes it (the span sits between),
  // and must be self-scoped so it only targets its own section.
  assert.match(HIDE_SECTION_TITLE_BLOCK, /data-mb-hide-section-title/);
  assert.match(HIDE_SECTION_TITLE_BLOCK, /:has\(/);
  assert.match(HIDE_SECTION_TITLE_BLOCK, /display:\s*none/);
});

// ── readSectionDescription integration ────────────────────────────────────────
test('readSectionDescription: reports hideTitle and strips the marker from the description', () => {
  const body = writeHideSectionTitle('Visible description.', true);
  const md = buildSection(2, 'My Section', 'sec-1', body);
  const { descriptionMarkdown, hideTitle } = readSectionDescription(md, 'sec-1');
  assert.equal(hideTitle, true);
  assert.equal(descriptionMarkdown, 'Visible description.');
});

test('readSectionDescription: hideTitle false and clean description when not hidden', () => {
  const md = buildSection(2, 'My Section', 'sec-1', 'Visible description.');
  const { descriptionMarkdown, hideTitle } = readSectionDescription(md, 'sec-1');
  assert.equal(hideTitle, false);
  assert.equal(descriptionMarkdown, 'Visible description.');
});

test('round-trip: marker survives buildSection and the span stays first non-empty line', () => {
  const body = writeHideSectionTitle('Desc.', true);
  const md = buildSection(2, 'Title', 'sec-x', body);
  // UUID span must remain the first non-empty line under the heading.
  const lines = md.split('\n');
  assert.match(lines[0], /^## Title$/);
  assert.match(lines[1], /data-uuid="sec-x"/);
  // marker appears after the span, before the description
  assert.ok(md.indexOf('data-uuid="sec-x"') < md.indexOf('data-mb-hide-section-title'));
  assert.ok(md.indexOf('data-mb-hide-section-title') < md.indexOf('Desc.'));
});

// ── trailing `---` separator is real body content, not stripped ──────────────
test('readSectionDescription: a trailing --- separator is preserved', () => {
  const md = buildSection(2, 'My Section', 'sec-1', 'Intro.\n\n---') +
    '\n\n## Next\n<span data-uuid="sec-2" style="display:none"></span>\n\nmore';
  const { descriptionMarkdown } = readSectionDescription(md, 'sec-1');
  assert.equal(descriptionMarkdown, 'Intro.\n\n---');
});

test('readSectionDescription: a separator-only body round-trips (regression: was stripped to "")', () => {
  // Mirrors the reported bug: a hidden-title section whose only content is `---`.
  const body = writeHideSectionTitle('---', true);
  const md = buildSection(2, '-', 'sec-1', body) +
    '\n\n## Next\n<span data-uuid="sec-2" style="display:none"></span>\n\nmore';
  const { descriptionMarkdown, hideTitle } = readSectionDescription(md, 'sec-1');
  assert.equal(hideTitle, true);
  assert.equal(descriptionMarkdown, '---');
});

console.log(`\n${passed} passed`);
