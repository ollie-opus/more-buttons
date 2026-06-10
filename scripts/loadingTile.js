// Full-screen "Loading…" tile shown during slow form-to-form navigations
// (e.g. library insert → capture editor: parent replay + GitHub fetches can
// take 1-2s with no feedback). The tile layers ON TOP of any open overlay and
// never touches the current form's DOM — action handlers read the old form's
// fields while the navigation is in flight.
//
// form.js owns the singleton: the data-action click dispatcher show()s before
// running action steps and dismiss()es in a finally; createForm() dismiss()es
// as soon as the destination form's HTML renders, so the form is interactive
// the moment it exists.
//
// Deps are injectable so the grace/dismiss state machine is testable in plain
// node (see tests/loadingTile.test.mjs).
export function createLoadingTile({
  doc = globalThis.document,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (id) => clearTimeout(id),
  graceMs = 200,
} = {}) {
  let timer = null;
  let overlay = null;

  // Arm the grace timer; the tile only appears if a navigation is still in
  // flight when it fires, so fast actions never flash it. No-op while a show
  // is already pending or visible.
  function show() {
    if (timer !== null || overlay) return;
    timer = schedule(() => {
      timer = null;
      overlay = doc.createElement('div');
      overlay.className = 'more-buttons-overlay';
      const content = doc.createElement('div');
      content.className = 'more-buttons-overlay-content more-buttons-loading-tile';
      content.innerHTML =
        '<span class="more-buttons-icon more-buttons-icon--spin">progress_activity</span>' +
        '<p class="more-buttons-description">Loading…</p>';
      overlay.appendChild(content);
      doc.body.appendChild(overlay);
    }, graceMs);
  }

  function dismiss() {
    if (timer !== null) { cancel(timer); timer = null; }
    if (overlay) { overlay.remove(); overlay = null; }
  }

  return { show, dismiss };
}
