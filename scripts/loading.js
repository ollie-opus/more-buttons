// loading.js — the single owner of every loading affordance in the extension.
//
//   1. formLoading (singleton): the navigation loading state. show() arms a
//      200ms grace timer; if the navigation is still in flight when it fires,
//      a translucent veil with a spinner is centered INSIDE the open form
//      tile (.more-buttons-overlay-content) — the form's DOM is never touched,
//      because in-flight handlers still read the old form's fields. If no form
//      is open (fresh entry), a standalone loading tile is shown instead.
//      dismiss() cancels/removes either. Idempotent both ways.
//
//      Arming sites: form.js's data-action dispatcher, form.js navigateTo()
//      (back/forward/crumb), guides.js card navigations, captures.js insert
//      chains. Dismissal: createForm() at HTML render + fetch error, overlay
//      cleanup(), every arming site's finally, and setButtonBusy() (a busy
//      button is richer feedback than the veil, so it takes over).
//
//   2. loadingMarkup(label): canonical inline placeholder for content areas
//      that load after their form renders (previews, panels, trees).
//
//   3. setButtonBusy / snapshotButton / restoreButton: amber busy-button
//      progress for GitHub commits (moved from form.js; form.js re-exports).
//
// Deps are injectable so the state machine is testable in plain node
// (see tests/loading.test.mjs).

const SPINNER =
  '<span class="more-buttons-icon more-buttons-icon--spin">progress_activity</span>';

// Open form tiles, excluding the standalone loading tile itself.
const TILE_SELECTOR = '.more-buttons-overlay-content:not(.more-buttons-loading-tile)';

export function loadingMarkup(label = 'Loading…') {
  return `<p class="more-buttons-description more-buttons-loading-inline">${SPINNER}${label}</p>`;
}

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

// ── Busy buttons (moved verbatim from form.js, plus the dismiss handoff) ────

// Put a save/publish button into the amber "working" state while a GitHub
// commit runs: disabled, amber, spinning change_circle icon, and a progress message.
// The icon is built once (so the spin doesn't restart on each message tick) and
// only the message span updates on subsequent calls.
export function setButtonBusy(btn, message) {
  // A busy button is the action's own loading UX — drop any pending/visible
  // navigation veil so the two never compete.
  formLoading.dismiss();
  if (!btn) return;
  btn.disabled = true;
  if (!btn.classList.contains('busy')) {
    btn.classList.remove('info', 'success', 'publish', 'danger', 'secondary');
    btn.classList.add('busy');
    btn.innerHTML = '<span class="more-buttons-icon more-buttons-icon--spin">change_circle</span><span data-busy-msg></span>';
  }
  const msgEl = btn.querySelector('[data-busy-msg]');
  if (msgEl) msgEl.textContent = message;
  else btn.textContent = message;
}

// Capture/restore a button's look so a non-dynamic (publish) button can be put
// back after a busy state on error. Dynamic save buttons use _refreshSaveState
// instead.
export function snapshotButton(btn) {
  return btn ? { html: btn.innerHTML, className: btn.className } : null;
}

export function restoreButton(btn, snap) {
  if (!btn || !snap) return;
  btn.className = snap.className;
  btn.innerHTML = snap.html;
  btn.disabled = false;
}
