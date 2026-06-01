import { createForm, snapshotFormStack } from './form.js';
import { readRepoBlob } from './repoClient.js';
import { enterCaptureMode } from './captureMode.js';
import { githubReplaceImage } from './github.js';
import { registerFormAction } from './formActions.js';

// lightPath / darkPath are repo-relative paths like "docs/assets/occ-captures/foo-light-mode.png"
export async function openCaptureEntry({ lightPath, darkPath, label } = {}) {
  if (!lightPath) return;

  const opener = () => openCaptureEntry({ lightPath, darkPath, label });
  const { formEl, overlay } = await createForm('captureEntry', opener);
  if (!formEl) return;

  // form.js moves .more-buttons-form-actions out of <form>, so look up
  // actionsEl on the parent overlay-content wrapper instead of formEl.
  const contentEl = formEl.parentElement ?? formEl;
  const titleEl = formEl.querySelector('[data-capture-entry-title]');
  const bodyEl = formEl.querySelector('[data-capture-entry-body]');
  const actionsEl = contentEl.querySelector('[data-capture-entry-actions]');
  if (titleEl && label) titleEl.textContent = label;

  // We fetch each image via the contents API (readRepoBlob) instead of using
  // assetCdnUrl, because raw.githubusercontent.com has a ~5 minute Fastly
  // cache window — a freshly-overridden capture would keep showing the old
  // bytes from that CDN. The API bypasses the CDN entirely.
  let lightObjectUrl = '';
  let darkObjectUrl = '';
  const revokeUrl = (url) => { if (url?.startsWith('blob:')) URL.revokeObjectURL(url); };

  async function loadRepoImages() {
    const [lightBlob, darkBlob] = await Promise.all([
      readRepoBlob(lightPath).catch(() => null),
      darkPath ? readRepoBlob(darkPath).catch(() => null) : Promise.resolve(null),
    ]);
    revokeUrl(lightObjectUrl);
    revokeUrl(darkObjectUrl);
    lightObjectUrl = lightBlob ? URL.createObjectURL(lightBlob) : '';
    darkObjectUrl = darkBlob ? URL.createObjectURL(darkBlob) : '';
  }

  let pendingCapture = null; // { lightDataUrl, darkDataUrl }

  function themeCard(theme, title, src, alt) {
    if (!src) return '';
    return `
      <figure class="mb-capture-card mb-capture-card--${theme}">
        <figcaption class="mb-capture-card__title">${title}</figcaption>
        <div class="mb-capture-card__image-wrap">
          <img class="mb-capture-card__img" src="${src}" alt="${alt}">
        </div>
      </figure>
    `;
  }

  function renderPreview() {
    bodyEl.innerHTML = `
      <div class="mb-capture-entry-grid">
        ${themeCard('light', 'Light mode', lightObjectUrl, label ?? 'light mode')}
        ${themeCard('dark', 'Dark mode', darkObjectUrl, `${label ?? 'capture'} (dark)`)}
      </div>
    `;
    actionsEl.innerHTML = `<button type="button" class="more-buttons-button" data-capture-entry-override>Recapture</button>`;
  }

  function renderCompare() {
    if (!pendingCapture) return;
    bodyEl.innerHTML = `
      <div class="mb-capture-entry-grid">
        ${themeCard('light', 'Light mode (Old)', lightObjectUrl, 'old light mode')}
        ${themeCard('dark', 'Dark mode (Old)', darkObjectUrl, 'old dark mode')}
        ${themeCard('light', 'Light mode (New)', pendingCapture.lightDataUrl, 'new light mode')}
        ${themeCard('dark', 'Dark mode (New)', pendingCapture.darkDataUrl, 'new dark mode')}
      </div>
    `;
    actionsEl.innerHTML = `
      <span class="more-buttons-description" data-capture-entry-status hidden></span>
      <button type="button" class="more-buttons-button secondary" data-capture-entry-cancel>Cancel</button>
      <button type="button" class="more-buttons-button" data-capture-entry-save>Save Changes</button>
    `;
  }

  function startOverride() {
    const formStackSnapshot = snapshotFormStack();
    overlay.style.display = 'none';
    const prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = '';

    enterCaptureMode({
      saveTarget: 'session',
      maxCaptures: 1,
      formStackSnapshot,
      returnTo: {
        onComplete: (buffer) => {
          if (formEl.isConnected) {
            overlay.style.display = '';
            document.body.style.overflow = prevBodyOverflow;
          }
          if (buffer.length) {
            pendingCapture = buffer[0];
            renderCompare();
          }
        },
      },
    });
  }

  async function saveChanges() {
    if (!pendingCapture) return;
    const statusEl = actionsEl.querySelector('[data-capture-entry-status]');
    const saveBtn = actionsEl.querySelector('[data-capture-entry-save]');
    const cancelBtn = actionsEl.querySelector('[data-capture-entry-cancel]');
    const setStatus = (msg) => {
      if (!statusEl) return;
      statusEl.hidden = false;
      statusEl.textContent = msg;
    };
    if (saveBtn) saveBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;

    try {
      await githubReplaceImage(lightPath, pendingCapture.lightDataUrl.split(',')[1], setStatus);
      if (darkPath && pendingCapture.darkDataUrl) {
        await githubReplaceImage(darkPath, pendingCapture.darkDataUrl.split(',')[1], setStatus);
      }
      setStatus('Saved. Refreshing preview…');
      pendingCapture = null;
      await loadRepoImages();
      renderPreview();
    } catch (e) {
      setStatus(`Failed: ${e.message}`);
      if (saveBtn) saveBtn.disabled = false;
      if (cancelBtn) cancelBtn.disabled = false;
    }
  }

  // form.js moves .more-buttons-form-actions out of <form> into the content
  // wrapper, so listen on the parent to catch action-button clicks.
  (formEl.parentElement ?? formEl).addEventListener('click', (e) => {
    if (e.target.closest('[data-capture-entry-override]')) {
      startOverride();
    } else if (e.target.closest('[data-capture-entry-save]')) {
      saveChanges();
    } else if (e.target.closest('[data-capture-entry-cancel]')) {
      pendingCapture = null;
      renderPreview();
    }
  });

  bodyEl.innerHTML = '<p class="more-buttons-description">Loading…</p>';
  await loadRepoImages();
  renderPreview();
}

registerFormAction('openCaptureEntry', openCaptureEntry);
