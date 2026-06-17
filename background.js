import { computeCaptureClip } from './scripts/captureGeometry.js';

// Bump this on every capture-debug change so we can prove the running code.
const CAPDBG_BUILD = 'CAPDBG-BUILD-15';
console.log(`[CAPDBG] ⚙️ background.js loaded — ${CAPDBG_BUILD}`);

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
      const clearMetrics = () => cmd(tabId, 'Emulation.clearDeviceMetricsOverride', {}).catch(() => {});
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
        // getBoundingClientRect() still returns logical CSS pixels, so
        // computeCaptureClip multiplies by the current tab zoom to convert to
        // the coordinate space CDP expects. All grid-alignment subtleties
        // (integer clip.scale, device-pixel snapping, the cropped-off margin)
        // live in captureGeometry.js.
        const zoom = await new Promise(resolve => chrome.tabs.getZoom(tabId, resolve));
        const { clip, clipScale, cropDip } = computeCaptureClip({ rect, zoom, devicePixelRatio, scale, tight });
        console.log(`[CAPDBG] [${CAPDBG_BUILD}] theme=${forcedTheme} SW: devicePixelRatio(fromContent)=${devicePixelRatio} zoom=${zoom} scale=${scale} clipScale=${clipScale}`, { clip, cropDip });

        // Probe the page's state at the TRUE pre-capture moment (debugger is
        // attached + theme emulated). Reveals whether a transition/animation is
        // still running, the surface is mid-reflow, or the debugger infobar is
        // still resizing the viewport when the screenshot fires.
        const PROBE_EXPR = `(function(){var r=document.getAnimations().filter(function(a){return a.playState==='running'});return {scrollX:window.scrollX,scrollY:window.scrollY,innerW:window.innerWidth,innerH:window.innerHeight,dpr:window.devicePixelRatio,vv:window.visualViewport?{w:Math.round(visualViewport.width),h:Math.round(visualViewport.height),s:visualViewport.scale,ot:Math.round(visualViewport.offsetTop)}:null,running:r.length,anims:r.slice(0,6).map(function(a){return {t:(a.effect&&a.effect.target)?a.effect.target.tagName:'?',c:(a.effect&&a.effect.target&&a.effect.target.className&&a.effect.target.className.toString)?a.effect.target.className.toString().trim().split(/\\s+/)[0]:'',p:a.transitionProperty||a.animationName||'?',cur:Math.round(a.currentTime||0)}})}})()`;
        try {
          const ev = await cmd(tabId, 'Runtime.evaluate', { expression: PROBE_EXPR, returnByValue: true });
          console.log(`[CAPDBG] theme=${forcedTheme} SW pre-capture state:`, ev?.result?.value);
        } catch (e) { console.warn('[CAPDBG] pre-capture probe failed', e); }

        // Baseline capture path (BUILD-10 reverted the DSF experiments — the bug
        // is specific to a popup element, likely its own compositor layer, not
        // the global surface DSF).
        const result = await cmd(tabId, 'Page.captureScreenshot', {
          format: 'png',
          clip: { ...clip, scale: clipScale },
        });

        // PNG IHDR carries width/height as big-endian uint32 at byte offsets
        // 16 and 20 (8-byte signature + 4 length + "IHDR"). Parse the first
        // few bytes to log the ACTUAL captured bitmap density vs the clip.
        try {
          const head = atob(result.data.slice(0, 44));
          const u32 = o => (head.charCodeAt(o) << 24 | head.charCodeAt(o + 1) << 16 | head.charCodeAt(o + 2) << 8 | head.charCodeAt(o + 3)) >>> 0;
          const bw = u32(16), bh = u32(20);
          console.log(`[CAPDBG] theme=${forcedTheme} SW: bitmap=${bw}x${bh}px  px/DIP=${(bw / clip.width).toFixed(3)} (clip.width=${clip.width} DIP, clipScale=${clipScale})`);
        } catch (e) { console.warn('[CAPDBG] PNG header parse failed', e); }

        await clearMetrics();
        if (forcedTheme) await resetEmulation();
        await detach();
        // cropDip (element box in DIP relative to the clip) rather than bitmap
        // pixels: how many px one DIP became depends on the display's
        // deviceScaleFactor, which the content script measures from the bitmap.
        sendResponse({ dataUrl: 'data:image/png;base64,' + result.data, cropDip });
      } catch (err) {
        await clearMetrics();
        if (forcedTheme) await resetEmulation().catch(() => {});
        try { await detach(); } catch {}
        sendResponse({ error: err.message || 'Capture failed' });
      }
    })();

    return true;
  }
});
