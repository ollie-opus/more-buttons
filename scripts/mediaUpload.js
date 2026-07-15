import { createForm, navigateBack, setButtonBusy, snapshotButton, restoreButton } from './form.js';
import { pushCaptures, resolveCaptureConflict, overwriteCapturePair } from './captures.js';
import { githubPathExists, githubPushImageIfNotExists, githubReplaceImage } from './github.js';
import { captureCard, captureGrid, capturePathField, captureUploadField, readCaptureImage, readMediaFile, CAPTURE_UPLOAD_TYPES } from './captureCards.js';
import { registerFormAction } from './formActions.js';

const MEDIA_ROOT = 'docs/assets/media';
// Uploads into this folder use the capture pipeline: a light+dark PNG/SVG pair
// with the theme suffixes appended. Every other folder takes a single file of
// any format, stored under the typed path with the file's own extension.
const CAPTURE_FOLDER = 'occ-captures';

// Library-side "Upload a new file". The destination dropdown lists the media
// library's top-level folders (passed in by the library so the two stay in
// sync); occ-captures keeps the original pair-upload flow, everything else is
// a single-file upload.
export async function openMediaUpload({ folders, folder } = {}) {
  const opener = () => openMediaUpload({ folders, folder });
  const { formEl } = await createForm('mediaUpload', opener);
  if (!formEl) return;

  // form.js moves .more-buttons-form-actions out of <form>, so look up the
  // action controls on the parent overlay-content wrapper.
  const contentEl = formEl.parentElement ?? formEl;
  const bodyEl = formEl.querySelector('[data-media-upload-body]');
  const saveBtn = contentEl.querySelector('[data-media-upload-save]');
  const cancelBtn = contentEl.querySelector('[data-media-upload-cancel]');

  const folderList = folders?.length ? folders : [{ key: CAPTURE_FOLDER, label: 'Occ Captures' }];
  let dest = folderList.some(f => f.key === folder) ? folder : folderList[0].key;
  const isCaptureDest = () => dest === CAPTURE_FOLDER;

  const picked = { light: null, dark: null, single: null }; // { ext, dataUrl } per file input

  function renderBody() {
    const destRow = `
      <div class="more-buttons-form-group">
        <label class="more-buttons-label">Destination</label>
        <select data-media-upload-dest>
          ${folderList.map(f => `<option value="${f.key}"${f.key === dest ? ' selected' : ''}>${f.label}</option>`).join('')}
        </select>
      </div>`;
    if (isCaptureDest()) {
      bodyEl.innerHTML = destRow +
        capturePathField({
          label: 'Capture path',
          value: '',
          editable: true,
          hint: 'Folder path + file name, no extension. e.g. sites/overview is saved as sites/overview-light-mode.svg and sites/overview-dark-mode.svg — the theme suffixes and file extension are added for you, so don’t type .png/.svg or -light-mode/-dark-mode',
        }) +
        captureUploadField({ label: 'Light mode image', name: 'light' }) +
        captureUploadField({ label: 'Dark mode image', name: 'dark' }) +
        '<div data-media-upload-previews></div>';
    } else {
      bodyEl.innerHTML = destRow +
        capturePathField({
          label: 'File path',
          value: '',
          editable: true,
          hint: `Folder path + file name inside ${dest}, no extension. e.g. training/intro is saved as training/intro.mp4 — the extension is taken from the chosen file, so don’t type it`,
        }) +
        captureUploadField({ label: 'File', name: 'single', exts: null }) +
        '<div data-media-upload-previews></div>';
    }
  }
  renderBody();

  function currentBase() {
    const pathInput = bodyEl.querySelector('[data-capture-path-input]');
    return (pathInput?.value ?? '').trim().replace(/^\/+|\/+$/g, '');
  }

  function renderPreviews() {
    const box = bodyEl.querySelector('[data-media-upload-previews]');
    if (isCaptureDest()) {
      box.innerHTML = captureGrid([
        captureCard({ theme: 'light', title: 'Light mode', src: picked.light?.dataUrl, alt: 'light mode' }),
        captureCard({ theme: 'dark', title: 'Dark mode', src: picked.dark?.dataUrl, alt: 'dark mode' }),
      ]);
    } else if (picked.single && CAPTURE_UPLOAD_TYPES[picked.single.ext]) {
      // Only image formats get a visual preview; anything else shows via the
      // file input's own filename text.
      box.innerHTML = captureGrid([
        captureCard({ theme: 'light', title: 'Preview', src: picked.single.dataUrl, alt: 'preview' }),
      ]);
    } else {
      box.innerHTML = '';
    }
  }

  bodyEl.addEventListener('change', async (e) => {
    const destSelect = e.target.closest('[data-media-upload-dest]');
    if (destSelect) {
      dest = destSelect.value;
      picked.light = picked.dark = picked.single = null;
      renderBody();
      return;
    }
    const input = e.target.closest('[data-capture-upload]');
    if (!input) return;
    const file = input.files?.[0];
    const slot = input.dataset.captureUpload;
    try {
      if (!file) picked[slot] = null;
      else picked[slot] = slot === 'single' ? await readMediaFile(file) : await readCaptureImage(file);
    } catch (err) {
      alert(err.message);
      input.value = '';
      picked[slot] = null;
    }
    input.classList.toggle('--has-file', !!input.files?.length);
    renderPreviews();
  });

  let busy = false;

  // occ-captures: the original pair save — theme suffixes, pair conflict flow.
  async function saveCapturePair(base) {
    const ext = picked.light.ext;
    const light = `media/${CAPTURE_FOLDER}/${base}-light-mode.${ext}`;
    const dark = `media/${CAPTURE_FOLDER}/${base}-dark-mode.${ext}`;
    const lightPath = `docs/assets/${light}`;
    const darkPath = `docs/assets/${dark}`;

    // Probe both theme files of the target. Only the SAME extension counts
    // as a conflict — foo.svg and foo.png are distinct pairs and coexist
    // (the library tree keys leaves per extension). pushCaptures is
    // create-only, so saving onto an existing path would silently no-op —
    // surface a failed probe as an error rather than pushing blind.
    let lightExists, darkExists;
    try {
      [lightExists, darkExists] = await Promise.all([
        githubPathExists(lightPath),
        githubPathExists(darkPath),
      ]);
    } catch (e) {
      alert(`Could not check for an existing capture: ${e.message}`);
      return false;
    }

    const capture = {
      lightDataUrl: picked.light.dataUrl,
      darkDataUrl: picked.dark.dataUrl,
      lightFilename: light,
      darkFilename: dark,
    };

    if (lightExists || darkExists) {
      const keepMine = await resolveCaptureConflict({
        formEl, base, lightPath, lightExists, mineLightDataUrl: capture.lightDataUrl,
      });
      // User chose to keep the existing capture — the conflict panel already
      // explained it; just settle the button so they can rename and retry.
      if (!keepMine) return false;
      await overwriteCapturePair({ lightPath, darkPath, lightExists, darkExists, capture, onProgress: s => setButtonBusy(saveBtn, s) });
    } else {
      await pushCaptures([capture], s => setButtonBusy(saveBtn, s));
    }
    return true;
  }

  // Any other folder: one file, stored as typed with its real extension.
  async function saveSingleFile(base) {
    const { ext, dataUrl } = picked.single;
    const path = `${MEDIA_ROOT}/${dest}/${base}.${ext}`;

    let exists;
    try {
      exists = await githubPathExists(path);
    } catch (e) {
      alert(`Could not check for an existing file: ${e.message}`);
      return false;
    }

    const base64 = dataUrl.split(',')[1];
    if (exists) {
      if (!window.confirm(`${base}.${ext} already exists in ${dest} — overwrite it?`)) return false;
      await githubReplaceImage(path, base64, s => setButtonBusy(saveBtn, s));
    } else {
      await githubPushImageIfNotExists(path, base64, s => setButtonBusy(saveBtn, s));
    }
    return true;
  }

  async function save() {
    if (busy) return;
    // Validate before entering the busy state — nothing to undo yet.
    const base = currentBase();
    if (!base) {
      alert(isCaptureDest() ? 'Enter a capture path.' : 'Enter a file path.');
      return;
    }
    if (isCaptureDest()) {
      if (!picked.light || !picked.dark) {
        alert('Choose both a light and a dark image.');
        return;
      }
      if (picked.light.ext !== picked.dark.ext) {
        alert('Light and dark images must be the same file type (both PNG or both SVG).');
        return;
      }
    } else if (!picked.single) {
      alert('Choose a file to upload.');
      return;
    }
    busy = true;
    // Progress rides the amber dock tag above the Save tile (the GitHub-commit
    // language shared by every push button), not an inline status line.
    const snap = snapshotButton(saveBtn);
    setButtonBusy(saveBtn, 'Saving…');
    if (cancelBtn) cancelBtn.disabled = true;
    let done = false; // true once we navigate away — leave the tile busy then
    try {
      const saved = isCaptureDest() ? await saveCapturePair(base) : await saveSingleFile(base);
      if (!saved) return;
      done = true;
      navigateBack(); // replays openMediaLibrary → re-fetches the tree
    } catch (e) {
      alert(`Failed to save: ${e.message}`);
    } finally {
      if (!done) {
        restoreButton(saveBtn, snap);
        if (cancelBtn) cancelBtn.disabled = false;
        busy = false;
      }
    }
  }

  contentEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-media-upload-save]')) save();
    else if (e.target.closest('[data-media-upload-cancel]')) navigateBack();
  });
}

registerFormAction('openMediaUpload', openMediaUpload);
