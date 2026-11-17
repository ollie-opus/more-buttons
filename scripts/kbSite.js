/**
 * kbSite.js — the extension's presence on the published Knowledge Base
 * (support.opus-safety.co.uk), driven by content.js on that host only.
 *
 * Works out what the current page is and shows what belongs on it:
 *
 *   live      a published guide            → a "Switch to edit mode" icon beside
 *                                            the title, where the theme puts its
 *                                            own (goes to the page's draft URL:
 *                                            being there is edit mode), and
 *                                            an "Edit log" icon next to it
 *   draft     a draft that exists in GitHub → the in-page editor, which brings
 *                                            its own bottom bar, keeps the
 *                                            "Edit log" icon in the same place
 *                                            and adds its own icons beside it
 *                                            (markdown view, publish, delete
 *                                            draft) and, above the title, the
 *                                            way out of edit mode and across to
 *                                            the live content
 *   no-draft  a draft URL with no draft file, whose live page exists
 *                                           → the 404 heading reads "This page
 *                                             has no draft yet", with
 *                                             "+ Create draft" under it; the
 *                                             editor adds its row above it
 *                                             (exit edit mode, view live
 *                                             content)
 *
 *   updates   System Updates is a page of its own kind: its draft is not a copy
 *             of the live page but the list of updates waiting to be published
 *             (kbUpdates.js). The live page gets the same two icons; the draft
 *             url is always the editor, which there adds and publishes updates
 *             one at a time.
 *
 *   admin     /admin and the pages under it → the Knowledge base admin area,
 *                                            drawn where the site's 404 would be
 *                                            (kbAdmin.js). Every page of the
 *                                            site gets a cog in the header, left
 *                                            of the search, that leads there.
 *
 * There is no side dock on this site: buttons are placed in the page itself.
 *
 * Everything is gated on a working GitHub token: with none (or an invalid one)
 * the site is left exactly as a reader sees it. Apart from the header cog, the
 * home page and the System Status page are never touched.
 *
 * "Does the draft exist" is asked of GitHub, never of the page: the site build
 * lags a commit by minutes, so a fresh draft is still a 404 here and a
 * published one still renders.
 *
 * Stays light: the editor stack (actions.js) is only loaded on a draft page.
 */

import { readRepoText, currentGithubLogin } from './repoClient.js';
import { getLucideSvgMarkup, lucideSvg } from './lucideIcons.js';
import { isUpdatesPage } from './kbUpdates.js';
import { parseMediaEntryPath } from './kbMediaEntry.js';

export const KB_HOST = 'support.opus-safety.co.uk';

// Pages the in-page editor does not cover (they have their own editors).
const EXCLUDED_SLUGS = new Set(['system-status']);

/**
 * `/pages/<slug>/` or `/drafts/<slug>/` (optionally `index.html`) → the page it
 * addresses; null for the home page, excluded pages and everything else. Pure.
 * @returns {{side:'live'|'draft', slug:string, livePath:string, draftPath:string, liveUrl:string, draftUrl:string}|null}
 */
export function classifyKbPath(pathname) {
  const m = /^\/(pages|drafts)\/([^/]+)\/?(?:index\.html)?$/.exec(pathname ?? '');
  if (!m) return null;
  let slug;
  try { slug = decodeURIComponent(m[2]); } catch { return null; }
  // The slug goes into repo paths and GitHub requests: only a plain file name
  // (letters, digits, hyphens, underscores) is a page.
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(slug) || EXCLUDED_SLUGS.has(slug)) return null;
  return {
    side: m[1] === 'pages' ? 'live' : 'draft',
    slug,
    livePath: `docs/pages/${slug}.md`,
    draftPath: `docs/drafts/${slug}.md`,
    liveUrl: `/pages/${m[2]}/`,
    draftUrl: `/drafts/${m[2]}/`,
  };
}

// The admin area: urls the site itself does not have (they are its 404 page),
// which the extension fills in. One entry per screen.
export const ADMIN_ROUTES = Object.freeze({
  home: '/admin/',
  pages: '/admin/pages/',
  'pages/new': '/admin/pages/new/',
  'media-library': '/admin/media-library/',
  'media-library/upload': '/admin/media-library/upload/',
  settings: '/admin/settings/',
});
/** The one admin screen whose url is not fixed: a media file's own page. */
export const MEDIA_FILE_ROUTE = 'media-library/file';

/**
 * `/admin`, `/admin/pages`, `/admin/media-library`, `/admin/settings` and their
 * sub-screens (trailing slash optional) → the screen addressed; null for
 * anything else. Pure.
 * @returns {{route: keyof typeof ADMIN_ROUTES}|{route: 'media-library/file', file: string}|null}
 */
export function classifyAdminPath(pathname) {
  const m = /^\/admin(?:\/([a-z-]+(?:\/[a-z-]+)?))?\/?$/.exec(pathname ?? '');
  const route = m ? m[1] ?? 'home' : null;
  if (route && Object.hasOwn(ADMIN_ROUTES, route)) return { route };
  // Anything else under the media library is one file's own page: the rest of
  // the url is its path in the library (kbMediaEntry.js).
  const file = parseMediaEntryPath(pathname);
  return file ? { route: MEDIA_FILE_ROUTE, file } : null;
}

/**
 * The way into the admin area: a button in the header (the sliders icon; the
 * cog is the Settings screen's), left of the search. It is
 * the theme's own header button (as the light / dark toggle beside it), so it
 * takes the header's size, hover and colours.
 */
export function injectAdminCog(doc) {
  const header = doc.querySelector('.md-header__inner');
  if (!header || header.querySelector('.mb-kb-admin-cog')) return null;
  const a = doc.createElement('a');
  a.className = 'md-header__button md-icon mb-kb-admin-cog';
  a.href = ADMIN_ROUTES.home;
  setThemeTip(doc, a, 'Knowledge base admin');
  // The search is a label (small screens) followed by the search box; the cog
  // goes before both. With no search, it sits ahead of the "Ask" button.
  const before = header.querySelector('label[for="__search"]')
    ?? header.querySelector('.md-search')
    ?? header.querySelector('.md-header__source');
  if (before) before.before(a); else header.append(a);
  ensureSiteCss(doc); // evens the gap to the search box
  Promise.resolve().then(() => getLucideSvgMarkup('sliders-horizontal')).then(svg => { if (svg) a.innerHTML = svg; }).catch(() => {});
  return a;
}

/** The site's own "404 - Not found" page (it keeps the normal header and layout). */
export function isNotFoundPage(doc) {
  return /^\s*404\b/.test(doc.querySelector('article h1')?.textContent ?? '');
}

const ARTICLE = 'article.md-content__inner';

// ── The theme's tooltip, on our buttons ──────────────────────────────────────
// The theme gives every `[title]` its own tooltip, but only those on the page
// when its script first runs: a button added after that (ours always is on a
// draft, which is redrawn on every edit, and often is on a live page) would be
// left with the browser's plain one. So our buttons carry no `title`: they
// show the theme's tooltip themselves, built from the theme's own markup and
// placed by the same custom properties its script sets, so its stylesheet
// draws it (size, shadow, dark mode, the slide in).

let tip = null; // {el, inner, host}: one tooltip per page, moved between buttons

function hideTip() {
  if (!tip) return;
  tip.host = null;
  tip.el.classList.remove('md-tooltip2--active');
}

function showTip(doc, host) {
  const text = host.mbTip;
  if (!text || !doc.body) return;
  if (!tip || !tip.el.isConnected) {
    const el = doc.createElement('div');
    el.className = 'md-tooltip2 md-tooltip2--bottom mb-kb-tip';
    el.setAttribute('role', 'tooltip');
    el.setAttribute('aria-hidden', 'true'); // the button's own name or label already says it
    const inner = doc.createElement('div');
    inner.className = 'md-tooltip2__inner md-typeset';
    el.append(inner);
    doc.body.append(el);
    tip = { el, inner, host: null };
    // Gone as soon as the pointer is anywhere else, or the button is (a redraw
    // takes it from under the pointer without a mouseleave).
    doc.addEventListener('mouseover', e => {
      if (tip?.host && (!tip.host.isConnected || !tip.host.contains(e.target))) hideTip();
    }, true);
    doc.addEventListener('scroll', hideTip, { passive: true, capture: true });
  }
  const { el, inner } = tip;
  tip.host = host;
  inner.textContent = text;
  const view = doc.defaultView;
  const r = host.getBoundingClientRect();
  const set = (k, v) => el.style.setProperty(k, `${v}px`);
  set('--md-tooltip-host-x', r.x + view.scrollX);
  set('--md-tooltip-host-y', r.y + view.scrollY);
  set('--md-tooltip-x', r.width / 2);
  set('--md-tooltip-y', 8 + r.height);
  set('--md-tooltip-width', inner.offsetWidth);
  set('--md-tooltip-tail', 0);
  el.classList.add('md-tooltip2--active');
}

/**
 * Give a button of ours the theme's tooltip. An icon button is named by it too
 * (`aria-label`); one with a label of its own passes `name: false`.
 */
export function setThemeTip(doc, el, text, { name = true } = {}) {
  if (name) el.setAttribute('aria-label', text);
  const wired = !!el.mbTip;
  el.mbTip = text;
  if (wired) return;
  el.addEventListener('mouseenter', () => showTip(doc, el));
  el.addEventListener('mouseleave', hideTip);
  el.addEventListener('mousedown', hideTip);
}

// How far under the article's top a heading may stand and still be where the
// page's buttons go when its title is hidden (placeButton).
const LATCH_REACH = 400;

const rendered = el => typeof el?.getClientRects === 'function' && el.getClientRects().length > 0;

/**
 * Put one of the page's buttons in the article. They float right at its top,
 * level with the title. A page whose title is hidden has nothing there to
 * stand beside: floated, they would narrow whatever comes first (a grid, say)
 * and lie under anything that spills out of it. There they go into the first
 * heading that shows near the top instead, or, with none, onto a row of
 * their own that the content starts under. (Not in the editor: it always
 * shows the title.)
 */
function placeButton(doc, article, a) {
  const title = typeof article.querySelector === 'function' ? article.querySelector(':scope > h1') : null;
  const editing = !!doc.documentElement?.classList?.contains('mb-kb-editing');
  if (editing || typeof article.querySelectorAll !== 'function' || rendered(title) || (title && typeof title.getClientRects !== 'function')) {
    article.prepend(a);
    return;
  }
  const top = article.getBoundingClientRect().top;
  const heading = [...article.querySelectorAll('h1, h2, h3')].find(rendered);
  if (heading && heading.getBoundingClientRect().top - top <= LATCH_REACH) {
    heading.prepend(a);
    return;
  }
  if (!article.querySelector(':scope > .mb-kb-buttons-end')) {
    const end = doc.createElement('div');
    end.className = 'mb-kb-buttons-end';
    article.prepend(end);
  }
  article.prepend(a);
}

/**
 * The theme's own "Edit this page" control (an icon link floated to the right
 * of the title), pointing at the page's draft. Wearing the theme's classes
 * gives it the site's position, size, hover and dark mode.
 */
export function injectEditButton(doc, page) {
  const article = doc.querySelector(ARTICLE);
  if (!article || article.querySelector('.mb-kb-edit')) return null;
  const a = doc.createElement('a');
  a.className = 'md-content__button md-icon mb-kb-edit';
  a.href = page.draftUrl;
  setThemeTip(doc, a, 'Switch to edit mode');
  placeButton(doc, article, a);
  Promise.resolve().then(() => getLucideSvgMarkup('file-pen')).then(svg => { if (svg) a.innerHTML = svg; }).catch(() => {});
  return a;
}

function openEditLog(page, btn) {
  return import('./kbEditLog.js')
    .then(({ openKbEditLog }) => openKbEditLog(page, { returnFocus: btn }))
    .catch(err => console.error('MB Error: could not open the edit log', err));
}

/**
 * One more of the theme's icon buttons beside the title (the control
 * "Switch to edit mode" is). They float right, so the last one added sits furthest
 * right. `cls` names it: there is never a second one of the same name.
 * @param {{cls: string, icon: string, title: string, onClick: (btn: HTMLElement) => void, popup?: boolean}} spec
 */
export function injectPageButton(doc, { cls, icon, title, onClick, popup = false }) {
  const article = doc.querySelector(ARTICLE);
  if (!article || article.querySelector('.' + cls)) return null;
  const a = doc.createElement('a');
  a.className = `md-content__button md-icon ${cls}`;
  a.href = '#';
  a.setAttribute('role', 'button');
  setThemeTip(doc, a, title);
  if (popup) a.setAttribute('aria-haspopup', 'dialog');
  a.addEventListener('click', (e) => {
    e?.preventDefault?.();
    if (a.getAttribute?.('aria-disabled') === 'true') return;
    onClick(a);
  });
  // All float right: the first one in the article sits furthest right.
  placeButton(doc, article, a);
  // Drawn at once when the icons are already loaded: the row is put back on
  // every redraw of the editor, and whatever is placed from one of its buttons
  // straight after (the Page settings menu, from the cog) needs the others at
  // their full width, or it lands to the right of where the cog comes to rest.
  const now = lucideSvg(icon);
  if (now) a.innerHTML = now;
  else Promise.resolve().then(() => getLucideSvgMarkup(icon)).then(svg => { if (svg) a.innerHTML = svg; }).catch(() => {});
  return a;
}

/**
 * The Edit log control: the same theme icon button as "Switch to edit mode", sitting
 * to its right on a live page and, on a draft, in the middle of the editor's
 * own (the editor puts the whole row back after each redraw).
 * Opens the page's edit log in a popup.
 */
export function injectLogButton(doc, page, onOpen = openEditLog) {
  return injectPageButton(doc, { cls: 'mb-kb-log', icon: 'history', title: 'Edit log', popup: true, onClick: btn => onOpen(page, btn) });
}

// The little this module needs beyond the theme's own classes (no extension
// stylesheet is loaded outside the editor).
//  - A draft URL with no draft shows only the heading and Create draft: until
//    the site rebuilds after a draft is deleted, the old draft's content,
//    contents list and breadcrumbs are still in the served page. The article
//    keeps the place it has in the editor (formsStyling.css, `mb-kb-editing`):
//    reader width, centred, as if the hidden side panels were still there.
//  - A page with its title hidden and no heading near its top has the page's
//    buttons on a row of their own (placeButton): the content starts under it.
//  - Create new draft's label matches its icon (half strength, full on hover)
//    and is not underlined like a link in the text. The button does not float
//    as the theme's own do: it stands under the heading.
const SITE_CSS = `
.mb-kb-buttons-end { clear: both; }
html.mb-kb-no-draft .md-sidebar--primary,
html.mb-kb-no-draft .md-sidebar--secondary,
html.mb-kb-no-draft .md-path,
html.mb-kb-no-draft article.md-content__inner > :not(h1):not(.mb-kb-create-draft) { display: none !important; }
html.mb-kb-no-draft .md-content { max-width: 37rem; margin-inline: auto; }
.md-typeset .mb-kb-create-draft a.md-content__button {
  float: none;
  display: inline-flex;
  align-items: center;
  gap: .3rem;
  margin: 0;
  padding-right: .55rem;
  font-size: .7rem;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  text-decoration: none !important;
}
.mb-kb-create-draft a > span { opacity: .5; transition: opacity .25s; }
.mb-kb-create-draft a:hover > span,
.mb-kb-create-draft a:focus > span { opacity: 1; }
.mb-kb-create-draft a[aria-disabled="true"] { opacity: .5; cursor: wait; }
/* Creating the draft: the button turns the draft's yellow (the Draft tab's
   mix, said here too: the editor's stylesheet may not be loaded yet), its
   plus a spinner, and its label says what is being done. */
.md-typeset .mb-kb-create-draft a.md-content__button {
  border-radius: .4rem;
  transition: background-color .3s ease, color .3s ease, padding .3s ease;
}
.md-typeset .mb-kb-create-draft a.md-content__button[aria-busy="true"] {
  opacity: 1;
  padding: .45rem .75rem .45rem .6rem;
  background: color-mix(in oklch, oklch(0.82 0.17 86) 28%, var(--md-default-bg-color, #fff));
  color: color-mix(in oklch, oklch(0.82 0.17 86) 52%, var(--md-default-fg-color, #000));
}
.mb-kb-create-draft a[aria-busy="true"] > span { opacity: 1; animation: mb-kb-cd-in .3s ease; }
.mb-kb-create-draft a[aria-busy="true"] > svg { animation: mb-kb-cd-spin .9s linear infinite; }
@keyframes mb-kb-cd-spin { to { transform: rotate(360deg); } }
@keyframes mb-kb-cd-in { from { opacity: 0; transform: translateY(3px); } }
@media (prefers-reduced-motion: reduce) {
  .mb-kb-create-draft a[aria-busy="true"] > span { animation: none; }
}
/* An admin url is the site's 404 until kbAdmin.js has drawn over it: keep the
   "404 - Not found" and the reader's navigation from flashing first. */
html.mb-kb-admin-hold .md-main__inner { visibility: hidden; }
/* The admin button stands between the light / dark toggle and the search box.
   Two of the theme's header buttons side by side are 1.2rem apart, icon to
   icon (each has .2rem margin and .4rem padding); the search box has neither,
   so it would sit .6rem off the icon. It is given the other .6rem. (The box is
   not shown on a small screen: nothing to undo there.) */
.md-header__inner > .mb-kb-admin-cog ~ .md-search { margin-left: .6rem; }
`;

function ensureSiteCss(doc) {
  // At document_start there may be no <head> yet.
  const host = doc.head || doc.documentElement;
  if (!host || doc.getElementById('mb-kb-site-css')) return;
  const style = doc.createElement('style');
  style.id = 'mb-kb-site-css';
  style.textContent = SITE_CSS;
  host.append(style);
}

/**
 * A draft URL with no draft: the 404 heading becomes "This page has no draft
 * yet", with "+ Create new draft" under it. It is the theme's own edit control
 * (`md-content__button md-icon`, as injectEditButton uses) with a label;
 * SITE_CSS undoes the float and sizes the label.
 */
export function injectCreateDraftButton(doc, onCreate) {
  const article = doc.querySelector(ARTICLE);
  if (!article || article.querySelector('.mb-kb-create-draft')) return null;
  const h1 = article.querySelector('h1');
  if (h1) h1.textContent = 'This page has no draft yet';
  ensureSiteCss(doc);
  const p = doc.createElement('p');
  p.className = 'mb-kb-create-draft';
  const btn = doc.createElement('a');
  btn.className = 'md-content__button md-icon';
  btn.href = '#';
  btn.setAttribute('role', 'button');
  setThemeTip(doc, btn, 'Copy the live page into a new draft you can edit', { name: false });
  const IDLE = 'Create new draft';
  let label = doc.createElement('span');
  label.textContent = IDLE;
  btn.append(label);
  // The plus, or the spinner while the draft is being made.
  let busy = false;
  const icons = {};
  const setIcon = name => {
    const svg = icons[name];
    if (!svg) return;
    btn.innerHTML = svg;
    btn.append(label);
  };
  for (const name of ['plus', 'loader-circle']) {
    Promise.resolve().then(() => getLucideSvgMarkup(name)).then(svg => {
      if (!svg) return;
      icons[name] = svg;
      if (name === (busy ? 'loader-circle' : 'plus')) setIcon(name);
    }).catch(() => {});
  }
  // Each step comes up afresh in the label (a new span: its entry animation replays).
  const say = text => {
    const next = doc.createElement('span');
    next.textContent = text || IDLE;
    if (label.parentNode && label.replaceWith) label.replaceWith(next); else btn.append(next);
    label = next;
  };
  btn.addEventListener('click', async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    busy = true;
    btn.setAttribute('aria-disabled', 'true');
    btn.setAttribute('aria-busy', 'true');
    setIcon('loader-circle');
    say('Creating draft…');
    // onCreate gets `say`, to tell the button each step as it is taken.
    try { await onCreate(say); }
    finally {
      busy = false;
      btn.removeAttribute?.('aria-disabled');
      btn.setAttribute('aria-busy', 'false');
      say(IDLE);
      setIcon('plus');
    }
  });
  p.append(btn);
  if (h1) h1.after(p); else article.append(p);
  return p;
}

function removeInjected(doc) {
  doc.querySelectorAll('.mb-kb-edit, .mb-kb-log, .mb-kb-buttons-end, .mb-kb-modenav, .mb-kb-mdview, .mb-kb-exit, .mb-kb-publish, .mb-kb-delete, .mb-kb-create-draft').forEach(el => el.remove());
}

function domReady(doc) {
  if (doc.readyState !== 'loading') return Promise.resolve();
  return new Promise(resolve => doc.addEventListener('DOMContentLoaded', resolve, { once: true }));
}

// Material sizes the site in rem off an enlarged root (125%+ and growing with
// the viewport), which would inflate the extension's own rem-sized chrome.
// Publish the correction as a CSS variable; formsStyling.css applies it.
function syncHostZoom(win) {
  const apply = () => {
    const root = parseFloat(win.getComputedStyle(win.document.documentElement).fontSize) || 16;
    win.document.documentElement.style.setProperty('--mb-kb-zoom', String(Math.round((16 / root) * 1000) / 1000));
  };
  win.document.documentElement.classList.add('mb-kb-host');
  apply();
  win.addEventListener('resize', apply);
}

/**
 * Whether the site is showing its dark scheme: true / false, or null when it
 * does not say (the extension then follows the system theme). The theme sets
 * `color-scheme` for the scheme on <body>; the scheme's name is the fallback
 * ("slate" is the dark one). Pure.
 */
export function kbSchemeIsDark(colorScheme, schemeName) {
  if (/\bdark\b/.test(colorScheme ?? '')) return true;
  if (/\blight\b/.test(colorScheme ?? '')) return false;
  return schemeName ? schemeName === 'slate' : null;
}

// The site has its own light / dark toggle (kept for the session, and able to
// follow the system). The extension's chrome goes with what the site shows, not
// with the system: publish it as `data-mb-theme`, which formsStyling.css reads.
function syncHostTheme(win) {
  const doc = win.document;
  const apply = () => {
    const body = doc.body;
    if (!body) return;
    const dark = kbSchemeIsDark(win.getComputedStyle(body).colorScheme, body.getAttribute('data-md-color-scheme'));
    if (dark == null) doc.documentElement.removeAttribute('data-mb-theme');
    else doc.documentElement.setAttribute('data-mb-theme', dark ? 'dark' : 'light');
  };
  apply();
  new win.MutationObserver(apply).observe(doc.body, {
    attributes: true,
    attributeFilter: ['data-md-color-scheme', 'data-md-color-media'],
  });
  win.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply);
}

let ctx = null;

/** The page this tab is on (null before startKbSite, or off a guide page). */
export function currentKbPage() {
  return ctx?.page ?? null;
}

const holdAdmin = on => document.documentElement.classList.toggle('mb-kb-admin-hold', on);

/**
 * @param {{loadActions: () => Promise<object>}} deps
 */
export async function startKbSite(deps) {
  const page = classifyKbPath(location.pathname);
  const admin = classifyAdminPath(location.pathname);
  if (admin) {
    // Hide the 404 while the token is checked, but only for someone who has
    // one saved: a reader with the extension and no token sees the site as is.
    const { moreButtonsIntegrations } = await chrome.storage.local.get('moreButtonsIntegrations');
    if (moreButtonsIntegrations?.githubPAT) { ensureSiteCss(document); holdAdmin(true); }
  }
  // No token, or one GitHub rejects: leave the site untouched.
  if (!(await currentGithubLogin())) { holdAdmin(false); return; }
  await domReady(document);
  syncHostZoom(window);
  syncHostTheme(window);
  injectAdminCog(document);
  if (admin) {
    try {
      // Only over the site's own 404: a real page at this url is left alone.
      if (isNotFoundPage(document)) {
        const { startKbAdmin } = await import('./kbAdmin.js');
        await startKbAdmin();
      }
    } catch (err) {
      console.error('MB Error: could not start the Knowledge base admin area', err);
    } finally {
      holdAdmin(false);
    }
    return;
  }
  if (!page) return;
  ctx = { ...deps, page };
  await refreshKbSite();
}

/** Re-read the page's state and redraw its buttons (after Create draft, say). */
export async function refreshKbSite() {
  if (!ctx) return;
  const { page } = ctx;
  let state = null;
  let hasLive = true;
  try {
    if (page.side === 'live') {
      state = isNotFoundPage(document) ? null : 'live';
    } else {
      const [draftMd, liveMd] = await Promise.all([readRepoText(page.draftPath), readRepoText(page.livePath)]);
      hasLive = !!liveMd;
      // The updates page's draft is a list of its own, never a copy of the live
      // page: there is no "Create draft" for it.
      state = draftMd ? 'draft' : hasLive && !isUpdatesPage(page) ? 'no-draft' : null;
    }
  } catch (err) {
    console.warn('MB Warn: could not read the Knowledge Base page state', err);
    return;
  }
  removeInjected(document);
  document.documentElement.classList.toggle('mb-kb-no-draft', state === 'no-draft');
  if (state === 'live') {
    injectEditButton(document, page);
    injectLogButton(document, page);
  }
  if (state === 'no-draft') {
    injectCreateDraftButton(document, async say => {
      try { await (await ctx.loadActions()).kbCreateDraft(say); }
      catch (err) { console.error('MB Error: could not create the draft', err); }
    });
    // This is edit mode too, with nothing to edit yet: the editor adds the row
    // above the heading (the way out, and across to the live content) and
    // draws the live content when asked. Create draft is on the page before
    // the editor has loaded, and stays if it cannot.
    try { await (await ctx.loadActions()).kbEnterEditMode?.(page, { hasLive, noDraft: true }); }
    catch (err) { console.error('MB Error: could not start edit mode', err); }
  }
  if (state === 'draft') {
    try { await (await ctx.loadActions()).kbEnterEditMode?.(page, { hasLive }); }
    catch (err) { console.error('MB Error: could not start the page editor', err); }
  }
}
