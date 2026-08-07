/**
 * navLinks.js — "Nav links" component markdown round-trip.
 *
 * A nav-links component is an empty placeholder block whose only content is a
 * nav path OR a frontmatter tag; the published page fills it with a live list of
 * links (derived from zensical.toml / page frontmatter at build time and
 * injected by the KB repo's docs/assets/javascripts/nav-links.js):
 *
 *   <div class="mb-nav-links" data-nav-path="guides/employees"></div>
 *   <div class="mb-nav-links" data-nav-tag="System" data-nav-layout="flat"></div>
 *
 * Path mode lists every page under that part of the site nav, nested. Tag mode
 * lists every page whose frontmatter carries the tag — `flat` as one plain list,
 * `grouped` spliced into the surviving nav-section hierarchy.
 *
 * Because the page stores only the PATH/TAG (never the list), editing
 * zensical.toml or page frontmatter + rebuilding the site updates every
 * nav-links list without re-touching any page.
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

// A path-mode nav-links div line. Group 1 indent, group 2 the path. Attribute
// spacing is tolerated, but class + data-nav-path are required (an arbitrary
// <div> is not a nav-links block). We always author the canonical form below.
const NAVLINKS_LINE_RE =
  /^(\s*)<div\s+class="mb-nav-links"\s+data-nav-path="([^"]*)"\s*>\s*<\/div>\s*$/;

// A tag-mode nav-links div line. Group 2 the tag, group 3 the layout (the
// attribute is tolerated-absent → flat, but we always author it explicitly).
const NAVLINKS_TAG_LINE_RE =
  /^(\s*)<div\s+class="mb-nav-links"\s+data-nav-tag="([^"]*)"(?:\s+data-nav-layout="([^"]*)")?\s*>\s*<\/div>\s*$/;

const UUID_SPAN_LINE_RE = /^\s*<span[^>]*data-uuid="([^"]+)"[^>]*><\/span>\s*$/;

/** A `"` in a path/tag is dropped so it can never break the attribute / the
 * locate regexes. */
function cleanAttr(v) {
  return (v ?? '').trim().replace(/"/g, '');
}

function cleanLayout(layout) {
  return layout === 'grouped' ? 'grouped' : 'flat';
}

/** The canonical div line for a path-mode nav-links block. */
function navLinksLine(path) {
  return `<div class="mb-nav-links" data-nav-path="${cleanAttr(path)}"></div>`;
}

/** The canonical div line for a tag-mode nav-links block. */
function navLinksTagLine(tag, layout) {
  return `<div class="mb-nav-links" data-nav-tag="${cleanAttr(tag)}" data-nav-layout="${cleanLayout(layout)}"></div>`;
}

/** One nav object → its canonical div line. Tag mode iff `tag` is present. */
function navLinksLineOf(n) {
  return n.tag != null ? navLinksTagLine(n.tag, n.layout) : navLinksLine(n.path);
}

/**
 * Emits the markdown lines for each nav-links block. Mirrors buildButtonLines: a
 * leading '' separator, then an optional uuid span, then the div line.
 * buildComponentBody slices off the leading ''.
 *
 * @param {Array<{uuid?,path?,tag?,layout?}>} list
 * @returns {string[]}
 */
export function buildNavLinksLines(list = []) {
  return list.flatMap(n => {
    const line = navLinksLineOf(n);
    const spanLines = n.uuid ? [`<span data-uuid="${n.uuid}" style="display:none"></span>`] : [];
    return ['', ...spanLines, line];
  });
}

/**
 * Locates every top-level nav-links block in `body`, returning line-addressable
 * entries. A preceding own-line uuid span is swallowed into startLine.
 *
 * Exactly one of `path` / `tag` is set (the other null); `layout` is only set
 * for tag blocks (absent attribute → 'flat').
 *
 * @param {string} body
 * @returns {Array<{uuid,path,tag,layout,indent,startLine,endLine}>}
 */
export function locateNavLinksLines(body) {
  const lines = (body ?? '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const pm = lines[i].match(NAVLINKS_LINE_RE);
    const tm = pm ? null : lines[i].match(NAVLINKS_TAG_LINE_RE);
    if (!pm && !tm) continue;

    let startLine = i;
    let uuid = null;
    if (i > 0) {
      const sm = lines[i - 1].match(UUID_SPAN_LINE_RE);
      if (sm) { uuid = sm[1]; startLine = i - 1; }
    }

    out.push({
      uuid,
      path: pm ? pm[2] : null,
      tag: tm ? tm[2] : null,
      layout: tm ? cleanLayout(tm[3]) : null,
      indent: (pm ?? tm)[1],
      startLine,
      endLine: i + 1,
    });
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

/** The single div line (no identity span — replaceNavLinksByUUID keeps the span).
 * `mode` picks the flavour when both fields are populated (the edit form keeps
 * hidden-mode values around); absent, tag presence decides. */
export function navLinksLineFrom({ mode, path, tag, layout }) {
  const isTag = mode ? mode === 'tag' : tag != null;
  return isTag ? navLinksTagLine(tag, layout) : navLinksLine(path);
}

/**
 * Canonical form/merge representation of a nav-links block's editable fields.
 * Mirrors buttonDimFields — the edit form seeds its baseline from this AND parses
 * fresh markdown through it, so an untouched block compares equal. Fields of the
 * inactive mode hold constant defaults for the same reason.
 */
export function navLinksDimFields(nav) {
  const isTag = nav?.tag != null;
  return {
    navMode: isTag ? 'tag' : 'path',
    navPath: nav?.path ?? '',
    navTag: nav?.tag ?? '',
    navLayout: isTag ? cleanLayout(nav.layout) : 'flat',
  };
}
