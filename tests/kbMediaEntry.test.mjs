import assert from 'node:assert/strict';
import {
  mediaEntryKey, mediaEntryUrl, parseMediaEntryPath, findMediaEntry, mediaEntryHref, mediaEntryActions,
  dataUrlBytes, dataUrlSize, sameBytes,
} from '../scripts/kbMediaEntry.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

test('key from a repo path, a component path, a single', () => {
  assert.equal(mediaEntryKey('docs/assets/media/occ-captures/sites/overview-light-mode.png'), 'occ-captures/sites/overview');
  assert.equal(mediaEntryKey('media/occ-captures/sites/overview-dark-mode.png'), 'occ-captures/sites/overview');
  assert.equal(mediaEntryKey('docs/assets/media/videos/intro.mp4'), 'videos/intro');
});

test('url round trip, odd characters', () => {
  const key = 'images/My Folder/50% off v1.2';
  assert.equal(parseMediaEntryPath(mediaEntryUrl(key)), key);
  assert.equal(mediaEntryUrl('occ-captures/sites/overview'), '/admin/media-library/occ-captures/sites/overview/');
  assert.equal(parseMediaEntryPath('/admin/media-library/occ-captures/sites/overview'), 'occ-captures/sites/overview');
});

test('not an entry url', () => {
  for (const p of ['/admin/media-library/', '/admin/media-library/upload/', '/admin/media-library/a/../b/', '/admin/media-library/a/%E0%A4%A/', '/admin/pages/x/', '/admin/media-library/a//b/']) {
    assert.equal(parseMediaEntryPath(p), null, p);
  }
});

test('lookup, missing, and shared bases', () => {
  const pair = { id: 'p', light: 'docs/assets/media/images/a-light-mode.png', dark: 'docs/assets/media/images/a-dark-mode.png', ext: 'png' };
  const vid = { id: 'v', single: 'docs/assets/media/images/a.mp4', ext: 'mp4' };
  const lone = { id: 'l', single: 'docs/assets/media/images/b.png', ext: 'png' };
  const all = [vid, pair, lone];
  assert.equal(findMediaEntry(all, 'images/b'), lone);
  assert.equal(findMediaEntry(all, 'images/zzz'), null);
  assert.equal(findMediaEntry(all, 'images/a.mp4'), vid);
  assert.equal(findMediaEntry(all, 'images/a'), pair);
  assert.equal(mediaEntryHref(lone, all), '/admin/media-library/images/b/');
  assert.equal(mediaEntryHref(vid, all), '/admin/media-library/images/a.mp4/');
  assert.equal(findMediaEntry(all, parseMediaEntryPath(mediaEntryHref(pair, all))), pair);
});

test('a file whose own name carries a dot is found by its bare key', () => {
  const dotted = { id: 'd', single: 'docs/assets/media/images/v1.2.png', ext: 'png' };
  assert.equal(findMediaEntry([dotted], 'images/v1.2'), dotted);
  assert.equal(mediaEntryHref(dotted, [dotted]), '/admin/media-library/images/v1.2/');
});

test('an entry is not its own namesake: a copy of it in the list adds no extension', () => {
  const lone = { id: 'l', single: 'docs/assets/media/images/b.png', ext: 'png' };
  assert.equal(mediaEntryHref({ ...lone }, [lone]), '/admin/media-library/images/b/');
});

test('actions', () => {
  const png = { light: 'x-light-mode.png', dark: 'x-dark-mode.png', ext: 'png' };
  assert.deepEqual(mediaEntryActions({ entry: png, frozen: false, unused: false }), { recapture: true, replace: true, remove: false });
  assert.deepEqual(mediaEntryActions({ entry: png, frozen: true, unused: true }), { recapture: false, replace: false, remove: true });
  assert.equal(mediaEntryActions({ entry: { ...png, ext: 'svg' }, frozen: false, unused: false }).recapture, false);
  assert.equal(mediaEntryActions({ entry: { single: 'v.mp4', ext: 'mp4' }, frozen: false, unused: false }).recapture, false);
});

test('a data url against a file\'s bytes', () => {
  const url = 'data:image/png;base64,' + Buffer.from([1, 2, 3, 250]).toString('base64');
  assert.deepEqual([...dataUrlBytes(url)], [1, 2, 3, 250]);
  assert.equal(dataUrlSize(url), 4);
  assert.equal(dataUrlSize('data:video/mp4;base64,' + Buffer.from([9, 9, 9, 9, 9]).toString('base64')), 5);
  assert.equal(sameBytes(dataUrlBytes(url), new Uint8Array([1, 2, 3, 250])), true);
  assert.equal(sameBytes(dataUrlBytes(url), new Uint8Array([1, 2, 3, 251])), false);
  assert.equal(sameBytes(dataUrlBytes(url), new Uint8Array([1, 2, 3])), false);
  assert.equal(dataUrlBytes('nonsense'), null);
  assert.equal(dataUrlSize('nonsense'), null);
});

console.log(`kbMediaEntry: ${passed} passed`);
