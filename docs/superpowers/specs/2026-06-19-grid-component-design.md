# Grid component — design spec

**Date:** 2026-06-19
**Status:** Approved design, pre-implementation
**Author:** brainstorming session (ollie + Claude)

## 1. Goal

Add a 5th knowledge-base component kind, **`grid`**, alongside the existing four
(`admonition`, `capture`, `tabs`/content-tabs, `table`/data-table). A grid is a
[Zensical grid](https://zensical.org/docs/authoring/grids/): an auto-flowing
list of cells/cards that the CSS lays out into as many columns as fit the
viewport. It must be insertable into every place the other components are
(guide sections, admonitions, content-tab cells, data-table cells, system
updates), edited via an overlay form, and saved as markdown ("markdown as
truth").

This is an **additive clone** of existing patterns — no new UI paradigms. The
content-tabs component is the structural template.

## 2. Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Grid flavors | **Both**, via a grid-level toggle: **Card** (`.card` cells, hover chrome) and **Generic** (plain cells). |
| D2 | Cell content model | **Full component container** — each cell holds a rich-text description + an ordered list of nested components (admonitions, captures, content-tabs, tables), exactly like a content-tab. |
| D3 | Dimensionality | **1-D ordered list of cells.** A Zensical grid auto-flows; the author does not lay out a 2-D matrix. Clone the content-tabs *strip*, not the data-table 2-D toolbar. |
| D4 | Editor-hop | **On.** Inserting a grid opens the grid editor immediately (like tabs/table; unlike captures). |
| D5 | Save model | **Whole-grid last-write-wins** (a dynamic cell list cannot be a flat `mergeSave` field). Each save re-reads every surviving cell's components from fresh markdown so immediate-save children (captures) aren't clobbered. Mirrors `persistTabsEdit`. |
| D6 | `zensical.toml` extensions | `md_in_html` + `attr_list` are **already present** in the target KB's toml. Document the assumption; **no `navToml.js` change**. |
| D7 | Markdown encoding | **`<div>`-wrapper per cell** (see §4). Rejected: native list / `{ .card }` syntax, because a single cell must hold multiple components. |

## 3. Mental model of the existing system (why this is a clone)

- There is **no central component-kind enum**. The four kinds exist only as
  parallel `if (c.kind === …)` branches across ~9 sites. Adding `grid` means
  adding one branch at each site + 2 new modules + 1 form + a manifest entry +
  an `actions.js` import. Miss a site → silent breakage (card won't render, Edit
  does nothing, paste loses identity, etc.).
- The one real registry, `componentContainers.js`, is keyed by **container
  kind** (`guide-section`, `guide-admonition`, `content-tab`, `data-table-cell`,
  `system-update`). A grid registers a new `grid-cell` container here because its
  cells hold their own component lists.
- Every whole-object component round-trips through `components.js`
  (`parseComponents` / `buildComponentBody` / `uuidOfComponent`), is rendered as
  a card by `guides.js` `renderComponents`, persists through the save-gate
  (`beginChildNavigation` → `_componentSaver`), and hops to its editor via
  `openEditorForComponent`.

## 4. Markdown encoding (D7)

Wrapper is always `<div class="grid" markdown>`; flavor lives in the cells.

**Card flavor:**
```
<span data-uuid="GRID-UUID" style="display:none"></span>
<div class="grid" markdown>

<div class="card" markdown>
<span data-uuid="CELL1-UUID" style="display:none"></span>

:material-clock-fast: __Set up fast__

---

Up and running in minutes

[:octicons-arrow-right-24: Start](#)

</div>

<div class="card" markdown>
<span data-uuid="CELL2-UUID" style="display:none"></span>

Cell two content…

</div>

</div>
```

**Generic flavor:** identical, but each cell is `<div markdown>` (no `card`
class). Material styles `.grid > .card` as a card, so the only difference
between flavors is the per-cell `card` class.

### Identity convention (non-negotiable)
- **Grid identity:** hidden `<span data-uuid="…" style="display:none"></span>`
  on the line immediately *before* `<div class="grid" markdown>`, at the same
  indent (mirrors the content-tab group span).
- **Cell identity:** hidden span as the *first body line inside* the cell div,
  followed by a blank line, then the cell content (mirrors `injectTabUUID` —
  the trailing blank stops a capture's "span immediately before the image"
  reader from stealing the cell's identity).

### Parsing note
Cell content is markdown inside a `<div markdown>` block (`md_in_html`), so —
unlike content-tab bodies — it is **not** indented +4. The cell container's
read/write is therefore simpler than tabs (no dedent/reindent). The genuinely
new complexity vs content-tabs: locating the wrapper's matching `</div>` and the
per-cell `</div>`s requires **`<div>` depth-counting** (a grid may be nested
inside a cell). This is the riskiest new code and will be built test-first.

### Flavor round-trip
`flavor` is derived on parse from whether cells carry the `card` class
(card ⇔ at least one `.card` cell; generic otherwise) and re-applied uniformly
on build. The editor holds one `flavor` value for the whole grid.

## 5. New module: `scripts/grid.js` (leaf serializer)

Clone of `scripts/contentTabs.js`. **Must NOT import `components.js`** (cycle —
cell bodies are opaque strings at this layer). Imports only `generateUUID` from
`admonitions.js`.

Exports:
- `locateGrids(markdown)` → `[{ uuid, flavor, indent, cells: [{ uuid, body }], startLine, endLine }]`
- `buildGrid(uuid, flavor, cells)` → markdown (inverse of one grid; cells provide pre-built bodies via `buildComponentBody`, which embeds each cell's own span)
- `getGridByUUID(md, uuid)`, `replaceGridByUUID(md, uuid, newBlock)`, `deleteGridByUUID(md, uuid)`
- `ensureGridUUIDs(md)` — idempotent recursive backfill; reverse-order splice; returns the same reference when nothing changed
- A `GRID_OPEN_RE` / cell-open regex

## 6. New module: `scripts/gridEditor.js`

Clone of `scripts/contentTabsEditor.js`. Differences from content-tabs:
1. **No per-cell Title** — drop the title input; strip buttons render "Cell N".
2. **Flavor toggle** — a grid-level Card/Generic radio, mirrored into
   `gridState`; `buildGrid` applies it to all cells.
3. **Default 2 cells** on create (a 1-cell grid is pointless; still allowed via
   delete down to 1, with the same "needs at least one cell — use Delete to
   remove the whole grid" guard as tabs).

Reused verbatim (renamed): `_grid` state object mirrored to one hidden named
`gridState` JSON input; per-cell visible inputs **unnamed** (no false-dirty on
cell switch); `installRefreshHook` order-sync; the add/move/delete-cell
management; the active-cell component mount via `setOpenComponentEditor`;
`makeContainerHandler` + `spliceIntoContainer`.

Registers:
- `registerComponentContainer('grid-cell', makeContainerHandler(readGridCellComponents, writeGridCellBody, gridCellExists))`
- form actions `openCreateGrid`, `openEditGrid`, `submitEditGrid`, `deleteGrid`
- `saveGridForComponent(formEl)` as `_componentSaver`, returning `{ container, formEl }` where `container` is the active cell.

Persistence: `persistNewGrid` (→ `spliceIntoContainer` with
`{ kind: 'grid', grid: { uuid, flavor, cells } }`) → `transitionGridCreateToEdit`
(`replaceCurrentOpener('openEditGrid', …)`); `persistGridEdit` (whole-grid
rewrite via `replaceGridByUUID` + `buildGrid`, re-reading each cell's components
from fresh md). New container helpers `readGridCellComponents` /
`writeGridCellBody` / `gridCellExists` live in `components.js` next to the tab
equivalents (`readTabComponents` etc.) — but with **no** +4 dedent/reindent,
since cell bodies sit at the grid's indent inside `<div markdown>`.

## 7. New form: `config/forms/editGrid.html`

Clone of `editContentTabs.html`:
```
<form data-nav data-dirty-guard id="edit-grid-form"
      data-storage-key="moreButtonsEditGrid" data-width="90vw" data-height="90vh">
  <h2 data-grid-heading>Edit grid</h2>

  <!-- flavor toggle: Card / Generic radios -->
  <!-- cell strip (data-grid-strip) + add cell -->
  <!-- manage: move left / move right / delete cell -->
  <!-- Description (data-grid-description, data-richtext) -->
  <!-- Components list (data-grid-cell-components) in [data-components-row] -->
  <input type="hidden" name="gridState" />
  <!-- actions: submitEditGrid (data-save-state) + deleteGrid (data-delete-grid-btn) -->
</form>
```
No manifest edit needed for the form (`config/forms/*` is wildcard-served).
Follows MEMORY conventions: horizontal label-left form groups; actions block is
relocated by `form.js` to the overlay-content wrapper, so action controls are
delegated on `formEl.parentElement`.

## 8. Edit sites (each adds one `grid` branch)

All line numbers verified against the live source on 2026-06-19.

1. **`scripts/components.js`**
   - import `{ locateGrids, buildGrid, ensureGridUUIDs }` from `./grid.js`
   - `parseComponents` (~:154–182): locate grids (`indent === ''`, not in an
     admonition range), add `{ kind: 'grid', grid }` to `items`, strip-down branch
   - `buildComponentBody` (~:233–248): `else if (c.kind === 'grid') lines.push(buildGrid(c.grid.uuid, c.grid.flavor, c.grid.cells))`
   - `uuidOfComponent` (~:276–281): `if (c.kind === 'grid') return c.grid.uuid`
   - `parsePastedComponents` ensure-chain (:312): add `ensureGridUUIDs`, **before** `ensureCaptureUUIDs`/`ensureDataTableUUIDs` (a capture/table span as a cell's first body line would otherwise be misread as the cell's identity)
   - add `readGridCellComponents` / `writeGridCellBody` / `gridCellExists`
2. **`scripts/guides.js`**
   - `onComponentEditorClick`: `[data-edit-grid]` → `beginChildNavigation(formEl, { type: 'edit-grid', uuid })`; insert-menu handler `grid: (i) => beginChildNavigation(formEl, { type: 'insert', kind: 'grid', insertAt: i })`
   - `runChildAction`: insert branch `kind === 'grid'` → `openCreateGrid`; edit branch `type === 'edit-grid'` → `openEditGrid`
   - `openEditorForComponent`: `component.kind === 'grid'` → `openEditGrid`
   - `renderComponents` card switch: `c.kind === 'grid'` → `gridCard(c.grid)`; add `gridCard` (clone `dataTableCard`, badge "Grid", accent `--teal`, `data-edit-grid` + `data-copy-component-md`)
   - **both** conflict-resolver label maps (`saveSectionForComponent` ~:1278, `persistAdmonitionEdit` ~:1690): `else if (c.kind === 'grid') labelMap[c.grid.uuid] = { kind: 'admonition', title: 'Grid' }`
   - `CONTAINER_NOUN` (~:931): `'grid-cell': 'cell'`
3. **`scripts/insertMenu.js`** — menu item `data-pick="grid"` (Grid), `pick()` branch, `handlers.grid` JSDoc
4. **`scripts/form.js`** — `FORM_LABELS.editGrid = 'Edit Grid'`
5. **`scripts/actions.js`** — `import './gridEditor.js';`
6. **`manifest.json`** — add `"scripts/grid.js"` and `"scripts/gridEditor.js"` to `web_accessible_resources`
7. **`scripts/github.js`** — add `ensureGridUUIDs` to **both** `migrateComponentIdentity` chains (guide markdown + `system-updates.md`), ordered per the rule above
8. **`scripts/systemUpdates.js`** — label-map branch for `grid` (grids inside system-update bodies)

## 9. Risks & gotchas (carried from the architecture map)

- **Manifest reload mandatory.** New scripts must be in `manifest.json` *and*
  imported in `actions.js`; reload the unpacked extension at `chrome://extensions`
  after the manifest change, or "Failed to fetch dynamically imported module".
- **`grid.js` must stay a leaf** — no `components.js` import.
- **UUID ensure-chain ordering** — `ensureGridUUIDs` before captures/tables.
- **Two conflict-resolver label maps** — miss either and grids inside
  sections vs admonitions show a blank label in the order-conflict resolver.
- **Whole-grid save can clobber immediate-save children** unless each cell's
  current components are re-read from fresh markdown on save (clone
  `persistTabsEdit`), with a live re-hydrate after a child commit.
- **Save-gate participation is not optional** — both openers set
  `formEl._componentSaver`; every child click routes through
  `beginChildNavigation`.
- **`<div>` depth-counting** in the parser is the one piece without a direct
  line-prefix precedent — TDD it against nested-grid and capture-in-cell cases.

## 10. Testing

Test-first for `grid.js` (pure, no DOM): build→parse round-trip; `locateGrids`
on top-level and nested grids; identity backfill idempotency; depth-counting
with a grid nested in a cell and a capture as a cell's first content; flavor
detection both ways; `getGridByUUID` / `replaceGridByUUID` / `deleteGridByUUID`.
Then manual smoke test per the checklist: insert → editor hop → save → reopen
(re-parse) → copy/paste round-trip (UUIDs backfilled, not duplicated) → reorder
rails → insert a capture and an admonition into a cell and confirm both survive a
subsequent whole-grid save → flavor toggle changes rendered output.

## 11. Total edit surface

2 new scripts (`grid.js`, `gridEditor.js`), 1 new form (`editGrid.html`), edits
to 8 existing files (`components.js`, `guides.js`, `insertMenu.js`, `form.js`,
`actions.js`, `manifest.json`, `github.js`, `systemUpdates.js`). No
`navToml.js` change (D6).
