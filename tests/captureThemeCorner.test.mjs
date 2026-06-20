import assert from 'node:assert/strict';
import { buildCaptureLines, CAPTURE_CORNER_RADIUS } from '../scripts/captures.js';
import { parseComponents, buildComponentBody, locateCaptureLines } from '../scripts/components.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const ADM_RE = /note|tip|step/;
const base = { uuid: 'CAP-1', lightFilename: 'a-light-mode.png', darkFilename: 'a-dark-mode.png' };

// buildCaptureLines returns ['', span, lightLine, darkLine]; grab the two image lines.
function lines(cap) {
  const out = buildCaptureLines([cap]);
  const imgs = out.filter(l => l.startsWith('!['));
  return { light: imgs[0], dark: imgs[1] };
}

// ── Serialized output format ───────────────────────────────────────────────

test('default theme keeps #only-light on the light file, #only-dark on the dark file', () => {
  const { light, dark } = lines({ ...base, dimMode: 'height', dimValue: 50, inversed: false, rounded: false });
  assert.equal(light, '![](../assets/a-light-mode.png#only-light){ style="height: 50px" loading=lazy }');
  assert.equal(dark,  '![](../assets/a-dark-mode.png#only-dark){ style="height: 50px" loading=lazy }');
});

test('inversed theme swaps the hashes onto the opposite files', () => {
  const { light, dark } = lines({ ...base, dimMode: 'height', dimValue: 50, inversed: true, rounded: false });
  assert.equal(light, '![](../assets/a-light-mode.png#only-dark){ style="height: 50px" loading=lazy }');
  assert.equal(dark,  '![](../assets/a-dark-mode.png#only-light){ style="height: 50px" loading=lazy }');
});

test('rounding folds border-radius into the existing height style', () => {
  const { light } = lines({ ...base, dimMode: 'height', dimValue: 50, rounded: true });
  assert.equal(light, `![](../assets/a-light-mode.png#only-light){ style="height: 50px; border-radius: ${CAPTURE_CORNER_RADIUS}px" loading=lazy }`);
});

test('rounding in width mode gets its own style segment alongside the width attr', () => {
  const { light } = lines({ ...base, dimMode: 'width', dimValue: 200, rounded: true });
  assert.equal(light, `![](../assets/a-light-mode.png#only-light){ style="border-radius: ${CAPTURE_CORNER_RADIUS}px" width="200" loading=lazy }`);
});

test('rounding in auto mode emits an attr block where none existed before', () => {
  const { light } = lines({ ...base, dimMode: 'none', dimValue: null, rounded: true });
  assert.equal(light, `![](../assets/a-light-mode.png#only-light){ style="border-radius: ${CAPTURE_CORNER_RADIUS}px" loading=lazy }`);
});

// ── Byte-identical backward compatibility (unchanged captures must not churn) ──

test('a plain (default/disabled) capture serializes byte-identically to the legacy format', () => {
  const height = lines({ ...base, dimMode: 'height', dimValue: 50 });
  assert.equal(height.light, '![](../assets/a-light-mode.png#only-light){ style="height: 50px" loading=lazy }');
  assert.equal(height.dark,  '![](../assets/a-dark-mode.png#only-dark){ style="height: 50px" loading=lazy }');

  const width = lines({ ...base, dimMode: 'width', dimValue: 640 });
  assert.equal(width.light, '![](../assets/a-light-mode.png#only-light){ width="640" loading=lazy }');

  const auto = lines({ ...base, dimMode: 'none', dimValue: null });
  assert.equal(auto.light, '![](../assets/a-light-mode.png#only-light)'); // no attr block at all
  assert.equal(auto.dark,  '![](../assets/a-dark-mode.png#only-dark)');
});

// ── Full round-trip across the dimMode × theme × corner matrix ────────────────

test('every dimMode × theme × corner combination round-trips through markdown', () => {
  const dims = [
    { dimMode: 'height', dimValue: 50 },
    { dimMode: 'width', dimValue: 200 },
    { dimMode: 'none', dimValue: null },
  ];
  for (const d of dims) {
    for (const inversed of [false, true]) {
      for (const rounded of [false, true]) {
        const cap = { ...base, ...d, inversed, rounded };
        const body = buildComponentBody(null, 'Desc', [{ kind: 'capture', cap }]);
        const got = parseComponents(body, ADM_RE).components
          .find(c => c.kind === 'capture' && c.cap.uuid === 'CAP-1')?.cap;
        const label = `${d.dimMode}/inv=${inversed}/round=${rounded}`;
        assert.ok(got, `parsed back a capture for ${label}`);
        assert.equal(got.dimMode, d.dimMode, `dimMode ${label}`);
        assert.equal(got.dimValue, d.dimValue, `dimValue ${label}`);
        assert.equal(got.inversed, inversed, `inversed ${label}`);
        assert.equal(got.rounded, rounded, `rounded ${label}`);
        assert.equal(got.lightFilename, 'a-light-mode.png', `lightFilename ${label}`);
        assert.equal(got.darkFilename, 'a-dark-mode.png', `darkFilename ${label}`);
      }
    }
  }
});

// ── Legacy markdown (pre-feature, hand-authored) parses to the off defaults ──

test('legacy capture markdown (no rounding, normal hashes) reads as default/disabled', () => {
  const body = [
    '<span data-uuid="CAP-9" style="display:none"></span>',
    '![](../assets/y-light-mode.png#only-light){ width="800" loading=lazy }',
    '![](../assets/y-dark-mode.png#only-dark){ width="800" loading=lazy }',
  ].join('\n');
  const caps = locateCaptureLines(body);
  assert.equal(caps.length, 1);
  assert.equal(caps[0].inversed, false);
  assert.equal(caps[0].rounded, false);
  assert.equal(caps[0].dimMode, 'width');
  assert.equal(caps[0].dimValue, 800);
  assert.equal(caps[0].lightFilename, 'y-light-mode.png');
  assert.equal(caps[0].darkFilename, 'y-dark-mode.png');
});

console.log(`captureThemeCorner: ${passed} passed`);
