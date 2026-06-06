/**
 * captureCards.js — Shared light/dark capture preview cards.
 * Used by captureEntry.js (override existing) and captureNew.js (new capture).
 */

/**
 * One theme card. Returns '' when src is falsy so callers can spread an array
 * and let missing variants drop out.
 * @param {{theme:'light'|'dark', title:string, src:string, alt?:string}} opts
 */
export function captureCard({ theme, title, src, alt = '' }) {
  if (!src) return '';
  return `
    <figure class="mb-capture-card mb-capture-card--${theme}">
      <figcaption class="mb-capture-card__title">${title}</figcaption>
      <div class="mb-capture-card__image-wrap">
        <img class="mb-capture-card__img" src="${src}" alt="${alt}">
      </div>
    </figure>
  `;
}

/** Wrap rendered cards in the preview grid. */
export function captureGrid(cards) {
  return `<div class="mb-capture-entry-grid">${cards.join('')}</div>`;
}

// Storage root for all captures (mirrors CAPTURE_ROOT in captureLibrary.js).
const CAPTURE_ROOT = 'docs/assets/occ-captures';

/**
 * Reduce a stored capture path to its theme-agnostic, root-relative base.
 * Accepts either a full repo path (captureEntry's `lightPath`) or a
 * library-relative `occ-captures/…` filename (captureNew's `lightFilename`),
 * and strips the trailing -light-mode.png / -dark-mode.png so the same string
 * represents the light+dark pair.
 *
 *   "docs/assets/occ-captures/sites/uuid/foo-light-mode.png" -> "sites/uuid/foo"
 *   "occ-captures/sites/uuid/foo-dark-mode.png"              -> "sites/uuid/foo"
 *
 * @param {string} path
 * @returns {string}
 */
export function captureBasePath(path) {
  if (!path) return '';
  let p = path;
  if (p.startsWith(CAPTURE_ROOT + '/')) p = p.slice(CAPTURE_ROOT.length + 1);
  else if (p.startsWith('occ-captures/')) p = p.slice('occ-captures/'.length);
  return p.replace(/-(light|dark)-mode\.png$/, '');
}

/** Escape a value for safe interpolation into an HTML attribute. */
function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Read-only "capture path" form row, rendered above the preview grid. Uses the
 * standard horizontal form-group layout (label left, input right) so it matches
 * every other overlay form. The input is disabled + readonly: view-only, always.
 * @param {{label:string, value:string}} opts
 */
export function capturePathField({ label, value }) {
  return `
    <div class="more-buttons-form-group">
      <label class="more-buttons-label">${escapeAttr(label)}</label>
      <input class="more-buttons-input-text" type="text" value="${escapeAttr(value)}" disabled readonly>
    </div>
  `;
}
