# Capture Insert Decision Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Chosen execution mode (user-approved 2026-06-11): subagent-driven-development** — fresh subagent per task, review between tasks. Task 9 Step 2 is manual verification that requires the user in the browser (reload the extension at chrome://extensions first — manifest.json changes in Task 6).

**Goal:** After a shift-click in the Components capture flow, nothing is pushed to GitHub; the flow probes whether the capture's derived path already exists in the library and opens a review form (existing `captureEntry` insert mode, or a new `captureInsertNew` form) where the user sets the size and clicks Insert (commits) or Cancel (back to capture mode).

**Architecture:** A new decision point in `captures.js` (`finishComponentCapture`) replaces the immediate commit in `runComponentCaptureFlow`. Both review forms commit through one renamed action (`completeComponentInsert`) backed by one module-scoped intent (`pendingComponentInsert`), and the inserted component **no longer opens its editor** — size is chosen on the review form via a shared `captureSizeField` control extracted into `captureCards.js`. The recently added cold-exit machinery (`planColdExit`, serialized intents) is untouched; only the `completeComponentCaptureInsert` handler's body changes from "replay + commit" to "replay + probe + open form".

**Tech Stack:** Vanilla ES modules (Chrome extension MV3, no build step). Tests via Node's built-in runner (`node --test tests/*.test.mjs`) with `node:assert/strict` and the repo's custom `test()` helper. No DOM test harness — DOM and GitHub-wiring code is verified manually in the browser.

**Spec:** `docs/superpowers/specs/2026-06-11-capture-insert-decision-form-design.md`

**Key background for an engineer with zero context:**

- Capture filenames are deterministic, derived from page path + element label (`scripts/captureElement.js:321` `deriveFilename`): `media/occ-captures/{page-segments}/{element-slug}-{light|dark}-mode.png`. Repo paths prepend `docs/assets/`. That's why "already in library" is a simple existence probe.
- Forms are HTML files in `config/forms/<name>.html` loaded by `createForm(name, opener)` (`scripts/form.js:326`). `createForm` moves `.more-buttons-form-actions` out of `<form>` into the overlay-content wrapper — query action buttons on `formEl.parentElement`, and attach click listeners there.
- Form actions are a string-keyed registry (`scripts/formActions.js`): `registerFormAction(name, fn)` / `getFormAction(name)`. Modules register at import time; `scripts/actions.js` holds the side-effect import list.
- Every new `scripts/*.js` file MUST be added individually to `manifest.json` `web_accessible_resources` (form HTML is already globbed via `config/forms/*`). After any manifest change the extension must be reloaded at `chrome://extensions` — a stale extension throws "Failed to fetch dynamically imported module".
- All async loading uses the `formLoading` veil (`scripts/loading.js`) — never inline placeholders.
- `commitCapturesIntoContainer` (`scripts/captures.js:85`) calls `pushCaptures`, which **skips entries without `lightDataUrl`** — passing `{ lightFilename, darkFilename, dimMode, dimValue }` commits markdown without uploading.

---

### Task 1: Commit the pending cold-exit work

The working tree contains completed-but-uncommitted cold-exit recovery work (modified `scripts/captureEntry.js`, `scripts/captureMode.js`, `scripts/captures.js`, new `tests/captureColdExit.test.mjs`). This plan builds directly on it.

**Files:**
- Commit (no edits): `scripts/captureEntry.js`, `scripts/captureMode.js`, `scripts/captures.js`, `tests/captureColdExit.test.mjs`

- [x] **Step 1: Run the full test suite**

Run: `node --test tests/*.test.mjs`
Expected: all test files pass (`fail 0`).

- [x] **Step 2: Commit** *(was already committed as 66523da "capture tweaks" — same four files, verified suite-green; not amended)*

```bash
git add scripts/captureEntry.js scripts/captureMode.js scripts/captures.js tests/captureColdExit.test.mjs
git commit -m "feat(captures): cold-exit intent recovery — serialise insert/recapture intents across hard navs"
```

---

### Task 2: Shared capture size field in `captureCards.js`

**Files:**
- Modify: `scripts/captureCards.js` (append new exports)
- Test: `tests/captureSizeField.test.mjs` (new)

- [x] **Step 1: Write the failing test**

Create `tests/captureSizeField.test.mjs`:

```js
import assert from 'node:assert/strict';
import { captureSizeField, normalizeDimChoice } from '../scripts/captureCards.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// ── captureSizeField markup ───────────────────────────────────────────────────

test('height mode: height option selected, value rendered, input enabled', () => {
  const html = captureSizeField({ dimMode: 'height', dimValue: 64 });
  assert.match(html, /<option value="height" selected>/);
  assert.match(html, /value="64"/);
  assert.doesNotMatch(html, /disabled/);
  assert.doesNotMatch(html, /--auto/);
});

test('width mode: width option selected', () => {
  const html = captureSizeField({ dimMode: 'width', dimValue: 120 });
  assert.match(html, /<option value="width" selected>/);
  assert.match(html, /value="120"/);
});

test('auto mode: --auto class, disabled empty input', () => {
  const html = captureSizeField({ dimMode: 'none' });
  assert.match(html, /<option value="none" selected>/);
  assert.match(html, /--auto/);
  assert.match(html, /value=""/);
  assert.match(html, /disabled/);
});

test('defaults to height/50', () => {
  const html = captureSizeField();
  assert.match(html, /<option value="height" selected>/);
  assert.match(html, /value="50"/);
});

// ── normalizeDimChoice ────────────────────────────────────────────────────────

test('none → null value regardless of raw input', () => {
  assert.deepEqual(normalizeDimChoice('none', '64'), { dimMode: 'none', dimValue: null });
});

test('valid number parses', () => {
  assert.deepEqual(normalizeDimChoice('height', '64'), { dimMode: 'height', dimValue: 64 });
});

test('empty, zero, negative, junk all fall back to 50', () => {
  assert.deepEqual(normalizeDimChoice('height', ''), { dimMode: 'height', dimValue: 50 });
  assert.deepEqual(normalizeDimChoice('width', '0'), { dimMode: 'width', dimValue: 50 });
  assert.deepEqual(normalizeDimChoice('width', '-3'), { dimMode: 'width', dimValue: 50 });
  assert.deepEqual(normalizeDimChoice('height', 'abc'), { dimMode: 'height', dimValue: 50 });
});

console.log(`\n${passed} passed`);
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/captureSizeField.test.mjs`
Expected: FAIL — `captureSizeField` is not exported.

- [x] **Step 3: Implement the helpers**

Append to `scripts/captureCards.js` (after `capturePathField`; note `escapeAttr` already exists in this file):

```js
/**
 * "Dimension" form row — the capture size control: height/width/auto select +
 * px value input. One source of truth for the markup captureComponent.js's
 * edit form and both insert review forms render. Render with current values,
 * call wireCaptureSizeField() once after injecting, and readCaptureSizeField()
 * to read the choice back. The CSS for .more-buttons-capture-dim (and its
 * .--auto state) already exists in config/forms/formsStyling.css.
 * dimValue may be a number or string; '' renders an empty input.
 * @param {{dimMode?:'height'|'width'|'none', dimValue?:number|string}} opts
 */
export function captureSizeField({ dimMode = 'height', dimValue = 50 } = {}) {
  const isAuto = dimMode === 'none';
  const value = isAuto ? '' : String(dimValue ?? 50);
  const opt = (v, text) => `<option value="${v}"${dimMode === v ? ' selected' : ''}>${text}</option>`;
  return `
    <div class="more-buttons-form-group">
      <label class="more-buttons-label">Dimension</label>
      <div class="more-buttons-capture-dim${isAuto ? ' --auto' : ''}" data-capture-size>
        <select class="more-buttons-capture-dim-mode" name="dimMode">
          ${opt('height', 'Height')}
          ${opt('width', 'Width')}
          ${opt('none', 'Auto')}
        </select>
        <input class="more-buttons-capture-dim-value" type="number" name="dimValue" value="${escapeAttr(value)}" min="1"${isAuto ? ' disabled' : ''} />
        <span class="more-buttons-capture-dim-unit">px</span>
      </div>
    </div>
  `;
}

/**
 * Bind the Auto-mode behaviour to an injected captureSizeField: value input
 * disabled + '--auto' class while the mode is 'none'; switching back to a
 * dimension seeds the 50px default into an emptied input. The markup renders
 * its initial state itself, so this only needs the change listener.
 */
export function wireCaptureSizeField(rootEl) {
  const dim = rootEl.querySelector('[data-capture-size]');
  const sel = dim?.querySelector('[name="dimMode"]');
  const val = dim?.querySelector('[name="dimValue"]');
  if (!dim || !sel || !val) return;
  sel.addEventListener('change', () => {
    const isAuto = sel.value === 'none';
    dim.classList.toggle('--auto', isAuto);
    val.disabled = isAuto;
    if (!isAuto && val.value === '') val.value = '50';
  });
}

/**
 * Normalize a raw (dimMode, dimValue-string) choice into the capture
 * component's canonical shape: Auto carries no value; a dimension falls back
 * to 50 when the input is empty or invalid. Pure — unit tested.
 */
export function normalizeDimChoice(dimMode, rawValue) {
  if (dimMode === 'none') return { dimMode: 'none', dimValue: null };
  const v = parseInt(rawValue, 10);
  return { dimMode, dimValue: Number.isFinite(v) && v > 0 ? v : 50 };
}

/** Read { dimMode, dimValue } back from an injected captureSizeField. */
export function readCaptureSizeField(rootEl) {
  const sel = rootEl.querySelector('[data-capture-size] [name="dimMode"]');
  const val = rootEl.querySelector('[data-capture-size] [name="dimValue"]');
  return normalizeDimChoice(sel?.value ?? 'none', val?.value ?? '');
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/captureSizeField.test.mjs`
Expected: PASS — `7 passed`.

- [x] **Step 5: Commit**

```bash
git add scripts/captureCards.js tests/captureSizeField.test.mjs
git commit -m "feat(captures): shared captureSizeField control in captureCards"
```

---

### Task 3: Edit-capture form renders the shared size field

The Dimension markup is currently static HTML in `config/forms/editCaptureComponent.html`; replace it with a placeholder filled by the shared helper so there's one source of truth. The submit/merge logic in `captureComponent.js` queries `[name="dimMode"]`/`[name="dimValue"]` and keeps working because the helper emits the same names/classes.

**Files:**
- Modify: `config/forms/editCaptureComponent.html`
- Modify: `scripts/captureComponent.js`

- [x] **Step 1: Replace the static Dimension block with a placeholder**

In `config/forms/editCaptureComponent.html`, replace:

```html
  <div class="more-buttons-form-group">
    <label class="more-buttons-label">Dimension</label>
    <div class="more-buttons-capture-dim" data-capture-component-dim>
      <select class="more-buttons-capture-dim-mode" name="dimMode">
        <option value="height">Height</option>
        <option value="width">Width</option>
        <option value="none">Auto</option>
      </select>
      <input class="more-buttons-capture-dim-value" type="number" name="dimValue" value="50" min="1" />
      <span class="more-buttons-capture-dim-unit">px</span>
    </div>
  </div>
```

with:

```html
  <div data-capture-component-size></div>
```

- [x] **Step 2: Inject the shared control from `captureComponent.js`**

In `scripts/captureComponent.js`:

1. Extend the captureCards import (line 14):

```js
import { captureCard, captureGrid, captureSizeField, wireCaptureSizeField } from './captureCards.js';
```

2. Delete the whole `applyDimAuto` function (lines 21–34).

3. Replace the select wiring block (lines 79–84):

```js
  const sel = formEl.querySelector('[name="dimMode"]');
  if (sel) {
    sel.value = cap.dimMode ?? 'none';
    sel.addEventListener('change', () => applyDimAuto(formEl));
  }
  applyDimAuto(formEl);
  resetDirtyBaseline(formEl);
```

with:

```js
  // The Dimension control is injected (not static HTML) so its markup comes
  // from the shared captureSizeField helper. Render from captureDimFields so
  // an untouched form matches the storage seed exactly (dimValue '' on auto)
  // — the merge baseline depends on that equality.
  const sizeHost = formEl.querySelector('[data-capture-component-size]');
  if (sizeHost) {
    const dim = captureDimFields(cap);
    sizeHost.innerHTML = captureSizeField({ dimMode: dim.dimMode, dimValue: dim.dimValue });
    wireCaptureSizeField(formEl);
  }
  resetDirtyBaseline(formEl);
```

(Note: the old flow relied on `createForm`'s storage hydration to fill `dimValue` from the seeded `captureDimFields(cap)`; injected-after-createForm inputs miss hydration, which is why `captureSizeField` receives the values explicitly. `resetDirtyBaseline` stays AFTER injection so the dirty snapshot includes the size inputs.)

- [x] **Step 3: Run the full suite**

Run: `node --test tests/*.test.mjs`
Expected: all pass (notably `captureDimFields.test.mjs` — untouched pure logic).

- [x] **Step 4: Commit**

```bash
git add config/forms/editCaptureComponent.html scripts/captureComponent.js
git commit -m "refactor(captures): edit-capture form renders the shared captureSizeField"
```

---

### Task 4: Extract the capture conflict helpers into `captures.js`

`captureNew.js` owns two closure-bound helpers (`resolveExistingConflict`, `overwriteExisting`) that the new insert form also needs. Move parametrized versions into `captures.js` (the publish module — `captureNew` already imports `pushCaptures` from it, so no cycle).

**Files:**
- Modify: `scripts/captures.js`
- Modify: `scripts/captureNew.js`

- [x] **Step 1: Add the shared helpers to `captures.js`**

Add to the imports at the top of `scripts/captures.js`:

```js
import { githubPushImageIfNotExists, githubReplaceImage } from './github.js';
import { readRepoBlob } from './repoClient.js';
import { showConflictResolver, ResolveCancelled } from './conflictResolver.js';
```

(`githubPushImageIfNotExists` is already imported — extend that line rather than duplicating it.)

Insert after `pushCaptures` (after line 75):

```js
// ── Library conflicts (shared by captureNew's save and captureInsertNew) ─────

/**
 * A clash with a stored capture is resolved through the standard conflict
 * panel (conflictResolver.js — the same UI guides use for concurrent-edit
 * conflicts): one "Capture" field whose tiles carry the stored light
 * thumbnail vs the new capture's. Resolves true only when the user picks
 * "Yours (overwrite)"; picking theirs or cancelling keeps the library
 * untouched. The stored thumbnail comes via the contents API (readRepoBlob),
 * not the raw CDN, so a recently replaced capture can't show stale bytes; a
 * failed fetch just drops the thumbnail (text-only tile).
 */
export async function resolveCaptureConflict({ formEl, base, lightPath, lightExists, mineLightDataUrl }) {
  const theirsBlob = lightExists ? await readRepoBlob(lightPath).catch(() => null) : null;
  const theirsUrl = theirsBlob ? URL.createObjectURL(theirsBlob) : '';
  try {
    const choices = await showConflictResolver(
      formEl,
      [{ field: 'capture', label: 'Capture', mine: ['mine'], theirs: ['theirs'] }],
      {
        describe: (token) => ({
          kind: 'capture',
          thumbSrc: token === 'mine' ? mineLightDataUrl : theirsUrl,
        }),
        head: 'A capture already exists at this path',
        desc: `The library already has a capture at "${base}". Keep the existing one (you can rename the path and save again), or overwrite it with this capture.`,
      },
    );
    return choices.capture === 'mine';
  } catch (e) {
    if (e instanceof ResolveCancelled) return false;
    throw e;
  } finally {
    if (theirsUrl) URL.revokeObjectURL(theirsUrl);
  }
}

/**
 * "Yours (overwrite)": replace the stored pair with this capture. Replace
 * what's there and create what isn't (a manual rename can land on a
 * half-existing pair), then upsert the manifest entry so padding/resized
 * follow the new bytes.
 */
export async function overwriteCapturePair({ lightPath, darkPath, lightExists, darkExists, capture, onProgress }) {
  const lightB64 = capture.lightDataUrl.split(',')[1];
  const darkB64 = capture.darkDataUrl.split(',')[1];
  await (lightExists
    ? githubReplaceImage(lightPath, lightB64, onProgress)
    : githubPushImageIfNotExists(lightPath, lightB64, onProgress));
  await (darkExists
    ? githubReplaceImage(darkPath, darkB64, onProgress)
    : githubPushImageIfNotExists(darkPath, darkB64, onProgress));
  await writeCaptureMeta(
    [{ lightPath, resized: !!capture.resized, padding: capture.padding || 0 }],
    onProgress,
  );
}
```

- [x] **Step 2: Consume them from `captureNew.js`**

In `scripts/captureNew.js`:

1. Replace the imports (lines 1–8) with:

```js
import { createForm, navigateBack } from './form.js';
import { pushCaptures, resolveCaptureConflict, overwriteCapturePair } from './captures.js';
import { githubPathExists } from './github.js';
import { captureCard, captureGrid, capturePathField, captureBasePath } from './captureCards.js';
import { registerFormAction } from './formActions.js';
```

(`githubReplaceImage`, `githubPushImageIfNotExists`, `writeCaptureMeta`, `readRepoBlob`, and the conflictResolver imports move with the extracted helpers.)

2. Delete the local `resolveExistingConflict` (lines 59–90, including its comment block) and `overwriteExisting` (lines 92–109, including comment).

3. In `save()`, replace:

```js
      if (lightExists || darkExists) {
        const keepMine = await resolveExistingConflict({ base, lightPath, lightExists });
        if (!keepMine) {
          setStatus('Kept the existing capture — rename the path to save yours separately.');
          return;
        }
        await overwriteExisting({ lightPath, darkPath, lightExists, darkExists });
      } else {
```

with:

```js
      if (lightExists || darkExists) {
        const keepMine = await resolveCaptureConflict({
          formEl, base, lightPath, lightExists, mineLightDataUrl: capture.lightDataUrl,
        });
        if (!keepMine) {
          setStatus('Kept the existing capture — rename the path to save yours separately.');
          return;
        }
        await overwriteCapturePair({ lightPath, darkPath, lightExists, darkExists, capture, onProgress: setStatus });
      } else {
```

- [x] **Step 3: Run the full suite**

Run: `node --test tests/*.test.mjs`
Expected: all pass (this also proves `captures.js`'s new imports — `repoClient`, `conflictResolver` — stay node-importable; `captureUuid.test.mjs` imports `captures.js` directly).

- [x] **Step 4: Commit**

```bash
git add scripts/captures.js scripts/captureNew.js
git commit -m "refactor(captures): extract shared capture-conflict helpers into captures.js"
```

---

### Task 5: `chooseInsertBranch` decision logic (TDD)

**Files:**
- Modify: `scripts/captures.js`
- Test: `tests/captureInsertBranch.test.mjs` (new)

- [x] **Step 1: Write the failing test**

Create `tests/captureInsertBranch.test.mjs`:

```js
import assert from 'node:assert/strict';
import { chooseInsertBranch, buildCaptureLines } from '../scripts/captures.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// ── Branch decision: which review form opens after a component capture ──────

test('both theme files exist → library branch', () => {
  assert.equal(chooseInsertBranch(true, true), 'library');
});

test('half pairs and missing pairs → new branch', () => {
  assert.equal(chooseInsertBranch(true, false), 'new');
  assert.equal(chooseInsertBranch(false, true), 'new');
  assert.equal(chooseInsertBranch(false, false), 'new');
});

// ── Size values chosen on the review forms ride the capture object into the
//    committed markdown — pin all three dimMode variants. ────────────────────

const CAP = {
  lightFilename: 'media/occ-captures/p/a-light-mode.png',
  darkFilename: 'media/occ-captures/p/a-dark-mode.png',
  uuid: 'U1',
};

test('height dim renders the style attr on both theme lines', () => {
  const lines = buildCaptureLines([{ ...CAP, dimMode: 'height', dimValue: 64 }]);
  assert.ok(lines.some(l => l.includes('#only-light){ style="height: 64px" loading=lazy }')));
  assert.ok(lines.some(l => l.includes('#only-dark){ style="height: 64px" loading=lazy }')));
});

test('width dim renders the width attr', () => {
  const lines = buildCaptureLines([{ ...CAP, dimMode: 'width', dimValue: 120 }]);
  assert.ok(lines.some(l => l.includes('{ width="120" loading=lazy }')));
});

test('auto renders bare image lines (no dim attrs)', () => {
  const lines = buildCaptureLines([{ ...CAP, dimMode: 'none', dimValue: null }]);
  assert.ok(lines.some(l => l.endsWith('#only-light)')));
  assert.ok(lines.every(l => !l.includes('loading=lazy')));
});

console.log(`\n${passed} passed`);
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/captureInsertBranch.test.mjs`
Expected: FAIL — `chooseInsertBranch` is not exported.

- [x] **Step 3: Implement `chooseInsertBranch`**

Add to `scripts/captures.js`, just above the `// ── Components: capture acquisition…` comment block:

```js
// ── Insert decision ───────────────────────────────────────────────────────────

/**
 * After a component-flow capture, decide which review form opens. 'library'
 * only when BOTH theme files already exist at the derived path — a half pair
 * (e.g. left by a partial manual rename) goes through the 'new' form, whose
 * insert-time conflict flow can repair the missing half.
 */
export function chooseInsertBranch(lightExists, darkExists) {
  return lightExists && darkExists ? 'library' : 'new';
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/captureInsertBranch.test.mjs`
Expected: PASS — `5 passed`.

- [x] **Step 5: Commit**

```bash
git add scripts/captures.js tests/captureInsertBranch.test.mjs
git commit -m "feat(captures): chooseInsertBranch — library only when the full theme pair exists"
```

---

### Task 6: The `captureInsertNew` review form

New form for the "not in library yet" branch. It calls form actions registered in Task 8 (`completeComponentInsert`, `reenterComponentCapture`) via `getFormAction(...)?.()` — safe no-ops until then; the form itself is unreachable until Task 8 wires the decision point anyway.

**Files:**
- Create: `config/forms/captureInsertNew.html`
- Create: `scripts/captureInsertNew.js`
- Modify: `manifest.json` (web_accessible_resources)
- Modify: `scripts/actions.js` (side-effect import)
- Modify: `scripts/form.js` (FORM_LABELS)

- [x] **Step 1: Create `config/forms/captureInsertNew.html`**

```html
<form data-nav id="capture-insert-new-form" data-storage-key="moreButtonsCaptureInsertNew" data-width="90vw" data-height="90vh">
  <h2>New Capture</h2>
  <div data-capture-insert-new-body></div>

  <div class="more-buttons-form-actions">
    <span class="more-buttons-description" data-capture-insert-new-status hidden></span>
    <button type="button" class="more-buttons-button secondary" data-capture-insert-new-cancel><span class="more-buttons-icon">close</span>Cancel</button>
    <button type="button" class="more-buttons-button success" data-capture-insert-new-insert><span class="more-buttons-icon">add</span>Insert this capture</button>
  </div>
</form>
```

- [x] **Step 2: Create `scripts/captureInsertNew.js`**

```js
/**
 * captureInsertNew.js — review form for a component-flow capture whose derived
 * path is NOT in the library yet.
 *
 * Opened by captures.js's finishComponentCapture (the post-shift-click
 * decision point). Nothing has been pushed when this form opens: the preview
 * tiles render the in-memory dataURLs, the proposed path is editable, and the
 * Dimension control sets the size the inserted markdown will carry.
 *
 *   - Insert this capture → probe the (possibly renamed) target path, resolve
 *     any collision through the standard conflict panel, push the PNG pair +
 *     metadata, then commit the component markdown via completeComponentInsert
 *     (which replays the origin form stack — the editor does NOT open).
 *   - Cancel → discard this capture and re-enter capture mode so another
 *     element can be picked (reenterComponentCapture in captures.js).
 */

import { createForm } from './form.js';
import { pushCaptures, resolveCaptureConflict, overwriteCapturePair } from './captures.js';
import { githubPathExists } from './github.js';
import {
  captureCard, captureGrid, capturePathField, captureBasePath,
  captureSizeField, wireCaptureSizeField, readCaptureSizeField,
} from './captureCards.js';
import { registerFormAction, getFormAction } from './formActions.js';

export async function openCaptureInsertNew({ capture } = {}) {
  if (!capture?.lightDataUrl) return;

  const opener = () => openCaptureInsertNew({ capture });
  const { formEl, overlay } = await createForm('captureInsertNew', opener);
  if (!formEl) return;

  // form.js moves .more-buttons-form-actions out of <form>, so look up the
  // action controls on the parent overlay-content wrapper.
  const contentEl = formEl.parentElement ?? formEl;
  const bodyEl = formEl.querySelector('[data-capture-insert-new-body]');
  const statusEl = contentEl.querySelector('[data-capture-insert-new-status]');
  const insertBtn = contentEl.querySelector('[data-capture-insert-new-insert]');
  const cancelBtn = contentEl.querySelector('[data-capture-insert-new-cancel]');

  // The proposed path is editable: the trimmed input value (sans surrounding
  // slashes) is the theme-agnostic base, with the original as fallback when
  // the field is emptied.
  const originalBase = captureBasePath(capture.lightFilename);

  bodyEl.innerHTML =
    capturePathField({
      label: 'Proposed capture path',
      value: originalBase,
      editable: true,
      hint: 'Warning: Only rename this path for legitimate reasons. The majority of the time you will want to utilise the automatically generated path',
    }) +
    captureGrid([
      captureCard({ theme: 'light', title: 'Light mode', src: capture.lightDataUrl, alt: 'light mode' }),
      captureCard({ theme: 'dark', title: 'Dark mode', src: capture.darkDataUrl, alt: 'dark mode' }),
    ]) +
    captureSizeField({ dimMode: capture.dimMode ?? 'height', dimValue: capture.dimValue ?? 50 });
  wireCaptureSizeField(bodyEl);

  const pathInput = bodyEl.querySelector('[data-capture-path-input]');

  function currentBase() {
    const raw = (pathInput?.value ?? '').trim().replace(/^\/+|\/+$/g, '');
    return raw || originalBase;
  }

  const setStatus = (msg) => {
    if (!statusEl) return;
    statusEl.hidden = false;
    statusEl.textContent = msg;
  };

  let busy = false;

  async function insert() {
    if (busy) return;
    busy = true;
    if (insertBtn) insertBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    try {
      const base = currentBase();
      const light = `media/occ-captures/${base}-light-mode.png`;
      const dark = `media/occ-captures/${base}-dark-mode.png`;
      const lightPath = `docs/assets/${light}`;
      const darkPath = `docs/assets/${dark}`;

      // Re-probe at insert time: the user may have renamed onto an existing
      // path, or the path may have appeared since the post-capture probe.
      // pushCaptures is create-only, so pushing blind would silently no-op.
      let lightExists, darkExists;
      try {
        [lightExists, darkExists] = await Promise.all([
          githubPathExists(lightPath),
          githubPathExists(darkPath),
        ]);
      } catch (e) {
        setStatus(`Could not check for an existing capture: ${e.message}`);
        return;
      }

      if (lightExists || darkExists) {
        const keepMine = await resolveCaptureConflict({
          formEl, base, lightPath, lightExists, mineLightDataUrl: capture.lightDataUrl,
        });
        if (!keepMine) {
          setStatus('Kept the existing capture — rename the path to insert yours separately, or cancel.');
          return;
        }
        await overwriteCapturePair({ lightPath, darkPath, lightExists, darkExists, capture, onProgress: setStatus });
      } else {
        await pushCaptures([{ ...capture, lightFilename: light, darkFilename: dark }], setStatus);
      }

      // Files are up; hand a dataURL-less capture to the commit action so the
      // markdown splice references them without a second upload.
      const { dimMode, dimValue } = readCaptureSizeField(bodyEl);
      await getFormAction('completeComponentInsert')?.({
        capture: { lightFilename: light, darkFilename: dark, dimMode, dimValue },
      });
    } catch (e) {
      setStatus(`Failed: ${e.message}`);
    } finally {
      busy = false;
      if (insertBtn) insertBtn.disabled = false;
      if (cancelBtn) cancelBtn.disabled = false;
    }
  }

  function cancel() {
    // Back to capture mode to pick something else. Hide this overlay (the next
    // form's createForm — or a form-stack replay — tears it down) and unlock
    // body scroll for the selector, mirroring runComponentCaptureFlow's entry.
    overlay.style.display = 'none';
    document.body.style.overflow = '';
    getFormAction('reenterComponentCapture')?.();
  }

  contentEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-capture-insert-new-insert]')) insert();
    else if (e.target.closest('[data-capture-insert-new-cancel]')) cancel();
  });
}

registerFormAction('openCaptureInsertNew', openCaptureInsertNew);
```

- [x] **Step 3: Manifest entry**

In `manifest.json`, in the first `web_accessible_resources` entry's `resources` array, add (next to the other capture scripts — the array lists scripts individually, never globs):

```json
        "scripts/captureInsertNew.js",
```

- [x] **Step 4: Register via `actions.js` + breadcrumb label**

In `scripts/actions.js`, after `import './captureNew.js';` add:

```js
import './captureInsertNew.js';
```

In `scripts/form.js`, in `FORM_LABELS` (after the `captureEntry: 'Capture',` line) add:

```js
  captureInsertNew: 'New Capture',
```

- [x] **Step 5: Run the full suite**

Run: `node --test tests/*.test.mjs`
Expected: all pass.

- [x] **Step 6: Commit**

```bash
git add config/forms/captureInsertNew.html scripts/captureInsertNew.js manifest.json scripts/actions.js scripts/form.js
git commit -m "feat(captures): captureInsertNew review form for not-yet-in-library captures"
```

---

### Task 7: `captureEntry` insert mode — size field, Cancel, origin

The existing from-library review form gains the size control and a Cancel button; an `origin` param decides Cancel's behaviour. Keep the action name `completeLibraryInsert` for now — Task 8 renames it everywhere at once.

**Files:**
- Modify: `scripts/captureEntry.js`

- [x] **Step 1: Imports + signature**

Replace line 1 and line 6 of `scripts/captureEntry.js`:

```js
import { createForm, navigateBack, snapshotFormStack, replayFormStack } from './form.js';
```

```js
import {
  captureCard, captureGrid, capturePathField, captureBasePath,
  captureSizeField, wireCaptureSizeField, readCaptureSizeField,
} from './captureCards.js';
```

Replace the function signature and opener (lines 38, 42). `origin` is `'library'` (default — opened from the capture library tree) or `'captureMode'` (opened by the post-capture decision point in captures.js):

```js
export async function openCaptureEntry({ lightPath, darkPath, label, mode, origin = 'library' } = {}) {
```

```js
  const opener = () => openCaptureEntry({ lightPath, darkPath, label, mode, origin });
```

- [x] **Step 2: Size field + Cancel button in `renderPreview`**

Replace `renderPreview` (lines 78–88) with:

```js
  function renderPreview() {
    bodyEl.innerHTML =
      capturePathField({ label: 'Capture path', value: displayPath }) +
      captureGrid([
        captureCard({ theme: 'light', title: 'Light mode', src: lightObjectUrl, alt: label ?? 'light mode' }),
        captureCard({ theme: 'dark', title: 'Dark mode', src: darkObjectUrl, alt: `${label ?? 'capture'} (dark)` }),
      ]) +
      (insertMode ? captureSizeField({ dimMode: 'height', dimValue: 50 }) : '');
    if (insertMode) wireCaptureSizeField(bodyEl);
    actionsEl.innerHTML = insertMode
      ? `<button type="button" class="more-buttons-button secondary" data-capture-entry-insert-cancel><span class="more-buttons-icon">close</span>Cancel</button>
        <button type="button" class="more-buttons-button" data-capture-entry-insert><span class="more-buttons-icon">add</span>Insert this capture</button>`
      : `<button type="button" class="more-buttons-button" data-capture-entry-override><span class="more-buttons-icon">swap_vertical_circle</span>Recapture</button>`;
  }
```

(`data-capture-entry-insert-cancel` is deliberately distinct from the compare view's `data-capture-entry-cancel` — `closest('[data-capture-entry-cancel]')` does not match it.)

- [x] **Step 3: Size values into the insert payload**

Replace `insertIntoForm` (lines 93–103) with (only the size line and comment change):

```js
  // Insert mode: reference the existing library asset (no upload). Strip the
  // repo "docs/assets/" prefix so the filename matches what buildCaptureLines
  // expects, then hand off to captures.js to splice it into the origin form
  // with the size chosen on this form.
  function insertIntoForm() {
    const STRIP = 'docs/assets/';
    const stripPrefix = (p) => (p.startsWith(STRIP) ? p.slice(STRIP.length) : p);
    const lightFilename = stripPrefix(lightPath);
    const darkFilename = darkPath
      ? stripPrefix(darkPath)
      : lightFilename.replace('-light-mode', '-dark-mode');
    const { dimMode, dimValue } = readCaptureSizeField(bodyEl);
    getFormAction('completeLibraryInsert')?.({
      capture: { lightFilename, darkFilename, dimMode, dimValue },
    });
  }
```

(Behaviour change, intended per spec: library inserts previously hardcoded `dimMode: 'none'` — they now default to height/50 with the control visible.)

- [x] **Step 4: Cancel handler + click wiring**

Add after `insertIntoForm`:

```js
  // Insert-mode Cancel. From the library route this is plain back-navigation
  // (to the library tree); from the capture-mode route it re-enters capture
  // mode so the user can pick a different element — the just-taken capture is
  // simply dropped (this form shows the STORED library files; nothing was
  // pushed).
  function cancelInsert() {
    if (origin === 'captureMode') {
      overlay.style.display = 'none';
      document.body.style.overflow = '';
      getFormAction('reenterComponentCapture')?.();
    } else {
      navigateBack();
    }
  }
```

In the click dispatcher (lines 203–214), add a branch after the `data-capture-entry-insert` case:

```js
    } else if (e.target.closest('[data-capture-entry-insert-cancel]')) {
      cancelInsert();
```

- [x] **Step 5: Run the full suite**

Run: `node --test tests/*.test.mjs`
Expected: all pass.

- [x] **Step 6: Commit**

```bash
git add scripts/captureEntry.js
git commit -m "feat(captures): captureEntry insert mode — size control, Cancel, origin-aware return"
```

---

### Task 8: Rewire the component capture flow in `captures.js`

The flow flip: probe-then-review instead of push-then-edit. One commit so the runtime never half-switches.

**Files:**
- Modify: `scripts/captures.js` (everything from `openInsertedComponentEditor` to the end of the file — the named functions are listed in Step 2; line numbers will have shifted since Tasks 4–5 added code above them)
- Modify: `scripts/captureEntry.js` (one action-name string)

- [x] **Step 1: Add the two new imports**

Extend the github.js import in `scripts/captures.js` with `githubPathExists`, and add `captureBasePath`:

```js
import { githubPushImageIfNotExists, githubReplaceImage, githubPathExists } from './github.js';
import { captureBasePath } from './captureCards.js';
```

- [x] **Step 2: Replace the flow section**

In `scripts/captures.js`, DELETE all of the following (lines 107–241 of the current file):

- `openInsertedComponentEditor` (and its comment block)
- `replayAndCommitCapture` (and its comment block)
- the `completeComponentCaptureInsert` registration
- `runComponentCaptureFlow`
- `runComponentLibraryInsert`
- `componentLibraryIntent`
- the `completeLibraryInsert` registration

(KEEP `commitCapturesIntoContainer` and `chooseInsertBranch`.) Then add, in their place:

```js
// Single pending component-insert intent: where the chosen capture commits.
// Set when a library browse or a capture-mode decision form opens; consumed by
// completeComponentInsert. `snapshot` is always the ORIGIN form stack (the
// container's form), so replaying it never resurrects a stale review form.
let pendingComponentInsert = null; // { snapshot, container, insertAt } | null

// Commit the chosen capture into the origin container. Called by the Insert
// button of BOTH review forms (captureEntry insert mode + captureInsertNew):
// replays the origin form stack, then splices the capture component into the
// container's markdown. `capture` carries no dataURLs (any upload already
// happened), so commitCapturesIntoContainer's pushCaptures skips uploading.
// The component editor deliberately does NOT open — size was already set on
// the review form (captures-only deviation from insert-lands-in-editor).
registerFormAction('completeComponentInsert', async ({ capture } = {}) => {
  const intent = pendingComponentInsert;
  if (!intent || !capture || !intent.snapshot?.length) return;
  // The review forms' insert buttons bypass form.js's data-action dispatcher,
  // so this action arms the loading tile itself.
  formLoading.show();
  try {
    const ok = await replayFormStack(intent.snapshot);
    if (!ok) return;
    // The replay's createForm dropped the tile when the parent form
    // re-rendered; re-arm it to cover the commit gap.
    formLoading.show();
    await commitCapturesIntoContainer(intent.container, intent.insertAt, [capture]);
    // Clear only on success — a failed commit leaves the intent for a retry.
    pendingComponentInsert = null;
  } catch (e) {
    alert('Failed to insert capture: ' + e.message);
  } finally {
    formLoading.dismiss();
  }
});

// Post-shift-click decision point: probe whether the capture's derived path
// already exists in the library, then open the matching review form. Nothing
// is pushed from here — the review forms own all writes (the in-library form
// uploads nothing at all; captureInsertNew pushes on Insert). On a probe
// failure, fail loudly and land back on the origin form.
async function finishComponentCapture({ container, insertAt, snapshot, sessionBuffer }) {
  const capture = sessionBuffer[0];
  const lightPath = `docs/assets/${capture.lightFilename}`;
  const darkPath = `docs/assets/${capture.darkFilename}`;
  formLoading.show();
  try {
    const [lightExists, darkExists] = await Promise.all([
      githubPathExists(lightPath),
      githubPathExists(darkPath),
    ]);
    pendingComponentInsert = { snapshot, container, insertAt };
    if (chooseInsertBranch(lightExists, darkExists) === 'library') {
      await getFormAction('openCaptureEntry')?.({
        lightPath,
        darkPath,
        label: captureBasePath(capture.lightFilename),
        mode: 'insert',
        origin: 'captureMode',
      });
    } else {
      await getFormAction('openCaptureInsertNew')?.({ capture });
    }
  } catch (e) {
    alert('Failed to check the capture library: ' + e.message);
    await replayFormStack(snapshot);
  } finally {
    formLoading.dismiss();
  }
}

// Shared by the closure cold path (Turbo nav: closure alive, form DOM gone)
// and the registered cold-exit intent (hard nav: closure gone too). Replays
// the originating form stack, then runs the decision point so the buffered
// capture lands in its review form.
async function replayAndOpenInsertDecision({ container, insertAt, formStackSnapshot, sessionBuffer }) {
  if (!container || !formStackSnapshot?.length || !sessionBuffer?.length) return;
  formLoading.show();
  try {
    const ok = await replayFormStack(formStackSnapshot);
    if (ok) {
      await finishComponentCapture({ container, insertAt, snapshot: formStackSnapshot, sessionBuffer });
    }
  } catch (e) {
    alert('Failed to insert capture: ' + e.message);
  } finally {
    formLoading.dismiss();
  }
}

// Cold-exit intent for the component capture flow: a hard navigation during
// capture mode killed the JS context that held runComponentCaptureFlow's
// returnTo closures, so captureMode.js dispatches the session's serialised
// intent here instead (see planColdExit in captureMode.js).
registerFormAction('completeComponentCaptureInsert', ({ intent, formStackSnapshot, sessionBuffer } = {}) =>
  replayAndOpenInsertDecision({
    container: intent?.container,
    insertAt: intent?.insertAt,
    formStackSnapshot,
    sessionBuffer,
  }));

// "Create a new capture" → screenshot → review form (nothing pushed yet).
export function runComponentCaptureFlow({ container, insertAt, formEl, overlay }) {
  const formStackSnapshot = snapshotFormStack();
  overlay.style.display = 'none';
  const prevBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = '';

  enterCaptureMode({
    formStackSnapshot,
    // Survives a hard navigation (unlike the returnTo closures below): on cold
    // exit captureMode dispatches this intent so the capture still lands in
    // its review form.
    intent: { action: 'completeComponentCaptureInsert', container, insertAt },
    // One capture per insert in the Components context: capture mode auto-exits
    // after a single screenshot so the flow lands in the review form.
    maxCaptures: 1,
    returnTo: {
      onComplete: async (sessionBuffer) => {
        if (formEl.isConnected) {
          overlay.style.display = '';
          document.body.style.overflow = prevBodyOverflow;
          if (sessionBuffer.length) {
            await finishComponentCapture({ container, insertAt, snapshot: formStackSnapshot, sessionBuffer });
          }
          return;
        }
        // Cold-DOM path: a Turbo navigation tore the form down (this closure
        // survived, its DOM didn't). Replay the form stack, then decide.
        await replayAndOpenInsertDecision({ container, insertAt, formStackSnapshot, sessionBuffer });
      },
      // ✕ / Esc: discard everything captured this session and just re-show the
      // form. Nothing is committed to the draft (immediate-save means a commit
      // would otherwise be irreversible from here).
      onCancel: () => {
        if (formEl.isConnected) {
          overlay.style.display = '';
          document.body.style.overflow = prevBodyOverflow;
        }
      },
    },
  });
}

// Review-form Cancel (capture-mode route): drop the pending capture and go
// hunting again. Re-enters capture mode against the SAME insert intent; Done
// lands in a fresh review form, while ✕/Esc — or Done with nothing captured —
// replays the origin form stack instead (the cancelled review form hid itself
// and is torn down by whatever opens next; there is nothing to re-show).
registerFormAction('reenterComponentCapture', () => {
  const pending = pendingComponentInsert;
  if (!pending) return;
  const backToOrigin = async () => {
    formLoading.show();
    try {
      await replayFormStack(pending.snapshot);
    } finally {
      formLoading.dismiss();
    }
  };
  enterCaptureMode({
    formStackSnapshot: pending.snapshot,
    intent: { action: 'completeComponentCaptureInsert', container: pending.container, insertAt: pending.insertAt },
    maxCaptures: 1,
    returnTo: {
      onComplete: async (sessionBuffer) => {
        if (sessionBuffer.length) {
          await finishComponentCapture({ ...pending, sessionBuffer });
        } else {
          await backToOrigin();
        }
      },
      onCancel: backToOrigin,
    },
  });
});

// "Add from library" → pick a library capture → review form → commit at idx.
export function runComponentLibraryInsert({ container, insertAt }) {
  pendingComponentInsert = { snapshot: snapshotFormStack(), container, insertAt };
  return getFormAction('openCaptureLibrary')?.({ mode: 'insert' });
}
```

- [x] **Step 3: Rename the action call in `captureEntry.js`**

In `insertIntoForm` (Task 7's version), change:

```js
    getFormAction('completeLibraryInsert')?.({
```

to:

```js
    getFormAction('completeComponentInsert')?.({
```

- [x] **Step 4: Verify nothing else references the old names**

Run: `grep -rn "completeLibraryInsert\|componentLibraryIntent\|openInsertedComponentEditor\|replayAndCommitCapture" scripts/`
Expected: no output.

- [x] **Step 5: Run the full suite**

Run: `node --test tests/*.test.mjs`
Expected: all pass — in particular `tests/captureColdExit.test.mjs` (the `completeComponentCaptureInsert` action name and `planColdExit` contract are unchanged) and `tests/captureInsertBranch.test.mjs`.

- [x] **Step 6: Commit**

```bash
git add scripts/captures.js scripts/captureEntry.js
git commit -m "feat(captures): review-before-push insert flow — probe library, decision form, no editor hop"
```

---

### Task 9: Full verification

- [x] **Step 1: Full suite**

Run: `node --test tests/*.test.mjs`
Expected: all files pass, `fail 0`.

- [x] **Step 2: Manual verification (requires the human — extension must be reloaded at `chrome://extensions` because manifest.json changed)**

Checklist to walk with the user:

1. **New-capture branch:** Insert component → Capture → Create a new capture → shift-click a never-captured element → `captureInsertNew` opens: editable proposed path, in-memory light/dark tiles, Dimension control (height/50), Cancel + Insert this capture bottom-right. Nothing appears in the GitHub repo yet.
2. Insert this capture (with a custom height, e.g. 64) → PNG pair + manifest land in the repo, markdown commits with `style="height: 64px"`, container form re-renders — **no editor opens**.
3. **In-library branch:** repeat the capture on the SAME element → `captureEntry` insert form opens instead: disabled path, **stored** tiles (fetched from the repo), Dimension control, Cancel + Insert. Insert commits markdown only (no new files).
4. **Cancel → capture mode:** from each review form, Cancel re-enters capture mode; shift-click a different element lands in a fresh review form; Esc from re-entered capture mode replays back to the container form.
5. **Library route:** Insert component → Captures → From library → select → same form now shows the Dimension control + Cancel; Cancel returns to the library tree; Insert commits with the chosen size, no editor.
6. **Edit form regression:** open an existing capture component's editor — Dimension control renders/behaves as before (Auto disables the input; save round-trips).
7. **Cold exit:** enter capture mode from a container form, hard-navigate (e.g. `/sites` → `/sites/{uuid}`), shift-click → Done → form stack replays and the review form opens with the buffered capture.

- [x] **Step 3: Tick the plan checkboxes and commit any stragglers**

```bash
git add -A
git commit -m "docs(plans): capture insert decision form — verification complete"
```

(Implementation lead: after manual verification passes, update the auto-memory file `project_component_insert_opens_editor.md` — captures are now a deliberate exception to insert-lands-in-editor — and note the new flow in `project_components_merge.md` if relevant.)
