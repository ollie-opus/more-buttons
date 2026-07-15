import { createForm, snapshotFormStack } from './form.js';
import { enterCaptureMode } from './captureMode.js';
import { REPO, authHeader, assetCdnUrl } from './repoClient.js';
import { renderTree, applySearch } from './kbTree.js';
import { buildMediaNodes, groupMediaPaths } from './mediaTree.js';
import { getFormAction, registerFormAction } from './formActions.js';
import { MANIFEST_PATH, readCaptureMeta, captureMetaPills } from './captureMeta.js';
import { formLoading } from './loading.js';

// The library mirrors this repo folder: every top-level subfolder becomes a
// tab, so adding a folder in the repo adds a tab here with no code change.
const MEDIA_ROOT = 'docs/assets/media';
// The one folder with extra behaviour: capture-manifest pills and the
// create/upload dock buttons (both write into this folder).
const CAPTURE_TAB_KEY = 'occ-captures';
const IMAGE_EXTS = ['png', 'svg'];
const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'm4v'];
const ACCEPT_EXTS = { image: IMAGE_EXTS, video: VIDEO_EXTS };

// Snapshot of the open library's tabs + active tab, read by the upload action
// so its destination dropdown mirrors the library (plain data — replay-safe).
let libraryContext = { folders: [], current: CAPTURE_TAB_KEY };

async function listMediaPaths() {
  const auth = await authHeader();
  const url = `https://api.github.com/repos/${REPO.owner}/${REPO.name}/git/trees/${REPO.branch}?recursive=1`;
  const res = await fetch(url, { headers: { 'Authorization': auth }, cache: 'no-store' });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const data = await res.json();
  return (data.tree ?? [])
    .filter(e => e.type === 'blob' && e.path.startsWith(MEDIA_ROOT + '/') && e.path !== MANIFEST_PATH)
    .map(e => e.path);
}


// Append RESIZED / PADDED pills (captures with manifest metadata) and the grey
// file-format pill (every leaf, videos included) to the media tree. Mirrors
// decorateKbPills in knowledgeBaseManagement.js. Meta is keyed by the leaf's
// light path; pass {} for tabs outside occ-captures, which have no manifest.
function decorateCapturePills(panel, meta) {
  panel.querySelectorAll('[data-kb-leaf]').forEach(leaf => {
    const lightPath = leaf.dataset.mediaLight;
    const html = captureMetaPills(lightPath ? meta[lightPath] : null, leaf.dataset.mediaExt);
    if (html) leaf.insertAdjacentHTML('beforeend', html);
  });
}

export async function openMediaLibrary({ mode, accept } = {}) {
  const insertMode = mode === 'insert';
  const exts = ACCEPT_EXTS[accept] ?? null; // null = browse: every file shows
  const opener = () => openMediaLibrary({ mode, accept });
  const { formEl } = await createForm('mediaLibrary', opener);
  if (!formEl) return;

  const contentEl = formEl.parentElement ?? formEl;
  // "Create new capture" / "Upload a new capture" write into occ-captures and
  // route away from this form, so hide them in insert mode and on other tabs.
  const createBtn = contentEl.querySelector('[data-action="startLibraryCapture"]');
  const uploadBtn = contentEl.querySelector('[data-action="startLibraryUpload"]');
  const tabList = formEl.querySelector('[data-media-library-tabs]');
  const panel = formEl.querySelector('[data-media-library-panel]');
  if (!panel || !tabList) return;

  // One recursive fetch per open; tab switches re-render from these nodes.
  // Tabs whose tree is empty after the accept filter are dropped entirely.
  // The capture manifest (for Resized/Padded pills) is read IN PARALLEL with
  // the tree and cached here, so the pills land with the tree under the veil
  // instead of popping in a second round-trip later — and tab switches reuse
  // it rather than re-reading it. readCaptureMeta never throws (returns {}).
  formLoading.show();
  let tabs;
  let captureMeta = {};
  try {
    const [paths, meta] = await Promise.all([listMediaPaths(), readCaptureMeta()]);
    captureMeta = meta;
    tabs = groupMediaPaths(paths, MEDIA_ROOT)
      .map(group => ({ ...group, nodes: buildMediaNodes(group.paths, { root: group.root, exts }) }))
      .filter(tab => tab.nodes.length);
  } catch (e) {
    panel.innerHTML = `<p class="more-buttons-description">Failed to load media: ${e.message}</p>`;
    return;
  } finally {
    formLoading.dismiss();
  }

  let current = tabs[0]?.key;
  libraryContext = { folders: tabs.map(({ key, label }) => ({ key, label })), current };

  tabList.innerHTML = tabs.map(tab =>
    `<button type="button" class="more-buttons-tab" data-media-tab="${tab.key}">${tab.label}</button>`
  ).join('');

  function syncChrome() {
    libraryContext.current = current;
    tabList.querySelectorAll('[data-media-tab]').forEach(b =>
      b.classList.toggle('--active', b.dataset.mediaTab === current));
    // Create-new-capture only writes into occ-captures; upload can target any
    // folder (its form has a destination dropdown), so it shows on every tab.
    createBtn?.style.setProperty('display', (insertMode || current !== CAPTURE_TAB_KEY) ? 'none' : '');
    uploadBtn?.style.setProperty('display', insertMode ? 'none' : '');
  }

  function renderPanel() {
    syncChrome();
    const tab = tabs.find(t => t.key === current);
    panel.innerHTML = renderTree(tab?.nodes ?? [], { emptyMessage: 'No media found.' });
    if (!tab) return;
    decorateCapturePills(panel, current === CAPTURE_TAB_KEY ? captureMeta : {});
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
      if (tab.dataset.mediaTab !== current) { current = tab.dataset.mediaTab; renderPanel(); }
      return;
    }
    const sectionRow = e.target.closest('[data-kb-section]');
    if (sectionRow) {
      sectionRow.closest('.mb-kb-node')?.classList.toggle('--collapsed');
      return;
    }
    const fileEl = e.target.closest('[data-kb-leaf]');
    if (!fileEl) return;
    // Route by the FILE's format, not the active tab — a folder may mix kinds.
    const ext = fileEl.dataset.mediaExt;
    const lightPath = fileEl.dataset.mediaLight;
    const darkPath = fileEl.dataset.mediaDark;
    const singlePath = fileEl.dataset.mediaSingle;
    const label = fileEl.dataset.mediaBase;
    if (VIDEO_EXTS.includes(ext)) {
      getFormAction('openVideoEntry')?.({ lightPath, darkPath, singlePath, label, mode });
    } else if (IMAGE_EXTS.includes(ext)) {
      if (!lightPath) return;
      getFormAction('openCaptureEntry')?.({ lightPath, darkPath, label, mode });
    } else if (!insertMode) {
      // Odd formats (e.g. a PDF in other/) are browse-only: open the raw file.
      const path = singlePath || lightPath || darkPath;
      if (path) window.open(assetCdnUrl(path), '_blank');
    }
  });

  await renderPanel();
}

registerFormAction('openMediaLibrary', openMediaLibrary);

// "Upload a new file": navigate to the upload form, defaulting its destination
// dropdown to the active tab. Thin wrapper rather than
// data-action="openMediaUpload" on the button itself: form.js's dispatcher
// passes DOM refs (formEl/overlay/cleanup) as the action args, and getFormAction
// records args into the replayable invocation descriptor — DOM refs would
// poison snapshotFormStack replays. libraryContext is plain data, so it's safe.
registerFormAction('startLibraryUpload', () =>
  getFormAction('openMediaUpload')?.({ folders: libraryContext.folders, folder: libraryContext.current }));

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
