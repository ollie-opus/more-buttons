import assert from 'node:assert/strict';
import { captureUploadField, captureUploadAccept, captureFileExt, captureBasePath, mediaFileExt } from '../scripts/captureCards.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// ── captureUploadField markup ─────────────────────────────────────────────────

test('renders a file input in the standard form-group row, accepting PNG + SVG by default', () => {
  const html = captureUploadField({ label: 'Light mode image', name: 'light' });
  assert.match(html, /type="file"/);
  assert.match(html, /accept="image\/png,image\/svg\+xml"/);
  assert.match(html, /data-capture-upload="light"/);
  assert.match(html, /class="more-buttons-form-group"/);
  assert.match(html, /class="more-buttons-label">Light mode image</);
  assert.match(html, /class="mb-capture-upload-field"/);
  assert.match(html, /class="mb-capture-upload-input"/);
});

test('exts option restricts the accept attribute', () => {
  const png = captureUploadField({ label: 'Light mode image', name: 'light', exts: ['png'] });
  assert.match(png, /accept="image\/png"/);
  assert.doesNotMatch(png, /svg/);
  const svg = captureUploadField({ label: 'Light mode image', name: 'light', exts: ['svg'] });
  assert.match(svg, /accept="image\/svg\+xml"/);
});

test('dark slot carries its own data attribute', () => {
  const html = captureUploadField({ label: 'Dark mode image', name: 'dark' });
  assert.match(html, /data-capture-upload="dark"/);
});

test('label and name are attribute-escaped', () => {
  const html = captureUploadField({ label: '<b>"x"</b>', name: 'light' });
  assert.match(html, /&lt;b&gt;&quot;x&quot;&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>/);
});

// ── captureUploadAccept ───────────────────────────────────────────────────────

test('builds accept values, MIME for capture types', () => {
  assert.equal(captureUploadAccept(), 'image/png,image/svg+xml');
  assert.equal(captureUploadAccept(['png']), 'image/png');
});

test('non-capture extensions fall back to the .ext token form', () => {
  assert.equal(captureUploadAccept(['mp4']), '.mp4');
  assert.equal(captureUploadAccept(['svg', 'bmp']), 'image/svg+xml,.bmp');
});

test('exts option accepts video extensions via the token form', () => {
  const html = captureUploadField({ label: 'Video file', name: 'light', exts: ['mp4'] });
  assert.match(html, /accept="\.mp4"/);
});

test('exts: null drops the accept attribute entirely (any file)', () => {
  const html = captureUploadField({ label: 'File', name: 'single', exts: null });
  assert.doesNotMatch(html, /accept=/);
  assert.match(html, /data-capture-upload="single"/);
});

// ── captureFileExt ────────────────────────────────────────────────────────────

test('MIME type wins when present', () => {
  assert.equal(captureFileExt({ type: 'image/png', name: 'x.jpg' }), 'png');
  assert.equal(captureFileExt({ type: 'image/svg+xml', name: 'x.png' }), 'svg');
  assert.equal(captureFileExt({ type: 'image/jpeg', name: 'x.png' }), null);
});

test('falls back to the extension (case-insensitive) when type is empty', () => {
  assert.equal(captureFileExt({ type: '', name: 'shot.png' }), 'png');
  assert.equal(captureFileExt({ type: '', name: 'DIAGRAM.SVG' }), 'svg');
  assert.equal(captureFileExt({ name: 'shot.jpg' }), null);
});

test('safe on empty or missing input', () => {
  assert.equal(captureFileExt({}), null);
  assert.equal(captureFileExt(), null);
});

// ── mediaFileExt (any-format uploads) ─────────────────────────────────────────

test('takes the lowercase filename extension of any format', () => {
  assert.equal(mediaFileExt({ name: 'report.pdf' }), 'pdf');
  assert.equal(mediaFileExt({ name: 'CLIP.MP4' }), 'mp4');
  assert.equal(mediaFileExt({ name: 'archive.tar.gz' }), 'gz');
});

test('null when the name has no extension or is missing', () => {
  assert.equal(mediaFileExt({ name: 'LICENSE' }), null);
  assert.equal(mediaFileExt({}), null);
  assert.equal(mediaFileExt(), null);
});

// ── captureBasePath (extension-agnostic pair stripping) ──────────────────────

test('strips theme suffixes for both png and svg', () => {
  assert.equal(captureBasePath('docs/assets/media/occ-captures/sites/foo-light-mode.png'), 'sites/foo');
  assert.equal(captureBasePath('media/occ-captures/sites/foo-dark-mode.svg'), 'sites/foo');
});

console.log(`\n${passed} passed`);
