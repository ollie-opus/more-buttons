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

// Position the menu: `anchor` is either a trigger element (menu opens under
// it, left-aligned — flipping above when it would overflow the viewport
// bottom) or a {x, y} client point (contextmenu), clamped to the viewport.
function positionMenu(menu, anchor) {
  menu.style.position = 'fixed';
  const menuW = menu.offsetWidth;
  const menuH = menu.offsetHeight;
  let x, yBelow, yAbove;
  if (anchor instanceof HTMLElement) {
    const rect = anchor.getBoundingClientRect();
    x = rect.left;
    yBelow = rect.bottom + 4;
    yAbove = rect.top - menuH - 4;
  } else {
    x = anchor.x;
    yBelow = anchor.y;
    yAbove = anchor.y - menuH;
  }
  x = Math.max(4, Math.min(x, window.innerWidth - menuW - 4));
  const y = (yBelow + menuH > window.innerHeight && yAbove > 0) ? yAbove : yBelow;
  menu.style.left = `${Math.round(x)}px`;
  menu.style.top = `${Math.round(y)}px`;

  // Submenus fly out to the right by default (CSS `left:100%`). When the menu
  // sits near the right viewport edge (e.g. the column menu of a right-side
  // datatable column) that flyout would open off-screen — flip it leftward.
  // Width is measured with the submenu invisibly shown, since display:none
  // reports 0.
  for (const parent of menu.querySelectorAll('.mb-popup-menu__item--has-sub')) {
    const sub = parent.querySelector('.mb-popup-submenu');
    if (!sub) continue;
    sub.style.display = 'flex';
    sub.style.visibility = 'hidden';
    const subW = sub.offsetWidth;
    sub.style.display = '';
    sub.style.visibility = '';
    const overflowsRight = x + menuW + 6 + subW > window.innerWidth - 4;
    const fitsLeft = x - 6 - subW >= 4;
    parent.classList.toggle('--flip-left', overflowsRight && fitsLeft);
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
 * @param {{admonition:Function, captureNew:Function, captureLibrary:Function, contentTabs:Function, dataTable:Function, grid:Function, video:Function, button:Function, navLinks:Function, diagram:Function, pasteMarkdown:Function}} handlers
 *   Each receives `insertAtIndex`.
 * @param {{capturesOnly?: boolean}} [opts] - capturesOnly renders just the two
 *   capture choices flat (no submenu / other kinds), for hosts where a cell can
 *   only hold a capture (data-table cells).
 */
export function openInsertMenu(triggerEl, insertAtIndex, handlers, opts = {}) {
  const items = opts.capturesOnly ? [
    { id: 'capture-new', label: 'Create a new capture' },
    { id: 'capture-library', label: 'Add from library' },
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
    { id: 'video', label: 'Video' },
    { id: 'button', label: 'Button' },
    { id: 'nav-links', label: 'Nav links' },
    { id: 'diagram', label: 'Diagram' },
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
    'video': handlers.video,
    'button': handlers.button,
    'nav-links': handlers.navLinks,
    'diagram': handlers.diagram,
    'paste-markdown': handlers.pasteMarkdown,
  };
  openPopupMenu(triggerEl, items, id => byId[id]?.(insertAtIndex));
}

export function closeInsertMenu() { closeMenu(); }
