import assert from 'node:assert/strict';
import { buildMediaNodes, groupMediaPaths, humanizeSegment } from '../scripts/mediaTree.js';

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


test('png and svg pairs at the same base stay separate leaves, each with its ext', () => {
  const nodes = buildMediaNodes([
    'docs/assets/media/occ-captures/test/test-light-mode.png',
    'docs/assets/media/occ-captures/test/test-dark-mode.png',
    'docs/assets/media/occ-captures/test/test-light-mode.svg',
    'docs/assets/media/occ-captures/test/test-dark-mode.svg',
  ], { root: 'docs/assets/media/occ-captures', exts: ['png', 'svg'] });
  const leaves = nodes[0].children;
  assert.equal(leaves.length, 2);
  assert.deepEqual(leaves.map(l => l.attrs['data-media-ext']), ['png', 'svg']);
  assert.equal(leaves[0].attrs['data-media-light'], 'docs/assets/media/occ-captures/test/test-light-mode.png');
  assert.equal(leaves[1].attrs['data-media-light'], 'docs/assets/media/occ-captures/test/test-light-mode.svg');
  // Both leaves keep the same theme-agnostic label; the ext pill disambiguates.
  assert.equal(leaves[0].attrs['data-media-base'], 'test');
  assert.equal(leaves[1].attrs['data-media-base'], 'test');
});

test('every leaf carries data-media-ext (pairs and singles, images and videos)', () => {
  const img = buildMediaNodes([
    'docs/assets/media/occ-captures/x-light-mode.png',
    'docs/assets/media/occ-captures/x-dark-mode.png',
  ], IMG);
  assert.equal(img[0].attrs['data-media-ext'], 'png');
  const vid = buildMediaNodes(['docs/assets/media/videos/intro.webm'], VID);
  assert.equal(vid[0].attrs['data-media-ext'], 'webm');
});

test('humanizeSegment: dashes/underscores to spaces, title case', () => {
  assert.equal(humanizeSegment('occ-captures'), 'Occ Captures');
  assert.equal(humanizeSegment('other'), 'Other');
  assert.equal(humanizeSegment('my_folder-name'), 'My Folder Name');
});

test('groupMediaPaths groups by top-level folder, sorted with "other" last, root-level files ignored', () => {
  const groups = groupMediaPaths([
    'docs/assets/media/videos/intro.mp4',
    'docs/assets/media/occ-captures/x-light-mode.png',
    'docs/assets/media/occ-captures/sub/y-light-mode.png',
    'docs/assets/media/other/report.pdf',
    'docs/assets/media/stray.png', // directly in the root — no tab
    'docs/assets/other-tree/nope.png', // outside the media root
  ], 'docs/assets/media');
  assert.deepEqual(groups.map(g => g.key), ['occ-captures', 'videos', 'other']);
  assert.deepEqual(groups.map(g => g.label), ['Occ Captures', 'Videos', 'Other']);
  assert.equal(groups[0].root, 'docs/assets/media/occ-captures');
  assert.deepEqual(groups[0].paths, [
    'docs/assets/media/occ-captures/x-light-mode.png',
    'docs/assets/media/occ-captures/sub/y-light-mode.png',
  ]);
  assert.deepEqual(groups[2].paths, ['docs/assets/media/other/report.pdf']);
});

test('no exts: every extension renders, pairing preserved, extension-less skipped', () => {
  const nodes = buildMediaNodes([
    'docs/assets/media/other/report.pdf',
    'docs/assets/media/other/x-light-mode.png',
    'docs/assets/media/other/x-dark-mode.png',
    'docs/assets/media/other/LICENSE',
  ], { root: 'docs/assets/media/other' });
  assert.equal(nodes.length, 2);
  const pdf = nodes.find(n => n.attrs['data-media-ext'] === 'pdf');
  assert.equal(pdf.attrs['data-media-single'], 'docs/assets/media/other/report.pdf');
  const pair = nodes.find(n => n.attrs['data-media-ext'] === 'png');
  assert.equal(pair.attrs['data-media-light'], 'docs/assets/media/other/x-light-mode.png');
  assert.equal(pair.attrs['data-media-dark'], 'docs/assets/media/other/x-dark-mode.png');
});

test('accept filter over a foreign-format group yields [] (drives empty-tab hiding)', () => {
  const nodes = buildMediaNodes([
    'docs/assets/media/videos/intro.mp4',
    'docs/assets/media/videos/clip.webm',
  ], { root: 'docs/assets/media/videos', exts: ['png', 'svg'] });
  assert.deepEqual(nodes, []);
});

console.log(`mediaTree: ${passed} passed`);
