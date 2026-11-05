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
// The paint drives two things from (selection, order): each row's checkbox +
// `--selected` class, and the tile head's select-all box (checked /
// indeterminate). The selection's actions live in the form's dock.

const ROW_SEL = ':scope > .mb-component-row';
const ROW_BOX_SEL = ':scope > .mb-component-select > [data-select-row]';
const HEAD_SEL = ':scope > .mb-list-tile__head';
const COUNT_CLASS = 'mb-eyebrow-count';

// The "· n" count after a list group's eyebrow label ("COMPONENTS · 6"). One
// child span of the group's own label, so readers of the label's text (e.g.
// systemStatus.js service names) see it only on list groups. Removed at 0.
// No-op (null) for a list without a group.
export function listCountBadge(groupEl, n) {
  const label = groupEl?.querySelector?.(':scope > .more-buttons-label');
  if (!label) return null;
  let span = label.querySelector(`.${COUNT_CLASS}`);
  if (!n) { span?.remove(); return null; }
  if (!span) {
    span = (groupEl.ownerDocument ?? document).createElement('span');
    span.className = COUNT_CLASS;
    label.appendChild(span);
  }
  span.textContent = `· ${n}`;
  return span;
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
  const bar = listEl.querySelector(HEAD_SEL);
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
