/**
 * captureMode.js — Capture Mode controller.
 *
 * Owns:
 *   - Top bar UI (the orange ON-AIR bar)
 *   - Settings state (live-bound to bar controls, persisted to chrome.storage.local)
 *   - Session buffer (captures collected this session)
 *   - returnTo context (form to reopen on exit)
 *
 * Driven by:
 *   - Components "+ Insert New Capture" (runComponentCaptureFlow) →
 *       enterCaptureMode({ returnTo: { ... } })
 *
 * Exits:
 *   - Done button (or capture limit reached) → returnTo.onComplete(buffer): commit.
 *   - ✕ close button / Esc → returnTo.onCancel() if provided (discard), else
 *     falls back to onComplete(buffer) for callers that don't distinguish.
 *   - A second invocation of enterCaptureMode also exits (commit semantics).
 *
 * Persistence:
 *   - Settings (resize mode, padding, etc.) → chrome.storage.local (long-lived).
 *   - Active session (bar state, buffer, form-stack snapshot) → window.sessionStorage.
 *     Per-tab, dies on tab close, NOT shared with new tabs. Survives the hard
 *     navigations that Turbo doesn't catch (e.g. /sites → /sites/uuid).
 *     A refresh (performance navigation type "reload") wipes the slot so the
 *     user gets a clean slate — matches the user's "refresh shouldn't persist"
 *     intuition. Turbo nav doesn't need storage at all (JS context survives)
 *     but persistence is cheap to keep up to date and means the cold-restore
 *     path is the single recovery mechanism.
 */

import { installSelector, screenshotElement, enterResizeMode } from './captureElement.js';

const STORAGE_KEY = 'moreButtonsCaptureSettings';
const SESSION_KEY = 'moreButtonsCaptureSession';

function persistSession(snapshot) {
  try { window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(snapshot)); } catch {}
}
function clearSession() {
  try { window.sessionStorage.removeItem(SESSION_KEY); } catch {}
}
function readSession() {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function ensureStylesheet() {
  if (document.getElementById('more-buttons-overlay-stylesheet')) return;
  const link = document.createElement('link');
  link.id = 'more-buttons-overlay-stylesheet';
  link.rel = 'stylesheet';
  link.href = chrome.runtime.getURL('config/forms/formsStyling.css');
  (document.head || document.documentElement).appendChild(link);
}

let active = null; // { settings, sessionBuffer, returnTo, exit, bar, ... }
let starting = false; // synchronous re-entry guard while loadSettings() awaits

async function loadSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const s = stored[STORAGE_KEY] ?? {};
  return {
    resizeMode:      !!s.resizeMode,
    capturePadding:  0,
    themeDelay:      s.themeDelay ?? 500,
    scale:           6, // HIGH SCALE VALUES CAN CAUSE BROWSER CRASHES
  };
}

let saveTimer = null;
function persistSettings(settings) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    chrome.storage.local.set({
      [STORAGE_KEY]: {
        resizeMode:     settings.resizeMode,
        themeDelay:     settings.themeDelay,
      },
    });
  }, 200);
}

// ── Bar construction ─────────────────────────────────────────────────────────

function buildBar({ settings }) {
  const bar = document.createElement('div');
  bar.className = 'mb-capture-bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Capture Mode');

  bar.innerHTML = `
    <span class="mb-capture-bar__hint" data-bar-hint>Shift + click to capture</span>

    <div class="mb-capture-bar__divider" aria-hidden="true"></div>

    <div class="mb-capture-bar__group mb-capture-bar__settings">
      <button type="button"
        class="mb-capture-bar__toggle ${settings.resizeMode ? '--on' : ''}"
        data-bar-resize
        title="Resize mode: crop after picking"
        aria-pressed="${settings.resizeMode ? 'true' : 'false'}">
        <span class="more-buttons-icon" aria-hidden="true">crop_free</span>
        <span class="mb-capture-bar__toggle-label">Resize</span>
      </button>

      <div class="mb-capture-bar__stepper" data-bar-padding-wrap>
        <button type="button" class="mb-capture-bar__step" data-bar-padding-dec aria-label="Decrease padding">−</button>
        <input class="mb-capture-bar__step-value" type="number" inputmode="numeric" min="0"
          data-bar-padding value="${settings.capturePadding}" aria-label="Padding pixels" />
        <button type="button" class="mb-capture-bar__step" data-bar-padding-inc aria-label="Increase padding">+</button>
        <span class="mb-capture-bar__step-unit">px padding</span>
      </div>
    </div>

    <div class="mb-capture-bar__spacer"></div>

    <div class="mb-capture-bar__group mb-capture-bar__counter" data-bar-counter hidden>
      <span class="mb-capture-bar__counter-chip" data-bar-counter-chip>0</span>
      <span class="mb-capture-bar__counter-label">captured</span>
    </div>

    <button type="button" class="mb-capture-bar__done" data-bar-done>Done</button>

    <button type="button" class="mb-capture-bar__close" data-bar-close aria-label="Exit capture mode">
      <span class="more-buttons-icon" aria-hidden="true">close</span>
    </button>
  `;
  return bar;
}

// ── Controller ───────────────────────────────────────────────────────────────

/**
 * @param {Object} opts
 * @param {Object} [opts.returnTo]
 * @param {Function} [opts.returnTo.onComplete] — invoked with the session buffer
 *   on exit. Restoring the form / re-rendering the captures list is the
 *   caller's responsibility (the controller doesn't know about forms).
 * @param {Function} [opts.returnTo.onCancel] — invoked if the user dismisses
 *   capture mode with no captures collected (so the form can still re-show).
 * @param {Array} [opts.formStackSnapshot] — serialisable form stack from
 *   form.js's snapshotFormStack(). Used on cold exit (Done after a hard nav
 *   killed the original JS context) to replay the originating form.
 */
export async function enterCaptureMode(opts = {}) {
  // Re-entry while already active = exit. Matches the prior toggle behaviour
  // of the pink button: pressing it again drops you out cleanly.
  if (active) {
    exitCaptureMode();
    return;
  }
  // Synchronous guard so two clicks during loadSettings() don't both proceed.
  if (starting) return;
  starting = true;

  let settings;
  try {
    settings = await loadSettings();
  } catch (e) {
    starting = false;
    throw e;
  }
  const restored = opts.__restored ?? null;
  if (restored?.settings) Object.assign(settings, restored.settings);
  const hasReturnTo = !!opts.returnTo;

  ensureStylesheet();
  const bar = buildBar({ settings });
  // Always-visible left tab — peeks below the hidden bar so the user knows
  // capture mode is active and has a hover target to reveal the full bar.
  const tab = document.createElement('div');
  tab.className = 'mb-capture-tab';
  tab.innerHTML = `
    <span class="mb-capture-tab__dot" aria-hidden="true"></span>
    <span class="mb-capture-tab__label">Capture mode</span>
  `;
  // Viewport-edge glow — a non-interactive overlay that draws a warm inset
  // shadow around the left, right, and bottom edges so the whole page
  // reads as "inside capture mode". The top edge is intentionally skipped
  // because the bar already sits there with its own shadow.
  const glow = document.createElement('div');
  glow.className = 'mb-capture-glow';
  glow.setAttribute('aria-hidden', 'true');
  // The bar's stylesheet loads asynchronously via <link>. Until it applies,
  // the bar renders with default styles (no transform) and is fully
  // visible at the top, which then animates out once the CSS loads —
  // producing a startup flicker. Pin the bar's hidden transform inline
  // (no transition for the first frame) so the very first paint is hidden.
  bar.style.transform = 'translateY(-100%)';
  bar.style.transition = 'none';
  // Mount as a sibling of <body>, not inside it. Turbo navigations on
  // opus-safety replace <body> wholesale; siblings of body survive — so the
  // bar and its event handlers persist across navigation without any
  // serialisation.
  document.documentElement.appendChild(glow);
  document.documentElement.appendChild(bar);
  document.documentElement.appendChild(tab);
  // After the first paint, clear the inline overrides so the stylesheet's
  // transition takes over for subsequent reveal/hide.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    bar.style.transform = '';
    bar.style.transition = '';
  }));

  // Bar's left padding (set in CSS via --tab-w) reserves space for the tab
  // so the bar's controls render to the right of it rather than underneath.

  // Reveal/hide the full bar based on cursor proximity to the top edge.
  // The bar overlays the page (does not push content) and is hidden by
  // default; the left tab stays visible at all times and visually becomes
  // the bar's left edge while the bar is revealed.
  //
  // Gate: on entry the user's cursor is often already in the reveal zone
  // (the popup they just clicked sits at the top of the viewport, so when
  // it closes the cursor lands near y=0 — over the tab). We don't count
  // that as a deliberate hover. Reveal only unlocks once the cursor has
  // moved clearly away from the top (y > 80) at least once.
  let revealed = false;
  let hideTimer = null;
  let canReveal = false;
  function showBar() {
    if (!canReveal) return;
    clearTimeout(hideTimer);
    if (revealed) return;
    revealed = true;
    bar.classList.add('--enter');
    tab.classList.add('--in-bar');
  }
  function hideBar() {
    if (!revealed) return;
    revealed = false;
    bar.classList.remove('--enter');
    tab.classList.remove('--in-bar');
  }
  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideBar, 10);
  }
  // While revealed, keep the bar shown for a generous buffer below it
  // (HOVER_BUFFER px past the bar's bottom) — small drift downward
  // shouldn't dismiss it. Hide kicks in once the cursor moves above the
  // buffer, or when the cursor leaves the viewport entirely.
  const BAR_H = 40;
  const HOVER_BUFFER = 20;
  const HOLD_Y = BAR_H + HOVER_BUFFER;
  function onMouseMove(e) {
    if (!canReveal && e.clientY > 80) canReveal = true;
    if (e.clientY <= 2) showBar();
    if (revealed) {
      if (e.clientY <= HOLD_Y) clearTimeout(hideTimer);
      else scheduleHide();
    }
  }
  document.addEventListener('mousemove', onMouseMove, true);
  bar.addEventListener('mouseenter', showBar);
  tab.addEventListener('mouseenter', showBar);
  // Note: we don't hide on document mouseleave (cursor exiting the viewport
  // at the top). Moving up into the browser chrome counts as still "in
  // the zone" — the bar only dismisses once the cursor comes back into
  // the viewport below the buffer.

  const sessionBuffer = Array.isArray(restored?.sessionBuffer) ? [...restored.sessionBuffer] : [];
  let selectorCleanup = null;
  let capturing = false; // single-flight guard for the screenshot pipeline

  const ctx = {
    settings,
    sessionBuffer,
    returnTo: opts.returnTo ?? null,
    bar,
    wasFormMode: hasReturnTo || !!restored?.wasFormMode,
    formStackSnapshot: opts.formStackSnapshot ?? restored?.formStackSnapshot ?? null,
    maxCaptures: typeof opts.maxCaptures === 'number' && opts.maxCaptures > 0
      ? opts.maxCaptures
      : (typeof restored?.maxCaptures === 'number' && restored.maxCaptures > 0 ? restored.maxCaptures : null),
  };
  active = ctx;
  starting = false;

  function snapshotForSession() {
    return {
      active: true,
      settings: {
        resizeMode:     settings.resizeMode,
        capturePadding: settings.capturePadding,
        themeDelay:     settings.themeDelay,
      },
      wasFormMode: ctx.wasFormMode,
      formStackSnapshot: ctx.formStackSnapshot,
      maxCaptures: ctx.maxCaptures,
      sessionBuffer: sessionBuffer.slice(),
    };
  }
  persistSession(snapshotForSession());

  // ── Bar control bindings ──────────────────────────────────────────────────

  const $ = sel => bar.querySelector(sel);
  const counterEl = $('[data-bar-counter]');
  const counterChip = $('[data-bar-counter-chip]');

  function refreshCounter() {
    counterEl.hidden = false;
    counterChip.textContent = String(sessionBuffer.length);
  }
  refreshCounter();

  function setHint(text) {
    const h = $('[data-bar-hint]');
    if (h) h.textContent = text;
  }

  $('[data-bar-resize]').addEventListener('click', () => {
    settings.resizeMode = !settings.resizeMode;
    const btn = $('[data-bar-resize]');
    btn.classList.toggle('--on', settings.resizeMode);
    btn.setAttribute('aria-pressed', settings.resizeMode ? 'true' : 'false');
    persistSettings(settings);
    persistSession(snapshotForSession());
  });

  function setPadding(next) {
    const v = Math.max(0, parseInt(next, 10) || 0);
    settings.capturePadding = v;
    const inp = $('[data-bar-padding]');
    if (inp && inp.value !== String(v)) inp.value = String(v);
    persistSettings(settings);
    persistSession(snapshotForSession());
  }
  $('[data-bar-padding-dec]').addEventListener('click', () => setPadding(settings.capturePadding - 5));
  $('[data-bar-padding-inc]').addEventListener('click', () => setPadding(settings.capturePadding + 5));
  $('[data-bar-padding]').addEventListener('input', e => setPadding(e.target.value));

  // Done = commit (onComplete); ✕ close = cancel (onCancel, if the caller
  // provided one — otherwise it falls back to onComplete for back-compat).
  $('[data-bar-done]').addEventListener('click', () => exitCaptureMode(false));
  $('[data-bar-close]').addEventListener('click', () => exitCaptureMode(true));

  // ── Esc handler (controller-level) ────────────────────────────────────────
  // Resize mode owns Esc while its overlay is mounted — let that handler
  // cancel just the resize and leave Capture Mode active.
  function onKey(e) {
    if (e.key !== 'Escape') return;
    if (document.querySelector('.mb-capture-resize')) return;
    e.stopPropagation();
    exitCaptureMode(true); // Esc = cancel, same as the ✕ close button.
  }
  document.addEventListener('keydown', onKey, true);

  // ── Selector + capture pipeline ───────────────────────────────────────────
  async function onPick(target) {
    if (capturing) return;
    // Hard cap: refuse new picks once the configured limit has been reached.
    if (ctx.maxCaptures && sessionBuffer.length >= ctx.maxCaptures) return;
    capturing = true;

    // Tear the selector down for the duration of the screenshot, otherwise
    // the engine's debugger session and the selector's mousemove/keydown
    // listeners run concurrently and the selector's blue overlay can be
    // captured.
    selectorCleanup?.();
    selectorCleanup = null;
    bar.classList.add('--capturing');

    const finishCapture = (light, dark, resized) => {
      if (!light || !dark) return;
      handleCapture(light, dark, resized);
    };

    try {
      if (settings.resizeMode) {
        await new Promise(resolve => {
          enterResizeMode(target, settings, async (rect, resized, untouched) => {
            // Plain Enter with the box untouched = the user wants the element
            // as-is: take the element path so the rounded-corner mask applies,
            // exactly like a non-resize-mode capture. Only an adjusted box
            // captures the raw region (whose corner radii are unknowable).
            const customRect = untouched ? null : rect;
            const light = await screenshotElement(target, { theme: 'light', customRect, settings });
            const dark  = await screenshotElement(target, { theme: 'dark',  customRect, settings });
            finishCapture(light, dark, resized);
            resolve();
          }, () => resolve());
        });
      } else {
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
          document.activeElement.blur();
        }
        // small settle delay matches the prior implementation's 100ms blur gap
        await new Promise(r => setTimeout(r, 100));
        const light = await screenshotElement(target, { theme: 'light', settings });
        const dark  = await screenshotElement(target, { theme: 'dark',  settings });
        finishCapture(light, dark, false);
      }
    } finally {
      capturing = false;
      bar.classList.remove('--capturing');
      // Re-arm the selector if still in mode.
      if (active === ctx) {
        selectorCleanup = installSelector({
          onPick,
          getPadding: () => settings.capturePadding,
          onArmedChange: armed => {
            bar.classList.toggle('--armed', armed);
            tab.classList.toggle('--armed', armed);
            setHint(armed ? 'Click to capture' : 'Shift + click to capture');
          },
        });
      }
    }
  }

  function handleCapture(light, dark, resized) {
    sessionBuffer.push({
      lightDataUrl: light.dataUrl,
      lightFilename: light.filename,
      darkDataUrl: dark.dataUrl,
      darkFilename: dark.filename,
      resized: !!resized,
      padding: light.appliedPadding || 0,
      dimMode: 'height',
      dimValue: 50,
      addToLibrary: true,
    });
    refreshCounter();
    pulseCounter();
    persistSession(snapshotForSession());
    if (ctx.maxCaptures && sessionBuffer.length >= ctx.maxCaptures) {
      sweepBottomBorder();
      exitCaptureMode();
      return;
    }
    sweepBottomBorder();
  }

  function pulseCounter() {
    counterChip.classList.remove('--pulse');
    // force reflow so the class re-add re-triggers the animation
    void counterChip.offsetWidth;
    counterChip.classList.add('--pulse');
  }
  function sweepBottomBorder() {
    bar.classList.remove('--sweep');
    void bar.offsetWidth;
    bar.classList.add('--sweep');
  }

  // ── Initial selector install ──────────────────────────────────────────────
  selectorCleanup = installSelector({
    onPick,
    getPadding: () => settings.capturePadding,
    onArmedChange: armed => {
      bar.classList.toggle('--armed', armed);
      tab.classList.toggle('--armed', armed);
      setHint(armed ? 'Click to capture' : 'Shift + click to capture');
    },
  });

  // ── Exit ──────────────────────────────────────────────────────────────────
  // `cancelled` is true when the user dismissed via ✕ / Esc (discard intent)
  // and false on Done / limit-reached (commit intent).
  function exitCaptureMode(cancelled = false) {
    if (active !== ctx) return;
    active = null;

    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousemove', onMouseMove, true);
    clearTimeout(hideTimer);
    selectorCleanup?.();
    selectorCleanup = null;

    bar.classList.remove('--enter');
    bar.classList.add('--exit');
    tab.classList.add('--exit');
    glow.classList.add('--exit');
    setTimeout(() => { bar.remove(); tab.remove(); glow.remove(); }, 220);

    clearSession();

    // Cancelled (✕ / Esc) with a cancel handler: re-show the form without
    // committing the buffered captures. Callers that don't supply onCancel keep
    // the legacy behaviour (cancel falls through to onComplete below).
    if (cancelled && opts.returnTo?.onCancel) {
      try {
        opts.returnTo.onCancel();
      } catch (e) {
        console.error('[captureMode] returnTo.onCancel threw:', e);
      }
      return;
    }

    // Hot-ish exit: returnTo closure is still alive (entered capture mode in
    // this JS context, no hard nav since). The closure handles re-showing the
    // form overlay, attaching captures, and — if a Turbo nav detached the
    // form mid-session — replaying the form stack itself.
    if (opts.returnTo?.onComplete) {
      try {
        opts.returnTo.onComplete(sessionBuffer.slice());
      } catch (e) {
        console.error('[captureMode] returnTo.onComplete threw:', e);
      }
      return;
    }
  }

  ctx.exit = exitCaptureMode;
}

/** Imperative exit (e.g. for testing, or if a future caller needs it). */
export function exitCaptureMode() {
  active?.exit?.();
}

/**
 * Resume capture mode if a sessionStorage record survived a hard navigation.
 * Called once per content-script load (initial page load) by content.js.
 * On a full refresh we deliberately discard the slot — user wants F5 to
 * leave capture mode behind.
 */
export async function restoreCaptureMode() {
  if (active || starting) return;
  const navEntry = performance.getEntriesByType?.('navigation')?.[0];
  if (navEntry?.type === 'reload') {
    clearSession();
    return;
  }
  const snap = readSession();
  if (!snap?.active) return;
  enterCaptureMode({
    __restored: snap,
  });
}
