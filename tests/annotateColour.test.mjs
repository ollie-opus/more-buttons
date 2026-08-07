import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// captureMode.js touches window.sessionStorage at call time only, but import
// is side-effect free — a minimal window stub is enough to load the module.
globalThis.window = {
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
};
const { annotateColourEntries, resolveAnnotateColour } = await import('../scripts/captureMode.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const palette = JSON.parse(
  await readFile(new URL('../config/labelColours.json', import.meta.url), 'utf8'),
);
const entries = annotateColourEntries(palette.chromatic);

const NEUTRAL_SLUGS = ['slate', 'grey', 'zinc', 'neutral', 'stone', 'taupe', 'mauve', 'mist', 'olive'];

test('the real palette yields exactly the 17 chromatic entries, no neutrals', () => {
  assert.equal(entries.length, 17);
  const slugs = entries.map(e => e.slug);
  for (const neutral of NEUTRAL_SLUGS) {
    assert.ok(!slugs.includes(neutral), `neutral slug leaked in: ${neutral}`);
  }
});

test('green is pinned to the annotate-mode chrome green, not the palette border', () => {
  const green = entries.find(e => e.slug === 'green');
  assert.ok(green, 'no green entry');
  assert.equal(green.colour, '#22c55e');
});

test('a non-green slug maps to its dark.border value', () => {
  const red = entries.find(e => e.slug === 'red');
  assert.ok(red, 'no red entry');
  assert.equal(red.colour, palette.chromatic.Red.dark.border);
});

test('missing palette (fetch failure) degrades to a green-only fallback', () => {
  const fallback = annotateColourEntries(null);
  assert.deepEqual(fallback.map(e => e.slug), ['green']);
  assert.equal(fallback[0].colour, '#22c55e');
});

test('resolveAnnotateColour returns the entry colour for a known slug', () => {
  const blue = entries.find(e => e.slug === 'blue');
  assert.equal(resolveAnnotateColour('blue', entries), blue.colour);
});

test('resolveAnnotateColour falls back to green for an unknown slug', () => {
  assert.equal(resolveAnnotateColour('vantablack', entries), '#22c55e');
  assert.equal(resolveAnnotateColour('green', annotateColourEntries(null)), '#22c55e');
});

console.log(`\nannotateColour: ${passed} tests passed`);
