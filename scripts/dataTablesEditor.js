/**
 * dataTablesEditor.js — the "Data table" overlay for a pipe-table component.
 *
 * The grid form edits a whole TABLE: a clickable grid (header + body cells,
 * each preview rendered from its inline markdown) and structure controls
 * (add / move / delete rows and columns). Clicking a cell selects it; the
 * right-most Edit column opens the per-row (tabbed) child form, which owns
 * content + per-column alignment editing (inline rich text — no lists,
 * no line breaks; see richTextEditor.js).
 *
 * Editor state lives in formEl._dt, mirrored into ONE hidden named input
 * (`tableState`, JSON) for dirty tracking — the grid itself is deliberately
 * UNNAMED so selecting cells never false-dirties the form
 * (contentTabsEditor's pattern).
 *
 * Save model: the TABLE is whole-table last-write-wins (same v1 trade-off as
 * content tabs). A single twist: a body cell may hold ONE capture, and captures
 * follow the app-wide immediate-save Components model. So each cell is exposed
 * as a tiny `data-table-cell` component container (0-or-1 capture); inserting /
 * editing / deleting a capture commits straight to the draft via the shared
 * capture flows + editCaptureComponent, exactly like every other component. The
 * row editor therefore carries the standard component save-gate (_componentSaver
 * flushes the whole-table state before any child navigation) and re-hydrates its
 * table from the file, so the two save models stay consistent.
 */

import { registerFormAction } from './formActions.js';
import {
  createForm, replaceCurrentOpener, setCrumbLabel, isFormReplay, navigateBack,
  resetDirtyBaseline, setButtonBusy, snapshotButton, restoreButton,
} from './form.js';
import { githubFetchAndPushFile, fetchFileMigratingIdentity } from './github.js';
import { generateUUID } from './admonitions.js';
import { getComponentContainer, registerComponentContainer } from './componentContainers.js';
import {
  getDataTableByUUID, buildDataTable, replaceDataTableByUUID, deleteDataTableByUUID,
  parseCellCapture, serializeCellCapture,
} from './dataTables.js';
import { spliceIntoContainer, beginChildNavigation } from './guides.js';
import { openInsertMenu } from './insertMenu.js';
import { syncSurfaceFromTextarea } from './richTextEditor.js';
import { renderDocHtml } from './markdownInline.js';
import { escapeHtml, captureComponentCard } from './cardRenderer.js';
import { assetCdnUrl } from './repoClient.js';

const STORAGE_KEY = 'moreButtonsEditDataTable';

// ── Editor state ──────────────────────────────────────────────────────────────
//
// formEl._dt = { uuid, file, selected: {row, col}, align, header, rows }
//   - selected.row === -1 addresses the header row; a cell is ALWAYS selected
//     (default header 0), which drives the structure button-bar.

function starterTable() {
  return {
    align: ['left', 'left'],
    header: ['Column 1', 'Column 2'],
    rows: [['', ''], ['', '']],
  };
}

function cellAt(st, row, col) {
  return row === -1 ? (st.header[col] ?? '') : (st.rows[row]?.[col] ?? '');
}

function setCellAt(st, row, col, value) {
  if (row === -1) st.header[col] = value;
  else if (st.rows[row]) st.rows[row][col] = value;
}

function clampSelection(st) {
  if (!st.selected) st.selected = { row: -1, col: 0 };
  st.selected.col = Math.max(0, Math.min(st.selected.col, st.align.length - 1));
  st.selected.row = Math.max(-1, Math.min(st.selected.row, st.rows.length - 1));
}

// Mirror the table into the single named input that drives dirty tracking
// (and capture-free storage round-trips, via the generic save step).
function syncTableState(formEl) {
  const input = formEl.querySelector('[name="tableState"]');
  const { align, header, rows } = formEl._dt;
  if (input) input.value = JSON.stringify({ align, header, rows });
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function cellPreview(text) {
  // A capture cell holds dual (light+dark) inline image markdown; preview it as
  // a single light-mode thumbnail rather than letting the mini-renderer stack
  // both themed images.
  const { capture } = parseCellCapture(text ?? '');
  if (capture) {
    return `<img class="mb-dt-cell__capture" src="${escapeHtml(assetCdnUrl('docs/assets/' + capture.lightFilename))}" alt="" loading="lazy" />`;
  }
  return renderDocHtml(text ?? '') || '<span class="mb-dt-cell__empty">…</span>';
}

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
  // Reuses the component-card edit button (.mb-incident-card__edit); the accent
  // vars it needs are supplied by .mb-dt-edit-cell in formsStyling.css.
  const editCell = row => {
    const tag = row === -1 ? 'th' : 'td';
    const cls = 'mb-dt-edit-cell' + (row === -1 ? ' mb-dt-cell--header' : '');
    const label = row === -1 ? 'header' : `row ${row + 1}`;
    return `<${tag} class="${cls}"><button type="button" class="mb-incident-card__edit" data-edit-table-row="${row}" title="Edit ${label}">Edit</button></${tag}>`;
  };
  grid.innerHTML =
    `<thead><tr>${st.header.map((h, c) => cell(-1, c, h)).join('')}${editCell(-1)}</tr></thead>` +
    `<tbody>${st.rows.map((r, ri) => `<tr>${r.map((v, c) => cell(ri, c, v)).join('')}${editCell(ri)}</tr>`).join('')}</tbody>`;
  refreshControls(formEl);
}

// Enable/disable the structure controls for the current selection.
function refreshControls(formEl) {
  const st = formEl._dt;
  const sel = st.selected;
  const q = s => formEl.querySelector(s);
  const onBody = sel.row >= 0;
  q('[data-dt-move="up"]').disabled = !onBody || sel.row <= 0;
  q('[data-dt-move="down"]').disabled = !onBody || sel.row >= st.rows.length - 1;
  q('[data-dt-move="left"]').disabled = sel.col <= 0;
  q('[data-dt-move="right"]').disabled = sel.col >= st.align.length - 1;
  q('[data-dt-delete="row"]').disabled = !onBody || st.rows.length <= 1;
  q('[data-dt-delete="col"]').disabled = st.align.length <= 1;
}

// ── Structure operations ──────────────────────────────────────────────────────

function afterStructureChange(formEl) {
  clampSelection(formEl._dt);
  renderGrid(formEl);
  syncTableState(formEl);
  formEl._refreshSaveState?.();
}

function addRow(formEl) {
  const st = formEl._dt;
  st.rows.push(Array.from({ length: st.align.length }, () => ''));
  st.selected = { row: st.rows.length - 1, col: st.selected.col };
  afterStructureChange(formEl);
}

function addColumn(formEl) {
  const st = formEl._dt;
  st.align.push('left');
  st.header.push(`Column ${st.header.length + 1}`);
  st.rows.forEach(r => r.push(''));
  st.selected = { row: -1, col: st.align.length - 1 };
  afterStructureChange(formEl);
}

function moveSelected(formEl, dir) {
  const st = formEl._dt;
  const sel = st.selected;
  if (dir === 'up' || dir === 'down') {
    const j = sel.row + (dir === 'up' ? -1 : 1);
    if (sel.row < 0 || j < 0 || j >= st.rows.length) return;
    [st.rows[sel.row], st.rows[j]] = [st.rows[j], st.rows[sel.row]];
    sel.row = j; // the selected row travels with the move
  } else {
    const j = sel.col + (dir === 'left' ? -1 : 1);
    if (j < 0 || j >= st.align.length) return;
    for (const arr of [st.align, st.header, ...st.rows]) [arr[sel.col], arr[j]] = [arr[j], arr[sel.col]];
    sel.col = j;
  }
  afterStructureChange(formEl);
}

function deleteSelected(formEl, what) {
  const st = formEl._dt;
  const sel = st.selected;
  if (what === 'row') {
    if (sel.row < 0 || st.rows.length <= 1) return;
    st.rows.splice(sel.row, 1);
  } else {
    if (st.align.length <= 1) return;
    st.align.splice(sel.col, 1);
    st.header.splice(sel.col, 1);
    st.rows.forEach(r => r.splice(sel.col, 1));
  }
  afterStructureChange(formEl);
}

// ── Wiring ────────────────────────────────────────────────────────────────────

function wireTableEditor(formEl) {
  formEl.addEventListener('click', e => {
    const editRow = e.target.closest('[data-edit-table-row]');
    if (editRow) {
      beginChildNavigation(formEl, { type: 'edit-table-row', row: parseInt(editRow.dataset.editTableRow, 10) });
      return;
    }
    const cellEl = e.target.closest('[data-dt-cell-at]');
    if (cellEl) {
      const [row, col] = cellEl.dataset.dtCellAt.split(':').map(n => parseInt(n, 10));
      formEl._dt.selected = { row, col };
      renderGrid(formEl);
      return;
    }
    const add = e.target.closest('[data-dt-add]');
    if (add) { (add.dataset.dtAdd === 'row' ? addRow : addColumn)(formEl); return; }
    const move = e.target.closest('[data-dt-move]');
    if (move) { if (!move.disabled) moveSelected(formEl, move.dataset.dtMove); return; }
    const del = e.target.closest('[data-dt-delete]');
    if (del) { if (!del.disabled) deleteSelected(formEl, del.dataset.dtDelete); return; }
  });
}

// Initialise state. Storage (seeded by the opener, or carrying in-flight edits
// across a replay) wins over the markdown-derived fallback. Awaiting the get
// also sequences us behind form.js's storage hydration (FIFO), so
// resetDirtyBaseline below snapshots AFTER hydration set input values.
async function initStateFromStorage(formEl, fallback, file, uuid) {
  let table = fallback;
  try {
    const res = await chrome.storage.local.get(STORAGE_KEY);
    const raw = res?.[STORAGE_KEY]?.tableState;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.align) && parsed.align.length) table = parsed;
    }
  } catch { /* fall back to markdown-derived state */ }
  formEl._dt = { uuid, file, selected: { row: -1, col: 0 }, align: table.align, header: table.header, rows: table.rows };
}

function seedStorage(table) {
  const { align, header, rows } = table;
  return chrome.storage.local.set({ [STORAGE_KEY]: { tableState: JSON.stringify({ align, header, rows }) } });
}

// ── Openers ───────────────────────────────────────────────────────────────────

registerFormAction('openCreateDataTable', async ({ container, insertAtIndex } = {}) => {
  if (!container?.file) return;
  const initial = starterTable();
  if (!isFormReplay()) await seedStorage(initial);

  const { formEl } = await createForm('editDataTable');
  if (!formEl) return;
  formEl.dataset.mode = 'create';
  // Parent container this table will be spliced into (kind/uuid/file).
  formEl.dataset.parentKind = container.kind;
  formEl.dataset.parentUuid = container.uuid;
  formEl.dataset.parentFile = container.file;
  formEl.dataset.insertAtIndex = insertAtIndex == null ? '' : String(insertAtIndex);
  formEl.dataset.tableUuid = '';
  formEl.dataset.containerFile = container.file;
  formEl.dataset.componentNoun = 'data table';
  formEl._componentSaver = () => saveDataTableForRow(formEl);

  const heading = formEl.querySelector('[data-dt-heading]');
  if (heading) heading.textContent = 'Add data table';
  formEl.parentElement?.querySelector('[data-delete-table-btn]')?.style.setProperty('display', 'none');

  await initStateFromStorage(formEl, initial, container.file, null);
  wireTableEditor(formEl);
  renderGrid(formEl);
  syncTableState(formEl);
  resetDirtyBaseline(formEl);
});

registerFormAction('openEditDataTable', async ({ uuid, file } = {}) => {
  if (!uuid || !file) return;
  let md;
  try {
    // Backfill + persist any missing table UUIDs before reading, so
    // pre-existing pipe tables become editable on open.
    md = await fetchFileMigratingIdentity(file);
  } catch (e) {
    alert('Failed to load file: ' + e.message);
    return;
  }
  const tbl = getDataTableByUUID(md, uuid);
  if (!tbl) { alert('Data table not found.'); return; }
  const fallback = { align: tbl.align, header: tbl.header, rows: tbl.rows };
  if (!isFormReplay()) await seedStorage(fallback);

  const { formEl } = await createForm('editDataTable');
  if (!formEl) return;
  formEl.dataset.mode = 'edit';
  formEl.dataset.tableUuid = uuid;
  formEl.dataset.containerFile = file;
  formEl.dataset.componentNoun = 'data table';
  formEl._componentSaver = () => saveDataTableForRow(formEl);

  const heading = formEl.querySelector('[data-dt-heading]');
  if (heading) heading.textContent = 'Edit data table';
  setCrumbLabel('Data table');

  await initStateFromStorage(formEl, fallback, file, uuid);
  wireTableEditor(formEl);
  renderGrid(formEl);
  syncTableState(formEl);
  resetDirtyBaseline(formEl);
});

// ── Persistence ───────────────────────────────────────────────────────────────

// Build the brand-new table and splice it into the parent container at the
// chosen index — persistNewTabsGroup's shape, with a 'table' component.
async function persistNewDataTable(formEl, onProgress = () => {}) {
  const st = formEl._dt;
  const parent = {
    kind: formEl.dataset.parentKind,
    uuid: formEl.dataset.parentUuid,
    file: formEl.dataset.parentFile,
  };
  if (!getComponentContainer(parent.kind)) { alert('Unknown parent container.'); return null; }

  const uuid = generateUUID();
  const insertAtRaw = formEl.dataset.insertAtIndex;
  const insertAt = insertAtRaw === '' || insertAtRaw == null ? null : parseInt(insertAtRaw, 10);
  await spliceIntoContainer(parent, insertAt,
    [{ kind: 'table', tbl: { uuid, align: st.align, header: st.header, rows: st.rows } }], onProgress);
  return { uuid, file: parent.file };
}

// Flip the create form into an edit form in place — mirrors
// transitionTabsCreateToEdit.
async function transitionTableCreateToEdit(formEl, uuid, file) {
  formEl.dataset.mode = 'edit';
  formEl.dataset.tableUuid = uuid;
  formEl.dataset.containerFile = file;
  formEl._dt.uuid = uuid;
  replaceCurrentOpener('openEditDataTable', { uuid, file });
  const heading = formEl.querySelector('[data-dt-heading]');
  if (heading) heading.textContent = 'Edit data table';
  setCrumbLabel('Data table');
  formEl.parentElement?.querySelector('[data-delete-table-btn]')?.style.removeProperty('display');
  syncTableState(formEl);
  await seedStorage(formEl._dt);
  resetDirtyBaseline(formEl);
}

// Whole-table save, last-write-wins (known v1 limitation — module header).
async function persistDataTableEdit(formEl, onProgress = () => {}) {
  const st = formEl._dt;
  const file = formEl.dataset.containerFile;
  const uuid = formEl.dataset.tableUuid;

  let found = true;
  await githubFetchAndPushFile(file, onProgress, md => {
    if (!getDataTableByUUID(md, uuid)) { found = false; return md; }
    return replaceDataTableByUUID(md, uuid, buildDataTable(uuid, st.align, st.header, st.rows));
  });
  if (!found) {
    alert(`This data table was deleted in another session — your changes can't be saved.`);
    return null;
  }
  await seedStorage(st);
  resetDirtyBaseline(formEl);
  return { uuid, file };
}

async function saveDataTable(formEl, onProgress = () => {}) {
  if (formEl.dataset.mode === 'create') {
    const res = await persistNewDataTable(formEl, onProgress);
    if (!res) return null;
    await transitionTableCreateToEdit(formEl, res.uuid, res.file);
    return res;
  }
  return persistDataTableEdit(formEl, onProgress);
}

// The grid form is the PARENT of the per-row form. The save-gate calls this to
// persist (create → splice + transition; edit → whole-table rewrite) before
// opening a row child, so the table always has a uuid in the file by then.
// The `edit-table-row` branch re-reads the saved identity from the grid form's
// dataset (tableUuid/containerFile), so for that flow only the truthiness of
// this return matters; the container payload is kept for the saver contract.
async function saveDataTableForRow(formEl, onProgress = () => {}) {
  const res = await saveDataTable(formEl, onProgress);
  if (!res) return null;
  return { container: { kind: 'table', uuid: res.uuid, file: res.file }, formEl };
}

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
  formEl.querySelectorAll('[data-dt-align]').forEach(label => {
    const input = label.querySelector('input');
    if (input) input.checked = (st.align[st.selected.col] === label.dataset.dtAlign);
  });
}

// The active cell parsed into { text, capture } (exclusive — see dataTables.js).
function activeCell(formEl) {
  const st = formEl._dt;
  return parseCellCapture(cellAt(st, st.selected.row, st.selected.col));
}

// The cell-container ref the save-gate uses: a body cell is a `data-table-cell`
// container identified by `tableUuid@row,col`. Kept current on formEl.dataset so
// containerFromForm (guides.js) resolves to the SELECTED cell.
function cellRefOf(tableUuid, row, col) { return `${tableUuid}@${row},${col}`; }
function selectedCellRef(formEl) {
  const st = formEl._dt;
  return cellRefOf(formEl.dataset.tableUuid, st.selected.row, st.selected.col);
}

// Render the active cell's Components group: the capture card (Edit → the shared
// editCaptureComponent form, which owns size + delete) when the cell holds one,
// otherwise the standard "+ Insert capture" empty-state button. Header cells
// (row -1) never hold captures, so the group stays empty there.
function renderRowComponents(formEl) {
  const host = formEl.querySelector('[data-dtr-components]');
  if (!host) return;
  const onHeader = formEl._dt.selected.row === -1;
  const { capture } = activeCell(formEl);
  host.innerHTML = onHeader ? '' : (capture
    ? captureComponentCard({
        thumbSrc: assetCdnUrl('docs/assets/' + capture.lightFilename),
        btnAttr: `data-edit-component="${escapeHtml(capture.uuid ?? '')}"`,
      })
    : `<button type="button" class="mb-insert-component__empty" data-dtr-insert-capture><span class="mb-adm-empty__icon">+</span> Insert capture</button>`);
  // Keep the save-gate's container identity pointed at the selected cell.
  formEl.dataset.editUuid = selectedCellRef(formEl);
}

// Push the active cell into the editor — text editor when the cell is text (or a
// header), capture card when it holds a capture (exclusive) — and light its
// alignment. The text editor is hidden while a capture occupies the cell.
function loadRowCell(formEl) {
  const st = formEl._dt;
  const { text, capture } = activeCell(formEl);
  const onHeader = st.selected.row === -1;
  const hasCapture = !!capture && !onHeader;

  const textGroup = formEl.querySelector('[data-dtr-text-group]');
  if (textGroup) textGroup.hidden = hasCapture;
  // Header cells (column titles) can't hold captures — hide the whole group.
  const compGroup = formEl.querySelector('[data-components-row]');
  if (compGroup) compGroup.hidden = onHeader;
  if (!hasCapture) {
    const ta = formEl.querySelector('[data-dt-cell]');
    if (ta) { ta.value = text; syncSurfaceFromTextarea(ta); }
  }
  renderRowComponents(formEl);
  refreshRowAlign(formEl);
}

// "+ Insert capture" → captures-only menu → the shared capture flows, routed
// through the component save-gate (beginChildNavigation flushes the whole-table
// state first). Inserting into a text cell replaces its text (exclusive model).
function openCellCaptureMenu(formEl, anchorBtn) {
  const hasText = !!activeCell(formEl).text.trim();
  const dispatch = (kind) => {
    if (hasText && !confirm('This cell has text. Replace it with a capture?')) return;
    beginChildNavigation(formEl, { type: 'insert', kind, insertAt: 0 });
  };
  openInsertMenu(anchorBtn, 0, {
    captureNew: () => dispatch('capture-new'),
    captureLibrary: () => dispatch('capture-library'),
  }, { capturesOnly: true });
}

function wireRowEditor(formEl) {
  // The rich editor re-dispatches surface edits as bubbling `input` events on
  // its textarea, so this listener covers the in-view text editor.
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
    // The capture card's Edit → shared edit-capture flow (size + delete live in
    // editCaptureComponent), routed through the save-gate like every container.
    const editCap = e.target.closest('[data-edit-component]');
    if (editCap) {
      beginChildNavigation(formEl, { type: 'edit-capture', uuid: editCap.dataset.editComponent });
      return;
    }
    const insertCap = e.target.closest('[data-dtr-insert-capture]');
    if (insertCap) { openCellCaptureMenu(formEl, insertCap); return; }
  });
}

// Whole-table save used as the row editor's component save-gate hook: flush the
// in-flight table to the draft, then hand back the SELECTED cell as the container
// the pending child (capture insert / edit) will act on.
async function saveRowForComponent(formEl) {
  const res = await persistDataTableEdit(formEl);
  if (!res) return null;
  return {
    container: { kind: 'data-table-cell', uuid: selectedCellRef(formEl), file: formEl.dataset.containerFile },
    formEl,
  };
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
  // The row editor sources its table from the FILE on every open (incl. replay):
  // the save-gate flushes any in-flight whole-table edits before any navigation
  // away, so the file is authoritative, and cell captures committed immediately
  // by editCaptureComponent / the capture flows always round-trip. Seeding
  // storage from the file keeps the grid's back-navigation re-render correct.
  await seedStorage(fallback);

  const { formEl } = await createForm('editDataTableRow');
  if (!formEl) return;
  formEl.dataset.mode = 'edit';
  formEl.dataset.tableUuid = uuid;
  formEl.dataset.containerFile = file;
  // Make the row editor a component host: each cell is a `data-table-cell`
  // container (resolved per-selection via dataset.editUuid in renderRowComponents),
  // and the save-gate flushes the whole table before opening a capture child.
  formEl.dataset.componentContainerKind = 'data-table-cell';
  formEl.dataset.componentNoun = 'data table';
  formEl._componentSaver = () => saveRowForComponent(formEl);

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

// ── data-table-cell component container ─────────────────────────────────────
//
// Each body cell is a leaf container holding 0-or-1 capture. The cell is keyed
// by `tableUuid@row,col` so the registry's (md, uuid) contract carries the
// coordinates. Insert / edit / delete go through the shared capture flows +
// editCaptureComponent, which commit to the draft via these helpers. After any
// commit, the live row editor (if mounted) is re-hydrated from the file so its
// in-memory `_dt` — the whole-table save's source of truth — never goes stale.

function parseCellRef(ref) {
  const [tableUuid, rc = ''] = String(ref).split('@');
  const [row, col] = rc.split(',').map(n => parseInt(n, 10));
  return { tableUuid, row, col };
}

function readCellComponents(md, cellRef) {
  const { tableUuid, row, col } = parseCellRef(cellRef);
  const tbl = getDataTableByUUID(md, tableUuid);
  if (!tbl) return { description: '', components: [] };
  const cellStr = row === -1 ? tbl.header[col] : tbl.rows[row]?.[col];
  const { capture } = parseCellCapture(cellStr ?? '');
  return { description: '', components: capture ? [{ kind: 'capture', cap: capture }] : [] };
}

function writeCellBody(md, cellRef, _description, components) {
  const { tableUuid, row, col } = parseCellRef(cellRef);
  const tbl = getDataTableByUUID(md, tableUuid);
  if (!tbl) return md;
  const cap = components.find(c => c.kind === 'capture')?.cap;
  const cellStr = cap ? serializeCellCapture(cap) : '';
  const header = tbl.header.slice();
  const rows = tbl.rows.map(r => r.slice());
  if (row === -1) header[col] = cellStr; else if (rows[row]) rows[row][col] = cellStr;
  return replaceDataTableByUUID(md, tableUuid, buildDataTable(tableUuid, tbl.align, header, rows));
}

function cellExists(md, cellRef) {
  return !!getDataTableByUUID(md, parseCellRef(cellRef).tableUuid);
}

// Re-read the table from the file into the live row editor's `_dt` and re-render.
// Used after a capture commit so the whole-table save can't clobber it. A no-op
// when the row editor isn't the mounted form (e.g. delete happens from the
// editCaptureComponent child — the row editor re-reads the file on navigate-back).
// `select` (the committed cell's coords) is surfaced so an insert lands the user
// on the cell they just filled rather than the replay's reset column.
async function refreshLiveRowFormFromFile(select) {
  const formEl = document.getElementById('edit-data-table-row-form');
  if (!formEl?.isConnected || !formEl._dt) return;
  const md = await fetchFileMigratingIdentity(formEl.dataset.containerFile);
  const tbl = getDataTableByUUID(md, formEl.dataset.tableUuid);
  if (!tbl) return;
  const st = formEl._dt;
  st.align = tbl.align; st.header = tbl.header; st.rows = tbl.rows;
  if (select && Number.isInteger(select.col)) st.selected = { row: select.row, col: select.col };
  clampSelection(st);
  syncTableState(formEl);
  await seedStorage(st);
  renderRowStrip(formEl);
  loadRowCell(formEl);
  resetDirtyBaseline(formEl);
}

registerComponentContainer('data-table-cell', {
  readComponents: readCellComponents,
  writeBody: writeCellBody,
  exists: cellExists,
  mutate: async (container, transform, onProgress) => {
    await githubFetchAndPushFile(container.file, onProgress || (() => {}), md => {
      if (!cellExists(md, container.uuid)) throw new Error('Parent table no longer exists.');
      const { description, components } = readCellComponents(md, container.uuid);
      const next = transform(components, description) || components;
      return writeCellBody(md, container.uuid, description, next);
    });
    await refreshLiveRowFormFromFile(parseCellRef(container.uuid));
  },
});

// ── Form actions ──────────────────────────────────────────────────────────────

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

registerFormAction('submitEditDataTable', async ({ formEl, content }) => {
  const btn = content.querySelector('[data-save-state]');
  setButtonBusy(btn, 'Saving…');
  try {
    await saveDataTable(formEl, s => setButtonBusy(btn, s));
    formEl._refreshSaveState?.();
  } catch (e) {
    formEl._refreshSaveState?.();
    alert('Failed to save data table: ' + e.message);
  }
});

registerFormAction('deleteDataTable', async ({ formEl, content }) => {
  const uuid = formEl.dataset.tableUuid;
  const file = formEl.dataset.containerFile;
  if (!uuid || !file) return;
  if (!confirm('Delete this data table?')) return;
  const btn = content?.querySelector('[data-action="deleteDataTable"]');
  const snap = snapshotButton(btn);
  setButtonBusy(btn, 'Deleting…'); // disable immediately — no double-click window
  try {
    await githubFetchAndPushFile(file, s => setButtonBusy(btn, s), md => deleteDataTableByUUID(md, uuid));
    await chrome.storage.local.remove(STORAGE_KEY);
    await navigateBack();
  } catch (e) {
    restoreButton(btn, snap);
    alert('Failed to delete data table: ' + e.message);
  }
});
