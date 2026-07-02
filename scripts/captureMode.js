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
 *   - Cold exit (session restored after a hard nav, returnTo closures dead) →
 *     dispatches the serialised entry intent through the form-action registry
 *     (planColdExit). Cold cancel discards, matching the hot cancel semantics.
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
import { getFormAction } from './formActions.js';
import { captureSizeField, wireCaptureSizeField, readCaptureSizeField } from './captureCards.js';

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

/**
 * Decide what a cold exit should dispatch. "Cold" = the JS context that
 * entered capture mode died in a hard navigation, so the returnTo closures
 * are gone and the only way back to the originating flow is the serialised
 * intent carried in the session snapshot. Returns { action, payload } to fire
 * through the form-action registry, or null when nothing should happen:
 * a live returnTo owns the exit, cancel means discard, an empty buffer has
 * nothing to commit, and sessions entered without an intent (standalone
 * capture mode) have nowhere to deliver to.
 */
export function planColdExit({ cancelled, hasLiveReturnTo, intent, formStackSnapshot, sessionBuffer }) {
  if (hasLiveReturnTo || cancelled) return null;
  if (!intent?.action || !sessionBuffer?.length) return null;
  return { action: intent.action, payload: { intent, formStackSnapshot, sessionBuffer } };
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const s = stored[STORAGE_KEY] ?? {};
  return {
    resizeMode:       false, // ephemeral — never restored from storage
    pickMode:         'capture', // 'capture' | 'annotate' | 'zap'; ephemeral — never restored
    capturePadding:   0,
    forceResizeMode:  'none', // ephemeral; bar "Force Resize" advanced setting
    forceResizeValue: null,
    themeDelay:       s.themeDelay ?? 500,
    scale:            6, // HIGH SCALE VALUES CAN CAUSE BROWSER CRASHES
  };
}

let saveTimer = null;
function persistSettings(settings) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    chrome.storage.local.set({
      [STORAGE_KEY]: {
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
    <div class="mb-capture-bar__mode" role="group" aria-label="Mode" data-bar-mode>
      <button type="button" class="mb-capture-bar__mode-btn --on" data-mode-capture
        title="Shift + click captures the element" aria-pressed="true">
        <span class="more-buttons-icon" aria-hidden="true">photo_camera</span>Capture
      </button>
      <button type="button" class="mb-capture-bar__mode-btn" data-mode-annotate
        title="Shift + click marks the element with a green ring" aria-pressed="false">
        <span class="more-buttons-icon" aria-hidden="true">border_color</span>Annotate
      </button>
      <button type="button" class="mb-capture-bar__mode-btn" data-mode-zap
        title="Shift + click deletes the element from the page" aria-pressed="false">
        <span class="more-buttons-icon" aria-hidden="true">bolt</span>Zapper
      </button>
    </div>

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

      <button type="button" class="mb-capture-bar__toggle" data-bar-clear-annotations hidden
        title="Remove all annotation rings">
        <span class="more-buttons-icon" aria-hidden="true">ink_eraser</span>
        <span class="mb-capture-bar__toggle-label" data-bar-clear-count>Clear</span>
      </button>

      <button type="button" class="mb-capture-bar__toggle" data-bar-restore-zapped hidden
        title="Bring back all zapped elements">
        <span class="more-buttons-icon" aria-hidden="true">undo</span>
        <span class="mb-capture-bar__toggle-label" data-bar-restore-count>Restore</span>
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

    <button type="button" class="mb-capture-bar__cog" data-bar-settings
      title="Advanced settings" aria-label="Advanced settings"
      aria-haspopup="true" aria-expanded="false">
      <span class="more-buttons-icon" aria-hidden="true">settings</span>
    </button>

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
 * @param {Object} [opts.intent] — serialisable completion intent,
 *   { action, ...data }. On cold exit the controller dispatches
 *   getFormAction(intent.action)({ intent, formStackSnapshot, sessionBuffer })
 *   — the registered handler (captures.js / captureEntry.js) replays the form
 *   stack and commits the buffer. Without it a cold Done silently drops the
 *   session buffer, because returnTo closures cannot survive a hard nav.
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
    // Keep the bar pinned while the advanced-settings popover is open — it
    // hangs below the bar, so dismissing the bar mid-interaction is jarring.
    if (popover && !popover.hidden) return;
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
    intent: opts.intent ?? restored?.intent ?? null,
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
        // pickMode deliberately excluded — annotations and zaps are DOM state
        // and die on hard nav, so a restored session always re-enters capture.
        resizeMode:       settings.resizeMode,
        capturePadding:   settings.capturePadding,
        forceResizeMode:  settings.forceResizeMode,
        forceResizeValue: settings.forceResizeValue,
        themeDelay:       settings.themeDelay,
      },
      wasFormMode: ctx.wasFormMode,
      formStackSnapshot: ctx.formStackSnapshot,
      intent: ctx.intent,
      maxCaptures: ctx.maxCaptures,
      sessionBuffer: sessionBuffer.slice(),
    };
  }
  persistSession(snapshotForSession());

  // ── Bar control bindings ──────────────────────────────────────────────────

  const $ = sel => bar.querySelector(sel);

  // ── Annotate mode ─────────────────────────────────────────────────────────
  // Picks apply a persistent green ring to the element instead of capturing
  // it; toggling back to capture mode, the rings are live DOM styling so they
  // appear in the shots. Inline `outline` (not border) so nothing shifts
  // layout. The bar's padding value P offsets the ring: its OUTER edge lands
  // exactly P px outside the element bounds (offset = P - width), so P=0 hugs
  // the element from the inside and survives the tight capture clip. Applied
  // at pick time, like capture padding. Prior inline values saved for clean
  // removal. Resize-mode picks confirm a draggable box instead and drop an
  // absolutely-positioned box annotation (see addBoxAnnotation).
  const ANNOTATION_COLOR = '#22c55e'; // matches --cb-hue green in formsStyling.css
  const ANNOTATION_WIDTH = 3; // px
  const annotations = new Map(); // Element -> { outline, outlineOffset } (prior inline values)

  const boxAnnotations = new Set(); // free-drawn <div> rings from resize-mode picks

  function refreshClearButton() {
    const btn = $('[data-bar-clear-annotations]');
    if (!btn) return;
    const count = annotations.size + boxAnnotations.size;
    btn.hidden = count === 0;
    const label = $('[data-bar-clear-count]');
    if (label) label.textContent = `Clear (${count})`;
  }

  function toggleAnnotation(el) {
    if (annotations.has(el)) {
      removeAnnotation(el);
      return;
    }
    annotations.set(el, {
      outline: el.style.getPropertyValue('outline'),
      outlineOffset: el.style.getPropertyValue('outline-offset'),
    });
    el.style.setProperty('outline', `${ANNOTATION_WIDTH}px solid ${ANNOTATION_COLOR}`, 'important');
    el.style.setProperty('outline-offset', `${settings.capturePadding - ANNOTATION_WIDTH}px`, 'important');
    refreshClearButton();
  }

  // Resize-mode annotation: a page-level ring at the user-adjusted box (doc
  // coords from enterResizeMode). Same padding semantics as element rings —
  // the border's outer edge lands P px outside the confirmed box. Plain
  // absolutely-positioned div (NOT .mb-capture-*) so the screenshot pipeline
  // doesn't hide it; scrolls with the page; dies with the session (or a hard
  // nav, like every annotation).
  function addBoxAnnotation(rect) {
    const P = settings.capturePadding;
    const box = document.createElement('div');
    box.className = 'mb-annotation-box';
    Object.assign(box.style, {
      position: 'absolute',
      top: `${rect.top - P}px`,
      left: `${rect.left - P}px`,
      width: `${rect.width + P * 2}px`,
      height: `${rect.height + P * 2}px`,
      border: `${ANNOTATION_WIDTH}px solid ${ANNOTATION_COLOR}`,
      boxSizing: 'border-box',
      pointerEvents: 'none',
      zIndex: '2147483640', // above page content, below the capture-mode UI
    });
    document.body.appendChild(box);
    boxAnnotations.add(box);
    refreshClearButton();
  }

  function removeAnnotation(el) {
    const saved = annotations.get(el);
    if (!saved) return;
    if (saved.outline) el.style.setProperty('outline', saved.outline);
    else el.style.removeProperty('outline');
    if (saved.outlineOffset) el.style.setProperty('outline-offset', saved.outlineOffset);
    else el.style.removeProperty('outline-offset');
    annotations.delete(el);
    refreshClearButton();
  }

  function clearAllAnnotations() {
    // Harmless on nodes a Turbo body swap has since detached.
    for (const el of [...annotations.keys()]) removeAnnotation(el);
    for (const box of boxAnnotations) box.remove();
    boxAnnotations.clear();
    refreshClearButton();
  }

  // ── Zapper mode ───────────────────────────────────────────────────────────
  // Picks remove the element from the page. Hidden via display:none (not
  // Node.remove()) so Restore can bring everything back in place without
  // re-inserting; prior inline display values saved per element. Like
  // annotations, zaps are undone on exit — the page leaves the mode intact.
  const zapped = new Map(); // Element -> prior inline display value

  function refreshRestoreButton() {
    const btn = $('[data-bar-restore-zapped]');
    if (!btn) return;
    btn.hidden = zapped.size === 0;
    const label = $('[data-bar-restore-count]');
    if (label) label.textContent = `Restore (${zapped.size})`;
  }

  function zapElement(el) {
    if (zapped.has(el)) return;
    zapped.set(el, el.style.getPropertyValue('display'));
    el.style.setProperty('display', 'none', 'important');
    refreshRestoreButton();
  }

  function restoreAllZapped() {
    for (const [el, display] of zapped) {
      if (display) el.style.setProperty('display', display);
      else el.style.removeProperty('display');
    }
    zapped.clear();
    refreshRestoreButton();
  }

  const MODE_TAB_LABEL = { capture: 'Capture mode', annotate: 'Annotate mode', zap: 'Zapper mode' };

  function setPickMode(mode) {
    settings.pickMode = mode;
    document.documentElement.classList.toggle('mb-annotate-mode', mode === 'annotate');
    document.documentElement.classList.toggle('mb-zap-mode', mode === 'zap');
    for (const name of ['capture', 'annotate', 'zap']) {
      const btn = $(`[data-mode-${name}]`);
      btn.classList.toggle('--on', mode === name);
      btn.setAttribute('aria-pressed', mode === name ? 'true' : 'false');
    }
    const tabLabel = tab.querySelector('.mb-capture-tab__label');
    if (tabLabel) tabLabel.textContent = MODE_TAB_LABEL[mode];
    // Ephemeral, like resizeMode — not persisted to storage or the session.
  }

  $('[data-mode-capture]').addEventListener('click', () => setPickMode('capture'));
  $('[data-mode-annotate]').addEventListener('click', () => setPickMode('annotate'));
  $('[data-mode-zap]').addEventListener('click', () => setPickMode('zap'));
  $('[data-bar-clear-annotations]').addEventListener('click', clearAllAnnotations);
  $('[data-bar-restore-zapped]').addEventListener('click', restoreAllZapped);

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

  // ✕ close = cancel (onCancel, if the caller provided one — otherwise it
  // falls back to onComplete for back-compat). There is no Done button: every
  // caller captures a single element, so the session auto-commits on the one
  // pick (see handleCapture's maxCaptures auto-exit).
  $('[data-bar-close]').addEventListener('click', () => exitCaptureMode(true));

  // ── Advanced settings popover (cog button) ────────────────────────────────
  const cogBtn = $('[data-bar-settings]');
  const popover = document.createElement('div');
  // Carries .more-buttons-overlay-content so the form palette (--mb-* vars) and
  // the scoped .more-buttons-capture-dim segmented-control rules apply — the
  // popover is a body sibling, outside any live overlay. .mb-capture-bar__popover
  // (later in the stylesheet) overrides that class's card layout.
  popover.className = 'more-buttons-overlay-content mb-capture-bar__popover';
  popover.hidden = true;
  popover.innerHTML = `
    <div class="mb-capture-bar__popover-title">Advanced settings</div>
    ${captureSizeField({
      dimMode: settings.forceResizeMode,
      dimValue: settings.forceResizeValue ?? 50,
      label: 'Force Resize',
    })}
  `;
  document.documentElement.appendChild(popover);
  wireCaptureSizeField(popover);

  function readForceResize() {
    const { dimMode, dimValue } = readCaptureSizeField(popover);
    settings.forceResizeMode = dimMode;
    settings.forceResizeValue = dimValue;
    persistSession(snapshotForSession());
  }
  popover.addEventListener('change', readForceResize);
  popover.addEventListener('input', readForceResize);

  function onPopoverOutside(e) {
    if (popover.contains(e.target) || cogBtn.contains(e.target)) return;
    closePopover();
  }
  function openPopover() {
    const r = cogBtn.getBoundingClientRect();
    popover.style.top = `${Math.round(r.bottom + 8)}px`;
    popover.style.right = `${Math.round(window.innerWidth - r.right)}px`;
    popover.hidden = false;
    cogBtn.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', onPopoverOutside, true);
  }
  function closePopover() {
    if (popover.hidden) return;
    popover.hidden = true;
    cogBtn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onPopoverOutside, true);
  }
  cogBtn.addEventListener('click', () => {
    if (popover.hidden) openPopover(); else closePopover();
  });

  // ── Esc handler (controller-level) ────────────────────────────────────────
  // Resize mode owns Esc while its overlay is mounted — let that handler
  // cancel just the resize and leave Capture Mode active.
  function onKey(e) {
    if (e.key !== 'Escape') return;
    if (document.querySelector('.mb-capture-resize')) return;
    // Esc dismisses an open advanced-settings popover before it exits mode.
    if (!popover.hidden) {
      e.stopPropagation();
      closePopover();
      return;
    }
    e.stopPropagation();
    exitCaptureMode(true); // Esc = cancel, same as the ✕ close button.
  }
  document.addEventListener('keydown', onKey, true);

  // ── Selector + capture pipeline ───────────────────────────────────────────
  function installPickSelector() {
    return installSelector({
      onPick,
      // Zapper has no padding concept (the stepper is hidden); 0 kills the ring.
      getPadding: () => (settings.pickMode === 'zap' ? 0 : settings.capturePadding),
      onArmedChange: isArmed => {
        bar.classList.toggle('--armed', isArmed);
        tab.classList.toggle('--armed', isArmed);
      },
    });
  }

  async function onPick(target) {
    // Annotate/zap picks stay armed — no screenshot, and they never count
    // against maxCaptures.
    if (settings.pickMode === 'annotate') {
      if (!settings.resizeMode) {
        toggleAnnotation(target);
        return;
      }
      // Resize-mode annotate: confirm a draggable box, then ring it. The
      // selector is torn down while the box is up (same reason as capture:
      // a second Shift+pick would stack overlays) and re-armed after.
      if (capturing) return;
      capturing = true;
      selectorCleanup?.();
      selectorCleanup = null;
      try {
        await new Promise(resolve => {
          enterResizeMode(target, settings, (rect, resized, untouched) => {
            // Plain Enter with the box untouched = ring the element itself
            // (outline follows its border-radius); an adjusted box gets a
            // free-drawn rectangular ring.
            if (untouched) toggleAnnotation(target);
            else addBoxAnnotation(rect);
            resolve();
          }, () => resolve());
        });
      } finally {
        capturing = false;
        if (active === ctx) selectorCleanup = installPickSelector();
      }
      return;
    }
    if (settings.pickMode === 'zap') {
      zapElement(target);
      return;
    }
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
      if (active === ctx) selectorCleanup = installPickSelector();
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
    persistSession(snapshotForSession());
    if (ctx.maxCaptures && sessionBuffer.length >= ctx.maxCaptures) {
      sweepBottomBorder();
      exitCaptureMode();
      return;
    }
    sweepBottomBorder();
  }

  function sweepBottomBorder() {
    bar.classList.remove('--sweep');
    void bar.offsetWidth;
    bar.classList.add('--sweep');
  }

  // ── Initial selector install ──────────────────────────────────────────────
  selectorCleanup = installPickSelector();

  // ── Exit ──────────────────────────────────────────────────────────────────
  // `cancelled` is true when the user dismissed via ✕ / Esc (discard intent)
  // and false on Done / limit-reached (commit intent).
  function exitCaptureMode(cancelled = false) {
    if (active !== ctx) return;
    active = null;

    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('mousedown', onPopoverOutside, true);
    clearTimeout(hideTimer);
    selectorCleanup?.();
    selectorCleanup = null;
    // Annotations and zaps never outlive the mode — every exit path (✕, Esc,
    // Done / limit-reached, cold) lands here.
    clearAllAnnotations();
    restoreAllZapped();
    document.documentElement.classList.remove('mb-annotate-mode', 'mb-zap-mode');
    popover.remove();

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

    // Cold exit: this session was restored after a hard navigation, so no
    // returnTo closures exist. Deliver the buffer to the originating flow via
    // the serialised intent recorded at entry (registry handlers replay the
    // form stack and commit). Without this, Done after a hard nav dropped the
    // captures on the floor.
    const cold = planColdExit({
      cancelled,
      hasLiveReturnTo: !!opts.returnTo,
      intent: ctx.intent,
      formStackSnapshot: ctx.formStackSnapshot,
      sessionBuffer: sessionBuffer.slice(),
    });
    if (cold) {
      Promise.resolve(getFormAction(cold.action)?.(cold.payload))
        .catch(e => console.error('[captureMode] cold-exit intent failed:', e));
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
