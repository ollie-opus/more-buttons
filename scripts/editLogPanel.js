// Edit log panel: prefetches a thread, mounts the panel into a form, re-renders
// it and owns its clicks (expand -> redline, Show history, Show more). Every real
// fetch runs under the formLoading veil; cached expands and collapses never do.
// Module scope is DOM/chrome-free (import-safe in Node).
import { createThread, openThread, revealHistory, showMore, threadView } from './editLog.js';
import { editLogPanelHtml, bubbleDetailHtml, EDIT_LOG_COPY } from './editLogView.js';
import { sectionRedline, itemRedline } from './textDiff.js';
import { listCommits, recentCommits, readRepoText, currentGithubLogin } from './repoClient.js';
import { formLoading } from './loading.js';

/** Adapts listCommits(path, { page }) to the model's fetchPage(path, page). */
export const makeFetchPage = (list) => (path, page) => list(path, { page });
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

export function mountEditLog(formEl, thread, { container, itemTypeRegex = null }) {
  formEl._editLog = {
    thread, container, itemTypeRegex,
    texts: new Map(), detailHtml: new Map(), expanded: new Set(),
  };
  if (!formEl._editLogWired) {
    formEl._editLogWired = true;
    formEl.parentElement.addEventListener('click', (e) => onEditLogClick(formEl, e));
  }
  renderEditLog(formEl);
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
    st.detailHtml.set(key, html);
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
