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

import { createForm, navigateBack, resetDirtyBaseline } from './form.js';
import { readRepoBlob } from './repoClient.js';
import { captureCard, captureGrid } from './captureCards.js';
import { registerFormAction } from './formActions.js';
import { getComponentContainer } from './componentContainers.js';

function applyDimAuto(formEl) {
  const dim = formEl.querySelector('[data-capture-component-dim]');
  const sel = formEl.querySelector('[name="dimMode"]');
  if (!dim || !sel) return;
  const isAuto = sel.value === 'none';
  dim.classList.toggle('--auto', isAuto);
  const val = dim.querySelector('[name="dimValue"]');
  if (val) val.disabled = isAuto;
}

/**
 * @param {Object} opts
 * @param {{kind:string, uuid:string}} opts.container - the owning container.
 * @param {number} opts.index - component index of this capture within the container.
 * @param {{lightFilename,darkFilename,dimMode,dimValue}} opts.cap
 */
export async function openEditCaptureComponent({ container, index, cap } = {}) {
  if (!container || !cap) return;
  const opener = () => openEditCaptureComponent({ container, index, cap });

  await chrome.storage.local.set({
    moreButtonsEditCaptureComponent: { dimMode: cap.dimMode ?? 'none', dimValue: cap.dimValue ?? 50 },
  });

  const { formEl } = await createForm('editCaptureComponent', opener);
  if (!formEl) return;
  formEl.dataset.containerKind = container.kind;
  formEl.dataset.containerUuid = container.uuid;
  formEl.dataset.containerFile = container.file;
  formEl.dataset.componentIndex = String(index);

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
    index: parseInt(formEl.dataset.componentIndex, 10),
  };
}

registerFormAction('submitEditCaptureComponent', async ({ formEl, content }) => {
  const { handler, container, index } = readContainerRef(formEl);
  if (!handler) return;
  const btn = content?.querySelector('[data-action="submitEditCaptureComponent"]');
  const originalText = btn?.textContent;
  if (btn) btn.disabled = true;
  try {
    const mode = formEl.querySelector('[name="dimMode"]')?.value ?? 'none';
    const rawVal = parseInt(formEl.querySelector('[name="dimValue"]')?.value, 10);
    const dimValue = mode === 'none' ? null : (Number.isFinite(rawVal) && rawVal > 0 ? rawVal : 50);

    await handler.mutate(container, (components) => {
      const c = components[index];
      if (!c || c.kind !== 'capture') return components;
      const next = components.slice();
      next[index] = { kind: 'capture', cap: { ...c.cap, dimMode: mode, dimValue } };
      return next;
    }, s => { if (btn) btn.textContent = s; });

    await chrome.storage.local.remove('moreButtonsEditCaptureComponent');
    await navigateBack();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    alert('Failed to save capture: ' + e.message);
  }
});

registerFormAction('deleteCaptureComponent', async ({ formEl, content }) => {
  if (!confirm('Delete this capture? This removes it from the page (the image stays in the library).')) return;
  const { handler, container, index } = readContainerRef(formEl);
  if (!handler) return;
  const btn = content?.querySelector('[data-action="deleteCaptureComponent"]');
  const originalText = btn?.textContent;
  if (btn) btn.disabled = true;
  try {
    await handler.mutate(container, (components) => {
      const c = components[index];
      if (!c || c.kind !== 'capture') return components;
      const next = components.slice();
      next.splice(index, 1);
      return next;
    }, s => { if (btn) btn.textContent = s; });

    await chrome.storage.local.remove('moreButtonsEditCaptureComponent');
    await navigateBack();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    alert('Failed to delete capture: ' + e.message);
  }
});
