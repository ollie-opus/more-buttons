import assert from 'node:assert/strict';

globalThis.MutationObserver = class { constructor() {} observe(t) { if (!t || typeof t !== 'object') throw new TypeError('observe: parameter 1 is not of type Node'); } disconnect() {} };
const store = new Map();
globalThis.window = globalThis;
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.sessionStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
globalThis.document = { documentElement: { querySelectorAll: () => [] }, defaultView: globalThis, createElement: () => ({ style: {}, classList: { add() {} }, setAttribute() {}, appendChild() {} }), body: { style: {} }, addEventListener() {}, removeEventListener() {} };
globalThis.chrome = { runtime: { getURL: p => p }, storage: { local: { get: async () => ({ moreButtonsIntegrations: { githubPAT: 't' } }), set: async () => {} } } };

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('  ok -', name); }

// loadLabelPalette fetches the preset file; answer it with an empty palette.
globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });

const { renderComponents, onComponentEditorClick, setOpenComponentEditor } = await import('../scripts/guides.js');
const { parseComponents } = await import('../scripts/components.js');
const { GUIDE_ADMONITION_TYPES_RE } = await import('../scripts/admonitions.js');

const span = (u, ind = '') => `${ind}<span data-uuid="${u}" style="display:none"></span>`;
const TWO = parseComponents(['!!! note "A"', '', span('U-1', '    '), '', '    Alpha.', '', '!!! note "B"', '', span('U-2', '    '), '', '    Beta.', ''].join('\n'), GUIDE_ADMONITION_TYPES_RE).components;

function fakeList(viewOnly) {
  const form = { hasAttribute: n => viewOnly && n === 'data-view-only', querySelector: () => null };
  const l = { _html: '', sets: 0, querySelectorAll: () => [], closest: () => form,
    get innerHTML() { return l._html; }, set innerHTML(v) { l._html = v; l.sets++; } };
  return l;
}
const count = (s, re) => (s.match(re) || []).length;

await test('view-only renderComponents: no insert triggers, no rail, Copy is the only foot button, rows keep the copySelection shape', () => {
  const list = fakeList(true);
  renderComponents(list, TWO, true, { viewOnly: true });
  const html = list.innerHTML;
  assert.ok(!html.includes('data-insert-component-at'));
  assert.ok(!html.includes('mb-component-rail'));
  assert.equal(count(html, /data-copy-component-md="U-[12]"/g), 2);
  assert.equal(count(html, /class="mb-incident-card__edit"/g), 2);
  assert.equal(count(html, /data-edit-guide-admonition/g), 0);
  assert.equal(count(html, /class="mb-component-row" data-component-uuid="U-[12]"/g), 2);
  assert.equal(count(html, /data-card-expand/g), 2, 'Show more survives');
});

await test('view-only renderComponents: the flag is read from the form when the option is omitted', () => {
  const list = fakeList(true);
  renderComponents(list, TWO);
  assert.ok(!list.innerHTML.includes('mb-component-rail'));
});

await test('view-only renderComponents: an empty list is a plain line', () => {
  const list = fakeList(true);
  renderComponents(list, [], true, { viewOnly: true });
  assert.equal(list.innerHTML, '<p class="more-buttons-description">No components in this section.</p>');
});

await test('editable renderComponents output is unchanged', () => {
  const list = fakeList(false);
  renderComponents(list, TWO);
  const html = list.innerHTML;
  assert.equal(count(html, /data-insert-component-at="[012]"/g), 3);
  assert.equal(count(html, /mb-component-rail"/g), 2);
  assert.equal(count(html, /data-edit-guide-admonition="U-[12]"/g), 2);
});

function moveClick(formEl) {
  const btn = { disabled: false, dataset: { moveComponent: 'down' }, closest: () => ({ dataset: { componentUuid: 'U-1' } }) };
  return { currentTarget: formEl, shiftKey: false, target: { closest: sel => (sel === '[data-move-component]' ? btn : null) } };
}

await test('onComponentEditorClick: a rail move on a view-only form is ignored', () => {
  const list = fakeList(true);
  let refreshed = 0;
  const formEl = { hasAttribute: n => n === 'data-view-only', dataset: {}, querySelector: () => null, _refreshSaveState: () => { refreshed++; } };
  setOpenComponentEditor({ formEl, listEl: list, container: { kind: 'guide-section', uuid: 'S', file: 'docs/pages/x.md' }, components: TWO.slice() });
  onComponentEditorClick(moveClick(formEl));
  assert.equal(list.sets, 0);
  assert.equal(refreshed, 0);
});

await test('onComponentEditorClick: the same move on an editable form re-renders in the new order', () => {
  const list = fakeList(false);
  const formEl = { hasAttribute: () => false, dataset: {}, querySelector: () => null, _refreshSaveState: () => {} };
  setOpenComponentEditor({ formEl, listEl: list, container: { kind: 'guide-section', uuid: 'S', file: 'docs/drafts/x.md' }, components: TWO.slice() });
  onComponentEditorClick(moveClick(formEl));
  assert.equal(list.sets, 1);
  assert.ok(list.innerHTML.indexOf('U-2') < list.innerHTML.indexOf('U-1'));
});

console.log(`\n${passed} passed`);
