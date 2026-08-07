import assert from 'node:assert/strict';
import {
  parseAdmonitions,
  buildAdmonition,
  splitTitleMeta,
  joinTitleMeta,
  stripLabelSpans,
} from '../scripts/admonitions.js';
import { titleWithLabelsHtml } from '../scripts/cardRenderer.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const pill = (slug, text) => `<span class="mb-label mb-label-${slug}">${text}</span>`;

// ── stripLabelSpans ───────────────────────────────────────────────────────────

test('stripLabelSpans leaves a plain title unchanged', () => {
  assert.equal(stripLabelSpans('Configure access'), 'Configure access');
});
test('stripLabelSpans unwraps a single pill', () => {
  assert.equal(stripLabelSpans(pill('red', 'Beta')), 'Beta');
});
test('stripLabelSpans unwraps multiple pills amid text', () => {
  assert.equal(
    stripLabelSpans(`Release ${pill('purple', 'Beta')} notes ${pill('green', 'New')}`),
    'Release Beta notes New');
});
test('stripLabelSpans leaves a malformed span intact', () => {
  const bad = '<span class="mb-label">no slug</span>';
  assert.equal(stripLabelSpans(bad), bad);
});
test('stripLabelSpans handles empty / nullish input', () => {
  assert.equal(stripLabelSpans(''), '');
  assert.equal(stripLabelSpans(undefined), '');
});

// ── titleWithLabelsHtml ───────────────────────────────────────────────────────

test('titleWithLabelsHtml escapes plain text', () => {
  assert.equal(titleWithLabelsHtml('a <b> & "c"'), 'a &lt;b&gt; &amp; &quot;c&quot;');
});
test('titleWithLabelsHtml re-emits a pill with escaped inner text', () => {
  assert.equal(
    titleWithLabelsHtml(pill('red', 'a & b')),
    '<span class="mb-label mb-label-red">a &amp; b</span>');
});
test('titleWithLabelsHtml escapes text around pills', () => {
  assert.equal(
    titleWithLabelsHtml(`<x> ${pill('teal', 'Go')} & done`),
    `&lt;x&gt; <span class="mb-label mb-label-teal">Go</span> &amp; done`);
});
test('titleWithLabelsHtml fully escapes a malformed span (no live HTML)', () => {
  const bad = '<span class="mb-label">text</span>';
  assert.equal(titleWithLabelsHtml(bad), '&lt;span class=&quot;mb-label&quot;&gt;text&lt;/span&gt;');
});
test('titleWithLabelsHtml rejects slugs outside [a-z0-9-]', () => {
  const bad = '<span class="mb-label mb-label-Red!">text</span>';
  assert.ok(!titleWithLabelsHtml(bad).includes('<span'));
});
test('titleWithLabelsHtml handles empty / nullish input', () => {
  assert.equal(titleWithLabelsHtml(''), '');
  assert.equal(titleWithLabelsHtml(undefined), '');
});

// ── header round-trip ─────────────────────────────────────────────────────────

test('pill-bearing title round-trips through buildAdmonition/parseAdmonitions', () => {
  const title = `Release ${pill('purple', 'Beta')} notes`;
  const block = buildAdmonition('!!!', 'note', title, 'body');
  assert.equal(parseAdmonitions(block, /note/)[0].title, title);
});
test('pill text containing a quote survives the greedy title group', () => {
  const title = pill('red', 'say "hi"');
  const block = buildAdmonition('???+', 'note', title, 'body');
  const parsed = parseAdmonitions(block, /note/)[0];
  assert.equal(parsed.title, title);
  assert.equal(parsed.prefix, '???+');
});

// ── pills vs the trailing meta span ───────────────────────────────────────────

test('pill title + trailing meta splits and re-joins losslessly', () => {
  const visible = `Configure ${pill('green', 'New')} access`;
  const raw = joinTitleMeta(visible, '(optional)');
  const { title, meta } = splitTitleMeta(raw);
  assert.equal(title, visible);
  assert.equal(meta, '(optional)');
  assert.equal(joinTitleMeta(title, meta), raw);
});
test('a title ENDING with a pill is not mistaken for a meta span', () => {
  const visible = `Release ${pill('purple', 'Beta')}`;
  const { title, meta } = splitTitleMeta(visible);
  assert.equal(title, visible);
  assert.equal(meta, '');
});

console.log(`\n${passed} passed`);
