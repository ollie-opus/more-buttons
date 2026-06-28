// loading.js — the single owner of every loading affordance in the extension.
//
//   1. formLoading (singleton): THE loading state. show() arms a 200ms grace
//      timer; if the work is still in flight when it fires, a translucent
//      veil with a spinner is centered INSIDE the open form tile
//      (.more-buttons-overlay-content) — the form's DOM is never touched,
//      because in-flight handlers still read the old form's fields. If no form
//      is open (fresh entry), a standalone loading tile is shown instead.
//      dismiss() cancels/removes either. Idempotent both ways.
//
//      Arming sites: form.js's data-action dispatcher, form.js navigateTo()
//      (back/forward/crumb), guides.js card navigations, captures.js insert
//      chains, and every async sub-content fetch (previews, panels, trees) —
//      all loading funnels through the veil; there is no inline variant.
//      Dismissal: createForm() at HTML render + fetch error, overlay
//      cleanup(), every arming site's finally, and setButtonBusy() (a busy
//      button is richer feedback than the veil, so it takes over).
//
//   2. setButtonBusy / snapshotButton / restoreButton: amber busy-button
//      progress for GitHub commits (moved from form.js; form.js re-exports).
//
// Deps are injectable so the state machine is testable in plain node
// (see tests/loading.test.mjs).

const SPINNER =
  '<span class="more-buttons-icon more-buttons-icon--spin">progress_activity</span>';

// Open form tiles, excluding the standalone loading tile itself.
const TILE_SELECTOR = '.more-buttons-overlay-content:not(.more-buttons-loading-tile)';

export function createFormLoading({
  doc = globalThis.document,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (id) => clearTimeout(id),
  graceMs = 200,
} = {}) {
  let timer = null;
  let element = null; // the veil, or the fallback overlay

  function show() {
    if (timer !== null || element) return;
    timer = schedule(() => {
      timer = null;
      const tiles = doc.querySelectorAll(TILE_SELECTOR);
      const host = tiles.length ? tiles[tiles.length - 1] : null;
      if (host) {
        element = doc.createElement('div');
        element.className = 'more-buttons-loading-veil';
        element.innerHTML = `${SPINNER}<p class="more-buttons-description">Loading…</p>`;
        host.appendChild(element);
      } else {
        element = doc.createElement('div');
        element.className = 'more-buttons-overlay';
        const content = doc.createElement('div');
        content.className = 'more-buttons-overlay-content more-buttons-loading-tile';
        content.innerHTML = `${SPINNER}<p class="more-buttons-description">Loading…</p>`;
        element.appendChild(content);
        doc.body.appendChild(element);
      }
    }, graceMs);
  }

  function dismiss() {
    if (timer !== null) { cancel(timer); timer = null; }
    if (element) { element.remove(); element = null; }
  }

  return { show, dismiss };
}

// Shared singleton. Module-eval-safe outside the browser: the defaults only
// dereference `document` inside show(), which tests never reach (they inject).
export const formLoading = createFormLoading();

// ── Dock tags ───────────────────────────────────────────────────────────────

// Dock action buttons (the macOS-dock bar) are square icon-only tiles; their
// label lives in a floating tag above the tile, rendered as a CSS pseudo-element
// that reads `data-mb-tag`. This mirrors a button's inline label into that
// attribute (and `aria-label`, since the visible text node is then removed so the
// square shows only its icon). Idempotent: a second call on an already-synced
// button (icon only) finds no label and leaves the existing tag untouched.
export function syncDockTag(btn) {
  if (!btn || btn.nodeType !== 1) return;
  let label = '';
  for (const node of [...btn.childNodes]) {
    // Keep the icon glyph; everything else is label text we lift into the tag.
    if (node.nodeType === 1 && node.classList?.contains('more-buttons-icon')) continue;
    label += node.textContent || '';
    node.remove();
  }
  label = label.trim();
  if (!label) return;
  btn.dataset.mbTag = label;
  btn.setAttribute('aria-label', label);
}

// ── Busy buttons (moved verbatim from form.js, plus the dismiss handoff) ────

// Put a save/publish button into the amber "working" state while a GitHub
// commit runs: disabled, amber, spinning change_circle icon, and a progress
// message. The progress message rides in the dock tag (`data-mb-tag`), which the
// `.busy` rule keeps visible without a hover — so the square stays icon-only and
// the message never doubles up inline. The icon is built once (so the spin
// doesn't restart on each message tick); only the tag text updates after that.
export function setButtonBusy(btn, message) {
  // A busy button is the action's own loading UX — drop any pending/visible
  // navigation veil so the two never compete.
  formLoading.dismiss();
  if (!btn) return;
  btn.disabled = true;
  if (!btn.classList.contains('busy')) {
    btn.classList.remove('info', 'success', 'publish', 'danger', 'secondary');
    btn.classList.add('busy');
    btn.innerHTML = '<span class="more-buttons-icon more-buttons-icon--spin">change_circle</span>';
  }
  btn.dataset.mbTag = message;
  btn.setAttribute('aria-label', message);
}

// Capture/restore a button's look so a non-dynamic (publish) button can be put
// back after a busy state on error. Dynamic save buttons use _refreshSaveState
// instead.
export function snapshotButton(btn) {
  return btn
    ? { html: btn.innerHTML, className: btn.className, tag: btn.dataset.mbTag }
    : null;
}

export function restoreButton(btn, snap) {
  if (!btn || !snap) return;
  btn.className = snap.className;
  btn.innerHTML = snap.html;
  btn.disabled = false;
  // The busy cycle overwrote the dock tag with its progress message; put the
  // button's own label back (snapshot taken after it was synced to icon-only).
  if (snap.tag != null) { btn.dataset.mbTag = snap.tag; btn.setAttribute('aria-label', snap.tag); }
  else delete btn.dataset.mbTag;
}
