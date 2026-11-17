/**
 * kbCaptureTabs.js — the "Capture" entry of the in-page editor's add menu
 * (support.opus-safety.co.uk), and the shape of a capture handed back to it.
 *
 * A new capture is taken on the webapp, in another tab: "Create a new
 * capture" lists the webapp tabs that are open (plus "Open a new tab" and
 * "Reopen last tab": a new tab on the webapp page the last capture was taken
 * from, disabled until there has been one), the
 * service worker arms capture mode in the one picked, and the dialog's Insert
 * sends the pushed capture back to the draft (background.js kbCaptureStart /
 * kbCaptureReturn, kbSiteCapture.js).
 *
 * Pure: no DOM, no chrome.*.
 */

import { capturePresetShape } from './capturePresets.js';

const TAB_PICK = 'capture-tab:';
const LABEL_MAX = 48;

/** What a webapp tab is called in the menu: its title, else its path. */
export function captureTabLabel(tab) {
  let text = String(tab?.title ?? '').trim();
  if (!text) {
    try { text = new URL(tab.url).pathname; } catch { text = ''; }
  }
  if (!text || text === '/') text = 'Opus webapp';
  return text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1).trimEnd()}…` : text;
}

/**
 * Where a capture can be taken: a new tab, the page the last capture came
 * from (`hasLast`; without one it is there, disabled), then the webapp tabs
 * open now ([{id, title, url}]). Each id reads back through captureTabPick.
 */
export function captureTabChoices(tabs = [], hasLast = false) {
  const open = tabs.filter(t => Number.isInteger(t?.id));
  return [
    { id: `${TAB_PICK}new`, label: 'Open a new tab' },
    { id: `${TAB_PICK}last`, label: 'Reopen last tab', ...(hasLast ? {} : { disabled: true }) },
    ...open.map(t => ({ id: `${TAB_PICK}${t.id}`, label: captureTabLabel(t) })),
  ];
}

/**
 * The add menu's Capture item. `tabs` are the open webapp tabs
 * ([{id, title, url}]); 'capture' is the library pick the editor already knows.
 * `hasLast`: there is a last-captured page to reopen (without one the item
 * is there, disabled).
 */
export function captureMenuItem(tabs = [], hasLast = false) {
  const [fresh, last, ...open] = captureTabChoices(tabs, hasLast);
  return {
    id: 'capture-menu',
    label: 'Capture',
    submenu: [
      {
        id: 'capture-new',
        label: 'Create a new capture',
        submenu: [fresh, last, ...(open.length ? [{ divider: true }] : []), ...open],
      },
      { id: 'capture', label: 'Add from library' },
    ],
  };
}

/**
 * Reads a picked menu id. Null when it is not a capture-tab pick; otherwise
 * { tabId }, where a null tabId means "open a new tab" (with `reopen`: on the
 * page the last capture was taken from).
 */
export function captureTabPick(id) {
  if (typeof id !== 'string' || !id.startsWith(TAB_PICK)) return null;
  const rest = id.slice(TAB_PICK.length);
  if (rest === 'new') return { tabId: null };
  if (rest === 'last') return { tabId: null, reopen: true };
  const tabId = Number(rest);
  return Number.isInteger(tabId) ? { tabId } : null;
}

/**
 * The capture component for a capture the webapp's dialog handed back:
 * { lightFilename, darkFilename (relative to docs/assets), preset }, where
 * preset is 'button' (an icon or a button) or 'auto'. Null when it names no
 * file. Size, theme and corners are then changed in the draft's own settings.
 */
export function deliveredCaptureComponent(capture, uuid) {
  const lightFilename = String(capture?.lightFilename ?? '').replace(/^docs\/assets\//, '');
  if (!lightFilename) return null;
  const darkFilename = String(capture.darkFilename ?? '').replace(/^docs\/assets\//, '')
    || lightFilename.replace('-light-mode', '-dark-mode');
  const shape = capturePresetShape(capture.preset) ?? capturePresetShape('auto');
  return { kind: 'capture', cap: { uuid, lightFilename, darkFilename, ...shape, inversed: false } };
}
