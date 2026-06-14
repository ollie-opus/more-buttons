# Data table per-row tabbed editing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the data-table editor's below-grid single-cell editor with a per-row Edit button that opens a child form whose tabs are the columns (alignment + rich-text per cell), the header row included (editing column titles).

**Architecture:** The grid form (`editDataTable`) gains a right-most Edit column; cells become select-only (they still drive the structure bar). Clicking a row's Edit button routes through the existing component save-gate (`beginChildNavigation` → `_componentSaver`, which auto-saves/transitions an unsaved table) into a new child form (`editDataTableRow`) modelled closely on `contentTabsEditor`. Both forms share the existing `formEl._dt` state + `chrome.storage.local` replay buffer + hidden `tableState` dirty-tracking. Each form saves the whole table via the existing `persistDataTableEdit` path.

**Tech Stack:** Vanilla ES modules (Chrome extension, no build step). Tests via Node's built-in runner (`node --test tests/*.test.mjs`) with `node:assert/strict`. **No DOM test harness — the editor wiring, new form, and navigation are verified manually in the browser** (consistent with `dataTablesEditor.js`, which has no unit test). The existing `tests/dataTables.test.mjs` is run as a regression guard since the markdown primitives are untouched.

---

## Reference: files and patterns

- **Mirror:** `scripts/contentTabsEditor.js` (dynamic tab strip `renderStrip`/`[data-ct-tab]`, `formEl._ct` + hidden `tabsState`, `_componentSaver`, openers, `submit*` action). The new per-row form is the same shape.
- **Save-gate:** `scripts/guides.js` `beginChildNavigation` (line 908), `ensureContainerReady` (895), `runChildAction` (924) — `ensureContainerReady` auto-saves an unsaved/dirty parent via its `_componentSaver()` before navigating to a child.
- **Current editor:** `scripts/dataTablesEditor.js` — `renderGrid` (79), `wireTableEditor` (198), `loadSelectedCell` (122), `setAlign` (190), `refreshControls` (99), `openCreateDataTable` (261), `openEditDataTable` (289), `saveDataTable` (381), `persistDataTableEdit` (362).
- **Grid form HTML:** `config/forms/editDataTable.html`. **Tabs form HTML to mirror:** `config/forms/editContentTabs.html`.

**Manifest:** No change needed. No new `scripts/*.js` file (all logic lives in `dataTablesEditor.js`), and the new HTML form is covered by the existing `web_accessible_resources` entry `"config/forms/*"` (manifest.json:105).

**Reload reminder:** This codebase is an unpacked extension. After **every** change to `scripts/*.js`, `config/forms/*.html`, or `*.css`, reload at `chrome://extensions` before manual verification, or you will be testing a stale build.

---

## Task 1: Route the save-gate to a (not-yet-registered) row action

**Files:**
- Modify: `scripts/guides.js:908` (export `beginChildNavigation`)
- Modify: `scripts/guides.js:939-941` (add `edit-table-row` branch)

This task is safe to land first: the new branch calls `getFormAction('openEditDataTableRow')?.(...)`, which is a no-op (optional chaining) until Task 3 registers the action.

- [ ] **Step 1: Export `beginChildNavigation`**

In `scripts/guides.js`, change line 908 from:

```js
async function beginChildNavigation(formEl, action) {
```

to:

```js
export async function beginChildNavigation(formEl, action) {
```

- [ ] **Step 2: Add the `edit-table-row` branch to `runChildAction`**

In `scripts/guides.js`, find the `edit-table` branch (lines 939-941):

```js
  } else if (action.type === 'edit-table') {
    await getFormAction('openEditDataTable')?.({ uuid: action.uuid, file: container.file });
  }
```

Replace it with (adds a new branch after it):

```js
  } else if (action.type === 'edit-table') {
    await getFormAction('openEditDataTable')?.({ uuid: action.uuid, file: container.file });
  } else if (action.type === 'edit-table-row') {
    // The data-table grid form is the parent here; after ensureContainerReady
    // the saved table's uuid/file live on its dataset (set by the opener or the
    // create→edit transition).
    await getFormAction('openEditDataTableRow')?.({ uuid: formEl.dataset.tableUuid, file: formEl.dataset.containerFile, row: action.row });
  }
```

- [ ] **Step 3: Verify the module still loads**

Run: `node --check scripts/guides.js`
Expected: no output (syntax OK).

- [ ] **Step 4: Commit**

```bash
git add scripts/guides.js
git commit -m "feat(dataTables): export save-gate + route edit-table-row child action"
```

---

## Task 2: Create the per-row form HTML

**Files:**
- Create: `config/forms/editDataTableRow.html`

Mirrors `editContentTabs.html`: a dynamic tab strip, then the relocated alignment segment + inline rich-text cell editor, the shared hidden `tableState` input, and a single Save-to-draft action (no delete — row/column deletion stays on the grid's structure bar). It shares `data-storage-key="moreButtonsEditDataTable"` with the grid form so they read the same state buffer.

- [ ] **Step 1: Write the file**

Create `config/forms/editDataTableRow.html`:

```html
<form data-nav data-dirty-guard id="edit-data-table-row-form" data-storage-key="moreButtonsEditDataTable" data-width="90vw" data-height="90vh">
  <h2 data-dtr-heading>Edit row</h2>

  <div class="more-buttons-tabs mb-dtr-tabs">
    <div class="more-buttons-tab-list" data-dtr-strip></div>
  </div>

  <div class="more-buttons-form-group">
    <label class="more-buttons-label">Alignment</label>
    <div class="mb-dt-align">
      <button type="button" class="more-buttons-tab" data-dt-align="left">Left</button>
      <button type="button" class="more-buttons-tab" data-dt-align="center">Center</button>
      <button type="button" class="more-buttons-tab" data-dt-align="right">Right</button>
    </div>
  </div>

  <div class="more-buttons-form-group">
    <label class="more-buttons-label">Cell</label>
    <textarea data-dt-cell rows="2" data-richtext="inline" placeholder="Inline markdown"></textarea>
  </div>

  <input type="hidden" name="tableState" />

  <div class="more-buttons-form-actions">
    <button type="button" class="more-buttons-button success" data-action="submitEditDataTableRow" data-save-state data-saved-label="Draft saved" data-unsaved-label="Save to draft"><span class="more-buttons-icon">outbound</span>Save to draft</button>
  </div>
</form>
```

- [ ] **Step 2: Commit**

```bash
git add config/forms/editDataTableRow.html
git commit -m "feat(dataTables): add editDataTableRow form (column tabs + cell editor)"
```

---

## Task 3: Add the per-row editor module (open + wire + submit)

**Files:**
- Modify: `scripts/dataTablesEditor.js` (imports + new "Per-row editor" section + two `registerFormAction`s)

Reuses existing helpers: `cellAt`, `setCellAt`, `syncTableState`, `seedStorage`, `initStateFromStorage`, `persistDataTableEdit`, `getDataTableByUUID`, `fetchFileMigratingIdentity`, `setCrumbLabel`, `navigateBack`, `resetDirtyBaseline`, `setButtonBusy`, `syncSurfaceFromTextarea`. New dependency: `escapeHtml` from `cardRenderer.js` (the strip labels are user text).

- [ ] **Step 1: Add the `escapeHtml` import**

In `scripts/dataTablesEditor.js`, find (line 32):

```js
import { renderDocHtml } from './markdownInline.js';
```

Add immediately after it:

```js
import { escapeHtml } from './cardRenderer.js';
```

- [ ] **Step 2: Add the per-row editor section**

In `scripts/dataTablesEditor.js`, insert this block immediately **before** the `// ── Form actions ──` comment (currently line 391):

```js
// ── Per-row (tabbed) editor ─────────────────────────────────────────────────
//
// A child form of the grid. Tabs = columns; the active tab edits one cell of a
// fixed row (selected.row), reusing the shared formEl._dt + tableState. The
// header row (row === -1) edits the column titles, so typing live-renames the
// active tab. Alignment is a column property, surfaced in every tab.

function clampRowIndex(st, row) {
  return row === -1 ? -1 : Math.max(0, Math.min(row, st.rows.length - 1));
}

function renderRowStrip(formEl) {
  const strip = formEl.querySelector('[data-dtr-strip]');
  const st = formEl._dt;
  if (!strip || !st) return;
  strip.innerHTML = st.header.map((h, i) =>
    `<button type="button" class="more-buttons-tab${i === st.selected.col ? ' --active' : ''}" data-dtr-tab="${i}">${escapeHtml((h ?? '').trim() || `Column ${i + 1}`)}</button>`
  ).join('');
}

function refreshRowAlign(formEl) {
  const st = formEl._dt;
  formEl.querySelectorAll('[data-dt-align]').forEach(btn =>
    btn.classList.toggle('--active', st.align[st.selected.col] === btn.dataset.dtAlign));
}

// Push the active column's cell into the editor + light its alignment.
function loadRowCell(formEl) {
  const st = formEl._dt;
  const ta = formEl.querySelector('[data-dt-cell]');
  if (ta) { ta.value = cellAt(st, st.selected.row, st.selected.col); syncSurfaceFromTextarea(ta); }
  refreshRowAlign(formEl);
}

function wireRowEditor(formEl) {
  // The rich editor re-dispatches surface edits as bubbling `input` events on
  // its textarea, so this one listener covers both views.
  formEl.addEventListener('input', e => {
    if (!e.target.matches?.('[data-dt-cell]')) return;
    const st = formEl._dt;
    setCellAt(st, st.selected.row, st.selected.col, e.target.value);
    if (st.selected.row === -1) renderRowStrip(formEl); // header rename → live tab label
    syncTableState(formEl);
    formEl._refreshSaveState?.();
  });

  formEl.addEventListener('click', e => {
    const tabBtn = e.target.closest('[data-dtr-tab]');
    if (tabBtn) {
      formEl._dt.selected.col = parseInt(tabBtn.dataset.dtrTab, 10);
      renderRowStrip(formEl);
      loadRowCell(formEl);
      return;
    }
    const alignBtn = e.target.closest('[data-dt-align]');
    if (alignBtn) {
      const st = formEl._dt;
      st.align[st.selected.col] = alignBtn.dataset.dtAlign;
      refreshRowAlign(formEl);
      syncTableState(formEl);
      formEl._refreshSaveState?.();
      return;
    }
  });
}

registerFormAction('openEditDataTableRow', async ({ uuid, file, row } = {}) => {
  if (!uuid || !file || row == null) return;
  let md;
  try {
    md = await fetchFileMigratingIdentity(file);
  } catch (e) {
    alert('Failed to load file: ' + e.message);
    return;
  }
  const tbl = getDataTableByUUID(md, uuid);
  if (!tbl) { alert('Data table not found.'); return; }
  const fallback = { align: tbl.align, header: tbl.header, rows: tbl.rows };
  if (!isFormReplay()) await seedStorage(fallback);

  const { formEl } = await createForm('editDataTableRow');
  if (!formEl) return;
  formEl.dataset.mode = 'edit';
  formEl.dataset.tableUuid = uuid;
  formEl.dataset.containerFile = file;

  await initStateFromStorage(formEl, fallback, file, uuid);
  const st = formEl._dt;
  const rowIdx = clampRowIndex(st, row);
  st.selected = { row: rowIdx, col: 0 };
  formEl.dataset.rowIndex = String(rowIdx);

  const heading = formEl.querySelector('[data-dtr-heading]');
  if (heading) heading.textContent = rowIdx === -1 ? 'Edit header' : `Edit row ${rowIdx + 1}`;
  setCrumbLabel(rowIdx === -1 ? 'Header' : `Row ${rowIdx + 1}`);

  wireRowEditor(formEl);
  renderRowStrip(formEl);
  loadRowCell(formEl);
  syncTableState(formEl);
  resetDirtyBaseline(formEl);
});
```

- [ ] **Step 3: Add the row-form submit action**

In `scripts/dataTablesEditor.js`, find the `submitEditDataTable` registration (line 393). Insert this **immediately before** it:

```js
registerFormAction('submitEditDataTableRow', async ({ formEl, content }) => {
  const btn = content.querySelector('[data-save-state]');
  setButtonBusy(btn, 'Saving…');
  try {
    const res = await persistDataTableEdit(formEl, s => setButtonBusy(btn, s));
    if (res) { await navigateBack(); return; } // back to the grid, which re-renders from storage
    formEl._refreshSaveState?.();
  } catch (e) {
    formEl._refreshSaveState?.();
    alert('Failed to save data table: ' + e.message);
  }
});

```

- [ ] **Step 4: Verify the module still loads**

Run: `node --check scripts/dataTablesEditor.js`
Expected: no output (syntax OK).

- [ ] **Step 5: Commit**

```bash
git add scripts/dataTablesEditor.js
git commit -m "feat(dataTables): per-row tabbed editor form (open/wire/submit)"
```

---

## Task 4: Render the Edit column + attach the save-gate to the grid

**Files:**
- Modify: `scripts/dataTablesEditor.js` — `renderGrid` (79-95), `wireTableEditor` click handler (217), openers (261, 289)

After this task the grid shows Edit buttons and clicking one navigates to the row form (auto-saving/transitioning the table first in create/dirty modes). The old below-grid editor still exists and works — it is removed in Task 5, so cell editing is never broken between commits.

- [ ] **Step 1: Add `beginChildNavigation` to the guides import**

In `scripts/dataTablesEditor.js`, find (line 30):

```js
import { spliceIntoContainer } from './guides.js';
```

Replace with:

```js
import { spliceIntoContainer, beginChildNavigation } from './guides.js';
```

- [ ] **Step 2: Render the Edit column in `renderGrid`**

Replace the whole `renderGrid` function (lines 79-95) with:

```js
function renderGrid(formEl) {
  const grid = formEl.querySelector('[data-dt-grid]');
  const st = formEl._dt;
  if (!grid || !st) return;
  const sel = st.selected;
  const cell = (row, col, text) => {
    const tag = row === -1 ? 'th' : 'td';
    const cls = 'mb-dt-cell'
      + (row === -1 ? ' mb-dt-cell--header' : '')
      + (sel && sel.row === row && sel.col === col ? ' mb-dt-cell--selected' : '');
    return `<${tag} class="${cls}" data-dt-cell-at="${row}:${col}">${cellPreview(text)}</${tag}>`;
  };
  // Right-most Edit column — one button per row (incl. the header, row -1).
  const editCell = row => {
    const tag = row === -1 ? 'th' : 'td';
    const cls = 'mb-dt-edit-cell' + (row === -1 ? ' mb-dt-cell--header' : '');
    const label = row === -1 ? 'header' : `row ${row + 1}`;
    return `<${tag} class="${cls}"><button type="button" class="mb-dt-edit-btn" data-edit-table-row="${row}" title="Edit ${label}"><span class="more-buttons-icon">edit</span></button></${tag}>`;
  };
  grid.innerHTML =
    `<thead><tr>${st.header.map((h, c) => cell(-1, c, h)).join('')}${editCell(-1)}</tr></thead>` +
    `<tbody>${st.rows.map((r, ri) => `<tr>${r.map((v, c) => cell(ri, c, v)).join('')}${editCell(ri)}</tr>`).join('')}</tbody>`;
  refreshControls(formEl);
}
```

- [ ] **Step 3: Add the Edit-button branch to the grid click handler**

In `wireTableEditor`, find the start of the `click` listener (lines 217-219):

```js
  formEl.addEventListener('click', e => {
    const cellEl = e.target.closest('[data-dt-cell-at]');
    if (cellEl) {
```

Insert the Edit-button branch **before** the `cellEl` lookup, so it reads:

```js
  formEl.addEventListener('click', e => {
    const editRow = e.target.closest('[data-edit-table-row]');
    if (editRow) {
      beginChildNavigation(formEl, { type: 'edit-table-row', row: parseInt(editRow.dataset.editTableRow, 10) });
      return;
    }
    const cellEl = e.target.closest('[data-dt-cell-at]');
    if (cellEl) {
```

- [ ] **Step 4: Add `saveDataTableForRow` and attach the saver in both openers**

In `scripts/dataTablesEditor.js`, find `saveDataTable` (line 381). Insert this **immediately after** the end of `saveDataTable` (after its closing `}` on line 389):

```js

// The grid form is the PARENT of the per-row form. The save-gate calls this to
// persist (create → splice + transition; edit → whole-table rewrite) before
// opening a row child, so the table always has a uuid in the file by then.
async function saveDataTableForRow(formEl, onProgress) {
  const res = await saveDataTable(formEl, onProgress);
  if (!res) return null;
  return { container: { kind: 'table', uuid: res.uuid, file: res.file }, formEl };
}
```

In `openCreateDataTable`, find (lines 274-275):

```js
  formEl.dataset.tableUuid = '';
  formEl.dataset.containerFile = container.file;
```

Add immediately after:

```js
  formEl.dataset.componentNoun = 'data table';
  formEl._componentSaver = () => saveDataTableForRow(formEl);
```

In `openEditDataTable`, find (lines 308-309):

```js
  formEl.dataset.tableUuid = uuid;
  formEl.dataset.containerFile = file;
```

Add immediately after:

```js
  formEl.dataset.componentNoun = 'data table';
  formEl._componentSaver = () => saveDataTableForRow(formEl);
```

- [ ] **Step 5: Verify the module still loads**

Run: `node --check scripts/dataTablesEditor.js`
Expected: no output (syntax OK).

- [ ] **Step 6: Manual smoke test (browser)**

Reload the extension at `chrome://extensions`. Open a guide, edit a section containing (or insert) a data table to open the grid form. Verify:
- A right-most **Edit** column shows a pencil button on every body row and on the header row.
- Clicking a body row's Edit button: in create mode it prompts "This data table hasn't been saved yet. Save it to continue?" → Save → the per-row form opens with column tabs; in edit mode it opens directly.
- The tab labels are the column titles; switching tabs swaps the cell shown.
- The below-grid editor still works (not yet removed) — that's expected at this step.

- [ ] **Step 7: Commit**

```bash
git add scripts/dataTablesEditor.js
git commit -m "feat(dataTables): grid Edit column + save-gate into per-row form"
```

---

## Task 5: Remove the below-grid single-cell editor

**Files:**
- Modify: `config/forms/editDataTable.html` (remove alignment + cell form-groups)
- Modify: `scripts/dataTablesEditor.js` (remove `loadSelectedCell`, `editingLabel`, `setAlign`, the grid `input` listener, the grid align-click branch, the alignment toggle in `refreshControls`, and the now-dead `loadSelectedCell` calls)

Cells now only select (driving the structure bar); all content editing happens in the per-row form.

- [ ] **Step 1: Strip the cell editor from the grid HTML**

In `config/forms/editDataTable.html`, delete lines 19-31 (the Alignment form-group and the Cell form-group), i.e. remove this block:

```html

  <div class="more-buttons-form-group">
    <label class="more-buttons-label">Alignment</label>
    <div class="mb-dt-align">
      <button type="button" class="more-buttons-tab" data-dt-align="left">Left</button>
      <button type="button" class="more-buttons-tab" data-dt-align="center">Center</button>
      <button type="button" class="more-buttons-tab" data-dt-align="right">Right</button>
    </div>
  </div>

  <div class="more-buttons-form-group">
    <label class="more-buttons-label" data-dt-editing>Cell</label>
    <textarea data-dt-cell rows="2" data-richtext="inline" placeholder="Inline markdown"></textarea>
  </div>
```

The `<input type="hidden" name="tableState" />` and the form-actions block remain.

- [ ] **Step 2: Remove the grid `input` listener and the align-click branch**

In `wireTableEditor`, delete the entire `input` listener (lines 201-215):

```js
  formEl.addEventListener('input', e => {
    if (!e.target.matches?.('[data-dt-cell]')) return;
    const st = formEl._dt;
    setCellAt(st, st.selected.row, st.selected.col, e.target.value);
    // Live-update just the selected cell's preview — a full grid re-render
    // here would be wasteful (the editor keeps focus either way).
    const cellEl = formEl.querySelector(`[data-dt-cell-at="${st.selected.row}:${st.selected.col}"]`);
    if (cellEl) cellEl.innerHTML = cellPreview(e.target.value);
    if (st.selected.row === -1) {
      const label = formEl.querySelector('[data-dt-editing]');
      if (label) label.textContent = editingLabel(st); // header rename renames the label
    }
    syncTableState(formEl);
    formEl._refreshSaveState?.();
  });

```

In the `click` listener, delete the align-click branch (lines 232-233):

```js
    const alignBtn = e.target.closest('[data-dt-align]');
    if (alignBtn) { setAlign(formEl, alignBtn.dataset.dtAlign); return; }
```

- [ ] **Step 3: Drop `loadSelectedCell` from the cell-select branch**

In the same `click` listener, the cell-select branch currently reads:

```js
    const cellEl = e.target.closest('[data-dt-cell-at]');
    if (cellEl) {
      const [row, col] = cellEl.dataset.dtCellAt.split(':').map(n => parseInt(n, 10));
      formEl._dt.selected = { row, col };
      renderGrid(formEl);
      loadSelectedCell(formEl);
      return;
    }
```

Remove the `loadSelectedCell(formEl);` line so it becomes:

```js
    const cellEl = e.target.closest('[data-dt-cell-at]');
    if (cellEl) {
      const [row, col] = cellEl.dataset.dtCellAt.split(':').map(n => parseInt(n, 10));
      formEl._dt.selected = { row, col };
      renderGrid(formEl);
      return;
    }
```

- [ ] **Step 4: Remove `loadSelectedCell` from `afterStructureChange` and the openers**

In `afterStructureChange` (lines 134-140), remove the `loadSelectedCell(formEl);` line:

```js
function afterStructureChange(formEl) {
  clampSelection(formEl._dt);
  renderGrid(formEl);
  syncTableState(formEl);
  formEl._refreshSaveState?.();
}
```

In `openCreateDataTable`, remove the `loadSelectedCell(formEl);` line (currently line 284), leaving:

```js
  wireTableEditor(formEl);
  renderGrid(formEl);
  syncTableState(formEl);
  resetDirtyBaseline(formEl);
```

In `openEditDataTable`, remove the `loadSelectedCell(formEl);` line (currently line 318), leaving the same four-line tail.

- [ ] **Step 5: Delete the now-unused `editingLabel`, `loadSelectedCell`, and `setAlign` helpers, and the alignment toggle**

Delete `editingLabel` (lines 115-119) and `loadSelectedCell` (lines 122-130) entirely.

Delete `setAlign` (lines 190-194) entirely.

In `refreshControls`, delete the alignment-toggle loop (lines 110-112):

```js
  formEl.querySelectorAll('[data-dt-align]').forEach(btn => {
    btn.classList.toggle('--active', st.align[sel.col] === btn.dataset.dtAlign);
  });
```

(The `const sel = st.selected;` line above it stays — it's still used by the disable checks.)

- [ ] **Step 6: Verify the module still loads and nothing dangling references the removed helpers**

Run: `node --check scripts/dataTablesEditor.js`
Expected: no output.

Run: `grep -n "loadSelectedCell\|editingLabel\|setAlign\|data-dt-editing" scripts/dataTablesEditor.js config/forms/editDataTable.html`
Expected: no matches (all references removed).

- [ ] **Step 7: Commit**

```bash
git add scripts/dataTablesEditor.js config/forms/editDataTable.html
git commit -m "refactor(dataTables): remove below-grid cell editor; cells select-only"
```

---

## Task 6: Style the Edit column, button, and row tab strip

**Files:**
- Modify: `config/forms/formsStyling.css` (after the `.mb-dt-align` rule, line 2246)

- [ ] **Step 1: Append the new rules**

In `config/forms/formsStyling.css`, find the `.mb-dt-align` rule (lines 2242-2246):

```css
/* Segmented Left / Center / Right control (reuses .more-buttons-tab look). */
.mb-dt-align {
  display: inline-flex;
  gap: 2px;
  border-bottom: 1px solid var(--mb-border-subtle);
}
```

Insert immediately after its closing `}`:

```css

/* Right-most per-row Edit column in the grid. */
.mb-dt-edit-cell {
  border: 1px solid var(--mb-border-subtle);
  width: 1%;
  white-space: nowrap;
  text-align: center;
  padding: 2px 6px;
}

.mb-dt-edit-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: none;
  background: none;
  color: var(--mb-text-muted);
  cursor: pointer;
  border-radius: 4px;
}

.mb-dt-edit-btn:hover {
  background: rgba(127, 127, 127, 0.12);
  color: var(--mb-text);
}

/* Column tab strip on the per-row editor. */
.mb-dtr-tabs {
  margin-bottom: 14px;
}
```

- [ ] **Step 2: Commit**

```bash
git add config/forms/formsStyling.css
git commit -m "style(dataTables): edit column, edit button, row tab strip"
```

---

## Task 7: Full manual verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the primitive regression tests**

Run: `node --test tests/dataTables.test.mjs`
Expected: PASS (the markdown primitives are untouched; this guards against accidental breakage).

Run: `node --test tests/*.test.mjs`
Expected: PASS across the suite.

- [ ] **Step 2: Reload and verify the create flow**

Reload at `chrome://extensions`. In a guide section, insert a new data table.
- Add a couple of rows/columns via the structure bar (clicking a cell first to select where).
- Click a body row's **Edit** → confirm the save prompt → the per-row form opens with one tab per column.
- Type rich text (bold/italic/link/code) in a cell; switch tabs and edit another column; set alignment.
- **Save to draft** → returns to the grid; the edited cells show their rendered previews.

- [ ] **Step 3: Verify header editing**

- Click the **header row's** Edit button → heading reads "Edit header".
- Rename a column in its tab → the active tab label updates live.
- Save → back on the grid the header cell shows the new title; re-open any body row's Edit and confirm its tab labels reflect the rename.

- [ ] **Step 4: Verify structure ops + selection still work**

- On the grid, click a data cell → it highlights (selection); the structure bar's Row up/down, Delete row, Column left/right, Delete column enable/disable correctly and operate on the selection.
- Add/delete a column, then open a row's Edit → the tab set matches the new columns.

- [ ] **Step 5: Verify alignment round-trips**

- Set a column to Center in a row's Edit tab, Save. Re-open: the alignment buttons show Center lit. Confirm the saved markdown divider row reflects the alignment (e.g. `:---:`).

- [ ] **Step 6: Verify back-navigation / replay**

- Grid → Edit a row → make an edit but **don't** save → click the breadcrumb back to the grid → Edit the same row again: the in-flight edit is preserved (storage buffer).
- Delete the whole table from the grid's Delete button → confirm it's removed and the editor closes.

- [ ] **Step 7: Final commit (if any verification fixes were needed)**

Only if Steps 2-6 surfaced fixes:

```bash
git add -A
git commit -m "fix(dataTables): per-row editing verification fixes"
```

---

## Self-review notes (spec coverage)

- Grid Edit column + select-only cells + structure bar unchanged → Tasks 4, 5.
- Per-row form: column tabs, alignment, rich textarea, header-title editing with live rename → Tasks 2, 3.
- Navigation via save-gate (create→edit transition handled) → Tasks 1, 4 (`_componentSaver`).
- Shared state + storage buffer + dirty-guard, no new storage concept → reuses `formEl._dt` / `seedStorage` / `tableState` (Tasks 3, 4).
- Per-screen whole-table save (§3) → grid keeps `submitEditDataTable`; row form adds `submitEditDataTableRow` → `persistDataTableEdit` (Task 3).
- No manifest change (no new script; `config/forms/*` already web-accessible) → Reference section.
- Styling → Task 6. Testing → Task 7 (+ regression run).
