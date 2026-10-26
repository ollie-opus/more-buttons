/**
 * actionToolbar.js — the on-page bar for an Actions recording or playback.
 *
 * Same chrome as capture mode (captureMode.js buildBar / .mb-capture-bar +
 * .mb-capture-tab): an always-visible left tab carrying the live title and a
 * full bar that reveals when the cursor hits the top edge. Both mount as
 * siblings of <body> on documentElement, so a Turbo body swap leaves them
 * (and their handlers) in place. Variant classes re-hue the whole surface via
 * --cb-hue (see "Action bar variants" in formsStyling.css).
 *
 * Everything environmental (document, timers, icon painter, stylesheet) is
 * injectable so tests/actionToolbar.test.mjs drives it under Node.
 */

import { watchIconSpans } from './lucideIcons.js';

export const BAR_VARIANTS = ['recording', 'paused', 'playing'];

const BAR_H = 40, HOVER_BUFFER = 20, HOLD_Y = BAR_H + HOVER_BUFFER;
const EXIT_MS = 220, FLASH_MS = 2200;

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

function controlEl(doc, c) {
  const icon = h(doc, 'span', { class: 'more-buttons-icon', 'aria-hidden': 'true', text: c.icon });
  if (c.kind === 'close') {
    return h(doc, 'button', { type: 'button', class: 'mb-capture-bar__close', 'data-bar-control': c.id, 'aria-label': c.label, title: c.label }, [icon]);
  }
  return h(doc, 'button', { type: 'button', class: 'mb-capture-bar__toggle', 'data-bar-control': c.id, title: c.label }, [
    icon, h(doc, 'span', { class: 'mb-capture-bar__toggle-label', text: c.label }),
  ]);
}

/**
 * @param {Object} o
 * @param {'recording'|'paused'|'playing'} o.variant
 * @param {string} o.title
 * @param {Array<{id, icon, label, kind?: 'toggle'|'close'}>} o.controls
 * @param {(id: string, btn: Element) => void} o.onControl
 * @param {string|null} [o.escapeControl]  control id fired on Escape
 */
export function mountActionBar({
  variant, title, controls = [], onControl = () => {}, escapeControl = null,
  doc = document, win = window, paintIcons = watchIconSpans, ensureStyles = true,
  setTimeout = globalThis.setTimeout, clearTimeout = globalThis.clearTimeout,
  raf = cb => win.requestAnimationFrame(cb),
} = {}) {
  if (!BAR_VARIANTS.includes(variant)) throw new Error(`actionToolbar: unknown variant "${variant}"`);
  if (ensureStyles) ensureStylesheet(doc);

  const titleEl = h(doc, 'span', { class: 'mb-capture-bar__title', 'data-bar-title': true, text: title });
  const flashEl = h(doc, 'span', { class: 'mb-action-bar__flash', 'data-bar-flash': true, hidden: true });
  const tabLabel = h(doc, 'span', { class: 'mb-capture-tab__label', 'data-tab-label': true, text: title });
  const buttons = new Map();
  const bar = h(doc, 'div', { class: `mb-capture-bar mb-action-bar --${variant}`, role: 'toolbar', 'aria-label': title }, [
    h(doc, 'div', { class: 'mb-capture-bar__group mb-capture-bar__identity' }, [
      h(doc, 'span', { class: 'mb-capture-bar__dot', 'aria-hidden': 'true' }), titleEl, flashEl,
    ]),
    h(doc, 'div', { class: 'mb-capture-bar__spacer' }),
    ...controls.map(c => { const b = controlEl(doc, c); buttons.set(c.id, b); b.addEventListener('click', () => onControl(c.id, b)); return b; }),
  ]);
  const tab = h(doc, 'div', { class: `mb-capture-tab mb-action-tab --${variant}` }, [
    h(doc, 'span', { class: 'mb-capture-tab__dot', 'aria-hidden': 'true' }), tabLabel,
  ]);

  // First paint hidden (the stylesheet may still be loading), then let the
  // stylesheet's transition take over — same anti-flicker as captureMode.js.
  bar.style.transform = 'translateY(-100%)';
  bar.style.transition = 'none';
  doc.documentElement.appendChild(bar);
  doc.documentElement.appendChild(tab);
  paintIcons(doc);
  raf(() => raf(() => { bar.style.transform = ''; bar.style.transition = ''; }));

  // ── Hover reveal (mirrors captureMode.js, minus its popup-aware gate) ──────
  let revealed = false, hideTimer = null;
  const showBar = () => { clearTimeout(hideTimer); if (revealed) return; revealed = true; bar.classList.add('--enter'); tab.classList.add('--in-bar'); };
  const hideBar = () => { if (!revealed) return; revealed = false; bar.classList.remove('--enter'); tab.classList.remove('--in-bar'); };
  const scheduleHide = () => { clearTimeout(hideTimer); hideTimer = setTimeout(hideBar, 10); };
  const onMouseMove = e => {
    if (e.clientY <= 2) showBar();
    if (revealed) { if (e.clientY <= HOLD_Y) clearTimeout(hideTimer); else scheduleHide(); }
  };
  const onKey = e => {
    if (e.key !== 'Escape' || !escapeControl) return;
    e.stopPropagation();
    onControl(escapeControl, buttons.get(escapeControl) ?? null);
  };
  doc.addEventListener('mousemove', onMouseMove, true);
  doc.addEventListener('keydown', onKey, true);
  bar.addEventListener('mouseenter', showBar);
  tab.addEventListener('mouseenter', showBar);

  // ── API ──────────────────────────────────────────────────────────────────
  let currentTitle = title;
  let flashTimer = null;
  const setTitle = t => { currentTitle = t; titleEl.textContent = t; bar.setAttribute('aria-label', t); if (flashTimer === null) tabLabel.textContent = t; };
  const setArmed = on => { bar.classList.toggle('--armed', !!on); tab.classList.toggle('--armed', !!on); };
  const setVariant = v => {
    if (!BAR_VARIANTS.includes(v)) throw new Error(`actionToolbar: unknown variant "${v}"`);
    for (const el of [bar, tab]) { BAR_VARIANTS.forEach(x => el.classList.remove(`--${x}`)); el.classList.add(`--${v}`); }
  };
  const setControl = (id, { icon, label, hidden } = {}) => {
    const btn = buttons.get(id);
    if (!btn) return;
    if (icon != null) btn.querySelector('.more-buttons-icon').textContent = icon;
    if (label != null) {
      const lbl = btn.querySelector('.mb-capture-bar__toggle-label');
      if (lbl) lbl.textContent = label;
      btn.setAttribute('title', label);
      if (btn.classList.contains('mb-capture-bar__close')) btn.setAttribute('aria-label', label);
    }
    if (hidden != null) { if (hidden) btn.setAttribute('hidden', ''); else btn.removeAttribute('hidden'); btn.hidden = !!hidden; }
  };
  const flash = (msg, ms = FLASH_MS) => {
    clearTimeout(flashTimer);
    flashEl.textContent = msg; flashEl.removeAttribute('hidden'); flashEl.hidden = false;
    tabLabel.textContent = msg;
    flashTimer = setTimeout(() => { flashTimer = null; flashEl.setAttribute('hidden', ''); flashEl.hidden = true; tabLabel.textContent = currentTitle; }, ms);
  };
  const remove = () => {
    doc.removeEventListener('mousemove', onMouseMove, true);
    doc.removeEventListener('keydown', onKey, true);
    clearTimeout(hideTimer); clearTimeout(flashTimer);
    bar.classList.remove('--enter');
    bar.classList.add('--exit'); tab.classList.add('--exit');
    setTimeout(() => { bar.remove(); tab.remove(); }, EXIT_MS);
  };

  return { bar, tab, setTitle, setArmed, setVariant, setControl, flash, show: showBar, remove };
}
