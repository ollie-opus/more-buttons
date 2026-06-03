import { ensureAdmonitionUUIDs } from './admonitions.js';
import { contentsApiUrl, authHeader } from './repoClient.js';

let _opQueue = Promise.resolve();

// Serialise an operation behind any in-flight ones, returning a promise that
// carries the op's real result/rejection to the caller. The queue itself is
// advanced with a swallowed copy: chaining .then() on a *rejected* _opQueue
// would skip the callback and replay that rejection for every future op, so a
// single transient failure would otherwise poison all later GitHub work for
// the rest of the session.
function _enqueue(run) {
  const result = _opQueue.then(run);
  _opQueue = result.catch(() => {});
  return result;
}

const ADMONITION_TYPE_BY_FILE = {
  'system-updates.md': /feature-release|new-addition|improvement/,
  'system-status.md':  /status-available|status-disruption|status-outage/,
};

export function githubFetchAndPushFile(filePath, onProgress, buildUpdatedMarkdown) {
  return _enqueue(() => _githubFetchAndPushFile(filePath, onProgress, buildUpdatedMarkdown));
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
  const filename = filePath.split('/').pop();
  const label = filename.replace(/\.md$/, '').replace(/-/g, ' ');
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

/**
 * Deletes a file via the contents API. No-op if the file doesn't exist (404).
 * Serialised through _opQueue alongside push operations.
 *
 * @param {string} filePath
 * @param {(s: string) => void} [onProgress]
 */
export function githubDeleteFile(filePath, onProgress) {
  return _enqueue(() => _githubDeleteFile(filePath, onProgress));
}

async function _githubDeleteFile(filePath, onProgress) {
  const auth = await authHeader();

  onProgress?.('Fetching current file...');
  const fileRes = await fetch(contentsApiUrl(filePath), {
    headers: { 'Authorization': auth },
    cache: 'no-store',
  });
  if (fileRes.status === 404) return; // already gone
  if (!fileRes.ok) throw new Error(`GitHub API error: ${fileRes.status}`);

  const fileData = await fileRes.json();
  const sha = fileData.sha;

  onProgress?.('Deleting file...');
  const filename = filePath.split('/').pop();
  const label = filename.replace(/\.md$/, '').replace(/-/g, ' ');
  const delRes = await fetch(contentsApiUrl(filePath), {
    method: 'DELETE',
    headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Delete ${label}\n\nPublished via More Buttons Chrome Extension`,
      sha,
    }),
  });
  if (!delRes.ok) {
    const err = await delRes.json();
    throw new Error(err.message || `GitHub API error: ${delRes.status}`);
  }
}

// Replaces an existing binary file in place. base64Data — raw Base64 string
// (no data-URI prefix; strip with dataUrl.split(',')[1]). Throws if the file
// doesn't already exist (use githubPushImageIfNotExists for creates).
// Serialised through _opQueue alongside other push/delete operations.
export function githubReplaceImage(imagePath, base64Data, onProgress) {
  return _enqueue(() => _githubReplaceImage(imagePath, base64Data, onProgress));
}

async function _githubReplaceImage(imagePath, base64Data, onProgress) {
  const auth = await authHeader();

  onProgress?.('Fetching current file...');
  const fileRes = await fetch(contentsApiUrl(imagePath), {
    headers: { 'Authorization': auth },
    cache: 'no-store',
  });
  if (fileRes.status === 404) throw new Error(`File not found: ${imagePath}`);
  if (!fileRes.ok) throw new Error(`GitHub API error: ${fileRes.status}`);
  const { sha } = await fileRes.json();

  onProgress?.(`Uploading ${imagePath.split('/').pop()}...`);
  const putRes = await fetch(contentsApiUrl(imagePath), {
    method: 'PUT',
    headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Replace capture\n\nPublished via More Buttons Chrome Extension',
      content: base64Data,
      sha,
    }),
  });
  if (!putRes.ok) {
    const err = await putRes.json();
    throw new Error(err.message || `GitHub API error: ${putRes.status}`);
  }
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
