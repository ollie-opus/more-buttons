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

console.log(`\n${passed} passed`);
