import assert from 'node:assert/strict';
import { orderDockButtons } from '../scripts/dockLayout.js';

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('  ok -', name); }

// (1) Importing must not touch chrome.* or document at module scope.
const { renderPageDock, removePageDock } = await import('../scripts/pageDock.js');

// ── Minimal fake DOM ───────────────────────────────────────────────────────
function el(tagName) {
  const classes = new Set();
  const listeners = {};
  const node = {
    tagName: tagName.toUpperCase(), id: '', children: [], parentNode: null, attrs: {}, dataset: {},
    _text: '',
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      contains: (c) => classes.has(c),
      toggle: (c, force) => { const on = force ?? !classes.has(c); on ? classes.add(c) : classes.delete(c); return on; },
    },
    get className() { return [...classes].join(' '); },
    set className(v) { classes.clear(); v.split(/\s+/).filter(Boolean).forEach((x) => classes.add(x)); },
    get textContent() { return node._text + node.children.map((c) => c.textContent).join(''); },
    set textContent(v) { node.children = []; node._text = String(v); },
    setAttribute: (k, v) => { node.attrs[k] = String(v); },
    getAttribute: (k) => node.attrs[k] ?? null,
    appendChild: (c) => { c.parentNode = node; node.children.push(c); return c; },
    append: (...cs) => cs.forEach((c) => node.appendChild(c)),
    replaceChildren: (...cs) => { node.children = []; cs.forEach((c) => node.appendChild(c)); },
    remove: () => { const p = node.parentNode; if (p) p.children = p.children.filter((c) => c !== node); node.parentNode = null; },
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    click: () => (listeners.click || []).forEach((fn) => fn({ preventDefault() {}, stopPropagation() {} })),
    querySelector: (sel) => all(node).find((n) => n !== node && matches(n, sel)) ?? null,
    querySelectorAll: (sel) => all(node).filter((n) => n !== node && matches(n, sel)),
  };
  return node;
}
const all = (n) => [n, ...n.children.flatMap(all)];
const matches = (n, sel) => (sel.startsWith('#') ? n.id === sel.slice(1)
  : sel.startsWith('.') ? sel.slice(1).split('.').every((c) => n.classList.contains(c))
  : n.tagName === sel.toUpperCase());

function fakeDoc() {
  const documentElement = el('html');
  const head = el('head');
  documentElement.appendChild(head);
  return {
    documentElement, head,
    createElement: el,
    getElementById: (id) => all(documentElement).find((n) => n.id === id) ?? null,
  };
}

function fakeChrome(initial) {
  const store = { ...initial };
  const writes = [];
  globalThis.chrome = {
    runtime: { getURL: (p) => 'chrome-extension://x/' + p },
    storage: { local: {
      get: async (k) => (k in store ? { [k]: store[k] } : {}),
      set: async (obj) => { Object.assign(store, obj); writes.push(obj); },
    } },
  };
  return { store, writes };
}

const B = (id, dockOrder, dockGroup, extra = {}) => ({
  id, displayText: 'Do ' + id, descriptionText: 'Desc ' + id, icon: 'star', colour: 'blue',
  action: 'act-' + id, dockOrder, dockGroup, ...extra,
});
const buttons = [B('a1', 1, 'A'), B('b2', 2, 'B'), B('n9', 0), B('a3', 3, 'A', { descriptionText: undefined, colour: 'red' })];
const island = (root) => root.querySelector('.mb-page-dock__island');

// ── Tests ──────────────────────────────────────────────────────────────────
await test('renders root into documentElement with stylesheet link', async () => {
  fakeChrome({});
  const doc = fakeDoc();
  await renderPageDock(buttons, () => {}, { doc });
  const root = doc.getElementById('mb-page-dock');
  assert.ok(root);
  assert.equal(root.parentNode, doc.documentElement);
  assert.ok(root.classList.contains('mb-page-dock'));
  assert.equal(root.getAttribute('role'), 'toolbar');
  assert.ok(!root.classList.contains('--closed'));
  assert.ok(doc.getElementById('more-buttons-overlay-stylesheet'));
});

await test('groups follow orderDockButtons with separators only between groups', async () => {
  fakeChrome({});
  const doc = fakeDoc();
  await renderPageDock(buttons, () => {}, { doc });
  const kids = island(doc.getElementById('mb-page-dock')).children;
  const shape = kids.map((k) => (k.classList.contains('mb-dock-sep') ? '|' : 'G'));
  const groups = orderDockButtons(buttons);
  assert.deepEqual(shape, groups.flatMap((g, i) => (i ? ['|', 'G'] : ['G'])));
  const tileIds = kids.filter((k) => !k.classList.contains('mb-dock-sep'))
    .map((g) => g.children.map((t) => t.id));
  assert.deepEqual(tileIds, groups.map((g) => g.map((b) => b.id)));
  assert.equal(kids[0].dataset.group, 'A');
});

await test('tile structure, classes, aria and tag text', async () => {
  fakeChrome({});
  const doc = fakeDoc();
  await renderPageDock(buttons, () => {}, { doc });
  const t = doc.getElementById('a1');
  assert.equal(t.tagName, 'BUTTON');
  assert.equal(t.getAttribute('type'), 'button');
  for (const c of ['more-buttons-button', 'mb-page-dock__tile', 'blue']) assert.ok(t.classList.contains(c), c);
  assert.equal(t.getAttribute('aria-label'), 'Do a1');
  assert.equal(t.querySelector('.more-buttons-icon').textContent, 'star');
  const tag = t.querySelector('.mb-page-dock__tag');
  assert.equal(tag.getAttribute('aria-hidden'), 'true');
  assert.equal(tag.querySelector('b').textContent, 'Do a1');
  assert.equal(tag.querySelector('small').textContent, 'Desc a1');
  const t3 = doc.getElementById('a3');
  assert.ok(t3.classList.contains('red'));
  assert.equal(t3.querySelector('small'), null);
});

await test('tile click dispatches its action', async () => {
  fakeChrome({});
  const doc = fakeDoc();
  const calls = [];
  await renderPageDock(buttons, (a) => calls.push(a), { doc });
  doc.getElementById('b2').click();
  assert.deepEqual(calls, ['act-b2']);
});

await test('second render reuses root and replaces island children', async () => {
  fakeChrome({});
  const doc = fakeDoc();
  await renderPageDock(buttons, () => {}, { doc });
  const root = doc.getElementById('mb-page-dock');
  await renderPageDock([B('z1', 1, 'Z')], () => {}, { doc });
  assert.equal(doc.getElementById('mb-page-dock'), root);
  assert.equal(doc.documentElement.querySelectorAll('.mb-page-dock').length, 1);
  assert.equal(doc.getElementById('a1'), null);
  assert.ok(doc.getElementById('z1'));
});

await test('overlapping first renders create a single root with the newest buttons', async () => {
  fakeChrome({});
  const doc = fakeDoc();
  await Promise.all([
    renderPageDock(buttons, () => {}, { doc }),
    renderPageDock([B('z1', 1, 'Z')], () => {}, { doc }),
  ]);
  assert.equal(doc.documentElement.querySelectorAll('.mb-page-dock').length, 1);
  assert.ok(doc.getElementById('z1'));
  assert.equal(doc.getElementById('a1'), null);
});

await test('stored closed state renders collapsed; handle toggles and persists', async () => {
  const { writes } = fakeChrome({ moreButtonsPageDock: { open: false } });
  const doc = fakeDoc();
  await renderPageDock(buttons, () => {}, { doc });
  const root = doc.getElementById('mb-page-dock');
  const handle = root.querySelector('.mb-page-dock__handle');
  assert.ok(root.classList.contains('--closed'));
  assert.equal(handle.getAttribute('aria-expanded'), 'false');
  assert.equal(handle.getAttribute('aria-label'), 'Expand More Buttons dock');
  assert.equal(handle.querySelector('.more-buttons-icon').textContent, 'chevron_left');
  handle.click();
  assert.ok(!root.classList.contains('--closed'));
  assert.equal(handle.getAttribute('aria-expanded'), 'true');
  assert.equal(handle.getAttribute('aria-label'), 'Collapse More Buttons dock');
  assert.equal(handle.querySelector('.more-buttons-icon').textContent, 'chevron_right');
  assert.deepEqual(writes.at(-1), { moreButtonsPageDock: { open: true } });
  handle.click();
  assert.ok(root.classList.contains('--closed'));
  assert.deepEqual(writes.at(-1), { moreButtonsPageDock: { open: false } });
});

await test('removePageDock removes the root and is idempotent', async () => {
  fakeChrome({});
  const doc = fakeDoc();
  await renderPageDock(buttons, () => {}, { doc });
  removePageDock({ doc });
  assert.equal(doc.getElementById('mb-page-dock'), null);
  removePageDock({ doc });
  assert.equal(doc.getElementById('mb-page-dock'), null);
});

await test('removePageDock during a pending first render prevents the root appearing', async () => {
  fakeChrome({});
  const doc = fakeDoc();
  const p = renderPageDock(buttons, () => {}, { doc });
  removePageDock({ doc });
  await p;
  assert.equal(doc.getElementById('mb-page-dock'), null);
});

console.log(`pageDock: ${passed} passed`);
