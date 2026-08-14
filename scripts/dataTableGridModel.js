/**
 * dataTableGridModel.js — pure state logic for the spreadsheet-style data
 * table editor (no chrome.*, no DOM — unit-testable like dataTables.js).
 *
 * State shape (owned by dataTablesEditor.js as formEl._dt):
 *   { align: string[], header: string[], rows: string[][],
 *     selected: {row, col}, anchor?: {row, col} | null }
 * where selected.row === -1 addresses the markdown header row. `selected` is
 * always the ACTIVE cell; `anchor` (optional) marks the far corner of a
 * rectangular range selection — absent/null means a single-cell selection.
 *
 * All ops mutate the state in place (the editor's existing convention) and
 * leave `selected` somewhere sensible: insertions/moves keep the user on the
 * inserted/moved line; deletions clamp. The menu-item builders return the
 * declarative item arrays consumed by insertMenu.js's openPopupMenu, encoding
 * every guard (header pinning, min-1 row/column) so the rules live in one
 * testable place.
 */

export const COLUMN_ALIGNMENTS = ['left', 'center', 'right'];

export function clampSelection(st) {
  if (!st.selected) st.selected = { row: -1, col: 0 };
  st.selected.col = Math.max(0, Math.min(st.selected.col, st.align.length - 1));
  st.selected.row = Math.max(-1, Math.min(st.selected.row, st.rows.length - 1));
  if (st.anchor) {
    st.anchor.col = Math.max(0, Math.min(st.anchor.col, st.align.length - 1));
    st.anchor.row = Math.max(-1, Math.min(st.anchor.row, st.rows.length - 1));
  }
}

// ── Cell accessors ────────────────────────────────────────────────────────────

export function cellAt(st, row, col) {
  return row === -1 ? (st.header[col] ?? '') : (st.rows[row]?.[col] ?? '');
}

export function setCellAt(st, row, col, value) {
  if (row === -1) st.header[col] = value;
  else if (st.rows[row]) st.rows[row][col] = value;
}

// ── Structure ops ─────────────────────────────────────────────────────────────

// Insert a blank row at index `at` (-1..rows.length). The markdown header row
// is structurally required, so `at === -1` (insert above row 1) makes the NEW
// blank row the header and demotes the current header to body row 0.
export function insertRow(st, at) {
  collapseRange(st);
  if (at === -1) {
    st.rows.unshift(st.header);
    st.header = Array.from({ length: st.align.length }, () => '');
    st.selected = { row: -1, col: st.selected?.col ?? 0 };
    clampSelection(st);
    return;
  }
  const i = Math.max(0, Math.min(at, st.rows.length));
  st.rows.splice(i, 0, Array.from({ length: st.align.length }, () => ''));
  st.selected = { row: i, col: st.selected?.col ?? 0 };
  clampSelection(st);
}

export function insertColumn(st, at) {
  collapseRange(st);
  const i = Math.max(0, Math.min(at, st.align.length));
  st.align.splice(i, 0, 'left');
  st.header.splice(i, 0, `Column ${st.align.length}`);
  st.rows.forEach(r => r.splice(i, 0, ''));
  st.selected = { row: st.selected?.row ?? -1, col: i };
  clampSelection(st);
}

// Move a body row from one index to another (adjacent for the menu's
// up/down, but general). The selection travels with the moved row. Moving
// between -1 and 0 swaps the header CONTENT with body row 0 (the header slot
// itself is structural and stays put).
export function moveRow(st, from, to) {
  collapseRange(st);
  if ((from === -1 && to === 0) || (from === 0 && to === -1)) {
    if (!st.rows.length) return;
    const h = st.header;
    st.header = st.rows[0];
    st.rows[0] = h;
    if (st.selected?.row === from) st.selected.row = to;
    else if (st.selected?.row === to) st.selected.row = from;
    clampSelection(st);
    return;
  }
  if (from < 0 || to < 0 || from >= st.rows.length || to >= st.rows.length || from === to) return;
  const [row] = st.rows.splice(from, 1);
  st.rows.splice(to, 0, row);
  if (st.selected?.row === from) st.selected.row = to;
  clampSelection(st);
}

// Move a column: alignment and header travel with the cells.
export function moveColumn(st, from, to) {
  collapseRange(st);
  if (from < 0 || to < 0 || from >= st.align.length || to >= st.align.length || from === to) return;
  for (const arr of [st.align, st.header, ...st.rows]) {
    const [v] = arr.splice(from, 1);
    arr.splice(to, 0, v);
  }
  if (st.selected?.col === from) st.selected.col = to;
  clampSelection(st);
}

export function deleteRow(st, at) {
  collapseRange(st);
  if (at === -1) {
    // Markdown requires a header row: deleting row 1 promotes body row 0's
    // content into the header slot (guarded so ≥1 body row remains).
    if (st.rows.length <= 1) return;
    st.header = st.rows.shift();
    clampSelection(st);
    return;
  }
  if (at < 0 || at >= st.rows.length || st.rows.length <= 1) return;
  st.rows.splice(at, 1);
  clampSelection(st);
}

export function deleteColumn(st, at) {
  collapseRange(st);
  if (at < 0 || at >= st.align.length || st.align.length <= 1) return;
  st.align.splice(at, 1);
  st.header.splice(at, 1);
  st.rows.forEach(r => r.splice(at, 1));
  clampSelection(st);
}

export function setColumnAlign(st, col, align) {
  if (!COLUMN_ALIGNMENTS.includes(align)) return;
  if (col < 0 || col >= st.align.length) return;
  st.align[col] = align;
}

// ── Selection navigation ──────────────────────────────────────────────────────

// Semantic moves (the editor translates key events):
//   'up' | 'down' | 'left' | 'right'  — arrows, clamped at edges (up reaches
//                                       the header row, -1)
//   'next' | 'prev'                   — Tab / Shift-Tab, wrapping to the next /
//                                       previous row at the row ends
//   'commitDown'                      — Enter after an edit: down one row
// Mutates st.selected; returns true when the selection changed. Any plain
// move collapses a range selection (Sheets behavior).
export function moveSelection(st, move) {
  collapseRange(st);
  const { row, col } = st.selected;
  let r = row, c = col;
  if (move === 'up') r = Math.max(-1, row - 1);
  else if (move === 'down' || move === 'commitDown') r = Math.min(st.rows.length - 1, row + 1);
  else if (move === 'left') c = Math.max(0, col - 1);
  else if (move === 'right') c = Math.min(st.align.length - 1, col + 1);
  else if (move === 'next') {
    if (col < st.align.length - 1) c = col + 1;
    else if (row < st.rows.length - 1) { r = row + 1; c = 0; }
  } else if (move === 'prev') {
    if (col > 0) c = col - 1;
    else if (row > -1) { r = row - 1; c = st.align.length - 1; }
  }
  const changed = r !== row || c !== col;
  st.selected = { row: r, col: c };
  return changed;
}

// ── Range selection ───────────────────────────────────────────────────────────
//
// A range is the inclusive rectangle between `anchor` and `selected` (gsheets
// drag / shift+click / shift+arrows). The header row (-1) participates.

export function collapseRange(st) {
  st.anchor = null;
}

// The selection rectangle normalized to { r0, c0, r1, c1 } (inclusive,
// r0 <= r1, c0 <= c1). No anchor → the 1×1 rect at `selected`.
export function normalizeRange(st) {
  const a = st.anchor ?? st.selected;
  return {
    r0: Math.min(a.row, st.selected.row), r1: Math.max(a.row, st.selected.row),
    c0: Math.min(a.col, st.selected.col), c1: Math.max(a.col, st.selected.col),
  };
}

export function isMultiCellRange(st) {
  return !!st.anchor && (st.anchor.row !== st.selected.row || st.anchor.col !== st.selected.col);
}

// Shift+arrow: keep (or seed) the anchor and step `selected`, with the same
// edge clamps as moveSelection's arrows. Returns true when selected moved.
export function extendSelection(st, dir) {
  if (!st.anchor) st.anchor = { ...st.selected };
  const { row, col } = st.selected;
  let r = row, c = col;
  if (dir === 'up') r = Math.max(-1, row - 1);
  else if (dir === 'down') r = Math.min(st.rows.length - 1, row + 1);
  else if (dir === 'left') c = Math.max(0, col - 1);
  else if (dir === 'right') c = Math.min(st.align.length - 1, col + 1);
  const changed = r !== row || c !== col;
  st.selected = { row: r, col: c };
  return changed;
}

// Shift+click / drag-over: keep (or seed) the anchor and jump `selected` to
// the target cell.
export function extendSelectionTo(st, row, col) {
  if (!st.anchor) st.anchor = { ...st.selected };
  st.selected = { row, col };
  clampSelection(st);
}

// Handle-click (gutter / column-letter) selection: whole rows / columns as a
// range. A full-row range spans every column; a full-column range spans every
// row INCLUDING the header (-1), gsheets-style.

export function selectRowRange(st, row, extend = false) {
  const anchorRow = extend ? (st.anchor?.row ?? st.selected.row) : row;
  st.anchor = { row: anchorRow, col: 0 };
  st.selected = { row, col: st.align.length - 1 };
  clampSelection(st);
}

export function selectColumnRange(st, col, extend = false) {
  const anchorCol = extend ? (st.anchor?.col ?? st.selected.col) : col;
  st.anchor = { row: -1, col: anchorCol };
  st.selected = { row: st.rows.length - 1, col };
  clampSelection(st);
}

// → { r0, r1 } when the current range spans every column (a handle-selected
// row band), else null. Header-inclusive bands don't count: the pinned header
// row can't participate in row structure ops.
export function fullRowRange(st) {
  if (!st.anchor) return null;
  const { r0, c0, r1, c1 } = normalizeRange(st);
  if (c0 !== 0 || c1 !== st.align.length - 1 || r0 === -1) return null;
  return { r0, r1 };
}

// → { c0, c1 } when the current range spans every row (header included), else
// null.
export function fullColumnRange(st) {
  if (!st.anchor) return null;
  const { r0, c0, r1, c1 } = normalizeRange(st);
  if (r0 !== -1 || r1 !== st.rows.length - 1) return null;
  return { c0, c1 };
}

// Empty every cell in the range (header and capture cells included — clearing
// a capture is the same whole-table edit the cell menu's remove performs).
export function clearRange(st) {
  const { r0, c0, r1, c1 } = normalizeRange(st);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) setCellAt(st, r, c, '');
  }
}

// ── Clipboard (TSV) ───────────────────────────────────────────────────────────
//
// Cell values are single-line markdown strings (the inline editor collapses
// newlines) so plain tab/newline joining round-trips with Sheets/Excel.

export function rangeToTsv(st) {
  const { r0, c0, r1, c1 } = normalizeRange(st);
  const lines = [];
  for (let r = r0; r <= r1; r++) {
    const cells = [];
    for (let c = c0; c <= c1; c++) cells.push(cellAt(st, r, c));
    lines.push(cells.join('\t'));
  }
  return lines.join('\n');
}

// Clipboard text → string[][]. Strips \r; drops ONE trailing newline
// (spreadsheets terminate the copy with one — a deliberately blank last row
// survives as a second). Ragged rows are preserved as-is.
export function parseTsv(text) {
  let t = (text ?? '').replace(/\r/g, '');
  if (t.endsWith('\n')) t = t.slice(0, -1);
  return t.split('\n').map(line => line.split('\t'));
}

// Paste `block` (parseTsv output, non-empty) at the range's top-left,
// auto-growing rows/columns to fit. A 1×1 block pasted onto a multi-cell
// range fills the whole range instead (Sheets behavior). Afterwards the
// selection covers the pasted rectangle.
export function applyPaste(st, block) {
  const { r0, c0, r1, c1 } = normalizeRange(st);
  if (block.length === 1 && block[0].length === 1 && isMultiCellRange(st)) {
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) setCellAt(st, r, c, block[0][0]);
    }
    return;
  }
  const width = Math.max(...block.map(cells => cells.length));
  // Grow rows first (direct pushes — insertRow/insertColumn would clobber
  // `selected`), then columns so the new rows are padded too.
  while (st.rows.length - 1 < r0 + block.length - 1) {
    st.rows.push(Array.from({ length: st.align.length }, () => ''));
  }
  while (st.align.length - 1 < c0 + width - 1) {
    st.align.push('left');
    st.header.push(`Column ${st.align.length}`);
    st.rows.forEach(r => r.push(''));
  }
  block.forEach((cells, i) => cells.forEach((v, j) => setCellAt(st, r0 + i, c0 + j, v)));
  st.anchor = { row: r0, col: c0 };
  st.selected = { row: r0 + block.length - 1, col: c0 + width - 1 };
  clampSelection(st);
}

// ── Context-menu item builders ────────────────────────────────────────────────
//
// Items: { id, label, icon?, disabled?, danger?, checked?, submenu? } plus
// { divider: true } separators — the openPopupMenu contract.

export function rowMenuItems(st, row) {
  // A handle-selected band of body rows gets bulk ops instead (no moves —
  // gsheets keeps those out of the multi menu too).
  const band = fullRowRange(st);
  if (band && band.r1 > band.r0 && row >= band.r0 && row <= band.r1) {
    const n = band.r1 - band.r0 + 1;
    return [
      { id: 'rows-insert-above', label: `Insert ${n} rows above`, icon: 'add' },
      { id: 'rows-insert-below', label: `Insert ${n} rows below`, icon: 'add' },
      { divider: true },
      { id: 'rows-delete', label: `Delete ${n} rows`, icon: 'delete', danger: true, disabled: n >= st.rows.length },
    ];
  }
  // The header row (-1) gets the same menu: insert-above/move/delete on it are
  // content-level promote/demote/swap ops (see insertRow/moveRow/deleteRow),
  // so the markdown always keeps a header.
  return [
    { id: 'row-insert-above', label: 'Insert 1 row above', icon: 'add' },
    { id: 'row-insert-below', label: 'Insert 1 row below', icon: 'add' },
    { divider: true },
    { id: 'row-move-up', label: 'Move row up', icon: 'arrow_upward', disabled: row === -1 },
    { id: 'row-move-down', label: 'Move row down', icon: 'arrow_downward', disabled: row >= st.rows.length - 1 },
    { divider: true },
    { id: 'row-delete', label: 'Delete row', icon: 'delete', danger: true, disabled: st.rows.length <= 1 },
  ];
}

export function columnMenuItems(st, col) {
  const band = fullColumnRange(st);
  if (band && band.c1 > band.c0 && col >= band.c0 && col <= band.c1) {
    const n = band.c1 - band.c0 + 1;
    return [
      { id: 'cols-insert-left', label: `Insert ${n} columns left`, icon: 'add' },
      { id: 'cols-insert-right', label: `Insert ${n} columns right`, icon: 'add' },
      { divider: true },
      { id: 'cols-delete', label: `Delete ${n} columns`, icon: 'delete', danger: true, disabled: n >= st.align.length },
    ];
  }
  return [
    { id: 'col-insert-left', label: 'Insert 1 column left', icon: 'add' },
    { id: 'col-insert-right', label: 'Insert 1 column right', icon: 'add' },
    { divider: true },
    { id: 'col-move-left', label: 'Move column left', icon: 'arrow_back', disabled: col <= 0 },
    { id: 'col-move-right', label: 'Move column right', icon: 'arrow_forward', disabled: col >= st.align.length - 1 },
    { divider: true },
    {
      id: 'col-align', label: 'Alignment', icon: `format_align_${st.align[col] ?? 'left'}`,
      submenu: COLUMN_ALIGNMENTS.map(a => ({
        id: `col-align-${a}`,
        label: a[0].toUpperCase() + a.slice(1),
        icon: `format_align_${a}`,
        checked: (st.align[col] ?? 'left') === a,
      })),
    },
    { divider: true },
    { id: 'col-delete', label: 'Delete column', icon: 'delete', danger: true, disabled: st.align.length <= 1 },
  ];
}

export function cellMenuItems(st, row, col, { mediaKind = null } = {}) {
  if (row === -1) {
    // Header cells hold column titles only — no media.
    return [{ id: 'cell-clear', label: 'Clear cell', icon: 'backspace' }];
  }
  if (mediaKind) {
    // mediaKind: 'capture' | 'image' — same ids, kind-specific labels.
    return [
      { id: 'cell-edit-capture', label: `Edit ${mediaKind}`, icon: 'photo_camera' },
      { divider: true },
      { id: 'cell-remove-capture', label: `Remove ${mediaKind}`, icon: 'delete', danger: true },
    ];
  }
  return [
    {
      id: 'cell-capture', label: 'Insert media', icon: 'photo_camera',
      submenu: [
        { id: 'cell-capture-new', label: 'Create a new capture' },
        { id: 'cell-capture-library', label: 'Add capture from library' },
        { id: 'cell-image-library', label: 'Add image from library' },
      ],
    },
    { divider: true },
    { id: 'cell-clear', label: 'Clear cell', icon: 'backspace' },
  ];
}
