/**
 * insertMenu.js — reusable floating popup menus.
 *
 * openPopupMenu is the general primitive: a declarative item list rendered as
 * a `.mb-popup-menu`, anchored either under a trigger element or at a point
 * (for contextmenu events), with submenu support, disabled/danger/checked
 * item states, arrow-key navigation, and outside-click / Escape dismissal.
 * Only one menu is open at a time.
 *
 * openInsertMenu is the "+ Insert Component" menu built on top of it (five
 * component kinds plus Paste copied markdown; Capture expands to a submenu).
 */

let openEl = null;
let cleanupFns = [];

function closeMenu() {
  if (openEl) { openEl.remove(); openEl = null; }
  cleanupFns.forEach(fn => fn());
  cleanupFns = [];
}

function itemButton(item) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mb-popup-menu__item'
    + (item.danger ? ' mb-popup-menu__item--danger' : '')
    + (item.disabled ? ' mb-popup-menu__item--disabled' : '');
  btn.dataset.pick = item.id;
  btn.setAttribute('role', 'menuitem' + (item.checked != null ? 'radio' : ''));
  if (item.checked != null) btn.setAttribute('aria-checked', String(!!item.checked));
  if (item.disabled) btn.setAttribute('aria-disabled', 'true');
  if (item.icon) {
    const ic = document.createElement('span');
    ic.className = 'more-buttons-icon mb-popup-menu__icon';
    ic.setAttribute('aria-hidden', 'true');
    ic.textContent = item.icon;
    btn.appendChild(ic);
  }
  const label = document.createElement('span');
  label.className = 'mb-popup-menu__label';
  label.textContent = item.label;
  btn.appendChild(label);
  if (item.checked) {
    const check = document.createElement('span');
    check.className = 'more-buttons-icon mb-popup-menu__check';
    check.setAttribute('aria-hidden', 'true');
    check.textContent = 'check';
    btn.appendChild(check);
  }
  return btn;
}

function buildItems(host, items) {
  for (const item of items) {
    if (item.divider) {
      const div = document.createElement('div');
      div.className = 'mb-popup-menu__divider';
      div.setAttribute('role', 'separator');
      host.appendChild(div);
      continue;
    }
    if (item.submenu) {
      const parent = document.createElement('div');
      parent.className = 'mb-popup-menu__item mb-popup-menu__item--has-sub';
      parent.dataset.pick = item.id;
      parent.setAttribute('role', 'menuitem');
      parent.setAttribute('aria-haspopup', 'true');
      parent.tabIndex = 0;
      if (item.icon) {
        const ic = document.createElement('span');
        ic.className = 'more-buttons-icon mb-popup-menu__icon';
        ic.setAttribute('aria-hidden', 'true');
        ic.textContent = item.icon;
        parent.appendChild(ic);
      }
      const label = document.createElement('span');
      label.className = 'mb-popup-menu__label';
      label.textContent = item.label;
      parent.appendChild(label);
      const chev = document.createElement('span');
      chev.className = 'mb-popup-menu__chev';
      chev.setAttribute('aria-hidden', 'true');
      chev.textContent = '›';
      parent.appendChild(chev);
      const sub = document.createElement('div');
      sub.className = 'mb-popup-submenu';
      sub.setAttribute('role', 'menu');
      buildItems(sub, item.submenu);
      parent.appendChild(sub);
      host.appendChild(parent);
      continue;
    }
    host.appendChild(itemButton(item));
  }
}

const EDGE = 4;   // viewport inset the menu never crosses
const GAP = 4;    // gap between a trigger element and the menu

/**
 * Where a menu goes. Pure, so the rule is testable: `anchor` is a trigger's
 * client rect ({top, bottom, left}) or a client point ({x, y}); `menu` is its
 * measured {width, height}; `viewport` is {width, height}.
 *
 * Below the trigger when that fits, else above when that fits, else as far
 * down as the viewport allows (the menu may then cover its trigger — a menu
 * is never left hanging off the edge). Horizontally it is left-aligned and
 * clamped. `maxHeight` is set only when the menu is taller than the viewport
 * itself; it then scrolls.
 */
export function resolveMenuPlacement(anchor, menu, viewport) {
  const point = !('bottom' in anchor);
  const x0 = point ? anchor.x : anchor.left;
  const yBelow = point ? anchor.y : anchor.bottom + GAP;
  const yAbove = point ? anchor.y - menu.height : anchor.top - GAP - menu.height;
  const room = viewport.height - 2 * EDGE;
  const maxHeight = menu.height > room ? room : null;
  const h = maxHeight ?? menu.height;
  let y;
  if (yBelow + h <= viewport.height - EDGE) y = yBelow;
  else if (yAbove >= EDGE) y = yAbove;
  else y = Math.max(EDGE, viewport.height - EDGE - h);
  const x = Math.max(EDGE, Math.min(x0, viewport.width - menu.width - EDGE));
  return { x: Math.round(x), y: Math.round(y), maxHeight };
}

/**
 * Which way a submenu flies out of its parent row. Pure. `parent` is the
 * row's client rect, `sub` the submenu's measured {width, height}, `menu`
 * the open menu's placed {x, width}. Rightward unless that leaves the
 * viewport and leftward fits; hanging from the row's top unless that runs
 * past the bottom and hanging from its bottom fits.
 */
export function resolveSubmenuFlip(parent, sub, menu, viewport) {
  const overflowsRight = menu.x + menu.width + 6 + sub.width > viewport.width - EDGE;
  const fitsLeft = menu.x - 6 - sub.width >= EDGE;
  const overflowsBottom = parent.top - 4 + sub.height > viewport.height - EDGE;
  const fitsUp = parent.bottom + 4 - sub.height >= EDGE;
  return { left: overflowsRight && fitsLeft, up: overflowsBottom && fitsUp };
}

// Measure a hidden flyout: display:none reports 0, so show it invisibly.
function measureHidden(el) {
  el.style.display = 'flex';
  el.style.visibility = 'hidden';
  const size = { width: el.offsetWidth, height: el.offsetHeight };
  el.style.display = '';
  el.style.visibility = '';
  return size;
}

// Position the menu (resolveMenuPlacement) and orient every submenu
// (resolveSubmenuFlip) against the viewport. `anchor` is the trigger element
// or a {x, y} client point (contextmenu).
function positionMenu(menu, anchor) {
  menu.style.position = 'fixed';
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const anchorBox = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
  const place = resolveMenuPlacement(anchorBox, { width: menu.offsetWidth, height: menu.offsetHeight }, viewport);
  menu.style.left = `${place.x}px`;
  menu.style.top = `${place.y}px`;
  if (place.maxHeight != null) {
    menu.style.maxHeight = `${place.maxHeight}px`;
    menu.style.overflowY = 'auto';
  }

  const placed = { x: place.x, width: menu.offsetWidth };
  for (const parent of menu.querySelectorAll('.mb-popup-menu__item--has-sub')) {
    const sub = parent.querySelector('.mb-popup-submenu');
    if (!sub) continue;
    const flip = resolveSubmenuFlip(parent.getBoundingClientRect(), measureHidden(sub), placed, viewport);
    parent.classList.toggle('--flip-left', flip.left);
    parent.classList.toggle('--flip-up', flip.up);
  }
}

/**
 * @param {HTMLElement|{x:number, y:number}} anchor - trigger element, or a
 *   client point (e.g. contextmenu's clientX/clientY).
 * @param {Array} items - [{id, label, icon?, disabled?, danger?, checked?,
 *   submenu?: items}] plus {divider: true} separators.
 * @param {(id: string) => void} onPick - called with the picked item id
 *   (after the menu closes). Disabled items never pick.
 * @param {{focusFirst?: boolean}} [opts] - focusFirst moves focus to the
 *   first enabled item on open (keyboard-initiated menus).
 */
export function openPopupMenu(anchor, items, onPick, opts = {}) {
  closeMenu();

  const menu = document.createElement('div');
  menu.className = 'mb-popup-menu';
  menu.setAttribute('role', 'menu');
  buildItems(menu, items);

  const anchorEl = anchor instanceof HTMLElement ? anchor : document.activeElement;
  const host = anchorEl?.closest?.('.more-buttons-overlay-content') || document.body;
  host.appendChild(menu);
  openEl = menu;
  positionMenu(menu, anchor);

  const enabledItems = () =>
    [...menu.querySelectorAll('[data-pick]:not(.mb-popup-menu__item--disabled)')]
      .filter(el => !el.closest('.mb-popup-submenu')
        || el.closest('.mb-popup-menu__item--has-sub')?.classList.contains('--sub-open'));

  menu.addEventListener('click', (e) => {
    const item = e.target.closest('[data-pick]');
    if (!item || item.classList.contains('mb-popup-menu__item--disabled')) return;
    if (item.classList.contains('mb-popup-menu__item--has-sub')
      && !e.target.closest('.mb-popup-submenu')) {
      // Parent row: toggle the submenu open (for touch / keyboard).
      item.classList.toggle('--sub-open');
      return;
    }
    e.stopPropagation();
    const id = item.dataset.pick;
    closeMenu();
    onPick?.(id);
  });

  menu.addEventListener('keydown', (e) => {
    const focused = document.activeElement?.closest?.('[data-pick]');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const list = enabledItems();
      if (!list.length) return;
      const i = list.indexOf(focused);
      const next = e.key === 'ArrowDown'
        ? list[(i + 1) % list.length]
        : list[(i - 1 + list.length) % list.length];
      next.focus();
    } else if (e.key === 'ArrowRight' && focused?.classList.contains('mb-popup-menu__item--has-sub')) {
      e.preventDefault();
      focused.classList.add('--sub-open');
      focused.querySelector('.mb-popup-submenu [data-pick]')?.focus();
    } else if (e.key === 'ArrowLeft') {
      const parent = focused?.closest('.mb-popup-menu__item--has-sub');
      if (parent) {
        e.preventDefault();
        parent.classList.remove('--sub-open');
        parent.focus();
      }
    } else if ((e.key === 'Enter' || e.key === ' ') && focused) {
      e.preventDefault();
      focused.click();
    }
  });

  if (opts.focusFirst) enabledItems()[0]?.focus();

  // Dismiss on outside click (capture phase, deferred so the opening click that
  // triggered us doesn't immediately close it) + Escape.
  const onDocClick = (e) => { if (!menu.contains(e.target)) closeMenu(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); } };
  setTimeout(() => {
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKey, true);
  }, 0);
  cleanupFns.push(() => document.removeEventListener('click', onDocClick, true));
  cleanupFns.push(() => document.removeEventListener('keydown', onKey, true));
}

export function isPopupMenuOpen() { return !!openEl; }

/**
 * @param {HTMLElement} triggerEl - the clicked "+ Insert Component" button.
 * @param {number} insertAtIndex - component index to insert at.
 * @param {{admonition:Function, captureNew:Function, captureLibrary:Function, contentTabs:Function, dataTable:Function, grid:Function, image:Function, video:Function, button:Function, navLinks:Function, diagram:Function, codeBlock:Function, pasteMarkdown:Function}} handlers
 *   Each receives `insertAtIndex`.
 * @param {{capturesOnly?: boolean}} [opts] - capturesOnly renders just the
 *   media choices flat (no submenu / other kinds), for hosts where a cell can
 *   only hold a capture or image (data-table cells).
 */
export function openInsertMenu(triggerEl, insertAtIndex, handlers, opts = {}) {
  const items = opts.capturesOnly ? [
    { id: 'capture-new', label: 'Create a new capture' },
    { id: 'capture-library', label: 'Add capture from library' },
    { id: 'image', label: 'Add image from library' },
  ] : [
    { id: 'admonition', label: 'Admonition' },
    {
      id: 'capture', label: 'Capture',
      submenu: [
        { id: 'capture-new', label: 'Create a new capture' },
        { id: 'capture-library', label: 'Add from library' },
      ],
    },
    { id: 'content-tabs', label: 'Content tabs' },
    { id: 'data-table', label: 'Data table' },
    { id: 'grid', label: 'Grid' },
    { id: 'image', label: 'Image' },
    { id: 'video', label: 'Video' },
    { id: 'button', label: 'Button' },
    { id: 'nav-links', label: 'Nav links' },
    { id: 'diagram', label: 'Diagram' },
    { id: 'code-block', label: 'Code block' },
    { divider: true },
    { id: 'paste-markdown', label: 'Paste copied markdown' },
  ];

  const byId = {
    'admonition': handlers.admonition,
    'capture-new': handlers.captureNew,
    'capture-library': handlers.captureLibrary,
    'content-tabs': handlers.contentTabs,
    'data-table': handlers.dataTable,
    'grid': handlers.grid,
    'image': handlers.image,
    'video': handlers.video,
    'button': handlers.button,
    'nav-links': handlers.navLinks,
    'diagram': handlers.diagram,
    'code-block': handlers.codeBlock,
    'paste-markdown': handlers.pasteMarkdown,
  };
  openPopupMenu(triggerEl, items, id => byId[id]?.(insertAtIndex));
}

export function closeInsertMenu() { closeMenu(); }
