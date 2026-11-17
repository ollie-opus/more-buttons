/**
 * kbUpdates.js — what the in-page editor needs to know about the System
 * Updates drafts page (support.opus-safety.co.uk/drafts/system-updates/).
 *
 * That page is not a guide: it has no sections, only a list of update blocks
 * waiting to be published, each one an admonition of an update type whose
 * title carries the type's name, the update's title and its release date:
 *
 *   ??? improvement "Improvement: Faster reports<span class="meta">12th November 2026</span>"
 *
 * The editor holds them as admonition components in one container of their
 * own (UPDATES_ROOT), so everything inside an update is edited as it is in a
 * guide. A title or a date still to be filled in is simply absent from the
 * title string; both are required before a save or a publish.
 *
 * Pure: no DOM, no network.
 */

import { parseAdmonitions, splitTitleMeta, joinTitleMeta } from './admonitions.js';

export const UPDATES_SLUG = 'system-updates';

/** Is this page (classifyKbPath's result) the System Updates one? */
export const isUpdatesPage = page => page?.slug === UPDATES_SLUG;

/** [type, label], in the order they are offered. */
export const UPDATE_TYPES = [
  ['improvement', 'Improvement'],
  ['feature-release', 'Feature release'],
  ['new-addition', 'New addition'],
];
export const UPDATE_TYPE_LABELS = Object.fromEntries(UPDATE_TYPES);
export const UPDATE_TYPES_RE = /feature-release|new-addition|improvement/;
export const isUpdateType = type => Object.hasOwn(UPDATE_TYPE_LABELS, type ?? '');

/** The container the updates of the page stand in (it has no element or uuid of its own in the file). */
export const UPDATES_KIND = 'system-updates';
export const UPDATES_ROOT = Object.freeze({ kind: UPDATES_KIND, uuid: UPDATES_SLUG });

// ── Dates ────────────────────────────────────────────────────────────────────
// A release date is stored as it reads on the page ("5th June 2026").

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** `2026-06-05` → `5th June 2026`; '' for anything that is not a date. */
export function formatUpdateDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!m) return '';
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  const v = day % 100;
  const ordinal = (v >= 11 && v <= 13) ? 'th' : (['th', 'st', 'nd', 'rd'][v % 10] ?? 'th');
  return `${day}${ordinal} ${MONTHS[month - 1]} ${year}`;
}

/** `5th June 2026` → `2026-06-05`; '' when it does not read as a date. */
export function isoOfUpdateDate(display) {
  const m = /^(\d{1,2})\w*\s+(\w+)\s+(\d{4})$/.exec((display ?? '').trim());
  const month = m ? MONTHS.indexOf(m[2]) + 1 : 0;
  if (!month) return '';
  return `${m[3]}-${String(month).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

// ── Titles ───────────────────────────────────────────────────────────────────

/** An update's raw title string → its own title and its date as shown ('' for either when not set). */
export function splitUpdateTitle(type, rawTitle) {
  const { title, meta } = splitTitleMeta(rawTitle ?? '');
  const label = UPDATE_TYPE_LABELS[type];
  const own = label && title.startsWith(`${label}:`) ? title.slice(label.length + 1) : title;
  return { title: own.trim(), date: meta.trim() };
}

/** The raw title string for an update of `type` (`date` as shown on the page). */
export function joinUpdateTitle(type, title, date) {
  const label = UPDATE_TYPE_LABELS[type] ?? type;
  const own = String(title ?? '').replace(/\s+/g, ' ').replace(/"/g, "'").trim();
  return joinTitleMeta(own ? `${label}: ${own}` : `${label}:`, date);
}

// ── Reading the page ─────────────────────────────────────────────────────────

/** The page's update blocks, in file order, as the editors' admonition components. */
export function updateComponents(md) {
  return parseAdmonitions(md ?? '', UPDATE_TYPES_RE)
    .filter(a => a.indent === '' && a.uuid)
    .map(({ uuid, prefix, type, title, body }) => ({ kind: 'admonition', adm: { uuid, prefix, type, title, body } }));
}

/**
 * The live System Updates page as the editor shows it: its headings (the years
 * and months) and the updates under each, in file order. What stands before
 * the first of those headings (the introduction, the "contact us" tiles) is
 * left out, and so is anything between that is not an update.
 * @returns {Array<{level: number, heading: string, updates: object[]}>}
 */
export function liveUpdateGroups(md) {
  const groups = [];
  let group = null;
  let lines = [];
  const close = () => {
    if (group) group.updates = parseAdmonitions(lines.join('\n'), UPDATE_TYPES_RE).filter(a => a.indent === '')
      .map(({ uuid, prefix, type, title, body }) => ({ uuid, prefix, type, title, body }));
    lines = [];
  };
  // An update's own lines are indented: a `#` at the margin is a heading of the page.
  for (const line of String(md ?? '').split('\n')) {
    const m = /^(#{2,6}) +(.+?)\s*$/.exec(line);
    if (!m) { lines.push(line); continue; }
    close();
    group = { level: m[1].length, heading: m[2], updates: [] };
    groups.push(group);
  }
  close();
  return groups;
}

/**
 * Where a live update goes in the drafts list, so the drafts stand in the
 * order the live page has them (newest first). Against a draft that is on the
 * live page too, their places there decide; against one that is not (a new
 * update), their dates do, and one with no date yet stays above.
 * @param {Array<{uuid: string|null, type: string, title: string}>} drafts in file order
 * @param {Array<{uuid: string|null, type: string, title: string}>} live in file order
 * @param {string} uuid the live update being copied
 * @returns {number} the index to insert at (drafts.length: after them all)
 */
export function draftPlaceFor(drafts, live, uuid) {
  const at = new Map(live.map((a, i) => [a.uuid, i]));
  const iso = a => isoOfUpdateDate(splitUpdateTitle(a.type, a.title).date);
  const own = live[at.get(uuid)];
  if (!own) return 0;
  const date = iso(own);
  const i = drafts.findIndex(d => {
    if (d.uuid && at.has(d.uuid)) return at.get(d.uuid) > at.get(uuid);
    const other = iso(d);
    return !!other && !!date && other < date;
  });
  return i < 0 ? drafts.length : i;
}

/** The page's own title (its H1), '' when it has none. */
export function updatesPageTitle(md) {
  return /^# +(.+?)\s*$/m.exec(md ?? '')?.[1] ?? '';
}

/**
 * The updates that may not be saved or published yet: one entry per update
 * with no title or no release date, saying which is missing.
 * @returns {Array<{uuid: string, title: boolean, date: boolean}>}
 */
export function missingUpdateFields(md) {
  const out = [];
  for (const { adm } of updateComponents(md)) {
    const { title, date } = splitUpdateTitle(adm.type, adm.title);
    const noDate = !isoOfUpdateDate(date);
    if (!title || noDate) out.push({ uuid: adm.uuid, title: !title, date: noDate });
  }
  return out;
}

/** What to tell the user about `missing` (missingUpdateFields' result). */
export function missingMessage(missing) {
  const titles = missing.some(m => m.title);
  const dates = missing.some(m => m.date);
  const what = titles && dates ? 'a title and a date of release' : titles ? 'a title' : 'a date of release';
  return missing.length > 1 ? `${missing.length} updates still need ${what}.` : `This update still needs ${what}.`;
}

/**
 * The commit for saving the updates page: what happened to each update between
 * `before` and `after`, in the words the update forms write (the edit log
 * reads them). One change carries its update's `Item:` trailer.
 */
export function commitForUpdates(before, after) {
  const titled = c => splitUpdateTitle(c.adm.type, c.adm.title).title;
  const was = new Map(updateComponents(before).map(c => [c.adm.uuid, c]));
  const now = new Map(updateComponents(after).map(c => [c.adm.uuid, c]));
  const changes = [];
  for (const [uuid, c] of now) {
    const old = was.get(uuid);
    if (!old) changes.push({ uuid, subject: `Saved draft update '${titled(c)}'` });
    else if (JSON.stringify(old.adm) !== JSON.stringify(c.adm)) changes.push({ uuid, subject: `Edited draft update '${titled(c)}'` });
  }
  for (const [uuid, c] of was) if (!now.has(uuid)) changes.push({ uuid, subject: `Deleted draft update '${titled(c)}'` });
  if (!changes.length) return 'Edited the page';
  if (changes.length === 1) return { subject: changes[0].subject, bodyLines: [`Item: ${changes[0].uuid}`] };
  return { subject: `Made ${changes.length} changes to the page`, bodyLines: changes.map(c => `- ${c.subject}`) };
}

// ── Published, not yet live ──────────────────────────────────────────────────
// A published update has left the drafts file at once, but the site takes
// minutes to build it into the live page. Until the live page shows it, the
// editor keeps a copy and draws it greyed in the drafts list (kbPageEditor.js).

/** How the wait is paced (ms). An object so a test can shorten it. */
export const PUBLISH_WATCH = {
  first: 45_000,        // a build is never quicker than this: the first look at the live page
  every: 20_000,        // then this often, while the tab is in view
  late: 20 * 60_000,    // after this long the wait says so, and can be dismissed
  forget: 24 * 3600_000, // a copy this old is dropped unseen (the tab was closed mid-wait)
};

/** Is the update with this identity in the built live page (its HTML)? */
export function liveShowsUpdate(html, uuid) {
  return !!uuid && String(html ?? '').includes(`data-uuid="${uuid}"`);
}

/**
 * The kept copies still worth showing: not too old, and not back in the
 * drafts (`md`) by some other hand.
 * @param {Array<{uuid: string, adm: object, index: number, at: number}>} list
 */
export function pendingPublishes(list, md, now = Date.now()) {
  const inDrafts = new Set(updateComponents(md).map(c => c.adm.uuid));
  return (Array.isArray(list) ? list : [])
    .filter(p => p?.uuid && p.adm?.uuid === p.uuid && isUpdateType(p.adm.type) && Number.isFinite(p.at))
    .filter(p => now - p.at < PUBLISH_WATCH.forget && !inDrafts.has(p.uuid));
}
