/**
 * captureInsertNew.js — review form for a component-flow capture whose derived
 * path is NOT in the library yet.
 *
 * Opened by captures.js's finishComponentCapture (the post-shift-click
 * decision point). Nothing has been pushed when this form opens: the preview
 * tiles render the in-memory dataURLs, the proposed path is editable, and the
 * Dimension control sets the size the inserted markdown will carry.
 *
 *   - Insert this capture → probe the (possibly renamed) target path, resolve
 *     any collision through the standard conflict panel, push the PNG pair +
 *     metadata, then commit the component markdown via completeComponentInsert
 *     (which replays the origin form stack — the editor does NOT open).
 *   - Cancel → discard this capture and re-enter capture mode so another
 *     element can be picked (reenterComponentCapture in captures.js).
 */

import { createForm, setButtonBusy, snapshotButton, restoreButton } from './form.js';
import { pushCaptures, resolveCaptureConflict, overwriteCapturePair } from './captures.js';
import { githubPathExists } from './github.js';
import {
  captureCard, captureGrid, capturePathField, captureBasePath,
  captureSizeField, wireCaptureSizeField, readCaptureSizeField,
  captureThemeField, captureCornerField,
} from './captureCards.js';
import { registerFormAction, getFormAction } from './formActions.js';

export async function openCaptureInsertNew({ capture } = {}) {
  if (!capture?.lightDataUrl) return;

  const opener = () => openCaptureInsertNew({ capture });
  const { formEl, overlay } = await createForm('captureInsertNew', opener);
  if (!formEl) return;

  // form.js moves .more-buttons-form-actions out of <form>, so look up the
  // action controls on the parent overlay-content wrapper.
  const contentEl = formEl.parentElement ?? formEl;
  const bodyEl = formEl.querySelector('[data-capture-insert-new-body]');
  const insertBtn = contentEl.querySelector('[data-capture-insert-new-insert]');
  const cancelBtn = contentEl.querySelector('[data-capture-insert-new-cancel]');

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
    ]) +
    captureSizeField({ dimMode: capture.dimMode ?? 'height', dimValue: capture.dimValue ?? 50 })
    + (capture.darkDataUrl ? captureThemeField({ inversed: !!capture.inversed }) : '')
    + captureCornerField({ rounded: !!capture.rounded });
  wireCaptureSizeField(bodyEl);

  const pathInput = bodyEl.querySelector('[data-capture-path-input]');

  function currentBase() {
    const raw = (pathInput?.value ?? '').trim().replace(/^\/+|\/+$/g, '');
    return raw || originalBase;
  }

  let busy = false;

  async function insert() {
    if (busy) return;
    busy = true;
    // Progress rides the amber dock tag above the Insert tile (the shared
    // GitHub-commit language), not an inline status line.
    const snap = snapshotButton(insertBtn);
    setButtonBusy(insertBtn, 'Inserting…');
    if (cancelBtn) cancelBtn.disabled = true;
    let done = false; // true once the commit action takes over — leave it busy
    try {
      const base = currentBase();
      const light = `media/occ-captures/${base}-light-mode.png`;
      const dark = `media/occ-captures/${base}-dark-mode.png`;
      const lightPath = `docs/assets/${light}`;
      const darkPath = `docs/assets/${dark}`;

      // Re-probe at insert time: the user may have renamed onto an existing
      // path, or the path may have appeared since the post-capture probe.
      // pushCaptures is create-only, so pushing blind would silently no-op.
      let lightExists, darkExists;
      try {
        [lightExists, darkExists] = await Promise.all([
          githubPathExists(lightPath),
          githubPathExists(darkPath),
        ]);
      } catch (e) {
        alert(`Could not check for an existing capture: ${e.message}`);
        return;
      }

      if (lightExists || darkExists) {
        const keepMine = await resolveCaptureConflict({
          formEl, base, lightPath, lightExists, mineLightDataUrl: capture.lightDataUrl,
        });
        // User kept the existing capture — settle the button so they can rename
        // and retry, or cancel.
        if (!keepMine) return;
        await overwriteCapturePair({ lightPath, darkPath, lightExists, darkExists, capture, onProgress: s => setButtonBusy(insertBtn, s) });
      } else {
        await pushCaptures([{ ...capture, lightFilename: light, darkFilename: dark }], s => setButtonBusy(insertBtn, s));
      }

      // Files are up; hand a dataURL-less capture to the commit action so the
      // markdown splice references them without a second upload.
      const { dimMode, dimValue } = readCaptureSizeField(bodyEl);
      const readRadio = (name, fallback) =>
        bodyEl.querySelector(`[name="${name}"]:checked`)?.value ?? fallback;
      const inversed = !!capture.darkDataUrl && readRadio('captureTheme', 'default') === 'inversed';
      const rounded = readRadio('captureCorner', 'disabled') === 'enabled';
      done = true;
      await getFormAction('completeComponentInsert')?.({
        capture: { lightFilename: light, darkFilename: dark, dimMode, dimValue, inversed, rounded },
      });
    } catch (e) {
      done = false;
      alert(`Failed to insert capture: ${e.message}`);
    } finally {
      if (!done) {
        restoreButton(insertBtn, snap);
        if (cancelBtn) cancelBtn.disabled = false;
        busy = false;
      }
    }
  }

  function cancel() {
    // Back to capture mode to pick something else. Hide this overlay (the next
    // form's createForm — or a form-stack replay — tears it down) and unlock
    // body scroll for the selector, mirroring runComponentCaptureFlow's entry.
    overlay.style.display = 'none';
    document.body.style.overflow = '';
    getFormAction('reenterComponentCapture')?.();
  }

  contentEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-capture-insert-new-insert]')) insert();
    else if (e.target.closest('[data-capture-insert-new-cancel]')) cancel();
  });
}

registerFormAction('openCaptureInsertNew', openCaptureInsertNew);
