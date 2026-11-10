import assert from 'node:assert/strict';
import { collapse, choiceOf, choiceOfOption, controlFor, describePick, commonAncestor } from '../scripts/builderPickables.js';

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

function page(...nodes) {
  const body = el('body', {}, nodes);
  return { byName: n => all(body).filter(x => x.attrs.name === n), count: sel => body.querySelectorAll(sel).length };
}

test('collapse squeezes whitespace and maps null to empty', () => {
  assert.equal(collapse('  Sole \n\t Trader  '), 'Sole Trader');
  assert.equal(collapse(null), '');
});

test('choiceOf prefers the label, then aria-label, then the value', () => {
  const a = el('input', { type: 'radio', name: 'k', value: 'company', id: 'k_company' }); label('  Company\n', a);
  assert.deepEqual(choiceOf(a), { label: 'Company', value: 'company', id: 'k_company' });
  const b = el('input', { type: 'radio', name: 'k', value: 'sole', 'aria-label': 'Sole  Trader' });
  assert.deepEqual(choiceOf(b), { label: 'Sole Trader', value: 'sole', id: '' });
  assert.deepEqual(choiceOf(el('input', { type: 'checkbox', name: 'k', value: 'x' })), { label: 'x', value: 'x', id: '' });
});

test('choiceOfOption prefers the label attribute, then the text, then the value', () => {
  assert.deepEqual(choiceOfOption(el('option', { value: '17' }, ['  Opus\n Safety '])), { label: 'Opus Safety', value: '17', id: '' });
  assert.deepEqual(choiceOfOption(el('option', { value: '9', label: 'Short' }, ['Long text'])), { label: 'Short', value: '9', id: '' });
  assert.deepEqual(choiceOfOption(el('option', { value: 'v' })), { label: 'v', value: 'v', id: '' });
});

test('controlFor maps a label or a child of a button to the control', () => {
  const input = el('input', { name: 'n' });
  const lbl = label('Name', input);
  const span = el('span', {}, ['Save']);
  const btn = el('button', { type: 'submit' }, [span]);
  assert.equal(controlFor(lbl), input);
  assert.equal(controlFor(span), btn);
  assert.equal(controlFor(el('a', { href: '/x' }, ['link'])), null);
});

test('a uniquely named text input is addressed by name', () => {
  const input = el('input', { type: 'email', name: 'contractor[email]', id: 'contractor_email' });
  const pick = describePick(input, page(el('form', {}, [input])));
  assert.equal(pick.kind, 'text');
  assert.equal(pick.title, 'contractor[email]');
  assert.equal(pick.typeLabel, 'email');
  assert.deepEqual([pick.targetType, pick.target], ['name', 'contractor[email]']);
  assert.equal(pick.choices, null);
  assert.equal(pick.key, 'text:name:contractor[email]');
});

test('a name shared with another element falls back to a unique id, then a unique css candidate', () => {
  const box = el('input', { type: 'checkbox', name: 'active', value: '1', id: 'c_active' });
  const pick = describePick(box, page(el('form', {}, [el('input', { type: 'hidden', name: 'active', value: '0' }), box])));
  assert.equal(pick.kind, 'checkbox');
  assert.deepEqual([pick.targetType, pick.target], ['id', 'c_active']);

  const bare = el('input', { type: 'checkbox', name: 'flag', value: '1' });
  const pick2 = describePick(bare, page(el('form', {}, [el('input', { type: 'hidden', name: 'flag', value: '0' }), bare])));
  assert.deepEqual([pick2.targetType, pick2.target], ['css', 'input[name="flag"][value="1"]']);
});

test('radios sharing a name are one group with its choices', () => {
  const a = el('input', { type: 'radio', name: 'contractor[kind]', value: 'company', id: 'kind_company' });
  const b = el('input', { type: 'radio', name: 'contractor[kind]', value: 'sole_trader', id: 'kind_sole' });
  const wrap = el('div', {}, [a, label('Company', a), b, label('Sole Trader', b)]);
  const look = page(el('form', {}, [wrap]));
  const pick = describePick(b, look);
  assert.equal(pick.kind, 'radioGroup');
  assert.equal(pick.title, 'contractor[kind]');
  assert.equal(pick.typeLabel, 'radio group');
  assert.deepEqual([pick.targetType, pick.target], ['name', 'contractor[kind]']);
  assert.deepEqual(pick.choices, [
    { label: 'Company', value: 'company', id: 'kind_company' },
    { label: 'Sole Trader', value: 'sole_trader', id: 'kind_sole' },
  ]);
  assert.equal(pick.elements.length, 2);
  assert.equal(describePick(a, look).key, pick.key);
  assert.equal(commonAncestor(pick.elements), wrap);
});

test('two checkboxes sharing a name are a group, ignoring the hidden input', () => {
  const t1 = el('input', { type: 'checkbox', name: 'types[]', value: '1' });
  const t2 = el('input', { type: 'checkbox', name: 'types[]', value: '2' });
  const look = page(el('form', {}, [el('input', { type: 'hidden', name: 'types[]', value: '' }), t1, label('Cleaning', t1), t2, label('Grounds, Landscaping', t2)]));
  const pick = describePick(t1, look);
  assert.equal(pick.kind, 'checkboxGroup');
  assert.deepEqual(pick.choices.map(c => c.label), ['Cleaning', 'Grounds, Landscaping']);
  assert.deepEqual([pick.targetType, pick.target], ['name', 'types[]']);
});

test('a group is every radio or checkbox on the page with that name, whatever form it is in', () => {
  const f1 = el('form'), f2 = el('form');
  const a = el('input', { type: 'radio', name: 'k', value: 'a' }); a.form = f1; f1.appendChild(a);
  const b = el('input', { type: 'radio', name: 'k', value: 'b' }); b.form = f1; f1.appendChild(b);
  const other = el('input', { type: 'radio', name: 'k', value: 'z' }); other.form = f2; f2.appendChild(other);
  f2.appendChild(el('input', { type: 'hidden', name: 'k', value: '' }));
  assert.deepEqual(describePick(a, page(f1, f2)).choices.map(c => c.value), ['a', 'b', 'z']);
});

test('a single select lists its options; a multiple select is not pickable', () => {
  const sel = el('select', { name: 'owner' });
  sel.options = [el('option', { value: '17' }, ['Opus Safety']), el('option', { value: '42' }, ['Ollie Test Site 1'])];
  const pick = describePick(sel, page(sel));
  assert.equal(pick.kind, 'select');
  assert.equal(pick.typeLabel, 'dropdown');
  assert.deepEqual(pick.choices.map(c => [c.label, c.value]), [['Opus Safety', '17'], ['Ollie Test Site 1', '42']]);
  const multi = el('select', { name: 'tags', multiple: '' });
  assert.equal(describePick(multi, page(multi)), null);
});

test('a submit button in a form is a submit pick; other buttons are click picks', () => {
  const save = el('button', { type: 'submit', id: 'save_btn' }, ['  Create\n contractor ']);
  const form = el('form', {}, [save]); save.form = form;
  const pick = describePick(save, page(form));
  assert.equal(pick.kind, 'button');
  assert.equal(pick.title, 'Create contractor');
  assert.equal(pick.typeLabel, 'submit button');
  assert.equal(pick.submit, true);
  assert.deepEqual([pick.targetType, pick.target], ['id', 'save_btn']);

  const plain = el('button', { type: 'button', 'data-action': 'panel#open' }, ['Open']);
  const pick2 = describePick(plain, page(plain));
  assert.equal(pick2.submit, false);
  assert.equal(pick2.typeLabel, 'button');
  assert.deepEqual([pick2.targetType, pick2.target], ['css', 'button[data-action="panel#open"]']);
});

test('a button with no type attribute is a submit button only inside a form', () => {
  const inForm = el('button', {}, ['Go']); const form = el('form', {}, [inForm]); inForm.form = form;
  assert.equal(describePick(inForm, page(form)).submit, true);
  const loose = el('button', {}, ['Go']);
  assert.equal(describePick(loose, page(loose)).submit, false);
});

test('hidden, file and reset inputs, links, nameless radios and plain text are not pickable', () => {
  for (const node of [
    el('input', { type: 'hidden', name: 'h' }), el('input', { type: 'file', name: 'f' }), el('input', { type: 'reset' }),
    el('a', { href: '/x' }, ['x']), el('input', { type: 'radio', value: 'a' }), el('div', {}, ['text']),
  ]) assert.equal(describePick(node, page(node)), null);
});

test('a nameless control is titled by its id, then its label', () => {
  const byId = el('input', { type: 'text', id: 'search_box' });
  assert.equal(describePick(byId, page(byId)).title, 'search_box');
  const byLabel = el('input', { type: 'text' }); label('Find a site', byLabel);
  assert.equal(describePick(byLabel, page(byLabel)).title, 'Find a site');
});

console.log(`\n${passed} passed`);
