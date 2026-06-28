import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { reorderButtonGating } from '../scripts/form.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// Pull a single button's tag out of an actions-bar HTML blob by data-attr.
const btn = (html, attr) => html.match(new RegExp(`<button[^>]*${attr}[^>]*>`))[0];

// ── Reorder Save/Discard gating (shared helper) ────────────────────────────
// Bug 1: Discard stayed permanently disabled. Bug 2: Save never appeared
// disabled because it hard-coded `.success`, which the disabled-dimming CSS
// deliberately excludes. The dirty flag must gate both, and `.success` must
// only ride along while dirty — mirroring the normal "Draft saved" button.

test('clean: aria-disabled on, Save carries no .success', () => {
  const { dis, saveClass } = reorderButtonGating(false);
  assert.equal(dis, ' aria-disabled="true"');
  assert.equal(saveClass, '');
});

test('dirty: aria-disabled off, Save carries .success', () => {
  const { dis, saveClass } = reorderButtonGating(true);
  assert.equal(dis, '');
  assert.match(saveClass, /\bsuccess\b/);
});

// ── KB reorder actions (static HTML) ───────────────────────────────────────
// The KB buttons seeded the native `disabled` attr, but updateReorderUi only
// toggles `aria-disabled` — so Discard stayed permanently disabled. They must
// ship as aria-disabled, and Save must NOT hard-code `.success` (JS toggles it).

test('KB html: reorder buttons use aria-disabled, not native disabled', () => {
  const file = fileURLToPath(new URL('../config/forms/knowledgeBaseManagement.html', import.meta.url));
  const html = readFileSync(file, 'utf8');
  const discard = btn(html, 'data-kb-reorder-discard');
  const save = btn(html, 'data-kb-reorder-save');
  for (const b of [discard, save]) {
    assert.match(b, /aria-disabled="true"/);
    assert.doesNotMatch(b, /\sdisabled(\s|>)/);   // no native disabled attr
  }
  // The commit button's accent (`.publish` — blue "Publish changes to live")
  // is JS-toggled by dirty state, so the static markup must ship WITHOUT it;
  // a baked-in accent stays coloured when disabled (the dimming rule overrides
  // border + text but not an accent's background fill).
  assert.doesNotMatch(save, /\b(publish|success)\b/);
});

console.log(`\n${passed} passed`);
