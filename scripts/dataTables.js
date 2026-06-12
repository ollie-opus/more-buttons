/**
 * dataTables.js — Pure primitives for parsing, building, and mutating
 * markdown pipe tables ("Data table" components) in markdown strings.
 *
 * A data table is one component: a hidden identity span, then ONE blank line,
 * then the header row, the divider row (which carries per-column alignment),
 * and zero or more body rows:
 *
 *   <span data-uuid="TBL-UUID" style="display:none"></span>
 *
 *   | Method | Description |
 *   | :--- | :--- |
 *   | `GET` | Fetch resource |
 *
 * LEGACY form (tables saved before the blank-line requirement): the span sits
 * on the line immediately before the header with no intervening blank. The
 * legacy form is accepted on read and automatically normalised to the canonical
 * blank-separated form by ensureDataTableUUIDs on the next fetch/push.
 *
 * Cells hold INLINE markdown only (no line breaks / block content); literal
 * pipes are escaped `\|` on build and unescaped on parse. The divider row's
 * column count is canonical — ragged header/body rows are padded/truncated
 * to it (parser lenient, builder strict).
 *
 * Leaf module: must NOT import components.js (which imports this). Mirrors
 * contentTabs.js.
 */

import { generateUUID } from './admonitions.js';

const UUID_SPAN_LINE_RE = /^\s*<span[^>]*data-uuid="([^"]+)"[^>]*><\/span>\s*$/;

// A table line: optional indent, a leading pipe, anything, a trailing pipe.
export const TABLE_ROW_RE = /^(\s*)\|(.*)\|\s*$/;

// One divider cell: optional colons around 1+ dashes (`---`, `:--`, `:-:`, `--:`).
const DIVIDER_CELL_RE = /^:?-+:?$/;

// Container header: admonition or content-tab opener.
const CONTAINER_HEADER_RE = /^(\s*)(?:!!!|\?\?\?\+?|===)\s/;

function lineIndent(line) {
  return (line.match(/^(\s*)/) || ['', ''])[1];
}

/** Re-indents every non-empty line of `block`; blank lines stay bare. */
function reindent(block, indent) {
  if (!indent) return block;
  return block.split('\n').map(l => (l.length ? indent + l : l)).join('\n');
}

/**
 * Splits a `| a | b |` row line into trimmed cell strings, unescaping `\|`.
 * Returns null when `line` isn't a row.
 */
export function splitRowCells(line) {
  const m = line.match(TABLE_ROW_RE);
  if (!m) return null;
  const inner = m[2];
  const cells = [];
  let cur = '';
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '\\' && inner[i + 1] === '|') { cur += '|'; i++; }
    else if (ch === '|') { cells.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

/** True when every cell of a split row is a valid divider cell (`:---:` etc). */
function isDividerCells(cells) {
  return cells != null && cells.length > 0 && cells.every(c => DIVIDER_CELL_RE.test(c));
}

function alignOfDividerCell(cell) {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  return 'left';
}

function dividerCellOf(align) {
  if (align === 'center') return ':---:';
  if (align === 'right') return '---:';
  return ':---';
}

/** Escapes literal pipes so cell text can't break the row grammar. */
function escapeCell(text) {
  return (text ?? '').replace(/\|/g, '\\|');
}

/** Pads/truncates `cells` to exactly `n` entries (parser is lenient). */
function fitCells(cells, n) {
  const out = cells.slice(0, n);
  while (out.length < n) out.push('');
  return out;
}

/**
 * Returns true when a span at `spanLine` in `lines` is owned by a container
 * (admonition or content-tab): walk upward from the span, skipping blank
 * lines, to the nearest non-blank line; if that line matches a container
 * header AND its indent is strictly shorter than the span's indent, the span
 * belongs to that container.
 */
function isContainerOwnedSpan(lines, spanLine) {
  const spanIndent = lineIndent(lines[spanLine]);
  let k = spanLine - 1;
  while (k >= 0 && /^\s*$/.test(lines[k])) k--;
  if (k < 0) return false;
  const m = lines[k].match(CONTAINER_HEADER_RE);
  return m != null && m[1].length < spanIndent.length;
}

/**
 * Locates every pipe table in `markdown` with a linear scan. A table starts
 * where a row line is immediately followed by a divider row at the same
 * indent; consecutive same-indent row lines after the divider are body rows.
 * Tables nested inside admonitions/tabs are returned with their deeper
 * indent, so callers wanting immediate children filter on `indent === ''`.
 *
 * Identity is claimed in two forms:
 *   - LEGACY adjacent form: span on lines[i-1] at the same indent.
 *   - NEW blank-separated form: lines[i-1] blank AND lines[i-2] is a span at
 *     the same indent AND that span is NOT container-owned (i.e. not an
 *     admonition/tab body identity). Exactly one blank is allowed; two or more
 *     means the span is not claimed.
 *
 * @param {string} markdown
 * @returns {Array<{uuid: string|null, indent: string, align: string[], header: string[], rows: string[][], startLine: number, endLine: number}>}
 *   `startLine` includes the identity span line (and blank, in the new form)
 *   when present; `endLine` is exclusive.
 */
export function locateDataTables(markdown) {
  const lines = (markdown ?? '').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const head = lines[i].match(TABLE_ROW_RE);
    if (!head) { i++; continue; }
    const indent = head[1];
    const next = lines[i + 1] != null ? lines[i + 1].match(TABLE_ROW_RE) : null;
    const dividerCells = next && next[1] === indent ? splitRowCells(lines[i + 1]) : null;
    if (!isDividerCells(dividerCells)) { i++; continue; }

    const align = dividerCells.map(alignOfDividerCell);
    const header = fitCells(splitRowCells(lines[i]), align.length);

    // Identity: claim a hidden span as this table's uuid.
    // Accept two forms:
    //   1. LEGACY: span immediately before the header at the same indent.
    //   2. NEW: span two lines before (with exactly one blank between them)
    //      at the same indent, and NOT container-owned.
    let startLine = i;
    let uuid = null;

    if (i > 0) {
      const prevLine = lines[i - 1];
      // Form 1 — legacy adjacent.
      const sm1 = prevLine.match(UUID_SPAN_LINE_RE);
      if (sm1 && lineIndent(prevLine) === indent) {
        uuid = sm1[1];
        startLine = i - 1;
      } else if (/^\s*$/.test(prevLine) && i >= 2) {
        // Form 2 — blank-separated: check exactly one blank (not two or more).
        const prevPrevLine = lines[i - 2];
        const sm2 = prevPrevLine.match(UUID_SPAN_LINE_RE);
        if (sm2 && lineIndent(prevPrevLine) === indent && !isContainerOwnedSpan(lines, i - 2)) {
          // Verify there's not a second blank above the span (two blank separator means not claimed).
          // Only one blank is allowed; the line directly above the span must exist and be non-blank,
          // or the span is at the start of the document. (The check is: lines[i-1] is blank and
          // lines[i-2] is the span — that's already confirmed. We just need to make sure there isn't
          // ANOTHER blank between span and header via the container-owned logic above.)
          uuid = sm2[1];
          startLine = i - 2; // include the span AND the blank in range
        }
      }
    }

    let j = i + 2;
    const rows = [];
    while (j < lines.length) {
      const rm = lines[j].match(TABLE_ROW_RE);
      if (!rm || rm[1] !== indent) break;
      rows.push(fitCells(splitRowCells(lines[j]), align.length));
      j++;
    }

    out.push({ uuid, indent, align, header, rows, startLine, endLine: j });
    i = j;
  }
  return out;
}

/**
 * Builds a complete data-table block (no outer indent) from its parts.
 * Emits the canonical blank-separated format:
 *
 *   <span data-uuid="UUID" style="display:none"></span>
 *
 *   | Header |
 *   | :--- |
 *   | row |
 *
 * Inverse of locateDataTables for a single table. The column count is
 * `align.length`; header/row cells are padded/truncated to it.
 *
 * @param {string} uuid - the table's identity span value.
 * @param {string[]} align - 'left' | 'center' | 'right' per column.
 * @param {string[]} header
 * @param {string[][]} rows
 * @returns {string}
 */
export function buildDataTable(uuid, align, header, rows) {
  const row = cells => '| ' + fitCells(cells, align.length).map(escapeCell).join(' | ') + ' |';
  return [
    `<span data-uuid="${uuid}" style="display:none"></span>`,
    '',
    row(header),
    '| ' + align.map(dividerCellOf).join(' | ') + ' |',
    ...rows.map(row),
  ].join('\n');
}

// ── Locate / replace / delete by UUID ─────────────────────────────────────────

/**
 * Locates the line range [startLine, endLine) of the data table whose identity
 * span carries `uuid`, at any nesting depth in the raw document. Returns null
 * when the uuid isn't a table span (e.g. it's an admonition's or a tab's).
 *
 * Accepts both forms:
 *   - NEW blank-separated: span at spanIdx, blank at spanIdx+1, header at spanIdx+2.
 *   - LEGACY adjacent: span at spanIdx, header at spanIdx+1.
 *
 * @param {string[]} lines
 * @param {string} uuid
 * @returns {{startLine: number, endLine: number, indent: string} | null}
 */
export function locateDataTableByUUID(lines, uuid) {
  const spanIdx = lines.findIndex(l => l.includes(`data-uuid="${uuid}"`));
  if (spanIdx === -1) return null;
  const indent = lineIndent(lines[spanIdx]);

  // Determine header index: accept blank-separated or legacy adjacent.
  let headerIdx = -1;
  const afterSpan = lines[spanIdx + 1];
  if (afterSpan != null && /^\s*$/.test(afterSpan)) {
    // Potential blank-separated form.
    const afterBlank = lines[spanIdx + 2];
    if (afterBlank != null) {
      const hm = afterBlank.match(TABLE_ROW_RE);
      if (hm && hm[1] === indent) headerIdx = spanIdx + 2;
    }
  }
  if (headerIdx === -1) {
    // Try legacy adjacent form.
    const hm = afterSpan != null ? afterSpan.match(TABLE_ROW_RE) : null;
    if (hm && hm[1] === indent) headerIdx = spanIdx + 1;
  }
  if (headerIdx === -1) return null;

  // Divider must follow the header.
  const divLine = lines[headerIdx + 1];
  const div = divLine != null ? divLine.match(TABLE_ROW_RE) : null;
  if (!div || div[1] !== indent || !isDividerCells(splitRowCells(divLine))) return null;

  let endLine = headerIdx + 2;
  while (endLine < lines.length) {
    const rm = lines[endLine].match(TABLE_ROW_RE);
    if (!rm || rm[1] !== indent) break;
    endLine++;
  }
  return { startLine: spanIdx, endLine, indent };
}

/**
 * Parses the table identified by `uuid` out of the raw document (any nesting
 * depth) into `{ uuid, align, header, rows, indent }` with dedented cells,
 * or null.
 */
export function getDataTableByUUID(markdown, uuid) {
  const lines = (markdown ?? '').split('\n');
  const loc = locateDataTableByUUID(lines, uuid);
  if (!loc) return null;
  const block = lines.slice(loc.startLine, loc.endLine)
    .map(l => (loc.indent && l.startsWith(loc.indent)) ? l.slice(loc.indent.length) : l)
    .join('\n');
  const [t] = locateDataTables(block);
  return t ? { uuid: t.uuid ?? uuid, align: t.align, header: t.header, rows: t.rows, indent: loc.indent } : null;
}

/**
 * Replaces the data table identified by `uuid` with `newBlock` (provided
 * WITHOUT outer indent; re-indented here to match the original table).
 */
export function replaceDataTableByUUID(markdown, uuid, newBlock) {
  const lines = markdown.split('\n');
  const loc = locateDataTableByUUID(lines, uuid);
  if (!loc) return markdown;
  return [
    ...lines.slice(0, loc.startLine),
    ...reindent(newBlock, loc.indent).split('\n'),
    ...lines.slice(loc.endLine),
  ].join('\n');
}

/**
 * Deletes the data table identified by `uuid`, plus one trailing blank line
 * if present (mirrors deleteTabGroupByUUID).
 */
export function deleteDataTableByUUID(markdown, uuid) {
  const lines = markdown.split('\n');
  const loc = locateDataTableByUUID(lines, uuid);
  if (!loc) return markdown;
  let trailingEnd = loc.endLine;
  if (trailingEnd < lines.length && lines[trailingEnd] === '') trailingEnd++;
  return [...lines.slice(0, loc.startLine), ...lines.slice(trailingEnd)].join('\n');
}

// ── UUID injection ────────────────────────────────────────────────────────────

/**
 * Backfills an identity span (and blank line) before every table that lacks
 * one, and normalises legacy-adjacent tables (span immediately before header,
 * no blank) to the canonical blank-separated form. Idempotent: a
 * fully-migrated document is returned unchanged, byte-for-byte (same
 * reference). Reverse-order splice keeps earlier line indices valid.
 *
 * Canonical format after this pass:
 *
 *   <span data-uuid="UUID" style="display:none"></span>
 *
 *   | Header |
 *   | :--- |
 *
 * Legacy form accepted on read:
 *
 *   <span data-uuid="UUID" style="display:none"></span>
 *   | Header |
 *   | :--- |
 *
 * NOTE: in github.js' migrateComponentIdentity this must run AFTER
 * ensureTabUUIDs — a table span injected as a tab's first body line would
 * otherwise be misread as the tab's own identity (same rule as captures).
 *
 * @param {string} markdown
 * @returns {string}
 */
export function ensureDataTableUUIDs(markdown) {
  const tables = locateDataTables(markdown);
  if (tables.length === 0) return markdown;
  const lines = (markdown ?? '').split('\n');
  let modified = false;
  for (let k = tables.length - 1; k >= 0; k--) {
    const t = tables[k];
    if (t.uuid === null) {
      // Backfill: insert span line AND blank line before the header.
      // Idempotency guard for the nested case: if a UUID span already sits at
      // startLine-2 (with a blank at startLine-1) and that span is NOT container-owned,
      // it was inserted by a previous pass of this function and we must not insert again.
      // If the span IS container-owned (e.g. a tab/admonition body span), we still need
      // to insert a new table span before the header.
      const spanAboveIdx = t.startLine - 2;
      const alreadyHasNonContainerSpanAbove = t.startLine >= 2 &&
        /^\s*$/.test(lines[t.startLine - 1]) &&
        UUID_SPAN_LINE_RE.test(lines[spanAboveIdx]) &&
        lineIndent(lines[spanAboveIdx]) === t.indent &&
        !isContainerOwnedSpan(lines, spanAboveIdx);
      if (!alreadyHasNonContainerSpanAbove) {
        lines.splice(t.startLine, 0,
          `${t.indent}<span data-uuid="${generateUUID()}" style="display:none"></span>`,
          '',
        );
        modified = true;
      }
    } else {
      // Check for legacy adjacent form: span at startLine, header immediately after.
      // Detect by checking the line after startLine is a table row (no blank between).
      const lineAfterSpan = lines[t.startLine + 1];
      if (lineAfterSpan != null && TABLE_ROW_RE.test(lineAfterSpan)) {
        // Insert a blank line between the span and the header.
        lines.splice(t.startLine + 1, 0, '');
        modified = true;
      }
    }
  }
  return modified ? lines.join('\n') : markdown;
}
