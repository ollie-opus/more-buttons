import assert from 'node:assert/strict';
import { mountPlayVeil, VEIL_CLASS } from '../scripts/actionPlayVeil.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// ── Minimal fake DOM ─────────────────────────────────────────────────────────
function el(tag) {
  const classes = new Set(); const listeners = {};
  const node = {
    tagName: tag.toUpperCase(), attrs: {}, children: [], parentNode: null, _text: '', hidden: false, focused: false,
    classList: { add: (...c) => c.forEach(x => classes.add(x)), remove: (...c) => c.forEach(x => classes.delete(x)), contains: c => classes.has(c) },
    get className() { return [...classes].join(' '); },
    set className(v) { classes.clear(); v.split(/\s+/).filter(Boolean).forEach(x => classes.add(x)); },
    get textContent() { return node._text + node.children.map(c => c.textContent).join(''); },
    set textContent(v) { node.children = []; node._text = String(v); },
    setAttribute: (k, v) => { node.attrs[k] = String(v); if (k === 'hidden') node.hidden = true; },
    getAttribute: k => node.attrs[k] ?? null,
    appendChild: c => { c.parentNode = node; node.children.push(c); return c; },
    remove: () => { const p = node.parentNode; if (p) p.children = p.children.filter(c => c !== node); node.parentNode = null; },
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    fire: (t, ev = {}) => (listeners[t] || []).forEach(fn => fn({ target: node, stopPropagation() {}, preventDefault() {}, ...ev })),
    focus: () => { node.focused = true; },
    querySelector: sel => all(node).find(n => n !== node && n.className.split(' ').includes(sel.slice(1))) ?? null,
  };
  return node;
}
const all = n => [n, ...n.children.flatMap(all)];
function fakeDoc() {
  const docListeners = {};
  const doc = {
    documentElement: el('html'),
    createElement: el,
    getElementById: () => ({}), // stylesheet already present
    addEventListener: (t, fn, cap) => { (docListeners[t] ||= []).push(fn); },
    removeEventListener: (t, fn) => { docListeners[t] = (docListeners[t] || []).filter(f => f !== fn); },
    fireKey: (t, key) => { const ev = { key, stopped: false, prevented: false, stopPropagation() { ev.stopped = true; }, preventDefault() { ev.prevented = true; } }; (docListeners[t] || []).forEach(fn => fn(ev)); return ev; },
    listenerCount: t => (docListeners[t] || []).length,
  };
  return doc;
}

test('mounts beside <body> on documentElement with spinner, title, subtitle and a focused Cancel; paints icons', () => {
  const doc = fakeDoc(); let painted = 0;
  const v = mountPlayVeil({ title: 'Playing “Go”', subtitle: 'Step 1 of 2', doc, paintIcons: () => { painted++; }, ensureStyles: false });
  assert.equal(doc.documentElement.children[0], v.veil);
  assert.ok(v.veil.classList.contains(VEIL_CLASS));
  assert.equal(v.card.getAttribute('aria-modal'), 'true');
  assert.equal(v.card.querySelector('.' + VEIL_CLASS + '__title').textContent, 'Playing “Go”');
  assert.equal(v.card.querySelector('.' + VEIL_CLASS + '__sub').textContent, 'Step 1 of 2');
  const icon = v.card.children[0];
  assert.ok(icon.classList.contains('more-buttons-icon--spin') && icon.textContent === 'loader-circle');
  assert.equal(v.card.querySelector('.' + VEIL_CLASS + '__cancel').focused, true);
  assert.equal(painted, 1);
});

test('Cancel button and Escape both fire onCancel exactly once; other keys are swallowed before the host sees them', () => {
  const doc = fakeDoc(); let cancels = 0;
  const v = mountPlayVeil({ title: 't', doc, onCancel: () => cancels++, paintIcons: () => {}, ensureStyles: false });
  const typed = doc.fireKey('keydown', 'a');
  assert.ok(typed.stopped && typed.prevented, 'a plain key never reaches the page');
  const tab = doc.fireKey('keydown', 'Tab');
  assert.ok(tab.stopped && !tab.prevented, 'Tab still moves focus so Cancel stays reachable');
  doc.fireKey('keydown', 'Escape');
  assert.equal(cancels, 1);
  v.card.querySelector('.' + VEIL_CLASS + '__cancel').fire('click');
  assert.equal(cancels, 1, 'second cancel is a no-op');
});

test('setDone swaps the spinner for a tick, hides Cancel; remove detaches the key listeners and the node', () => {
  const doc = fakeDoc();
  const v = mountPlayVeil({ title: 't', doc, paintIcons: () => {}, ensureStyles: false });
  v.setSubtitle('Step 2 of 2');
  assert.equal(v.card.querySelector('.' + VEIL_CLASS + '__sub').textContent, 'Step 2 of 2');
  v.setDone('Played · 2 steps', '“t” finished');
  const icon = v.card.children[0];
  assert.equal(icon.textContent, 'circle-check');
  assert.ok(!icon.classList.contains('more-buttons-icon--spin'));
  assert.ok(v.veil.classList.contains('--done'));
  assert.equal(v.card.querySelector('.' + VEIL_CLASS + '__cancel').hidden, true);
  assert.equal(doc.listenerCount('keydown'), 1);
  v.remove();
  assert.equal(doc.listenerCount('keydown'), 0);
  assert.equal(doc.documentElement.children.length, 0);
});

console.log(`\n${passed} passed`);
