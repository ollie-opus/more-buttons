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
    const { scale, devicePixelRatio = 1, forcedTheme, themeDelay = 0 } = msg;
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
        const rx = rect.x * zoom;
        const ry = rect.y * zoom;
        const x = Math.round(rx);
        const y = Math.round(ry);
        const clip = {
          x,
          y,
          width:  Math.ceil(rx + rect.width  * zoom) - x,
          height: Math.ceil(ry + rect.height * zoom) - y,
        };

        const result = await cmd(tabId, 'Page.captureScreenshot', {
          format: 'png',
          clip: { ...clip, scale: scale / devicePixelRatio },
        });

        if (forcedTheme) await resetEmulation();
        await detach();
        sendResponse({ dataUrl: 'data:image/png;base64,' + result.data });
      } catch (err) {
        if (forcedTheme) await resetEmulation().catch(() => {});
        try { await detach(); } catch {}
        sendResponse({ error: err.message || 'Capture failed' });
      }
    })();

    return true;
  }
});
