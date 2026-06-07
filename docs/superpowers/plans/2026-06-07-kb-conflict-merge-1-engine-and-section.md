# KB Conflict Merge — Plan 1: Engine + Resolver + Guide Section

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the three-way field-merge engine and inline conflict resolver, and wire them into the guide-section edit save so two sessions editing the same section no longer silently clobber each other.

**Architecture:** A pure, unit-tested merge function (`scripts/formMerge.js`) computes per-field outcomes from three values — baseline (`formEl._initialSnapshot`), your form value (`readFormValues`), and the freshly-fetched markdown value. A DOM resolver (`scripts/conflictResolver.js`) prompts on true collisions. An orchestrator (`scripts/mergeSave.js`) runs the merge *inside* the existing `githubFetchAndPushFile` builder (so the read that feeds the merge is the same fetch the PUT commits against — no TOCTOU window), throwing `ConflictNeeded` to drive the resolver and retry loop. The guide-section saver is refactored to drive its save through the orchestrator.

**Tech Stack:** Vanilla ES modules (Chrome extension, no build step). Tests via Node's built-in runner (`node --test tests/*.test.mjs`) with `node:assert/strict` and the repo's existing custom `test()` helper. No DOM test harness — DOM and GitHub-wiring code is verified manually in the browser.

**Spec:** `docs/superpowers/specs/2026-06-07-kb-form-conflict-merge-design.md`

---

## File Structure

- **Create `scripts/formMerge.js`** — pure merge engine: `mergeFields(snap, cur, fresh, fieldSpecs, resolutions)` and `class ConflictNeeded`. No DOM, no network — fully unit-testable.
- **Create `tests/formMerge.test.mjs`** — unit tests for `mergeFields`.
- **Create `scripts/conflictResolver.js`** — `showConflictResolver(formEl, conflicts)`: renders an inline panel into the form, returns a promise of `{field: 'mine'|'theirs'}`. DOM-only, self-styled inline (no CSS-file dependency).
- **Create `scripts/mergeSave.js`** — `mergeSave({formEl, file, fieldSpecs, readFresh, build, onProgress})`: the conflict-aware save loop reused by every scalar form. Imports the pure engine + the resolver + `githubFetchAndPushFile` + form helpers.
- **Modify `scripts/form.js`** — export the currently-private `readFormValues`.
- **Modify `scripts/guides.js`** — refactor the edit-mode branch of `saveSectionForComponent` to drive its save via `mergeSave`.
- **Modify `manifest.json`** — add the three new scripts to `web_accessible_resources`.

---

## Task 1: Pure merge engine + unit tests

**Files:**
- Create: `scripts/formMerge.js`
- Test: `tests/formMerge.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/formMerge.test.mjs` (mirrors the repo's existing test idiom — a custom `test()` helper + `node:assert/strict`):

```js
import assert from 'node:assert/strict';
import { mergeFields, ConflictNeeded } from '../scripts/formMerge.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const SPECS = [
  { name: 'title', type: 'scalar', label: 'Title' },
  { name: 'desc', type: 'scalar', label: 'Description' },
];

test('untouched field takes fresh (theirs)', () => {
  const snap  = { title: 'A', desc: 'D' };
  const cur   = { title: 'A', desc: 'D' };           // user changed nothing
  const fresh = { title: 'A2', desc: 'D' };          // someone else changed title
  const { resolved, conflicts } = mergeFields(snap, cur, fresh, SPECS);
  assert.equal(conflicts.length, 0);
  assert.equal(resolved.title, 'A2');                // theirs
  assert.equal(resolved.desc, 'D');
});

test('only-you-changed takes yours', () => {
  const snap  = { title: 'A', desc: 'D' };
  const cur   = { title: 'A', desc: 'D2' };          // you changed desc
  const fresh = { title: 'A', desc: 'D' };           // theirs unchanged
  const { resolved, conflicts } = mergeFields(snap, cur, fresh, SPECS);
  assert.equal(conflicts.length, 0);
  assert.equal(resolved.desc, 'D2');                 // yours
});

test('same edit both sides is not a conflict', () => {
  const snap  = { title: 'A', desc: 'D' };
  const cur   = { title: 'A', desc: 'SAME' };
  const fresh = { title: 'A', desc: 'SAME' };
  const { resolved, conflicts } = mergeFields(snap, cur, fresh, SPECS);
  assert.equal(conflicts.length, 0);
  assert.equal(resolved.desc, 'SAME');
});

test('true collision is reported as a conflict (not auto-resolved)', () => {
  const snap  = { title: 'A', desc: 'D' };
  const cur   = { title: 'MINE', desc: 'D' };
  const fresh = { title: 'THEIRS', desc: 'D' };
  const { resolved, conflicts } = mergeFields(snap, cur, fresh, SPECS);
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0], { field: 'title', label: 'Title', mine: 'MINE', theirs: 'THEIRS' });
  assert.equal('title' in resolved, false);          // unresolved field is omitted
});

test('recorded resolution choose-mine applies when fresh is stable', () => {
  const snap  = { title: 'A' };
  const cur   = { title: 'MINE' };
  const fresh = { title: 'THEIRS' };
  const resolutions = { title: { choice: 'mine', theirsShown: 'THEIRS' } };
  const { resolved, conflicts } = mergeFields(snap, cur, fresh, [SPECS[0]], resolutions);
  assert.equal(conflicts.length, 0);
  assert.equal(resolved.title, 'MINE');
});

test('recorded resolution choose-theirs applies when fresh is stable', () => {
  const snap  = { title: 'A' };
  const cur   = { title: 'MINE' };
  const fresh = { title: 'THEIRS' };
  const resolutions = { title: { choice: 'theirs', theirsShown: 'THEIRS' } };
  const { resolved, conflicts } = mergeFields(snap, cur, fresh, [SPECS[0]], resolutions);
  assert.equal(conflicts.length, 0);
  assert.equal(resolved.title, 'THEIRS');
});

test('recorded resolution re-prompts when fresh moved again', () => {
  const snap  = { title: 'A' };
  const cur   = { title: 'MINE' };
  const fresh = { title: 'THEIRS_V2' };              // changed since user resolved
  const resolutions = { title: { choice: 'mine', theirsShown: 'THEIRS' } };
  const { conflicts } = mergeFields(snap, cur, fresh, [SPECS[0]], resolutions);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].theirs, 'THEIRS_V2');
});

test('ConflictNeeded carries the conflicts array', () => {
  const e = new ConflictNeeded([{ field: 'x' }]);
  assert.ok(e instanceof Error);
  assert.equal(e.name, 'ConflictNeeded');
  assert.deepEqual(e.conflicts, [{ field: 'x' }]);
});

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/formMerge.test.mjs`
Expected: FAIL — cannot import `../scripts/formMerge.js` (module not found).

- [ ] **Step 3: Write the implementation**

Create `scripts/formMerge.js`:

```js
/**
 * formMerge.js — pure three-way field merge for markdown-backed forms.
 *
 * For each field we compare three values:
 *   snap  — baseline captured at form-open (formEl._initialSnapshot[name])
 *   cur   — the user's current form value (readFormValues(formEl)[name])
 *   fresh — the value parsed out of the freshly re-fetched markdown
 *
 * No DOM, no network — kept pure so it is fully unit-testable.
 */

/** Thrown by a save builder when unresolved conflicts need user input. */
export class ConflictNeeded extends Error {
  constructor(conflicts) {
    super('Merge conflict requires resolution');
    this.name = 'ConflictNeeded';
    this.conflicts = conflicts;
  }
}

function scalarEqual(a, b) {
  return a === b;
}

/**
 * @param {Object} snap  - baseline field values
 * @param {Object} cur   - current form field values
 * @param {Object} fresh - field values parsed from fresh markdown
 * @param {Array<{name:string,type:string,label:string}>} fieldSpecs
 * @param {Object} [resolutions] - { [field]: { choice:'mine'|'theirs', theirsShown } }
 * @returns {{ resolved: Object, conflicts: Array<{field,label,mine,theirs}> }}
 */
export function mergeFields(snap = {}, cur = {}, fresh = {}, fieldSpecs = [], resolutions = {}) {
  const resolved = {};
  const conflicts = [];

  for (const spec of fieldSpecs) {
    const { name, label } = spec;
    const s = snap[name];
    const c = cur[name];
    const f = fresh[name];

    if (scalarEqual(c, s)) { resolved[name] = f; continue; }   // untouched → theirs
    if (scalarEqual(f, s)) { resolved[name] = c; continue; }   // only you → yours
    if (scalarEqual(f, c)) { resolved[name] = c; continue; }   // same edit → fine

    // true collision — honour a recorded choice only if theirs hasn't moved since.
    const r = resolutions[name];
    if (r && scalarEqual(f, r.theirsShown)) {
      resolved[name] = r.choice === 'mine' ? c : f;
      continue;
    }
    conflicts.push({ field: name, label, mine: c, theirs: f });
  }

  return { resolved, conflicts };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/formMerge.test.mjs`
Expected: PASS — `8 passed` and `✔ tests/formMerge.test.mjs`.

- [ ] **Step 5: Commit**

```bash
git add scripts/formMerge.js tests/formMerge.test.mjs
git commit -m "feat(merge): pure three-way field-merge engine + tests"
```

---

## Task 2: Export `readFormValues` from form.js

**Files:**
- Modify: `scripts/form.js:147`

- [ ] **Step 1: Make the function exported**

In `scripts/form.js`, change the declaration at line 147 from:

```js
function readFormValues(formEl) {
```

to:

```js
export function readFormValues(formEl) {
```

Leave the body unchanged.

- [ ] **Step 2: Verify nothing else broke**

Run: `node --test tests/*.test.mjs`
Expected: PASS — all existing test files still pass (the change is additive; `readFormValues` was previously only used internally).

- [ ] **Step 3: Commit**

```bash
git add scripts/form.js
git commit -m "refactor(form): export readFormValues for the merge orchestrator"
```

---

## Task 3: Inline conflict resolver (DOM)

**Files:**
- Create: `scripts/conflictResolver.js`

> Not unit-tested (DOM). Verified manually in Task 7.

- [ ] **Step 1: Write the implementation**

Create `scripts/conflictResolver.js`:

```js
/**
 * conflictResolver.js — inline per-field conflict resolution.
 *
 * Renders one row per conflicting field into the form's overlay content with
 * "Use theirs" / "Keep mine" buttons. Resolves once every field has a choice.
 * Styled inline so there is no CSS-file dependency.
 */

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {HTMLElement} formEl
 * @param {Array<{field,label,mine,theirs}>} conflicts
 * @returns {Promise<{ [field]: 'mine'|'theirs' }>}
 */
export function showConflictResolver(formEl, conflicts) {
  return new Promise(resolve => {
    const host = formEl.parentElement || formEl;
    host.querySelector('[data-conflict-panel]')?.remove();

    const panel = document.createElement('div');
    panel.setAttribute('data-conflict-panel', '');
    panel.style.cssText =
      'border:1px solid #d97706;background:#fffbeb;border-radius:8px;padding:12px;margin:12px 0;';

    const rows = conflicts.map(c => `
      <div data-conflict-field="${esc(c.field)}" style="padding:8px 0;border-top:1px solid #fde68a;">
        <p style="margin:0 0 4px;font-weight:600;">⚠ "${esc(c.label)}" changed in another tab since you opened this:</p>
        <p style="margin:0 0 2px;"><strong>theirs:</strong> ${esc(c.theirs)}</p>
        <p style="margin:0 0 6px;"><strong>mine:</strong> ${esc(c.mine)}</p>
        <div style="display:flex;gap:8px;">
          <button type="button" class="more-buttons-button" data-choose="theirs">Use theirs</button>
          <button type="button" class="more-buttons-button success" data-choose="mine">Keep mine</button>
        </div>
      </div>`).join('');

    panel.innerHTML =
      `<div style="font-weight:700;margin-bottom:4px;">Resolve conflicts to save</div>${rows}`;
    host.prepend(panel);

    const chosen = {};
    panel.addEventListener('click', e => {
      const btn = e.target.closest('[data-choose]');
      if (!btn) return;
      const row = btn.closest('[data-conflict-field]');
      chosen[row.dataset.conflictField] = btn.dataset.choose;
      row.querySelectorAll('[data-choose]').forEach(b => { b.disabled = true; });
      btn.style.outline = '2px solid #2563eb';
      if (conflicts.every(c => chosen[c.field])) {
        panel.remove();
        resolve(chosen);
      }
    });
  });
}
```

- [ ] **Step 2: Syntax-check the module**

Run: `node --check scripts/conflictResolver.js`
Expected: no output (exit 0) — the file parses.

- [ ] **Step 3: Commit**

```bash
git add scripts/conflictResolver.js
git commit -m "feat(merge): inline conflict resolver UI"
```

---

## Task 4: Save orchestrator

**Files:**
- Create: `scripts/mergeSave.js`

> Not unit-tested (uses GitHub + DOM). Verified manually in Task 7.

- [ ] **Step 1: Write the implementation**

Create `scripts/mergeSave.js`:

```js
/**
 * mergeSave.js — conflict-aware save loop shared by all scalar forms.
 *
 * The merge runs INSIDE the githubFetchAndPushFile builder, against the same
 * fresh fetch the PUT commits with — so there is no read-then-write window.
 * On unresolved conflicts the builder throws ConflictNeeded; we surface the
 * inline resolver, record the user's choices, and retry. A recorded choice is
 * re-applied only while "theirs" is unchanged; if it moved again we re-prompt.
 */

import { mergeFields, ConflictNeeded } from './formMerge.js';
import { showConflictResolver } from './conflictResolver.js';
import { githubFetchAndPushFile } from './github.js';
import { readFormValues, resetDirtyBaseline } from './form.js';

/**
 * @param {Object} opts
 * @param {HTMLElement} opts.formEl
 * @param {string} opts.file - repo path to fetch + push
 * @param {Array<{name,type,label}>} opts.fieldSpecs
 * @param {(md:string)=>Object} opts.readFresh - parse fresh field values from md
 * @param {(md:string, resolved:Object)=>string} opts.build - build updated md
 * @param {(msg:string)=>void} [opts.onProgress]
 * @returns {Promise<Object>} the resolved values that were written
 */
export async function mergeSave({ formEl, file, fieldSpecs, readFresh, build, onProgress = () => {} }) {
  const snap = formEl._initialSnapshot ?? {};
  const resolutions = {};
  let lastResolved = null;

  for (;;) {
    try {
      await githubFetchAndPushFile(file, onProgress, md => {
        const cur = readFormValues(formEl);
        const fresh = readFresh(md);
        const { resolved, conflicts } = mergeFields(snap, cur, fresh, fieldSpecs, resolutions);
        if (conflicts.length) throw new ConflictNeeded(conflicts);
        lastResolved = resolved;
        return build(md, resolved);
      });
      break;
    } catch (e) {
      if (e instanceof ConflictNeeded) {
        const choices = await showConflictResolver(formEl, e.conflicts);
        for (const c of e.conflicts) {
          resolutions[c.field] = { choice: choices[c.field], theirsShown: c.theirs };
        }
        continue;
      }
      throw e;
    }
  }

  rehydrateFields(formEl, fieldSpecs, lastResolved);
  resetDirtyBaseline(formEl);
  return lastResolved;
}

/** Push merged scalar values back into the form inputs so the view isn't stale. */
function rehydrateFields(formEl, fieldSpecs, resolved) {
  if (!resolved) return;
  for (const spec of fieldSpecs) {
    if (spec.type !== 'scalar') continue;
    const val = resolved[spec.name];
    if (val === undefined) continue;
    const els = formEl.querySelectorAll(`[name="${spec.name}"]`);
    if (els.length && els[0].type === 'radio') {
      els.forEach(r => { r.checked = (r.value === String(val)); });
    } else if (els[0]) {
      els[0].value = val ?? '';
    }
  }
}
```

- [ ] **Step 2: Syntax-check the module**

Run: `node --check scripts/mergeSave.js`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add scripts/mergeSave.js
git commit -m "feat(merge): conflict-aware save orchestrator"
```

---

## Task 5: Register new scripts in the manifest

**Files:**
- Modify: `manifest.json`

> Every dynamically-imported `scripts/*.js` must be listed individually in
> `web_accessible_resources`, or the import fails at runtime with
> "Failed to fetch dynamically imported module".

- [ ] **Step 1: Locate the resources list**

Run: `grep -n "scripts/form.js\|web_accessible_resources\|scripts/github.js" manifest.json`
Expected: shows the `resources` array entries (e.g. `"scripts/form.js"`, `"scripts/github.js"`).

- [ ] **Step 2: Add the three new entries**

In `manifest.json`, inside the `web_accessible_resources[].resources` array (next to the other `scripts/*.js` entries), add:

```json
"scripts/formMerge.js",
"scripts/conflictResolver.js",
"scripts/mergeSave.js",
```

Match the surrounding indentation and keep valid JSON (commas between entries, no trailing comma at the end of the array).

- [ ] **Step 3: Validate the JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('valid')"`
Expected: `valid`

- [ ] **Step 4: Commit**

```bash
git add manifest.json
git commit -m "chore(manifest): expose merge engine/resolver/orchestrator scripts"
```

---

## Task 6: Wire the guide-section edit save through `mergeSave`

**Files:**
- Modify: `scripts/guides.js` (imports near line 15–34; edit-mode branch of `saveSectionForComponent`, ~lines 912–930)

> Only the **edit-mode** branch changes. Create mode is untouched (a new section
> gets a fresh UUID and cannot conflict).

- [ ] **Step 1: Add the import**

In `scripts/guides.js`, add this import alongside the existing imports (e.g. directly after the `import { ... } from './form.js';` line):

```js
import { mergeSave } from './mergeSave.js';
```

- [ ] **Step 2: Replace the edit-mode branch**

In `saveSectionForComponent`, replace the current edit-mode block (from `const editUuid = formEl.dataset.editUuid;` through the `resetDirtyBaseline(formEl); return { ... };` at the end of the function) with:

```js
  const editUuid = formEl.dataset.editUuid;
  const draftMarkdown = await readRepoText(currentGuide.draftPath);
  const section = locateSectionByUUID(draftMarkdown, editUuid);
  if (!section) { alert('This section was deleted in another session — your changes can’t be saved.'); return null; }
  const currentParentUuid = section.level === 2
    ? (buildSectionTree(draftMarkdown).title?.uuid ?? null)
    : (section.level === 3 ? findH2ParentUuid(draftMarkdown, editUuid) || null : null);
  const requestedParent = parentUuid || null;
  const parentChanged = section.level !== 1 && (currentParentUuid ?? null) !== (requestedParent ?? null);

  await mergeSave({
    formEl,
    file: currentGuide.draftPath,
    onProgress,
    fieldSpecs: [
      { name: 'sectionTitle', type: 'scalar', label: 'Title' },
      { name: 'sectionDescription', type: 'scalar', label: 'Description' },
    ],
    readFresh: md => {
      const sec = locateSectionByUUID(md, editUuid);
      return {
        sectionTitle: sec?.title ?? '',
        sectionDescription: readSectionDescription(md, editUuid).descriptionMarkdown ?? '',
      };
    },
    build: (md, resolved) => {
      const sec = locateSectionByUUID(md, editUuid);
      if (!sec) throw new Error('Section no longer exists.');
      const { components } = readContainerComponents(md, { kind: 'guide-section', uuid: editUuid });
      const newBody = buildComponentBody(null, (resolved.sectionDescription ?? '').trim(), components);
      let updated = replaceSectionByUUID(md, editUuid, buildSection(sec.level, (resolved.sectionTitle ?? '').trim(), editUuid, newBody));
      if (parentChanged) updated = moveSectionToParent(updated, editUuid, requestedParent);
      return updated;
    },
  });
  return { container: { kind: 'guide-section', uuid: editUuid, file: currentGuide.draftPath }, formEl };
```

> Notes: `mergeSave` calls `resetDirtyBaseline` itself, so the old explicit call is removed. The title-required validation at the top of the function (`if (!title) { alert('Title is required.'); return null; }`) stays as-is and still guards the form value before any save.

- [ ] **Step 3: Syntax-check**

Run: `node --check scripts/guides.js`
Expected: no output (exit 0).

- [ ] **Step 4: Confirm `findH2ParentUuid` is imported**

Run: `grep -n "findH2ParentUuid" scripts/guides.js`
Expected: at least one match in an import or local definition (it was already used by the prior edit-mode code). If it is **not** found, the prior code referenced it from a local scope — re-check that the replacement preserved any helper that block relied on.

- [ ] **Step 5: Commit**

```bash
git add scripts/guides.js
git commit -m "feat(guides): conflict-aware merge on guide-section edit save"
```

---

## Task 7: End-to-end manual verification (the motivating scenario)

**Files:** none (manual browser test)

- [ ] **Step 1: Load the unpacked extension**

In Chrome → `chrome://extensions` → enable Developer mode → "Load unpacked" → select the repo root. If already loaded, click the reload icon so the new scripts and manifest take effect.

- [ ] **Step 2: Non-conflicting merge (the reported bug)**

1. Open a guide with at least one section, create/open its draft.
2. **Tab A:** open Section X for edit, change the **title**, Save to draft. Confirm "Draft saved".
3. **Tab B** (open the same guide/section in a second tab, opened *after* A saved is fine, but do NOT reload A): change the **description**, Save to draft.
4. Reload and reopen Section X.

Expected: **both** the title (from Tab A) and the description (from Tab B) are present. No prompt appeared (different fields → clean auto-merge).

- [ ] **Step 3: True conflict (same field)**

1. **Tab A:** open Section X, change the **title** to `Alpha`, Save.
2. **Tab B** (opened before A's save, still showing the old title): change the **title** to `Beta`, Save.

Expected: Tab B shows the inline panel — `⚠ "Title" changed in another tab … theirs: Alpha / mine: Beta` with **Use theirs** / **Keep mine**. Choosing **Keep mine** saves `Beta`; reopening confirms `Beta`. Re-run choosing **Use theirs** and confirm `Alpha` wins. After resolving, the title input shows the chosen value (re-hydrated), and the save button settles to "Draft saved".

- [ ] **Step 4: Components untouched by a title edit**

1. Add an admonition to Section X in **Tab A** (immediate save).
2. In **Tab B** (opened before that), edit only Section X's **title**, Save.
3. Reopen Section X.

Expected: the admonition from Tab A is still present (components are re-read fresh by the builder), and Tab B's title change applied.

- [ ] **Step 5: Edit-vs-delete guard**

1. **Tab A:** delete Section X.
2. **Tab B** (still open on Section X): change the title, Save.

Expected: alert "This section was deleted in another session — your changes can’t be saved." and the save aborts cleanly.

- [ ] **Step 6: Commit a note if any fixes were needed**

If Steps 2–5 surfaced bugs, fix them, re-verify, and commit. Otherwise no commit needed for this task.

---

## Self-review checklist (for the implementer before finishing)

- [ ] `node --test tests/formMerge.test.mjs` → `8 passed`.
- [ ] `node --test tests/*.test.mjs` → all pre-existing suites still pass.
- [ ] `node --check` is clean for `scripts/conflictResolver.js`, `scripts/mergeSave.js`, `scripts/guides.js`.
- [ ] `manifest.json` parses and lists all three new scripts.
- [ ] All five manual scenarios in Task 7 behave as described.
