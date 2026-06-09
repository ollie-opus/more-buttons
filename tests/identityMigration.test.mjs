import assert from 'node:assert/strict';
import { migrateComponentIdentity } from '../scripts/github.js';
import { locateCaptureLines } from '../scripts/components.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const capture = (slug) => [
  `![](../assets/${slug}-light-mode.png#only-light){ width="800" }`,
  `![](../assets/${slug}-dark-mode.png#only-dark)`,
].join('\n');

// ── The bug: uuid-less captures in component containers ───────────────────────

test('guide draft: a uuid-less capture gets a data-uuid span backfilled', () => {
  const md = ['# Title', '', '## Section One', '', capture('a'), ''].join('\n');
  const out = migrateComponentIdentity('docs/drafts/some-guide.md', md);
  const [c] = locateCaptureLines(out);
  assert.ok(c.uuid, 'capture should have a uuid after migration');
});

test('guide live page (docs/pages): captures migrate there too', () => {
  const md = ['# Title', '', capture('b'), ''].join('\n');
  const out = migrateComponentIdentity('docs/pages/some-guide.md', md);
  const [c] = locateCaptureLines(out);
  assert.ok(c.uuid, 'capture should have a uuid after migration');
});

test('guide draft: sections also get uuids (mirrors createGuideDraft)', () => {
  const md = ['# Title', '', '## Section One', ''].join('\n');
  const out = migrateComponentIdentity('docs/drafts/some-guide.md', md);
  assert.match(out, /<span data-uuid="[^"]+"/, 'a section uuid span should be injected');
});

test('system-updates.md: captures in update bodies get uuids', () => {
  const md = ['/// feature-release | New | 5th June 2026', '', capture('c'), '///', ''].join('\n');
  const out = migrateComponentIdentity('docs/pages/system-updates.md', md);
  const [c] = locateCaptureLines(out);
  assert.ok(c.uuid, 'capture should have a uuid after migration');
});

test('system-updates drafts file is also migrated', () => {
  const md = ['/// feature-release | New | 5th June 2026', '', capture('d'), '///', ''].join('\n');
  const out = migrateComponentIdentity('docs/drafts/system-updates.md', md);
  const [c] = locateCaptureLines(out);
  assert.ok(c.uuid, 'capture should have a uuid after migration');
});

// ── Safety: never touch non-component files ───────────────────────────────────

test('non-component file (zensical.toml) is returned byte-for-byte unchanged', () => {
  const toml = '[nav]\nitems = []\n# ![](../assets/x-light-mode.png#only-light)\n';
  assert.equal(migrateComponentIdentity('zensical.toml', toml), toml);
});

test('arbitrary non-docs markdown is left unchanged', () => {
  const md = ['# Readme', '', capture('e'), ''].join('\n');
  assert.equal(migrateComponentIdentity('README.md', md), md);
});

// ── Idempotence: a migrated file reads through with no further change ──────────

test('idempotent: migrating twice equals migrating once', () => {
  const md = ['# Title', '', '## Section', '', capture('f'), ''].join('\n');
  const once = migrateComponentIdentity('docs/drafts/g.md', md);
  const twice = migrateComponentIdentity('docs/drafts/g.md', once);
  assert.equal(twice, once);
});

test('already-migrated capture is not double-spanned', () => {
  const md = ['# Title', '', capture('g')].join('\n');
  const once = migrateComponentIdentity('docs/drafts/g.md', md);
  const spanCount = (once.match(/data-uuid/g) || []).length;
  const twice = migrateComponentIdentity('docs/drafts/g.md', once);
  assert.equal((twice.match(/data-uuid/g) || []).length, spanCount);
});

console.log(`\n${passed} passed`);
