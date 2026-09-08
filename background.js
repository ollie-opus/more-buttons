import { runCaptureTab } from './scripts/captureFlow.js';
import { runExtractTheme } from './scripts/extractFlow.js';
import { createMotionSessionRegistry } from './scripts/motionSessions.js';

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

function attach(tabId) {
  return new Promise((res, rej) => {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
      else res();
    });
  });
}

// Tabs holding a capture-session-long debugger attach. While capture mode is
// armed, prefers-reduced-motion: reduce is emulated for the whole session (not
// just the shot window) so hover-lift rules gated behind it never fire while
// the user is picking — the element sits at rest at pick time. The attach
// survives hard navigations; captureTab reuses it instead of attaching per
// shot. Cleared on capture-mode exit, on tab close, when the user dismisses
// Chrome's debugger infobar (both land in onDetach), or when the tab leaves
// the KB host (onUpdated below). Mirrored to chrome.storage.session because
// the debugger attach is extension-scoped and SURVIVES a service-worker
// restart: with in-memory-only state a restart would desync — release would
// no-op (stuck infobar + emulation) and the per-shot attach would collide
// with the surviving attach, failing shots. Consumers await
// `motionSessions.ready` before reading.
const motionSessions = createMotionSessionRegistry(chrome.storage.session);
const REDUCED_MOTION = { name: 'prefers-reduced-motion', value: 'reduce' };

// Attach, adopting an attach that already exists. After a SW restart the
// session-long attach survives; a plain attach would reject ("Another
// debugger is already attached"). The probe distinguishes OUR surviving
// attach (sendCommand works) from a genuinely foreign debugger such as
// DevTools (sendCommand fails) — only the latter is a real error.
async function ensureAttached(tabId) {
  try {
    await attach(tabId);
  } catch (err) {
    if (!/already attached/i.test(err.message || '')) throw err;
    await cmd(tabId, 'Browser.getVersion'); // throws if the attach isn't ours
  }
}

// Full release for one tab: forget the session, clear emulation, detach.
// Unconditional and idempotent — correct even if the registry has drifted
// (both CDP calls swallow their errors on an unattached tab).
async function releaseMotionSession(tabId) {
  await motionSessions.ready;
  motionSessions.remove(tabId);
  await cmd(tabId, 'Emulation.setEmulatedMedia', { features: [] }).catch(() => {});
  await new Promise(res => chrome.debugger.detach({ tabId }, () => {
    void chrome.runtime.lastError;
    res();
  }));
}

chrome.debugger.onDetach.addListener(source => {
  if (source.tabId == null) return;
  (async () => {
    await motionSessions.ready; // never race hydration: a stale entry would resurrect
    motionSessions.remove(source.tabId);
  })();
});

// Navigating the tab off the KB host removes the content script that would
// send captureMotionRelease — without this, the attach, the reduce emulation
// and Chrome's infobar would stick until tab close. In-host navigations keep
// the session: captureMode restores from sessionStorage and re-freezes.
const KB_HOST_PREFIX = 'https://cloud.opus-safety.co.uk/';
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url || changeInfo.url.startsWith(KB_HOST_PREFIX)) return;
  (async () => {
    await motionSessions.ready;
    if (motionSessions.has(tabId)) await releaseMotionSession(tabId);
  })();
});

// Shared debugger-side deps for captureTab / captureExtractTheme. While a
// capture-mode motion session holds the attach, reuse it: don't attach or
// detach per shot, and restore the session's reduce-only emulation instead of
// clearing everything. Callers await motionSessions.ready first — sessionHeld
// is read synchronously here.
function buildDebuggerDeps(tabId) {
  return {
    sessionHeld: motionSessions.has(tabId),
    cmd: (method, params) => cmd(tabId, method, params),
    attach: () => ensureAttached(tabId),
    detach: async () => {
      if (motionSessions.has(tabId)) return;
      await new Promise(res => chrome.debugger.detach({ tabId }, () => {
        void chrome.runtime.lastError;
        res();
      }));
    },
    resetEmulation: () => cmd(tabId, 'Emulation.setEmulatedMedia', {
      features: motionSessions.has(tabId) ? [REDUCED_MOTION] : []
    }).catch(() => {}),
    sleep: ms => new Promise(r => setTimeout(r, ms)),
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'captureMotionFreeze') {
    const tabId = sender.tab.id;
    (async () => {
      try {
        await motionSessions.ready;
        if (!motionSessions.has(tabId)) {
          await ensureAttached(tabId);
          motionSessions.add(tabId);
        }
        await cmd(tabId, 'Emulation.setEmulatedMedia', { features: [REDUCED_MOTION] });
        sendResponse({});
      } catch (err) {
        // Best-effort: capture mode works without the session hold (shots
        // still emulate reduce themselves), so just report and move on.
        sendResponse({ error: err.message || 'freeze failed' });
      }
    })();
    return true;
  }

  if (msg.type === 'captureMotionRelease') {
    // Unconditional: after a SW restart the old guard (`has(tabId)`) saw an
    // empty set and skipped the detach, leaving the infobar and the reduce
    // emulation stuck for the tab's lifetime.
    releaseMotionSession(sender.tab.id).then(() => sendResponse({}));
    return true;
  }

  if (msg.type === 'getZoom') {
    chrome.tabs.getZoom(sender.tab.id, zoom => sendResponse(zoom));
    return true;
  }

  if (msg.type === 'setZoom') {
    chrome.tabs.setZoom(sender.tab.id, msg.factor, () => sendResponse({}));
    return true;
  }

  if (msg.type === 'captureTab') {
    const tabId = sender.tab.id;

    // The ordering of the capture pipeline (emulate → rect → settle → bg
    // sample → screenshot) lives in runCaptureTab (scripts/captureFlow.js),
    // where it is pinned by tests/captureFlowOrder.test.mjs. This handler only
    // binds chrome.* to the deps it needs.
    (async () => {
      await motionSessions.ready;
      const deps = {
        ...buildDebuggerDeps(tabId),
        getRect: () => new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(tabId, { type: 'getRectForCapture' }, r => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(r);
          });
        }),
        // Best-effort: padding is simply skipped if the sample never lands.
        sampleBg: () => new Promise(resolve => {
          chrome.tabs.sendMessage(tabId, { type: 'sampleBgForCapture' }, () => {
            void chrome.runtime.lastError;
            resolve();
          });
        }),
        getZoom: () => new Promise(resolve => chrome.tabs.getZoom(tabId, resolve)),
      };
      sendResponse(await runCaptureTab(deps, msg));
    })();
    return true;
  }

  if (msg.type === 'captureExtractTheme') {
    const tabId = sender.tab.id;

    // Extract mode's themed serialization: no screenshot — the theme flip is
    // held while the content script reads computed styles and serializes the
    // picked SVG (svgExtract.js). Ordering lives in runExtractTheme
    // (scripts/extractFlow.js), pinned by tests/extractFlowOrder.test.mjs.
    // This handler only binds chrome.* to the deps, mirroring captureTab.
    (async () => {
      await motionSessions.ready;
      const deps = {
        ...buildDebuggerDeps(tabId),
        serialize: () => new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(tabId, { type: 'serializeSvgForExtract' }, r => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(r);
          });
        }),
      };
      sendResponse(await runExtractTheme(deps, msg));
    })();
    return true;
  }
});
