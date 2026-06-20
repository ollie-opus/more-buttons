import { createForm, snapshotFormStack } from './form.js';
import { enterCaptureMode } from './captureMode.js';
import { REPO, authHeader } from './repoClient.js';
import { renderTree, applySearch } from './kbTree.js';
import { buildMediaNodes } from './mediaTree.js';
import { getFormAction, registerFormAction } from './formActions.js';
import { MANIFEST_PATH, readCaptureMeta, captureMetaPills } from './captureMeta.js';
import { formLoading } from './loading.js';

const CAPTURE_ROOT = 'docs/assets/media/occ-captures';
const VIDEO_ROOT = 'docs/assets/media/videos';
const MEDIA = {
  image: { root: CAPTURE_ROOT, exts: ['png'], empty: 'No captures found.', title: 'Capture Library' },
  video: { root: VIDEO_ROOT, exts: ['mp4', 'webm', 'mov', 'm4v'], empty: 'No videos found.', title: 'Video Library' },
};

async function listMediaTree(root) {
  const auth = await authHeader();
  const url = `https://api.github.com/repos/${REPO.owner}/${REPO.name}/git/trees/${REPO.branch}?recursive=1`;
  const res = await fetch(url, { headers: { 'Authorization': auth }, cache: 'no-store' });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const data = await res.json();
  return (data.tree ?? [])
    .filter(e => e.type === 'blob' && e.path.startsWith(root + '/') && e.path !== MANIFEST_PATH)
    .map(e => e.path);
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

export async function openCaptureLibrary({ mode, media = 'image' } = {}) {
  const insertMode = mode === 'insert';
  const opener = () => openCaptureLibrary({ mode, media });
  const { formEl } = await createForm('captureLibrary', opener);
  if (!formEl) return;

  const contentEl = formEl.parentElement ?? formEl;
  // "Create new capture" is image-only and routes away from this form, so hide
  // it in insert mode (and whenever the Videos tab is active — no create path).
  const createBtn = contentEl.querySelector('[data-action="startLibraryCapture"]');
  const panel = formEl.querySelector('[data-capture-library-panel]');
  const titleEl = formEl.querySelector('[data-media-library-title]');
  if (!panel) return;

  let current = media;

  function syncChrome() {
    formEl.querySelectorAll('[data-media-tab]').forEach(b =>
      b.classList.toggle('--active', b.dataset.mediaTab === current));
    if (titleEl) titleEl.textContent = MEDIA[current].title;
    // Hide the image-only "Create new capture" action in insert mode or on Videos.
    createBtn?.style.setProperty('display', (insertMode || current === 'video') ? 'none' : '');
  }

  async function renderMedia() {
    const cfg = MEDIA[current];
    syncChrome();
    formLoading.show();
    let paths;
    try {
      paths = await listMediaTree(cfg.root);
    } catch (e) {
      panel.innerHTML = `<p class="more-buttons-description">Failed to load ${current}s: ${e.message}</p>`;
      return;
    } finally {
      formLoading.dismiss();
    }
    const nodes = buildMediaNodes(paths, { root: cfg.root, exts: cfg.exts });
    panel.innerHTML = renderTree(nodes, { emptyMessage: cfg.empty });
    if (current === 'image') decorateCapturePills(panel, await readCaptureMeta());
  }

  formEl.addEventListener('input', e => {
    const searchEl = e.target.closest('.mb-kb-search');
    if (!searchEl) return;
    const tree = panel.querySelector('.mb-kb-tree');
    if (tree) applySearch(tree, searchEl.value);
  });

  formEl.addEventListener('click', e => {
    const tab = e.target.closest('[data-media-tab]');
    if (tab) {
      if (tab.dataset.mediaTab !== current) { current = tab.dataset.mediaTab; renderMedia(); }
      return;
    }
    const sectionRow = e.target.closest('[data-kb-section]');
    if (sectionRow) {
      sectionRow.closest('.mb-kb-node')?.classList.toggle('--collapsed');
      return;
    }
    const fileEl = e.target.closest('[data-kb-leaf]');
    if (!fileEl) return;
    if (current === 'video') {
      const lightPath = fileEl.dataset.mediaLight;
      const darkPath = fileEl.dataset.mediaDark;
      const singlePath = fileEl.dataset.mediaSingle;
      const label = fileEl.dataset.mediaBase;
      getFormAction('openVideoEntry')?.({ lightPath, darkPath, singlePath, label, mode });
    } else {
      const lightPath = fileEl.dataset.mediaLight;
      if (!lightPath) return;
      getFormAction('openCaptureEntry')?.({ lightPath, darkPath: fileEl.dataset.mediaDark, label: fileEl.dataset.mediaBase, mode });
    }
  });

  await renderMedia();
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
