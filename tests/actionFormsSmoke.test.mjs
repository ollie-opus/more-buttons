// Node smoke test for the Manage/Edit render helpers and the recorder→editor
// hand-offs: the DOM controllers are thin, but their integration with the
// icon painter and the form registry is exactly what unit tests of the pure
// modules cannot see (review finding C1/I1).
import assert from 'node:assert/strict';

// A MutationObserver that behaves like the browser's: observing a non-Node throws.
globalThis.MutationObserver = class { constructor() {} observe(t) { if (!t || typeof t !== 'object') throw new TypeError('observe: parameter 1 is not of type Node'); } disconnect() {} };
const store = new Map();
globalThis.window = globalThis;
globalThis.sessionStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
globalThis.document = { documentElement: { querySelectorAll: () => [] }, defaultView: globalThis, createElement: () => ({ style: {}, classList: { add() {} }, setAttribute() {}, appendChild() {} }), body: { style: {} }, addEventListener() {}, removeEventListener() {} };
globalThis.chrome = { runtime: { getURL: p => p }, storage: { local: { get: async () => ({ moreButtonsActions: { version: 1, activeId: 'a1', actions: [{ id: 'a1', name: 'One', createdAt: 1, updatedAt: 2, steps: [] }] } }), set: async () => {} } } };

const { renderActionsList } = await import('../scripts/actionsManage.js');
const { renderTimeline } = await import('../scripts/actionEditor.js');
const { registerFormAction, getFormAction } = await import('../scripts/formActions.js');

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('  ok -', name); }

function host() {
  const h = { _html: '', children: [], querySelectorAll: () => [], get innerHTML() { return h._html; }, set innerHTML(v) { h._html = v; } };
  return h;
}

await test('renderActionsList paints the library into the list host without touching the icon watcher', async () => {
  const list = host();
  const formEl = { querySelector: sel => (sel === '[data-actions-list]' ? list : null) };
  await renderActionsList(formEl);
  assert.ok(list.innerHTML.includes('mb-action-card') && list.innerHTML.includes('data-action-active="a1" aria-pressed="true"'));
});

await test('renderTimeline paints the steps into the timeline host', () => {
  const tl = host();
  const formEl = { _action: { steps: [{ id: 's', kind: 'click', locator: { key: '#x', candidates: [] }, describe: { label: 'Go', tag: 'button', type: null }, value: null, askAtPlay: false }] }, querySelector: sel => (sel === '[data-action-steps]' ? tl : null) };
  renderTimeline(formEl);
  assert.ok(tl.innerHTML.includes('mb-action-step') && tl.innerHTML.includes('data-insert-steps-at="1"'));
});

await test('insert-mode hand-offs reopen Manage BEFORE the editor so Back has somewhere to go', async () => {
  const calls = [];
  registerFormAction('openManageActions', async () => { calls.push('manage'); });
  registerFormAction('openEditAction', async args => { calls.push(['edit', args.id, args.draft?.steps.length]); });
  const state = { v: 1, phase: 'naming', mode: 'insert', insert: { actionId: 'a1', name: 'One', draftSteps: [{ id: 'd1', kind: 'click' }], insertAt: 1 }, steps: [{ id: 'n1', kind: 'click' }], lastPath: '/', startedAt: 0, lastStepAt: 0 };
  await getFormAction('finishInsertRecording')({ state });
  assert.deepEqual(calls, ['manage', ['edit', 'a1', 2]]);
  calls.length = 0;
  await getFormAction('cancelActionRecording')({ state });
  assert.deepEqual(calls, ['manage', ['edit', 'a1', 1]]);
});

console.log(`\n${passed} passed`);
