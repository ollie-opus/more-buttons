/**
 * videoCards.js — Shared video preview cards + path helper for the video insert
 * and edit forms. Reuses the capture card wrapper classes (so existing capture
 * CSS applies) but renders a muted, paused <video> instead of an <img>.
 */

const VIDEO_ROOT = 'docs/assets/media/videos';

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * One theme card holding a muted preview <video>. Returns '' when src is falsy
 * so callers can spread an array and let missing variants drop out.
 * @param {{theme:'light'|'dark', title:string, src:string, alt?:string}} opts
 */
export function videoCard({ theme, title, src, alt = '' }) {
  if (!src) return '';
  return `
    <figure class="mb-capture-card mb-capture-card--${theme}">
      <figcaption class="mb-capture-card__title">${title}</figcaption>
      <div class="mb-capture-card__image-wrap">
        <video class="mb-capture-card__img" src="${escapeAttr(src)}" muted playsinline preload="metadata" aria-label="${escapeAttr(alt)}"></video>
      </div>
    </figure>
  `;
}

/**
 * Reduce a stored video path to its theme-agnostic, root-relative base: strips
 * the media/videos prefix and the -light-mode/-dark-mode + extension suffix
 * (pairs), or just the prefix + extension (singles).
 * @param {string} path
 * @returns {string}
 */
export function videoBasePath(path) {
  if (!path) return '';
  let p = path;
  if (p.startsWith(VIDEO_ROOT + '/')) p = p.slice(VIDEO_ROOT.length + 1);
  else if (p.startsWith('media/videos/')) p = p.slice('media/videos/'.length);
  if (/-(light|dark)-mode\.[a-z0-9]+$/i.test(p)) return p.replace(/-(light|dark)-mode\.[a-z0-9]+$/i, '');
  return p.replace(/\.[a-z0-9]+$/i, '');
}
