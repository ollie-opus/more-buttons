import assert from 'node:assert/strict';
import { compositeColorStack, voteBackgroundColor, bgProbePoints } from '../scripts/captureElement.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

test('empty stack falls back to opaque white', () => {
  assert.equal(compositeColorStack([]), 'rgb(255, 255, 255)');
});

test('single opaque colour passes through', () => {
  assert.equal(compositeColorStack([[30, 40, 56, 1]]), 'rgb(30, 40, 56)');
});

test('semi-transparent layer over an opaque one composites (the dark-padding bug)', () => {
  // rgba(30,40,56,.5) veil over an opaque rgb(23,32,48) page background —
  // must yield the blended OPAQUE colour, never the raw semi-transparent veil.
  assert.equal(compositeColorStack([[30, 40, 56, 0.5], [23, 32, 48, 1]]), 'rgb(27, 36, 52)');
});

test('semi-transparent layer with no opaque ancestor blends over the white base', () => {
  assert.equal(compositeColorStack([[0, 0, 0, 0.5]]), 'rgb(128, 128, 128)');
});

test('layers below an opaque one are ignored', () => {
  assert.equal(compositeColorStack([[10, 20, 30, 1], [200, 0, 0, 0.9]]), 'rgb(10, 20, 30)');
});

test('two semi-transparent layers stack in order (nearest last-applied)', () => {
  // white base → 50% black → 50% white = rgb(191.5) rounded 192? compute:
  // base 255 → over 0.5 black: 127.5 → over 0.5 white: 191.25 → round 191
  assert.equal(compositeColorStack([[255, 255, 255, 0.5], [0, 0, 0, 0.5]]), 'rgb(191, 191, 191)');
});

test('out-of-range alpha is clamped', () => {
  assert.equal(compositeColorStack([[50, 60, 70, 1.5]]), 'rgb(50, 60, 70)');
  assert.equal(compositeColorStack([[50, 60, 70, -1]]), 'rgb(255, 255, 255)');
});

// Probes that land outside the viewport hit no page node and come back null.
// They used to be counted as opaque white, so a full-width header (left/right
// probes off-screen) got a white padding band in dark mode.
test('off-viewport probes (null) do not vote', () => {
  const dark = 'rgb(54, 65, 83)', body = 'rgb(16, 24, 40)';
  const colors = [dark, dark, dark, body, body, body, null, null, null, null, null, null];
  assert.equal(voteBackgroundColor(colors), dark);
});

test('vote with no on-screen probes yields null, not white', () => {
  assert.equal(voteBackgroundColor([null, null, null]), null);
  assert.equal(voteBackgroundColor([]), null);
});

test('vote ties resolve to the first colour seen', () => {
  assert.equal(voteBackgroundColor(['rgb(1, 1, 1)', 'rgb(2, 2, 2)', 'rgb(2, 2, 2)', 'rgb(1, 1, 1)']), 'rgb(1, 1, 1)');
});

test('probe points sit `offset` outside the rect, three per side', () => {
  const pts = bgProbePoints({ left: 100, top: 50, width: 200, height: 80 }, 3);
  assert.equal(pts.length, 12);
  assert.deepEqual(pts[1], [200, 47]);   // top centre
  assert.deepEqual(pts[4], [200, 133]);  // bottom centre
  assert.deepEqual(pts[7], [97, 90]);    // left middle
  assert.deepEqual(pts[10], [303, 90]);  // right middle
});

test('a negative offset moves the probes inside the rect', () => {
  const pts = bgProbePoints({ left: 0, top: 0, width: 200, height: 80 }, -3);
  assert.deepEqual(pts[1], [100, 3]);
  assert.deepEqual(pts[7], [3, 40]);
  assert.deepEqual(pts[10], [197, 40]);
});

console.log(`\n${passed} passed`);
