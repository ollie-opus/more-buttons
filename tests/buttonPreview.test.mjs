import assert from 'node:assert/strict';
import { paintedSide, strongLightBorder, buttonTileColours } from '../scripts/buttonPreview.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// A chromatic preset: light border transparent by design (like Red).
const CHROMATIC = {
  light: { bg: 'rgb(255,226,226)', text: 'rgb(159,7,18)', border: 'transparent' },
  dark: { bg: 'rgb(159,7,18)', text: 'rgb(255,226,226)', border: 'rgb(251,44,54)' },
};
// A neutral preset: curated light border (like Slate).
const NEUTRAL = {
  light: { bg: 'rgb(226,232,240)', text: 'rgb(49,65,88)', border: 'rgb(144,161,185)' },
  dark: { bg: 'rgb(49,65,88)', text: 'rgb(241,245,249)', border: 'rgb(98,116,142)' },
};
const CHROMATIC_STRONG = 'color-mix(in srgb, rgb(159,7,18) 30%, transparent)';

// ── paintedSide: the 4×2 theme/tile matrix ───────────────────────────────────

test('paintedSide: full theme × tile matrix', () => {
  const expected = {
    'default': { light: 'light', dark: 'dark' },
    'inversed': { light: 'dark', dark: 'light' },
    'force-light': { light: 'light', dark: 'light' },
    'force-dark': { light: 'dark', dark: 'dark' },
  };
  for (const [theme, byTile] of Object.entries(expected)) {
    for (const [tile, side] of Object.entries(byTile)) {
      assert.equal(paintedSide(theme, tile), side, `${theme}/${tile}`);
    }
  }
});

// ── strongLightBorder ────────────────────────────────────────────────────────

test('strongLightBorder: neutral uses its curated border', () => {
  assert.equal(strongLightBorder(NEUTRAL), 'rgb(144,161,185)');
});

test('strongLightBorder: chromatic falls back to color-mix of the light fg', () => {
  assert.equal(strongLightBorder(CHROMATIC), CHROMATIC_STRONG);
});

// ── buttonTileColours: painting ──────────────────────────────────────────────

test('default theme paints each tile with its own trio', () => {
  const light = buttonTileColours({ preset: CHROMATIC, tile: 'light' });
  assert.equal(light.background, CHROMATIC.light.bg);
  assert.equal(light.color, CHROMATIC.light.text);
  assert.equal(light.hover, 'brightness(0.95)');
  assert.equal(light.hoverStrong, 'brightness(0.9)');
  const dark = buttonTileColours({ preset: CHROMATIC, tile: 'dark' });
  assert.equal(dark.background, CHROMATIC.dark.bg);
  assert.equal(dark.color, CHROMATIC.dark.text);
  assert.equal(dark.hover, 'brightness(1.15)');
  assert.equal(dark.hoverStrong, 'brightness(1.3)');
});

test('inversed swaps the trios (and the hover follows the painted trio)', () => {
  const light = buttonTileColours({ preset: CHROMATIC, theme: 'inversed', tile: 'light' });
  assert.equal(light.background, CHROMATIC.dark.bg);
  assert.equal(light.hover, 'brightness(1.15)');
  assert.equal(light.hoverStrong, 'brightness(1.3)');
  const dark = buttonTileColours({ preset: CHROMATIC, theme: 'inversed', tile: 'dark' });
  assert.equal(dark.background, CHROMATIC.light.bg);
  assert.equal(dark.hover, 'brightness(0.95)');
});

test('force-light / force-dark paint the same trio on both tiles', () => {
  for (const tile of ['light', 'dark']) {
    assert.equal(buttonTileColours({ preset: NEUTRAL, theme: 'force-light', tile }).background, NEUTRAL.light.bg);
    assert.equal(buttonTileColours({ preset: NEUTRAL, theme: 'force-dark', tile }).background, NEUTRAL.dark.bg);
  }
});

// ── buttonTileColours: borders (follow the painted trio, not the tile) ───────

test('border default: trio border (chromatic light transparent, dark coloured)', () => {
  assert.equal(buttonTileColours({ preset: CHROMATIC, tile: 'light' }).borderColor, 'transparent');
  assert.equal(buttonTileColours({ preset: CHROMATIC, tile: 'dark' }).borderColor, CHROMATIC.dark.border);
  assert.equal(buttonTileColours({ preset: NEUTRAL, tile: 'light' }).borderColor, NEUTRAL.light.border);
});

test('bordered: strong light border on the light trio, dark border on the dark trio', () => {
  assert.equal(buttonTileColours({ preset: CHROMATIC, border: 'bordered', tile: 'light' }).borderColor, CHROMATIC_STRONG);
  assert.equal(buttonTileColours({ preset: CHROMATIC, border: 'bordered', tile: 'dark' }).borderColor, CHROMATIC.dark.border);
  assert.equal(buttonTileColours({ preset: NEUTRAL, border: 'bordered', tile: 'light' }).borderColor, NEUTRAL.light.border);
  assert.equal(buttonTileColours({ preset: NEUTRAL, border: 'bordered', tile: 'dark' }).borderColor, NEUTRAL.dark.border);
});

test('border-light: only when the LIGHT trio paints', () => {
  assert.equal(buttonTileColours({ preset: NEUTRAL, border: 'border-light', tile: 'light' }).borderColor, NEUTRAL.light.border);
  assert.equal(buttonTileColours({ preset: NEUTRAL, border: 'border-light', tile: 'dark' }).borderColor, 'transparent');
});

test('border-light + inversed: the dark TILE paints the light trio → strong border', () => {
  const dark = buttonTileColours({ preset: CHROMATIC, theme: 'inversed', border: 'border-light', tile: 'dark' });
  assert.equal(dark.borderColor, CHROMATIC_STRONG);
  const light = buttonTileColours({ preset: CHROMATIC, theme: 'inversed', border: 'border-light', tile: 'light' });
  assert.equal(light.borderColor, 'transparent');
});

test('border-dark: only when the DARK trio paints', () => {
  assert.equal(buttonTileColours({ preset: CHROMATIC, border: 'border-dark', tile: 'dark' }).borderColor, CHROMATIC.dark.border);
  assert.equal(buttonTileColours({ preset: CHROMATIC, border: 'border-dark', tile: 'light' }).borderColor, 'transparent');
  // force-dark: the dark trio paints BOTH tiles → both get the dark border
  assert.equal(buttonTileColours({ preset: CHROMATIC, theme: 'force-dark', border: 'border-dark', tile: 'light' }).borderColor, CHROMATIC.dark.border);
});

test('borderless: always transparent, every theme, both tiles', () => {
  for (const theme of ['default', 'inversed', 'force-light', 'force-dark']) {
    for (const tile of ['light', 'dark']) {
      assert.equal(
        buttonTileColours({ preset: NEUTRAL, theme, border: 'borderless', tile }).borderColor,
        'transparent', `${theme}/${tile}`);
    }
  }
});

console.log(`\n${passed} passed`);
