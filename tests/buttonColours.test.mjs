import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// No build step generates the CSS palette from buttonColours.json, so this
// sync test is the guard that keeps the two hand-maintained copies aligned.

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const palette = JSON.parse(read('../config/buttonColours.json'));
const css = read('../config/forms/formsStyling.css');
const names = Object.keys(palette);
const HEX = /^#[0-9a-f]{6}$/;

function isListNames(re) {
  const m = css.match(re);
  assert.ok(m, `no rule matching ${re}`);
  return m[1].split(',').map(s => s.trim().replace(/^\./, ''));
}

test('palette has 21 entries, each with light + dark hex', () => {
  assert.equal(names.length, 21);
  for (const name of names) {
    assert.match(palette[name].light, HEX, `${name}.light`);
    assert.match(palette[name].dark, HEX, `${name}.dark`);
  }
});

test('each colour has exactly two CSS tokens (light then dark) matching the JSON', () => {
  for (const name of names) {
    const re = new RegExp(`--mb-col-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`, 'g');
    const hexes = [...css.matchAll(re)].map(m => m[1].toLowerCase());
    assert.deepEqual(hexes, [palette[name].light, palette[name].dark], `--mb-col-${name}`);
  }
});

test('each colour has a .more-buttons-button.<name> accent rule', () => {
  for (const name of names) {
    const re = new RegExp(`\\.more-buttons-button\\.${name}\\s*\\{\\s*--mb-acc:\\s*var\\(--mb-col-${name}\\);\\s*\\}`);
    assert.match(css, re, `.more-buttons-button.${name}`);
  }
});

test('the faint-fill :is() list contains every colour', () => {
  const list = isListNames(/\.more-buttons-button:is\(([^)]*)\)\s*\{/);
  assert.deepEqual([...list].sort(), [...names].sort());
});

test('the hover :is() list contains every colour', () => {
  const list = isListNames(/\.more-buttons-button:is\(([^)]*)\):hover\s*\{/);
  assert.deepEqual([...list].sort(), [...names].sort());
});

test('no --mb-col-* token in the CSS is absent from the JSON', () => {
  const used = new Set([...css.matchAll(/--mb-col-([a-z]+)/g)].map(m => m[1]));
  for (const name of used) assert.ok(names.includes(name), `stray --mb-col-${name}`);
});

console.log(`${passed} passed`);
