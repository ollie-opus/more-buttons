import assert from 'node:assert/strict';
import { buildVideoLines } from '../scripts/videos.js';
import { parseComponents, buildComponentBody, videoDimFields, uuidOfComponent } from '../scripts/components.js';

const ADM_RE = /note|tip|step/;
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

test('videoDimFields maps a sized inversed clip to form-facing values', () => {
  const vid = { dimMode: 'width', dimValue: 800, inversed: true, rounded: true, playback: 'clip' };
  assert.deepEqual(videoDimFields(vid), { dimMode: 'width', dimValue: '800', captureTheme: 'inversed', captureCorner: 'enabled', videoPlayback: 'clip' });
});

test('videoDimFields of an auto/default video', () => {
  const vid = { dimMode: 'none', dimValue: null };
  assert.deepEqual(videoDimFields(vid), { dimMode: 'none', dimValue: '', captureTheme: 'default', captureCorner: 'disabled', videoPlayback: 'animation' });
});

test('a video round-trips through buildComponentBody / parseComponents', () => {
  const vid = { uuid: 'VID-1', lightFilename: 'media/videos/a-light-mode.mp4', darkFilename: 'media/videos/a-dark-mode.mp4', dimMode: 'width', dimValue: 1000, inversed: false, rounded: false, playback: 'animation' };
  const body = buildComponentBody(null, 'Desc', [{ kind: 'video', vid }]);
  const got = parseComponents(body, ADM_RE).components.find(c => c.kind === 'video')?.vid;
  assert.ok(got);
  assert.equal(got.lightFilename, 'media/videos/a-light-mode.mp4');
  assert.equal(got.darkFilename, 'media/videos/a-dark-mode.mp4');
  assert.equal(got.playback, 'animation');
  assert.equal(got.dimValue, 1000);
});

test('a single video round-trips', () => {
  const vid = { uuid: 'VID-2', lightFilename: 'media/videos/intro.mp4', darkFilename: null, dimMode: 'none', dimValue: null, inversed: false, rounded: false, playback: 'clip' };
  const body = buildComponentBody(null, '', [{ kind: 'video', vid }]);
  const got = parseComponents(body, ADM_RE).components.find(c => c.kind === 'video')?.vid;
  assert.equal(got.single, true);
  assert.equal(got.darkFilename, null);
  assert.equal(got.playback, 'clip');
});

test('a video interleaves with a capture in document order', () => {
  const cap = { uuid: 'CAP-1', lightFilename: 'a-light-mode.png', darkFilename: 'a-dark-mode.png', dimMode: 'none', dimValue: null, inversed: false, rounded: false };
  const vid = { uuid: 'VID-1', lightFilename: 'media/videos/b-light-mode.mp4', darkFilename: 'media/videos/b-dark-mode.mp4', dimMode: 'none', dimValue: null, inversed: false, rounded: false, playback: 'animation' };
  const body = buildComponentBody(null, '', [{ kind: 'capture', cap }, { kind: 'video', vid }]);
  const kinds = parseComponents(body, ADM_RE).components.map(c => c.kind);
  assert.deepEqual(kinds, ['capture', 'video']);
});

test('uuidOfComponent returns a video uuid', () => {
  assert.equal(uuidOfComponent({ kind: 'video', vid: { uuid: 'VID-9' } }), 'VID-9');
});

console.log(`videoComponent: ${passed} passed`);
