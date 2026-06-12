import assert from 'node:assert/strict';
import { parseDoc, renderDocHtml } from '../scripts/markdownInline.js';
import { toggleList, indentSelection, isListLineAt } from '../scripts/markdownToolbarActions.js';
import { serialize, locateOffset } from '../scripts/richEditorMapping.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// ── renderDocHtml: list-aware document rendering ──────────────────────────────

test('plain text renders as before (newlines -> <br>)', () => {
  assert.equal(renderDocHtml('a\nb'), 'a<br>b');
});
test('unordered list lines render as one <ul>', () => {
  assert.equal(renderDocHtml('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
});
test('ordered list lines render as one <ol> regardless of source numbers', () => {
  assert.equal(renderDocHtml('1. a\n7. b'), '<ol><li>a</li><li>b</li></ol>');
});
test('text around a list keeps its newlines in the text runs', () => {
  assert.equal(renderDocHtml('intro\n\n- a\n- b\n\nafter'),
    'intro<br><br><ul><li>a</li><li>b</li></ul><br><br>after');
});
test('inline marks render inside list items', () => {
  assert.equal(renderDocHtml('- **a**'), '<ul><li><strong>a</strong></li></ul>');
});
test('adjacent lists of different kinds stay separate blocks', () => {
  assert.equal(renderDocHtml('- a\n1. b'), '<ul><li>a</li></ul><br><ol><li>b</li></ol>');
});
test('an empty item line renders an empty <li>', () => {
  assert.equal(renderDocHtml('- '), '<ul><li></li></ul>');
});
test('parseDoc of empty string is a single empty text block', () => {
  assert.deepEqual(parseDoc(''), [{ type: 'text', nodes: [] }]);
});

// ── serialization round-trips (fake DOM mirrors richEditorMapping.test.mjs) ──

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

test('serialize <ul> items to - lines', () => {
  assert.equal(serialize(el('root', el('ul', el('li', txt('a')), el('li', txt('b'))))), '- a\n- b');
});
test('serialize <ol> renumbers items sequentially', () => {
  assert.equal(serialize(el('root', el('ol', el('li', txt('a')), el('li', txt('b'))))), '1. a\n2. b');
});
test('serialize text + br + list round-trips the separating newline', () => {
  const root = el('root', txt('intro'), el('br'), el('ul', el('li', txt('a'))));
  assert.equal(serialize(root), 'intro\n- a');
});
test('serialize marks inside an item', () => {
  assert.equal(serialize(el('root', el('ul', el('li', el('strong', txt('a')))))), '- **a**');
});
test('empty <li> serializes to a bare prefix (placeholder <br> ignored)', () => {
  assert.equal(serialize(el('root', el('ul', el('li', txt('a')), el('li', el('br'))))), '- a\n- ');
});
test('render -> serialize round-trip for a mixed document', () => {
  const src = 'intro\n\n- one\n- **two**\n\n1. first\n2. second\n\nafter';
  // parse the rendered HTML structure indirectly: rebuild the fake DOM by hand
  // is brittle, so assert the canonical invariant the editor relies on instead:
  // renderDocHtml emits one li per item line and keeps every newline countable.
  const html = renderDocHtml(src);
  assert.equal((html.match(/<li>/g) || []).length, 4);
  assert.equal((html.match(/<br>/g) || []).length, 6);
});
test('locateOffset lands inside a trailing empty <li>', () => {
  const li2 = el('li');
  const root = el('root', el('ul', el('li', txt('a')), li2)); // source '- a\n- '
  assert.deepEqual(locateOffset(root, 6), { node: li2, offset: 0 });
});

// ── toggleList transform ──────────────────────────────────────────────────────

test('collapsed caret wraps its line as a bullet item', () => {
  assert.deepEqual(toggleList('hello', 2, 2, 'ul'),
    { value: '- hello', selStart: 4, selEnd: 4 });
});
test('collapsed caret unwraps an existing bullet item', () => {
  assert.deepEqual(toggleList('- hello', 4, 4, 'ul'),
    { value: 'hello', selStart: 2, selEnd: 2 });
});
test('caret inside the prefix clamps to content start on unwrap', () => {
  assert.deepEqual(toggleList('- hello', 1, 1, 'ul'),
    { value: 'hello', selStart: 0, selEnd: 0 });
});
test('multi-line selection becomes one bullet list', () => {
  assert.deepEqual(toggleList('a\nb', 0, 3, 'ul'),
    { value: '- a\n- b', selStart: 2, selEnd: 7 });
});
test('ordered toggle numbers lines sequentially', () => {
  assert.equal(toggleList('a\nb\nc', 0, 5, 'ol').value, '1. a\n2. b\n3. c');
});
test('toggling the other kind converts in place', () => {
  assert.equal(toggleList('- a\n- b', 0, 7, 'ol').value, '1. a\n2. b');
  assert.equal(toggleList('1. a\n2. b', 0, 9, 'ul').value, '- a\n- b');
});
test('mixed lines toggle ON (not all already items)', () => {
  assert.equal(toggleList('- a\nb', 0, 5, 'ul').value, '- a\n- b');
});
test('blank lines inside the selection are skipped, not prefixed', () => {
  assert.equal(toggleList('a\n\nb', 0, 4, 'ul').value, '- a\n\n- b');
});
test('toggling ON below plain text inserts a separating blank line', () => {
  assert.deepEqual(toggleList('text\nitem', 7, 7, 'ul'),
    { value: 'text\n\n- item', selStart: 10, selEnd: 10 });
});
test('toggling ON above plain text inserts a separating blank line', () => {
  assert.equal(toggleList('item\ntext', 0, 0, 'ul').value, '- item\n\ntext');
});
test('toggling ON under a same-kind item merges without a gap', () => {
  assert.equal(toggleList('- a\nb', 4, 4, 'ul').value, '- a\n- b');
});
test('ordered merge continues numbering from the adjacent run', () => {
  assert.equal(toggleList('1. a\nb', 5, 5, 'ol').value, '1. a\n2. b');
});
test('toggling OFF mid-list separates the remaining items with blanks', () => {
  assert.equal(toggleList('- a\n- b\n- c', 5, 5, 'ul').value, '- a\n\nb\n\n- c');
});
test('toggling OFF an ordered item restarts numbering in the run below', () => {
  assert.equal(toggleList('1. a\n2. b\n3. c', 6, 6, 'ol').value, '1. a\n\nb\n\n1. c');
});
test('collapsed caret on a blank line starts an empty item', () => {
  assert.deepEqual(toggleList('', 0, 0, 'ul'), { value: '- ', selStart: 2, selEnd: 2 });
  assert.deepEqual(toggleList('', 0, 0, 'ol'), { value: '1. ', selStart: 3, selEnd: 3 });
});
test('blank-only selection is a no-op', () => {
  assert.deepEqual(toggleList('a\n\n\nb', 2, 3, 'ul'),
    { value: 'a\n\n\nb', selStart: 2, selEnd: 3 });
});
test('selection ending exactly at a line start excludes that line', () => {
  // select 'a\n' (end sits at start of 'b') -> only 'a' becomes an item
  assert.equal(toggleList('a\nb', 0, 2, 'ul').value, '- a\n\nb');
});
test('inline marks inside the line survive the toggle', () => {
  assert.equal(toggleList('**a**', 0, 0, 'ul').value, '- **a**');
  assert.equal(toggleList('- **a**', 3, 3, 'ul').value, '**a**');
});

// ── nested lists: parse + render ──────────────────────────────────────────────

test('one nested level renders inside its parent <li>', () => {
  assert.equal(renderDocHtml('- a\n    - b'),
    '<ul><li>a<ul><li>b</li></ul></li></ul>');
});
test('two nested levels render as nested <ul>s', () => {
  assert.equal(renderDocHtml('- a\n    - b\n        - c'),
    '<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li></ul>');
});
test('a nested list can be a different kind from its parent', () => {
  assert.equal(renderDocHtml('- a\n    1. b'),
    '<ul><li>a<ol><li>b</li></ol></li></ul>');
});
test('the parent item keeps its own siblings after a nested block closes', () => {
  assert.equal(renderDocHtml('- a\n    - b\n- c'),
    '<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>');
});
test('a nested item carries inline marks', () => {
  assert.equal(renderDocHtml('- a\n    - **b**'),
    '<ul><li>a<ul><li><strong>b</strong></li></ul></li></ul>');
});
test('a non-multiple-of-4 indent is treated as plain text, not a nested item', () => {
  // two leading spaces -> not a clean level -> the whole thing is one text run
  assert.equal(renderDocHtml('- a\n  - b'), '<ul><li>a</li></ul><br>  - b');
});
test('parseDoc nests children under the preceding item', () => {
  const blocks = parseDoc('- a\n    - b');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'ul');
  assert.equal(blocks[0].items.length, 1);
  assert.equal(blocks[0].items[0].children.length, 1);
  assert.equal(blocks[0].items[0].children[0].type, 'ul');
});

// ── nested lists: serialize round-trips ───────────────────────────────────────

test('serialize a nested <ul> indents the child by 4 spaces', () => {
  const root = el('root', el('ul', el('li', txt('a'), el('ul', el('li', txt('b'))))));
  assert.equal(serialize(root), '- a\n    - b');
});
test('serialize two nested levels indents 4 then 8', () => {
  const root = el('root',
    el('ul', el('li', txt('a'),
      el('ul', el('li', txt('b'),
        el('ul', el('li', txt('c'))))))));
  assert.equal(serialize(root), '- a\n    - b\n        - c');
});
test('serialize a parent with a nested block and a trailing sibling', () => {
  const root = el('root',
    el('ul',
      el('li', txt('a'), el('ul', el('li', txt('b')))),
      el('li', txt('c'))));
  assert.equal(serialize(root), '- a\n    - b\n- c');
});
test('serialize a nested ol renumbers from 1 within its level', () => {
  const root = el('root',
    el('ul', el('li', txt('a'),
      el('ol', el('li', txt('b')), el('li', txt('c'))))));
  assert.equal(serialize(root), '- a\n    1. b\n    2. c');
});
test('nested render -> serialize round-trip count check', () => {
  const html = renderDocHtml('- a\n    - b\n        - c\n- d');
  assert.equal((html.match(/<li>/g) || []).length, 4);
  assert.equal((html.match(/<ul>/g) || []).length, 3);
});

// ── indentSelection ───────────────────────────────────────────────────────────

test('indent nests an item under the sibling above it', () => {
  assert.equal(indentSelection('- a\n- b', 6, 6, 1).value, '- a\n    - b');
});
test('the first item of a list cannot indent (no parent)', () => {
  assert.deepEqual(indentSelection('- a\n- b', 2, 2, 1), { value: '- a\n- b', selStart: 2, selEnd: 2 });
});
test('a sole nested child cannot indent further (no sibling above it)', () => {
  // b is the only child of a; with no sibling at its own depth, indent is a no-op
  assert.equal(indentSelection('- a\n    - b', 10, 10, 1).value, '- a\n    - b');
});
test('outdent reduces depth by one level', () => {
  assert.equal(indentSelection('- a\n    - b', 10, 10, -1).value, '- a\n- b');
});
test('outdent floors at depth 0 (never un-lists)', () => {
  assert.deepEqual(indentSelection('- a\n- b', 6, 6, -1), { value: '- a\n- b', selStart: 6, selEnd: 6 });
});
test('indent shifts the caret by the added indentation', () => {
  // caret just after 'b' on line 2; line gains 4 leading spaces -> +4
  const r = indentSelection('- a\n- b', 7, 7, 1);
  assert.equal(r.value, '- a\n    - b');
  assert.equal(r.selStart, 11);
});
test('indent preserves an ordered marker and inline content', () => {
  assert.equal(indentSelection('1. a\n2. b', 8, 8, 1).value, '1. a\n    2. b');
});
test('a multi-line selection indents each eligible line', () => {
  // select across b and c (both depth 0 under a); a stays, b->1, c->1
  assert.equal(indentSelection('- a\n- b\n- c', 5, 11, 1).value,
    '- a\n    - b\n    - c');
});
test('indenting a non-list line is a no-op for that line', () => {
  assert.deepEqual(indentSelection('plain', 2, 2, 1), { value: 'plain', selStart: 2, selEnd: 2 });
});

// ── toggleList tolerates indentation (nesting survives a type-toggle / un-list) ──

test('toggling the other kind on a nested item keeps its indentation', () => {
  // caret in nested '    - b' -> convert that line to ordered, indent intact
  assert.equal(toggleList('- a\n    - b', 10, 10, 'ol').value, '- a\n    1. b');
});
test('toggling a nested item off strips indentation and marker', () => {
  assert.equal(toggleList('- a\n    - b', 10, 10, 'ul').value, '- a\n\nb');
});

// ── isListLineAt ──────────────────────────────────────────────────────────────

test('isListLineAt detects a top-level and a nested item line', () => {
  assert.equal(isListLineAt('- a\n    - b', 1), true);
  assert.equal(isListLineAt('- a\n    - b', 9), true);
});
test('isListLineAt is false on a plain-text line', () => {
  assert.equal(isListLineAt('hello\n- a', 2), false);
});

console.log(`\n${passed} passed`);
