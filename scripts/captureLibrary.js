import { createForm } from './form.js';
import { REPO, authHeader } from './repoClient.js';
import { renderTree, applySearch } from './kbTree.js';
import { getFormAction, registerFormAction } from './formActions.js';

const CAPTURE_ROOT = 'docs/assets/occ-captures';

// Fetch the full repo tree in one call, then keep only entries under CAPTURE_ROOT.
async function listCaptureTree() {
  const auth = await authHeader();
  const url = `https://api.github.com/repos/${REPO.owner}/${REPO.name}/git/trees/${REPO.branch}?recursive=1`;
  const res = await fetch(url, {
    headers: { 'Authorization': auth },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const data = await res.json();
  return (data.tree ?? []).filter(e => e.type === 'blob' && e.path.startsWith(CAPTURE_ROOT + '/'));
}

// Build hierarchical nodes from a flat list of blob paths.
// Light/dark PNG pairs are collapsed to one leaf per base name.
function buildNodes(blobs) {
  // root = { folders: Map<name, root>, files: Map<baseId, { light, dark }> }
  const makeDir = () => ({ folders: new Map(), pairs: new Map() });
  const root = makeDir();

  for (const blob of blobs) {
    const relative = blob.path.slice(CAPTURE_ROOT.length + 1); // strip "docs/assets/occ-captures/"
    const parts = relative.split('/');
    const fileName = parts.pop();
    let cursor = root;
    for (const part of parts) {
      if (!cursor.folders.has(part)) cursor.folders.set(part, makeDir());
      cursor = cursor.folders.get(part);
    }

    let baseId = null;
    let variant = null;
    if (fileName.endsWith('-light-mode.png')) {
      baseId = fileName.replace(/-light-mode\.png$/, '');
      variant = 'light';
    } else if (fileName.endsWith('-dark-mode.png')) {
      baseId = fileName.replace(/-dark-mode\.png$/, '');
      variant = 'dark';
    } else {
      // Non-pair file — show as standalone leaf, no override target.
      baseId = fileName;
      variant = 'other';
    }
    if (!cursor.pairs.has(baseId)) cursor.pairs.set(baseId, { dirPath: parts.join('/'), baseId });
    const pair = cursor.pairs.get(baseId);
    if (variant === 'light') pair.light = blob.path;
    else if (variant === 'dark') pair.dark = blob.path;
    else pair.other = blob.path;
  }

  function dirToNodes(dir) {
    const out = [];
    // folders first, alphabetical
    [...dir.folders.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([name, sub]) => {
      out.push({ kind: 'folder', label: name, children: dirToNodes(sub) });
    });
    // then files
    [...dir.pairs.values()].sort((a, b) => a.baseId.localeCompare(b.baseId)).forEach(pair => {
      // Need at least a light file to enable override; entries with only dark
      // are still listed but disabled (rare edge case).
      const attrs = {
        'data-capture-base': pair.baseId,
        'data-capture-light': pair.light ?? '',
        'data-capture-dark': pair.dark ?? '',
      };
      out.push({ kind: 'file', label: pair.baseId, attrs });
    });
    return out;
  }

  return dirToNodes(root);
}

export async function openCaptureLibrary() {
  const { formEl } = await createForm('captureLibrary', openCaptureLibrary);
  if (!formEl) return;

  const panel = formEl.querySelector('[data-capture-library-panel]');
  if (!panel) return;
  panel.innerHTML = '<p class="more-buttons-description">Loading…</p>';

  let blobs;
  try {
    blobs = await listCaptureTree();
  } catch (e) {
    panel.innerHTML = `<p class="more-buttons-description">Failed to load captures: ${e.message}</p>`;
    return;
  }

  const nodes = buildNodes(blobs);
  panel.innerHTML = renderTree(nodes, { emptyMessage: 'No captures found.' });

  formEl.addEventListener('input', e => {
    const searchEl = e.target.closest('.mb-kb-search');
    if (!searchEl) return;
    const tree = panel.querySelector('.mb-kb-tree');
    if (tree) applySearch(tree, searchEl.value);
  });

  formEl.addEventListener('click', e => {
    const sectionRow = e.target.closest('[data-kb-section]');
    if (sectionRow) {
      sectionRow.closest('.mb-kb-node')?.classList.toggle('--collapsed');
      return;
    }
    const fileEl = e.target.closest('[data-kb-leaf]');
    if (!fileEl) return;
    const lightPath = fileEl.dataset.captureLight;
    const darkPath = fileEl.dataset.captureDark;
    const label = fileEl.dataset.captureBase;
    if (!lightPath) return; // no light file to preview/override
    getFormAction('openCaptureEntry')?.({ lightPath, darkPath, label });
  });
}

registerFormAction('openCaptureLibrary', openCaptureLibrary);
