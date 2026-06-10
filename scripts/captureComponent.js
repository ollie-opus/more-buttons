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

import { createForm, navigateBack, resetDirtyBaseline, setButtonBusy } from './form.js';
import { readRepoBlob } from './repoClient.js';
import { captureCard, captureGrid } from './captureCards.js';
import { registerFormAction } from './formActions.js';
import { getComponentContainer } from './componentContainers.js';
import { captureDimFields } from './components.js';
import { mergeSave } from './mergeSave.js';

function applyDimAuto(formEl) {
  const dim = formEl.querySelector('[data-capture-component-dim]');
  const sel = formEl.querySelector('[name="dimMode"]');
  if (!dim || !sel) return;
  const isAuto = sel.value === 'none';
  dim.classList.toggle('--auto', isAuto);
  const val = dim.querySelector('[name="dimValue"]');
  if (val) {
    val.disabled = isAuto;
    // Auto captures are seeded with an empty value (see captureDimFields);
    // offer the 50px default once the user actually picks a dimension.
    if (!isAuto && val.value === '') val.value = '50';
  }
}

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
    previewEl.innerHTML = '<p class="more-buttons-description">Loading…</p>';
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
  }

  const sel = formEl.querySelector('[name="dimMode"]');
  if (sel) {
    sel.value = cap.dimMode ?? 'none';
    sel.addEventListener('change', () => applyDimAuto(formEl));
  }
  applyDimAuto(formEl);
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
        const next = components.map(c =>
          (c.kind === 'capture' && c.cap.uuid === uuid)
            ? { kind: 'capture', cap: { ...c.cap, dimMode: mode, dimValue } }
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
  const originalText = btn?.textContent;
  if (btn) btn.disabled = true;
  try {
    await handler.mutate(container, (components) =>
      components.filter(c => !(c.kind === 'capture' && c.cap.uuid === uuid)),
      s => { if (btn) btn.textContent = s; });

    await chrome.storage.local.remove('moreButtonsEditCaptureComponent');
    await navigateBack();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    alert('Failed to delete capture: ' + e.message);
  }
});
