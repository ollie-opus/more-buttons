/**
 * kbSite.js — the extension's presence on the published Knowledge Base
 * (support.opus-safety.co.uk), driven by content.js on that host only.
 *
 * Works out what the current page is and shows what belongs on it:
 *
 *   live      a published guide            → an "Edit this page" icon beside the
 *                                            title, where the theme puts its own
 *                                            (goes to the page's draft URL), and
 *                                            an "Edit log" icon next to it
 *   draft     a draft that exists in GitHub → the in-page editor, which brings
 *                                            its own bottom bar and keeps the
 *                                            "Edit log" icon in the same place
 *   no-draft  a draft URL with no draft file, whose live page exists
 *                                           → the 404 heading reads "This page
 *                                             has no draft yet", with
 *                                             "+ Create draft" under it
 *
 *   admin     /admin and the pages under it → the Knowledge Base admin area,
 *                                            drawn where the site's 404 would be
 *                                            (kbAdmin.js). Every page of the
 *                                            site gets a cog in the header, left
 *                                            of the search, that leads there.
 *
 * There is no side dock on this site: buttons are placed in the page itself.
 *
 * Everything is gated on a working GitHub token: with none (or an invalid one)
 * the site is left exactly as a reader sees it. Apart from the header cog, the
 * home page and the System Status / System Updates pages are never touched.
 *
 * "Does the draft exist" is asked of GitHub, never of the page: the site build
 * lags a commit by minutes, so a fresh draft is still a 404 here and a
 * published one still renders.
 *
 * Stays light: the editor stack (actions.js) is only loaded on a draft page.
 */

import { readRepoText, currentGithubLogin } from './repoClient.js';
import { getLucideSvgMarkup } from './lucideIcons.js';

export const KB_HOST = 'support.opus-safety.co.uk';

// Guides the in-page editor does not cover (they have their own editors).
const EXCLUDED_SLUGS = new Set(['system-status', 'system-updates']);

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
  if (!slug || slug.includes('/') || EXCLUDED_SLUGS.has(slug)) return null;
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

/**
 * `/admin`, `/admin/pages`, `/admin/media-library`, `/admin/settings` and their
 * sub-screens (trailing slash optional) → the screen addressed; null for
 * anything else. Pure.
 * @returns {{route: keyof typeof ADMIN_ROUTES}|null}
 */
export function classifyAdminPath(pathname) {
  const m = /^\/admin(?:\/([a-z-]+(?:\/[a-z-]+)?))?\/?$/.exec(pathname ?? '');
  if (!m) return null;
  const route = m[1] ?? 'home';
  return Object.hasOwn(ADMIN_ROUTES, route) ? { route } : null;
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
  a.title = 'Knowledge Base admin';
  a.setAttribute('aria-label', 'Knowledge Base admin');
  // The search is a label (small screens) followed by the search box; the cog
  // goes before both. With no search, it sits ahead of the "Ask" button.
  const before = header.querySelector('label[for="__search"]')
    ?? header.querySelector('.md-search')
    ?? header.querySelector('.md-header__source');
  if (before) before.before(a); else header.append(a);
  Promise.resolve().then(() => getLucideSvgMarkup('sliders-horizontal')).then(svg => { if (svg) a.innerHTML = svg; }).catch(() => {});
  return a;
}

/** The site's own "404 - Not found" page (it keeps the normal header and layout). */
export function isNotFoundPage(doc) {
  return /^\s*404\b/.test(doc.querySelector('article h1')?.textContent ?? '');
}

const ARTICLE = 'article.md-content__inner';

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
  a.title = 'Edit this page';
  a.setAttribute('aria-label', 'Edit this page');
  article.prepend(a);
  Promise.resolve().then(() => getLucideSvgMarkup('file-pen')).then(svg => { if (svg) a.innerHTML = svg; }).catch(() => {});
  return a;
}

function openEditLog(page, btn) {
  return import('./kbEditLog.js')
    .then(({ openKbEditLog }) => openKbEditLog(page, { returnFocus: btn }))
    .catch(err => console.error('MB Error: could not open the edit log', err));
}

/**
 * The Edit log control: the same theme icon button as "Edit this page", sitting
 * to its right on a live page and alone in that place on a draft (where the
 * editor puts it back after each redraw). Opens the page's edit log in a popup.
 */
export function injectLogButton(doc, page, onOpen = openEditLog) {
  const article = doc.querySelector(ARTICLE);
  if (!article || article.querySelector('.mb-kb-log')) return null;
  const a = doc.createElement('a');
  a.className = 'md-content__button md-icon mb-kb-log';
  a.href = '#';
  a.title = 'Edit log';
  a.setAttribute('role', 'button');
  a.setAttribute('aria-label', 'Edit log');
  a.setAttribute('aria-haspopup', 'dialog');
  a.addEventListener('click', (e) => {
    e?.preventDefault?.();
    onOpen(page, a);
  });
  // Both float right: the first one in the article sits furthest right.
  article.prepend(a);
  Promise.resolve().then(() => getLucideSvgMarkup('history')).then(svg => { if (svg) a.innerHTML = svg; }).catch(() => {});
  return a;
}

// The little this module needs beyond the theme's own classes (no extension
// stylesheet is loaded outside the editor).
//  - A draft URL with no draft shows only the heading and Create draft: until
//    the site rebuilds after a draft is deleted, the old draft's content,
//    contents list and breadcrumbs are still in the served page. The article
//    keeps the place it has in the editor (formsStyling.css, `mb-kb-editing`):
//    reader width, centred, as if the hidden side panels were still there.
//  - Create draft's label matches its icon (half strength, full on hover) and
//    is not underlined like a link in the text.
const SITE_CSS = `
html.mb-kb-no-draft .md-sidebar--primary,
html.mb-kb-no-draft .md-sidebar--secondary,
html.mb-kb-no-draft .md-path,
html.mb-kb-no-draft article.md-content__inner > :not(h1):not(.mb-kb-create-draft) { display: none !important; }
html.mb-kb-no-draft .md-content { max-width: 37rem; margin-inline: auto; }
.mb-kb-create-draft a { text-decoration: none !important; font-weight: 500; }
.mb-kb-create-draft a > span { opacity: .5; transition: opacity .25s; }
.mb-kb-create-draft a:hover > span,
.mb-kb-create-draft a:focus > span { opacity: 1; }
/* An admin url is the site's 404 until kbAdmin.js has drawn over it: keep the
   "404 - Not found" and the reader's navigation from flashing first. */
html.mb-kb-admin-hold .md-main__inner { visibility: hidden; }
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
 * yet", with "+ Create draft" under it. It is the theme's own edit control
 * (`md-content__button md-icon`, as injectEditButton uses) with a label; the
 * inline style only undoes the float and spaces the label from the icon.
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
  btn.title = 'Copy the live page into a new draft you can edit';
  btn.style.cssText = 'float:none;display:inline-flex;align-items:center;gap:.3rem;margin:0;padding-right:.5rem';
  const label = doc.createElement('span');
  label.textContent = 'Create draft';
  const setIcon = svg => { btn.innerHTML = svg; btn.append(label); };
  btn.append(label);
  Promise.resolve().then(() => getLucideSvgMarkup('plus')).then(svg => { if (svg) setIcon(svg); }).catch(() => {});
  let busy = false;
  btn.addEventListener('click', async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    busy = true;
    btn.setAttribute('aria-disabled', 'true');
    btn.style.opacity = '.5';
    btn.style.cursor = 'wait';
    try { await onCreate(); }
    finally {
      busy = false;
      btn.removeAttribute?.('aria-disabled');
      btn.style.opacity = '';
      btn.style.cursor = '';
    }
  });
  p.append(btn);
  if (h1) h1.after(p); else article.append(p);
  return p;
}

function removeInjected(doc) {
  doc.querySelectorAll('.mb-kb-edit, .mb-kb-log, .mb-kb-create-draft').forEach(el => el.remove());
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
      console.error('MB Error: could not start the Knowledge Base admin area', err);
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
      state = draftMd ? 'draft' : hasLive ? 'no-draft' : null;
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
    injectCreateDraftButton(document, async () => {
      try { await (await ctx.loadActions()).kbCreateDraft(); }
      catch (err) { console.error('MB Error: could not create the draft', err); }
    });
  }
  if (state === 'draft') {
    try { (await ctx.loadActions()).kbEnterEditMode?.(page, { hasLive }); }
    catch (err) { console.error('MB Error: could not start the page editor', err); }
  }
}
