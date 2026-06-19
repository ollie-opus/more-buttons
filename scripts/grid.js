/**
 * grid.js — Pure primitives for parsing, building, and mutating Zensical grid
 * blocks (`<div class="grid" markdown>` … `</div>`) in markdown strings.
 *
 * A grid is one component: an optional hidden identity span on the line
 * immediately before the wrapper, then N CELL divs, then a closing `</div>`.
 * Each cell is `<div class="card" markdown>` (card flavor) or `<div markdown>`
 * (generic flavor) and is itself a component container — its body begins with
 * its own identity span (admonition-style), so admonitions / captures / content
 * tabs / data tables / nested grids can live inside a cell.
 *
 * Flavor ('card' | 'generic') is uniform across a grid, carried by the cells'
 * `class="card"`. Cell content lives inside `<div markdown>` (md_in_html), so it
 * is NOT extra-indented — nesting is tracked by `<div>` DEPTH, not indentation.
 * The grid block as a whole is still indent-aware (a grid nested inside an
 * admonition/tab is reindented), mirroring contentTabs.js / dataTables.js.
 *
 * Leaf module: must NOT import components.js (which imports this) — cell bodies
 * are opaque strings here.
 */

import { generateUUID } from './admonitions.js';

export const GRID_OPEN_RE = /^(\s*)<div class="grid" markdown>\s*$/;
// A cell opener: `<div class="…" markdown>` or `<div markdown>`. group2 is the
// full class string (e.g. "card", "spill", "card spill") or undefined; flavor and
// the per-cell "spill" flag are derived from its space-separated tokens.
const CELL_OPEN_RE = /^(\s*)<div(?: class="([^"]*)")? markdown>\s*$/;
// Any div opener (depth counting inside cell bodies / nested grids).
const DIV_OPEN_ANY_RE = /^\s*<div(?:\s|>)/;
const DIV_CLOSE_RE = /^\s*<\/div>\s*$/;
const UUID_SPAN_LINE_RE = /^\s*<span[^>]*data-uuid="([^"]+)"[^>]*><\/span>\s*$/;
const TAB_HEADER_RE = /^\s*=== "/;

function lineIndent(line) {
  return (line.match(/^(\s*)/) || ['', ''])[1];
}

/** Re-indents every non-empty line of `block`; blank lines stay bare. */
function reindent(block, indent) {
  if (!indent) return block;
  return block.split('\n').map(l => (l.length ? indent + l : l)).join('\n');
}

/**
 * The cell's own identity span, read from the first non-blank line of its
 * (dedented) body. A span whose next non-blank line is a nested grid wrapper or
 * a `=== "` tab header is a nested container's identity, not this cell's —
 * returns null so migration still backfills the cell's own span.
 */
function getCellBodyUUID(body) {
  const lines = (body ?? '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '') continue;
    const m = lines[i].match(UUID_SPAN_LINE_RE);
    if (!m) return null;
    let j = i + 1;
    while (j < lines.length && lines[j] === '') j++;
    const nxt = j < lines.length ? lines[j] : '';
    if (GRID_OPEN_RE.test(nxt) || TAB_HEADER_RE.test(nxt)) return null;
    return m[1];
  }
  return null;
}

/** Prepends a cell's identity span as the first body line, then a blank line. */
function injectCellUUID(body, uuid) {
  const span = `<span data-uuid="${uuid}" style="display:none"></span>`;
  return body.length ? `${span}\n\n${body}` : span;
}

/**
 * Locates every grid in `markdown` with a linear, non-recursive scan (mirrors
 * locateTabGroups: grids nested inside another grid's cell are consumed as cell
 * body lines and NOT returned — recurse into cell bodies to reach them). Grids
 * nested inside admonitions/tabs are returned with their deeper indent, so
 * callers wanting immediate children filter on `indent === ''`.
 *
 * @returns {Array<{uuid: string|null, flavor: 'card'|'generic', indent: string,
 *   cells: Array<{uuid: string|null, body: string, spill: boolean}>, startLine: number, endLine: number}>}
 *   `body` is dedented by the grid indent, blank-trimmed; `startLine` includes
 *   the grid span when present; `endLine` is exclusive.
 */
export function locateGrids(markdown) {
  const lines = (markdown ?? '').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const open = lines[i].match(GRID_OPEN_RE);
    if (!open) { i++; continue; }
    const indent = open[1];

    let startLine = i;
    let uuid = null;
    if (i > 0) {
      const sm = lines[i - 1].match(UUID_SPAN_LINE_RE);
      if (sm && lineIndent(lines[i - 1]) === indent) { uuid = sm[1]; startLine = i - 1; }
    }

    const cells = [];
    let flavor = 'generic';
    let depth = 1;             // inside the wrapper div
    let j = i + 1;
    let cellStart = -1;        // first line after a cell's open div, or -1
    let cellSpill = false;     // the open cell's "spill" class, applied on close
    while (j < lines.length && depth > 0) {
      const line = lines[j];
      const isClose = DIV_CLOSE_RE.test(line);
      const cm = (!isClose && depth === 1) ? line.match(CELL_OPEN_RE) : null;
      if (cm && cm[1] === indent) {
        const classes = cm[2] ? cm[2].split(/\s+/) : [];
        if (classes.includes('card')) flavor = 'card';
        cellSpill = classes.includes('spill');
        cellStart = j + 1;
        depth++;               // entered the cell div
        j++;
        continue;
      }
      if (isClose) {
        depth--;
        if (depth === 1 && cellStart >= 0) {
          const raw = lines.slice(cellStart, j)
            .map(l => (indent && l.startsWith(indent)) ? l.slice(indent.length) : l);
          while (raw.length && raw[0] === '') raw.shift();
          while (raw.length && raw[raw.length - 1] === '') raw.pop();
          const body = raw.join('\n');
          cells.push({ uuid: getCellBodyUUID(body), body, spill: cellSpill });
          cellStart = -1;
          cellSpill = false;
        }
        j++;
        continue;
      }
      if (DIV_OPEN_ANY_RE.test(line)) depth++;
      j++;
    }

    out.push({ uuid, flavor, indent, cells, startLine, endLine: j });
    i = j;
  }
  return out;
}

/**
 * A cell's opening `<div … markdown>` tag. The class list carries `card` (from
 * the grid's flavor) and/or `spill` (the per-cell "allow spill" flag); a generic,
 * non-spill cell has no class attribute at all.
 */
function cellOpenTag(flavor, spill) {
  const classes = [];
  if (flavor === 'card') classes.push('card');
  if (spill) classes.push('spill');
  return `<div${classes.length ? ` class="${classes.join(' ')}"` : ''} markdown>`;
}

/**
 * Builds a complete grid block (no outer indent) from its parts. Inverse of
 * locateGrids for a single grid. Cell bodies are provided WITH their own
 * identity span as the first line (callers build them via
 * components.js' buildComponentBody).
 *
 * @param {string} uuid - the grid's identity span value.
 * @param {'card'|'generic'} flavor
 * @param {Array<{body: string, spill?: boolean}>} cells
 * @returns {string}
 */
export function buildGrid(uuid, flavor, cells) {
  const lines = [
    `<span data-uuid="${uuid}" style="display:none"></span>`,
    '<div class="grid" markdown>',
  ];
  for (const c of cells) {
    lines.push('');
    lines.push(cellOpenTag(flavor, c.spill));
    lines.push('');
    const body = (c.body ?? '').replace(/^\n+/, '').replace(/\n+$/, '');
    if (body.length) lines.push(body);
    lines.push('');
    lines.push('</div>');
  }
  lines.push('');
  lines.push('</div>');
  return lines.join('\n');
}

// ── Locate / replace / delete by UUID ─────────────────────────────────────────

/**
 * Locates the line range [startLine, endLine) of the GRID whose identity span
 * carries `uuid`, at any nesting depth. Returns null when the uuid isn't a grid
 * span (e.g. it's a cell's own span). A grid span is immediately followed by the
 * `<div class="grid" markdown>` wrapper at the same indent.
 */
export function locateGridByUUID(lines, uuid) {
  const spanIdx = lines.findIndex(l => l.includes(`data-uuid="${uuid}"`));
  if (spanIdx === -1) return null;
  const indent = lineIndent(lines[spanIdx]);
  const openLine = lines[spanIdx + 1];
  const om = openLine != null ? openLine.match(GRID_OPEN_RE) : null;
  if (!om || om[1] !== indent) return null;

  let depth = 1;
  let j = spanIdx + 2;
  for (; j < lines.length; j++) {
    if (DIV_OPEN_ANY_RE.test(lines[j])) depth++;
    else if (DIV_CLOSE_RE.test(lines[j])) { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) return null;
  return { startLine: spanIdx, endLine: j + 1, indent };
}

/**
 * Parses the grid identified by `uuid` out of the raw document (any nesting
 * depth) into `{ uuid, flavor, cells, indent }` with dedented cell bodies, or null.
 */
export function getGridByUUID(markdown, uuid) {
  const lines = (markdown ?? '').split('\n');
  const loc = locateGridByUUID(lines, uuid);
  if (!loc) return null;
  const block = lines.slice(loc.startLine, loc.endLine)
    .map(l => (loc.indent && l.startsWith(loc.indent)) ? l.slice(loc.indent.length) : l)
    .join('\n');
  const [g] = locateGrids(block);
  return g ? { uuid: g.uuid ?? uuid, flavor: g.flavor, cells: g.cells, indent: loc.indent } : null;
}

/**
 * Replaces the grid identified by `uuid` with `newBlock` (provided WITHOUT outer
 * indent; re-indented here to match the original grid).
 */
export function replaceGridByUUID(markdown, uuid, newBlock) {
  const lines = markdown.split('\n');
  const loc = locateGridByUUID(lines, uuid);
  if (!loc) return markdown;
  return [
    ...lines.slice(0, loc.startLine),
    ...reindent(newBlock, loc.indent).split('\n'),
    ...lines.slice(loc.endLine),
  ].join('\n');
}

/** Deletes the grid identified by `uuid`, plus one trailing blank line if present. */
export function deleteGridByUUID(markdown, uuid) {
  const lines = markdown.split('\n');
  const loc = locateGridByUUID(lines, uuid);
  if (!loc) return markdown;
  let trailingEnd = loc.endLine;
  if (trailingEnd < lines.length && lines[trailingEnd] === '') trailingEnd++;
  return [...lines.slice(0, loc.startLine), ...lines.slice(trailingEnd)].join('\n');
}

/**
 * Locates the single CELL whose own identity span carries `uuid`. The span must
 * be the first non-blank body line under its cell `<div … markdown>` open (walk
 * UP skipping blanks to the open, DOWN by <div> depth for the close).
 *
 * @returns {{openLine: number, closeLine: number, indent: string} | null}
 *   `closeLine` is the cell's `</div>` line; body is (openLine, closeLine).
 */
export function locateGridCellByUUID(lines, uuid) {
  const spanIdx = lines.findIndex(l => l.includes(`data-uuid="${uuid}"`));
  if (spanIdx === -1) return null;
  let h = spanIdx - 1;
  while (h >= 0 && lines[h] === '') h--;
  const cm = h >= 0 ? lines[h].match(CELL_OPEN_RE) : null;
  if (!cm) return null;
  const indent = cm[1];

  let depth = 1;
  let j = h + 1;
  for (; j < lines.length; j++) {
    if (DIV_OPEN_ANY_RE.test(lines[j])) depth++;
    else if (DIV_CLOSE_RE.test(lines[j])) { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) return null;
  return { openLine: h, closeLine: j, indent };
}

// ── UUID injection ────────────────────────────────────────────────────────────

/**
 * Ensures every grid has a grid identity span and every cell its own body span —
 * at every nesting depth (recurses into cell bodies for grids nested inside
 * cells; grids nested inside admonitions/tabs are reached by the linear scan at
 * their deeper indent). Idempotent (a fully-migrated document returns the same
 * reference). Reverse-order splice keeps earlier line indices valid. Mirrors
 * ensureTabUUIDs.
 *
 * NOTE: in github.js' migrateComponentIdentity this must run AFTER ensureTabUUIDs
 * and BEFORE ensureDataTableUUIDs / ensureCaptureUUIDs.
 */
export function ensureGridUUIDs(markdown) {
  const grids = locateGrids(markdown);
  if (grids.length === 0) return markdown;

  let result = markdown.split('\n');
  let modified = false;
  for (let k = grids.length - 1; k >= 0; k--) {
    const g = grids[k];
    let changed = g.uuid === null;
    const cells = g.cells.map(c => {
      let body = ensureGridUUIDs(c.body); // recurse for nested grids
      let uuid = c.uuid;
      if (!uuid) { uuid = generateUUID(); body = injectCellUUID(body, uuid); }
      if (uuid !== c.uuid || body !== c.body) changed = true;
      return { uuid, body, spill: c.spill };
    });
    if (!changed) continue;

    const newBlock = buildGrid(g.uuid ?? generateUUID(), g.flavor, cells);
    result = [
      ...result.slice(0, g.startLine),
      ...reindent(newBlock, g.indent).split('\n'),
      ...result.slice(g.endLine),
    ];
    modified = true;
  }
  return modified ? result.join('\n') : markdown;
}
