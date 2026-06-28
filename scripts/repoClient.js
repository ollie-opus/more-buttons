// Single source of truth for the opus-knowledge-base repo.
// All readers go through readRepoText (no CDN, no HTTP cache).
// Writers in github.js share the same REPO config + auth header.

export const REPO = { owner: 'ollie-opus', name: 'opus-knowledge-base', branch: 'main' };

// The published Zensical site the repo builds to.
export const SITE = { baseUrl: 'https://support.opus-safety.co.uk' };

// Map a nav/draft_nav value ('pages/foo.md' | 'drafts/foo.md') to its published
// directory URL. Reads the route straight from the value — never rebuilds
// pages/<slug> — so a rename/move in zensical.toml is followed automatically.
export function publishedUrl(navValue) {
  const route = navValue.replace(/\.md$/, '').replace(/^\/+/, '');
  return `${SITE.baseUrl}/${route}/`;
}

export function contentsApiUrl(path) {
  return `https://api.github.com/repos/${REPO.owner}/${REPO.name}/contents/${path}?ref=${REPO.branch}`;
}

// Cache-busted contents-API read URL. The browser caches/coalesces these URLs by
// URL alone — it ignores `Vary: Accept` and even `cache: 'no-store'` — so a read
// issued right after a write (PUT) can be served the pre-write body, making a
// freshly-pushed component vanish until a full reload. A per-read unique query
// param gives each read its own URL, forcing a fresh hit. (github.js' writer uses
// the identical guard for its own JSON-envelope reads.)
let _readNonce = 0;
function freshContentsUrl(path) {
  return `${contentsApiUrl(path)}&_cb=${Date.now()}-${++_readNonce}`;
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
export async function readRepoText(path, { signal } = {}) {
  const auth = await authHeader();
  const res = await fetch(freshContentsUrl(path), {
    headers: { 'Authorization': auth, 'Accept': 'application/vnd.github.raw' },
    cache: 'no-store',
    signal,
  });
  if (res.status === 404) return reconcileRead(path, '').content;
  if (!res.ok) throw new Error('GitHub API error: ' + res.status);
  return reconcileRead(path, await res.text()).content;
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
  return res.blob();
}
