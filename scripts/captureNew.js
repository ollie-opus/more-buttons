import { createForm, navigateBack } from './form.js';
import { pushCaptures } from './captures.js';
import { githubPathExists, githubReplaceImage, githubPushImageIfNotExists } from './github.js';
import { writeCaptureMeta } from './captureMeta.js';
import { readRepoBlob } from './repoClient.js';
import { captureCard, captureGrid, capturePathField, captureBasePath } from './captureCards.js';
import { showConflictResolver, ResolveCancelled } from './conflictResolver.js';
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

  // A clash with a stored capture is resolved through the standard conflict
  // panel (conflictResolver.js — the same UI guides use for concurrent-edit
  // conflicts): one "Capture" field whose tiles carry the stored light
  // thumbnail vs this capture's. Resolves true only when the user picks
  // "Yours (overwrite)"; picking theirs or cancelling keeps the library
  // untouched. The stored thumbnail comes via the contents API (readRepoBlob),
  // not the raw CDN, so a recently replaced capture can't show stale bytes; a
  // failed fetch just drops the thumbnail (text-only tile).
  async function resolveExistingConflict({ base, lightPath, lightExists }) {
    const theirsBlob = lightExists ? await readRepoBlob(lightPath).catch(() => null) : null;
    const theirsUrl = theirsBlob ? URL.createObjectURL(theirsBlob) : '';
    try {
      const choices = await showConflictResolver(
        formEl,
        [{ field: 'capture', label: 'Capture', mine: ['mine'], theirs: ['theirs'] }],
        {
          describe: (token) => ({
            kind: 'capture',
            thumbSrc: token === 'mine' ? capture.lightDataUrl : theirsUrl,
          }),
          head: 'A capture already exists at this path',
          desc: `The library already has a capture at "${base}". Keep the existing one (you can rename the path and save again), or overwrite it with this capture.`,
        },
      );
      return choices.capture === 'mine';
    } catch (e) {
      if (e instanceof ResolveCancelled) return false;
      throw e;
    } finally {
      if (theirsUrl) URL.revokeObjectURL(theirsUrl);
    }
  }

  // "Yours (overwrite)": replace the stored files with this capture. Replace
  // what's there and create what isn't (a manual rename can land on a
  // half-existing pair), then upsert the manifest entry so padding/resized
  // follow the new bytes — the same writes captureEntry's recapture save does.
  async function overwriteExisting({ lightPath, darkPath, lightExists, darkExists }) {
    const lightB64 = capture.lightDataUrl.split(',')[1];
    const darkB64 = capture.darkDataUrl.split(',')[1];
    await (lightExists
      ? githubReplaceImage(lightPath, lightB64, setStatus)
      : githubPushImageIfNotExists(lightPath, lightB64, setStatus));
    await (darkExists
      ? githubReplaceImage(darkPath, darkB64, setStatus)
      : githubPushImageIfNotExists(darkPath, darkB64, setStatus));
    await writeCaptureMeta(
      [{ lightPath, resized: !!capture.resized, padding: capture.padding || 0 }],
      setStatus,
    );
  }

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
        const keepMine = await resolveExistingConflict({ base, lightPath, lightExists });
        if (!keepMine) {
          setStatus('Kept the existing capture — rename the path to save yours separately.');
          return;
        }
        await overwriteExisting({ lightPath, darkPath, lightExists, darkExists });
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
