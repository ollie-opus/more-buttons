/**
 * kbEditLog.js — the Edit log as a popup on the published Knowledge Base.
 *
 * The same thread the form editors show in their drawer (editLogPanel.js owns
 * the fetching, the rendering and the clicks); here it fills a tile of its own
 * over the page, opened from the history icon kbSite.js puts beside the title.
 * Loaded on the first click only, so a reader's page stays light.
 */

import { prefetchEditLog, mountEditLog, setEditLogOpen } from './editLogPanel.js';
import { EDIT_LOG_COPY } from './editLogView.js';
import { formLoading } from './loading.js';
import { watchIconSpans } from './lucideIcons.js';

const SHEET_ID = 'more-buttons-overlay-stylesheet'; // shared with kbPageEditor.js

// A live page has no extension stylesheet until something asks for it.
function ensureStylesheet() {
  let link = document.getElementById(SHEET_ID);
  if (link?.sheet) return Promise.resolve();
  if (!link) {
    link = document.createElement('link');
    link.id = SHEET_ID;
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('config/forms/formsStyling.css');
    (document.head || document.documentElement).appendChild(link);
  }
  return new Promise(resolve => {
    link.addEventListener('load', resolve, { once: true });
    link.addEventListener('error', resolve, { once: true });
  });
}

let overlay = null;
let opening = false;

/**
 * @param {{draftPath: string, livePath: string, side: 'live'|'draft'}} page
 * @param {{returnFocus?: HTMLElement|null}} [opts]
 */
export async function openKbEditLog(page, { returnFocus = null } = {}) {
  if (overlay || opening) return;
  opening = true;
  let thread;
  try {
    await ensureStylesheet();
    watchIconSpans(document);
    formLoading.show();
    // On a draft the thread opens on this draft's own edits, with the page's
    // earlier history behind "Show history" (as the guide form does).
    thread = await prefetchEditLog({ paths: [page.draftPath, page.livePath], session: page.side === 'draft' });
  } finally {
    formLoading.dismiss();
    opening = false;
  }

  overlay = document.createElement('div');
  overlay.className = 'more-buttons-overlay mb-editlog-popup';
  const tile = document.createElement('div');
  tile.className = 'more-buttons-overlay-content --animate-in';
  tile.setAttribute('role', 'dialog');
  tile.setAttribute('aria-modal', 'true');
  tile.setAttribute('aria-label', EDIT_LOG_COPY.header);
  // editLogPanel.js hangs its state on a "form" inside the tile; nothing else lives here.
  const anchor = document.createElement('div');
  anchor.hidden = true;
  tile.append(anchor);
  overlay.append(tile);
  document.body.append(overlay);

  const mounted = overlay;
  mountEditLog(anchor, thread, {
    onClose: () => {
      mounted.remove();
      if (overlay === mounted) overlay = null;
      returnFocus?.focus?.({ preventScroll: true });
    },
  });
  // A click on the dimmed page closes it, like its Close button and Escape.
  overlay.addEventListener('mousedown', e => { if (e.target === mounted) setEditLogOpen(anchor, false); });
  setEditLogOpen(anchor, true);
}
