# KB Save-State Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. **The user has chosen subagent-driven execution** (fresh subagent per task + two-stage review). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "Save" button on every knowledge-base form informational — a single button that flows **blue "Save to draft" → amber "working" (with a spinning sync icon + progress messages) → green "Draft saved"** — and give all KB form action buttons one consistent colour vocabulary. Publish buttons get the same amber working state while they commit.

**Architecture:** A `bindSaveStateButton()` helper in `form.js` wires any button carrying `data-save-state` to the form's existing dirty-tracking (`isFormDirty()` / `data-dirty-guard`), re-rendering it (class + icon + label + disabled) on every `input`/`change`, and exposing `formEl._refreshSaveState()`. A `setButtonBusy(btn, message)` helper puts any save/publish button into the amber working state during a commit; `snapshotButton`/`restoreButton` restore non-dynamic buttons on error. Save handlers stop navigating away on save — they stay in place so the green "Draft saved" state is visible. Four new CSS button variants are added: `.success` (green), `.info` (blue), `.publish` (indigo), `.busy` (amber), plus a spin animation for the sync icon.

**Tech Stack:** Vanilla ES-module JavaScript (Chrome extension content scripts), HTML form partials in `config/forms/`, CSS custom properties in `config/forms/formsStyling.css`. No build step. No DOM test harness (the `tests/` suite covers pure string/markdown helpers only, via `node tests/*.test.mjs`), so per-task gates are JS **syntax checks** plus grep assertions; a **human browser verification checklist** lives in the final task.

**Reference spec:** `docs/superpowers/specs/2026-06-06-kb-save-state-buttons-design.md`

---

## State flow per button type

- **Dynamic save** (`data-save-state` buttons): blue `Save to draft` (`cloud_upload`) → amber working (`sync`, spinning, with progress text) → green `Draft saved` (`cloud_done`, disabled). Stays on the form after save.
- **Publish** buttons: indigo `Publish…` (`publish`) → amber working → navigates away on success / restores on error.
- **Delete / Discard / Create-draft**: **unchanged** — keep their existing plain-text progress (per scoping decision: amber is for Save + Publish only).

## ⚠️ Behavioural change to be aware of

Today, clicking **Save** on an *edit* form commits and then **navigates back** to the parent view. To make the green "Draft saved" state visible, this plan changes every dynamic save button to **save in place and stay open** (the user returns via the existing back arrow / breadcrumb). Create forms already stay open via their create→edit transition. This affects five forms: section edit, admonition edit+create, capture-component edit, published system-update edit, draft system-update edit. If the user prefers Save to keep navigating back, only the success-path `formEl._refreshSaveState?.()` lines need to become `await navigateBack()` again.

## File structure

| File | Change |
|---|---|
| `config/forms/formsStyling.css` | Add `.success`/`.info`/`.publish`/`.busy` variants + tokens + spin animation (Task 1) |
| `scripts/form.js` | Add `bindSaveStateButton()`, `setButtonBusy()`, `snapshotButton()`, `restoreButton()` (Task 2) |
| `config/forms/editGuideSection.html` + `scripts/guides.js` | Section Save → dynamic, amber, stay-in-place (Task 3) |
| `config/forms/editGuideAdmonition.html` + `scripts/guides.js` | Admonition Save → dynamic, amber, stay-in-place (Task 4) |
| `config/forms/editCaptureComponent.html` + `scripts/captureComponent.js` | Capture Save → dynamic, amber, stay-in-place (Task 5) |
| `config/forms/editSystemUpdate.html` + `scripts/systemUpdates.js` | Published Save & Publish → dynamic, amber (live copy) (Task 6) |
| `config/forms/editDraftSystemUpdate.html` + `scripts/systemUpdates.js` | Draft Save → dynamic; Publish → indigo + amber (Task 7) |
| `config/forms/logSystemUpdate.html` + `scripts/systemUpdates.js` | Log Save → static blue + amber; Publish → indigo + amber (Task 8) |
| `scripts/guides.js` (guide-entry hub) | Create draft → blue; Publish → indigo + amber (Task 9) |
| — | Final integration + human verification (Task 10) |

No new script files → **no `manifest.json` change needed**.

---

### Task 1: CSS button variants (green / blue / indigo / amber) + spin

**Files:**
- Modify: `config/forms/formsStyling.css` (tokens near line 19; button rules near line 564-616)

- [ ] **Step 1: Add theme tokens.** In `config/forms/formsStyling.css`, find the base token block inside `.more-buttons-overlay-content {` (containing `--mb-btn-bg: #0f172a;` around line 19). Immediately after the line `--mb-btn-2-hover:      #cbd5e1;` add:

```css
  --mb-btn-success-bg:    #16a34a;
  --mb-btn-success-hover: #15803d;
  --mb-btn-success-fg:    #ffffff;
  --mb-btn-info-btn-bg:   #2563eb;
  --mb-btn-info-btn-hover:#1d4ed8;
  --mb-btn-info-btn-fg:   #ffffff;
  --mb-btn-publish-bg:    #4f46e5;
  --mb-btn-publish-hover: #4338ca;
  --mb-btn-publish-fg:    #ffffff;
  --mb-btn-busy-bg:       #f59e0b;
  --mb-btn-busy-fg:       #1f2937;
```

(These accent colours read correctly on both the light `#ffffff` and dark `#1e293b` overlay backgrounds, so they are defined once in the base block and intentionally **not** overridden in the dark `@media` block. `--mb-btn-info-btn-*` is deliberately distinct from the pre-existing `--mb-info-bg` admonition-box token. Amber uses dark text `#1f2937` for contrast.)

- [ ] **Step 2: Add the variant classes + spin animation.** Find the `.more-buttons-button.danger:hover { ... }` rule (around line 609-611). Immediately **after** its closing `}` and **before** the `.more-buttons-button:disabled {` rule, insert:

```css
.more-buttons-button.success {
  background: var(--mb-btn-success-bg);
  color: var(--mb-btn-success-fg);
  align-self: flex-start;
}

.more-buttons-button.success:hover {
  background: var(--mb-btn-success-hover);
}

/* The saved/clean state is intentionally disabled but must stay solid green,
   not the generic faded `:disabled` look. Higher specificity than the generic
   rule below, so it wins regardless of source order. */
.more-buttons-button.success:disabled {
  opacity: 1;
  cursor: default;
  background: var(--mb-btn-success-bg);
  color: var(--mb-btn-success-fg);
}

.more-buttons-button.info {
  background: var(--mb-btn-info-btn-bg);
  color: var(--mb-btn-info-btn-fg);
  align-self: flex-start;
}

.more-buttons-button.info:hover {
  background: var(--mb-btn-info-btn-hover);
}

.more-buttons-button.publish {
  background: var(--mb-btn-publish-bg);
  color: var(--mb-btn-publish-fg);
  align-self: flex-start;
}

.more-buttons-button.publish:hover {
  background: var(--mb-btn-publish-hover);
}

/* Amber "working" state shown while a save/publish commit is in flight. Stays
   amber even though the button is disabled. */
.more-buttons-button.busy,
.more-buttons-button.busy:hover {
  background: var(--mb-btn-busy-bg);
  color: var(--mb-btn-busy-fg);
  cursor: progress;
  align-self: flex-start;
}

.more-buttons-button.busy:disabled {
  opacity: 1;
  cursor: progress;
  background: var(--mb-btn-busy-bg);
  color: var(--mb-btn-busy-fg);
}

@keyframes more-buttons-spin {
  to { transform: rotate(360deg); }
}

.more-buttons-icon--spin {
  display: inline-block;
  animation: more-buttons-spin 0.9s linear infinite;
}
```

- [ ] **Step 3: Verify the CSS rules exist.**

Run:
```bash
grep -c "more-buttons-button.success\|more-buttons-button.info\|more-buttons-button.publish\|more-buttons-button.busy" config/forms/formsStyling.css
grep -c "mb-btn-success-bg\|mb-btn-info-btn-bg\|mb-btn-publish-bg\|mb-btn-busy-bg" config/forms/formsStyling.css
grep -c "more-buttons-icon--spin\|more-buttons-spin" config/forms/formsStyling.css
```
Expected: first prints `7`, second prints `8` (4 token defs + 4 usages), third prints `3` (keyframes def + 2 references).

- [ ] **Step 4: Commit.**

```bash
git add config/forms/formsStyling.css
git commit -m "feat(forms): add success/info/publish/busy button variants + spin"
```

---

### Task 2: Button-state helpers in form.js

**Files:**
- Modify: `scripts/form.js` (add helpers near `resetDirtyBaseline`, ~line 208; call `bindSaveStateButton` after the snapshot, ~line 1011)

- [ ] **Step 1: Add the helpers.** In `scripts/form.js`, immediately **after** the `resetDirtyBaseline` function (the block ending around line 208, just before `function activeGuardedForm()`), insert:

```javascript
// Wire a `[data-save-state]` button to the form's dirty state. Clean/saved →
// disabled green "saved" pill; dirty or create-mode → clickable blue "unsaved"
// button. The form-actions bar is relocated under the overlay content, so the
// button is a sibling of the form (formEl.parentElement), not a descendant.
// Exposes formEl._refreshSaveState() so save handlers can re-sync after a commit.
export function bindSaveStateButton(formEl) {
  if (!formEl) return;
  const btn = formEl.parentElement?.querySelector('[data-save-state]')
    || formEl.querySelector('[data-save-state]');
  if (!btn) return;
  const savedLabel = btn.dataset.savedLabel || 'Draft saved';
  const unsavedLabel = btn.dataset.unsavedLabel || 'Save to draft';

  const render = () => {
    // Create-mode forms have no saved baseline yet → always "unsaved".
    const unsaved = formEl.dataset.mode === 'create' || isFormDirty(formEl);
    btn.classList.remove('busy');
    btn.classList.toggle('info', unsaved);
    btn.classList.toggle('success', !unsaved);
    btn.disabled = !unsaved;
    const icon = unsaved ? 'cloud_upload' : 'cloud_done';
    const label = unsaved ? unsavedLabel : savedLabel;
    btn.innerHTML = `<span class="more-buttons-icon">${icon}</span>${label}`;
  };

  formEl._refreshSaveState = render;
  formEl.addEventListener('input', render);
  formEl.addEventListener('change', render);
  render();
}

// Put a save/publish button into the amber "working" state while a GitHub
// commit runs: disabled, amber, spinning sync icon, and a progress message.
// The icon is built once (so the spin doesn't restart on each message tick) and
// only the message span updates on subsequent calls.
export function setButtonBusy(btn, message) {
  if (!btn) return;
  btn.disabled = true;
  if (!btn.classList.contains('busy')) {
    btn.classList.remove('info', 'success', 'publish', 'danger', 'secondary');
    btn.classList.add('busy');
    btn.innerHTML = '<span class="more-buttons-icon more-buttons-icon--spin">sync</span><span data-busy-msg></span>';
  }
  const msgEl = btn.querySelector('[data-busy-msg]');
  if (msgEl) msgEl.textContent = message;
  else btn.textContent = message;
}

// Capture/restore a button's look so a non-dynamic (publish) button can be put
// back after a busy state on error. Dynamic save buttons use _refreshSaveState
// instead.
export function snapshotButton(btn) {
  return btn ? { html: btn.innerHTML, className: btn.className } : null;
}

export function restoreButton(btn, snap) {
  if (!btn || !snap) return;
  btn.className = snap.className;
  btn.innerHTML = snap.html;
  btn.disabled = false;
}
```

- [ ] **Step 2: Call `bindSaveStateButton` after the dirty-guard snapshot.** Find the snapshot block near the end of `createForm` (around line 1007-1011):

```javascript
    // Snapshot baseline for dirty-guard forms after hydration completes so
    // later edits can be detected when the user tries to navigate away.
    if (formEl.hasAttribute('data-dirty-guard')) {
      formEl._initialSnapshot = readFormValues(formEl);
    }
```

Replace it with (adds one line):

```javascript
    // Snapshot baseline for dirty-guard forms after hydration completes so
    // later edits can be detected when the user tries to navigate away.
    if (formEl.hasAttribute('data-dirty-guard')) {
      formEl._initialSnapshot = readFormValues(formEl);
    }
    // Wire the informational save-state button (no-op for forms without one).
    bindSaveStateButton(formEl);
```

- [ ] **Step 3: Syntax check.**

Run:
```bash
cp scripts/form.js /tmp/form.mjs && node --check /tmp/form.mjs && echo "SYNTAX OK"
grep -c "export function setButtonBusy\|export function snapshotButton\|export function restoreButton\|export function bindSaveStateButton" scripts/form.js
```
Expected: `SYNTAX OK`, then `4`.

- [ ] **Step 4: Commit.**

```bash
git add scripts/form.js
git commit -m "feat(forms): button-state helpers (save-state, busy, snapshot/restore)"
```

---

### Task 3: Section form — dynamic save, amber, stay in place

**Files:**
- Modify: `config/forms/editGuideSection.html` (buttons, lines 26-29)
- Modify: `scripts/guides.js` (import line 16; `submitEditGuideSection`, lines 933-953)

- [ ] **Step 1: Update the Save button HTML.** In `config/forms/editGuideSection.html` replace:

```html
  <div class="more-buttons-form-actions">
    <button type="button" class="more-buttons-button" data-action="submitEditGuideSection" data-validate>Save</button>
    <button type="button" class="more-buttons-button danger" data-action="deleteGuideSection" data-delete-section-btn>Delete</button>
  </div>
```

with:

```html
  <div class="more-buttons-form-actions">
    <button type="button" class="more-buttons-button info" data-action="submitEditGuideSection" data-validate data-save-state data-saved-label="Draft saved" data-unsaved-label="Save to draft"><span class="more-buttons-icon">cloud_upload</span>Save to draft</button>
    <button type="button" class="more-buttons-button danger" data-action="deleteGuideSection" data-delete-section-btn>Delete</button>
  </div>
```

- [ ] **Step 2: Import the busy helper.** In `scripts/guides.js` line 16, change:

```javascript
import { createForm, replaceCurrentOpener, setCrumbLabel, isFormReplay, navigateBack, isFormDirty, resetDirtyBaseline } from './form.js';
```

to:

```javascript
import { createForm, replaceCurrentOpener, setCrumbLabel, isFormReplay, navigateBack, isFormDirty, resetDirtyBaseline, setButtonBusy, snapshotButton, restoreButton } from './form.js';
```

- [ ] **Step 3: Rewrite the handler (amber + stay-in-place).** In `scripts/guides.js` replace the whole `submitEditGuideSection` registration (lines 933-953):

```javascript
registerFormAction('submitEditGuideSection', async ({ formEl, content }) => {
  if (!currentGuide) return;
  const btn = content.querySelector('[data-save-state]');
  setButtonBusy(btn, 'Saving…');
  try {
    const result = await saveSectionForComponent(formEl, s => setButtonBusy(btn, s));
    // Validation failed → re-render the button to its live state and bail.
    if (!result) { formEl._refreshSaveState?.(); return; }
    // Saved in place (create→edit transition or in-place edit): stay open so the
    // save-state button can report "Draft saved" (green).
    formEl._refreshSaveState?.();
  } catch (e) {
    formEl._refreshSaveState?.();
    alert('Failed to save section: ' + e.message);
  }
});
```

(`saveSectionForComponent` already does the create→edit transition + `resetDirtyBaseline`, so `_refreshSaveState()` afterwards shows green; on error it shows blue. The previous `navigateBack()` and `chrome.storage.local.remove('moreButtonsEditGuideSection')` are intentionally dropped — openers re-hydrate storage from markdown on reopen.)

- [ ] **Step 4: Syntax check + assertions.**

Run:
```bash
cp scripts/guides.js /tmp/guides.mjs && node --check /tmp/guides.mjs && echo "SYNTAX OK"
grep -c "data-save-state" config/forms/editGuideSection.html
```
Expected: `SYNTAX OK`, then `1`.

- [ ] **Step 5: Commit.**

```bash
git add config/forms/editGuideSection.html scripts/guides.js
git commit -m "feat(guides): section save button — blue/amber/green save state"
```

---

### Task 4: Admonition form — dynamic save, amber, stay in place

**Files:**
- Modify: `config/forms/editGuideAdmonition.html` (buttons, lines 55-58)
- Modify: `scripts/guides.js` (`saveAdmonitionForComponent` ~line 1212; `submitEditGuideAdmonition` lines 1225-1240)

- [ ] **Step 1: Update the Save button HTML.** In `config/forms/editGuideAdmonition.html` replace:

```html
  <div class="more-buttons-form-actions">
    <button type="button" class="more-buttons-button" data-action="submitEditGuideAdmonition" data-validate>Save</button>
    <button type="button" class="more-buttons-button danger" data-action="deleteGuideAdmonition" data-delete-admonition-btn>Delete</button>
  </div>
```

with:

```html
  <div class="more-buttons-form-actions">
    <button type="button" class="more-buttons-button info" data-action="submitEditGuideAdmonition" data-validate data-save-state data-saved-label="Draft saved" data-unsaved-label="Save to draft"><span class="more-buttons-icon">cloud_upload</span>Save to draft</button>
    <button type="button" class="more-buttons-button danger" data-action="deleteGuideAdmonition" data-delete-admonition-btn>Delete</button>
  </div>
```

- [ ] **Step 2: Thread `onProgress` through `saveAdmonitionForComponent`.** In `scripts/guides.js` replace the function (lines 1212-1223):

```javascript
async function saveAdmonitionForComponent(formEl, onProgress = () => {}) {
  if (formEl.dataset.mode === 'create') {
    const res = await persistNewAdmonition(formEl, onProgress);
    if (!res) return null;
    await transitionAdmonitionCreateToEdit(formEl, res.newUuid, res.file);
    return { container: { kind: 'guide-admonition', uuid: res.newUuid, file: res.file }, formEl };
  }
  const res = await persistAdmonitionEdit(formEl, onProgress);
  if (!res) return null;
  resetDirtyBaseline(formEl);
  return { container: { kind: 'guide-admonition', uuid: res.editUuid, file: res.file }, formEl };
}
```

- [ ] **Step 3: Rewrite the handler (reuse the saver, amber + stay-in-place).** Replace the `submitEditGuideAdmonition` registration (lines 1225-1240):

```javascript
registerFormAction('submitEditGuideAdmonition', async ({ formEl, content }) => {
  const btn = content.querySelector('[data-save-state]');
  setButtonBusy(btn, 'Saving…');
  try {
    const res = await saveAdmonitionForComponent(formEl, s => setButtonBusy(btn, s));
    if (!res) { formEl._refreshSaveState?.(); return; }
    // create→edit transition or in-place edit both leave the form mounted; show green.
    formEl._refreshSaveState?.();
  } catch (e) {
    formEl._refreshSaveState?.();
    alert('Failed to save admonition: ' + e.message);
  }
});
```

(This routes the button through `saveAdmonitionForComponent`, which transitions create→edit in place — previously the button handler called `persistNewAdmonition` directly and then `navigateBack()`, so admonition create did **not** stay open like sections. This change makes the two consistent.)

- [ ] **Step 4: Syntax check + assertions.**

Run:
```bash
cp scripts/guides.js /tmp/guides.mjs && node --check /tmp/guides.mjs && echo "SYNTAX OK"
grep -c "data-save-state" config/forms/editGuideAdmonition.html
```
Expected: `SYNTAX OK`, then `1`.

- [ ] **Step 5: Commit.**

```bash
git add config/forms/editGuideAdmonition.html scripts/guides.js
git commit -m "feat(guides): admonition save button — blue/amber/green save state"
```

---

### Task 5: Capture-component form — dynamic save, amber, stay in place

**Files:**
- Modify: `config/forms/editCaptureComponent.html` (buttons, lines 19-22)
- Modify: `scripts/captureComponent.js` (import line 12; `submitEditCaptureComponent`, lines 87-112)

- [ ] **Step 1: Update the Save button HTML.** In `config/forms/editCaptureComponent.html` replace:

```html
  <div class="more-buttons-form-actions">
    <button type="button" class="more-buttons-button" data-action="submitEditCaptureComponent">Save</button>
    <button type="button" class="more-buttons-button danger" data-action="deleteCaptureComponent">Delete</button>
  </div>
```

with:

```html
  <div class="more-buttons-form-actions">
    <button type="button" class="more-buttons-button info" data-action="submitEditCaptureComponent" data-save-state data-saved-label="Draft saved" data-unsaved-label="Save to draft"><span class="more-buttons-icon">cloud_upload</span>Save to draft</button>
    <button type="button" class="more-buttons-button danger" data-action="deleteCaptureComponent">Delete</button>
  </div>
```

- [ ] **Step 2: Import the busy helper.** In `scripts/captureComponent.js` line 12, change:

```javascript
import { createForm, navigateBack, resetDirtyBaseline } from './form.js';
```

to:

```javascript
import { createForm, navigateBack, resetDirtyBaseline, setButtonBusy } from './form.js';
```

- [ ] **Step 3: Rewrite the handler (amber + stay-in-place).** In `scripts/captureComponent.js` replace the `submitEditCaptureComponent` registration (lines 87-112):

```javascript
registerFormAction('submitEditCaptureComponent', async ({ formEl, content }) => {
  const { handler, container, index } = readContainerRef(formEl);
  if (!handler) return;
  const btn = content?.querySelector('[data-save-state]');
  setButtonBusy(btn, 'Saving…');
  try {
    const mode = formEl.querySelector('[name="dimMode"]')?.value ?? 'none';
    const rawVal = parseInt(formEl.querySelector('[name="dimValue"]')?.value, 10);
    const dimValue = mode === 'none' ? null : (Number.isFinite(rawVal) && rawVal > 0 ? rawVal : 50);

    await handler.mutate(container, (components) => {
      const c = components[index];
      if (!c || c.kind !== 'capture') return components;
      const next = components.slice();
      next[index] = { kind: 'capture', cap: { ...c.cap, dimMode: mode, dimValue } };
      return next;
    }, s => setButtonBusy(btn, s));

    resetDirtyBaseline(formEl);
    formEl._refreshSaveState?.();
  } catch (e) {
    formEl._refreshSaveState?.();
    alert('Failed to save capture: ' + e.message);
  }
});
```

(The previous `chrome.storage.local.remove(...)` + `navigateBack()` are dropped. The `deleteCaptureComponent` handler below is unchanged — it keeps plain-text progress.)

- [ ] **Step 4: Syntax check + assertions.**

Run:
```bash
cp scripts/captureComponent.js /tmp/captureComponent.mjs && node --check /tmp/captureComponent.mjs && echo "SYNTAX OK"
grep -c "data-save-state" config/forms/editCaptureComponent.html
```
Expected: `SYNTAX OK`, then `1`.

- [ ] **Step 5: Commit.**

```bash
git add config/forms/editCaptureComponent.html scripts/captureComponent.js
git commit -m "feat(captures): capture component save button — blue/amber/green"
```

---

### Task 6: Published system-update edit — dynamic save, amber (live copy)

**Files:**
- Modify: `config/forms/editSystemUpdate.html` (buttons, lines 35-38)
- Modify: `scripts/systemUpdates.js` (import line 5; `submitEditSystemUpdate`, lines 511-535)

- [ ] **Step 1: Update the Save & Publish button HTML.** In `config/forms/editSystemUpdate.html` replace:

```html
  <div class="more-buttons-form-actions">
    <button type="button" class="more-buttons-button" data-action="submitEditSystemUpdate" data-validate>Save &amp; Publish</button>
    <button type="button" class="more-buttons-button danger" data-action="deleteSystemUpdate">Delete</button>
  </div>
```

with (live-flavoured copy — `All changes saved` / `Save & Publish`):

```html
  <div class="more-buttons-form-actions">
    <button type="button" class="more-buttons-button info" data-action="submitEditSystemUpdate" data-validate data-save-state data-saved-label="All changes saved" data-unsaved-label="Save &amp; Publish"><span class="more-buttons-icon">cloud_upload</span>Save &amp; Publish</button>
    <button type="button" class="more-buttons-button danger" data-action="deleteSystemUpdate">Delete</button>
  </div>
```

- [ ] **Step 2: Import the busy helpers.** In `scripts/systemUpdates.js` line 5, change:

```javascript
import { createForm, navigateBack, isFormReplay, replaceCurrentOpener, resetDirtyBaseline } from './form.js';
```

to:

```javascript
import { createForm, navigateBack, isFormReplay, replaceCurrentOpener, resetDirtyBaseline, setButtonBusy, snapshotButton, restoreButton } from './form.js';
```

- [ ] **Step 3: Rewrite the handler (amber + stay-in-place).** In `scripts/systemUpdates.js` replace the `submitEditSystemUpdate` registration (lines 511-535):

```javascript
registerFormAction('submitEditSystemUpdate', async ({ formEl, content }) => {
  const btn = content.querySelector('[data-save-state]');
  setButtonBusy(btn, 'Saving…');
  try {
    const _uuid = formEl.dataset.editUuid;
    if (!_uuid) throw new Error('No update identity found');

    const { title, date, type, description } = readUpdateFormFields(formEl);
    if (!title || !date || !type) { alert('Please fill in all required fields.'); formEl._refreshSaveState?.(); return; }

    await githubFetchAndPushFile(UPDATES_FILE, s => setButtonBusy(btn, s), md => {
      const body = rebuildUpdateBody(md, _uuid, description);
      return replaceUpdateInMarkdown(md, _uuid, { title, date, type, uuid: _uuid, description: body }, []);
    });

    resetDirtyBaseline(formEl);
    formEl._refreshSaveState?.();
  } catch (e) {
    formEl._refreshSaveState?.();
    alert('Failed to save update: ' + e.message);
  }
});
```

(The `deleteSystemUpdate` handler is unchanged — plain-text progress.)

- [ ] **Step 4: Syntax check + assertions.**

Run:
```bash
cp scripts/systemUpdates.js /tmp/systemUpdates.mjs && node --check /tmp/systemUpdates.mjs && echo "SYNTAX OK"
grep -c "data-save-state" config/forms/editSystemUpdate.html
```
Expected: `SYNTAX OK`, then `1`.

- [ ] **Step 5: Commit.**

```bash
git add config/forms/editSystemUpdate.html scripts/systemUpdates.js
git commit -m "feat(system-updates): published edit save button — blue/amber/green"
```

---

### Task 7: Draft system-update edit — dynamic save + indigo/amber publish

**Files:**
- Modify: `config/forms/editDraftSystemUpdate.html` (buttons, lines 35-39)
- Modify: `scripts/systemUpdates.js` (`saveDraftEditSystemUpdate` lines 623-647; `publishDraftSystemUpdate` lines 649-675)

- [ ] **Step 1: Update the buttons HTML (reorder to save → publish → delete).** In `config/forms/editDraftSystemUpdate.html` replace:

```html
  <div class="more-buttons-form-actions">
    <button type="button" class="more-buttons-button" data-action="publishDraftSystemUpdate" data-validate>Publish update</button>
    <button type="button" class="more-buttons-button secondary" data-action="saveDraftEditSystemUpdate" data-validate>Save draft</button>
    <button type="button" class="more-buttons-button danger" data-action="deleteDraftSystemUpdate">Delete</button>
  </div>
```

with:

```html
  <div class="more-buttons-form-actions">
    <button type="button" class="more-buttons-button info" data-action="saveDraftEditSystemUpdate" data-validate data-save-state data-saved-label="Draft saved" data-unsaved-label="Save to draft"><span class="more-buttons-icon">cloud_upload</span>Save to draft</button>
    <button type="button" class="more-buttons-button publish" data-action="publishDraftSystemUpdate" data-validate><span class="more-buttons-icon">publish</span>Publish update</button>
    <button type="button" class="more-buttons-button danger" data-action="deleteDraftSystemUpdate">Delete</button>
  </div>
```

- [ ] **Step 2: Rewrite the Save-draft handler (amber + stay-in-place).** In `scripts/systemUpdates.js` replace the `saveDraftEditSystemUpdate` registration (lines 623-647):

```javascript
registerFormAction('saveDraftEditSystemUpdate', async ({ formEl, content }) => {
  const btn = content.querySelector('[data-save-state]');
  setButtonBusy(btn, 'Saving…');
  try {
    const _uuid = formEl.dataset.editUuid;
    if (!_uuid) throw new Error('No draft identity found');

    const { title, date, type, description } = readUpdateFormFields(formEl);
    if (!title || !date || !type) { alert('Please fill in all required fields.'); formEl._refreshSaveState?.(); return; }

    await githubFetchAndPushFile(DRAFTS_FILE, s => setButtonBusy(btn, s), md => {
      const body = rebuildUpdateBody(md, _uuid, description);
      return replaceDraftInMarkdown(md, _uuid, { title, date, type, description: body }, []);
    });

    resetDirtyBaseline(formEl);
    formEl._refreshSaveState?.();
  } catch (e) {
    formEl._refreshSaveState?.();
    alert('Failed to save draft: ' + e.message);
  }
});
```

- [ ] **Step 3: Rewrite the Publish handler (amber working state).** Replace the `publishDraftSystemUpdate` registration (lines 649-675):

```javascript
registerFormAction('publishDraftSystemUpdate', async ({ formEl, content }) => {
  const btn = content.querySelector('[data-action="publishDraftSystemUpdate"]');
  const snap = snapshotButton(btn);
  if (btn) btn.disabled = true;
  try {
    const _uuid = formEl.dataset.editUuid;
    if (!_uuid) throw new Error('No draft identity found');

    const { title, date, type, description } = readUpdateFormFields(formEl);
    if (!title || !date || !type) { alert('Please fill in all required fields.'); restoreButton(btn, snap); return; }

    // Preserve the draft body's committed components; only the header + leading
    // description come from the form.
    const draftMd = await readRepoText(DRAFTS_FILE);
    const body = rebuildUpdateBody(draftMd, _uuid, description);
    await publishDraft(_uuid, { title, date, type, description: body }, [], s => setButtonBusy(btn, s));

    suppress(DRAFT_ENTITY, _uuid);
    await chrome.storage.local.remove('moreButtonsEditDraftSystemUpdate');
    await navigateBack();
  } catch (e) {
    await chrome.storage.local.remove('moreButtonsEditDraftSystemUpdate');
    restoreButton(btn, snap);
    alert('Failed to publish draft: ' + e.message);
  }
});
```

(The `deleteDraftSystemUpdate` handler is unchanged — plain-text progress.)

- [ ] **Step 4: Syntax check + assertions.**

Run:
```bash
cp scripts/systemUpdates.js /tmp/systemUpdates.mjs && node --check /tmp/systemUpdates.mjs && echo "SYNTAX OK"
grep -c "data-save-state\|class=\"more-buttons-button publish\"" config/forms/editDraftSystemUpdate.html
```
Expected: `SYNTAX OK`, then `2`.

- [ ] **Step 5: Commit.**

```bash
git add config/forms/editDraftSystemUpdate.html scripts/systemUpdates.js
git commit -m "feat(system-updates): draft edit dynamic save + indigo/amber publish"
```

---

### Task 8: Log system-update — static blue save + indigo publish (both amber while working)

**Files:**
- Modify: `config/forms/logSystemUpdate.html` (buttons, lines 35-38)
- Modify: `scripts/systemUpdates.js` (`submitLogSystemUpdate` lines 458-483; `saveDraftSystemUpdate` lines 568-589)

This form is create-only and transitions to an edit form on submit, so its Save button is **static** blue `.info` (no `data-save-state` — there is no clean/dirty cycle here). Both buttons still show the amber working state during their commit, then navigate forward.

- [ ] **Step 1: Update the buttons HTML (reorder to save → publish).** In `config/forms/logSystemUpdate.html` replace:

```html
  <div class="more-buttons-form-actions">
    <button type="button" class="more-buttons-button" data-action="submitLogSystemUpdate" data-validate>Publish update</button>
    <button type="button" class="more-buttons-button secondary" data-action="saveDraftSystemUpdate" data-validate>Save draft</button>
  </div>
```

with:

```html
  <div class="more-buttons-form-actions">
    <button type="button" class="more-buttons-button info" data-action="saveDraftSystemUpdate" data-validate><span class="more-buttons-icon">cloud_upload</span>Save to draft</button>
    <button type="button" class="more-buttons-button publish" data-action="submitLogSystemUpdate" data-validate><span class="more-buttons-icon">publish</span>Publish update</button>
  </div>
```

- [ ] **Step 2: Rewrite `submitLogSystemUpdate` (amber working, snapshot/restore on error).** In `scripts/systemUpdates.js` replace the registration (lines 458-483):

```javascript
registerFormAction('submitLogSystemUpdate', async ({ formEl, content }) => {
  const btn = content.querySelector('[data-action="submitLogSystemUpdate"]');
  const snap = snapshotButton(btn);
  if (btn) btn.disabled = true;
  try {
    const title = formEl.querySelector('[name="updateTitle"]')?.value.trim() ?? '';
    const date = formEl.querySelector('[name="updateDate"]')?.value ?? '';
    const type = formEl.querySelector('[name="updateType"]:checked')?.value;
    const description = formEl.querySelector('[name="description"]')?.value.trim() ?? '';
    if (!title || !date || !type) { alert('Please fill in all required fields.'); restoreButton(btn, snap); return; }

    const update = { title, date, type, description, uuid: generateUUID() };
    await publishNewUpdate(update, [], s => setButtonBusy(btn, s));

    await chrome.storage.local.remove('moreButtonsLogSystemUpdate');
    // Continue into the edit form so components can be added to the just-published
    // update. Repoint this slot at the list so Back returns there.
    replaceCurrentOpener('openSystemUpdatesEntry');
    await getFormAction('openEditSystemUpdate')({ uuid: update.uuid });
  } catch (e) {
    restoreButton(btn, snap);
    alert('Failed to publish update: ' + e.message);
  }
});
```

- [ ] **Step 3: Rewrite `saveDraftSystemUpdate` (amber working, snapshot/restore on error).** Replace the registration (lines 568-589):

```javascript
registerFormAction('saveDraftSystemUpdate', async ({ formEl, content }) => {
  const btn = content.querySelector('[data-action="saveDraftSystemUpdate"]');
  const snap = snapshotButton(btn);
  if (btn) btn.disabled = true;
  try {
    const { title, date, type, description } = readUpdateFormFields(formEl);
    if (!title || !date || !type) { alert('Please fill in all required fields.'); restoreButton(btn, snap); return; }

    const update = { title, date, type, description, uuid: generateUUID() };
    await saveNewDraft(update, [], s => setButtonBusy(btn, s));

    await chrome.storage.local.remove('moreButtonsLogSystemUpdate');
    // Continue into the draft edit form to add components. Repoint this slot at
    // the list so Back returns there, not the blank log form.
    replaceCurrentOpener('openSystemUpdatesEntry');
    await getFormAction('openEditDraftSystemUpdate')({ uuid: update.uuid });
  } catch (e) {
    restoreButton(btn, snap);
    alert('Failed to save draft: ' + e.message);
  }
});
```

- [ ] **Step 4: Syntax check + assertions.**

Run:
```bash
cp scripts/systemUpdates.js /tmp/systemUpdates.mjs && node --check /tmp/systemUpdates.mjs && echo "SYNTAX OK"
grep -c "originalText" scripts/systemUpdates.js
grep -c "class=\"more-buttons-button info\"\|class=\"more-buttons-button publish\"" config/forms/logSystemUpdate.html
```
Expected: `SYNTAX OK`; `originalText` count is `0` (these two handlers no longer use it); HTML grep prints `2`.

- [ ] **Step 5: Commit.**

```bash
git add config/forms/logSystemUpdate.html scripts/systemUpdates.js
git commit -m "feat(system-updates): log form blue save + indigo publish (amber working)"
```

---

### Task 9: Guide-entry hub buttons — blue create, indigo/amber publish

**Files:**
- Modify: `scripts/guides.js` (guide-entry render template, lines 161 and 172-173; `publishGuideDraft`, lines 257-295)

The guide-entry buttons render as a template string (no `data-storage-key` form). "Create draft" and "Discard draft" keep their current plain-text progress; only "Publish draft to live" gains the amber working state (per Save+Publish scope).

- [ ] **Step 1: Recolour the "Create draft" button.** In `scripts/guides.js` find (around line 161):

```javascript
      <button type="button" class="more-buttons-button" data-guide-action="create">Create draft</button>
```

replace with:

```javascript
      <button type="button" class="more-buttons-button info" data-guide-action="create">Create draft</button>
```

- [ ] **Step 2: Recolour the "Publish draft to live" + keep "Discard draft".** Find (around lines 172-173):

```javascript
    <button type="button" class="more-buttons-button" data-guide-action="publish">Publish draft to live</button>
    <button type="button" class="more-buttons-button danger" data-guide-action="discard">Discard draft</button>`;
```

replace with:

```javascript
    <button type="button" class="more-buttons-button publish" data-guide-action="publish"><span class="more-buttons-icon">publish</span>Publish draft to live</button>
    <button type="button" class="more-buttons-button danger" data-guide-action="discard">Discard draft</button>`;
```

- [ ] **Step 3: Give the Publish handler the amber working state.** Replace the whole `publishGuideDraft` function (lines 257-295):

```javascript
async function publishGuideDraft(formEl) {
  if (!currentGuide) return;
  if (!confirm('Publish this draft to live? This overwrites the live page.')) return;
  const btn = formEl.parentElement?.querySelector('[data-guide-action="publish"]');
  const snap = snapshotButton(btn);
  if (btn) btn.disabled = true;

  try {
    setButtonBusy(btn, 'Reading draft…');
    const draftMarkdown = await readRepoText(currentGuide.draftPath);
    if (!draftMarkdown) {
      alert('Draft not found at ' + currentGuide.draftPath);
      restoreButton(btn, snap);
      return;
    }
    await githubFetchAndPushFile(currentGuide.livePath, s => setButtonBusy(btn, s), () => draftMarkdown);
    setButtonBusy(btn, 'Deleting draft…');
    await githubDeleteFile(currentGuide.draftPath, s => setButtonBusy(btn, s));
    // Promote into nav (mirroring its draft_nav location) and drop from draft_nav.
    setButtonBusy(btn, 'Updating navigation…');
    const value = navValueOf(currentGuide.livePath);
    await githubFetchAndPushFile('zensical.toml', s => setButtonBusy(btn, s), md => {
      const navItems = parseNavBlock(md, 'nav').items;
      const draftItems = parseNavBlock(md, 'draft_nav').items;
      const loc = findPathOfValue(draftItems, value);
      if (!findPathOfValue(navItems, value)) {
        insertPath(navItems, loc?.segments ?? [], loc?.leafName ?? guideBaseName(currentGuide.livePath), value);
      }
      removeByValue(draftItems, value);
      let out = replaceNavBlock(md, 'nav', navItems);
      out = replaceNavBlock(out, 'draft_nav', draftItems);
      return out;
    });
    await renderGuideEntryContent(formEl);
  } catch (e) {
    restoreButton(btn, snap);
    alert('Failed to publish draft: ' + e.message);
  }
}
```

(On success `renderGuideEntryContent` re-renders the whole panel, so no manual restore is needed there. `createGuideDraft` and `discardGuideDraft` are intentionally left unchanged.)

- [ ] **Step 4: Syntax check + assertions.**

Run:
```bash
cp scripts/guides.js /tmp/guides.mjs && node --check /tmp/guides.mjs && echo "SYNTAX OK"
grep -c "more-buttons-button info\" data-guide-action=\"create\"\|more-buttons-button publish\" data-guide-action=\"publish\"" scripts/guides.js
```
Expected: `SYNTAX OK`, then `2`.

- [ ] **Step 5: Commit.**

```bash
git add scripts/guides.js
git commit -m "feat(guides): guide-entry blue create + indigo/amber publish"
```

---

### Task 10: Integration check + human browser verification

**Files:** none (verification only)

- [ ] **Step 1: Full syntax sweep of every modified JS file.**

Run:
```bash
for f in scripts/form.js scripts/guides.js scripts/systemUpdates.js scripts/captureComponent.js; do
  cp "$f" "/tmp/$(basename "$f" .js).mjs" && node --check "/tmp/$(basename "$f" .js).mjs" && echo "OK $f"
done
```
Expected: four `OK …` lines.

- [ ] **Step 2: Confirm existing unit tests still pass (no regression in pure helpers).**

Run:
```bash
for t in tests/*.test.mjs; do node "$t" && echo "PASS $t"; done
```
Expected: each test file prints its own `ok -` lines and a `PASS …` line.

- [ ] **Step 3: Confirm every dynamic save button is wired and helpers are imported.**

Run:
```bash
grep -l "data-save-state" config/forms/editGuideSection.html config/forms/editGuideAdmonition.html config/forms/editCaptureComponent.html config/forms/editSystemUpdate.html config/forms/editDraftSystemUpdate.html
grep -c "setButtonBusy" scripts/guides.js scripts/systemUpdates.js scripts/captureComponent.js
```
Expected: all five HTML paths listed; each JS file reports a non-zero `setButtonBusy` count.

- [ ] **Step 4: Human browser verification checklist.** Load the unpacked extension (`chrome://extensions` → Developer mode → Load unpacked → this folder), then exercise each form and confirm:

  - **Section edit (open an existing draft section):** button is **green, disabled, "Draft saved"** (cloud-done) on open. Edit the title → **blue, "Save to draft"** (cloud-upload). Click it → **amber with a spinning sync icon** and progress text ("Pushing…" etc.) → settles to **green "Draft saved"**, staying on the form.
  - **Section create:** **blue "Save to draft"** immediately → click → amber → transitions to edit-in-place showing **green "Draft saved"**; Delete appears.
  - **Admonition create + edit:** same blue→amber→green; create now stays in place (green) instead of navigating back.
  - **Capture component edit:** change Dimension → blue; Save → amber → green, stays open.
  - **Published system update edit:** clean **green "All changes saved"**; edit → **blue "Save & Publish"**; Save → amber → green.
  - **Draft system update edit:** **blue "Save to draft"** ⇄ green with amber while saving; **"Publish update" is indigo** and goes **amber while publishing**; unsaved + Publish still shows the save-gate confirm; Delete is red. Order: save → publish → delete.
  - **Log system update:** **"Save to draft" blue**, **"Publish update" indigo**; both go **amber + sync** while committing, then transition into the edit form.
  - **Guide entry:** "Create draft" is **blue** (plain progress while creating); "Publish draft to live" is **indigo** and goes **amber + sync** ("Reading draft…", "Deleting draft…", "Updating navigation…"); "Discard draft" is **red** (plain progress).
  - **Editing the rich-text Description** flips the save button to blue (confirms `input` events propagate).
  - **Light and dark mode:** green / blue / indigo / amber all legible in both themes; the amber sync icon spins smoothly (no stutter on message change).

- [ ] **Step 5: Final confirmation.** If any browser check fails, fix in the relevant task's files and re-commit. When all pass, the feature is complete.

---

## Self-review notes

- **Spec coverage:** dynamic save-state button (Tasks 2-7); green/blue/indigo/amber variants (Task 1); amber "working" state on Save + Publish via `setButtonBusy` (Tasks 2-9, scoped to Save+Publish per user decision — Delete/Discard/Create-draft keep plain text); capture-component participation (Task 5 — note `editCaptureComponent.html` already carries `data-dirty-guard`); published-edit adapted copy (Task 6); publish stays clickable (Task 7, no gating); guide-entry vocabulary (Task 9); button order convention (Tasks 7-8). All covered.
- **Stay-in-place** is a deliberate behavioural change, flagged near the top; isolated to the success path of each dynamic save handler for easy reversal.
- **Busy-state restart:** `setButtonBusy` builds the spinning icon once and only updates the message span thereafter, so the spin animation doesn't restart on each progress tick.
- **Edge case:** if the user types into a field mid-commit, `bindSaveStateButton`'s `render` clears `busy` and shows blue momentarily; the handler's final `_refreshSaveState()` re-settles to the correct state. Harmless and self-healing.
- **No automated DOM tests** exist in this repo; verification is syntax checks + existing pure-function tests + a human browser pass.
```
