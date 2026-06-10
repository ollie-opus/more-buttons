# Copy/Paste Component Markdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Copy" button next to Edit on every component card that copies the component's full markdown (uuid spans stripped) to the system clipboard, and a "Paste copied markdown" insert-menu option that opens a textarea form which validates, re-uuids, and commits pasted markdown into the container at the chosen position.

**Architecture:** Pure markdown helpers (`stripUUIDSpans`, `componentMarkdown`, `parsePastedComponents`) live in `scripts/components.js` and are unit-tested in node. UI wiring (copy buttons, insert-menu option, form actions `openPasteMarkdown` / `insertPastedMarkdown`) lives in `scripts/guides.js` + `scripts/insertMenu.js` + `scripts/cardRenderer.js`, following the existing `openCreateGuideAdmonition` / `deleteGuideAdmonition` patterns exactly. One new form HTML (`config/forms/pasteMarkdown.html`) is covered by the existing `config/forms/*` manifest glob — **no manifest.json change is needed** (no new script files).

**Tech Stack:** Chrome MV3 content-script extension, plain ES modules, node test scripts (`node tests/<file>.test.mjs`, custom inline `test()` helper, no framework).

**Spec:** `docs/superpowers/specs/2026-06-10-copy-paste-component-markdown-design.md`

---

## Background you need (read before Task 1)

- A **component** is `{kind:'admonition', adm}`, `{kind:'capture', cap}` or `{kind:'tabs', grp}` — see `scripts/components.js:123` (`parseComponents`). `buildComponentBody(uuid, description, components)` (`components.js:207`) is the inverse; passing `(null, '', [component])` yields `'\n' + <that one component's full markdown including nested children and all uuid spans>`.
- Identity rides in hidden spans on their own line: `<span data-uuid="…" style="display:none"></span>`. Backfill functions mint missing uuids: `ensureAdmonitionUUIDs(md, typeRegex)` (admonitions.js:404), `ensureTabUUIDs(md)` (contentTabs.js:292), `ensureCaptureUUIDs(md)` (components.js:98). Order matters: **admonitions → tabs → captures** (a capture span injected as a tab's first body line would be misread as the tab's identity — see `migrateComponentIdentity`, github.js:58).
- Component cards render in `scripts/guides.js`: `admonitionCard` (line 963), `tabsComponentCard` (line 996), `captureComponentCardFor` (line 762, delegating to `captureComponentCard` in `scripts/cardRenderer.js:34`). All clicks delegate through `onComponentEditorClick` (guides.js:894). Child navigation (insert/edit) goes through `beginChildNavigation` (save-gate); **copy must NOT** — it navigates nowhere.
- The module-level `openComponentEditor` (guides.js:673) holds `{ formEl, listEl, container:{kind,uuid,file}, components }` for the currently open editor — the in-memory source for copy.
- Inserts commit immediately: see `persistNewAdmonition` (guides.js:1341) — `githubFetchAndPushFile(file, onProgress, md => { read components; splice at idx; writeContainerBody })`. After a leaf-form commit, the pattern is `await chrome.storage.local.remove(key); await navigateBack();` (see `deleteGuideAdmonition`, guides.js:1488). `navigateBack()` replays the parent form's opener, which re-reads the file — the new components appear without manual re-render.
- `form.js`'s delegated `data-action` click handler (form.js:738) already wraps every action in `formLoading.show()/dismiss()` — the loading-veil convention is automatic; do not add inline placeholders.
- Tests: each `tests/*.test.mjs` is a self-running node script using a local `test(name, fn)` helper and ending with `console.log(`\n${passed} passed`)`. Run with `node tests/<file>.test.mjs`. Node ≥19 (uses `crypto.randomUUID`).

---

### Task 1: Pure helpers in components.js (TDD)

**Files:**
- Modify: `scripts/components.js`
- Test (create): `tests/componentMarkdown.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/componentMarkdown.test.mjs`:

```js
import assert from 'node:assert/strict';
import { parseComponents, stripUUIDSpans, componentMarkdown, parsePastedComponents, uuidOfComponent } from '../scripts/components.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const ADM_RE = /step|note|tip/;

// A note admonition containing a nested capture — both with uuid spans.
const ADM_FIXTURE = [
  '!!! note "Widget setup"',
  '',
  '    <span data-uuid="ADM-1" style="display:none"></span>',
  '    Do the thing.',
  '',
  '    <span data-uuid="CAP-1" style="display:none"></span>',
  '    ![](../assets/x-light-mode.png#only-light){ width="800" loading=lazy }',
  '    ![](../assets/x-dark-mode.png#only-dark){ width="800" loading=lazy }',
].join('\n');

test('stripUUIDSpans: removes whole span lines at any indent, leaving no residue', () => {
  const out = stripUUIDSpans(ADM_FIXTURE);
  assert.ok(!out.includes('data-uuid'));
  // The indented span lines vanish entirely — no stray indent-only lines.
  assert.ok(!out.split('\n').some(l => /^\s+$/.test(l)));
  // Content survives.
  assert.ok(out.includes('Do the thing.'));
  assert.ok(out.includes('#only-light'));
});

test('componentMarkdown: admonition round-trips with nested capture, no spans, no leading blank', () => {
  const { components } = parseComponents(ADM_FIXTURE, ADM_RE);
  assert.equal(components.length, 1);
  const md = componentMarkdown(components[0]);
  assert.ok(md.startsWith('!!! note "Widget setup"'));
  assert.ok(!md.includes('data-uuid'));
  assert.ok(md.includes('#only-light'));
  assert.ok(md.includes('#only-dark'));
});

test('componentMarkdown: capture component emits the light/dark pair without a span', () => {
  const body = [
    '<span data-uuid="CAP-9" style="display:none"></span>',
    '![](../assets/y-light-mode.png#only-light){ width="640" loading=lazy }',
    '![](../assets/y-dark-mode.png#only-dark){ width="640" loading=lazy }',
  ].join('\n');
  const { components } = parseComponents(body, ADM_RE);
  const md = componentMarkdown(components[0]);
  assert.ok(!md.includes('data-uuid'));
  assert.ok(md.includes('![](../assets/y-light-mode.png#only-light)'));
});

test('parsePastedComponents: valid copy gains FRESH uuids', () => {
  const { components } = parseComponents(ADM_FIXTURE, ADM_RE);
  const pasted = componentMarkdown(components[0]); // what the Copy button puts on the clipboard
  const res = parsePastedComponents(pasted);
  assert.equal(res.error, null);
  assert.equal(res.components.length, 1);
  assert.equal(res.components[0].kind, 'admonition');
  const u = res.components[0].adm.uuid;
  assert.ok(typeof u === 'string' && u.length > 0 && u !== 'ADM-1');
});

test('parsePastedComponents: pre-existing uuid spans in the paste are replaced (never reused)', () => {
  const res = parsePastedComponents(ADM_FIXTURE); // raw markdown WITH old spans
  assert.equal(res.error, null);
  assert.notEqual(res.components[0].adm.uuid, 'ADM-1');
});

test('parsePastedComponents: multiple components keep their order', () => {
  const { components } = parseComponents(ADM_FIXTURE, ADM_RE);
  const adm = componentMarkdown(components[0]);
  const cap = [
    '![](../assets/z-light-mode.png#only-light)',
    '![](../assets/z-dark-mode.png#only-dark)',
  ].join('\n');
  const res = parsePastedComponents(adm + '\n\n' + cap);
  assert.equal(res.error, null);
  assert.deepEqual(res.components.map(c => c.kind), ['admonition', 'capture']);
});

test('parsePastedComponents: rejects empty / whitespace paste', () => {
  assert.ok(parsePastedComponents('').error);
  assert.ok(parsePastedComponents('   \n  ').error);
});

test('parsePastedComponents: rejects plain prose', () => {
  const res = parsePastedComponents('Just some text, not a component.');
  assert.equal(res.components, null);
  assert.ok(res.error);
});

test('parsePastedComponents: rejects components mixed with stray prose', () => {
  const { components } = parseComponents(ADM_FIXTURE, ADM_RE);
  const res = parsePastedComponents('Stray intro line.\n\n' + componentMarkdown(components[0]));
  assert.equal(res.components, null);
  assert.ok(res.error);
});

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tests/componentMarkdown.test.mjs`
Expected: FAIL — `SyntaxError: The requested module '../scripts/components.js' does not provide an export named 'stripUUIDSpans'`

- [ ] **Step 3: Implement the helpers in components.js**

In `scripts/components.js`, extend the two existing imports at the top (line 21 and 24):

```js
import { parseAdmonitions, buildAdmonition, generateUUID, GUIDE_ADMONITION_TYPES_RE, ensureAdmonitionUUIDs } from './admonitions.js';
```

```js
import { locateTabGroups, buildTabGroup, locateTabByUUID, ensureTabUUIDs } from './contentTabs.js';
```

Add next to the existing `UUID_SPAN_RE` definitions (after line 32):

```js
// Whole-line variant: removes an own-line uuid span INCLUDING its indent and
// newline, so nested (indented) spans vanish without leaving indent residue —
// UUID_SPAN_RE alone would merge the leftover indent into the following line.
const UUID_SPAN_FULL_LINE_RE = /^[ \t]*<span[^>]*data-uuid[^>]*><\/span>[ \t]*\r?\n?/gm;
```

Add after `uuidOfComponent` (after line 260):

```js
/** Removes every own-line `data-uuid` identity span (any indent) from `markdown`. */
export function stripUUIDSpans(markdown) {
  return (markdown ?? '').replace(UUID_SPAN_FULL_LINE_RE, '');
}

/**
 * The full markdown of one component (including all nested subcomponents),
 * with every identity span stripped — the Copy-to-clipboard payload.
 */
export function componentMarkdown(component) {
  return stripUUIDSpans(buildComponentBody(null, '', [component]))
    .replace(/^\n+/, '')
    .trimEnd();
}

/**
 * Validates pasted markdown for the "Paste copied markdown" insert flow.
 * Strips any uuid spans the paste carried (fresh identities are always minted —
 * pasting into the same page can never duplicate a uuid), backfills new uuids
 * (admonitions → tabs → captures, same order as migrateComponentIdentity), and
 * parses the result. Valid = at least one recognized component and no stray
 * prose outside component blocks.
 *
 * @param {string} text
 * @returns {{ components: Array|null, error: string|null }}
 */
export function parsePastedComponents(text) {
  const stripped = stripUUIDSpans(text ?? '').trim();
  if (!stripped) return { components: null, error: 'Nothing to insert — paste component markdown first.' };
  const withUuids = ensureCaptureUUIDs(ensureTabUUIDs(ensureAdmonitionUUIDs(stripped, GUIDE_ADMONITION_TYPES_RE)));
  const { description, components } = parseComponents(withUuids, GUIDE_ADMONITION_TYPES_RE);
  if (components.length === 0) {
    return { components: null, error: 'No components recognised. Paste markdown copied from a component (admonition, capture or content tabs).' };
  }
  if (description.trim() !== '') {
    return { components: null, error: 'The pasted markdown contains text outside of component blocks, so it can’t be inserted.' };
  }
  return { components, error: null };
}
```

Circular-import check: `admonitions.js` and `contentTabs.js` do not import `components.js`, so the two new named imports are safe (they're the same modules already imported).

- [ ] **Step 4: Run the new tests — verify they pass**

Run: `node tests/componentMarkdown.test.mjs`
Expected: `9 passed`

- [ ] **Step 5: Run the full existing suite (regression)**

Run: `for f in tests/*.test.mjs; do echo "== $f"; node "$f" || break; done`
Expected: every file prints `N passed`, no assertion errors.

- [ ] **Step 6: Commit**

```bash
git add scripts/components.js tests/componentMarkdown.test.mjs
git commit -m "feat(components): markdown copy/paste helpers (stripUUIDSpans, componentMarkdown, parsePastedComponents)"
```

---

### Task 2: Copy button on all component cards

**Files:**
- Modify: `scripts/cardRenderer.js` (captureComponentCard, line 34)
- Modify: `scripts/guides.js` (captureComponentCardFor line 762, admonitionCard line 963, tabsComponentCard line 996, onComponentEditorClick line 894, imports line 37)

- [ ] **Step 1: Extend captureComponentCard with an optional copy button**

In `scripts/cardRenderer.js`, replace `captureComponentCard` with:

```js
export function captureComponentCard({ thumbSrc, btnAttr, btnLabel = 'Edit', copyAttr = '' }) {
  return `
  <div class="mb-incident-card --grey mb-component-card--capture">
    <div class="mb-incident-card__head">
      <strong class="mb-incident-card__title">Capture</strong>
      <span class="mb-incident-card__badge">Capture</span>
    </div>
    ${thumbSrc ? `<div class="mb-incident-card__body mb-component-card__thumb-row"><img class="mb-component-card__thumb" src="${escapeHtml(thumbSrc)}" alt="" loading="lazy" /></div>` : ''}
    <div class="mb-incident-card__foot --end">
      ${copyAttr ? `<button type="button" class="mb-incident-card__edit" ${copyAttr}>Copy</button>` : ''}
      <button type="button" class="mb-incident-card__edit" ${btnAttr}>${btnLabel}</button>
    </div>
  </div>`;
}
```

(`copyAttr` defaults to `''`, so the other call sites of `captureComponentCard` — pending-capture previews — are unchanged. The foot is `display:flex; gap:10px`, so the second button needs no styling.)

- [ ] **Step 2: Emit the copy attribute from all three card renderers in guides.js**

Replace `captureComponentCardFor` (guides.js:762):

```js
function captureComponentCardFor(cap) {
  return captureComponentCard({
    thumbSrc: assetCdnUrl('docs/assets/' + cap.lightFilename),
    btnAttr: `data-edit-component="${escapeHtml(cap.uuid ?? '')}"`,
    copyAttr: cap.uuid ? `data-copy-component-md="${escapeHtml(cap.uuid)}"` : '',
  });
}
```

In `admonitionCard` (guides.js:963), replace the foot block:

```js
      <div class="mb-incident-card__foot --end">
        <button type="button" class="mb-incident-card__edit" ${btnAttr}>${btnLabel}</button>
      </div>
```

with:

```js
      <div class="mb-incident-card__foot --end">
        ${adm.uuid ? `<button type="button" class="mb-incident-card__edit" data-copy-component-md="${escapeHtml(adm.uuid)}">Copy</button>` : ''}
        <button type="button" class="mb-incident-card__edit" ${btnAttr}>${btnLabel}</button>
      </div>
```

In `tabsComponentCard` (guides.js:996), replace its foot block the same way:

```js
      <div class="mb-incident-card__foot --end">
        ${grp.uuid ? `<button type="button" class="mb-incident-card__edit" data-copy-component-md="${escapeHtml(grp.uuid)}">Copy</button>` : ''}
        <button type="button" class="mb-incident-card__edit" ${btnAttr}>${grp.uuid ? 'Edit' : 'Error'}</button>
      </div>
```

- [ ] **Step 3: Handle the copy click (no save-gate) in guides.js**

Add `componentMarkdown` to the components.js import (guides.js:37):

```js
import { parseComponents, buildComponentBody, ensureCaptureUUIDs, uuidOfComponent, reorderComponents, componentMarkdown } from './components.js';
```

In `onComponentEditorClick` (guides.js:894), add this branch immediately after the `moveBtn` block (before the `editAdm` block) — copy is a leaf action, NOT routed through `beginChildNavigation`:

```js
  const copyBtn = e.target.closest('[data-copy-component-md]');
  if (copyBtn) {
    copyComponentMarkdown(formEl, copyBtn.dataset.copyComponentMd, copyBtn);
    return;
  }
```

Add these two functions near `openCaptureComponentEditor` (after guides.js:961):

```js
// Briefly swap a button's label as click feedback ("Copied ✓" / "Copy failed").
function flashButtonLabel(btn, label) {
  if (!btn || btn.dataset.flashing) return;
  btn.dataset.flashing = '1';
  const original = btn.textContent;
  btn.textContent = label;
  setTimeout(() => { btn.textContent = original; delete btn.dataset.flashing; }, 1500);
}

// Copy one component's full markdown (uuid spans stripped) to the clipboard.
// Reads from the open editor's in-memory list; falls back to a fresh repo read
// when the click arrives outside the tracked editor (defensive — shouldn't happen).
async function copyComponentMarkdown(formEl, uuid, btn) {
  try {
    let comp = openComponentEditor?.formEl === formEl
      ? openComponentEditor.components?.find(c => uuidOfComponent(c) === uuid)
      : null;
    if (!comp) {
      const container = containerFromForm(formEl);
      const md = await readRepoText(container.file);
      comp = readContainerComponents(md, container).components.find(c => uuidOfComponent(c) === uuid);
    }
    if (!comp) throw new Error('component not found');
    await navigator.clipboard.writeText(componentMarkdown(comp));
    flashButtonLabel(btn, 'Copied ✓');
  } catch (err) {
    console.warn('[MB] copy component markdown failed:', err);
    flashButtonLabel(btn, 'Copy failed');
  }
}
```

- [ ] **Step 4: Regression-run the suite**

Run: `for f in tests/*.test.mjs; do echo "== $f"; node "$f" || break; done`
Expected: all pass (this task is UI-only; nothing pure changed).

- [ ] **Step 5: Commit**

```bash
git add scripts/cardRenderer.js scripts/guides.js
git commit -m "feat(components): Copy-to-clipboard button on component cards"
```

---

### Task 3: "Paste copied markdown" insert-menu option

**Files:**
- Modify: `scripts/insertMenu.js`
- Modify: `config/forms/formsStyling.css` (one divider rule, near the `.mb-popup-menu` block at line 1017)
- Modify: `scripts/guides.js` (`onComponentEditorClick` menu handlers line 927, `runChildAction` line 876)

- [ ] **Step 1: Add divider + option to the menu markup**

In `scripts/insertMenu.js`, inside `menu.innerHTML` (after the `content-tabs` button, line 40):

```js
    <button type="button" class="mb-popup-menu__item" data-pick="content-tabs" role="menuitem">Content tabs</button>
    <div class="mb-popup-menu__divider" role="separator"></div>
    <button type="button" class="mb-popup-menu__item" data-pick="paste-markdown" role="menuitem">Paste copied markdown</button>
```

In the `pick` dispatcher (line 58), add a branch:

```js
    else if (kind === 'content-tabs') handlers.contentTabs?.(insertAtIndex);
    else if (kind === 'paste-markdown') handlers.pasteMarkdown?.(insertAtIndex);
```

Update the JSDoc `handlers` type (line 22) to `{admonition:Function, captureNew:Function, captureLibrary:Function, contentTabs:Function, pasteMarkdown:Function}`, and the file header comment (lines 4–7) to mention the divider + paste option.

- [ ] **Step 2: Divider style**

In `config/forms/formsStyling.css`, after the `.mb-popup-menu__chev` rule (line 1051), add (same colour recipe as the menu's own border):

```css
.mb-popup-menu__divider {
  height: 1px;
  margin: 4px 2px;
  background: color-mix(in srgb, var(--mb-text-muted) 25%, transparent);
}
```

- [ ] **Step 3: Wire the handler through the save-gate in guides.js**

In `onComponentEditorClick`'s `openInsertMenu` call (guides.js:927), add to the handlers object:

```js
      contentTabs: (i) => beginChildNavigation(formEl, { type: 'insert', kind: 'tabs', insertAt: i }),
      pasteMarkdown: (i) => beginChildNavigation(formEl, { type: 'insert', kind: 'paste-markdown', insertAt: i }),
```

In `runChildAction` (guides.js:876), add a branch to the `insert` block:

```js
    else if (action.kind === 'tabs') await getFormAction('openCreateContentTabs')?.({ container, insertAtIndex: action.insertAt });
    else if (action.kind === 'paste-markdown') await getFormAction('openPasteMarkdown')?.({ container, insertAtIndex: action.insertAt });
```

(`openPasteMarkdown` is registered in Task 4; until then the optional-chained call is a silent no-op — safe to commit.)

- [ ] **Step 4: Commit**

```bash
git add scripts/insertMenu.js config/forms/formsStyling.css scripts/guides.js
git commit -m "feat(insert-menu): divider + Paste copied markdown option"
```

---

### Task 4: Paste form (HTML + opener action)

**Files:**
- Create: `config/forms/pasteMarkdown.html`
- Modify: `scripts/guides.js` (register `openPasteMarkdown`, after `openCreateGuideAdmonition` at line 1244)

- [ ] **Step 1: Create the form HTML**

Create `config/forms/pasteMarkdown.html`. Conventions: `--full` form group because the textarea is label-less full-width; **plain** textarea (no `data-richtext` — it holds raw markdown); single primary action bottom-right (form-actions is already `justify-content: flex-end`); `add` is the standard plus icon ligature.

```html
<form data-nav id="paste-markdown-form" data-storage-key="moreButtonsPasteMarkdown" data-width="90vw" data-height="90vh">
  <h2>Paste copied markdown</h2>

  <div class="more-buttons-form-group more-buttons-form-group--full">
    <textarea name="pasteMarkdownText" rows="18" placeholder="Paste component markdown here — copied with a component’s Copy button (admonitions, captures or content tabs)"></textarea>
  </div>

  <div class="more-buttons-form-actions">
    <button type="button" class="more-buttons-button success" data-action="insertPastedMarkdown"><span class="more-buttons-icon">add</span>Insert Markdown</button>
  </div>
</form>
```

No manifest change: `config/forms/*` is already globbed in `manifest.json` web_accessible_resources (line 99). No `data-dirty-guard`: the pasted text survives on the clipboard, so discard-on-back needs no prompt.

- [ ] **Step 2: Register the opener form action**

In `scripts/guides.js`, after the `openCreateGuideAdmonition` registration (line 1244), add — same shape: clear storage so the textarea opens empty (except on history replay), then carry the parent container + insert index on the form's dataset:

```js
registerFormAction('openPasteMarkdown', async ({ container, insertAtIndex }) => {
  if (!container?.file) return;
  if (!isFormReplay()) {
    await chrome.storage.local.set({ moreButtonsPasteMarkdown: { pasteMarkdownText: '' } });
  }
  const { formEl } = await createForm('pasteMarkdown');
  if (!formEl) return;
  // Parent container the pasted components will be spliced into (kind/uuid/file).
  formEl.dataset.parentKind = container.kind;
  formEl.dataset.parentUuid = container.uuid;
  formEl.dataset.parentFile = container.file;
  formEl.dataset.insertAtIndex = insertAtIndex == null ? '' : String(insertAtIndex);
  setCrumbLabel('Paste markdown');
});
```

- [ ] **Step 3: Manual smoke check (form opens)**

Reload the extension at chrome://extensions, open a guide section editor, click "+ Insert Component" → the menu shows the divider + "Paste copied markdown"; clicking it opens the textarea form with the breadcrumb "Paste markdown", with the standard loading veil during the transition. (Insert does nothing yet — that's Task 5.)

- [ ] **Step 4: Commit**

```bash
git add config/forms/pasteMarkdown.html scripts/guides.js
git commit -m "feat(forms): paste-markdown form + openPasteMarkdown action"
```

---

### Task 5: Insert action — validate → fresh uuids → push

**Files:**
- Modify: `scripts/guides.js` (register `insertPastedMarkdown` right after `openPasteMarkdown`; import `parsePastedComponents`)

- [ ] **Step 1: Implement the submit action**

Extend the components.js import in guides.js (line 37) once more:

```js
import { parseComponents, buildComponentBody, ensureCaptureUUIDs, uuidOfComponent, reorderComponents, componentMarkdown, parsePastedComponents } from './components.js';
```

Register after `openPasteMarkdown`. Notes on the shape: validation failure marks the textarea `--invalid` + `alert(...)` (the codebase's standard error pattern — see `persistNewAdmonition`'s `alert('Type is required.')`); the commit mirrors `persistNewAdmonition`'s splice (guides.js:1353) with a multi-component splice; success mirrors `deleteGuideAdmonition`'s exit (clear storage → `navigateBack()`, which replays the parent editor's opener and re-reads the file, so the inserted components appear). No editor is opened after insert (per spec). `form.js`'s dispatcher supplies the loading veil; `setButtonBusy` adds progress text on the button itself.

```js
registerFormAction('insertPastedMarkdown', async ({ formEl, content }) => {
  const textarea = formEl.querySelector('[name="pasteMarkdownText"]');
  textarea?.classList.remove('--invalid');
  const { components, error } = parsePastedComponents(textarea?.value ?? '');
  if (error) {
    textarea?.classList.add('--invalid');
    alert(error);
    return;
  }
  const container = {
    kind: formEl.dataset.parentKind,
    uuid: formEl.dataset.parentUuid,
    file: formEl.dataset.parentFile,
  };
  const insertAtRaw = formEl.dataset.insertAtIndex;
  const insertAt = insertAtRaw === '' || insertAtRaw == null ? null : parseInt(insertAtRaw, 10);
  const btn = content.querySelector('[data-action="insertPastedMarkdown"]');
  const snap = snapshotButton(btn);
  setButtonBusy(btn, 'Inserting…');
  try {
    await githubFetchAndPushFile(container.file, s => setButtonBusy(btn, s), md => {
      const { description, components: existing } = readContainerComponents(md, container);
      const idx = (insertAt != null && insertAt >= 0 && insertAt <= existing.length) ? insertAt : existing.length;
      const next = existing.slice();
      next.splice(idx, 0, ...components);
      return writeContainerBody(md, container, description, next);
    });
    await chrome.storage.local.remove('moreButtonsPasteMarkdown');
    await navigateBack();
  } catch (e) {
    restoreButton(btn, snap);
    alert('Failed to insert markdown: ' + e.message);
  }
});
```

(`snapshotButton`, `restoreButton`, `setButtonBusy`, `navigateBack`, `isFormReplay`, `setCrumbLabel`, `createForm` are all already imported in guides.js line 16.)

- [ ] **Step 2: Regression-run the suite**

Run: `for f in tests/*.test.mjs; do echo "== $f"; node "$f" || break; done`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add scripts/guides.js
git commit -m "feat(components): insertPastedMarkdown — validate, mint fresh uuids, splice + push"
```

---

### Task 6: End-to-end manual verification

No new automated coverage is possible for clipboard/DOM/GitHub wiring — verify in the live extension. Reload at chrome://extensions first.

- [ ] **Step 1: Copy — each component type**

In a guide section editor: click Copy on an admonition that contains a nested capture, on a plain capture, and on a content-tabs group. Each click flashes "Copied ✓". Paste the clipboard into a scratch editor and confirm: full markdown including nested children, **zero** `data-uuid` occurrences, no stray blank/indent-only lines where spans were.

- [ ] **Step 2: Paste — same page**

"+ Insert Component" → "Paste copied markdown" → paste the copied admonition → "Insert Markdown". Form closes back to the section editor; the new component appears at the chosen position. Open the draft file on GitHub and confirm the inserted block carries a **new** uuid (different from the source component's).

- [ ] **Step 3: Paste — different page + multi-component**

Copy from one guide, paste into a different guide's section. Also paste two components at once (admonition + capture markdown concatenated with a blank line) and confirm both insert in order. Capture images render (shared asset reference).

- [ ] **Step 4: Negative cases**

Paste plain prose → textarea turns red + explanatory alert, form stays open, nothing committed. Empty textarea → same. Prose above a valid component → rejected.

- [ ] **Step 5: Save-gate + veil behaviour**

With unsaved parent-form edits, choosing "Paste copied markdown" prompts to save first (standard gate). All transitions show the centered formLoading veil — no inline placeholders anywhere.

- [ ] **Step 6: Final commit (if any fixups) and wrap up**

```bash
git status   # confirm clean or commit fixups with a fix: message
```

---

## Self-review record

- Spec coverage: copy button on all 3 card types (Task 2), uuid-stripped clipboard payload (Task 1+2), menu divider + option (Task 3), textarea form with "+ Insert Markdown" (Task 4), validate/re-uuid/push respecting insert position (Task 5), no-editor-after-paste + veil + no manifest change (Tasks 4–5 notes), edge cases (Task 6).
- Placeholders: none — every step carries the actual code/commands.
- Naming consistency: `data-copy-component-md`, `componentMarkdown`, `parsePastedComponents`, `pasteMarkdownText`, `moreButtonsPasteMarkdown`, `openPasteMarkdown`, `insertPastedMarkdown` used identically across tasks.
