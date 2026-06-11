import { createForm, navigateBack } from './form.js';
import { pushCaptures, resolveCaptureConflict, overwriteCapturePair } from './captures.js';
import { githubPathExists } from './github.js';
import { captureCard, captureGrid, capturePathField, captureBasePath } from './captureCards.js';
import { registerFormAction } from './formActions.js';

// `capture` is one entry from Capture Mode's session buffer: it carries
// lightDataUrl/darkDataUrl plus library-relative lightFilename/darkFilename
// (derived from the page path under media/occ-captures/…). pushCaptures writes those
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

  // The proposed path is editable: the trimmed input value (sans surrounding
  // slashes) is the theme-agnostic base, with the original as fallback when
  // the field is emptied.
  const originalBase = captureBasePath(capture.lightFilename);

  bodyEl.innerHTML =
    capturePathField({
      label: 'Proposed capture path',
      value: originalBase,
      editable: true,
      hint: 'Warning: Only rename this path for legitimate reasons. The majority of the time you will want to utilise the automatically generated path',
    }) +
    captureGrid([
      captureCard({ theme: 'light', title: 'Light mode', src: capture.lightDataUrl, alt: 'light mode' }),
      captureCard({ theme: 'dark', title: 'Dark mode', src: capture.darkDataUrl, alt: 'dark mode' }),
    ]);

  const pathInput = bodyEl.querySelector('[data-capture-path-input]');

  function currentBase() {
    const raw = (pathInput?.value ?? '').trim().replace(/^\/+|\/+$/g, '');
    return raw || originalBase;
  }

  const setStatus = (msg) => {
    if (!statusEl) return;
    statusEl.hidden = false;
    statusEl.textContent = msg;
  };

  let busy = false;

  async function save() {
    if (busy) return;
    busy = true;
    if (saveBtn) saveBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    try {
      const base = currentBase();
      const light = `media/occ-captures/${base}-light-mode.png`;
      const dark = `media/occ-captures/${base}-dark-mode.png`;
      const lightPath = `docs/assets/${light}`;
      const darkPath = `docs/assets/${dark}`;

      // Probe both theme files of the (possibly renamed) target. pushCaptures
      // is create-only, so saving onto an existing path would silently no-op —
      // surface a failed probe as an error rather than pushing blind.
      let lightExists, darkExists;
      try {
        [lightExists, darkExists] = await Promise.all([
          githubPathExists(lightPath),
          githubPathExists(darkPath),
        ]);
      } catch (e) {
        setStatus(`Could not check for an existing capture: ${e.message}`);
        return;
      }

      capture.lightFilename = light;
      capture.darkFilename = dark;

      if (lightExists || darkExists) {
        const keepMine = await resolveCaptureConflict({
          formEl, base, lightPath, lightExists, mineLightDataUrl: capture.lightDataUrl,
        });
        if (!keepMine) {
          setStatus('Kept the existing capture — rename the path to save yours separately.');
          return;
        }
        await overwriteCapturePair({ lightPath, darkPath, lightExists, darkExists, capture, onProgress: setStatus });
      } else {
        await pushCaptures([capture], setStatus);
      }
      setStatus('Saved to library.');
      navigateBack(); // replays openCaptureLibrary → re-fetches the tree
    } catch (e) {
      setStatus(`Failed: ${e.message}`);
    } finally {
      busy = false;
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
