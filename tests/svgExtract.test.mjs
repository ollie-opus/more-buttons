import assert from 'node:assert/strict';

// svgExtract.js imports captureElement.js (for deriveFilename), whose import
// is side-effect free under the same minimal window stub annotateColour.test.mjs
// uses for captureMode.js. The DOM-taking functions are never called here —
// only the pure helpers are under test.
globalThis.window = {
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
};
const { shouldDropAttribute, bakePaintDecision, ensureViewBox, svgTextToDataUrl } =
  await import('../scripts/svgExtract.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// ── shouldDropAttribute ──────────────────────────────────────────────────────

test('class, data-*, and on* are dropped', () => {
  assert.ok(shouldDropAttribute('class'));
  assert.ok(shouldDropAttribute('data-icon'));
  assert.ok(shouldDropAttribute('onclick'));
  assert.ok(shouldDropAttribute('onLoad'));
});

test('id, paint, geometry, and namespace attributes are kept', () => {
  for (const keep of ['id', 'fill', 'stroke', 'viewBox', 'd', 'xmlns', 'xlink:href', 'stroke-width', 'style', 'aria-hidden']) {
    assert.ok(!shouldDropAttribute(keep), `${keep} should be kept`);
  }
});

// ── bakePaintDecision ────────────────────────────────────────────────────────

const FILL_INITIAL = 'rgb(0, 0, 0)';

test('an explicit presentation attribute is left alone', () => {
  assert.equal(bakePaintDecision({
    attrValue: '#f00', computed: 'rgb(255, 0, 0)', parentComputed: FILL_INITIAL, initial: FILL_INITIAL,
  }), null);
});

test('fill="currentColor" is left alone (root colour bake resolves it)', () => {
  assert.equal(bakePaintDecision({
    attrValue: 'currentColor', computed: 'rgb(22, 163, 74)', parentComputed: FILL_INITIAL, initial: FILL_INITIAL,
  }), null);
});

test('a CSS-driven value (class like fill-green-600) is baked', () => {
  assert.equal(bakePaintDecision({
    attrValue: null, computed: 'rgb(22, 163, 74)', parentComputed: FILL_INITIAL, initial: FILL_INITIAL,
  }), 'rgb(22, 163, 74)');
});

test('a value inherited from the parent is not re-baked', () => {
  assert.equal(bakePaintDecision({
    attrValue: null, computed: 'rgb(22, 163, 74)', parentComputed: 'rgb(22, 163, 74)', initial: FILL_INITIAL,
  }), null);
});

test('the initial value is never baked', () => {
  assert.equal(bakePaintDecision({
    attrValue: null, computed: 'none', parentComputed: 'none', initial: 'none',
  }), null);
  assert.equal(bakePaintDecision({
    attrValue: null, computed: '1', parentComputed: '1', initial: '1',
  }), null);
});

test('a CSS stroke-width is baked', () => {
  assert.equal(bakePaintDecision({
    attrValue: null, computed: '2px', parentComputed: '1px', initial: '1px',
  }), '2px');
});

// ── ensureViewBox ────────────────────────────────────────────────────────────

test('an existing viewBox wins', () => {
  assert.equal(ensureViewBox({
    viewBoxAttr: '0 0 24 24', widthAttr: '16', heightAttr: '16', bboxRect: { x: 0, y: 0, width: 20, height: 20 },
  }), '0 0 24 24');
});

test('numeric width/height attributes derive the viewBox', () => {
  assert.equal(ensureViewBox({
    viewBoxAttr: null, widthAttr: '24', heightAttr: '24', bboxRect: null,
  }), '0 0 24 24');
});

test('non-numeric dimensions fall through to the bbox', () => {
  assert.equal(ensureViewBox({
    viewBoxAttr: null, widthAttr: '100%', heightAttr: null, bboxRect: { x: 1.005, y: 0, width: 22, height: 20 },
  }), '1 0 22 20');
});

test('nothing usable yields null (leave the svg as it was)', () => {
  assert.equal(ensureViewBox({
    viewBoxAttr: null, widthAttr: null, heightAttr: null, bboxRect: { x: 0, y: 0, width: 0, height: 0 },
  }), null);
});

// ── svgTextToDataUrl ─────────────────────────────────────────────────────────

test('round-trips UTF-8 content through base64', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><title>émoji ✓</title></svg>';
  const url = svgTextToDataUrl(svg);
  assert.ok(url.startsWith('data:image/svg+xml;base64,'));
  const b64 = url.split(',')[1];
  assert.equal(decodeURIComponent(escape(atob(b64))), svg);
});

console.log(`\n${passed} passed`);
