import assert from 'node:assert/strict';

globalThis.window = { sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } };
globalThis.chrome = { runtime: { onMessage: { addListener() {} }, sendMessage() {}, getURL: p => p }, storage: { local: { get: async () => ({}) } } };
const { recaptureTarget, recaptureProblem } = await import('../scripts/kbSiteCapture.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const L = 'docs/assets/media/occ-captures/sites/overview-light-mode.png';
const D = 'docs/assets/media/occ-captures/sites/overview-dark-mode.png';

test('a stored png pair is a valid target', () => {
  assert.deepEqual(recaptureTarget({ lightPath: L, darkPath: D }), { lightPath: L, darkPath: D, base: 'sites/overview' });
  assert.equal(recaptureTarget({ lightPath: L, darkPath: null }).darkPath, null);
});

test('anything else is refused', () => {
  for (const bad of [
    null, {}, { lightPath: L, darkPath: 'docs/assets/media/occ-captures/other-dark-mode.png' },
    { lightPath: 'docs/assets/media/system-update-captures/x-light-mode.png', darkPath: null },
    { lightPath: 'docs/assets/media/occ-captures/x-light-mode.svg', darkPath: null },
    { lightPath: 'docs/assets/media/occ-captures/../../../zensical-light-mode.png', darkPath: null },
    { lightPath: 'docs/assets/media/occ-captures/a//b-light-mode.png', darkPath: null },
    { lightPath: 'docs/pages/x-light-mode.png', darkPath: null },
    { lightPath: 'docs/assets/media/occ-captures/x.png', darkPath: null },
    { lightPath: 42, darkPath: null },
  ]) assert.equal(recaptureTarget(bad), null, JSON.stringify(bad));
});

test('an svg extract cannot replace a png pair', () => {
  assert.equal(recaptureProblem({ lightFilename: 'media/occ-captures/a-light-mode.png' }), '');
  assert.match(recaptureProblem({ lightFilename: 'media/occ-captures/a-light-mode.svg' }), /SVG/);
});

console.log(`kbSiteRecapture: ${passed} passed`);
