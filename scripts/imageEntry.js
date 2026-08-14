/**
 * imageEntry.js — the review form for a library single image, in two flavours
 * that mirror videoEntry: the INSERT flavour (mode === 'insert', reached from
 * the guide insert flow) previews the image and lets the user set Size /
 * Corner, then hands a resolved spec to images.js (completeComponentImageInsert)
 * to commit into the container; the LIBRARY-BROWSE flavour (clicked straight
 * from the media library) previews the image and offers "Replace via upload" —
 * singles have no recapture path, so replacement is always a fresh upload,
 * pushed in place onto the stored path so pages embedding the image keep working.
 */

import { createForm, navigateBack, setButtonBusy, snapshotButton, restoreButton } from './form.js';
import { readRepoBlob } from './repoClient.js';
import { githubReplaceImage } from './github.js';
import { registerFormAction, getFormAction } from './formActions.js';
import { captureCard, captureGrid, captureSizeField, wireCaptureSizeField, readCaptureSizeField, captureCornerField, capturePathField, captureUploadField, readMediaFile, mediaFileExt, mediaBasePath } from './captureCards.js';
import { formLoading } from './loading.js';
import { buildUsagePanelHtml, wireUsagePanel } from './usagePanel.js';

const STRIP = 'docs/assets/';
const stripPrefix = (p) => (p && p.startsWith(STRIP) ? p.slice(STRIP.length) : p);

// singlePath is a full repo path like "docs/assets/media/buttons/menu-icon.png"
// — always a lone file with no theme pair (pairs route to captureEntry).
export async function openImageEntry({ singlePath, label, mode } = {}) {
  if (!singlePath) return;
  // Two flavours, mirroring videoEntry: the insert flavour (reached from the
  // guide insert flow) shows the sizing + Corner options and an "Insert this
  // image" button; the library-browse flavour (clicked straight from the media
  // library) shows the preview plus "Replace via upload".
  const insertMode = mode === 'insert';

  const opener = () => openImageEntry({ singlePath, label, mode });
  const { formEl } = await createForm('imageEntry', opener);
  if (!formEl) return;

  const contentEl = formEl.parentElement ?? formEl;
  const titleEl = formEl.querySelector('[data-image-entry-title]');
  const bodyEl = formEl.querySelector('[data-image-entry-body]');
  const actionsEl = contentEl.querySelector('[data-image-entry-actions]');
  const base = mediaBasePath(singlePath);
  // Replacement happens in place at the stored path, so the picker only takes
  // the file's own format.
  const storedExt = mediaFileExt({ name: singlePath });
  if (titleEl) {
    titleEl.textContent = insertMode ? `Insert image — ${base}` : base;
    // Same grey format pill as the library tree, pushed to the row's right.
    titleEl.insertAdjacentHTML('beforeend', `<span class="mb-kb-pills"><span class="mb-kb-pill --format">.${storedExt}</span></span>`);
  }

  let imageUrl = '';
  let usageHtml = ''; // "Used on pages" block, loaded once per open (browse only)
  const revoke = (u) => { if (u?.startsWith('blob:')) URL.revokeObjectURL(u); };

  async function loadBlob() {
    formLoading.show();
    try {
      const blob = await readRepoBlob(singlePath).catch(() => null);
      revoke(imageUrl);
      imageUrl = blob ? URL.createObjectURL(blob) : '';
    } finally {
      formLoading.dismiss();
    }
  }

  function render() {
    bodyEl.innerHTML =
      captureGrid([captureCard({ theme: 'light', title: 'Image', src: imageUrl, alt: label ?? 'image' })]) +
      (insertMode
        ? captureSizeField({ dimMode: 'height', dimValue: 50 }) + captureCornerField()
        : usageHtml);
    if (insertMode) wireCaptureSizeField(bodyEl);
    actionsEl.innerHTML = insertMode
      ? `<button type="button" class="more-buttons-button secondary" data-image-entry-cancel><span class="more-buttons-icon">close</span>Cancel</button>
         <button type="button" class="more-buttons-button" data-image-entry-insert><span class="more-buttons-icon">add</span>Insert this image</button>`
      : `<button type="button" class="more-buttons-button" data-image-entry-upload><span class="more-buttons-icon">upload</span>Replace via upload</button>`;
  }

  // ── Replace via upload — the browse flavour's two extra views, mirroring
  // videoEntry: pick a replacement file of the stored format, land in an
  // old-vs-new compare, then push in place onto the stored path.
  let pendingReplace = null; // { ext, dataUrl } staged once a file is picked
  let busy = false;

  function renderUploadPicker() {
    pendingReplace = null;
    bodyEl.innerHTML =
      capturePathField({ label: 'Image path', value: base }) +
      captureUploadField({ label: 'Image file', name: 'light', exts: [storedExt] });
    actionsEl.innerHTML = `
      <button type="button" class="more-buttons-button secondary" data-image-entry-cancel-replace><span class="more-buttons-icon">close</span>Cancel</button>
    `;
  }

  function renderCompare() {
    if (!pendingReplace) return;
    bodyEl.innerHTML = capturePathField({ label: 'Image path', value: base }) + captureGrid([
      captureCard({ theme: 'light', title: 'Image (Old)', src: imageUrl, alt: 'old image' }),
      captureCard({ theme: 'light', title: 'Image (New)', src: pendingReplace.dataUrl, alt: 'new image' }),
    ]);
    actionsEl.innerHTML = `
      <button type="button" class="more-buttons-button secondary" data-image-entry-cancel-replace><span class="more-buttons-icon">close</span>Cancel</button>
      <button type="button" class="more-buttons-button success" data-image-entry-save><span class="more-buttons-icon">save</span>Save Changes</button>
    `;
  }

  async function saveChanges() {
    if (!pendingReplace || busy) return;
    busy = true;
    const saveBtn = actionsEl.querySelector('[data-image-entry-save]');
    const cancelBtn = actionsEl.querySelector('[data-image-entry-cancel-replace]');
    // Progress rides the amber dock tag above the Save tile (the shared
    // GitHub-commit language), not an inline status line.
    const snap = snapshotButton(saveBtn);
    setButtonBusy(saveBtn, 'Saving…');
    if (cancelBtn) cancelBtn.disabled = true;
    try {
      await githubReplaceImage(singlePath, pendingReplace.dataUrl.split(',')[1], s => setButtonBusy(saveBtn, s));
      setButtonBusy(saveBtn, 'Refreshing…');
      pendingReplace = null;
      await loadBlob();
      render(); // rebuilds the dock, clearing the busy tile
    } catch (e) {
      restoreButton(saveBtn, snap);
      if (cancelBtn) cancelBtn.disabled = false;
      alert(`Failed to save image: ${e.message}`);
    } finally {
      busy = false;
    }
  }

  // Upload-picker file input. Delegated on formEl (bodyEl's contents are
  // re-rendered per view, but formEl persists). The accept filter is only a
  // hint, so re-check the real extension — bytes are pushed as-is onto the
  // stored path, so the format must match. Once picked, stage the file as
  // pendingReplace and jump to the compare view.
  formEl.addEventListener('change', async (e) => {
    const input = e.target.closest('[data-capture-upload]');
    if (!input) return;
    const file = input.files?.[0];
    try {
      if (!file) {
        pendingReplace = null;
      } else {
        const read = await readMediaFile(file);
        if (read.ext !== storedExt) {
          throw new Error(`Only .${storedExt} files are supported here — the image is replaced in place at its stored path.`);
        }
        pendingReplace = read;
      }
    } catch (err) {
      alert(err.message);
      input.value = '';
      pendingReplace = null;
    }
    input.classList.toggle('--has-file', !!input.files?.length);
    if (pendingReplace) renderCompare();
  });

  function readRadio(name, fallback) {
    return formEl.querySelector(`[name="${name}"]:checked`)?.value ?? fallback;
  }

  function insert() {
    const { dimMode, dimValue } = readCaptureSizeField(bodyEl);
    const image = {
      filename: stripPrefix(singlePath),
      dimMode, dimValue,
      rounded: readRadio('captureCorner', 'disabled') === 'enabled',
    };
    getFormAction('completeComponentImageInsert')?.({ image });
  }

  (formEl.parentElement ?? formEl).addEventListener('click', (e) => {
    if (e.target.closest('[data-image-entry-insert]')) insert();
    else if (e.target.closest('[data-image-entry-cancel]')) navigateBack();
    else if (e.target.closest('[data-image-entry-upload]')) renderUploadPicker();
    else if (e.target.closest('[data-image-entry-save]')) saveChanges();
    else if (e.target.closest('[data-image-entry-cancel-replace]')) {
      if (busy) return;
      pendingReplace = null;
      render();
    }
  });

  if (!insertMode) {
    wireUsagePanel(formEl);
    formLoading.show();
    try {
      usageHtml = await buildUsagePanelHtml([singlePath]);
    } finally {
      formLoading.dismiss();
    }
  }
  await loadBlob();
  render();
}

registerFormAction('openImageEntry', openImageEntry);
