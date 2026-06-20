import assert from 'node:assert/strict';
import { videoBasePath } from '../scripts/videoCards.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

test('strips repo prefix and -light-mode suffix of a pair', () => {
  assert.equal(videoBasePath('docs/assets/media/videos/sites/x/tile-light-mode.mp4'), 'sites/x/tile');
});

test('strips library-relative prefix and -dark-mode suffix', () => {
  assert.equal(videoBasePath('media/videos/sites/x/tile-dark-mode.webm'), 'sites/x/tile');
});

test('a single video keeps its name (extension dropped)', () => {
  assert.equal(videoBasePath('media/videos/intro.mp4'), 'intro');
});

console.log(`videoBasePath: ${passed} passed`);
