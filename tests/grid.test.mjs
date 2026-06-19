import assert from 'node:assert/strict';
import {
  locateGrids, buildGrid, getGridByUUID, locateGridCellByUUID,
  replaceGridByUUID, deleteGridByUUID, ensureGridUUIDs,
} from '../scripts/grid.js';
import {
  parseComponents, buildComponentBody, uuidOfComponent,
  readGridCellComponents, writeGridCellBody, gridCellExists,
} from '../scripts/components.js';
import { migrateComponentIdentity } from '../scripts/github.js';

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
  assert.equal(g.endLine, 18);
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

console.log(`\n${passed} passed`);
