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
import { formLoading } from './loading.js';
import { enterCaptureMode } from './captureMode.js';
import { githubPushImageIfNotExists, githubReplaceImage, githubPathExists } from './github.js';
import { captureBasePath } from './captureCards.js';
import { writeCaptureMeta } from './captureMeta.js';
import { readRepoBlob } from './repoClient.js';
import { showConflictResolver, ResolveCancelled } from './conflictResolver.js';
import { generateUUID } from './admonitions.js';
import { getComponentContainer } from './componentContainers.js';

// ── Parsing ───────────────────────────────────────────────────────────────────

export function buildCaptureLines(list = []) {
  return list.flatMap(c => {
    const light = `![](../assets/${c.lightFilename}#only-light)`;
    const dark  = `![](../assets/${c.darkFilename}#only-dark)`;
    const spanLines = c.uuid ? [`<span data-uuid="${c.uuid}" style="display:none"></span>`] : [];
    if (c.dimMode === 'none') {
      return ['', ...spanLines, light, dark];
    }
    const v = c.dimValue ?? 50;
    const dimAttr = c.dimMode === 'width' ? `width="${v}"` : `style="height: ${v}px"`;
    return [
      '',
      ...spanLines,
      `${light}{ ${dimAttr} loading=lazy }`,
      `${dark}{ ${dimAttr} loading=lazy }`,
    ];
  });
}

// ── Insert decision ───────────────────────────────────────────────────────────

/**
 * After a component-flow capture, decide which review form opens. 'library'
 * only when BOTH theme files already exist at the derived path — a half pair
 * (e.g. left by a partial manual rename) goes through the 'new' form, whose
 * insert-time conflict flow can repair the missing half.
 */
export function chooseInsertBranch(lightExists, darkExists) {
  return lightExists && darkExists ? 'library' : 'new';
}

// ── Publish ───────────────────────────────────────────────────────────────────

export function resolveCaptures(list) {
  return list.map(c => {
    if (c.lightDataUrl && c.addToLibrary === false) {
      const id = generateUUID();
      return {
        ...c,
        lightFilename: `media/occ-captures/uncategorised/${id}-light-mode.png`,
        darkFilename:  `media/occ-captures/uncategorised/${id}-dark-mode.png`,
      };
    }
    return c;
  });
}

export async function pushCaptures(list = [], onProgress) {
  const upserts = [];
  for (const c of list) {
    if (!c.lightDataUrl) continue;
    const created = await githubPushImageIfNotExists(`docs/assets/${c.lightFilename}`, c.lightDataUrl.split(',')[1], onProgress);
    await githubPushImageIfNotExists(`docs/assets/${c.darkFilename}`, c.darkDataUrl.split(',')[1], onProgress);
    // Only record metadata for captures we actually created. If the light PNG
    // already existed we skipped overwriting it — so we must also leave its
    // manifest entry untouched rather than clobber it with this capture's
    // (possibly different) resized/padding values.
    if (created) {
      upserts.push({ lightPath: `docs/assets/${c.lightFilename}`, resized: !!c.resized, padding: c.padding || 0 });
    }
  }
  await writeCaptureMeta(upserts, onProgress);
}

// ── Library conflicts (shared by captureNew's save and captureInsertNew) ─────

/**
 * A clash with a stored capture is resolved through the standard conflict
 * panel (conflictResolver.js — the same UI guides use for concurrent-edit
 * conflicts): one "Capture" field whose tiles carry the stored light
 * thumbnail vs the new capture's. Resolves true only when the user picks
 * "Yours (overwrite)"; picking theirs or cancelling keeps the library
 * untouched. The stored thumbnail comes via the contents API (readRepoBlob),
 * not the raw CDN, so a recently replaced capture can't show stale bytes; a
 * failed fetch just drops the thumbnail (text-only tile).
 */
export async function resolveCaptureConflict({ formEl, base, lightPath, lightExists, mineLightDataUrl }) {
  const theirsBlob = lightExists ? await readRepoBlob(lightPath).catch(() => null) : null;
  const theirsUrl = theirsBlob ? URL.createObjectURL(theirsBlob) : '';
  try {
    const choices = await showConflictResolver(
      formEl,
      [{ field: 'capture', label: 'Capture', mine: ['mine'], theirs: ['theirs'] }],
      {
        describe: (token) => ({
          kind: 'capture',
          thumbSrc: token === 'mine' ? mineLightDataUrl : theirsUrl,
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

/**
 * "Yours (overwrite)": replace the stored pair with this capture. Replace
 * what's there and create what isn't (a manual rename can land on a
 * half-existing pair), then upsert the manifest entry so padding/resized
 * follow the new bytes.
 */
export async function overwriteCapturePair({ lightPath, darkPath, lightExists, darkExists, capture, onProgress }) {
  const lightB64 = capture.lightDataUrl.split(',')[1];
  const darkB64 = capture.darkDataUrl.split(',')[1];
  await (lightExists
    ? githubReplaceImage(lightPath, lightB64, onProgress)
    : githubPushImageIfNotExists(lightPath, lightB64, onProgress));
  await (darkExists
    ? githubReplaceImage(darkPath, darkB64, onProgress)
    : githubPushImageIfNotExists(darkPath, darkB64, onProgress));
  await writeCaptureMeta(
    [{ lightPath, resized: !!capture.resized, padding: capture.padding || 0 }],
    onProgress,
  );
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
  if (!handler) return [];
  const resolved = resolveCaptures(capList);
  await pushCaptures(resolved);
  const caps = resolved.map(c => ({
    uuid: generateUUID(),
    lightFilename: c.lightFilename,
    darkFilename: c.darkFilename,
    dimMode: c.dimMode ?? 'height',
    dimValue: c.dimMode === 'none' ? null : (c.dimValue ?? 50),
  }));
  const inserted = caps.map(cap => ({ kind: 'capture', cap }));
  await handler.mutate(container, (components) => {
    const idx = Math.max(0, Math.min(insertAt, components.length));
    const next = components.slice();
    next.splice(idx, 0, ...inserted);
    return next;
  });
  return inserted;
}

// Single pending component-insert intent: where the chosen capture commits.
// Set when a library browse or a capture-mode decision form opens; consumed by
// completeComponentInsert. `snapshot` is always the ORIGIN form stack (the
// container's form), so replaying it never resurrects a stale review form.
let pendingComponentInsert = null; // { snapshot, container, insertAt } | null

// Commit the chosen capture into the origin container. Called by the Insert
// button of BOTH review forms (captureEntry insert mode + captureInsertNew):
// replays the origin form stack, then splices the capture component into the
// container's markdown. `capture` carries no dataURLs (any upload already
// happened), so commitCapturesIntoContainer's pushCaptures skips uploading.
// The component editor deliberately does NOT open — size was already set on
// the review form (captures-only deviation from insert-lands-in-editor).
registerFormAction('completeComponentInsert', async ({ capture } = {}) => {
  const intent = pendingComponentInsert;
  if (!intent || !capture || !intent.snapshot?.length) return;
  // The review forms' insert buttons bypass form.js's data-action dispatcher,
  // so this action arms the loading tile itself.
  formLoading.show();
  try {
    const ok = await replayFormStack(intent.snapshot);
    if (!ok) return;
    // The replay's createForm dropped the tile when the parent form
    // re-rendered; re-arm it to cover the commit gap.
    formLoading.show();
    await commitCapturesIntoContainer(intent.container, intent.insertAt, [capture]);
    // Clear only on success — a failed commit leaves the intent for a retry.
    pendingComponentInsert = null;
  } catch (e) {
    alert('Failed to insert capture: ' + e.message);
  } finally {
    formLoading.dismiss();
  }
});

// Post-shift-click decision point: probe whether the capture's derived path
// already exists in the library, then open the matching review form. Nothing
// is pushed from here — the review forms own all writes (the in-library form
// uploads nothing at all; captureInsertNew pushes on Insert). On a probe
// failure, fail loudly and land back on the origin form.
async function finishComponentCapture({ container, insertAt, snapshot, sessionBuffer }) {
  const capture = sessionBuffer[0];
  const lightPath = `docs/assets/${capture.lightFilename}`;
  const darkPath = `docs/assets/${capture.darkFilename}`;
  formLoading.show();
  try {
    const [lightExists, darkExists] = await Promise.all([
      githubPathExists(lightPath),
      githubPathExists(darkPath),
    ]);
    pendingComponentInsert = { snapshot, container, insertAt };
    if (chooseInsertBranch(lightExists, darkExists) === 'library') {
      await getFormAction('openCaptureEntry')?.({
        lightPath,
        darkPath,
        label: captureBasePath(capture.lightFilename),
        mode: 'insert',
        origin: 'captureMode',
      });
    } else {
      await getFormAction('openCaptureInsertNew')?.({ capture });
    }
  } catch (e) {
    alert('Failed to check the capture library: ' + e.message);
    await replayFormStack(snapshot);
  } finally {
    formLoading.dismiss();
  }
}

// Shared by the closure cold path (Turbo nav: closure alive, form DOM gone)
// and the registered cold-exit intent (hard nav: closure gone too). Replays
// the originating form stack, then runs the decision point so the buffered
// capture lands in its review form.
async function replayAndOpenInsertDecision({ container, insertAt, formStackSnapshot, sessionBuffer }) {
  if (!container || !formStackSnapshot?.length || !sessionBuffer?.length) return;
  formLoading.show();
  try {
    const ok = await replayFormStack(formStackSnapshot);
    if (ok) {
      await finishComponentCapture({ container, insertAt, snapshot: formStackSnapshot, sessionBuffer });
    }
  } catch (e) {
    alert('Failed to insert capture: ' + e.message);
  } finally {
    formLoading.dismiss();
  }
}

// Cold-exit intent for the component capture flow: a hard navigation during
// capture mode killed the JS context that held runComponentCaptureFlow's
// returnTo closures, so captureMode.js dispatches the session's serialised
// intent here instead (see planColdExit in captureMode.js).
registerFormAction('completeComponentCaptureInsert', ({ intent, formStackSnapshot, sessionBuffer } = {}) =>
  replayAndOpenInsertDecision({
    container: intent?.container,
    insertAt: intent?.insertAt,
    formStackSnapshot,
    sessionBuffer,
  }));

// "Create a new capture" → screenshot → review form (nothing pushed yet).
export function runComponentCaptureFlow({ container, insertAt, formEl, overlay }) {
  const formStackSnapshot = snapshotFormStack();
  overlay.style.display = 'none';
  const prevBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = '';

  enterCaptureMode({
    formStackSnapshot,
    // Survives a hard navigation (unlike the returnTo closures below): on cold
    // exit captureMode dispatches this intent so the capture still lands in
    // its review form.
    intent: { action: 'completeComponentCaptureInsert', container, insertAt },
    // One capture per insert in the Components context: capture mode auto-exits
    // after a single screenshot so the flow lands in the review form.
    maxCaptures: 1,
    returnTo: {
      onComplete: async (sessionBuffer) => {
        if (formEl.isConnected) {
          overlay.style.display = '';
          document.body.style.overflow = prevBodyOverflow;
          if (sessionBuffer.length) {
            await finishComponentCapture({ container, insertAt, snapshot: formStackSnapshot, sessionBuffer });
          }
          return;
        }
        // Cold-DOM path: a Turbo navigation tore the form down (this closure
        // survived, its DOM didn't). Replay the form stack, then decide.
        await replayAndOpenInsertDecision({ container, insertAt, formStackSnapshot, sessionBuffer });
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

// Review-form Cancel (capture-mode route): drop the pending capture and go
// hunting again. Re-enters capture mode against the SAME insert intent; Done
// lands in a fresh review form, while ✕/Esc — or Done with nothing captured —
// replays the origin form stack instead (the cancelled review form hid itself
// and is torn down by whatever opens next; there is nothing to re-show).
registerFormAction('reenterComponentCapture', () => {
  const pending = pendingComponentInsert;
  if (!pending) return;
  const backToOrigin = async () => {
    formLoading.show();
    try {
      await replayFormStack(pending.snapshot);
    } finally {
      formLoading.dismiss();
    }
  };
  enterCaptureMode({
    formStackSnapshot: pending.snapshot,
    intent: { action: 'completeComponentCaptureInsert', container: pending.container, insertAt: pending.insertAt },
    maxCaptures: 1,
    returnTo: {
      onComplete: async (sessionBuffer) => {
        if (sessionBuffer.length) {
          await finishComponentCapture({ ...pending, sessionBuffer });
        } else {
          await backToOrigin();
        }
      },
      onCancel: backToOrigin,
    },
  });
});

// "Add from library" → pick a library capture → review form → commit at idx.
export function runComponentLibraryInsert({ container, insertAt }) {
  pendingComponentInsert = { snapshot: snapshotFormStack(), container, insertAt };
  return getFormAction('openCaptureLibrary')?.({ mode: 'insert' });
}

