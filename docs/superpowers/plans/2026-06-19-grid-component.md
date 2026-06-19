# Grid Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 5th knowledge-base component kind, `grid` (a Zensical grid: an auto-flowing list of cells, each a full component container), with Card/Generic flavors.

**Architecture:** Clone the content-tabs component (a container of N content-containers). New leaf serializer `grid.js` round-trips `<div class="grid" markdown>` blocks whose cells are `<div class="card"|"" markdown>`; nesting is tracked by `<div>` depth (cell content is `md_in_html`, so it is NOT indented). New editor `gridEditor.js` + form `editGrid.html` clone the content-tabs editor minus per-cell titles, plus a Card/Generic flavor toggle. Each cell registers as a `grid-cell` component container. The new kind is added as a parallel `if (c.kind === 'grid')` branch at ~9 sites (there is no central kind enum).

**Tech Stack:** Plain ES modules (Chrome MV3 extension). Tests are standalone `.test.mjs` files using `node:assert/strict` and a tiny inline `test()` harness, run with `node tests/<file>.test.mjs`. No build step.

**Execution approach (chosen):** subagent-driven-development — dispatch a fresh subagent per task, with a two-stage review between tasks. Execute tasks **in order** (1 → 9); tasks 1–3 are pure-module and independently testable, 4–8 are wiring that depends on 1–3, and 9 is final verification. Work on a dedicated branch (`feature/grid-component`); commit per task as each task's final step specifies.

---

## Design decisions (locked in spec `docs/superpowers/specs/2026-06-19-grid-component-design.md`)

- **Both flavors** via a grid-level toggle: Card (`<div class="card" markdown>` cells) and Generic (`<div markdown>` cells). Wrapper is always `<div class="grid" markdown>`.
- **Cells are full component containers** (description + nested components), like content-tab cells. Registered as `grid-cell`.
- **1-D ordered cell list** (Zensical auto-flows columns). Clone the content-tabs strip, NOT the data-table 2-D toolbar.
- **Editor-hop on** (insert lands in the grid editor).
- **Whole-grid last-write-wins save**, re-reading each cell's components from fresh markdown each save (clone `persistTabsEdit`).
- **`md_in_html` + `attr_list` are already enabled** in the target KB toml — no `navToml.js` change.

## Markdown shape (canonical)

```
<span data-uuid="GRID-UUID" style="display:none"></span>
<div class="grid" markdown>

<div class="card" markdown>

<span data-uuid="CELL1-UUID" style="display:none"></span>
Cell one content…

</div>

<div class="card" markdown>

<span data-uuid="CELL2-UUID" style="display:none"></span>
Cell two content…

</div>

</div>
```

Generic flavor is identical but each cell is `<div markdown>` (no `class="card"`). Cell bodies are produced by `buildComponentBody(cellUuid, description, components)` (so each begins with the cell's own identity span). The grid identity span sits on the line immediately before the wrapper.

## File structure

**New files**
- `scripts/grid.js` — pure leaf serializer (parse/build/locate/ensure). Imports only `generateUUID` from `admonitions.js`. MUST NOT import `components.js`.
- `scripts/gridEditor.js` — the overlay editor (clone of `contentTabsEditor.js`). Registers the `grid-cell` container and the `openCreateGrid`/`openEditGrid`/`submitEditGrid`/`deleteGrid` form actions.
- `config/forms/editGrid.html` — the overlay form (clone of `editContentTabs.html`).
- `tests/grid.test.mjs` — covers `grid.js`, the `components.js` integration, and identity migration (mirrors `tests/contentTabs.test.mjs`).

**Modified files**
- `scripts/components.js` — add `grid` to `parseComponents`/`buildComponentBody`/`uuidOfComponent`/`parsePastedComponents`; add `readGridCellComponents`/`writeGridCellBody`/`gridCellExists`.
- `scripts/github.js` — add `ensureGridUUIDs` to both `migrateComponentIdentity` chains.
- `scripts/guides.js` — `gridCard`, `renderComponents` branch, `runChildAction` (insert + edit-grid), `onComponentEditorClick` (edit-grid card + insert handler), `openEditorForComponent` branch, both conflict-resolver label maps, `CONTAINER_NOUN`.
- `scripts/insertMenu.js` — menu item + `pick()` branch + JSDoc.
- `scripts/systemUpdates.js` — conflict-resolver label map branch.
- `scripts/form.js` — `FORM_LABELS.editGrid`.
- `scripts/actions.js` — `import './gridEditor.js';`.
- `manifest.json` — add `scripts/grid.js` and `scripts/gridEditor.js` to `web_accessible_resources`.

## UUID ensure-chain order (critical)

`admonitions → tabs → grids → tables → captures`. Grids run AFTER tabs (so a tab group span placed as a cell's first content is recognised, not stolen) and BEFORE tables/captures (so a table/capture as a cell's first content does not occupy the cell's body-span slot). `getCellBodyUUID` additionally disqualifies a first span whose next non-blank line is a nested grid wrapper or a `=== "` tab header.

---

### Task 1: `scripts/grid.js` — leaf serializer

**Files:**
- Create: `scripts/grid.js`
- Test: `tests/grid.test.mjs`

- [ ] **Step 1: Write the failing test file** `tests/grid.test.mjs`

```js
import assert from 'node:assert/strict';
import {
  locateGrids, buildGrid, getGridByUUID, locateGridCellByUUID,
  replaceGridByUUID, deleteGridByUUID, ensureGridUUIDs,
} from '../scripts/grid.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const span = (uuid, indent = '') => `${indent}<span data-uuid="${uuid}" style="display:none"></span>`;

// A canonical two-cell CARD grid, fully migrated.
const GRID_MD = [
  span('GRID'),
  '<div class="grid" markdown>',
  '',
  '<div class="card" markdown>',
  '',
  span('C1'),
  'First cell text.',
  '',
  '</div>',
  '',
  '<div class="card" markdown>',
  '',
  span('C2'),
  'Second cell text.',
  '',
  '</div>',
  '',
  '</div>',
].join('\n');

// ── locateGrids ───────────────────────────────────────────────────────────────

test('locateGrids: grid span, flavor, per-cell spans + dedented bodies', () => {
  const [g] = locateGrids(GRID_MD);
  assert.equal(g.uuid, 'GRID');
  assert.equal(g.flavor, 'card');
  assert.equal(g.indent, '');
  assert.equal(g.startLine, 0);
  assert.equal(g.endLine, 19);
  assert.deepEqual(g.cells.map(c => c.uuid), ['C1', 'C2']);
  assert.equal(g.cells[0].body, `${span('C1')}\nFirst cell text.`);
  assert.equal(g.cells[1].body, `${span('C2')}\nSecond cell text.`);
});

test('locateGrids: generic flavor when cells have no card class', () => {
  const md = [
    span('G'), '<div class="grid" markdown>', '',
    '<div markdown>', '', span('X'), 'Plain.', '', '</div>', '',
    '</div>',
  ].join('\n');
  const [g] = locateGrids(md);
  assert.equal(g.flavor, 'generic');
  assert.equal(g.cells[0].uuid, 'X');
});

test('locateGrids: grid without identity span has uuid=null, startLine on the wrapper', () => {
  const md = ['<div class="grid" markdown>', '', '<div class="card" markdown>', '', 'Solo.', '', '</div>', '', '</div>'].join('\n');
  const [g] = locateGrids(md);
  assert.equal(g.uuid, null);
  assert.equal(g.startLine, 0);
  assert.equal(g.cells[0].uuid, null);
});

test('locateGrids: a nested grid inside a cell is consumed, not a sibling', () => {
  const md = [
    span('OUTER'), '<div class="grid" markdown>', '',
    '<div class="card" markdown>', '',
    span('OC'),
    span('INNER'), '<div class="grid" markdown>', '',
    '<div class="card" markdown>', '', span('IC'), 'inner', '', '</div>', '',
    '</div>', '',
    '</div>', '',
    '</div>',
  ].join('\n');
  const grids = locateGrids(md);
  assert.equal(grids.length, 1);
  assert.equal(grids[0].uuid, 'OUTER');
  assert.equal(grids[0].cells.length, 1);
  assert.match(grids[0].cells[0].body, /data-uuid="INNER"/);
});

test('locateGrids: a grid inside an admonition body is found at its deeper indent', () => {
  const md = [
    '!!! note "N"', '',
    span('ADM', '    '), '',
    span('G', '    '),
    '    <div class="grid" markdown>', '',
    '    <div class="card" markdown>', '',
    span('CX', '    '),
    '    x', '',
    '    </div>', '',
    '    </div>',
  ].join('\n');
  const [g] = locateGrids(md);
  assert.equal(g.uuid, 'G');
  assert.equal(g.indent, '    ');
  assert.equal(g.cells[0].uuid, 'CX');
});

// ── buildGrid round-trip ──────────────────────────────────────────────────────

test('buildGrid: inverse of locateGrids (byte-for-byte round-trip)', () => {
  const [g] = locateGrids(GRID_MD);
  assert.equal(buildGrid(g.uuid, g.flavor, g.cells), GRID_MD);
});

test('buildGrid: generic flavor omits the card class', () => {
  const out = buildGrid('G', 'generic', [{ body: `${span('X')}\nPlain.` }]);
  assert.match(out, /^<div markdown>$/m);
  assert.ok(!out.includes('class="card"'));
});

// ── getGridByUUID / locateGridCellByUUID ──────────────────────────────────────

test('getGridByUUID: parses a nested grid out of the raw document', () => {
  const md = ['Before.', '', GRID_MD, '', 'After.'].join('\n');
  const g = getGridByUUID(md, 'GRID');
  assert.equal(g.uuid, 'GRID');
  assert.equal(g.flavor, 'card');
  assert.deepEqual(g.cells.map(c => c.uuid), ['C1', 'C2']);
});

test('getGridByUUID: a CELL uuid is not mistaken for a grid', () => {
  assert.equal(getGridByUUID(GRID_MD, 'C1'), null);
});

test('locateGridCellByUUID: finds a cell (open line, close line, indent)', () => {
  const lines = GRID_MD.split('\n');
  const loc = locateGridCellByUUID(lines, 'C1');
  assert.equal(loc.openLine, 3);
  assert.equal(loc.closeLine, 8);
  assert.equal(loc.indent, '');
});

test('locateGridCellByUUID: a GRID uuid is not mistaken for a cell', () => {
  assert.equal(locateGridCellByUUID(GRID_MD.split('\n'), 'GRID'), null);
});

// ── replace / delete by UUID ──────────────────────────────────────────────────

test('replaceGridByUUID: replaces in place, re-indented to the original depth', () => {
  const md = [
    '!!! note "N"', '',
    span('ADM', '    '), '',
    span('G', '    '),
    '    <div class="grid" markdown>', '',
    '    <div class="card" markdown>', '', span('CX', '    '), '    x', '', '    </div>', '',
    '    </div>',
  ].join('\n');
  const out = replaceGridByUUID(md, 'G', buildGrid('G', 'generic', [{ body: `${span('CX')}\ny2` }]));
  assert.match(out, /^ {4}<div markdown>$/m);
  assert.match(out, /^ {4}y2$/m);
  assert.ok(out.startsWith('!!! note "N"'));
});

test('deleteGridByUUID: removes the block plus one trailing blank line', () => {
  const md = ['Before.', '', GRID_MD, '', 'After.'].join('\n');
  const out = deleteGridByUUID(md, 'GRID');
  assert.equal(out, ['Before.', '', 'After.'].join('\n'));
});

test('replace/delete: unknown uuid leaves the document unchanged', () => {
  assert.equal(replaceGridByUUID(GRID_MD, 'NOPE', 'x'), GRID_MD);
  assert.equal(deleteGridByUUID(GRID_MD, 'NOPE'), GRID_MD);
});

// ── ensureGridUUIDs ───────────────────────────────────────────────────────────

test('ensureGridUUIDs: backfills the grid span and every per-cell span', () => {
  const bare = [
    '<div class="grid" markdown>', '',
    '<div class="card" markdown>', '', 'One.', '', '</div>', '',
    '<div class="card" markdown>', '', 'Two.', '', '</div>', '',
    '</div>',
  ].join('\n');
  const out = ensureGridUUIDs(bare);
  const [g] = locateGrids(out);
  assert.ok(g.uuid, 'grid should have a uuid');
  assert.ok(g.cells[0].uuid && g.cells[1].uuid, 'both cells should have uuids');
  assert.notEqual(g.cells[0].uuid, g.cells[1].uuid);
  // span, then the original text (injectCellUUID adds span + blank + body)
  assert.deepEqual(g.cells[0].body.split('\n').slice(1), ['', 'One.']);
});

test('ensureGridUUIDs: idempotent (a migrated grid reads through unchanged)', () => {
  const once = ensureGridUUIDs(['<div class="grid" markdown>', '', '<div class="card" markdown>', '', 'One.', '', '</div>', '', '</div>'].join('\n'));
  assert.equal(ensureGridUUIDs(once), once);
  assert.equal(ensureGridUUIDs(GRID_MD), GRID_MD);
});

test('ensureGridUUIDs: recurses into nested grids (grid inside a cell)', () => {
  const nested = [
    '<div class="grid" markdown>', '',
    '<div class="card" markdown>', '',
    '<div class="grid" markdown>', '',
    '<div class="card" markdown>', '', 'Deep.', '', '</div>', '',
    '</div>', '',
    '</div>', '',
    '</div>',
  ].join('\n');
  const out = ensureGridUUIDs(nested);
  // outer grid + outer cell + inner grid + inner cell = 4 identity spans
  assert.equal((out.match(/data-uuid=/g) || []).length, 4);
  assert.equal(ensureGridUUIDs(out), out);
});

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/grid.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/grid.js'`.

- [ ] **Step 3: Write `scripts/grid.js`**

```js
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
// A cell opener: `<div class="card" markdown>` (group2='card') or `<div markdown>`.
const CELL_OPEN_RE = /^(\s*)<div(?: class="(card)")? markdown>\s*$/;
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
 *   cells: Array<{uuid: string|null, body: string}>, startLine: number, endLine: number}>}
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
    while (j < lines.length && depth > 0) {
      const line = lines[j];
      const isClose = DIV_CLOSE_RE.test(line);
      const cm = (!isClose && depth === 1) ? line.match(CELL_OPEN_RE) : null;
      if (cm && cm[1] === indent) {
        if (cm[2] === 'card') flavor = 'card';
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
          cells.push({ uuid: getCellBodyUUID(body), body });
          cellStart = -1;
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
 * Builds a complete grid block (no outer indent) from its parts. Inverse of
 * locateGrids for a single grid. Cell bodies are provided WITH their own
 * identity span as the first line (callers build them via
 * components.js' buildComponentBody).
 *
 * @param {string} uuid - the grid's identity span value.
 * @param {'card'|'generic'} flavor
 * @param {Array<{body: string}>} cells
 * @returns {string}
 */
export function buildGrid(uuid, flavor, cells) {
  const cellOpen = `<div${flavor === 'card' ? ' class="card"' : ''} markdown>`;
  const lines = [
    `<span data-uuid="${uuid}" style="display:none"></span>`,
    '<div class="grid" markdown>',
  ];
  for (const c of cells) {
    lines.push('');
    lines.push(cellOpen);
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
      return { uuid, body };
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/grid.test.mjs`
Expected: PASS — all `ok -` lines, ending `… passed` (19 passed at this stage).

- [ ] **Step 5: Commit**

```bash
git add scripts/grid.js tests/grid.test.mjs
git commit -m "feat(grid): leaf serializer for <div class=grid> blocks"
```

### Task 2: `scripts/components.js` — wire `grid` into the ordered-component model

**Files:**
- Modify: `scripts/components.js`
- Test: `tests/grid.test.mjs` (append)

- [ ] **Step 1: Append failing integration tests to `tests/grid.test.mjs`** (above the final `console.log`)

First add the new imports at the top of the file (extend the existing `from '../scripts/grid.js'` import and add a `components.js` import):

```js
import {
  parseComponents, buildComponentBody, uuidOfComponent,
  readGridCellComponents, writeGridCellBody, gridCellExists,
} from '../scripts/components.js';
import { migrateComponentIdentity } from '../scripts/github.js';
```

Then add these tests before `console.log(\`\n${passed} passed\`)`:

```js
// ── parseComponents / buildComponentBody integration ──────────────────────────

const INTEGRATION_BODY = [
  'Intro description.',
  '',
  '!!! note "A note"',
  '',
  span('ADM', '    '),
  '    Note text.',
  '',
  span('GRID'),
  '<div class="grid" markdown>',
  '',
  '<div class="card" markdown>',
  '',
  span('C1'),
  'Cell text.',
  '',
  '!!! tip "Nested"',
  '',
  span('NEST', '    '),
  '    Nested tip.',
  '',
  '</div>',
  '',
  '</div>',
].join('\n');

test('parseComponents: grids interleave with admonitions in document order', () => {
  const { description, components } = parseComponents(INTEGRATION_BODY, /step|note|tip/);
  assert.equal(description, 'Intro description.');
  assert.deepEqual(components.map(c => c.kind), ['admonition', 'grid']);
  assert.deepEqual(components.map(uuidOfComponent), ['ADM', 'GRID']);
  assert.equal(components[1].grid.flavor, 'card');
});

test('parseComponents: an admonition inside a grid cell is NOT a sibling component', () => {
  const { components } = parseComponents(INTEGRATION_BODY, /step|note|tip/);
  assert.ok(!components.some(c => c.kind === 'admonition' && c.adm.uuid === 'NEST'));
  const grid = components.find(c => c.kind === 'grid');
  assert.match(grid.grid.cells[0].body, /Nested tip\./);
});

test('buildComponentBody: kind=grid round-trips through parseComponents', () => {
  const { description, components } = parseComponents(INTEGRATION_BODY, /step|note|tip/);
  const rebuilt = buildComponentBody(null, description, components);
  const again = parseComponents(rebuilt, /step|note|tip/);
  assert.equal(again.description, description);
  assert.deepEqual(again.components.map(c => c.kind), ['admonition', 'grid']);
  assert.deepEqual(again.components.map(uuidOfComponent), ['ADM', 'GRID']);
  assert.deepEqual(again.components.find(c => c.kind === 'grid').grid.cells,
                   components.find(c => c.kind === 'grid').grid.cells);
});

test('uuidOfComponent: grid branch returns the grid uuid', () => {
  assert.equal(uuidOfComponent({ kind: 'grid', grid: { uuid: 'G9', flavor: 'card', cells: [] } }), 'G9');
});

// ── Grid-cell containers: readGridCellComponents / writeGridCellBody ──────────

test('readGridCellComponents: a cell body parses as a container (description + components)', () => {
  const { description, components } = readGridCellComponents(INTEGRATION_BODY, 'C1');
  assert.equal(description, 'Cell text.');
  assert.equal(components.length, 1);
  assert.equal(components[0].kind, 'admonition');
  assert.equal(components[0].adm.uuid, 'NEST');
});

test('writeGridCellBody: rewrites a cell description, preserving its components', () => {
  const out = writeGridCellBody(INTEGRATION_BODY, 'C1', 'Edited cell text.', readGridCellComponents(INTEGRATION_BODY, 'C1').components);
  const { description, components } = readGridCellComponents(out, 'C1');
  assert.equal(description, 'Edited cell text.');
  assert.equal(components[0].adm.uuid, 'NEST');
  // Siblings outside the grid untouched.
  const { components: top } = parseComponents(out, /step|note|tip/);
  assert.deepEqual(top.map(uuidOfComponent), ['ADM', 'GRID']);
});

test('gridCellExists: true for a present cell, false otherwise', () => {
  assert.equal(gridCellExists(INTEGRATION_BODY, 'C1'), true);
  assert.equal(gridCellExists(INTEGRATION_BODY, 'NOPE'), false);
});

test('writeGridCellBody: unknown cell uuid is a no-op', () => {
  assert.equal(writeGridCellBody(INTEGRATION_BODY, 'NOPE', 'x', []), INTEGRATION_BODY);
});

// ── Identity migration ────────────────────────────────────────────────────────

test('migrateComponentIdentity: pre-existing grid blocks in guide markdown get uuids', () => {
  const md = ['# Title', '', '<div class="grid" markdown>', '', '<div class="card" markdown>', '', 'Hello.', '', '</div>', '', '</div>'].join('\n');
  const out = migrateComponentIdentity('docs/drafts/some-guide.md', md);
  const [g] = locateGrids(out);
  assert.ok(g.uuid, 'grid uuid backfilled');
  assert.ok(g.cells[0].uuid, 'cell uuid backfilled');
  assert.equal(migrateComponentIdentity('docs/drafts/some-guide.md', out), out);
});

test("migrateComponentIdentity: a capture as a cell's first content is not stolen as the cell uuid", () => {
  const md = [
    '# Title', '',
    '<div class="grid" markdown>', '',
    '<div class="card" markdown>', '',
    '![](../assets/a-light-mode.png#only-light){ width="800" }',
    '![](../assets/a-dark-mode.png#only-dark)', '',
    '</div>', '',
    '</div>',
  ].join('\n');
  const out = migrateComponentIdentity('docs/drafts/g.md', md);
  const [g] = locateGrids(out);
  const { components } = readGridCellComponents(out, g.cells[0].uuid);
  assert.equal(components.length, 1);
  assert.equal(components[0].kind, 'capture');
  assert.notEqual(g.cells[0].uuid, components[0].cap.uuid);
  assert.equal(migrateComponentIdentity('docs/drafts/g.md', out), out);
});
```

> The two `migrateComponentIdentity` tests will only pass after Task 3 wires `ensureGridUUIDs` into `github.js`. That is expected — they fail at the end of Task 2 (the function leaves grids unmigrated) and pass at the end of Task 3.

- [ ] **Step 2: Run to verify the new component tests fail**

Run: `node tests/grid.test.mjs`
Expected: FAIL — `readGridCellComponents is not a function` (export missing) / `parseComponents` returns the grid-cell admonition as a sibling.

- [ ] **Step 3: Edit `scripts/components.js` — import grid helpers**

Add after the existing `import { locateDataTables, … } from './dataTables.js';` line:

```js
import { locateGrids, buildGrid, ensureGridUUIDs, locateGridCellByUUID } from './grid.js';
```

- [ ] **Step 4: Edit `parseComponents` to locate grids and exclude grid-internal content**

Because grid cell content is `md_in_html` (NOT indented), grid-internal components sit at indent `0` and would otherwise be double-counted. Exclude them by grid range, exactly like admonition ranges.

Replace the block from `// Immediate-child admonitions` down to the `const tbls = …` line (currently `components.js` lines ~131–151) with:

```js
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

  // Immediate-child data tables (indent 0; tables inside admonitions/grids excluded).
  const tbls = locateDataTables(src)
    .filter(t => t.indent === '' && !inContainer(t.startLine));
```

- [ ] **Step 5: Edit the `items` array in `parseComponents`**

In the `const items = [ … ]` literal, change the admonitions spread to drop grid-internal admonitions, and add a grids spread. Replace the existing `...adms.map(...)` line and add the grids block immediately after it:

```js
    ...adms
      .filter(a => !inAnyRange(a.headerLine, gridRanges))
      .map(adm => ({ kind: 'admonition', adm, startLine: adm.headerLine, endLine: adm.endLine })),
    ...grids.map(g => ({
      kind: 'grid',
      grid: { uuid: g.uuid ?? null, flavor: g.flavor, cells: g.cells },
      startLine: g.startLine,
      endLine: g.endLine,
    })),
```

- [ ] **Step 6: Edit the strip-down `.map(it => …)` in `parseComponents`**

Add a grid branch alongside the others (before the final `return { kind: 'capture', cap: it.cap };`):

```js
    if (it.kind === 'grid') return { kind: 'grid', grid: it.grid };
```

- [ ] **Step 7: Edit `buildComponentBody`**

In the `for (const c of components)` loop, add a grid branch (e.g. after the `else if (c.kind === 'table')` branch):

```js
    } else if (c.kind === 'grid') {
      lines.push(buildGrid(c.grid.uuid, c.grid.flavor, c.grid.cells));
```

- [ ] **Step 8: Edit `uuidOfComponent`**

Add before the final capture `return`:

```js
  if (c.kind === 'grid') return c.grid.uuid;
```

- [ ] **Step 9: Edit `parsePastedComponents` ensure-chain**

Replace the `const withUuids = …` line with (insert `ensureGridUUIDs` between tabs and tables):

```js
  const withUuids = ensureCaptureUUIDs(ensureDataTableUUIDs(ensureGridUUIDs(ensureTabUUIDs(ensureAdmonitionUUIDs(stripped, GUIDE_ADMONITION_TYPES_RE)))));
```

Also extend the "No components recognised" error string to mention grids:

```js
    return { components: null, error: 'No components recognised. Paste markdown copied from a component (admonition, capture, content tabs, data table or grid).' };
```

- [ ] **Step 10: Add grid-cell container helpers to `components.js`**

Append after `writeTabBody` (the tab-container section). Cell bodies live inside `<div markdown>`, so — unlike tabs — there is NO +4 dedent/reindent; the cell body sits at the grid indent and `locateGridCellByUUID` reports it.

```js
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
```

- [ ] **Step 11: Run the tests (grid + components integration pass; migration tests still fail)**

Run: `node tests/grid.test.mjs`
Expected: the `parseComponents`/`buildComponentBody`/`readGridCellComponents`/`writeGridCellBody`/`gridCellExists` tests PASS. The two `migrateComponentIdentity` tests still FAIL (wired in Task 3).

- [ ] **Step 12: Guard against regressions in the sibling component tests**

Run: `node tests/contentTabs.test.mjs && node tests/dataTables.test.mjs && node tests/componentMarkdown.test.mjs && node tests/componentContainers.test.mjs`
Expected: all PASS (the parseComponents change must not break existing kinds).

- [ ] **Step 13: Commit**

```bash
git add scripts/components.js tests/grid.test.mjs
git commit -m "feat(grid): wire grid kind into components.js ordered model"
```

### Task 3: `scripts/github.js` — backfill grid UUIDs on fetch/push

**Files:**
- Modify: `scripts/github.js`
- Test: `tests/grid.test.mjs` (the two `migrateComponentIdentity` tests added in Task 2)

- [ ] **Step 1: Confirm the migration tests currently fail**

Run: `node tests/grid.test.mjs`
Expected: the two `migrateComponentIdentity` tests FAIL (grids not yet backfilled).

- [ ] **Step 2: Edit `scripts/github.js` — import `ensureGridUUIDs`**

Add after the existing `import { ensureDataTableUUIDs } from './dataTables.js';` line (line 5):

```js
import { ensureGridUUIDs } from './grid.js';
```

- [ ] **Step 3: Edit both chains in `migrateComponentIdentity`**

Insert `ensureGridUUIDs` between `ensureTabUUIDs` and `ensureDataTableUUIDs` in BOTH branches. Replace the system-updates return line:

```js
    return filePath.includes('system-updates.md') ? ensureCaptureUUIDs(ensureDataTableUUIDs(ensureGridUUIDs(ensureTabUUIDs(withAdm)))) : withAdm;
```

and replace the guide-markdown return block:

```js
    return ensureCaptureUUIDs(ensureDataTableUUIDs(ensureGridUUIDs(ensureTabUUIDs(
      ensureAdmonitionUUIDs(ensureSectionUUIDs(markdown), GUIDE_ADMONITION_TYPES_RE),
    ))));
```

Also update the ordering comment at the top of the function to read:

```js
  // ensureTabUUIDs + ensureGridUUIDs must run BEFORE ensureDataTableUUIDs and
  // ensureCaptureUUIDs: a table/capture span injected as a tab's or grid cell's
  // first body line would be misread as that container's own identity.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/grid.test.mjs`
Expected: PASS — full file, ending `… passed` (all grid + components + migration tests green).

- [ ] **Step 5: Guard the existing migration test**

Run: `node tests/identityMigration.test.mjs`
Expected: PASS (the new chain link must not break existing migration behaviour).

- [ ] **Step 6: Commit**

```bash
git add scripts/github.js
git commit -m "feat(grid): backfill grid UUIDs in migrateComponentIdentity"
```

### Task 4: `scripts/guides.js` — card, render branch, dispatch, label maps

No new unit test (these are DOM/dispatch wiring verified by the Task 9 smoke test). Each edit adds one `grid` branch parallel to the existing `tabs`/`table` branches.

**Files:**
- Modify: `scripts/guides.js`

- [ ] **Step 1: Add `gridCard` builder**

Insert immediately after the `dataTableCard` function (ends ~line 1200):

```js
// Card for a grid component: "Grid" with a cell-count + flavor summary. Edit
// routes through the save-gate via data-edit-grid.
function gridCard(grid) {
  const n = (grid.cells ?? []).length;
  const flavorLabel = grid.flavor === 'card' ? 'Cards' : 'Plain';
  const summary = `${n} cell${n === 1 ? '' : 's'} — ${flavorLabel}`;
  const btnAttr = grid.uuid
    ? `data-edit-grid="${escapeHtml(grid.uuid)}"`
    : `disabled title="No UUID"`;
  return `
    <div class="mb-incident-card --teal">
      <div class="mb-incident-card__head">
        <strong class="mb-incident-card__title">Grid</strong>
        <span class="mb-incident-card__badge">Grid</span>
      </div>
      <p class="mb-incident-card__body">${escapeHtml(summary)}</p>
      <div class="mb-incident-card__foot --end">
        ${grid.uuid ? `<button type="button" class="mb-incident-card__edit" data-copy-component-md="${escapeHtml(grid.uuid)}">Copy</button>` : ''}
        <button type="button" class="mb-incident-card__edit" ${btnAttr}>${grid.uuid ? 'Edit' : 'Error'}</button>
      </div>
    </div>`;
}
```

- [ ] **Step 2: Add the `grid` branch to `renderComponents`**

In the `components.forEach` card switch (~line 894–903), add before the final `else { card = captureComponentCardFor(c.cap); }`:

```js
    } else if (c.kind === 'grid') {
      card = gridCard(c.grid);
```

- [ ] **Step 3: Add insert + edit dispatch in `runChildAction`**

In the `action.type === 'insert'` block, after the `else if (action.kind === 'table') …` line (~990):

```js
    else if (action.kind === 'grid') await getFormAction('openCreateGrid')?.({ container, insertAtIndex: action.insertAt });
```

After the `else if (action.type === 'edit-table')` block and before `else if (action.type === 'edit-table-row')` (~1000), add:

```js
  } else if (action.type === 'edit-grid') {
    await getFormAction('openEditGrid')?.({ uuid: action.uuid, file: container.file });
```

- [ ] **Step 4: Add the edit-grid card handler + insert-menu handler in `onComponentEditorClick`**

After the `editTable` block (~line 1049), add:

```js
  const editGrid = e.target.closest('[data-edit-grid]');
  if (editGrid) {
    beginChildNavigation(formEl, { type: 'edit-grid', uuid: editGrid.dataset.editGrid });
    return;
  }
```

In the `openInsertMenu(anchor, idx, { … })` handler map (~1055–1062), add after the `dataTable:` line:

```js
      grid: (i) => beginChildNavigation(formEl, { type: 'insert', kind: 'grid', insertAt: i }),
```

- [ ] **Step 5: Add the `grid` branch to `openEditorForComponent`**

After the `else if (component.kind === 'table')` branch (~1080), add:

```js
  } else if (component.kind === 'grid') {
    await getFormAction('openEditGrid')?.({ uuid: component.grid.uuid, file: container.file });
```

- [ ] **Step 6: Add `grid` to both conflict-resolver label maps**

In `saveSectionForComponent`'s `noteLabels` (~line 1278) add after the `table` branch:

```js
      } else if (c.kind === 'grid') {
        labelMap[c.grid.uuid] = { kind: 'admonition', title: 'Grid' };
```

In `persistAdmonitionEdit`'s `noteLabels` (~line 1690) add the identical branch after its `table` branch:

```js
      } else if (c.kind === 'grid') {
        labelMap[c.grid.uuid] = { kind: 'admonition', title: 'Grid' };
```

- [ ] **Step 7: Add the `grid-cell` container noun**

In `CONTAINER_NOUN` (~line 931–937) add:

```js
  'grid-cell': 'cell',
```

- [ ] **Step 8: Sanity-check the module parses (no test yet)**

Run: `node --check scripts/guides.js`
Expected: no output (syntax OK).

- [ ] **Step 9: Commit**

```bash
git add scripts/guides.js
git commit -m "feat(grid): card, render branch, dispatch + label maps in guides.js"
```

### Task 5: `insertMenu.js` + `systemUpdates.js`

**Files:**
- Modify: `scripts/insertMenu.js`
- Modify: `scripts/systemUpdates.js`

- [ ] **Step 1: Add the "Grid" menu item to `insertMenu.js`**

In the non-`capturesOnly` `menu.innerHTML` template, add after the `data-pick="data-table"` button line (~47):

```js
    <button type="button" class="mb-popup-menu__item" data-pick="grid" role="menuitem">Grid</button>
```

- [ ] **Step 2: Add the `grid` dispatch in `pick()`**

After the `else if (kind === 'data-table') handlers.dataTable?.(insertAtIndex);` line (~73):

```js
    else if (kind === 'grid') handlers.grid?.(insertAtIndex);
```

- [ ] **Step 3: Update the `handlers` JSDoc**

In the `@param {{…}} handlers` line (~22), add `grid:Function` to the destructured shape so the contract stays documented:

```js
 * @param {{admonition:Function, captureNew:Function, captureLibrary:Function, contentTabs:Function, dataTable:Function, grid:Function, pasteMarkdown:Function}} handlers
```

- [ ] **Step 4: Add the `grid` branch to the `systemUpdates.js` label map**

In `noteLabels` (~line 192–193), after the `else if (c.kind === 'table')` branch:

```js
      } else if (c.kind === 'grid') {
        labelMap[c.grid.uuid] = { kind: 'admonition', title: 'Grid' };
```

- [ ] **Step 5: Sanity-check both modules parse**

Run: `node --check scripts/insertMenu.js && node --check scripts/systemUpdates.js`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add scripts/insertMenu.js scripts/systemUpdates.js
git commit -m "feat(grid): insert-menu item + system-updates label map"
```

### Task 6: `config/forms/editGrid.html` — the overlay form

Clone of `editContentTabs.html`: per-cell Title dropped, a Card/Generic flavor toggle added (segmented buttons, not radios — keeps every visible input unnamed so cell switching never false-dirties the form; flavor lives in `gridState`). No manifest edit (forms are wildcard-served via `config/forms/*`).

**Files:**
- Create: `config/forms/editGrid.html`

- [ ] **Step 1: Create `config/forms/editGrid.html`**

```html
<form data-nav data-dirty-guard id="edit-grid-form" data-storage-key="moreButtonsEditGrid" data-width="90vw" data-height="90vh">
  <h2 data-grid-heading>Edit grid</h2>

  <div class="more-buttons-form-group">
    <label class="more-buttons-label">Style</label>
    <div class="more-buttons-tab-list mb-grid-flavor">
      <button type="button" class="more-buttons-tab" data-grid-flavor="card">Cards</button>
      <button type="button" class="more-buttons-tab" data-grid-flavor="generic">Plain</button>
    </div>
  </div>

  <div class="more-buttons-tabs mb-grid-cells">
    <div class="more-buttons-tab-list" data-grid-strip></div>
  </div>

  <div class="mb-grid-manage">
    <button type="button" class="more-buttons-button secondary" data-grid-move="left"><span class="more-buttons-icon">arrow_back</span>Move left</button>
    <button type="button" class="more-buttons-button secondary" data-grid-move="right"><span class="more-buttons-icon">arrow_forward</span>Move right</button>
    <button type="button" class="more-buttons-button danger" data-grid-delete-cell><span class="more-buttons-icon">tab_close</span>Delete cell</button>
  </div>

  <div class="more-buttons-form-group">
    <label class="more-buttons-label">Cell content</label>
    <textarea data-grid-description rows="6" data-richtext placeholder="Markdown allowed"></textarea>
  </div>

  <div class="more-buttons-form-group" data-components-row>
    <label class="more-buttons-label">Components</label>
    <div>
      <div data-grid-cell-components></div>
    </div>
  </div>

  <input type="hidden" name="gridState" />

  <div class="more-buttons-form-actions">
    <button type="button" class="more-buttons-button success" data-action="submitEditGrid" data-save-state data-saved-label="Draft saved" data-unsaved-label="Save to draft"><span class="more-buttons-icon">outbound</span>Save to draft</button>
    <button type="button" class="more-buttons-button danger" data-action="deleteGrid" data-delete-grid-btn><span class="more-buttons-icon">delete</span>Delete</button>
  </div>
</form>
```

- [ ] **Step 2: Commit**

```bash
git add config/forms/editGrid.html
git commit -m "feat(grid): editGrid overlay form"
```

### Task 7: `scripts/gridEditor.js` — the overlay editor

Full clone of `contentTabsEditor.js` with three changes: (1) no per-cell title; strip labels are "Cell N"; (2) a grid-level Card/Generic flavor toggle stored in `gridState`; (3) each cell is a `grid-cell` container (no +4 dedent). Everything else — the single hidden `gridState` JSON input, unnamed visible inputs, `installRefreshHook`, the whole-object last-write-wins save re-reading each cell's components — mirrors content-tabs exactly.

**Files:**
- Create: `scripts/gridEditor.js`

- [ ] **Step 1: Create `scripts/gridEditor.js`**

```js
/**
 * gridEditor.js — the "Grid" overlay for a grid component.
 *
 * One form edits a whole GRID: a flavor toggle (Card / Generic), a dynamic cell
 * strip, ONE active panel below it (rich cell content + the active cell's
 * Components list), and add / move / delete-cell management. Each cell is itself
 * a component container ('grid-cell', uuid = the CELL's uuid), so admonitions,
 * captures, content tabs, data tables and nested grids can be inserted into the
 * active cell through the standard save-gate machinery in guides.js.
 *
 * Mirrors contentTabsEditor.js. Differences: cells have no title (Zensical grid
 * cells are title-less); a grid-level `flavor` toggle; and cell bodies live in
 * `<div markdown>` (md_in_html, no +4 indent) so the container read/write needs
 * no dedent. Editor state lives in `formEl._grid`, mirrored into ONE hidden
 * named input (`gridState`, JSON) for dirty tracking; visible per-cell inputs
 * are deliberately UNNAMED.
 */

import { registerFormAction } from './formActions.js';
import {
  createForm, replaceCurrentOpener, setCrumbLabel, isFormReplay, navigateBack,
  resetDirtyBaseline, setButtonBusy, snapshotButton, restoreButton,
} from './form.js';
import { readRepoText } from './repoClient.js';
import { githubFetchAndPushFile, fetchFileMigratingIdentity } from './github.js';
import { generateUUID, GUIDE_ADMONITION_TYPES_RE } from './admonitions.js';
import {
  parseComponents, buildComponentBody, uuidOfComponent, reorderComponents,
  readGridCellComponents, writeGridCellBody, gridCellExists,
} from './components.js';
import { registerComponentContainer, getComponentContainer } from './componentContainers.js';
import { getGridByUUID, buildGrid, replaceGridByUUID, deleteGridByUUID } from './grid.js';
import { makeContainerHandler, spliceIntoContainer, renderComponents, onComponentEditorClick, setOpenComponentEditor } from './guides.js';
import { syncSurfaceFromTextarea } from './richTextEditor.js';
import { escapeHtml } from './cardRenderer.js';

const STORAGE_KEY = 'moreButtonsEditGrid';

// Each CELL is a component container: children read and write through the
// registry like any other container.
registerComponentContainer('grid-cell', makeContainerHandler(readGridCellComponents, writeGridCellBody, gridCellExists));

// ── Editor state ──────────────────────────────────────────────────────────────
//
// formEl._grid = { gridUuid, file, active, flavor, cells: [{ uuid, description, order }] }

function newCell() {
  return { uuid: generateUUID(), description: '', order: null };
}

function cellsFromGrid(grid) {
  return grid.cells.map(c => {
    const { description } = parseComponents(c.body, GUIDE_ADMONITION_TYPES_RE);
    return { uuid: c.uuid ?? generateUUID(), description, order: null };
  });
}

// Mirror the state into the single named input that drives dirty tracking.
function syncGridState(formEl) {
  const input = formEl.querySelector('[name="gridState"]');
  if (input) input.value = JSON.stringify({ flavor: formEl._grid.flavor, cells: formEl._grid.cells });
}

// Pull the active cell's visible (unnamed) field back into state.
function stashActiveCell(formEl) {
  const st = formEl._grid;
  const c = st?.cells[st.active];
  if (!c) return;
  const desc = formEl.querySelector('[data-grid-description]');
  if (desc) c.description = desc.value;
}

// Push the active cell's state into the visible field.
function loadActiveCellFields(formEl) {
  const st = formEl._grid;
  const c = st?.cells[st.active];
  if (!c) return;
  // containerFromForm targets the ACTIVE cell; the grid uuid stays in
  // formEl.dataset.gridUuid for save/delete.
  formEl.dataset.editUuid = c.uuid;
  const desc = formEl.querySelector('[data-grid-description]');
  if (desc) { desc.value = c.description; syncSurfaceFromTextarea(desc); }
}

function renderStrip(formEl) {
  const strip = formEl.querySelector('[data-grid-strip]');
  const st = formEl._grid;
  if (!strip || !st) return;
  strip.innerHTML = st.cells.map((c, i) =>
    `<button type="button" class="more-buttons-tab${i === st.active ? ' --active' : ''}" data-grid-cell="${i}">Cell ${i + 1}</button>`
  ).join('') + `<button type="button" class="more-buttons-tab mb-grid-add-cell" data-grid-add title="Add cell">+ Add cell</button>`;

  const left = formEl.querySelector('[data-grid-move="left"]');
  const right = formEl.querySelector('[data-grid-move="right"]');
  const del = formEl.querySelector('[data-grid-delete-cell]');
  if (left) left.disabled = st.active <= 0;
  if (right) right.disabled = st.active >= st.cells.length - 1;
  if (del) del.disabled = st.cells.length <= 1;
}

function renderFlavor(formEl) {
  const st = formEl._grid;
  formEl.querySelectorAll('[data-grid-flavor]').forEach(btn => {
    btn.classList.toggle('--active', btn.dataset.gridFlavor === st.flavor);
  });
}

// Render the active cell's component list and point the shared open-editor
// tracking at it, so inserts/mutations re-render in place.
async function mountActiveCellComponents(formEl, md = null) {
  const st = formEl._grid;
  const c = st?.cells[st.active];
  if (!c) return;
  const listEl = formEl.querySelector('[data-grid-cell-components]');
  const file = formEl.dataset.containerFile;
  let components = [];
  if (formEl.dataset.mode !== 'create' && file) {
    try {
      const source = md ?? await readRepoText(file);
      components = reorderComponents(readGridCellComponents(source, c.uuid).components, c.order ?? []);
    } catch { components = []; }
  }
  renderComponents(listEl, components, false); // grids never number steps
  const ed = { formEl, listEl, container: { kind: 'grid-cell', uuid: c.uuid, file }, components };
  ed._mountedOrder = components.map(uuidOfComponent);
  formEl._gridEditor = ed;
  setOpenComponentEditor(ed);
}

// Sync an in-editor rail reorder into the owning cell's batch order + gridState.
function syncActiveOrderFromEditor(formEl) {
  const ed = formEl._gridEditor;
  const st = formEl._grid;
  if (!ed || !st || !Array.isArray(ed.components)) return;
  const cell = st.cells.find(c => c.uuid === ed.container.uuid);
  if (!cell) return;
  const cur = ed.components.map(uuidOfComponent);
  const mounted = ed._mountedOrder ?? cur;
  if (cell.order == null && cur.join(',') === mounted.join(',')) return; // untouched
  cell.order = cur;
  syncGridState(formEl);
}

function installRefreshHook(formEl) {
  const orig = formEl._refreshSaveState;
  formEl._refreshSaveState = () => { syncActiveOrderFromEditor(formEl); orig?.(); };
}

// ── Cell + flavor management ───────────────────────────────────────────────────

async function activateCell(formEl, index) {
  stashActiveCell(formEl);
  const st = formEl._grid;
  st.active = Math.max(0, Math.min(index, st.cells.length - 1));
  loadActiveCellFields(formEl);
  renderStrip(formEl);
  syncGridState(formEl);
  formEl._refreshSaveState?.();
  await mountActiveCellComponents(formEl);
}

async function addCell(formEl) {
  stashActiveCell(formEl);
  const st = formEl._grid;
  st.cells.push(newCell());
  await activateCell(formEl, st.cells.length - 1);
}

function moveActiveCell(formEl, dir) {
  stashActiveCell(formEl);
  const st = formEl._grid;
  const i = st.active;
  const j = i + dir;
  if (j < 0 || j >= st.cells.length) return;
  [st.cells[i], st.cells[j]] = [st.cells[j], st.cells[i]];
  st.active = j; // the active cell travels with the move
  renderStrip(formEl);
  syncGridState(formEl);
  formEl._refreshSaveState?.();
}

async function deleteActiveCell(formEl) {
  const st = formEl._grid;
  if (st.cells.length <= 1) {
    alert('A grid needs at least one cell — use Delete below to remove the whole grid.');
    return;
  }
  stashActiveCell(formEl);
  if (!confirm(`Delete cell ${st.active + 1}? Its contents are removed when you save.`)) return;
  st.cells.splice(st.active, 1);
  st.active = Math.min(st.active, st.cells.length - 1);
  loadActiveCellFields(formEl);
  renderStrip(formEl);
  syncGridState(formEl);
  formEl._refreshSaveState?.();
  await mountActiveCellComponents(formEl);
}

function setFlavor(formEl, flavor) {
  const st = formEl._grid;
  if (st.flavor === flavor) return;
  stashActiveCell(formEl);
  st.flavor = flavor;
  renderFlavor(formEl);
  syncGridState(formEl);
  formEl._refreshSaveState?.();
}

// ── Wiring ────────────────────────────────────────────────────────────────────

function wireGridEditor(formEl) {
  formEl.addEventListener('input', e => {
    if (e.target.matches?.('[data-grid-description]')) {
      stashActiveCell(formEl);
      syncGridState(formEl);
      formEl._refreshSaveState?.();
    }
  });

  formEl.addEventListener('click', e => {
    const cellBtn = e.target.closest('[data-grid-cell]');
    if (cellBtn) { activateCell(formEl, parseInt(cellBtn.dataset.gridCell, 10)); return; }
    if (e.target.closest('[data-grid-add]')) { addCell(formEl); return; }
    const move = e.target.closest('[data-grid-move]');
    if (move) { if (!move.disabled) moveActiveCell(formEl, move.dataset.gridMove === 'left' ? -1 : 1); return; }
    const del = e.target.closest('[data-grid-delete-cell]');
    if (del) { if (!del.disabled) deleteActiveCell(formEl); return; }
    const flavor = e.target.closest('[data-grid-flavor]');
    if (flavor) { setFlavor(formEl, flavor.dataset.gridFlavor); return; }
  });

  // Shared component delegation: rails, edit buttons, "+ Insert Component".
  formEl.addEventListener('click', onComponentEditorClick);
}

// ── State init / storage ───────────────────────────────────────────────────────

async function initStateFromStorage(formEl, fallbackCells, fallbackFlavor, file, gridUuid) {
  let cells = fallbackCells;
  let flavor = fallbackFlavor;
  try {
    const res = await chrome.storage.local.get(STORAGE_KEY);
    const raw = res?.[STORAGE_KEY]?.gridState;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.cells) && parsed.cells.length) cells = parsed.cells;
      if (parsed?.flavor === 'card' || parsed?.flavor === 'generic') flavor = parsed.flavor;
    }
  } catch { /* fall back to markdown-derived state */ }
  formEl._grid = { gridUuid, file, cells, flavor, active: 0 };
}

function seedStorage(flavor, cells) {
  return chrome.storage.local.set({ [STORAGE_KEY]: { gridState: JSON.stringify({ flavor, cells }) } });
}

// ── Openers ───────────────────────────────────────────────────────────────────

registerFormAction('openCreateGrid', async ({ container, insertAtIndex } = {}) => {
  if (!container?.file) return;
  const initialCells = [newCell(), newCell()];
  const initialFlavor = 'card';
  if (!isFormReplay()) await seedStorage(initialFlavor, initialCells);

  const { formEl } = await createForm('editGrid');
  if (!formEl) return;
  formEl.dataset.mode = 'create';
  formEl.dataset.parentKind = container.kind;
  formEl.dataset.parentUuid = container.uuid;
  formEl.dataset.parentFile = container.file;
  formEl.dataset.insertAtIndex = insertAtIndex == null ? '' : String(insertAtIndex);
  formEl.dataset.gridUuid = '';
  formEl.dataset.componentContainerKind = 'grid-cell';
  formEl.dataset.containerFile = container.file;
  formEl.dataset.componentNoun = 'grid';

  const heading = formEl.querySelector('[data-grid-heading]');
  if (heading) heading.textContent = 'Add grid';
  formEl.parentElement?.querySelector('[data-delete-grid-btn]')?.style.setProperty('display', 'none');

  await initStateFromStorage(formEl, initialCells, initialFlavor, container.file, null);
  formEl._componentSaver = () => saveGridForComponent(formEl);
  wireGridEditor(formEl);
  loadActiveCellFields(formEl);
  renderStrip(formEl);
  renderFlavor(formEl);
  syncGridState(formEl);
  await mountActiveCellComponents(formEl);
  installRefreshHook(formEl);
  resetDirtyBaseline(formEl);
});

registerFormAction('openEditGrid', async ({ uuid, file } = {}) => {
  if (!uuid || !file) return;
  let md;
  try {
    md = await fetchFileMigratingIdentity(file);
  } catch (e) {
    alert('Failed to load file: ' + e.message);
    return;
  }
  const grid = getGridByUUID(md, uuid);
  if (!grid) { alert('Grid not found.'); return; }
  const mdCells = cellsFromGrid(grid);
  if (!isFormReplay()) await seedStorage(grid.flavor, mdCells);

  const { formEl } = await createForm('editGrid');
  if (!formEl) return;
  formEl.dataset.mode = 'edit';
  formEl.dataset.gridUuid = uuid;
  formEl.dataset.componentContainerKind = 'grid-cell';
  formEl.dataset.containerFile = file;
  formEl.dataset.componentNoun = 'grid';

  const heading = formEl.querySelector('[data-grid-heading]');
  if (heading) heading.textContent = 'Edit grid';
  setCrumbLabel('Grid');

  await initStateFromStorage(formEl, mdCells, grid.flavor, file, uuid);
  formEl._componentSaver = () => saveGridForComponent(formEl);
  wireGridEditor(formEl);
  loadActiveCellFields(formEl);
  renderStrip(formEl);
  renderFlavor(formEl);
  syncGridState(formEl);
  await mountActiveCellComponents(formEl, md);
  installRefreshHook(formEl);
  resetDirtyBaseline(formEl);
});

// ── Persistence ───────────────────────────────────────────────────────────────

function validateGrid(st) {
  if (!st?.cells.length) { alert('Add at least one cell.'); return false; }
  return true;
}

async function persistNewGrid(formEl, onProgress = () => {}) {
  stashActiveCell(formEl);
  const st = formEl._grid;
  if (!validateGrid(st)) return null;
  const parent = {
    kind: formEl.dataset.parentKind,
    uuid: formEl.dataset.parentUuid,
    file: formEl.dataset.parentFile,
  };
  const handler = getComponentContainer(parent.kind);
  if (!handler) { alert('Unknown parent container.'); return null; }

  const gridUuid = generateUUID();
  const gridCells = st.cells.map(c => ({
    uuid: c.uuid,
    body: buildComponentBody(c.uuid, c.description, []),
  }));
  const insertAtRaw = formEl.dataset.insertAtIndex;
  const insertAt = insertAtRaw === '' || insertAtRaw == null ? null : parseInt(insertAtRaw, 10);

  await spliceIntoContainer(parent, insertAt, [{ kind: 'grid', grid: { uuid: gridUuid, flavor: st.flavor, cells: gridCells } }], onProgress);
  return { gridUuid, file: parent.file };
}

async function transitionGridCreateToEdit(formEl, gridUuid, file) {
  formEl.dataset.mode = 'edit';
  formEl.dataset.gridUuid = gridUuid;
  formEl.dataset.containerFile = file;
  formEl._grid.gridUuid = gridUuid;
  formEl._grid.cells.forEach(c => { c.order = null; });
  replaceCurrentOpener('openEditGrid', { uuid: gridUuid, file });
  const heading = formEl.querySelector('[data-grid-heading]');
  if (heading) heading.textContent = 'Edit grid';
  setCrumbLabel('Grid');
  formEl.parentElement?.querySelector('[data-delete-grid-btn]')?.style.removeProperty('display');
  syncGridState(formEl);
  await seedStorage(formEl._grid.flavor, formEl._grid.cells);
  await mountActiveCellComponents(formEl);
  resetDirtyBaseline(formEl);
}

// Whole-grid save, last-write-wins on flavor/cell list. Components are preserved
// per cell: each surviving cell's CURRENT components are re-read from fresh
// markdown, an in-flight batch reorder applied, and the grid rebuilt in order.
async function persistGridEdit(formEl, onProgress = () => {}) {
  stashActiveCell(formEl);
  const st = formEl._grid;
  if (!validateGrid(st)) return null;
  const file = formEl.dataset.containerFile;
  const gridUuid = formEl.dataset.gridUuid;

  let found = true;
  await githubFetchAndPushFile(file, onProgress, md => {
    if (!getGridByUUID(md, gridUuid)) { found = false; return md; }
    const gridCells = st.cells.map(c => {
      const { components } = readGridCellComponents(md, c.uuid);
      const ordered = c.order ? reorderComponents(components, c.order) : components;
      return { uuid: c.uuid, body: buildComponentBody(c.uuid, c.description, ordered) };
    });
    return replaceGridByUUID(md, gridUuid, buildGrid(gridUuid, st.flavor, gridCells));
  });
  if (!found) {
    alert('This grid was deleted in another session — your changes can’t be saved.');
    return null;
  }

  st.cells.forEach(c => { c.order = null; }); // the file is canonical again
  syncGridState(formEl);
  await seedStorage(st.flavor, st.cells);
  await mountActiveCellComponents(formEl);
  resetDirtyBaseline(formEl);
  return { gridUuid, file };
}

// Persist the grid form for the save-gate. Returns { container, formEl } where
// container = the ACTIVE cell, so child flows insert into it.
async function saveGridForComponent(formEl, onProgress = () => {}) {
  if (formEl.dataset.mode === 'create') {
    const res = await persistNewGrid(formEl, onProgress);
    if (!res) return null;
    await transitionGridCreateToEdit(formEl, res.gridUuid, res.file);
  } else {
    const res = await persistGridEdit(formEl, onProgress);
    if (!res) return null;
  }
  return {
    container: { kind: 'grid-cell', uuid: formEl.dataset.editUuid, file: formEl.dataset.containerFile },
    formEl,
  };
}

// ── Form actions ──────────────────────────────────────────────────────────────

registerFormAction('submitEditGrid', async ({ formEl, content }) => {
  const btn = content.querySelector('[data-save-state]');
  setButtonBusy(btn, 'Saving…');
  try {
    await saveGridForComponent(formEl, s => setButtonBusy(btn, s));
    formEl._refreshSaveState?.();
  } catch (e) {
    formEl._refreshSaveState?.();
    alert('Failed to save grid: ' + e.message);
  }
});

registerFormAction('deleteGrid', async ({ formEl, content }) => {
  const gridUuid = formEl.dataset.gridUuid;
  const file = formEl.dataset.containerFile;
  if (!gridUuid || !file) return;
  if (!confirm('Delete this grid? All of its cells and their contents are removed.')) return;
  const btn = content?.querySelector('[data-action="deleteGrid"]');
  const snap = snapshotButton(btn);
  setButtonBusy(btn, 'Deleting…'); // disable immediately — no double-click window
  try {
    await githubFetchAndPushFile(file, s => setButtonBusy(btn, s), md => deleteGridByUUID(md, gridUuid));
    await chrome.storage.local.remove(STORAGE_KEY);
    await navigateBack();
  } catch (e) {
    restoreButton(btn, snap);
    alert('Failed to delete grid: ' + e.message);
  }
});
```

- [ ] **Step 2: Sanity-check the module parses**

Run: `node --check scripts/gridEditor.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add scripts/gridEditor.js
git commit -m "feat(grid): gridEditor overlay (clone of content-tabs editor)"
```

### Task 8: Registration — `manifest.json` + `actions.js` + `form.js`

This makes the new scripts loadable and the form's breadcrumb correct. **A manifest change requires reloading the unpacked extension** at `chrome://extensions` — without that, even a correct manifest throws "Failed to fetch dynamically imported module".

**Files:**
- Modify: `manifest.json`
- Modify: `scripts/actions.js`
- Modify: `scripts/form.js`

- [ ] **Step 1: Add both scripts to `manifest.json` `web_accessible_resources`**

After the `"scripts/dataTablesEditor.js",` line (line 95), add:

```json
        "scripts/grid.js",
        "scripts/gridEditor.js",
```

(Both modules must be listed individually — scripts are not globbed. `grid.js` loads transitively via `components.js`/`github.js`/`gridEditor.js`, but listing it explicitly matches the convention used for every other leaf serializer, e.g. `contentTabs.js`, `dataTables.js`.)

- [ ] **Step 2: Import the editor in `scripts/actions.js`**

After the `import './dataTablesEditor.js';` line (line 16), add:

```js
import './gridEditor.js';
```

(This side-effect import runs `registerComponentContainer('grid-cell', …)` and the `openCreateGrid`/`openEditGrid`/`submitEditGrid`/`deleteGrid` `registerFormAction` calls.)

- [ ] **Step 3: Add the breadcrumb label in `scripts/form.js`**

In `FORM_LABELS` (line 40–57), after the `editDataTable: 'Edit Data Table',` line, add:

```js
  editGrid: 'Edit Grid',
```

- [ ] **Step 4: Sanity-check manifest is valid JSON and modules parse**

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')" && node --check scripts/actions.js && node --check scripts/form.js`
Expected: `manifest ok` and no syntax errors.

- [ ] **Step 5: Commit**

```bash
git add manifest.json scripts/actions.js scripts/form.js
git commit -m "feat(grid): register grid scripts, editor import + breadcrumb label"
```

### Task 9: Full verification + manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `for f in tests/*.test.mjs; do echo "== $f"; node "$f" || exit 1; done`
Expected: every file ends in `… passed` with no failures. Pay attention to `grid.test.mjs`, `contentTabs.test.mjs`, `dataTables.test.mjs`, `componentMarkdown.test.mjs`, `componentContainers.test.mjs`, `identityMigration.test.mjs`.

- [ ] **Step 2: Syntax-check every touched/new script**

Run: `for f in scripts/grid.js scripts/gridEditor.js scripts/components.js scripts/guides.js scripts/github.js scripts/insertMenu.js scripts/systemUpdates.js scripts/form.js scripts/actions.js; do node --check "$f" && echo "ok $f"; done`
Expected: `ok` for each.

- [ ] **Step 3: Reload the unpacked extension**

In Chrome: `chrome://extensions` → More Buttons → Reload. (Mandatory after the `manifest.json` change.)

- [ ] **Step 4: Manual smoke test — create + author a grid**

Open a guide draft → a section editor → **+ Insert Component → Grid**. Verify:
- The grid editor opens immediately (editor-hop), showing **2 cells** and the **Cards** flavor active.
- Type cell content; switch cells via the strip (no false "unsaved" prompt on switch).
- Toggle **Plain**/**Cards** — marks the form dirty.
- Add / Move left / Move right / Delete cell behave; Delete cell is disabled at 1 cell.
- **Save to draft** → reopen the section: a **Grid** card (teal, "N cells — Cards/Plain") renders in the component list.

- [ ] **Step 5: Manual smoke test — nested components survive a whole-grid save**

Edit the grid → into a cell, **+ Insert Component → Admonition** (and a **Capture**). Confirm each lands in its editor, saves, and appears in the cell's components list. Back in the grid, change the flavor and **Save** again → reopen → the admonition and capture are still inside that cell (whole-grid save re-read worked).

- [ ] **Step 6: Manual smoke test — markdown shape, copy/paste, migration**

- Open the draft `.md` on GitHub (or via the repo) and confirm the block matches §"Markdown shape": `<div class="grid" markdown>` wrapper, `<div class="card" markdown>` (or `<div markdown>`) cells, hidden uuid spans.
- Use the grid card's **Copy**, then **+ Insert Component → Paste copied markdown** into another section → a new grid appears with FRESH uuids (no duplicates).
- Confirm grids render correctly on the built Zensical site (cards flow into columns; `md_in_html` + `attr_list` already enabled).

- [ ] **Step 7: Final commit (if any verification fixes were made)**

```bash
git add -A && git commit -m "test(grid): verification fixes"  # only if needed
```

---

## Self-review (completed by plan author)

**Spec coverage** — every spec section maps to a task:
- §"Markdown shape" / grid.js serializer → Task 1.
- D1 both flavors → flavor toggle in Task 6 (form) + Task 7 (editor); `buildGrid`/`locateGrids` flavor in Task 1.
- D2 full component-container cells → `grid-cell` registration (Task 7) + `readGridCellComponents`/`writeGridCellBody`/`gridCellExists` (Task 2).
- D3 1-D cell list → content-tabs strip clone (Task 7); no 2-D toolbar.
- D4 editor-hop → `openEditorForComponent` grid branch (Task 4 Step 5).
- D5 whole-grid last-write-wins → `persistGridEdit` (Task 7).
- D6 toml extensions already present → no `navToml.js` task (noted in header + smoke test).
- Registration points (components/guides/insertMenu/form/actions/manifest/github/systemUpdates) → Tasks 2–5, 8.
- UUID ensure-chain order → Task 2 Step 9 + Task 3 Step 3, with `getCellBodyUUID` disambiguation in Task 1.

**Placeholder scan** — no TBD/TODO; every code step shows full code; every test step shows assertions; every run step shows the command + expected output.

**Type/name consistency** — verified across tasks: component shape `{ kind: 'grid', grid: { uuid, flavor, cells: [{ uuid, body }] } }`; container kind `'grid-cell'`; helpers `readGridCellComponents`/`writeGridCellBody`/`gridCellExists`; form name `editGrid`; storage key `moreButtonsEditGrid`; state `formEl._grid` / `formEl._gridEditor`; hidden input `gridState`; serializer exports `locateGrids`/`buildGrid`/`getGridByUUID`/`locateGridByUUID`/`locateGridCellByUUID`/`replaceGridByUUID`/`deleteGridByUUID`/`ensureGridUUIDs`/`GRID_OPEN_RE`. The data attributes used in `editGrid.html` (`data-grid-strip`/`data-grid-cell`/`data-grid-add`/`data-grid-move`/`data-grid-delete-cell`/`data-grid-flavor`/`data-grid-description`/`data-grid-cell-components`/`data-grid-heading`/`data-edit-grid`/`data-delete-grid-btn`) match those queried in `gridEditor.js` and `guides.js`.









