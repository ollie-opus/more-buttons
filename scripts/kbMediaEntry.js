/**
 * kbMediaEntry.js — a media file's own admin page on the Knowledge Base site
 * (/admin/media-library/<folder>/<path>/, kbAdminMediaEntry.js): its url, the
 * entry a url names, and what can be done to it.
 *
 * A media file has no id of its own: its path is its identity everywhere (the
 * usage index, the capture manifest, the markdown). The url is that path
 * inside docs/assets/media, without the light / dark tail and the extension:
 *
 *   docs/assets/media/occ-captures/sites/overview-light-mode.png
 *     → key  occ-captures/sites/overview
 *     → url  /admin/media-library/occ-captures/sites/overview/
 *
 * Two entries can share a key (a.png beside a.mp4): their urls then carry the
 * extension (…/a.mp4/).
 *
 * An entry is { id, label, light?, dark?, single?, ext } with repo paths, as
 * kbAdminMedia.js builds them. Pure: no DOM, no chrome.*.
 */

const ROOT = '/admin/media-library/';
const RESERVED = new Set(['upload']);   // /admin/media-library/upload/ is a screen

/** The key of a repo path, or of a path relative to docs/assets (what a component stores). */
export function mediaEntryKey(path) {
  return String(path ?? '')
    .replace(/^docs\//, '')
    .replace(/^assets\//, '')
    .replace(/^media\//, '')
    .replace(/-(?:light|dark)-mode(\.[a-z0-9]+)$/i, '$1')
    .replace(/\.[a-z0-9]+$/i, '');
}

/** The entry page's url. `ext`: the form for an entry that shares its key with another. */
export function mediaEntryUrl(key, ext = '') {
  const full = ext ? `${key}.${ext}` : String(key ?? '');
  return ROOT + full.split('/').map(encodeURIComponent).join('/') + '/';
}

/** The key an admin url names; null when it is not an entry's url. */
export function parseMediaEntryPath(pathname) {
  const path = String(pathname ?? '');
  if (!path.startsWith(ROOT)) return null;
  const rest = path.slice(ROOT.length).replace(/\/$/, '');
  if (!rest) return null;
  const segments = [];
  for (const raw of rest.split('/')) {
    let seg;
    try { seg = decodeURIComponent(raw); } catch { return null; }
    if (!seg || seg === '.' || seg === '..' || seg.includes('/') || seg.includes('\\')) return null;
    segments.push(seg);
  }
  const key = segments.join('/');
  return RESERVED.has(key) ? null : key;
}

const firstPath = entry => entry?.light || entry?.single || entry?.dark || '';
const keyOf = entry => mediaEntryKey(firstPath(entry));

/** The entry a key names (a bare key shared by several: the light / dark pair first). */
export function findMediaEntry(entries, key) {
  const list = entries ?? [];
  const exact = list.filter(e => keyOf(e) === key);
  if (exact.length) return exact.find(e => e.light) ?? exact[0];
  return list.find(e => `${keyOf(e)}.${e.ext}` === key) ?? null;
}

/** An entry's url among `entries`: with its extension only when another shares its key. */
export function mediaEntryHref(entry, entries) {
  const key = keyOf(entry);
  // Told apart by their files, not by object: the list may hold a copy of `entry`.
  const shared = (entries ?? []).some(e => firstPath(e) !== firstPath(entry) && keyOf(e) === key);
  return mediaEntryUrl(key, shared ? entry.ext : '');
}

/**
 * What the entry's page offers.
 *   recapture  a .png light / dark pair (a screenshot); never a frozen one
 *   replace    anything that is not frozen (system update captures are)
 *   remove     only when the usage index says no page uses the file
 */
export function mediaEntryActions({ entry, frozen, unused }) {
  return {
    recapture: !frozen && !!entry?.light && entry.ext === 'png',
    replace: !frozen,
    remove: unused === true,
  };
}

// ── Is the site still serving the old file? ──────────────────────────────────
// A stored file reaches the site only when the site has rebuilt. The page
// (kbAdminMediaEntry.js) tells by holding the repo's copy against what the
// site serves: these compare the two.

const base64Of = dataUrl => {
  const m = /^data:[^,]*;base64,(.*)$/s.exec(String(dataUrl ?? ''));
  return m ? m[1] : null;
};

/** A base64 data url's bytes; null when it is not one. */
export function dataUrlBytes(dataUrl) {
  const b64 = base64Of(dataUrl);
  if (b64 == null) return null;
  let bin;
  try { bin = atob(b64); } catch { return null; }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** How many bytes a base64 data url holds, without decoding it (a video's is large); null when it is not one. */
export function dataUrlSize(dataUrl) {
  const b64 = base64Of(dataUrl);
  if (b64 == null) return null;
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor(b64.length * 3 / 4) - pad;
}

export function sameBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
