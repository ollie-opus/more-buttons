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

// ── Captures for the published Knowledge Base ────────────────────────────────
// The in-page editor on support.opus-safety.co.uk takes a new capture in a
// webapp tab: an open one it lists (kbCaptureTabs), or a new one. This worker
// arms capture mode there, stands it beside the draft (split view where
// Chrome has it) and switches to it (kbCaptureStart), and brings the
// user back with the result (kbCaptureReturn; scripts/kbSiteCapture.js). `origin` is { tabId, token, frozen }:
// the draft's tab and the request the capture answers.
const WEBAPP_URL = 'https://cloud.opus-safety.co.uk/';
const UNREACHABLE = 'Could not start capture mode in that tab. Reload it and try again.';
// New tabs still loading, waiting to be armed: { [tabId]: origin }. In
// chrome.storage.session so a worker restart mid-load does not drop one.
const KB_CAPTURE_PENDING = 'mbKbCapturePending';
// The webapp page the last capture was taken from, for "Reopen last tab". In
// chrome.storage.local: it is still there after Chrome restarts.
const KB_CAPTURE_LAST_URL = 'mbKbCaptureLastUrl';
async function lastKbCaptureUrl() {
  const url = (await chrome.storage.local.get(KB_CAPTURE_LAST_URL))[KB_CAPTURE_LAST_URL];
  return typeof url === 'string' && url.startsWith(WEBAPP_URL) ? url : null;
}

// Chrome's own split view (two tabs side by side in one window), where this
// Chrome can be told to make one: tabs.createSplit / tabs.unsplit and
// tabs.create's splitWithTabId, Chrome 155+. The draft and the webapp tab are
// split for the length of a capture and parted again after it. Without the
// API (or when Chrome refuses: a pinned tab, a tab already in a split) the
// webapp tab is simply brought to the front, as before.
const splitApi = globalThis.browser?.tabs?.createSplit ? globalThis.browser.tabs
  : (chrome.tabs.createSplit ? chrome.tabs : null);
const NO_SPLIT = -1; // tabs.SPLIT_VIEW_ID_NONE
// Splits made here, so only those are undone: { [splitViewId]: true }.
const KB_CAPTURE_SPLITS = 'mbKbCaptureSplits';

async function rememberSplit(tabId) {
  const id = (await chrome.tabs.get(tabId)).splitViewId;
  if (id == null || id === NO_SPLIT) return;
  const { [KB_CAPTURE_SPLITS]: made = {} } = await chrome.storage.session.get(KB_CAPTURE_SPLITS);
  await chrome.storage.session.set({ [KB_CAPTURE_SPLITS]: { ...made, [id]: true } });
}

// Stand an open webapp tab beside the draft's tab and split the two. Moves
// the webapp tab next to the draft (and into its tab group, or out of its
// own): Chrome only splits neighbours of the same kind. False when it could not.
async function splitWithDraft(kbTabId, tabId) {
  if (!splitApi) return false;
  try {
    let [kb, tab] = await Promise.all([chrome.tabs.get(kbTabId), chrome.tabs.get(tabId)]);
    const split = t => t.splitViewId != null && t.splitViewId !== NO_SPLIT;
    if (split(kb) && kb.splitViewId === tab.splitViewId) return true; // already side by side
    if (split(kb) || split(tab) || kb.pinned || tab.pinned) return false;
    if (tab.groupId !== kb.groupId) {
      if (kb.groupId !== -1) await chrome.tabs.group({ tabIds: tabId, groupId: kb.groupId });
      else await chrome.tabs.ungroup(tabId);
    }
    tab = await chrome.tabs.get(tabId);
    kb = await chrome.tabs.get(kbTabId);
    // Straight after the draft: a tab taken from before it leaves a gap first.
    const index = tab.windowId === kb.windowId && tab.index < kb.index ? kb.index : kb.index + 1;
    if (tab.windowId !== kb.windowId || tab.index !== index) await chrome.tabs.move(tabId, { windowId: kb.windowId, index });
    await splitApi.createSplit([kbTabId, tabId]);
    await rememberSplit(kbTabId);
    return true;
  } catch {
    return false;
  }
}

// Part the draft from the webapp tab it was split with for a capture. A split
// the user made themselves is left alone.
async function unsplitFromDraft(kbTabId, webappTabId) {
  if (!splitApi || webappTabId == null) return;
  try {
    const [kb, tab] = await Promise.all([chrome.tabs.get(kbTabId), chrome.tabs.get(webappTabId)]);
    const id = kb.splitViewId;
    if (id == null || id === NO_SPLIT || id !== tab.splitViewId) return;
    const { [KB_CAPTURE_SPLITS]: made = {} } = await chrome.storage.session.get(KB_CAPTURE_SPLITS);
    if (!made[id]) return;
    const { [id]: _done, ...rest } = made;
    await chrome.storage.session.set({ [KB_CAPTURE_SPLITS]: rest });
    await splitApi.unsplit(id);
  } catch { /* the split is already gone */ }
}

// A new tab for the webapp, directly to the right of the draft's tab and, where
// Chrome can, split with it.
async function openBesideDraft(kb) {
  if (splitApi) {
    try {
      const tab = await splitApi.create({ url: 'about:blank', splitWithTabId: kb.id });
      return { tab, split: true };
    } catch { /* the draft's tab cannot be split (pinned, already in a split) */ }
  }
  const tab = await chrome.tabs.create({ url: 'about:blank', windowId: kb.windowId, index: kb.index + 1, openerTabId: kb.id });
  return { tab, split: false };
}

// The capture each draft is waiting on:
// { [kbTabId]: { token, tabId, created, armed, restore } }. `tabId` is the
// webapp tab; `created` says this flow opened it (so cancelling closes it);
// `restore` is where an already-open tab stood ({ windowId, index, groupId }),
// to put it back; `armed` turns true once capture mode has started there.
const KB_CAPTURE_SESSIONS = 'mbKbCaptureSessions';

async function kbSessions() {
  return (await chrome.storage.session.get(KB_CAPTURE_SESSIONS))[KB_CAPTURE_SESSIONS] ?? {};
}
async function putKbSession(kbTabId, session) {
  const { [kbTabId]: _old, ...rest } = await kbSessions();
  await chrome.storage.session.set({ [KB_CAPTURE_SESSIONS]: session ? { ...rest, [kbTabId]: session } : rest });
}
async function kbSessionFor(kbTabId, token) {
  const session = (await kbSessions())[kbTabId];
  return session && session.token === token ? session : null;
}

// Put a tab that was already open back where it stood before the capture.
async function restoreTab(session) {
  const { tabId, restore } = session;
  if (session.created || !restore) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.groupId !== restore.groupId) {
      if (restore.groupId !== -1) await chrome.tabs.group({ tabIds: tabId, groupId: restore.groupId }).catch(() => {});
      else await chrome.tabs.ungroup(tabId).catch(() => {});
    }
    await chrome.tabs.move(tabId, { windowId: restore.windowId, index: restore.index });
  } catch { /* the tab or its window is gone */ }
}

// A capture is over, however it ended: part the two tabs, put an already-open
// one back, forget the session.
async function endKbSession(kbTabId, session) {
  await unsplitFromDraft(kbTabId, session.tabId);
  await restoreTab(session);
  await putKbSession(kbTabId, null);
}

async function focusTab(tabId) {
  const tab = await chrome.tabs.update(tabId, { active: true });
  if (tab?.windowId != null) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
}

async function armKbCapture(tabId, origin) {
  try {
    return (await chrome.tabs.sendMessage(tabId, { type: 'kbCaptureArm', origin })) ?? { error: UNREACHABLE };
  } catch {
    return { error: UNREACHABLE };
  }
}

async function startKbCapture({ tabId, token, frozen, reopen, recapture }, sender) {
  // `frozen`: the draft is the System Updates page, whose captures are stored
  // as frozen copies in their own library folder (scripts/captureDest.js).
  // `recapture` ({ lightPath, darkPath }): asked by a media file's admin page
  // (scripts/kbAdminMediaEntry.js), not a draft: the shot replaces that
  // stored capture instead of adding one. The webapp side checks the paths.
  const origin = { tabId: sender.tab.id, token, frozen: !!frozen };
  if (recapture) origin.recapture = { lightPath: String(recapture.lightPath ?? ''), darkPath: recapture.darkPath ? String(recapture.darkPath) : null };
  if (tabId == null) {
    // Recorded before the tab exists to load: about:blank is created first,
    // so its 'complete' for the webapp cannot beat the write.
    const { tab, split } = await openBesideDraft(await chrome.tabs.get(sender.tab.id));
    const { [KB_CAPTURE_PENDING]: pending = {} } = await chrome.storage.session.get(KB_CAPTURE_PENDING);
    await chrome.storage.session.set({ [KB_CAPTURE_PENDING]: { ...pending, [tab.id]: origin } });
    await putKbSession(origin.tabId, { token, tabId: tab.id, created: true, armed: false, restore: null });
    // `reopen`: the page the last capture was taken from, not the webapp's front page.
    const url = (reopen && await lastKbCaptureUrl()) || WEBAPP_URL;
    await chrome.tabs.update(tab.id, { url, active: true });
    if (split) await rememberSplit(sender.tab.id).catch(() => {});
    return { ok: true, split };
  }
  const res = await armKbCapture(tabId, origin);
  if (res.ok) {
    const { windowId, index, groupId } = await chrome.tabs.get(tabId);
    await putKbSession(origin.tabId, { token, tabId, created: false, armed: true, restore: { windowId, index, groupId } });
    const split = await splitWithDraft(origin.tabId, tabId);
    await focusTab(tabId); // split or not, the webapp tab is the one in hand
    return { ok: true, split };
  }
  return res;
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url?.startsWith(WEBAPP_URL)) return;
  (async () => {
    const { [KB_CAPTURE_PENDING]: pending } = await chrome.storage.session.get(KB_CAPTURE_PENDING);
    const origin = pending?.[tabId];
    if (!origin) return;
    const { [tabId]: _armed, ...rest } = pending;
    await chrome.storage.session.set({ [KB_CAPTURE_PENDING]: rest });
    // The content script answers from document_start; the retries cover a
    // page that is slow to import the capture stack.
    for (let attempt = 0; attempt < 4; attempt++) {
      if ((await armKbCapture(tabId, origin)).ok) {
        const session = await kbSessionFor(origin.tabId, origin.token);
        if (session) await putKbSession(origin.tabId, { ...session, armed: true });
        return;
      }
      await new Promise(r => setTimeout(r, 400));
    }
    // Never armed: the draft's next check finds no capture and drops its placeholder.
    await putKbSession(origin.tabId, null);
  })();
});

chrome.tabs.onRemoved.addListener(tabId => {
  (async () => {
    const { [KB_CAPTURE_PENDING]: pending } = await chrome.storage.session.get(KB_CAPTURE_PENDING);
    if (pending?.[tabId]) {
      const { [tabId]: _gone, ...rest } = pending;
      await chrome.storage.session.set({ [KB_CAPTURE_PENDING]: rest });
    }
    // A draft closed mid-capture, or the tab it was waiting on closed: tell
    // the draft at once, so its placeholder goes without waiting for a check.
    const sessions = await kbSessions();
    if (sessions[tabId]) await putKbSession(tabId, null);
    for (const [kbTabId, session] of Object.entries(sessions)) {
      if (session.tabId !== tabId) continue;
      await putKbSession(kbTabId, null);
      chrome.tabs.sendMessage(Number(kbTabId), { type: 'kbCaptureDeliver', token: session.token, capture: null }).catch(() => {});
    }
  })();
});

// Hand the result to the draft's tab and bring it to the front. `capture` is
// null when capture mode was dismissed. { ok } only when the draft took it.
async function returnToKbTab({ origin, capture }, sender) {
  // A capture was taken: this is the page "Reopen last tab" goes back to.
  if (capture && sender.tab?.url?.startsWith(WEBAPP_URL)) {
    await chrome.storage.local.set({ [KB_CAPTURE_LAST_URL]: sender.tab.url }).catch(() => {});
  }
  const session = await kbSessionFor(origin.tabId, origin.token);
  if (session) await endKbSession(origin.tabId, session);
  else await unsplitFromDraft(origin.tabId, sender.tab?.id);
  let res;
  try {
    res = await chrome.tabs.sendMessage(origin.tabId, { type: 'kbCaptureDeliver', token: origin.token, capture: capture ?? null });
  } catch {
    return { error: 'gone' }; // the tab was closed, or left the Knowledge Base
  }
  await focusTab(origin.tabId).catch(() => {});
  // A tab this flow opened has done its job once its capture is in the draft.
  // (Not when the draft could not take it: that tab then says where the
  // capture went.)
  if (res?.ok && capture && session?.created) chrome.tabs.remove(session.tabId).catch(() => {});
  return res?.ok ? { ok: true } : { error: 'stale' };
}

// Are the draft and the capturing tab side by side in one split view right now?
async function splitTogether(kbTabId, tabId) {
  try {
    const [kb, tab] = await Promise.all([chrome.tabs.get(kbTabId), chrome.tabs.get(tabId)]);
    return kb.splitViewId != null && kb.splitViewId !== NO_SPLIT && kb.splitViewId === tab.splitViewId;
  } catch {
    return false;
  }
}

// Is the capture a draft waits on still going? { alive } is certain (with
// `split`: whether the two tabs stand side by side);
// { alive: true, unsure: true } when the webapp tab did not answer (it may be
// between pages). The draft drops its placeholder after repeated doubt.
async function checkKbCapture(kbTabId, token) {
  const session = await kbSessionFor(kbTabId, token);
  if (!session) return { alive: false };
  let tab;
  try { tab = await chrome.tabs.get(session.tabId); } catch { tab = null; }
  if (!tab) { await putKbSession(kbTabId, null); return { alive: false }; }
  const split = await splitTogether(kbTabId, session.tabId);
  if (!session.armed) return { alive: true, split };
  let res = null;
  if (tab.status !== 'complete') return { alive: true, unsure: true, split };
  if (tab.url?.startsWith(WEBAPP_URL)) {
    try { res = await chrome.tabs.sendMessage(session.tabId, { type: 'kbCaptureAlive', token }); } catch { return { alive: true, unsure: true, split }; }
  }
  if (res?.alive) return { alive: true, split };
  // Capture mode is gone from that tab (a reload, another site): the capture is over.
  await endKbSession(kbTabId, session);
  return { alive: false };
}

// The placeholder was clicked: stand the capturing tab beside the draft again.
async function focusKbCapture(kbTabId, token) {
  const session = await kbSessionFor(kbTabId, token);
  if (!session) return { error: 'gone' };
  await splitWithDraft(kbTabId, session.tabId);
  await focusTab(session.tabId);
  return { ok: true };
}

// The placeholder's ✕: a tab this flow opened is closed; one that was already
// open leaves capture mode and goes back to where it stood.
async function cancelKbCapture(kbTabId, token) {
  const session = await kbSessionFor(kbTabId, token);
  if (!session) return { ok: true };
  // Asked of either kind of tab first: one already storing its capture
  // refuses ({ busy }), and is left to finish and deliver it.
  const res = await chrome.tabs.sendMessage(session.tabId, { type: 'kbCaptureAbort', token }).catch(() => null);
  if (res?.busy) return { ok: false, busy: true };
  if (session.created) {
    await putKbSession(kbTabId, null);
    await chrome.tabs.remove(session.tabId).catch(() => {});
  } else {
    await endKbSession(kbTabId, session);
  }
  await focusTab(kbTabId).catch(() => {});
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'kbCaptureCheck' || msg.type === 'kbCaptureFocus' || msg.type === 'kbCaptureCancel') {
    const run = { kbCaptureCheck: checkKbCapture, kbCaptureFocus: focusKbCapture, kbCaptureCancel: cancelKbCapture }[msg.type];
    run(sender.tab.id, msg.token).then(sendResponse, err => sendResponse({ error: err?.message || 'failed' }));
    return true;
  }

  if (msg.type === 'kbCaptureTabs') {
    chrome.tabs.query({ url: WEBAPP_URL + '*' }, async tabs => {
      void chrome.runtime.lastError;
      const hasLast = !!(await lastKbCaptureUrl().catch(() => null));
      sendResponse({ tabs: (tabs ?? []).map(t => ({ id: t.id, title: t.title, url: t.url })), hasLast });
    });
    return true;
  }

  if (msg.type === 'kbCaptureStart') {
    startKbCapture(msg, sender).then(sendResponse, err => sendResponse({ error: err.message || UNREACHABLE }));
    return true;
  }

  if (msg.type === 'kbCaptureReturn') {
    returnToKbTab(msg, sender).then(sendResponse, () => sendResponse({ error: 'gone' }));
    return true;
  }

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
