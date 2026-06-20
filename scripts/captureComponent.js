/**
 * captureComponent.js — the "Edit capture" overlay for a capture component.
 *
 * Modeled on the admonition edit form: shows the light + dark preview (like the
 * capture-entry view) plus a Dimension control (height/width/auto), with Save +
 * Delete in the bottom-right. Consistent with the immediate-save Components
 * model, Save/Delete commit straight to the container's markdown (via the
 * componentContainers registry) and navigate back — the parent editor then
 * re-renders from markdown.
 */

import { createForm, navigateBack, resetDirtyBaseline, setButtonBusy, snapshotButton, restoreButton } from './form.js';
import { readRepoBlob } from './repoClient.js';
import { captureCard, captureGrid, captureSizeField, wireCaptureSizeField } from './captureCards.js';
import { videoCard } from './videoCards.js';
import { registerFormAction } from './formActions.js';
import { getComponentContainer } from './componentContainers.js';
import { captureDimFields, videoDimFields, uuidOfComponent } from './components.js';
import { mergeSave } from './mergeSave.js';
import { formLoading } from './loading.js';

export async function openEditCaptureComponent({ container, uuid, cap } = {}) {
  return openEditMediaComponent({ kind: 'capture', container, uuid, media: cap });
}
registerFormAction('openEditCaptureComponent', openEditCaptureComponent);

export async function openEditVideoComponent({ container, uuid, vid } = {}) {
  return openEditMediaComponent({ kind: 'video', container, uuid, media: vid });
}
registerFormAction('openEditVideoComponent', openEditVideoComponent);

async function openEditMediaComponent({ kind, container, uuid, media } = {}) {
  if (!container || !media) return;
  const isVideo = kind === 'video';
  const fieldsFn = isVideo ? videoDimFields : captureDimFields;
  const opener = () => openEditMediaComponent({ kind, container, uuid, media });

  await chrome.storage.local.set({ moreButtonsEditCaptureComponent: fieldsFn(media) });

  const { formEl } = await createForm('editCaptureComponent', opener);
  if (!formEl) return;
  formEl.dataset.containerKind = container.kind;
  formEl.dataset.containerUuid = container.uuid;
  formEl.dataset.containerFile = container.file;
  formEl.dataset.componentUuid = uuid;
  formEl.dataset.mediaKind = kind;

  const titleEl = formEl.querySelector('[data-edit-media-title]');
  if (titleEl) titleEl.textContent = isVideo ? 'Edit video' : 'Edit capture';

  // Playback radios are video-only; Theme is meaningless for a single video.
  const playbackGroup = formEl.querySelector('[data-video-playback-group]');
  if (playbackGroup) playbackGroup.hidden = !isVideo;
  if (isVideo && !media.darkFilename) {
    formEl.querySelector('[name="captureTheme"]')?.closest('.more-buttons-form-group')?.setAttribute('hidden', '');
  }

  const previewEl = formEl.querySelector('[data-capture-component-preview]');
  if (previewEl) {
    formLoading.show();
    try {
      const [lightBlob, darkBlob] = await Promise.all([
        readRepoBlob('docs/assets/' + media.lightFilename).catch(() => null),
        media.darkFilename ? readRepoBlob('docs/assets/' + media.darkFilename).catch(() => null) : Promise.resolve(null),
      ]);
      const lightUrl = lightBlob ? URL.createObjectURL(lightBlob) : '';
      const darkUrl = darkBlob ? URL.createObjectURL(darkBlob) : '';
      const card = isVideo ? videoCard : captureCard;
      previewEl.innerHTML = captureGrid([
        card({ theme: 'light', title: media.darkFilename ? 'Light mode' : 'Preview', src: lightUrl, alt: 'light mode' }),
        card({ theme: 'dark', title: 'Dark mode', src: darkUrl, alt: 'dark mode' }),
      ]);
    } finally {
      formLoading.dismiss();
    }
  }

  const sizeHost = formEl.querySelector('[data-capture-component-size]');
  if (sizeHost) {
    const dim = fieldsFn(media);
    sizeHost.innerHTML = captureSizeField({ dimMode: dim.dimMode, dimValue: dim.dimValue });
    wireCaptureSizeField(formEl);
  }
  resetDirtyBaseline(formEl);
}

function readContainerRef(formEl) {
  return {
    handler: getComponentContainer(formEl.dataset.containerKind),
    container: {
      kind: formEl.dataset.containerKind,
      uuid: formEl.dataset.containerUuid,
      file: formEl.dataset.containerFile,
    },
    uuid: formEl.dataset.componentUuid,
  };
}

registerFormAction('submitEditCaptureComponent', async ({ formEl, content }) => {
  const { handler, container, uuid } = readContainerRef(formEl);
  if (!handler) return;
  const isVideo = formEl.dataset.mediaKind === 'video';
  const btn = content?.querySelector('[data-save-state]');
  setButtonBusy(btn, 'Saving…');

  const modeSel = formEl.querySelector('[name="dimMode"]');
  const valInput = formEl.querySelector('[name="dimValue"]');
  if (modeSel?.value === 'none' && valInput) valInput.value = '';

  const baseSpecs = [
    { name: 'dimMode', type: 'scalar', label: 'Dimension mode' },
    { name: 'dimValue', type: 'scalar', label: 'Dimension value' },
    { name: 'captureTheme', type: 'scalar', label: 'Theme' },
    { name: 'captureCorner', type: 'scalar', label: 'Corner rounding' },
  ];
  const fieldSpecs = isVideo
    ? [...baseSpecs, { name: 'videoPlayback', type: 'scalar', label: 'Playback' }]
    : baseSpecs;

  try {
    await mergeSave({
      formEl,
      file: container.file,
      onProgress: s => setButtonBusy(btn, s),
      fieldSpecs,
      readFresh: md => {
        const { components } = handler.readComponents(md, container.uuid);
        if (isVideo) {
          const vid = components.find(c => c.kind === 'video' && c.vid.uuid === uuid)?.vid;
          return videoDimFields(vid);
        }
        const cap = components.find(c => c.kind === 'capture' && c.cap.uuid === uuid)?.cap;
        return captureDimFields(cap);
      },
      build: (md, resolved) => {
        const { description, components } = handler.readComponents(md, container.uuid);
        const mode = resolved.dimMode ?? 'none';
        const raw = parseInt(resolved.dimValue, 10);
        const dimValue = mode === 'none' ? null : (Number.isFinite(raw) && raw > 0 ? raw : 50);
        const inversed = resolved.captureTheme === 'inversed';
        const rounded = resolved.captureCorner === 'enabled';
        const next = components.map(c => {
          if (isVideo && c.kind === 'video' && c.vid.uuid === uuid) {
            return { kind: 'video', vid: { ...c.vid, dimMode: mode, dimValue, inversed: c.vid.single ? false : inversed, rounded, playback: resolved.videoPlayback ?? 'animation' } };
          }
          if (!isVideo && c.kind === 'capture' && c.cap.uuid === uuid) {
            return { kind: 'capture', cap: { ...c.cap, dimMode: mode, dimValue, inversed, rounded } };
          }
          return c;
        });
        return handler.writeBody(md, container.uuid, description, next);
      },
    });
    formEl._refreshSaveState?.();
  } catch (e) {
    formEl._refreshSaveState?.();
    alert('Failed to save: ' + e.message);
  }
});

registerFormAction('deleteCaptureComponent', async ({ formEl, content }) => {
  const isVideo = formEl.dataset.mediaKind === 'video';
  const noun = isVideo ? 'video' : 'capture';
  if (!confirm(`Delete this ${noun}? This removes it from the page (the file stays in the library).`)) return;
  const { handler, container, uuid } = readContainerRef(formEl);
  if (!handler) return;
  const btn = content?.querySelector('[data-action="deleteCaptureComponent"]');
  const snap = snapshotButton(btn);
  setButtonBusy(btn, 'Deleting…');
  try {
    await handler.mutate(container, (components) =>
      components.filter(c => uuidOfComponent(c) !== uuid),
      s => setButtonBusy(btn, s));
    await chrome.storage.local.remove('moreButtonsEditCaptureComponent');
    await navigateBack();
  } catch (e) {
    restoreButton(btn, snap);
    alert(`Failed to delete ${noun}: ` + e.message);
  }
});
