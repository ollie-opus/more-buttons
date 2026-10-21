/**
 * pageDock.js — the floating right-edge button dock on host webapp pages.
 *
 * Owns:
 *   - The `#mb-page-dock` root (appended to document.documentElement): a frosted
 *     vertical island of icon-only tiles plus a collapse handle on its left edge.
 *   - The open/collapsed state, persisted to chrome.storage.local
 *     (`moreButtonsPageDock` → { open }, default open).
 *
 * Driven by content.js, which calls renderPageDock on every SPA navigation with
 * the buttons matching the current page and a `dispatch(action)` callback. The
 * root + handle persist across calls; only the island's children are rebuilt.
 * Ordering/grouping is delegated to dockLayout.orderDockButtons.
 *
 * Config strings (displayText/descriptionText) only ever reach the DOM through
 * textContent. No chrome.* / document access at module scope, so the module
 * imports cleanly in Node for tests.
 */

import { orderDockButtons, normaliseGroup } from './dockLayout.js';

const STORAGE_KEY = 'moreButtonsPageDock';
const ROOT_ID = 'mb-page-dock';

// Bumped by every render/remove. A render that resumes after awaiting storage
// and finds the counter moved on is stale and must not touch the DOM.
let generation = 0;

function ensureStylesheet(doc) {
  if (doc.getElementById('more-buttons-overlay-stylesheet')) return;
  const link = doc.createElement('link');
  link.id = 'more-buttons-overlay-stylesheet';
  link.rel = 'stylesheet';
  link.href = chrome.runtime.getURL('config/forms/formsStyling.css');
  (doc.head || doc.documentElement).appendChild(link);
}

async function loadOpen() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    return stored?.[STORAGE_KEY]?.open !== false;
  } catch { return true; }
}

function persistOpen(open) {
  try { Promise.resolve(chrome.storage.local.set({ [STORAGE_KEY]: { open } })).catch(() => {}); } catch {}
}

function make(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function applyOpenState(root, handle, icon, open) {
  root.classList.toggle('--closed', !open);
  handle.setAttribute('aria-expanded', String(open));
  handle.setAttribute('aria-label', open ? 'Collapse More Buttons dock' : 'Expand More Buttons dock');
  icon.textContent = open ? 'chevron_right' : 'chevron_left';
}

function createRoot(doc, open) {
  const root = make(doc, 'div', 'mb-page-dock');
  root.id = ROOT_ID;
  root.setAttribute('role', 'toolbar');
  root.setAttribute('aria-label', 'More Buttons');
  root.appendChild(make(doc, 'div', 'mb-page-dock__island'));

  const handle = make(doc, 'button', 'mb-page-dock__handle');
  handle.setAttribute('type', 'button');
  const icon = handle.appendChild(make(doc, 'span', 'more-buttons-icon'));
  root.appendChild(handle);
  applyOpenState(root, handle, icon, open);

  handle.addEventListener('click', () => {
    const nowOpen = root.classList.contains('--closed');
    applyOpenState(root, handle, icon, nowOpen);
    persistOpen(nowOpen);
  });
  return root;
}

function buildTile(doc, def, dispatch) {
  const tile = make(doc, 'button', ['more-buttons-button', 'mb-page-dock__tile', def.colour].filter(Boolean).join(' '));
  tile.setAttribute('type', 'button');
  if (def.id) tile.id = def.id;
  tile.setAttribute('aria-label', def.displayText ?? '');
  tile.appendChild(make(doc, 'span', 'more-buttons-icon', def.icon ?? ''));

  const tag = make(doc, 'span', 'mb-page-dock__tag');
  tag.setAttribute('aria-hidden', 'true');
  tag.appendChild(make(doc, 'b', null, def.displayText ?? ''));
  if (def.descriptionText) tag.appendChild(make(doc, 'small', null, def.descriptionText));
  tile.appendChild(tag);

  tile.addEventListener('click', () => dispatch(def.action));
  return tile;
}

function buildIslandChildren(doc, buttons, dispatch) {
  const out = [];
  orderDockButtons(buttons).forEach((group, i) => {
    if (i > 0) {
      const sep = make(doc, 'span', 'mb-dock-sep');
      sep.setAttribute('aria-hidden', 'true');
      out.push(sep);
    }
    const wrap = make(doc, 'div', 'mb-page-dock__group');
    const name = normaliseGroup(group[0].dockGroup);
    if (name !== null) wrap.dataset.group = name;
    group.forEach((def) => wrap.appendChild(buildTile(doc, def, dispatch)));
    out.push(wrap);
  });
  return out;
}

export async function renderPageDock(buttons, dispatch, { doc = document } = {}) {
  const gen = ++generation;
  ensureStylesheet(doc);
  let root = doc.getElementById(ROOT_ID);
  if (!root) {
    const open = await loadOpen();
    if (gen !== generation) return; // a newer render/remove superseded us
    root = doc.getElementById(ROOT_ID) ?? doc.documentElement.appendChild(createRoot(doc, open));
  }
  root.querySelector('.mb-page-dock__island')
    .replaceChildren(...buildIslandChildren(doc, buttons, dispatch));
}

export function removePageDock({ doc = document } = {}) {
  generation++; // cancel any render still awaiting storage
  doc.getElementById(ROOT_ID)?.remove();
}
