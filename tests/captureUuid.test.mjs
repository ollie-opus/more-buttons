import assert from 'node:assert/strict';
import { locateCaptureLines, parseComponents, ensureCaptureUUIDs } from '../scripts/components.js';
import { buildCaptureLines } from '../scripts/captures.js';
import { buildComponentBody } from '../scripts/components.js';

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

test('buildCaptureLines: emits a uuid span before the light line when cap.uuid is set', () => {
  const lines = buildCaptureLines([{ uuid: 'CAP-7', lightFilename: 'a-light-mode.png', darkFilename: 'a-dark-mode.png', dimMode: 'width', dimValue: 800 }]);
  // ['', span, light, dark]
  assert.equal(lines[0], '');
  assert.match(lines[1], /data-uuid="CAP-7"/);
  assert.match(lines[2], /a-light-mode\.png#only-light/);
  assert.match(lines[3], /a-dark-mode\.png#only-dark/);
});

test('buildCaptureLines: no span when cap.uuid is absent', () => {
  const lines = buildCaptureLines([{ lightFilename: 'a-light-mode.png', darkFilename: 'a-dark-mode.png', dimMode: 'none', dimValue: null }]);
  assert.equal(lines.length, 3); // '', light, dark
  assert.ok(!lines.some(l => /data-uuid/.test(l)));
});

test('round-trip: parseComponents → buildComponentBody preserves capture uuid + order', () => {
  const body = buildComponentBody(null, 'Desc.', [
    { kind: 'capture', cap: { uuid: 'C1', lightFilename: 'p-light-mode.png', darkFilename: 'p-dark-mode.png', dimMode: 'width', dimValue: 800 } },
    { kind: 'capture', cap: { uuid: 'C2', lightFilename: 'q-light-mode.png', darkFilename: 'q-dark-mode.png', dimMode: 'none', dimValue: null } },
  ]);
  const { components } = parseComponents(body, /step|note/);
  assert.deepEqual(components.map(c => c.cap.uuid), ['C1', 'C2']);
});

test('ensureCaptureUUIDs: injects a span before an unmigrated capture', () => {
  const body = [
    'Intro.',
    '',
    '![](../assets/a-light-mode.png#only-light){ width="800" }',
    '![](../assets/a-dark-mode.png#only-dark)',
  ].join('\n');
  const out = ensureCaptureUUIDs(body);
  const lines = out.split('\n');
  const lightIdx = lines.findIndex(l => /a-light-mode/.test(l));
  assert.match(lines[lightIdx - 1], /data-uuid="[0-9a-f-]{36}"/i);
});

test('ensureCaptureUUIDs: idempotent (already-migrated capture is untouched)', () => {
  const body = [
    '<span data-uuid="CAP-X" style="display:none"></span>',
    '![](../assets/a-light-mode.png#only-light){ width="800" }',
    '![](../assets/a-dark-mode.png#only-dark)',
  ].join('\n');
  assert.equal(ensureCaptureUUIDs(body), body);
});

test('ensureCaptureUUIDs: migrates multiple captures, each with a distinct uuid', () => {
  const body = [
    '![](../assets/a-light-mode.png#only-light)',
    '![](../assets/a-dark-mode.png#only-dark)',
    '',
    '![](../assets/b-light-mode.png#only-light)',
    '![](../assets/b-dark-mode.png#only-dark)',
  ].join('\n');
  const out = ensureCaptureUUIDs(body);
  const uuids = [...out.matchAll(/data-uuid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(uuids.length, 2);
  assert.notEqual(uuids[0], uuids[1]);
  // Re-running is a no-op.
  assert.equal(ensureCaptureUUIDs(out), out);
});

test('ensureCaptureUUIDs: a nested (indented) capture gets a span at matching indent', () => {
  const body = [
    '!!! note "N"',
    '',
    '    <span data-uuid="ADM" style="display:none"></span>',
    '',
    '    ![](../assets/c-light-mode.png#only-light){ width="800" }',
    '    ![](../assets/c-dark-mode.png#only-dark)',
  ].join('\n');
  const out = ensureCaptureUUIDs(body);
  const lines = out.split('\n');
  const lightIdx = lines.findIndex(l => /c-light-mode/.test(l));
  assert.match(lines[lightIdx - 1], /^    <span[^>]*data-uuid="[0-9a-f-]{36}"/i); // 4-space indent preserved
});

console.log(`\n${passed} passed`);
