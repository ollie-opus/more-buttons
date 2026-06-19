/**
 * gridEditor.js — the "Grid" overlay for a grid component.
 *
 * One form edits a whole GRID: a flavor toggle (Card / Generic), a dynamic cell
 * strip, ONE active panel below it (rich cell content + the active cell's
 * Components list), and add / move / delete-cell management. Each cell is itself
 * a component container ('grid-cell', uuid = the CELL's uuid), so admonitions,
 * captures, content tabs, data tables and nested grids can be inserted into the
 * active cell through the standard save-gate machinery in guides.js.
 *
 * Mirrors contentTabsEditor.js. Differences: cells have no title (Zensical grid
 * cells are title-less); a grid-level `flavor` toggle; and cell bodies live in
 * `<div markdown>` (md_in_html, no +4 indent) so the container read/write needs
 * no dedent. Editor state lives in `formEl._grid`, mirrored into ONE hidden
 * named input (`gridState`, JSON) for dirty tracking; visible per-cell inputs
 * are deliberately UNNAMED.
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
import { makeContainerHandler, spliceIntoContainer, renderComponents, onComponentEditorClick, setOpenComponentEditor } from './guides.js';
import { syncSurfaceFromTextarea } from './richTextEditor.js';
import { escapeHtml } from './cardRenderer.js';

const STORAGE_KEY = 'moreButtonsEditGrid';

// Each CELL is a component container: children read and write through the
// registry like any other container.
registerComponentContainer('grid-cell', makeContainerHandler(readGridCellComponents, writeGridCellBody, gridCellExists));

// ── Editor state ──────────────────────────────────────────────────────────────
//
// formEl._grid = { gridUuid, file, active, flavor, cells: [{ uuid, description, order }] }

function newCell() {
  return { uuid: generateUUID(), description: '', order: null };
}

function cellsFromGrid(grid) {
  return grid.cells.map(c => {
    const { description } = parseComponents(c.body, GUIDE_ADMONITION_TYPES_RE);
    return { uuid: c.uuid ?? generateUUID(), description, order: null };
  });
}

// Mirror the state into the single named input that drives dirty tracking.
function syncGridState(formEl) {
  const input = formEl.querySelector('[name="gridState"]');
  if (input) input.value = JSON.stringify({ flavor: formEl._grid.flavor, cells: formEl._grid.cells });
}

// Pull the active cell's visible (unnamed) field back into state.
function stashActiveCell(formEl) {
  const st = formEl._grid;
  const c = st?.cells[st.active];
  if (!c) return;
  const desc = formEl.querySelector('[data-grid-description]');
  if (desc) c.description = desc.value;
}

// Push the active cell's state into the visible field.
function loadActiveCellFields(formEl) {
  const st = formEl._grid;
  const c = st?.cells[st.active];
  if (!c) return;
  // containerFromForm targets the ACTIVE cell; the grid uuid stays in
  // formEl.dataset.gridUuid for save/delete.
  formEl.dataset.editUuid = c.uuid;
  const desc = formEl.querySelector('[data-grid-description]');
  if (desc) { desc.value = c.description; syncSurfaceFromTextarea(desc); }
}

function renderStrip(formEl) {
  const strip = formEl.querySelector('[data-grid-strip]');
  const st = formEl._grid;
  if (!strip || !st) return;
  strip.innerHTML = st.cells.map((c, i) =>
    `<button type="button" class="more-buttons-tab${i === st.active ? ' --active' : ''}" data-grid-cell="${i}">Cell ${i + 1}</button>`
  ).join('') + `<button type="button" class="more-buttons-tab mb-grid-add-cell" data-grid-add title="Add cell">+ Add cell</button>`;

  const left = formEl.querySelector('[data-grid-move="left"]');
  const right = formEl.querySelector('[data-grid-move="right"]');
  const del = formEl.querySelector('[data-grid-delete-cell]');
  if (left) left.disabled = st.active <= 0;
  if (right) right.disabled = st.active >= st.cells.length - 1;
  if (del) del.disabled = st.cells.length <= 1;
}

function renderFlavor(formEl) {
  const st = formEl._grid;
  formEl.querySelectorAll('[data-grid-flavor]').forEach(btn => {
    btn.classList.toggle('--active', btn.dataset.gridFlavor === st.flavor);
  });
}

// Render the active cell's component list and point the shared open-editor
// tracking at it, so inserts/mutations re-render in place.
async function mountActiveCellComponents(formEl, md = null) {
  const st = formEl._grid;
  const c = st?.cells[st.active];
  if (!c) return;
  const listEl = formEl.querySelector('[data-grid-cell-components]');
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

// ── Cell + flavor management ───────────────────────────────────────────────────

async function activateCell(formEl, index) {
  stashActiveCell(formEl);
  const st = formEl._grid;
  st.active = Math.max(0, Math.min(index, st.cells.length - 1));
  loadActiveCellFields(formEl);
  renderStrip(formEl);
  syncGridState(formEl);
  formEl._refreshSaveState?.();
  await mountActiveCellComponents(formEl);
}

async function addCell(formEl) {
  stashActiveCell(formEl);
  const st = formEl._grid;
  st.cells.push(newCell());
  await activateCell(formEl, st.cells.length - 1);
}

function moveActiveCell(formEl, dir) {
  stashActiveCell(formEl);
  const st = formEl._grid;
  const i = st.active;
  const j = i + dir;
  if (j < 0 || j >= st.cells.length) return;
  [st.cells[i], st.cells[j]] = [st.cells[j], st.cells[i]];
  st.active = j; // the active cell travels with the move
  renderStrip(formEl);
  syncGridState(formEl);
  formEl._refreshSaveState?.();
}

async function deleteActiveCell(formEl) {
  const st = formEl._grid;
  if (st.cells.length <= 1) {
    alert('A grid needs at least one cell — use Delete below to remove the whole grid.');
    return;
  }
  stashActiveCell(formEl);
  if (!confirm(`Delete cell ${st.active + 1}? Its contents are removed when you save.`)) return;
  st.cells.splice(st.active, 1);
  st.active = Math.min(st.active, st.cells.length - 1);
  loadActiveCellFields(formEl);
  renderStrip(formEl);
  syncGridState(formEl);
  formEl._refreshSaveState?.();
  await mountActiveCellComponents(formEl);
}

function setFlavor(formEl, flavor) {
  const st = formEl._grid;
  if (st.flavor === flavor) return;
  stashActiveCell(formEl);
  st.flavor = flavor;
  renderFlavor(formEl);
  syncGridState(formEl);
  formEl._refreshSaveState?.();
}

// ── Wiring ────────────────────────────────────────────────────────────────────

function wireGridEditor(formEl) {
  formEl.addEventListener('input', e => {
    if (e.target.matches?.('[data-grid-description]')) {
      stashActiveCell(formEl);
      syncGridState(formEl);
      formEl._refreshSaveState?.();
    }
  });

  formEl.addEventListener('click', e => {
    const cellBtn = e.target.closest('[data-grid-cell]');
    if (cellBtn) { activateCell(formEl, parseInt(cellBtn.dataset.gridCell, 10)); return; }
    if (e.target.closest('[data-grid-add]')) { addCell(formEl); return; }
    const move = e.target.closest('[data-grid-move]');
    if (move) { if (!move.disabled) moveActiveCell(formEl, move.dataset.gridMove === 'left' ? -1 : 1); return; }
    const del = e.target.closest('[data-grid-delete-cell]');
    if (del) { if (!del.disabled) deleteActiveCell(formEl); return; }
    const flavor = e.target.closest('[data-grid-flavor]');
    if (flavor) { setFlavor(formEl, flavor.dataset.gridFlavor); return; }
  });

  // Shared component delegation: rails, edit buttons, "+ Insert Component".
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
  return chrome.storage.local.set({ [STORAGE_KEY]: { gridState: JSON.stringify({ flavor, cells }) } });
}

// ── Openers ───────────────────────────────────────────────────────────────────

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
  formEl.dataset.componentContainerKind = 'grid-cell';
  formEl.dataset.containerFile = container.file;
  formEl.dataset.componentNoun = 'grid';

  const heading = formEl.querySelector('[data-grid-heading]');
  if (heading) heading.textContent = 'Add grid';
  formEl.parentElement?.querySelector('[data-delete-grid-btn]')?.style.setProperty('display', 'none');

  await initStateFromStorage(formEl, initialCells, initialFlavor, container.file, null);
  formEl._componentSaver = () => saveGridForComponent(formEl);
  wireGridEditor(formEl);
  loadActiveCellFields(formEl);
  renderStrip(formEl);
  renderFlavor(formEl);
  syncGridState(formEl);
  await mountActiveCellComponents(formEl);
  installRefreshHook(formEl);
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
  formEl.dataset.componentContainerKind = 'grid-cell';
  formEl.dataset.containerFile = file;
  formEl.dataset.componentNoun = 'grid';

  const heading = formEl.querySelector('[data-grid-heading]');
  if (heading) heading.textContent = 'Edit grid';
  setCrumbLabel('Grid');

  await initStateFromStorage(formEl, mdCells, grid.flavor, file, uuid);
  formEl._componentSaver = () => saveGridForComponent(formEl);
  wireGridEditor(formEl);
  loadActiveCellFields(formEl);
  renderStrip(formEl);
  renderFlavor(formEl);
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
  await mountActiveCellComponents(formEl);
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
      return { uuid: c.uuid, body: buildComponentBody(c.uuid, c.description, ordered) };
    });
    return replaceGridByUUID(md, gridUuid, buildGrid(gridUuid, st.flavor, gridCells));
  });
  if (!found) {
    alert('This grid was deleted in another session — your changes can't be saved.');
    return null;
  }

  st.cells.forEach(c => { c.order = null; }); // the file is canonical again
  syncGridState(formEl);
  await seedStorage(st.flavor, st.cells);
  await mountActiveCellComponents(formEl);
  resetDirtyBaseline(formEl);
  return { gridUuid, file };
}

// Persist the grid form for the save-gate. Returns { container, formEl } where
// container = the ACTIVE cell, so child flows insert into it.
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
