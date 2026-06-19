/**
 * gridEditor.js — the "Grid" overlay for a grid component.
 *
 * Two forms, mirroring the data-table editor (editDataTable → editDataTableRow):
 *
 *   • editGrid (PARENT) — a flavor toggle (Card / Plain), a structure bar
 *     (add / move / delete cell) and a clickable strip of SQUARE cell TILES.
 *     Clicking a tile selects it (drives the structure bar); its Edit button
 *     drills into the per-cell child form. The parent owns no cell content.
 *
 *   • editGridCell (CHILD) — edits ONE cell: rich content + that cell's
 *     Components list. Each cell is a component container ('grid-cell', uuid =
 *     the CELL's uuid), so admonitions, captures, content tabs, data tables and
 *     nested grids insert into it through the standard save-gate in guides.js.
 *
 * Save model (mirrors the data table): the whole grid is last-write-wins on
 * flavor + cell list. Both forms persist via persistGridEdit, which re-reads each
 * surviving cell's components from fresh markdown so a per-cell save never
 * clobbers a sibling. The two forms share state through ONE storage key
 * (`moreButtonsEditGrid`) → a hidden named input (`gridState`, JSON) for dirty
 * tracking; the child reads it on open, and on save seeds it back so the parent's
 * back-navigation re-render is correct. Visible per-cell inputs are UNNAMED, and
 * `nComponents` is a render-only tile annotation kept out of `gridState`.
 *
 * Cell bodies live in `<div markdown>` (md_in_html, no +4 indent) so the
 * container read/write needs no dedent.
 */

import { registerFormAction } from './formActions.js';
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
} from './components.js';
import { registerComponentContainer, getComponentContainer } from './componentContainers.js';
import { getGridByUUID, buildGrid, replaceGridByUUID, deleteGridByUUID } from './grid.js';
import {
  makeContainerHandler, spliceIntoContainer, renderComponents, onComponentEditorClick,
  setOpenComponentEditor, beginChildNavigation,
} from './guides.js';
import { syncSurfaceFromTextarea } from './richTextEditor.js';
import { escapeHtml } from './cardRenderer.js';

const STORAGE_KEY = 'moreButtonsEditGrid';

// Each CELL is a component container: children read and write through the
// registry like any other container.
registerComponentContainer('grid-cell', makeContainerHandler(readGridCellComponents, writeGridCellBody, gridCellExists));

// ── Editor state ──────────────────────────────────────────────────────────────
//
// formEl._grid = { gridUuid, file, active, flavor, cells: [{ uuid, description, order, spill, nComponents }] }
//   - `active` is the SELECTED tile in the parent, and the EDITED cell in the child.
//   - `spill` is the per-cell "allow spill" flag (→ class="spill" on the cell div).
//   - `nComponents` is a render-only tile annotation; it is NOT persisted in gridState.

function newCell() {
  return { uuid: generateUUID(), description: '', order: null, spill: false, nComponents: 0 };
}

function cellsFromGrid(grid) {
  return grid.cells.map(c => {
    const { description, components } = parseComponents(c.body, GUIDE_ADMONITION_TYPES_RE);
    return { uuid: c.uuid ?? generateUUID(), description, order: null, spill: !!c.spill, nComponents: components.length };
  });
}

// The slim cell shape that drives dirty tracking + cross-form storage. `nComponents`
// is deliberately excluded so a tile's component count never affects the form's
// dirty/persist state.
function slimCells(cells) {
  return cells.map(c => ({ uuid: c.uuid, description: c.description, order: c.order ?? null, spill: !!c.spill }));
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
  const spill = formEl.querySelector('[data-grid-allow-spill]');
  if (spill) c.spill = spill.checked;
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
  const spill = formEl.querySelector('[data-grid-allow-spill]');
  if (spill) spill.checked = !!c.spill;
}

// Refresh each cell's render-only component count from fresh markdown (parent
// only — the child never renders tiles). Cells absent from `md` (added but not
// yet saved) keep a 0 count.
function enrichCellCounts(formEl, md) {
  const st = formEl._grid;
  if (!st) return;
  for (const c of st.cells) {
    try { c.nComponents = readGridCellComponents(md, c.uuid).components.length; }
    catch { c.nComponents = c.nComponents ?? 0; }
  }
}

// ── Parent: tiles + flavor rendering ────────────────────────────────────────────

// A plain-text, single-line preview of the cell's content for the tile body.
function tilePreview(cell) {
  const text = (cell.description ?? '')
    .replace(/<span[^>]*data-uuid[^>]*><\/span>\n?/g, '')
    .replace(/!\[[^\]]*\]\([^)]+\)(\{[^}]+\})?/g, '')
    .replace(/\n+/g, ' ')
    .trim();
  if (text) return escapeHtml(text.length > 160 ? text.slice(0, 160) + '…' : text);
  return `<span class="mb-grid-cell-tile__empty">No text</span>`;
}

// Render the square cell tiles + sync the structure-bar enablement.
function renderTiles(formEl) {
  const host = formEl.querySelector('[data-grid-tiles]');
  const st = formEl._grid;
  if (!host || !st) return;
  host.innerHTML = st.cells.map((c, i) => {
    const sel = i === st.active ? ' --selected' : '';
    const n = c.nComponents ?? 0;
    return `
      <div class="mb-incident-card --grey mb-grid-cell-tile${sel}" data-grid-cell="${i}">
        <div class="mb-incident-card__head">
          <strong class="mb-incident-card__title">Cell ${i + 1}</strong>
        </div>
        <p class="mb-incident-card__body">${tilePreview(c)}</p>
        <div class="mb-incident-card__foot${n ? '' : ' --end'}">
          ${n ? `<span class="mb-incident-card__meta">${n} component${n === 1 ? '' : 's'}</span>` : ''}
          <button type="button" class="mb-incident-card__edit" data-grid-edit-cell="${i}">Edit</button>
        </div>
      </div>`;
  }).join('');

  const left = formEl.querySelector('[data-grid-move="left"]');
  const right = formEl.querySelector('[data-grid-move="right"]');
  const del = formEl.querySelector('[data-grid-delete-cell]');
  if (left) left.disabled = st.active <= 0;
  if (right) right.disabled = st.active >= st.cells.length - 1;
  if (del) del.disabled = st.cells.length <= 1;
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

// Select a tile (drives the structure bar + which cell the Edit button opens).
function activateCell(formEl, index) {
  const st = formEl._grid;
  st.active = Math.max(0, Math.min(index, st.cells.length - 1));
  formEl.dataset.editUuid = st.cells[st.active]?.uuid ?? '';
  renderTiles(formEl);
}

function addCell(formEl) {
  const st = formEl._grid;
  st.cells.push(newCell());
  st.active = st.cells.length - 1;
  formEl.dataset.editUuid = st.cells[st.active].uuid;
  renderTiles(formEl);
  syncGridState(formEl);
  formEl._refreshSaveState?.();
}

function moveActiveCell(formEl, dir) {
  const st = formEl._grid;
  const i = st.active;
  const j = i + dir;
  if (j < 0 || j >= st.cells.length) return;
  [st.cells[i], st.cells[j]] = [st.cells[j], st.cells[i]];
  st.active = j; // the active cell travels with the move
  formEl.dataset.editUuid = st.cells[st.active].uuid;
  renderTiles(formEl);
  syncGridState(formEl);
  formEl._refreshSaveState?.();
}

function deleteActiveCell(formEl) {
  const st = formEl._grid;
  if (st.cells.length <= 1) {
    alert('A grid needs at least one cell — use Delete below to remove the whole grid.');
    return;
  }
  if (!confirm(`Delete cell ${st.active + 1}? Its contents are removed when you save.`)) return;
  st.cells.splice(st.active, 1);
  st.active = Math.min(st.active, st.cells.length - 1);
  formEl.dataset.editUuid = st.cells[st.active]?.uuid ?? '';
  renderTiles(formEl);
  syncGridState(formEl);
  formEl._refreshSaveState?.();
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

// Parent: flavor toggle, tile selection, drill-in to a cell, structure bar.
function wireGridEditor(formEl) {
  formEl.addEventListener('change', e => {
    if (e.target.name === 'gridFlavor') setFlavor(formEl, e.target.value);
  });

  formEl.addEventListener('click', e => {
    const editBtn = e.target.closest('[data-grid-edit-cell]');
    if (editBtn) {
      const i = parseInt(editBtn.dataset.gridEditCell, 10);
      activateCell(formEl, i);
      beginChildNavigation(formEl, { type: 'edit-grid-cell', index: i });
      return;
    }
    const tile = e.target.closest('[data-grid-cell]');
    if (tile) { activateCell(formEl, parseInt(tile.dataset.gridCell, 10)); return; }
    if (e.target.closest('[data-grid-add]')) { addCell(formEl); return; }
    const move = e.target.closest('[data-grid-move]');
    if (move) { if (!move.disabled) moveActiveCell(formEl, move.dataset.gridMove === 'left' ? -1 : 1); return; }
    const del = e.target.closest('[data-grid-delete-cell]');
    if (del) { if (!del.disabled) deleteActiveCell(formEl); return; }
  });
}

// Child: rich content edits + the shared component delegation (rails, edit
// buttons, "+ Insert Component").
function wireGridCellEditor(formEl) {
  formEl.addEventListener('input', e => {
    if (e.target.matches?.('[data-grid-description], [data-grid-allow-spill]')) {
      stashActiveCell(formEl);
      syncGridState(formEl);
      formEl._refreshSaveState?.();
    }
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
  const initialFlavor = 'card';
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
  renderTiles(formEl);
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
  renderTiles(formEl);
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
      return { uuid: c.uuid, body: buildComponentBody(c.uuid, c.description, ordered), spill: c.spill };
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
    const res = await persistGridEdit(formEl, s => setButtonBusy(btn, s));
    if (res) { await navigateBack(); return; } // back to the grid, which re-renders from storage
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
