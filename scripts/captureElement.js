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

import { cropBoxPx } from './captureGeometry.js';

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
      const { width: elW } = el.getBoundingClientRect();
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
      function parseR(val, dim, scale) {
        const v = val.trim().split(/\s+/)[0];
        if (v.endsWith('%')) return (parseFloat(v) / 100) * dim * scale;
        return (parseFloat(v) || 0) * scale;
      }

      let tl = parseR(cs.borderTopLeftRadius,     elW, sx);
      let tr = parseR(cs.borderTopRightRadius,    elW, sx);
      let br = parseR(cs.borderBottomRightRadius, elW, sx);
      let bl = parseR(cs.borderBottomLeftRadius,  elW, sx);

      // getComputedStyle returns the *unclamped* radius (e.g. "9999px" for a
      // pill), but CSS scales all radii down by a single factor when the two
      // radii along any edge would overlap. Reproduce that clamp here against the
      // element's own box, otherwise large/pill radii feed arcTo() values bigger
      // than the box and the clip path becomes malformed (no rounded ends). The
      // factor stays 1 for normal radii.
      const f = Math.min(1, w / (tl + tr), h / (tr + br), w / (br + bl), h / (bl + tl));
      if (f < 1) { tl *= f; tr *= f; br *= f; bl *= f; }

      ctx.beginPath();
      ctx.moveTo(tl, 0);
      ctx.lineTo(w - tr, 0);  ctx.arcTo(w, 0, w, tr, tr);
      ctx.lineTo(w, h - br);  ctx.arcTo(w, h, w - br, h, br);
      ctx.lineTo(bl, h);      ctx.arcTo(0, h, 0, h - bl, bl);
      ctx.lineTo(0, tl);      ctx.arcTo(0, 0, tl, 0, tl);
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
 * Single screenshot. The controller calls this once per theme.
 *
 * @returns {Promise<{ dataUrl: string, filename: string, appliedPadding: number } | null>}
 *   null if the underlying screenshot failed (e.g. CDP attach refused).
 *   appliedPadding is the padding actually applied (0 if none / no sampleable bg).
 */
export async function screenshotElement(el, { theme, customRect = null, settings }) {
  const scale = Math.max(1, parseFloat(settings.scale) || 2);
  const padding = Math.max(0, parseInt(settings.capturePadding, 10) || 0);

  let sampledBgColor = null;

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
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        sendResponse({ x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height });
      }));
    }
    return true;
  };
  chrome.runtime.onMessage.addListener(rectListener);

  // Hide our own capture-mode overlays for the duration of the screenshot so
  // the inset edge glow, bar, tab, and selector box don't bleed into the PNG
  // for elements near the viewport edge.
  const hiddenOverlays = document.querySelectorAll(
    '.mb-capture-glow, .mb-capture-bar, .mb-capture-tab, .mb-capture-selector, .mb-capture-padding-ring, .mb-capture-resize'
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

  return { dataUrl: finalDataUrl, filename: deriveFilename(el, theme), appliedPadding };
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
export function enterResizeMode(el, _settings, onConfirm, onCancel) {
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
    border: '2px solid oklch(0.62 0.21 45)', zIndex: '2147483647', boxSizing: 'border-box',
  });
  document.body.appendChild(resizeOverlay);

  const hint = document.createElement('div');
  Object.assign(hint.style, {
    position: 'absolute', zIndex: '2147483647',
    background: 'oklch(0.24 0.05 60)', color: 'oklch(0.95 0.05 80)',
    fontSize: '11px', padding: '4px 8px', borderRadius: '4px',
    pointerEvents: 'none', whiteSpace: 'nowrap',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  });
  hint.textContent = '↵ Enter to capture · Esc to cancel';
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
      background: 'oklch(0.96 0.02 80)', border: '2px solid oklch(0.62 0.21 45)', boxSizing: 'border-box',
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
