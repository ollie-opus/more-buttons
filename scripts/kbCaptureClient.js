/**
 * kbCaptureClient.js — asking for a capture from a Knowledge Base page
 * (support.opus-safety.co.uk) that is not the draft editor: today, a media
 * file's admin page recapturing it (kbAdminMediaEntry.js).
 *
 * The thing to capture is on the webapp, in another tab. The service worker
 * arms capture mode there, stands that tab beside this one and brings the
 * user back with the result (background.js kbCaptureStart / kbCaptureReturn;
 * the webapp side is kbSiteCapture.js). This module is this page's end of
 * that: start, keep asking whether it is still going (capture mode can end
 * with no word back: a reload, the tab closed), take the delivery.
 *
 * The draft editor has its own copy of this, bound to the draft's state
 * (kbPageEditor.js startCapture / watchCapture).
 */

/** Ask the service worker something; null when there is no answer. */
function ask(type, extra = {}) {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage({ type, ...extra }, res => {
        void chrome.runtime.lastError;
        resolve(res ?? null);
      });
    } catch {
      resolve(null); // the extension was reloaded under this page
    }
  });
}

/** The webapp tabs open now, and whether there is a last-captured page to reopen. Never waits long. */
export function listCaptureTabs() {
  return new Promise(done => {
    const resolve = res => done({ tabs: res?.tabs ?? [], hasLast: !!res?.hasLast });
    const giveUp = setTimeout(() => resolve(null), 500);
    ask('kbCaptureTabs').then(res => { clearTimeout(giveUp); resolve(res); });
  });
}

/**
 * The doubt that a capture is still going, after one more check. A sure
 * "alive" clears it; "gone" counts double; a doubtful or missing answer once
 * (the tab may be between two pages). At STRIKES_OUT the capture is over.
 */
export function nextStrikes(strikes, res) {
  if (res?.alive && !res.unsure) return 0;
  return strikes + (res?.alive === false ? 2 : 1);
}
const STRIKES_OUT = 4;
const CHECK_EVERY = 2000;

/**
 * Start a capture in a webapp tab (`tabId` null: a new one; `reopen`: on the
 * page the last capture was taken from). `recapture` ({ lightPath, darkPath })
 * makes it replace that stored capture.
 *   onDeliver(capture)  the capture came back
 *   onEnd()             it ended with nothing (dismissed, its tab closed)
 *   onSplit(bool)       whether the capturing tab stands beside this one
 * @returns {Promise<{ok: true, focus: () => void, cancel: () => Promise<boolean>} | {error: string}>}
 */
export async function startCaptureSession({ tabId = null, reopen = false, recapture = null, onDeliver, onEnd, onSplit }) {
  const token = crypto.randomUUID();
  let over = false;
  let strikes = 0;
  let timer = null;

  const onMessage = (msg, _sender, sendResponse) => {
    if (msg?.type !== 'kbCaptureDeliver' || msg.token !== token || over) return;
    sendResponse({ ok: true });
    finish();
    if (msg.capture) onDeliver?.(msg.capture); else onEnd?.();
  };
  const onFocus = () => { if (!over) watch(0); };
  const onVisible = () => { if (!document.hidden) onFocus(); };

  function finish() {
    over = true;
    clearTimeout(timer);
    chrome.runtime.onMessage.removeListener(onMessage);
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVisible);
  }

  function watch(delay = CHECK_EVERY) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const res = await ask('kbCaptureCheck', { token });
      if (over) return;
      strikes = nextStrikes(strikes, res);
      if (strikes >= STRIKES_OUT) { finish(); onEnd?.(); return; }
      if (res?.alive) onSplit?.(!!res.split);
      watch();
    }, delay);
  }

  // Listening before the ask: the answer and the delivery cannot cross.
  chrome.runtime.onMessage.addListener(onMessage);
  const res = await ask('kbCaptureStart', { tabId, token, reopen, recapture });
  if (!res?.ok) {
    finish();
    return { error: res?.error || 'Could not start capture mode. Reload this page and try again.' };
  }
  onSplit?.(!!res.split);
  // Coming back to this tab is when the two have most likely been parted: ask at once.
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisible);
  watch();
  return {
    ok: true,
    focus: () => { if (!over) ask('kbCaptureFocus', { token }); },
    /** Resolves false when it was refused: the other tab is already storing the capture, and will deliver it. */
    cancel: async () => {
      if (over) return true;
      const res = await ask('kbCaptureCancel', { token });
      if (res?.busy) return false;
      if (!over) finish();
      return true;
    },
  };
}
