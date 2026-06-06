# Read-Only Capture Path Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a disabled, read-only "capture path" form field above the light/dark preview tiles on every capture page — labelled "Proposed capture path" in the in-memory New Capture flow and "Capture path" in the GitHub-backed library entry / recapture / insert flows.

**Architecture:** Add two small shared exports to `captureCards.js` (the module both capture flows already import for their preview tiles): a pure `captureBasePath(path)` that reduces any stored capture path to its theme-agnostic, root-relative base, and a `capturePathField({ label, value })` renderer that returns a standard `.more-buttons-form-group` row with a disabled `.more-buttons-input-text`. `captureNew.js` and `captureEntry.js` then prepend that field above their `captureGrid(...)` calls. No new fetches, no manifest changes — New derives the path from its in-memory `capture.lightFilename`, Entry from the GitHub-tree `lightPath`.

**Tech Stack:** Plain ES modules (Chrome MV3 unpacked extension), no build step, no test runner. Verification is manual in the loaded extension. Form styling reuses existing classes in `config/forms/formsStyling.css` (`.more-buttons-form-group`, `.more-buttons-label`, `.more-buttons-input-text`, and the existing `input:disabled` rule at `formsStyling.css:323`).

**Path format (decided):** theme-agnostic base, e.g. `docs/assets/occ-captures/sites/uuid/report-something-light-mode.png` → `sites/uuid/report-something`. Same string in New (from `occ-captures/…`-relative `lightFilename`) and Entry (from `docs/assets/occ-captures/…` `lightPath`).

---

## File Structure

- **Modify** `scripts/captureCards.js` — add `captureBasePath()` (pure path reducer) and `capturePathField()` (form-row renderer). This module already owns the shared `captureCard`/`captureGrid` preview rendering used by both flows, so the path field belongs here too — both pages stay identical by construction.
- **Modify** `scripts/captureNew.js` — prepend `capturePathField({ label: 'Proposed capture path', value: captureBasePath(capture.lightFilename) })` above the grid.
- **Modify** `scripts/captureEntry.js` — prepend `capturePathField({ label: 'Capture path', value: captureBasePath(lightPath) })` above the grid in both `renderPreview()` and `renderCompare()`.

No manifest change needed: `captureCards.js` is already listed in `manifest.json` web_accessible_resources (it is imported by the existing shipped flows).

---

## Task 1: Add `captureBasePath` and `capturePathField` to captureCards.js

**Files:**
- Modify: `scripts/captureCards.js`

- [ ] **Step 1: Add the two exports to the bottom of `captureCards.js`**

Append after the existing `captureGrid` function (after `scripts/captureCards.js:26`):

```javascript

// Storage root for all captures (mirrors CAPTURE_ROOT in captureLibrary.js).
const CAPTURE_ROOT = 'docs/assets/occ-captures';

/**
 * Reduce a stored capture path to its theme-agnostic, root-relative base.
 * Accepts either a full repo path (captureEntry's `lightPath`) or a
 * library-relative `occ-captures/…` filename (captureNew's `lightFilename`),
 * and strips the trailing -light-mode.png / -dark-mode.png so the same string
 * represents the light+dark pair.
 *
 *   "docs/assets/occ-captures/sites/uuid/foo-light-mode.png" -> "sites/uuid/foo"
 *   "occ-captures/sites/uuid/foo-dark-mode.png"              -> "sites/uuid/foo"
 *
 * @param {string} path
 * @returns {string}
 */
export function captureBasePath(path) {
  if (!path) return '';
  let p = path;
  if (p.startsWith(CAPTURE_ROOT + '/')) p = p.slice(CAPTURE_ROOT.length + 1);
  else if (p.startsWith('occ-captures/')) p = p.slice('occ-captures/'.length);
  return p.replace(/-(light|dark)-mode\.png$/, '');
}

/** Escape a value for safe interpolation into an HTML attribute. */
function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Read-only "capture path" form row, rendered above the preview grid. Uses the
 * standard horizontal form-group layout (label left, input right) so it matches
 * every other overlay form. The input is disabled + readonly: view-only, always.
 * @param {{label:string, value:string}} opts
 */
export function capturePathField({ label, value }) {
  return `
    <div class="more-buttons-form-group">
      <label class="more-buttons-label">${escapeAttr(label)}</label>
      <input class="more-buttons-input-text" type="text" value="${escapeAttr(value)}" disabled readonly>
    </div>
  `;
}
```

- [ ] **Step 2: Verify the file parses (syntax check)**

Run: `node --check scripts/captureCards.js`
Expected: no output, exit code 0 (file is valid ES module syntax).

- [ ] **Step 3: Commit**

```bash
git add scripts/captureCards.js
git commit -m "feat(captures): add captureBasePath + capturePathField helpers"
```

---

## Task 2: Show "Proposed capture path" on the New Capture page

**Files:**
- Modify: `scripts/captureNew.js`

- [ ] **Step 1: Import the new helper**

Edit the import on `scripts/captureNew.js:4` from:

```javascript
import { captureCard, captureGrid } from './captureCards.js';
```

to:

```javascript
import { captureCard, captureGrid, capturePathField, captureBasePath } from './captureCards.js';
```

- [ ] **Step 2: Prepend the path field above the preview grid**

Replace the `bodyEl.innerHTML = captureGrid([...])` block at `scripts/captureNew.js:26-29`:

```javascript
  bodyEl.innerHTML = captureGrid([
    captureCard({ theme: 'light', title: 'Light mode', src: capture.lightDataUrl, alt: 'light mode' }),
    captureCard({ theme: 'dark', title: 'Dark mode', src: capture.darkDataUrl, alt: 'dark mode' }),
  ]);
```

with:

```javascript
  bodyEl.innerHTML =
    capturePathField({ label: 'Proposed capture path', value: captureBasePath(capture.lightFilename) }) +
    captureGrid([
      captureCard({ theme: 'light', title: 'Light mode', src: capture.lightDataUrl, alt: 'light mode' }),
      captureCard({ theme: 'dark', title: 'Dark mode', src: capture.darkDataUrl, alt: 'dark mode' }),
    ]);
```

- [ ] **Step 3: Verify the file parses**

Run: `node --check scripts/captureNew.js`
Expected: no output, exit code 0.

- [ ] **Step 4: Manual verification in the extension**

1. Reload the unpacked extension (`chrome://extensions` → reload).
2. Open the capture library form, click "Add a new capture", shift-click an element on a page with a UUID in its URL.
3. On the New Capture page, confirm a "Proposed capture path" row appears **above** the light/dark tiles.
4. Confirm the value is the theme-agnostic base (e.g. `sites/uuid/<element-slug>`) — no `-light-mode`, no `.png`, no `occ-captures/` prefix.
5. Confirm the input is greyed-out and cannot be focused/edited.

Expected: all five hold.

- [ ] **Step 5: Commit**

```bash
git add scripts/captureNew.js
git commit -m "feat(captures): show Proposed capture path on New Capture page"
```

---

## Task 3: Show "Capture path" on the library entry, recapture, and insert views

**Files:**
- Modify: `scripts/captureEntry.js`

- [ ] **Step 1: Import the new helper**

Edit the import on `scripts/captureEntry.js:6` from:

```javascript
import { captureCard, captureGrid } from './captureCards.js';
```

to:

```javascript
import { captureCard, captureGrid, capturePathField, captureBasePath } from './captureCards.js';
```

- [ ] **Step 2: Compute the display path once, near the top of `openCaptureEntry`**

Immediately after `if (titleEl && label) titleEl.textContent = label;` (`scripts/captureEntry.js:35`), add:

```javascript
  // Theme-agnostic, root-relative path shown read-only above the previews.
  const displayPath = captureBasePath(lightPath);
```

- [ ] **Step 3: Prepend the path field in `renderPreview()`**

Replace the `bodyEl.innerHTML = captureGrid([...])` block in `renderPreview()` at `scripts/captureEntry.js:59-62`:

```javascript
    bodyEl.innerHTML = captureGrid([
      captureCard({ theme: 'light', title: 'Light mode', src: lightObjectUrl, alt: label ?? 'light mode' }),
      captureCard({ theme: 'dark', title: 'Dark mode', src: darkObjectUrl, alt: `${label ?? 'capture'} (dark)` }),
    ]);
```

with:

```javascript
    bodyEl.innerHTML =
      capturePathField({ label: 'Capture path', value: displayPath }) +
      captureGrid([
        captureCard({ theme: 'light', title: 'Light mode', src: lightObjectUrl, alt: label ?? 'light mode' }),
        captureCard({ theme: 'dark', title: 'Dark mode', src: darkObjectUrl, alt: `${label ?? 'capture'} (dark)` }),
      ]);
```

- [ ] **Step 4: Prepend the path field in `renderCompare()`**

Replace the `bodyEl.innerHTML = captureGrid([...])` block in `renderCompare()` at `scripts/captureEntry.js:85-90`:

```javascript
    bodyEl.innerHTML = captureGrid([
      captureCard({ theme: 'light', title: 'Light mode (Old)', src: lightObjectUrl, alt: 'old light mode' }),
      captureCard({ theme: 'dark', title: 'Dark mode (Old)', src: darkObjectUrl, alt: 'old dark mode' }),
      captureCard({ theme: 'light', title: 'Light mode (New)', src: pendingCapture.lightDataUrl, alt: 'new light mode' }),
      captureCard({ theme: 'dark', title: 'Dark mode (New)', src: pendingCapture.darkDataUrl, alt: 'new dark mode' }),
    ]);
```

with:

```javascript
    bodyEl.innerHTML =
      capturePathField({ label: 'Capture path', value: displayPath }) +
      captureGrid([
        captureCard({ theme: 'light', title: 'Light mode (Old)', src: lightObjectUrl, alt: 'old light mode' }),
        captureCard({ theme: 'dark', title: 'Dark mode (Old)', src: darkObjectUrl, alt: 'old dark mode' }),
        captureCard({ theme: 'light', title: 'Light mode (New)', src: pendingCapture.lightDataUrl, alt: 'new light mode' }),
        captureCard({ theme: 'dark', title: 'Dark mode (New)', src: pendingCapture.darkDataUrl, alt: 'new dark mode' }),
      ]);
```

- [ ] **Step 5: Verify the file parses**

Run: `node --check scripts/captureEntry.js`
Expected: no output, exit code 0.

- [ ] **Step 6: Manual verification in the extension**

1. Reload the unpacked extension.
2. Open the capture library and click the capture you saved in Task 2.
3. Confirm a "Capture path" row appears **above** the light/dark tiles, with the **identical** string shown as "Proposed capture path" was in Task 2.
4. Click "Recapture", take a new shot, and confirm the "Capture path" row is still shown above the 4-tile compare view.
5. Open the library in insert mode (from a component form's insert flow) and click a capture; confirm "Capture path" shows there too.
6. Confirm the input is non-editable in both light and dark theme.

Expected: all hold; New and Entry strings match exactly.

- [ ] **Step 7: Commit**

```bash
git add scripts/captureEntry.js
git commit -m "feat(captures): show Capture path on library entry/recapture/insert views"
```

---

## Self-Review Notes

- **Spec coverage:** New page shows "Proposed capture path" (Task 2); library entry read-from-GitHub shows "Capture path" (Task 3 / `renderPreview`); also covered in recapture compare and insert views (Task 3 / `renderCompare`). Field is above the preview tiles in every case. Path starts just below `occ-captures` and is theme-agnostic (Task 1 `captureBasePath`). ✓
- **Type consistency:** `captureBasePath` / `capturePathField` named identically across all three files; `capturePathField` always called with `{ label, value }`. ✓
- **No placeholders:** every step shows the exact code/command. ✓
- **No fetch added:** New uses in-memory `capture.lightFilename`; Entry uses already-available `lightPath`. ✓
