// Edit log panel: prefetches a thread, mounts it as a slim right-hand drawer
// over the form tile (toggled from a history button in the navbar, left of
// Close), re-renders it and owns its clicks (toggle/close, expand -> redline,
// Show history, Show more). Every real fetch runs under the formLoading veil;
// cached expands and collapses never do. Module scope is DOM/chrome-free
// (import-safe in Node).
import { createThread, openThread, revealHistory, showMore, threadView, addCommits, logicalItems } from './editLog.js';
import { editLogPanelHtml, editLogDrawerHtml, editLogToggleHtml, bubbleDetailHtml, EDIT_LOG_COPY } from './editLogView.js';
import { sectionRedline, itemRedline } from './textDiff.js';
import { listCommits, recentCommits, readRepoText, currentGithubLogin } from './repoClient.js';
import { formLoading } from './loading.js';

/** Adapts listCommits(path, { page, perPage }) to the model's fetchPage(path, page, perPage). */
export const makeFetchPage = (list) => (path, page, perPage) => list(path, { page, perPage });
export const fetchPage = makeFetchPage(listCommits);

/** Builds and opens a thread. Never rejects: a failure sets thread.error. */
export async function prefetchEditLog({ paths, itemUuid = null, session = false }) {
  const thread = createThread({ paths, itemUuid, session });
  try {
    const [login] = await Promise.all([
      currentGithubLogin(),
      openThread(thread, { fetchPage, recent: paths.flatMap(p => recentCommits(p)) }),
    ]);
    thread.login = login;
  } catch {
    thread.error = true;
  }
  return thread;
}

/**
 * Merge the write memo for each of the thread's paths (a save made while the form is
 * open, e.g. a reorder) and widen `shown` so it appears. Deduped by sha: idempotent.
 */
export function mergeRecentCommits(thread, recent = recentCommits) {
  let added = 0;
  for (const p of Object.keys(thread.paths)) added += addCommits(thread, recent(p));
  if (added) thread.shown = Math.min(thread.shown + added, logicalItems(thread).length);
  return added;
}

/**
 * Whether a redline built from these reads may be cached for the form's life. An
 * empty read of the commit's own ref with a parent present is most likely GitHub
 * lag on a just-made commit, not a real deletion; don't pin it.
 */
export const detailCacheable = (parentSha, after) => !(parentSha && after === '');

const fromHtml = (html) => { const h = document.createElement('div'); h.innerHTML = html; return h.firstElementChild; };

/**
 * Mount (or re-mount) the drawer for a form. The drawer and its navbar toggle
 * live on the overlay tile, outside <form>, so re-rendering the form body never
 * wipes them and their buttons never dirty the form. Idempotent: a second call
 * on the same form swaps the thread and re-renders, keeping the open state.
 */
export function mountEditLog(formEl, thread, { itemTypeRegex = null, onClose = null } = {}) {
  const host = formEl.closest('.more-buttons-overlay-content') ?? formEl.parentElement;
  let layer = host.querySelector('[data-editlog-layer]');
  if (!layer) { layer = fromHtml(editLogDrawerHtml()); host.appendChild(layer); }
  const slot = host.querySelector('[data-nav-tools]') ?? host.querySelector('.more-buttons-navbar');
  if (slot && !slot.querySelector('[data-editlog-toggle]')) {
    slot.insertBefore(fromHtml(editLogToggleHtml()), slot.querySelector('.more-buttons-nav-close'));
  }

  formEl._editLog = {
    thread, itemTypeRegex, host, layer, onClose,
    container: layer.querySelector('[data-editlog-body]'),
    texts: new Map(), detailHtml: new Map(), expanded: new Set(),
  };
  if (!formEl._editLogWired) {
    formEl._editLogWired = true;
    host.addEventListener('click', (e) => onEditLogClick(formEl, e));
  }
  renderEditLog(formEl);
}

export function setEditLogOpen(formEl, open) {
  const st = formEl._editLog;
  if (!st || st.layer.hidden === !open) return;
  const toggle = st.host.querySelector('[data-editlog-toggle]');
  st.layer.hidden = !open;
  toggle?.setAttribute('aria-expanded', String(open));
  if (open) {
    // Escape closes the drawer before the form's own Escape handler sees it.
    st.onKey = (e) => {
      if (!st.layer.isConnected) { document.removeEventListener('keydown', st.onKey, true); return; }
      if (e.key !== 'Escape' || st.layer.hidden) return;
      e.stopPropagation();
      setEditLogOpen(formEl, false);
    };
    document.addEventListener('keydown', st.onKey, true);
    st.layer.querySelector('[data-editlog-drawer]')?.focus({ preventScroll: true });
  } else {
    if (st.onKey) document.removeEventListener('keydown', st.onKey, true);
    st.onKey = null;
    toggle?.focus({ preventScroll: true });
    // A host with no navbar toggle (the Knowledge Base popup) tears itself down here.
    st.onClose?.();
  }
}

const cacheKey = (path, sha) => `${path}@${sha}`;

function bubbleEls(panel, sha) {
  for (const b of panel.querySelectorAll('[data-editlog-sha]')) {
    if (b.dataset.editlogSha === sha) {
      return { bubble: b, btn: b.querySelector('[data-editlog-expand]'), detail: b.querySelector('.mb-editlog__detail') };
    }
  }
  return null;
}

function showDetail(els, html) {
  els.detail.innerHTML = html;
  els.detail.hidden = false;
  els.btn.textContent = EDIT_LOG_COPY.collapse;
  els.btn.setAttribute('aria-expanded', 'true');
}

export function renderEditLog(formEl) {
  const st = formEl._editLog;
  if (!st) return;
  mergeRecentCommits(st.thread);
  const holder = document.createElement('div');
  holder.innerHTML = editLogPanelHtml(threadView(st.thread));
  const panel = holder.firstElementChild;
  const existing = st.container.querySelector('[data-edit-log]');
  if (existing) existing.replaceWith(panel); else st.container.appendChild(panel);
  for (const sha of st.expanded) {
    const els = bubbleEls(panel, sha);
    const html = els && st.detailHtml.get(cacheKey(els.bubble.dataset.editlogPath, sha));
    if (html != null) showDetail(els, html);
  }
}

async function expandBubble(formEl, btn) {
  const st = formEl._editLog;
  const sha = btn.dataset.editlogExpand;
  const bubble = btn.closest('[data-editlog-sha]');
  const els = { bubble, btn, detail: bubble.querySelector('.mb-editlog__detail') };
  if (!els.detail.hidden) {
    els.detail.hidden = true;
    btn.textContent = EDIT_LOG_COPY.expand;
    btn.setAttribute('aria-expanded', 'false');
    st.expanded.delete(sha);
    return;
  }
  const path = bubble.dataset.editlogPath;
  const parentSha = bubble.dataset.editlogParent;
  const key = cacheKey(path, sha);
  const cached = st.detailHtml.get(key);
  if (cached != null) { st.expanded.add(sha); showDetail(els, cached); return; }

  const commit = st.thread.commits.find(c => c.sha === sha);
  const changed = commit?.trailers?.changed ?? '';
  const body = commit?.body ?? '';
  formLoading.show();
  let html;
  try {
    const read = async (ref) => {
      const k = cacheKey(path, ref);
      if (!st.texts.has(k)) st.texts.set(k, await readRepoText(path, { ref }));
      return st.texts.get(k);
    };
    const after = await read(sha);
    const before = parentSha ? await read(parentSha) : '';
    const blocks = st.thread.itemUuid
      ? itemRedline(before, after, st.thread.itemUuid, st.itemTypeRegex)
      : sectionRedline(before, after);
    html = bubbleDetailHtml({ changed, blocks });
    if (detailCacheable(parentSha, after)) st.detailHtml.set(key, html);
    else st.texts.delete(cacheKey(path, sha)); // re-read next expand
  } catch {
    html = bubbleDetailHtml({ changed, body, error: EDIT_LOG_COPY.detailError });
  } finally {
    formLoading.dismiss();
  }
  // The panel may have re-rendered while awaiting; re-resolve the live elements.
  const panel = st.container.querySelector('[data-edit-log]');
  const live = panel && bubbleEls(panel, sha);
  if (!live) return;
  st.expanded.add(sha);
  showDetail(live, html);
}

async function onEditLogClick(formEl, e) {
  const st = formEl._editLog;
  if (!st || !e.target.closest) return;
  if (e.target.closest('[data-editlog-toggle]')) { setEditLogOpen(formEl, st.layer.hidden); return; }
  if (e.target.closest('[data-editlog-close]')) { setEditLogOpen(formEl, false); return; }
  const panel = st.container.querySelector('[data-edit-log]');
  if (!panel || !panel.contains(e.target)) return;

  const expand = e.target.closest('[data-editlog-expand]');
  if (expand) { await expandBubble(formEl, expand); return; }

  if (e.target.closest('[data-editlog-history]')) {
    revealHistory(st.thread);
    renderEditLog(formEl);
    return;
  }
  if (e.target.closest('[data-editlog-more]')) {
    if (st.busy) return;
    st.busy = true;
    // Cleared before the fetch: the model re-sets it on failure.
    st.thread.error = false;
    formLoading.show();
    try {
      await showMore(st.thread, fetchPage);
    } catch {
      st.thread.error = true;
    } finally {
      formLoading.dismiss();
      st.busy = false;
    }
    renderEditLog(formEl);
  }
}
