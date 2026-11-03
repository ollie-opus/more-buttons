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

import { createForm, navigateBack, resetDirtyBaseline, confirmDiscardIfDirty, setButtonBusy, snapshotButton, restoreButton } from './form.js';
import { readRepoBlob } from './repoClient.js';
import { captureCard, captureGrid, captureSizeField, wireCaptureSizeField } from './captureCards.js';
import { videoCard } from './videoCards.js';
import { registerFormAction, getFormAction } from './formActions.js';
import { getComponentContainer } from './componentContainers.js';
import { fileExtOf } from './cardRenderer.js';
import { captureDimFields, videoDimFields, imageDimFields, uuidOfComponent } from './components.js';
import { mergeSave } from './mergeSave.js';
import { formLoading } from './loading.js';
import { componentKindLabel, componentCommit } from './editLogDescribe.js';

// The component `uuid` as parsed from `md` (null when absent) — only feeds the
// commit subject's kind label, so a parse failure must never fail the save.
function componentIn(handler, container, md, uuid) {
  try {
    return handler.readComponents(md, container.uuid).components.find(c => uuidOfComponent(c) === uuid) ?? null;
  } catch {
    return null;
  }
}

export async function openEditCaptureComponent({ container, uuid, cap } = {}) {
  return openEditMediaComponent({ kind: 'capture', container, uuid, media: cap });
}
registerFormAction('openEditCaptureComponent', openEditCaptureComponent);

export async function openEditVideoComponent({ container, uuid, vid } = {}) {
  return openEditMediaComponent({ kind: 'video', container, uuid, media: vid });
}
registerFormAction('openEditVideoComponent', openEditVideoComponent);

export async function openEditImageComponent({ container, uuid, img } = {}) {
  return openEditMediaComponent({ kind: 'image', container, uuid, media: img });
}
registerFormAction('openEditImageComponent', openEditImageComponent);

async function openEditMediaComponent({ kind, container, uuid, media } = {}) {
  if (!container || !media) return;
  const isVideo = kind === 'video';
  const isImage = kind === 'image';
  // Through the registry so a Back/crumb reopen runs the form-action hooks
  // (the guide Live/Draft switch) like the first open did.
  const action = isVideo ? 'openEditVideoComponent' : isImage ? 'openEditImageComponent' : 'openEditCaptureComponent';
  const mediaKey = isVideo ? 'vid' : isImage ? 'img' : 'cap';
  const opener = () => getFormAction(action)({ container, uuid, [mediaKey]: media });

  await chrome.storage.local.set({ moreButtonsEditCaptureComponent: mediaDimFields(kind, media) });

  const { formEl } = await createForm('editCaptureComponent', opener);
  if (!formEl) return;
  formEl.dataset.containerKind = container.kind;
  formEl.dataset.containerUuid = container.uuid;
  formEl.dataset.containerFile = container.file;
  formEl.dataset.componentUuid = uuid;

  const titleEl = formEl.querySelector('[data-edit-media-title]');
  if (titleEl) {
    titleEl.textContent = isVideo ? 'Edit video' : isImage ? 'Edit image' : 'Edit capture';
    // Surface the stored file format while editing (same grey pill as the
    // library tree and component cards), pushed to the row's right edge by
    // the h2 flex rules in formsStyling.css — e.g. an .svg capture can only
    // be replaced by uploading SVGs, so the format matters here.
    titleEl.insertAdjacentHTML('beforeend', mediaFormatPillHtml(media));
  }

  await paintMediaFields(formEl, kind, media);
  resetDirtyBaseline(formEl);
}

// The file-format pill for a media component's heading ('' when unknown).
export function mediaFormatPillHtml(media) {
  const ext = fileExtOf(media?.filename ?? media?.lightFilename);
  return ext ? `<span class="mb-kb-pills"><span class="mb-kb-pill --format">.${ext}</span></span>` : '';
}

// The canonical field values a media kind's form hydrates from.
export function mediaDimFields(kind, media) {
  return (kind === 'video' ? videoDimFields : kind === 'image' ? imageDimFields : captureDimFields)(media);
}

// Repo paths the preview reads: the single file (image / single video) or the
// light + dark pair ('' when absent).
export function mediaPreviewPaths(media) {
  const toRepo = (f) => (f ? 'docs/assets/' + f : '');
  return { light: toRepo(media?.filename ?? media?.lightFilename), dark: toRepo(media?.darkFilename) };
}

// The editor's light + dark preview grid from already-resolved object URLs.
// Pure; a missing url drops its card.
export function mediaPreviewHtml(kind, media, { lightUrl = '', darkUrl = '' } = {}) {
  const card = kind === 'video' ? videoCard : captureCard;
  return captureGrid([
    card({ theme: 'light', title: media?.darkFilename ? 'Light mode' : 'Preview', src: lightUrl, alt: 'light mode' }),
    card({ theme: 'dark', title: 'Dark mode', src: darkUrl, alt: 'dark mode' }),
  ]);
}

/**
 * Everything the edit-capture form shows for a media component, shared by the
 * draft editor and the live view (guideLiveView.js): the "Manage this …"
 * route's datasets and label, Playback / Theme visibility, the preview (read
 * via readRepoBlob, GET only) and the Dimension field. Writes nothing.
 */
export async function paintMediaFields(formEl, kind, media) {
  const isVideo = kind === 'video';
  const isImage = kind === 'image';
  formEl.dataset.mediaKind = kind;

  // Repo paths + display label for the "Manage this …" jump to the library
  // entry form. The editor only opens for already-saved components, so the
  // referenced library files always exist.
  const { light, dark } = mediaPreviewPaths(media);
  if (isImage || (isVideo && media.single)) {
    formEl.dataset.mediaSingle = light;
  } else {
    formEl.dataset.mediaLight = light;
    formEl.dataset.mediaDark = dark;
  }
  formEl.dataset.mediaLabel = mediaLeafLabel(media.filename ?? media.lightFilename);

  // The action bar was relocated to the content wrapper by createForm; its
  // MutationObserver re-runs syncDockTag after this rewrite, so the floating
  // dock tag follows the per-kind label.
  const manageBtn = (formEl.parentElement ?? formEl).querySelector('[data-action="openMediaEntryFromComponent"]');
  if (manageBtn) {
    manageBtn.innerHTML = `<span class="more-buttons-icon">images</span>Manage this ${isVideo ? 'video' : isImage ? 'image' : 'capture'}`;
  }

  // Playback radios are video-only; Theme is meaningless without a pair
  // (single videos and images alike).
  const playbackGroup = formEl.querySelector('[data-video-playback-group]');
  if (playbackGroup) playbackGroup.hidden = !isVideo;
  if (isImage || (isVideo && !media.darkFilename)) {
    formEl.querySelector('[name="captureTheme"]')?.closest('.more-buttons-form-group')?.setAttribute('hidden', '');
  }

  const previewEl = formEl.querySelector('[data-capture-component-preview]');
  if (previewEl) {
    formLoading.show();
    try {
      const [lightBlob, darkBlob] = await Promise.all([
        light ? readRepoBlob(light).catch(() => null) : Promise.resolve(null),
        dark ? readRepoBlob(dark).catch(() => null) : Promise.resolve(null),
      ]);
      previewEl.innerHTML = mediaPreviewHtml(kind, media, {
        lightUrl: lightBlob ? URL.createObjectURL(lightBlob) : '',
        darkUrl: darkBlob ? URL.createObjectURL(darkBlob) : '',
      });
    } finally {
      formLoading.dismiss();
    }
  }

  const sizeHost = formEl.querySelector('[data-capture-component-size]');
  if (sizeHost) {
    const dim = mediaDimFields(kind, media);
    sizeHost.innerHTML = captureSizeField({ dimMode: dim.dimMode, dimValue: dim.dimValue });
    wireCaptureSizeField(formEl);
  }
}

// The library's leaf label for a media file: basename with the theme tail
// (-light-mode/-dark-mode + ext) stripped for pairs, or just the ext stripped
// for singles — mirrors mediaTree's baseId derivation.
function mediaLeafLabel(filename) {
  const base = (filename || '').split('/').pop() || '';
  const themed = base.replace(/-(?:light|dark)-mode\.[a-z0-9]+$/i, '');
  return themed !== base ? themed : base.replace(/\.[a-z0-9]+$/i, '');
}

// "Manage this capture/video/image" — jump from the component editor to the
// media-library entry form for the same file (Recapture / Replace via upload
// live there). Same dirty guard as breadcrumb navigation; the entry form's
// createForm call pushes a crumb since this overlay is already open.
registerFormAction('openMediaEntryFromComponent', async ({ formEl }) => {
  if (!formEl || !confirmDiscardIfDirty(formEl)) return;
  const { mediaKind, mediaLight, mediaDark, mediaSingle, mediaLabel } = formEl.dataset;
  if (mediaKind === 'video') {
    await getFormAction('openVideoEntry')?.({
      lightPath: mediaLight || undefined,
      darkPath: mediaDark || undefined,
      singlePath: mediaSingle || undefined,
      label: mediaLabel,
    });
  } else if (mediaKind === 'image') {
    await getFormAction('openImageEntry')?.({ singlePath: mediaSingle, label: mediaLabel });
  } else {
    await getFormAction('openCaptureEntry')?.({ lightPath: mediaLight, darkPath: mediaDark, label: mediaLabel });
  }
});

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
  const mediaKind = formEl.dataset.mediaKind;
  const isVideo = mediaKind === 'video';
  const isImage = mediaKind === 'image';
  const btn = content?.querySelector('[data-save-state]');
  setButtonBusy(btn, 'Saving…');

  const modeSel = formEl.querySelector('[name="dimMode"]');
  const valInput = formEl.querySelector('[name="dimValue"]');
  if (modeSel?.value === 'none' && valInput) valInput.value = '';

  const dimSpecs = [
    { name: 'dimMode', type: 'scalar', label: 'Dimension mode' },
    { name: 'dimValue', type: 'scalar', label: 'Dimension value' },
  ];
  const cornerSpec = { name: 'captureCorner', type: 'scalar', label: 'Corner rounding' };
  // Hidden radios must stay out of the spec (an image has no Theme, only a
  // video has Playback), or merge sees phantom conflicts on fields the form
  // never shows.
  const themedSpecs = [...dimSpecs, { name: 'captureTheme', type: 'scalar', label: 'Theme' }, cornerSpec];
  const fieldSpecs = isImage
    ? [...dimSpecs, cornerSpec]
    : isVideo
      ? [...themedSpecs, { name: 'videoPlayback', type: 'scalar', label: 'Playback' }]
      : themedSpecs;

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
        if (isImage) {
          const img = components.find(c => c.kind === 'image' && c.img.uuid === uuid)?.img;
          return imageDimFields(img);
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
          if (isImage && c.kind === 'image' && c.img.uuid === uuid) {
            return { kind: 'image', img: { ...c.img, dimMode: mode, dimValue, rounded } };
          }
          if (!isVideo && !isImage && c.kind === 'capture' && c.cap.uuid === uuid) {
            return { kind: 'capture', cap: { ...c.cap, dimMode: mode, dimValue, inversed, rounded } };
          }
          return c;
        });
        return handler.writeBody(md, container.uuid, description, next);
      },
      commit: ({ before }) => componentCommit('Edited', componentKindLabel(componentIn(handler, container, before, uuid)), before, uuid),
    });
    formEl._refreshSaveState?.();
  } catch (e) {
    formEl._refreshSaveState?.();
    alert('Failed to save: ' + e.message);
  }
});

registerFormAction('deleteCaptureComponent', async ({ formEl, content }) => {
  const noun = { video: 'video', image: 'image' }[formEl.dataset.mediaKind] ?? 'capture';
  if (!confirm(`Delete this ${noun}? This removes it from the page (the file stays in the library).`)) return;
  const { handler, container, uuid } = readContainerRef(formEl);
  if (!handler) return;
  const btn = content?.querySelector('[data-action="deleteCaptureComponent"]');
  const snap = snapshotButton(btn);
  setButtonBusy(btn, 'Deleting…');
  try {
    await handler.mutate(container, (components) =>
      components.filter(c => uuidOfComponent(c) !== uuid),
      s => setButtonBusy(btn, s),
      ({ before }) => componentCommit('Deleted', componentKindLabel(componentIn(handler, container, before, uuid)), before, uuid));
    await chrome.storage.local.remove('moreButtonsEditCaptureComponent');
    await navigateBack();
  } catch (e) {
    restoreButton(btn, snap);
    alert(`Failed to delete ${noun}: ` + e.message);
  }
});
