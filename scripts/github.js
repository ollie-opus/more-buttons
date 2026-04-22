import { ensureAdmonitionUUIDs } from './admonitions.js';

let _opQueue = Promise.resolve();

const ADMONITION_TYPE_BY_FILE = {
  'system-updates.md': /feature-release|new-addition|improvement/,
  'system-status.md':  /status-available|status-disruption|status-outage/,
};

export function githubFetchAndPushFile(filePath, onProgress, buildUpdatedMarkdown) {
  _opQueue = _opQueue.then(() => _githubFetchAndPushFile(filePath, onProgress, buildUpdatedMarkdown));
  return _opQueue;
}

async function _githubFetchAndPushFile(filePath, onProgress, buildUpdatedMarkdown, retries = 1) {
  const REPO = 'ollie-opus/opus-knowledge-base';
  const { moreButtonsIntegrations } = await chrome.storage.local.get('moreButtonsIntegrations');
  const token = moreButtonsIntegrations?.githubPAT;
  if (!token) throw new Error('No GitHub PAT configured');

  onProgress?.('Fetching current file...');
  const fileRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${filePath}`, {
    headers: { 'Authorization': `token ${token}` }
  });
  if (!fileRes.ok) throw new Error(`GitHub API error: ${fileRes.status}`);
  const fileData = await fileRes.json();
  const currentMarkdown = decodeURIComponent(escape(atob(fileData.content.replace(/\n/g, ''))));

  const typeRegex = Object.entries(ADMONITION_TYPE_BY_FILE).find(([k]) => filePath.includes(k))?.[1];
  const migratedMarkdown = typeRegex ? ensureAdmonitionUUIDs(currentMarkdown, typeRegex) : currentMarkdown;

  const updatedMarkdown = buildUpdatedMarkdown(migratedMarkdown);

  onProgress?.('Pushing to GitHub...');
  const label = filePath.includes('system-updates') ? 'system updates' : 'system status';
  const putRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${filePath}`, {
    method: 'PUT',
    headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Update ${label}\n\nPublished via More Buttons Chrome Extension`,
      content: btoa(unescape(encodeURIComponent(updatedMarkdown))),
      sha: fileData.sha
    })
  });
  if (putRes.status === 409 && retries > 0) {
    return _githubFetchAndPushFile(filePath, onProgress, buildUpdatedMarkdown, 0);
  }
  if (!putRes.ok) {
    const err = await putRes.json();
    throw new Error(err.message || `GitHub API error: ${putRes.status}`);
  }
  return updatedMarkdown;
}

export async function githubFetchAndPush(onProgress, buildUpdatedMarkdown) {
  return githubFetchAndPushFile('docs/pages/system-status.md', onProgress, buildUpdatedMarkdown);
}

// base64Data — raw Base64 string (no data-URI prefix; strip with dataUrl.split(',')[1])
export async function githubPushImageIfNotExists(imagePath, base64Data, onProgress) {
  const REPO = 'ollie-opus/opus-knowledge-base';
  const { moreButtonsIntegrations } = await chrome.storage.local.get('moreButtonsIntegrations');
  const token = moreButtonsIntegrations?.githubPAT;
  if (!token) throw new Error('No GitHub PAT configured');

  const checkRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${imagePath}`, {
    headers: { 'Authorization': `token ${token}` }
  });
  if (checkRes.ok) return; // already exists — skip
  if (checkRes.status !== 404) throw new Error(`GitHub API error: ${checkRes.status}`);

  onProgress?.(`Uploading ${imagePath.split('/').pop()}...`);
  const putRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${imagePath}`, {
    method: 'PUT',
    headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Add capture\n\nPublished via More Buttons Chrome Extension',
      content: base64Data
    })
  });
  if (!putRes.ok) {
    const err = await putRes.json();
    throw new Error(err.message || `GitHub API error: ${putRes.status}`);
  }
}

// Fetches markdown via the GitHub API (bypasses CDN cache) when the URL is a
// raw.githubusercontent.com URL and a PAT is configured. Falls back to a plain fetch.
export async function fetchGitHubMarkdown(rawUrl) {
  const m = rawUrl.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
  if (m) {
    const [, owner, repo, branch, path] = m;
    const { moreButtonsIntegrations } = await chrome.storage.local.get('moreButtonsIntegrations');
    const token = moreButtonsIntegrations?.githubPAT;
    if (token) {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
        { headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.raw' } }
      );
      if (res.ok) return res.text();
    }
  }
  const res = await fetch(rawUrl, { cache: 'no-store' });
  if (!res.ok) throw new Error(res.status);
  return res.text();
}
