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
