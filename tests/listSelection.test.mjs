import assert from 'node:assert/strict';
import {
  createListSelection, listSelectionOf, selectionSummary, paintListSelection, listCountBadge, clearSelectionIfSelecting,
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
// The tile head: the select-all box, the count slot, and a classList.
function stubHead() {
  const head = {
    all: { checked: false, indeterminate: false },
    summary: { textContent: '' },
    classes: new Set(),
    classList: {
      toggle(cls, on) { on ? head.classes.add(cls) : head.classes.delete(cls); },
      contains(cls) { return head.classes.has(cls); },
    },
    querySelector(sel) {
      if (sel === '[data-select-all]') return head.all;
      if (sel === '[data-select-summary]') return head.summary;
      throw new Error('unexpected ' + sel);
    },
  };
  return head;
}
function stubList(n, { withHead = true } = {}) {
  const rows = Array.from({ length: n }, () => stubRow());
  const head = withHead ? stubHead() : null;
  return {
    rows, head,
    querySelectorAll(sel) { assert.equal(sel, ':scope > .mb-component-row'); return rows; },
    querySelector(sel) { assert.equal(sel, ':scope > .mb-list-tile__head'); return head; },
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
  assert.deepEqual([list.head.all.checked, list.head.all.indeterminate], [false, false]);
  sel.toggle('a');
  sel.paint(list, ['a', 'b']);
  assert.deepEqual([list.head.all.checked, list.head.all.indeterminate], [false, true]);
  sel.toggle('b');
  sel.paint(list, ['a', 'b']);
  assert.deepEqual([list.head.all.checked, list.head.all.indeterminate], [true, false]);
});

// ── The header's selecting state (count + actions live in the tile head) ─────

test('paint with a selection flags the head --selecting and writes the count; with none it unflags', () => {
  const list = stubList(3);
  const sel = createListSelection(); sel.add('u1');
  paintListSelection(list, ['u0', 'u1', 'u2'], sel);
  assert.ok(list.head.classes.has('--selecting'));
  assert.equal(list.head.summary.textContent, '1 of 3 selected');
  sel.clear(); paintListSelection(list, ['u0', 'u1', 'u2'], sel);
  assert.ok(!list.head.classes.has('--selecting'));
});

test('paint: a stale uuid (deleted component) counts for nothing', () => {
  const sel = createListSelection();
  const list = stubList(1);
  sel.toggle('gone'); sel.toggle('a');
  sel.paint(list, ['a']);
  assert.equal(list.head.summary.textContent, '1 of 1 selected');
});

test('paintListSelection: no selection yet, no head, rows without a box — all tolerated', () => {
  const list = stubList(2, { withHead: false });
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

// ── Stuck detection: the head is sticky under the navbar; --stuck squares it ──

test('paint observes the head once (root = the scrolling form) and flags --stuck only at the top edge', () => {
  const made = [];
  const Saved = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = class {
    constructor(cb, opts) { this.cb = cb; this.opts = opts; this.targets = []; made.push(this); }
    observe(el) { this.targets.push(el); }
  };
  try {
    const form = {};
    const list = stubList(1);
    list.closest = sel => (sel === 'form' ? form : null);
    paintListSelection(list, ['a']);
    paintListSelection(list, ['a']);
    assert.equal(made.length, 1, 'one observer per head');
    assert.equal(made[0].opts.root, form);
    assert.deepEqual(made[0].opts.threshold, [1]);
    assert.deepEqual(made[0].targets, [list.head]);
    const fire = (ratio, top, rootTop = 100) => made[0].cb([{ intersectionRatio: ratio, boundingClientRect: { top }, rootBounds: { top: rootTop } }]);
    fire(0.97, 99); assert.ok(list.head.classes.has('--stuck'), 'glued under the navbar (1px above the root)');
    fire(1, 100); assert.ok(!list.head.classes.has('--stuck'), 'fully visible');
    fire(0.5, 700); assert.ok(!list.head.classes.has('--stuck'), 'peeking in at the bottom is not stuck');
  } finally {
    if (Saved) globalThis.IntersectionObserver = Saved; else delete globalThis.IntersectionObserver;
  }
});

test('paint without IntersectionObserver (Node) skips the stuck watcher', () => {
  const list = stubList(1);
  list.closest = () => ({});
  paintListSelection(list, ['a']);
  assert.equal(list.head._stuckObs, undefined);
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

test('clearSelectionIfSelecting: unchecks a selecting head\'s Select all through a click, else does nothing', () => {
  let clicks = 0;
  // A real checkbox toggles on click(): arming it checked makes the click land unchecked.
  const box = { checked: false, indeterminate: true, click() { clicks++; this.checked = !this.checked; this.indeterminate = false; } };
  const content = { querySelector: s => (s === '.mb-list-tile__head.--selecting [data-select-all]' ? box : null) };
  assert.equal(clearSelectionIfSelecting(content), true);
  assert.equal(clicks, 1); assert.equal(box.checked, false);
  assert.equal(clearSelectionIfSelecting({ querySelector: () => null }), false);
  assert.equal(clearSelectionIfSelecting(null), false);
});

console.log(`\n${passed} passed`);
