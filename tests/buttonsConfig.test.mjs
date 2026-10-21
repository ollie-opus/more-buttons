import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const read = rel => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
const buttons = read('../config/buttons.json');
const palette = Object.keys(read('../config/buttonColours.json'));
const byId = id => buttons.find(b => b.id === id);

test('ids are unique', () => {
  const ids = buttons.map(b => b.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('removed keys are absent', () => {
  for (const b of buttons) {
    for (const k of ['containerId', 'fillColor', 'textColor', 'border', 'splitWith', 'hoverText']) {
      assert.ok(!(k in b), `${b.id} still has ${k}`);
    }
    if (b.toggle) for (const k of ['fillColorOn', 'fillColorOff']) assert.ok(!(k in b.toggle), `${b.id} toggle has ${k}`);
  }
});

test('colour is a palette key', () => {
  for (const b of buttons) assert.ok(palette.includes(b.colour), `${b.id}: ${b.colour}`);
});

test('surface is page, popup or undefined', () => {
  for (const b of buttons) assert.ok([undefined, 'page', 'popup'].includes(b.surface), b.id);
});

test('dockOrder is a finite number', () => {
  for (const b of buttons) assert.ok(Number.isFinite(b.dockOrder), b.id);
});

test('page buttons have displayText', () => {
  for (const b of buttons) {
    if (b.surface === 'popup') continue;
    assert.ok(typeof b.displayText === 'string' && b.displayText.trim(), b.id);
  }
});

test('toggle colours are palette keys', () => {
  for (const b of buttons) if (b.toggle) {
    assert.ok(palette.includes(b.toggle.colourOn), b.id);
    assert.ok(palette.includes(b.toggle.colourOff), b.id);
  }
});

test('exactly one moreButtonsActive toggle, on popup', () => {
  const t = buttons.filter(b => b.toggle?.storageKey === 'moreButtonsActive');
  assert.equal(t.length, 1);
  assert.equal(t[0].surface, 'popup');
});

test('deleted ids are gone', () => {
  for (const id of ['mb-example-btn', 'mb-switch-focus-toggle-btn', 'mb-generate-client-email-btn', 'mb-more-site-options-btn']) assert.equal(byId(id), undefined, id);
});

test('renamed ids exist, old ids gone', () => {
  for (const id of ['mb-qr-poster-builder-btn', 'mb-site-preset-btn', 'mb-report-type-preset-btn']) assert.ok(byId(id), id);
  for (const id of ['mb-generate-qr-btn', 'mb-apply-preset-btn', 'mb-apply-report-type-preset-btn']) assert.equal(byId(id), undefined, id);
});

console.log(`${passed} passed`);
