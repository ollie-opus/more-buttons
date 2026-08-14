import assert from 'node:assert/strict';
import { cardPreviewModel } from '../scripts/components.js';
import { cardPreviewBlock } from '../scripts/cardRenderer.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const span = (uuid, indent = '') => `${indent}<span data-uuid="${uuid}" style="display:none"></span>`;

// Composite body: description + nested note (itself holding a capture — the
// depth-2 leak case) + pipe table + capture pair + tabs group + mermaid fence.
const COMPOSITE = [
  span('PARENT'),
  'Intro description with **bold**.',
  '',
  '!!! note "Nested note"',
  '',
  '    ' + span('ADM-1').trim(),
  '    Inner description text.',
  '',
  '    ' + span('CAP-2').trim(),
  '    ![](../assets/inner-light-mode.png#only-light){ width="800" loading=lazy }',
  '    ![](../assets/inner-dark-mode.png#only-dark){ width="800" loading=lazy }',
  '',
  span('TBL-1'),
  '',
  '| Method | Description |',
  '| :--- | :---: |',
  '| `GET` | Fetch resource |',
  '',
  span('CAP-1'),
  '![](../assets/x-light-mode.png#only-light){ width="800" loading=lazy }',
  '![](../assets/x-dark-mode.png#only-dark){ width="800" loading=lazy }',
  '',
  span('G-1'),
  '=== "One"',
  '',
  '    a',
  '',
  '=== "Two"',
  '',
  '    b',
  '',
  span('DIA-1'),
  '```mermaid',
  'graph TD; A-->B;',
  '```',
].join('\n');

test('model: description separated from all nested component markdown', () => {
  const m = cardPreviewModel(COMPOSITE);
  assert.equal(m.description, 'Intro description with **bold**.');
  assert.equal(m.subs.length, 5);
  assert.deepEqual(m.subs.map(s => s.kind), ['admonition', 'table', 'capture', 'tabs', 'diagram']);
});

test('model: nested admonition carries description only — grandchild capture dropped', () => {
  const m = cardPreviewModel(COMPOSITE);
  const adm = m.subs[0];
  assert.equal(adm.type, 'note');
  assert.equal(adm.title, 'Nested note');
  assert.equal(adm.description, 'Inner description text.');
  assert.equal(adm.description.includes('only-light'), false);
});

test('model: per-kind view models', () => {
  const m = cardPreviewModel(COMPOSITE);
  assert.deepEqual(m.subs[1], { kind: 'table', cols: 2, rows: 1 });
  assert.equal(m.subs[2].filename, 'x-light-mode.png');
  assert.deepEqual(m.subs[3], { kind: 'tabs', titles: ['One', 'Two'] });
  assert.deepEqual(m.subs[4], { kind: 'diagram' });
});

test('block: collapsed shows first sub, rest container holds the others', () => {
  const html = cardPreviewBlock(cardPreviewModel(COMPOSITE));
  assert.equal(html.includes('data-card-preview'), true);
  assert.equal(html.includes('mb-card-subs-rest'), true);
  const [beforeRest, rest] = html.split('mb-card-subs-rest');
  assert.equal(beforeRest.includes('mb-card-sub '), true);       // first sub (mini-card) visible
  assert.equal(rest.includes('x-light-mode.png'), true);         // capture is in the hidden rest
});

test('block: 2+ subs → Show more visible from render, has-rest flag set', () => {
  const html = cardPreviewBlock(cardPreviewModel(COMPOSITE));
  assert.equal(html.includes('data-card-has-rest="1"'), true);
  assert.equal(/data-card-expand[^>]*hidden/.test(html), false);
});

test('block: no raw component markdown leaks', () => {
  const html = cardPreviewBlock(cardPreviewModel(COMPOSITE));
  for (const leak of ['!!! note', '=== "', '|---|', '| :--- |', '```mermaid', 'data-uuid']) {
    assert.equal(html.includes(leak), false, `leaked: ${leak}`);
  }
});

test('block: subs are inert — no action attrs, no foot', () => {
  const html = cardPreviewBlock(cardPreviewModel(COMPOSITE));
  for (const attr of ['data-edit', 'data-copy', 'data-move', 'mb-incident-card__foot']) {
    assert.equal(html.includes(attr), false, `found: ${attr}`);
  }
});

test('block: media subs render bare (img, no card chrome)', () => {
  const m = cardPreviewModel([span('CAP-1'),
    '![](../assets/y-light-mode.png#only-light){ width="640" loading=lazy }',
    '![](../assets/y-dark-mode.png#only-dark){ width="640" loading=lazy }',
  ].join('\n'));
  const html = cardPreviewBlock(m);
  assert.equal(html.includes('<img class="mb-component-card__thumb mb-card-sub-media"'), true);
  assert.equal(html.includes('docs/assets/y-light-mode.png'), true);
  assert.equal(html.includes('mb-incident-card mb-card-sub'), false);
});

test('block: 1 sub → no rest container, Show more starts hidden', () => {
  const m = cardPreviewModel(['Short.', '', span('TBL-1'), '', '| a |', '| :--- |', '| b |'].join('\n'));
  const html = cardPreviewBlock(m);
  assert.equal(html.includes('mb-card-subs-rest'), false);
  assert.equal(html.includes('data-card-has-rest="0"'), true);
  assert.equal(/data-card-expand[^>]*hidden/.test(html), true);
});

test('block: subs with empty description → no clamp div, subs still render', () => {
  const m = cardPreviewModel([span('P'), '', '!!! tip "Only child"', '', '    body'].join('\n'));
  const html = cardPreviewBlock(m);
  assert.equal(html.includes('data-card-clamp'), false);
  assert.equal(html.includes('Only child'), true);
});

test('block: empty body → empty string', () => {
  assert.equal(cardPreviewBlock(cardPreviewModel('')), '');
  assert.equal(cardPreviewBlock(cardPreviewModel(span('P') + '\n')), '');
});

console.log(`cardPreview: ${passed} tests passed`);
