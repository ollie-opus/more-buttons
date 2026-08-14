/**
 * videoEntry.js — the review form for a library video, in two flavours that
 * mirror captureEntry: the INSERT flavour (mode === 'insert', reached from the
 * guide insert flow) previews the video(s) and lets the user set Size /
 * Animation-Clip / Theme / Corner, then hands a resolved spec to videos.js
 * (completeComponentVideoInsert) to commit into the container; the LIBRARY-BROWSE
 * flavour (clicked straight from the media library) previews the video(s) and
 * offers "Replace via upload" — videos have no recapture path, so replacement
 * is always a fresh upload, pushed in place onto the stored path(s) so pages
 * embedding the video keep working.
 */

import { createForm, navigateBack, setButtonBusy, snapshotButton, restoreButton } from './form.js';
import { readRepoBlob } from './repoClient.js';
import { githubReplaceImage } from './github.js';
import { registerFormAction, getFormAction } from './formActions.js';
import { captureGrid, captureSizeField, wireCaptureSizeField, readCaptureSizeField, captureRadioField, captureThemeField, captureCornerField, capturePathField, captureUploadField, readMediaFile, mediaFileExt } from './captureCards.js';
import { videoCard, videoBasePath } from './videoCards.js';
import { formLoading } from './loading.js';
import { buildUsagePanelHtml, wireUsagePanel } from './usagePanel.js';

const STRIP = 'docs/assets/';
const stripPrefix = (p) => (p && p.startsWith(STRIP) ? p.slice(STRIP.length) : p);

// lightPath/darkPath/singlePath are full repo paths like
// "docs/assets/media/videos/foo-light-mode.mp4". Exactly one of (lightPath) or
// (singlePath) is set by the library: a pair carries light+dark, a single carries
// singlePath.
export async function openVideoEntry({ lightPath, darkPath, singlePath, label, mode } = {}) {
  const primaryPath = singlePath || lightPath;
  if (!primaryPath) return;
  const isSingle = !!singlePath && !lightPath;
  // Two flavours, mirroring captureEntry: the insert flavour (reached from the
  // guide insert flow) shows the sizing + Playback / Theme / Corner options and
  // an "Insert this video" button; the library-browse flavour (clicked straight
  // from the media library) shows the preview(s) plus "Replace via upload".
  const insertMode = mode === 'insert';
  // A pair's dark file when the library only passed the light path.
  const pairDarkPath = isSingle ? null : (darkPath || lightPath.replace('-light-mode', '-dark-mode'));

  const opener = () => openVideoEntry({ lightPath, darkPath, singlePath, label, mode });
  const { formEl } = await createForm('videoEntry', opener);
  if (!formEl) return;

  const contentEl = formEl.parentElement ?? formEl;
  const titleEl = formEl.querySelector('[data-video-entry-title]');
  const bodyEl = formEl.querySelector('[data-video-entry-body]');
  const actionsEl = contentEl.querySelector('[data-video-entry-actions]');
  const base = videoBasePath(primaryPath);
  // Replacement happens in place at the stored path, so the picker only takes
  // the pair's own container format.
  const storedExt = mediaFileExt({ name: primaryPath });
  if (titleEl) titleEl.textContent = insertMode ? `Insert video — ${base}` : base;

  let lightUrl = '', darkUrl = '';
  let usageHtml = ''; // "Used on pages" block, loaded once per open (browse only)
  const revoke = (u) => { if (u?.startsWith('blob:')) URL.revokeObjectURL(u); };

  async function loadBlobs() {
    formLoading.show();
    try {
      const [lb, db] = await Promise.all([
        readRepoBlob(primaryPath).catch(() => null),
        (!isSingle && pairDarkPath) ? readRepoBlob(pairDarkPath).catch(() => null) : Promise.resolve(null),
      ]);
      revoke(lightUrl); revoke(darkUrl);
      lightUrl = lb ? URL.createObjectURL(lb) : '';
      darkUrl = db ? URL.createObjectURL(db) : '';
    } finally {
      formLoading.dismiss();
    }
  }

  function render() {
    const cards = isSingle
      ? [videoCard({ theme: 'light', title: 'Video', src: lightUrl, alt: label ?? 'video' })]
      : [
          videoCard({ theme: 'light', title: 'Light mode', src: lightUrl, alt: label ?? 'light mode' }),
          videoCard({ theme: 'dark', title: 'Dark mode', src: darkUrl, alt: `${label ?? 'video'} (dark)` }),
        ];
    bodyEl.innerHTML =
      captureGrid(cards) +
      (insertMode
        ? captureSizeField({ dimMode: 'width', dimValue: 1000 })
          + captureRadioField('videoPlayback', 'Playback', [['animation', 'Animation', true], ['clip', 'Clip', false]])
          + (isSingle ? '' : captureThemeField())
          + captureCornerField()
        : usageHtml);
    if (insertMode) wireCaptureSizeField(bodyEl);
    actionsEl.innerHTML = insertMode
      ? `<button type="button" class="more-buttons-button secondary" data-video-entry-cancel><span class="more-buttons-icon">close</span>Cancel</button>
         <button type="button" class="more-buttons-button" data-video-entry-insert><span class="more-buttons-icon">add</span>Insert this video</button>`
      : `<button type="button" class="more-buttons-button" data-video-entry-upload><span class="more-buttons-icon">upload</span>Replace via upload</button>`;
  }

  // ── Replace via upload — the browse flavour's two extra views, mirroring
  // captureEntry: pick replacement file(s) of the stored format, land in an
  // old-vs-new compare, then push in place onto the stored path(s).
  const picked = { light: null, dark: null }; // { ext, dataUrl } per file input
  let pendingReplace = null; // { light, dark } staged once every slot is picked
  let busy = false;

  function renderUploadPicker() {
    picked.light = null;
    picked.dark = null;
    bodyEl.innerHTML =
      capturePathField({ label: 'Video path', value: base }) +
      captureUploadField({ label: isSingle ? 'Video file' : 'Light mode video', name: 'light', exts: [storedExt] }) +
      (isSingle ? '' : captureUploadField({ label: 'Dark mode video', name: 'dark', exts: [storedExt] }));
    actionsEl.innerHTML = `
      <button type="button" class="more-buttons-button secondary" data-video-entry-cancel-replace><span class="more-buttons-icon">close</span>Cancel</button>
    `;
  }

  function renderCompare() {
    if (!pendingReplace) return;
    const cards = isSingle
      ? [
          videoCard({ theme: 'light', title: 'Video (Old)', src: lightUrl, alt: 'old video' }),
          videoCard({ theme: 'light', title: 'Video (New)', src: pendingReplace.light.dataUrl, alt: 'new video' }),
        ]
      : [
          videoCard({ theme: 'light', title: 'Light mode (Old)', src: lightUrl, alt: 'old light mode' }),
          videoCard({ theme: 'dark', title: 'Dark mode (Old)', src: darkUrl, alt: 'old dark mode' }),
          videoCard({ theme: 'light', title: 'Light mode (New)', src: pendingReplace.light.dataUrl, alt: 'new light mode' }),
          videoCard({ theme: 'dark', title: 'Dark mode (New)', src: pendingReplace.dark.dataUrl, alt: 'new dark mode' }),
        ];
    bodyEl.innerHTML = capturePathField({ label: 'Video path', value: base }) + captureGrid(cards);
    actionsEl.innerHTML = `
      <button type="button" class="more-buttons-button secondary" data-video-entry-cancel-replace><span class="more-buttons-icon">close</span>Cancel</button>
      <button type="button" class="more-buttons-button success" data-video-entry-save><span class="more-buttons-icon">save</span>Save Changes</button>
    `;
  }

  async function saveChanges() {
    if (!pendingReplace || busy) return;
    busy = true;
    const saveBtn = actionsEl.querySelector('[data-video-entry-save]');
    const cancelBtn = actionsEl.querySelector('[data-video-entry-cancel-replace]');
    // Progress rides the amber dock tag above the Save tile (the shared
    // GitHub-commit language), not an inline status line.
    const snap = snapshotButton(saveBtn);
    setButtonBusy(saveBtn, 'Saving…');
    if (cancelBtn) cancelBtn.disabled = true;
    try {
      await githubReplaceImage(primaryPath, pendingReplace.light.dataUrl.split(',')[1], s => setButtonBusy(saveBtn, s));
      if (!isSingle && pendingReplace.dark) {
        await githubReplaceImage(pairDarkPath, pendingReplace.dark.dataUrl.split(',')[1], s => setButtonBusy(saveBtn, s));
      }
      setButtonBusy(saveBtn, 'Refreshing…');
      pendingReplace = null;
      await loadBlobs();
      render(); // rebuilds the dock, clearing the busy tile
    } catch (e) {
      restoreButton(saveBtn, snap);
      if (cancelBtn) cancelBtn.disabled = false;
      alert(`Failed to save video: ${e.message}`);
    } finally {
      busy = false;
    }
  }

  // Upload-picker file inputs. Delegated on formEl (bodyEl's contents are
  // re-rendered per view, but formEl persists). The accept filter is only a
  // hint, so re-check the real extension — bytes are pushed as-is onto the
  // stored path, so the format must match. When every required file is
  // picked, stage the set as pendingReplace and jump to the compare view.
  formEl.addEventListener('change', async (e) => {
    const input = e.target.closest('[data-capture-upload]');
    if (!input) return;
    const file = input.files?.[0];
    const slot = input.dataset.captureUpload;
    try {
      if (!file) {
        picked[slot] = null;
      } else {
        const read = await readMediaFile(file);
        if (read.ext !== storedExt) {
          throw new Error(`Only .${storedExt} files are supported here — the video is replaced in place at its stored path.`);
        }
        picked[slot] = read;
      }
    } catch (err) {
      alert(err.message);
      input.value = '';
      picked[slot] = null;
    }
    input.classList.toggle('--has-file', !!input.files?.length);
    if (picked.light && (isSingle || picked.dark)) {
      pendingReplace = { light: picked.light, dark: picked.dark };
      renderCompare();
    }
  });

  function readRadio(name, fallback) {
    return formEl.querySelector(`[name="${name}"]:checked`)?.value ?? fallback;
  }

  function insert() {
    const { dimMode, dimValue } = readCaptureSizeField(bodyEl);
    const video = {
      lightFilename: stripPrefix(primaryPath),
      darkFilename: isSingle ? null : stripPrefix(pairDarkPath),
      dimMode, dimValue,
      inversed: !isSingle && readRadio('captureTheme', 'default') === 'inversed',
      rounded: readRadio('captureCorner', 'disabled') === 'enabled',
      playback: readRadio('videoPlayback', 'animation'),
    };
    getFormAction('completeComponentVideoInsert')?.({ video });
  }

  (formEl.parentElement ?? formEl).addEventListener('click', (e) => {
    if (e.target.closest('[data-video-entry-insert]')) insert();
    else if (e.target.closest('[data-video-entry-cancel]')) navigateBack();
    else if (e.target.closest('[data-video-entry-upload]')) renderUploadPicker();
    else if (e.target.closest('[data-video-entry-save]')) saveChanges();
    else if (e.target.closest('[data-video-entry-cancel-replace]')) {
      if (busy) return;
      pendingReplace = null;
      render();
    }
  });

  if (!insertMode) {
    wireUsagePanel(formEl);
    formLoading.show();
    try {
      usageHtml = await buildUsagePanelHtml(isSingle ? [primaryPath] : [primaryPath, pairDarkPath]);
    } finally {
      formLoading.dismiss();
    }
  }
  await loadBlobs();
  render();
}

registerFormAction('openVideoEntry', openVideoEntry);
