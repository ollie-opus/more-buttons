/**
 * motionSessions.js — durable registry of tabs holding a capture-session-long
 * debugger attach (see background.js). Pure factory: the storage area is
 * injected so node tests can drive it with a fake, and so the service worker
 * can hand it chrome.storage.session — which survives SW restarts. The
 * debugger attach itself is extension-scoped and outlives the SW, so an
 * in-memory-only set would desync after a restart: release would no-op
 * (stuck infobar + emulation) and the per-shot attach would collide with the
 * surviving attach, failing shots.
 *
 * The in-memory Set is the synchronous source of truth once `ready` has
 * resolved; every mutation is mirrored to storage fire-and-forget.
 */
export function createMotionSessionRegistry(storageArea, key = 'mbMotionSessions') {
  const tabs = new Set();

  const persist = () => {
    try {
      const p = storageArea.set({ [key]: [...tabs] });
      p?.catch?.(() => {});
    } catch { /* storage gone (teardown) — the in-memory set still serves */ }
  };

  const ready = Promise.resolve()
    .then(() => storageArea.get(key))
    .then(items => { for (const id of items?.[key] ?? []) tabs.add(id); })
    .catch(() => {});

  return {
    ready,
    has: tabId => tabs.has(tabId),
    add: tabId => { tabs.add(tabId); persist(); },
    remove: tabId => { if (tabs.delete(tabId)) persist(); },
    all: () => [...tabs],
  };
}
