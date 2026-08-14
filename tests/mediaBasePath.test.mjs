import assert from 'node:assert/strict';
import { mediaBasePath } from '../scripts/captureCards.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

test('full repo path → media-root-relative base, extension stripped', () => {
  assert.equal(mediaBasePath('docs/assets/media/buttons/menu-icon.png'), 'buttons/menu-icon');
});

test('assets-relative media/ path is also accepted', () => {
  assert.equal(mediaBasePath('media/buttons/menu-icon.svg'), 'buttons/menu-icon');
});

test('nested folders keep their path', () => {
  assert.equal(mediaBasePath('docs/assets/media/other/logos/acme.webp'), 'other/logos/acme');
});

test('empty/undefined input → empty string', () => {
  assert.equal(mediaBasePath(''), '');
  assert.equal(mediaBasePath(undefined), '');
});

console.log(`mediaBasePath: ${passed} passed`);
