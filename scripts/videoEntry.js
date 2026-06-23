/**
 * videoEntry.js — the review form for a library video, in two flavours that
 * mirror captureEntry: the INSERT flavour (mode === 'insert', reached from the
 * guide insert flow) previews the video(s) and lets the user set Size /
 * Animation-Clip / Theme / Corner, then hands a resolved spec to videos.js
 * (completeComponentVideoInsert) to commit into the container; the LIBRARY-BROWSE
 * flavour (clicked straight from the media library) is preview-only. Unlike
 * captures there is no create/recapture path — videos are uploaded manually —
 * so the browse flavour simply shows the preview(s) with no options.
 */

import { createForm, navigateBack } from './form.js';
import { readRepoBlob } from './repoClient.js';
import { registerFormAction, getFormAction } from './formActions.js';
import { captureGrid, captureSizeField, wireCaptureSizeField, readCaptureSizeField, captureRadioField, captureThemeField, captureCornerField } from './captureCards.js';
import { videoCard, videoBasePath } from './videoCards.js';
import { formLoading } from './loading.js';

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
  // from the media library) is preview-only — no options, no insert. Videos have
  // no recapture path, so that flavour simply shows the preview(s).
  const insertMode = mode === 'insert';

  const opener = () => openVideoEntry({ lightPath, darkPath, singlePath, label, mode });
  const { formEl } = await createForm('videoEntry', opener);
  if (!formEl) return;

  const contentEl = formEl.parentElement ?? formEl;
  const titleEl = formEl.querySelector('[data-video-entry-title]');
  const bodyEl = formEl.querySelector('[data-video-entry-body]');
  const actionsEl = contentEl.querySelector('[data-video-entry-actions]');
  const base = videoBasePath(primaryPath);
  if (titleEl) titleEl.textContent = insertMode ? `Insert video — ${base}` : base;

  let lightUrl = '', darkUrl = '';
  const revoke = (u) => { if (u?.startsWith('blob:')) URL.revokeObjectURL(u); };

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
        : '');
    if (insertMode) wireCaptureSizeField(bodyEl);
    actionsEl.innerHTML = insertMode
      ? `<button type="button" class="more-buttons-button secondary" data-video-entry-cancel><span class="more-buttons-icon">close</span>Cancel</button>
         <button type="button" class="more-buttons-button" data-video-entry-insert><span class="more-buttons-icon">add</span>Insert this video</button>`
      : '';
  }

  function readRadio(name, fallback) {
    return formEl.querySelector(`[name="${name}"]:checked`)?.value ?? fallback;
  }

  function insert() {
    const { dimMode, dimValue } = readCaptureSizeField(bodyEl);
    const video = {
      lightFilename: stripPrefix(primaryPath),
      darkFilename: isSingle ? null : stripPrefix(darkPath || lightPath.replace('-light-mode', '-dark-mode')),
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
  });

  formLoading.show();
  try {
    const [lb, db] = await Promise.all([
      readRepoBlob(primaryPath).catch(() => null),
      (!isSingle && darkPath) ? readRepoBlob(darkPath).catch(() => null) : Promise.resolve(null),
    ]);
    revoke(lightUrl); revoke(darkUrl);
    lightUrl = lb ? URL.createObjectURL(lb) : '';
    darkUrl = db ? URL.createObjectURL(db) : '';
  } finally {
    formLoading.dismiss();
  }
  render();
}

registerFormAction('openVideoEntry', openVideoEntry);
