import assert from 'node:assert/strict';
import { CAPTURE_PRESETS, WIDTHS, capturePresetShape, capturePresetOf, applyCapturePreset, looksLikeButton } from '../scripts/capturePresets.js';

globalThis.window = { sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } };
const { capturePathBase, capturePairFor, insertPlan } = await import('../scripts/kbSiteCapture.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

test('the presets, in the order the settings show them', () => {
  assert.deepEqual(CAPTURE_PRESETS.map(p => p[0]), ['button', 'xs', 'sm', 'md', 'lg', 'auto', 'custom']);
  assert.deepEqual(WIDTHS, { xs: 200, sm: 300, md: 400, lg: 500 });
});

test('every capture already written reads as a preset', () => {
  assert.equal(capturePresetOf({ dimMode: 'height', dimValue: 50, rounded: false }), 'button');
  assert.equal(capturePresetOf({ dimMode: 'width', dimValue: 200, rounded: true }), 'xs');
  assert.equal(capturePresetOf({ dimMode: 'width', dimValue: 300, rounded: true }), 'sm');
  assert.equal(capturePresetOf({ dimMode: 'width', dimValue: 400, rounded: true }), 'md');
  assert.equal(capturePresetOf({ dimMode: 'width', dimValue: 500, rounded: true }), 'lg');
  assert.equal(capturePresetOf({ dimMode: 'none', dimValue: null, rounded: true }), 'auto');
  // The rest are custom: another height, another width, or square corners.
  assert.equal(capturePresetOf({ dimMode: 'height', dimValue: 30, rounded: false }), 'custom');
  assert.equal(capturePresetOf({ dimMode: 'width', dimValue: 350, rounded: true }), 'custom');
  assert.equal(capturePresetOf({ dimMode: 'width', dimValue: 400, rounded: false }), 'custom');
  assert.equal(capturePresetOf({ dimMode: 'none', dimValue: null, rounded: false }), 'custom');
  assert.equal(capturePresetOf({ dimMode: 'height', dimValue: 50, rounded: true }), 'custom');
});

test('a preset sets size and corners together, and round-trips', () => {
  for (const name of ['button', 'xs', 'sm', 'md', 'lg', 'auto']) {
    const cap = applyCapturePreset({ uuid: 'u', lightFilename: 'a', dimMode: 'width', dimValue: 123, rounded: false, inversed: true }, name);
    assert.equal(capturePresetOf(cap), name);
    assert.equal(cap.inversed, true, 'theme is not a preset\'s business');
    assert.equal(cap.lightFilename, 'a');
  }
  assert.deepEqual(capturePresetShape('button'), { dimMode: 'height', dimValue: 50, rounded: false });
});

test('custom keeps the size it has and turns rounding on', () => {
  const cap = applyCapturePreset({ dimMode: 'height', dimValue: 50, rounded: false }, 'custom');
  assert.deepEqual(cap, { dimMode: 'height', dimValue: 50, rounded: true });
  assert.equal(capturePresetShape('custom'), null);
});

test('the icon / button question is pre-answered from what was captured', () => {
  // Buttons, icons, chips.
  assert.equal(looksLikeButton({ width: 96, height: 36, control: true }), true);
  assert.equal(looksLikeButton({ width: 24, height: 24, control: false }), true);
  assert.equal(looksLikeButton({ width: 380, height: 44, control: true }), true, 'a wide button is still a button');
  assert.equal(looksLikeButton({ width: 800, height: 600, control: false, svg: true }), true, 'an extracted SVG is an icon');
  // Screens, cards, rows.
  assert.equal(looksLikeButton({ width: 900, height: 520, control: false }), false);
  assert.equal(looksLikeButton({ width: 1100, height: 48, control: false }), false, 'a table row is short but not a button');
  assert.equal(looksLikeButton({ width: 320, height: 240, control: true }), false, 'a card that happens to be a link');
  assert.equal(looksLikeButton({ width: 340, height: 40, control: false }), false);
  // Nothing recorded (a capture buffered before this existed): no.
  assert.equal(looksLikeButton(null), false);
  assert.equal(looksLikeButton({ width: 0, height: 0, control: true }), false);
});

// ── The webapp dialog's path and insert rules (kbSiteCapture.js) ─────────────

const CAPTURE = { lightFilename: 'media/occ-captures/sites/list-light-mode.png', darkFilename: 'media/occ-captures/sites/list-dark-mode.png' };

test('the path shown is the pair\'s name without folder or theme tail', () => {
  assert.equal(capturePathBase(CAPTURE.lightFilename), 'sites/list');
  assert.equal(capturePathBase('docs/assets/media/occ-captures/a/b-dark-mode.svg'), 'a/b');
});

test('a typed path names the pair to push; an emptied one falls back; the extension is kept', () => {
  assert.deepEqual(capturePairFor(' /users/edit/ ', CAPTURE), {
    base: 'users/edit',
    lightFilename: 'media/occ-captures/users/edit-light-mode.png',
    darkFilename: 'media/occ-captures/users/edit-dark-mode.png',
  });
  assert.equal(capturePairFor('  ', CAPTURE).base, 'sites/list');
  assert.equal(capturePairFor('x', { lightFilename: 'media/occ-captures/x-light-mode.svg' }).darkFilename, 'media/occ-captures/x-dark-mode.svg');
});

test('a capture already in the library is the one used; nothing is ever replaced', () => {
  assert.equal(insertPlan({ lightExists: true, darkExists: true }), 'existing');
  assert.equal(insertPlan({ lightExists: false, darkExists: false }), 'create');
  // Half a pair: the missing half is pushed, the stored half left as it is.
  assert.equal(insertPlan({ lightExists: true, darkExists: false }), 'create');
  assert.equal(insertPlan({ lightExists: false, darkExists: true }), 'create');
});

console.log(`capturePresets: ${passed} passed`);
