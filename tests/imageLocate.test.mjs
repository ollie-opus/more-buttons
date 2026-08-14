import assert from 'node:assert/strict';
import { buildImageLines } from '../scripts/images.js';
import { locateImageLines, ensureImageUUIDs, locateCaptureLines } from '../scripts/components.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

test('build → locate round-trips every dim mode', () => {
  for (const spec of [
    { uuid: 'A', filename: 'media/buttons/a.png', dimMode: 'height', dimValue: 50, rounded: false },
    { uuid: 'B', filename: 'media/other/b.svg', dimMode: 'width', dimValue: 300, rounded: true },
    { uuid: 'C', filename: 'media/other/c.webp', dimMode: 'none', dimValue: null, rounded: false },
  ]) {
    const [got] = locateImageLines(buildImageLines([spec]).join('\n'));
    assert.deepEqual(
      { uuid: got.uuid, filename: got.filename, dimMode: got.dimMode, dimValue: got.dimValue, rounded: got.rounded },
      spec);
  }
});

test('the preceding uuid span is swallowed into startLine', () => {
  const body = ['before', ...buildImageLines([{ uuid: 'IMG-1', filename: 'media/buttons/x.png', dimMode: 'none', dimValue: null, rounded: false }])].join('\n');
  const [got] = locateImageLines(body);
  assert.equal(got.uuid, 'IMG-1');
  assert.equal(got.startLine, 2); // 'before', '', span, image
  assert.equal(got.endLine, 4);
});

test('ensureImageUUIDs backfills a span and is idempotent', () => {
  const md = '![](../assets/media/buttons/x.png)';
  const once = ensureImageUUIDs(md);
  assert.match(once, /<span data-uuid="[^"]+" style="display:none"><\/span>\n!\[\]/);
  assert.equal(ensureImageUUIDs(once), once);
});

test('negative: a capture light line (#only-light) is not an image', () => {
  const md = '![](../assets/media/occ-captures/a-light-mode.png#only-light){ width="800" }';
  assert.equal(locateImageLines(md).length, 0);
});

test('negative: a hashless -light-mode/-dark-mode file is a capture half, not an image', () => {
  assert.equal(locateImageLines('![](../assets/media/x-light-mode.png)').length, 0);
  assert.equal(locateImageLines('![](../assets/media/x-dark-mode.svg)').length, 0);
});

test('negative: a non-image extension (pdf) is not an image component', () => {
  assert.equal(locateImageLines('![](../assets/media/other/doc.pdf)').length, 0);
});

test('negative: an image with alt text stays description prose', () => {
  assert.equal(locateImageLines('![screenshot](../assets/media/buttons/x.png)').length, 0);
});

test('an image line never steals the capture parse (both coexist)', () => {
  const body = [
    '<span data-uuid="CAP-1" style="display:none"></span>',
    '![](../assets/media/occ-captures/a-light-mode.png#only-light)',
    '![](../assets/media/occ-captures/a-dark-mode.png#only-dark)',
    '',
    '<span data-uuid="IMG-1" style="display:none"></span>',
    '![](../assets/media/buttons/b.png)',
  ].join('\n');
  assert.equal(locateCaptureLines(body).length, 1);
  const imgs = locateImageLines(body);
  assert.equal(imgs.length, 1);
  assert.equal(imgs[0].uuid, 'IMG-1');
});

console.log(`imageLocate: ${passed} passed`);
