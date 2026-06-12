# Data Tables Component — Design

**Date:** 2026-06-12
**Status:** Approved

## Summary

Add a 4th component kind, **Data tables**, alongside admonitions, captures, and
content tabs. A data table is a standard markdown pipe table (zensical
`tables` extension) carrying the usual hidden UUID identity span. The new/edit
form shows the whole table as a clickable grid with a single shared rich text
editor below it for the selected cell; cells hold inline markdown only.

Reference: https://zensical.org/docs/authoring/data-tables/

## Markdown model

A data table in guide markdown:

```markdown
<span data-uuid="..." style="display:none"></span>
| Method | Description |
| :----- | :---------- |
| `GET`  | Fetch resource |
| `PUT`  | Update resource |
```

- **Identity:** UUID span on the line immediately before the header row — same
  placement rule as a content tabs group span.
- **Alignment:** per column, serialized in the divider row (`:---` left,
  `:---:` center, `---:` right). A column with no colons parses as `left` and
  is rebuilt as `:---` (explicit left).
- **Cells:** inline markdown only — bold, italic, code, highlight, links,
  icons. No line breaks, no block content. Literal `|` inside a cell is
  escaped `\|` on build and unescaped on parse.
- **Indentation:** tables may sit indented inside admonitions / tabs / sections;
  the common indent is captured like other kinds and re-applied on build.
- Tables are **not** component containers: nothing nests inside a cell. No
  `registerComponentContainer` entry is needed.
- **Save model:** whole-table last-write-wins (same v1 trade-off as content
  tabs groups). Edits re-read the markdown fresh, replace the table block by
  UUID, write back.

### Parsed shape

```js
{ uuid, indent, align: ['left','center','right',...],
  header: ['Method','Description'],
  rows: [['`GET`','Fetch resource'], ...],
  startLine, endLine }  // startLine = span line; endLine = last row
```

`header.length === align.length === rows[i].length` is normalized on parse
(short rows padded with '', long rows truncated on build — parser is lenient,
builder is strict).

## New leaf module: `scripts/dataTables.js`

Pure parsing/building, no DOM, no import cycles (may import UUID helpers from
`admonitions.js` like `contentTabs.js` does). Mirrors the contentTabs surface:

- `locateDataTables(md)` → array of parsed tables (with line ranges)
- `buildDataTable(uuid, indent, align, header, rows)` → markdown block string
- `locateDataTableByUUID(md, uuid)` / `getDataTableByUUID(md, uuid)`
- `replaceDataTableByUUID(md, uuid, newBlock)`
- `deleteDataTableByUUID(md, uuid)`
- `ensureDataTableUUIDs(md)` → backfills spans before any bare table
- Cell escaping helpers (`escapeCell` / `unescapeCell`)

**Parse rule:** a table is a run of ≥2 consecutive lines starting `|` (after
indent) where line 2 is a valid divider row (`|? *:?-{1,}:? *(\||$)` cells).
Lines starting `|` that don't form a valid header+divider pair are left alone.

## Form: `config/forms/editDataTables.html` + `scripts/dataTablesEditor.js`

Follows the content tabs form conventions exactly:

- `data-nav data-dirty-guard data-storage-key="moreButtonsEditDataTables"`,
  `data-width="90vw" data-height="90vh"`.
- **All visible inputs are unnamed** (cell selection / grid interaction must
  not false-dirty the form). One hidden `<input name="tableState">` holds the
  serialized `{ align, header, rows }` JSON for dirty tracking via
  `readFormValues()`.
- Standard action row: save button with `data-save-state` /
  `data-saved-label="Draft saved"` / `data-unsaved-label="Save to draft"`,
  plus a danger Delete button. Labels registered in `form.js`
  (`editDataTables: 'Edit Data Table'`).

### Layout (top to bottom)

1. **Heading** — "New data table" / "Edit data table".
2. **Grid** — the table rendered as clickable cells. Header row visually
   distinct. Cell previews render their inline markdown via the existing
   `renderDocHtml` so `**bold**` / `` `code` `` display formatted. Clicking a
   cell selects it (highlight ring). Empty cells show a dim placeholder.
3. **Structure controls** — secondary-button row (reuses the `mb-ct-manage`
   pattern): Add row, Add column, Move row up/down, Move column left/right,
   Delete row, Delete column. Move/delete act on the selected cell's
   row/column. Deleting the last row or column is blocked (a table is minimum
   1×1 plus header). Deleting a header cell's "row" is not offered (header row
   is fixed; its cells are editable, the row itself can't move or be deleted).
4. **Alignment** — segmented Left / Center / Right control, visible when a
   cell is selected; sets the selected cell's **column** alignment.
5. **Cell editor** — label "Editing: Row 2 · Description" (or "Header ·
   Method") above one `data-richtext` textarea upgraded in **inline mode**
   (below). Typing live-updates the selected cell's grid preview and the
   hidden `tableState`. Selecting a different cell commits the current value
   and loads the new cell.
6. **Actions** — Save to draft / Delete.

### Create flow

`openCreateDataTables({ container, insertAt })` seeds a starter table:
2 columns × 2 body rows, headers "Column 1" / "Column 2", all left-aligned —
the grid is never empty. Persisting a new table splices the built block into
the parent container at the insert index (same as `persistNewTabsGroup`).

### State

`formEl._dt = { uuid, file, container, mode, selected: {row, col} | null,
align, header, rows }` — mirrored into the hidden `tableState` input on every
mutation. Storage-seeded via the opener (chrome.storage.local) with
markdown-as-fallback hydration, like content tabs.

## Rich editor inline mode

`upgradeTextarea(textarea, { inline: true })` — a small opt-in extension to
`scripts/richTextEditor.js`:

- Omits the list and indent toolbar buttons (cells can't hold blocks).
- Blocks Enter (keydown preventDefault in both Rich and Markdown views).
- Strips newlines (→ single space) from pasted text.
- Everything else — marks, link popover, armed formatting, Rich/Markdown
  tabs — unchanged.

Default behaviour without the flag is byte-for-byte identical; existing call
sites untouched. Note: `richTextEditor.js` currently carries uncommitted
nested-lists changes (manual verification pending); this work builds on top of
that working-tree state.

## Integration checklist

- `scripts/components.js` — import; parse data tables in `parseComponents()`
  (with range exclusion); `buildComponentBody()` branch `kind === 'table'`;
  `uuidOfComponent()` branch.
- `scripts/guides.js` — imports; `renderComponents()` card branch
  `dataTableCard(t)`: `mb-incident-card` with a distinct accent, badge
  "Table", title "Data table", description "3 columns × 4 rows"; edit button
  `data-edit-data-table="<uuid>"` delegate → `beginChildNavigation` type
  `'edit-table'`; `runChildAction()` branches for `kind:'table'` (create) and
  `type:'edit-table'`; insert-menu handler `dataTable: (i) => ...`;
  `openEditorForComponent()` dispatch for `kind === 'table'`; `noteLabels()`
  branch in **both** call sites (avoids the `c.cap.uuid` crash).
- `scripts/insertMenu.js` — `<button data-pick="data-table">Data table</button>`
  after Content tabs; dispatch to `handlers.dataTable?.(insertAtIndex)`.
- `scripts/systemUpdates.js` — `noteLabels()` branch.
- `scripts/github.js` — import `ensureDataTableUUIDs`; call it in **both**
  branches of `migrateComponentIdentity()` (guides and system-updates), after
  `ensureTabUUIDs` and before `ensureAdmonitionUUIDs` is fine — a pipe row
  can't be mistaken for an admonition or capture.
- `scripts/form.js` — `FORM_LABELS.editDataTables = 'Edit Data Table'`.
- `scripts/actions.js` — `import './dataTablesEditor.js';`
- `manifest.json` — add `scripts/dataTables.js` **and**
  `scripts/dataTablesEditor.js` to `web_accessible_resources` (individually;
  reload the extension after).
- `config/forms/formsStyling.css` — grid styles (`.mb-dt-grid`,
  `.mb-dt-cell`, `.mb-dt-cell--header`, `.mb-dt-cell--selected`,
  `.mb-dt-align`), reusing existing form tokens/colors.

## Testing

`tests/dataTables.test.mjs` (node test runner, like `contentTabs.test.mjs`):

- Parse/build round-trips: basic table, alignment variants, indented table,
  escaped pipes, ragged rows normalized.
- Non-tables ignored: `|`-prefixed lines without a divider row.
- UUID: `ensureDataTableUUIDs` backfill (idempotent), locate/replace/delete by
  UUID.
- Integration: `parseComponents()` returns tables interleaved with
  admonitions/captures/tabs in document order; `buildComponentBody()` rebuilds.
- Inline-mode editor: Enter blocked, paste newline-stripped, list buttons
  absent (jsdom test alongside existing richTextEditor tests if present,
  otherwise pure-transform coverage only).

## Zensical repo changes (APPLIED by user, 2026-06-12)

1. `[project.markdown_extensions.tables]` in `zensical.toml`.

2. Sortable tables (site-wide): tablesort entries added to `zensical.toml`
   `extra_javascript`, and the activation snippet lives at
   **`docs/assets/javascripts/tablesort.js`** (NOT `docs/javascripts/` — the
   user's repo keeps JS under `docs/assets/`):

   ```javascript
   document$.subscribe(function() {
     var tables = document.querySelectorAll("article table:not([class])")
     tables.forEach(function(table) {
       new Tablesort(table)
     })
   })
   ```

   `:not([class])` is the per-table opt-out: any table given an explicit CSS
   class is skipped by the sorter.

## Out of scope (v1)

- Captions on tables (zensical docs don't cover them for tables).
- Per-table sortable toggle in the form (sortable is site-wide).
- Cell-level UUIDs / merge granularity below whole-table LWW.
- Block content or line breaks inside cells.
- Column width control.
