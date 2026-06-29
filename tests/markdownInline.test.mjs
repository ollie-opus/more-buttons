import assert from 'node:assert/strict';
import { parseInline, renderMarkdown, renderHtml, markSpans, matchGroove, grooveMarkup, grooveTextOffset, matchLabel, labelMarkup, labelTextOffset } from '../scripts/markdownInline.js';

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
test('underline / strike / highlight / code', () => {
  assert.equal(parseInline('^^x^^')[0].type, 'underline');
  assert.equal(parseInline('~~x~~')[0].type, 'strike');
  assert.equal(parseInline('==x==')[0].type, 'highlight');
  assert.equal(parseInline('`x`')[0].type, 'code');
});
test('code renders to a <code> element', () => {
  assert.equal(renderHtml(parseInline('`npm i`')), '<code>npm i</code>');
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
  assert.equal(renderMarkdown([{ type: 'code', children: [{ type: 'text', value: 'x' }] }]), '`x`');
});
test('renderMarkdown of link', () => {
  assert.equal(renderMarkdown([{ type: 'link', href: 'http://x', children: [{ type: 'text', value: 'go' }] }]), '[go](http://x)');
});
test('round-trip: renderMarkdown(parseInline(md)) === md', () => {
  for (const md of [
    'plain text',
    '**bold** and *italic*',
    '^^under^^ ~~strike~~ ==hi==',
    'run `npm i` first',
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

// ── Groove-support links ──────────────────────────────────────────────────────
// Canonical anchor (raw HTML in the source so Zensical renders a working widget).
const G = t => `<a href="#" onclick="event.preventDefault(); window.groove.widget.open();">${t}</a>`;

test('matchGroove recognizes the canonical anchor', () => {
  const v = 'hi ' + G('sample text') + ' bye';
  assert.deepEqual(matchGroove(v, 3), { text: 'sample text', end: 3 + G('sample text').length });
});
test('matchGroove returns null off a non-groove anchor', () => {
  assert.equal(matchGroove('hello', 0), null);
  assert.equal(matchGroove('<a href="#">x</a>', 0), null);
});
test('parseInline produces a groove node', () => {
  assert.deepEqual(parseInline(G('hello')), [{ type: 'groove', text: 'hello' }]);
});
test('groove round-trips through renderMarkdown', () => {
  const v = 'see ' + G('support') + ' now';
  assert.equal(renderMarkdown(parseInline(v)), v);
});
test('renderHtml renders a groove badge without onclick', () => {
  assert.equal(renderHtml([{ type: 'groove', text: 'help' }]),
    '<a href="#" class="mb-groove-link" data-groove="1">help</a>');
});
test('grooveMarkup / grooveTextOffset are consistent', () => {
  assert.equal(grooveMarkup('x'), G('x'));
  assert.equal(grooveTextOffset, G('').indexOf('</a>')); // offset to inner text == open length
});
test('markSpans skips a groove anchor (no phantom spans from inner * or ==)', () => {
  assert.deepEqual(markSpans(G('a *b* ==c==')), []);
});
test('markSpans still finds marks outside a groove anchor', () => {
  assert.deepEqual(markSpans('**x** ' + G('y')).map(s => s.marker), ['**']);
});

// ── Label pills (atomic raw-HTML span, like Groove) ──────────────────────────
const L = (slug, t) => `<span class="mb-label mb-label-${slug}">${t}</span>`;

test('parseInline: a label span → atomic label node', () => {
  assert.deepEqual(parseInline(L('red', 'Beta')), [{ type: 'label', slug: 'red', text: 'Beta' }]);
});
test('parseInline: label among text keeps neighbours', () => {
  assert.deepEqual(parseInline('a ' + L('teal', 'New') + ' b'), [
    { type: 'text', value: 'a ' },
    { type: 'label', slug: 'teal', text: 'New' },
    { type: 'text', value: ' b' },
  ]);
});
test('renderHtml: label → class-only span (colour painted later)', () => {
  assert.equal(renderHtml(parseInline(L('slate', 'x'))), L('slate', 'x'));
});
test('renderHtml: label text is escaped', () => {
  assert.equal(renderHtml([{ type: 'label', slug: 'red', text: 'a & b' }]), L('red', 'a &amp; b'));
});
test('round-trip: renderMarkdown(parseInline(md)) === md', () => {
  const md = 'see ' + L('amber', 'WIP') + ' here';
  assert.equal(renderMarkdown(parseInline(md)), md);
});
test('matchLabel reads slug + text; labelMarkup/labelTextOffset are consistent', () => {
  assert.deepEqual(matchLabel(L('rose', 'hi'), 0), { slug: 'rose', text: 'hi', end: L('rose', 'hi').length });
  assert.equal(matchLabel('nope', 0), null);
  assert.equal(labelMarkup('rose', 'hi'), L('rose', 'hi'));
  assert.equal(labelTextOffset('rose'), L('rose', '').indexOf('</span>')); // offset to inner text == open length
});
test('markSpans skips a label span (no phantom marks from inner * or ==)', () => {
  assert.deepEqual(markSpans(L('blue', 'a *b* ==c==')), []);
});

console.log(`\n${passed} passed`);
