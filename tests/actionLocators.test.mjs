import assert from 'node:assert/strict';
import {
  isStableId, escapeCss, cssPathFor, labelTextFor, buildLocator, describeElement, resolveLocator,
} from '../scripts/actionLocators.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// ── Fake DOM with the selector grammar the module emits ─────────────────────
// compound := tag? #id? ([attr="v"])* (:nth-of-type(n))?   joined by " > "
function el(tag, attrs = {}, children = []) {
  const node = {
    tagName: tag.toUpperCase(), attrs: { ...attrs }, children: [], parentElement: null, _text: '',
    labels: [], control: null, isConnected: true, offsetParent: {},
    get id() { return node.attrs.id ?? ''; },
    get name() { return node.attrs.name ?? ''; },
    get type() { return node.attrs.type ?? (node.tagName === 'INPUT' ? 'text' : ''); },
    get value() { return node.attrs.value ?? ''; },
    get htmlFor() { return node.attrs.for ?? ''; },
    get textContent() { return node._text + node.children.map(c => c.textContent).join(''); },
    set textContent(v) { node.children = []; node._text = String(v); },
    getAttribute: k => node.attrs[k] ?? null,
    hasAttribute: k => k in node.attrs,
    appendChild(c) { c.parentElement = node; node.children.push(c); return c; },
    closest(sel) { for (let n = node; n; n = n.parentElement) if (matchesCompound(n, sel)) return n; return null; },
    matches: sel => matchesCompound(node, sel),
    querySelectorAll: sel => all(node).filter(n => n !== node && matchesSelector(n, sel)),
    querySelector: sel => all(node).find(n => n !== node && matchesSelector(n, sel)) ?? null,
    getClientRects: () => [{}],
  };
  children.forEach(c => (typeof c === 'string' ? (node._text += c) : node.appendChild(c)));
  return node;
}
const all = n => [n, ...n.children.flatMap(all)];
function parseCompound(sel) {
  const m = /^([a-z0-9-]*)(#[^\[:.]+)?((?:\[[^\]]+\])*)(?::nth-of-type\((\d+)\))?$/i.exec(sel.trim());
  if (!m) throw new Error(`fake DOM: unsupported selector "${sel}"`);
  const attrs = [...m[3].matchAll(/\[([^=\]]+)(?:="((?:[^"\\]|\\.)*)")?\]/g)].map(a => [a[1], a[2] == null ? null : a[2].replace(/\\(.)/g, '$1')]);
  return { tag: m[1].toUpperCase(), id: m[2]?.slice(1).replace(/\\(.)/g, '$1'), attrs, nth: m[4] ? +m[4] : null };
}
function matchesCompound(n, sel) {
  const c = parseCompound(sel);
  if (c.tag && n.tagName !== c.tag) return false;
  if (c.id && n.id !== c.id) return false;
  for (const [k, v] of c.attrs) { if (!(k in n.attrs)) return false; if (v != null && n.attrs[k] !== v) return false; }
  if (c.nth != null) {
    const sibs = (n.parentElement?.children ?? [n]).filter(s => s.tagName === n.tagName);
    if (sibs.indexOf(n) + 1 !== c.nth) return false;
  }
  return true;
}
function matchesSelector(n, sel) {
  const parts = sel.split(' > ');
  let cur = n;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!cur || !matchesCompound(cur, parts[i])) return false;
    cur = cur.parentElement;
  }
  return true;
}
function label(text, control, attrs = {}) {
  const l = el('label', attrs, [text]);
  if (control) { l.control = control; control.labels = [l]; }
  return l;
}

// ── isStableId / escapeCss ───────────────────────────────────────────────────
test('isStableId accepts Rails-style ids and rejects generated ones', () => {
  for (const ok of ['site_employee_name', 'asset_archived_at_not', 'more-buttons-role', 'q:1']) assert.ok(isStableId(ok), ok);
  for (const bad of ['', 'item-3f9a8c2e1b', 'row_12345', 'radix-:r1:', 'headlessui-menu-1', 'react-select-2', ':r0:', 'ember123', 'mui-1', '__next', '5abc', 'a b', 'd41d8cd98f00b204']) assert.ok(!isStableId(bad), bad);
});

test('escapeCss escapes characters that would break a selector', () => {
  assert.equal(escapeCss('site[name]'), 'site\\[name\\]');
  assert.equal(escapeCss('a:b.c'), 'a\\:b\\.c');
  assert.equal(escapeCss('plain_id-1'), 'plain_id-1');
});

// ── buildLocator candidate order ─────────────────────────────────────────────
test('text input with stable id, name and label: id → name → label → css', () => {
  const input = el('input', { id: 'site_name', name: 'site[name]', type: 'text' });
  const form = el('form', { id: 'site_form' }, [el('div', {}, [label('Site name', input), input])]);
  const loc = buildLocator(input);
  assert.deepEqual(loc.candidates.map(c => c.type), ['id', 'name', 'label', 'css']);
  assert.equal(loc.candidates[0].selector, '#site_name');
  assert.equal(loc.candidates[1].selector, 'input[name="site[name]"]');
  assert.deepEqual(loc.candidates[2], { type: 'label', tag: 'input', text: 'Site name' });
  assert.equal(loc.candidates[3].selector, '#site_form > div:nth-of-type(1) > input:nth-of-type(1)');
  assert.equal(loc.key, '#site_name');
  void form;
});

test('radio and checkbox name candidates carry the value', () => {
  const radio = el('input', { id: 'x-9f8e7d6c5b4a', name: 'site[location]', type: 'radio', value: 'ho' });
  el('form', {}, [radio]);
  const loc = buildLocator(radio);
  assert.equal(loc.candidates[0].type, 'name', 'generated id is skipped');
  assert.equal(loc.candidates[0].selector, 'input[name="site[location]"][value="ho"]');
});

test('button: data-testid / aria-label / data-action attrs, then text, then css', () => {
  const btn = el('button', { 'data-testid': 'save-btn', 'aria-label': 'Save changes', 'data-action': 'click->form#submit', type: 'submit' }, [el('span', {}, [' Save ']), el('span', {}, [' changes '])]);
  el('form', {}, [btn]);
  const loc = buildLocator(btn);
  assert.deepEqual(loc.candidates.map(c => c.type), ['attr', 'attr', 'attr', 'text', 'css']);
  assert.equal(loc.candidates[0].selector, 'button[data-testid="save-btn"]');
  assert.equal(loc.candidates[1].selector, 'button[aria-label="Save changes"]');
  assert.equal(loc.candidates[2].selector, 'button[data-action="click->form#submit"]');
  assert.deepEqual(loc.candidates[3], { type: 'text', tag: 'button', text: 'Save changes' });
});

test('link: href pathname attr, then text', () => {
  const a = el('a', { href: 'https://cloud.example.com/admin/sites/abc/edit?x=1' }, ['Edit']);
  el('body', {}, [a]);
  const loc = buildLocator(a);
  assert.equal(loc.candidates[0].selector, 'a[href="/admin/sites/abc/edit?x=1"]');
  assert.deepEqual(loc.candidates[1], { type: 'text', tag: 'a', text: 'Edit' });
});

test('text over 80 chars or empty is skipped; a bare element still gets a css path', () => {
  const div = el('div', {}, ['x'.repeat(81)]);
  const body = el('body', {}, [el('div'), div]);
  const loc = buildLocator(div);
  assert.deepEqual(loc.candidates.map(c => c.type), ['css']);
  assert.equal(loc.candidates[0].selector, 'body > div:nth-of-type(2)');
  assert.equal(loc.key, 'body > div:nth-of-type(2)');
  void body;
});

test('cssPathFor stops at the nearest stable-id ancestor and skips generated ids', () => {
  const target = el('button');
  const inner = el('div', { id: 'row-1a2b3c4d5e6f' }, [target]);
  const section = el('section', { id: 'main_panel' }, [el('div'), inner]);
  el('body', {}, [section]);
  assert.equal(cssPathFor(target), '#main_panel > div:nth-of-type(2) > button:nth-of-type(1)');
});

test('describeElement precedence: label, aria-label, placeholder, text, name, id, tag', () => {
  const input = el('input', { id: 'site_name', name: 'site[name]', placeholder: 'e.g. Acme', type: 'text' });
  el('div', {}, [label('Site name', input), input]);
  assert.deepEqual(describeElement(input), { label: 'Site name', tag: 'input', type: 'text' });
  const noLabel = el('input', { name: 'q', placeholder: 'Search…', type: 'search' });
  assert.equal(describeElement(noLabel).label, 'Search…');
  const btn = el('button', { 'aria-label': 'Close' }, ['×']);
  assert.equal(describeElement(btn).label, 'Close');
  const bare = el('select', { name: 'site[kind]' });
  assert.deepEqual(describeElement(bare), { label: 'site[kind]', tag: 'select', type: null });
  assert.equal(describeElement(el('div')).label, 'div');
});

test('labelTextFor falls back to a wrapping label and aria-labelledby', () => {
  const cb = el('input', { type: 'checkbox' });
  const wrap = el('label', {}, ['  Send  weekly\n digest ', cb]);
  assert.equal(labelTextFor(cb), 'Send weekly digest');
  void wrap;
  const inp = el('input', { 'aria-labelledby': 'lbl_x' });
  const root = el('div', {}, [el('span', { id: 'lbl_x' }, ['Reference']), inp]);
  assert.equal(labelTextFor(inp, root), 'Reference');
});

// ── resolveLocator ───────────────────────────────────────────────────────────
function page() {
  const name = el('input', { id: 'site_name', name: 'site[name]', type: 'text' });
  const edit1 = el('a', { href: '/admin/sites/1/edit' }, ['Edit']);
  const edit2 = el('a', { href: '/admin/sites/2/edit' }, ['Edit']);
  const hiddenEdit = el('a', { href: '/admin/sites/1/edit' }, ['Edit']);
  hiddenEdit.offsetParent = null; hiddenEdit.getClientRects = () => [];
  const root = el('body', {}, [
    el('form', { id: 'site_form' }, [el('div', {}, [label('Site name', name), name])]),
    el('ul', {}, [el('li', {}, [edit1]), el('li', {}, [edit2])]),
    el('nav', { id: 'mobile_nav' }, [hiddenEdit]),
  ]);
  return { root, name, edit1, edit2, hiddenEdit };
}

test('resolveLocator returns the first candidate that matches exactly one element', () => {
  const { root, name } = page();
  const loc = buildLocator(name);
  const r = resolveLocator(loc, root);
  assert.equal(r.el, name);
  assert.equal(r.candidate.type, 'id');
  assert.deepEqual(r.tried, []);
});

test('resolveLocator skips candidates that match nothing or several, recording tried counts', () => {
  const { root, edit2 } = page();
  const loc = { key: 'k', candidates: [
    { type: 'id', selector: '#nope' },
    { type: 'text', tag: 'a', text: 'Edit' },             // 3 matches, 2 visible → still ambiguous
    { type: 'attr', selector: 'a[href="/admin/sites/2/edit"]' },
  ] };
  const r = resolveLocator(loc, root);
  assert.equal(r.el, edit2);
  assert.equal(r.candidate.type, 'attr');
  assert.deepEqual(r.tried.map(t => t.count), [0, 2]);
});

test('resolveLocator breaks a tie by visibility using the injectable isVisible', () => {
  const { root, edit1, hiddenEdit } = page();
  const loc = { key: 'k', candidates: [{ type: 'attr', selector: 'a[href="/admin/sites/1/edit"]' }] };
  assert.equal(resolveLocator(loc, root).el, edit1, 'default isVisible drops the hidden duplicate');
  const r = resolveLocator(loc, root, { isVisible: () => true });
  assert.equal(r.el, null);
  assert.equal(r.tried[0].count, 2);
  void hiddenEdit;
});

test('resolveLocator resolves label candidates through label.control / for=, matching the tag', () => {
  const { root, name } = page();
  const r = resolveLocator({ key: 'k', candidates: [{ type: 'label', tag: 'input', text: 'Site name' }] }, root);
  assert.equal(r.el, name);
  const wrong = resolveLocator({ key: 'k', candidates: [{ type: 'label', tag: 'select', text: 'Site name' }] }, root);
  assert.equal(wrong.el, null);
  const byFor = el('input', { id: 'other_id' });
  const root2 = el('body', {}, [label('Other', null, { for: 'other_id' }), byFor]);
  assert.equal(resolveLocator({ key: 'k', candidates: [{ type: 'label', tag: 'input', text: 'Other' }] }, root2).el, byFor);
});

test('resolveLocator treats an invalid selector as zero matches instead of throwing', () => {
  const { root } = page();
  const r = resolveLocator({ key: 'k', candidates: [{ type: 'css', selector: '???' }] }, root);
  assert.equal(r.el, null);
  assert.equal(r.tried[0].count, 0);
});

console.log(`\n${passed} passed`);
