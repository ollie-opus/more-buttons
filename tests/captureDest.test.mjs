import assert from 'node:assert/strict';
import {
  OCC_DIR, SU_DIR, PAIR_DIRS, isSystemUpdateFile, isSystemUpdateContainer,
  captureDirForContainer, isSystemUpdateCapturePath, shortId, pairFilenames,
  toSystemUpdateFilename,
} from '../scripts/captureDest.js';
import { buildMediaNodes } from '../scripts/mediaTree.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

test('folder constants', () => {
  assert.equal(OCC_DIR, 'occ-captures');
  assert.equal(SU_DIR, 'system-update-captures');
  assert.deepEqual(PAIR_DIRS, ['occ-captures', 'system-update-captures']);
});

test('isSystemUpdateFile matches the page and the drafts file only', () => {
  assert.equal(isSystemUpdateFile('docs/pages/system-updates.md'), true);
  assert.equal(isSystemUpdateFile('docs/drafts/system-updates.md'), true);
  assert.equal(isSystemUpdateFile('docs/drafts/guides/foo.md'), false);
  assert.equal(isSystemUpdateFile('docs/pages/system-updates-archive.md'), false);
  assert.equal(isSystemUpdateFile(undefined), false);
});

test('container destination is keyed on file, not kind', () => {
  const su = 'docs/pages/system-updates.md';
  assert.equal(captureDirForContainer({ kind: 'system-update', uuid: 'u', file: su }), SU_DIR);
  assert.equal(captureDirForContainer({ kind: 'system-draft', uuid: 'u', file: 'docs/drafts/system-updates.md' }), SU_DIR);
  assert.equal(captureDirForContainer({ kind: 'data-table-cell', uuid: 'u', file: su }), SU_DIR);
  assert.equal(captureDirForContainer({ kind: 'grid-cell', uuid: 'u', file: su }), SU_DIR);
  assert.equal(captureDirForContainer({ kind: 'guide-section', uuid: 'u', file: 'docs/pages/guide.md' }), OCC_DIR);
  assert.equal(isSystemUpdateContainer(null), false);
  assert.equal(captureDirForContainer(undefined), OCC_DIR);
});

test('isSystemUpdateCapturePath accepts repo-relative and library-relative paths', () => {
  assert.equal(isSystemUpdateCapturePath('docs/assets/media/system-update-captures/foo-ab12cd34-light-mode.png'), true);
  assert.equal(isSystemUpdateCapturePath('media/system-update-captures/legacy-ab12cd34.gif'), true);
  assert.equal(isSystemUpdateCapturePath('media/occ-captures/sites/foo-light-mode.png'), false);
  assert.equal(isSystemUpdateCapturePath('docs/assets/media/other/system-update-captures.png'), false);
  assert.equal(isSystemUpdateCapturePath(''), false);
  assert.equal(isSystemUpdateCapturePath(undefined), false);
});

test('shortId is eight lowercase hex chars and varies', () => {
  const a = shortId(), b = shortId();
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.match(b, /^[0-9a-f]{8}$/);
  assert.notEqual(a, b);
});

test('pairFilenames builds the library-relative pair', () => {
  assert.deepEqual(pairFilenames(SU_DIR, 'foo-ab12cd34', 'png'), {
    lightFilename: 'media/system-update-captures/foo-ab12cd34-light-mode.png',
    darkFilename: 'media/system-update-captures/foo-ab12cd34-dark-mode.png',
  });
  assert.equal(pairFilenames(OCC_DIR, 'sites/uuid/foo', 'svg').lightFilename, 'media/occ-captures/sites/uuid/foo-light-mode.svg');
});

test('toSystemUpdateFilename flattens, keeps flags + ext, id before the theme tail', () => {
  assert.equal(
    toSystemUpdateFilename('media/occ-captures/sites/uuid/foo-a-z-light-mode.png', 'ab12cd34'),
    'media/system-update-captures/foo-a-z-ab12cd34-light-mode.png');
  assert.equal(
    toSystemUpdateFilename('media/occ-captures/admin/sites/uuid/dashboard/icon-dark-mode.svg', 'ab12cd34'),
    'media/system-update-captures/icon-ab12cd34-dark-mode.svg');
  assert.equal(
    toSystemUpdateFilename('docs/assets/media/occ-captures/x-light-mode.png', '01234567'),
    'media/system-update-captures/x-01234567-light-mode.png');
});

test('renamed pair still collapses to one leaf in the media tree', () => {
  const light = 'docs/assets/' + toSystemUpdateFilename('media/occ-captures/p/q/foo-light-mode.png', 'ab12cd34');
  const dark = 'docs/assets/' + toSystemUpdateFilename('media/occ-captures/p/q/foo-dark-mode.png', 'ab12cd34');
  const nodes = buildMediaNodes([light, dark, 'docs/assets/media/system-update-captures/legacy-0f0f0f0f.gif'],
    { root: 'docs/assets/media/system-update-captures', exts: null, shape: null });
  assert.equal(nodes.length, 2);
  const pair = nodes.find(n => n.attrs['data-media-light'] === light);
  assert.ok(pair);
  assert.equal(pair.attrs['data-media-dark'], dark);
  assert.equal(pair.attrs['data-media-base'], 'foo-ab12cd34');
  const pairsOnly = buildMediaNodes([light, dark, 'docs/assets/media/system-update-captures/legacy-0f0f0f0f.gif'],
    { root: 'docs/assets/media/system-update-captures', exts: null, shape: 'pair' });
  assert.equal(pairsOnly.length, 1);
});

console.log(`\ncaptureDest: ${passed} passed`);
