import assert from 'node:assert/strict';
import {
  parseAdmonitions,
  buildAdmonition,
  replaceAdmonitionByUUID,
  injectAdmonitionUUID,
} from '../scripts/admonitions.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

test('parses !!! as static prefix', () => {
  assert.equal(parseAdmonitions('!!! note "T"\n\n    body\n', /note/)[0].prefix, '!!!');
});
test('parses ??? as collapsible-closed prefix', () => {
  assert.equal(parseAdmonitions('??? note "T"\n\n    body\n', /note/)[0].prefix, '???');
});
test('parses ???+ as collapsible-open prefix', () => {
  assert.equal(parseAdmonitions('???+ note "T"\n\n    body\n', /note/)[0].prefix, '???+');
});
test('???+ round-trips through buildAdmonition', () => {
  const block = buildAdmonition('???+', 'note', 'T', 'body');
  assert.equal(parseAdmonitions(block, /note/)[0].prefix, '???+');
});
test('replaceAdmonitionByUUID finds a ???+ block by uuid', () => {
  const body = injectAdmonitionUUID('body', 'u1');
  const md = buildAdmonition('???+', 'note', 'T', body);
  const replaced = replaceAdmonitionByUUID(md, 'u1', buildAdmonition('!!!', 'note', 'T2', body));
  const parsed = parseAdmonitions(replaced, /note/)[0];
  assert.equal(parsed.prefix, '!!!');
  assert.equal(parsed.title, 'T2');
});

console.log(`\n${passed} passed`);
