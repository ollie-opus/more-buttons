# KB Save-State Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. **The user has chosen subagent-driven execution** (fresh subagent per task + two-stage review). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "Save" button on every knowledge-base form informational — a single button that shows a disabled green "Draft saved" pill when the form is clean and a clickable blue "Save to draft" button when there are unsaved edits — and give all KB form action buttons one consistent colour vocabulary.

**Architecture:** A new `bindSaveStateButton()` helper in `form.js` wires any button carrying `data-save-state` to the form's existing dirty-tracking (`isFormDirty()` / `data-dirty-guard`). It re-renders the button (class + icon + label + disabled) on every `input`/`change` and exposes `formEl._refreshSaveState()` so save handlers re-sync after a commit. Save handlers stop navigating away on save — they stay in place so the green "Draft saved" state is visible. Three new CSS button variants (`.success` green, `.info` blue, `.publish` indigo) are added. Publish buttons become indigo; Delete stays red.

**Tech Stack:** Vanilla ES-module JavaScript (Chrome extension content scripts), HTML form partials in `config/forms/`, CSS custom properties in `config/forms/formsStyling.css`. No build step. No DOM test harness (the `tests/` suite covers pure string/markdown helpers only, via `node tests/*.test.mjs`), so per-task gates are JS **syntax checks** plus grep assertions; a **human browser verification checklist** lives in the final task.

**Reference spec:** `docs/superpowers/specs/2026-06-06-kb-save-state-buttons-design.md`

---

## ⚠️ Behavioural change to be aware of

Today, clicking **Save** on an *edit* form commits and then **navigates back** to the parent view. To make the green "Draft saved" state visible, this plan changes every dynamic save button to **save in place and stay open** (the user returns via the existing back arrow / breadcrumb). Create forms already stay open via their create→edit transition. This unifies create and edit behaviour. If the user prefers Save to keep navigating back, only the `formEl._refreshSaveState?.()` lines in the success path of each handler need to become `await navigateBack()` again — the rest of the plan is unaffected.

## File structure

| File | Change |
|---|---|
| `config/forms/formsStyling.css` | Add `.success` / `.info` / `.publish` variants + theme tokens (Task 1) |
| `scripts/form.js` | Add `bindSaveStateButton()` + call it after the dirty-guard snapshot (Task 2) |
| `config/forms/editGuideSection.html` + `scripts/guides.js` | Section Save → dynamic, stay-in-place (Task 3) |
| `config/forms/editGuideAdmonition.html` + `scripts/guides.js` | Admonition Save → dynamic, stay-in-place (Task 4) |
| `config/forms/editCaptureComponent.html` + `scripts/captureComponent.js` | Capture Save → dynamic, stay-in-place (Task 5) |
| `config/forms/editSystemUpdate.html` + `scripts/systemUpdates.js` | Published update Save & Publish → dynamic (live copy) (Task 6) |
| `config/forms/editDraftSystemUpdate.html` + `scripts/systemUpdates.js` | Draft Save → dynamic; Publish → indigo (Task 7) |
| `config/forms/logSystemUpdate.html` + `scripts/systemUpdates.js` | Log Save → static blue; Publish → indigo (Task 8) |
| `scripts/guides.js` (guide-entry hub) | Create draft → blue; Publish → indigo (Task 9) |
| — | Final integration + human verification (Task 10) |

No new script files → **no `manifest.json` change needed**.

---

### Task 1: CSS button variants (green / blue / indigo)

**Files:**
- Modify: `config/forms/formsStyling.css` (tokens near line 19; button rules near line 564-616)

- [ ] **Step 1: Add theme tokens.** In `config/forms/formsStyling.css`, find the base token block inside `.more-buttons-overlay-content {` (the one containing `--mb-btn-bg: #0f172a;` around line 19). Immediately after the line `--mb-btn-2-hover:      #cbd5e1;` add:

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
```

(These accent colours read correctly on both the light `#ffffff` and dark `#1e293b` overlay backgrounds, so they are defined once in the base block and intentionally **not** overridden in the dark `@media` block. Note `--mb-btn-info-btn-*` is deliberately distinct from the pre-existing `--mb-info-bg` admonition-box token.)

- [ ] **Step 2: Add the variant classes.** Find the `.more-buttons-button.danger:hover { ... }` rule (around line 609-611). Immediately **after** its closing `}` and **before** the `.more-buttons-button:disabled {` rule, insert:

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
```

- [ ] **Step 3: Verify the CSS parses and rules exist.**

Run:
```bash
grep -c "more-buttons-button.success\|more-buttons-button.info\|more-buttons-button.publish" config/forms/formsStyling.css
grep -c "mb-btn-success-bg\|mb-btn-info-btn-bg\|mb-btn-publish-bg" config/forms/formsStyling.css
```
Expected: first prints `5`, second prints `6` (3 token defs + 3 usages).

- [ ] **Step 4: Commit.**

```bash
git add config/forms/formsStyling.css
git commit -m "feat(forms): add success/info/publish button colour variants"
```

---

### Task 2: `bindSaveStateButton()` helper in form.js

**Files:**
- Modify: `scripts/form.js` (add helper near `isFormDirty`, ~line 190; call it after the snapshot, ~line 1011)

- [ ] **Step 1: Add the helper.** In `scripts/form.js`, immediately **after** the `resetDirtyBaseline` function (the block ending around line 208, just before `function activeGuardedForm()`), insert:

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
```

- [ ] **Step 2: Call it after the dirty-guard snapshot.** Find the snapshot block near the end of `createForm` (around line 1007-1011):

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
```
Expected: prints `SYNTAX OK`.

- [ ] **Step 4: Commit.**

```bash
git add scripts/form.js
git commit -m "feat(forms): bindSaveStateButton wires save buttons to dirty state"
```

---

### Task 3: Section form — dynamic save, stay in place

**Files:**
- Modify: `config/forms/editGuideSection.html` (buttons, lines 26-29)
- Modify: `scripts/guides.js` (`submitEditGuideSection`, lines 933-953)

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

- [ ] **Step 2: Rewrite the handler to stay in place.** In `scripts/guides.js` replace the whole `submitEditGuideSection` registration (lines 933-953):

```javascript
registerFormAction('submitEditGuideSection', async ({ formEl, content }) => {
  if (!currentGuide) return;
  const btn = content.querySelector('[data-save-state]');
  if (btn) btn.disabled = true;
  try {
    const result = await saveSectionForComponent(formEl, s => { if (btn) btn.textContent = s; });
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

(`saveSectionForComponent` already does the create→edit transition + `resetDirtyBaseline` internally, so `_refreshSaveState()` afterwards correctly shows green. The previous `navigateBack()` and `chrome.storage.local.remove('moreButtonsEditGuideSection')` calls are intentionally dropped — openers re-hydrate storage from markdown on reopen.)

- [ ] **Step 3: Syntax check + assertions.**

Run:
```bash
cp scripts/guides.js /tmp/guides.mjs && node --check /tmp/guides.mjs && echo "SYNTAX OK"
grep -c "data-save-state" config/forms/editGuideSection.html
```
Expected: `SYNTAX OK`, then `1`.

- [ ] **Step 4: Commit.**

```bash
git add config/forms/editGuideSection.html scripts/guides.js
git commit -m "feat(guides): section save button reflects draft save state"
```

---

### Task 4: Admonition form — dynamic save, stay in place

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

- [ ] **Step 3: Rewrite the handler to reuse the saver + stay in place.** Replace the `submitEditGuideAdmonition` registration (lines 1225-1240):

```javascript
registerFormAction('submitEditGuideAdmonition', async ({ formEl, content }) => {
  const btn = content.querySelector('[data-save-state]');
  if (btn) btn.disabled = true;
  try {
    const res = await saveAdmonitionForComponent(formEl, s => { if (btn) btn.textContent = s; });
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
git commit -m "feat(guides): admonition save button reflects draft save state"
```

---

### Task 5: Capture-component form — dynamic save, stay in place

**Files:**
- Modify: `config/forms/editCaptureComponent.html` (buttons, lines 19-22)
- Modify: `scripts/captureComponent.js` (`submitEditCaptureComponent`, lines 87-112)

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

- [ ] **Step 2: Rewrite the handler to stay in place.** In `scripts/captureComponent.js` replace the `submitEditCaptureComponent` registration (lines 87-112):

```javascript
registerFormAction('submitEditCaptureComponent', async ({ formEl, content }) => {
  const { handler, container, index } = readContainerRef(formEl);
  if (!handler) return;
  const btn = content?.querySelector('[data-save-state]');
  if (btn) btn.disabled = true;
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
    }, s => { if (btn) btn.textContent = s; });

    resetDirtyBaseline(formEl);
    formEl._refreshSaveState?.();
  } catch (e) {
    formEl._refreshSaveState?.();
    alert('Failed to save capture: ' + e.message);
  }
});
```

(`resetDirtyBaseline` is already imported at the top of this file. The previous `chrome.storage.local.remove(...)` + `navigateBack()` are dropped. The `deleteCaptureComponent` handler below is unchanged.)

- [ ] **Step 3: Syntax check + assertions.**

Run:
```bash
cp scripts/captureComponent.js /tmp/captureComponent.mjs && node --check /tmp/captureComponent.mjs && echo "SYNTAX OK"
grep -c "data-save-state" config/forms/editCaptureComponent.html
```
Expected: `SYNTAX OK`, then `1`.

- [ ] **Step 4: Commit.**

```bash
git add config/forms/editCaptureComponent.html scripts/captureComponent.js
git commit -m "feat(captures): capture component save button reflects save state"
```

---

### Task 6: Published system-update edit — dynamic save (live copy)

**Files:**
- Modify: `config/forms/editSystemUpdate.html` (buttons, lines 35-38)
- Modify: `scripts/systemUpdates.js` (`submitEditSystemUpdate`, lines 511-535)

- [ ] **Step 1: Update the Save & Publish button HTML.** In `config/forms/editSystemUpdate.html` replace:

```html
  <div class="more-buttons-form-actions">
    <button type="button" class="more-buttons-button" data-action="submitEditSystemUpdate" data-validate>Save &amp; Publish</button>
    <button type="button" class="more-buttons-button danger" data-action="deleteSystemUpdate">Delete</button>
  </div>
```

with (this form writes straight to the live file, so it uses live-flavoured copy — `All changes saved` / `Save & Publish`):

```html
  <div class="more-buttons-form-actions">
    <button type="button" class="more-buttons-button info" data-action="submitEditSystemUpdate" data-validate data-save-state data-saved-label="All changes saved" data-unsaved-label="Save &amp; Publish"><span class="more-buttons-icon">cloud_upload</span>Save &amp; Publish</button>
    <button type="button" class="more-buttons-button danger" data-action="deleteSystemUpdate">Delete</button>
  </div>
```

- [ ] **Step 2: Rewrite the handler to stay in place.** In `scripts/systemUpdates.js` replace the `submitEditSystemUpdate` registration (lines 511-535):

```javascript
registerFormAction('submitEditSystemUpdate', async ({ formEl, content }) => {
  const btn = content.querySelector('[data-save-state]');
  if (btn) btn.disabled = true;
  try {
    const _uuid = formEl.dataset.editUuid;
    if (!_uuid) throw new Error('No update identity found');

    const { title, date, type, description } = readUpdateFormFields(formEl);
    if (!title || !date || !type) { alert('Please fill in all required fields.'); formEl._refreshSaveState?.(); return; }

    await githubFetchAndPushFile(UPDATES_FILE, s => { if (btn) btn.textContent = s; }, md => {
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

(`resetDirtyBaseline` is already imported at the top of `systemUpdates.js`. The `deleteSystemUpdate` handler is unchanged.)

- [ ] **Step 3: Syntax check + assertions.**

Run:
```bash
cp scripts/systemUpdates.js /tmp/systemUpdates.mjs && node --check /tmp/systemUpdates.mjs && echo "SYNTAX OK"
grep -c "data-save-state" config/forms/editSystemUpdate.html
```
Expected: `SYNTAX OK`, then `1`.

- [ ] **Step 4: Commit.**

```bash
git add config/forms/editSystemUpdate.html scripts/systemUpdates.js
git commit -m "feat(system-updates): published edit save button reflects save state"
```

---

### Task 7: Draft system-update edit — dynamic save + indigo publish

**Files:**
- Modify: `config/forms/editDraftSystemUpdate.html` (buttons, lines 35-39)
- Modify: `scripts/systemUpdates.js` (`saveDraftEditSystemUpdate`, lines 623-647)

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

- [ ] **Step 2: Rewrite the Save-draft handler to stay in place.** In `scripts/systemUpdates.js` replace the `saveDraftEditSystemUpdate` registration (lines 623-647):

```javascript
registerFormAction('saveDraftEditSystemUpdate', async ({ formEl, content }) => {
  const btn = content.querySelector('[data-save-state]');
  if (btn) btn.disabled = true;
  try {
    const _uuid = formEl.dataset.editUuid;
    if (!_uuid) throw new Error('No draft identity found');

    const { title, date, type, description } = readUpdateFormFields(formEl);
    if (!title || !date || !type) { alert('Please fill in all required fields.'); formEl._refreshSaveState?.(); return; }

    await githubFetchAndPushFile(DRAFTS_FILE, s => { if (btn) btn.textContent = s; }, md => {
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

(The `publishDraftSystemUpdate` handler keeps navigating away — Publish is terminal — and needs **no JS change**; its button just became indigo. It still finds its button via `[data-action="publishDraftSystemUpdate"]`, which is unchanged. The `deleteDraftSystemUpdate` handler is unchanged.)

- [ ] **Step 3: Syntax check + assertions.**

Run:
```bash
cp scripts/systemUpdates.js /tmp/systemUpdates.mjs && node --check /tmp/systemUpdates.mjs && echo "SYNTAX OK"
grep -c "data-save-state\|class=\"more-buttons-button publish\"" config/forms/editDraftSystemUpdate.html
```
Expected: `SYNTAX OK`, then `2`.

- [ ] **Step 4: Commit.**

```bash
git add config/forms/editDraftSystemUpdate.html scripts/systemUpdates.js
git commit -m "feat(system-updates): draft edit dynamic save + indigo publish"
```

---

### Task 8: Log system-update — static blue save + indigo publish

**Files:**
- Modify: `config/forms/logSystemUpdate.html` (buttons, lines 35-38)
- Modify: `scripts/systemUpdates.js` (`submitLogSystemUpdate` lines 458-483; `saveDraftSystemUpdate` lines 568-589 — error-path icon preservation only)

This form is create-only and transitions to an edit form on submit, so its Save button is **static** blue `.info` (no `data-save-state` — there is no clean/dirty cycle here).

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

- [ ] **Step 2: Preserve the button icon on error in `submitLogSystemUpdate`.** The handler swaps `btn.textContent` during the commit, which drops the icon; restore via `innerHTML` instead of `textContent` so the icon returns on error. In `scripts/systemUpdates.js`, in the `submitLogSystemUpdate` registration (lines 458-483), change the first three lines from:

```javascript
  const btn = content.querySelector('[data-action="submitLogSystemUpdate"]');
  const originalText = btn.textContent;
  btn.disabled = true;
```

to:

```javascript
  const btn = content.querySelector('[data-action="submitLogSystemUpdate"]');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
```

and in the same handler's `catch` block change:

```javascript
    btn.textContent = originalText;
    btn.disabled = false;
```

to:

```javascript
    btn.innerHTML = originalHtml;
    btn.disabled = false;
```

- [ ] **Step 3: Same icon-preservation fix for `saveDraftSystemUpdate`.** In the `saveDraftSystemUpdate` registration (lines 568-589) change:

```javascript
  const btn = content.querySelector('[data-action="saveDraftSystemUpdate"]');
  const originalText = btn.textContent;
  btn.disabled = true;
```

to:

```javascript
  const btn = content.querySelector('[data-action="saveDraftSystemUpdate"]');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
```

and in its `catch` block change:

```javascript
    btn.textContent = originalText;
    btn.disabled = false;
```

to:

```javascript
    btn.innerHTML = originalHtml;
    btn.disabled = false;
```

(The early validation-fail returns in both handlers only set `btn.disabled = false` and never touched the icon, so they need no change.)

- [ ] **Step 4: Syntax check + assertions.**

Run:
```bash
cp scripts/systemUpdates.js /tmp/systemUpdates.mjs && node --check /tmp/systemUpdates.mjs && echo "SYNTAX OK"
grep -c "originalText" scripts/systemUpdates.js
grep -c "class=\"more-buttons-button info\"\|class=\"more-buttons-button publish\"" config/forms/logSystemUpdate.html
```
Expected: `SYNTAX OK`; `originalText` count is `0` (all four occurrences in these two handlers replaced); HTML grep prints `2`.

- [ ] **Step 5: Commit.**

```bash
git add config/forms/logSystemUpdate.html scripts/systemUpdates.js
git commit -m "feat(system-updates): log form static blue save + indigo publish"
```

---

### Task 9: Guide-entry hub buttons — blue create, indigo publish

**Files:**
- Modify: `scripts/guides.js` (guide-entry render template, lines 161 and 172-173)

These buttons are rendered as a template string in `renderGuideEntry` (no `data-storage-key` form), so they are static — just colour + icon changes.

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

- [ ] **Step 3: Syntax check + assertions.**

Run:
```bash
cp scripts/guides.js /tmp/guides.mjs && node --check /tmp/guides.mjs && echo "SYNTAX OK"
grep -c "more-buttons-button info\" data-guide-action=\"create\"\|more-buttons-button publish\" data-guide-action=\"publish\"" scripts/guides.js
```
Expected: `SYNTAX OK`, then `2`.

- [ ] **Step 4: Commit.**

```bash
git add scripts/guides.js
git commit -m "feat(guides): guide-entry blue create + indigo publish buttons"
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
Expected: each test file prints its own `ok -` lines and a `PASS …` line (these cover markdown/nav helpers untouched by this work; they must still pass).

- [ ] **Step 3: Confirm every dynamic save button is wired.**

Run:
```bash
grep -l "data-save-state" config/forms/editGuideSection.html config/forms/editGuideAdmonition.html config/forms/editCaptureComponent.html config/forms/editSystemUpdate.html config/forms/editDraftSystemUpdate.html
```
Expected: all five file paths listed.

- [ ] **Step 4: Human browser verification checklist.** Load the unpacked extension (`chrome://extensions` → Developer mode → Load unpacked → this folder), then exercise each form and confirm:

  - **Section edit (open an existing draft section):** button is **green, disabled, "Draft saved"** with a cloud-done icon on open. Edit the title → button turns **blue, enabled, "Save to draft"** with a cloud-upload icon. Click it → shows "Pushing…" then returns to **green "Draft saved"**, staying on the form.
  - **Section create:** button is **blue "Save to draft"** immediately. Save → transitions to edit-in-place and shows **green "Draft saved"**; Delete button appears.
  - **Admonition create + edit:** same blue⇄green behaviour; create now stays in place (green) instead of navigating back.
  - **Capture component edit:** change the Dimension → blue; Save → green, stays open.
  - **Published system update edit:** clean shows **green "All changes saved"**; edit a field → **blue "Save & Publish"**; Save → green.
  - **Draft system update edit:** **blue "Save to draft"** ⇄ green; **"Publish update" is indigo**; clicking Publish with unsaved changes still shows the existing save-gate confirm; Delete is red. Order is save → publish → delete.
  - **Log system update:** **"Save to draft" is blue**, **"Publish update" is indigo**; both still transition into the edit form.
  - **Guide entry:** "Create draft" is **blue**; with a draft, "Publish draft to live" is **indigo** (with icon) and "Discard draft" is **red**.
  - **Editing the rich-text Description** on any form flips the button to blue (confirms `input` events propagate).
  - **Light and dark mode:** all three colours (green / blue / indigo) are legible in both themes.

- [ ] **Step 5: Final confirmation.** If any browser check fails, fix in the relevant task's files and re-commit. When all pass, the feature is complete — no extra commit needed (each task already committed).

---

## Self-review notes

- **Spec coverage:** dynamic save-state button (Tasks 2-7), green/blue/indigo variants (Task 1), capture-component participation (Task 5 — note: `editCaptureComponent.html` already carries `data-dirty-guard`, so no attribute add was needed, correcting the spec's assumption), published-edit adapted copy (Task 6), publish stays clickable (Task 7, no gating added), guide-entry vocabulary (Task 9), button order convention (Tasks 7-8). All covered.
- **Stay-in-place** is a deliberate behavioural change, flagged at the top; isolated to the success path of each handler for easy reversal.
- **No automated DOM tests** exist in this repo; verification is syntax checks + existing pure-function tests + a human browser pass. This matches the codebase, which has no jsdom/extension test harness.
