import assert from 'node:assert/strict';
import {
  locateDataTables, buildDataTable, splitRowCells, getDataTableByUUID,
  locateDataTableByUUID, replaceDataTableByUUID, deleteDataTableByUUID,
  ensureDataTableUUIDs, parseCellCapture, serializeCellCapture,
} from '../scripts/dataTables.js';
import { parseComponents, buildComponentBody, uuidOfComponent, parsePastedComponents, readTabComponents } from '../scripts/components.js';
import { GUIDE_ADMONITION_TYPES_RE } from '../scripts/admonitions.js';
import { migrateComponentIdentity } from '../scripts/github.js';
import { locateTabGroups } from '../scripts/contentTabs.js';
import { collapseNewlines } from '../scripts/richTextEditor.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const span = (uuid, indent = '') => `${indent}<span data-uuid="${uuid}" style="display:none"></span>`;

// A canonical 2×2 table, fully migrated (new blank-separated format: 6 lines).
const TABLE_MD = [
  span('TBL'),
  '',
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
  assert.equal(t.endLine, 6);
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

// NEW: legacy adjacent form (span immediately before header, no blank) still parses.
test('locateDataTables: legacy adjacent form (no blank) still parses uuid', () => {
  const md = [span('LEG'), '| A |', '| --- |', '| x |'].join('\n');
  const [t] = locateDataTables(md);
  assert.equal(t.uuid, 'LEG');
  assert.equal(t.startLine, 0);
  assert.equal(t.endLine, 4);
});

// NEW: two blank lines between span and header → span NOT claimed.
test('locateDataTables: two blank lines between span and header → uuid not claimed', () => {
  const md = [span('X'), '', '', '| A |', '| --- |'].join('\n');
  const [t] = locateDataTables(md);
  assert.equal(t.uuid, null);
});

// NEW: blank-separated span in a tab body is container-owned; table gets uuid=null.
test('locateDataTables: blank-separated span owned by tab container is not stolen', () => {
  const md = [
    '=== "One"',
    '',
    span('TAB', '    '),
    '',
    '    | A |',
    '    | --- |',
  ].join('\n');
  const [t] = locateDataTables(md);
  assert.equal(t.uuid, null, 'tab span must not be stolen as table identity');
});

// NEW: blank-separated span owned by admonition container is not stolen.
test('locateDataTables: blank-separated span owned by admonition container is not stolen', () => {
  const md = [
    '!!! note',
    '',
    span('ADM', '    '),
    '',
    '    | A |',
    '    | --- |',
  ].join('\n');
  const [t] = locateDataTables(md);
  assert.equal(t.uuid, null, 'admonition span must not be stolen as table identity');
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
  // Index 0: span, 1: blank, 2: header, 3: divider, 4: row
  assert.equal(block.split('\n')[3], '| :--- | ---: |');
  const [t] = locateDataTables(block);
  assert.deepEqual(t.header, ['A', '']);
  assert.deepEqual(t.rows, [['1', '2']]);
});

// NEW: blank line is emitted at index 1.
test('buildDataTable: emits blank line between span and header', () => {
  const block = buildDataTable('U', ['left'], ['H'], []);
  assert.equal(block.split('\n')[1], '', 'line 1 must be blank');
});

// ── locate/get/replace/delete by UUID ────────────────────────────────────────

// DOC uses TABLE_MD which is now 6 lines.
// Lines: 0:'# Title', 1:'', 2:'Intro.', 3:'', 4:span, 5:'', 6:header, 7:divider, 8:row, 9:row, 10:'', 11:'After.'
const DOC = ['# Title', '', 'Intro.', '', TABLE_MD, '', 'After.'].join('\n');

test('locateDataTableByUUID: finds range at top level', () => {
  const loc = locateDataTableByUUID(DOC.split('\n'), 'TBL');
  assert.deepEqual(loc, { startLine: 4, endLine: 10, indent: '' });
});

test('locateDataTableByUUID: a non-table span returns null', () => {
  const md = [span('S'), 'plain text'].join('\n');
  assert.equal(locateDataTableByUUID(md.split('\n'), 'S'), null);
});

// NEW: locateDataTableByUUID works with blank-separated form.
test('locateDataTableByUUID: finds range with blank-separated form (new canonical)', () => {
  const md = [span('U'), '', '| A |', '| --- |', '| x |'].join('\n');
  const loc = locateDataTableByUUID(md.split('\n'), 'U');
  assert.deepEqual(loc, { startLine: 0, endLine: 5, indent: '' });
});

// NEW: locateDataTableByUUID still works with legacy adjacent form.
test('locateDataTableByUUID: finds range with legacy adjacent form', () => {
  const md = [span('U'), '| A |', '| --- |', '| x |'].join('\n');
  const loc = locateDataTableByUUID(md.split('\n'), 'U');
  assert.deepEqual(loc, { startLine: 0, endLine: 4, indent: '' });
});

test('getDataTableByUUID: parses an indented (nested) table dedented — legacy form', () => {
  const md = ['!!! note', '', span('N', '    '), '    | A |', '    | --- |', '    | x |'].join('\n');
  const t = getDataTableByUUID(md, 'N');
  assert.equal(t.uuid, 'N');
  assert.equal(t.indent, '    ');
  assert.deepEqual(t.rows, [['x']]);
});

test('getDataTableByUUID: parses an indented (nested) table dedented — new blank-separated form', () => {
  const md = ['!!! note', '', span('N', '    '), '', '    | A |', '    | --- |', '    | x |'].join('\n');
  const t = getDataTableByUUID(md, 'N');
  assert.equal(t.uuid, 'N');
  assert.equal(t.indent, '    ');
  assert.deepEqual(t.rows, [['x']]);
});

test('replaceDataTableByUUID: swaps the block, re-indenting to match', () => {
  // Use legacy-form nested table for this test; re-indented block is new format.
  const md = ['!!! note', '', span('N', '    '), '    | A |', '    | --- |', '    | x |'].join('\n');
  const out = replaceDataTableByUUID(md, 'N', buildDataTable('N', ['left'], ['B'], [['y']]));
  const t = getDataTableByUUID(out, 'N');
  assert.deepEqual(t.header, ['B']);
  assert.deepEqual(t.rows, [['y']]);
  // After re-indent: line 0 '!!! note', 1 '', 2 span, 3 blank, 4 header '    | B |'
  const outLines = out.split('\n');
  assert.equal(outLines[3], '', 'blank line is bare (not indented)');
  assert.ok(outLines[4].startsWith('    |'), 'header is indented');
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

test('ensureDataTableUUIDs: backfills nested (indented) tables too (via full migration pipeline)', () => {
  // ensureDataTableUUIDs alone cannot claim the span for a table that is the first
  // non-blank content of a container (the container-owned guard in locateDataTables
  // correctly prevents stealing). The full migrateComponentIdentity pipeline injects
  // the container body span first, then ensureDataTableUUIDs adds the table span.
  const md = ['!!! note', '', '    | A |', '    | --- |', '    | x |'].join('\n');
  const out = migrateComponentIdentity('docs/drafts/g.md', md);
  const [t] = locateDataTables(out);
  assert.ok(t.uuid, 'table uuid backfilled via full pipeline');
  assert.equal(t.indent, '    ');
  assert.equal(migrateComponentIdentity('docs/drafts/g.md', out), out, 'idempotent');
});

test('ensureDataTableUUIDs: standalone on an unmigrated container is a no-op (table waits for the container chain)', () => {
  // A bare table that is the FIRST content of a container without its own
  // uuid span yet: backfilling here would put the table span in the
  // container's body-span slot (container-owned on re-parse, never claimed,
  // re-injected forever). The function must skip it and return the input
  // unchanged; the full pipeline (container chains first) backfills it.
  const md = ['!!! note', '', '    | A |', '    | --- |', '    | x |'].join('\n');
  assert.equal(ensureDataTableUUIDs(md), md, 'first pass is a no-op');
  assert.equal(ensureDataTableUUIDs(ensureDataTableUUIDs(md)), md, 'repeated passes stay a no-op');
});

// NEW: ensureDataTableUUIDs normalizes a legacy-adjacent table (inserts blank).
test('ensureDataTableUUIDs: normalizes legacy-adjacent table to blank-separated form', () => {
  const legacyMd = [span('LEG'), '| A |', '| --- |', '| x |'].join('\n');
  const out = ensureDataTableUUIDs(legacyMd);
  const lines = out.split('\n');
  // After normalization: span at 0, blank at 1, header at 2
  assert.equal(lines[1], '', 'blank line inserted after span');
  assert.ok(lines[2].startsWith('|'), 'header is now at index 2');
  // UUID is preserved
  const [t] = locateDataTables(out);
  assert.equal(t.uuid, 'LEG', 'uuid preserved after normalization');
  // Idempotent
  assert.equal(ensureDataTableUUIDs(out), out, 'second pass is byte-identical');
  // Parses identically after normalization
  assert.equal(t.startLine, 0);
  assert.equal(t.endLine, 5);
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

// ── richTextEditor inline mode (pure helper) ──────────────────────────────────

test('collapseNewlines: line breaks and surrounding space collapse to one space', () => {
  assert.equal(collapseNewlines('a\nb'), 'a b');
  assert.equal(collapseNewlines('a  \r\n  b\n\nc'), 'a b c');
  assert.equal(collapseNewlines('\nabc\n'), 'abc');
  assert.equal(collapseNewlines(null), '');
  assert.equal(collapseNewlines('a\rb'), 'a b');
});

// ── Cell captures (inline, single-line) ───────────────────────────────────────

const CAP = {
  uuid: 'CAP1',
  lightFilename: 'media/occ-captures/uncategorised/abc-light-mode.png',
  darkFilename: 'media/occ-captures/uncategorised/abc-dark-mode.png',
  dimMode: 'width',
  dimValue: 120,
};

test('serializeCellCapture: width mode is one line, span + both themed images', () => {
  const s = serializeCellCapture(CAP);
  assert.ok(!s.includes('\n'), 'no newline — fits a single table-cell line');
  assert.match(s, /data-uuid="CAP1"/);
  assert.match(s, /abc-light-mode\.png#only-light\)\{ width="120" loading=lazy \}/);
  assert.match(s, /abc-dark-mode\.png#only-dark\)\{ width="120" loading=lazy \}/);
});

test('serializeCellCapture: height mode emits style="height: Npx"', () => {
  const s = serializeCellCapture({ ...CAP, dimMode: 'height', dimValue: 64 });
  assert.match(s, /#only-light\)\{ style="height: 64px" loading=lazy \}/);
});

test('serializeCellCapture: none mode emits bare images, no attr braces', () => {
  const s = serializeCellCapture({ ...CAP, dimMode: 'none', dimValue: null });
  assert.ok(!s.includes('{'), 'no attribute list when auto-sized');
  assert.match(s, /#only-light\) !\[\]\(\.\.\/assets\/[^)]*#only-dark\)$/);
});

test('serializeCellCapture: incomplete descriptor → empty string', () => {
  assert.equal(serializeCellCapture(null), '');
  assert.equal(serializeCellCapture({ lightFilename: 'x' }), '');
});

test('parseCellCapture: plain text cell → text, no capture', () => {
  assert.deepEqual(parseCellCapture('`GET` fetch'), { text: '`GET` fetch', capture: null });
  assert.deepEqual(parseCellCapture(''), { text: '', capture: null });
});

test('parseCellCapture round-trips serializeCellCapture (width)', () => {
  const { text, capture } = parseCellCapture(serializeCellCapture(CAP));
  assert.equal(text, '');
  assert.deepEqual(capture, CAP);
});

test('parseCellCapture round-trips serializeCellCapture (height + none)', () => {
  for (const mode of [{ dimMode: 'height', dimValue: 64 }, { dimMode: 'none', dimValue: null }]) {
    const cap = { ...CAP, ...mode };
    assert.deepEqual(parseCellCapture(serializeCellCapture(cap)).capture, cap);
  }
});

test('parseCellCapture: capture without an identity span → uuid null', () => {
  const noSpan = serializeCellCapture({ ...CAP, uuid: null });
  const { capture } = parseCellCapture(noSpan);
  assert.equal(capture.uuid, null);
  assert.equal(capture.lightFilename, CAP.lightFilename);
});

test('parseCellCapture: tolerates surrounding whitespace from cell trimming', () => {
  const { capture } = parseCellCapture('  ' + serializeCellCapture(CAP) + '  ');
  assert.deepEqual(capture, CAP);
});

test('cell capture survives a full data-table build/parse round-trip', () => {
  const cellMd = serializeCellCapture(CAP);
  const md = buildDataTable('TBL', ['left', 'left'], ['Step', 'Shot'], [['Click', cellMd]]);
  const t = getDataTableByUUID(md, 'TBL');
  assert.deepEqual(parseCellCapture(t.rows[0][1]).capture, CAP, 'capture cell intact after pipe-table round-trip');
  assert.equal(parseCellCapture(t.rows[0][0]).capture, null, 'sibling text cell unaffected');
});

console.log(`\n${passed} passed`);
