import assert from 'node:assert/strict';
import {
  createListSelection, listSelectionOf, selectionSummary, paintListSelection, listCountBadge,
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
    querySelector(sel) { assert.equal(sel, ':scope > .mb-list-tile__head'); return bar; },
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

// ── listCountBadge: the "· n" count after the group's eyebrow label ──────────

test('listCountBadge: appends one count span to the group label, updates it, removes at 0', () => {
  const label = { children: [], textContent: 'Components', querySelector: s => label.children.find(c => c.className === 'mb-eyebrow-count') ?? null, appendChild(c) { label.children.push(c); } };
  const group = { querySelector: s => (s === ':scope > .more-buttons-label' ? label : null), ownerDocument: { createElement: () => ({ className: '', textContent: '', remove() { label.children = label.children.filter(c => c !== this); } }) } };
  const span = listCountBadge(group, 6);
  assert.equal(span.className, 'mb-eyebrow-count'); assert.equal(span.textContent, '· 6');
  assert.equal(listCountBadge(group, 2), span); assert.equal(span.textContent, '· 2');
  assert.equal(listCountBadge(group, 0), null); assert.equal(label.children.length, 0);
});

test('listCountBadge: no group (a list outside a form group) is a no-op', () => {
  assert.equal(listCountBadge(null, 3), null);
});

console.log(`\n${passed} passed`);
