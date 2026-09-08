import assert from 'node:assert/strict';
import { parseGridCellBlocks, cellOpenTag, locateGrids, buildGrid } from '../scripts/grid.js';
import { buildComponentBody, gridCellMarkdown, gridCellsMarkdown, parsePastedGridCells } from '../scripts/components.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const ADM_RE = /step|note|tip/;
const span = (uuid) => `<span data-uuid="${uuid}" style="display:none"></span>`;

// ── cellOpenTag ────────────────────────────────────────────────────────────────

test('cellOpenTag: exported; generic/default emits a bare opener', () => {
  assert.equal(cellOpenTag('generic', false, 'default'), '<div markdown>');
  assert.equal(cellOpenTag('card', true, 'middle'), '<div class="card spill" style="align-self: center" markdown>');
});

// ── parseGridCellBlocks ────────────────────────────────────────────────────────

test('parseGridCellBlocks: one bare cell block', () => {
  const cells = parseGridCellBlocks('<div markdown>\n\nHello **there**.\n\n</div>');
  assert.equal(cells.length, 1);
  assert.equal(cells[0].body, 'Hello **there**.');
  assert.equal(cells[0].spill, false);
  assert.equal(cells[0].valign, 'default');
});

test('parseGridCellBlocks: two cells keep spill + valign; card class is ignored', () => {
  const text = [
    '<div class="card spill" markdown>', '', 'A', '', '</div>', '',
    '<div class="card" style="align-self: end" markdown>', '', 'B', '', '</div>',
  ].join('\n');
  const cells = parseGridCellBlocks(text);
  assert.equal(cells.length, 2);
  assert.deepEqual(cells.map(c => c.body), ['A', 'B']);
  assert.equal(cells[0].spill, true);
  assert.equal(cells[1].valign, 'bottom');
  assert.ok(!('flavor' in cells[0]));
});

test('parseGridCellBlocks: a whole grid block unwraps into its cells', () => {
  const grid = buildGrid('G', 'card', [{ body: 'one' }, { body: 'two', spill: true }]);
  const cells = parseGridCellBlocks(grid);
  assert.equal(cells.length, 2);
  assert.deepEqual(cells.map(c => c.body), ['one', 'two']);
  assert.equal(cells[1].spill, true);
});

test('parseGridCellBlocks: a nested grid inside a cell body stays inside that cell', () => {
  const inner = buildGrid('IN', 'generic', [{ body: 'x' }, { body: 'y' }]);
  const text = `<div markdown>\n\nIntro\n\n${inner}\n\n</div>`;
  const cells = parseGridCellBlocks(text);
  assert.equal(cells.length, 1);
  assert.ok(cells[0].body.startsWith('Intro'));
  assert.ok(cells[0].body.includes('<div class="grid" markdown>'));
});

test('parseGridCellBlocks: prose outside a cell block is rejected', () => {
  assert.equal(parseGridCellBlocks('Just some prose.'), null);
  assert.equal(parseGridCellBlocks('<div markdown>\n\nA\n\n</div>\n\nstray'), null);
  assert.equal(parseGridCellBlocks('lead\n<div markdown>\n\nA\n\n</div>'), null);
});

test('parseGridCellBlocks: an admonition on its own is not a cell', () => {
  assert.equal(parseGridCellBlocks('!!! note "T"\n\n    body'), null);
});

test('parseGridCellBlocks: a grid wrapper followed by trailing prose is rejected', () => {
  const grid = buildGrid('G', 'generic', [{ body: 'one' }]);
  assert.equal(parseGridCellBlocks(grid + '\n\ntrailing'), null);
});

test('parseGridCellBlocks: an early-closing wrapper is rejected', () => {
  assert.equal(parseGridCellBlocks('<div markdown>\n\nA\n\n</div>\n</div>\nprose'), null);
});

test('parseGridCellBlocks: empty / blank input is rejected', () => {
  assert.equal(parseGridCellBlocks(''), null);
  assert.equal(parseGridCellBlocks('\n\n  \n'), null);
});

test('parseGridCellBlocks: a self-closed div at cell level is not a cell', () => {
  assert.equal(parseGridCellBlocks('<div class="mb-nav-links" data-path="a"></div>'), null);
});

test('locateGrids: still parses the canonical fixture after the scan refactor', () => {
  const grid = buildGrid('G', 'card', [{ body: `${span('C1')}\n\none`, valign: 'top' }, { body: 'two' }]);
  const [g] = locateGrids(grid);
  assert.equal(g.uuid, 'G');
  assert.equal(g.flavor, 'card');
  assert.equal(g.cells.length, 2);
  assert.equal(g.cells[0].uuid, 'C1');
  assert.equal(g.cells[0].valign, 'top');
});

// ── gridCellMarkdown + parsePastedGridCells ────────────────────────────────────

// A cell body as it lives in the file: identity span, description, a nested admonition.
const CELL_BODY = [
  span('CELL-1'),
  '',
  'Cell text.',
  '',
  '!!! note "Inside"',
  '',
  `    ${span('ADM-1')}`,
  '    Nested body.',
].join('\n');

test('gridCellMarkdown: emits a cell block with the flavor class and no spans', () => {
  const md = gridCellMarkdown('card', { body: CELL_BODY, spill: true, valign: 'default' });
  const lines = md.split('\n');
  assert.equal(lines[0], '<div class="card spill" markdown>');
  assert.equal(lines[lines.length - 1], '</div>');
  assert.ok(!md.includes('data-uuid'));
  assert.ok(md.includes('Cell text.'));
  assert.ok(md.includes('!!! note "Inside"'));
});

test('parsePastedGridCells: copied cell → one cell with fresh uuids, description + components intact', () => {
  const md = gridCellMarkdown('card', { body: CELL_BODY, spill: false, valign: 'middle' });
  const res = parsePastedGridCells(md);
  assert.equal(res.error, null);
  assert.equal(res.cells.length, 1);
  const c = res.cells[0];
  assert.ok(c.uuid && c.uuid !== 'CELL-1');
  assert.equal(c.description.trim(), 'Cell text.');
  assert.equal(c.components.length, 1);
  assert.equal(c.components[0].kind, 'admonition');
  assert.ok(c.components[0].adm.uuid && c.components[0].adm.uuid !== 'ADM-1');
  assert.equal(c.spill, false);
  assert.equal(c.valign, 'middle');
});

test('parsePastedGridCells: copy → paste → copy is byte-stable', () => {
  const first = gridCellMarkdown('generic', { body: CELL_BODY, spill: false, valign: 'default' });
  const { cells } = parsePastedGridCells(first);
  // Rebuild the pasted cell's body the way the editor does, then copy again.
  const body = buildComponentBody(cells[0].uuid, cells[0].description, cells[0].components);
  const second = gridCellMarkdown('generic', { body, spill: cells[0].spill, valign: cells[0].valign });
  assert.equal(second, first);
});

test('parsePastedGridCells: a whole copied grid yields all its cells', () => {
  const grid = buildGrid('G', 'card', [{ body: 'one' }, { body: 'two' }, { body: 'three' }]);
  const res = parsePastedGridCells(grid);
  assert.equal(res.error, null);
  assert.deepEqual(res.cells.map(c => c.description.trim()), ['one', 'two', 'three']);
  assert.ok(res.cells.every(c => c.uuid));
});

test('parsePastedGridCells: errors for empty and unrecognised input', () => {
  assert.match(parsePastedGridCells('').error, /Nothing to insert/);
  assert.match(parsePastedGridCells('   \n').error, /Nothing to insert/);
  assert.match(parsePastedGridCells('!!! note "T"\n\n    body').error, /No grid cells recognised/);
  assert.equal(parsePastedGridCells('plain prose').cells, null);
});

// ── gridCellsMarkdown (multi-select Copy payload) ──────────────────────────────

test('gridCellsMarkdown: joins single-cell payloads with one blank line, in order', () => {
  const a = { body: 'A', spill: true };
  const b = { body: 'B', valign: 'bottom' };
  assert.equal(gridCellsMarkdown('card', [a, b]), gridCellMarkdown('card', a) + '\n\n' + gridCellMarkdown('card', b));
  assert.ok(gridCellsMarkdown('card', [b, a]).startsWith('<div class="card" style="align-self: end"'));
});

test('gridCellsMarkdown: round-trips through parsePastedGridCells keeping order, spill and valign', () => {
  const a = { body: 'A', spill: true };
  const b = { body: 'B', valign: 'bottom' };
  const { cells, error } = parsePastedGridCells(gridCellsMarkdown('card', [a, b]));
  assert.equal(error, null);
  assert.deepEqual(cells.map(c => c.description), ['A', 'B']);
  assert.deepEqual(cells.map(c => c.spill), [true, false]);
  assert.deepEqual(cells.map(c => c.valign), ['default', 'bottom']);
});

console.log(`\n${passed} passed`);
