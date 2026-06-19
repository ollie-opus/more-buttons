import { computeCaptureClip } from './scripts/captureGeometry.js';

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
        }

        // Get the element rect from the content script (same coordinate space as
        // getBoundingClientRect). We avoid captureBeyondViewport because it uses the
        // layout viewport coordinate space, which excludes the scrollbar width and
        // causes a ~15px offset vs JS's visual viewport.
        //
        // The content script de-promotes the target popover's GPU layer (transform:none)
        // inside this getRectForCapture handler, forcing an async full-res inline
        // re-raster. The themeDelay wait below runs AFTER this rect read — i.e. after
        // de-promotion — so the re-raster has time to commit before Page.captureScreenshot;
        // otherwise the popover can be dropped from the frame (intermittent blank).
        const rect = await new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(tabId, { type: 'getRectForCapture' }, r => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(r);
          });
        });

        // Theme settle + de-promotion re-raster settle (see note above). Forced-theme
        // only; non-theme captures pass themeDelay=0. The de-promoted state persists on
        // the page until the content script restores it after this capture returns.
        if (forcedTheme && themeDelay > 0) await new Promise(r => setTimeout(r, themeDelay));

        // CDP clip coords are in CSS pixels at zoom=1. When the browser is zoomed,
        // getBoundingClientRect() still returns logical CSS pixels, so
        // computeCaptureClip multiplies by the current tab zoom to convert to
        // the coordinate space CDP expects. All grid-alignment subtleties
        // (integer clip.scale, device-pixel snapping, the cropped-off margin)
        // live in captureGeometry.js.
        const zoom = await new Promise(resolve => chrome.tabs.getZoom(tabId, resolve));
        const { clip, clipScale, cropDip } = computeCaptureClip({ rect, zoom, devicePixelRatio, scale, tight });

        const result = await cmd(tabId, 'Page.captureScreenshot', {
          format: 'png',
          clip: { ...clip, scale: clipScale },
        });

        if (forcedTheme) await resetEmulation();
        await detach();
        // cropDip (element box in DIP relative to the clip) rather than bitmap
        // pixels: how many px one DIP became depends on the display's
        // deviceScaleFactor, which the content script measures from the bitmap.
        sendResponse({ dataUrl: 'data:image/png;base64,' + result.data, cropDip });
      } catch (err) {
        if (forcedTheme) await resetEmulation().catch(() => {});
        try { await detach(); } catch {}
        sendResponse({ error: err.message || 'Capture failed' });
      }
    })();

    return true;
  }
});
