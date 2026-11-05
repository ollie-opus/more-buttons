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
// + `--selected` class, the tile head's select-all box (checked /
// indeterminate), and the selection bar in the form's actions dock ("2 of 6
// selected · Select all · Copy · Delete · ×"), which replaces the dock's
// buttons (CSS, via `--selecting`) while anything is picked.

const ROW_SEL = ':scope > .mb-component-row';
const ROW_BOX_SEL = ':scope > .mb-component-select > [data-select-row]';
const HEAD_SEL = ':scope > .mb-list-tile__head';
const DOCK_SEL = ':scope > .more-buttons-form-actions';
const BAR_SEL = ':scope > .mb-selection-bar';
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
    paint(listEl, orderUuids, opts) { paintListSelection(listEl, orderUuids, sel, opts); },
  };
  return sel;
}

// The selection owned by a list element, created on first use.
export function listSelectionOf(listEl) {
  return (listEl._listSel ??= createListSelection());
}

// The bar's count, against the list's total.
export function selectionSummary(selected, total) {
  return `${selected} of ${total} selected`;
}

// The selection bar: count, Select all, Copy, Delete (unless `canDelete` is
// off: view-only lists, a grid not yet in its file), and a clear (×) button.
// Its controls are deliberately NOT `.more-buttons-button`: form.js lifts
// every such button in the dock into an icon tile (syncDockTag).
export function selectionBarHtml({ canDelete = true } = {}) {
  return '<div class="mb-selection-bar">'
    + '<span class="mb-selection-bar__count" data-select-summary></span>'
    + '<button type="button" class="mb-selection-bar__btn" data-select-all-btn>Select all</button>'
    + '<span class="mb-selection-bar__sep"></span>'
    + '<button type="button" class="mb-selection-bar__btn" data-copy-selected title="Copy the selected items">Copy</button>'
    + (canDelete ? '<button type="button" class="mb-selection-bar__btn --danger" data-delete-selected title="Delete the selected items">Delete</button>' : '')
    + '<span class="mb-selection-bar__sep"></span>'
    + '<button type="button" class="mb-selection-bar__btn --icon" data-clear-selection aria-label="Clear selection" title="Clear selection"><span class="more-buttons-icon">x</span></button>'
    + '</div>';
}

// The actions dock of the form holding `listEl`: form.js relocates
// `.more-buttons-form-actions` to be a direct child of the overlay content,
// beside the form. Null for a list outside an overlay form.
export function dockOf(listEl) {
  return listEl.closest?.('form')?.parentElement?.querySelector?.(DOCK_SEL) ?? null;
}

// The dock's selection bar, created as its last child when missing. Missing
// is normal: the live screens rebuild the dock's innerHTML after render, and
// the first paint of a fresh form finds no bar either.
function ensureSelectionBar(dock, canDelete) {
  let bar = dock.querySelector(BAR_SEL);
  if (!bar) {
    dock.insertAdjacentHTML('beforeend', selectionBarHtml({ canDelete }));
    bar = dock.querySelector(BAR_SEL);
  }
  return bar;
}

// Called by the list renderers after every render and by the click handlers
// after a change. Index-aligned: the renderers emit exactly one
// `.mb-component-row` per item of the order array (the tile head and the
// insert triggers are siblings, not rows). Works before any selection exists.
// `canDelete` shapes the bar on creation (the owner knows whether its list
// can delete). With nothing picked the bar node stays; CSS hides it.
export function paintListSelection(listEl, orderUuids, sel = listEl._listSel, { canDelete = true } = {}) {
  const rows = listEl.querySelectorAll(ROW_SEL);
  let n = 0;
  rows.forEach((row, i) => {
    const on = !!sel?.has(orderUuids[i]);
    if (on) n++;
    row.classList.toggle('--selected', on);
    const box = row.querySelector(ROW_BOX_SEL);
    if (box) box.checked = on;
  });
  const total = rows.length;
  const all = listEl.querySelector(HEAD_SEL)?.querySelector('[data-select-all]');
  if (all) {
    all.checked = n > 0 && n === total;
    all.indeterminate = n > 0 && n < total;
  }
  const dock = dockOf(listEl);
  if (!dock) return;
  if (n > 0) {
    const summary = ensureSelectionBar(dock, canDelete)?.querySelector('[data-select-summary]');
    if (summary) summary.textContent = selectionSummary(n, total);
  }
  dock.classList.toggle('--selecting', n > 0);
}
