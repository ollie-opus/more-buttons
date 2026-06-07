import assert from 'node:assert/strict';
import { locateCaptureLines, parseComponents } from '../scripts/components.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

test('locateCaptureLines: capture with no span has uuid=null and startLine on the light line', () => {
  const body = [
    '![](../assets/a-light-mode.png#only-light){ width="800" }',
    '![](../assets/a-dark-mode.png#only-dark)',
  ].join('\n');
  const [c] = locateCaptureLines(body);
  assert.equal(c.uuid, null);
  assert.equal(c.startLine, 0);
  assert.equal(c.endLine, 2);
});

test('locateCaptureLines: preceding span is read as uuid and folded into startLine', () => {
  const body = [
    '<span data-uuid="CAP-1" style="display:none"></span>',
    '![](../assets/a-light-mode.png#only-light){ width="800" }',
    '![](../assets/a-dark-mode.png#only-dark)',
  ].join('\n');
  const [c] = locateCaptureLines(body);
  assert.equal(c.uuid, 'CAP-1');
  assert.equal(c.startLine, 0);   // extended back to include the span
  assert.equal(c.endLine, 3);
});

test('locateCaptureLines: a blank line before the light line means no span (uuid=null)', () => {
  const body = [
    '<span data-uuid="SECTION" style="display:none"></span>',
    '',
    '![](../assets/a-light-mode.png#only-light){ width="800" }',
    '![](../assets/a-dark-mode.png#only-dark)',
  ].join('\n');
  const [c] = locateCaptureLines(body);
  assert.equal(c.uuid, null);
  assert.equal(c.startLine, 2);
});

test('parseComponents: capture component carries its uuid', () => {
  const body = [
    'Intro text.',
    '',
    '<span data-uuid="CAP-9" style="display:none"></span>',
    '![](../assets/x-light-mode.png#only-light){ width="800" }',
    '![](../assets/x-dark-mode.png#only-dark)',
  ].join('\n');
  const { components } = parseComponents(body, /step|note/);
  assert.equal(components.length, 1);
  assert.equal(components[0].kind, 'capture');
  assert.equal(components[0].cap.uuid, 'CAP-9');
});

console.log(`\n${passed} passed`);
