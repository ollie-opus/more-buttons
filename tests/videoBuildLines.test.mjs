import assert from 'node:assert/strict';
import { buildVideoLines, VIDEO_CORNER_RADIUS } from '../scripts/videos.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const base = { uuid: 'VID-1', lightFilename: 'media/videos/a-light-mode.mp4', darkFilename: 'media/videos/a-dark-mode.mp4' };
// buildVideoLines returns ['', span, lightLine, darkLine?]; grab the <video> lines.
function vids(spec) {
  return buildVideoLines([spec]).filter(l => l.startsWith('<video'));
}

test('animation pair: default theme, width sizing', () => {
  const [light, dark] = vids({ ...base, dimMode: 'width', dimValue: 1000, inversed: false, rounded: false, playback: 'animation' });
  assert.equal(light, '<video src="../assets/media/videos/a-light-mode.mp4#only-light" autoplay loop muted playsinline preload="none" style="width: 1000px"></video>');
  assert.equal(dark,  '<video src="../assets/media/videos/a-dark-mode.mp4#only-dark" autoplay loop muted playsinline preload="none" style="width: 1000px"></video>');
});

test('inversed theme swaps the #only hashes onto the opposite files', () => {
  const [light, dark] = vids({ ...base, dimMode: 'width', dimValue: 1000, inversed: true, rounded: false, playback: 'animation' });
  assert.ok(light.includes('a-light-mode.mp4#only-dark'));
  assert.ok(dark.includes('a-dark-mode.mp4#only-light'));
});

test('clip pair: controls + metadata, no autoplay/loop', () => {
  const [light] = vids({ ...base, dimMode: 'height', dimValue: 500, inversed: false, rounded: false, playback: 'clip' });
  assert.equal(light, '<video src="../assets/media/videos/a-light-mode.mp4#only-light" controls playsinline preload="metadata" style="height: 500px"></video>');
});

test('rounding folds border-radius into the style', () => {
  const [light] = vids({ ...base, dimMode: 'width', dimValue: 1000, inversed: false, rounded: true, playback: 'animation' });
  assert.equal(light, `<video src="../assets/media/videos/a-light-mode.mp4#only-light" autoplay loop muted playsinline preload="none" style="width: 1000px; border-radius: ${VIDEO_CORNER_RADIUS}px"></video>`);
});

test('auto size with no rounding emits no style attribute', () => {
  const [light] = vids({ ...base, dimMode: 'none', dimValue: null, inversed: false, rounded: false, playback: 'animation' });
  assert.equal(light, '<video src="../assets/media/videos/a-light-mode.mp4#only-light" autoplay loop muted playsinline preload="none"></video>');
});

test('auto size WITH rounding emits a style holding only border-radius', () => {
  const [light] = vids({ ...base, dimMode: 'none', dimValue: null, inversed: false, rounded: true, playback: 'animation' });
  assert.equal(light, `<video src="../assets/media/videos/a-light-mode.mp4#only-light" autoplay loop muted playsinline preload="none" style="border-radius: ${VIDEO_CORNER_RADIUS}px"></video>`);
});

test('single video: one element, no #only fragment, no dark line', () => {
  const out = vids({ uuid: 'VID-2', lightFilename: 'media/videos/intro.mp4', darkFilename: null, dimMode: 'width', dimValue: 800, inversed: false, rounded: false, playback: 'animation' });
  assert.equal(out.length, 1);
  assert.equal(out[0], '<video src="../assets/media/videos/intro.mp4" autoplay loop muted playsinline preload="none" style="width: 800px"></video>');
});

test('uuid span is emitted before the first video line', () => {
  const out = buildVideoLines([{ ...base, dimMode: 'none', dimValue: null, inversed: false, rounded: false, playback: 'animation' }]);
  assert.equal(out[0], '');
  assert.equal(out[1], '<span data-uuid="VID-1" style="display:none"></span>');
});

console.log(`videoBuildLines: ${passed} passed`);
