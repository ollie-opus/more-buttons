import { ensureAdmonitionUUIDs } from './admonitions.js';
import { contentsApiUrl, authHeader } from './repoClient.js';

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
  const auth = await authHeader();

  onProgress?.('Fetching current file...');
  const fileRes = await fetch(contentsApiUrl(filePath), {
    headers: { 'Authorization': auth },
    cache: 'no-store',
  });
  let currentMarkdown = '';
  let currentSha;
  if (fileRes.ok) {
    const fileData = await fileRes.json();
    currentMarkdown = decodeURIComponent(escape(atob(fileData.content.replace(/\n/g, ''))));
    currentSha = fileData.sha;
  } else if (fileRes.status !== 404) {
    throw new Error(`GitHub API error: ${fileRes.status}`);
  }

  const typeRegex = Object.entries(ADMONITION_TYPE_BY_FILE).find(([k]) => filePath.includes(k))?.[1];
  const migratedMarkdown = typeRegex ? ensureAdmonitionUUIDs(currentMarkdown, typeRegex) : currentMarkdown;

  const updatedMarkdown = buildUpdatedMarkdown(migratedMarkdown);

  onProgress?.('Pushing to GitHub...');
  const label = filePath.includes('system-updates') ? 'system updates' : 'system status';
  const putBody = {
    message: `Update ${label}\n\nPublished via More Buttons Chrome Extension`,
    content: btoa(unescape(encodeURIComponent(updatedMarkdown)))
  };
  if (currentSha) putBody.sha = currentSha;
  const putRes = await fetch(contentsApiUrl(filePath), {
    method: 'PUT',
    headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(putBody)
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
  const auth = await authHeader();

  const checkRes = await fetch(contentsApiUrl(imagePath), {
    headers: { 'Authorization': auth },
    cache: 'no-store',
  });
  if (checkRes.ok) return; // already exists — skip
  if (checkRes.status !== 404) throw new Error(`GitHub API error: ${checkRes.status}`);

  onProgress?.(`Uploading ${imagePath.split('/').pop()}...`);
  const putRes = await fetch(contentsApiUrl(imagePath), {
    method: 'PUT',
    headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
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
