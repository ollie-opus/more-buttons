import assert from 'node:assert/strict';
import { parseInline } from '../scripts/markdownInline.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

test('plain text → single text node', () => {
  assert.deepEqual(parseInline('hello'), [{ type: 'text', value: 'hello' }]);
});
test('bold', () => {
  assert.deepEqual(parseInline('**x**'), [{ type: 'strong', children: [{ type: 'text', value: 'x' }] }]);
});
test('italic uses single asterisk only', () => {
  assert.deepEqual(parseInline('*x*'), [{ type: 'em', children: [{ type: 'text', value: 'x' }] }]);
});
test('underscores stay literal', () => {
  assert.deepEqual(parseInline('some_var_name'), [{ type: 'text', value: 'some_var_name' }]);
});
test('underline / strike / highlight', () => {
  assert.equal(parseInline('^^x^^')[0].type, 'underline');
  assert.equal(parseInline('~~x~~')[0].type, 'strike');
  assert.equal(parseInline('==x==')[0].type, 'highlight');
});
test('bold beats italic (** before *)', () => {
  assert.deepEqual(parseInline('**x**'), [{ type: 'strong', children: [{ type: 'text', value: 'x' }] }]);
});
test('nested marks (distinct endpoints)', () => {
  // Normal nesting works: the inner italic sits cleanly inside the bold.
  assert.deepEqual(parseInline('**a *b* c**'), [{
    type: 'strong',
    children: [
      { type: 'text', value: 'a ' },
      { type: 'em', children: [{ type: 'text', value: 'b' }] },
      { type: 'text', value: ' c' },
    ],
  }]);
});
test('shared-endpoint triple is a v1 limitation (lazy, not nested)', () => {
  // `**a*b***` does NOT become strong>em — lazy matching closes the bold at the
  // first `**`, leaving the trailing `*` literal. Documented limitation; still
  // round-trips to the same Markdown (see round-trip test).
  assert.deepEqual(parseInline('**a*b***'), [
    { type: 'strong', children: [{ type: 'text', value: 'a*b' }] },
    { type: 'text', value: '*' },
  ]);
});
test('adjacent same-type marks stay independent', () => {
  // Regression guard: lazy matching must NOT merge two emphases across the gap.
  assert.deepEqual(parseInline('*a* and *b*'), [
    { type: 'em', children: [{ type: 'text', value: 'a' }] },
    { type: 'text', value: ' and ' },
    { type: 'em', children: [{ type: 'text', value: 'b' }] },
  ]);
  assert.deepEqual(parseInline('**a** plain **b**'), [
    { type: 'strong', children: [{ type: 'text', value: 'a' }] },
    { type: 'text', value: ' plain ' },
    { type: 'strong', children: [{ type: 'text', value: 'b' }] },
  ]);
});
test('link with plain text', () => {
  assert.deepEqual(parseInline('[go](http://x)'), [{
    type: 'link', href: 'http://x', children: [{ type: 'text', value: 'go' }],
  }]);
});
test('unmatched delimiter stays literal', () => {
  assert.deepEqual(parseInline('a ** b'), [{ type: 'text', value: 'a ** b' }]);
});
test('empty delimiter stays literal', () => {
  assert.deepEqual(parseInline('****'), [{ type: 'text', value: '****' }]);
});
test('unsupported block markdown passes through', () => {
  assert.deepEqual(parseInline('- item'), [{ type: 'text', value: '- item' }]);
});
test('newlines preserved in text', () => {
  assert.deepEqual(parseInline('a\nb'), [{ type: 'text', value: 'a\nb' }]);
});

console.log(`\n${passed} passed`);
