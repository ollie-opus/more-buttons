# Page Settings Path Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Path input to the KB guide Page settings form that moves the guide's `draft_nav` entry to a new folder in `zensical.toml`.

**Architecture:** A new pure tree-op `setPathByValueSlug` in `navToml.js` (TDD-tested, mirroring the existing `removeByValueSlug`/`insertPath` helpers) does the move. The Page settings form gains a Path field; `openEditPageSettings` prefills it from the current `draft_nav` location, and `submitEditPageSettings` calls the new helper inside a best-effort `zensical.toml` push after the existing icon save.

**Tech Stack:** Vanilla JS Chrome extension. Tests are plain Node ESM scripts (`node tests/<name>.test.mjs`) using `node:assert/strict`. No package.json / test runner — each test file is self-executing.

## Global Constraints

- `draft_nav` leaf values are `drafts/<slug>.md` by current convention (`draftNavValueOf`); `nav` is **not** touched by this feature.
- Tree ops in `navToml.js` are pure (no network, no DOM); they mutate and return the nodes array.
- `findPathByValueSlug` returns `{ segments, leafName }` where `segments` are already slugs.
- No empty-diff commits: return the markdown unchanged when nothing moved; `githubFetchAndPushFile` skips byte-identical PUTs.
- Form-stored prefill values live under the `moreButtonsEditPageSettings` storage key, seeded inside the `!isFormReplay()` guard.

---

### Task 1: Pure `setPathByValueSlug` helper in navToml.js

**Files:**
- Modify: `scripts/navToml.js` (add export after `removeByValueSlug`, ~line 174)
- Test: `tests/navToml-setpath.test.mjs` (create)

**Interfaces:**
- Consumes: `findPathByValueSlug`, `removeByValueSlug`, `insertPath`, `slugify` (all already in `navToml.js`).
- Produces: `setPathByValueSlug(nodes, slug, newSegments, { value, fallbackName }) -> { changed: boolean }`. Moves (or creates) the leaf identified by `valueSlug === slug` to the section path `newSegments`, preserving the existing display name when present (else `fallbackName`), and setting the leaf value to `value`. Returns `{ changed: false }` (and leaves `nodes` untouched) when an existing leaf is already at the target path. Mutates `nodes`.

- [ ] **Step 1: Write the failing test**

Create `tests/navToml-setpath.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import { parseNavBlock, setPathByValueSlug } from '../scripts/navToml.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const TOML = `draft_nav = [
  {"Guides" = [
    {"Employees" = [
      {"Registering an employee" = "drafts/registering-an-employee.md"}
    ]}
  ]}
]
`;

test('moves a leaf to a new section path, preserving its name', () => {
  const items = parseNavBlock(TOML, 'draft_nav').items;
  const r = setPathByValueSlug(items, 'registering-an-employee', ['onboarding'], {
    value: 'drafts/registering-an-employee.md',
    fallbackName: 'registering-an-employee',
  });
  assert.equal(r.changed, true);
  // Old "Guides/Employees" branch pruned (left empty), new "Onboarding" created.
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'Onboarding');
  assert.equal(items[0].children[0].name, 'Registering an employee');
  assert.equal(items[0].children[0].value, 'drafts/registering-an-employee.md');
});

test('moves a leaf to the root when newSegments is empty', () => {
  const items = parseNavBlock(TOML, 'draft_nav').items;
  const r = setPathByValueSlug(items, 'registering-an-employee', [], {
    value: 'drafts/registering-an-employee.md',
    fallbackName: 'registering-an-employee',
  });
  assert.equal(r.changed, true);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'Registering an employee');
  assert.equal(items[0].value, 'drafts/registering-an-employee.md');
});

test('no-op when already at the target path', () => {
  const items = parseNavBlock(TOML, 'draft_nav').items;
  const before = JSON.stringify(items);
  const r = setPathByValueSlug(items, 'registering-an-employee', ['guides', 'employees'], {
    value: 'drafts/registering-an-employee.md',
    fallbackName: 'registering-an-employee',
  });
  assert.equal(r.changed, false);
  assert.equal(JSON.stringify(items), before);
});

test('creates the leaf when slug is absent (self-heal)', () => {
  const items = [];
  const r = setPathByValueSlug(items, 'new-guide', ['guides'], {
    value: 'drafts/new-guide.md',
    fallbackName: 'new-guide',
  });
  assert.equal(r.changed, true);
  assert.equal(items[0].name, 'Guides');
  assert.equal(items[0].children[0].name, 'new-guide');
});

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/navToml-setpath.test.mjs`
Expected: FAIL — `SyntaxError`/`TypeError` that `setPathByValueSlug` is not exported (not a function).

- [ ] **Step 3: Write minimal implementation**

In `scripts/navToml.js`, add after `removeByValueSlug` (after line 174):

```javascript
// Move (or create) the leaf identified by valueSlug === slug to the section path
// `newSegments`. Preserves the existing leaf's display name when found, else uses
// `fallbackName`; sets the leaf value to `value`. Returns { changed:false } and
// leaves nodes untouched when an existing leaf is already at the target path —
// callers skip the toml write to avoid an empty-diff commit. Mutates + returns
// { changed }. removeByValueSlug runs across the whole tree first, so the
// subsequent insertPath cannot create a duplicate.
export function setPathByValueSlug(nodes, slug, newSegments, { value, fallbackName } = {}) {
  const loc = findPathByValueSlug(nodes, slug);
  const targetSlugs = newSegments.map(slugify);
  if (loc) {
    const currSlugs = loc.segments.map(slugify);
    const same = currSlugs.length === targetSlugs.length
      && currSlugs.every((s, i) => s === targetSlugs[i]);
    if (same) return { changed: false };
  }
  const leafName = loc?.leafName ?? fallbackName ?? '';
  removeByValueSlug(nodes, slug);
  insertPath(nodes, newSegments, leafName, value);
  return { changed: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/navToml-setpath.test.mjs`
Expected: PASS — `4 passed`.

- [ ] **Step 5: Run the existing navToml suites to confirm no regression**

Run: `node tests/navToml.test.mjs && node tests/navToml-rename.test.mjs`
Expected: both print their `N passed` lines with no assertion errors.

- [ ] **Step 6: Commit**

```bash
git add scripts/navToml.js tests/navToml-setpath.test.mjs
git commit -m "feat(navToml): add setPathByValueSlug tree-move helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add the Path field to the Page settings form

**Files:**
- Modify: `config/forms/editPageSettings.html`

**Interfaces:**
- Consumes: nothing (static markup).
- Produces: an `<input name="path">` and a `[data-path-suffix]` span the Task 3/4 handlers read/write. Field structure mirrors `config/forms/createGuide.html`'s `.mb-path-field`.

- [ ] **Step 1: Add the Path field above the Icon field**

In `config/forms/editPageSettings.html`, insert this block **between** the `<h2>Page settings</h2>` line and the existing `Icon` form-group:

```html
  <div class="more-buttons-form-group">
    <label class="more-buttons-label">Path</label>
    <div class="mb-path-field">
      <input type="text" name="path" placeholder="guides/employees" autocomplete="off" />
      <span class="mb-path-suffix" data-path-suffix>/…md</span>
    </div>
  </div>
```

The file should now read, in order: `<h2>`, the Path group, the Icon group, the form-actions.

- [ ] **Step 2: Verify the markup is well-formed**

Run: `node -e "const h=require('fs').readFileSync('config/forms/editPageSettings.html','utf8'); const op=(h.match(/<div/g)||[]).length, cl=(h.match(/<\/div>/g)||[]).length; if(op!==cl) throw new Error('div mismatch '+op+'/'+cl); if(!/name=\"path\"/.test(h)) throw new Error('no path input'); if(h.indexOf('name=\"path\"')>h.indexOf('name=\"icon\"')) throw new Error('path not above icon'); console.log('ok: path field above icon, '+op+' divs balanced');"`
Expected: `ok: path field above icon, 4 divs balanced`

- [ ] **Step 3: Commit**

```bash
git add config/forms/editPageSettings.html
git commit -m "feat(pageSettings): add Path field to the form

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Prefill the Path field and the filename suffix on open

**Files:**
- Modify: `scripts/guides.js` — `openEditPageSettings` (currently lines 1378–1394) and the import line (line 21).

**Interfaces:**
- Consumes: `setPathByValueSlug` is NOT needed here. Uses `parseNavBlock`, `findPathByValueSlug` (already imported), `guideBaseName`, `readRepoText`, `readFrontmatterIcon`, `currentGuide`.
- Produces: the form opens with `name="path"` prefilled to the current `draft_nav` folder path (slugs joined by `/`, empty string when at root) and the `[data-path-suffix]` showing `/<slug>.md`.

- [ ] **Step 1: Add `setPathByValueSlug` to the navToml import (forward-prep for Task 4)**

In `scripts/guides.js` line 21, add `setPathByValueSlug` to the import list:

```javascript
import { parseNavBlock, replaceNavBlock, insertPath, removeByValue, removeByValueSlug, findPathOfValue, findPathByValueSlug, valueSlug, renameByValue, renameByValueSlug, slugify, setPathByValueSlug } from './navToml.js';
```

- [ ] **Step 2: Prefill the path value and suffix in `openEditPageSettings`**

Replace the body of `openEditPageSettings` (lines 1378–1394) with:

```javascript
registerFormAction('openEditPageSettings', async ({ file }) => {
  adoptGuideFromDraftPath(file);
  if (!currentGuide) return;
  const draftMarkdown = await readRepoText(currentGuide.draftPath);
  const slug = guideBaseName(currentGuide.livePath);

  if (!isFormReplay()) {
    // Current draft_nav folder path → prefill the Path field (slugs joined by '/').
    let pathValue = '';
    try {
      const tomlText = await readRepoText('zensical.toml');
      const draftItems = parseNavBlock(tomlText, 'draft_nav').items;
      const loc = findPathByValueSlug(draftItems, slug);
      pathValue = (loc?.segments ?? []).join('/');
    } catch { /* best-effort prefill; empty path = root */ }
    await chrome.storage.local.set({
      moreButtonsEditPageSettings: { icon: readFrontmatterIcon(draftMarkdown), path: pathValue },
    });
  }

  const { formEl } = await createForm('editPageSettings');
  if (!formEl) return;
  formEl.dataset.containerFile = currentGuide.draftPath;
  setCrumbLabel('Page settings');
  // Filename is fixed; only the folder moves. Show the real <slug>.md as the suffix.
  const suffix = formEl.querySelector('[data-path-suffix]');
  if (suffix) suffix.textContent = `/${slug}.md`;
  attachIconPicker(formEl.querySelector('[name="icon"]')); // fire-and-forget; degrades to plain input
});
```

- [ ] **Step 3: Reload the extension and verify the prefill**

This handler is DOM/network-coupled (no unit test). Manual check:
1. Reload the unpacked extension at `chrome://extensions`.
2. Open a KB guide that has a draft, open **Page settings**.
3. Confirm the Path field shows the guide's current folder (e.g. `guides/employees`) and the suffix reads `/<slug>.md` (the guide's filename).
Expected: both populated; a root-level guide shows an empty Path field.

- [ ] **Step 4: Commit**

```bash
git add scripts/guides.js
git commit -m "feat(pageSettings): prefill Path field from draft_nav location

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Save the path move on submit

**Files:**
- Modify: `scripts/guides.js` — `submitEditPageSettings` (currently lines 1396–1415).

**Interfaces:**
- Consumes: `setPathByValueSlug` (Task 1), `parseNavBlock`, `replaceNavBlock`, `draftNavValueOf`, `guideBaseName`, `githubFetchAndPushFile`, `mergeSave`, `currentGuide`.
- Produces: on save, after the icon `mergeSave` resolves, the guide's `draft_nav` entry is moved to the folder typed in the Path field (best-effort, non-fatal on failure).

- [ ] **Step 1: Add the draft_nav reconciliation after the icon save**

Replace `submitEditPageSettings` (lines 1396–1415) with:

```javascript
registerFormAction('submitEditPageSettings', async ({ formEl, content }) => {
  if (!currentGuide) return;
  const btn = content.querySelector('[data-save-state]');
  setButtonBusy(btn, 'Saving…');
  try {
    const resolved = await mergeSave({
      formEl,
      file: currentGuide.draftPath,
      onProgress: s => setButtonBusy(btn, s),
      fieldSpecs: [{ name: 'icon', type: 'scalar', label: 'Icon' }],
      readFresh: md => ({ icon: readFrontmatterIcon(md) }),
      build: (md, resolved) => writeFrontmatterIcon(md, (resolved.icon ?? '').trim()),
    });
    if (!resolved) { formEl._refreshSaveState?.(); return; }

    // Path lives in zensical.toml (draft_nav), not the markdown frontmatter, so it
    // is a separate best-effort push — mirrors the H1-title rename. A failure here
    // must not roll back the icon save.
    try {
      const pathRaw = formEl.querySelector('[name="path"]')?.value ?? '';
      const newSegments = pathRaw.split('/').map(s => s.trim()).filter(Boolean);
      const slug = guideBaseName(currentGuide.livePath);
      setButtonBusy(btn, 'Updating path…');
      await githubFetchAndPushFile('zensical.toml', s => setButtonBusy(btn, s), md => {
        const { items } = parseNavBlock(md, 'draft_nav');
        const { changed } = setPathByValueSlug(items, slug, newSegments, {
          value: draftNavValueOf(currentGuide.livePath),
          fallbackName: slug,
        });
        return changed ? replaceNavBlock(md, 'draft_nav', items) : md;
      });
    } catch (e) {
      alert(`Icon saved, but updating the path failed: ${e.message}. Re-saving retries it.`);
    }

    formEl._refreshSaveState?.();
  } catch (e) {
    formEl._refreshSaveState?.();
    alert('Failed to save page settings: ' + e.message);
  }
});
```

- [ ] **Step 2: Reload the extension and verify the move (manual — DOM/network handler)**

1. Reload the unpacked extension at `chrome://extensions`.
2. Open a draft-only guide's **Page settings**, change the Path (e.g. to `onboarding`), Save.
3. In the repo's `zensical.toml`, confirm the guide's `draft_nav` leaf now sits under `Onboarding`, name and `drafts/<slug>.md` value preserved.
4. Reopen the KB tree: the guide appears under the new folder.
Expected: leaf moved; old empty section pruned.

- [ ] **Step 3: Verify the no-op path (no empty-diff commit)**

1. Open the same guide's Page settings again (Path now prefilled to `onboarding`).
2. Save without changing the Path.
Expected: no new commit to `zensical.toml` for the path (only the icon's own write path runs). `setPathByValueSlug` returns `{ changed: false }`, the builder returns `md` unchanged, and `githubFetchAndPushFile` skips the byte-identical PUT.

- [ ] **Step 4: Verify the icon + path still save together**

1. Change both the icon and the path, Save.
Expected: icon persists in the draft frontmatter AND the draft_nav entry moves.

- [ ] **Step 5: Commit**

```bash
git add scripts/guides.js
git commit -m "feat(pageSettings): move draft_nav entry on Path save

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **Known limitation (by design, not a bug):** for a guide that is already published *and* being re-drafted, only `draft_nav` moves; its live `nav` leaf stays put, so the KB tree may show it twice. See the spec (`docs/superpowers/specs/2026-06-19-page-settings-path-field-design.md`) for why publish does not reconcile this.
- Only Task 1 is unit-testable; Tasks 2–4 are form/DOM/network glue verified manually by reloading the unpacked extension at `chrome://extensions` (reload is required after any `scripts/` change).
- No `manifest.json` change is needed — `editPageSettings.html` and `navToml.js`/`guides.js` are already registered.
