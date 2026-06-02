# Admonition Collapsible Setting + Library Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 3-way collapsible control to the edit-admonition form, and an "Add a new capture" flow to the capture library that captures one screenshot and saves it straight to the GitHub library.

**Architecture:** Feature 1 teaches the existing markdown admonition parser about the `???+` (collapsible-open) prefix and drives the prefix from a new radio control on create + edit. Feature 2 reuses Capture Mode (single-shot) and the existing `pushCaptures` GitHub helper, with a new captureEntry-style preview form; the light/dark card renderer is extracted into a shared module used by both preview pages.

**Tech Stack:** Vanilla ES-module JS (Chrome extension MV3, no build step), HTML form templates loaded via `fetch`, `chrome.storage.local`, GitHub contents/git-trees API. No test framework exists; the one pure-logic change (the parser) gets a standalone Node assertion script (`node tests/*.mjs`, ESM auto-detected). Everything else is verified by loading the unpacked extension.

---

## File Structure

**Feature 1 — collapsible setting**
- Modify `scripts/admonitions.js` — parser/locator regexes recognize `???+`.
- Modify `config/forms/editGuideAdmonition.html` — add the `admonitionCollapsible` radio group.
- Modify `scripts/guides.js` — prefix⇄value mapping; seed on open; derive prefix on submit (create + edit).
- Create `tests/admonitions-prefix.test.mjs` — Node assertions for the parser change.

**Feature 2 — library capture**
- Create `scripts/captureCards.js` — shared light/dark card renderer.
- Modify `scripts/captureEntry.js` — use the shared renderer.
- Create `config/forms/captureNew.html` — preview page template.
- Create `scripts/captureNew.js` — preview page controller + `openCaptureNew` action.
- Modify `config/forms/captureLibrary.html` — add "Add a new capture" action button.
- Modify `scripts/captureLibrary.js` — register `startLibraryCapture` action.
- Modify `scripts/actions.js` — import `captureNew.js` so it self-registers.

---

## Task 1: Teach the admonition parser the `???+` prefix

**Files:**
- Test: `tests/admonitions-prefix.test.mjs`
- Modify: `scripts/admonitions.js` (header regex ~line 81; walk-up regex ~line 258; doc comments)

- [ ] **Step 1: Write the failing test**

Create `tests/admonitions-prefix.test.mjs`:

```js
import assert from 'node:assert/strict';
import {
  parseAdmonitions,
  buildAdmonition,
  replaceAdmonitionByUUID,
  injectAdmonitionUUID,
} from '../scripts/admonitions.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

test('parses !!! as static prefix', () => {
  assert.equal(parseAdmonitions('!!! note "T"\n\n    body\n', /note/)[0].prefix, '!!!');
});
test('parses ??? as collapsible-closed prefix', () => {
  assert.equal(parseAdmonitions('??? note "T"\n\n    body\n', /note/)[0].prefix, '???');
});
test('parses ???+ as collapsible-open prefix', () => {
  assert.equal(parseAdmonitions('???+ note "T"\n\n    body\n', /note/)[0].prefix, '???+');
});
test('???+ round-trips through buildAdmonition', () => {
  const block = buildAdmonition('???+', 'note', 'T', 'body');
  assert.equal(parseAdmonitions(block, /note/)[0].prefix, '???+');
});
test('replaceAdmonitionByUUID finds a ???+ block by uuid', () => {
  const body = injectAdmonitionUUID('body', 'u1');
  const md = buildAdmonition('???+', 'note', 'T', body);
  const replaced = replaceAdmonitionByUUID(md, 'u1', buildAdmonition('!!!', 'note', 'T2', body));
  const parsed = parseAdmonitions(replaced, /note/)[0];
  assert.equal(parsed.prefix, '!!!');
  assert.equal(parsed.title, 'T2');
});

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/ollie/Desktop/stuff/more-buttons/more-buttons-unpacked && node tests/admonitions-prefix.test.mjs`
Expected: FAIL on the "???+ as collapsible-open prefix" assertion — current regex captures `???` (or the header doesn't match and `[0]` is undefined), throwing an AssertionError / TypeError.

- [ ] **Step 3: Update the header regex**

In `scripts/admonitions.js`, `parseAdmonitions` (~line 81), change the prefix alternation to allow an optional `+`:

```js
  const headerRe = new RegExp(`^(\\s*)(\\?\\?\\?\\+?|!!!) (${typeRegex.source})(?:\\s+"(.*)")?\\s*$`);
```

(Only `(\\?\\?\\?|!!!)` → `(\\?\\?\\?\\+?|!!!)` changes.)

- [ ] **Step 4: Update the walk-up regex in `locateBlockByUUID`**

In `scripts/admonitions.js` (~line 258), change:

```js
    if (/^\s*(\?\?\?\+?|!!!) /.test(lines[i])) {
```

(Only `(\?\?\?|!!!)` → `(\?\?\?\+?|!!!)` changes.)

- [ ] **Step 5: Update doc comments mentioning the prefix**

In `scripts/admonitions.js`, update the comments that enumerate prefixes so they stay accurate:
- The header-pattern comment (~line 62): note the prefix is `???`, `???+`, or `!!!`.
- The `prefix` field comment (~line 113): `// '???', '???+' or '!!!'`.
- `buildAdmonition`'s `@param {string} prefix` line (~line 171): `- '???', '???+' or '!!!'`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd /Users/ollie/Desktop/stuff/more-buttons/more-buttons-unpacked && node tests/admonitions-prefix.test.mjs`
Expected: `5 passed`.

- [ ] **Step 7: Commit**

```bash
git add tests/admonitions-prefix.test.mjs scripts/admonitions.js
git commit -m "feat: recognize ???+ (collapsible-open) admonition prefix"
```

---

## Task 2: Add the collapsible radio control to the edit-admonition form

**Files:**
- Modify: `config/forms/editGuideAdmonition.html` (insert after the Type group, before Description)

- [ ] **Step 1: Insert the control**

In `config/forms/editGuideAdmonition.html`, after the Type `more-buttons-form-group` block closes (the `</div>` ending the block that contains the `admonitionType` radios) and before the Description `more-buttons-form-group`, insert:

```html
  <div class="more-buttons-form-group">
    <label class="more-buttons-label">Collapsible</label>
    <div class="more-buttons-radio-btn-group-row">
      <label class="more-buttons-radio-btn"><input type="radio" name="admonitionCollapsible" value="static" /> Static</label>
      <label class="more-buttons-radio-btn"><input type="radio" name="admonitionCollapsible" value="collapsed" /> Collapsible (closed)</label>
      <label class="more-buttons-radio-btn"><input type="radio" name="admonitionCollapsible" value="expanded" /> Collapsible (open)</label>
    </div>
  </div>
```

No code wiring is needed for restore: `form.js` (~line 936) already restores radios from `chrome.storage.local` by matching `input.value` against the stored value, and `.more-buttons-form-group` is a 2-column grid (label left, control right) per `formsStyling.css:258`.

- [ ] **Step 2: Verify the file parses (visual check)**

Run: `cd /Users/ollie/Desktop/stuff/more-buttons/more-buttons-unpacked && grep -c "admonitionCollapsible" config/forms/editGuideAdmonition.html`
Expected: `3` (three radio inputs share the name).

- [ ] **Step 3: Commit**

```bash
git add config/forms/editGuideAdmonition.html
git commit -m "feat: add collapsible radio control to edit-admonition form"
```

---

## Task 3: Drive the admonition prefix from the control in guides.js

**Files:**
- Modify: `scripts/guides.js` — add mapping helpers; seed `admonitionCollapsible` on open (create + edit); derive `prefix` on submit.

- [ ] **Step 1: Add prefix⇄value mapping helpers**

In `scripts/guides.js`, near the other admonition helpers (e.g. just above `registerFormAction('openCreateGuideAdmonition', …)` ~line 786), add:

```js
// Collapsible control value ⇄ admonition prefix.
//   static    → !!!   (always open)
//   collapsed → ???   (collapsible, closed by default)
//   expanded  → ???+  (collapsible, open by default)
const COLLAPSIBLE_TO_PREFIX = { static: '!!!', collapsed: '???', expanded: '???+' };
function collapsibleToPrefix(value) { return COLLAPSIBLE_TO_PREFIX[value] ?? '!!!'; }
function prefixToCollapsible(prefix) {
  if (prefix === '???+') return 'expanded';
  if (prefix === '???') return 'collapsed';
  return 'static';
}
```

- [ ] **Step 2: Seed the control on create**

In `openCreateGuideAdmonition` (~line 790), add `admonitionCollapsible` to the seeded storage object so new admonitions default to static:

```js
    await chrome.storage.local.set({
      moreButtonsEditGuideAdmonition: {
        admonitionTitle: '',
        admonitionMeta: '',
        admonitionType: 'step',
        admonitionDescription: '',
        admonitionCollapsible: 'static',
      },
    });
```

- [ ] **Step 3: Seed the control on edit**

In `openEditGuideAdmonition` (~line 834), add the current prefix's mapped value to the seeded storage object:

```js
    await chrome.storage.local.set({
      moreButtonsEditGuideAdmonition: {
        admonitionTitle: admTitle,
        admonitionMeta: admMeta,
        admonitionType: adm.type,
        admonitionDescription: description,
        admonitionCollapsible: prefixToCollapsible(adm.prefix),
      },
    });
```

- [ ] **Step 4: Read the control and derive the prefix on submit**

In `submitEditGuideAdmonition` (~line 931), after `const description = …` and before the `if (!type)` guard, add:

```js
    const collapsible = formEl.querySelector('[name="admonitionCollapsible"]:checked')?.value ?? 'static';
    const prefix = collapsibleToPrefix(collapsible);
```

- [ ] **Step 5: Use the derived prefix in the create path**

In the same function, in the `if (mode === 'create')` branch, DELETE the existing hardcoded line:

```js
      const prefix = '!!!';
```

The `newUuid` line stays; `buildAdmonition(prefix, type, title, body)` now uses the `prefix` derived in Step 4 (declared in the outer scope).

- [ ] **Step 6: Use the derived prefix in the edit path**

In the same function, in the edit path (~line 995), change:

```js
      const newBlock = buildAdmonition(prefix, type, title, body);
```

(was `buildAdmonition(cur.prefix, type, title, body)` — now driven by the control so toggling actually changes the prefix.)

- [ ] **Step 7: Sanity-check no duplicate `prefix` declaration remains**

Run: `cd /Users/ollie/Desktop/stuff/more-buttons/more-buttons-unpacked && grep -n "const prefix" scripts/guides.js`
Expected: exactly one `const prefix = collapsibleToPrefix(collapsible);` inside `submitEditGuideAdmonition` (the old `const prefix = '!!!';` is gone). Other matches in unrelated functions are fine.

- [ ] **Step 8: Commit**

```bash
git add scripts/guides.js
git commit -m "feat: drive admonition collapsibility from the form control"
```

---

## Task 4: Manual verification — Feature 1

**Files:** none (verification only)

- [ ] **Step 1: Load the unpacked extension**

In Chrome → `chrome://extensions` → enable Developer mode → "Load unpacked" → select `/Users/ollie/Desktop/stuff/more-buttons/more-buttons-unpacked` (or click the reload icon on the existing entry if already loaded).

- [ ] **Step 2: Verify create defaults to Static**

Open a guide, add a new admonition. Confirm the new "Collapsible" control shows **Static** selected by default. Fill a title/body, save, and confirm the pushed markdown header is `!!! <type> …` (unchanged behaviour).

- [ ] **Step 3: Verify collapsed + expanded round-trip**

Edit an admonition, switch the control to **Collapsible (closed)**, save → reopen and confirm the control shows Collapsible (closed) and the markdown header is `??? <type> …`. Repeat with **Collapsible (open)** → header `???+ <type> …` and the control restores to Collapsible (open).

- [ ] **Step 4: Verify an existing block's prefix is read correctly**

Open an admonition that is already `???` or `???+` in the repo and confirm the control reflects it on open (not defaulting to Static).

---

## Task 5: Extract the shared light/dark card renderer

**Files:**
- Create: `scripts/captureCards.js`
- Modify: `scripts/captureEntry.js` (replace the private `themeCard` + inline grids)

- [ ] **Step 1: Create the shared renderer module**

Create `scripts/captureCards.js`:

```js
/**
 * captureCards.js — Shared light/dark capture preview cards.
 * Used by captureEntry.js (override existing) and captureNew.js (new capture).
 */

/**
 * One theme card. Returns '' when src is falsy so callers can spread an array
 * and let missing variants drop out.
 * @param {{theme:'light'|'dark', title:string, src:string, alt?:string}} opts
 */
export function captureCard({ theme, title, src, alt = '' }) {
  if (!src) return '';
  return `
    <figure class="mb-capture-card mb-capture-card--${theme}">
      <figcaption class="mb-capture-card__title">${title}</figcaption>
      <div class="mb-capture-card__image-wrap">
        <img class="mb-capture-card__img" src="${src}" alt="${alt}">
      </div>
    </figure>
  `;
}

/** Wrap rendered cards in the preview grid. */
export function captureGrid(cards) {
  return `<div class="mb-capture-entry-grid">${cards.join('')}</div>`;
}
```

- [ ] **Step 2: Import the shared renderer into captureEntry.js**

At the top of `scripts/captureEntry.js`, add to the imports:

```js
import { captureCard, captureGrid } from './captureCards.js';
```

- [ ] **Step 3: Delete the private `themeCard` and use the shared renderer**

In `scripts/captureEntry.js`, delete the local `themeCard(theme, title, src, alt)` function. Replace `renderPreview` and `renderCompare` with:

```js
  function renderPreview() {
    bodyEl.innerHTML = captureGrid([
      captureCard({ theme: 'light', title: 'Light mode', src: lightObjectUrl, alt: label ?? 'light mode' }),
      captureCard({ theme: 'dark', title: 'Dark mode', src: darkObjectUrl, alt: `${label ?? 'capture'} (dark)` }),
    ]);
    actionsEl.innerHTML = `<button type="button" class="more-buttons-button" data-capture-entry-override>Recapture</button>`;
  }

  function renderCompare() {
    if (!pendingCapture) return;
    bodyEl.innerHTML = captureGrid([
      captureCard({ theme: 'light', title: 'Light mode (Old)', src: lightObjectUrl, alt: 'old light mode' }),
      captureCard({ theme: 'dark', title: 'Dark mode (Old)', src: darkObjectUrl, alt: 'old dark mode' }),
      captureCard({ theme: 'light', title: 'Light mode (New)', src: pendingCapture.lightDataUrl, alt: 'new light mode' }),
      captureCard({ theme: 'dark', title: 'Dark mode (New)', src: pendingCapture.darkDataUrl, alt: 'new dark mode' }),
    ]);
    actionsEl.innerHTML = `
      <span class="more-buttons-description" data-capture-entry-status hidden></span>
      <button type="button" class="more-buttons-button secondary" data-capture-entry-cancel>Cancel</button>
      <button type="button" class="more-buttons-button" data-capture-entry-save>Save Changes</button>
    `;
  }
```

- [ ] **Step 4: Verify captureEntry no longer references the deleted function**

Run: `cd /Users/ollie/Desktop/stuff/more-buttons/more-buttons-unpacked && grep -n "themeCard" scripts/captureEntry.js`
Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add scripts/captureCards.js scripts/captureEntry.js
git commit -m "refactor: extract shared capture card renderer"
```

---

## Task 6: Build the new-capture preview form + controller

**Files:**
- Create: `config/forms/captureNew.html`
- Create: `scripts/captureNew.js`

- [ ] **Step 1: Create the form template**

Create `config/forms/captureNew.html`:

```html
<form data-nav id="capture-new-form" data-storage-key="moreButtonsCaptureNew" data-width="80vw" data-height="80vh">
  <h2>New Capture</h2>
  <div data-capture-new-body></div>

  <div class="more-buttons-form-actions">
    <span class="more-buttons-description" data-capture-new-status hidden></span>
    <button type="button" class="more-buttons-button secondary" data-capture-new-cancel>Cancel</button>
    <button type="button" class="more-buttons-button" data-capture-new-save>Save to Library</button>
  </div>
</form>
```

- [ ] **Step 2: Create the controller**

Create `scripts/captureNew.js`:

```js
import { createForm, navigateBack } from './form.js';
import { pushCaptures } from './captures.js';
import { captureCard, captureGrid } from './captureCards.js';
import { registerFormAction } from './formActions.js';

// `capture` is one entry from Capture Mode's session buffer: it carries
// lightDataUrl/darkDataUrl plus library-relative lightFilename/darkFilename
// (derived from the page path under occ-captures/…). pushCaptures writes those
// straight to docs/assets/<filename> on GitHub — the library root.
export async function openCaptureNew({ capture } = {}) {
  if (!capture?.lightDataUrl) return;

  const opener = () => openCaptureNew({ capture });
  const { formEl } = await createForm('captureNew', opener);
  if (!formEl) return;

  // form.js moves .more-buttons-form-actions out of <form>, so look up the
  // action controls on the parent overlay-content wrapper.
  const contentEl = formEl.parentElement ?? formEl;
  const bodyEl = formEl.querySelector('[data-capture-new-body]');
  const statusEl = contentEl.querySelector('[data-capture-new-status]');
  const saveBtn = contentEl.querySelector('[data-capture-new-save]');
  const cancelBtn = contentEl.querySelector('[data-capture-new-cancel]');

  bodyEl.innerHTML = captureGrid([
    captureCard({ theme: 'light', title: 'Light mode', src: capture.lightDataUrl, alt: 'light mode' }),
    captureCard({ theme: 'dark', title: 'Dark mode', src: capture.darkDataUrl, alt: 'dark mode' }),
  ]);

  const setStatus = (msg) => {
    if (!statusEl) return;
    statusEl.hidden = false;
    statusEl.textContent = msg;
  };

  async function save() {
    if (saveBtn) saveBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    try {
      await pushCaptures([capture], setStatus);
      setStatus('Saved to library.');
      navigateBack(); // replays openCaptureLibrary → re-fetches the tree
    } catch (e) {
      setStatus(`Failed: ${e.message}`);
      if (saveBtn) saveBtn.disabled = false;
      if (cancelBtn) cancelBtn.disabled = false;
    }
  }

  contentEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-capture-new-save]')) save();
    else if (e.target.closest('[data-capture-new-cancel]')) navigateBack();
  });
}

registerFormAction('openCaptureNew', openCaptureNew);
```

- [ ] **Step 3: Commit**

```bash
git add config/forms/captureNew.html scripts/captureNew.js
git commit -m "feat: add new-capture preview form with Save to Library"
```

---

## Task 7: Wire the "Add a new capture" button into the library

**Files:**
- Modify: `config/forms/captureLibrary.html` — add the action button
- Modify: `scripts/captureLibrary.js` — register `startLibraryCapture`
- Modify: `scripts/actions.js` — import `captureNew.js`

- [ ] **Step 1: Add the action button to the library form**

Replace the contents of `config/forms/captureLibrary.html` with:

```html
<form data-nav id="capture-library-form" data-storage-key="moreButtonsCaptureLibrary" data-width="80vw" data-height="80vh">
  <h2>Capture Library</h2>
  <div data-capture-library-panel></div>

  <div class="more-buttons-form-actions">
    <button type="button" class="more-buttons-button" data-action="startLibraryCapture">Add a new capture</button>
  </div>
</form>
```

`form.js`'s delegated `data-action` handler (form.js:605-625) dispatches `startLibraryCapture` to the registered form action with a `{ formEl, overlay, content, … }` context.

- [ ] **Step 2: Add imports to captureLibrary.js**

In `scripts/captureLibrary.js`, extend the existing imports. Change the form import line and add the capture-mode import:

```js
import { createForm, snapshotFormStack } from './form.js';
import { enterCaptureMode } from './captureMode.js';
```

(`createForm` is already imported from `./form.js`; add `snapshotFormStack` to that line and add the `enterCaptureMode` line. `getFormAction`/`registerFormAction` are already imported.)

- [ ] **Step 3: Register the `startLibraryCapture` action**

At the bottom of `scripts/captureLibrary.js`, after the existing `registerFormAction('openCaptureLibrary', openCaptureLibrary);` line, add:

```js
// "Add a new capture": one-shot Capture Mode → new-capture preview → Save to Library.
registerFormAction('startLibraryCapture', ({ overlay }) => {
  const formStackSnapshot = snapshotFormStack();
  overlay.style.display = 'none';
  const prevBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = '';

  enterCaptureMode({
    saveTarget: 'session',
    maxCaptures: 1,
    formStackSnapshot,
    returnTo: {
      onComplete: (buffer) => {
        if (!buffer.length) {
          // User exited capture mode without a shot — restore the library.
          if (overlay.isConnected) {
            overlay.style.display = '';
            document.body.style.overflow = prevBodyOverflow;
          }
          return;
        }
        // Hand the single capture to the preview page. createForm there tears
        // down this (hidden) library overlay and pushes a new history entry.
        getFormAction('openCaptureNew')?.({ capture: buffer[0] });
      },
    },
  });
});
```

- [ ] **Step 4: Import captureNew.js so it self-registers**

In `scripts/actions.js`, after the `import './captureEntry.js';` line (line 11), add:

```js
import './captureNew.js';
```

- [ ] **Step 5: Verify the action name matches in both places**

Run: `cd /Users/ollie/Desktop/stuff/more-buttons/more-buttons-unpacked && grep -rn "startLibraryCapture" config/forms/captureLibrary.html scripts/captureLibrary.js`
Expected: one match in the HTML (`data-action="startLibraryCapture"`) and one `registerFormAction('startLibraryCapture', …)` in the JS.

- [ ] **Step 6: Commit**

```bash
git add config/forms/captureLibrary.html scripts/captureLibrary.js scripts/actions.js
git commit -m "feat: add 'Add a new capture' action to the capture library"
```

---

## Task 8: Manual verification — Feature 2

**Files:** none (verification only)

- [ ] **Step 1: Reload the unpacked extension**

`chrome://extensions` → reload the More Buttons entry.

- [ ] **Step 2: Open the capture library and start a capture**

Open the Capture Library. Confirm an **"Add a new capture"** button sits bottom-right in the actions bar. Click it: the library overlay hides and Capture Mode's bar appears.

- [ ] **Step 3: Capture one element**

Shift+click (or arm + click) an element. Capture Mode should auto-exit after the single shot (maxCaptures: 1) and the new-capture preview page should open showing **Light mode** and **Dark mode** cards.

- [ ] **Step 4: Cancel path**

Click **Cancel** → confirm you return to the Capture Library (tree visible), no GitHub write occurred.

- [ ] **Step 5: Save path**

Repeat Steps 2-3, then click **Save to Library**. Confirm the button/status shows progress, then you return to the (re-fetched) Capture Library. Verify the new capture appears under its page-derived folder under `occ-captures/…` (reload the library if the git-trees API is briefly stale).

- [ ] **Step 6: Confirm on GitHub**

In the target repo, confirm two new blobs exist at `docs/assets/occ-captures/<page-path>/<slug>-light-mode.png` and `…-dark-mode.png`.

---

## Self-Review Notes

- **Spec coverage:** Feature 1 (3-way control, parser `???+`, create+edit prefix) → Tasks 1-4. Feature 2 (library button, capture mode 1-shot, preview cards, Save to Library, refreshed return, shared card renderer) → Tasks 5-8. All spec sections map to tasks.
- **Type/name consistency:** `admonitionCollapsible` values `static`/`collapsed`/`expanded` are identical across the HTML (Task 2), seeds (Task 3 Steps 2-3), and `collapsibleToPrefix`/`prefixToCollapsible` (Task 3 Step 1). The action name `startLibraryCapture` and form action `openCaptureNew` match across Tasks 6-7. `captureCard`/`captureGrid` signatures match between Tasks 5 and 6.
- **No placeholders:** every code step shows full content.
