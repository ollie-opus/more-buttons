import assert from 'node:assert/strict';
import { scanMarkdownMediaPaths, isTrackedPagePath, USAGE_INDEX_PATH } from '../scripts/mediaUsage.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const CAP_LIGHT = 'docs/assets/media/occ-captures/foo-light-mode.png';
const CAP_DARK = 'docs/assets/media/occ-captures/foo-dark-mode.png';

// ── scanMarkdownMediaPaths ────────────────────────────────────────────────────
test('scan finds a capture pair as both repo paths with the docs/assets prefix', () => {
  const md = [
    '<span data-uuid="u1" style="display:none"></span>',
    '![](../assets/media/occ-captures/foo-light-mode.png#only-light){ style="height: 50px" loading=lazy }',
    '![](../assets/media/occ-captures/foo-dark-mode.png#only-dark){ style="height: 50px" loading=lazy }',
  ].join('\n');
  assert.deepEqual(scanMarkdownMediaPaths(md), [CAP_DARK, CAP_LIGHT]);
});

test('scan counts an inversed capture pair (hashes swapped)', () => {
  const md = [
    '![](../assets/media/occ-captures/foo-light-mode.png#only-dark){ loading=lazy }',
    '![](../assets/media/occ-captures/foo-dark-mode.png#only-light){ loading=lazy }',
  ].join('\n');
  assert.deepEqual(scanMarkdownMediaPaths(md), [CAP_DARK, CAP_LIGHT]);
});

test('scan counts an indented capture nested inside an admonition body', () => {
  const md = [
    '!!! note "Note"',
    '',
    '    <span data-uuid="u2" style="display:none"></span>',
    '    ![](../assets/media/occ-captures/foo-light-mode.png#only-light){ loading=lazy }',
    '    ![](../assets/media/occ-captures/foo-dark-mode.png#only-dark){ loading=lazy }',
  ].join('\n');
  assert.deepEqual(scanMarkdownMediaPaths(md), [CAP_DARK, CAP_LIGHT]);
});

test('scan finds a video pair as both repo paths', () => {
  const md = [
    '<video src="../assets/media/videos/demo-light-mode.mp4#only-light" autoplay loop muted playsinline preload="none" style="height: 50px"></video>',
    '<video src="../assets/media/videos/demo-dark-mode.mp4#only-dark" autoplay loop muted playsinline preload="none" style="height: 50px"></video>',
  ].join('\n');
  assert.deepEqual(scanMarkdownMediaPaths(md), [
    'docs/assets/media/videos/demo-dark-mode.mp4',
    'docs/assets/media/videos/demo-light-mode.mp4',
  ]);
});

test('scan finds a single (theme-less) video as one path', () => {
  const md = '<video src="../assets/media/videos/solo.mp4" autoplay loop muted playsinline preload="none"></video>';
  assert.deepEqual(scanMarkdownMediaPaths(md), ['docs/assets/media/videos/solo.mp4']);
});

test('scan finds a single image as one path', () => {
  const md = '![](../assets/media/buttons/logo.png){ style="height: 40px" }';
  assert.deepEqual(scanMarkdownMediaPaths(md), ['docs/assets/media/buttons/logo.png']);
});

// Usage means ANY reference — unlike the component parsers, prose-style
// references (alt-text images, plain links) count too. Regression: an
// alt-text image in system-updates.md was invisible to the component-based
// scan, so its file showed "Not used on any pages".
test('scan counts images with alt text (usage = any reference)', () => {
  assert.deepEqual(scanMarkdownMediaPaths('![diagram](../assets/media/buttons/logo.png)'), ['docs/assets/media/buttons/logo.png']);
});

test('scan counts the real-world alt-text + attrs line from system-updates', () => {
  const md = '![Animation](../assets/media/other/screenshots/APaQ0SSK7BZKp_GweT7f6oecXlvJorS_huozrp_4_7ccdb102.png){ width="700" loading=lazy }';
  assert.deepEqual(scanMarkdownMediaPaths(md), ['docs/assets/media/other/screenshots/APaQ0SSK7BZKp_GweT7f6oecXlvJorS_huozrp_4_7ccdb102.png']);
});

test('scan counts a plain prose link to an asset', () => {
  assert.deepEqual(scanMarkdownMediaPaths('See [the form](../assets/media/other/blank-form.pdf) for details.'), ['docs/assets/media/other/blank-form.pdf']);
});

test('scan counts a lone hashless -light-mode line (still a reference)', () => {
  assert.deepEqual(scanMarkdownMediaPaths('![](../assets/media/occ-captures/foo-light-mode.png)'), [CAP_LIGHT]);
});

test('scan strips #only-* fragments and quote/paren delimiters cleanly', () => {
  const md = '<video src="../assets/media/videos/demo.mp4#only-light" autoplay></video>';
  assert.deepEqual(scanMarkdownMediaPaths(md), ['docs/assets/media/videos/demo.mp4']);
});

test('scan dedupes repeats and returns sorted output', () => {
  const cap = [
    '![](../assets/media/occ-captures/foo-light-mode.png#only-light){ loading=lazy }',
    '![](../assets/media/occ-captures/foo-dark-mode.png#only-dark){ loading=lazy }',
  ].join('\n');
  const md = [cap, '', 'Some text.', '', cap, '', '![](../assets/media/buttons/a.png)'].join('\n');
  assert.deepEqual(scanMarkdownMediaPaths(md), ['docs/assets/media/buttons/a.png', CAP_DARK, CAP_LIGHT]);
});

test('scan returns [] for empty or media-free markdown', () => {
  assert.deepEqual(scanMarkdownMediaPaths(''), []);
  assert.deepEqual(scanMarkdownMediaPaths('# Title\n\nJust prose.'), []);
});

// ── isTrackedPagePath ─────────────────────────────────────────────────────────
test('isTrackedPagePath accepts pages and drafts markdown, including system files', () => {
  assert.equal(isTrackedPagePath('docs/pages/alpha.md'), true);
  assert.equal(isTrackedPagePath('docs/drafts/alpha.md'), true);
  assert.equal(isTrackedPagePath('docs/pages/system-updates.md'), true);
  assert.equal(isTrackedPagePath('docs/pages/system-status.md'), true);
});

test('isTrackedPagePath rejects everything else', () => {
  assert.equal(isTrackedPagePath('zensical.toml'), false);
  assert.equal(isTrackedPagePath(USAGE_INDEX_PATH), false);
  assert.equal(isTrackedPagePath('docs/index.md'), false);
  assert.equal(isTrackedPagePath('docs/assets/media/occ-captures/foo-light-mode.png'), false);
  assert.equal(isTrackedPagePath('docs/pages/not-markdown.png'), false);
});

console.log(`\n${passed} passed`);
