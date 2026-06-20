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

import { parseAdmonitions, buildAdmonition, generateUUID, GUIDE_ADMONITION_TYPES_RE, ensureAdmonitionUUIDs } from './admonitions.js';
import { buildSectionUUIDSpan } from './sections.js';
import { buildCaptureLines } from './captures.js';
import { buildVideoLines } from './videos.js';
import { locateTabGroups, buildTabGroup, locateTabByUUID, ensureTabUUIDs } from './contentTabs.js';
import { locateDataTables, buildDataTable, ensureDataTableUUIDs } from './dataTables.js';
import { locateGrids, buildGrid, ensureGridUUIDs, locateGridCellByUUID } from './grid.js';

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
const UUID_SPAN_RE = /<span[^>]*data-uuid[^>]*><\/span>\n?/g;
const UUID_SPAN_LINE_RE = /^\s*<span[^>]*data-uuid="([^"]+)"[^>]*><\/span>\s*$/;
// Whole-line variant: removes an own-line uuid span INCLUDING its indent and
// newline, so nested (indented) spans vanish without leaving indent residue —
// UUID_SPAN_RE alone would merge the leftover indent into the following line.
const UUID_SPAN_FULL_LINE_RE = /^[ \t]*<span[^>]*data-uuid[^>]*><\/span>[ \t]*\r?\n?/gm;

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
export function parseComponents(body, typeRegex, { skipTabBlocks = true } = {}) {
  const src = body ?? '';

  // Immediate-child admonitions (indent 0 within this dedented body).
  // skipTabBlocks keeps admonitions buried inside tab groups out of this list.
  const adms = parseAdmonitions(src, typeRegex, { skipTabBlocks })
    .filter(a => a.indent === '');
  const admRanges = adms.map(a => [a.headerLine, a.endLine]);

  // Immediate-child grids (indent 0). Grid cells hold their own components at
  // indent 0 (md_in_html does not indent), so grids must be located first and
  // their ranges used to exclude grid-internal admonitions/tabs/tables/captures.
  const grids = locateGrids(src)
    .filter(g => g.indent === '' && !inAnyRange(g.startLine, admRanges));
  const gridRanges = grids.map(g => [g.startLine, g.endLine]);
  const inContainer = (line) => inAnyRange(line, admRanges) || inAnyRange(line, gridRanges);

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

  // Immediate-child data tables (indent 0; tables inside admonitions/grids excluded).
  const tbls = locateDataTables(src)
    .filter(t => t.indent === '' && !inContainer(t.startLine));

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
      tbl: { uuid: t.uuid ?? null, align: t.align, header: t.header, rows: t.rows },
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
  ].sort((a, b) => a.startLine - b.startLine);

  const description = extractDescription(src, items);

  // Strip the internal line bookkeeping before handing components back.
  const components = items.map(it => {
    if (it.kind === 'admonition') return { kind: 'admonition', adm: it.adm };
    if (it.kind === 'tabs') return { kind: 'tabs', grp: it.grp };
    if (it.kind === 'table') return { kind: 'table', tbl: it.tbl };
    if (it.kind === 'grid') return { kind: 'grid', grid: it.grid };
    if (it.kind === 'video') return { kind: 'video', vid: it.vid };
    return { kind: 'capture', cap: it.cap };
  });

  return { description, components };
}

/**
 * Returns the leading description text of `body` — everything that isn't part of
 * a component block. Mirrors splitSectionBody's removal logic.
 */
function extractDescription(body, items) {
  const lines = body.split('\n');
  const removed = items.map(it => ({ start: it.startLine, end: it.endLine }));
  removed.sort((a, b) => b.start - a.start); // descending so splices stay valid
  let descLines = lines.slice();
  for (const { start, end } of removed) {
    let extEnd = end;
    if (descLines[extEnd] === '') extEnd++; // eat one trailing blank
    descLines.splice(start, extEnd - start);
  }
  let desc = descLines.join('\n');
  desc = desc.replace(UUID_SPAN_RE, ''); // drop the admonition/section UUID span
  return desc.trim();
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
 * @param {Array} components - `{kind:'admonition', adm}` | `{kind:'capture', cap}`
 * @returns {string}
 */
export function buildComponentBody(uuid, description, components) {
  const lines = [];
  if (uuid) lines.push(buildSectionUUIDSpan(uuid));
  const desc = (description ?? '').trim();
  if (desc.length) lines.push(desc);

  for (const c of components) {
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
      lines.push(buildDataTable(c.tbl.uuid, c.tbl.align, c.tbl.header, c.tbl.rows));
    } else if (c.kind === 'grid') {
      lines.push(buildGrid(c.grid.uuid, c.grid.flavor, c.grid.cells));
    } else if (c.kind === 'video') {
      // buildVideoLines emits a leading '' we don't want (we add our own).
      lines.push(...buildVideoLines([c.vid]).slice(1));
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

/** Builds an admonition component from a parsed admonition entry. */
export function admonitionComponent(adm) {
  return { kind: 'admonition', adm };
}

/** The stable UUID of a component (admonition, capture, video, tab group, or data table). */
export function uuidOfComponent(c) {
  if (c.kind === 'admonition') return c.adm.uuid;
  if (c.kind === 'tabs') return c.grp.uuid;
  if (c.kind === 'table') return c.tbl.uuid;
  if (c.kind === 'grid') return c.grid.uuid;
  if (c.kind === 'video') return c.vid.uuid;
  return c.cap.uuid;
}

/** Removes every own-line `data-uuid` identity span (any indent) from `markdown`. */
export function stripUUIDSpans(markdown) {
  return (markdown ?? '').replace(UUID_SPAN_FULL_LINE_RE, '');
}

/**
 * The full markdown of one component (including all nested subcomponents),
 * with every identity span stripped — the Copy-to-clipboard payload.
 */
export function componentMarkdown(component) {
  return stripUUIDSpans(buildComponentBody(null, '', [component]))
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
  const stripped = stripUUIDSpans(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!stripped) return { components: null, error: 'Nothing to insert — paste component markdown first.' };
  const withUuids = ensureVideoUUIDs(ensureCaptureUUIDs(ensureDataTableUUIDs(ensureGridUUIDs(ensureTabUUIDs(ensureAdmonitionUUIDs(stripped, GUIDE_ADMONITION_TYPES_RE))))));
  const { description, components } = parseComponents(withUuids, GUIDE_ADMONITION_TYPES_RE);
  if (components.length === 0) {
    return { components: null, error: 'No components recognised. Paste markdown copied from a component (admonition, capture, content tabs, data table or grid).' };
  }
  if (description.trim() !== '') {
    return { components: null, error: 'The pasted markdown contains text outside of component blocks, so it can\'t be inserted.' };
  }
  return { components, error: null };
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
  if (!loc) return { description: '', components: [] };
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
  const body = buildComponentBody(tabUuid, description, components);
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
  if (!loc) return { description: '', components: [] };
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
  const body = buildComponentBody(cellUuid, description, components);
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
