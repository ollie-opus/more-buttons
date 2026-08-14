/**
 * dataTablesEditor.js — the "Data table" overlay for a pipe-table component.
 *
 * A single spreadsheet-style form: a grid with a row-number gutter and
 * lettered column handles (gsheets chrome), one rich-text toolbar pinned at
 * the top, and in-place cell editing. Clicking a cell selects it; typing,
 * Enter/F2 or double-click edits it in the cell — the shared rich-text
 * editor's surface + textarea nodes are physically moved into the cell for
 * the duration of the edit and parked (hidden) back under the toolbar after.
 * Structure ops (insert / move / delete rows and columns, per-column
 * alignment) live in context menus on the gutter / handles / cells
 * (right-click or the hover ▾), built from dataTableGridModel.js.
 *
 * Editor state lives in formEl._dt, mirrored into a hidden named input
 * (`tableState`, JSON) for dirty tracking — the grid itself is deliberately
 * UNNAMED so selecting cells never false-dirties the form
 * (contentTabsEditor's pattern). The cell-editor textarea is unnamed too.
 * The Text wrapping radios (`textWrap`) are the only other named inputs; the
 * flag also rides inside tableState, which stays authoritative.
 *
 * Save model: the TABLE is whole-table last-write-wins (same v1 trade-off as
 * content tabs). A single twist: a body cell may hold ONE capture, and captures
 * follow the app-wide immediate-save Components model. So each cell is exposed
 * as a tiny `data-table-cell` component container (0-or-1 capture); inserting /
 * editing / deleting a capture commits straight to the draft via the shared
 * capture flows + editCaptureComponent, exactly like every other component.
 * The grid form therefore carries the standard component save-gate
 * (_componentSaver flushes the whole-table state before any child navigation)
 * and re-hydrates its table from the file, so the two save models stay
 * consistent.
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
  parseCellMedia, serializeCellCapture, serializeCellImage,
} from './dataTables.js';
import {
  clampSelection, insertRow, insertColumn, moveRow, moveColumn,
  deleteRow, deleteColumn, setColumnAlign, moveSelection,
  cellAt, setCellAt, collapseRange, normalizeRange, isMultiCellRange,
  extendSelection, extendSelectionTo, clearRange, rangeToTsv, parseTsv, applyPaste,
  selectRowRange, selectColumnRange, fullRowRange, fullColumnRange,
  rowMenuItems, columnMenuItems, cellMenuItems,
} from './dataTableGridModel.js';
import { spliceIntoContainer, beginChildNavigation } from './guides.js';
import { openPopupMenu, openInsertMenu, isPopupMenuOpen } from './insertMenu.js';
import { renderSurface, clearArmed, paintLabels, setMode } from './richTextEditor.js';
import { placeCaret } from './richEditorMapping.js';
import { renderDocHtml } from './markdownInline.js';
import { escapeHtml } from './cardRenderer.js';
import { assetCdnUrl } from './repoClient.js';

const STORAGE_KEY = 'moreButtonsEditDataTable';

// ── Editor state ──────────────────────────────────────────────────────────────
//
// formEl._dt = { uuid, file, selected: {row, col}, align, header, rows }
//   - selected.row === -1 addresses the header row; a cell is ALWAYS selected
//     (default header 0).
// formEl._dtEdit = { row, col, original } while a cell is being edited in place.
// formEl._dtRte = the shared rich-text editor instance (wired once on open).

function starterTable() {
  return {
    align: ['left', 'left'],
    header: ['Column 1', 'Column 2'],
    rows: [['', ''], ['', '']],
    wrap: true,
  };
}

// The selected cell parsed into { text, capture, image } (exclusive —
// dataTables.js). Header cells never hold media.
function mediaOfCell(st, row, col) {
  const { text, capture, image } = parseCellMedia(cellAt(st, row, col));
  if (row === -1) return { text, capture: null, image: null };
  return { text, capture, image };
}

// Mirror the table into the single named input that drives dirty tracking
// (and capture-free storage round-trips, via the generic save step). The
// textWrap radios are ALSO named, but `wrap` lives in this JSON too, so
// tableState alone carries the full table across storage round-trips.
function syncTableState(formEl) {
  const input = formEl.querySelector('[name="tableState"]');
  const { align, header, rows, wrap } = formEl._dt;
  if (input) input.value = JSON.stringify({ align, header, rows, wrap });
}

// Reflect the state's wrap flag into the Text wrapping radio group.
function syncWrapControls(formEl) {
  const wrap = formEl._dt?.wrap !== false;
  formEl.querySelectorAll('[name="textWrap"]').forEach(input => {
    input.checked = (input.value === (wrap ? 'enabled' : 'disabled'));
  });
}

// The cell-container ref the save-gate uses: a body cell is a `data-table-cell`
// container identified by `tableUuid@row,col`. Kept current on formEl.dataset
// (renderGrid) so containerFromForm (guides.js) resolves to the SELECTED cell.
function cellRefOf(tableUuid, row, col) { return `${tableUuid}@${row},${col}`; }
function selectedCellRef(formEl) {
  const st = formEl._dt;
  return cellRefOf(formEl.dataset.tableUuid, st.selected.row, st.selected.col);
}

// ── Rendering ─────────────────────────────────────────────────────────────────

// Spreadsheet column letters: 0 → A, 25 → Z, 26 → AA…
function colLetter(i) {
  let s = '';
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
}

function cellPreview(text) {
  // A capture cell holds dual (light+dark) inline image markdown; preview it as
  // a single light-mode thumbnail rather than letting the mini-renderer stack
  // both themed images. An image cell is a single file — same thumbnail.
  const { capture, image } = parseCellMedia(text ?? '');
  if (capture || image) {
    const file = capture ? capture.lightFilename : image.filename;
    return `<img class="mb-dt-cell__capture" src="${escapeHtml(assetCdnUrl('docs/assets/' + file))}" alt="" loading="lazy" />`;
  }
  return renderDocHtml(text ?? '') || '<span class="mb-dt-cell__empty">…</span>';
}

// The top toolbar is inert while the selected cell holds media (there is
// no text to format; media ops live in the cell menu).
function refreshToolbarState(formEl) {
  const bar = formEl.querySelector('[data-dt-toolbar]');
  if (!bar) return;
  const st = formEl._dt;
  const { capture, image } = mediaOfCell(st, st.selected.row, st.selected.col);
  const media = capture || image;
  bar.classList.toggle('mb-dt-toolbar--disabled', !!media);
  // Insert Media sits outside .mb-rte__btns (and header cells keep the text
  // toolbar live), so its state is per-button: a cell holds 0-or-1 media item
  // and header cells never hold one.
  const btn = formEl._dtInsertCaptureBtn;
  if (btn) btn.disabled = !!media || st.selected.row === -1;
}

function renderGrid(formEl) {
  const grid = formEl.querySelector('[data-dt-grid]');
  const st = formEl._dt;
  if (!grid || !st) return;
  if (formEl._dtEdit) return; // never re-render mid-edit — callers commit first
  const sel = st.selected;
  const rect = normalizeRange(st);
  const hasRange = isMultiCellRange(st);
  const colActive = c => (hasRange ? c >= rect.c0 && c <= rect.c1 : sel.col === c);
  const rowActive = r => (hasRange ? r >= rect.r0 && r <= rect.r1 : sel.row === r);

  const menuBtn = label =>
    `<button type="button" class="mb-dt-handle__menu" data-dt-handle-menu tabindex="-1" aria-haspopup="menu" aria-label="${label} options"><span class="more-buttons-icon">arrow_drop_down</span></button>`;

  const chromeRow = '<tr>'
    + '<th class="mb-dt-corner"></th>'
    + st.header.map((_, c) =>
      `<th class="mb-dt-handle${colActive(c) ? ' mb-dt-handle--active' : ''}" data-dt-col-handle="${c}"><span>${colLetter(c)}</span>${menuBtn(`Column ${colLetter(c)}`)}</th>`).join('')
    + '</tr>';

  // The markdown header row displays as plain row 1 (body rows are 2..n); its
  // pinned/structural nature only shows in the menus.
  const gutter = row => {
    const cls = 'mb-dt-gutter' + (rowActive(row) ? ' mb-dt-gutter--active' : '');
    const label = `Row ${row + 2}`;
    return `<th class="${cls}" data-dt-row-handle="${row}" aria-label="${label}"><span>${row + 2}</span>${menuBtn(label)}</th>`;
  };

  const cell = (row, col, text) => {
    const tag = row === -1 ? 'th' : 'td';
    const selected = sel.row === row && sel.col === col;
    const inRange = hasRange && row >= rect.r0 && row <= rect.r1 && col >= rect.c0 && col <= rect.c1;
    const cls = 'mb-dt-cell'
      + (selected ? ' mb-dt-cell--selected' : '')
      + (inRange ? ' mb-dt-cell--in-range' : '');
    // The released range draws a thin blue perimeter, gsheets-style: each edge
    // cell carries an inset shadow segment on its outward side(s).
    const edges = [];
    if (inRange) {
      if (row === rect.r0) edges.push('inset 0 1px 0 0 var(--mb-acc-info)');
      if (row === rect.r1) edges.push('inset 0 -1px 0 0 var(--mb-acc-info)');
      if (col === rect.c0) edges.push('inset 1px 0 0 0 var(--mb-acc-info)');
      if (col === rect.c1) edges.push('inset -1px 0 0 0 var(--mb-acc-info)');
    }
    const styles = edges.length ? [`box-shadow: ${edges.join(', ')}`] : [];
    // Paint the column's markdown alignment; published tables align header cells too.
    const align = st.align[col];
    if (align === 'center' || align === 'right') styles.push(`text-align: ${align}`);
    const style = styles.length ? ` style="${styles.join('; ')}"` : '';
    return `<${tag} class="${cls}" role="${row === -1 ? 'columnheader' : 'gridcell'}"${selected ? ' aria-selected="true"' : ''}${style} data-dt-cell-at="${row}:${col}">${cellPreview(text)}</${tag}>`;
  };

  grid.innerHTML =
    `<thead>${chromeRow}<tr>${gutter(-1)}${st.header.map((h, c) => cell(-1, c, h)).join('')}</tr></thead>` +
    `<tbody>${st.rows.map((r, ri) => `<tr>${gutter(ri)}${r.map((v, c) => cell(ri, c, v)).join('')}</tr>`).join('')}</tbody>`;
  paintLabels(grid); // colour any label pills in the rendered cell previews
  syncWrapControls(formEl);
  // Keep the save-gate's container identity pointed at the selected cell.
  formEl.dataset.editUuid = selectedCellRef(formEl);
  refreshToolbarState(formEl);
}

// Mid-drag range highlight WITHOUT an innerHTML rebuild — rebuilding on every
// pointerover would destroy the node under the cursor mid-gesture. The full
// renderGrid on pointerup reconciles everything else (gutters, editUuid,
// toolbar state).
function paintRange(formEl) {
  const st = formEl._dt;
  const rect = normalizeRange(st);
  const hasRange = isMultiCellRange(st);
  formEl.querySelectorAll('[data-dt-cell-at]').forEach(el => {
    const [row, col] = el.dataset.dtCellAt.split(':').map(n => parseInt(n, 10));
    el.classList.toggle('mb-dt-cell--in-range',
      hasRange && row >= rect.r0 && row <= rect.r1 && col >= rect.c0 && col <= rect.c1);
    const selected = row === st.selected.row && col === st.selected.col && !el.classList.contains('mb-dt-cell--editing');
    el.classList.toggle('mb-dt-cell--selected', selected);
    if (selected) el.setAttribute('aria-selected', 'true');
    else el.removeAttribute('aria-selected');
    el.style.boxShadow = ''; // the range perimeter only appears on release (renderGrid)
  });
  formEl.querySelectorAll('[data-dt-col-handle]').forEach(el => {
    const c = parseInt(el.dataset.dtColHandle, 10);
    el.classList.toggle('mb-dt-handle--active', hasRange ? c >= rect.c0 && c <= rect.c1 : c === st.selected.col);
  });
  formEl.querySelectorAll('[data-dt-row-handle]').forEach(el => {
    const r = parseInt(el.dataset.dtRowHandle, 10);
    el.classList.toggle('mb-dt-gutter--active', hasRange ? r >= rect.r0 && r <= rect.r1 : r === st.selected.row);
  });
}

// Selection moved but the table structure/content didn't: repaint classes and
// selection-tracking chrome WITHOUT an innerHTML rebuild. Plain clicks must go
// through here, not renderGrid — a rebuild detaches the clicked node, so the
// browser dispatches the paired dblclick on a detached target and it never
// bubbles to the form (dblclick-to-edit would silently never fire).
function syncSelectionChrome(formEl) {
  paintRange(formEl);
  formEl.dataset.editUuid = selectedCellRef(formEl);
  refreshToolbarState(formEl);
}

function scrollSelectedIntoView(formEl) {
  formEl.querySelector('.mb-dt-cell--selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function focusGrid(formEl) {
  formEl.querySelector('[data-dt-grid-wrap]')?.focus({ preventScroll: true });
}

// ── In-place editing state machine ────────────────────────────────────────────

// Park the shared editor nodes back under the toolbar, hidden.
function parkEditor(formEl) {
  const rte = formEl._dtRte;
  const wrapper = formEl.querySelector('[data-dt-toolbar] .mb-rte');
  if (!rte || !wrapper) return;
  wrapper.append(rte.surface, rte.textarea);
  rte.surface.hidden = true;
  rte.textarea.hidden = true;
  // The editor is shared across cells: drop the parked content and any armed
  // format state so nothing from this cell can leak into the next edit. The
  // textarea is unnamed, so clearing it never touches dirty tracking.
  rte.surface.innerHTML = '';
  rte.textarea.value = '';
  clearArmed(rte);
}

// Begin editing the SELECTED cell: move the rich editor's surface + textarea
// into the cell's <td>. caret: 'end' | 'all'. replaceWith: type-to-replace —
// the cell starts over with that text (already a dirtying edit).
function startEditing(formEl, { caret = 'end', replaceWith = null } = {}) {
  const st = formEl._dt;
  const rte = formEl._dtRte;
  if (!st || !rte || formEl._dtEdit) return;
  const { row, col } = st.selected;
  const raw = cellAt(st, row, col);
  const media = mediaOfCell(st, row, col);
  if (media.capture || media.image) return; // media cells: no text editing
  const td = formEl.querySelector(`[data-dt-cell-at="${row}:${col}"]`);
  if (!td) return;
  if (st.anchor) { collapseRange(st); paintRange(formEl); } // editing collapses a range

  formEl._dtEdit = { row, col, original: raw };
  const value = replaceWith != null ? replaceWith : raw;
  td.innerHTML = '';
  td.classList.add('mb-dt-cell--editing');
  td.classList.remove('mb-dt-cell--selected');
  // Seed + render BEFORE relocating: the surface must be re-rendered from this
  // cell's value while the shared editor still holds no live selection, and via
  // the direct rte ref (a closest('.mb-rte') lookup breaks once relocated).
  rte.textarea.value = value;
  renderSurface(rte);
  td.append(rte.surface, rte.textarea);
  rte.surface.hidden = rte.mode !== 'rich';
  rte.textarea.hidden = rte.mode === 'rich';
  if (replaceWith != null) {
    setCellAt(st, row, col, value);
    syncTableState(formEl);
    formEl._refreshSaveState?.();
  }
  const [s, e] = caret === 'all' ? [0, value.length] : [value.length, value.length];
  if (rte.mode === 'rich') {
    rte.surface.focus();
    placeCaret(rte.surface, s, e);
  } else {
    rte.textarea.focus();
    rte.textarea.setSelectionRange(s, e);
  }
}

// The edited value is live-synced into _dt on every keystroke, so committing
// is UI-only: park the editor nodes and restore the cell preview.
function commitEditing(formEl) {
  if (!formEl._dtEdit) return;
  formEl._dtEdit = null;
  parkEditor(formEl);
  renderGrid(formEl);
}

function cancelEditing(formEl) {
  const ed = formEl._dtEdit;
  if (!ed) return;
  setCellAt(formEl._dt, ed.row, ed.col, ed.original);
  syncTableState(formEl);
  formEl._refreshSaveState?.();
  formEl._dtEdit = null;
  parkEditor(formEl);
  renderGrid(formEl);
}

// ── Structure operations ──────────────────────────────────────────────────────

function afterStructureChange(formEl) {
  clampSelection(formEl._dt);
  renderGrid(formEl);
  syncTableState(formEl);
  formEl._refreshSaveState?.();
  scrollSelectedIntoView(formEl);
}

// ── Context menus ─────────────────────────────────────────────────────────────
//
// anchor: the ▾ / gutter / handle element (click) or {x, y} (contextmenu).
// The openers re-render the grid first (selection highlight), which detaches a
// clicked element anchor — re-resolve it in the fresh DOM before positioning.

function liveAnchor(formEl, anchor, selector) {
  if (!(anchor instanceof HTMLElement) || anchor.isConnected) return anchor;
  return formEl.querySelector(selector) ?? anchor;
}

// Opening a row menu selects the whole row (gsheets) unless the row is already
// inside a handle-selected band — then the band survives and the menu offers
// bulk ops on it.
function openRowMenu(formEl, row, anchor, opts) {
  const st = formEl._dt;
  const band = fullRowRange(st);
  if (!(band && row >= band.r0 && row <= band.r1)) selectRowRange(st, row);
  renderGrid(formEl);
  anchor = liveAnchor(formEl, anchor, `[data-dt-row-handle="${row}"]`);
  const { r0, r1 } = fullRowRange(st) ?? { r0: row, r1: row };
  const n = r1 - r0 + 1;
  openPopupMenu(anchor, rowMenuItems(st, row), id => {
    if (id === 'row-insert-above') insertRow(st, row);
    else if (id === 'row-insert-below') insertRow(st, row + 1);
    else if (id === 'row-move-up') moveRow(st, row, row - 1);
    else if (id === 'row-move-down') moveRow(st, row, row + 1);
    else if (id === 'row-delete') deleteRow(st, row);
    else if (id === 'rows-insert-above') { for (let i = 0; i < n; i++) insertRow(st, r0); }
    else if (id === 'rows-insert-below') { for (let i = 0; i < n; i++) insertRow(st, r1 + 1); }
    else if (id === 'rows-delete') { for (let i = r1; i >= r0; i--) deleteRow(st, i); }
    afterStructureChange(formEl);
    focusGrid(formEl);
  }, opts);
}

function openColumnMenu(formEl, col, anchor, opts) {
  const st = formEl._dt;
  const band = fullColumnRange(st);
  if (!(band && col >= band.c0 && col <= band.c1)) selectColumnRange(st, col);
  renderGrid(formEl);
  anchor = liveAnchor(formEl, anchor, `[data-dt-col-handle="${col}"]`);
  const { c0, c1 } = fullColumnRange(st) ?? { c0: col, c1: col };
  const n = c1 - c0 + 1;
  openPopupMenu(anchor, columnMenuItems(st, col), id => {
    if (id === 'col-insert-left') insertColumn(st, col);
    else if (id === 'col-insert-right') insertColumn(st, col + 1);
    else if (id === 'col-move-left') moveColumn(st, col, col - 1);
    else if (id === 'col-move-right') moveColumn(st, col, col + 1);
    else if (id === 'col-delete') deleteColumn(st, col);
    else if (id.startsWith('col-align-')) setColumnAlign(st, col, id.slice('col-align-'.length));
    else if (id === 'cols-insert-left') { for (let i = 0; i < n; i++) insertColumn(st, c0); }
    else if (id === 'cols-insert-right') { for (let i = 0; i < n; i++) insertColumn(st, c1 + 1); }
    else if (id === 'cols-delete') { for (let i = c1; i >= c0; i--) deleteColumn(st, i); }
    afterStructureChange(formEl);
    focusGrid(formEl);
  }, opts);
}

// Insert a capture/image into the SELECTED cell (the container the save-gate
// resolves via selectedCellRef). Shared by the cell context menu and the
// toolbar's Insert Media button. A cell is exclusively text OR media,
// so text cells confirm the replacement first.
function insertCaptureIntoSelectedCell(formEl, kind) {
  const st = formEl._dt;
  const { text, capture, image } = mediaOfCell(st, st.selected.row, st.selected.col);
  if (capture || image || st.selected.row === -1) return;
  if (text.trim() && !confirm('This cell has text. Replace it?')) return;
  beginChildNavigation(formEl, { type: 'insert', kind, insertAt: 0 });
}

function openCellMenu(formEl, row, col, anchor, opts) {
  const st = formEl._dt;
  const { capture, image } = mediaOfCell(st, row, col);
  const mediaKind = capture ? 'capture' : image ? 'image' : null;
  openPopupMenu(anchor, cellMenuItems(st, row, col, { mediaKind }), id => {
    if (id === 'cell-clear' || id === 'cell-remove-capture') {
      // Removing media is a normal unsaved edit: the whole-table save
      // writes the emptied cell, exactly what writeCellBody with no
      // components produces.
      setCellAt(st, row, col, '');
      afterStructureChange(formEl);
      focusGrid(formEl);
    } else if (id === 'cell-capture-new' || id === 'cell-capture-library' || id === 'cell-image-library') {
      // The menu-open path selected (row, col), so the selected-cell insert
      // targets exactly the right-clicked cell.
      insertCaptureIntoSelectedCell(formEl, { 'cell-capture-new': 'capture-new', 'cell-capture-library': 'capture-library', 'cell-image-library': 'image' }[id]);
    } else if (id === 'cell-edit-capture') {
      beginChildNavigation(formEl, capture
        ? { type: 'edit-capture', uuid: capture.uuid }
        : { type: 'edit-image', uuid: image.uuid });
    }
  }, opts);
}

// ── Wiring ────────────────────────────────────────────────────────────────────

function wireTableEditor(formEl) {
  const wrap = formEl.querySelector('[data-dt-grid-wrap]');
  const rte = formEl._dtRte;

  // Text wrapping toggle (gridEditor's flavor-radio pattern): the radios are
  // named, but the flag is authoritative in _dt and rides in tableState.
  formEl.addEventListener('change', e => {
    if (e.target.name !== 'textWrap') return;
    formEl._dt.wrap = e.target.value === 'enabled';
    syncTableState(formEl);
    formEl._refreshSaveState?.();
  });

  // Toolbar acts on the selected cell, gsheets-style: using any control while
  // merely selected enters edit mode with the whole cell content selected —
  // capture phase, so this runs before the button's own mousedown handler
  // (which preventDefaults to keep the selection alive).
  rte?.toolbar.addEventListener('mousedown', e => {
    if (formEl._dtEdit) return;
    if (!e.target.closest('button')) return;
    if (e.target.closest('[data-dt-insert-capture]')) return; // acts on the cell, not its text
    startEditing(formEl, { caret: 'all' });
  }, true);

  // The rich editor re-dispatches surface edits as bubbling `input` events on
  // its (relocated) textarea, so this covers both Rich and Markdown modes.
  formEl.addEventListener('input', e => {
    if (!e.target.matches?.('[data-dt-cell-editor]')) return;
    const ed = formEl._dtEdit;
    if (!ed) return;
    setCellAt(formEl._dt, ed.row, ed.col, e.target.value);
    syncTableState(formEl);
    formEl._refreshSaveState?.();
  });

  // Drag range selection. Delegated pointer events (no setPointerCapture —
  // capture retargets events to the captured element, breaking closest()
  // hit-testing on the cells). pointerdown never preventDefaults, so dblclick,
  // focus and native caret behavior are untouched; a motionless press leaves
  // moved=false and the click handler does the single-select as before.
  wrap?.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.shiftKey) return; // shift+click extends via the click handler
    if (e.target.closest('[data-dt-handle-menu], [data-dt-row-handle], [data-dt-col-handle]')) return;
    const cellEl = e.target.closest('[data-dt-cell-at]');
    if (!cellEl) return;
    const [row, col] = cellEl.dataset.dtCellAt.split(':').map(n => parseInt(n, 10));
    const ed = formEl._dtEdit;
    if (ed && ed.row === row && ed.col === col) return; // native caret placement in the RTE
    if (ed) {
      // Commit up-front so no re-render happens mid-drag. The rebuild destroys
      // the pressed cell, which can swallow the trailing click — select the
      // pressed cell here so it doesn't get lost.
      commitEditing(formEl);
      const st = formEl._dt;
      collapseRange(st);
      st.selected = { row, col };
      renderGrid(formEl);
      focusGrid(formEl);
    }
    formEl._dtDrag = { row, col, moved: false };
    window.addEventListener('pointerup', () => {
      const drag = formEl._dtDrag;
      formEl._dtDrag = null;
      if (drag?.moved) {
        // The trailing click (if any — none when released outside the grid)
        // must not collapse the range; it dispatches before timers run.
        formEl._dtSuppressClick = true;
        setTimeout(() => { formEl._dtSuppressClick = false; }, 0);
        renderGrid(formEl);
        focusGrid(formEl);
      }
    }, { once: true });
  });

  wrap?.addEventListener('pointerover', e => {
    const drag = formEl._dtDrag;
    if (!drag) return;
    const cellEl = e.target.closest('[data-dt-cell-at]');
    if (!cellEl) return;
    const [row, col] = cellEl.dataset.dtCellAt.split(':').map(n => parseInt(n, 10));
    if (!drag.moved && row === drag.row && col === drag.col) return;
    const st = formEl._dt;
    if (!drag.moved) {
      drag.moved = true;
      st.anchor = { row: drag.row, col: drag.col };
      st.selected = { row: drag.row, col: drag.col };
    }
    extendSelectionTo(st, row, col);
    paintRange(formEl); // class toggling only — no innerHTML rebuild mid-drag
  });

  formEl.addEventListener('click', e => {
    const menuBtn = e.target.closest('[data-dt-handle-menu]');
    if (menuBtn) {
      commitEditing(formEl);
      const colHandle = menuBtn.closest('[data-dt-col-handle]');
      const rowHandle = menuBtn.closest('[data-dt-row-handle]');
      if (colHandle) openColumnMenu(formEl, parseInt(colHandle.dataset.dtColHandle, 10), menuBtn);
      else if (rowHandle) openRowMenu(formEl, parseInt(rowHandle.dataset.dtRowHandle, 10), menuBtn);
      return;
    }
    // Clicking a gutter / handle selects the whole row / column, gsheets-style
    // (shift+click extends the band). Menus live on right-click and the ▾.
    const rowHandle = e.target.closest('[data-dt-row-handle]');
    if (rowHandle) {
      commitEditing(formEl);
      selectRowRange(formEl._dt, parseInt(rowHandle.dataset.dtRowHandle, 10), e.shiftKey);
      renderGrid(formEl);
      focusGrid(formEl);
      return;
    }
    const colHandle = e.target.closest('[data-dt-col-handle]');
    if (colHandle) {
      commitEditing(formEl);
      selectColumnRange(formEl._dt, parseInt(colHandle.dataset.dtColHandle, 10), e.shiftKey);
      renderGrid(formEl);
      focusGrid(formEl);
      return;
    }
    const cellEl = e.target.closest('[data-dt-cell-at]');
    if (cellEl) {
      if (formEl._dtSuppressClick) { formEl._dtSuppressClick = false; return; } // drag just ended
      const [row, col] = cellEl.dataset.dtCellAt.split(':').map(n => parseInt(n, 10));
      const ed = formEl._dtEdit;
      if (ed && ed.row === row && ed.col === col) return; // native caret placement
      commitEditing(formEl);
      const st = formEl._dt;
      if (e.shiftKey) {
        extendSelectionTo(st, row, col);
        renderGrid(formEl); // draws the released range's perimeter
      } else {
        collapseRange(st);
        st.selected = { row, col };
        syncSelectionChrome(formEl); // no rebuild — keeps a paired dblclick alive
      }
      focusGrid(formEl);
    }
  });

  formEl.addEventListener('dblclick', e => {
    const cellEl = e.target.closest('[data-dt-cell-at]');
    if (!cellEl) return;
    const [row, col] = cellEl.dataset.dtCellAt.split(':').map(n => parseInt(n, 10));
    const ed = formEl._dtEdit;
    if (ed && ed.row === row && ed.col === col) return;
    commitEditing(formEl);
    const st = formEl._dt;
    collapseRange(st);
    st.selected = { row, col };
    const { capture, image } = mediaOfCell(st, row, col);
    if (capture || image) {
      renderGrid(formEl);
      beginChildNavigation(formEl, capture
        ? { type: 'edit-capture', uuid: capture.uuid }
        : { type: 'edit-image', uuid: image.uuid });
      return;
    }
    startEditing(formEl, { caret: 'all' });
  });

  formEl.addEventListener('contextmenu', e => {
    const rowHandle = e.target.closest('[data-dt-row-handle]');
    const colHandle = e.target.closest('[data-dt-col-handle]');
    const cellEl = e.target.closest('[data-dt-cell-at]');
    if (!rowHandle && !colHandle && !cellEl) return;
    // Right-clicking inside the cell being edited keeps the native menu
    // (paste, spellcheck…).
    if (cellEl && formEl._dtEdit
      && `${formEl._dtEdit.row}:${formEl._dtEdit.col}` === cellEl.dataset.dtCellAt) return;
    e.preventDefault();
    commitEditing(formEl);
    const at = { x: e.clientX, y: e.clientY };
    if (rowHandle) { openRowMenu(formEl, parseInt(rowHandle.dataset.dtRowHandle, 10), at); return; }
    if (colHandle) { openColumnMenu(formEl, parseInt(colHandle.dataset.dtColHandle, 10), at); return; }
    const [row, col] = cellEl.dataset.dtCellAt.split(':').map(n => parseInt(n, 10));
    const st = formEl._dt;
    // Right-clicking inside a handle-selected row/column band targets the
    // band (bulk insert/delete), not the individual cell.
    const rowBand = fullRowRange(st);
    if (rowBand && row >= rowBand.r0 && row <= rowBand.r1) { openRowMenu(formEl, row, at); return; }
    const colBand = fullColumnRange(st);
    if (colBand && col >= colBand.c0 && col <= colBand.c1) { openColumnMenu(formEl, col, at); return; }
    collapseRange(st);
    st.selected = { row, col };
    renderGrid(formEl);
    openCellMenu(formEl, row, col, at);
  });

  // Keyboard navigation while merely selected (the grid wrap holds focus).
  wrap?.addEventListener('keydown', e => {
    if (formEl._dtEdit) return; // editing keys are handled at the form level
    const st = formEl._dt;
    const arrow = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.key];
    if (arrow || e.key === 'Tab') {
      e.preventDefault();
      if (arrow && e.shiftKey) extendSelection(st, arrow); // shift+arrow grows the range
      else moveSelection(st, arrow || (e.shiftKey ? 'prev' : 'next'));
      renderGrid(formEl);
      scrollSelectedIntoView(formEl);
      return;
    }
    // Copy / cut the selection as TSV. Cells are user-select:none, so there is
    // never a document selection and Chrome won't fire a native `copy` event
    // on the focused wrap — write the clipboard directly instead (permission-
    // free under a user gesture).
    if ((e.metaKey || e.ctrlKey) && (e.key === 'c' || e.key === 'x')) {
      e.preventDefault();
      navigator.clipboard?.writeText(rangeToTsv(st));
      if (e.key === 'x') {
        clearRange(st);
        afterStructureChange(formEl);
      }
      return;
    }
    if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault();
      const { capture, image } = mediaOfCell(st, st.selected.row, st.selected.col);
      if (capture) beginChildNavigation(formEl, { type: 'edit-capture', uuid: capture.uuid });
      else if (image) beginChildNavigation(formEl, { type: 'edit-image', uuid: image.uuid });
      else startEditing(formEl, { caret: 'end' });
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      if (isMultiCellRange(st)) { // range clear includes capture cells
        clearRange(st);
        afterStructureChange(formEl);
        return;
      }
      const del = mediaOfCell(st, st.selected.row, st.selected.col);
      if (del.capture || del.image) return; // menu owns media removal
      setCellAt(st, st.selected.row, st.selected.col, '');
      afterStructureChange(formEl);
      return;
    }
    if (e.key === 'ContextMenu') {
      e.preventDefault();
      const td = formEl.querySelector('.mb-dt-cell--selected');
      if (td) openCellMenu(formEl, st.selected.row, st.selected.col, td, { focusFirst: true });
      return;
    }
    // Type-to-replace: a printable character starts the cell over.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const sel = mediaOfCell(st, st.selected.row, st.selected.col);
      if (sel.capture || sel.image) return;
      e.preventDefault();
      startEditing(formEl, { replaceWith: e.key });
    }
  });

  // Editing keys. The inline RTE preventDefaults Enter but lets it bubble, so
  // commit-and-move-down works in both Rich and Markdown modes.
  formEl.addEventListener('keydown', e => {
    if (!formEl._dtEdit || !rte) return;
    if (e.target !== rte.surface && e.target !== rte.textarea) return;
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      commitEditing(formEl);
      moveSelection(formEl._dt, 'commitDown');
      renderGrid(formEl);
      focusGrid(formEl);
      scrollSelectedIntoView(formEl);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      commitEditing(formEl);
      moveSelection(formEl._dt, e.shiftKey ? 'prev' : 'next');
      renderGrid(formEl);
      focusGrid(formEl);
      scrollSelectedIntoView(formEl);
    } else if (e.key === 'Escape') {
      // Popovers and popup menus consume Escape first.
      if (isPopupMenuOpen() || formEl.querySelector('.mb-rte__popover:not([hidden])')) return;
      e.stopPropagation(); // don't let the overlay's Escape-close fire
      cancelEditing(formEl);
      focusGrid(formEl);
    }
  });

  // Paste while merely selected: TSV lands from the range's top-left,
  // auto-growing the grid; a single value fills a multi-cell range. The native
  // paste event fires on the focused wrap regardless of editability, and
  // e.clipboardData is a permission-free synchronous read (unlike
  // navigator.clipboard.readText, which would prompt).
  wrap?.addEventListener('paste', e => {
    if (formEl._dtEdit) return; // the in-cell RTE owns paste while editing
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    applyPaste(formEl._dt, parseTsv(text));
    afterStructureChange(formEl);
    focusGrid(formEl);
  });

  // Focus leaving the grid AND the toolbar (e.g. into the dock) commits the
  // edit — the value is already live-synced, this just restores the preview.
  formEl.addEventListener('focusout', e => {
    if (!formEl._dtEdit) return;
    const to = e.relatedTarget;
    if (!to) return; // focus dropped to body (popover mousedown etc.) — keep editing
    if (to.closest?.('[data-dt-grid-wrap], [data-dt-toolbar], .mb-rte__popover, .mb-popup-menu')) return;
    commitEditing(formEl);
  });
}

// Locate the upgraded rich-text editor and park its editing nodes. Runs after
// initStateFromStorage, whose awaited storage.get sequences us behind
// form.js's hydration — which is also what upgraded the textarea.
function initCellEditor(formEl) {
  const ta = formEl.querySelector('[data-dt-cell-editor]');
  const rte = ta?.closest('.mb-rte')?._rte;
  if (!rte) return;
  formEl._dtRte = rte;
  // The datatable editor is rich-only: its Rich|Markdown tabs are hidden via
  // CSS (.mb-dt-toolbar .mb-rte__tabs), so pin the mode defensively too.
  if (rte.mode !== 'rich') setMode(rte, 'rich', { focus: false });
  rte.surface.hidden = true;
  rte.textarea.hidden = true;

  // Right-aligned "Insert Media" on the toolbar: the discoverable twin of
  // the cell menu's insert flow. Datatable-only, so it is grafted onto the
  // shared RTE toolbar here rather than in richTextEditor's buildButtons.
  // ("Add from library" covers captures AND single images — routed per file.)
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mb-rte__btn mb-dt-insert-capture';
  btn.dataset.dtInsertCapture = '';
  btn.innerHTML = '<span class="more-buttons-icon">photo_camera</span>Insert Media';
  btn.addEventListener('mousedown', e => e.preventDefault()); // keep grid selection alive
  btn.addEventListener('click', () => {
    if (formEl._dtEdit) commitEditing(formEl); // the popup acts on the committed selected cell
    openInsertMenu(btn, 0, {
      captureNew: () => insertCaptureIntoSelectedCell(formEl, 'capture-new'),
      captureLibrary: () => insertCaptureIntoSelectedCell(formEl, 'capture-library'),
      image: () => insertCaptureIntoSelectedCell(formEl, 'image'),
    }, { capturesOnly: true });
  });
  rte.toolbar.append(btn);
  formEl._dtInsertCaptureBtn = btn;
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
  formEl._dt = { uuid, file, selected: { row: -1, col: 0 }, align: table.align, header: table.header, rows: table.rows, wrap: table.wrap !== false };
}

function seedStorage(table) {
  const { align, header, rows, wrap } = table;
  return chrome.storage.local.set({ [STORAGE_KEY]: { tableState: JSON.stringify({ align, header, rows, wrap }) } });
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
  formEl.dataset.componentContainerKind = 'data-table-cell';
  formEl.dataset.componentNoun = 'data table';
  formEl._componentSaver = () => saveGridForComponent(formEl);

  const heading = formEl.querySelector('[data-dt-heading]');
  if (heading) heading.textContent = 'Add data table';
  formEl.parentElement?.querySelector('[data-delete-table-btn]')?.style.setProperty('display', 'none');

  await initStateFromStorage(formEl, initial, container.file, null);
  initCellEditor(formEl);
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
  const fallback = { align: tbl.align, header: tbl.header, rows: tbl.rows, wrap: tbl.wrap };
  // Seed from the FILE on every open, replays included: this form hosts the
  // immediate-commit capture children directly, and any navigation away went
  // through the save-gate (which flushed in-flight edits), so the file is
  // authoritative — a replay from stale storage could clobber a capture
  // committed while the form was away.
  await seedStorage(fallback);

  const { formEl } = await createForm('editDataTable');
  if (!formEl) return;
  formEl.dataset.mode = 'edit';
  formEl.dataset.tableUuid = uuid;
  formEl.dataset.containerFile = file;
  formEl.dataset.componentContainerKind = 'data-table-cell';
  formEl.dataset.componentNoun = 'data table';
  formEl._componentSaver = () => saveGridForComponent(formEl);

  const heading = formEl.querySelector('[data-dt-heading]');
  if (heading) heading.textContent = 'Edit data table';
  setCrumbLabel('Data table');

  await initStateFromStorage(formEl, fallback, file, uuid);
  initCellEditor(formEl);
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
    [{ kind: 'table', tbl: { uuid, wrap: st.wrap, align: st.align, header: st.header, rows: st.rows } }], onProgress);
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
  formEl.dataset.editUuid = selectedCellRef(formEl); // uuid was blank pre-save
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
    return replaceDataTableByUUID(md, uuid, buildDataTable(uuid, st.align, st.header, st.rows, st.wrap));
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

// The grid form's component save-gate hook: flush the in-flight table to the
// draft (create → splice + transition, so the table has a UUID in the file),
// then hand back the SELECTED cell as the container the pending child (capture
// insert / edit) will act on.
async function saveGridForComponent(formEl, onProgress = () => {}) {
  const res = await saveDataTable(formEl, onProgress);
  if (!res) return null;
  return {
    container: { kind: 'data-table-cell', uuid: selectedCellRef(formEl), file: formEl.dataset.containerFile },
    formEl,
  };
}

// ── data-table-cell component container ─────────────────────────────────────
//
// Each body cell is a leaf container holding 0-or-1 capture. The cell is keyed
// by `tableUuid@row,col` so the registry's (md, uuid) contract carries the
// coordinates. Insert / edit / delete go through the shared capture flows +
// editCaptureComponent, which commit to the draft via these helpers. After any
// commit, the live grid form (if mounted) is re-hydrated from the file so its
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
  const { capture, image } = parseCellMedia(cellStr ?? '');
  return {
    description: '',
    components: capture ? [{ kind: 'capture', cap: capture }] : image ? [{ kind: 'image', img: image }] : [],
  };
}

function writeCellBody(md, cellRef, _description, components) {
  const { tableUuid, row, col } = parseCellRef(cellRef);
  const tbl = getDataTableByUUID(md, tableUuid);
  if (!tbl) return md;
  const cap = components.find(c => c.kind === 'capture')?.cap;
  const img = components.find(c => c.kind === 'image')?.img;
  const cellStr = cap ? serializeCellCapture(cap) : img ? serializeCellImage(img) : '';
  const header = tbl.header.slice();
  const rows = tbl.rows.map(r => r.slice());
  if (row === -1) header[col] = cellStr; else if (rows[row]) rows[row][col] = cellStr;
  return replaceDataTableByUUID(md, tableUuid, buildDataTable(tableUuid, tbl.align, header, rows, tbl.wrap));
}

function cellExists(md, cellRef) {
  return !!getDataTableByUUID(md, parseCellRef(cellRef).tableUuid);
}

// Re-read the table from the file into the live grid form's `_dt` and
// re-render. Used after a capture commit so the whole-table save can't clobber
// it. A no-op when the grid isn't the mounted form (e.g. delete happens from
// the editCaptureComponent child — the grid re-reads the file on
// navigate-back, since its opener always seeds from the file). `select` (the
// committed cell's coords) lands the user on the cell they just filled.
async function refreshLiveGridFromFile(select) {
  const formEl = document.getElementById('edit-data-table-form');
  if (!formEl?.isConnected || !formEl._dt) return;
  const md = await fetchFileMigratingIdentity(formEl.dataset.containerFile);
  const tbl = getDataTableByUUID(md, formEl.dataset.tableUuid);
  if (!tbl) return;
  const st = formEl._dt;
  st.align = tbl.align; st.header = tbl.header; st.rows = tbl.rows; st.wrap = tbl.wrap;
  if (select && Number.isInteger(select.col)) st.selected = { row: select.row, col: select.col };
  clampSelection(st);
  syncTableState(formEl);
  await seedStorage(st);
  renderGrid(formEl);
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
    await refreshLiveGridFromFile(parseCellRef(container.uuid));
  },
});

// ── Form actions ──────────────────────────────────────────────────────────────

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
