import assert from 'node:assert/strict';
import {
  createListSelection, listSelectionOf, selectionSummary, paintListSelection, listCountBadge, selectionBarHtml, dockOf, clearSelectionIfSelecting,
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
// The tile head: just the select-all box.
function stubBar() {
  const bar = {
    all: { checked: false, indeterminate: false },
    querySelector(sel) {
      if (sel === '[data-select-all]') return bar.all;
      throw new Error('unexpected ' + sel);
    },
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
// The form's actions dock (outside the form): the selection bar is created in
// it on first use. Each inserted bar remembers the elements it hands out.
function fakeDock() {
  const dock = {
    classList: new Set(), children: [],
    querySelector(s) { return s.includes('mb-selection-bar') ? this.children[0] ?? null : null; },
    insertAdjacentHTML(where, html) {
      assert.equal(where, 'beforeend');
      const els = {};
      this.children.push({ html, querySelector: sel => (els[sel] ??= { textContent: '', hidden: false, sel }) });
    },
  };
  dock.classList.toggle = (c, on) => on ? dock.classList.add(c) : dock.classList.delete(c);
  return dock;
}
// A list of n rows inside a form whose overlay content holds `dock`.
function fakeList(n, dock) {
  const list = stubList(n);
  list.closest = sel => (sel === 'form' ? { parentElement: { querySelector: s => (s === ':scope > .more-buttons-form-actions' ? dock : null) } } : null);
  return list;
}
const barSummary = dock => dock.children[0].querySelector('[data-select-summary]').textContent;

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

test('selectionSummary counts against the total', () => {
  assert.equal(selectionSummary(2, 6), '2 of 6 selected');
  assert.equal(selectionSummary(1, 1), '1 of 1 selected');
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

test('paint: the tile head box reads nothing / partial (indeterminate) / all', () => {
  const sel = createListSelection();
  const list = stubList(2);
  sel.paint(list, ['a', 'b']);
  assert.deepEqual([list.bar.all.checked, list.bar.all.indeterminate], [false, false]);
  sel.toggle('a');
  sel.paint(list, ['a', 'b']);
  assert.deepEqual([list.bar.all.checked, list.bar.all.indeterminate], [false, true]);
  sel.toggle('b');
  sel.paint(list, ['a', 'b']);
  assert.deepEqual([list.bar.all.checked, list.bar.all.indeterminate], [true, false]);
});

test('paint: a stale uuid (deleted component) counts for nothing', () => {
  const dock = fakeDock();
  const sel = createListSelection();
  const list = fakeList(1, dock);
  sel.toggle('gone'); sel.toggle('a');
  sel.paint(list, ['a']);
  assert.equal(barSummary(dock), '1 of 1 selected');
});

// ── The selection bar in the actions dock ────────────────────────────────────

test('dockOf: the form\'s relocated actions dock, or null for a list outside a form', () => {
  const dock = fakeDock();
  assert.equal(dockOf(fakeList(1, dock)), dock);
  assert.equal(dockOf(stubList(1)), null);
  assert.equal(dockOf({ closest: () => null }), null);
});

test('paint with a selection creates the bar in the dock and flags --selecting; with none it unflags', () => {
  const dock = fakeDock();
  const list = fakeList(3, dock);
  const sel = createListSelection(); sel.add('u1');
  paintListSelection(list, ['u0', 'u1', 'u2'], sel);
  assert.equal(dock.children.length, 1); assert.ok(dock.classList.has('--selecting'));
  assert.equal(barSummary(dock), '1 of 3 selected');
  sel.clear(); paintListSelection(list, ['u0', 'u1', 'u2'], sel);
  assert.ok(!dock.classList.has('--selecting')); assert.equal(dock.children.length, 1, 'bar node kept');
});

test('bar is recreated when the dock was rebuilt (live dock replaces innerHTML)', () => {
  const dock = fakeDock(); const list = fakeList(2, dock); const sel = createListSelection(); sel.add('u0');
  paintListSelection(list, ['u0', 'u1'], sel); dock.children.length = 0;
  paintListSelection(list, ['u0', 'u1'], sel); assert.equal(dock.children.length, 1);
});

test('paint: the bar is built without Delete when the caller says canDelete: false', () => {
  const dock = fakeDock(); const list = fakeList(2, dock); const sel = createListSelection(); sel.add('u0');
  paintListSelection(list, ['u0', 'u1'], sel, { canDelete: false });
  assert.ok(!dock.children[0].html.includes('data-delete-selected'));
});

test('paint: no dock (a list outside an overlay form) paints the rows and stops', () => {
  const list = stubList(1);
  const sel = createListSelection(); sel.add('a');
  paintListSelection(list, ['a'], sel);
  assert.ok(list.rows[0].classes.has('--selected'));
});

test('selectionBarHtml: canDelete false drops Delete; no .more-buttons-button inside', () => {
  const html = selectionBarHtml({ canDelete: false });
  assert.ok(!html.includes('data-delete-selected')); assert.ok(!html.includes('more-buttons-button'));
  assert.ok(selectionBarHtml({ canDelete: true }).includes('data-delete-selected'));
  for (const hook of ['data-select-summary', 'data-select-all-btn', 'data-copy-selected', 'data-clear-selection']) assert.ok(html.includes(hook), hook);
  assert.ok(html.includes('<span class="more-buttons-icon">x</span>'), 'the clear button is a lucide x');
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

test('clearSelectionIfSelecting: clicks the dock bar\'s clear button while selecting, else does nothing', () => {
  let clicks = 0;
  const content = { querySelector: s => (s === ':scope > .more-buttons-form-actions.--selecting [data-clear-selection]' ? { click() { clicks++; } } : null) };
  assert.equal(clearSelectionIfSelecting(content), true); assert.equal(clicks, 1);
  assert.equal(clearSelectionIfSelecting({ querySelector: () => null }), false);
  assert.equal(clearSelectionIfSelecting(null), false);
});

console.log(`\n${passed} passed`);
