import assert from 'node:assert/strict';
import {
  locateDataTables, buildDataTable, splitRowCells, getDataTableByUUID,
  locateDataTableByUUID, replaceDataTableByUUID, deleteDataTableByUUID,
  ensureDataTableUUIDs,
} from '../scripts/dataTables.js';
import { parseComponents, buildComponentBody, uuidOfComponent, parsePastedComponents, readTabComponents } from '../scripts/components.js';
import { GUIDE_ADMONITION_TYPES_RE } from '../scripts/admonitions.js';
import { migrateComponentIdentity } from '../scripts/github.js';
import { locateTabGroups } from '../scripts/contentTabs.js';

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

test('migrateComponentIdentity: table as an admonition\'s first body line gets its OWN uuid', () => {
  // No blank line between the admonition header and the table body — the case
  // where the body (when parsed) does NOT start with a blank line, meaning the
  // injected admonition span would land immediately above the table row.
  const md = [
    '!!! note "Title"',
    '    | A |',
    '    | --- |',
    '    | x |',
  ].join('\n');
  const out = migrateComponentIdentity('docs/drafts/g.md', md);
  const spans = [...out.matchAll(/data-uuid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(spans.length, 2, 'both admonition and table get a uuid span');
  assert.equal(new Set(spans).size, spans.length, 'admonition and table uuids are distinct');
  const [t] = locateDataTables(out);
  assert.ok(t.uuid, 'table has its own uuid');
  assert.equal(migrateComponentIdentity('docs/drafts/g.md', out), out, 'idempotent');
});

console.log(`\n${passed} passed`);
