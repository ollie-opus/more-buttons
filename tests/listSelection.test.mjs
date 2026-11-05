import assert from 'node:assert/strict';
import {
  createListSelection, listSelectionOf, selectionSummary, paintListSelection, listHeadSlot,
} from '../scripts/listSelection.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const ROW_BOX_SEL = ':scope > .mb-component-select > [data-select-row]';

// Stub row: a classList that records classes, and a select checkbox.
function stubRow({ withBox = true } = {}) {
  const row = {
    classes: new Set(),
    box: withBox ? { checked: false } : null,
    classList: {
      toggle(cls, on) { on ? row.classes.add(cls) : row.classes.delete(cls); },
      contains(cls) { return row.classes.has(cls); },
    },
    querySelector(sel) { assert.equal(sel, ROW_BOX_SEL); return row.box; },
  };
  return row;
}
function stubBar() {
  const bar = {
    all: { checked: false, indeterminate: false },
    summary: { textContent: '' },
    copy: { hidden: true }, del: { hidden: true },
    querySelector(sel) {
      if (sel === '[data-select-all]') return bar.all;
      if (sel === '[data-select-summary]') return bar.summary;
      throw new Error('unexpected ' + sel);
    },
    querySelectorAll(sel) { assert.equal(sel, '[data-copy-selected], [data-delete-selected]'); return [bar.copy, bar.del]; },
  };
  return bar;
}
function stubList(n, { withBar = true } = {}) {
  const rows = Array.from({ length: n }, () => stubRow());
  const bar = withBar ? stubBar() : null;
  return {
    rows, bar,
    querySelectorAll(sel) { assert.equal(sel, ':scope > .mb-component-row'); return rows; },
    querySelector(sel) { assert.equal(sel, ':scope > .mb-list-bar'); return bar; },
  };
}

test('set/toggle/add/delete: a Set of uuids; empty uuids are never added', () => {
  const sel = createListSelection();
  sel.toggle('a');
  assert.equal(sel.size, 1);
  assert.ok(sel.has('a'));
  sel.toggle('a');
  assert.equal(sel.size, 0);
  sel.set('b', true); sel.set('c', true); sel.set('b', false);
  assert.deepEqual(sel.ordered(['a', 'b', 'c']), ['c']);
  sel.add(''); sel.add(undefined);
  assert.equal(sel.size, 1);
  sel.delete('c');
  assert.equal(sel.size, 0);
});

test('ordered: follows the supplied order, not click order, and drops unknown uuids', () => {
  const sel = createListSelection();
  sel.toggle('c'); sel.toggle('a'); sel.toggle('gone');
  assert.deepEqual(sel.ordered(['a', 'b', 'c', 'd']), ['a', 'c']);
});

test('clear: empties the selection', () => {
  const sel = createListSelection();
  sel.toggle('a'); sel.toggle('b');
  sel.clear();
  assert.equal(sel.size, 0);
});

test('selectionSummary: invitation at rest, a count once anything is picked', () => {
  assert.equal(selectionSummary(0), 'Select all');
  assert.equal(selectionSummary(1), '1 selected');
  assert.equal(selectionSummary(4), '4 selected');
});

test('paint: checks rows by index, toggles --selected, and follows a swap', () => {
  const sel = createListSelection();
  const list = stubList(3);
  sel.toggle('b');
  sel.paint(list, ['a', 'b', 'c']);
  assert.deepEqual(list.rows.map(r => r.classes.has('--selected')), [false, true, false]);
  assert.deepEqual(list.rows.map(r => r.box.checked), [false, true, false]);
  sel.paint(list, ['b', 'a', 'c']);
  assert.deepEqual(list.rows.map(r => r.classes.has('--selected')), [true, false, false]);
  assert.deepEqual(list.rows.map(r => r.box.checked), [true, false, false]);
});

test('paint: the bar reads nothing / partial (indeterminate) / all, and its actions only show once something is picked', () => {
  const sel = createListSelection();
  const list = stubList(2);
  sel.paint(list, ['a', 'b']);
  assert.equal(list.bar.summary.textContent, 'Select all');
  assert.deepEqual([list.bar.all.checked, list.bar.all.indeterminate], [false, false]);
  assert.deepEqual([list.bar.copy.hidden, list.bar.del.hidden], [true, true]);
  sel.toggle('a');
  sel.paint(list, ['a', 'b']);
  assert.equal(list.bar.summary.textContent, '1 selected');
  assert.deepEqual([list.bar.all.checked, list.bar.all.indeterminate], [false, true]);
  assert.deepEqual([list.bar.copy.hidden, list.bar.del.hidden], [false, false]);
  sel.toggle('b');
  sel.paint(list, ['a', 'b']);
  assert.equal(list.bar.summary.textContent, '2 selected');
  assert.deepEqual([list.bar.all.checked, list.bar.all.indeterminate], [true, false]);
});

test('paint: a stale uuid (deleted component) counts for nothing', () => {
  const sel = createListSelection();
  const list = stubList(1);
  sel.toggle('gone'); sel.toggle('a');
  sel.paint(list, ['a']);
  assert.equal(list.bar.summary.textContent, '1 selected');
});

test('paintListSelection: no selection yet, no bar, rows without a box — all tolerated', () => {
  const list = stubList(2, { withBar: false });
  list.rows[1] = stubRow({ withBox: false });
  paintListSelection(list, ['a', 'b']);
  assert.ok(!list.rows[0].classes.has('--selected'));
  assert.equal(list.rows[0].box.checked, false);
});

test('listSelectionOf: one instance per element, distinct across elements', () => {
  const el1 = {}, el2 = {};
  assert.equal(listSelectionOf(el1), listSelectionOf(el1));
  assert.notEqual(listSelectionOf(el1), listSelectionOf(el2));
});

// ── listHeadSlot: the form group's sticky section head ───────────────────────

function el(cls = '') { const e = { className: cls, children: [], append(...k) { e.children.push(...k); }, prepend(...k) { e.children.unshift(...k); }, querySelector(sel) { return e.children.find(c => c.className === sel.replace(/^:scope > \./, '')) ?? null; }, closest() { return null; } }; return e; }
globalThis.document = { createElement: () => el() };

test('listHeadSlot: no form group → null (the bar then renders inside the list)', () => {
  assert.equal(listHeadSlot({ closest: () => null }), null);
  assert.equal(listHeadSlot({}), null);
});

test('listHeadSlot: first call moves the group label into a new head + bar slot, prepended to the group; later calls reuse it', () => {
  const label = el('more-buttons-label');
  const group = el('more-buttons-form-group');
  group.children.push(label, el('list-wrap'));
  group.querySelector = sel => {
    if (sel === ':scope > .mb-list-head') return group.children.find(c => c.className === 'mb-list-head') ?? null;
    if (sel === ':scope > .more-buttons-label') return label;
    return null;
  };
  const list = { closest: sel => (sel === '.more-buttons-form-group' ? group : null) };
  const slot = listHeadSlot(list);
  assert.equal(slot.className, 'mb-list-head__bar');
  const head = group.children[0];
  assert.equal(head.className, 'mb-list-head');
  assert.deepEqual(head.children.map(c => c.className), ['more-buttons-label', 'mb-list-head__bar']);
  assert.equal(group.children.length, 3, 'head prepended; the label is now inside it (the stub keeps its old slot)');
  assert.equal(listHeadSlot(list), slot, 'idempotent');
});

test('paint: the bar is looked up in the group head first, then at the top of the list', () => {
  const sel = createListSelection();
  const list = stubList(1);
  const headBar = stubBar();
  const group = { querySelector: s => (s === ':scope > .mb-list-head > .mb-list-head__bar .mb-list-bar' ? headBar : null) };
  list.closest = s => (s === '.more-buttons-form-group' ? group : null);
  sel.toggle('a');
  sel.paint(list, ['a']);
  assert.equal(headBar.summary.textContent, '1 selected');
  assert.equal(list.bar.summary.textContent, '', 'the in-list bar is ignored when a head exists');
});

console.log(`\n${passed} passed`);
