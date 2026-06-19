import { ensureAdmonitionUUIDs, GUIDE_ADMONITION_TYPES_RE } from './admonitions.js';
import { ensureSectionUUIDs } from './sections.js';
import { ensureCaptureUUIDs } from './components.js';
import { ensureTabUUIDs } from './contentTabs.js';
import { ensureDataTableUUIDs } from './dataTables.js';
import { ensureGridUUIDs } from './grid.js';
import { contentsApiUrl, authHeader } from './repoClient.js';

let _opQueue = Promise.resolve();

// Cache-busted read URL. repoClient.js fetches these same contents-API URLs with
// `Accept: application/vnd.github.raw`; the browser caches/coalesces by URL alone
// (ignoring `Vary: Accept` and even `cache: 'no-store'`), so a JSON-envelope GET
// here can be served that raw variant — making `.json()` choke on raw markdown.
// A per-read unique query param gives each read its own URL, forcing a fresh hit.
let _readNonce = 0;
function contentsReadUrl(path) {
  return `${contentsApiUrl(path)}&_cb=${Date.now()}-${++_readNonce}`;
}

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

// True for guide pages/drafts (which carry sections + component admonitions +
// captures), but NOT the system-updates/status files that share those dirs and
// have their own block grammar. Anything outside docs/pages|docs/drafts (toml,
// nav, etc.) is never touched.
function isGuideMarkdown(filePath) {
  if (!filePath.endsWith('.md')) return false;
  if (!(filePath.startsWith('docs/pages/') || filePath.startsWith('docs/drafts/'))) return false;
  const base = filePath.split('/').pop();
  return base !== 'system-updates.md' && base !== 'system-status.md';
}

// Backfill missing component-identity UUIDs (sections / admonitions / captures)
// for any file that carries components, BEFORE the caller's build runs — so every
// save and merge sees stable UUIDs and self-heals. This is the single place that
// guarantees identity; previously only admonitions were migrated here (and only
// for system files), while captures/sections were migrated once at guide-draft
// creation. That left pre-existing drafts and all system-update captures UUID-less,
// which silently no-oped every UUID-keyed component op (reorder, edit, delete,
// merge). Idempotent; a no-op (returns the input) for non-component files.
//
// Exported for unit testing the dispatch — callers use githubFetchAndPushFile /
// fetchFileMigratingIdentity, which apply it automatically.
export function migrateComponentIdentity(filePath, markdown) {
  // ensureTabUUIDs + ensureGridUUIDs must run BEFORE ensureDataTableUUIDs and
  // ensureCaptureUUIDs: a table/capture span injected as a tab's or grid cell's
  // first body line would be misread as that container's own identity.
  const blockRegex = Object.entries(ADMONITION_TYPE_BY_FILE).find(([k]) => filePath.includes(k))?.[1];
  if (blockRegex) {
    // System updates / status: their top-level block admonitions, plus (for
    // updates, which embed components) tab groups + captures inside update bodies.
    const withAdm = ensureAdmonitionUUIDs(markdown, blockRegex);
    return filePath.includes('system-updates.md') ? ensureCaptureUUIDs(ensureDataTableUUIDs(ensureGridUUIDs(ensureTabUUIDs(withAdm)))) : withAdm;
  }
  if (isGuideMarkdown(filePath)) {
    // Mirror createGuideDraft: sections + component admonitions + tabs + tables + captures.
    return ensureCaptureUUIDs(ensureDataTableUUIDs(ensureGridUUIDs(ensureTabUUIDs(
      ensureAdmonitionUUIDs(ensureSectionUUIDs(markdown), GUIDE_ADMONITION_TYPES_RE),
    ))));
  }
  return markdown;
}

export function githubFetchAndPushFile(filePath, onProgress, buildUpdatedMarkdown) {
  return _enqueue(() => _githubFetchAndPushFile(filePath, onProgress, buildUpdatedMarkdown));
}

// Read a component-bearing file, backfilling + persisting any missing identity
// UUIDs once (idempotent: a fully-migrated file reads through with no write), and
// return the up-to-date markdown. Used by the editor-open paths so existing
// content with UUID-less captures becomes reorderable/editable immediately,
// without waiting for an unrelated save to trigger the migration.
export function fetchFileMigratingIdentity(filePath, onProgress) {
  return githubFetchAndPushFile(filePath, onProgress, md => md);
}

async function _githubFetchAndPushFile(filePath, onProgress, buildUpdatedMarkdown, retries = 1) {
  const auth = await authHeader();

  onProgress?.('Fetching current file...');
  // We read `.sha` + base64 `.content` below, so we need the JSON envelope:
  // request it explicitly AND via a cache-busted URL (see contentsReadUrl).
  const fileRes = await fetch(contentsReadUrl(filePath), {
    headers: { 'Authorization': auth, 'Accept': 'application/vnd.github+json' },
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

  const migratedMarkdown = migrateComponentIdentity(filePath, currentMarkdown);

  const updatedMarkdown = buildUpdatedMarkdown(migratedMarkdown);

  // Nothing actually changed (e.g. the user resolved every conflict as "keep
  // theirs") — skip the PUT so we don't write an empty commit to GitHub.
  if (updatedMarkdown === currentMarkdown) {
    onProgress?.('No changes to save.');
    return updatedMarkdown;
  }

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
  const fileRes = await fetch(contentsReadUrl(filePath), {
    headers: { 'Authorization': auth, 'Accept': 'application/vnd.github+json' },
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
  const fileRes = await fetch(contentsReadUrl(imagePath), {
    headers: { 'Authorization': auth, 'Accept': 'application/vnd.github+json' },
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

// Lightweight existence probe — true if the path is present in the repo, false
// on 404. Used to warn before a create flow that would otherwise silently skip
// an existing file. Read-only, so no need to serialise through _opQueue.
export async function githubPathExists(imagePath) {
  const auth = await authHeader();
  const res = await fetch(contentsReadUrl(imagePath), {
    headers: { 'Authorization': auth, 'Accept': 'application/vnd.github+json' },
    cache: 'no-store',
  });
  if (res.ok) return true;
  if (res.status === 404) return false;
  throw new Error(`GitHub API error: ${res.status}`);
}

// base64Data — raw Base64 string (no data-URI prefix; strip with dataUrl.split(',')[1])
// Returns true if the file was created, false if it already existed (skipped).
export async function githubPushImageIfNotExists(imagePath, base64Data, onProgress) {
  const auth = await authHeader();

  const checkRes = await fetch(contentsReadUrl(imagePath), {
    headers: { 'Authorization': auth, 'Accept': 'application/vnd.github+json' },
    cache: 'no-store',
  });
  if (checkRes.ok) return false; // already exists — skip
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
  return true;
}
