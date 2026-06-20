import assert from 'node:assert/strict';
import { locateGrids, buildGrid, ensureGridUUIDs } from '../scripts/grid.js';
import { parseComponents, buildComponentBody } from '../scripts/components.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const span = (uuid, indent = '') => `${indent}<span data-uuid="${uuid}" style="display:none"></span>`;
const ADM_RE = /step|note|tip/;

// A one-cell grid whose cell-open line is exactly `openTag`.
function gridWith(openTag) {
  return [
    span('G'), '<div class="grid" markdown>', '',
    openTag, '', span('C'), 'Body.', '', '</div>', '',
    '</div>',
  ].join('\n');
}

// ── buildGrid: emits the align-self inline style per valign ───────────────────

test('buildGrid: valign=middle emits align-self: center (generic cell, no class)', () => {
  const out = buildGrid('G', 'generic', [{ body: `${span('C')}\nBody.`, valign: 'middle' }]);
  assert.match(out, /^<div style="align-self: center" markdown>$/m);
});

test('buildGrid: valign=top emits align-self: start, bottom emits align-self: end', () => {
  const top = buildGrid('G', 'generic', [{ body: `${span('C')}\nx`, valign: 'top' }]);
  const bottom = buildGrid('G', 'generic', [{ body: `${span('C')}\nx`, valign: 'bottom' }]);
  assert.match(top, /^<div style="align-self: start" markdown>$/m);
  assert.match(bottom, /^<div style="align-self: end" markdown>$/m);
});

test('buildGrid: card flavor + valign keeps class-then-style attribute order', () => {
  const out = buildGrid('G', 'card', [{ body: `${span('C')}\nx`, valign: 'middle' }]);
  assert.match(out, /^<div class="card" style="align-self: center" markdown>$/m);
});

test('buildGrid: spill + valign emits both the class and the style', () => {
  const out = buildGrid('G', 'generic', [{ body: `${span('C')}\nx`, spill: true, valign: 'bottom' }]);
  assert.match(out, /^<div class="spill" style="align-self: end" markdown>$/m);
});

test('buildGrid: valign=default (or omitted) emits no style — byte-identical to legacy', () => {
  const dflt = buildGrid('G', 'generic', [{ body: `${span('C')}\nx`, valign: 'default' }]);
  const omit = buildGrid('G', 'generic', [{ body: `${span('C')}\nx` }]);
  assert.match(dflt, /^<div markdown>$/m);
  assert.equal(dflt, omit);
  assert.ok(!dflt.includes('align-self'));
});

// ── locateGrids: reads valign back from the cell's align-self ─────────────────

test('locateGrids: align-self center/start/end → middle/top/bottom', () => {
  assert.equal(locateGrids(gridWith('<div style="align-self: center" markdown>'))[0].cells[0].valign, 'middle');
  assert.equal(locateGrids(gridWith('<div style="align-self: start" markdown>'))[0].cells[0].valign, 'top');
  assert.equal(locateGrids(gridWith('<div style="align-self: end" markdown>'))[0].cells[0].valign, 'bottom');
});

test('locateGrids: a cell with no style reads as valign=default', () => {
  assert.equal(locateGrids(gridWith('<div markdown>'))[0].cells[0].valign, 'default');
});

test('locateGrids: class and style on the same cell both parse', () => {
  const [g] = locateGrids(gridWith('<div class="card spill" style="align-self: center" markdown>'));
  assert.equal(g.flavor, 'card');
  assert.equal(g.cells[0].spill, true);
  assert.equal(g.cells[0].valign, 'middle');
});

test('locateGrids: flex-start/flex-end aliases read as top/bottom; unknown → default', () => {
  assert.equal(locateGrids(gridWith('<div style="align-self: flex-start" markdown>'))[0].cells[0].valign, 'top');
  assert.equal(locateGrids(gridWith('<div style="align-self: flex-end" markdown>'))[0].cells[0].valign, 'bottom');
  assert.equal(locateGrids(gridWith('<div style="align-self: baseline" markdown>'))[0].cells[0].valign, 'default');
});

// ── round-trip ────────────────────────────────────────────────────────────────

test('build → locate → build is byte-identical across every valign', () => {
  for (const valign of ['default', 'top', 'middle', 'bottom']) {
    const built = buildGrid('G', 'card', [{ body: `${span('C')}\nx`, spill: false, valign }]);
    const [g] = locateGrids(built);
    assert.equal(g.cells[0].valign, valign, `parsed valign ${valign}`);
    assert.equal(buildGrid('G', g.flavor, g.cells), built, `rebuilt ${valign}`);
  }
});

// ── ensureGridUUIDs preserves valign ──────────────────────────────────────────

test('ensureGridUUIDs: a cell align-self survives identity backfill', () => {
  const bare = [
    '<div class="grid" markdown>', '',
    '<div style="align-self: center" markdown>', '', 'One.', '', '</div>', '',
    '</div>',
  ].join('\n');
  const out = ensureGridUUIDs(bare);
  assert.match(out, /align-self: center/);
  assert.equal(locateGrids(out)[0].cells[0].valign, 'middle');
});

// ── integration: buildComponentBody round-trips valign ────────────────────────

test('parseComponents/buildComponentBody: grid cell valign round-trips', () => {
  const body = [
    'Intro.', '',
    span('GRID'), '<div class="grid" markdown>', '',
    '<div class="card" style="align-self: center" markdown>', '', span('C1'), 'Cell.', '', '</div>', '',
    '</div>',
  ].join('\n');
  const { components } = parseComponents(body, ADM_RE);
  assert.equal(components[0].grid.cells[0].valign, 'middle');
  const rebuilt = buildComponentBody(null, 'Intro.', components);
  assert.match(rebuilt, /align-self: center/);
  const again = parseComponents(rebuilt, ADM_RE);
  assert.equal(again.components[0].grid.cells[0].valign, 'middle');
});

console.log(`\ngridValign: ${passed} passed`);
