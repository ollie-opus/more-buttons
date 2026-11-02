// Single source of truth for the opus-knowledge-base repo.
// All readers go through readRepoText (no CDN, no HTTP cache).
// Writers in github.js share the same REPO config + auth header.

import { parseCommitMessage } from './editLogGrammar.js';

export const REPO = { owner: 'opus-safety', name: 'opus-knowledge-base', branch: 'main' };

// The published Zensical site the repo builds to.
export const SITE = { baseUrl: 'https://support.opus-safety.co.uk' };

// Map a nav/draft_nav value ('pages/foo.md' | 'drafts/foo.md') to its published
// directory URL. Reads the route straight from the value — never rebuilds
// pages/<slug> — so a rename/move in zensical.toml is followed automatically.
export function publishedUrl(navValue) {
  const route = navValue.replace(/\.md$/, '').replace(/^\/+/, '');
  return `${SITE.baseUrl}/${route}/`;
}

export function contentsApiUrl(path, ref = REPO.branch) {
  return `https://api.github.com/repos/${REPO.owner}/${REPO.name}/contents/${path}?ref=${ref}`;
}

// Cache-busted contents-API read URL. The browser caches/coalesces these URLs by
// URL alone — it ignores `Vary: Accept` and even `cache: 'no-store'` — so a read
// issued right after a write (PUT) can be served the pre-write body, making a
// freshly-pushed component vanish until a full reload. A per-read unique query
// param gives each read its own URL, forcing a fresh hit. (github.js' writer uses
// the identical guard for its own JSON-envelope reads.)
let _readNonce = 0;
function freshContentsUrl(path, ref = REPO.branch) {
  return `${contentsApiUrl(path, ref)}&_cb=${Date.now()}-${++_readNonce}`;
}

// ── Read-your-writes consistency ────────────────────────────────────────────────
//
// The contents API is eventually consistent: a GET issued immediately after a PUT
// can be served the PRE-write tree from a read replica — even cache-busted, since
// the lag is on GitHub's side, not the browser's. That makes a freshly inserted or
// deleted component briefly "vanish" from the form the editor returns to (it only
// reappears after a reload, once the replica catches up).
//
// To get read-your-writes, every writer records what it pushed (rememberWrite);
// every reader reconciles its fetched body against that memo (reconcileRead): if
// GitHub hasn't caught up yet, we serve what we last wrote instead. The memo for a
// path is dropped as soon as a fetch matches it (GitHub is consistent again) or
// the window lapses (so a genuine out-of-band change is never masked for long).
const _writeMemo = new Map(); // path -> { content, sha, at }
const MEMO_WINDOW_MS = 20000;

/** Record the content (and contents-API sha) a writer just pushed for `path`. */
export function rememberWrite(path, content, sha = undefined) {
  _writeMemo.set(path, { content, sha, at: Date.now() });
}

/** Drop any remembered write for `path` (e.g. after the file is deleted). */
export function forgetWrite(path) {
  _writeMemo.delete(path);
}

/**
 * Reconcile a freshly-fetched body against the last write we recorded for `path`.
 * Returns `{ content, sha }` — the caller's fresh values when GitHub is up to date
 * (or no memo / window lapsed), otherwise the remembered content + sha (so writers
 * also build on, and PUT against, the right base). Self-clearing on agreement.
 */
export function reconcileRead(path, freshContent, freshSha = undefined) {
  const memo = _writeMemo.get(path);
  if (!memo) return { content: freshContent, sha: freshSha };
  if (freshContent === memo.content || Date.now() - memo.at >= MEMO_WINDOW_MS) {
    _writeMemo.delete(path); // GitHub caught up, or the trust window lapsed
    return { content: freshContent, sha: freshSha };
  }
  return { content: memo.content, sha: memo.sha ?? freshSha };
}

// ── Response-commit memo ────────────────────────────────────────────────────────
//
// GitHub's list-commits endpoint lags a fresh write just as the contents API does.
// Every writer records the `commit` object the PUT/DELETE response returns, per
// path, so the edit log can show a just-made save immediately. An entry is dropped
// once a fetched history contains its sha (reconcileCommits) or after the window.
const _commitMemo = new Map(); // path -> [{ commit: NormCommit, at }] newest first
const COMMIT_MEMO_MS = 600000;

/** Normalise a contents-API PUT/DELETE response `commit` object into a NormCommit. */
export function normalizeWriteCommit(raw, path) {
  const { subject, body, trailers } = parseCommitMessage(raw.message);
  return {
    sha: raw.sha,
    parentSha: raw.parents?.[0]?.sha ?? null,
    path,
    subject,
    body,
    trailers,
    date: Date.parse(raw.author?.date),
    login: null,
    name: raw.author?.name ?? '',
    own: true,
  };
}

/** Record the commit a writer's response returned for `path` (falsy `raw` ignored). */
export function rememberCommit(path, raw) {
  if (!raw) return;
  const list = _commitMemo.get(path) ?? [];
  list.unshift({ commit: normalizeWriteCommit(raw, path), at: Date.now() });
  _commitMemo.set(path, list);
}

/** Remembered commits for `path` newer than the memo window, newest first. */
export function recentCommits(path) {
  const now = Date.now();
  const live = (_commitMemo.get(path) ?? []).filter(e => now - e.at < COMMIT_MEMO_MS);
  if (live.length) _commitMemo.set(path, live); else _commitMemo.delete(path);
  return live.map(e => e.commit);
}

/** Drop memo entries whose sha now appears in the fetched history. */
export function reconcileCommits(path, fetched) {
  const list = _commitMemo.get(path);
  if (!list) return;
  const seen = new Set(fetched.map(c => c.sha));
  const rest = list.filter(e => !seen.has(e.commit.sha));
  if (rest.length) _commitMemo.set(path, rest); else _commitMemo.delete(path);
}

/** Forget every remembered commit for `path`. */
export function forgetCommits(path) {
  _commitMemo.delete(path);
}

// Use ONLY for binary assets where a few minutes of staleness is acceptable.
// For markdown / text content, always use readRepoText.
export function assetCdnUrl(path) {
  return `https://raw.githubusercontent.com/${REPO.owner}/${REPO.name}/${REPO.branch}/${path}`;
}

export async function authHeader() {
  const { moreButtonsIntegrations } = await chrome.storage.local.get('moreButtonsIntegrations');
  const token = moreButtonsIntegrations?.githubPAT;
  if (!token) throw new Error('No GitHub PAT configured');
  return `token ${token}`;
}

// Read a text file via the contents API. Bypasses HTTP caches.
// Returns '' on 404 (file does not exist yet). Throws on other errors.
// With `ref` (a commit sha) the read is of an immutable snapshot, so it skips the
// read-your-writes memo entirely (including on 404).
export async function readRepoText(path, { signal, ref } = {}) {
  const auth = await authHeader();
  const res = await fetch(ref ? freshContentsUrl(path, ref) : freshContentsUrl(path), {
    headers: { 'Authorization': auth, 'Accept': 'application/vnd.github.raw' },
    cache: 'no-store',
    signal,
  });
  if (res.status === 404) return ref ? '' : reconcileRead(path, '').content;
  if (!res.ok) throw new Error('GitHub API error: ' + res.status);
  const text = await res.text();
  return ref ? text : reconcileRead(path, text).content;
}

// List a directory's immediate entries via the contents API. Returns an array
// of file/dir names (basenames). Returns [] if the directory does not exist
// (404). Throws on other errors. One API request lists the whole folder, so
// callers can membership-test many files without a request per file.
export async function readRepoDir(path, { signal } = {}) {
  const auth = await authHeader();
  const res = await fetch(freshContentsUrl(path), {
    headers: { 'Authorization': auth, 'Accept': 'application/vnd.github+json' },
    cache: 'no-store',
    signal,
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error('GitHub API error: ' + res.status);
  const json = await res.json();
  return Array.isArray(json) ? json.map(entry => entry.name) : [];
}

// Read a binary file via the contents API and return a Blob. Bypasses HTTP
// caches and the raw.githubusercontent.com CDN (which has ~5min stale
// windows after writes), so freshly-pushed assets read back immediately.
// Trade-off: each call costs one API request against the 5000/hr rate limit,
// so use this only where post-write freshness matters (e.g. capture preview
// after override). For browsing many images at once, prefer assetCdnUrl.
export async function readRepoBlob(path, { signal } = {}) {
  const auth = await authHeader();
  const res = await fetch(freshContentsUrl(path), {
    headers: { 'Authorization': auth, 'Accept': 'application/vnd.github.raw' },
    cache: 'no-store',
    signal,
  });
  if (!res.ok) throw new Error('GitHub API error: ' + res.status);
  const blob = await res.blob();
  // The contents API reports its own media type, not the file's. That's fine
  // for formats <img> will sniff (PNG), but SVG is never sniffed for security
  // reasons — an object URL without image/svg+xml renders nothing. Re-type it.
  if (/\.svg$/i.test(path) && blob.type !== 'image/svg+xml') {
    return new Blob([blob], { type: 'image/svg+xml' });
  }
  return blob;
}

// readRepoBlob as a `data:<type>;base64,…` URL — the shape the capture flows
// carry in `lightDataUrl` / `darkDataUrl` and that pushCaptures splits on the
// comma. Used to duplicate an existing library pair into another folder.
export async function readRepoDataUrl(path, opts) {
  const blob = await readRepoBlob(path, opts);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read ' + path));
    reader.readAsDataURL(blob);
  });
}

// ── Commit history reads ────────────────────────────────────────────────────────

export const COMMITS_PAGE_SIZE = 30;

/** Normalise a list-commits element into a NormCommit (same shape as normalizeWriteCommit). */
export function normalizeListCommit(raw, path) {
  const { subject, body, trailers } = parseCommitMessage(raw.commit.message);
  return {
    sha: raw.sha,
    parentSha: raw.parents?.[0]?.sha ?? null,
    path,
    subject,
    body,
    trailers,
    date: Date.parse(raw.commit.author?.date),
    login: raw.author?.login ?? null,
    name: raw.commit.author?.name ?? '',
    own: false,
  };
}

/** One page of commits touching `path` on the repo branch, newest first. No history -> []. */
export async function listCommits(path, { page = 1, perPage = COMMITS_PAGE_SIZE, signal } = {}) {
  const auth = await authHeader();
  const url = `https://api.github.com/repos/${REPO.owner}/${REPO.name}/commits?sha=${REPO.branch}`
    + `&path=${encodeURIComponent(path)}&per_page=${perPage}&page=${page}&_cb=${Date.now()}-${++_readNonce}`;
  const res = await fetch(url, {
    headers: { 'Authorization': auth, 'Accept': 'application/vnd.github+json' },
    cache: 'no-store',
    signal,
  });
  if (res.status === 404 || res.status === 409) return [];
  if (!res.ok) throw new Error('GitHub API error: ' + res.status);
  const json = await res.json();
  const result = Array.isArray(json) ? json.map(raw => normalizeListCommit(raw, path)) : [];
  reconcileCommits(path, result);
  return result;
}

// The token owner's login, cached under its own key (form.js's generic save
// overwrites the whole moreButtonsIntegrations object, so it can't live there).
// The cache carries the PAT's last 8 chars, so changing the PAT invalidates it.
export const GITHUB_LOGIN_KEY = 'moreButtonsGithubLogin';

/** Login of the PAT's owner, or null on any failure (nothing cached; retried next call). */
export async function currentGithubLogin() {
  try {
    const store = await chrome.storage.local.get([GITHUB_LOGIN_KEY, 'moreButtonsIntegrations']);
    const pat = store.moreButtonsIntegrations?.githubPAT;
    if (!pat) return null;
    const tokenTail = pat.slice(-8);
    const cached = store[GITHUB_LOGIN_KEY];
    if (cached?.login && cached.tokenTail === tokenTail) return cached.login;
    const res = await fetch('https://api.github.com/user', {
      headers: { 'Authorization': `token ${pat}`, 'Accept': 'application/vnd.github+json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const login = (await res.json())?.login;
    if (!login) return null;
    await chrome.storage.local.set({ [GITHUB_LOGIN_KEY]: { login, tokenTail } });
    return login;
  } catch {
    return null;
  }
}
