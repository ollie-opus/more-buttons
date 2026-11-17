import assert from 'node:assert/strict';
import { isolationPhase, coveringIndex } from '../scripts/captureIsolate.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

test('toggle off is always off, whatever the mode or Shift', () => {
  assert.equal(isolationPhase({ on: false, mode: 'isolate', armed: true }), 'off');
  assert.equal(isolationPhase({ on: false, mode: 'capture', armed: false }), 'off');
});

test('toggle on is solid until Shift is held in Isolator mode', () => {
  assert.equal(isolationPhase({ on: true, mode: 'isolate', armed: false }), 'solid');
  assert.equal(isolationPhase({ on: true, mode: 'isolate', armed: true }), 'peek');
});

test('other modes never peek: Shift there picks from the isolated page', () => {
  assert.equal(isolationPhase({ on: true, mode: 'capture', armed: true }), 'solid');
  assert.equal(isolationPhase({ on: true, mode: 'annotate', armed: true }), 'solid');
});

const rect = (left, top, width, height) => ({ left, top, width, height });

test('coveringIndex skips a sidebar and takes the main area', () => {
  assert.equal(coveringIndex([rect(0, 0, 256, 900), rect(256, 0, 1184, 900)], 1440, 900), 1);
});

test('coveringIndex takes the first covering child (wrapper before a later scrim)', () => {
  assert.equal(coveringIndex([rect(0, 0, 1440, 4000), rect(0, 0, 1440, 900)], 1440, 900), 0);
});

test('coveringIndex only counts the part inside the viewport', () => {
  // Tall, but scrolled almost out of view.
  assert.equal(coveringIndex([rect(0, 800, 1440, 5000)], 1440, 900), -1);
  assert.equal(coveringIndex([rect(0, -3000, 1440, 5000)], 1440, 900), 0);
});

test('coveringIndex is -1 for no children or zero-size boxes', () => {
  assert.equal(coveringIndex([], 1440, 900), -1);
  assert.equal(coveringIndex([rect(0, 0, 0, 0)], 1440, 900), -1);
});

console.log(`captureIsolate: ${passed} passed`);
