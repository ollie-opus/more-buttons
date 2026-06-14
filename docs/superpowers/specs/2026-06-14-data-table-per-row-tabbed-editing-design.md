# Data table: per-row tabbed editing

**Date:** 2026-06-14
**Status:** Approved design, ready for implementation plan

## Problem

The edit-data-table form currently couples a clickable grid to a single shared
cell editor below it. You click any grid cell and it loads that one cell into an
alignment control + a rich-text textarea below the grid. Editing one cell at a
time, in a control that sits apart from the table, feels fiddly.

## Goal

Edit a table **per row** instead of per cell, in a dedicated form away from the
grid:

- The grid gains a right-most **Edit** column with a per-row Edit button.
- Clicking a row's Edit button navigates to a child form whose **tabs are the
  columns**; each tab holds that row's cell editor (alignment + rich text).
- The header row also gets an Edit button; its form edits the **column titles**.

This is a presentation/interaction change. The markdown format, parsing
(`dataTables.js`), persistence path, and storage-replay buffer are unchanged.

## Precedent

`scripts/contentTabsEditor.js` already implements the exact pattern this needs: a
dynamically rendered tab strip (`renderStrip` / `[data-ct-tab]`) plus a per-tab
editing body, backed by an in-memory `formEl._ct` object mirrored to a hidden
JSON input and a `chrome.storage.local` replay buffer. The new per-row form
mirrors it closely. Where this spec is silent on a mechanism, follow how
`contentTabsEditor.js` and the existing `dataTablesEditor.js` already do it.

## Non-goals

- No change to the table markdown format or `dataTables.js` primitives.
- No change to the structure button-bar's behaviour (it still acts on the
  selected cell — see below).
- No change to the create flow's overall shape (create still opens the grid
  form; per-row editing is reachable once the table exists / has cells).
- No new storage concept. Reuse the existing `formEl._dt` + `seedStorage` /
  `initStateFromStorage` + hidden `[name="tableState"]` machinery.

---

## Design

### 1. The grid form (`config/forms/editDataTable.html`, `renderGrid`)

The grid keeps its inline markdown previews and gains one new right-most column,
header label **"Edit"**. Every row renders an Edit button (`✎`) in that column,
**including the header row** (the header's Edit button sits in the `<thead>` Edit
cell).

- **Per-row Edit button markup:** each Edit cell contains
  `<button data-edit-table-row="<rowIndex>">` where `rowIndex` is `-1` for the
  header row and `≥0` for body rows (matching the existing `cellAt` row
  convention). Use a button styled like the existing icon buttons; the new
  "Edit" header cell is not itself selectable.

- **Cells stay clickable, but only to *select*.** Clicking a body/header data
  cell still sets `formEl._dt.selected = {row, col}` and re-renders the grid with
  the selection highlight, exactly as today. Selection continues to drive the
  below-grid structure bar. The only removed behaviour is loading the clicked
  cell into a below-grid editor — that editor no longer exists on this form.
  Clicks on the Edit column do **not** change selection; they navigate.

- **Removed from `editDataTable.html`:** the below-grid cell editor block — the
  `Alignment` form-group (`[data-dt-align]` buttons), the `[data-dt-editing]`
  label, and the `<textarea data-dt-cell>`. All of that moves to the per-row
  form. The hidden `[name="tableState"]` input and the structure button-bar stay.

- **Structure button-bar unchanged.** Add row / Add column / Row up·down /
  Column left·right / Delete row / Delete column keep acting on
  `formEl._dt.selected`. `refreshControls` keeps enabling/disabling them based on
  selection. Alignment is no longer surfaced here (it now lives in the per-row
  form tabs), so `setAlign` and the `[data-dt-align]` handling are removed from
  this form's wiring (the `setAlign` helper itself moves/serves the per-row
  form).

- **`wireTableEditor` changes:** remove the `input` handler that mirrored the
  below-grid textarea into the selected cell (no textarea on this form anymore)
  and the `[data-dt-align]` click branch. Add a click branch: if the target is
  `[data-edit-table-row]`, read the row index and start child navigation to the
  per-row form (see §4). Keep the cell-select click branch and the structure
  button branches. `loadSelectedCell` is removed from this form.

### 2. The per-row form (`config/forms/editDataTableRow.html` + `dataTablesEditor.js`)

A new child form, navigated to from the grid. It is parameterised by row index;
`row === -1` means the header row.

**Layout (mirrors `editContentTabs.html` + the old cell editor):**

- Heading: **"Edit row N"** for body rows (1-based N for human readability),
  **"Edit header"** when `row === -1`.
- A tab strip container `<div class="more-buttons-tab-list" data-dtr-strip>`,
  re-rendered from state: one `<button class="more-buttons-tab" data-dtr-tab="<colIndex>">`
  per column, labelled with the column title (`escapeHtml(header[col] || 'Column N')`),
  the active one carrying `--active`. Modelled on `contentTabsEditor.renderStrip`.
- A per-tab body (single shared body, swapped on tab change — not one panel per
  column):
  - An **Alignment** segmented control reusing the existing markup
    (`<div class="mb-dt-align">` with `[data-dt-align="left|center|right"]`).
  - The **rich-text textarea**: `<textarea data-dt-cell data-richtext="inline"
    rows="2" placeholder="Inline markdown">`, upgraded with
    `upgradeTextarea(textarea, { inline: true })` and refreshed via
    `syncSurfaceFromTextarea` on tab switch — identical to today's cell editor.
- Form actions: a **"Save to draft"** button
  (`data-action="submitEditDataTableRow" data-save-state`) and **no** delete
  button (deleting rows/columns stays on the grid's structure bar). `data-nav`,
  `data-dirty-guard`, and `data-storage-key="moreButtonsEditDataTable"` (shared
  with the grid form — same underlying state).

**State:** reuse `formEl._dt = { uuid, file, selected, align, header, rows }`.
On this form, `selected.row` is fixed to the row being edited (the navigation
arg); `selected.col` tracks the active tab. Switching tabs sets `selected.col`,
re-renders the strip's active state, and reloads the textarea + alignment for the
new column via the existing `loadSelectedCell` logic (moved/shared here).

**Editing semantics:**

- **Body row (`row ≥ 0`):** each tab edits `rows[row][col]` — that row's cell in
  the active column. `input` on the textarea calls `setCellAt(st, row, col, value)`,
  syncs `[name="tableState"]`, and refreshes the dirty/save state. No live grid
  preview is needed here (the grid is on the other screen); the grid re-renders
  from storage on back-navigation.
- **Header row (`row === -1`):** each tab's textarea edits `header[col]` — the
  column **title** itself. Typing live-updates that tab's own label (re-render
  the strip on input when `row === -1`), mirroring how content tabs renames a tab
  live.
- **Alignment** writes `align[col]` via `setAlign` regardless of which row's form
  you're in — it is a column-level property surfaced in every tab. The alignment
  buttons light the active value for `align[selected.col]` (existing
  `refreshControls`-style toggle).

### 3. State & save model

Both forms share **one source of truth**: the in-memory `formEl._dt` mirrored to
`[name="tableState"]` and the `chrome.storage.local` replay buffer
(`seedStorage` / `initStateFromStorage`), plus the markdown-in-file as the real
persisted truth on save. This is the same mechanism content tabs and the existing
data-table editor already use; nothing new is introduced.

Each screen **saves its own scope, and both rebuild the whole table** (matching
today's whole-table-rebuild + fetch-push):

- The **grid form** keeps its existing "Save to draft" for structure changes.
- The **per-row form** gets its own "Save to draft" → new
  `submitEditDataTableRow` action → reuses `persistDataTableEdit` (whole-table
  rebuild via `replaceDataTableByUUID`, fetch-and-push), then `seedStorage` +
  `resetDirtyBaseline` and **navigates back** to the grid. On replay the grid
  re-hydrates from storage and re-renders previews to reflect the edit.
- Each form keeps its own `data-dirty-guard` and `[data-save-state]` button.

Rationale for per-screen saving over a single grid-only saver: a per-row save
makes each edit feel committed and avoids returning the user to a silently-dirty
grid they must remember to save. The shared storage buffer keeps both screens
consistent across the hop.

### 4. Navigation & wiring

Follow the existing parent→child form pattern
(`beginChildNavigation` → `runChildAction`, used by `guides.js` for
`edit-table`):

1. **Grid Edit-button click** (`dataTablesEditor.js`, `wireTableEditor`):
   on `[data-edit-table-row]`, call
   `beginChildNavigation(formEl, { type: 'edit-table-row', uuid: formEl._dt.uuid,
   file: formEl._dt.file, row })`. Ensure `seedStorage` reflects current
   in-memory state before navigating (so any unsaved grid edits carry over).
2. **Route the action** by adding an `edit-table-row` branch to the existing
   `runChildAction` switch (wherever `edit-table` is handled):
   `await getFormAction('openEditDataTableRow')?.({ uuid, file: container.file, row })`.
3. **Register `openEditDataTableRow`** in `dataTablesEditor.js`, self-contained
   from `{ uuid, file, row }` (so form-stack replay can re-open it):
   fetch markdown → `getDataTableByUUID` → `createForm('editDataTableRow')` →
   set `formEl.dataset` (uuid/file/row) → `initStateFromStorage` (storage wins,
   markdown fallback) with `selected = { row, col: 0 }` → render strip + load
   active cell + wire → `resetDirtyBaseline`. Guard `seedStorage` with
   `!isFormReplay()` exactly as `openEditDataTable` / content tabs do.
4. **Register `submitEditDataTableRow`** (see §3): set the save button busy,
   `persistDataTableEdit`, refresh save state, then `navigateBack()`.
5. **Breadcrumb label:** add `editDataTableRow` to the form-label map so the back
   crumb reads sensibly (e.g. "Edit Data Table" → "Edit Row"). Confirm the exact
   label map location during implementation.
6. **No manifest change:** forms load by filename from `config/forms/*`, which is
   already web-accessible; no new `scripts/*.js` file is added (all logic lives in
   `dataTablesEditor.js`), so no `web_accessible_resources` edit is needed.

### 5. Styling (`config/forms/formsStyling.css`)

- New **Edit** grid column: a narrow column; the Edit button styled like existing
  icon buttons. The header's Edit cell is non-selectable (no hover/select
  affordance).
- The per-row tab strip reuses `.more-buttons-tabs` / `.more-buttons-tab-list` /
  `.more-buttons-tab` (and `--active`) — the same classes content tabs uses; no
  new tab CSS expected beyond minor spacing.
- The selection highlight (`.mb-dt-cell--selected`) stays for the grid's
  structure-targeting selection.

---

## Files touched

| File | Change |
|---|---|
| `config/forms/editDataTable.html` | Add Edit column to grid render contract; remove below-grid cell editor (alignment group, editing label, `data-dt-cell` textarea). Keep structure bar + hidden `tableState`. |
| `config/forms/editDataTableRow.html` | **New** form: heading, `[data-dtr-strip]` tab strip, alignment control, `data-dt-cell` rich textarea, Save-to-draft action. |
| `scripts/dataTablesEditor.js` | `renderGrid`: render Edit column + per-row Edit buttons (incl. header). `wireTableEditor`: remove textarea-input + below-grid align handling, add Edit-button → child-nav branch, keep select + structure. Add `openEditDataTableRow`, `submitEditDataTableRow`, a `renderRowStrip`, and row-form wiring (tab switch, cell load, alignment, header-title live-rename). Move/share `loadSelectedCell` + `setAlign` to serve the row form. |
| `runChildAction` host (`guides.js` or wherever `edit-table` is routed) | Add `edit-table-row` branch dispatching `openEditDataTableRow`. |
| Form-label map | Add `editDataTableRow` label for the breadcrumb. |
| `config/forms/formsStyling.css` | Edit-column + Edit-button styling; minor row-form spacing. |

## Testing

- **Grid render:** Edit column appears with a button per row and on the header;
  clicking a data cell still selects (highlights) and drives the structure bar;
  clicking Edit navigates without changing selection.
- **Body-row edit:** tabs show all column titles; switching tabs loads the right
  cell + alignment; rich-text edits + bold/italic/link/code persist; alignment
  change updates `align[col]`; Save-to-draft rebuilds the table and back-nav
  shows updated previews in the grid.
- **Header edit:** "Edit header" form edits column titles; renaming a column live
  updates its tab label and, after save, the grid header + every per-row form's
  tab labels.
- **Structure ops still work:** add/move/delete row & column from the grid bar
  operate on the selected cell as before; the Edit column tracks rows correctly
  after structure changes.
- **Replay/back:** navigating grid → row → back → row preserves in-flight edits
  via the storage buffer; dirty-guards behave per form; deleting the table clears
  storage.
- **Save-gate / persistence:** per-row save uses fetch-and-push whole-table
  rebuild; no regression versus the current edit save.
