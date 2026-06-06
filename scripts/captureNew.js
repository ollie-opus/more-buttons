import { createForm, navigateBack } from './form.js';
import { pushCaptures } from './captures.js';
import { githubPathExists } from './github.js';
import { captureCard, captureGrid, capturePathField, captureBasePath } from './captureCards.js';
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

  bodyEl.innerHTML =
    capturePathField({ label: 'Proposed capture path', value: captureBasePath(capture.lightFilename) }) +
    captureGrid([
      captureCard({ theme: 'light', title: 'Light mode', src: capture.lightDataUrl, alt: 'light mode' }),
      captureCard({ theme: 'dark', title: 'Dark mode', src: capture.darkDataUrl, alt: 'dark mode' }),
    ]);

  const setStatus = (msg) => {
    if (!statusEl) return;
    statusEl.hidden = false;
    statusEl.textContent = msg;
  };

  // A new capture writes to docs/assets/<lightFilename>, derived purely from
  // the element + page path + theme — padding/resize are NOT in the name. So
  // recapturing the same element resolves to the same path. The save flow is
  // create-only (it never overwrites an existing PNG or its metadata), which
  // would make a save silently no-op. Detect that up front and block the save
  // with an in-button warning instead of letting it look like it succeeded.
  const lightPath = `docs/assets/${capture.lightFilename}`;
  let alreadyExists = false;

  function markAlreadyExists() {
    alreadyExists = true;
    if (!saveBtn) return;
    saveBtn.disabled = true;
    saveBtn.classList.remove('success');
    saveBtn.classList.add('warn');
    saveBtn.innerHTML =
      '<span class="more-buttons-icon">warning</span>Capture already exists';
    saveBtn.title =
      'A capture for this element already exists in the library. ' +
      'Delete it from the library first to recapture.';
  }

  async function save() {
    if (alreadyExists) return;
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

  // Probe for an existing capture while the preview renders. Disable save until
  // we know, so a quick click can't push before the check resolves. A failed
  // probe (offline/auth) leaves save enabled — pushCaptures stays create-only,
  // so the worst case is a no-op, never a clobber.
  if (saveBtn) saveBtn.disabled = true;
  try {
    if (await githubPathExists(lightPath)) markAlreadyExists();
    else if (saveBtn) saveBtn.disabled = false;
  } catch {
    if (saveBtn) saveBtn.disabled = false;
  }
}

registerFormAction('openCaptureNew', openCaptureNew);
