/**
 * actionPlayVeil.js — the full-page veil shown while an Action is playing.
 *
 * Playback drives the host page by dispatching DOM events; a stray click or
 * keystroke from the person at the same time would race those events and
 * corrupt the run. The veil sits above everything (page, dock, forms), eats
 * pointer input, swallows keyboard input in the capture phase, and shows a
 * spinner + live title with one Cancel button (Escape does the same). Like
 * the action bar it mounts as a sibling of <body> on documentElement so a
 * Turbo body swap leaves it in place; a hard navigation kills it and
 * resumePlayback mounts a fresh one.
 *
 * Programmatic events (el.click(), dispatchEvent) are unaffected by the veil:
 * pointer-events only gates REAL input, which is exactly the split we want.
 *
 * Mirrors the mountActionBar API surface the player uses (setTitle / remove),
 * plus setDone for the end-of-run tick. Everything environmental is
 * injectable so tests/actionPlayVeil.test.mjs drives it under Node.
 */

import { watchIconSpans } from './lucideIcons.js';

export const VEIL_CLASS = 'mb-action-veil';

function ensureStylesheet(doc) {
  if (doc.getElementById?.('more-buttons-overlay-stylesheet')) return;
  const link = doc.createElement('link');
  link.id = 'more-buttons-overlay-stylesheet';
  link.rel = 'stylesheet';
  link.href = chrome.runtime.getURL('config/forms/formsStyling.css');
  (doc.head || doc.documentElement).appendChild(link);
}

function h(doc, tag, attrs = {}, children = []) {
  const node = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  children.forEach(c => node.appendChild(c));
  return node;
}

/**
 * @param {Object} o
 * @param {string} o.title       e.g. Playing “Weekly report”
 * @param {string} [o.subtitle]  e.g. step 1 of 4
 * @param {() => void} o.onCancel
 */
export function mountPlayVeil({
  title, subtitle = '', onCancel = () => {},
  doc = document, paintIcons = watchIconSpans, ensureStyles = true,
} = {}) {
  if (ensureStyles) ensureStylesheet(doc);

  const iconEl = h(doc, 'span', { class: 'more-buttons-icon more-buttons-icon--spin', 'aria-hidden': 'true', text: 'loader-circle' });
  const titleEl = h(doc, 'div', { class: `${VEIL_CLASS}__title`, 'data-veil-title': true, text: title });
  const subEl = h(doc, 'div', { class: `${VEIL_CLASS}__sub`, 'data-veil-sub': true, text: subtitle });
  const cancelBtn = h(doc, 'button', { type: 'button', class: `more-buttons-button ${VEIL_CLASS}__cancel`, 'data-veil-cancel': true }, [
    h(doc, 'span', { class: 'more-buttons-icon', 'aria-hidden': 'true', text: 'square' }),
    h(doc, 'span', { text: 'Cancel' }),
  ]);
  const card = h(doc, 'div', { class: `${VEIL_CLASS}__card`, role: 'dialog', 'aria-modal': 'true', 'aria-live': 'polite', 'aria-label': title }, [
    iconEl, titleEl, subEl, cancelBtn,
  ]);
  const veil = h(doc, 'div', { class: VEIL_CLASS }, [card]);

  let cancelled = false;
  const cancel = () => { if (cancelled) return; cancelled = true; onCancel(); };
  cancelBtn.addEventListener('click', e => { e.stopPropagation(); cancel(); });

  // Keyboard: Escape cancels; everything else is swallowed before the host
  // sees it. Capture phase on the document so Stimulus/Turbo never get a turn.
  const onKey = e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault?.(); cancel(); return; }
    if (e.key === 'Tab' || e.key === 'Enter' || e.key === ' ') return; // keep the Cancel button operable
    e.preventDefault?.();
  };
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('keyup', onKey, true);
  doc.addEventListener('keypress', onKey, true);

  doc.documentElement.appendChild(veil);
  paintIcons(doc);
  try { cancelBtn.focus?.({ preventScroll: true }); } catch {}

  const setTitle = t => { titleEl.textContent = t; card.setAttribute('aria-label', t); };
  const setSubtitle = t => { subEl.textContent = t; };
  const setDone = (t, sub = '') => {
    setTitle(t); setSubtitle(sub);
    iconEl.classList.remove('more-buttons-icon--spin');
    iconEl.textContent = 'circle-check';
    veil.classList.add('--done');
    cancelBtn.setAttribute('hidden', ''); cancelBtn.hidden = true;
    paintIcons(doc);
  };
  const remove = () => {
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('keyup', onKey, true);
    doc.removeEventListener('keypress', onKey, true);
    veil.remove();
  };

  return { veil, card, setTitle, setSubtitle, setDone, remove };
}
