/**
 * insertMenu.js — small reusable popup menu for the "+ Insert Component" button.
 *
 * Opens anchored to the trigger with five choices — Admonition, Capture,
 * Content tabs, Data table, and (below a divider) Paste copied markdown — where Capture
 * expands to a submenu (Create a new capture / Add from library). Closes on
 * outside-click or Escape. Only one menu is open at a time.
 */

let openEl = null;
let cleanupFns = [];

function closeMenu() {
  if (openEl) { openEl.remove(); openEl = null; }
  cleanupFns.forEach(fn => fn());
  cleanupFns = [];
}

/**
 * @param {HTMLElement} triggerEl - the clicked "+ Insert Component" button.
 * @param {number} insertAtIndex - component index to insert at.
 * @param {{admonition:Function, captureNew:Function, captureLibrary:Function, contentTabs:Function, dataTable:Function, pasteMarkdown:Function}} handlers
 *   Each receives `insertAtIndex`.
 */
export function openInsertMenu(triggerEl, insertAtIndex, handlers) {
  closeMenu();

  const menu = document.createElement('div');
  menu.className = 'mb-popup-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `
    <button type="button" class="mb-popup-menu__item" data-pick="admonition" role="menuitem">Admonition</button>
    <div class="mb-popup-menu__item mb-popup-menu__item--has-sub" data-pick="capture" role="menuitem" aria-haspopup="true" tabindex="0">
      <span>Capture</span><span class="mb-popup-menu__chev" aria-hidden="true">›</span>
      <div class="mb-popup-submenu" role="menu">
        <button type="button" class="mb-popup-menu__item" data-pick="capture-new" role="menuitem">Create a new capture</button>
        <button type="button" class="mb-popup-menu__item" data-pick="capture-library" role="menuitem">Add from library</button>
      </div>
    </div>
    <button type="button" class="mb-popup-menu__item" data-pick="content-tabs" role="menuitem">Content tabs</button>
    <button type="button" class="mb-popup-menu__item" data-pick="data-table" role="menuitem">Data table</button>
    <div class="mb-popup-menu__divider" role="separator"></div>
    <button type="button" class="mb-popup-menu__item" data-pick="paste-markdown" role="menuitem">Paste copied markdown</button>
  `;

  const host = triggerEl.closest('.more-buttons-overlay-content') || document.body;
  host.appendChild(menu);
  openEl = menu;

  // Position fixed just under the trigger, left-aligned. Flip up if it would
  // overflow the viewport bottom.
  const rect = triggerEl.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.left = `${Math.round(rect.left)}px`;
  const menuH = menu.offsetHeight;
  const below = rect.bottom + 4;
  menu.style.top = (below + menuH > window.innerHeight && rect.top - menuH - 4 > 0)
    ? `${Math.round(rect.top - menuH - 4)}px`
    : `${Math.round(below)}px`;

  const pick = (kind) => {
    closeMenu();
    if (kind === 'admonition') handlers.admonition?.(insertAtIndex);
    else if (kind === 'capture-new') handlers.captureNew?.(insertAtIndex);
    else if (kind === 'capture-library') handlers.captureLibrary?.(insertAtIndex);
    else if (kind === 'content-tabs') handlers.contentTabs?.(insertAtIndex);
    else if (kind === 'data-table') handlers.dataTable?.(insertAtIndex);
    else if (kind === 'paste-markdown') handlers.pasteMarkdown?.(insertAtIndex);
  };

  menu.addEventListener('click', (e) => {
    const item = e.target.closest('[data-pick]');
    if (!item) return;
    const kind = item.dataset.pick;
    if (kind === 'capture') {
      // Parent row: toggle the submenu open (for touch / keyboard).
      item.classList.toggle('--sub-open');
      return;
    }
    e.stopPropagation();
    pick(kind);
  });

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

export function closeInsertMenu() { closeMenu(); }
