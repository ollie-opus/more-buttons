import assert from 'node:assert/strict';
import { parseInline, renderMarkdown, renderHtml, markSpans } from '../scripts/markdownInline.js';

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
test('symmetric triple ***x*** nests as bold>italic', () => {
  // A matched `***…***` run (what stacking Bold then Italic produces) renders as
  // nested strong>em, unlike the asymmetric `**a*b***` case above.
  assert.deepEqual(parseInline('***x***'), [{
    type: 'strong',
    children: [{ type: 'em', children: [{ type: 'text', value: 'x' }] }],
  }]);
});
test('triple-star wraps a full nested mark stack', () => {
  // ***^^~~==test==~~^^*** — bold+italic outside, underline/strike/highlight in.
  assert.equal(
    renderHtml(parseInline('***^^~~==test==~~^^***')),
    '<strong><em><u><s><mark>test</mark></s></u></em></strong>');
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

test('renderMarkdown of text', () => {
  assert.equal(renderMarkdown([{ type: 'text', value: 'hi' }]), 'hi');
});
test('renderMarkdown of each mark', () => {
  assert.equal(renderMarkdown([{ type: 'strong', children: [{ type: 'text', value: 'x' }] }]), '**x**');
  assert.equal(renderMarkdown([{ type: 'em', children: [{ type: 'text', value: 'x' }] }]), '*x*');
  assert.equal(renderMarkdown([{ type: 'underline', children: [{ type: 'text', value: 'x' }] }]), '^^x^^');
  assert.equal(renderMarkdown([{ type: 'strike', children: [{ type: 'text', value: 'x' }] }]), '~~x~~');
  assert.equal(renderMarkdown([{ type: 'highlight', children: [{ type: 'text', value: 'x' }] }]), '==x==');
});
test('renderMarkdown of link', () => {
  assert.equal(renderMarkdown([{ type: 'link', href: 'http://x', children: [{ type: 'text', value: 'go' }] }]), '[go](http://x)');
});
test('round-trip: renderMarkdown(parseInline(md)) === md', () => {
  for (const md of [
    'plain text',
    '**bold** and *italic*',
    '^^under^^ ~~strike~~ ==hi==',
    '**a*b***',
    '***x***',
    '***^^~~==test==~~^^***',
    '[go](http://x)',
    'a ** b',
    '****',
    '- item\n- two',
    'some_var_name',
    'line one\nline two',
  ]) {
    assert.equal(renderMarkdown(parseInline(md)), md, `failed for: ${JSON.stringify(md)}`);
  }
});
test('parse is idempotent', () => {
  const once = parseInline('**a*b*** plain');
  const twice = parseInline(renderMarkdown(once));
  assert.deepEqual(twice, once);
});
test('markSpans reports matched pairs with source positions', () => {
  assert.deepEqual(markSpans('**testing** 12345'),
    [{ marker: '**', open: [0, 2], close: [9, 11] }]);
});
test('markSpans reports nested pairs too', () => {
  // strong wrapping an em: both spans, outer first.
  assert.deepEqual(markSpans('**a *b* c**'), [
    { marker: '**', open: [0, 2], close: [9, 11] },
    { marker: '*', open: [4, 5], close: [6, 7] },
  ]);
});
test('clipped overlap renders as separate, non-overlapping marks', () => {
  // After clipping, a straddling underline only formats the clean outside part,
  // so the result is two independent marks (no literal ^^, no overlap).
  assert.equal(renderHtml(parseInline('**testing** ^^12345^^')),
    '<strong>testing</strong> <u>12345</u>');
});
test('renderHtml escapes HTML in text', () => {
  assert.equal(renderHtml([{ type: 'text', value: 'a < b & c > d' }]), 'a &lt; b &amp; c &gt; d');
});
test('renderHtml maps marks to tags', () => {
  assert.equal(renderHtml(parseInline('**b** *i* ^^u^^ ~~s~~ ==h==')),
    '<strong>b</strong> <em>i</em> <u>u</u> <s>s</s> <mark>h</mark>');
});
test('renderHtml link escapes href quotes', () => {
  assert.equal(renderHtml([{ type: 'link', href: 'http://x?a="b"', children: [{ type: 'text', value: 'go' }] }]),
    '<a href="http://x?a=&quot;b&quot;">go</a>');
});
test('renderHtml maps newlines to <br>', () => {
  assert.equal(renderHtml([{ type: 'text', value: 'a\nb' }]), 'a<br>b');
});
test('renderHtml preserves literal markdown-looking HTML as escaped text', () => {
  assert.equal(renderHtml([{ type: 'text', value: '<div>raw</div>' }]), '&lt;div&gt;raw&lt;/div&gt;');
});

console.log(`\n${passed} passed`);
