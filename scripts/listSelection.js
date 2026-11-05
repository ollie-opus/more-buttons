// Checkbox selection for the card lists (components list in guides.js, grid
// cell list in gridEditor.js, their view-only twins in guideLiveView.js). Leaf
// module — no imports — so the Node tests can load it without the chrome.*
// surface that cardRenderer pulls in.
//
// The selection is a Set of uuids keyed to ONE list element (`listEl._listSel`,
// same expando convention as `formEl._grid`). It is never stored by index: the
// renderer repaints it after every render from the current order array, so a
// rail move or a child-form round trip keeps the checks on the same cards.
//
// The paint drives three things from (selection, order): each row's checkbox
// + `--selected` class, the header bar's select-all box (checked / indeterminate)
// and summary text, and the bar's Copy/Delete buttons (hidden until something
// is picked). The bar lives in the form group's sticky section head
// (listHeadSlot) when the list has one, else at the top of the list.

const ROW_SEL = ':scope > .mb-component-row';
const ROW_BOX_SEL = ':scope > .mb-component-select > [data-select-row]';
const BAR_SEL = ':scope > .mb-list-bar';
const GROUP_SEL = '.more-buttons-form-group';
const HEAD_BAR_SEL = ':scope > .mb-list-head > .mb-list-head__bar .mb-list-bar';

// The list's selection bar: in the section head when the list sits in a form
// group (listHeadSlot), else the list's own first child.
function barOf(listEl) {
  return listEl.closest?.(GROUP_SEL)?.querySelector?.(HEAD_BAR_SEL) ?? listEl.querySelector(BAR_SEL);
}

// Upgrades the form group holding `listEl` into a section header on first use:
// the group's label moves into a `.mb-list-head` row that spans both grid
// columns and sticks to the top of the scrolling form, with a slot beside the
// label for the selection bar. Returns that slot, or null when the list has no
// form group (the bar then renders inside the list). The head watches its own
// stuck state (an IntersectionObserver against the scrolling <form>, using the
// -1px top trick) to raise a hairline + shadow only while content slides under.
export function listHeadSlot(listEl) {
  const row = listEl.closest?.(GROUP_SEL);
  if (!row) return null;
  const existing = row.querySelector(':scope > .mb-list-head');
  if (existing) return existing.querySelector(':scope > .mb-list-head__bar');
  const label = row.querySelector(':scope > .more-buttons-label');
  if (!label) return null;
  const head = document.createElement('div');
  head.className = 'mb-list-head';
  const slot = document.createElement('div');
  slot.className = 'mb-list-head__bar';
  head.append(label, slot);
  row.prepend(head);
  watchStuck(head, row.closest('form'));
  return slot;
}

function watchStuck(head, scroller) {
  if (typeof IntersectionObserver !== 'function' || !scroller) return;
  const io = new IntersectionObserver(([e]) => {
    const atTop = !!e.rootBounds && e.boundingClientRect.top <= e.rootBounds.top + 1;
    head.classList.toggle('--stuck', e.intersectionRatio < 1 && atTop);
  }, { root: scroller, threshold: [1] });
  io.observe(head);
}

export function createListSelection() {
  const set = new Set();
  const sel = {
    get size() { return set.size; },
    has(uuid) { return set.has(uuid); },
    add(uuid) { if (uuid) set.add(uuid); },
    delete(uuid) { set.delete(uuid); },
    set(uuid, on) { on ? sel.add(uuid) : set.delete(uuid); },
    toggle(uuid) { set.has(uuid) ? set.delete(uuid) : sel.add(uuid); },
    clear() { set.clear(); },
    // Document order regardless of click order; uuids no longer rendered drop out.
    ordered(orderUuids) { return orderUuids.filter(u => set.has(u)); },
    paint(listEl, orderUuids) { paintListSelection(listEl, orderUuids, sel); },
  };
  return sel;
}

// The selection owned by a list element, created on first use.
export function listSelectionOf(listEl) {
  return (listEl._listSel ??= createListSelection());
}

// The bar's left-hand label: an invitation at rest, a count once anything is
// picked (the select-all box itself shows whether that count is everything).
export function selectionSummary(selected) {
  return selected ? `${selected} selected` : 'Select all';
}

// Called by the list renderers after every render and by the click handlers
// after a change. Index-aligned: the renderers emit exactly one
// `.mb-component-row` per item of the order array (the bar and the insert
// triggers are siblings, not rows). Works before any selection exists.
export function paintListSelection(listEl, orderUuids, sel = listEl._listSel) {
  const rows = listEl.querySelectorAll(ROW_SEL);
  let n = 0;
  rows.forEach((row, i) => {
    const on = !!sel?.has(orderUuids[i]);
    if (on) n++;
    row.classList.toggle('--selected', on);
    const box = row.querySelector(ROW_BOX_SEL);
    if (box) box.checked = on;
  });
  const bar = barOf(listEl);
  if (!bar) return;
  const total = rows.length;
  const all = bar.querySelector('[data-select-all]');
  if (all) {
    all.checked = n > 0 && n === total;
    all.indeterminate = n > 0 && n < total;
  }
  const summary = bar.querySelector('[data-select-summary]');
  if (summary) summary.textContent = selectionSummary(n);
  // The actions only exist while something is picked.
  bar.querySelectorAll('[data-copy-selected], [data-delete-selected]').forEach(btn => { btn.hidden = n === 0; });
}
