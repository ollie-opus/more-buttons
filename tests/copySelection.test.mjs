import assert from 'node:assert/strict';
import {
  createCopySelection, copySelectionOf, copyButtonLabel, paintCopySelection, repaintCopyLabels, setShiftHeld,
} from '../scripts/copySelection.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const COPY_BTN_SEL = ':scope > .mb-incident-card > .mb-incident-card__foot [data-copy-component-md], :scope > .mb-incident-card > .mb-incident-card__foot [data-copy-grid-cell]';

// Stub row: a classList that records classes, and a Copy button in its foot.
function stubRow({ withButton = true } = {}) {
  const row = {
    classes: new Set(),
    btn: withButton ? { textContent: 'Copy', dataset: {} } : null,
    classList: {
      toggle(cls, on) { on ? row.classes.add(cls) : row.classes.delete(cls); },
      contains(cls) { return row.classes.has(cls); },
    },
    querySelector(sel) { assert.equal(sel, COPY_BTN_SEL); return row.btn; },
  };
  return row;
}
function stubList(n) {
  const rows = Array.from({ length: n }, () => stubRow());
  return { rows, querySelectorAll(sel) { assert.equal(sel, ':scope > .mb-component-row'); return rows; } };
}

test('toggle: adds on first call, removes on second', () => {
  const sel = createCopySelection();
  sel.toggle('a');
  assert.equal(sel.size, 1);
  assert.ok(sel.has('a'));
  sel.toggle('a');
  assert.equal(sel.size, 0);
  assert.ok(!sel.has('a'));
});

test('ordered: follows the supplied order, not click order, and drops unknown uuids', () => {
  const sel = createCopySelection();
  sel.toggle('c'); sel.toggle('a'); sel.toggle('gone');
  assert.deepEqual(sel.ordered(['a', 'b', 'c', 'd']), ['a', 'c']);
});

test('clear: empties the selection', () => {
  const sel = createCopySelection();
  sel.toggle('a'); sel.toggle('b');
  sel.clear();
  assert.equal(sel.size, 0);
  assert.deepEqual(sel.ordered(['a', 'b']), []);
});

test('copyButtonLabel: Copy at rest, Multi copy under Shift, Copied ✓ when selected under Shift', () => {
  assert.equal(copyButtonLabel(false, false), 'Copy');
  assert.equal(copyButtonLabel(false, true), 'Copy');
  assert.equal(copyButtonLabel(true, false), 'Multi copy');
  assert.equal(copyButtonLabel(true, true), 'Copied ✓');
});

test('paint: toggles --selected on rows by index and follows a swap', () => {
  setShiftHeld(false);
  const sel = createCopySelection();
  const list = stubList(3);
  sel.toggle('b');
  sel.paint(list, ['a', 'b', 'c']);
  assert.deepEqual(list.rows.map(r => r.classes.has('--selected')), [false, true, false]);
  sel.paint(list, ['b', 'a', 'c']);
  assert.deepEqual(list.rows.map(r => r.classes.has('--selected')), [true, false, false]);
});

test('paint: Shift held → selected buttons read Copied ✓, the rest Multi copy; released → Copy', () => {
  const sel = createCopySelection();
  const list = stubList(2);
  sel.toggle('a');
  setShiftHeld(true);
  sel.paint(list, ['a', 'b']);
  assert.deepEqual(list.rows.map(r => r.btn.textContent), ['Copied ✓', 'Multi copy']);
  setShiftHeld(false);
  sel.paint(list, ['a', 'b']);
  assert.deepEqual(list.rows.map(r => r.btn.textContent), ['Copy', 'Copy']);
});

test('paint: a mid-flash button keeps its flash text but records the rest label for the flash to restore', () => {
  setShiftHeld(true);
  const sel = createCopySelection();
  const list = stubList(1);
  list.rows[0].btn.textContent = 'Copy failed';
  list.rows[0].btn.dataset.flashing = '1';
  sel.paint(list, ['a']);
  assert.equal(list.rows[0].btn.textContent, 'Copy failed');
  assert.equal(list.rows[0].btn.dataset.restLabel, 'Multi copy');
  setShiftHeld(false);
});

test('paintCopySelection: a list with no selection yet still gets Shift labels; rows without a button are skipped', () => {
  setShiftHeld(true);
  const list = stubList(2);
  list.rows[1] = stubRow({ withButton: false });
  paintCopySelection(list, ['a', 'b']);
  assert.equal(list.rows[0].btn.textContent, 'Multi copy');
  assert.ok(!list.rows[0].classes.has('--selected'));
  setShiftHeld(false);
});

test('repaintCopyLabels: relabels every row under a root from its --selected class and the Shift state', () => {
  const list = stubList(2);
  list.rows[1].classes.add('--selected');
  const root = { querySelectorAll(sel) { assert.equal(sel, '.mb-component-row'); return list.rows; } };
  setShiftHeld(true);
  repaintCopyLabels(root);
  assert.deepEqual(list.rows.map(r => r.btn.textContent), ['Multi copy', 'Copied ✓']);
  setShiftHeld(false);
  repaintCopyLabels(root);
  assert.deepEqual(list.rows.map(r => r.btn.textContent), ['Copy', 'Copy']);
});

test('copySelectionOf: one instance per element, distinct across elements', () => {
  const el1 = {}, el2 = {};
  assert.equal(copySelectionOf(el1), copySelectionOf(el1));
  assert.notEqual(copySelectionOf(el1), copySelectionOf(el2));
});

console.log(`\n${passed} passed`);
