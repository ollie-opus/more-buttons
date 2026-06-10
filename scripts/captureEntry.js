import { createForm, snapshotFormStack, replayFormStack } from './form.js';
import { readRepoBlob } from './repoClient.js';
import { enterCaptureMode } from './captureMode.js';
import { githubReplaceImage } from './github.js';
import { writeCaptureMeta } from './captureMeta.js';
import { captureCard, captureGrid, capturePathField, captureBasePath } from './captureCards.js';
import { registerFormAction, getFormAction } from './formActions.js';
import { formLoading } from './loading.js';

// Cold-DOM hand-off for the recapture round-trip. While the user hunts for an
// element in Capture Mode they can navigate to other pages; a Turbo navigation
// swaps <body>, which detaches this form's DOM even though the JS context (and
// captureMode's returnTo closure) survives. In that case we replay the form
// stack to rebuild the entry from scratch and stash the freshly captured buffer
// here so the rebuilt openCaptureEntry can resume straight into the compare
// view instead of the plain preview. Keyed by lightPath so a rebuilt entry only
// consumes the hand-off meant for it. (Mirrors runComponentCaptureFlow's cold
// path in captures.js — the working pattern the component editors already use.)
let pendingRecapture = null; // { lightPath, capture } | null

// lightPath / darkPath are repo-relative paths like "docs/assets/occ-captures/foo-light-mode.png"
export async function openCaptureEntry({ lightPath, darkPath, label, mode } = {}) {
  if (!lightPath) return;

  const insertMode = mode === 'insert';
  const opener = () => openCaptureEntry({ lightPath, darkPath, label, mode });
  const { formEl, overlay } = await createForm('captureEntry', opener);
  if (!formEl) return;

  // form.js moves .more-buttons-form-actions out of <form>, so look up
  // actionsEl on the parent overlay-content wrapper instead of formEl.
  const contentEl = formEl.parentElement ?? formEl;
  const titleEl = formEl.querySelector('[data-capture-entry-title]');
  const bodyEl = formEl.querySelector('[data-capture-entry-body]');
  const actionsEl = contentEl.querySelector('[data-capture-entry-actions]');
  if (titleEl && label) titleEl.textContent = label;

  // Theme-agnostic, root-relative path shown read-only above the previews.
  const displayPath = captureBasePath(lightPath);

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

  function renderPreview() {
    bodyEl.innerHTML =
      capturePathField({ label: 'Capture path', value: displayPath }) +
      captureGrid([
        captureCard({ theme: 'light', title: 'Light mode', src: lightObjectUrl, alt: label ?? 'light mode' }),
        captureCard({ theme: 'dark', title: 'Dark mode', src: darkObjectUrl, alt: `${label ?? 'capture'} (dark)` }),
      ]);
    actionsEl.innerHTML = insertMode
      ? `<button type="button" class="more-buttons-button" data-capture-entry-insert><span class="more-buttons-icon">add</span>Insert this capture</button>`
      : `<button type="button" class="more-buttons-button" data-capture-entry-override><span class="more-buttons-icon">swap_vertical_circle</span>Recapture</button>`;
  }

  // Insert mode: reference the existing library asset (no upload). Strip the
  // repo "docs/assets/" prefix so the filename matches what buildCaptureLines
  // expects, then hand off to captures.js to splice it into the origin form.
  function insertIntoForm() {
    const STRIP = 'docs/assets/';
    const stripPrefix = (p) => (p.startsWith(STRIP) ? p.slice(STRIP.length) : p);
    const lightFilename = stripPrefix(lightPath);
    const darkFilename = darkPath
      ? stripPrefix(darkPath)
      : lightFilename.replace('-light-mode', '-dark-mode');
    getFormAction('completeLibraryInsert')?.({
      capture: { lightFilename, darkFilename, dimMode: 'none', dimValue: null },
    });
  }

  function renderCompare() {
    if (!pendingCapture) return;
    bodyEl.innerHTML =
      capturePathField({ label: 'Capture path', value: displayPath }) +
      captureGrid([
        captureCard({ theme: 'light', title: 'Light mode (Old)', src: lightObjectUrl, alt: 'old light mode' }),
        captureCard({ theme: 'dark', title: 'Dark mode (Old)', src: darkObjectUrl, alt: 'old dark mode' }),
        captureCard({ theme: 'light', title: 'Light mode (New)', src: pendingCapture.lightDataUrl, alt: 'new light mode' }),
        captureCard({ theme: 'dark', title: 'Dark mode (New)', src: pendingCapture.darkDataUrl, alt: 'new dark mode' }),
      ]);
    actionsEl.innerHTML = `
      <span class="more-buttons-description" data-capture-entry-status hidden></span>
      <button type="button" class="more-buttons-button secondary" data-capture-entry-cancel><span class="more-buttons-icon">close</span>Cancel</button>
      <button type="button" class="more-buttons-button success" data-capture-entry-save><span class="more-buttons-icon">save</span>Save Changes</button>
    `;
  }

  function startOverride() {
    const formStackSnapshot = snapshotFormStack();
    overlay.style.display = 'none';
    const prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = '';

    enterCaptureMode({
      maxCaptures: 1,
      formStackSnapshot,
      returnTo: {
        onComplete: async (buffer) => {
          // Hot path: same JS context AND the form is still in the document
          // (capture happened on this page, no navigation). Re-show the
          // overlay in place and jump to compare.
          if (formEl.isConnected) {
            overlay.style.display = '';
            document.body.style.overflow = prevBodyOverflow;
            if (buffer.length) {
              pendingCapture = buffer[0];
              renderCompare();
            }
            return;
          }
          // Cold-DOM path: a Turbo navigation swapped <body> and detached this
          // form. Rebuild the form stack from the serialisable snapshot, then
          // hand the buffer to the rebuilt entry (via pendingRecapture) so it
          // resumes in the compare view.
          if (!buffer.length || !formStackSnapshot?.length) return;
          pendingRecapture = { lightPath, capture: buffer[0] };
          await replayFormStack(formStackSnapshot);
        },
        // ✕ / Esc: re-show the form untouched when it's still here; after a
        // navigation there's nothing in the DOM to re-show (matches the
        // component flow's cancel semantics).
        onCancel: () => {
          if (formEl.isConnected) {
            overlay.style.display = '';
            document.body.style.overflow = prevBodyOverflow;
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
      await writeCaptureMeta(
        [{ lightPath, resized: !!pendingCapture.resized, padding: pendingCapture.padding || 0 }],
        setStatus,
      );
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
    if (e.target.closest('[data-capture-entry-insert]')) {
      insertIntoForm();
    } else if (e.target.closest('[data-capture-entry-override]')) {
      startOverride();
    } else if (e.target.closest('[data-capture-entry-save]')) {
      saveChanges();
    } else if (e.target.closest('[data-capture-entry-cancel]')) {
      pendingCapture = null;
      renderPreview();
    }
  });

  formLoading.show();
  try {
    await loadRepoImages();
  } finally {
    formLoading.dismiss();
  }

  // If a recapture round-trip detached this form and we just replayed it to get
  // back here, resume straight into the compare view with the buffered capture.
  if (pendingRecapture && pendingRecapture.lightPath === lightPath) {
    pendingCapture = pendingRecapture.capture;
    pendingRecapture = null;
    renderCompare();
  } else {
    renderPreview();
  }
}

registerFormAction('openCaptureEntry', openCaptureEntry);
