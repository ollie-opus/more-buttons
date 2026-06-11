import assert from 'node:assert/strict';
import { captureSizeField, normalizeDimChoice } from '../scripts/captureCards.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// ── captureSizeField markup ───────────────────────────────────────────────────

test('height mode: height option selected, value rendered, input enabled', () => {
  const html = captureSizeField({ dimMode: 'height', dimValue: 64 });
  assert.match(html, /<option value="height" selected>/);
  assert.match(html, /value="64"/);
  assert.doesNotMatch(html, /disabled/);
  assert.doesNotMatch(html, /--auto/);
});

test('width mode: width option selected', () => {
  const html = captureSizeField({ dimMode: 'width', dimValue: 120 });
  assert.match(html, /<option value="width" selected>/);
  assert.match(html, /value="120"/);
});

test('auto mode: --auto class, disabled empty input', () => {
  const html = captureSizeField({ dimMode: 'none' });
  assert.match(html, /<option value="none" selected>/);
  assert.match(html, /--auto/);
  assert.match(html, /value=""/);
  assert.match(html, /disabled/);
});

test('defaults to height/50', () => {
  const html = captureSizeField();
  assert.match(html, /<option value="height" selected>/);
  assert.match(html, /value="50"/);
});

// ── normalizeDimChoice ────────────────────────────────────────────────────────

test('none → null value regardless of raw input', () => {
  assert.deepEqual(normalizeDimChoice('none', '64'), { dimMode: 'none', dimValue: null });
});

test('valid number parses', () => {
  assert.deepEqual(normalizeDimChoice('height', '64'), { dimMode: 'height', dimValue: 64 });
});

test('empty, zero, negative, junk all fall back to 50', () => {
  assert.deepEqual(normalizeDimChoice('height', ''), { dimMode: 'height', dimValue: 50 });
  assert.deepEqual(normalizeDimChoice('width', '0'), { dimMode: 'width', dimValue: 50 });
  assert.deepEqual(normalizeDimChoice('width', '-3'), { dimMode: 'width', dimValue: 50 });
  assert.deepEqual(normalizeDimChoice('height', 'abc'), { dimMode: 'height', dimValue: 50 });
});

console.log(`\n${passed} passed`);
