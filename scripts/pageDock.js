/**
 * pageDock.js — the floating right-edge button dock on host webapp pages.
 *
 * Owns:
 *   - The `#mb-page-dock` root (appended to document.documentElement): a frosted
 *     vertical island preceded by a collapse handle on its left. The island holds
 *     a micro-controls strip (pin / expand toggles) above the button tiles.
 *   - Three persisted preferences in chrome.storage.local
 *     (`moreButtonsPageDock` → { pinned, expanded, open }):
 *       pinned   (default true)  — unpinning arms the slide-away-on-leave collapse
 *                                  and is the fallback for `open` when it is absent.
 *       expanded (default false) — tiles show their displayText beside the icon and
 *                                  the hover tag shows descriptionText instead.
 *                                  Compact tags read "Group: displayText" (no
 *                                  prefix for ungrouped buttons).
 *       open     (default pinned) — the drawer is pulled out. The handle, the pin
 *                                  toggle (pin → open, unpin → closed) and the
 *                                  pointer-leave collapse all write it.
 *     Legacy `{ open:false }` alone (pre-pin builds) reads as unpinned + closed; the
 *     first write replaces it. All three prefs are UNIVERSAL: every open tab
 *     follows them via storage.onChanged and new tabs start from them, so pushing
 *     the dock away in one tab pushes it away everywhere.
 *
 * Driven by content.js, which calls renderPageDock on every SPA navigation with
 * the buttons matching the current page and a `dispatch(action)` callback. The
 * root, handle and controls strip persist across calls; only the tiles
 * container's children are rebuilt. Ordering/grouping is delegated to
 * dockLayout.orderDockButtons.
 *
 * Tile icons are lucide names written as the icon span's text; the document's
 * icon painter (lucideIcons.watchIconSpans, started by content.js) swaps them
 * for inline SVG. Config strings only ever reach the DOM through textContent. No chrome.* /
 * document access at module scope, so the module imports cleanly in Node for tests.
 */

import { orderDockButtons, normaliseGroup, isReservedGroup } from './dockLayout.js';

const STORAGE_KEY = 'moreButtonsPageDock';
const ROOT_ID = 'mb-page-dock';

// Bumped by every render/remove. A render that resumes after awaiting storage
// and finds the counter moved on is stale and must not touch the DOM.
let generation = 0;

// The storage.onChanged listener of the live root (one root per document, and
// content scripts have one document), detached by removePageDock.
let changeListener = null;

function ensureStylesheet(doc) {
  const existing = doc.getElementById('more-buttons-overlay-stylesheet');
  if (existing) return { link: existing, created: false };
  const link = doc.createElement('link');
  link.id = 'more-buttons-overlay-stylesheet';
  link.rel = 'stylesheet';
  link.href = chrome.runtime.getURL('config/forms/formsStyling.css');
  (doc.head || doc.documentElement).appendChild(link);
  return { link, created: true };
}

function normalisePrefs(stored) {
  const s = stored && typeof stored === 'object' ? stored : {};
  const pinned = typeof s.pinned === 'boolean' ? s.pinned : s.open !== false;
  return {
    pinned,
    expanded: s.expanded === true,
    open: typeof s.open === 'boolean' ? s.open : pinned,
  };
}

async function loadPrefs() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    return normalisePrefs(stored?.[STORAGE_KEY]);
  } catch { return normalisePrefs(null); }
}

function persistPrefs(prefs) {
  const value = { pinned: prefs.pinned, expanded: prefs.expanded, open: prefs.open };
  try { Promise.resolve(chrome.storage.local.set({ [STORAGE_KEY]: value })).catch(() => {}); } catch {}
}

function make(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function applyOpenState(root, handle, icon, open) {
  root.classList.toggle('--closed', !open);
  // Collapsed tiles are translated off-screen but would stay tabbable.
  const island = root.querySelector('.mb-page-dock__island');
  if (island) island.inert = !open;
  handle.setAttribute('aria-expanded', String(open));
  handle.setAttribute('aria-label', open ? 'Collapse More Buttons dock' : 'Expand More Buttons dock');
  icon.textContent = open ? 'chevron-right' : 'chevron-left';
}

function setToggleLabel(btn, text) {
  btn.setAttribute('aria-label', text);
  // No hover tag on the micro buttons, so the native tooltip carries the hint.
  btn.setAttribute('title', text);
}

function applyPinState(btn, icon, pinned) {
  btn.setAttribute('aria-pressed', String(pinned));
  setToggleLabel(btn, pinned ? 'Unpin dock (currently open by default)' : 'Pin dock open by default');
  // Icon shows the action, like the expand toggle: unpin while pinned, pin while not.
  icon.textContent = pinned ? 'pin-off' : 'pin';
}

function applyExpandedState(root, btn, icon, expanded) {
  root.classList.toggle('--expanded', expanded);
  btn.setAttribute('aria-pressed', String(expanded));
  setToggleLabel(btn, expanded ? 'Compress dock (icons only)' : 'Expand dock (show labels)');
  icon.textContent = expanded ? 'shrink' : 'expand';
}

function buildMicro(doc, variant) {
  const btn = make(doc, 'button', `mb-page-dock__micro ${variant}`);
  btn.setAttribute('type', 'button');
  const icon = btn.appendChild(make(doc, 'span', 'more-buttons-icon'));
  return { btn, icon };
}

function createRoot(doc, prefs) {
  const root = make(doc, 'div', 'mb-page-dock');
  root.id = ROOT_ID;
  root.setAttribute('role', 'toolbar');
  root.setAttribute('aria-label', 'More Buttons');
  // Handle FIRST: collapsing translates the root so only its leftmost
  // handle-width stays on screen, which must be the handle (glued to the island).
  const handle = make(doc, 'button', 'mb-page-dock__handle');
  handle.setAttribute('type', 'button');
  const handleIcon = handle.appendChild(make(doc, 'span', 'more-buttons-icon'));
  root.appendChild(handle);

  const island = root.appendChild(make(doc, 'div', 'mb-page-dock__island'));
  const controls = island.appendChild(make(doc, 'div', 'mb-page-dock__controls'));
  const pin = buildMicro(doc, '--pin');
  const expand = buildMicro(doc, '--expand');
  controls.appendChild(pin.btn);
  controls.appendChild(expand.btn);
  island.appendChild(make(doc, 'div', 'mb-page-dock__tiles'));

  const paint = () => {
    applyPinState(pin.btn, pin.icon, prefs.pinned);
    applyExpandedState(root, expand.btn, expand.icon, prefs.expanded);
  };
  applyOpenState(root, handle, handleIcon, prefs.open);
  paint();

  // Paint-only; callers that change the pref go through persistOpen.
  const setOpen = (open) => applyOpenState(root, handle, handleIcon, open);
  const persistOpen = (open) => {
    setOpen(open);
    if (prefs.open === open) return;
    prefs.open = open;
    persistPrefs(prefs);
  };

  // Unpinning while the pointer is over the dock arms a ONE-SHOT collapse that
  // fires when the pointer leaves, so the drawer slides away as you move off
  // it. Re-pinning (or anything else) before that disarms it; a dock the user
  // later pulls open via the handle is never auto-collapsed. The unpin already
  // wrote open:false (other tabs collapse at once); this tab just catches up.
  let collapseOnLeave = false;
  root.addEventListener('pointerleave', () => {
    if (!collapseOnLeave) return;
    collapseOnLeave = false;
    persistOpen(false);
  });

  // Universal: the handle persists open/closed so every tab (and new ones) follow.
  handle.addEventListener('click', () => {
    collapseOnLeave = false;
    persistOpen(root.classList.contains('--closed'));
  });
  pin.btn.addEventListener('click', () => {
    prefs.pinned = !prefs.pinned;
    // Pin → open everywhere; unpin → closed everywhere (this tab on pointer-leave).
    prefs.open = prefs.pinned;
    paint();
    persistPrefs(prefs);
    collapseOnLeave = !prefs.pinned;
  });
  expand.btn.addEventListener('click', () => {
    prefs.expanded = !prefs.expanded;
    paint();
    persistPrefs(prefs);
  });

  // Follow pin/expand/open changes made in other tabs. The drawer only moves
  // when `open` actually flipped, so an expand-only change leaves it alone and
  // this tab's own writes (prefs already updated) are no-ops here.
  detachChangeListener();
  const onChanged = (changes, area) => {
    if (area !== 'local' || !changes || !(STORAGE_KEY in changes)) return;
    const next = normalisePrefs(changes[STORAGE_KEY]?.newValue);
    const openFlipped = next.open !== prefs.open;
    Object.assign(prefs, next);
    paint();
    if (openFlipped) { collapseOnLeave = false; setOpen(prefs.open); }
  };
  try {
    chrome.storage.onChanged?.addListener?.(onChanged);
    changeListener = onChanged;
  } catch { changeListener = null; }
  return root;
}

function detachChangeListener() {
  if (!changeListener) return;
  try { chrome.storage.onChanged?.removeListener?.(changeListener); } catch {}
  changeListener = null;
}

// `groupName` is the tile's normalised dockGroup. Only the compact tag line
// carries it ("Group: Label"), and only for user-defined groups — the reserved
// Uncategorised/System buckets show the bare label. The inline label,
// aria-label and expanded description stay bare because expanded mode already
// shows the group as a heading above the tiles.
function buildTile(doc, def, dispatch, groupName = null) {
  const tile = make(doc, 'button', ['more-buttons-button', 'mb-page-dock__tile', def.colour].filter(Boolean).join(' '));
  tile.setAttribute('type', 'button');
  if (def.id) tile.id = def.id;
  tile.setAttribute('aria-label', def.displayText ?? '');
  tile.appendChild(make(doc, 'span', 'more-buttons-icon', def.icon ?? ''));
  // Inline label: CSS shows it only in expanded mode.
  tile.appendChild(make(doc, 'span', 'mb-page-dock__label', def.displayText ?? ''));

  // Tag: <b> "Group: displayText" (compressed) / <small> descriptionText (expanded).
  const tag = make(doc, 'span', 'mb-page-dock__tag');
  tag.setAttribute('aria-hidden', 'true');
  const label = def.displayText ?? '';
  const prefixed = groupName && !isReservedGroup(groupName);
  tag.appendChild(make(doc, 'b', null, prefixed ? `${groupName}: ${label}` : label));
  if (typeof def.descriptionText === 'string' && def.descriptionText.trim()) {
    tag.appendChild(make(doc, 'small', null, def.descriptionText));
  }
  tile.appendChild(tag);

  tile.addEventListener('click', (e) => {
    // Modifier state rides along so an action can offer a Ctrl/Cmd-click
    // variant (Play action skips its confirm). content.js only forwards it
    // when a modifier is actually held, so plain clicks are unchanged.
    const mods = { ctrlKey: !!e?.ctrlKey, metaKey: !!e?.metaKey, shiftKey: !!e?.shiftKey, altKey: !!e?.altKey };
    Promise.resolve().then(() => dispatch(def.action, mods))
      .catch((err) => console.warn('MB Warn: dock action failed', err));
  });
  return tile;
}

// Every group is preceded by a separator. Compressed mode hides the leading one
// and shows plain lines between groups; expanded mode turns each into a heading
// ("Group name ────"). normaliseGroup never yields null (blank → Uncategorised),
// so every separator carries a heading; the null guard is belt-and-braces.
function buildSeparator(doc, name) {
  const sep = make(doc, 'span', 'mb-dock-sep');
  sep.setAttribute('aria-hidden', 'true');
  if (name !== null) sep.appendChild(make(doc, 'span', 'mb-page-dock__sep-label', name));
  return sep;
}

function buildTileChildren(doc, buttons, dispatch) {
  const out = [];
  orderDockButtons(buttons).forEach((group) => {
    const name = normaliseGroup(group[0].dockGroup);
    out.push(buildSeparator(doc, name));
    const wrap = make(doc, 'div', 'mb-page-dock__group');
    if (name !== null) {
      wrap.dataset.group = name;
      wrap.setAttribute('aria-label', name);
    }
    group.forEach((def) => wrap.appendChild(buildTile(doc, def, dispatch, name)));
    out.push(wrap);
  });
  return out;
}

// Resolves when the stylesheet link has settled (load OR error). A link that
// already existed is treated as settled.
function stylesheetSettled(link, created) {
  if (!created) return Promise.resolve();
  return new Promise((resolve) => {
    link.addEventListener('load', resolve);
    link.addEventListener('error', resolve);
  });
}

// Resolves once `iconsReady` settles (either way) or after `capMs`, whichever
// comes first, so a slow/failed icon load can never hide the dock for good.
function iconsSettled(iconsReady, capMs) {
  if (!iconsReady) return Promise.resolve();
  const settled = Promise.resolve(iconsReady).then(() => {}, () => {});
  const cap = new Promise((resolve) => setTimeout(resolve, capMs));
  return Promise.race([settled, cap]);
}

/**
 * @param {object} [opts]
 * @param {Document} [opts.doc]
 * @param {Promise} [opts.iconsReady] — resolves when the lucide icon bodies have
 *   loaded (lucideIcons.loadChromeIcons). Until then the icon spans are empty
 *   boxes (the stylesheet hides their name text), so the first reveal waits for
 *   it too rather than showing a dock of blank tiles.
 * @param {number} [opts.revealTimeoutMs] — cap on that wait (default 1500).
 */
export async function renderPageDock(buttons, dispatch, { doc = document, iconsReady, revealTimeoutMs = 1500 } = {}) {
  const gen = ++generation;
  const { link, created } = ensureStylesheet(doc);
  let root = doc.getElementById(ROOT_ID);
  if (!root) {
    const prefs = await loadPrefs();
    if (gen !== generation) return; // a newer render/remove superseded us
    root = doc.getElementById(ROOT_ID);
    if (!root) {
      root = createRoot(doc, prefs);
      if (created || iconsReady) {
        // Hide until the stylesheet AND the icon bodies have settled so the dock
        // never flashes unstyled or with empty icon boxes.
        root.style.visibility = 'hidden';
        Promise.all([stylesheetSettled(link, created), iconsSettled(iconsReady, revealTimeoutMs)])
          .then(() => { root.style.visibility = ''; });
      }
      doc.documentElement.appendChild(root);
    }
  }
  root.querySelector('.mb-page-dock__tiles')
    .replaceChildren(...buildTileChildren(doc, buttons, dispatch));
}

export function removePageDock({ doc = document } = {}) {
  generation++; // cancel any render still awaiting storage
  detachChangeListener();
  doc.getElementById(ROOT_ID)?.remove();
}
