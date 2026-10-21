/**
 * pageNavigation.js — tells content.js WHEN the page changed, without polling.
 *
 * Two callbacks:
 *   onNavigate(url)  the url changed. Fired as early as possible so url-only work
 *                    (the page dock) can run before the new page has rendered.
 *   onSettle(url)    the page for that url has rendered, so DOM work
 *                    (automations) can run. Fired once per rendered body.
 *
 * Signals, in the order the host (a Hotwire Turbo Drive app) produces them:
 *   turbo:visit          location.href is already the new url → navigate
 *   turbo:before-render  (url read again, in case a visit event was missed)
 *   turbo:render         body has been swapped
 *   turbo:load           render finished → settle. Also fires once on the hard load.
 *   popstate/hashchange  back/forward and fragment changes → navigate; Turbo's
 *                        restoration visit then follows with the events above.
 *   DOMContentLoaded     hard load fallback → settle (first-wins: the turbo:load
 *                        that follows on a Turbo page sees the same body and is
 *                        ignored).
 *
 * Settling is keyed on (document.body, url): a same-url Turbo visit swaps the
 * body and settles again; a duplicate load event on an already-settled body
 * does not, which keeps non-idempotent automations from running twice.
 *
 * A url change that no load event follows within `fallbackMs` (a non-Turbo
 * pushState page, say) settles on a single timer, cleared the moment a real
 * load signal arrives. That timer is the only one in the module.
 *
 * Page-dispatched DOM events are visible to the content script's isolated
 * world; `event.detail` is not relied on, only `location.href` and `document.body`.
 *
 * No document/window/chrome access at module scope — the factory takes them as
 * arguments so the module imports and runs under Node for tests.
 */

const DOC_EVENTS = ['turbo:visit', 'turbo:before-render', 'turbo:render', 'turbo:load', 'DOMContentLoaded'];
const WIN_EVENTS = ['popstate', 'hashchange'];
const LOAD_EVENTS = new Set(['turbo:load', 'DOMContentLoaded']);

export function createNavigationWatcher({
  doc, win,
  onNavigate, onSettle,
  fallbackMs = 1500,
  setTimeout = globalThis.setTimeout,
  clearTimeout = globalThis.clearTimeout,
}) {
  let lastHref = null;
  let settledBody = null;
  let settledHref = null;
  let fallbackTimer = null;
  let started = false;

  const safely = (fn, url) => { try { fn(url); } catch (err) { console.error('MB Error: navigation handler failed', err); } };

  function clearFallback() {
    if (fallbackTimer === null) return;
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }

  function settle() {
    const href = win.location.href;
    const body = doc.body;
    clearFallback();
    if (body === settledBody && href === settledHref) return;
    settledBody = body;
    settledHref = href;
    safely(onSettle, href);
  }

  function announce() {
    const href = win.location.href;
    if (href === lastHref) return;
    lastHref = href;
    safely(onNavigate, href);
    // Something must settle this url. A load event clears the timer; on a page
    // whose navigation never produces one, the timer does the settling.
    clearFallback();
    fallbackTimer = setTimeout(() => { fallbackTimer = null; settle(); }, fallbackMs);
  }

  const onDocEvent = (event) => {
    announce();
    if (LOAD_EVENTS.has(event.type)) settle();
  };
  const onWinEvent = () => announce();

  return {
    start() {
      if (started) return;
      started = true;
      DOC_EVENTS.forEach((t) => doc.addEventListener(t, onDocEvent));
      WIN_EVENTS.forEach((t) => win.addEventListener(t, onWinEvent));
      announce();
      // Content scripts run at document_start, but the watcher can also start
      // after the DOM is already parsed (slow storage read); don't wait for a
      // DOMContentLoaded that has already happened.
      if (doc.readyState && doc.readyState !== 'loading') settle();
    },
    stop() {
      if (!started) return;
      started = false;
      clearFallback();
      DOC_EVENTS.forEach((t) => doc.removeEventListener(t, onDocEvent));
      WIN_EVENTS.forEach((t) => win.removeEventListener(t, onWinEvent));
    },
  };
}
