import { createForm, snapshotFormStack } from './form.js';
import { enterCaptureMode } from './captureMode.js';
import { REPO, authHeader } from './repoClient.js';
import { renderTree, applySearch } from './kbTree.js';
import { buildMediaNodes } from './mediaTree.js';
import { getFormAction, registerFormAction } from './formActions.js';
import { MANIFEST_PATH, readCaptureMeta, captureMetaPills } from './captureMeta.js';
import { formLoading } from './loading.js';

const CAPTURE_ROOT = 'docs/assets/media/occ-captures';

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
  return (data.tree ?? []).filter(e =>
    e.type === 'blob' && e.path.startsWith(CAPTURE_ROOT + '/') && e.path !== MANIFEST_PATH);
}


// Append RESIZED / PADDED pills to each capture leaf from the manifest. Mirrors
// decorateKbPills in knowledgeBaseManagement.js. Keyed by the leaf's light path.
function decorateCapturePills(panel, meta) {
  panel.querySelectorAll('[data-kb-leaf]').forEach(leaf => {
    const lightPath = leaf.dataset.mediaLight;
    if (!lightPath) return;
    const html = captureMetaPills(meta[lightPath]);
    if (html) leaf.insertAdjacentHTML('beforeend', html);
  });
}

export async function openCaptureLibrary({ mode } = {}) {
  const insertMode = mode === 'insert';
  const opener = () => openCaptureLibrary({ mode });
  const { formEl } = await createForm('captureLibrary', opener);
  if (!formEl) return;

  // In insert mode the footer "Add a new capture" routes to the standalone
  // save-to-library flow (which returns to the library, not to the form we
  // came from), so hide it. form.js moves form-actions onto the parent wrapper.
  if (insertMode) {
    (formEl.parentElement ?? formEl)
      .querySelector('[data-action="startLibraryCapture"]')
      ?.style.setProperty('display', 'none');
  }

  const panel = formEl.querySelector('[data-capture-library-panel]');
  if (!panel) return;

  formLoading.show();
  let blobs;
  try {
    blobs = await listCaptureTree();
  } catch (e) {
    panel.innerHTML = `<p class="more-buttons-description">Failed to load captures: ${e.message}</p>`;
    return;
  } finally {
    formLoading.dismiss();
  }

  const nodes = buildMediaNodes(blobs.map(b => b.path), { root: CAPTURE_ROOT, exts: ['png'] });
  panel.innerHTML = renderTree(nodes, { emptyMessage: 'No captures found.' });

  const captureMeta = await readCaptureMeta();
  decorateCapturePills(panel, captureMeta);

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
    const lightPath = fileEl.dataset.mediaLight;
    const darkPath = fileEl.dataset.mediaDark;
    const label = fileEl.dataset.mediaBase;
    if (!lightPath) return; // image library: a leaf with no light file isn't selectable
    getFormAction('openCaptureEntry')?.({ lightPath, darkPath, label, mode });
  });
}

registerFormAction('openCaptureLibrary', openCaptureLibrary);

// "Add a new capture": one-shot Capture Mode → new-capture preview → Save to Library.
registerFormAction('startLibraryCapture', ({ overlay }) => {
  const formStackSnapshot = snapshotFormStack();
  overlay.style.display = 'none';
  const prevBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = '';

  enterCaptureMode({
    maxCaptures: 1,
    formStackSnapshot,
    returnTo: {
      onComplete: (buffer) => {
        if (!buffer.length) {
          // User exited capture mode without a shot — restore the library.
          if (overlay.isConnected) {
            overlay.style.display = '';
            document.body.style.overflow = prevBodyOverflow;
          }
          return;
        }
        // Hand the single capture to the preview page. createForm there tears
        // down this (hidden) library overlay and pushes a new history entry.
        getFormAction('openCaptureNew')?.({ capture: buffer[0] });
      },
    },
  });
});
