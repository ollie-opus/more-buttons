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
