import assert from 'node:assert/strict';
import { renderDocHtml } from '../scripts/markdownInline.js';
import { insertHorizontalRule } from '../scripts/markdownToolbarActions.js';
import { serialize } from '../scripts/richEditorMapping.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// The separator is a markdown-only feature: the button inserts `---`, but the
// rich surface does NOT render it as a block <hr> (a contentless block widget
// can't host the caret in this editor's <br>-based line model — it merged typed
// text onto its own line). So `---` is plain text in Rich mode and renders as a
// real rule only on the published site.

// ── `---` is plain text in the rich surface (NOT a block rule) ────────────────

test('renderDocHtml: --- renders as literal text, not an <hr>', () => {
  assert.equal(renderDocHtml('---'), '---');
});
test('renderDocHtml: --- between text stays on its own text line', () => {
  assert.equal(renderDocHtml('a\n\n---\n\nb'), 'a<br><br>---<br><br>b');
});

// ── serialize: a --- text line round-trips (fake DOM mirrors markdownLists) ───

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

test('serialize a --- text line + surrounding breaks round-trips the source', () => {
  const root = el('root', txt('a'), el('br'), el('br'), txt('---'), el('br'), el('br'), txt('b'));
  assert.equal(serialize(root), 'a\n\n---\n\nb');
});

// ── insertHorizontalRule: block insert with blank-line guards ─────────────────

test('insert into plain text breaks the line and pads both sides', () => {
  const r = insertHorizontalRule('hello world', 5, 5);
  assert.equal(r.value, 'hello\n\n---\n\n world');
  assert.equal(r.value.slice(r.selStart), ' world'); // caret on the line after the rule
});
test('insert at the start emits no leading blank line', () => {
  assert.equal(insertHorizontalRule('abc', 0, 0).value, '---\n\nabc');
});
test('insert at the end gives an empty line to type on', () => {
  const r = insertHorizontalRule('abc', 3, 3);
  assert.equal(r.value, 'abc\n\n---\n\n');
  assert.equal(r.selStart, r.value.length);
});
test('existing blank lines around the caret are reused, not doubled', () => {
  assert.equal(insertHorizontalRule('a\n\nb', 3, 3).value, 'a\n\n---\n\nb');
});
test('a single adjacent newline is topped up to a blank line', () => {
  assert.equal(insertHorizontalRule('a\nb', 1, 1).value, 'a\n\n---\n\nb');
});
test('a selection is replaced by the rule', () => {
  assert.equal(insertHorizontalRule('keepXXXkeep', 4, 7).value, 'keep\n\n---\n\nkeep');
});

console.log(`\n${passed} passed`);
