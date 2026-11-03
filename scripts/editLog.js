// Edit log thread model: merges commits for one or two paths (plus the write memo),
// dedupes, filters by item, collapses rule-lines, slices a draft session and pages
// behind a frontier. Pure leaf module: no browser APIs, no fetching (the page fetcher
// is injected).

import { classifySubject, RULE_LABELS, SESSION_START_RULES } from './editLogGrammar.js';

export const PAGE_SIZE = 30;
// Item-filtered threads page GitHub 100 commits at a time (pre-feature commits carry
// no Item: trailer, so most of a page can be filtered out); guide threads keep 30.
export const ITEM_PER_PAGE = 100;
export const RULE_COLLAPSE_MS = 120000;

export function createThread({
  paths, itemUuid = null, session = false,
  perPage = itemUuid ? ITEM_PER_PAGE : PAGE_SIZE,
  maxPagesPerClick = itemUuid ? 2 : 1,
}) {
  const byPath = {};
  for (const p of paths) byPath[p] = { page: 0, exhausted: false, oldest: Infinity };
  return {
    paths: byPath, commits: [], itemUuid, session, perPage, maxPagesPerClick,
    shown: 0, historyHidden: false, error: false, login: null,
  };
}

/** Merge commits in: item filter, dedupe by sha (first wins), newest first. Returns matches added. */
export function addCommits(thread, commits) {
  const seen = new Set(thread.commits.map(c => c.sha));
  let added = 0;
  for (const c of commits) {
    if (thread.itemUuid && c.trailers?.item !== thread.itemUuid) continue;
    if (seen.has(c.sha)) continue;
    seen.add(c.sha);
    thread.commits.push(c);
    added++;
  }
  thread.commits.sort((a, b) => b.date - a.date);
  return added;
}

export function allExhausted(thread) {
  return Object.values(thread.paths).every(p => p.exhausted);
}

/** Oldest date safely renderable: the newest `oldest` among paths still holding unfetched history. */
export function frontier(thread) {
  let f = -Infinity;
  for (const p of Object.values(thread.paths)) if (!p.exhausted) f = Math.max(f, p.oldest);
  return f;
}

export function renderableCommits(thread) {
  const f = frontier(thread);
  return thread.commits.filter(c => c.date >= f);
}

// Rounds: each round fetches the next page of EVERY non-exhausted path (under its
// per-click cap) in parallel, then re-checks the frontier once all pages have landed.
export async function fetchUntil(thread, fetchPage, wanted) {
  const taken = {};
  while (renderableCommits(thread).length < wanted) {
    const round = Object.entries(thread.paths)
      .filter(([path, p]) => !p.exhausted && (taken[path] ?? 0) < thread.maxPagesPerClick)
      .map(([path]) => path);
    if (!round.length) return;
    let pages;
    try {
      pages = await Promise.all(round.map(path => fetchPage(path, thread.paths[path].page + 1, thread.perPage)));
    } catch {
      thread.error = true;
      return;
    }
    round.forEach((path, i) => {
      const state = thread.paths[path];
      const page = pages[i];
      taken[path] = (taken[path] ?? 0) + 1;
      state.page += 1;
      addCommits(thread, page);
      state.oldest = page.reduce((m, c) => Math.min(m, c.date), state.oldest);
      if (page.length < thread.perPage) state.exhausted = true;
    });
  }
}

/** Display name for a commit's author: login, else the thread login for own writes, else git name. */
const authorOf = (c, login) => c.login ?? (c.own ? login : null) ?? c.name;

export function classifyCommit(c, { login }) {
  const k = classifySubject(c.subject);
  if (k.kind === 'rule') {
    return { type: 'rule', rule: k.rule, label: RULE_LABELS[k.rule], by: authorOf(c, login), sha: c.sha, date: c.date };
  }
  return {
    type: 'bubble', sha: c.sha, path: c.path, parentSha: c.parentSha,
    text: k.text, muted: k.muted,
    mine: !!c.own || (!!login && c.login === login),
    nametag: authorOf(c, login),
    date: c.date,
    changed: c.trailers?.changed ?? '',
    body: c.body,
  };
}

export function collapseRules(items, windowMs = RULE_COLLAPSE_MS) {
  const out = [];
  let last = null; // last kept rule of the current consecutive run
  for (const it of items) {
    if (it.type === 'rule' && last && last.rule === it.rule && last.by === it.by && Math.abs(last.date - it.date) < windowMs) continue;
    out.push(it);
    last = it.type === 'rule' ? it : null;
  }
  return out;
}

export function logicalItems(thread) {
  return collapseRules(renderableCommits(thread).map(c => classifyCommit(c, { login: thread.login })));
}

const defaultFormatDay = d => new Date(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

export function addDayDividers(items, { now, formatDay = defaultFormatDay }) {
  const dayKey = d => { const x = new Date(d); return x.getFullYear() * 10000 + x.getMonth() * 100 + x.getDate(); };
  const today = dayKey(now);
  const yest = dayKey(new Date(now).setDate(new Date(now).getDate() - 1));
  const out = [];
  let prev = null;
  for (const it of items) {
    const k = dayKey(it.date);
    if (k !== prev) {
      out.push({ type: 'day', label: k === today ? 'Today' : k === yest ? 'Yesterday' : formatDay(it.date) });
      prev = k;
    }
    out.push(it);
  }
  return out;
}

export async function openThread(thread, { fetchPage, recent = [] }) {
  addCommits(thread, recent);
  await fetchUntil(thread, fetchPage, PAGE_SIZE);
  const items = logicalItems(thread);
  if (thread.session) {
    const i = items.findIndex(it => it.type === 'rule' && SESSION_START_RULES.has(it.rule));
    if (i >= 0) { thread.shown = i + 1; thread.historyHidden = true; return; }
    // No session start loaded (pre-feature draft): show everything loaded.
    thread.shown = items.length;
    thread.historyHidden = false;
    return;
  }
  thread.shown = Math.min(PAGE_SIZE, items.length);
}

/** Re-project a session-opened thread as a live page: newest PAGE_SIZE, history not hidden. */
export function endSession(thread) {
  thread.session = false;
  thread.historyHidden = false;
  thread.shown = Math.min(PAGE_SIZE, logicalItems(thread).length);
}

export function revealHistory(thread) {
  thread.historyHidden = false;
  thread.shown = logicalItems(thread).length;
}

export async function showMore(thread, fetchPage) {
  await fetchUntil(thread, fetchPage, thread.shown + PAGE_SIZE);
  thread.shown = Math.min(thread.shown + PAGE_SIZE, logicalItems(thread).length);
}

export function threadView(thread, { now = Date.now(), formatDay } = {}) {
  const all = logicalItems(thread);
  const more = all.length > thread.shown || !allExhausted(thread);
  return {
    items: addDayDividers(all.slice(0, thread.shown), { now, formatDay }),
    showHistory: thread.historyHidden && more,
    showMore: !thread.historyHidden && more,
    error: thread.error,
    empty: all.length === 0 && allExhausted(thread) && !thread.error,
  };
}
