import assert from 'node:assert/strict';
import {
  clampSelection, insertRow, insertColumn, moveRow, moveColumn,
  deleteRow, deleteColumn, setColumnAlign, moveSelection,
  cellAt, setCellAt, collapseRange, normalizeRange, isMultiCellRange,
  extendSelection, extendSelectionTo, clearRange, rangeToTsv, parseTsv, applyPaste,
  selectRowRange, selectColumnRange, fullRowRange, fullColumnRange,
  rowMenuItems, columnMenuItems, cellMenuItems,
} from '../scripts/dataTableGridModel.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// 2 columns × 3 body rows, distinct values so column moves are observable.
function st(selected = { row: 0, col: 0 }) {
  return {
    align: ['left', 'center'],
    header: ['A', 'B'],
    rows: [['a1', 'b1'], ['a2', 'b2'], ['a3', 'b3']],
    selected,
  };
}

// ── clampSelection ────────────────────────────────────────────────────────────

test('clampSelection: seeds a default selection when missing', () => {
  const s = st(); delete s.selected;
  clampSelection(s);
  assert.deepEqual(s.selected, { row: -1, col: 0 });
});

test('clampSelection: clamps row to [-1, rows.length-1] and col to [0, cols-1]', () => {
  const s = st({ row: 9, col: 9 });
  clampSelection(s);
  assert.deepEqual(s.selected, { row: 2, col: 1 });
  const s2 = st({ row: -5, col: -5 });
  clampSelection(s2);
  assert.deepEqual(s2.selected, { row: -1, col: 0 });
});

// ── insertRow / insertColumn ──────────────────────────────────────────────────

test('insertRow: inserts a blank row sized to the column count, selection lands on it', () => {
  const s = st({ row: 2, col: 1 });
  insertRow(s, 1);
  assert.equal(s.rows.length, 4);
  assert.deepEqual(s.rows[1], ['', '']);
  assert.deepEqual(s.rows[2], ['a2', 'b2'], 'old row 1 shifted down');
  assert.deepEqual(s.selected, { row: 1, col: 1 }, 'selection on the new row, same col');
});

test('insertRow: at rows.length appends; out-of-range clamps', () => {
  const s = st();
  insertRow(s, 99);
  assert.equal(s.rows.length, 4);
  assert.deepEqual(s.rows[3], ['', '']);
  assert.equal(s.selected.row, 3);
});

test('insertColumn: splices align/header/every row, selection lands on it', () => {
  const s = st({ row: 1, col: 0 });
  insertColumn(s, 1);
  assert.deepEqual(s.align, ['left', 'left', 'center']);
  assert.equal(s.header[1], 'Column 3', 'named for the new column count');
  assert.deepEqual(s.rows[0], ['a1', '', 'b1']);
  assert.deepEqual(s.rows[2], ['a3', '', 'b3']);
  assert.deepEqual(s.selected, { row: 1, col: 1 });
});

test('insertColumn: at 0 shifts everything right', () => {
  const s = st();
  insertColumn(s, 0);
  assert.deepEqual(s.header, ['Column 3', 'A', 'B']);
  assert.deepEqual(s.align, ['left', 'left', 'center']);
  assert.deepEqual(s.rows[0], ['', 'a1', 'b1']);
});

// ── moveRow / moveColumn ──────────────────────────────────────────────────────

test('moveRow: adjacent move swaps; selection travels with the moved row', () => {
  const s = st({ row: 1, col: 0 });
  moveRow(s, 1, 2);
  assert.deepEqual(s.rows.map(r => r[0]), ['a1', 'a3', 'a2']);
  assert.equal(s.selected.row, 2);
});

test('moveRow: out-of-range or same index is a no-op', () => {
  const s = st();
  const before = JSON.stringify(s.rows);
  moveRow(s, -2, 0);
  moveRow(s, 0, 3);
  moveRow(s, 1, 1);
  assert.equal(JSON.stringify(s.rows), before);
});

test('moveRow: between -1 and 0 swaps the header content with body row 0', () => {
  const s = st({ row: -1, col: 0 });
  moveRow(s, -1, 0); // header "moves down"
  assert.deepEqual(s.header, ['a1', 'b1']);
  assert.deepEqual(s.rows[0], ['A', 'B']);
  assert.equal(s.selected.row, 0, 'selection travels with the moved content');
  moveRow(s, 0, -1); // and back up
  assert.deepEqual(s.header, ['A', 'B']);
  assert.deepEqual(s.rows[0], ['a1', 'b1']);
  assert.equal(s.selected.row, -1);
});

test('moveColumn: align + header + all rows travel together', () => {
  const s = st({ row: 0, col: 0 });
  moveColumn(s, 0, 1);
  assert.deepEqual(s.align, ['center', 'left'], 'alignment travels with the column');
  assert.deepEqual(s.header, ['B', 'A']);
  assert.deepEqual(s.rows[1], ['b2', 'a2']);
  assert.equal(s.selected.col, 1, 'selection travels');
});

test('moveColumn: out-of-range is a no-op', () => {
  const s = st();
  const before = JSON.stringify([s.align, s.header, s.rows]);
  moveColumn(s, 0, 2);
  moveColumn(s, -1, 0);
  assert.equal(JSON.stringify([s.align, s.header, s.rows]), before);
});

// ── deleteRow / deleteColumn ──────────────────────────────────────────────────

test('deleteRow: removes and clamps selection', () => {
  const s = st({ row: 2, col: 0 });
  deleteRow(s, 2);
  assert.equal(s.rows.length, 2);
  assert.equal(s.selected.row, 1, 'selection clamped to last row');
});

test('deleteRow: refuses the last remaining row', () => {
  const s = st();
  deleteRow(s, 0); deleteRow(s, 0);
  assert.equal(s.rows.length, 1);
  deleteRow(s, 0);
  assert.equal(s.rows.length, 1, 'min-1 guard holds');
});

test('deleteRow: the header row promotes body row 0 into the header slot', () => {
  const s = st({ row: -1, col: 1 });
  deleteRow(s, -1);
  assert.deepEqual(s.header, ['a1', 'b1']);
  assert.deepEqual(s.rows.map(r => r[0]), ['a2', 'a3']);
});

test('deleteRow: header delete refuses when only one body row would remain empty', () => {
  const s = st();
  s.rows = [['a1', 'b1']];
  deleteRow(s, -1);
  assert.deepEqual(s.header, ['A', 'B'], 'guarded — header unchanged');
  assert.equal(s.rows.length, 1);
});

test('insertRow: at -1 makes a blank header and demotes the old one to row 0', () => {
  const s = st({ row: 1, col: 1 });
  insertRow(s, -1);
  assert.deepEqual(s.header, ['', '']);
  assert.deepEqual(s.rows[0], ['A', 'B']);
  assert.equal(s.rows.length, 4);
  assert.deepEqual(s.selected, { row: -1, col: 1 }, 'selection lands on the new header row');
});

test('deleteColumn: splices align/header/rows and clamps selection', () => {
  const s = st({ row: 0, col: 1 });
  deleteColumn(s, 1);
  assert.deepEqual(s.align, ['left']);
  assert.deepEqual(s.header, ['A']);
  assert.deepEqual(s.rows[0], ['a1']);
  assert.equal(s.selected.col, 0);
});

test('deleteColumn: refuses the last remaining column', () => {
  const s = st();
  deleteColumn(s, 0);
  deleteColumn(s, 0);
  assert.equal(s.align.length, 1, 'min-1 guard holds');
});

// ── setColumnAlign ────────────────────────────────────────────────────────────

test('setColumnAlign: sets a valid alignment; rejects junk and bad indices', () => {
  const s = st();
  setColumnAlign(s, 0, 'right');
  assert.equal(s.align[0], 'right');
  setColumnAlign(s, 0, 'wide');
  assert.equal(s.align[0], 'right', 'invalid value ignored');
  setColumnAlign(s, 9, 'left');
  assert.deepEqual(s.align, ['right', 'center'], 'bad index ignored');
});

// ── moveSelection ─────────────────────────────────────────────────────────────

test('moveSelection: arrows move and clamp; up reaches the header row', () => {
  const s = st({ row: 0, col: 0 });
  assert.equal(moveSelection(s, 'up'), true);
  assert.deepEqual(s.selected, { row: -1, col: 0 });
  assert.equal(moveSelection(s, 'up'), false, 'clamped at header');
  moveSelection(s, 'down'); moveSelection(s, 'down'); moveSelection(s, 'down');
  assert.equal(s.selected.row, 2);
  assert.equal(moveSelection(s, 'down'), false, 'clamped at last row');
  moveSelection(s, 'right');
  assert.equal(s.selected.col, 1);
  assert.equal(moveSelection(s, 'right'), false, 'clamped at last col');
  moveSelection(s, 'left');
  assert.equal(s.selected.col, 0);
  assert.equal(moveSelection(s, 'left'), false, 'clamped at first col');
});

test('moveSelection: next wraps to the next row, prev to the previous (into header)', () => {
  const s = st({ row: 0, col: 1 });
  moveSelection(s, 'next');
  assert.deepEqual(s.selected, { row: 1, col: 0 }, 'Tab past last col wraps down');
  moveSelection(s, 'prev');
  assert.deepEqual(s.selected, { row: 0, col: 1 }, 'Shift-Tab wraps back up');
  s.selected = { row: 0, col: 0 };
  moveSelection(s, 'prev');
  assert.deepEqual(s.selected, { row: -1, col: 1 }, 'prev from row 0 col 0 lands on header');
});

test('moveSelection: next at the very last cell stays put', () => {
  const s = st({ row: 2, col: 1 });
  assert.equal(moveSelection(s, 'next'), false);
  assert.deepEqual(s.selected, { row: 2, col: 1 });
});

test('moveSelection: commitDown from header lands on row 0', () => {
  const s = st({ row: -1, col: 1 });
  moveSelection(s, 'commitDown');
  assert.deepEqual(s.selected, { row: 0, col: 1 });
});

// ── Menu builders ─────────────────────────────────────────────────────────────

const ids = items => items.filter(i => !i.divider).map(i => i.id);

test('rowMenuItems: header row gets the full set; only move-up disabled', () => {
  const items = rowMenuItems(st(), -1);
  assert.deepEqual(ids(items), ['row-insert-above', 'row-insert-below', 'row-move-up', 'row-move-down', 'row-delete']);
  assert.equal(items.find(i => i.id === 'row-move-up').disabled, true);
  assert.equal(items.find(i => i.id === 'row-move-down').disabled, false);
  assert.equal(items.find(i => i.id === 'row-delete').disabled, false);
});

test('rowMenuItems: body row has full set; row 0 can move up (header swap)', () => {
  const s = st();
  const first = rowMenuItems(s, 0);
  assert.deepEqual(ids(first), ['row-insert-above', 'row-insert-below', 'row-move-up', 'row-move-down', 'row-delete']);
  assert.equal(first.find(i => i.id === 'row-move-up').disabled, false);
  assert.equal(first.find(i => i.id === 'row-move-down').disabled, false);
  const last = rowMenuItems(s, 2);
  assert.equal(last.find(i => i.id === 'row-move-down').disabled, true);
});

test('rowMenuItems: delete is danger and disabled at one remaining row', () => {
  const s = st();
  assert.equal(rowMenuItems(s, 1).find(i => i.id === 'row-delete').danger, true);
  s.rows = [['a1', 'b1']];
  assert.equal(rowMenuItems(s, 0).find(i => i.id === 'row-delete').disabled, true);
});

test('columnMenuItems: moves disabled at edges, delete disabled at one column', () => {
  const s = st();
  const first = columnMenuItems(s, 0);
  assert.equal(first.find(i => i.id === 'col-move-left').disabled, true);
  assert.equal(first.find(i => i.id === 'col-move-right').disabled, false);
  const last = columnMenuItems(s, 1);
  assert.equal(last.find(i => i.id === 'col-move-right').disabled, true);
  s.align = ['left']; s.header = ['A']; s.rows = [['a1']];
  assert.equal(columnMenuItems(s, 0).find(i => i.id === 'col-delete').disabled, true);
});

test('columnMenuItems: alignment submenu checks the current alignment', () => {
  const s = st(); // col 1 is 'center'
  const sub = columnMenuItems(s, 1).find(i => i.id === 'col-align').submenu;
  assert.deepEqual(sub.map(i => i.id), ['col-align-left', 'col-align-center', 'col-align-right']);
  assert.deepEqual(sub.map(i => !!i.checked), [false, true, false]);
});

test('cellMenuItems: header cell → clear only; text cell → media submenu + clear', () => {
  const s = st();
  assert.deepEqual(ids(cellMenuItems(s, -1, 0)), ['cell-clear']);
  const text = cellMenuItems(s, 0, 0, { mediaKind: null });
  assert.deepEqual(ids(text), ['cell-capture', 'cell-clear']);
  assert.deepEqual(text.find(i => i.id === 'cell-capture').submenu.map(i => i.id),
    ['cell-capture-new', 'cell-capture-library', 'cell-image-library']);
});

test('cellMenuItems: capture cell → edit + remove (danger), kind-specific labels', () => {
  const items = cellMenuItems(st(), 0, 0, { mediaKind: 'capture' });
  assert.deepEqual(ids(items), ['cell-edit-capture', 'cell-remove-capture']);
  assert.equal(items.find(i => i.id === 'cell-remove-capture').danger, true);
  assert.equal(items.find(i => i.id === 'cell-edit-capture').label, 'Edit capture');
  const img = cellMenuItems(st(), 0, 0, { mediaKind: 'image' });
  assert.deepEqual(ids(img), ['cell-edit-capture', 'cell-remove-capture']);
  assert.equal(img.find(i => i.id === 'cell-edit-capture').label, 'Edit image');
  assert.equal(img.find(i => i.id === 'cell-remove-capture').label, 'Remove image');
});

// ── cellAt / setCellAt ────────────────────────────────────────────────────────

test('cellAt: row -1 reads the header; out-of-range reads empty', () => {
  const s = st();
  assert.equal(cellAt(s, -1, 1), 'B');
  assert.equal(cellAt(s, 1, 0), 'a2');
  assert.equal(cellAt(s, 9, 0), '');
  assert.equal(cellAt(s, 0, 9), '');
});

test('setCellAt: writes header and body; out-of-range row is a no-op', () => {
  const s = st();
  setCellAt(s, -1, 0, 'Title');
  setCellAt(s, 2, 1, 'x');
  assert.equal(s.header[0], 'Title');
  assert.equal(s.rows[2][1], 'x');
  setCellAt(s, 9, 0, 'y');
  assert.equal(s.rows.length, 3, 'no phantom row created');
});

// ── Range selection ───────────────────────────────────────────────────────────

test('normalizeRange: no anchor → 1×1 rect at selected', () => {
  assert.deepEqual(normalizeRange(st({ row: 1, col: 1 })), { r0: 1, r1: 1, c0: 1, c1: 1 });
});

test('normalizeRange: inverted anchor normalizes; header row participates', () => {
  const s = st({ row: 0, col: 0 });
  s.anchor = { row: 2, col: 1 };
  assert.deepEqual(normalizeRange(s), { r0: 0, r1: 2, c0: 0, c1: 1 });
  s.anchor = { row: -1, col: 1 };
  assert.deepEqual(normalizeRange(s), { r0: -1, r1: 0, c0: 0, c1: 1 });
});

test('isMultiCellRange: only when the anchor differs from selected', () => {
  const s = st({ row: 0, col: 0 });
  assert.equal(isMultiCellRange(s), false, 'no anchor');
  s.anchor = { row: 0, col: 0 };
  assert.equal(isMultiCellRange(s), false, 'anchor === selected');
  s.anchor = { row: 1, col: 0 };
  assert.equal(isMultiCellRange(s), true);
});

test('extendSelection: seeds the anchor once and keeps it across extends', () => {
  const s = st({ row: 1, col: 0 });
  assert.equal(extendSelection(s, 'down'), true);
  assert.deepEqual(s.anchor, { row: 1, col: 0 });
  assert.deepEqual(s.selected, { row: 2, col: 0 });
  extendSelection(s, 'right');
  assert.deepEqual(s.anchor, { row: 1, col: 0 }, 'anchor fixed');
  assert.deepEqual(s.selected, { row: 2, col: 1 });
});

test('extendSelection: clamps at all four edges (up reaches the header)', () => {
  const s = st({ row: 0, col: 0 });
  assert.equal(extendSelection(s, 'up'), true);
  assert.equal(s.selected.row, -1);
  assert.equal(extendSelection(s, 'up'), false, 'clamped at header');
  assert.equal(extendSelection(s, 'left'), false);
  s.selected = { row: 2, col: 1 };
  assert.equal(extendSelection(s, 'down'), false);
  assert.equal(extendSelection(s, 'right'), false);
});

test('extendSelectionTo: seeds anchor, clamps the target, keeps anchor on re-extend', () => {
  const s = st({ row: 0, col: 0 });
  extendSelectionTo(s, 9, 9);
  assert.deepEqual(s.anchor, { row: 0, col: 0 });
  assert.deepEqual(s.selected, { row: 2, col: 1 }, 'target clamped');
  extendSelectionTo(s, 1, 0);
  assert.deepEqual(s.anchor, { row: 0, col: 0 }, 'anchor unchanged');
});

test('moveSelection and every structure op collapse the range', () => {
  const mk = () => { const s = st({ row: 1, col: 1 }); s.anchor = { row: 0, col: 0 }; return s; };
  const ops = {
    moveSelection: s => moveSelection(s, 'down'),
    insertRow: s => insertRow(s, 0),
    insertColumn: s => insertColumn(s, 0),
    moveRow: s => moveRow(s, 0, 1),
    moveColumn: s => moveColumn(s, 0, 1),
    deleteRow: s => deleteRow(s, 0),
    deleteColumn: s => deleteColumn(s, 0),
  };
  for (const [name, op] of Object.entries(ops)) {
    const s = mk();
    op(s);
    assert.equal(s.anchor, null, `${name} collapses the range`);
  }
});

test('clampSelection: clamps a stale anchor too', () => {
  const s = st({ row: 0, col: 0 });
  s.anchor = { row: 9, col: 9 };
  clampSelection(s);
  assert.deepEqual(s.anchor, { row: 2, col: 1 });
});

test('clearRange: empties exactly the rect; header rect works; no anchor → one cell', () => {
  const s = st({ row: 1, col: 1 });
  s.anchor = { row: 0, col: 0 };
  clearRange(s);
  assert.deepEqual(s.rows, [['', ''], ['', ''], ['a3', 'b3']]);
  const h = st({ row: 0, col: 0 });
  h.anchor = { row: -1, col: 1 };
  clearRange(h);
  assert.deepEqual(h.header, ['', '']);
  assert.deepEqual(h.rows[0], ['', '']);
  const one = st({ row: 2, col: 0 });
  clearRange(one);
  assert.deepEqual(one.rows, [['a1', 'b1'], ['a2', 'b2'], ['', 'b3']]);
});

// ── Clipboard (TSV) ───────────────────────────────────────────────────────────

test('rangeToTsv: single cell, 2×2 rect, and header-anchored rect', () => {
  assert.equal(rangeToTsv(st({ row: 0, col: 0 })), 'a1');
  const s = st({ row: 1, col: 1 });
  s.anchor = { row: 0, col: 0 };
  assert.equal(rangeToTsv(s), 'a1\tb1\na2\tb2');
  const h = st({ row: 0, col: 1 });
  h.anchor = { row: -1, col: 0 };
  assert.equal(rangeToTsv(h), 'A\tB\na1\tb1');
});

test('rangeToTsv: capture markdown is copied verbatim', () => {
  const s = st({ row: 0, col: 0 });
  s.rows[0][0] = '![x](docs/assets/foo-light-mode.png#only-light)';
  assert.equal(rangeToTsv(s), s.rows[0][0]);
});

test('parseTsv: grid split, \\r stripped, one trailing newline dropped', () => {
  assert.deepEqual(parseTsv('x\ty\nz\tw'), [['x', 'y'], ['z', 'w']]);
  assert.deepEqual(parseTsv('x\ty\r\nz\tw\r\n'), [['x', 'y'], ['z', 'w']]);
  assert.deepEqual(parseTsv('v\n'), [['v']]);
  assert.deepEqual(parseTsv('v\n\n'), [['v'], ['']], 'second trailing newline keeps a blank row');
  assert.deepEqual(parseTsv('a\tb\nc'), [['a', 'b'], ['c']], 'ragged preserved');
  assert.deepEqual(parseTsv(''), [['']]);
});

test('applyPaste: exact fit writes values and selects the pasted rect', () => {
  const s = st({ row: 0, col: 0 });
  applyPaste(s, [['X', 'Y'], ['Z', 'W']]);
  assert.deepEqual(s.rows, [['X', 'Y'], ['Z', 'W'], ['a3', 'b3']]);
  assert.deepEqual(s.anchor, { row: 0, col: 0 });
  assert.deepEqual(s.selected, { row: 1, col: 1 });
});

test('applyPaste: grows rows and columns to fit', () => {
  const s = st({ row: 2, col: 1 });
  applyPaste(s, [['1', '2'], ['3', '4']]);
  assert.equal(s.rows.length, 4, 'one row appended');
  assert.deepEqual(s.align, ['left', 'center', 'left'], 'new column defaults left');
  assert.equal(s.header[2], 'Column 3');
  assert.deepEqual(s.rows[2], ['a3', '1', '2']);
  assert.deepEqual(s.rows[3], ['', '3', '4']);
  assert.deepEqual(s.rows[0], ['a1', 'b1', ''], 'old rows padded');
  assert.deepEqual(s.selected, { row: 3, col: 2 });
});

test('applyPaste: anchored at the header, block row 0 lands on the header', () => {
  const s = st({ row: -1, col: 0 });
  applyPaste(s, [['H1', 'H2'], ['r1', 'r2']]);
  assert.deepEqual(s.header, ['H1', 'H2']);
  assert.deepEqual(s.rows[0], ['r1', 'r2']);
  assert.equal(s.rows.length, 3, 'no growth needed');
  assert.deepEqual(s.anchor, { row: -1, col: 0 });
  assert.deepEqual(s.selected, { row: 0, col: 1 });
});

test('applyPaste: 1×1 block fills a multi-cell range, selection untouched', () => {
  const s = st({ row: 1, col: 1 });
  s.anchor = { row: 0, col: 0 };
  applyPaste(s, [['V']]);
  assert.deepEqual(s.rows, [['V', 'V'], ['V', 'V'], ['a3', 'b3']]);
  assert.deepEqual(s.anchor, { row: 0, col: 0 });
  assert.deepEqual(s.selected, { row: 1, col: 1 });
});

test('applyPaste: 1×1 block into a single cell writes one cell', () => {
  const s = st({ row: 1, col: 0 });
  applyPaste(s, [['V']]);
  assert.deepEqual(s.rows, [['a1', 'b1'], ['V', 'b2'], ['a3', 'b3']]);
});

test('applyPaste: ragged block leaves uncovered cells intact', () => {
  const s = st({ row: 0, col: 0 });
  applyPaste(s, [['X', 'Y'], ['Z']]);
  assert.deepEqual(s.rows, [['X', 'Y'], ['Z', 'b2'], ['a3', 'b3']]);
  assert.deepEqual(s.selected, { row: 1, col: 1 }, 'selection spans the block width');
});

// ── Row / column bands (handle-click selection) ───────────────────────────────

test('selectRowRange: selects the whole row; shift-extend keeps the anchor row', () => {
  const s = st({ row: 0, col: 1 });
  selectRowRange(s, 1);
  assert.deepEqual(s.anchor, { row: 1, col: 0 });
  assert.deepEqual(s.selected, { row: 1, col: 1 });
  selectRowRange(s, 2, true);
  assert.deepEqual(s.anchor, { row: 1, col: 0 }, 'anchor row kept on extend');
  assert.deepEqual(s.selected, { row: 2, col: 1 });
});

test('selectRowRange: shift-extend without a prior anchor seeds from selected', () => {
  const s = st({ row: 0, col: 1 });
  selectRowRange(s, 2, true);
  assert.deepEqual(s.anchor, { row: 0, col: 0 });
  assert.deepEqual(s.selected, { row: 2, col: 1 });
});

test('selectColumnRange: spans header through last row; shift-extend keeps anchor col', () => {
  const s = st({ row: 1, col: 0 });
  selectColumnRange(s, 1);
  assert.deepEqual(s.anchor, { row: -1, col: 1 });
  assert.deepEqual(s.selected, { row: 2, col: 1 });
  selectColumnRange(s, 0, true);
  assert.deepEqual(s.anchor, { row: -1, col: 1 });
  assert.deepEqual(s.selected, { row: 2, col: 0 });
});

test('fullRowRange: detects a row band; null for partial-width or header-inclusive', () => {
  const s = st({ row: 0, col: 1 });
  selectRowRange(s, 0);
  selectRowRange(s, 1, true);
  assert.deepEqual(fullRowRange(s), { r0: 0, r1: 1 });
  const partial = st({ row: 1, col: 0 });
  partial.anchor = { row: 0, col: 0 }; // one column only
  assert.equal(fullRowRange(partial), null);
  const withHeader = st({ row: 0, col: 1 });
  withHeader.anchor = { row: -1, col: 0 };
  assert.equal(fullRowRange(withHeader), null, 'pinned header cannot join a row band');
});

test('fullColumnRange: detects a column band; null when not spanning every row', () => {
  const s = st({ row: 0, col: 0 });
  selectColumnRange(s, 0);
  assert.deepEqual(fullColumnRange(s), { c0: 0, c1: 0 });
  selectColumnRange(s, 1, true);
  assert.deepEqual(fullColumnRange(s), { c0: 0, c1: 1 });
  const partial = st({ row: 1, col: 1 });
  partial.anchor = { row: 0, col: 0 };
  assert.equal(fullColumnRange(partial), null);
});

test('rowMenuItems: a multi-row band gets bulk insert/delete; delete guarded', () => {
  const s = st({ row: 0, col: 0 });
  selectRowRange(s, 0);
  selectRowRange(s, 1, true);
  const items = rowMenuItems(s, 1);
  assert.deepEqual(ids(items), ['rows-insert-above', 'rows-insert-below', 'rows-delete']);
  assert.equal(items.find(i => i.id === 'rows-insert-above').label, 'Insert 2 rows above');
  assert.equal(items.find(i => i.id === 'rows-delete').disabled, false);
  selectRowRange(s, 2, true); // band now covers all body rows
  assert.equal(rowMenuItems(s, 1).find(i => i.id === 'rows-delete').disabled, true, 'min-1 guard');
});

test('rowMenuItems: a single-row band still gets the standard single menu', () => {
  const s = st({ row: 0, col: 0 });
  selectRowRange(s, 1);
  assert.deepEqual(ids(rowMenuItems(s, 1)),
    ['row-insert-above', 'row-insert-below', 'row-move-up', 'row-move-down', 'row-delete']);
});

test('columnMenuItems: a multi-column band gets bulk insert/delete; delete guarded', () => {
  const s = st({ row: 0, col: 0 });
  selectColumnRange(s, 0);
  selectColumnRange(s, 1, true); // both columns → delete must be disabled
  const items = columnMenuItems(s, 0);
  assert.deepEqual(ids(items), ['cols-insert-left', 'cols-insert-right', 'cols-delete']);
  assert.equal(items.find(i => i.id === 'cols-delete').disabled, true, 'min-1 guard');
  assert.equal(items.find(i => i.id === 'cols-insert-right').label, 'Insert 2 columns right');
});

test('columnMenuItems: a single-column band keeps the standard menu (alignment intact)', () => {
  const s = st({ row: 0, col: 0 });
  selectColumnRange(s, 1);
  assert.deepEqual(ids(columnMenuItems(s, 1)),
    ['col-insert-left', 'col-insert-right', 'col-move-left', 'col-move-right', 'col-align', 'col-delete']);
});

console.log(`\n${passed} passed`);
