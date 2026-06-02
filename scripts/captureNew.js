import { createForm, navigateBack } from './form.js';
import { pushCaptures } from './captures.js';
import { captureCard, captureGrid } from './captureCards.js';
import { registerFormAction } from './formActions.js';

// `capture` is one entry from Capture Mode's session buffer: it carries
// lightDataUrl/darkDataUrl plus library-relative lightFilename/darkFilename
// (derived from the page path under occ-captures/…). pushCaptures writes those
// straight to docs/assets/<filename> on GitHub — the library root.
export async function openCaptureNew({ capture } = {}) {
  if (!capture?.lightDataUrl) return;

  const opener = () => openCaptureNew({ capture });
  const { formEl } = await createForm('captureNew', opener);
  if (!formEl) return;

  // form.js moves .more-buttons-form-actions out of <form>, so look up the
  // action controls on the parent overlay-content wrapper.
  const contentEl = formEl.parentElement ?? formEl;
  const bodyEl = formEl.querySelector('[data-capture-new-body]');
  const statusEl = contentEl.querySelector('[data-capture-new-status]');
  const saveBtn = contentEl.querySelector('[data-capture-new-save]');
  const cancelBtn = contentEl.querySelector('[data-capture-new-cancel]');

  bodyEl.innerHTML = captureGrid([
    captureCard({ theme: 'light', title: 'Light mode', src: capture.lightDataUrl, alt: 'light mode' }),
    captureCard({ theme: 'dark', title: 'Dark mode', src: capture.darkDataUrl, alt: 'dark mode' }),
  ]);

  const setStatus = (msg) => {
    if (!statusEl) return;
    statusEl.hidden = false;
    statusEl.textContent = msg;
  };

  async function save() {
    if (saveBtn) saveBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    try {
      await pushCaptures([capture], setStatus);
      setStatus('Saved to library.');
      navigateBack(); // replays openCaptureLibrary → re-fetches the tree
    } catch (e) {
      setStatus(`Failed: ${e.message}`);
      if (saveBtn) saveBtn.disabled = false;
      if (cancelBtn) cancelBtn.disabled = false;
    }
  }

  contentEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-capture-new-save]')) save();
    else if (e.target.closest('[data-capture-new-cancel]')) navigateBack();
  });
}

registerFormAction('openCaptureNew', openCaptureNew);
