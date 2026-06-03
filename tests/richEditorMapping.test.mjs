import assert from 'node:assert/strict';
import { buildSource, serialize, serializeWithSelection, locateOffset } from '../scripts/richEditorMapping.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// --- Minimal fake DOM (mirrors the Node interface buildSource reads) ---
const TEXT_NODE = 3, ELEMENT_NODE = 1;
function txt(value) {
  return { nodeType: TEXT_NODE, nodeValue: value, childNodes: [],
           get textContent() { return value; } };
}
function el(tag, ...children) {
  return {
    nodeType: ELEMENT_NODE, tagName: tag.toUpperCase(), childNodes: children, _attrs: {},
    getAttribute(n) { return this._attrs[n] ?? null; },
    setAttribute(n, v) { this._attrs[n] = v; },
    get firstChild() { return children[0] || null; },
    get textContent() { return children.map(c => c.textContent).join(''); },
  };
}
function link(href, text) { const a = el('a', txt(text)); a.setAttribute('href', href); return a; }
// Export-ish helpers reused by later tasks live in this same file.
globalThis.__rteFake = { txt, el, link, TEXT_NODE, ELEMENT_NODE };

test('serialize plain text', () => {
  assert.equal(serialize(el('root', txt('foo'))), 'foo');
});
test('serialize bold (strong -> **)', () => {
  assert.equal(serialize(el('root', el('strong', txt('foo')))), '**foo**');
});
test('serialize nested strong>em -> ***x***', () => {
  assert.equal(serialize(el('root', el('strong', el('em', txt('x'))))), '***x***');
});
test('serialize all marks', () => {
  assert.equal(serialize(el('root', el('u', txt('a')))), '^^a^^');
  assert.equal(serialize(el('root', el('s', txt('a')))), '~~a~~');
  assert.equal(serialize(el('root', el('mark', txt('a')))), '==a==');
  assert.equal(serialize(el('root', el('em', txt('a')))), '*a*');
});
test('serialize link -> [text](href)', () => {
  assert.equal(serialize(el('root', link('https://x', 'y'))), '[y](https://x)');
});
test('serialize <br> -> newline', () => {
  assert.equal(serialize(el('root', txt('a'), el('br'), txt('b'))), 'a\nb');
});
test('serialize div block -> newline boundary', () => {
  assert.equal(serialize(el('root', txt('a'), el('div', txt('b')))), 'a\nb');
});
test('serialize unknown element unwraps to contents', () => {
  assert.equal(serialize(el('root', el('span', txt('a')))), 'a');
});
test('buildSource onText reports source start offsets', () => {
  const fooNode = txt('foo');
  const seen = [];
  buildSource(el('root', el('strong', fooNode)), (node, start) => seen.push([node.nodeValue, start]));
  assert.deepEqual(seen, [['foo', 2]]); // after the leading '**'
});

// A fake Selection: anchor/focus are {node, offset} pairs.
function sel(aNode, aOff, fNode, fOff) {
  return { anchorNode: aNode, anchorOffset: aOff, focusNode: fNode ?? aNode, focusOffset: fNode ? fOff : aOff };
}

test('selection over whole bold inner text', () => {
  const t = txt('foo');
  const root = el('root', el('strong', t));
  assert.deepEqual(serializeWithSelection(root, sel(t, 0, t, 3)),
    { value: '**foo**', selStart: 2, selEnd: 5 });
});
test('partial selection inside a mark', () => {
  const t = txt('foo');
  const root = el('root', el('strong', t));
  assert.deepEqual(serializeWithSelection(root, sel(t, 1, t, 3)),
    { value: '**foo**', selStart: 3, selEnd: 5 });
});
test('selection spanning two text nodes', () => {
  const a = txt('a'); const b = txt('b');
  const root = el('root', a, el('strong', b));
  assert.deepEqual(serializeWithSelection(root, sel(a, 0, b, 1)),
    { value: 'a**b**', selStart: 0, selEnd: 4 }); // 'a'=1 + '**'=2 -> b starts at 3, +1
});
test('reversed selection (focus before anchor) normalizes', () => {
  const t = txt('foo');
  const root = el('root', t);
  assert.deepEqual(serializeWithSelection(root, sel(t, 3, t, 0)),
    { value: 'foo', selStart: 0, selEnd: 3 });
});
test('collapsed caret at element boundary (empty surface)', () => {
  const root = el('root');
  assert.deepEqual(serializeWithSelection(root, sel(root, 0)),
    { value: '', selStart: 0, selEnd: 0 });
});
test('caret at element child boundary between nodes', () => {
  const a = txt('a'); const strong = el('strong', txt('b'));
  const root = el('root', a, strong);
  // caret at root, childIndex 1 -> just after 'a', before '**b**'
  assert.deepEqual(serializeWithSelection(root, sel(root, 1)),
    { value: 'a**b**', selStart: 1, selEnd: 1 });
});

test('locateOffset into plain text', () => {
  const t = txt('foo');
  assert.deepEqual(locateOffset(el('root', t), 2), { node: t, offset: 2 });
});
test('locateOffset maps source offset past a marker to text-node start', () => {
  const t = txt('foo'); // value '**foo**', text starts at source 2
  const root = el('root', el('strong', t));
  assert.deepEqual(locateOffset(root, 2), { node: t, offset: 0 });
  assert.deepEqual(locateOffset(root, 5), { node: t, offset: 3 });
});
test('locateOffset in a delimiter gap clamps to next text node start', () => {
  const foo = txt('foo'); const bar = txt('bar');
  const root = el('root', el('strong', foo), bar); // '**foo**bar', bar starts at 7
  // source offset 6 sits inside the closing '**' -> clamp to start of next text
  assert.deepEqual(locateOffset(root, 6), { node: bar, offset: 0 });
});
test('locateOffset past the end returns end of last text node', () => {
  const t = txt('foo');
  assert.deepEqual(locateOffset(el('root', t), 99), { node: t, offset: 3 });
});
test('locateOffset on empty surface returns root,0', () => {
  const root = el('root');
  assert.deepEqual(locateOffset(root, 0), { node: root, offset: 0 });
});

// An emptied mark element (e.g. the user deleted all text inside a <strong>)
// must NOT serialize to bare delimiters '****' — that corrupts the source and
// renders literally. Empty marks are dropped entirely.
test('serialize drops an empty mark element (no bare delimiters)', () => {
  assert.equal(serialize(el('root', el('strong'))), '');
  assert.equal(serialize(el('root', el('strong', txt('')))), '');
});
test('serialize drops empty mark but keeps siblings', () => {
  assert.equal(serialize(el('root', txt('a'), el('strong'), txt('b'))), 'ab');
});
test('serialize keeps non-empty marks (regression)', () => {
  assert.equal(serialize(el('root', el('strong', txt('x')))), '**x**');
});
test('serialize drops nested empty marks', () => {
  assert.equal(serialize(el('root', el('strong', el('em')))), '');
});

console.log(`\n${passed} passed`);
