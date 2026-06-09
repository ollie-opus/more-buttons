chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
});

// Grant content scripts access to chrome.storage.session. Without this,
// capture mode's persistence layer silently no-ops in the page context.
// setAccessLevel must be called from a privileged context (the SW), and
// the setting persists for the extension's lifetime — re-asserting it on
// every SW start is safe and idempotent.
try {
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
} catch (e) {
  console.warn('storage.session.setAccessLevel failed:', e);
}

function cmd(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, result => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result);
    });
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'getZoom') {
    chrome.tabs.getZoom(sender.tab.id, zoom => sendResponse(zoom));
    return true;
  }

  if (msg.type === 'setZoom') {
    chrome.tabs.setZoom(sender.tab.id, msg.factor, () => sendResponse({}));
    return true;
  }

  if (msg.type === 'captureTab') {
    const { scale, devicePixelRatio = 1, forcedTheme, themeDelay = 0, tight = false } = msg;
    const tabId = sender.tab.id;

    (async () => {
      const detach = () => new Promise(res => chrome.debugger.detach({ tabId }, res));
      const resetEmulation = () => cmd(tabId, 'Emulation.setEmulatedMedia', { features: [] }).catch(() => {});
      try {
        await new Promise((res, rej) => {
          chrome.debugger.attach({ tabId }, '1.3', () => {
            if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
            else res();
          });
        });

        if (forcedTheme) {
          await cmd(tabId, 'Emulation.setEmulatedMedia', {
            features: [{ name: 'prefers-color-scheme', value: forcedTheme }]
          });
          if (themeDelay > 0) await new Promise(r => setTimeout(r, themeDelay));
        }

        // Get scroll offset from the content script (same coordinate space as getBoundingClientRect).
        // Note: we avoid captureBeyondViewport because it uses the layout viewport coordinate space
        // which excludes the scrollbar width, causing a ~15px offset vs JS's visual viewport.
        const rect = await new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(tabId, { type: 'getRectForCapture' }, r => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(r);
          });
        });

        // CDP clip coords are in CSS pixels at zoom=1. When the browser is zoomed,
        // getBoundingClientRect() still returns logical CSS pixels, so we must multiply
        // by the current tab zoom to convert to the coordinate space CDP expects.
        const zoom = await new Promise(resolve => chrome.tabs.getZoom(tabId, resolve));
        // Element box in DIP (the coordinate space CDP's clip expects). CDP clip
        // coords are CSS px at zoom=1, so multiply the page's logical rect by the
        // tab zoom.
        const rx = rect.x * zoom;
        const ry = rect.y * zoom;
        const rw = rect.width  * zoom;
        const rh = rect.height * zoom;

        // Pixel-exact capture rests on two grid alignments:
        //
        // 1. INTEGER clip.scale. clip.scale is output-px-per-DIP. A fractional
        //    value (e.g. 6/2.2 under zoom) makes CDP resample and round, which
        //    clamps the captured region ~1 DIP short and shifts edges. An integer
        //    scale maps the clip to the bitmap linearly with no rounding. `scale`
        //    is only a quality knob, so rounding scale/dpr to the nearest integer
        //    is free. (At 100% on Retina this is already 6/2=3 — why 100% looked
        //    clean and zoom didn't.)
        //
        // 2. DEVICE-pixel-snapped element box. getBoundingClientRect() is
        //    fractional, but the browser paints element edges snapped to the
        //    device-pixel grid. Cropping from the raw fractional rect misses the
        //    painted edge by a sub-pixel that scale magnifies into visible px, in
        //    either direction depending on where the fraction lands. Snapping the
        //    box to the device grid (physicalDpr = device px per DIP) registers
        //    the crop against the pixels actually drawn.
        const physicalDpr = devicePixelRatio / zoom;            // device px per DIP
        const clipScale = Math.max(1, Math.round(scale / devicePixelRatio)); // integer px per DIP
        const snapDip = v => Math.round(v * physicalDpr) / physicalDpr;       // → nearest device px
        const eL = snapDip(rx);
        const eT = snapDip(ry);
        const eR = snapDip(rx + rw);
        const eB = snapDip(ry + rh);

        // Element captures take a background margin (cropped off via cropPx) so
        // any residual rounding can't eat the element's edge; resize-mode
        // captures (`tight`) are used as-is, so capture exactly the box.
        const MARGIN = tight ? 0 : 4 / physicalDpr; // 4 device px, in DIP
        const clipLeft   = eL - MARGIN;
        const clipTop    = eT - MARGIN;
        const clipRight  = eR + MARGIN;
        const clipBottom = eB + MARGIN;
        const clip = {
          x:      clipLeft,
          y:      clipTop,
          width:  clipRight - clipLeft,
          height: clipBottom - clipTop,
        };

        // Crop box in BITMAP PIXELS: clip top-left maps to (0,0), one DIP is
        // clipScale output px. With integer clipScale and device-snapped edges
        // this is exact, not approximate.
        const cropPx = {
          x: (eL - clipLeft) * clipScale,
          y: (eT - clipTop)  * clipScale,
          w: (eR - eL) * clipScale,
          h: (eB - eT) * clipScale,
        };

        const result = await cmd(tabId, 'Page.captureScreenshot', {
          format: 'png',
          clip: { ...clip, scale: clipScale },
        });

        if (forcedTheme) await resetEmulation();
        await detach();
        sendResponse({ dataUrl: 'data:image/png;base64,' + result.data, cropPx });
      } catch (err) {
        if (forcedTheme) await resetEmulation().catch(() => {});
        try { await detach(); } catch {}
        sendResponse({ error: err.message || 'Capture failed' });
      }
    })();

    return true;
  }
});
