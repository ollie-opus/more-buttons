/**
 * gridEditor.js — the "Grid" overlay for a grid component.
 *
 * Two forms:
 *
 *   • editGrid (PARENT) — a flavor toggle (Card / Plain) and a VERTICAL list of
 *     cell cards laid out like the component list: a "+ Insert cell" bar between
 *     every pair (Add cell / Paste cell markdown), an up/down rail per row, and
 *     Copy / Edit on each card. Rail reorder is a batch edit saved with the grid;
 *     Add / Paste commit immediately through the save-gate (Add then drills into
 *     the new cell's editor). The parent owns no cell content.
 *
 *   • editGridCell (CHILD) — edits ONE cell: rich content, spill, vertical
 *     alignment, that cell's Components list, and an immediate-commit Delete
 *     cell. Each cell is a component container ('grid-cell', uuid = the CELL's
 *     uuid), so admonitions, captures, content tabs, data tables and nested grids
 *     insert into it through the standard save-gate in guides.js.
 *
 * Save model (mirrors the data table): the whole grid is last-write-wins on
 * flavor + cell list. Both forms persist via persistGridEdit, which re-reads each
 * surviving cell's components from fresh markdown so a per-cell save never
 * clobbers a sibling. The two forms share state through ONE storage key
 * (`moreButtonsEditGrid`) → a hidden named input (`gridState`, JSON) for dirty
 * tracking; the child reads it on open, and on save seeds it back so the parent's
 * back-navigation re-render is correct. Visible per-cell inputs are UNNAMED, and
 * `nComponents` is a render-only card annotation kept out of `gridState`.
 *
 * Cell bodies live in `<div markdown>` (md_in_html, no +4 indent) so the
 * container read/write needs no dedent.
 */

import { registerFormAction, getFormAction } from './formActions.js';
import {
  createForm, replaceCurrentOpener, setCrumbLabel, isFormReplay, navigateBack,
  resetDirtyBaseline, setButtonBusy, snapshotButton, restoreButton,
} from './form.js';
import { readRepoText } from './repoClient.js';
import { githubFetchAndPushFile, fetchFileMigratingIdentity } from './github.js';
import { generateUUID, GUIDE_ADMONITION_TYPES_RE } from './admonitions.js';
import {
  parseComponents, buildComponentBody, uuidOfComponent, reorderComponents,
  readGridCellComponents, writeGridCellBody, gridCellExists,
  gridCellsMarkdown, parsePastedGridCells,
} from './components.js';
import { copySelectionOf, paintCopySelection, setShiftHeld } from './copySelection.js';
import { registerComponentContainer, getComponentContainer } from './componentContainers.js';
import { getGridByUUID, buildGrid, replaceGridByUUID, deleteGridByUUID } from './grid.js';
import {
  makeContainerHandler, spliceIntoContainer, renderComponents, onComponentEditorClick,
  setOpenComponentEditor, beginChildNavigation, flashButtonLabel,
} from './guides.js';
import { syncSurfaceFromTextarea, paintInlineAtoms } from './richTextEditor.js';
import {
  cardBodyBlock, applyCardClamps, toggleCardExpand, insertTriggerHtml, railRowHtml,
} from './cardRenderer.js';
import { openPopupMenu } from './insertMenu.js';
import { showFieldError } from './formValidation.js';

const STORAGE_KEY = 'moreButtonsEditGrid';

// Each CELL is a component container: children read and write through the
// registry like any other container.
registerComponentContainer('grid-cell', makeContainerHandler(readGridCellComponents, writeGridCellBody, gridCellExists));

// ── Editor state ──────────────────────────────────────────────────────────────
//
// formEl._grid = { gridUuid, file, active, flavor, cells: [{ uuid, description, order, spill, valign, nComponents }] }
//   - `active` is the EDITED cell in the child; always 0 in the parent (which has
//     no per-cell fields, so stashActiveCell / the content re-read are no-ops there).
//   - `spill` is the per-cell "allow spill" flag (→ class="spill" on the cell div).
//   - `valign` is the per-cell vertical alignment ('default'|'top'|'middle'|'bottom';
//     non-default → inline style="align-self: …" on the cell div).
//   - `nComponents` is a render-only card annotation; it is NOT persisted in gridState.

function newCell() {
  return { uuid: generateUUID(), description: '', order: null, spill: false, valign: 'default', nComponents: 0 };
}

function cellsFromGrid(grid) {
  return grid.cells.map(c => {
    const { description, components } = parseComponents(c.body, GUIDE_ADMONITION_TYPES_RE);
    return { uuid: c.uuid ?? generateUUID(), description, order: null, spill: !!c.spill, valign: c.valign ?? 'default', nComponents: components.length };
  });
}

// The slim cell shape that drives dirty tracking + cross-form storage. `nComponents`
// is deliberately excluded so a tile's component count never affects the form's
// dirty/persist state.
function slimCells(cells) {
  return cells.map(c => ({ uuid: c.uuid, description: c.description, order: c.order ?? null, spill: !!c.spill, valign: c.valign ?? 'default' }));
}

// Mirror the state into the single named input that drives dirty tracking.
function syncGridState(formEl) {
  const input = formEl.querySelector('[name="gridState"]');
  const st = formEl._grid;
  if (input) input.value = JSON.stringify({ flavor: st.flavor, cells: slimCells(st.cells) });
}

// Pull the active cell's visible (unnamed) field back into state. A no-op in the
// parent (no content field) — only the child carries the description textarea.
function stashActiveCell(formEl) {
  const st = formEl._grid;
  const c = st?.cells[st.active];
  if (!c) return;
  const desc = formEl.querySelector('[data-grid-description]');
  if (desc) c.description = desc.value;
}

// Push the active cell's state into the visible field (child only).
function loadActiveCellFields(formEl) {
  const st = formEl._grid;
  const c = st?.cells[st.active];
  if (!c) return;
  // containerFromForm targets the ACTIVE cell; the grid uuid stays in
  // formEl.dataset.gridUuid for save/delete.
  formEl.dataset.editUuid = c.uuid;
  const desc = formEl.querySelector('[data-grid-description]');
  if (desc) { desc.value = c.description; syncSurfaceFromTextarea(desc); }
  renderCellSpill(formEl);
  renderCellValign(formEl);
}

// Reflect the active cell's `spill` flag into the nameless radio-btn group (False /
// True). Mirrors renderCellValign: the radios share no `name` so they stay out of
// the form's dirty tracking — selection is enforced by hand and persistence flows
// through gridState.
function renderCellSpill(formEl) {
  const c = formEl._grid?.cells[formEl._grid.active];
  const spill = !!c?.spill;
  formEl.querySelectorAll('[data-grid-spill]').forEach(label => {
    const input = label.querySelector('input');
    if (input) input.checked = ((label.dataset.gridSpill === 'true') === spill);
  });
}

// Apply an "allow spill" choice to the active cell + refresh dirty state.
function setCellSpill(formEl, spill) {
  const c = formEl._grid?.cells[formEl._grid.active];
  if (!c || !!c.spill === spill) return;
  c.spill = spill;
  renderCellSpill(formEl);
  syncGridState(formEl);
  formEl._refreshSaveState?.();
}

// Reflect the active cell's `valign` into the nameless radio-btn group, enforcing
// single-selection by hand (the radios share no `name`, mirroring the data-table
// alignment control so the visible inputs stay out of the form's dirty tracking).
function renderCellValign(formEl) {
  const c = formEl._grid?.cells[formEl._grid.active];
  const valign = c?.valign ?? 'default';
  formEl.querySelectorAll('[data-grid-valign]').forEach(label => {
    const input = label.querySelector('input');
    if (input) input.checked = (label.dataset.gridValign === valign);
  });
}

// Apply a vertical-alignment choice to the active cell + refresh dirty state.
function setCellValign(formEl, valign) {
  const c = formEl._grid?.cells[formEl._grid.active];
  if (!c || c.valign === valign) return;
  c.valign = valign;
  renderCellValign(formEl);
  syncGridState(formEl);
  formEl._refreshSaveState?.();
}

// Refresh each cell's render-only component count from fresh markdown (parent
// only — the child never renders the cell list). Cells absent from `md` keep a
// 0 count.
function enrichCellCounts(formEl, md) {
  const st = formEl._grid;
  if (!st) return;
  for (const c of st.cells) {
    try { c.nComponents = readGridCellComponents(md, c.uuid).components.length; }
    catch { c.nComponents = c.nComponents ?? 0; }
  }
}

// ── Parent: cell list + flavor rendering ────────────────────────────────────────

const CELL_INSERT_ATTR = 'data-insert-cell-at';

// One cell card: rich description preview (clamp + Show more), a component-count
// meta, and Copy / Edit. Copy reads the cell from the file, so it is omitted in
// create mode (the grid isn't in the file yet and its cells are empty anyway).
function cellCard(formEl, c, i) {
  const n = c.nComponents ?? 0;
  const canCopy = formEl.dataset.mode !== 'create';
  return `
    <div class="mb-incident-card --teal">
      <div class="mb-incident-card__head">
        <strong class="mb-incident-card__title">Cell ${i + 1}</strong>
      </div>
      ${cardBodyBlock(c.description) || '<p class="mb-incident-card__body mb-grid-cell-empty">No text</p>'}
      <div class="mb-incident-card__foot${n ? '' : ' --end'}">
        ${n ? `<span class="mb-incident-card__meta">${n} component${n === 1 ? '' : 's'}</span>` : ''}
        <span class="mb-incident-card__foot-actions">
          ${canCopy ? `<button type="button" class="mb-incident-card__edit" data-copy-grid-cell="${i}">Copy</button>` : ''}
          <button type="button" class="mb-incident-card__edit" data-grid-edit-cell="${i}">Edit</button>
        </span>
      </div>
    </div>`;
}

// Render the vertical cell list: an insert bar before every card and after the
// last, each card wrapped in the shared up/down rail. Same chrome as the
// component list (renderComponents in guides.js).
function renderCellList(formEl) {
  const host = formEl.querySelector('[data-grid-cells]');
  const st = formEl._grid;
  if (!host || !st) return;
  const parts = [];
  const last = st.cells.length - 1;
  st.cells.forEach((c, i) => {
    parts.push(insertTriggerHtml(i, { attr: CELL_INSERT_ATTR, label: '+ Insert cell' }));
    parts.push(railRowHtml({
      rowAttrs: `data-grid-cell="${i}"`,
      isFirst: i === 0,
      isLast: i === last,
      moveAttr: 'data-grid-move-cell',
      cardHtml: cellCard(formEl, c, i),
    }));
  });
  parts.push(insertTriggerHtml(st.cells.length, { attr: CELL_INSERT_ATTR, label: '+ Insert cell' }));
  host.innerHTML = parts.join('');
  paintInlineAtoms(host); // colour label pills + inline icons in the rich previews
  applyCardClamps(host);  // reveal Show more on previews that overflow the clamp
  // Re-mark any Shift+click Copy selection (uuid-keyed, so it follows rail
  // moves) and the Copy buttons' Shift labels.
  paintCopySelection(host, st.cells.map(c => c.uuid));
}

function renderFlavor(formEl) {
  const st = formEl._grid;
  formEl.querySelectorAll('[name="gridFlavor"]').forEach(input => {
    input.checked = (input.value === st.flavor);
  });
}

// ── Child: component list ───────────────────────────────────────────────────────

// Render the active cell's component list and point the shared open-editor
// tracking at it, so inserts/mutations re-render in place. No-op in the parent,
// which has no component list element.
async function mountActiveCellComponents(formEl, md = null) {
  const st = formEl._grid;
  const c = st?.cells[st.active];
  if (!c) return;
  const listEl = formEl.querySelector('[data-grid-cell-components]');
  if (!listEl) return;
  const file = formEl.dataset.containerFile;
  let components = [];
  if (formEl.dataset.mode !== 'create' && file) {
    try {
      const source = md ?? await readRepoText(file);
      components = reorderComponents(readGridCellComponents(source, c.uuid).components, c.order ?? []);
    } catch { components = []; }
  }
  renderComponents(listEl, components, false); // grids never number steps
  const ed = { formEl, listEl, container: { kind: 'grid-cell', uuid: c.uuid, file }, components };
  ed._mountedOrder = components.map(uuidOfComponent);
  formEl._gridEditor = ed;
  setOpenComponentEditor(ed);
}

// Sync an in-editor rail reorder into the owning cell's batch order + gridState.
function syncActiveOrderFromEditor(formEl) {
  const ed = formEl._gridEditor;
  const st = formEl._grid;
  if (!ed || !st || !Array.isArray(ed.components)) return;
  const cell = st.cells.find(c => c.uuid === ed.container.uuid);
  if (!cell) return;
  const cur = ed.components.map(uuidOfComponent);
  const mounted = ed._mountedOrder ?? cur;
  if (cell.order == null && cur.join(',') === mounted.join(',')) return; // untouched
  cell.order = cur;
  syncGridState(formEl);
}

function installRefreshHook(formEl) {
  const orig = formEl._refreshSaveState;
  formEl._refreshSaveState = () => { syncActiveOrderFromEditor(formEl); orig?.(); };
}

// ── Parent: cell + flavor management ─────────────────────────────────────────────

// Batch reorder (rail arrows): swap with the neighbour, re-render, mark dirty.
// Not committed here — it rides the grid's next save, like the component rail.
function moveCell(formEl, i, dir) {
  const st = formEl._grid;
  const j = i + dir;
  if (i < 0 || i >= st.cells.length || j < 0 || j >= st.cells.length) return;
  [st.cells[i], st.cells[j]] = [st.cells[j], st.cells[i]];
  renderCellList(formEl);
  syncGridState(formEl);
  formEl._refreshSaveState?.();
}

// Copy cell markdown (`<div … markdown>` blocks, spans stripped). A plain click
// copies the clicked cell alone and clears any multi-selection; a Shift+click
// (`multi`) toggles the cell in the list's selection and copies the WHOLE
// selection in current on-screen order (see copySelection.js), falling back to
// the clicked cell when the toggle empties it. Bodies are read from the file:
// the parent never edits cell content, only flavor and order, and an unsaved
// flavor only changes the `card` class, which paste ignores. Order comes from
// state so an unsaved reorder still copies the cards you see.
async function copyGridCell(formEl, i, btn, multi = false) {
  try {
    const st = formEl._grid;
    const host = formEl.querySelector('[data-grid-cells]');
    const order = st.cells.map(c => c.uuid);
    const uuid = order[i];
    if (!uuid) throw new Error('cell not found');
    setShiftHeld(multi); // resync the label tracker from the click itself
    const sel = copySelectionOf(host);
    if (multi) sel.toggle(uuid); else sel.clear();
    let uuids = multi ? sel.ordered(order) : [uuid];
    if (!uuids.length) uuids = [uuid];
    sel.paint(host, order); // before the await: instant feedback
    const md = await readRepoText(formEl.dataset.containerFile);
    const grid = getGridByUUID(md, formEl.dataset.gridUuid);
    const cells = uuids.map(u => grid?.cells.find(c => c.uuid === u));
    if (cells.some(c => !c)) throw new Error('cell not found');
    await navigator.clipboard.writeText(gridCellsMarkdown(st.flavor, cells));
    if (!multi) flashButtonLabel(btn, 'Copied ✓'); // multi: the painted label persists
  } catch (err) {
    console.warn('[MB] copy grid cell failed:', err);
    flashButtonLabel(btn, 'Copy failed');
  }
}

function setFlavor(formEl, flavor) {
  const st = formEl._grid;
  if (st.flavor === flavor) return;
  st.flavor = flavor;
  renderFlavor(formEl);
  syncGridState(formEl);
  formEl._refreshSaveState?.();
}

// ── Wiring ────────────────────────────────────────────────────────────────────

// Parent: flavor toggle, rail reorder, Copy / Edit on a card, and the insert bar
// (a two-item menu: Add cell / Paste cell markdown — both via the save-gate).
function wireGridEditor(formEl) {
  formEl.addEventListener('change', e => {
    if (e.target.name === 'gridFlavor') setFlavor(formEl, e.target.value);
  });

  formEl.addEventListener('click', e => {
    const expandBtn = e.target.closest('[data-card-expand]');
    if (expandBtn) { toggleCardExpand(expandBtn); return; }

    const move = e.target.closest('[data-grid-move-cell]');
    if (move) {
      if (move.disabled) return;
      const row = move.closest('[data-grid-cell]');
      moveCell(formEl, parseInt(row?.dataset.gridCell ?? '-1', 10), move.dataset.gridMoveCell === 'up' ? -1 : 1);
      return;
    }

    const copyBtn = e.target.closest('[data-copy-grid-cell]');
    if (copyBtn) { copyGridCell(formEl, parseInt(copyBtn.dataset.copyGridCell, 10), copyBtn, e.shiftKey); return; }

    const editBtn = e.target.closest('[data-grid-edit-cell]');
    if (editBtn) {
      const i = parseInt(editBtn.dataset.gridEditCell, 10);
      // The save-gate returns "the active cell" as the child container; point it
      // at the clicked cell before navigating.
      formEl.dataset.editUuid = formEl._grid.cells[i]?.uuid ?? '';
      beginChildNavigation(formEl, { type: 'edit-grid-cell', index: i });
      return;
    }

    const insert = e.target.closest(`[${CELL_INSERT_ATTR}]`);
    if (insert) {
      const idx = parseInt(insert.getAttribute(CELL_INSERT_ATTR), 10);
      const anchor = insert.querySelector('.mb-insert-component__btn') || insert;
      openPopupMenu(anchor, [
        { id: 'add-cell', label: 'Add cell' },
        { id: 'paste-cell', label: 'Paste cell markdown' },
      ], id => {
        if (id === 'add-cell') beginChildNavigation(formEl, { type: 'grid-cell-add', insertAt: idx });
        else if (id === 'paste-cell') beginChildNavigation(formEl, { type: 'grid-cell-paste', insertAt: idx });
      });
    }
  });
}

// Child: rich content edits + the shared component delegation (rails, edit
// buttons, "+ Insert Component").
function wireGridCellEditor(formEl) {
  formEl.addEventListener('input', e => {
    if (e.target.matches?.('[data-grid-description]')) {
      stashActiveCell(formEl);
      syncGridState(formEl);
      formEl._refreshSaveState?.();
    }
  });
  formEl.addEventListener('click', e => {
    const valignBtn = e.target.closest('[data-grid-valign]');
    if (valignBtn) setCellValign(formEl, valignBtn.dataset.gridValign);
    const spillBtn = e.target.closest('[data-grid-spill]');
    if (spillBtn) setCellSpill(formEl, spillBtn.dataset.gridSpill === 'true');
  });
  formEl.addEventListener('click', onComponentEditorClick);
}

// ── State init / storage ───────────────────────────────────────────────────────

async function initStateFromStorage(formEl, fallbackCells, fallbackFlavor, file, gridUuid) {
  let cells = fallbackCells;
  let flavor = fallbackFlavor;
  try {
    const res = await chrome.storage.local.get(STORAGE_KEY);
    const raw = res?.[STORAGE_KEY]?.gridState;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.cells) && parsed.cells.length) cells = parsed.cells;
      if (parsed?.flavor === 'card' || parsed?.flavor === 'generic') flavor = parsed.flavor;
    }
  } catch { /* fall back to markdown-derived state */ }
  formEl._grid = { gridUuid, file, cells, flavor, active: 0 };
}

function seedStorage(flavor, cells) {
  return chrome.storage.local.set({ [STORAGE_KEY]: { gridState: JSON.stringify({ flavor, cells: slimCells(cells) }) } });
}

// ── Openers (parent) ────────────────────────────────────────────────────────────

registerFormAction('openCreateGrid', async ({ container, insertAtIndex } = {}) => {
  if (!container?.file) return;
  const initialCells = [newCell(), newCell()];
  const initialFlavor = 'generic';
  if (!isFormReplay()) await seedStorage(initialFlavor, initialCells);

  const { formEl } = await createForm('editGrid');
  if (!formEl) return;
  formEl.dataset.mode = 'create';
  formEl.dataset.parentKind = container.kind;
  formEl.dataset.parentUuid = container.uuid;
  formEl.dataset.parentFile = container.file;
  formEl.dataset.insertAtIndex = insertAtIndex == null ? '' : String(insertAtIndex);
  formEl.dataset.gridUuid = '';
  formEl.dataset.containerFile = container.file;
  formEl.dataset.componentNoun = 'grid';

  const heading = formEl.querySelector('[data-grid-heading]');
  if (heading) heading.textContent = 'Add grid';
  formEl.parentElement?.querySelector('[data-delete-grid-btn]')?.style.setProperty('display', 'none');

  await initStateFromStorage(formEl, initialCells, initialFlavor, container.file, null);
  formEl._componentSaver = () => saveGridForComponent(formEl);
  wireGridEditor(formEl);
  formEl.dataset.editUuid = formEl._grid.cells[0]?.uuid ?? '';
  renderCellList(formEl);
  renderFlavor(formEl);
  syncGridState(formEl);
  resetDirtyBaseline(formEl);
});

registerFormAction('openEditGrid', async ({ uuid, file } = {}) => {
  if (!uuid || !file) return;
  let md;
  try {
    md = await fetchFileMigratingIdentity(file);
  } catch (e) {
    alert('Failed to load file: ' + e.message);
    return;
  }
  const grid = getGridByUUID(md, uuid);
  if (!grid) { alert('Grid not found.'); return; }
  const mdCells = cellsFromGrid(grid);
  if (!isFormReplay()) await seedStorage(grid.flavor, mdCells);

  const { formEl } = await createForm('editGrid');
  if (!formEl) return;
  formEl.dataset.mode = 'edit';
  formEl.dataset.gridUuid = uuid;
  formEl.dataset.containerFile = file;
  formEl.dataset.componentNoun = 'grid';

  const heading = formEl.querySelector('[data-grid-heading]');
  if (heading) heading.textContent = 'Edit grid';
  setCrumbLabel('Grid');

  await initStateFromStorage(formEl, mdCells, grid.flavor, file, uuid);
  enrichCellCounts(formEl, md);
  formEl._componentSaver = () => saveGridForComponent(formEl);
  wireGridEditor(formEl);
  formEl.dataset.editUuid = formEl._grid.cells[formEl._grid.active]?.uuid ?? '';
  renderCellList(formEl);
  renderFlavor(formEl);
  syncGridState(formEl);
  resetDirtyBaseline(formEl);
});

// ── Opener (child) ──────────────────────────────────────────────────────────────

registerFormAction('openEditGridCell', async ({ uuid, file, index } = {}) => {
  if (!uuid || !file || index == null) return;
  let md;
  try {
    md = await fetchFileMigratingIdentity(file);
  } catch (e) {
    alert('Failed to load file: ' + e.message);
    return;
  }
  const grid = getGridByUUID(md, uuid);
  if (!grid) { alert('Grid not found.'); return; }
  const mdCells = cellsFromGrid(grid);
  // The save-gate flushed any in-flight whole-grid edits before navigating here,
  // so the file is authoritative; seed storage from it (covers capture-mode and
  // back-navigation replays) and let the parent re-render from it on the way back.
  await seedStorage(grid.flavor, mdCells);

  const { formEl } = await createForm('editGridCell');
  if (!formEl) return;
  formEl.dataset.mode = 'edit';
  formEl.dataset.gridUuid = uuid;
  formEl.dataset.containerFile = file;
  // Make the cell editor a component host: this cell is a `grid-cell` container,
  // and the save-gate flushes the whole grid before opening a component child.
  formEl.dataset.componentContainerKind = 'grid-cell';
  formEl.dataset.componentNoun = 'grid';
  formEl._componentSaver = () => saveGridCellForComponent(formEl);

  await initStateFromStorage(formEl, mdCells, grid.flavor, file, uuid);
  const st = formEl._grid;
  st.active = Math.max(0, Math.min(index, st.cells.length - 1));

  const heading = formEl.querySelector('[data-grid-cell-heading]');
  if (heading) heading.textContent = `Edit cell ${st.active + 1}`;
  setCrumbLabel(`Cell ${st.active + 1}`);

  wireGridCellEditor(formEl);
  loadActiveCellFields(formEl);
  syncGridState(formEl);
  await mountActiveCellComponents(formEl, md);
  installRefreshHook(formEl);
  resetDirtyBaseline(formEl);
});

// ── Persistence ───────────────────────────────────────────────────────────────

function validateGrid(st) {
  if (!st?.cells.length) { alert('Add at least one cell.'); return false; }
  return true;
}

async function persistNewGrid(formEl, onProgress = () => {}) {
  stashActiveCell(formEl);
  const st = formEl._grid;
  if (!validateGrid(st)) return null;
  const parent = {
    kind: formEl.dataset.parentKind,
    uuid: formEl.dataset.parentUuid,
    file: formEl.dataset.parentFile,
  };
  const handler = getComponentContainer(parent.kind);
  if (!handler) { alert('Unknown parent container.'); return null; }

  const gridUuid = generateUUID();
  const gridCells = st.cells.map(c => ({
    uuid: c.uuid,
    body: buildComponentBody(c.uuid, c.description, []),
    spill: c.spill,
    valign: c.valign,
  }));
  const insertAtRaw = formEl.dataset.insertAtIndex;
  const insertAt = insertAtRaw === '' || insertAtRaw == null ? null : parseInt(insertAtRaw, 10);

  await spliceIntoContainer(parent, insertAt, [{ kind: 'grid', grid: { uuid: gridUuid, flavor: st.flavor, cells: gridCells } }], onProgress);
  return { gridUuid, file: parent.file };
}

async function transitionGridCreateToEdit(formEl, gridUuid, file) {
  formEl.dataset.mode = 'edit';
  formEl.dataset.gridUuid = gridUuid;
  formEl.dataset.containerFile = file;
  formEl._grid.gridUuid = gridUuid;
  formEl._grid.cells.forEach(c => { c.order = null; });
  replaceCurrentOpener('openEditGrid', { uuid: gridUuid, file });
  const heading = formEl.querySelector('[data-grid-heading]');
  if (heading) heading.textContent = 'Edit grid';
  setCrumbLabel('Grid');
  formEl.parentElement?.querySelector('[data-delete-grid-btn]')?.style.removeProperty('display');
  syncGridState(formEl);
  await seedStorage(formEl._grid.flavor, formEl._grid.cells);
  resetDirtyBaseline(formEl);
}

// Whole-grid save, last-write-wins on flavor/cell list. Components are preserved
// per cell: each surviving cell's CURRENT components are re-read from fresh
// markdown, an in-flight batch reorder applied, and the grid rebuilt in order.
async function persistGridEdit(formEl, onProgress = () => {}) {
  stashActiveCell(formEl);
  const st = formEl._grid;
  if (!validateGrid(st)) return null;
  const file = formEl.dataset.containerFile;
  const gridUuid = formEl.dataset.gridUuid;

  let found = true;
  await githubFetchAndPushFile(file, onProgress, md => {
    if (!getGridByUUID(md, gridUuid)) { found = false; return md; }
    const gridCells = st.cells.map(c => {
      const { components } = readGridCellComponents(md, c.uuid);
      const ordered = c.order ? reorderComponents(components, c.order) : components;
      return { uuid: c.uuid, body: buildComponentBody(c.uuid, c.description, ordered), spill: c.spill, valign: c.valign };
    });
    return replaceGridByUUID(md, gridUuid, buildGrid(gridUuid, st.flavor, gridCells));
  });
  if (!found) {
    alert('This grid was deleted in another session — your changes can’t be saved.');
    return null;
  }

  st.cells.forEach(c => { c.order = null; }); // the file is canonical again
  syncGridState(formEl);
  await seedStorage(st.flavor, st.cells);
  await mountActiveCellComponents(formEl); // child re-renders its cell; parent no-ops
  resetDirtyBaseline(formEl);
  return { gridUuid, file };
}

// Persist the parent grid form for the save-gate. Returns { container, formEl }
// where container = the ACTIVE cell, so child flows insert into it.
async function saveGridForComponent(formEl, onProgress = () => {}) {
  if (formEl.dataset.mode === 'create') {
    const res = await persistNewGrid(formEl, onProgress);
    if (!res) return null;
    await transitionGridCreateToEdit(formEl, res.gridUuid, res.file);
  } else {
    const res = await persistGridEdit(formEl, onProgress);
    if (!res) return null;
  }
  return {
    container: { kind: 'grid-cell', uuid: formEl.dataset.editUuid, file: formEl.dataset.containerFile },
    formEl,
  };
}

// Whole-grid save used as the CHILD cell editor's component save-gate hook: flush
// the in-flight grid to the draft, then hand back the EDITED cell as the container
// the pending child (component insert / edit) will act on.
async function saveGridCellForComponent(formEl, onProgress = () => {}) {
  const res = await persistGridEdit(formEl, onProgress);
  if (!res) return null;
  return {
    container: { kind: 'grid-cell', uuid: formEl.dataset.editUuid, file: formEl.dataset.containerFile },
    formEl,
  };
}

// ── Immediate-commit cell mutations (add / paste / delete) ─────────────────────
//
// Unlike a rail reorder these write the file straight away (through the parent's
// save-gate, which flushes any in-flight grid edits first). `isFormReplay()` is
// only true during a form-stack restore, NOT on back-navigation, so when a child
// navigates back the parent's opener re-fetches the file and re-seeds storage —
// the parent is always file-authoritative afterwards. The seedStorage calls here
// are belt-and-braces for stack restores.

// Rebuilds the grid from the file's own cells (bodies already carry their
// identity spans) — the same faithful rewrite persistGridEdit does.
function gridWithCells(grid, cells) {
  return buildGrid(grid.uuid, grid.flavor, cells.map(c => ({ uuid: c.uuid, body: c.body, spill: c.spill, valign: c.valign })));
}

// Splice `newCells` ({ uuid, description, components, spill, valign }) into the
// grid at `insertAt` (clamped) as one commit. Returns the landing index.
async function spliceGridCells(file, gridUuid, insertAt, newCells, onProgress = () => {}) {
  let landed = 0;
  let after = null;
  await githubFetchAndPushFile(file, onProgress, md => {
    const grid = getGridByUUID(md, gridUuid);
    if (!grid) throw new Error('This grid no longer exists.');
    const idx = (insertAt != null && insertAt >= 0 && insertAt <= grid.cells.length) ? insertAt : grid.cells.length;
    const built = newCells.map(c => ({
      uuid: c.uuid,
      body: buildComponentBody(c.uuid, c.description ?? '', c.components ?? []),
      spill: !!c.spill,
      valign: c.valign ?? 'default',
    }));
    const cells = grid.cells.slice();
    cells.splice(idx, 0, ...built);
    landed = idx;
    after = { flavor: grid.flavor, cells };
    return replaceGridByUUID(md, gridUuid, gridWithCells(grid, cells));
  });
  if (after) await seedStorage(after.flavor, cellsFromGrid(after));
  return landed;
}

// Insert bar → "Add cell": commit one empty cell at the index, then drill into
// its editor (mirrors component inserts landing in their editor). In create
// mode this follows the save-gate's own commit of the new grid — two commits
// back to back, by design.
registerFormAction('addGridCell', async ({ uuid, file, insertAt } = {}) => {
  if (!uuid || !file) return;
  try {
    const index = await spliceGridCells(file, uuid, insertAt, [newCell()]);
    await getFormAction('openEditGridCell')?.({ uuid, file, index });
  } catch (e) {
    alert('Failed to add cell: ' + e.message);
  }
});

// Insert bar → "Paste cell markdown": the paste form (mirrors openPasteMarkdown).
registerFormAction('openPasteGridCell', async ({ uuid, file, insertAt } = {}) => {
  if (!uuid || !file) return;
  if (!isFormReplay()) {
    await chrome.storage.local.set({ moreButtonsPasteGridCell: { pasteMarkdownText: '' } });
  }
  const { formEl } = await createForm('pasteGridCell');
  if (!formEl) return;
  formEl.dataset.gridUuid = uuid;
  formEl.dataset.containerFile = file;
  formEl.dataset.insertAtIndex = insertAt == null ? '' : String(insertAt);
  setCrumbLabel('Paste cell markdown');
});

registerFormAction('insertPastedGridCells', async ({ formEl, content }) => {
  const textarea = formEl.querySelector('[name="pasteMarkdownText"]');
  // showFieldError doesn't dedupe: clear a prior inline error before re-checking.
  textarea?.classList.remove('--invalid');
  textarea?.parentElement?.querySelectorAll('.more-buttons-field-error').forEach(el => el.remove());
  const { cells, error } = parsePastedGridCells(textarea?.value ?? '');
  if (error) {
    showFieldError(formEl, textarea, error);
    return;
  }
  const insertAtRaw = formEl.dataset.insertAtIndex;
  const insertAt = insertAtRaw === '' || insertAtRaw == null ? null : parseInt(insertAtRaw, 10);
  const btn = content.querySelector('[data-action="insertPastedGridCells"]');
  const snap = snapshotButton(btn);
  setButtonBusy(btn, 'Inserting…');
  try {
    await spliceGridCells(formEl.dataset.containerFile, formEl.dataset.gridUuid, insertAt, cells, s => setButtonBusy(btn, s));
    await chrome.storage.local.remove('moreButtonsPasteGridCell');
    await navigateBack();
  } catch (e) {
    restoreButton(btn, snap);
    alert('Failed to insert cell: ' + e.message);
  }
});

// Child form → "Delete cell": confirm (native dialog, like every other component
// delete), remove this cell from the grid as one commit, and return to the grid.
// A grid keeps at least one cell.
registerFormAction('deleteGridCell', async ({ formEl, content }) => {
  const st = formEl._grid;
  const gridUuid = formEl.dataset.gridUuid;
  const file = formEl.dataset.containerFile;
  const cell = st?.cells[st.active];
  if (!cell || !gridUuid || !file) return;
  if (st.cells.length <= 1) {
    alert('A grid needs at least one cell — delete the whole grid instead.');
    return;
  }
  if (!confirm(`Delete cell ${st.active + 1}? Its text and components are removed from the grid.`)) return;

  const btn = content?.querySelector('[data-action="deleteGridCell"]');
  const snap = snapshotButton(btn);
  setButtonBusy(btn, 'Deleting…');
  try {
    let after = null;
    await githubFetchAndPushFile(file, s => setButtonBusy(btn, s), md => {
      const grid = getGridByUUID(md, gridUuid);
      if (!grid) throw new Error('This grid no longer exists.');
      const cells = grid.cells.filter(c => c.uuid !== cell.uuid);
      if (cells.length === grid.cells.length) throw new Error('This cell no longer exists.');
      after = { flavor: grid.flavor, cells };
      return replaceGridByUUID(md, gridUuid, gridWithCells(grid, cells));
    });
    if (after) await seedStorage(after.flavor, cellsFromGrid(after));
    await navigateBack();
  } catch (e) {
    restoreButton(btn, snap);
    alert('Failed to delete cell: ' + e.message);
  }
});

// ── Form actions ──────────────────────────────────────────────────────────────

registerFormAction('submitEditGrid', async ({ formEl, content }) => {
  const btn = content.querySelector('[data-save-state]');
  setButtonBusy(btn, 'Saving…');
  try {
    await saveGridForComponent(formEl, s => setButtonBusy(btn, s));
    formEl._refreshSaveState?.();
  } catch (e) {
    formEl._refreshSaveState?.();
    alert('Failed to save grid: ' + e.message);
  }
});

registerFormAction('submitEditGridCell', async ({ formEl, content }) => {
  const btn = content.querySelector('[data-save-state]');
  setButtonBusy(btn, 'Saving…');
  try {
    // Stay on the cell (like every component editor); the dock flips to "Draft
    // saved" and the grid re-renders from the file on back-navigation.
    await persistGridEdit(formEl, s => setButtonBusy(btn, s));
    formEl._refreshSaveState?.();
  } catch (e) {
    formEl._refreshSaveState?.();
    alert('Failed to save grid: ' + e.message);
  }
});

registerFormAction('deleteGrid', async ({ formEl, content }) => {
  const gridUuid = formEl.dataset.gridUuid;
  const file = formEl.dataset.containerFile;
  if (!gridUuid || !file) return;
  if (!confirm('Delete this grid? All of its cells and their contents are removed.')) return;
  const btn = content?.querySelector('[data-action="deleteGrid"]');
  const snap = snapshotButton(btn);
  setButtonBusy(btn, 'Deleting…'); // disable immediately — no double-click window
  try {
    await githubFetchAndPushFile(file, s => setButtonBusy(btn, s), md => deleteGridByUUID(md, gridUuid));
    await chrome.storage.local.remove(STORAGE_KEY);
    await navigateBack();
  } catch (e) {
    restoreButton(btn, snap);
    alert('Failed to delete grid: ' + e.message);
  }
});
