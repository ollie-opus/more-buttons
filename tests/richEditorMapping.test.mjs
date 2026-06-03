import assert from 'node:assert/strict';
import { buildSource, serialize } from '../scripts/richEditorMapping.js';

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

console.log(`\n${passed} passed`);
