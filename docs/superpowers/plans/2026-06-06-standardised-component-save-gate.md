# Standardised "save-to-add-component" Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task (the user has chosen subagent-driven execution: one fresh subagent per task, two-stage review between tasks). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every knowledge-base component form (guide sections, guide admonitions, the log-system-update form, and the system-update / draft editors) show a Components list at all times and route all child-component navigation through one "this form isn't saved — save & continue?" gate; then retire the legacy in-memory captures buffer.

**Architecture:** A single gate (`beginChildNavigation` → `ensureContainerReady`) intercepts every insert/edit of a child component. If the parent form is in `create` mode or `isFormDirty`, it confirms, calls the form's attached `_componentSaver()` (which persists and returns `{ container, formEl }` — the formEl may change if saving navigated), then runs the child flow against the now-saved container. Each opener attaches the appropriate saver; the existing submit handlers are refactored to share the same persistence functions (DRY).

**Tech stack:** Vanilla ES modules in a Chrome MV3 content-script extension. No bundler. No DOM test runner — the codebase Node-tests pure leaf utilities (`tests/*.test.mjs`, run with `node tests/<file>.test.mjs`) and verifies UI by loading the unpacked extension. **Verification for this plan is: `node --check <file>` on every edited JS file (catches syntax/parse errors), `node --test`-style run of the existing suites (regression), and the manual browser checklist in each task.** This matches the repo's established "Node-verified, browser-tested" convention; do not invent fake DOM unit tests.

**No new files are created.** All `scripts/*.js` are already in `manifest.json` web_accessible_resources, so no manifest change is needed.

---

## File map

| File | Responsibility | Change |
|---|---|---|
| `scripts/form.js` | overlay/form engine + dirty guard | export `isFormDirty` |
| `scripts/guides.js` | guide editors + shared component machinery | add the gate; section saver; refactor section submit; show components in section-create; rewrite `onComponentEditorClick` |
| `scripts/systemUpdates.js` | system-update editors | migrate `logSystemUpdate` to unified components; add update savers; drop legacy capture calls |
| `config/forms/logSystemUpdate.html` | log form markup | replace Captures block with Components block |
| `scripts/captures.js` | capture round-trip + (legacy) buffer | delete the dead legacy buffer API |
| `scripts/captureMode.js` | capture-mode controller | delete the legacy cold-exit re-render block |
| `config/forms/formsStyling.css` | overlay styles | delete legacy capture/cap-insert CSS |

---

## Task 1: Export `isFormDirty` from form.js

**Files:**
- Modify: `scripts/form.js:171`

- [ ] **Step 1: Make `isFormDirty` exported**

In `scripts/form.js`, change line 171 from:

```js
function isFormDirty(formEl) {
```

to:

```js
export function isFormDirty(formEl) {
```

- [ ] **Step 2: Verify it parses**

Run: `node --check scripts/form.js`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add scripts/form.js
git commit -m "refactor(form): export isFormDirty for the component save-gate"
```

---

## Task 2: Guide-section slice — gate machinery + section saver + components in create mode

This task delivers a complete working slice for guide sections: the Components list shows in create mode, and adding/editing a child component on an unsaved or dirty section prompts to save first.

**Files:**
- Modify: `scripts/guides.js` (imports; `openCreateGuideSection`; `openEditGuideSection`; new gate functions; new `saveSectionForComponent` + `transitionSectionCreateToEdit`; refactor `submitEditGuideSection`; rewrite `onComponentEditorClick`)

- [ ] **Step 1: Update the form.js import in guides.js**

In `scripts/guides.js` line 16, replace:

```js
import { createForm, replaceCurrentOpener, setCrumbLabel, isFormReplay, navigateBack, confirmDiscardIfDirty, resetDirtyBaseline } from './form.js';
```

with (drop `confirmDiscardIfDirty`, add `isFormDirty`):

```js
import { createForm, replaceCurrentOpener, setCrumbLabel, isFormReplay, navigateBack, isFormDirty, resetDirtyBaseline } from './form.js';
```

- [ ] **Step 2: Add the shared gate machinery**

In `scripts/guides.js`, immediately **above** the existing `export function onComponentEditorClick(e) {` (currently ~line 725), insert:

```js
// ── The component save-gate ──────────────────────────────────────────────────
//
// Every child-component navigation (insert a new component, or open an existing
// one for edit) goes through beginChildNavigation. If the parent form is unsaved
// (create mode) or has unsaved field edits (dirty), it confirms and persists via
// the form's attached `_componentSaver()` before running the child flow. Savers
// return { container, formEl } — formEl may differ if saving navigated to a new
// form (e.g. log-update → draft editor).

const CONTAINER_NOUN = {
  'guide-section': 'section',
  'guide-admonition': 'admonition',
  'system-update': 'update',
  'system-draft': 'draft',
};

function componentNoun(formEl) {
  return formEl.dataset.componentNoun || CONTAINER_NOUN[formEl.dataset.componentContainerKind] || 'item';
}

// The saved container identity carried on a form (valid only once saved).
function containerFromForm(formEl) {
  return {
    kind: formEl.dataset.componentContainerKind,
    uuid: formEl.dataset.editUuid,
    file: formEl.dataset.containerFile || currentGuide?.draftPath,
  };
}

// Ensure the form's container is persisted before navigating to a child.
// Returns { container, formEl } or null (user cancelled / validation failed).
async function ensureContainerReady(formEl) {
  const needsSave = formEl.dataset.mode === 'create' || isFormDirty(formEl);
  if (!needsSave) return { container: containerFromForm(formEl), formEl };
  const noun = componentNoun(formEl);
  const msg = formEl.dataset.mode === 'create'
    ? `This ${noun} hasn’t been saved yet. Save it to continue?`
    : `You have unsaved changes. Save them to continue?`;
  if (!confirm(msg)) return null;
  const saver = formEl._componentSaver;
  if (typeof saver !== 'function') { console.warn('[MB] form has no _componentSaver'); return null; }
  return await saver();
}

async function beginChildNavigation(formEl, action) {
  const ready = await ensureContainerReady(formEl);
  if (!ready) return;
  await runChildAction(ready.container, ready.formEl, action);
}

async function runChildAction(container, formEl, action) {
  const overlay = formEl.closest('.more-buttons-overlay');
  if (action.type === 'insert') {
    if (action.kind === 'admonition') getFormAction('openCreateGuideAdmonition')?.({ container, insertAtIndex: action.insertAt });
    else if (action.kind === 'capture-new') runComponentCaptureFlow({ container, insertAt: action.insertAt, formEl, overlay });
    else if (action.kind === 'capture-library') runComponentLibraryInsert({ container, insertAt: action.insertAt });
  } else if (action.type === 'edit-admonition') {
    getFormAction('openEditGuideAdmonition')?.({ uuid: action.uuid, file: container.file });
  } else if (action.type === 'edit-capture') {
    openCaptureComponentEditor(container, action.index);
  }
}
```

- [ ] **Step 3: Rewrite `onComponentEditorClick` to use the gate**

In `scripts/guides.js`, replace the **entire** existing `export function onComponentEditorClick(e) { … }` body (currently ~lines 725-760) with:

```js
// Shared click delegation for every component editor (section / admonition /
// system-update). Routes all child navigation through the save-gate.
export function onComponentEditorClick(e) {
  const formEl = e.currentTarget;

  const editAdm = e.target.closest('[data-edit-guide-admonition]');
  if (editAdm) {
    beginChildNavigation(formEl, { type: 'edit-admonition', uuid: editAdm.dataset.editGuideAdmonition });
    return;
  }

  const editCap = e.target.closest('[data-edit-component]');
  if (editCap) {
    beginChildNavigation(formEl, { type: 'edit-capture', index: parseInt(editCap.dataset.editComponent, 10) });
    return;
  }

  const insert = e.target.closest('[data-insert-component-at]');
  if (insert) {
    const idx = parseInt(insert.dataset.insertComponentAt, 10);
    const anchor = insert.querySelector('.mb-insert-component__btn') || insert;
    openInsertMenu(anchor, idx, {
      admonition: (i) => beginChildNavigation(formEl, { type: 'insert', kind: 'admonition', insertAt: i }),
      captureNew: (i) => beginChildNavigation(formEl, { type: 'insert', kind: 'capture-new', insertAt: i }),
      captureLibrary: (i) => beginChildNavigation(formEl, { type: 'insert', kind: 'capture-library', insertAt: i }),
    });
    return;
  }
}
```

- [ ] **Step 4: Extract `transitionSectionCreateToEdit` and add `saveSectionForComponent`**

In `scripts/guides.js`, add these two functions just above `registerFormAction('submitEditGuideSection', …)` (currently ~line 803):

```js
// Flip an in-place section create form into an edit-of-new-section form: point
// its history slot at the saved section, reveal Delete + Components, render the
// (empty) component list, refresh heading/crumb/parent dropdown, and re-baseline
// the dirty guard. Shared by the Save button and the component save-gate.
async function transitionSectionCreateToEdit(formEl, newUuid, level, title, description, parentUuid) {
  formEl.dataset.mode = 'edit';
  formEl.dataset.editUuid = newUuid;
  formEl.dataset.editLevel = String(level);
  replaceCurrentOpener(() => getFormAction('openEditGuideSection')({ uuid: newUuid }));
  formEl.parentElement?.querySelector('[data-delete-section-btn]')?.style.removeProperty('display');
  formEl.querySelector('[data-components-row]')?.style.removeProperty('display');
  const listEl = formEl.querySelector('[data-section-components]');
  renderComponents(listEl, []);
  setOpenComponentEditor({ formEl, listEl, container: { kind: 'guide-section', uuid: newUuid, file: currentGuide.draftPath } });
  const refreshed = await readRepoText(currentGuide.draftPath);
  const newTreeMatch = buildSectionTree(refreshed).sections.find(s => s.uuid === newUuid);
  const heading = formEl.querySelector('[data-guide-section-heading]');
  if (heading) heading.textContent = newTreeMatch ? `Edit ${newTreeMatch.label.toLowerCase()}` : 'Edit section';
  if (newTreeMatch?.visualLabel) setCrumbLabel(newTreeMatch.visualLabel);
  populateParentDropdown(formEl, refreshed, newUuid, level);
  await chrome.storage.local.set({
    moreButtonsEditGuideSection: { sectionTitle: title, sectionDescription: description, sectionParent: parentUuid },
  });
  resetDirtyBaseline(formEl);
}

// Persist the section form. create → insert + transition-in-place; dirty edit →
// rewrite body (+ optional parent move) + rebaseline. Returns { container,
// formEl } or null (validation failed). Used by the Save button and the gate.
async function saveSectionForComponent(formEl, onProgress = () => {}) {
  const title = formEl.querySelector('[name="sectionTitle"]')?.value.trim() ?? '';
  const description = formEl.querySelector('[name="sectionDescription"]')?.value ?? '';
  const parentUuid = formEl.querySelector('[name="sectionParent"]')?.value ?? '';
  if (!title) { alert('Title is required.'); return null; }

  if (formEl.dataset.mode === 'create') {
    let level = 2;
    if (parentUuid) {
      const draftNow = await readRepoText(currentGuide.draftPath);
      const par = locateSectionByUUID(draftNow, parentUuid);
      if (par) level = Math.min(3, par.level + 1);
    }
    let newUuid;
    await githubFetchAndPushFile(currentGuide.draftPath, onProgress, md => {
      const result = insertSectionUnderParent(md, parentUuid || null, level, title, description.trim());
      newUuid = result.uuid;
      return result.markdown;
    });
    await transitionSectionCreateToEdit(formEl, newUuid, level, title, description, parentUuid);
    return { container: { kind: 'guide-section', uuid: newUuid, file: currentGuide.draftPath }, formEl };
  }

  const editUuid = formEl.dataset.editUuid;
  const draftMarkdown = await readRepoText(currentGuide.draftPath);
  const section = locateSectionByUUID(draftMarkdown, editUuid);
  if (!section) { alert('Section no longer exists.'); return null; }
  const currentParentUuid = section.level === 2
    ? (buildSectionTree(draftMarkdown).title?.uuid ?? null)
    : (section.level === 3 ? findH2ParentUuid(draftMarkdown, editUuid) || null : null);
  const requestedParent = parentUuid || null;
  const parentChanged = section.level !== 1 && (currentParentUuid ?? null) !== (requestedParent ?? null);

  await githubFetchAndPushFile(currentGuide.draftPath, onProgress, md => {
    const { components } = readContainerComponents(md, { kind: 'guide-section', uuid: editUuid });
    const newBody = buildComponentBody(null, description, components);
    let updated = replaceSectionByUUID(md, editUuid, buildSection(section.level, title, editUuid, newBody));
    if (parentChanged) updated = moveSectionToParent(updated, editUuid, requestedParent);
    return updated;
  });
  resetDirtyBaseline(formEl);
  return { container: { kind: 'guide-section', uuid: editUuid, file: currentGuide.draftPath }, formEl };
}
```

> Note: `setOpenComponentEditor` is already defined/exported in this file (it sets the module `openComponentEditor`); use it rather than assigning the variable directly so this function can sit anywhere in the module.

- [ ] **Step 5: Refactor `submitEditGuideSection` to delegate to the shared saver**

Replace the entire `registerFormAction('submitEditGuideSection', …)` handler (currently ~lines 803-899) with:

```js
registerFormAction('submitEditGuideSection', async ({ formEl, content }) => {
  if (!currentGuide) return;
  const btn = content.querySelector('[data-action="submitEditGuideSection"]');
  const originalText = btn?.textContent;
  if (btn) btn.disabled = true;
  const wasCreate = formEl.dataset.mode === 'create';
  try {
    const result = await saveSectionForComponent(formEl, s => { if (btn) btn.textContent = s; });
    if (!result) { if (btn) { btn.disabled = false; btn.textContent = originalText; } return; }
    if (wasCreate) {
      // Transitioned to edit-in-place; stay open so the user can add components.
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
      return;
    }
    await chrome.storage.local.remove('moreButtonsEditGuideSection');
    await navigateBack();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    alert('Failed to save section: ' + e.message);
  }
});
```

- [ ] **Step 6: Show Components in `openCreateGuideSection` and attach the saver**

In `openCreateGuideSection` (currently ~lines 471-507), find the block that hides the Delete button and Components row:

```js
  formEl.parentElement?.querySelector('[data-delete-section-btn]')?.style.setProperty('display', 'none');
  formEl.querySelector('[data-components-row]')?.style.setProperty('display', 'none');
```

Replace it with (keep hiding Delete; **show** Components and render an empty list):

```js
  formEl.parentElement?.querySelector('[data-delete-section-btn]')?.style.setProperty('display', 'none');
  // Components are visible in create mode now; adding one routes through the
  // save-gate, which persists the section first.
  renderComponents(formEl.querySelector('[data-section-components]'), []);
  formEl._componentSaver = () => saveSectionForComponent(formEl);
```

(The existing `formEl.addEventListener('click', onComponentEditorClick);` line at the end of this opener stays as-is.)

- [ ] **Step 7: Attach the saver + mode in `openEditGuideSection`**

In `openEditGuideSection` (currently ~lines 509-562), find:

```js
  formEl.dataset.mode = 'edit';
  formEl.dataset.editUuid = uuid;
  formEl.dataset.editLevel = String(section.level);
  formEl.dataset.componentContainerKind = 'guide-section';
  formEl.dataset.containerFile = currentGuide.draftPath;
```

and append immediately after it:

```js
  formEl._componentSaver = () => saveSectionForComponent(formEl);
```

- [ ] **Step 8: Verify parse**

Run: `node --check scripts/guides.js`
Expected: no output (exit 0).

- [ ] **Step 9: Manual browser check (orchestrator/human)**

Load the unpacked extension. In a guide draft:
1. **Add new section** → the **Components** list is visible with a "+ Insert Component" CTA.
2. Type a title, click **+ Insert Component → Admonition** → prompt "This section hasn’t been saved yet. Save it to continue?" → **OK** → the section saves, the form becomes "Edit section", and the new-admonition form opens. Back lands on the saved section.
3. Repeat with **Capture → Create a new capture** and **Capture → Add from library**.
4. On a saved section, edit the title (don't save), click **+ Insert Component** + pick a type → prompt "You have unsaved changes. Save them to continue?" → OK saves the title edit then opens the child flow.
5. On a saved, **unchanged** section, insert/edit a child → **no** prompt (proceeds directly).
6. Cancel at the prompt → nothing saved, form unchanged.

- [ ] **Step 10: Commit**

```bash
git add scripts/guides.js
git commit -m "feat(guides): component save-gate + components in section create mode"
```

---

## Task 3: Guide-admonition slice — in-place create transition + saver

Mirrors Task 2 for admonitions. The new wrinkle: admonition-create currently `navigateBack`s on Save; the gate path instead flips the form in place to edit the just-created admonition so sub-components can be added.

**Files:**
- Modify: `scripts/guides.js` (`openCreateGuideAdmonition`; `openEditGuideAdmonition`; new `persistNewAdmonition`, `persistAdmonitionEdit`, `transitionAdmonitionCreateToEdit`, `saveAdmonitionForComponent`; refactor `submitEditGuideAdmonition`)

- [ ] **Step 1: Add admonition persistence + transition + saver helpers**

In `scripts/guides.js`, add just above `registerFormAction('submitEditGuideAdmonition', …)` (currently ~line 1070):

```js
// Read the admonition form's header fields into a normalized shape.
function readAdmonitionFields(formEl) {
  const type = formEl.querySelector('[name="admonitionType"]:checked')?.value;
  const titleField = type === 'step' ? '' : (formEl.querySelector('[name="admonitionTitle"]')?.value.trim() ?? '');
  const metaField = formEl.querySelector('[name="admonitionMeta"]')?.value.trim() ?? '';
  const title = joinTitleMeta(titleField, metaField);
  const description = formEl.querySelector('[name="admonitionDescription"]')?.value ?? '';
  const collapsible = formEl.querySelector('[name="admonitionCollapsible"]:checked')?.value ?? 'static';
  return { type, title, description, prefix: collapsibleToPrefix(collapsible) };
}

// Build the new admonition and splice it into its parent container at the chosen
// index. Returns { newUuid, file } or null (validation failed).
async function persistNewAdmonition(formEl, onProgress = () => {}) {
  const { type, title, description, prefix } = readAdmonitionFields(formEl);
  if (!type) { alert('Type is required.'); return null; }
  const newUuid = generateUUID();
  const newAdm = { prefix, type, title, body: buildComponentBody(newUuid, description, []) };
  const container = {
    kind: formEl.dataset.parentKind,
    uuid: formEl.dataset.parentUuid,
    file: formEl.dataset.parentFile,
  };
  const insertAtRaw = formEl.dataset.insertAtIndex;
  const insertAt = insertAtRaw === '' || insertAtRaw == null ? null : parseInt(insertAtRaw, 10);
  await githubFetchAndPushFile(container.file, onProgress, md => {
    const { description: pDesc, components } = readContainerComponents(md, container);
    const idx = (insertAt != null && insertAt >= 0 && insertAt <= components.length) ? insertAt : components.length;
    const next = components.slice();
    next.splice(idx, 0, { kind: 'admonition', adm: newAdm });
    return writeContainerBody(md, container, pDesc, next);
  });
  return { newUuid, file: container.file };
}

// Rewrite an existing admonition's header + description, preserving its
// committed sub-components.
async function persistAdmonitionEdit(formEl, onProgress = () => {}) {
  const { type, title, description, prefix } = readAdmonitionFields(formEl);
  if (!type) { alert('Type is required.'); return null; }
  const editUuid = formEl.dataset.editUuid;
  const file = formEl.dataset.containerFile || currentGuide?.draftPath;
  const draftMarkdown = await readRepoText(file);
  if (!locateGuideAdmonition(draftMarkdown, editUuid)) { alert('Admonition no longer exists.'); return null; }
  await githubFetchAndPushFile(file, onProgress, md => {
    if (!locateGuideAdmonition(md, editUuid)) return md;
    const { components } = readContainerComponents(md, { kind: 'guide-admonition', uuid: editUuid });
    const body = buildComponentBody(editUuid, description, components);
    return replaceAdmonitionByUUID(md, editUuid, buildAdmonition(prefix, type, title, body));
  });
  return { editUuid, file };
}

// Flip an admonition create form into an edit-of-new-admonition form in place
// (gate path only — the plain Save button still navigates back).
async function transitionAdmonitionCreateToEdit(formEl, newUuid, file) {
  formEl.dataset.mode = 'edit';
  formEl.dataset.editUuid = newUuid;
  formEl.dataset.componentContainerKind = 'guide-admonition';
  formEl.dataset.containerFile = file;
  replaceCurrentOpener(() => getFormAction('openEditGuideAdmonition')({ uuid: newUuid, file }));
  const heading = formEl.querySelector('[data-guide-admonition-heading]');
  if (heading) heading.textContent = 'Edit admonition';
  formEl.parentElement?.querySelector('[data-delete-admonition-btn]')?.style.removeProperty('display');
  formEl.querySelector('[data-components-row]')?.style.removeProperty('display');
  const listEl = formEl.querySelector('[data-admonition-components]');
  renderComponents(listEl, [], false);
  setOpenComponentEditor({ formEl, listEl, container: { kind: 'guide-admonition', uuid: newUuid, file } });
  await chrome.storage.local.set({
    moreButtonsEditGuideAdmonition: {
      admonitionTitle: formEl.querySelector('[name="admonitionTitle"]')?.value ?? '',
      admonitionMeta: formEl.querySelector('[name="admonitionMeta"]')?.value ?? '',
      admonitionType: formEl.querySelector('[name="admonitionType"]:checked')?.value ?? 'step',
      admonitionDescription: formEl.querySelector('[name="admonitionDescription"]')?.value ?? '',
      admonitionCollapsible: formEl.querySelector('[name="admonitionCollapsible"]:checked')?.value ?? 'static',
    },
  });
  resetDirtyBaseline(formEl);
}

// Persist the admonition form for the save-gate. create → splice into parent +
// transition in place; dirty edit → rewrite + rebaseline. Returns { container,
// formEl } or null.
async function saveAdmonitionForComponent(formEl) {
  if (formEl.dataset.mode === 'create') {
    const res = await persistNewAdmonition(formEl);
    if (!res) return null;
    await transitionAdmonitionCreateToEdit(formEl, res.newUuid, res.file);
    return { container: { kind: 'guide-admonition', uuid: res.newUuid, file: res.file }, formEl };
  }
  const res = await persistAdmonitionEdit(formEl);
  if (!res) return null;
  resetDirtyBaseline(formEl);
  return { container: { kind: 'guide-admonition', uuid: res.editUuid, file: res.file }, formEl };
}
```

- [ ] **Step 2: Refactor `submitEditGuideAdmonition` to share the persistence helpers**

Replace the entire `registerFormAction('submitEditGuideAdmonition', …)` handler (currently ~lines 1070-1134) with:

```js
registerFormAction('submitEditGuideAdmonition', async ({ formEl, content }) => {
  const btn = content.querySelector('[data-action="submitEditGuideAdmonition"]');
  const originalText = btn?.textContent;
  if (btn) btn.disabled = true;
  try {
    const res = formEl.dataset.mode === 'create'
      ? await persistNewAdmonition(formEl, s => { if (btn) btn.textContent = s; })
      : await persistAdmonitionEdit(formEl, s => { if (btn) btn.textContent = s; });
    if (!res) { if (btn) { btn.disabled = false; btn.textContent = originalText; } return; }
    await chrome.storage.local.remove('moreButtonsEditGuideAdmonition');
    await navigateBack();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    alert('Failed to save admonition: ' + e.message);
  }
});
```

- [ ] **Step 3: Show Components in `openCreateGuideAdmonition` and attach the saver**

In `openCreateGuideAdmonition` (currently ~lines 959-993), find:

```js
  formEl.parentElement?.querySelector('[data-delete-admonition-btn]')?.style.setProperty('display', 'none');
  formEl.querySelector('[data-components-row]')?.style.setProperty('display', 'none');
```

Replace with (keep hiding Delete; show Components, render empty list, set the noun + saver):

```js
  formEl.parentElement?.querySelector('[data-delete-admonition-btn]')?.style.setProperty('display', 'none');
  // Components visible in create mode; adding one routes through the save-gate,
  // which splices this admonition into its parent and flips to edit in place.
  formEl.dataset.componentContainerKind = 'guide-admonition';
  renderComponents(formEl.querySelector('[data-admonition-components]'), [], false);
  formEl._componentSaver = () => saveAdmonitionForComponent(formEl);
```

(The existing `formEl.addEventListener('click', onComponentEditorClick);` and `wireAdmonitionTypeToggle(formEl, 'step');` lines stay.)

- [ ] **Step 4: Attach the saver + mode in `openEditGuideAdmonition`**

In `openEditGuideAdmonition` (currently ~lines 995-1050), find:

```js
  formEl.dataset.mode = 'edit';
  formEl.dataset.editUuid = uuid;
  formEl.dataset.componentContainerKind = 'guide-admonition';
  formEl.dataset.containerFile = containerFile;
```

and append immediately after it:

```js
  formEl._componentSaver = () => saveAdmonitionForComponent(formEl);
```

- [ ] **Step 5: Verify parse**

Run: `node --check scripts/guides.js`
Expected: no output (exit 0).

- [ ] **Step 6: Manual browser check (orchestrator/human)**

In a guide draft, open a section, then:
1. **+ Insert Component → Admonition**, fill it, then on the *new admonition* form click **+ Insert Component → Admonition** (a sub-admonition) → prompt "This admonition hasn’t been saved yet. Save it to continue?" → OK saves the admonition (it appears as a card in the parent section behind), flips the form to "Edit admonition", and opens the sub-admonition form.
2. Add a **Capture** sub-component to a freshly-created admonition the same way.
3. Plain **Save** on a new admonition (no sub-component) still returns to the parent section (navigates back) — unchanged behavior.
4. Dirty an existing admonition's title → add a component → "You have unsaved changes…" → OK saves then opens child.

- [ ] **Step 7: Commit**

```bash
git add scripts/guides.js
git commit -m "feat(guides): component save-gate for admonitions + in-place create transition"
```

---

## Task 4: System-update slice — migrate logSystemUpdate to unified components + update savers

**Files:**
- Modify: `config/forms/logSystemUpdate.html` (Captures block → Components block)
- Modify: `scripts/systemUpdates.js` (`openLogSystemUpdate`; new `saveLogUpdateForComponent`, `saveUpdateForComponent`; `mountUpdateComponentsEditor`; drop legacy capture calls in submit/draft handlers)

- [ ] **Step 1: Swap the Captures block for a Components block in the log form**

In `config/forms/logSystemUpdate.html`, replace lines 28-33:

```html
  <div class="more-buttons-form-group">
    <label class="more-buttons-label">Captures</label>
    <div class="more-buttons-captures-field">
      <div id="log-update-captures" class="more-buttons-captures-list" data-captures-container></div>
    </div>
  </div>
```

with:

```html
  <div class="more-buttons-form-group" data-components-row>
    <label class="more-buttons-label">Components</label>
    <div>
      <div data-update-components></div>
    </div>
  </div>
```

- [ ] **Step 2: Add the import for `resetDirtyBaseline` in systemUpdates.js**

In `scripts/systemUpdates.js` line 5, replace:

```js
import { createForm, navigateBack, isFormReplay, replaceCurrentOpener } from './form.js';
```

with:

```js
import { createForm, navigateBack, isFormReplay, replaceCurrentOpener, resetDirtyBaseline } from './form.js';
```

- [ ] **Step 3: Add the two update savers**

In `scripts/systemUpdates.js`, just below `mountUpdateComponentsEditor` (currently ~line 147), add:

```js
// Save-gate saver for the Log form: persist as a DRAFT, navigate into the draft
// editor, and continue the child flow there. Returns { container, formEl } or null.
async function saveLogUpdateForComponent(formEl) {
  const { title, date, type, description } = readUpdateFormFields(formEl);
  if (!title || !date || !type) { alert('Please fill in all required fields.'); return null; }
  const uuid = generateUUID();
  await saveNewDraft({ title, date, type, description, uuid }, [], () => {});
  await chrome.storage.local.remove('moreButtonsLogSystemUpdate');
  // Returning from a child should land on the updates list, not the blank log form.
  replaceCurrentOpener(() => getFormAction('openSystemUpdatesEntry')());
  await getFormAction('openEditDraftSystemUpdate')({ uuid });
  const newFormEl = document.querySelector('.more-buttons-overlay form[data-storage-key]');
  return { container: { kind: 'system-draft', uuid, file: DRAFTS_FILE }, formEl: newFormEl };
}

// Save-gate saver for the (already-saved) update + draft editors: rewrite the
// block's header + leading description, preserving committed components.
async function saveUpdateForComponent(formEl) {
  const { title, date, type, description } = readUpdateFormFields(formEl);
  if (!title || !date || !type) { alert('Please fill in all required fields.'); return null; }
  const uuid = formEl.dataset.editUuid;
  const kind = formEl.dataset.componentContainerKind; // 'system-update' | 'system-draft'
  const file = formEl.dataset.containerFile;
  await githubFetchAndPushFile(file, () => {}, md => {
    const body = rebuildUpdateBody(md, uuid, description);
    return kind === 'system-update'
      ? replaceUpdateInMarkdown(md, uuid, { title, date, type, uuid, description: body }, [])
      : replaceDraftInMarkdown(md, uuid, { title, date, type, description: body }, []);
  });
  resetDirtyBaseline(formEl);
  return { container: { kind, uuid, file }, formEl };
}
```

- [ ] **Step 4: Attach mode + saver in `mountUpdateComponentsEditor`**

In `mountUpdateComponentsEditor` (currently ~lines 139-147), after the existing `formEl.dataset.containerFile = file;` line, add:

```js
  formEl.dataset.mode = 'edit';
  formEl._componentSaver = () => saveUpdateForComponent(formEl);
```

- [ ] **Step 5: Rewrite `openLogSystemUpdate` to use the unified components list**

Replace the entire `registerFormAction('openLogSystemUpdate', …)` handler (currently ~lines 405-419) with:

```js
registerFormAction('openLogSystemUpdate', async () => {
  // On a genuine fresh open, discard any half-finished entry saved to storage
  // during an earlier capture-mode handoff. Skip during a capture-mode replay.
  if (!isFormReplay()) {
    await chrome.storage.local.remove('moreButtonsLogSystemUpdate');
  }
  const { formEl: logFormEl } = await createForm('logSystemUpdate');
  if (!logFormEl) return;
  const dateInput = logFormEl.querySelector('[name="updateDate"]');
  if (dateInput && !dateInput.value) dateInput.value = todayIsoDate();

  // Unified Components: the log form is create-mode; adding a component routes
  // through the save-gate, which saves a draft then continues in the draft editor.
  logFormEl.dataset.mode = 'create';
  logFormEl.dataset.componentContainerKind = 'system-draft';
  logFormEl.dataset.componentNoun = 'update';
  renderComponents(logFormEl.querySelector('[data-update-components]'), [], false);
  logFormEl._componentSaver = () => saveLogUpdateForComponent(logFormEl);
  logFormEl.addEventListener('click', onComponentEditorClick);
});
```

- [ ] **Step 6: Drop the legacy capture calls from the submit + save-draft handlers**

In `scripts/systemUpdates.js`:

(a) In `submitLogSystemUpdate` (currently ~lines 421-448), replace:

```js
    const update = { title, date, type, description, uuid: generateUUID() };
    const resolved = resolveCaptures([...captures]);
    await publishNewUpdate(update, resolved, s => { btn.textContent = s; });

    resetCaptureState();
    await chrome.storage.local.remove('moreButtonsLogSystemUpdate');
```

with:

```js
    const update = { title, date, type, description, uuid: generateUUID() };
    await publishNewUpdate(update, [], s => { btn.textContent = s; });

    await chrome.storage.local.remove('moreButtonsLogSystemUpdate');
```

(b) In `saveDraftSystemUpdate` (currently ~lines 533-556), replace:

```js
    const update = { title, date, type, description, uuid: generateUUID() };
    const resolved = resolveCaptures([...captures]);
    await saveNewDraft(update, resolved, s => { btn.textContent = s; });

    resetCaptureState();
    await chrome.storage.local.remove('moreButtonsLogSystemUpdate');
```

with:

```js
    const update = { title, date, type, description, uuid: generateUUID() };
    await saveNewDraft(update, [], s => { btn.textContent = s; });

    await chrome.storage.local.remove('moreButtonsLogSystemUpdate');
```

- [ ] **Step 7: Remove the now-unused legacy imports from systemUpdates.js**

In `scripts/systemUpdates.js`, replace the import block (currently lines 8-11):

```js
import {
  captures, resetCaptureState,
  updateCapturesList, resolveCaptures, pushCaptures,
} from './captures.js';
```

with (keep only `pushCaptures`, still used by the publish helpers):

```js
import { pushCaptures } from './captures.js';
```

> `publishNewUpdate` / `saveNewDraft` / `publishDraft` still call `pushCaptures(captures, …)` with an empty list (a no-op) — that's fine; real captures now live in the block body.

- [ ] **Step 8: Verify parse**

Run: `node --check scripts/systemUpdates.js`
Expected: no output (exit 0).

- [ ] **Step 9: Manual browser check (orchestrator/human)**

1. **Log a system update** → the form now shows a **Components** list (no "Captures" field).
2. Fill Title/Date/Type, click **+ Insert Component → Admonition** → prompt "This update hasn’t been saved yet. Save it to continue?" → **OK** → a draft is saved, the form becomes **Edit Draft**, and the new-admonition form opens. The component lands in the draft.
3. Add a **Capture** component the same way.
4. With no components added, **Publish update** (direct-to-live) and **Save draft** both still work.
5. Open an existing **published update** and an existing **draft**; dirty the title → add a component → "You have unsaved changes…" → OK saves then opens the child; a clean editor adds/edits children with no prompt.
6. Confirm the published draft round-trips with a correct date (no "undefinedth undefined NaN").

- [ ] **Step 10: Commit**

```bash
git add config/forms/logSystemUpdate.html scripts/systemUpdates.js
git commit -m "feat(system-updates): unified components in log form via draft save-gate"
```

---

## Task 5: Remove the dead legacy captures buffer

After Task 4 nothing uses the legacy in-memory buffer. Remove it. **Keep** `buildCaptureLines` (used by `components.js`), `resolveCaptures` + `pushCaptures` (used by the unified `commitCapturesIntoContainer` and `captureNew`), the unified `runComponentCaptureFlow` / `runComponentLibraryInsert`, `componentLibraryIntent`, and `commitCapturesIntoContainer`.

**Files:**
- Modify: `scripts/captures.js` (delete legacy API)
- Modify: `scripts/captureMode.js` (delete legacy cold-exit block)
- Modify: `config/forms/formsStyling.css` (delete legacy capture CSS)

- [ ] **Step 1: Confirm nothing external still references the legacy symbols**

Run:

```bash
grep -rn "updateCapturesList\|resetCaptureState\|setExistingCaptures\|runCaptureFlow\|runLibraryInsertFlow\|\bcaptures\b\|parseExistingCaptures\|stripCaptureLines" scripts --include='*.js' | grep -v '^scripts/captures.js:'
```

Expected: the only remaining hit is the comment in `scripts/captureMode.js` referencing `updateCapturesList` (removed in Step 3) — no live code outside `captures.js`. If any live reference remains, stop and reconcile before deleting.

- [ ] **Step 2: Delete the legacy buffer from `scripts/captures.js`**

Remove these exported/internal members entirely (leave everything else intact):
- `export const captures = []` and `resetCaptureState`, `setExistingCaptures`
- `parseExistingCaptures`, `stripCaptureLines` (dead — confirmed in Step 1)
- UI helpers: `captureRowHtml`, `captureInsertZone`, `captureEmptyCta`, `applyDimAutoState`, `updateCapturesList`
- Flow helpers: `runCaptureFlow`, `runLibraryInsertFlow`, `persistFormToStorage`, `resolveContainerId`
- The module-level `let libraryInsertIntent = null;` declaration
- The legacy `registerFormAction('startCapture', …)` registration
- In `registerFormAction('completeLibraryInsert', …)`: delete the trailing **legacy** branch (everything after the `componentLibraryIntent` block — the part using `libraryInsertIntent`, `setExistingCaptures`, `capturesSnapshot`). The handler keeps only the `componentLibraryIntent` (Design-B) path:

```js
registerFormAction('completeLibraryInsert', async ({ capture } = {}) => {
  if (!componentLibraryIntent) return;
  const intent = componentLibraryIntent;
  componentLibraryIntent = null;
  if (!capture || !intent.snapshot?.length) return;
  const ok = await replayFormStack(intent.snapshot);
  if (!ok) return;
  await commitCapturesIntoContainer(intent.container, intent.insertAt, [capture]);
});
```

Also remove now-unused imports from `captures.js` if they become unreferenced after the deletions (check `enterCaptureMode`, `escapeHtml`, `assetCdnUrl` — `enterCaptureMode` and the image helpers are still used by `runComponentCaptureFlow`; verify with `node --check` + a grep before removing any import). Update the module's top-of-file doc comment to drop the description of the deleted buffer.

- [ ] **Step 3: Delete the legacy cold-exit block in `scripts/captureMode.js`**

Remove the block at ~lines 566-582 (the `// Cold exit:` comment through the end of the `if (!cancelled && ctx.wasFormMode && ctx.formStackSnapshot?.length) { … }` statement) that dynamically imports `captures.js` and calls `capturesMod.captures.push(...)` + `capturesMod.updateCapturesList(...)`. The unified capture flow handles its own warm cold-path via `returnTo.onComplete` (the branch just above, ~lines 557-564), so this legacy fallback is dead. Optionally tidy the stale `startCapture` mention in the top doc comment (line ~12).

- [ ] **Step 4: Delete the legacy capture CSS**

In `config/forms/formsStyling.css`, delete the rule blocks for the legacy capture list and insert pills. Find their ranges with:

```bash
grep -n "mb-cap-insert\|more-buttons-captures\|more-buttons-capture-\|log-update-captures" config/forms/formsStyling.css
```

Remove the `.mb-cap-insert*`, `.more-buttons-captures-field`, `.more-buttons-captures-list`, and `.more-buttons-capture-row/-thumb/-controls/-dim*/-remove/-library` rule blocks (the legacy buffer's row + insert-zone styling). Do **not** remove `.mb-insert-component*` (the unified Components "+ Insert Component" styling) or `.mb-adm-empty*` (still used by `renderComponents`).

- [ ] **Step 5: Verify parse + existing tests**

Run:

```bash
node --check scripts/captures.js
node --check scripts/captureMode.js
node --check scripts/systemUpdates.js
node --check scripts/guides.js
for t in tests/*.test.mjs; do echo "== $t =="; node "$t" || exit 1; done
```

Expected: all `node --check` silent (exit 0); every test file prints `N passed` and exits 0.

- [ ] **Step 6: Manual browser regression (orchestrator/human)**

Re-run the capture flows once more to confirm nothing broke: add a **new screenshot capture** and an **add-from-library** capture as components on a guide section and on a draft update; edit a capture's height; delete a capture. All should commit and re-render correctly. The capture **library** itself (browse/create) is unaffected.

- [ ] **Step 7: Commit**

```bash
git add scripts/captures.js scripts/captureMode.js config/forms/formsStyling.css
git commit -m "chore(captures): remove dead legacy in-memory captures buffer"
```

---

## Task 6: Full regression sweep + close-out

**Files:** none (verification only), plus an optional doc-comment/memory touch-up.

- [ ] **Step 1: Parse-check every edited JS file**

```bash
for f in scripts/form.js scripts/guides.js scripts/systemUpdates.js scripts/captures.js scripts/captureMode.js; do echo "== $f =="; node --check "$f" || exit 1; done
```

Expected: all silent, exit 0.

- [ ] **Step 2: Run the full existing test suite**

```bash
for t in tests/*.test.mjs; do echo "== $t =="; node "$t" || exit 1; done
```

Expected: each prints `N passed`, exit 0.

- [ ] **Step 3: End-to-end manual checklist (orchestrator/human)**

Walk the full matrix once in the unpacked extension:
- Guide section: create→add admonition; create→add capture; dirty-edit→add; dirty-edit→edit-existing-child (prompts); clean edit→add (no prompt); cancel-at-prompt (no save).
- Guide admonition: create→add sub-admonition; create→add sub-capture; plain Save still navigates back.
- System update: log→add component lands in draft editor; direct Publish (no components) works; published-update and draft editors add/edit components; dirty-edit prompts.
- Captures: screenshot + library inserts, height edit, delete — all still work; capture library unaffected.

- [ ] **Step 4: Update the project memory note (optional but recommended)**

Update `…/memory/project_components_merge.md`: the line stating the **logSystemUpdate keeps the old buffered-captures group** and "Don't delete that API" is now **obsolete** — record that the log form uses the unified components model via a draft save-gate, the legacy buffer (`captures[]`, `updateCapturesList`, `runCaptureFlow`, `runLibraryInsertFlow`, etc.) has been removed, and all five component forms share the `beginChildNavigation`/`ensureContainerReady` save-gate with per-form `_componentSaver`.

- [ ] **Step 5: Final commit (if memory/docs touched in your repo) / done**

If any tracked doc was edited:

```bash
git add -A
git commit -m "docs: note unified component save-gate + legacy buffer removal"
```

Otherwise the feature is complete across Tasks 1-5.

---

## Self-review notes (author)

- **Spec coverage:** §Architecture gate → Task 2 (machinery) + Tasks 2-4 (savers); §Components visible in create → Tasks 2.6, 3.3, 4.1/4.5; §logSystemUpdate draft target → Task 4.3/4.5; §edit-existing consistent → Task 2.3 (`onComponentEditorClick` routes edit-admonition/edit-capture through the gate); §legacy removal → Task 5; §testing → Tasks 2.9/3.6/4.9/5.6/6.3. All covered.
- **Type/name consistency:** `_componentSaver` returns `{ container, formEl }` everywhere; `container` is `{ kind, uuid, file }` everywhere; `componentNoun` reads `dataset.componentNoun || CONTAINER_NOUN[kind]`; `setOpenComponentEditor` (exported) used instead of bare assignment. `saveSectionForComponent` / `saveAdmonitionForComponent` / `saveLogUpdateForComponent` / `saveUpdateForComponent` are the four savers.
- **Risk:** Tasks 2 & 3 refactor working submit handlers to share persistence — covered by the manual checklists. `pushCaptures`/`resolveCaptures` deliberately retained (used by the unified flow).
