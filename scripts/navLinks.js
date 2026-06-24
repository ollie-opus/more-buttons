/**
 * navLinks.js — "Nav links" component markdown round-trip.
 *
 * A nav-links component is an empty placeholder block whose only content is a
 * nav path; the published page fills it with a live, nested list of links to
 * every page under that part of the site nav (derived from zensical.toml at
 * build time and injected by the KB repo's docs/assets/javascripts/nav-links.js):
 *
 *   <div class="mb-nav-links" data-nav-path="guides/employees"></div>
 *
 * Because the page stores only the PATH (never the list), editing zensical.toml +
 * rebuilding the site updates every nav-links list without re-touching any page.
 *
 * Like the Button it is the simplest kind of component: single-line, holds no
 * sub-components. Identity is a hidden `<span data-uuid>` on the line BEFORE the
 * div — the same convention buttons / captures / videos use.
 *
 * `md_in_html` (enabled in zensical.toml) lets this raw block pass through as-is.
 *
 * All functions here are pure (no DOM, no network) except generateUUID.
 */

import { generateUUID } from './admonitions.js';

// A nav-links div line. Group 1 indent, group 2 the path. Attribute spacing is
// tolerated, but class + data-nav-path are required (an arbitrary <div> is not a
// nav-links block). We always author the canonical form below.
const NAVLINKS_LINE_RE =
  /^(\s*)<div\s+class="mb-nav-links"\s+data-nav-path="([^"]*)"\s*>\s*<\/div>\s*$/;

const UUID_SPAN_LINE_RE = /^\s*<span[^>]*data-uuid="([^"]+)"[^>]*><\/span>\s*$/;

/** The canonical div line for a nav-links block (a `"` in the path is dropped so
 * it can never break the attribute / the locate regex). */
function navLinksLine(path) {
  const clean = (path ?? '').trim().replace(/"/g, '');
  return `<div class="mb-nav-links" data-nav-path="${clean}"></div>`;
}

/**
 * Emits the markdown lines for each nav-links block. Mirrors buildButtonLines: a
 * leading '' separator, then an optional uuid span, then the div line.
 * buildComponentBody slices off the leading ''.
 *
 * @param {Array<{uuid?,path}>} list
 * @returns {string[]}
 */
export function buildNavLinksLines(list = []) {
  return list.flatMap(n => {
    const line = navLinksLine(n.path);
    const spanLines = n.uuid ? [`<span data-uuid="${n.uuid}" style="display:none"></span>`] : [];
    return ['', ...spanLines, line];
  });
}

/**
 * Locates every top-level nav-links block in `body`, returning line-addressable
 * entries. A preceding own-line uuid span is swallowed into startLine.
 *
 * @param {string} body
 * @returns {Array<{uuid,path,indent,startLine,endLine}>}
 */
export function locateNavLinksLines(body) {
  const lines = (body ?? '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(NAVLINKS_LINE_RE);
    if (!m) continue;

    let startLine = i;
    let uuid = null;
    if (i > 0) {
      const sm = lines[i - 1].match(UUID_SPAN_LINE_RE);
      if (sm) { uuid = sm[1]; startLine = i - 1; }
    }

    out.push({ uuid, path: m[2], indent: m[1], startLine, endLine: i + 1 });
  }
  return out;
}

/**
 * Backfills a hidden data-uuid span before every nav-links block that lacks one.
 * Idempotent; reverse-order splice keeps earlier indices valid. Mirrors
 * ensureButtonUUIDs.
 */
export function ensureNavLinksUUIDs(markdown) {
  const blocks = locateNavLinksLines(markdown);
  if (blocks.length === 0) return markdown;
  const lines = (markdown ?? '').split('\n');
  let modified = false;
  for (let k = blocks.length - 1; k >= 0; k--) {
    const b = blocks[k];
    if (b.uuid) continue;
    const span = `${b.indent}<span data-uuid="${generateUUID()}" style="display:none"></span>`;
    lines.splice(b.startLine, 0, span);
    modified = true;
  }
  return modified ? lines.join('\n') : markdown;
}

/** Finds the nav-links block identified by `uuid` anywhere in `md`, or null. */
export function locateNavLinksByUUID(md, uuid) {
  return locateNavLinksLines(md).find(b => b.uuid === uuid) ?? null;
}

/**
 * Replaces the single div line of the nav-links block identified by `uuid` with
 * `newLine` (no uuid span, no indent — they are reapplied here). Leaves the
 * identity span in place. Returns original markdown if the uuid is absent.
 */
export function replaceNavLinksByUUID(md, uuid, newLine) {
  const lines = (md ?? '').split('\n');
  const loc = locateNavLinksByUUID(md, uuid);
  if (!loc) return md;
  const divLine = loc.endLine - 1;
  lines[divLine] = loc.indent + newLine;
  return lines.join('\n');
}

/**
 * Deletes the nav-links block identified by `uuid` (its identity span + div
 * line), plus one trailing blank line if present. Mirrors deleteButtonByUUID.
 */
export function deleteNavLinksByUUID(md, uuid) {
  const lines = (md ?? '').split('\n');
  const loc = locateNavLinksByUUID(md, uuid);
  if (!loc) return md;
  let end = loc.endLine;
  if (end < lines.length && lines[end] === '') end++; // eat one trailing blank
  lines.splice(loc.startLine, end - loc.startLine);
  return lines.join('\n');
}

/** Builds a fresh nav-links component from a nav-links object. */
export function navLinksComponent(nav) {
  return { kind: 'navlinks', nav };
}

/** The single div line (no identity span — replaceNavLinksByUUID keeps the span). */
export function navLinksLineFrom({ path }) {
  return navLinksLine(path);
}

/**
 * Canonical form/merge representation of a nav-links block's editable fields.
 * Mirrors buttonDimFields — the edit form seeds its baseline from this AND parses
 * fresh markdown through it, so an untouched block compares equal.
 */
export function navLinksDimFields(nav) {
  return { navPath: nav?.path ?? '' };
}
