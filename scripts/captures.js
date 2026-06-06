/**
 * captures.js — Capture markdown round-trip + Components capture acquisition.
 *
 * The actual selector / screenshot lifecycle now lives in captureMode.js
 * (the Capture Mode controller). This module is now only the "form glue":
 *
 *   - buildCaptureLines round-trips the `![](../assets/...)` markdown body.
 *   - resolveCaptures / pushCaptures publish captured images to GitHub.
 *   - runComponentCaptureFlow / runComponentLibraryInsert acquire a capture
 *     (screenshot or library) and commit it straight into a container's
 *     markdown via the componentContainers registry.
 */

import { registerFormAction, getFormAction } from './formActions.js';
import { snapshotFormStack, replayFormStack } from './form.js';
import { enterCaptureMode } from './captureMode.js';
import { githubPushImageIfNotExists } from './github.js';
import { generateUUID } from './admonitions.js';
import { getComponentContainer } from './componentContainers.js';

// ── Parsing ───────────────────────────────────────────────────────────────────

export function buildCaptureLines(list = []) {
  return list.flatMap(c => {
    const light = `![](../assets/${c.lightFilename}#only-light)`;
    const dark  = `![](../assets/${c.darkFilename}#only-dark)`;
    if (c.dimMode === 'none') {
      return ['', light, dark];
    }
    const v = c.dimValue ?? 50;
    const dimAttr = c.dimMode === 'width' ? `width="${v}"` : `style="height: ${v}px"`;
    return [
      '',
      `${light}{ ${dimAttr} loading=lazy }`,
      `${dark}{ ${dimAttr} loading=lazy }`,
    ];
  });
}

// ── Publish ───────────────────────────────────────────────────────────────────

export function resolveCaptures(list) {
  return list.map(c => {
    if (c.lightDataUrl && c.addToLibrary === false) {
      const id = generateUUID();
      return {
        ...c,
        lightFilename: `occ-captures/uncategorised/${id}-light-mode.png`,
        darkFilename:  `occ-captures/uncategorised/${id}-dark-mode.png`,
      };
    }
    return c;
  });
}

export async function pushCaptures(list = [], onProgress) {
  for (const c of list) {
    if (!c.lightDataUrl) continue;
    await githubPushImageIfNotExists(`docs/assets/${c.lightFilename}`, c.lightDataUrl.split(',')[1], onProgress);
    await githubPushImageIfNotExists(`docs/assets/${c.darkFilename}`, c.darkDataUrl.split(',')[1], onProgress);
  }
}

// ── Components: capture acquisition that commits immediately ───────────────────
//
// In the unified "Components" list, a capture lives in the markdown like an
// admonition — adding it commits straight to the container's draft. These flows
// acquire a capture (screenshot or library), upload any new image bytes, then
// ask the container (via the componentContainers registry) to splice a capture
// component into its ordered list at `insertAt`. The open editor then re-renders.

async function commitCapturesIntoContainer(container, insertAt, capList) {
  const handler = getComponentContainer(container.kind);
  if (!handler) return;
  const resolved = resolveCaptures(capList);
  await pushCaptures(resolved);
  const caps = resolved.map(c => ({
    lightFilename: c.lightFilename,
    darkFilename: c.darkFilename,
    dimMode: c.dimMode ?? 'height',
    dimValue: c.dimMode === 'none' ? null : (c.dimValue ?? 50),
  }));
  await handler.mutate(container, (components) => {
    const idx = Math.max(0, Math.min(insertAt, components.length));
    const next = components.slice();
    next.splice(idx, 0, ...caps.map(cap => ({ kind: 'capture', cap })));
    return next;
  });
}

// "Create a new capture" → screenshot → upload → splice into the container at idx.
export function runComponentCaptureFlow({ container, insertAt, formEl, overlay }) {
  const formStackSnapshot = snapshotFormStack();
  overlay.style.display = 'none';
  const prevBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = '';

  enterCaptureMode({
    saveTarget: 'session',
    formStackSnapshot,
    returnTo: {
      onComplete: async (sessionBuffer) => {
        if (formEl.isConnected) {
          overlay.style.display = '';
          document.body.style.overflow = prevBodyOverflow;
          if (sessionBuffer.length) await commitCapturesIntoContainer(container, insertAt, sessionBuffer);
          return;
        }
        // Cold path: the form was torn down by a hard nav. Replay it, then commit.
        if (!formStackSnapshot?.length || !sessionBuffer.length) return;
        const ok = await replayFormStack(formStackSnapshot);
        if (ok) await commitCapturesIntoContainer(container, insertAt, sessionBuffer);
      },
      // ✕ / Esc: discard everything captured this session and just re-show the
      // form. Nothing is committed to the draft (immediate-save means a commit
      // would otherwise be irreversible from here).
      onCancel: () => {
        if (formEl.isConnected) {
          overlay.style.display = '';
          document.body.style.overflow = prevBodyOverflow;
        }
      },
    },
  });
}

// "Add from library" → pick a library capture → splice into the container at idx.
export function runComponentLibraryInsert({ container, insertAt }) {
  componentLibraryIntent = { snapshot: snapshotFormStack(), container, insertAt };
  getFormAction('openCaptureLibrary')?.({ mode: 'insert' });
}

// componentLibraryIntent remembers where to commit the chosen library capture:
// it is set when runComponentLibraryInsert starts and consumed when the library
// completes, committing the capture straight into a container's markdown
// (see commitCapturesIntoContainer).
let componentLibraryIntent = null;

// Called from captureEntry.js once the user picks a library capture. Rebuilds
// the origin form, then commits the chosen capture into the container.
registerFormAction('completeLibraryInsert', async ({ capture } = {}) => {
  if (!componentLibraryIntent) return;
  const intent = componentLibraryIntent;
  componentLibraryIntent = null;
  if (!capture || !intent.snapshot?.length) return;
  const ok = await replayFormStack(intent.snapshot);
  if (!ok) return;
  await commitCapturesIntoContainer(intent.container, intent.insertAt, [capture]);
});
