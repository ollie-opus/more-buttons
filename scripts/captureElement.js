/**
 * captureElement.js — Pure capture engine.
 *
 * Stateless primitives the Capture Mode controller (captureMode.js) drives:
 *   - installSelector({ onPick, onArmedChange }) → cleanup
 *       Installs hover overlay + Shift+click listener. The controller
 *       decides when to tear it down (mode exit, mid-capture pause).
 *   - screenshotElement(el, { theme, customRect, settings }) → { dataUrl, filename }
 *       One screenshot. Light+dark pairs are two awaits in the controller.
 *   - enterResizeMode(el, settings, onConfirm, onCancel)
 *       Draggable selection box overlay. Calls onConfirm(rect) on Enter,
 *       onCancel() on Esc.
 *
 * No module-level lifecycle. The controller owns mode state.
 */

// ── Hover + Shift-arm selector ────────────────────────────────────────────────

export function installSelector({ onPick, onArmedChange }) {
  const overlay = document.createElement('div');
  overlay.className = 'mb-capture-selector';
  Object.assign(overlay.style, {
    position: 'fixed', pointerEvents: 'none',
    // border + background come from CSS (.mb-capture-selector) so they
    // share the capture-mode hue token defined in formsStyling.css.
    zIndex: '2147483647', boxSizing: 'border-box',
    display: 'none',
  });
  // Mount on <html> so Turbo's <body> swap doesn't sweep it.
  document.documentElement.appendChild(overlay);

  let armed = false;
  function setArmed(next) {
    if (next === armed) return;
    armed = next;
    // Highlight box only exists while Shift is held — otherwise the page is
    // unobstructed and the user can interact with it normally.
    overlay.style.display = armed ? 'block' : 'none';
    onArmedChange?.(armed);
  }

  function highlight(el) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    Object.assign(overlay.style, {
      top: r.top + 'px', left: r.left + 'px',
      width: r.width + 'px', height: r.height + 'px',
    });
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
  const overlays = document.querySelectorAll('.mb-capture-selector, .mb-capture-bar, .mb-capture-tab, .mb-capture-resize');
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

function applyBorderRadiusMask(src, el) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const { width: elW } = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const canvas = document.createElement('canvas');
      canvas.width  = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');

      const sx = img.width / elW;
      function parseR(val, dim, scale) {
        const v = val.trim().split(/\s+/)[0];
        if (v.endsWith('%')) return (parseFloat(v) / 100) * dim * scale;
        return (parseFloat(v) || 0) * scale;
      }

      const tl = parseR(cs.borderTopLeftRadius,     elW, sx);
      const tr = parseR(cs.borderTopRightRadius,    elW, sx);
      const br = parseR(cs.borderBottomRightRadius, elW, sx);
      const bl = parseR(cs.borderBottomLeftRadius,  elW, sx);
      const w = img.width, h = img.height;

      ctx.beginPath();
      ctx.moveTo(tl, 0);
      ctx.lineTo(w - tr, 0);  ctx.arcTo(w, 0, w, tr, tr);
      ctx.lineTo(w, h - br);  ctx.arcTo(w, h, w - br, h, br);
      ctx.lineTo(bl, h);      ctx.arcTo(0, h, 0, h - bl, bl);
      ctx.lineTo(0, tl);      ctx.arcTo(0, 0, tl, 0, tl);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, 0, 0);

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
const BASE64_LIKE_RE = /^[a-z0-9]{30,}$/i;

function deriveFilename(el, forcedTheme, settings) {
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
      if (BASE64_LIKE_RE.test(s)) return 'id';
      return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    })
    .filter(Boolean);
  const prefixSegments = settings.downloadPath
    ? settings.downloadPath.split('/').map(s => s.trim()).filter(Boolean)
    : [];
  return [...prefixSegments, ...pathSegments, fileName].join('/');
}

/**
 * Single screenshot. The controller calls this once per theme.
 *
 * @returns {Promise<{ dataUrl: string, filename: string } | null>}
 *   null if the underlying screenshot failed (e.g. CDP attach refused).
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
    '.mb-capture-glow, .mb-capture-bar, .mb-capture-tab, .mb-capture-selector, .mb-capture-resize'
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
    }, resolve)
  );

  hiddenOverlays.forEach((o, i) => { o.style.display = prevOverlayDisplay[i] ?? ''; });

  chrome.runtime.onMessage.removeListener(rectListener);

  if (!response || response.error) {
    console.error('[captureElement] Screenshot failed:', response?.error);
    return null;
  }

  const maskedDataUrl = !customRect ? await applyBorderRadiusMask(response.dataUrl, el) : response.dataUrl;
  const originalWidth = customRect ? customRect.width : el.getBoundingClientRect().width;
  const finalDataUrl = (padding > 0 && sampledBgColor)
    ? await expandWithBackground(maskedDataUrl, sampledBgColor, padding, originalWidth)
    : maskedDataUrl;

  return { dataUrl: finalDataUrl, filename: deriveFilename(el, theme, settings) };
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
 * Draggable selection box. Calls onConfirm(rect) on Enter, onCancel() on Esc.
 * Cleans up its own UI before invoking either callback.
 */
export function enterResizeMode(el, _settings, onConfirm, onCancel) {
  const initRect = el.getBoundingClientRect();
  let box = {
    top: initRect.top + window.scrollY,
    left: initRect.left + window.scrollX,
    width: initRect.width,
    height: initRect.height,
  };

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
      onConfirm?.({ ...box });
    }
  }

  document.addEventListener('keydown', onKey, true);
}
