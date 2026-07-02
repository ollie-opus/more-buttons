/**
 * captureElement.js — Pure capture engine.
 *
 * Stateless primitives the Capture Mode controller (captureMode.js) drives:
 *   - installSelector({ onPick, onArmedChange }) → cleanup
 *       Installs hover overlay + Shift+click listener. The controller
 *       decides when to tear it down (mode exit, mid-capture pause).
 *   - screenshotElement(el, { theme, customRect, settings }) → { dataUrl, filename, appliedPadding }
 *       One screenshot. Light+dark pairs are two awaits in the controller.
 *   - enterResizeMode(el, settings, onConfirm, onCancel)
 *       Draggable selection box overlay. Calls onConfirm(rect, resized) on
 *       Enter, onCancel() on Esc.
 *
 * No module-level lifecycle. The controller owns mode state.
 */

import { cropBoxPx, resolveCornerRadii, transformIsNearIdentity } from './captureGeometry.js';

// A "motion signature" of the element's ancestor chain: every ancestor's
// transform + opacity. JS-driven (rAF) popover animations never appear in
// document.getAnimations(), but they DO move these computed values — so we
// detect "still animating" by watching this signature change frame to frame.
function motionSignature(el) {
  let node = el; const parts = [];
  while (node && node.nodeType === 1) {
    const cs = getComputedStyle(node);
    if ((cs.transform && cs.transform !== 'none') || (cs.opacity && cs.opacity !== '1')) {
      parts.push(`${node.tagName.toLowerCase()}${node.id ? '#' + node.id : ''}:T=${cs.transform};O=${cs.opacity}`);
    }
    node = node.parentElement;
  }
  return parts.join(' || ') || '(no transforms/opacity)';
}

// Wait until the ancestor motion signature is unchanged for `needFrames`
// consecutive animation frames (or `maxMs` elapses). Settles popover
// enter/exit scale+fade animations before we screenshot, so the compositor
// isn't mid-resample (which yields soft + sub-pixel-offset captures).
function waitForStable(el, { maxMs = 2000, needFrames = 3 } = {}) {
  return new Promise(resolve => {
    const t0 = performance.now();
    let prev = motionSignature(el), stable = 0, frames = 0;
    const tick = () => {
      frames++;
      const cur = motionSignature(el);
      if (cur === prev) stable++; else { stable = 0; prev = cur; }
      const elapsed = performance.now() - t0;
      if (stable >= needFrames || elapsed > maxMs) {
        resolve();
      } else {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  });
}

// Does a running Animation drive the element's `transform`? CSS transitions and
// @keyframes animations on transform sit ABOVE inline `!important` in the
// cascade, so while one runs, `transform: none !important` is silently ignored
// and the element stays GPU-promoted. We must cancel these before de-promoting.
function animAffectsTransform(a) {
  if (a.transitionProperty != null) return a.transitionProperty === 'transform' || a.transitionProperty === 'all';
  try { return a.effect.getKeyframes().some(k => 'transform' in k); } catch { return false; }
}

// Like animAffectsTransform but for opacity. Forcing/resetting prefers-color-scheme
// for the capture triggers the popover's close fade (opacity 1→0); the screenshot
// grab catches it mid-fade, blending page-behind into the captured pixels (faint
// "bleed-through"). We cancel opacity-driving animations + pin opacity:1 to hold
// the popover visible through the shot.
function animAffectsOpacity(a) {
  if (a.transitionProperty != null) return a.transitionProperty === 'opacity' || a.transitionProperty === 'all';
  try { return a.effect.getKeyframes().some(k => 'opacity' in k); } catch { return false; }
}

// Temporarily de-promote layer-forming ancestors (transform / will-change) so
// they paint inline into the main surface at full device resolution for the
// screenshot, instead of being captured as a low-res standalone GPU layer.
// Neutralizes identity AND settled-near-identity transforms (see
// transformIsNearIdentity) so an animation that eased to matrix(0.9998,…) — not
// the exact identity string — is still pinned; deliberate (non-identity)
// transforms are skipped so nothing visible moves. Returns a restore() fn.
//
// The full-res re-raster this triggers is asynchronous, so the service worker
// waits its themeDelay AFTER reading the rect (i.e. after this runs) to let the
// raster commit before Page.captureScreenshot — see background.js.
function neutralizeLayers(el) {
  const touched = [];
  let node = el;
  while (node && node.nodeType === 1) {
    const cs = getComputedStyle(node);
    const t = cs.transform;
    const hasTransform = t && t !== 'none';
    const promotes = hasTransform || (cs.willChange && cs.willChange !== 'auto');
    // Freeze opacity open. The capture triggers a close fade (opacity 1→0) that the
    // shot catches mid-fade → faint page-behind bleed. Pin opacity:1 on every
    // currently-opaque ancestor (so we don't alter anything intentionally
    // translucent), cancelling opacity-driving animations first. The inline
    // !important is set BEFORE the close fires and persists through the shot.
    const opaqueNow = !cs.opacity || Math.abs(parseFloat(cs.opacity) - 1) < 1e-3;
    if (opaqueNow && !(promotes && transformIsNearIdentity(t))) {
      const oa = node.getAnimations().filter(animAffectsOpacity);
      for (const a of oa) { try { a.commitStyles(); } catch {} }
      for (const a of oa) { try { a.cancel(); } catch {} }
      touched.push({ node, css: node.getAttribute('style') });
      node.style.setProperty('opacity', '1', 'important');
    }
    if (promotes && transformIsNearIdentity(t)) {
      // A running/filling transform transition/animation outranks inline
      // !important, so transform:none would be ignored and the layer stays
      // GPU-promoted. The popover's enter/theme animation is usually scale +
      // FADE with fill:forwards: it holds the element at opacity:1 via the
      // ANIMATION, not the base CSS (opacity:0, the hidden pre-enter state). So
      // commitStyles() FIRST bakes the settled animated frame (opacity, transform,
      // …) into inline styles that survive the cancel; cancel() then frees the
      // transform so the transform:none pin below can de-promote, while the baked
      // opacity keeps the element visible. (No-op when no transform animation is
      // present, e.g. a statically-promoted popover.)
      // Cancel transform- AND opacity-driving animations (commitStyles first to
      // bake the settled frame so it survives the cancel — opacity:1, identity
      // transform). Then pin transform:none (de-promote) + opacity:1 (hold open
      // through the capture's close fade — see animAffectsOpacity).
      const affecting = node.getAnimations().filter(a => animAffectsTransform(a) || animAffectsOpacity(a));
      for (const a of affecting) { try { a.commitStyles(); } catch {} }
      for (const a of affecting) { try { a.cancel(); } catch {} }
      // Snapshot the post-commit inline style; restore() reverts to exactly this,
      // so the popover stays visually identical to its resting (filled) frame.
      touched.push({ node, css: node.getAttribute('style') });
      // No `transition:none` pin: identity→none is a zero-delta change so no
      // transition fires, and the cssText snapshot above reverts what we set here.
      node.style.setProperty('transform', 'none', 'important');
      node.style.setProperty('will-change', 'auto', 'important');
      node.style.setProperty('opacity', '1', 'important');
    }
    node = node.parentElement;
  }
  return () => {
    for (const r of touched) {
      if (r.css == null) r.node.removeAttribute('style');
      else r.node.setAttribute('style', r.css);
    }
  };
}

// ── Hover + Shift-arm selector ────────────────────────────────────────────────

export function installSelector({ onPick, onArmedChange, getPadding }) {
  const overlay = document.createElement('div');
  overlay.className = 'mb-capture-selector';
  Object.assign(overlay.style, {
    position: 'fixed', pointerEvents: 'none',
    // border + background come from CSS (.mb-capture-selector) so they
    // share the capture-mode hue token defined in formsStyling.css.
    zIndex: '2147483647', boxSizing: 'border-box',
    display: 'none',
  });
  // Faint secondary border tracing where the captured padding will land —
  // sits `padding` CSS px outside the element rect, mirroring the expansion
  // expandWithBackground() applies to the final screenshot. Same hue token,
  // styling from CSS (.mb-capture-padding-ring).
  const ring = document.createElement('div');
  ring.className = 'mb-capture-padding-ring';
  Object.assign(ring.style, {
    position: 'fixed', pointerEvents: 'none',
    zIndex: '2147483646', boxSizing: 'border-box',
    display: 'none',
  });
  // Mount on <html> so Turbo's <body> swap doesn't sweep it.
  document.documentElement.appendChild(ring);
  document.documentElement.appendChild(overlay);

  let armed = false;
  function setArmed(next) {
    if (next === armed) return;
    armed = next;
    // Highlight box only exists while Shift is held — otherwise the page is
    // unobstructed and the user can interact with it normally.
    overlay.style.display = armed ? 'block' : 'none';
    if (!armed) ring.style.display = 'none';
    onArmedChange?.(armed);
  }

  function highlight(el) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    Object.assign(overlay.style, {
      top: r.top + 'px', left: r.left + 'px',
      width: r.width + 'px', height: r.height + 'px',
    });
    // Trace the padding region only when a positive padding is configured.
    const pad = Math.max(0, getPadding?.() || 0);
    if (pad > 0) {
      Object.assign(ring.style, {
        top: (r.top - pad) + 'px', left: (r.left - pad) + 'px',
        width: (r.width + pad * 2) + 'px', height: (r.height + pad * 2) + 'px',
        display: 'block',
      });
    } else {
      ring.style.display = 'none';
    }
  }

  function onMove(e) {
    // mousemove carries shiftKey; this catches the case where Shift was
    // already held when the selector was (re-)installed and no keydown fires.
    setArmed(e.shiftKey);
    // Skip the bar/tab + their descendants, plus our own overlay.
    if (e.target.closest('.mb-capture-bar, .mb-capture-tab, .mb-capture-selector')) return;
    highlight(e.target);
  }

  function onClick(e) {
    if (!e.shiftKey) return;
    if (e.target.closest('.mb-capture-bar, .mb-capture-tab')) return;
    e.preventDefault();
    e.stopPropagation();
    onPick?.(e.target);
  }

  // Swallow pointer/mouse events with Shift held so frameworks (Stimulus,
  // etc.) that navigate on mousedown/pointerdown can't fire the underlying
  // action before our click handler runs. We still let the click event itself
  // through to onClick (above) to drive capture.
  function swallowIfArmed(e) {
    if (!e.shiftKey) return;
    if (e.target.closest('.mb-capture-bar, .mb-capture-tab')) return;
    e.preventDefault();
    e.stopPropagation();
  }

  function onKey(e) {
    if (e.key === 'Shift') setArmed(true);
  }
  function onKeyUp(e) {
    if (e.key === 'Shift') setArmed(false);
  }
  function onBlur() { setArmed(false); }

  const SWALLOW_EVENTS = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick'];
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  SWALLOW_EVENTS.forEach(t => document.addEventListener(t, swallowIfArmed, true));
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', onBlur);

  return function cleanup() {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    SWALLOW_EVENTS.forEach(t => document.removeEventListener(t, swallowIfArmed, true));
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('blur', onBlur);
    overlay.remove();
    ring.remove();
  };
}

// ── Background sampling, masking, padding (unchanged from prior implementation) ─

function sampleBackgroundColor(el) {
  const r = el.getBoundingClientRect();
  const OFFSET = 3;
  const t = r.top - OFFSET, b = r.bottom + OFFSET;
  const l = r.left - OFFSET, ri = r.right + OFFSET;
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;

  const points = [
    [r.left + r.width * 0.25, t], [cx, t], [r.left + r.width * 0.75, t],
    [r.left + r.width * 0.25, b], [cx, b], [r.left + r.width * 0.75, b],
    [l, r.top + r.height * 0.25], [l, cy], [l, r.top + r.height * 0.75],
    [ri, r.top + r.height * 0.25], [ri, cy], [ri, r.top + r.height * 0.75],
  ];

  // Hide our overlays so they don't shadow elementFromPoint.
  const overlays = document.querySelectorAll('.mb-capture-selector, .mb-capture-padding-ring, .mb-capture-bar, .mb-capture-tab, .mb-capture-resize');
  const prevDisplay = [];
  overlays.forEach((o, i) => { prevDisplay[i] = o.style.display; o.style.display = 'none'; });
  const colors = points.map(([x, y]) => {
    let node = document.elementFromPoint(x, y);
    while (node && node !== document.documentElement) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
      node = node.parentElement;
    }
    return getComputedStyle(document.documentElement).backgroundColor || 'rgb(255,255,255)';
  });
  overlays.forEach((o, i) => { o.style.display = prevDisplay[i] ?? ''; });

  const freq = {};
  for (const c of colors) freq[c] = (freq[c] || 0) + 1;
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'rgb(255,255,255)';
}

function getElementLabel(el) {
  const clean = s => s?.trim().replace(/\s*\([^)]*\)/g, '').trim() || null;
  const legendEl = el.tagName === 'FIELDSET' ? el.querySelector('legend') : null;
  const firstLine = () => {
    const line = (el.innerText || el.textContent || '').trim().split('\n').find(l => l.trim());
    return line && line.length <= 60 ? clean(line) : null;
  };
  return (
    clean(el.getAttribute('aria-label')) ||
    clean(document.getElementById(el.getAttribute('aria-labelledby') ?? '')?.textContent) ||
    clean(legendEl?.textContent) ||
    clean(el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent : null) ||
    clean(el.closest('label')?.textContent) ||
    clean(el.getAttribute('placeholder')) ||
    clean(el.getAttribute('title')) ||
    firstLine()
  );
}

function applyBorderRadiusMask(src, el, cropDip) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const { width: elW, height: elH } = el.getBoundingClientRect();
      const cs = getComputedStyle(el);

      // The captured bitmap contains the element plus a background margin (the
      // clip is captured with a deliberate margin so CDP's ~1-DIP capture
      // shortfall never eats the element's edge). `cropDip` is the element's
      // box in DIP relative to the clip origin; cropBoxPx resolves it against
      // the decoded bitmap, measuring the actual px-per-DIP from the bitmap
      // itself (the surface is rendered at clip.scale * deviceScaleFactor, so
      // a background-side pixel value would be display-dependent). We crop the
      // canvas to exactly that box so the margin is removed and the rounded mask
      // registers against the element's true edges (critical for pills, whose
      // curved ends would otherwise be sliced by a mask centred on the whole
      // bitmap).
      const { x: ex, y: ey, w: ew, h: eh } = cropBoxPx(cropDip, img.width, img.height);

      const w = Math.max(1, Math.round(ew));
      const h = Math.max(1, Math.round(eh));

      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');

      const sx = ew / elW;
      const sy = eh / elH;

      // CSS corners are ELLIPSES (rx,ry). getComputedStyle keeps each
      // border-*-radius as "H" or "H V" with percentages UNRESOLVED ("25%"), so
      // resolve the horizontal token against width and the vertical against
      // height, scale each axis by its own bitmap-px-per-CSS-px, then apply the
      // single CSS overlap-clamp (see resolveCornerRadii). Drawn with
      // ctx.ellipse — arcTo is circular-only and would force ry = rx, which
      // over-rounds the short axis and slices the corners off wide/short or
      // percentage-radius elements (buttons, chips, pills).
      const { tl, tr, br, bl } = resolveCornerRadii(
        {
          tl: cs.borderTopLeftRadius,
          tr: cs.borderTopRightRadius,
          br: cs.borderBottomRightRadius,
          bl: cs.borderBottomLeftRadius,
        },
        { elW, elH, w, h, sx, sy }
      );

      ctx.beginPath();
      ctx.moveTo(tl.x, 0);
      ctx.lineTo(w - tr.x, 0);  ctx.ellipse(w - tr.x, tr.y, tr.x, tr.y, 0, -Math.PI / 2, 0);
      ctx.lineTo(w, h - br.y);  ctx.ellipse(w - br.x, h - br.y, br.x, br.y, 0, 0, Math.PI / 2);
      ctx.lineTo(bl.x, h);      ctx.ellipse(bl.x, h - bl.y, bl.x, bl.y, 0, Math.PI / 2, Math.PI);
      ctx.lineTo(0, tl.y);      ctx.ellipse(tl.x, tl.y, tl.x, tl.y, 0, Math.PI, 1.5 * Math.PI);
      ctx.closePath();
      ctx.clip();
      // Draw the full bitmap shifted so the element's top-left lands at (0,0); the
      // canvas is exactly the element box, so the outward clip margin is cropped off.
      ctx.drawImage(img, -ex, -ey);

      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = src;
  });
}

// Plain crop to the cropDip box, no rounded-corner mask — used for resize-mode
// captures, whose clip is also outward-snapped to whole DIPs (fractional clips
// get rounded inward by CDP and mis-register the capture under browser zoom).
function cropToBox(src, cropDip) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const { x, y, w, h } = cropBoxPx(cropDip, img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width  = Math.max(1, Math.round(w));
      canvas.height = Math.max(1, Math.round(h));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, -x, -y);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = src;
  });
}

function expandWithBackground(src, bgColor, padCssPx, originalCssWidth) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const outputScale = img.width / originalCssWidth;
      const padPx = Math.round(padCssPx * outputScale);
      const canvas = document.createElement('canvas');
      canvas.width  = img.width  + padPx * 2;
      canvas.height = img.height + padPx * 2;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, padPx, padPx);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = src;
  });
}

// Downscale (or upscale) a finished capture so its output PNG hits a target
// pixel height or width, aspect ratio preserved. Drives the bar's "Force
// Resize" advanced setting — distinct from the per-capture display Dimension
// (which only sets the rendered <img> size); this changes the saved bitmap.
function scaleToTarget(src, mode, value) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const target = Math.max(1, Math.round(value));
      let w, h;
      if (mode === 'height') {
        h = target;
        w = Math.max(1, Math.round(img.width * (target / img.height)));
      } else { // 'width'
        w = target;
        h = Math.max(1, Math.round(img.height * (target / img.width)));
      }
      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = src;
  });
}

// ── Single-frame screenshot ───────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Charset covering base64, base64url, and plain alphanumeric IDs.
const ID_CHARSET_RE = /^[A-Za-z0-9_\-+/=]+$/;

// Heuristic: detect opaque IDs (base64/base64url/random tokens) in URL segments
// without flagging real path words like "knowledge-base" or "admin".
function looksLikeOpaqueId(s) {
  if (s.length < 12) return false;
  if (!ID_CHARSET_RE.test(s)) return false;
  // Strong signals: base64 padding or non-url-safe chars.
  if (/[=+/]/.test(s)) return true;
  // Mixed-case alphanumeric tokens (e.g. "pLFhQgoc8NxyiYiRdGLShEMf").
  if (/[A-Z]/.test(s) && /[a-z]/.test(s)) return true;
  // Long all-lower/digit blobs (e.g. legacy hex/base32 IDs).
  if (s.length >= 24 && /[0-9]/.test(s)) return true;
  return false;
}

// Library-relative storage prefix for derived capture filenames. Mirrors
// CAPTURE_ROOT in captureLibrary.js (which carries the repo "docs/assets/"
// part) — captureBasePath strips exactly this prefix, so the two must agree.
const LIBRARY_PREFIX = 'media/occ-captures';

function deriveFilename(el, forcedTheme) {
  const rawLabel = getElementLabel(el);
  const slug = (rawLabel || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  const theme = forcedTheme
    ? `${forcedTheme}-mode`
    : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark-mode' : 'light-mode');
  const baseName = slug || `element-${el.tagName.toLowerCase()}`;
  const fileName = `${baseName}-${theme}.png`;

  const pathSegments = window.location.pathname
    .split('/')
    .filter(Boolean)
    .map(s => {
      if (UUID_RE.test(s)) return 'uuid';
      if (looksLikeOpaqueId(s)) return 'id';
      return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    })
    .filter(Boolean);
  return [LIBRARY_PREFIX, ...pathSegments, fileName].join('/');
}

/**
 * Screenshot the element for one theme. The controller calls this once per theme
 * (light + dark are two awaits in the controller).
 *
 * The target may live inside a GPU-promoted popover (an identity transform forces
 * its own compositor layer, which Chrome rasters at low resolution). We settle any
 * enter/exit animation (waitForStable), then de-promote layer-forming ancestors
 * (neutralizeLayers) so they re-raster inline at full device resolution. That
 * re-raster is async, so the service worker waits its themeDelay AFTER reading the
 * rect — i.e. after de-promotion — to let it commit before Page.captureScreenshot
 * (see background.js). Layers are restored once the screenshot returns.
 *
 * @returns {Promise<{ dataUrl, filename, appliedPadding } | null>} null on hard
 *   failure (e.g. CDP attach refused).
 */
export async function screenshotElement(el, { theme, customRect = null, settings }) {
  const scale = Math.max(1, parseFloat(settings.scale) || 2);
  const padding = Math.max(0, parseInt(settings.capturePadding, 10) || 0);

  let sampledBgColor = null;
  let restoreLayerStyles = null;

  const rectListener = (msg, _sender, sendResponse) => {
    if (msg.type !== 'getRectForCapture') return false;
    chrome.runtime.onMessage.removeListener(rectListener);
    if (customRect) {
      if (padding > 0) sampledBgColor = sampleBackgroundColor(el);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        sendResponse({
          x:      customRect.left,
          y:      customRect.top,
          width:  customRect.width,
          height: customRect.height,
        });
      }));
    } else {
      el.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'nearest' });
      if (padding > 0) sampledBgColor = sampleBackgroundColor(el);
      (async () => {
        // Settle popover/ancestor enter-exit animations (scale+fade) so we don't
        // screenshot a layer mid-resample → soft + offset capture.
        await waitForStable(el);
        // De-promote layer-forming ancestors so the capture samples a full-res
        // inline paint, not the popover's low-res GPU layer. Restored once the
        // screenshot returns (after `await response` below).
        restoreLayerStyles = neutralizeLayers(el);
        // Flush the de-promote style/layout locally; the SW's post-rect themeDelay
        // gives the async full-res re-raster time to commit before capture.
        await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
        const r = el.getBoundingClientRect();
        sendResponse({ x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height });
      })();
    }
    return true;
  };
  chrome.runtime.onMessage.addListener(rectListener);

  // Hide our own capture-mode overlays for the duration of the screenshot so
  // the inset edge glow, bar, tab, and selector box don't bleed into the PNG
  // for elements near the viewport edge. Annotate-mode rings (inline outlines
  // on page elements, applied by captureMode.js) are deliberately NOT hidden —
  // capturing them is the point of that mode.
  const hiddenOverlays = document.querySelectorAll(
    '.mb-capture-glow, .mb-capture-bar, .mb-capture-bar__popover, .mb-capture-tab, .mb-capture-selector, .mb-capture-padding-ring, .mb-capture-resize'
  );
  const prevOverlayDisplay = [];
  hiddenOverlays.forEach((o, i) => {
    prevOverlayDisplay[i] = o.style.display;
    o.style.display = 'none';
  });

  const response = await new Promise(resolve =>
    chrome.runtime.sendMessage({
      type: 'captureTab',
      scale,
      devicePixelRatio: window.devicePixelRatio,
      forcedTheme: theme,
      themeDelay: theme ? (settings.themeDelay ?? 500) : 0,
      // Element captures take a 4-device-px margin (cropped off afterwards);
      // resize-mode captures add no extra margin beyond the whole-DIP snap.
      // Both crop back to cropDip afterwards.
      tight: !!customRect,
    }, resolve)
  );

  if (restoreLayerStyles) restoreLayerStyles();

  hiddenOverlays.forEach((o, i) => { o.style.display = prevOverlayDisplay[i] ?? ''; });

  chrome.runtime.onMessage.removeListener(rectListener);

  if (!response || response.error) {
    console.error('[captureElement] Screenshot failed:', response?.error);
    return null;
  }

  const maskedDataUrl = !customRect
    ? await applyBorderRadiusMask(response.dataUrl, el, response.cropDip)
    : await cropToBox(response.dataUrl, response.cropDip);
  const originalWidth = customRect ? customRect.width : el.getBoundingClientRect().width;
  const appliedPadding = (padding > 0 && sampledBgColor) ? padding : 0;
  const finalDataUrl = appliedPadding
    ? await expandWithBackground(maskedDataUrl, sampledBgColor, appliedPadding, originalWidth)
    : maskedDataUrl;

  // Force Resize (bar advanced setting): rescale the finished bitmap to a
  // target pixel height/width. Runs after mask/crop/padding so the whole
  // output — including any padding — hits the requested dimension.
  const frMode = settings.forceResizeMode;
  const frValue = settings.forceResizeValue;
  const scaledDataUrl = (frMode === 'height' || frMode === 'width') && frValue > 0
    ? await scaleToTarget(finalDataUrl, frMode, frValue)
    : finalDataUrl;

  return { dataUrl: scaledDataUrl, filename: deriveFilename(el, theme), appliedPadding };
}

/**
 * Did the user actually change the capture's size? Compares the initial element
 * rect against the final resize box, width/height only (rounded so sub-pixel
 * layout jitter doesn't count). Position changes do not count as a resize.
 */
export function dimensionsChanged(initRect, box) {
  return Math.round(box.width) !== Math.round(initRect.width)
      || Math.round(box.height) !== Math.round(initRect.height);
}

/**
 * Is the resize box still exactly where it started (position AND size, rounded
 * so sub-pixel jitter doesn't count)? Unlike dimensionsChanged this also
 * catches pure moves (opposite-handle drags that net a shift). An untouched
 * box means the user confirmed the element as-is, so the capture should take
 * the element path and get the rounded-corner mask.
 */
export function boxUnchanged(a, b) {
  return Math.round(a.top)    === Math.round(b.top)
      && Math.round(a.left)   === Math.round(b.left)
      && Math.round(a.width)  === Math.round(b.width)
      && Math.round(a.height) === Math.round(b.height);
}

// ── Resize mode (draggable box) ───────────────────────────────────────────────

function applyDelta(handle, startBox, dx, dy) {
  let { top, left, width, height } = startBox;
  const MIN = 10;
  if (handle.includes('t')) {
    const h2 = height - dy;
    if (h2 >= MIN) { top += dy; height = h2; } else { top += (height - MIN); height = MIN; }
  }
  if (handle.includes('b')) { height = Math.max(MIN, height + dy); }
  if (handle.includes('l')) {
    const w2 = width - dx;
    if (w2 >= MIN) { left += dx; width = w2; } else { left += (width - MIN); width = MIN; }
  }
  if (handle.includes('r')) { width = Math.max(MIN, width + dx); }
  return { top, left, width, height };
}

/**
 * Draggable selection box. Calls onConfirm(rect, resized, untouched) on Enter,
 * onCancel() on Esc. Cleans up its own UI before invoking either callback.
 * `untouched` is true when the box still matches the element's initial rect
 * (position and size) — i.e. the user just pressed Enter without adjusting.
 */
export function enterResizeMode(el, settings, onConfirm, onCancel) {
  // Annotate-mode picks confirm a green ring instead of a capture — match
  // the box/handles/hint to the mode's hue (amber otherwise).
  const annotate = settings?.pickMode === 'annotate';
  const accent = annotate ? 'oklch(0.62 0.19 150)' : 'oklch(0.62 0.21 45)';
  const hintBg = annotate ? 'oklch(0.24 0.05 150)' : 'oklch(0.24 0.05 60)';
  const hintFg = annotate ? 'oklch(0.95 0.05 150)' : 'oklch(0.95 0.05 80)';
  const handleBg = annotate ? 'oklch(0.96 0.02 150)' : 'oklch(0.96 0.02 80)';
  const initRect = el.getBoundingClientRect();
  let box = {
    top: initRect.top + window.scrollY,
    left: initRect.left + window.scrollX,
    width: initRect.width,
    height: initRect.height,
  };
  const initBox = { ...box };

  const resizeOverlay = document.createElement('div');
  resizeOverlay.className = 'mb-capture-resize';
  Object.assign(resizeOverlay.style, {
    position: 'absolute', pointerEvents: 'none', overflow: 'visible',
    border: `2px solid ${accent}`, zIndex: '2147483647', boxSizing: 'border-box',
  });
  document.body.appendChild(resizeOverlay);

  const hint = document.createElement('div');
  Object.assign(hint.style, {
    position: 'absolute', zIndex: '2147483647',
    background: hintBg, color: hintFg,
    fontSize: '11px', padding: '4px 8px', borderRadius: '4px',
    pointerEvents: 'none', whiteSpace: 'nowrap',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  });
  hint.textContent = annotate ? '↵ Enter to annotate · Esc to cancel' : '↵ Enter to capture · Esc to cancel';
  document.body.appendChild(hint);

  function updateOverlay() {
    Object.assign(resizeOverlay.style, {
      top: box.top + 'px', left: box.left + 'px',
      width: box.width + 'px', height: box.height + 'px',
    });
    hint.style.top  = (box.top + box.height + 6) + 'px';
    hint.style.left = box.left + 'px';
  }
  updateOverlay();

  const HANDLE_DEFS = {
    tl: { top: '-5px',              left: '-5px',              cursor: 'nwse-resize' },
    tm: { top: '-5px',              left: 'calc(50% - 5px)',   cursor: 'ns-resize'   },
    tr: { top: '-5px',              right: '-5px',             cursor: 'nesw-resize' },
    ml: { top: 'calc(50% - 5px)',   left: '-5px',              cursor: 'ew-resize'   },
    mr: { top: 'calc(50% - 5px)',   right: '-5px',             cursor: 'ew-resize'   },
    bl: { bottom: '-5px',           left: '-5px',              cursor: 'nesw-resize' },
    bm: { bottom: '-5px',           left: 'calc(50% - 5px)',   cursor: 'ns-resize'   },
    br: { bottom: '-5px',           right: '-5px',             cursor: 'nwse-resize' },
  };

  for (const [name, styles] of Object.entries(HANDLE_DEFS)) {
    const h = document.createElement('div');
    Object.assign(h.style, {
      position: 'absolute', width: '10px', height: '10px',
      background: handleBg, border: `2px solid ${accent}`, boxSizing: 'border-box',
      pointerEvents: 'auto', zIndex: '2147483647',
      ...styles,
    });
    h.addEventListener('mousedown', (e) => {
      e.stopPropagation(); e.preventDefault();
      const startX = e.clientX, startY = e.clientY;
      const startBox = { ...box };
      function onMove(e) {
        box = applyDelta(name, startBox, e.clientX - startX, e.clientY - startY);
        updateOverlay();
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    resizeOverlay.appendChild(h);
  }

  function teardown() {
    document.removeEventListener('keydown', onKey, true);
    resizeOverlay.remove();
    hint.remove();
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      teardown();
      onCancel?.();
      return;
    }
    if (e.key === 'Enter') {
      e.stopPropagation();
      teardown();
      if (document.activeElement) document.activeElement.blur();
      onConfirm?.({ ...box }, dimensionsChanged(initRect, box), boxUnchanged(initBox, box));
    }
  }

  document.addEventListener('keydown', onKey, true);
}
