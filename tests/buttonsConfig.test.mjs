import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
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

test('surface is page, popup, both or undefined', () => {
  for (const b of buttons) assert.ok([undefined, 'page', 'popup', 'both'].includes(b.surface), b.id);
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
  for (const id of ['mb-example-btn', 'mb-switch-focus-toggle-btn', 'mb-generate-client-email-btn', 'mb-more-site-options-btn', 'mb-copy-reg-email-btn', 'mb-copy-seed-client-email-btn']) assert.equal(byId(id), undefined, id);
});

test('renamed ids exist, old ids gone', () => {
  for (const id of ['mb-qr-poster-builder-btn', 'mb-site-preset-btn', 'mb-report-type-preset-btn']) assert.ok(byId(id), id);
  for (const id of ['mb-generate-qr-btn', 'mb-apply-preset-btn', 'mb-apply-report-type-preset-btn']) assert.equal(byId(id), undefined, id);
});

const actionsSrc = readFileSync(fileURLToPath(new URL('../scripts/actions.js', import.meta.url)), 'utf8');
const exported = new Set();
for (const m of actionsSrc.matchAll(/export\s*\{([^}]*)\}/g)) {
  for (const part of m[1].split(',')) {
    const names = part.trim().split(/\s+as\s+/);
    if (names[0]) exported.add(names.at(-1).trim());
  }
}
for (const m of actionsSrc.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) exported.add(m[1]);

test('every action name is exported from scripts/actions.js', () => {
  assert.ok(exported.size > 10);
  for (const b of buttons) {
    const name = b.action.split(':')[0];
    assert.ok(exported.has(name), `${b.id}: ${name} not exported`);
  }
});

test('every createForm:<name> action has config/forms/<name>.html', () => {
  for (const b of buttons) {
    const [fn, arg] = b.action.split(':');
    if (fn !== 'createForm') continue;
    assert.ok(existsSync(fileURLToPath(new URL(`../config/forms/${arg}.html`, import.meta.url))), `${b.id}: ${arg}.html`);
  }
});

console.log(`${passed} passed`);
