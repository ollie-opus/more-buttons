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
import { registerFormAction } from './formActions.js';
import { getComponentContainer } from './componentContainers.js';
import { captureDimFields } from './components.js';
import { mergeSave } from './mergeSave.js';
import { formLoading } from './loading.js';

/**
 * @param {Object} opts
 * @param {{kind:string, uuid:string}} opts.container - the owning container.
 * @param {string} opts.uuid - the capture component's UUID.
 * @param {{lightFilename,darkFilename,dimMode,dimValue}} opts.cap
 */
export async function openEditCaptureComponent({ container, uuid, cap } = {}) {
  if (!container || !cap) return;
  const opener = () => openEditCaptureComponent({ container, uuid, cap });

  // Seed the form with the same normalization readFresh applies to markdown
  // (dimValue '' when auto) — the merge baseline snapshots these values, so an
  // unedited auto capture must compare equal to its freshly-parsed self.
  await chrome.storage.local.set({
    moreButtonsEditCaptureComponent: captureDimFields(cap),
  });

  const { formEl } = await createForm('editCaptureComponent', opener);
  if (!formEl) return;
  formEl.dataset.containerKind = container.kind;
  formEl.dataset.containerUuid = container.uuid;
  formEl.dataset.containerFile = container.file;
  formEl.dataset.componentUuid = uuid;

  const previewEl = formEl.querySelector('[data-capture-component-preview]');
  if (previewEl) {
    formLoading.show();
    try {
      const [lightBlob, darkBlob] = await Promise.all([
        readRepoBlob('docs/assets/' + cap.lightFilename).catch(() => null),
        cap.darkFilename ? readRepoBlob('docs/assets/' + cap.darkFilename).catch(() => null) : Promise.resolve(null),
      ]);
      const lightUrl = lightBlob ? URL.createObjectURL(lightBlob) : '';
      const darkUrl = darkBlob ? URL.createObjectURL(darkBlob) : '';
      previewEl.innerHTML = captureGrid([
        captureCard({ theme: 'light', title: 'Light mode', src: lightUrl, alt: 'light mode' }),
        captureCard({ theme: 'dark', title: 'Dark mode', src: darkUrl, alt: 'dark mode' }),
      ]);
    } finally {
      formLoading.dismiss();
    }
  }

  // The Dimension control is injected (not static HTML) so its markup comes
  // from the shared captureSizeField helper. Render from captureDimFields so
  // an untouched form matches the storage seed exactly (dimValue '' on auto)
  // — the merge baseline depends on that equality.
  const sizeHost = formEl.querySelector('[data-capture-component-size]');
  if (sizeHost) {
    const dim = captureDimFields(cap);
    sizeHost.innerHTML = captureSizeField({ dimMode: dim.dimMode, dimValue: dim.dimValue });
    wireCaptureSizeField(formEl);
  }
  resetDirtyBaseline(formEl);
}

registerFormAction('openEditCaptureComponent', openEditCaptureComponent);

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
  const btn = content?.querySelector('[data-save-state]');
  setButtonBusy(btn, 'Saving…');

  // Normalize the form so dimValue is '' whenever the mode is 'none' — this
  // keeps `cur` and `fresh` equal for an untouched auto capture (no false
  // conflict). The number input is disabled in 'none' mode but still reports
  // its stale .value to readFormValues, so blank it explicitly.
  const modeSel = formEl.querySelector('[name="dimMode"]');
  const valInput = formEl.querySelector('[name="dimValue"]');
  if (modeSel?.value === 'none' && valInput) valInput.value = '';

  try {
    await mergeSave({
      formEl,
      file: container.file,
      onProgress: s => setButtonBusy(btn, s),
      fieldSpecs: [
        { name: 'dimMode', type: 'scalar', label: 'Dimension mode' },
        { name: 'dimValue', type: 'scalar', label: 'Dimension value' },
        { name: 'captureTheme', type: 'scalar', label: 'Theme' },
        { name: 'captureCorner', type: 'scalar', label: 'Corner rounding' },
      ],
      readFresh: md => {
        const { components } = handler.readComponents(md, container.uuid);
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
        const next = components.map(c =>
          (c.kind === 'capture' && c.cap.uuid === uuid)
            ? { kind: 'capture', cap: { ...c.cap, dimMode: mode, dimValue, inversed, rounded } }
            : c);
        return handler.writeBody(md, container.uuid, description, next);
      },
    });
    formEl._refreshSaveState?.();
  } catch (e) {
    formEl._refreshSaveState?.();
    alert('Failed to save capture: ' + e.message);
  }
});

registerFormAction('deleteCaptureComponent', async ({ formEl, content }) => {
  if (!confirm('Delete this capture? This removes it from the page (the image stays in the library).')) return;
  const { handler, container, uuid } = readContainerRef(formEl);
  if (!handler) return;
  const btn = content?.querySelector('[data-action="deleteCaptureComponent"]');
  const snap = snapshotButton(btn);
  setButtonBusy(btn, 'Deleting…'); // disable immediately — no double-click window
  try {
    await handler.mutate(container, (components) =>
      components.filter(c => !(c.kind === 'capture' && c.cap.uuid === uuid)),
      s => setButtonBusy(btn, s));

    await chrome.storage.local.remove('moreButtonsEditCaptureComponent');
    await navigateBack();
  } catch (e) {
    restoreButton(btn, snap);
    alert('Failed to delete capture: ' + e.message);
  }
});
