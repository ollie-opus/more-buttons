/**
 * kbAdmin.js — the Knowledge Base admin area on the published site
 * (support.opus-safety.co.uk/admin and the pages under it).
 *
 * The site has nothing at these urls: they are its 404 page. kbSite.js spots
 * the url and hands over to startKbAdmin, which draws the admin screen where
 * the page content goes, inside the site's own layout: its header and tabs
 * stay, the left navigation becomes the admin navigation, and the screen is
 * built from the theme's own pieces (breadcrumbs, card grid, admonitions), so
 * it reads as a page of the site, not a popup over it.
 *
 *   /admin/                       tiles to the areas below
 *   /admin/pages/                 every page, with Create and Reorder   (kbAdminPages.js)
 *   /admin/pages/new/             a new page as a draft                 (kbAdminPages.js)
 *   /admin/media-library/         the media folders                     (kbAdminMedia.js)
 *   /admin/media-library/upload/  add a file                            (kbAdminMedia.js)
 *   /admin/settings/              the tag registry                      (kbAdminSettings.js)
 *
 * Moving between screens is done here (history.pushState): each real load of
 * an admin url costs a 404 round trip. A screen module exports `mount(ctx)`
 * and may return `{ canLeave, destroy }`.
 */

import { ADMIN_ROUTES, classifyAdminPath } from './kbSite.js';
import { loadLucideBodies, lucideSvg } from './lucideIcons.js';
import { searchMatches } from './kbTree.js';

const SITE_NAME = 'Opus Knowledge Base';

// One entry per screen. `nav` screens appear in the left navigation and as
// tiles on the home screen; the others hang off their `parent`.
const SCREENS = {
  home: { title: 'Admin', icon: 'sliders-horizontal' },
  pages: {
    title: 'Manage pages', icon: 'files', nav: true, module: 'kbAdminPages.js', mount: 'mountPages',
    blurb: 'Every guide and system page. Create a new page or change the order of the navigation.',
  },
  'pages/new': { title: 'New page', parent: 'pages', module: 'kbAdminPages.js', mount: 'mountNewPage' },
  'media-library': {
    title: 'Media library', icon: 'images', nav: true, module: 'kbAdminMedia.js', mount: 'mountMedia',
    blurb: 'The captures, images and videos the pages use, and where each one appears.',
  },
  'media-library/upload': { title: 'Upload a file', parent: 'media-library', module: 'kbAdminMedia.js', mount: 'mountUpload' },
  settings: {
    title: 'Settings', icon: 'settings', nav: true, module: 'kbAdminSettings.js', mount: 'mountSettings',
    blurb: 'The tags pages can carry, and the colour each one shows in.',
  },
};

export const escapeHtml = s =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Outline lucide markup by name ('' until the icon map has loaded, or for an unknown name). */
export const icon = name => lucideSvg(name) || '';

// ── Stylesheets ──────────────────────────────────────────────────────────────

function loadSheet(id, file) {
  let link = document.getElementById(id);
  if (link?.sheet) return Promise.resolve();
  if (!link) {
    link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL(file);
    (document.head || document.documentElement).appendChild(link);
  }
  return new Promise(resolve => {
    link.addEventListener('load', resolve, { once: true });
    link.addEventListener('error', resolve, { once: true });
  });
}

// ── Page actions ─────────────────────────────────────────────────────────────
// A screen's buttons sit in the page itself, never in a bar over it (the bottom
// bar on this site belongs to the draft editor alone). A screen describes its
// buttons; clicks come back through `onAct`. Two places: 'top', beside the
// title (list screens), and 'end', under the content (forms, where the button
// finishes what was filled in above it).

let actions = null;
const TONES = new Set(['accent', 'pink']);

/**
 * @param {Array<Array<{act:string, icon:string, label:string, colour?:string, pressed?:boolean, disabled?:boolean}>>} groups
 *   `colour`: 'accent' for the button that needs emphasis (the one that saves,
 *   uploads or publishes), in the theme's accent colour; 'pink' for a mode that is on.
 * @param {(act:string, btn:HTMLElement) => void} onAct
 * @param {{at?: 'top'|'end'}} [opts]
 */
function setActions(groups, onAct, { at = 'top' } = {}) {
  // A redraw (a toggle, a dirty flip) must not drop the keyboard's place.
  const focused = actions?.contains(document.activeElement) ? document.activeElement.dataset.admAct : null;
  actions?.remove();
  actions = null;
  const shown = (groups ?? []).filter(g => g?.length);
  const slot = document.querySelector(`${ARTICLE} [data-adm-actions="${at}"]`);
  if (!shown.length || !slot) return null;
  const el = document.createElement('div');
  el.className = 'mb-adm-actions';
  el.setAttribute('role', 'toolbar');
  el.setAttribute('aria-label', 'Page actions');
  el.innerHTML = shown.map(group => `<div class="mb-adm-actions__group">${group.map(b => `
      <button type="button" class="mb-adm-button${TONES.has(b.colour) ? ` --${b.colour}` : ''}" data-adm-act="${escapeHtml(b.act)}"
        ${b.pressed != null ? `aria-pressed="${b.pressed}"` : ''} ${b.disabled ? 'aria-disabled="true"' : ''}>
        ${icon(b.icon)}<span>${escapeHtml(b.label)}</span></button>`).join('')}</div>`).join('');
  el.addEventListener('click', e => {
    const btn = e.target instanceof Element && e.target.closest('[data-adm-act]');
    if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') return;
    onAct?.(btn.dataset.admAct, btn);
  });
  slot.appendChild(el);
  actions = el;
  if (focused) actionButton(focused)?.focus({ preventScroll: true });
  return el;
}

/** The button for an action (null when it is not on the screen). */
const actionButton = act => actions?.querySelector(`[data-adm-act="${act}"]`) ?? null;

/**
 * Put an action button into its working state: disabled, a turning icon and the
 * progress message as its label. Pair with snapshotButton / restoreButton
 * (loading.js) to put it back after a failure.
 */
export function busyAction(btn, message) {
  if (!btn) return;
  btn.disabled = true;
  btn.classList.add('--busy');
  btn.innerHTML = `${icon('refresh-cw')}<span>${escapeHtml(message)}</span>`;
}

// ── The tree ─────────────────────────────────────────────────────────────────
// One renderer for the pages tree and the media folders.
//
// Node: { id, label, children?: Node[] }               a folder
//       { id, label, href?, pills?: string, open?: bool, detail?: string }   a leaf
// `path` (reorder only) is the node's index path in the unfiltered tree.

const CONTROLS = [
  ['up', 'chevron-up', 'Move up'],
  ['down', 'chevron-down', 'Move down'],
  ['to', 'folder-input', 'Move to another section'],
];

function controlsHtml(path, isFirst, isLast) {
  return `<span class="mb-adm-controls">${CONTROLS.map(([act, name, title]) => {
    const off = (act === 'up' && isFirst) || (act === 'down' && isLast);
    return `<button type="button" class="mb-adm-ctl" data-adm-move="${act}" data-adm-path="${path}" title="${title}" aria-label="${title}"${off ? ' disabled' : ''}>${icon(name)}</button>`;
  }).join('')}</span>`;
}

const countLeaves = node => (node.children ? node.children.reduce((n, c) => n + countLeaves(c), 0) : 1);

/**
 * @param {object[]} nodes
 * @param {{query?:string, predicate?:((leaf:object)=>boolean)|null, collapsed?:Set<string>, reorder?:boolean, leafIcon?:string, empty?:string}} opts
 * @returns {{html:string, shown:number, total:number}}
 */
export function renderAdminTree(nodes, { query = '', predicate = null, collapsed = new Set(), reorder = false, leafIcon = 'file-text', empty = 'Nothing here yet.' } = {}) {
  const narrowed = query.trim() !== '' || !!predicate;
  let shown = 0;
  let total = 0;

  const draw = (list, trail, idxTrail) => list.map((node, i) => {
    const labels = [...trail, node.label];
    const path = [...idxTrail, i].join('.');
    const ctl = reorder ? controlsHtml(path, i === 0, i === list.length - 1) : '';
    const idAttr = `data-adm-id="${escapeHtml(node.id)}"`;
    if (node.children) {
      const inner = draw(node.children, labels, [...idxTrail, i]);
      if (narrowed && !inner) return '';
      const open = narrowed || !collapsed.has(node.id);
      return `<li class="mb-adm-node --folder${open ? '' : ' --collapsed'}" role="treeitem" aria-expanded="${open}">
        <div class="mb-adm-row" ${idAttr}>
          <button type="button" class="mb-adm-row__main" data-adm-fold="${escapeHtml(node.id)}">
            <span class="mb-adm-chevron">${icon('chevron-right')}</span>
            <span class="mb-adm-label">${escapeHtml(node.label)}</span>
            <span class="mb-adm-count">${countLeaves(node)}</span>
          </button>${ctl}
        </div>
        <ul role="group">${inner}</ul>
      </li>`;
    }
    total++;
    if (!searchMatches(labels, query) || (predicate && !predicate(node))) return '';
    shown++;
    const body = `<span class="mb-adm-leaf-icon">${icon(node.icon || leafIcon)}</span><span class="mb-adm-label">${escapeHtml(node.label)}</span>`;
    // While reordering a row is something to move, not somewhere to go.
    const main = node.href && !reorder
      ? `<a class="mb-adm-row__main" href="${escapeHtml(node.href)}">${body}</a>`
      : `<button type="button" class="mb-adm-row__main" data-adm-leaf="${escapeHtml(node.id)}"${node.open != null ? ` aria-expanded="${!!node.open}"` : ''}>${body}</button>`;
    return `<li class="mb-adm-node --leaf${node.open ? ' --open' : ''}" role="treeitem">
      <div class="mb-adm-row" ${idAttr}>${main}${node.pills ? `<span class="mb-adm-pills">${node.pills}</span>` : ''}${ctl}</div>
      ${node.open && node.detail ? `<div class="mb-adm-detail">${node.detail}</div>` : ''}
    </li>`;
  }).join('');

  const inner = draw(nodes ?? [], [], []);
  if (!total) return { html: `<p class="mb-adm-empty">${escapeHtml(empty)}</p>`, shown, total };
  if (!shown) return { html: '<p class="mb-adm-empty">Nothing matches. Try a shorter search, or clear the filters.</p>', shown, total };
  return { html: `<ul class="mb-adm-tree${reorder ? ' --reorder' : ''}" role="tree">${inner}</ul>`, shown, total };
}

/** Placeholder rows while a list loads (the list's own shape, not a spinner). */
export function skeletonHtml(rows = 7) {
  const widths = [38, 52, 44, 61, 35, 48, 57, 41];
  return `<div class="mb-adm-skeleton" aria-busy="true" aria-label="Loading">${
    Array.from({ length: rows }, (_, i) => `<span style="width:${widths[i % widths.length]}%"></span>`).join('')}</div>`;
}

/** One of the theme's admonitions (kind: failure | success | info | warning). */
export function noticeHtml(kind, title, text = '') {
  return `<div class="admonition ${kind} mb-adm-notice" role="${kind === 'failure' ? 'alert' : 'status'}">
    <p class="admonition-title">${escapeHtml(title)}</p>${text ? `<p>${escapeHtml(text)}</p>` : ''}</div>`;
}

// ── The shell ────────────────────────────────────────────────────────────────

const ARTICLE = 'article.md-content__inner';
let current = null;   // { route, handle } for the mounted screen
let mounting = 0;

const routeUrl = route => ADMIN_ROUTES[route] ?? ADMIN_ROUTES.home;

function drawSidebar(route) {
  const inner = document.querySelector('.md-sidebar--primary .md-sidebar__inner');
  if (!inner) return;
  const section = SCREENS[route]?.parent ?? route;
  const link = (key, label, name) => `
    <li class="md-nav__item${key === section ? ' md-nav__item--active' : ''}">
      <a href="${routeUrl(key)}" class="md-nav__link${key === section ? ' md-nav__link--active' : ''}" data-adm-route="${key}"${key === section ? ' aria-current="page"' : ''}>
        ${icon(name)}<span class="md-ellipsis">${escapeHtml(label)}</span>
      </a>
    </li>`;
  inner.innerHTML = `
    <nav class="md-nav md-nav--primary mb-adm-nav" aria-label="Admin" data-md-level="0">
      <label class="md-nav__title" for="__drawer">Admin</label>
      <ul class="md-nav__list">
        ${link('home', 'Overview', 'layout-grid')}
        ${Object.entries(SCREENS).filter(([, s]) => s.nav).map(([key, s]) => link(key, s.title, s.icon)).join('')}
      </ul>
      <ul class="md-nav__list mb-adm-nav__exit">
        <li class="md-nav__item">
          <a href="/" class="md-nav__link">${icon('arrow-left')}<span class="md-ellipsis">Back to the Knowledge Base</span></a>
        </li>
      </ul>
    </nav>`;
}

function drawPath(route) {
  const content = document.querySelector('.md-content');
  if (!content) return;
  const trail = [];
  for (let key = route; key && key !== 'home'; key = SCREENS[key]?.parent) trail.unshift(key);
  const item = (href, label, attr = '') =>
    `<li class="md-path__item"><a href="${href}" class="md-path__link"${attr}><span class="md-ellipsis">${escapeHtml(label)}</span></a></li>`;
  const nav = document.createElement('nav');
  nav.className = 'md-path mb-adm-path';
  nav.setAttribute('aria-label', 'Breadcrumb');
  nav.innerHTML = `<ol class="md-path__list">
    ${item('/', 'Home')}
    ${item(routeUrl('home'), 'Admin', ' data-adm-route="home"')}
    ${trail.slice(0, -1).map(key => item(routeUrl(key), SCREENS[key].title, ` data-adm-route="${key}"`)).join('')}
  </ol>`;
  content.querySelector('.md-path')?.remove();
  content.prepend(nav);
}

function mountHome(ctx) {
  ctx.body.innerHTML = `
    <p class="mb-adm-lead">Manage what the Knowledge Base holds. Editing a page's content happens on the page itself: open it and use the pencil beside its title.</p>
    <div class="grid cards mb-adm-tiles">
      <ul>${Object.entries(SCREENS).filter(([, s]) => s.nav).map(([key, s]) => `
        <li>
          <a class="mb-adm-tile" href="${routeUrl(key)}" data-adm-route="${key}">
            <span class="mb-adm-tile__icon">${icon(s.icon)}</span>
            <strong>${escapeHtml(s.title)}</strong>
          </a>
          <p>${escapeHtml(s.blurb)}</p>
        </li>`).join('')}
      </ul>
    </div>`;
}

async function show(route) {
  const screen = SCREENS[route] ?? SCREENS.home;
  const token = ++mounting;
  try { current?.handle?.destroy?.(); } catch (err) { console.error('MB Error: admin screen teardown failed', err); }
  current = { route, handle: null };
  setActions(null);

  document.title = `${screen.title === 'Admin' ? 'Admin' : `${screen.title} - Admin`} - ${SITE_NAME}`;
  drawSidebar(route);
  drawPath(route);

  const article = document.querySelector(ARTICLE);
  if (!article) return;
  article.classList.add('mb-adm');
  article.innerHTML = `
    <div class="mb-adm-head"><h1>${escapeHtml(screen.title)}</h1><div data-adm-actions="top"></div></div>
    <div class="mb-adm-body"></div>
    <div data-adm-actions="end"></div>`;
  const body = article.querySelector('.mb-adm-body');
  const ctx = {
    body,
    heading: article.querySelector('h1'),
    go,
    setActions,
    actionButton,
    /** False once another screen has taken over (an await came back late). */
    alive: () => token === mounting,
  };
  if (!screen.module) { mountHome(ctx); return; }

  body.innerHTML = skeletonHtml();
  try {
    const mod = await import(`./${screen.module}`);
    if (!ctx.alive()) return;
    const handle = await mod[screen.mount](ctx);
    if (ctx.alive()) current.handle = handle ?? null;
    else handle?.destroy?.();
  } catch (err) {
    console.error('MB Error: admin screen failed', route, err);
    if (ctx.alive()) body.innerHTML = noticeHtml('failure', 'This screen could not be loaded', err?.message ?? String(err));
  }
}

/** Unsaved work on the current screen: ask before dropping it. */
function okToLeave() {
  try { return current?.handle?.canLeave?.() !== false; } catch { return true; }
}

/** Go to another admin screen (a key of ADMIN_ROUTES). */
export function go(route, { replace = false, force = false } = {}) {
  if (!force && !okToLeave()) return false;
  const url = routeUrl(route);
  if (replace) history.replaceState({ mbAdmin: route }, '', url);
  else if (location.pathname !== url) history.pushState({ mbAdmin: route }, '', url);
  window.scrollTo(0, 0);
  show(route);
  return true;
}

function wire() {
  // Links between admin screens stay on the page; anything else is a real link.
  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target instanceof Element && e.target.closest('a[data-adm-route]');
    if (!a) return;
    e.preventDefault();
    go(a.dataset.admRoute);
  });
  window.addEventListener('popstate', () => {
    const admin = classifyAdminPath(location.pathname);
    if (!admin) { location.reload(); return; }
    if (admin.route === current?.route) return;
    if (!okToLeave()) { history.pushState({ mbAdmin: current.route }, '', routeUrl(current.route)); return; }
    show(admin.route);
  });
  // A real navigation away (a site link, closing the tab) with unsaved work.
  window.addEventListener('beforeunload', e => {
    if (current?.handle?.isDirty?.()) e.preventDefault();
  });
}

let started = false;

/** Take over the site's 404 at an admin url. Called by kbSite.js once the token checks out. */
export async function startKbAdmin() {
  if (started) return;
  const admin = classifyAdminPath(location.pathname);
  if (!admin || !document.querySelector(ARTICLE)) return;
  started = true;
  await Promise.all([
    loadSheet('mb-kb-admin-stylesheet', 'config/forms/kbAdmin.css'),
    loadLucideBodies(),
  ]);
  document.documentElement.classList.add('mb-kb-admin');
  wire();
  await show(admin.route);
}
