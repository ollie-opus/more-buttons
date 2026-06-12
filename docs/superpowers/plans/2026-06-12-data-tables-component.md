# Data Tables Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development — the user chose subagent-driven execution (fresh subagent per task, review between tasks). Steps use checkbox (`- [ ]`) syntax for tracking; check them off as you go.

**Goal:** Add a 4th component kind, "Data table" (markdown pipe table with per-column alignment and rich-text-editable cells), alongside admonitions, captures, and content tabs.

**Architecture:** A new pure leaf module `scripts/dataTables.js` (mirrors `contentTabs.js`) parses/builds pipe tables identified by a hidden UUID span on the line before the header row. `scripts/dataTablesEditor.js` + `config/forms/editDataTable.html` provide a grid-with-shared-cell-editor form. The rich text editor gains an opt-in inline mode (no lists, no line breaks) for cells. Tables are NOT component containers — strictly simpler than content tabs (no save-gate registration, no child component lists).

**Tech Stack:** Vanilla JS Chrome extension (ES modules), node:assert test files run directly with `node`, no build step.

**Spec:** `docs/superpowers/specs/2026-06-12-data-tables-component-design.md`

**Naming note (deviation from spec):** the form/file/actions use the SINGULAR `editDataTable` (`config/forms/editDataTable.html`, `openCreateDataTable`, `openEditDataTable`, `submitEditDataTable`, `deleteDataTable`, storage key `moreButtonsEditDataTable`) — one form edits one table, matching `editGuideAdmonition`/`editCaptureComponent`. The component kind string is `'table'`, payload key `tbl` (like `'tabs'`/`grp`).

**Zensical repo:** already done by the user — `[project.markdown_extensions.tables]` enabled, tablesort wired with the activation snippet at `docs/assets/javascripts/tablesort.js`. Nothing to do on that side.

**Working tree:** clean at plan time (the nested-lists rich editor work is committed as `60449d8`). Commit ONLY the files each task names (explicit `git add <paths>`, never `git add -A`).

---

### Task 1: `scripts/dataTables.js` — pure parse/build/mutate leaf module

**Files:**
- Create: `scripts/dataTables.js`
- Test: `tests/dataTables.test.mjs`

- [ ] **Step 1: Write the failing test file**

Create `tests/dataTables.test.mjs`:

```js
import assert from 'node:assert/strict';
import {
  locateDataTables, buildDataTable, splitRowCells, getDataTableByUUID,
  locateDataTableByUUID, replaceDataTableByUUID, deleteDataTableByUUID,
  ensureDataTableUUIDs,
} from '../scripts/dataTables.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const span = (uuid, indent = '') => `${indent}<span data-uuid="${uuid}" style="display:none"></span>`;

// A canonical 2×2 table, fully migrated.
const TABLE_MD = [
  span('TBL'),
  '| Method | Description |',
  '| :--- | :---: |',
  '| `GET` | Fetch resource |',
  '| `PUT` | Update resource |',
].join('\n');

// ── splitRowCells ─────────────────────────────────────────────────────────────

test('splitRowCells: trims cells and unescapes \\|', () => {
  assert.deepEqual(splitRowCells('| a | b \\| c |'), ['a', 'b | c']);
});

test('splitRowCells: non-row line returns null', () => {
  assert.equal(splitRowCells('not a row'), null);
});

// ── locateDataTables ──────────────────────────────────────────────────────────

test('locateDataTables: span, alignment, header, rows, line range', () => {
  const [t] = locateDataTables(TABLE_MD);
  assert.equal(t.uuid, 'TBL');
  assert.equal(t.indent, '');
  assert.equal(t.startLine, 0);
  assert.equal(t.endLine, 5);
  assert.deepEqual(t.align, ['left', 'center']);
  assert.deepEqual(t.header, ['Method', 'Description']);
  assert.deepEqual(t.rows, [['`GET`', 'Fetch resource'], ['`PUT`', 'Update resource']]);
});

test('locateDataTables: table without identity span has uuid=null, startLine on the header', () => {
  const md = ['| A |', '| --- |', '| x |'].join('\n');
  const [t] = locateDataTables(md);
  assert.equal(t.uuid, null);
  assert.equal(t.startLine, 0);
  assert.deepEqual(t.align, ['left']);
});

test('locateDataTables: right alignment and bare dashes parse', () => {
  const md = ['| A | B | C |', '| --- | ---: | :-: |', '| 1 | 2 | 3 |'].join('\n');
  const [t] = locateDataTables(md);
  assert.deepEqual(t.align, ['left', 'right', 'center']);
});

test('locateDataTables: pipe lines without a divider row are NOT a table', () => {
  const md = ['| just | text |', '| more | text |'].join('\n');
  assert.equal(locateDataTables(md).length, 0);
});

test('locateDataTables: indented table (inside an admonition) keeps its indent', () => {
  const md = ['!!! note', '', '    | A |', '    | --- |', '    | x |'].join('\n');
  const [t] = locateDataTables(md);
  assert.equal(t.indent, '    ');
  assert.deepEqual(t.rows, [['x']]);
});

test('locateDataTables: ragged rows are padded/truncated to the divider width', () => {
  const md = ['| A | B |', '| --- | --- |', '| 1 |', '| 1 | 2 | 3 |'].join('\n');
  const [t] = locateDataTables(md);
  assert.deepEqual(t.rows, [['1', ''], ['1', '2']]);
});

test('locateDataTables: a span at a different indent is not the table identity', () => {
  const md = [span('X', '  '), '| A |', '| --- |'].join('\n');
  const [t] = locateDataTables(md);
  assert.equal(t.uuid, null);
});

// ── buildDataTable ────────────────────────────────────────────────────────────

test('buildDataTable: round-trips through locateDataTables', () => {
  const block = buildDataTable('TBL', ['left', 'center'], ['Method', 'Description'],
    [['`GET`', 'Fetch resource'], ['`PUT`', 'Update resource']]);
  const [t] = locateDataTables(block);
  assert.equal(t.uuid, 'TBL');
  assert.deepEqual(t.align, ['left', 'center']);
  assert.deepEqual(t.header, ['Method', 'Description']);
  assert.deepEqual(t.rows, [['`GET`', 'Fetch resource'], ['`PUT`', 'Update resource']]);
});

test('buildDataTable: escapes literal pipes so they round-trip', () => {
  const block = buildDataTable('U', ['left'], ['a | b'], [['c | d']]);
  const [t] = locateDataTables(block);
  assert.deepEqual(t.header, ['a | b']);
  assert.deepEqual(t.rows, [['c | d']]);
});

test('buildDataTable: emits explicit-left divider and pads cells to align width', () => {
  const block = buildDataTable('U', ['left', 'right'], ['A'], [['1', '2', 'extra']]);
  assert.equal(block.split('\n')[2], '| :--- | ---: |');
  const [t] = locateDataTables(block);
  assert.deepEqual(t.header, ['A', '']);
  assert.deepEqual(t.rows, [['1', '2']]);
});

// ── locate/get/replace/delete by UUID ────────────────────────────────────────

const DOC = ['# Title', '', 'Intro.', '', TABLE_MD, '', 'After.'].join('\n');

test('locateDataTableByUUID: finds range at top level', () => {
  const loc = locateDataTableByUUID(DOC.split('\n'), 'TBL');
  assert.deepEqual(loc, { startLine: 4, endLine: 9, indent: '' });
});

test('locateDataTableByUUID: a non-table span returns null', () => {
  const md = [span('S'), 'plain text'].join('\n');
  assert.equal(locateDataTableByUUID(md.split('\n'), 'S'), null);
});

test('getDataTableByUUID: parses an indented (nested) table dedented', () => {
  const md = ['!!! note', '', span('N', '    '), '    | A |', '    | --- |', '    | x |'].join('\n');
  const t = getDataTableByUUID(md, 'N');
  assert.equal(t.uuid, 'N');
  assert.equal(t.indent, '    ');
  assert.deepEqual(t.rows, [['x']]);
});

test('replaceDataTableByUUID: swaps the block, re-indenting to match', () => {
  const md = ['!!! note', '', span('N', '    '), '    | A |', '    | --- |', '    | x |'].join('\n');
  const out = replaceDataTableByUUID(md, 'N', buildDataTable('N', ['left'], ['B'], [['y']]));
  const t = getDataTableByUUID(out, 'N');
  assert.deepEqual(t.header, ['B']);
  assert.deepEqual(t.rows, [['y']]);
  assert.ok(out.split('\n')[3].startsWith('    |'));
});

test('replaceDataTableByUUID: unknown uuid is a no-op', () => {
  assert.equal(replaceDataTableByUUID(DOC, 'NOPE', 'x'), DOC);
});

test('deleteDataTableByUUID: removes the block plus one trailing blank', () => {
  const out = deleteDataTableByUUID(DOC, 'TBL');
  assert.equal(out, ['# Title', '', 'Intro.', '', 'After.'].join('\n'));
});

// ── ensureDataTableUUIDs ──────────────────────────────────────────────────────

test('ensureDataTableUUIDs: backfills a span before a bare table; idempotent', () => {
  const md = ['Intro.', '', '| A |', '| --- |', '| x |'].join('\n');
  const out = ensureDataTableUUIDs(md);
  const [t] = locateDataTables(out);
  assert.ok(t.uuid, 'uuid backfilled');
  assert.equal(ensureDataTableUUIDs(out), out, 'second pass is byte-identical');
});

test('ensureDataTableUUIDs: migrated document returns the same reference', () => {
  assert.equal(ensureDataTableUUIDs(TABLE_MD), TABLE_MD);
});

test('ensureDataTableUUIDs: backfills nested (indented) tables too', () => {
  const md = ['!!! note', '', '    | A |', '    | --- |', '    | x |'].join('\n');
  const out = ensureDataTableUUIDs(md);
  const [t] = locateDataTables(out);
  assert.ok(t.uuid);
  assert.equal(t.indent, '    ');
});

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/dataTables.test.mjs`
Expected: FAIL — `Cannot find module '.../scripts/dataTables.js'`

- [ ] **Step 3: Write the implementation**

Create `scripts/dataTables.js`:

```js
/**
 * dataTables.js — Pure primitives for parsing, building, and mutating
 * markdown pipe tables ("Data table" components) in markdown strings.
 *
 * A data table is one component: an optional hidden identity span on the line
 * immediately before the header row (capture-style identity), then the header
 * row, the divider row (which carries per-column alignment), and zero or more
 * body rows:
 *
 *   <span data-uuid="TBL-UUID" style="display:none"></span>
 *   | Method | Description |
 *   | :--- | :--- |
 *   | `GET` | Fetch resource |
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
 * Locates every pipe table in `markdown` with a linear scan. A table starts
 * where a row line is immediately followed by a divider row at the same
 * indent; consecutive same-indent row lines after the divider are body rows.
 * Tables nested inside admonitions/tabs are returned with their deeper
 * indent, so callers wanting immediate children filter on `indent === ''`.
 *
 * @param {string} markdown
 * @returns {Array<{uuid: string|null, indent: string, align: string[], header: string[], rows: string[][], startLine: number, endLine: number}>}
 *   `startLine` includes the identity span line when present; `endLine` is
 *   exclusive.
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

    // Identity: a hidden span on the line immediately before the header row,
    // at the same indent (capture-style identity).
    let startLine = i;
    let uuid = null;
    if (i > 0) {
      const sm = lines[i - 1].match(UUID_SPAN_LINE_RE);
      if (sm && lineIndent(lines[i - 1]) === indent) { uuid = sm[1]; startLine = i - 1; }
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
 * @param {string[]} lines
 * @param {string} uuid
 * @returns {{startLine: number, endLine: number, indent: string} | null}
 */
export function locateDataTableByUUID(lines, uuid) {
  const spanIdx = lines.findIndex(l => l.includes(`data-uuid="${uuid}"`));
  if (spanIdx === -1) return null;
  const indent = lineIndent(lines[spanIdx]);

  // Table span ⇔ the next line is a header row at the same indent with a
  // valid divider row under it.
  const head = lines[spanIdx + 1] != null ? lines[spanIdx + 1].match(TABLE_ROW_RE) : null;
  if (!head || head[1] !== indent) return null;
  const div = lines[spanIdx + 2] != null ? lines[spanIdx + 2].match(TABLE_ROW_RE) : null;
  if (!div || div[1] !== indent || !isDividerCells(splitRowCells(lines[spanIdx + 2]))) return null;

  let endLine = spanIdx + 3;
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
 * Backfills an identity span before every table that lacks one, at every
 * nesting depth. Idempotent: a fully-migrated document is returned unchanged,
 * byte-for-byte. Reverse-order splice keeps earlier line indices valid.
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
    if (t.uuid) continue; // already migrated
    lines.splice(t.startLine, 0, `${t.indent}<span data-uuid="${generateUUID()}" style="display:none"></span>`);
    modified = true;
  }
  return modified ? lines.join('\n') : markdown;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/dataTables.test.mjs`
Expected: all `ok -` lines, ending `21 passed`

- [ ] **Step 5: Commit**

```bash
git add scripts/dataTables.js tests/dataTables.test.mjs
git commit -m "feat(dataTables): pure pipe-table parse/build/mutate leaf module"
```

---

### Task 2: components.js integration — `kind: 'table'`

**Files:**
- Modify: `scripts/components.js` (import block ~line 24; `parseComponents` ~127-172; `buildComponentBody` ~211-235; `uuidOfComponent` ~260-264; `parsePastedComponents` ~292-304; module header comment ~lines 5-12)
- Test: `tests/dataTables.test.mjs` (append)

- [ ] **Step 1: Append the failing integration tests**

In `tests/dataTables.test.mjs`, add to the imports at the top:

```js
import { parseComponents, buildComponentBody, uuidOfComponent, parsePastedComponents } from '../scripts/components.js';
import { GUIDE_ADMONITION_TYPES_RE } from '../scripts/admonitions.js';
```

and append BEFORE the final `console.log` line:

```js
// ── components.js integration ─────────────────────────────────────────────────

test('parseComponents: tables interleave with admonitions in document order', () => {
  const md = [
    'Section description.',
    '',
    '!!! note "First"',
    '',
    `    ${span('A1')}`,
    '    Note text.',
    '',
    TABLE_MD,
  ].join('\n');
  const { description, components } = parseComponents(md, GUIDE_ADMONITION_TYPES_RE);
  assert.equal(description, 'Section description.');
  assert.deepEqual(components.map(c => c.kind), ['admonition', 'table']);
  assert.equal(components[1].tbl.uuid, 'TBL');
  assert.deepEqual(components[1].tbl.header, ['Method', 'Description']);
});

test('parseComponents: a table nested inside an admonition is NOT a top-level component', () => {
  const nested = [
    '!!! note "Outer"',
    '',
    `    ${span('A1')}`,
    `    ${span('N')}`,
    '    | A |',
    '    | --- |',
    '    | x |',
  ].join('\n');
  const { components } = parseComponents(nested, GUIDE_ADMONITION_TYPES_RE);
  assert.deepEqual(components.map(c => c.kind), ['admonition']);
});

test('buildComponentBody: rebuilds a table component; round-trips', () => {
  const comp = { kind: 'table', tbl: { uuid: 'TBL', align: ['left', 'center'], header: ['Method', 'Description'], rows: [['`GET`', 'Fetch resource'], ['`PUT`', 'Update resource']] } };
  const body = buildComponentBody(null, 'Desc.', [comp]);
  const { description, components } = parseComponents(body, GUIDE_ADMONITION_TYPES_RE);
  assert.equal(description, 'Desc.');
  assert.equal(components[0].kind, 'table');
  assert.deepEqual(components[0].tbl, comp.tbl);
});

test('uuidOfComponent: table branch', () => {
  assert.equal(uuidOfComponent({ kind: 'table', tbl: { uuid: 'TBL' } }), 'TBL');
});

test('parsePastedComponents: a bare pasted table is recognized and gets a fresh uuid', () => {
  const { components, error } = parsePastedComponents('| A | B |\n| --- | --- |\n| 1 | 2 |');
  assert.equal(error, null);
  assert.equal(components.length, 1);
  assert.equal(components[0].kind, 'table');
  assert.ok(components[0].tbl.uuid);
});

```

(The `console.log` summary line must appear exactly once, at the very end of the file — these appends always go before it.)

- [ ] **Step 2: Run the test to verify the new tests fail**

Run: `node tests/dataTables.test.mjs`
Expected: FAIL — first integration test throws (components list lacks the `'table'` entry; `parseComponents` doesn't know tables yet)

- [ ] **Step 3: Implement the components.js edits**

In `scripts/components.js`:

(a) Module header comment — add to the "A component is one of" list (after the tab group bullet):

```js
 *   - a data table  (a markdown pipe table — see dataTables.js)
```

(b) Imports — after the `contentTabs.js` import line, add:

```js
import { locateDataTables, buildDataTable, ensureDataTableUUIDs } from './dataTables.js';
```

(c) In `parseComponents`, after the `topCaptures` declaration, add:

```js
  // Immediate-child data tables (indent 0; tables inside admonitions / tabs
  // are indented, but guard against pathological overlaps anyway).
  const tbls = locateDataTables(src)
    .filter(t => t.indent === '' && !inAnyRange(t.startLine, admRanges));
```

(d) In the same function's `items` array literal, add after the `...grps.map(...)` spread:

```js
    ...tbls.map(t => ({
      kind: 'table',
      tbl: { uuid: t.uuid ?? null, align: t.align, header: t.header, rows: t.rows },
      startLine: t.startLine,
      endLine: t.endLine,
    })),
```

(e) In the `components` mapping at the end of `parseComponents`, add a branch:

```js
  const components = items.map(it => {
    if (it.kind === 'admonition') return { kind: 'admonition', adm: it.adm };
    if (it.kind === 'tabs') return { kind: 'tabs', grp: it.grp };
    if (it.kind === 'table') return { kind: 'table', tbl: it.tbl };
    return { kind: 'capture', cap: it.cap };
  });
```

(f) In `buildComponentBody`, add a branch before the final `else`:

```js
    } else if (c.kind === 'tabs') {
      lines.push(buildTabGroup(c.grp.uuid, c.grp.tabs));
    } else if (c.kind === 'table') {
      lines.push(buildDataTable(c.tbl.uuid, c.tbl.align, c.tbl.header, c.tbl.rows));
    } else {
```

(g) In `uuidOfComponent`:

```js
export function uuidOfComponent(c) {
  if (c.kind === 'admonition') return c.adm.uuid;
  if (c.kind === 'tabs') return c.grp.uuid;
  if (c.kind === 'table') return c.tbl.uuid;
  return c.cap.uuid;
}
```

(h) In `parsePastedComponents`, change the backfill chain (tables AFTER tabs — a table span injected as a tab's first body line would be misread as the tab's identity) and widen the error copy:

```js
  const withUuids = ensureCaptureUUIDs(ensureDataTableUUIDs(ensureTabUUIDs(ensureAdmonitionUUIDs(stripped, GUIDE_ADMONITION_TYPES_RE))));
```

and:

```js
    return { components: null, error: 'No components recognised. Paste markdown copied from a component (admonition, capture, content tabs or data table).' };
```

Also update the comment above the chain from `(admonitions → tabs → captures, same order as migrateComponentIdentity)` to `(admonitions → tabs → tables → captures, same order as migrateComponentIdentity)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/dataTables.test.mjs && node tests/contentTabs.test.mjs && node tests/componentMarkdown.test.mjs && node tests/componentContainers.test.mjs`
Expected: all PASS (the last three guard against regressions in shared code)

- [ ] **Step 5: Commit**

```bash
git add scripts/components.js tests/dataTables.test.mjs
git commit -m "feat(components): parse/build/uuid/paste support for kind:'table' data tables"
```

---

### Task 3: github.js identity migration

**Files:**
- Modify: `scripts/github.js` (imports lines 1-5; `migrateComponentIdentity` lines 58-75)
- Test: `tests/dataTables.test.mjs` (append)

- [ ] **Step 1: Append the failing migration tests**

Add to the imports of `tests/dataTables.test.mjs`:

```js
import { migrateComponentIdentity } from '../scripts/github.js';
import { locateTabGroups } from '../scripts/contentTabs.js';
```

and extend the existing components.js import with `readTabComponents`:

```js
import { parseComponents, buildComponentBody, uuidOfComponent, parsePastedComponents, readTabComponents } from '../scripts/components.js';
```

Append before the final `console.log`:

```js
// ── github.js identity migration ──────────────────────────────────────────────

test('migrateComponentIdentity: backfills table uuids in guide markdown; idempotent', () => {
  const md = ['# Title', '', '| A |', '| --- |', '| x |'].join('\n');
  const out = migrateComponentIdentity('docs/drafts/g.md', md);
  const [t] = locateDataTables(out);
  assert.ok(t.uuid, 'table uuid backfilled');
  assert.equal(migrateComponentIdentity('docs/drafts/g.md', out), out);
});

test('migrateComponentIdentity: a table as a tab\'s first content is not stolen as the tab uuid', () => {
  const md = [
    '# Title', '',
    '=== "One"', '',
    '    | A |',
    '    | --- |',
    '    | x |',
  ].join('\n');
  const out = migrateComponentIdentity('docs/drafts/g.md', md);
  const [g] = locateTabGroups(out);
  const { components } = readTabComponents(out, g.tabs[0].uuid);
  assert.equal(components.length, 1);
  assert.equal(components[0].kind, 'table');
  assert.notEqual(g.tabs[0].uuid, components[0].tbl.uuid);
  assert.equal(migrateComponentIdentity('docs/drafts/g.md', out), out);
});

test('migrateComponentIdentity: tables inside system-update bodies are migrated', () => {
  const md = [
    '??? feature-release "Feature release: X<span class="meta">5th June 2026</span>"',
    '',
    '    | A |',
    '    | --- |',
    '    | x |',
  ].join('\n');
  const out = migrateComponentIdentity('docs/drafts/system-updates.md', md);
  const [t] = locateDataTables(out);
  assert.ok(t.uuid, 'table uuid backfilled inside the update body');
  assert.equal(migrateComponentIdentity('docs/drafts/system-updates.md', out), out);
});
```

- [ ] **Step 2: Run the test to verify the new tests fail**

Run: `node tests/dataTables.test.mjs`
Expected: FAIL — `table uuid backfilled` assertion (migration doesn't call `ensureDataTableUUIDs` yet)

- [ ] **Step 3: Implement the github.js edits**

(a) Add the import after the `contentTabs.js` import:

```js
import { ensureDataTableUUIDs } from './dataTables.js';
```

(b) In `migrateComponentIdentity`, update the ordering comment to:

```js
  // ensureTabUUIDs must run BEFORE ensureDataTableUUIDs and ensureCaptureUUIDs:
  // a table/capture span injected as a tab's first body line would be misread
  // as the tab's own identity.
```

(c) System-files branch:

```js
    return filePath.includes('system-updates.md') ? ensureCaptureUUIDs(ensureDataTableUUIDs(ensureTabUUIDs(withAdm))) : withAdm;
```

(d) Guide branch:

```js
  if (isGuideMarkdown(filePath)) {
    // Mirror createGuideDraft: sections + component admonitions + tabs + tables + captures.
    return ensureCaptureUUIDs(ensureDataTableUUIDs(ensureTabUUIDs(
      ensureAdmonitionUUIDs(ensureSectionUUIDs(markdown), GUIDE_ADMONITION_TYPES_RE),
    )));
  }
```

(Do NOT touch guides.js' `createGuideDraft` chain — like tabs, tables are covered by `migrateComponentIdentity` on every fetch/push.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/dataTables.test.mjs && node tests/identityMigration.test.mjs && node tests/contentTabs.test.mjs`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/github.js tests/dataTables.test.mjs
git commit -m "feat(github): backfill data-table identity uuids in migrateComponentIdentity"
```

---

### Task 4: Rich text editor inline mode

**Files:**
- Modify: `scripts/richTextEditor.js` (`upgradeTextarea` ~36-95; `buildButtons` ~298-325; `attachSurfaceEvents` ~360-414)
- Modify: `scripts/form.js` (line ~1115, the `upgradeTextarea` forEach)
- Test: `tests/dataTables.test.mjs` (append — only the pure helper is unit-testable; the DOM behaviour is manually verified in Task 7)

- [ ] **Step 1: Append the failing pure-helper test**

Add to the imports of `tests/dataTables.test.mjs`:

```js
import { collapseNewlines } from '../scripts/richTextEditor.js';
```

Append before the final `console.log`:

```js
// ── richTextEditor inline mode (pure helper) ──────────────────────────────────

test('collapseNewlines: line breaks and surrounding space collapse to one space', () => {
  assert.equal(collapseNewlines('a\nb'), 'a b');
  assert.equal(collapseNewlines('a  \r\n  b\n\nc'), 'a b c');
  assert.equal(collapseNewlines('\nabc\n'), 'abc');
  assert.equal(collapseNewlines(null), '');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/dataTables.test.mjs`
Expected: FAIL — `collapseNewlines` is not exported

- [ ] **Step 3: Implement the richTextEditor.js edits**

(a) Add the exported pure helper near the top (after the `INDENTS` const):

```js
// Pure: collapse line breaks (and surrounding whitespace) to single spaces —
// what inline mode does to pasted text, since a table cell can't hold a newline.
export function collapseNewlines(text) {
  return (text ?? '').replace(/\s*\r?\n\s*/g, ' ').trim();
}
```

(b) Change the `upgradeTextarea` signature and record the flag. `opts.inline === true` (strict — form.js's old `forEach(upgradeTextarea)` style would pass an index number; the strict check keeps any stray caller safe):

```js
export function upgradeTextarea(textarea, opts = {}) {
  if (textarea.dataset.rteReady === '1') return; // idempotent
  textarea.dataset.rteReady = '1';
  const inline = opts.inline === true;
```

(c) Make aria reflect the mode — replace the existing `surface.setAttribute('aria-multiline', 'true');` line with:

```js
  surface.setAttribute('aria-multiline', String(!inline));
```

(d) Add `inline` to the `rte` object literal:

```js
  const rte = {
    textarea, surface, toolbar, btnGroup, richTab, mdTab, buttons: [], mode: 'rich', inline,
```

(e) At the end of `upgradeTextarea`, before `wrapper._rte = rte;`, add the markdown-view guards:

```js
  if (inline) {
    // Markdown view: the raw textarea must obey the same single-line rule.
    textarea.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });
    textarea.addEventListener('paste', e => {
      e.preventDefault();
      const text = collapseNewlines((e.clipboardData || window.clipboardData).getData('text/plain'));
      textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd, 'end');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
```

(f) In `buildButtons`, skip block-level buttons in inline mode (cells can't hold lists):

```js
function buildButtons(rte) {
  MARKS.forEach(m => {
    const btn = makeBtn(m.icon, m.label, () => runMarker(rte, m.marker));
    btn._mark = m;
    rte.btnGroup.appendChild(btn);
    rte.buttons.push(btn);
  });
  if (!rte.inline) {
    LISTS.forEach(l => {
      const btn = makeBtn(l.icon, l.label, () => runTransform(rte, (v, s, e) => toggleList(v, s, e, l.kind)));
      btn._list = l;
      rte.btnGroup.appendChild(btn);
      rte.buttons.push(btn);
    });
    INDENTS.forEach(ind => {
      const btn = makeBtn(ind.icon, ind.label, () => runTransform(rte, (v, s, e) => indentSelection(v, s, e, ind.dir)));
      btn._indent = ind;
      rte.btnGroup.appendChild(btn);
      rte.buttons.push(btn);
    });
  }

  const linkBtn = makeBtn('link', 'Link', () => rte.openLinkPopover?.());
  rte.btnGroup.appendChild(linkBtn);
  rte.buttons.push(linkBtn);

  const clearBtn = makeBtn('format_clear', 'Clear formatting', () => runStrip(rte));
  rte.btnGroup.appendChild(clearBtn);
  rte.buttons.push(clearBtn);
}
```

(g) In `attachSurfaceEvents`, block Enter/line breaks on the surface in inline mode. At the top of the `beforeinput` listener:

```js
  surface.addEventListener('beforeinput', e => {
    if (rte.inline && (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak')) { e.preventDefault(); return; }
    if (!isArmed(rte) || e.inputType !== 'insertText') return;
```

At the top of the `keydown` listener:

```js
  surface.addEventListener('keydown', e => {
    if (rte.inline && e.key === 'Enter') { e.preventDefault(); return; }
    if (e.key !== 'Tab') return;
```

(h) In the `paste` listener, collapse newlines in inline mode:

```js
  surface.addEventListener('paste', e => {
    e.preventDefault();
    let text = (e.clipboardData || window.clipboardData).getData('text/plain');
    if (rte.inline) text = collapseNewlines(text);
```

(i) Update the module-level comment? Not needed — but extend the `upgradeTextarea` JSDoc-free header by adding one comment line above the function:

```js
// opts.inline: single-line cell mode — no list/indent buttons, Enter blocked,
// pasted newlines collapsed. Default (multiline) behaviour is unchanged.
```

- [ ] **Step 4: Implement the form.js edit**

Replace line ~1115:

```js
    formEl.querySelectorAll('textarea[data-richtext]').forEach(upgradeTextarea);
```

with:

```js
    formEl.querySelectorAll('textarea[data-richtext]').forEach(ta =>
      upgradeTextarea(ta, { inline: ta.dataset.richtext === 'inline' }));
```

(`data-richtext="inline"` opts a textarea into inline mode; bare `data-richtext` keeps today's behaviour.)

- [ ] **Step 5: Run the tests to verify they pass (and nothing regressed)**

Run: `node tests/dataTables.test.mjs && node tests/richTextEditor.test.mjs && node tests/markdownLists.test.mjs && node tests/richEditorMapping.test.mjs && node tests/markdownToolbarActions.test.mjs`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/richTextEditor.js scripts/form.js tests/dataTables.test.mjs
git commit -m "feat(richTextEditor): opt-in inline mode (data-richtext=\"inline\") for single-line cells"
```

---

### Task 5: The Data Table form — HTML, CSS, editor module, wiring

**Files:**
- Create: `config/forms/editDataTable.html`
- Create: `scripts/dataTablesEditor.js`
- Modify: `config/forms/formsStyling.css` (append after the "Content Tabs editor" section, ~line 2192)
- Modify: `scripts/form.js` (FORM_LABELS, line ~51)
- Modify: `scripts/actions.js` (import block, after `import './contentTabsEditor.js';`)
- Modify: `manifest.json` (web_accessible_resources, after `scripts/contentTabsEditor.js`)

No unit test — this is DOM/orchestration glue verified manually in Task 7 (the project's test harness has no DOM).

- [ ] **Step 1: Create `config/forms/editDataTable.html`**

```html
<form data-nav data-dirty-guard id="edit-data-table-form" data-storage-key="moreButtonsEditDataTable" data-width="90vw" data-height="90vh">
  <h2 data-dt-heading>Edit data table</h2>

  <div class="mb-dt-grid-wrap">
    <table class="mb-dt-grid" data-dt-grid></table>
  </div>

  <div class="mb-ct-manage mb-dt-manage">
    <button type="button" class="more-buttons-button secondary" data-dt-add="row"><span class="more-buttons-icon">add</span>Add row</button>
    <button type="button" class="more-buttons-button secondary" data-dt-add="col"><span class="more-buttons-icon">add</span>Add column</button>
    <button type="button" class="more-buttons-button secondary" data-dt-move="up"><span class="more-buttons-icon">arrow_upward</span>Row up</button>
    <button type="button" class="more-buttons-button secondary" data-dt-move="down"><span class="more-buttons-icon">arrow_downward</span>Row down</button>
    <button type="button" class="more-buttons-button secondary" data-dt-move="left"><span class="more-buttons-icon">arrow_back</span>Column left</button>
    <button type="button" class="more-buttons-button secondary" data-dt-move="right"><span class="more-buttons-icon">arrow_forward</span>Column right</button>
    <button type="button" class="more-buttons-button danger" data-dt-delete="row"><span class="more-buttons-icon">delete</span>Delete row</button>
    <button type="button" class="more-buttons-button danger" data-dt-delete="col"><span class="more-buttons-icon">delete</span>Delete column</button>
  </div>

  <div class="more-buttons-form-group">
    <label class="more-buttons-label">Alignment</label>
    <div class="mb-dt-align">
      <button type="button" class="more-buttons-tab" data-dt-align="left">Left</button>
      <button type="button" class="more-buttons-tab" data-dt-align="center">Center</button>
      <button type="button" class="more-buttons-tab" data-dt-align="right">Right</button>
    </div>
  </div>

  <div class="more-buttons-form-group">
    <label class="more-buttons-label" data-dt-editing>Cell</label>
    <textarea data-dt-cell rows="2" data-richtext="inline" placeholder="Inline markdown"></textarea>
  </div>

  <input type="hidden" name="tableState" />

  <div class="more-buttons-form-actions">
    <button type="button" class="more-buttons-button success" data-action="submitEditDataTable" data-save-state data-saved-label="Draft saved" data-unsaved-label="Save to draft"><span class="more-buttons-icon">outbound</span>Save to draft</button>
    <button type="button" class="more-buttons-button danger" data-action="deleteDataTable" data-delete-table-btn><span class="more-buttons-icon">delete</span>Delete</button>
  </div>
</form>
```

(Visible inputs are deliberately UNNAMED — selecting cells must never false-dirty the form; the hidden `tableState` JSON is the only named field, exactly the contentTabs pattern.)

- [ ] **Step 2: Append the CSS to `config/forms/formsStyling.css`**

Insert immediately after the "Content Tabs editor" section (before `/* ── Knowledge Base Hierarchy Tree ─...`):

```css
/* ── Data Table editor ─────────────────────────────────────────────────────── */

.mb-dt-grid-wrap {
  overflow-x: auto;
  margin-bottom: 14px;
}

.mb-dt-grid {
  border-collapse: collapse;
  width: 100%;
  font-size: 0.875rem;
}

.mb-dt-cell {
  border: 1px solid var(--mb-border-subtle);
  padding: 6px 10px;
  text-align: left;
  cursor: pointer;
  min-width: 90px;
}

.mb-dt-cell--header {
  font-weight: 600;
  background: rgba(127, 127, 127, 0.08);
}

.mb-dt-cell:hover {
  background: rgba(127, 127, 127, 0.10);
}

.mb-dt-cell--selected {
  outline: 2px solid var(--mb-radio-checked-bg);
  outline-offset: -2px;
}

.mb-dt-cell__empty {
  color: var(--mb-text-muted);
  opacity: 0.6;
}

/* The structure-controls row reuses .mb-ct-manage; it just needs to wrap. */
.mb-dt-manage {
  flex-wrap: wrap;
}

/* Segmented Left / Center / Right control (reuses .more-buttons-tab look). */
.mb-dt-align {
  display: inline-flex;
  gap: 2px;
  border-bottom: 1px solid var(--mb-border-subtle);
}
```

- [ ] **Step 3: Create `scripts/dataTablesEditor.js`**

```js
/**
 * dataTablesEditor.js — the "Data table" overlay for a pipe-table component.
 *
 * One form edits a whole TABLE: a clickable grid (header + body cells, each
 * preview rendered from its inline markdown), structure controls (add / move /
 * delete rows and columns), a per-column alignment segment, and ONE shared
 * rich-text cell editor bound to the selected cell (inline mode — no lists,
 * no line breaks; see richTextEditor.js).
 *
 * Editor state lives in formEl._dt, mirrored into ONE hidden named input
 * (`tableState`, JSON) for dirty tracking — the grid and the cell editor are
 * deliberately UNNAMED so selecting cells never false-dirties the form
 * (contentTabsEditor's pattern).
 *
 * Save model: whole-table last-write-wins (same v1 trade-off as content
 * tabs). Tables are NOT component containers — nothing nests inside a cell —
 * so there is no registerComponentContainer here and no child save-gate; the
 * form is only ever a CHILD of a section / admonition / tab / update container.
 */

import { registerFormAction } from './formActions.js';
import {
  createForm, replaceCurrentOpener, setCrumbLabel, isFormReplay, navigateBack,
  resetDirtyBaseline, setButtonBusy, snapshotButton, restoreButton,
} from './form.js';
import { githubFetchAndPushFile, fetchFileMigratingIdentity } from './github.js';
import { generateUUID } from './admonitions.js';
import { getComponentContainer } from './componentContainers.js';
import { getDataTableByUUID, buildDataTable, replaceDataTableByUUID, deleteDataTableByUUID } from './dataTables.js';
import { spliceIntoContainer } from './guides.js';
import { syncSurfaceFromTextarea } from './richTextEditor.js';
import { renderDocHtml } from './markdownInline.js';

const STORAGE_KEY = 'moreButtonsEditDataTable';

// ── Editor state ──────────────────────────────────────────────────────────────
//
// formEl._dt = { uuid, file, selected: {row, col}, align, header, rows }
//   - selected.row === -1 addresses the header row; a cell is ALWAYS selected
//     (default header 0), so the shared editor is never unbound.

function starterTable() {
  return {
    align: ['left', 'left'],
    header: ['Column 1', 'Column 2'],
    rows: [['', ''], ['', '']],
  };
}

function cellAt(st, row, col) {
  return row === -1 ? (st.header[col] ?? '') : (st.rows[row]?.[col] ?? '');
}

function setCellAt(st, row, col, value) {
  if (row === -1) st.header[col] = value;
  else if (st.rows[row]) st.rows[row][col] = value;
}

function clampSelection(st) {
  if (!st.selected) st.selected = { row: -1, col: 0 };
  st.selected.col = Math.max(0, Math.min(st.selected.col, st.align.length - 1));
  st.selected.row = Math.max(-1, Math.min(st.selected.row, st.rows.length - 1));
}

// Mirror the table into the single named input that drives dirty tracking
// (and capture-free storage round-trips, via the generic save step).
function syncTableState(formEl) {
  const input = formEl.querySelector('[name="tableState"]');
  const { align, header, rows } = formEl._dt;
  if (input) input.value = JSON.stringify({ align, header, rows });
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function cellPreview(text) {
  return renderDocHtml(text ?? '') || '<span class="mb-dt-cell__empty">…</span>';
}

function renderGrid(formEl) {
  const grid = formEl.querySelector('[data-dt-grid]');
  const st = formEl._dt;
  if (!grid || !st) return;
  const sel = st.selected;
  const cell = (row, col, text) => {
    const tag = row === -1 ? 'th' : 'td';
    const cls = 'mb-dt-cell'
      + (row === -1 ? ' mb-dt-cell--header' : '')
      + (sel && sel.row === row && sel.col === col ? ' mb-dt-cell--selected' : '');
    return `<${tag} class="${cls}" data-dt-cell-at="${row}:${col}">${cellPreview(text)}</${tag}>`;
  };
  grid.innerHTML =
    `<thead><tr>${st.header.map((h, c) => cell(-1, c, h)).join('')}</tr></thead>` +
    `<tbody>${st.rows.map((r, ri) => `<tr>${r.map((v, c) => cell(ri, c, v)).join('')}</tr>`).join('')}</tbody>`;
  refreshControls(formEl);
}

// Enable/disable the structure controls for the current selection, and light
// the selected column's alignment segment.
function refreshControls(formEl) {
  const st = formEl._dt;
  const sel = st.selected;
  const q = s => formEl.querySelector(s);
  const onBody = sel.row >= 0;
  q('[data-dt-move="up"]').disabled = !onBody || sel.row <= 0;
  q('[data-dt-move="down"]').disabled = !onBody || sel.row >= st.rows.length - 1;
  q('[data-dt-move="left"]').disabled = sel.col <= 0;
  q('[data-dt-move="right"]').disabled = sel.col >= st.align.length - 1;
  q('[data-dt-delete="row"]').disabled = !onBody || st.rows.length <= 1;
  q('[data-dt-delete="col"]').disabled = st.align.length <= 1;
  formEl.querySelectorAll('[data-dt-align]').forEach(btn => {
    btn.classList.toggle('--active', st.align[sel.col] === btn.dataset.dtAlign);
  });
}

function editingLabel(st) {
  const sel = st.selected;
  const colName = (st.header[sel.col] ?? '').trim() || `Column ${sel.col + 1}`;
  return sel.row === -1 ? `Editing: Header · ${colName}` : `Editing: Row ${sel.row + 1} · ${colName}`;
}

// Push the selected cell's state into the shared editor.
function loadSelectedCell(formEl) {
  const st = formEl._dt;
  const label = formEl.querySelector('[data-dt-editing]');
  if (label) label.textContent = editingLabel(st);
  const ta = formEl.querySelector('[data-dt-cell]');
  if (!ta) return;
  ta.value = cellAt(st, st.selected.row, st.selected.col);
  syncSurfaceFromTextarea(ta);
}

// ── Structure operations ──────────────────────────────────────────────────────

function afterStructureChange(formEl) {
  clampSelection(formEl._dt);
  renderGrid(formEl);
  loadSelectedCell(formEl);
  syncTableState(formEl);
  formEl._refreshSaveState?.();
}

function addRow(formEl) {
  const st = formEl._dt;
  st.rows.push(Array.from({ length: st.align.length }, () => ''));
  st.selected = { row: st.rows.length - 1, col: st.selected.col };
  afterStructureChange(formEl);
}

function addColumn(formEl) {
  const st = formEl._dt;
  st.align.push('left');
  st.header.push(`Column ${st.header.length + 1}`);
  st.rows.forEach(r => r.push(''));
  st.selected = { row: -1, col: st.align.length - 1 };
  afterStructureChange(formEl);
}

function moveSelected(formEl, dir) {
  const st = formEl._dt;
  const sel = st.selected;
  if (dir === 'up' || dir === 'down') {
    const j = sel.row + (dir === 'up' ? -1 : 1);
    if (sel.row < 0 || j < 0 || j >= st.rows.length) return;
    [st.rows[sel.row], st.rows[j]] = [st.rows[j], st.rows[sel.row]];
    sel.row = j; // the selected row travels with the move
  } else {
    const j = sel.col + (dir === 'left' ? -1 : 1);
    if (j < 0 || j >= st.align.length) return;
    for (const arr of [st.align, st.header, ...st.rows]) [arr[sel.col], arr[j]] = [arr[j], arr[sel.col]];
    sel.col = j;
  }
  afterStructureChange(formEl);
}

function deleteSelected(formEl, what) {
  const st = formEl._dt;
  const sel = st.selected;
  if (what === 'row') {
    if (sel.row < 0 || st.rows.length <= 1) return;
    st.rows.splice(sel.row, 1);
  } else {
    if (st.align.length <= 1) return;
    st.align.splice(sel.col, 1);
    st.header.splice(sel.col, 1);
    st.rows.forEach(r => r.splice(sel.col, 1));
  }
  afterStructureChange(formEl);
}

function setAlign(formEl, align) {
  const st = formEl._dt;
  st.align[st.selected.col] = align;
  afterStructureChange(formEl);
}

// ── Wiring ────────────────────────────────────────────────────────────────────

function wireTableEditor(formEl) {
  // The rich editor re-dispatches surface edits as bubbling `input` events on
  // its textarea, so this one listener covers both views.
  formEl.addEventListener('input', e => {
    if (!e.target.matches?.('[data-dt-cell]')) return;
    const st = formEl._dt;
    setCellAt(st, st.selected.row, st.selected.col, e.target.value);
    // Live-update just the selected cell's preview — a full grid re-render
    // here would be wasteful (the editor keeps focus either way).
    const cellEl = formEl.querySelector(`[data-dt-cell-at="${st.selected.row}:${st.selected.col}"]`);
    if (cellEl) cellEl.innerHTML = cellPreview(e.target.value);
    if (st.selected.row === -1) {
      const label = formEl.querySelector('[data-dt-editing]');
      if (label) label.textContent = editingLabel(st); // header rename renames the label
    }
    syncTableState(formEl);
    formEl._refreshSaveState?.();
  });

  formEl.addEventListener('click', e => {
    const cellEl = e.target.closest('[data-dt-cell-at]');
    if (cellEl) {
      const [row, col] = cellEl.dataset.dtCellAt.split(':').map(n => parseInt(n, 10));
      formEl._dt.selected = { row, col };
      renderGrid(formEl);
      loadSelectedCell(formEl);
      return;
    }
    const add = e.target.closest('[data-dt-add]');
    if (add) { (add.dataset.dtAdd === 'row' ? addRow : addColumn)(formEl); return; }
    const move = e.target.closest('[data-dt-move]');
    if (move) { if (!move.disabled) moveSelected(formEl, move.dataset.dtMove); return; }
    const del = e.target.closest('[data-dt-delete]');
    if (del) { if (!del.disabled) deleteSelected(formEl, del.dataset.dtDelete); return; }
    const alignBtn = e.target.closest('[data-dt-align]');
    if (alignBtn) { setAlign(formEl, alignBtn.dataset.dtAlign); return; }
  });
}

// Initialise state. Storage (seeded by the opener, or carrying in-flight edits
// across a replay) wins over the markdown-derived fallback. Awaiting the get
// also sequences us behind form.js's storage hydration (FIFO), so
// resetDirtyBaseline below snapshots AFTER hydration set input values.
async function initStateFromStorage(formEl, fallback, file, uuid) {
  let table = fallback;
  try {
    const res = await chrome.storage.local.get(STORAGE_KEY);
    const raw = res?.[STORAGE_KEY]?.tableState;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.align) && parsed.align.length) table = parsed;
    }
  } catch { /* fall back to markdown-derived state */ }
  formEl._dt = { uuid, file, selected: { row: -1, col: 0 }, align: table.align, header: table.header, rows: table.rows };
}

function seedStorage(table) {
  const { align, header, rows } = table;
  return chrome.storage.local.set({ [STORAGE_KEY]: { tableState: JSON.stringify({ align, header, rows }) } });
}

// ── Openers ───────────────────────────────────────────────────────────────────

registerFormAction('openCreateDataTable', async ({ container, insertAtIndex } = {}) => {
  if (!container?.file) return;
  const initial = starterTable();
  if (!isFormReplay()) await seedStorage(initial);

  const { formEl } = await createForm('editDataTable');
  if (!formEl) return;
  formEl.dataset.mode = 'create';
  // Parent container this table will be spliced into (kind/uuid/file).
  formEl.dataset.parentKind = container.kind;
  formEl.dataset.parentUuid = container.uuid;
  formEl.dataset.parentFile = container.file;
  formEl.dataset.insertAtIndex = insertAtIndex == null ? '' : String(insertAtIndex);
  formEl.dataset.tableUuid = '';
  formEl.dataset.containerFile = container.file;

  const heading = formEl.querySelector('[data-dt-heading]');
  if (heading) heading.textContent = 'Add data table';
  formEl.parentElement?.querySelector('[data-delete-table-btn]')?.style.setProperty('display', 'none');

  await initStateFromStorage(formEl, initial, container.file, null);
  wireTableEditor(formEl);
  renderGrid(formEl);
  loadSelectedCell(formEl);
  syncTableState(formEl);
  resetDirtyBaseline(formEl);
});

registerFormAction('openEditDataTable', async ({ uuid, file } = {}) => {
  if (!uuid || !file) return;
  let md;
  try {
    // Backfill + persist any missing table UUIDs before reading, so
    // pre-existing pipe tables become editable on open.
    md = await fetchFileMigratingIdentity(file);
  } catch (e) {
    alert('Failed to load file: ' + e.message);
    return;
  }
  const tbl = getDataTableByUUID(md, uuid);
  if (!tbl) { alert('Data table not found.'); return; }
  const fallback = { align: tbl.align, header: tbl.header, rows: tbl.rows };
  if (!isFormReplay()) await seedStorage(fallback);

  const { formEl } = await createForm('editDataTable');
  if (!formEl) return;
  formEl.dataset.mode = 'edit';
  formEl.dataset.tableUuid = uuid;
  formEl.dataset.containerFile = file;

  const heading = formEl.querySelector('[data-dt-heading]');
  if (heading) heading.textContent = 'Edit data table';
  setCrumbLabel('Data table');

  await initStateFromStorage(formEl, fallback, file, uuid);
  wireTableEditor(formEl);
  renderGrid(formEl);
  loadSelectedCell(formEl);
  syncTableState(formEl);
  resetDirtyBaseline(formEl);
});

// ── Persistence ───────────────────────────────────────────────────────────────

// Build the brand-new table and splice it into the parent container at the
// chosen index — persistNewTabsGroup's shape, with a 'table' component.
async function persistNewDataTable(formEl, onProgress = () => {}) {
  const st = formEl._dt;
  const parent = {
    kind: formEl.dataset.parentKind,
    uuid: formEl.dataset.parentUuid,
    file: formEl.dataset.parentFile,
  };
  if (!getComponentContainer(parent.kind)) { alert('Unknown parent container.'); return null; }

  const uuid = generateUUID();
  const insertAtRaw = formEl.dataset.insertAtIndex;
  const insertAt = insertAtRaw === '' || insertAtRaw == null ? null : parseInt(insertAtRaw, 10);
  await spliceIntoContainer(parent, insertAt,
    [{ kind: 'table', tbl: { uuid, align: st.align, header: st.header, rows: st.rows } }], onProgress);
  return { uuid, file: parent.file };
}

// Flip the create form into an edit form in place — mirrors
// transitionTabsCreateToEdit.
async function transitionTableCreateToEdit(formEl, uuid, file) {
  formEl.dataset.mode = 'edit';
  formEl.dataset.tableUuid = uuid;
  formEl.dataset.containerFile = file;
  formEl._dt.uuid = uuid;
  replaceCurrentOpener('openEditDataTable', { uuid, file });
  const heading = formEl.querySelector('[data-dt-heading]');
  if (heading) heading.textContent = 'Edit data table';
  setCrumbLabel('Data table');
  formEl.parentElement?.querySelector('[data-delete-table-btn]')?.style.removeProperty('display');
  syncTableState(formEl);
  await seedStorage(formEl._dt);
  resetDirtyBaseline(formEl);
}

// Whole-table save, last-write-wins (known v1 limitation — module header).
async function persistDataTableEdit(formEl, onProgress = () => {}) {
  const st = formEl._dt;
  const file = formEl.dataset.containerFile;
  const uuid = formEl.dataset.tableUuid;

  let found = true;
  await githubFetchAndPushFile(file, onProgress, md => {
    if (!getDataTableByUUID(md, uuid)) { found = false; return md; }
    return replaceDataTableByUUID(md, uuid, buildDataTable(uuid, st.align, st.header, st.rows));
  });
  if (!found) {
    alert('This data table was deleted in another session — your changes can’t be saved.');
    return null;
  }
  await seedStorage(st);
  resetDirtyBaseline(formEl);
  return { uuid, file };
}

async function saveDataTable(formEl, onProgress = () => {}) {
  if (formEl.dataset.mode === 'create') {
    const res = await persistNewDataTable(formEl, onProgress);
    if (!res) return null;
    await transitionTableCreateToEdit(formEl, res.uuid, res.file);
    return res;
  }
  return persistDataTableEdit(formEl, onProgress);
}

// ── Form actions ──────────────────────────────────────────────────────────────

registerFormAction('submitEditDataTable', async ({ formEl, content }) => {
  const btn = content.querySelector('[data-save-state]');
  setButtonBusy(btn, 'Saving…');
  try {
    await saveDataTable(formEl, s => setButtonBusy(btn, s));
    formEl._refreshSaveState?.();
  } catch (e) {
    formEl._refreshSaveState?.();
    alert('Failed to save data table: ' + e.message);
  }
});

registerFormAction('deleteDataTable', async ({ formEl, content }) => {
  const uuid = formEl.dataset.tableUuid;
  const file = formEl.dataset.containerFile;
  if (!uuid || !file) return;
  if (!confirm('Delete this data table?')) return;
  const btn = content?.querySelector('[data-action="deleteDataTable"]');
  const snap = snapshotButton(btn);
  setButtonBusy(btn, 'Deleting…'); // disable immediately — no double-click window
  try {
    await githubFetchAndPushFile(file, s => setButtonBusy(btn, s), md => deleteDataTableByUUID(md, uuid));
    await chrome.storage.local.remove(STORAGE_KEY);
    await navigateBack();
  } catch (e) {
    restoreButton(btn, snap);
    alert('Failed to delete data table: ' + e.message);
  }
});
```

- [ ] **Step 4: Register the form label in `scripts/form.js`**

In `FORM_LABELS` (after `editContentTabs: 'Edit Content Tabs',`):

```js
  editDataTable: 'Edit Data Table',
```

- [ ] **Step 5: Load the module in `scripts/actions.js`**

After `import './contentTabsEditor.js';`:

```js
import './dataTablesEditor.js';
```

- [ ] **Step 6: Add both scripts to `manifest.json`**

In `web_accessible_resources[].resources`, after `"scripts/contentTabsEditor.js",`:

```json
        "scripts/dataTables.js",
        "scripts/dataTablesEditor.js",
```

(Required — omission causes "Failed to fetch dynamically imported module". Reload the extension at chrome://extensions after this change.)

- [ ] **Step 7: Sanity-check the module graph parses**

Run: `node --input-type=module -e "import('./scripts/dataTables.js').then(() => console.log('dataTables ok'))"`
Expected: `dataTables ok`

dataTablesEditor.js can't be imported under node (its import chain pulls guides.js → DOM), so syntax-check it via stdin instead:

Run: `node --check --input-type=module < scripts/dataTablesEditor.js`
Expected: no output (exit 0)

- [ ] **Step 8: Commit**

```bash
git add config/forms/editDataTable.html scripts/dataTablesEditor.js config/forms/formsStyling.css scripts/form.js scripts/actions.js manifest.json
git commit -m "feat(dataTables): grid + shared inline rich editor form for data table components"
```

---

### Task 6: guides.js / systemUpdates.js / insertMenu.js integration

**Files:**
- Modify: `scripts/guides.js` (renderComponents ~line 832-847; card fns ~1082-1099; save-gate delegates ~941-989; runChildAction ~922-937; openEditorForComponent ~996-1005; noteLabels ~1170-1181 AND ~1537-1548)
- Modify: `scripts/systemUpdates.js` (noteLabels ~185-196)
- Modify: `scripts/insertMenu.js` (header comment, JSDoc, menu HTML ~31-43, pick dispatch ~60-67)

- [ ] **Step 1: guides.js — render branch + card**

In `renderComponents` (~line 838), add the branch:

```js
    } else if (c.kind === 'tabs') {
      card = tabsComponentCard(c.grp);
    } else if (c.kind === 'table') {
      card = dataTableCard(c.tbl);
    } else {
```

After `tabsComponentCard` (~line 1099), add:

```js
// Card for a data-table component: "Data table" with a columns × rows summary
// plus the header names. Edit routes through the save-gate via data-edit-data-table.
function dataTableCard(tbl) {
  const cols = tbl.align?.length ?? (tbl.header ?? []).length;
  const headers = (tbl.header ?? []).filter(Boolean).join(' · ');
  const summary = `${cols} column${cols === 1 ? '' : 's'} × ${tbl.rows.length} row${tbl.rows.length === 1 ? '' : 's'}${headers ? ` — ${headers}` : ''}`;
  const btnAttr = tbl.uuid
    ? `data-edit-data-table="${escapeHtml(tbl.uuid)}"`
    : `disabled title="No UUID"`;
  return `
    <div class="mb-incident-card --purple">
      <div class="mb-incident-card__head">
        <strong class="mb-incident-card__title">Data table</strong>
        <span class="mb-incident-card__badge">Table</span>
      </div>
      <p class="mb-incident-card__body">${escapeHtml(summary)}</p>
      <div class="mb-incident-card__foot --end">
        ${tbl.uuid ? `<button type="button" class="mb-incident-card__edit" data-copy-component-md="${escapeHtml(tbl.uuid)}">Copy</button>` : ''}
        <button type="button" class="mb-incident-card__edit" ${btnAttr}>${tbl.uuid ? 'Edit' : 'Error'}</button>
      </div>
    </div>`;
}
```

- [ ] **Step 2: guides.js — save-gate delegates and dispatch**

(a) In `onComponentEditorClick`, after the `editTabs` block (~line 974):

```js
  const editTable = e.target.closest('[data-edit-data-table]');
  if (editTable) {
    beginChildNavigation(formEl, { type: 'edit-table', uuid: editTable.dataset.editDataTable });
    return;
  }
```

(b) In the `openInsertMenu` handlers object (~line 984), after `contentTabs:`:

```js
      dataTable: (i) => beginChildNavigation(formEl, { type: 'insert', kind: 'table', insertAt: i }),
```

(c) In `runChildAction` insert branches (~line 928), after the `'tabs'` line:

```js
    else if (action.kind === 'table') await getFormAction('openCreateDataTable')?.({ container, insertAtIndex: action.insertAt });
```

(d) In `runChildAction` edit branches (~line 934), after the `edit-tabs` block:

```js
  } else if (action.type === 'edit-table') {
    await getFormAction('openEditDataTable')?.({ uuid: action.uuid, file: container.file });
  }
```

(e) In `openEditorForComponent` (~line 1002), after the `'tabs'` branch:

```js
  } else if (component.kind === 'table') {
    await getFormAction('openEditDataTable')?.({ uuid: component.tbl.uuid, file: container.file });
  }
```

- [ ] **Step 3: guides.js — BOTH noteLabels sites (lines ~1170 and ~1537)**

In each `const noteLabels = comps => {` function, add after the `'tabs'` branch (skipping it crashes the merge resolver on `c.cap.uuid`):

```js
      } else if (c.kind === 'table') {
        labelMap[c.tbl.uuid] = { kind: 'admonition', title: 'Data table' };
```

- [ ] **Step 4: systemUpdates.js — noteLabels (~line 185)**

Same branch, after the `'tabs'` case:

```js
      } else if (c.kind === 'table') {
        labelMap[c.tbl.uuid] = { kind: 'admonition', title: 'Data table' };
```

- [ ] **Step 5: insertMenu.js**

(a) Header comment: change "four choices — Admonition, Capture, Content tabs, and (below a divider) Paste copied markdown" to "five choices — Admonition, Capture, Content tabs, Data table, and (below a divider) Paste copied markdown".

(b) JSDoc `handlers` type: add `dataTable:Function` after `contentTabs:Function`.

(c) Menu HTML — after the content-tabs button:

```js
    <button type="button" class="mb-popup-menu__item" data-pick="data-table" role="menuitem">Data table</button>
```

(d) `pick` dispatch — after the `content-tabs` line:

```js
    else if (kind === 'data-table') handlers.dataTable?.(insertAtIndex);
```

- [ ] **Step 6: Run the whole test suite**

Run: `for f in tests/*.test.mjs; do echo "== $f"; node "$f" || break; done`
Expected: every file prints its `ok -` lines and `N passed`; no failures. (Some capture tests may need network-free runs — if a pre-existing test fails identically on `main`, note it and move on.)

- [ ] **Step 7: Commit**

```bash
git add scripts/guides.js scripts/systemUpdates.js scripts/insertMenu.js
git commit -m "feat(guides): wire data-table cards, insert menu entry, edit dispatch, merge labels"
```

---

### Task 7: Verification

- [ ] **Step 1: Full test suite**

Run: `for f in tests/*.test.mjs; do echo "== $f"; node "$f" || break; done`
Expected: all pass.

- [ ] **Step 2: Manual verification checklist (user / extension reload required)**

Reload the unpacked extension at chrome://extensions (manifest changed), then on the target site:

1. Open a guide draft section → "+ Insert Component" → menu shows **Data table** between Content tabs and the divider.
2. Insert one: form opens titled "Add data table" with a 2×2 starter grid, header cell A selected, editor labelled "Editing: Header · Column 1".
3. Type in the editor — grid preview updates live; `**bold**` renders bold in the cell preview.
4. Toolbar has NO list/indent buttons; Enter does nothing; pasting multi-line text collapses to one line. Rich ↔ Markdown tabs both work.
5. Alignment segment sets the selected cell's column; check the saved markdown divider row (`:---:` etc).
6. Add/move/delete rows and columns; last row/column delete buttons disable; selection follows moves.
7. Save to draft → card appears in the section's component list: purple "Data table" card, "2 columns × 2 rows — …" summary; save button flips to "Draft saved".
8. Edit the card → form reopens with the saved table. Make a change, navigate away without saving → dirty guard prompts.
9. Copy on the card → pasteable markdown (no uuid spans); "Paste copied markdown" insert accepts it.
10. Delete in the form → table removed from the draft.
11. Insert a data table inside a content-tab's component list (tables nest in tabs; the reverse is impossible by design).
12. Publish the draft and confirm zensical renders the table (and click-to-sort works, via the user's tablesort setup).

- [ ] **Step 3: Check off plan items and commit the plan doc**

```bash
git add docs/superpowers/plans/2026-06-12-data-tables-component.md
git commit -m "docs(plans): data tables component plan executed"
```
