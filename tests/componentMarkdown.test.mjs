import assert from 'node:assert/strict';
import { parseComponents, stripUUIDSpans, componentMarkdown, parsePastedComponents, uuidOfComponent } from '../scripts/components.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const ADM_RE = /step|note|tip/;

// A note admonition containing a nested capture — both with uuid spans.
const ADM_FIXTURE = [
  '!!! note "Widget setup"',
  '',
  '    <span data-uuid="ADM-1" style="display:none"></span>',
  '    Do the thing.',
  '',
  '    <span data-uuid="CAP-1" style="display:none"></span>',
  '    ![](../assets/x-light-mode.png#only-light){ width="800" loading=lazy }',
  '    ![](../assets/x-dark-mode.png#only-dark){ width="800" loading=lazy }',
].join('\n');

test('stripUUIDSpans: removes whole span lines at any indent, leaving no residue', () => {
  const out = stripUUIDSpans(ADM_FIXTURE);
  assert.ok(!out.includes('data-uuid'));
  // The indented span lines vanish entirely — no stray indent-only lines.
  assert.ok(!out.split('\n').some(l => /^\s+$/.test(l)));
  // Content survives.
  assert.ok(out.includes('Do the thing.'));
  assert.ok(out.includes('#only-light'));
});

test('componentMarkdown: admonition round-trips with nested capture, no spans, no leading blank', () => {
  const { components } = parseComponents(ADM_FIXTURE, ADM_RE);
  assert.equal(components.length, 1);
  const md = componentMarkdown(components[0]);
  assert.ok(md.startsWith('!!! note "Widget setup"'));
  assert.ok(!md.includes('data-uuid'));
  assert.ok(md.includes('#only-light'));
  assert.ok(md.includes('#only-dark'));
});

test('componentMarkdown: capture component emits the light/dark pair without a span', () => {
  const body = [
    '<span data-uuid="CAP-9" style="display:none"></span>',
    '![](../assets/y-light-mode.png#only-light){ width="640" loading=lazy }',
    '![](../assets/y-dark-mode.png#only-dark){ width="640" loading=lazy }',
  ].join('\n');
  const { components } = parseComponents(body, ADM_RE);
  const md = componentMarkdown(components[0]);
  assert.ok(!md.includes('data-uuid'));
  assert.ok(md.includes('![](../assets/y-light-mode.png#only-light)'));
});

test('parsePastedComponents: valid copy gains FRESH uuids', () => {
  const { components } = parseComponents(ADM_FIXTURE, ADM_RE);
  const pasted = componentMarkdown(components[0]); // what the Copy button puts on the clipboard
  const res = parsePastedComponents(pasted);
  assert.equal(res.error, null);
  assert.equal(res.components.length, 1);
  assert.equal(res.components[0].kind, 'admonition');
  const u = res.components[0].adm.uuid;
  assert.ok(typeof u === 'string' && u.length > 0 && u !== 'ADM-1');
});

test('parsePastedComponents: pre-existing uuid spans in the paste are replaced (never reused)', () => {
  const res = parsePastedComponents(ADM_FIXTURE); // raw markdown WITH old spans
  assert.equal(res.error, null);
  assert.notEqual(res.components[0].adm.uuid, 'ADM-1');
});

test('parsePastedComponents: multiple components keep their order', () => {
  const { components } = parseComponents(ADM_FIXTURE, ADM_RE);
  const adm = componentMarkdown(components[0]);
  const cap = [
    '![](../assets/z-light-mode.png#only-light)',
    '![](../assets/z-dark-mode.png#only-dark)',
  ].join('\n');
  const res = parsePastedComponents(adm + '\n\n' + cap);
  assert.equal(res.error, null);
  assert.deepEqual(res.components.map(c => c.kind), ['admonition', 'capture']);
});

test('parsePastedComponents: rejects empty / whitespace paste', () => {
  assert.ok(parsePastedComponents('').error);
  assert.ok(parsePastedComponents('   \n  ').error);
});

test('parsePastedComponents: rejects plain prose', () => {
  const res = parsePastedComponents('Just some text, not a component.');
  assert.equal(res.components, null);
  assert.ok(res.error);
});

test('parsePastedComponents: rejects components mixed with stray prose', () => {
  const { components } = parseComponents(ADM_FIXTURE, ADM_RE);
  const res = parsePastedComponents('Stray intro line.\n\n' + componentMarkdown(components[0]));
  assert.equal(res.components, null);
  assert.ok(res.error);
});

console.log(`\n${passed} passed`);
