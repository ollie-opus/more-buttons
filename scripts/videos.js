/**
 * videos.js — Video markdown round-trip + Components video acquisition.
 *
 * Videos are library-only (no creation tool). This module owns the `<video>`
 * markdown emit (buildVideoLines) plus the library-insert flow that commits a
 * chosen video straight into a container's markdown. Mirrors captures.js, minus
 * all Capture-Mode / screenshot / image-upload code (videos are never created
 * or pushed by the extension — they are uploaded manually beforehand).
 */

import { registerFormAction, getFormAction } from './formActions.js';
import { snapshotFormStack, replayFormStack } from './form.js';
import { formLoading } from './loading.js';
import { generateUUID } from './admonitions.js';
import { getComponentContainer } from './componentContainers.js';

// Corner-rounding radius (px) applied to a rounded video's inline style. Single
// knob; the parser only detects `border-radius` presence so this can change
// freely without breaking already-saved videos.
export const VIDEO_CORNER_RADIUS = 8;

// Attribute sets keyed by playback mode (everything between src and style).
const PLAYBACK_ATTRS = {
  animation: 'autoplay loop muted playsinline preload="none"',
  clip: 'controls playsinline preload="metadata"',
};

export function buildVideoLines(list = []) {
  return list.flatMap(v => {
    const single = !v.darkFilename;
    const lightHash = single ? '' : (v.inversed ? '#only-dark' : '#only-light');
    const darkHash = v.inversed ? '#only-light' : '#only-dark';
    const attrs = PLAYBACK_ATTRS[v.playback] ?? PLAYBACK_ATTRS.animation;

    const styleParts = [];
    if (v.dimMode === 'width') styleParts.push(`width: ${v.dimValue ?? 50}px`);
    else if (v.dimMode === 'height') styleParts.push(`height: ${v.dimValue ?? 50}px`);
    if (v.rounded) styleParts.push(`border-radius: ${VIDEO_CORNER_RADIUS}px`);
    const styleAttr = styleParts.length ? ` style="${styleParts.join('; ')}"` : '';

    const el = (file, hash) =>
      `<video src="../assets/${file}${hash}" ${attrs}${styleAttr}></video>`;

    const spanLines = v.uuid ? [`<span data-uuid="${v.uuid}" style="display:none"></span>`] : [];
    const lines = ['', ...spanLines, el(v.lightFilename, lightHash)];
    if (!single) lines.push(el(v.darkFilename, darkHash));
    return lines;
  });
}

// ── Components: video acquisition that commits immediately ─────────────────────
//
// Videos are library-only, so there is just ONE acquisition route: browse the
// library, pick a video, set its options on the review form, commit. No bytes
// are ever uploaded (the file already exists in the repo).

async function commitVideosIntoContainer(container, insertAt, vidList) {
  const handler = getComponentContainer(container.kind);
  if (!handler) return [];
  const inserted = vidList.map(v => ({
    kind: 'video',
    vid: {
      uuid: generateUUID(),
      lightFilename: v.lightFilename,
      darkFilename: v.darkFilename ?? null,
      single: !v.darkFilename,
      dimMode: v.dimMode ?? 'width',
      dimValue: v.dimMode === 'none' ? null : (v.dimValue ?? 1000),
      inversed: !!v.inversed,
      rounded: !!v.rounded,
      playback: v.playback ?? 'animation',
    },
  }));
  await handler.mutate(container, (components) => {
    const idx = Math.max(0, Math.min(insertAt, components.length));
    const next = components.slice();
    next.splice(idx, 0, ...inserted);
    return next;
  });
  return inserted;
}

// Single pending video-insert intent: where the chosen video commits. Set when
// the library opens in video insert mode; consumed by completeComponentVideoInsert.
let pendingVideoInsert = null; // { snapshot, container, insertAt } | null

// Commit the chosen video into the origin container. Called by videoEntry's
// Insert button. Mirrors captures' completeComponentInsert: replay the origin
// form stack, then splice the video component into the container's markdown.
registerFormAction('completeComponentVideoInsert', async ({ video } = {}) => {
  const intent = pendingVideoInsert;
  if (!intent || !video || !intent.snapshot?.length) return;
  formLoading.show();
  try {
    const ok = await replayFormStack(intent.snapshot);
    if (!ok) { alert('Failed to insert video: could not restore the originating form.'); return; }
    formLoading.show();
    await commitVideosIntoContainer(intent.container, intent.insertAt, [video]);
    pendingVideoInsert = null;
  } catch (e) {
    alert('Failed to insert video: ' + e.message);
  } finally {
    formLoading.dismiss();
  }
});

// "Video" insert → browse library (Videos tab) → review → commit at idx.
export function runComponentVideoLibraryInsert({ container, insertAt }) {
  pendingVideoInsert = { snapshot: snapshotFormStack(), container, insertAt };
  return getFormAction('openCaptureLibrary')?.({ mode: 'insert', media: 'video' });
}
