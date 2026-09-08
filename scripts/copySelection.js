// Shift+click multi-select for the card lists' Copy buttons (components list in
// guides.js, grid cell list in gridEditor.js). Leaf module — no imports — so the
// Node tests can load it without the chrome.* surface that cardRenderer pulls in.
//
// The selection is a Set of uuids keyed to ONE list element (`listEl._copySel`,
// same expando convention as `formEl._grid`). It is never stored by index: the
// renderer repaints it after every render from the current order array, so a
// rail move or a child-form round trip keeps the highlight on the same cards.
//
// Copy-button labels are a pure function of (Shift held, row selected):
// "Copy" at rest, "Multi copy" while Shift is held, "Copied ✓" on a selected
// card while Shift is held. One document-level Shift tracker (installed on
// first paint) relabels every rendered row on press/release, so the status
// persists exactly until the card is unselected or Shift is lifted.

const ROW_SEL = ':scope > .mb-component-row';
const COPY_BTN_SEL = ':scope > .mb-incident-card > .mb-incident-card__foot [data-copy-component-md], :scope > .mb-incident-card > .mb-incident-card__foot [data-copy-grid-cell]';

let shiftHeld = false;
let trackingInstalled = false;

export function createCopySelection() {
  const set = new Set();
  const sel = {
    get size() { return set.size; },
    has(uuid) { return set.has(uuid); },
    toggle(uuid) { set.has(uuid) ? set.delete(uuid) : set.add(uuid); },
    clear() { set.clear(); },
    // Document order regardless of click order; uuids no longer rendered drop out.
    ordered(orderUuids) { return orderUuids.filter(u => set.has(u)); },
    paint(listEl, orderUuids) { paintCopySelection(listEl, orderUuids, sel); },
  };
  return sel;
}

// The selection owned by a list element, created on first use.
export function copySelectionOf(listEl) {
  return (listEl._copySel ??= createCopySelection());
}

export function copyButtonLabel(shift, selected) {
  return shift ? (selected ? 'Copied ✓' : 'Multi copy') : 'Copy';
}

// Mark one row: the --selected outline plus its Copy button's label. A button
// mid-flash ("Copy failed") keeps the flash text; `restLabel` is what the flash
// restores to (see flashButtonLabel in guides.js).
function paintRow(row, selected) {
  row.classList.toggle('--selected', selected);
  const btn = row.querySelector(COPY_BTN_SEL);
  if (!btn) return;
  const label = copyButtonLabel(shiftHeld, selected);
  btn.dataset.restLabel = label;
  if (!btn.dataset.flashing) btn.textContent = label;
}

// Called by the list renderers after every render (and by the copy handlers
// after a toggle). Index-aligned: both renderers emit exactly one
// `.mb-component-row` per item of the order array (insert triggers are
// siblings, not rows). Works before any selection exists so Shift labels show.
export function paintCopySelection(listEl, orderUuids, sel = listEl._copySel) {
  ensureShiftTracking();
  const rows = listEl.querySelectorAll(ROW_SEL);
  rows.forEach((row, i) => paintRow(row, !!sel?.has(orderUuids[i])));
}

// Relabel every rendered row under `root` from its current --selected class.
export function repaintCopyLabels(root) {
  root.querySelectorAll('.mb-component-row').forEach(row => paintRow(row, row.classList.contains('--selected')));
}

export function isShiftHeld() { return shiftHeld; }

// Idempotent; relabels the whole document on a change. Also used by the copy
// handlers to resync from the click's own shiftKey (a keydown can be missed
// when Shift was already down before the page had focus).
export function setShiftHeld(on) {
  on = !!on;
  if (shiftHeld === on) return;
  shiftHeld = on;
  if (typeof document !== 'undefined') repaintCopyLabels(document);
}

function ensureShiftTracking() {
  if (trackingInstalled || typeof document === 'undefined') return;
  trackingInstalled = true;
  // Capture phase: editors inside the form may stop propagation of key events.
  document.addEventListener('keydown', e => { if (e.key === 'Shift') setShiftHeld(true); }, true);
  document.addEventListener('keyup', e => { if (e.key === 'Shift') setShiftHeld(false); }, true);
  // Alt-tabbing away swallows the keyup — never leave "Multi copy" stuck.
  window.addEventListener('blur', () => setShiftHeld(false));
}
