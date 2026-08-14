/**
 * images.js — Single-image markdown round-trip + Components image acquisition.
 *
 * An "image" component is a lone `![](../assets/…)` line: a library file with
 * no -light-mode/-dark-mode theme pair (everything outside occ-captures —
 * buttons/, other/, …). Mirrors videos.js: library-only (files are uploaded
 * via the media library beforehand), so this module owns the markdown emit
 * (buildImageLines) plus the library-insert flow that commits a chosen image
 * straight into a container's markdown.
 */

import { registerFormAction, getFormAction } from './formActions.js';
import { snapshotFormStack, replayFormStack } from './form.js';
import { formLoading } from './loading.js';
import { generateUUID } from './admonitions.js';
import { getComponentContainer } from './componentContainers.js';

// Corner-rounding radius (px) applied to a rounded image's inline style. Single
// knob; the parser only detects `border-radius` presence so this can change
// freely without breaking already-saved images.
export const IMAGE_CORNER_RADIUS = 8;

export function buildImageLines(list = []) {
  return list.flatMap(img => {
    // Size + rounding share the img's inline style="", exactly like captures:
    // height mode is a style, width mode a width="" attr, rounding its own
    // style segment. Auto + unrounded emits NO attr block, so a hand-written
    // `![](../assets/…)` line round-trips byte-identical.
    const styleParts = [];
    let widthAttr = '';
    if (img.dimMode === 'width') {
      widthAttr = `width="${img.dimValue ?? 50}"`;
    } else if (img.dimMode !== 'none') {
      styleParts.push(`height: ${img.dimValue ?? 50}px`);
    }
    if (img.rounded) styleParts.push(`border-radius: ${IMAGE_CORNER_RADIUS}px`);

    const segs = [];
    if (styleParts.length) segs.push(`style="${styleParts.join('; ')}"`);
    if (widthAttr) segs.push(widthAttr);
    if (segs.length) segs.push('loading=lazy');
    const attrBlock = segs.length ? `{ ${segs.join(' ')} }` : '';

    const spanLines = img.uuid ? [`<span data-uuid="${img.uuid}" style="display:none"></span>`] : [];
    return ['', ...spanLines, `![](../assets/${img.filename})${attrBlock}`];
  });
}

// ── Components: image acquisition that commits immediately ─────────────────────
//
// Images are library-only, so there is just ONE acquisition route: browse the
// library, pick a single image, set its options on the review form, commit. No
// bytes are ever uploaded (the file already exists in the repo).

async function commitImagesIntoContainer(container, insertAt, imgList) {
  const handler = getComponentContainer(container.kind);
  if (!handler) return [];
  const inserted = imgList.map(img => ({
    kind: 'image',
    img: {
      uuid: generateUUID(),
      filename: img.filename,
      dimMode: img.dimMode ?? 'height',
      dimValue: img.dimMode === 'none' ? null : (img.dimValue ?? 50),
      rounded: !!img.rounded,
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

// Single pending image-insert intent: where the chosen image commits. Set when
// the library opens in image insert mode; consumed by completeComponentImageInsert.
let pendingImageInsert = null; // { snapshot, container, insertAt } | null

// Commit the chosen image into the origin container. Called by imageEntry's
// Insert button. Mirrors videos' completeComponentVideoInsert: replay the origin
// form stack, then splice the image component into the container's markdown.
registerFormAction('completeComponentImageInsert', async ({ image } = {}) => {
  const intent = pendingImageInsert;
  if (!intent || !image || !intent.snapshot?.length) return;
  formLoading.show();
  try {
    const ok = await replayFormStack(intent.snapshot);
    if (!ok) { alert('Failed to insert image: could not restore the originating form.'); return; }
    formLoading.show();
    await commitImagesIntoContainer(intent.container, intent.insertAt, [image]);
    pendingImageInsert = null;
  } catch (e) {
    alert('Failed to insert image: ' + e.message);
  } finally {
    formLoading.dismiss();
  }
});

// "Image" insert → browse library (single images only) → review → commit at idx.
// accept 'image' narrows the library to LONE files, so occ-captures' theme
// pairs never show here — mirrors runComponentVideoLibraryInsert.
export function runComponentImageLibraryInsert({ container, insertAt }) {
  pendingImageInsert = { snapshot: snapshotFormStack(), container, insertAt };
  return getFormAction('openMediaLibrary')?.({ mode: 'insert', accept: 'image' });
}
