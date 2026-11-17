import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeOf } from '../scripts/labelPills.js';

// A fake DOM with just what edgeOf reads: node types, values, children,
// parents and siblings.
const link = node => {
  node.childNodes.forEach((c, i) => {
    c.parentNode = node;
    c.previousSibling = node.childNodes[i - 1] ?? null;
    c.nextSibling = node.childNodes[i + 1] ?? null;
    if (c.nodeType === 1) link(c);
  });
  return node;
};
const txt = value => ({ nodeType: 3, nodeValue: value, childNodes: [] });
const el = (attrs, ...children) => ({
  nodeType: 1, childNodes: children, attrs,
  getAttribute(n) { return this.attrs[n] ?? null; },
  get textContent() { return children.map(c => (c.nodeType === 3 ? c.nodeValue : c.textContent)).join(''); },
});
const label = (...children) => el({ class: 'mb-label mb-label-red' }, ...children);
const icon = () => el({ 'data-mb-icon': 'check' });

test('edgeOf: the last and first places in a label are its edges, inside it', () => {
  const t = txt('Beta');
  const pill = label(t);
  const root = link(el({}, txt('go '), pill, txt(' on')));
  assert.deepEqual(edgeOf(root, t, 4), { label: pill, side: 'after', inside: true });
  assert.deepEqual(edgeOf(root, t, 0), { label: pill, side: 'before', inside: true });
  assert.equal(edgeOf(root, t, 2), null);
});

test('edgeOf: the text beside a label is at its edge, outside it', () => {
  const before = txt('go ');
  const after = txt(' on');
  const pill = label(txt('Beta'));
  const root = link(el({}, before, pill, after));
  assert.deepEqual(edgeOf(root, after, 0), { label: pill, side: 'after', inside: false });
  assert.deepEqual(edgeOf(root, before, 3), { label: pill, side: 'before', inside: false });
  assert.equal(edgeOf(root, after, 1), null);
  // An element-anchored caret (parent, child index) reads the same.
  assert.deepEqual(edgeOf(root, root, 2), { label: pill, side: 'after', inside: false });
  assert.deepEqual(edgeOf(root, root, 1), { label: pill, side: 'before', inside: false });
});

test('edgeOf: an icon counts as something to pass', () => {
  const t = txt(' Done');
  const pill = label(icon(), t);
  const root = link(el({}, pill));
  assert.equal(edgeOf(root, t, 0), null); // the icon is still before the caret
  assert.deepEqual(edgeOf(root, pill, 0), { label: pill, side: 'before', inside: true });
  assert.deepEqual(edgeOf(root, t, 5), { label: pill, side: 'after', inside: true });
});

test('edgeOf: an empty label reads as its end, and plain text as no edge', () => {
  const pill = label();
  const plain = txt('abc');
  const root = link(el({}, plain, el({ class: 'other' }, txt('x')), pill));
  assert.deepEqual(edgeOf(root, pill, 0), { label: pill, side: 'after', inside: true });
  assert.equal(edgeOf(root, plain, 3), null);
});

