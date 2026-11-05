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
// + `--selected` class, the tile header's select-all box (checked /
// indeterminate), and the header's selecting state (`--selecting`): the count
// ("2 of 6 selected") and the Copy / Delete buttons the header shows to the
// right of Select all while anything is picked. The header is sticky under the
// navbar; the paint also attaches the observer that flags it `--stuck`.

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
    paint(listEl, orderUuids, opts) { paintListSelection(listEl, orderUuids, sel, opts); },
  };
  return sel;
}

// The selection owned by a list element, created on first use.
export function listSelectionOf(listEl) {
  return (listEl._listSel ??= createListSelection());
}

// The header's count, against the list's total.
export function selectionSummary(selected, total) {
  return `${selected} of ${total} selected`;
}

// The tile header is `position: sticky; top: -1px`, so the observer (rooted on
// the scrolling form) sees it leave full visibility the moment it glues under
// the navbar: `--stuck` squares its top corners. A head peeking in at the
// bottom of the viewport also reports < 1, so the top edge decides. One
// observer per head element (a re-render makes a new head); none without
// IntersectionObserver (Node tests).
function watchListHeadStuck(head, listEl) {
  if (head._stuckObs || typeof IntersectionObserver !== 'function') return;
  const root = listEl.closest?.('form') ?? null;
  head._stuckObs = new IntersectionObserver(([e]) => {
    head.classList.toggle('--stuck', e.intersectionRatio < 1 && e.boundingClientRect.top <= (e.rootBounds?.top ?? 0));
  }, { root, threshold: [1] });
  head._stuckObs.observe(head);
}

// Escape while anything is picked clears the selection instead of closing the
// overlay (form.js's key handler asks first). `content` is the overlay content
// holding the form. True when a selection was cleared.
export function clearSelectionIfSelecting(content) {
  const all = content?.querySelector?.('.mb-list-tile__head.--selecting [data-select-all]');
  if (!all) return false;
  // Clearing goes through the owner's own Select-all handler (it repaints from
  // its list state). A click toggles a checkbox, so arm it checked first: the
  // click lands unchecked, which the owners read as "clear".
  all.checked = true;
  all.click();
  return true;
}

// Called by the list renderers after every render and by the click handlers
// after a change. Index-aligned: the renderers emit exactly one
// `.mb-component-row` per item of the order array (the tile header and the
// insert triggers are siblings, not rows). Works before any selection exists
// and on a list without a header (an empty list renders none).
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
  const total = rows.length;
  const head = listEl.querySelector(HEAD_SEL);
  if (!head) return;
  const all = head.querySelector('[data-select-all]');
  if (all) {
    all.checked = n > 0 && n === total;
    all.indeterminate = n > 0 && n < total;
  }
  const summary = head.querySelector('[data-select-summary]');
  if (summary) summary.textContent = n > 0 ? selectionSummary(n, total) : '';
  head.classList.toggle('--selecting', n > 0);
  watchListHeadStuck(head, listEl);
}
