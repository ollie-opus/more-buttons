/**
 * videoEntry.js — the insert-review form for a library video. Unlike captures
 * there is no create/recapture path: videos are uploaded manually, so this form
 * only previews the chosen video(s) and lets the user set Size / Animation-Clip
 * / Theme / Corner before inserting. On insert it hands a resolved video spec to
 * videos.js (completeComponentVideoInsert), which commits it into the container.
 */

import { createForm, navigateBack } from './form.js';
import { readRepoBlob } from './repoClient.js';
import { registerFormAction, getFormAction } from './formActions.js';
import { captureGrid, captureSizeField, wireCaptureSizeField, readCaptureSizeField } from './captureCards.js';
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

  const opener = () => openVideoEntry({ lightPath, darkPath, singlePath, label, mode });
  const { formEl } = await createForm('videoEntry', opener);
  if (!formEl) return;

  const contentEl = formEl.parentElement ?? formEl;
  const titleEl = formEl.querySelector('[data-video-entry-title]');
  const bodyEl = formEl.querySelector('[data-video-entry-body]');
  const actionsEl = contentEl.querySelector('[data-video-entry-actions]');
  if (titleEl) titleEl.textContent = `Insert video — ${videoBasePath(primaryPath)}`;

  let lightUrl = '', darkUrl = '';
  const revoke = (u) => { if (u?.startsWith('blob:')) URL.revokeObjectURL(u); };

  function radioGroup(name, legend, options) {
    const items = options.map(([v, lbl, checked]) =>
      `<label class="more-buttons-radio-btn"><input type="radio" name="${name}" value="${v}"${checked ? ' checked' : ''} /> ${lbl}</label>`).join('');
    return `<div class="more-buttons-form-group"><label class="more-buttons-label">${legend}</label><div class="more-buttons-radio-btn-group-row">${items}</div></div>`;
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
      captureSizeField({ dimMode: 'width', dimValue: 1000 }) +
      radioGroup('videoPlayback', 'Playback', [['animation', 'Animation', true], ['clip', 'Clip', false]]) +
      (isSingle ? '' : radioGroup('captureTheme', 'Theme', [['default', 'Default', true], ['inversed', 'Inversed', false]])) +
      radioGroup('captureCorner', 'Corner rounding', [['disabled', 'Disabled', true], ['enabled', 'Enabled', false]]);
    wireCaptureSizeField(bodyEl);
    actionsEl.innerHTML =
      `<button type="button" class="more-buttons-button secondary" data-video-entry-cancel><span class="more-buttons-icon">close</span>Cancel</button>
       <button type="button" class="more-buttons-button" data-video-entry-insert><span class="more-buttons-icon">add</span>Insert this video</button>`;
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
