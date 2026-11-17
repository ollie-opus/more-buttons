/**
 * kbCommentsPanel.js — the fallback place for the comments: a pull-out panel
 * over the right-hand side of the page, opened by a "Show comments" button in
 * the site's header. Used whenever the view has no margin to show them in
 * (a narrow window, where the theme hides its sidebars, or a page that hides
 * its table of contents). kbCommentsUi.js decides when (placement()); this
 * file only draws.
 *
 * The panel holds the one list of cards the core owns: mounting it moves the
 * list in, removing it leaves the list (and an open comment box in it) alone.
 */

import { lucideSvg } from './lucideIcons.js';
import { setThemeTip } from './kbSite.js';

/** The count on the header button: nothing for none, "99+" past two digits. */
export const countLabel = n => (n > 0 ? (n > 99 ? '99+' : String(n)) : '');

/**
 * A page's title with the site's name taken off the end of the document title
 * ("Overview - Opus Knowledge Base" → "Overview"). One part only is kept whole.
 */
export function titleFromDocument(title) {
  const t = String(title ?? '').replace(/\s+/g, ' ').trim();
  const at = t.lastIndexOf(' - ');
  return at > 0 ? t.slice(0, at).trim() : t;
}

const el = (doc, tag, cls, text) => {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

/**
 * The header's "Show comments" button: the theme's own header button, right
 * after the admin button (or where that goes when there is none).
 *
 * @param {Document} doc
 * @param {{onToggle: () => void}} opts
 * @returns {{el: HTMLElement, set(state: {count: number, open: boolean}): void, remove(): void}|null}
 *   null when the page has no header
 */
export function mountHeaderButton(doc, { onToggle }) {
  const header = doc.querySelector('.md-header__inner');
  if (!header) return null;
  const a = el(doc, 'a', 'md-header__button md-icon mb-kb-comments-btn');
  a.href = '#';
  a.setAttribute('role', 'button');
  a.setAttribute('aria-haspopup', 'dialog');
  a.setAttribute('aria-expanded', 'false');
  a.innerHTML = lucideSvg('message-square'); // the extension's own bundled markup
  const badge = el(doc, 'span', 'mb-kb-comments-btn__count');
  badge.hidden = true;
  a.append(badge);
  setThemeTip(doc, a, 'Show comments');
  a.addEventListener('click', e => { e.preventDefault(); onToggle(); });
  const cog = header.querySelector('.mb-kb-admin-cog');
  if (cog) cog.after(a);
  else {
    const before = header.querySelector('label[for="__search"]') ?? header.querySelector('.md-search') ?? header.querySelector('.md-header__source');
    if (before) before.before(a); else header.append(a);
  }
  return {
    el: a,
    set({ count, open }) {
      const label = countLabel(count);
      badge.textContent = label;
      badge.hidden = !label;
      const tip = open ? 'Hide comments' : 'Show comments';
      setThemeTip(doc, a, tip);
      if (count > 0) a.setAttribute('aria-label', `${tip}, ${count} open`);
      a.setAttribute('aria-expanded', String(open));
      a.classList.toggle('--open', open);
    },
    remove: () => a.remove(),
  };
}

/**
 * The panel, with `list` in it. Returns `{ remove(), el }`.
 *
 * @param {Document} doc
 * @param {HTMLElement} list - the core's `<ol>` of cards
 * @param {{onClose: () => void}} opts
 */
export function mountPanel(doc, list, { onClose }) {
  const win = doc.defaultView;
  const panel = el(doc, 'aside', 'mb-kb-comments-panel');
  panel.id = 'mb-kb-comments-panel';
  panel.setAttribute('aria-label', 'Comments');
  const head = el(doc, 'div', 'mb-kb-comments-panel__head');
  const close = el(doc, 'button', 'mb-kb-comments-panel__close');
  close.type = 'button';
  close.innerHTML = lucideSvg('x'); // the extension's own bundled markup
  setThemeTip(doc, close, 'Close comments');
  close.addEventListener('click', onClose);
  head.append(el(doc, 'h2', 'mb-kb-comments-panel__title', 'Comments'), close);
  const body = el(doc, 'div', 'mb-kb-comments-panel__body');
  const none = el(doc, 'p', 'mb-kb-comments-panel__none', 'No comments yet. Select some words in the guide to add one.');
  body.append(list, none);
  panel.append(head, body);

  // Stands under the header, whatever is above it (the status bar scrolls away).
  const place = () => {
    const h = doc.querySelector('.md-header');
    const bottom = h ? Math.max(0, h.getBoundingClientRect().bottom) : 0;
    panel.style.setProperty('--mb-kb-comments-top', `${bottom}px`);
    none.hidden = list.children.length > 0;
  };
  place();
  doc.body.append(panel);
  win.addEventListener('scroll', place, { passive: true });
  win.addEventListener('resize', place, { passive: true });
  return {
    el: panel,
    refresh: place,
    remove() {
      win.removeEventListener('scroll', place);
      win.removeEventListener('resize', place);
      panel.remove();
    },
  };
}
