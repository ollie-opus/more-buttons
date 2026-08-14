import assert from 'node:assert/strict';
import { buildImageLines, IMAGE_CORNER_RADIUS } from '../scripts/images.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const base = { uuid: 'IMG-1', filename: 'media/buttons/menu-icon.png' };
// buildImageLines returns ['', span, imageLine]; grab the image line.
function img(spec) {
  return buildImageLines([spec]).find(l => l.startsWith('!['));
}

test('height sizing rides the style attr', () => {
  assert.equal(img({ ...base, dimMode: 'height', dimValue: 50, rounded: false }),
    '![](../assets/media/buttons/menu-icon.png){ style="height: 50px" loading=lazy }');
});

test('width sizing is a width="" attr', () => {
  assert.equal(img({ ...base, dimMode: 'width', dimValue: 300, rounded: false }),
    '![](../assets/media/buttons/menu-icon.png){ width="300" loading=lazy }');
});

test('rounding folds border-radius into the style segment', () => {
  assert.equal(img({ ...base, dimMode: 'height', dimValue: 50, rounded: true }),
    `![](../assets/media/buttons/menu-icon.png){ style="height: 50px; border-radius: ${IMAGE_CORNER_RADIUS}px" loading=lazy }`);
});

test('width + rounding keeps both a style and the width attr', () => {
  assert.equal(img({ ...base, dimMode: 'width', dimValue: 300, rounded: true }),
    `![](../assets/media/buttons/menu-icon.png){ style="border-radius: ${IMAGE_CORNER_RADIUS}px" width="300" loading=lazy }`);
});

test('auto WITH rounding emits a style holding only border-radius', () => {
  assert.equal(img({ ...base, dimMode: 'none', dimValue: null, rounded: true }),
    `![](../assets/media/buttons/menu-icon.png){ style="border-radius: ${IMAGE_CORNER_RADIUS}px" loading=lazy }`);
});

test('auto with no rounding emits NO attr block (hand-written form round-trips)', () => {
  assert.equal(img({ ...base, dimMode: 'none', dimValue: null, rounded: false }),
    '![](../assets/media/buttons/menu-icon.png)');
});

test('uuid span is emitted before the image line; none without a uuid', () => {
  const out = buildImageLines([{ ...base, dimMode: 'none', dimValue: null, rounded: false }]);
  assert.equal(out[0], '');
  assert.equal(out[1], '<span data-uuid="IMG-1" style="display:none"></span>');
  const bare = buildImageLines([{ filename: base.filename, dimMode: 'none', dimValue: null, rounded: false }]);
  assert.equal(bare.length, 2);
});

console.log(`imageBuildLines: ${passed} passed`);
