import assert from 'node:assert/strict';
import { buildVideoLines } from '../scripts/videos.js';
import { locateVideoLines, ensureVideoUUIDs } from '../scripts/components.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

function bodyFor(spec) {
  // buildVideoLines yields ['', span?, light, dark?]; drop the leading ''.
  return buildVideoLines([spec]).slice(1).join('\n');
}

test('round-trips an animation pair with width + inversed + rounded', () => {
  const spec = { uuid: 'VID-1', lightFilename: 'media/videos/a-light-mode.mp4', darkFilename: 'media/videos/a-dark-mode.mp4', dimMode: 'width', dimValue: 1000, inversed: true, rounded: true, playback: 'animation' };
  const [v] = locateVideoLines(bodyFor(spec));
  assert.equal(v.lightFilename, 'media/videos/a-light-mode.mp4');
  assert.equal(v.darkFilename, 'media/videos/a-dark-mode.mp4');
  assert.equal(v.single, false);
  assert.equal(v.dimMode, 'width');
  assert.equal(v.dimValue, 1000);
  assert.equal(v.inversed, true);
  assert.equal(v.rounded, true);
  assert.equal(v.playback, 'animation');
  assert.equal(v.uuid, 'VID-1');
});

test('detects a clip pair via the controls attribute', () => {
  const spec = { uuid: 'VID-2', lightFilename: 'media/videos/b-light-mode.mp4', darkFilename: 'media/videos/b-dark-mode.mp4', dimMode: 'height', dimValue: 500, inversed: false, rounded: false, playback: 'clip' };
  const [v] = locateVideoLines(bodyFor(spec));
  assert.equal(v.playback, 'clip');
  assert.equal(v.dimMode, 'height');
  assert.equal(v.dimValue, 500);
});

test('detects a single (theme-agnostic) video', () => {
  const spec = { uuid: 'VID-3', lightFilename: 'media/videos/intro.mp4', darkFilename: null, dimMode: 'none', dimValue: null, inversed: false, rounded: false, playback: 'animation' };
  const found = locateVideoLines(bodyFor(spec));
  assert.equal(found.length, 1);
  assert.equal(found[0].single, true);
  assert.equal(found[0].darkFilename, null);
  assert.equal(found[0].dimMode, 'none');
});

test('a webm single video is recognised', () => {
  const body = '<video src="../assets/media/videos/clip.webm" controls playsinline preload="metadata"></video>';
  const [v] = locateVideoLines(body);
  assert.equal(v.single, true);
  assert.equal(v.lightFilename, 'media/videos/clip.webm');
  assert.equal(v.playback, 'clip');
});

test('ensureVideoUUIDs backfills a span before an unidentified video', () => {
  const body = '<video src="../assets/media/videos/intro.mp4" autoplay loop muted playsinline preload="none"></video>';
  const out = ensureVideoUUIDs(body);
  assert.match(out, /<span data-uuid="[^"]+" style="display:none"><\/span>\n<video/);
  // idempotent
  assert.equal(ensureVideoUUIDs(out), out);
});

console.log(`videoLocate: ${passed} passed`);
