// Single source of truth for the opus-knowledge-base repo.
// All readers go through readRepoText (no CDN, no HTTP cache).
// Writers in github.js share the same REPO config + auth header.

export const REPO = { owner: 'ollie-opus', name: 'opus-knowledge-base', branch: 'main' };

export function contentsApiUrl(path) {
  return `https://api.github.com/repos/${REPO.owner}/${REPO.name}/contents/${path}?ref=${REPO.branch}`;
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
  const res = await fetch(contentsApiUrl(path), {
    headers: { 'Authorization': auth, 'Accept': 'application/vnd.github.raw' },
    cache: 'no-store',
    signal,
  });
  if (res.status === 404) return '';
  if (!res.ok) throw new Error('GitHub API error: ' + res.status);
  return res.text();
}

// Read a binary file via the contents API and return a Blob. Bypasses HTTP
// caches and the raw.githubusercontent.com CDN (which has ~5min stale
// windows after writes), so freshly-pushed assets read back immediately.
// Trade-off: each call costs one API request against the 5000/hr rate limit,
// so use this only where post-write freshness matters (e.g. capture preview
// after override). For browsing many images at once, prefer assetCdnUrl.
export async function readRepoBlob(path, { signal } = {}) {
  const auth = await authHeader();
  const res = await fetch(contentsApiUrl(path), {
    headers: { 'Authorization': auth, 'Accept': 'application/vnd.github.raw' },
    cache: 'no-store',
    signal,
  });
  if (!res.ok) throw new Error('GitHub API error: ' + res.status);
  return res.blob();
}
