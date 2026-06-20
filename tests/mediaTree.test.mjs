import assert from 'node:assert/strict';
import { buildMediaNodes } from '../scripts/mediaTree.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const IMG = { root: 'docs/assets/media/occ-captures', exts: ['png'] };
const VID = { root: 'docs/assets/media/videos', exts: ['mp4', 'webm'] };

test('image png pair collapses to one leaf with light+dark paths', () => {
  const nodes = buildMediaNodes([
    'docs/assets/media/occ-captures/x-light-mode.png',
    'docs/assets/media/occ-captures/x-dark-mode.png',
  ], IMG);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].kind, 'file');
  assert.equal(nodes[0].attrs['data-media-base'], 'x');
  assert.equal(nodes[0].attrs['data-media-light'], 'docs/assets/media/occ-captures/x-light-mode.png');
  assert.equal(nodes[0].attrs['data-media-dark'], 'docs/assets/media/occ-captures/x-dark-mode.png');
  assert.equal(nodes[0].attrs['data-media-single'], '');
});

test('video pair + single coexist, folders nest', () => {
  const nodes = buildMediaNodes([
    'docs/assets/media/videos/sites/tile-light-mode.mp4',
    'docs/assets/media/videos/sites/tile-dark-mode.mp4',
    'docs/assets/media/videos/intro.webm',
  ], VID);
  // folder "sites" first, then single "intro"
  assert.equal(nodes[0].kind, 'folder');
  assert.equal(nodes[0].label, 'sites');
  assert.equal(nodes[0].children[0].attrs['data-media-light'], 'docs/assets/media/videos/sites/tile-light-mode.mp4');
  const single = nodes.find(n => n.kind === 'file');
  assert.equal(single.attrs['data-media-single'], 'docs/assets/media/videos/intro.webm');
  assert.equal(single.attrs['data-media-light'], '');
});

test('extension filter excludes unrelated blobs', () => {
  const nodes = buildMediaNodes([
    'docs/assets/media/videos/a.mp4',
    'docs/assets/media/videos/notes.txt',
  ], VID);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].attrs['data-media-base'], 'a');
});

console.log(`mediaTree: ${passed} passed`);
