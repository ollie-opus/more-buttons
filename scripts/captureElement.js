let captureStoreCallback = null;
export function setCaptureStoreMode(fn) { captureStoreCallback = fn; }

let activeCaptureCleanup = null;

export async function captureElement(scale, settingsOverrides = {}) {
  if (activeCaptureCleanup) {
    activeCaptureCleanup();
    return;
  }

  scale = Math.max(1, parseFloat(scale) || 1);

  const stored = await chrome.storage.local.get('moreButtonsCaptureSettings');
  const captureSettings = stored.moreButtonsCaptureSettings ?? {};
  if (!captureSettings.downloadPath) captureSettings.downloadPath = 'occ-captures';
  if (!captureSettings.downloadMode) captureSettings.downloadMode = 'both';
  if (captureSettings.capturePadding == null) captureSettings.capturePadding = 0;
  const padding = Math.max(0, parseInt(captureSettings.capturePadding, 10) || 0);
  Object.assign(captureSettings, settingsOverrides);

  let capturing = false;

  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed', pointerEvents: 'none',
    border: '2px solid #00f', zIndex: '999999', boxSizing: 'border-box'
  });
  document.body.appendChild(overlay);

  function highlight(el) {
    const r = el.getBoundingClientRect();
    Object.assign(overlay.style, {
      top: r.top + 'px', left: r.left + 'px',
      width: r.width + 'px', height: r.height + 'px'
    });
  }

  function sampleBackgroundColor(el) {
    const r = el.getBoundingClientRect();
    const OFFSET = 3; // px outside the element boundary to sample
    const t = r.top - OFFSET, b = r.bottom + OFFSET;
    const l = r.left - OFFSET, ri = r.right + OFFSET;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;

    // 12 sample points: 3 per side at 25%, 50%, 75% along each edge
    const points = [
      [r.left + r.width * 0.25, t], [cx, t], [r.left + r.width * 0.75, t],   // top
      [r.left + r.width * 0.25, b], [cx, b], [r.left + r.width * 0.75, b],   // bottom
      [l, r.top + r.height * 0.25], [l, cy], [l, r.top + r.height * 0.75],   // left
      [ri, r.top + r.height * 0.25], [ri, cy], [ri, r.top + r.height * 0.75], // right
    ];

    // briefly hide overlay so it doesn't shadow elementFromPoint
    overlay.style.display = 'none';
    const colors = points.map(([x, y]) => {
      let node = document.elementFromPoint(x, y);
      while (node && node !== document.documentElement) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
        node = node.parentElement;
      }
      return getComputedStyle(document.documentElement).backgroundColor || 'rgb(255,255,255)';
    });
    overlay.style.display = '';

    // pick the most frequent color (mode), fallback to white
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
        const { width: elW, height: elH } = el.getBoundingClientRect();
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

  async function capture(el, forcedTheme, customRect = null) {
    if (capturing) return;
    capturing = true;
    try {
      let sampledBgColor = null;

      const rectListener = (msg, _sender, sendResponse) => {
        if (msg.type !== 'getRectForCapture') return false;
        chrome.runtime.onMessage.removeListener(rectListener);
        if (customRect) {
          // customRect is page-absolute (position:absolute coords)
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
          // scrollIntoView ensures the element is visible even if blur() or other side-effects
          // scrolled the page during the 100ms gap. Double rAF lets the instant scroll
          // visually commit before we respond, so Page.captureScreenshot sees the right viewport.
          el.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'nearest' });
          if (padding > 0) sampledBgColor = sampleBackgroundColor(el);
          requestAnimationFrame(() => requestAnimationFrame(() => {
            const r = el.getBoundingClientRect();
            sendResponse({ x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height });
          }));
        }
        return true; // keep channel open for async sendResponse
      };
      chrome.runtime.onMessage.addListener(rectListener);

      const response = await new Promise(resolve =>
        chrome.runtime.sendMessage({
          type: 'captureTab',
          scale,
          devicePixelRatio: window.devicePixelRatio,
          forcedTheme,
          themeDelay: forcedTheme ? (captureSettings.themeDelay ?? 500) : 0,
        }, resolve)
      );

      chrome.runtime.onMessage.removeListener(rectListener);

      if (!response || response.error) {
        console.error('[captureElement] Screenshot failed:', response?.error);
        return;
      }

      // Apply border-radius mask for transparency + rounded corners; skip for resize-mode customRect
      const maskedDataUrl = !customRect ? await applyBorderRadiusMask(response.dataUrl, el) : response.dataUrl;

      // Expand canvas with sampled background colour if padding requested
      const originalWidth = customRect ? customRect.width : el.getBoundingClientRect().width;
      const finalDataUrl = (padding > 0 && sampledBgColor)
        ? await expandWithBackground(maskedDataUrl, sampledBgColor, padding, originalWidth)
        : maskedDataUrl;

      const rawLabel = getElementLabel(el);
      const slug = (rawLabel || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
      const theme = forcedTheme
        ? `${forcedTheme}-mode`
        : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark-mode' : 'light-mode');
      const baseName = slug || `element-${el.tagName.toLowerCase()}`;
      const fileName = `${baseName}-${theme}.png`;

      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const BASE64_LIKE_RE = /^[a-z0-9]{30,}$/i;
      const pathSegments = window.location.pathname
        .split('/')
        .filter(Boolean)
        .map(s => {
          if (UUID_RE.test(s)) return 'uuid';
          if (BASE64_LIKE_RE.test(s)) return 'id';
          return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        })
        .filter(Boolean);
      const prefixSegments = captureSettings.downloadPath
        ? captureSettings.downloadPath.split('/').map(s => s.trim()).filter(Boolean)
        : [];
      const filename = [...prefixSegments, ...pathSegments, fileName].join('/');

      if (captureStoreCallback) {
        captureStoreCallback({ dataUrl: finalDataUrl, filename });
      } else {
        await new Promise(resolve =>
          chrome.runtime.sendMessage({ type: 'downloadFile', dataUrl: finalDataUrl, filename }, resolve)
        );
      }
    } finally {
      capturing = false;
    }
  }

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

  function enterResizeMode(el) {
    const initRect = el.getBoundingClientRect();
    let box = { top: initRect.top + window.scrollY, left: initRect.left + window.scrollX, width: initRect.width, height: initRect.height };

    const resizeOverlay = document.createElement('div');
    Object.assign(resizeOverlay.style, {
      position: 'absolute', pointerEvents: 'none', overflow: 'visible',
      border: '2px solid #00f', zIndex: '999999', boxSizing: 'border-box',
    });
    document.body.appendChild(resizeOverlay);

    const hint = document.createElement('div');
    Object.assign(hint.style, {
      position: 'absolute', zIndex: '999999',
      background: 'rgba(0,0,0,0.7)', color: '#fff',
      fontSize: '11px', padding: '3px 7px', borderRadius: '3px',
      pointerEvents: 'none', whiteSpace: 'nowrap',
    });
    hint.textContent = '↵ Enter to capture · Esc to exit';
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
        background: '#fff', border: '2px solid #00f', boxSizing: 'border-box',
        pointerEvents: 'auto', zIndex: '1000000',
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

    function cleanupResize() {
      document.removeEventListener('keydown', resizeKeydown, true);
      resizeOverlay.remove();
      hint.remove();
      activeCaptureCleanup = null;
    }

    activeCaptureCleanup = cleanupResize;

    function resizeKeydown(e) {
      if (e.key === 'Escape') {
        cleanupResize();
        return;
      }
      if (e.key === 'Enter') {
        document.removeEventListener('keydown', resizeKeydown, true);
        resizeOverlay.remove();
        hint.remove();
        activeCaptureCleanup = null;
        if (document.activeElement) document.activeElement.blur();
        const captureBox = { ...box };
        if (captureSettings.downloadMode === 'both') {
          setTimeout(async () => {
            await capture(el, 'light', captureBox);
            await capture(el, 'dark', captureBox);
            cleanup();
          }, 100);
        } else {
          setTimeout(async () => {
            await capture(el, undefined, captureBox);
            cleanup();
          }, 100);
        }
      }
    }

    document.addEventListener('keydown', resizeKeydown, true);
  }

  function move(e) { highlight(e.target); }

  function click(e) {
    e.preventDefault();
    e.stopPropagation();
    const target = e.target;
    cleanup();
    if (document.activeElement) document.activeElement.blur();
    if (captureSettings.resizeMode) {
      enterResizeMode(target);
    } else if (captureSettings.downloadMode === 'both') {
      // allow blur and any focus-loss repaints to settle before capture
      setTimeout(async () => {
        await capture(target, 'light');
        await capture(target, 'dark');
      }, 100);
    } else {
      setTimeout(() => capture(target), 100);
    }
  }

  function keydown(e) {
    if (e.key === 'Escape') cleanup();
  }

  function cleanup() {
    document.removeEventListener('mousemove', move, true);
    document.removeEventListener('click', click, true);
    document.removeEventListener('keydown', keydown, true);
    overlay.remove();
    activeCaptureCleanup = null;
  }

  activeCaptureCleanup = cleanup;
  document.addEventListener('mousemove', move, true);
  document.addEventListener('click', click, true);
  document.addEventListener('keydown', keydown, true);
}
