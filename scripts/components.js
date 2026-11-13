/**
 * components.js — Unified "Components" model for guide section / admonition
 * bodies (and, later, system-update bodies).
 *
 * A "component" is one of:
 *   - an admonition  (a `!!!`/`???` block — including steps, notes, and nested
 *                     sub-admonitions, which are themselves admonition components)
 *   - a capture      (a paired `![](…#only-light)` / `![](…#only-dark)` image)
 *   - a tab group    (consecutive `=== "Title"` content-tab headers — one
 *                     component per GROUP; each tab inside is itself a
 *                     component container, see contentTabs.js)
 *   - a data table  (a markdown pipe table — see dataTables.js)
 *
 * Historically captures and admonitions were stored segregated (description →
 * all captures → all sub-admonitions). This module parses a body into a single
 * ORDERED list of components and rebuilds it preserving that order, so the two
 * kinds can be freely interleaved.
 *
 * All functions here are pure (no DOM, no network) — markdown in, markdown out.
 */

import { parseAdmonitions, buildAdmonition, generateUUID, GUIDE_ADMONITION_TYPES_RE, ensureAdmonitionUUIDs, splitTitleMeta } from './admonitions.js';
import { buildSectionUUIDSpan } from './sections.js';
import { buildCaptureLines } from './captures.js';
import { buildVideoLines } from './videos.js';
import { buildImageLines } from './images.js';
import { locateTabGroups, buildTabGroup, locateTabByUUID, ensureTabUUIDs } from './contentTabs.js';
import { locateDataTables, buildDataTable, ensureDataTableUUIDs } from './dataTables.js';
import { locateGrids, buildGrid, ensureGridUUIDs, locateGridCellByUUID, parseGridCellBlocks, cellOpenTag } from './grid.js';
import { locateButtonLines, buildButtonLines, ensureButtonUUIDs, isSupportOnclick } from './mdButtons.js';
import { componentKindLabel } from './editLogDescribe.js';
import { locateDiagramLines, buildDiagramLines, ensureDiagramUUIDs } from './mdDiagrams.js';
import { locateCodeBlockLines, buildCodeBlockLines, ensureCodeBlockUUIDs } from './mdCodeBlocks.js';
import { locateNavLinksLines, buildNavLinksLines, ensureNavLinksUUIDs } from './navLinks.js';

// Per-line capture matchers (mirror captures.js' parseExistingCaptures, but
// line-addressable so we can interleave with admonitions by position). The pair
// is anchored on the FILENAME convention (-light-mode / -dark-mode), which is
// the source of truth for which file is which theme — the #only-light/#only-dark
// hash is read separately to detect the "inversed" theme (which swaps the two
// hashes onto the opposite files). Group 3 is that hash; group 4 the attr block.
const LIGHT_LINE_RE =
  /^(\s*)!\[\]\(\.\.\/assets\/([^)#]*-light-mode[^)#]*)#only-(light|dark)\)(?:\{\s*([^}]+?)\s*\})?\s*$/;
const DARK_LINE_RE = /^\s*!\[\]\(\.\.\/assets\/[^)#]*-dark-mode[^)#]*#only-(?:light|dark)\)/;

// Per-line video matchers. A <video> line carries its theme in the FILENAME
// (-light-mode / -dark-mode) like captures; the #only-* fragment is read
// separately to detect "inversed". Group 1 indent, group 2 filename (no hash),
// group 4 the #only side (light|dark) or undefined, group 5 the remaining attrs
// (used to read playback + style). A file with neither suffix is a single video.
const VIDEO_LINE_RE =
  /^(\s*)<video\s+src="\.\.\/assets\/([^"#]+?)(#only-(light|dark))?"\s*([^>]*?)\s*><\/video>\s*$/;
const VIDEO_LIGHT_SUFFIX_RE = /-light-mode\.[a-z0-9]+$/i;
const VIDEO_DARK_SUFFIX_RE = /-dark-mode\.[a-z0-9]+$/i;

// Per-line single-image matcher: a lone empty-alt `![](../assets/…)` with NO
// #only-* hash (which `[^)#\s]+` cannot match, keeping this disjoint from
// LIGHT_LINE_RE) and no theme suffix in the filename (a hand-written hashless
// capture half must never be swallowed as a single image). Empty alt only —
// images with alt text stay description prose. Group 1 indent, group 2 the
// assets-relative filename, group 3 the attr block body.
const IMAGE_LINE_RE = /^(\s*)!\[\]\(\.\.\/assets\/([^)#\s]+)\)(?:\{\s*([^}]+?)\s*\})?\s*$/;
const IMAGE_FILE_EXT_RE = /\.(png|svg|jpe?g|gif|webp)$/i;
const IMAGE_MODE_SUFFIX_RE = /-(light|dark)-mode\.[a-z0-9]+$/i;
const UUID_SPAN_RE = /<span[^>]*data-uuid[^>]*><\/span>\n?/g;
const UUID_SPAN_LINE_RE = /^\s*<span[^>]*data-uuid="([^"]+)"[^>]*><\/span>\s*$/;
// Whole-line variant: removes an own-line uuid span INCLUDING its indent and
// newline, so nested (indented) spans vanish without leaving indent residue —
// UUID_SPAN_RE alone would merge the leftover indent into the following line.
const UUID_SPAN_FULL_LINE_RE = /^[ \t]*<span[^>]*data-uuid[^>]*><\/span>[ \t]*\r?\n?/gm;
// First description lines that python-markdown can't start while a paragraph is
// open: lists, blockquotes, fences, tables. Glued directly under a uuid span
// these get lazily absorbed into the span's paragraph ("- a - b" as running
// text on the published page), so buildComponentBody separates them with a
// blank line. Plain text stays glued — the span rides inside the first
// paragraph instead of minting an empty <p> above every description.
const BLOCK_AFTER_SPAN_RE = /^(?:[-*+]\s|\d{1,9}[.)]\s|>|```|~~~|\|)/;

// First lines a text block cannot open with while its span's paragraph is still
// open: BLOCK_AFTER_SPAN_RE's, plus the ones that would read the span line as
// part of themselves (a `---` under it is a setext heading) or are blocks of
// their own (a heading, block html, an admonition or tab the parser left as text).
const TEXT_AFTER_SPAN_RE = /^(?:[-*+]\s|\d{1,9}[.)]\s|>|```|~~~|\||#{1,6}\s|[-=*_]{3,}\s*$|[-*_](?:\s*[-*_]){2,}\s*$|<(?:div|details|table|p|ul|ol|style|figure|iframe|video|h[1-6])\b|!!!|\?\?\?|===\s)/;

/** A text block's lines: its identity span, then the text (a blank between when the text cannot follow the span directly). */
function textBlockLines(uuid, body) {
  const first = body.split('\n', 1)[0];
  return [buildSectionUUIDSpan(uuid), ...(TEXT_AFTER_SPAN_RE.test(first) ? [''] : []), body];
}

/** True when `line` falls within any `[start, end)` range. */
function inAnyRange(line, ranges) {
  return ranges.some(([start, end]) => line >= start && line < end);
}

/**
 * Parses the dim mode/value + corner rounding out of a capture's `{ … }`
 * attribute string. `rounded` is keyed on the mere presence of a `border-radius`
 * segment (value-agnostic, so tweaking CAPTURE_CORNER_RADIUS never breaks the
 * round-trip). Falls back to 'none' when neither a width nor a height is present
 * — e.g. an auto-sized capture whose only attr is a `border-radius`.
 */
function parseDimAttrs(attrs) {
  if (!attrs) return { dimMode: 'none', dimValue: null, rounded: false };
  const rounded = /border-radius/.test(attrs);
  const widthMatch = attrs.match(/width="(\d+)"/);
  const heightMatch = attrs.match(/height:\s*(\d+)px/);
  if (widthMatch) return { dimMode: 'width', dimValue: parseInt(widthMatch[1], 10), rounded };
  if (heightMatch) return { dimMode: 'height', dimValue: parseInt(heightMatch[1], 10), rounded };
  return { dimMode: 'none', dimValue: null, rounded };
}

/** Parse a <video>'s trailing attribute string into dim + rounding + playback. */
function parseVideoAttrs(attrs) {
  const a = attrs ?? '';
  const playback = /\bcontrols\b/.test(a) ? 'clip' : 'animation';
  const rounded = /border-radius/.test(a);
  const widthMatch = a.match(/width:\s*(\d+)px/);
  const heightMatch = a.match(/height:\s*(\d+)px/);
  let dimMode = 'none', dimValue = null;
  if (widthMatch) { dimMode = 'width'; dimValue = parseInt(widthMatch[1], 10); }
  else if (heightMatch) { dimMode = 'height'; dimValue = parseInt(heightMatch[1], 10); }
  return { dimMode, dimValue, rounded, playback };
}

/**
 * Locates every top-level video in `body`, returning line-addressable entries.
 * A `-light-mode` line whose next non-blank line is its `-dark-mode` partner is
 * a pair; a line with neither suffix is a single. `-dark-mode` lines are only
 * consumed as partners (never anchors), mirroring captures' DARK_LINE_RE.
 *
 * @param {string} body
 * @returns {Array<{lightFilename,darkFilename,single,dimMode,dimValue,rounded,inversed,playback,indent,uuid,startLine,endLine}>}
 */
export function locateVideoLines(body) {
  const lines = (body ?? '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(VIDEO_LINE_RE);
    if (!m) continue;
    const indent = m[1];
    const filename = m[2];
    // A dark-mode line is only ever a partner; never anchor a component on it.
    if (VIDEO_DARK_SUFFIX_RE.test(filename)) continue;

    const isLight = VIDEO_LIGHT_SUFFIX_RE.test(filename);
    const { dimMode, dimValue, rounded, playback } = parseVideoAttrs(m[5]);

    let single = true;
    let darkFilename = null;
    let inversed = false;
    let endLine = i + 1;

    if (isLight) {
      // The light file carrying #only-dark means the theme was inversed.
      inversed = m[4] === 'dark';
      const j = (() => { let k = i + 1; while (k < lines.length && lines[k] === '') k++; return k; })();
      const dm = j < lines.length ? lines[j].match(VIDEO_LINE_RE) : null;
      if (dm && VIDEO_DARK_SUFFIX_RE.test(dm[2])) {
        single = false;
        darkFilename = filename.replace('-light-mode', '-dark-mode');
        endLine = j + 1;
      }
    }

    // A hidden data-uuid span on the line immediately before this video is its
    // identity; extend startLine to swallow it.
    let startLine = i;
    let uuid = null;
    if (i > 0) {
      const sm = lines[i - 1].match(UUID_SPAN_LINE_RE);
      if (sm) { uuid = sm[1]; startLine = i - 1; }
    }

    out.push({ lightFilename: filename, darkFilename, single, dimMode, dimValue, rounded, inversed, playback, indent, uuid, startLine, endLine });
    i = endLine - 1;
  }
  return out;
}

/**
 * Backfills a hidden data-uuid span before every video that lacks one.
 * Idempotent; matches videos at any indent. Mirrors ensureCaptureUUIDs.
 */
export function ensureVideoUUIDs(markdown) {
  const vids = locateVideoLines(markdown);
  if (vids.length === 0) return markdown;
  const lines = (markdown ?? '').split('\n');
  let modified = false;
  for (let k = vids.length - 1; k >= 0; k--) {
    const v = vids[k];
    if (v.uuid) continue;
    const span = `${v.indent}<span data-uuid="${generateUUID()}" style="display:none"></span>`;
    lines.splice(v.startLine, 0, span);
    modified = true;
  }
  return modified ? lines.join('\n') : markdown;
}

/**
 * Locates every single image in `body`, returning line-addressable entries.
 * One line per image (no pair scan — pairs are captures); non-image extensions
 * (e.g. a hand-linked PDF) and -light/-dark-mode filenames are skipped.
 *
 * @param {string} body
 * @returns {Array<{filename,dimMode,dimValue,rounded,indent,uuid,startLine,endLine}>}
 */
export function locateImageLines(body) {
  const lines = (body ?? '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(IMAGE_LINE_RE);
    if (!m) continue;
    const filename = m[2];
    if (!IMAGE_FILE_EXT_RE.test(filename)) continue;
    // A theme-suffixed file is a capture half (even hashless), never an image.
    if (IMAGE_MODE_SUFFIX_RE.test(filename)) continue;
    const indent = m[1];
    const { dimMode, dimValue, rounded } = parseDimAttrs(m[3]);

    // A hidden data-uuid span on the line immediately before this image is its
    // identity; extend startLine to swallow it.
    let startLine = i;
    let uuid = null;
    if (i > 0) {
      const sm = lines[i - 1].match(UUID_SPAN_LINE_RE);
      if (sm) { uuid = sm[1]; startLine = i - 1; }
    }

    out.push({ filename, dimMode, dimValue, rounded, indent, uuid, startLine, endLine: i + 1 });
  }
  return out;
}

/**
 * Backfills a hidden data-uuid span before every single image that lacks one.
 * Idempotent; matches images at any indent. Mirrors ensureVideoUUIDs.
 */
export function ensureImageUUIDs(markdown) {
  const imgs = locateImageLines(markdown);
  if (imgs.length === 0) return markdown;
  const lines = (markdown ?? '').split('\n');
  let modified = false;
  for (let k = imgs.length - 1; k >= 0; k--) {
    const img = imgs[k];
    if (img.uuid) continue;
    const span = `${img.indent}<span data-uuid="${generateUUID()}" style="display:none"></span>`;
    lines.splice(img.startLine, 0, span);
    modified = true;
  }
  return modified ? lines.join('\n') : markdown;
}

/**
 * Locates every top-level capture pair in `body`, returning line-addressable
 * entries. A pair is a `#only-light` line immediately followed (ignoring blanks)
 * by its `#only-dark` partner.
 *
 * @param {string} body
 * @returns {Array<{lightFilename,darkFilename,dimMode,dimValue,rounded,inversed,indent,startLine,endLine}>}
 */
export function locateCaptureLines(body) {
  const lines = (body ?? '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(LIGHT_LINE_RE);
    if (!m) continue;
    const indent = m[1];
    const lightFilename = m[2];
    const darkFilename = lightFilename.replace('-light-mode', '-dark-mode');
    // The light-mode file carrying #only-dark means the theme was inversed.
    const inversed = m[3] === 'dark';
    const { dimMode, dimValue, rounded } = parseDimAttrs(m[4]);

    // The dark partner is the next non-blank line (if it is indeed a dark image).
    let j = i + 1;
    while (j < lines.length && lines[j] === '') j++;
    const endLine = (j < lines.length && DARK_LINE_RE.test(lines[j])) ? j + 1 : i + 1;

    // A hidden data-uuid span on the line immediately before the light image is
    // this capture's identity; extend startLine to swallow it.
    let startLine = i;
    let uuid = null;
    if (i > 0) {
      const sm = lines[i - 1].match(UUID_SPAN_LINE_RE);
      if (sm) { uuid = sm[1]; startLine = i - 1; }
    }

    out.push({ lightFilename, darkFilename, dimMode, dimValue, rounded, inversed, indent, uuid, startLine, endLine });
    i = endLine - 1;
  }
  return out;
}

/**
 * Backfills a hidden data-uuid span before every capture that lacks one.
 * Idempotent; matches captures at any indent (so nested captures inside
 * admonitions / system-updates are covered in one whole-document pass).
 * Reverse-order splice keeps earlier line indices valid. Mirrors
 * ensureSectionUUIDs / ensureAdmonitionUUIDs.
 *
 * @param {string} markdown
 * @returns {string}
 */
export function ensureCaptureUUIDs(markdown) {
  const caps = locateCaptureLines(markdown);
  if (caps.length === 0) return markdown;
  const lines = (markdown ?? '').split('\n');
  let modified = false;
  for (let k = caps.length - 1; k >= 0; k--) {
    const c = caps[k];
    if (c.uuid) continue; // already migrated
    const span = `${c.indent}<span data-uuid="${generateUUID()}" style="display:none"></span>`;
    lines.splice(c.startLine, 0, span); // insert immediately before the light line
    modified = true;
  }
  return modified ? lines.join('\n') : markdown;
}

/**
 * Parses `body` into an ordered component list plus the leading description.
 *
 * @param {string} body
 * @param {RegExp} typeRegex - admonition type matcher (e.g. GUIDE_ADMONITION_TYPES_RE)
 * @param {{skipTabBlocks?: boolean}} [opts]
 * @returns {{ description: string, components: Array }}
 *   Each component is `{ kind:'admonition', adm }`, `{ kind:'capture', cap }`
 *   or `{ kind:'tabs', grp }`.
 */
export function parseComponents(body, typeRegex, opts = {}) {
  const { blocks } = parseBlocks(body, typeRegex, opts);
  const lead = blocks[0]?.kind === 'text' ? blocks[0].txt : null;
  return {
    description: lead ? lead.body : '',
    descriptionUuid: lead ? lead.uuid : null,
    components: lead ? blocks.slice(1) : blocks,
  };
}

/**
 * A body as ONE ordered list of blocks: every component, and every run of text
 * between them as `{ kind: 'text', txt: { uuid, body } }`. Text is a block like
 * any other: it keeps its place, and its identity is the uuid span on the line
 * above it (same span as every other block). Text with no span yet (a page
 * written before text blocks, or by hand) is given a uuid worked out from the
 * container, its place and its words, so the same body always reads the same
 * way; the span is written the next time the container is.
 *
 * @param {string} body
 * @param {RegExp} typeRegex
 * @param {{skipTabBlocks?: boolean, ownSpan?: boolean, owner?: string}} [opts]
 *   `ownSpan` (default true): the body opens with its container's own identity
 *   span (an admonition's, a tab's, a grid cell's, a system update's). A
 *   section's body does not (its span sits under the heading): pass false and
 *   the section's uuid as `owner`.
 * @returns {{ blocks: Array }}
 */
export function parseBlocks(body, typeRegex, { skipTabBlocks = true, ownSpan = true, owner = '' } = {}) {
  const src = body ?? '';

  // ALL code blocks (any indent) first: fence content can contain lines that
  // look like any other component (a `!!!` header, a `|` table row, a button
  // link inside a markdown example), so every other locator is masked by
  // these ranges. Top-level code-block COMPONENTS are the indent '' subset,
  // filtered against containers like every other leaf below.
  const codeBlocks = locateCodeBlockLines(src);
  const codeRanges = codeBlocks.map(cb => [cb.startLine, cb.endLine]);
  const inCode = (line) => inAnyRange(line, codeRanges);

  // Immediate-child admonitions (indent 0 within this dedented body).
  // skipTabBlocks keeps admonitions buried inside tab groups out of this list.
  const adms = parseAdmonitions(src, typeRegex, { skipTabBlocks })
    .filter(a => a.indent === '' && !inCode(a.headerLine));
  const admRanges = adms.map(a => [a.headerLine, a.endLine]);

  // Immediate-child grids (indent 0). Grid cells hold their own components at
  // indent 0 (md_in_html does not indent), so grids must be located first and
  // their ranges used to exclude grid-internal admonitions/tabs/tables/captures.
  const grids = locateGrids(src)
    .filter(g => g.indent === '' && !inAnyRange(g.startLine, admRanges) && !inCode(g.startLine));
  const gridRanges = grids.map(g => [g.startLine, g.endLine]);
  const inContainer = (line) => inAnyRange(line, admRanges) || inAnyRange(line, gridRanges) || inCode(line);

  // Immediate-child tab groups (indent 0; groups nested inside admonitions/grids
  // are excluded by range).
  const grps = locateTabGroups(src)
    .filter(g => g.indent === '' && !inContainer(g.startLine));

  // Top-level captures: indent 0 and not buried inside an admonition or grid.
  const topCaptures = locateCaptureLines(src)
    .filter(c => c.indent === '' && !inContainer(c.startLine));

  // Top-level videos: indent 0 and not buried inside an admonition or grid.
  const topVideos = locateVideoLines(src)
    .filter(v => v.indent === '' && !inContainer(v.startLine));

  // Top-level single images: indent 0 and not buried inside an admonition or grid.
  const topImages = locateImageLines(src)
    .filter(i => i.indent === '' && !inContainer(i.startLine));

  // Immediate-child data tables (indent 0; tables inside admonitions/grids excluded).
  const tbls = locateDataTables(src)
    .filter(t => t.indent === '' && !inContainer(t.startLine));

  // Top-level buttons: indent 0 and not buried inside an admonition or grid.
  const topButtons = locateButtonLines(src)
    .filter(b => b.indent === '' && !inContainer(b.startLine));

  // Top-level nav-links blocks: indent 0 and not buried inside an admonition or grid.
  const topNavLinks = locateNavLinksLines(src)
    .filter(n => n.indent === '' && !inContainer(n.startLine));

  // Top-level diagrams: indent 0 and not buried inside an admonition or grid.
  const topDiagrams = locateDiagramLines(src)
    .filter(d => d.indent === '' && !inContainer(d.startLine));

  // Top-level code blocks: indent 0 and not buried inside an admonition or
  // grid. Checked against those ranges only — inContainer would mask a code
  // block with its OWN fence range.
  const topCodeBlocks = codeBlocks
    .filter(cb => cb.indent === '' && !inAnyRange(cb.startLine, admRanges) && !inAnyRange(cb.startLine, gridRanges));

  const items = [
    ...adms
      .filter(a => !inAnyRange(a.headerLine, gridRanges))
      .map(adm => ({ kind: 'admonition', adm, startLine: adm.headerLine, endLine: adm.endLine })),
    ...grids.map(g => ({
      kind: 'grid',
      grid: { uuid: g.uuid ?? null, flavor: g.flavor, cells: g.cells },
      startLine: g.startLine,
      endLine: g.endLine,
    })),
    ...grps.map(g => ({
      kind: 'tabs',
      grp: { uuid: g.uuid ?? null, tabs: g.tabs },
      startLine: g.startLine,
      endLine: g.endLine,
    })),
    ...tbls.map(t => ({
      kind: 'table',
      tbl: { uuid: t.uuid ?? null, wrap: t.wrap, align: t.align, header: t.header, rows: t.rows },
      startLine: t.startLine,
      endLine: t.endLine,
    })),
    ...topCaptures.map(c => ({
      kind: 'capture',
      cap: { uuid: c.uuid ?? null, lightFilename: c.lightFilename, darkFilename: c.darkFilename, dimMode: c.dimMode, dimValue: c.dimValue, inversed: c.inversed, rounded: c.rounded },
      startLine: c.startLine,
      endLine: c.endLine,
    })),
    ...topVideos.map(v => ({
      kind: 'video',
      vid: { uuid: v.uuid ?? null, lightFilename: v.lightFilename, darkFilename: v.darkFilename, single: v.single, dimMode: v.dimMode, dimValue: v.dimValue, inversed: v.inversed, rounded: v.rounded, playback: v.playback },
      startLine: v.startLine,
      endLine: v.endLine,
    })),
    ...topImages.map(i => ({
      kind: 'image',
      img: { uuid: i.uuid ?? null, filename: i.filename, dimMode: i.dimMode, dimValue: i.dimValue, rounded: i.rounded },
      startLine: i.startLine,
      endLine: i.endLine,
    })),
    ...topButtons.map(b => ({
      kind: 'button',
      btn: { uuid: b.uuid ?? null, label: b.label, destination: b.destination, icon: b.icon, primary: b.primary, colour: b.colour, theme: b.theme, border: b.border, style: b.style, newTab: b.newTab, onclick: b.onclick },
      startLine: b.startLine,
      endLine: b.endLine,
    })),
    ...topNavLinks.map(n => ({
      kind: 'navlinks',
      nav: n.tag != null
        ? { uuid: n.uuid ?? null, tag: n.tag, layout: n.layout, newTab: n.newTab }
        : { uuid: n.uuid ?? null, path: n.path, newTab: n.newTab },
      startLine: n.startLine,
      endLine: n.endLine,
    })),
    ...topDiagrams.map(d => ({
      kind: 'diagram',
      dia: { uuid: d.uuid ?? null, code: d.code },
      startLine: d.startLine,
      endLine: d.endLine,
    })),
    ...topCodeBlocks.map(cb => ({
      kind: 'codeblock',
      cb: { uuid: cb.uuid ?? null, language: cb.language, title: cb.title, linenums: cb.linenums, hlLines: cb.hlLines, extra: cb.extra, code: cb.code, annotations: cb.annotations },
      startLine: cb.startLine,
      endLine: cb.endLine,
    })),
  ].sort((a, b) => a.startLine - b.startLine);

  const all = [...items, ...locateTextBlocks(src, items, ownSpan, owner)]
    .sort((a, b) => a.startLine - b.startLine);

  // Strip the internal line bookkeeping before handing components back.
  const blocks = all.map(it => {
    if (it.kind === 'text') return { kind: 'text', txt: it.txt };
    if (it.kind === 'admonition') return { kind: 'admonition', adm: it.adm };
    if (it.kind === 'tabs') return { kind: 'tabs', grp: it.grp };
    if (it.kind === 'table') return { kind: 'table', tbl: it.tbl };
    if (it.kind === 'grid') return { kind: 'grid', grid: it.grid };
    if (it.kind === 'video') return { kind: 'video', vid: it.vid };
    if (it.kind === 'image') return { kind: 'image', img: it.img };
    if (it.kind === 'button') return { kind: 'button', btn: it.btn };
    if (it.kind === 'navlinks') return { kind: 'navlinks', nav: it.nav };
    if (it.kind === 'diagram') return { kind: 'diagram', dia: it.dia };
    if (it.kind === 'codeblock') return { kind: 'codeblock', cb: it.cb };
    return { kind: 'capture', cap: it.cap };
  });

  return { blocks };
}

// A block's identity span standing on a line of its own, at the body's own
// indent (a deeper one belongs to something nested the parser does not know).
const OWN_LINE_SPAN_RE = /^<span[^>]*data-uuid="([^"]+)"[^>]*><\/span>\s*$/;

/**
 * A uuid worked out from a string: the same string always gives the same uuid.
 * For text that has no identity span yet (see parseBlocks).
 */
export function derivedUuid(seed) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  const hex = [h1 ^ h2 ^ h3 ^ h4, h2 ^ h1, h3 ^ h1, h4 ^ h1]
    .map(h => (h >>> 0).toString(16).padStart(8, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * The text blocks of `body`: every run of lines no component covers. A span
 * line starts a block (and names it); text with no span above it is a block
 * too. A span with nothing under it but the next component is that
 * component's own (or stray) and is not text.
 */
function locateTextBlocks(body, items, ownSpan, owner) {
  const lines = body.split('\n');
  const covered = new Array(lines.length).fill(false);
  for (const it of items) for (let i = it.startLine; i < it.endLine && i < lines.length; i++) covered[i] = true;

  let ownerUuid = owner ?? '';
  if (ownSpan) {
    const first = lines.findIndex(l => l.trim() !== '');
    const m = first >= 0 && !covered[first] ? lines[first].match(OWN_LINE_SPAN_RE) : null;
    if (m) { ownerUuid = m[1]; covered[first] = true; }
  }

  const out = [];
  let cur = null;
  let pending = null;
  const flush = () => {
    if (cur) {
      const text = cur.lines.join('\n').trim();
      if (text) out.push({ kind: 'text', startLine: cur.startLine, endLine: cur.startLine + 1, txt: { uuid: cur.uuid, body: text } });
    }
    cur = null;
  };
  for (let i = 0; i < lines.length; i++) {
    if (covered[i]) { flush(); pending = null; continue; }
    const line = lines[i];
    const span = line.match(OWN_LINE_SPAN_RE);
    if (span) { flush(); pending = { uuid: span[1], line: i }; continue; }
    if (line.trim() === '') { if (cur) cur.lines.push(''); continue; }
    if (!cur) {
      cur = { uuid: pending?.uuid ?? null, startLine: pending?.line ?? i, lines: [] };
      pending = null;
    }
    cur.lines.push(line);
  }
  flush();

  let n = 0;
  for (const t of out) {
    if (!t.txt.uuid) t.txt.uuid = derivedUuid(`${ownerUuid}|text|${n++}|${t.txt.body}`);
  }
  return out;
}

/**
 * Depth-1 view model for card previews: the container's own description plus a
 * small per-kind summary of each nested component, ready for cardRenderer's
 * cardPreviewBlock. Pure. Media subs carry raw filenames — the renderer
 * resolves CDN urls, keeping this module URL-free.
 */
export function cardPreviewModel(body, typeRegex = GUIDE_ADMONITION_TYPES_RE) {
  const { description, components } = parseComponents(body ?? '', typeRegex);
  return { description, subs: components.map(c => subViewModel(c, typeRegex)) };
}

function subViewModel(c, typeRegex) {
  switch (c.kind) {
    case 'admonition': {
      const { title, meta } = splitTitleMeta(c.adm.title || '');
      // Depth 1: the nested admonition's OWN description only — its
      // sub-components are parsed out and dropped so they never leak as raw
      // markdown into the mini-card.
      const description = parseComponents(c.adm.body, typeRegex).description;
      return { kind: 'admonition', type: c.adm.type, title, meta, description };
    }
    case 'tabs':     return { kind: 'tabs', titles: (c.grp.tabs ?? []).map(t => t.title).filter(Boolean) };
    case 'table':    return { kind: 'table', cols: c.tbl.align?.length ?? (c.tbl.header ?? []).length, rows: c.tbl.rows.length };
    case 'grid':     return { kind: 'grid', cells: (c.grid.cells ?? []).length, flavor: c.grid.flavor };
    case 'button':   return { kind: 'button', label: c.btn.label, destination: c.btn.destination, support: isSupportOnclick(c.btn.onclick) };
    case 'navlinks': return { kind: 'navlinks', text: c.nav.tag != null ? `${c.nav.tag.includes(',') ? 'Tags' : 'Tag'}: ${c.nav.tag}` : c.nav.path };
    case 'diagram':  return { kind: 'diagram' };
    case 'codeblock': return { kind: 'codeblock', title: c.cb.title, language: c.cb.language };
    case 'text':     return { kind: 'text', text: c.txt.body };
    case 'video':    return { kind: 'video', filename: c.vid.lightFilename };
    case 'image':    return { kind: 'image', filename: c.img.filename };
    default:         return { kind: 'capture', filename: c.cap.lightFilename };
  }
}

/**
 * Rebuilds a body from a description + ordered component list. Inverse of
 * parseComponents. Replaces both rebuildSectionBody and rebuildAdmonitionBody.
 *
 *   [uuidSpan?]
 *   description…
 *
 *   <component 1>
 *
 *   <component 2>
 *   …
 *
 * @param {string|null} uuid - admonition UUID to embed as a hidden span, or null
 *                             for sections (whose UUID lives in the heading).
 * @param {string} description
 * @param {Array} components - `{kind:'admonition', adm}` | `{kind:'capture', cap}` | `{kind:'text', txt}` …
 * @param {string|null} [descriptionUuid] - the leading text's own uuid (parseComponents hands it back)
 * @returns {string}
 */
export function buildComponentBody(uuid, description, components, descriptionUuid = null) {
  const lines = [];
  if (uuid) lines.push(buildSectionUUIDSpan(uuid));
  const desc = (description ?? '').trim();
  if (desc.length && descriptionUuid) {
    // The leading text as the block it is: its own span, on the line above it.
    if (uuid) lines.push('');
    lines.push(...textBlockLines(descriptionUuid, desc));
  } else if (desc.length) {
    // No identity handed over: the text is written bare and reads back as the
    // leading text block (parseBlocks names it until a span is written).
    if (uuid && BLOCK_AFTER_SPAN_RE.test(desc)) lines.push('');
    lines.push(desc);
  }

  for (const c of components) {
    if (c.kind === 'text') {
      const body = (c.txt.body ?? '').trim();
      if (!body) continue; // an emptied text block is no block at all
      lines.push('');
      lines.push(...textBlockLines(c.txt.uuid, body));
      continue;
    }
    lines.push(''); // one blank separator before each component
    if (c.kind === 'admonition') {
      const a = c.adm;
      // Strip leading blank lines from the parsed body before re-emitting:
      // parseAdmonitions captures the blank line under the header as part of
      // the body, and buildAdmonition re-adds its own header gap — so without
      // this, every round-trip accumulates an extra blank line inside the block.
      const body = (a.body ?? '').replace(/^\n+/, '');
      lines.push(buildAdmonition(a.prefix, a.type, a.title, body).trim());
    } else if (c.kind === 'tabs') {
      lines.push(buildTabGroup(c.grp.uuid, c.grp.tabs));
    } else if (c.kind === 'table') {
      lines.push(buildDataTable(c.tbl.uuid, c.tbl.align, c.tbl.header, c.tbl.rows, c.tbl.wrap));
    } else if (c.kind === 'grid') {
      lines.push(buildGrid(c.grid.uuid, c.grid.flavor, c.grid.cells));
    } else if (c.kind === 'video') {
      // buildVideoLines emits a leading '' we don't want (we add our own).
      lines.push(...buildVideoLines([c.vid]).slice(1));
    } else if (c.kind === 'image') {
      // buildImageLines emits a leading '' we don't want (we add our own).
      lines.push(...buildImageLines([c.img]).slice(1));
    } else if (c.kind === 'button') {
      // buildButtonLines emits a leading '' we don't want (we add our own).
      lines.push(...buildButtonLines([c.btn]).slice(1));
    } else if (c.kind === 'navlinks') {
      // buildNavLinksLines emits a leading '' we don't want (we add our own).
      lines.push(...buildNavLinksLines([c.nav]).slice(1));
    } else if (c.kind === 'diagram') {
      // buildDiagramLines emits a leading '' we don't want (we add our own).
      lines.push(...buildDiagramLines([c.dia]).slice(1));
    } else if (c.kind === 'codeblock') {
      // buildCodeBlockLines emits a leading '' we don't want (we add our own).
      lines.push(...buildCodeBlockLines([c.cb]).slice(1));
    } else {
      // buildCaptureLines emits a leading '' we don't want (we add our own).
      lines.push(...buildCaptureLines([c.cap]).slice(1));
    }
  }
  return lines.join('\n');
}

/**
 * Canonical form/merge representation of a capture's editable fields: dimensions
 * (`dimValue` is '' whenever the mode is 'none'/auto), plus the Theme and Corner
 * rounding radio values. The edit-capture form seeds its baseline from this AND
 * parses fresh markdown through it, so an untouched capture compares equal on
 * both sides of a merge (no false conflict from the number input's UI prefill).
 * The two radio fields use form-facing string values ('default'/'inversed',
 * 'disabled'/'enabled') that the form's named radios hydrate from directly.
 */
export function captureDimFields(cap) {
  const dimMode = cap?.dimMode ?? 'none';
  return {
    dimMode,
    dimValue: dimMode === 'none' ? '' : String(cap?.dimValue ?? ''),
    captureTheme: cap?.inversed ? 'inversed' : 'default',
    captureCorner: cap?.rounded ? 'enabled' : 'disabled',
  };
}

/** Builds a fresh capture component from a (resolved) capture object. */
export function captureComponent(cap) {
  return { kind: 'capture', cap };
}

/**
 * Canonical form/merge representation of a video's editable fields. Reuses the
 * capture radio field names (captureTheme/captureCorner) so the SHARED edit form
 * hydrates both kinds from the same radios; adds videoPlayback for the
 * animation/clip toggle (video-only).
 */
export function videoDimFields(vid) {
  const dimMode = vid?.dimMode ?? 'none';
  return {
    dimMode,
    dimValue: dimMode === 'none' ? '' : String(vid?.dimValue ?? ''),
    captureTheme: vid?.inversed ? 'inversed' : 'default',
    captureCorner: vid?.rounded ? 'enabled' : 'disabled',
    videoPlayback: vid?.playback ?? 'animation',
  };
}

/** Builds a fresh video component from a (resolved) video object. */
export function videoComponent(vid) {
  return { kind: 'video', vid };
}

/**
 * Canonical form/merge representation of a single image's editable fields.
 * Reuses the capture Corner radio name (captureCorner) so the SHARED edit form
 * hydrates it from the same radio; no captureTheme (an image has no pair) and
 * no videoPlayback — hidden fields must stay out of the spec or merge sees
 * phantom conflicts on radios the form never shows.
 */
export function imageDimFields(img) {
  const dimMode = img?.dimMode ?? 'none';
  return {
    dimMode,
    dimValue: dimMode === 'none' ? '' : String(img?.dimValue ?? ''),
    captureCorner: img?.rounded ? 'enabled' : 'disabled',
  };
}

/** Builds a fresh image component from a (resolved) image object. */
export function imageComponent(img) {
  return { kind: 'image', img };
}

/** Builds an admonition component from a parsed admonition entry. */
export function admonitionComponent(adm) {
  return { kind: 'admonition', adm };
}

/**
 * parseComponents options for a SECTION's body: unlike every other container's,
 * it does not open with the container's own span (that sits under the heading).
 */
export const sectionBodyOpts = sectionUuid => ({ ownSpan: false, owner: sectionUuid ?? '' });

/**
 * The identity a container's leading text is written with: the one it has
 * (`prior` is the container as last parsed), or a new one where there was no
 * leading text. Null when there is no text to write.
 */
export function leadUuid(prior, description) {
  if (!String(description ?? '').trim()) return null;
  return prior?.descriptionUuid ?? generateUUID();
}

/** The stable UUID of a component (admonition, capture, video, tab group, or data table). */
export function uuidOfComponent(c) {
  if (c.kind === 'admonition') return c.adm.uuid;
  if (c.kind === 'tabs') return c.grp.uuid;
  if (c.kind === 'table') return c.tbl.uuid;
  if (c.kind === 'grid') return c.grid.uuid;
  if (c.kind === 'video') return c.vid.uuid;
  if (c.kind === 'image') return c.img.uuid;
  if (c.kind === 'button') return c.btn.uuid;
  if (c.kind === 'navlinks') return c.nav.uuid;
  if (c.kind === 'diagram') return c.dia.uuid;
  if (c.kind === 'codeblock') return c.cb.uuid;
  if (c.kind === 'text') return c.txt.uuid;
  return c.cap.uuid;
}

/** Removes every own-line `data-uuid` identity span (any indent) from `markdown`. */
export function stripUUIDSpans(markdown) {
  return (markdown ?? '')
    // Span line flanked by blank lines (or at string start with a blank after):
    // deleting only the line would leave a doubled blank where the reader saw
    // one — consume one flanking blank with it. Glued spans fall through to
    // the plain line-strip below.
    .replace(/(?<=^|\n[ \t]*\n)[ \t]*<span[^>]*data-uuid[^>]*><\/span>[ \t]*\r?\n[ \t]*\r?\n/g, '')
    .replace(UUID_SPAN_FULL_LINE_RE, '');
}

/**
 * The full markdown of one component (including all nested subcomponents),
 * with every identity span stripped — the Copy-to-clipboard payload.
 */
export function componentMarkdown(component) {
  return componentsMarkdown([component]);
}

/**
 * The markdown of several components in the given order, one blank line apart
 * (buildComponentBody's own separator), identity spans stripped — the Shift+click
 * multi-select Copy payload. parsePastedComponents accepts it as-is.
 */
// The native-confirm text for deleting components from a list. One component
// → the exact prompt its edit form's Delete uses (kept in lockstep with those
// registerFormAction handlers). Several → the list of what goes, capped, plus
// the caveats that apply to the kinds present.
const DELETE_PROMPTS = {
  admonition: 'Delete this admonition? This also removes any sub-admonitions inside it.',
  capture: 'Delete this capture? This removes it from the page (the file stays in the library).',
  video: 'Delete this video? This removes it from the page (the file stays in the library).',
  image: 'Delete this image? This removes it from the page (the file stays in the library).',
  grid: 'Delete this grid? All of its cells and their contents are removed.',
  tabs: 'Delete this tab group? All of its tabs and their contents are removed.',
  table: 'Delete this data table?',
  button: 'Delete this button?',
  navlinks: 'Delete these nav links?',
  diagram: 'Delete this diagram?',
  codeblock: 'Delete this code block?',
  text: 'Delete this text?',
};
const DELETE_LIST_CAP = 8;
export function deleteConfirmMessage(components) {
  const comps = (components ?? []).filter(Boolean);
  if (comps.length === 1) return DELETE_PROMPTS[comps[0].kind] ?? 'Delete this component?';
  const kinds = new Set(comps.map(c => c.kind));
  const lines = comps.slice(0, DELETE_LIST_CAP).map(c => `• ${componentKindLabel(c)}`);
  if (comps.length > DELETE_LIST_CAP) lines.push(`• and ${comps.length - DELETE_LIST_CAP} more`);
  const caveats = ['They are removed from the page.'];
  if (kinds.has('admonition')) caveats.push('Admonitions take their sub-admonitions with them.');
  if (kinds.has('grid') || kinds.has('tabs')) caveats.push('Grids and tab groups take their contents with them.');
  if (kinds.has('capture') || kinds.has('video') || kinds.has('image')) caveats.push('Media files stay in the library.');
  return `Delete these ${comps.length} components?\n\n${lines.join('\n')}\n\n${caveats.join(' ')}`;
}

export function componentsMarkdown(components) {
  return stripUUIDSpans(buildComponentBody(null, '', components))
    .replace(/^\n+/, '')
    .trimEnd();
}

/**
 * Validates pasted markdown for the "Paste copied markdown" insert flow.
 * Strips any uuid spans the paste carried (fresh identities are always minted —
 * pasting into the same page can never duplicate a uuid), backfills new uuids
 * (admonitions → tabs → grids → tables → captures, same order as migrateComponentIdentity), and
 * parses the result. Valid = at least one recognized component and no stray
 * prose outside component blocks.
 *
 * @param {string} text
 * @returns {{ components: Array|null, error: string|null }}
 */
export function parsePastedComponents(text) {
  const { stripped, description, components } = mintPastedMarkdown(text);
  if (!stripped) return { components: null, error: 'Nothing to insert — paste component markdown first.' };
  // Text is a block like any other: pasted text lands as text blocks, in place.
  const lead = description.trim() ? [{ kind: 'text', txt: { uuid: generateUUID(), body: description.trim() } }] : [];
  return { components: [...lead, ...components], error: null };
}

// Shared mint step for the paste flows: strip any spans the paste carried,
// normalise line endings, backfill fresh uuids (same chain order as
// migrateComponentIdentity) and parse. `stripped` is '' for blank input (the
// chain is skipped; description/components are then empty).
function mintPastedMarkdown(text) {
  const stripped = stripUUIDSpans(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!stripped) return { stripped, description: '', components: [] };
  const withUuids = ensureCodeBlockUUIDs(ensureDiagramUUIDs(ensureNavLinksUUIDs(ensureButtonUUIDs(ensureImageUUIDs(ensureVideoUUIDs(ensureCaptureUUIDs(ensureDataTableUUIDs(ensureGridUUIDs(ensureTabUUIDs(ensureAdmonitionUUIDs(stripped, GUIDE_ADMONITION_TYPES_RE)))))))))));
  // The paste carries no container span of its own, and its text gets fresh
  // identities like everything else in it.
  const { description, components } = parseComponents(withUuids, GUIDE_ADMONITION_TYPES_RE, { ownSpan: false });
  for (const c of components) if (c.kind === 'text') c.txt.uuid = generateUUID();
  return { stripped, description, components };
}

/**
 * The clipboard payload for one grid cell: its `<div … markdown>` block (class
 * from the grid's flavor + the cell's spill flag, inline align-self from valign)
 * around the cell body with every identity span stripped.
 *
 * @param {'card'|'generic'} flavor
 * @param {{ body: string, spill?: boolean, valign?: string }} cell
 */
export function gridCellMarkdown(flavor, cell) {
  const body = stripUUIDSpans(cell.body ?? '').replace(/^\n+/, '').trimEnd();
  return [cellOpenTag(flavor, !!cell.spill, cell.valign ?? 'default'), '', ...(body ? [body, ''] : []), '</div>'].join('\n');
}

/**
 * Several cells' payloads in the given order, one blank line apart — the same
 * layout buildGrid emits between cells, so parsePastedGridCells accepts it as-is.
 */
export function gridCellsMarkdown(flavor, cells) {
  return cells.map(c => gridCellMarkdown(flavor, c)).join('\n\n');
}

/**
 * Validates pasted markdown for the grid form's "Paste cell markdown" flow.
 * Strict: the text must be one or more cell blocks or one whole grid (see
 * parseGridCellBlocks). Each cell body is minted like a component paste (spans
 * stripped, fresh uuids) — prose inside a cell is its description, so it is fine.
 *
 * @returns {{ cells: Array<{uuid, description, components, spill, valign}>|null, error: string|null }}
 */
export function parsePastedGridCells(text) {
  const stripped = stripUUIDSpans(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!stripped) return { cells: null, error: 'Nothing to insert — paste cell markdown first.' };
  const blocks = parseGridCellBlocks(stripped);
  if (!blocks) {
    return { cells: null, error: 'No grid cells recognised. Paste markdown copied with a cell’s Copy button, or a whole grid.' };
  }
  const cells = blocks.map(b => {
    const { description, components } = mintPastedMarkdown(b.body);
    return { uuid: generateUUID(), description, components, spill: !!b.spill, valign: b.valign ?? 'default' };
  });
  return { cells, error: null };
}

// ── Tab containers (a single tab's body holds an ordered component list) ──────

/**
 * Reads the component list of the TAB identified by `tabUuid` out of the raw
 * document (any nesting depth). The tab's body is dedented by header indent +4
 * and parsed like any container body — its own identity span is stripped by
 * the description extraction, same as admonition bodies.
 *
 * @param {string} md
 * @param {string} tabUuid
 * @returns {{ description: string, components: Array }}
 */
export function readTabComponents(md, tabUuid) {
  const lines = (md ?? '').split('\n');
  const loc = locateTabByUUID(lines, tabUuid);
  if (!loc) return { description: '', descriptionUuid: null, components: [] };
  const bodyIndent = loc.headerIndent + '    ';
  const body = lines.slice(loc.headerLine + 1, loc.endLine)
    .map(l => (l.startsWith(bodyIndent) ? l.slice(bodyIndent.length) : l))
    .join('\n');
  return parseComponents(body, GUIDE_ADMONITION_TYPES_RE);
}

/**
 * True when the TAB identified by `tabUuid` exists anywhere in the document.
 * readTabComponents returns an empty result for BOTH a missing tab and an
 * empty one — this is the disambiguator (registered as the 'content-tab'
 * container's `exists` handler).
 *
 * @param {string} md
 * @param {string} tabUuid
 * @returns {boolean}
 */
export function tabContainerExists(md, tabUuid) {
  return locateTabByUUID((md ?? '').split('\n'), tabUuid) != null;
}

/**
 * Rebuilds the body of the TAB identified by `tabUuid` from a description +
 * ordered component list (via buildComponentBody, which re-embeds the tab's
 * own identity span), re-indents it under the tab's header, and splices it in.
 * Inverse of readTabComponents.
 *
 * @param {string} md
 * @param {string} tabUuid
 * @param {string} description
 * @param {Array} components
 * @returns {string}
 */
export function writeTabBody(md, tabUuid, description, components) {
  const lines = (md ?? '').split('\n');
  const loc = locateTabByUUID(lines, tabUuid);
  if (!loc) return md;
  const bodyIndent = loc.headerIndent + '    ';
  const body = buildComponentBody(tabUuid, description, components, leadUuid(readTabComponents(md, tabUuid), description));
  const indented = body.split('\n').map(l => (l.length ? bodyIndent + l : l));
  return [
    ...lines.slice(0, loc.headerLine + 1),
    '',
    ...indented,
    ...lines.slice(loc.endLine),
  ].join('\n');
}

// ── Grid-cell containers (a single cell's body holds an ordered component list) ─

/**
 * Reads the component list of the CELL identified by `cellUuid` out of the raw
 * document (any nesting depth). The cell body is dedented by the grid indent and
 * parsed like any container body — its own identity span is stripped by the
 * description extraction, same as tab bodies.
 */
export function readGridCellComponents(md, cellUuid) {
  const lines = (md ?? '').split('\n');
  const loc = locateGridCellByUUID(lines, cellUuid);
  if (!loc) return { description: '', descriptionUuid: null, components: [] };
  const body = lines.slice(loc.openLine + 1, loc.closeLine)
    .map(l => (loc.indent && l.startsWith(loc.indent)) ? l.slice(loc.indent.length) : l)
    .join('\n');
  return parseComponents(body, GUIDE_ADMONITION_TYPES_RE);
}

/** True when the CELL identified by `cellUuid` exists anywhere in the document. */
export function gridCellExists(md, cellUuid) {
  return locateGridCellByUUID((md ?? '').split('\n'), cellUuid) != null;
}

/**
 * Rebuilds the body of the CELL identified by `cellUuid` from a description +
 * ordered component list (via buildComponentBody, which re-embeds the cell's own
 * identity span), re-indents it under the cell, and splices it in. Inverse of
 * readGridCellComponents.
 */
export function writeGridCellBody(md, cellUuid, description, components) {
  const lines = (md ?? '').split('\n');
  const loc = locateGridCellByUUID(lines, cellUuid);
  if (!loc) return md;
  const body = buildComponentBody(cellUuid, description, components, leadUuid(readGridCellComponents(md, cellUuid), description));
  const indented = body.split('\n').map(l => (l.length ? loc.indent + l : l));
  return [
    ...lines.slice(0, loc.openLine + 1),
    '',
    ...indented,
    '',
    ...lines.slice(loc.closeLine),
  ].join('\n');
}

/**
 * Returns `components` reordered to match the `order` UUID sequence. UUIDs in
 * `order` not present in `components` are ignored; components whose UUID is not
 * in `order` are appended in their original relative order (safety net).
 */
export function reorderComponents(components, order) {
  const byUuid = new Map(components.map(c => [uuidOfComponent(c), c]));
  const out = [];
  for (const u of order) { const c = byUuid.get(u); if (c) { out.push(c); byUuid.delete(u); } }
  for (const c of components) { if (byUuid.has(uuidOfComponent(c))) out.push(c); }
  return out;
}
