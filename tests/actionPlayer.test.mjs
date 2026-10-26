import assert from 'node:assert/strict';
import {
  PLAYBACK_KEY, newPlaybackState, playbackTitle, preflightSegment, describeFailure, performStep, setNativeValue,
  readPlayback, writePlayback, clearPlayback,
} from '../scripts/actionPlayer.js';

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('  ok -', name); }

// ── Fake elements ─────────────────────────────────────────────────────────────
class FakeControl {
  constructor(attrs = {}) { this.attrs = attrs; this.events = []; this.clicks = 0; this.focused = false; this.checked = !!attrs.checked; this._value = attrs.value ?? ''; this.isConnected = true; this.offsetParent = {}; this.disabled = false; this.readOnly = false; this.tagName = (attrs.tag ?? 'input').toUpperCase(); this.options = attrs.options ?? null; this.instanceSets = 0; }
  get value() { return this._value; }
  set value(v) { FakeControl.protoSets.push(v); this._value = this.options ? (this.options.includes(v) ? v : this._value) : v; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  dispatchEvent(ev) { this.events.push(ev.type); return true; }
  click() { this.clicks++; if (this.attrs.type === 'checkbox') this.checked = !this.checked; if (this.attrs.type === 'radio') this.checked = true; }
  focus() { this.focused = true; }
  getClientRects() { return [{}]; }
}
FakeControl.protoSets = [];
const step = (kind, id, over = {}) => ({ id, kind, locator: { key: '#' + id, candidates: [{ type: 'id', selector: '#' + id }] }, describe: { label: id, tag: 'input', type: 'text' }, value: null, askAtPlay: false, ...over });
const root = (map) => ({ querySelectorAll: sel => (map[sel] ? [].concat(map[sel]) : []) });

await test('PLAYBACK_KEY is the per-tab session key content.js gates on', () => {
  assert.equal(PLAYBACK_KEY, 'moreButtonsActionPlayback');
});

await test('newPlaybackState snapshots the action and starts at step 0', () => {
  const action = { id: 'a1', name: 'Go', steps: [step('click', 's1')] };
  const st = newPlaybackState(action, { askValues: { s9: 'x' }, now: 5, runId: 'r1' });
  assert.deepEqual(st, { v: 1, runId: 'r1', actionId: 'a1', name: 'Go', steps: action.steps, nextIndex: 0, askValues: { s9: 'x' }, log: [], startedAt: 5 });
});

await test('playbackTitle counts the current step of the total', () => {
  const st = newPlaybackState({ id: 'a', name: 'n', steps: [{}, {}, {}] }, { now: 0, runId: 'r' });
  assert.equal(playbackTitle({ ...st, nextIndex: 2 }), 'Playing · step 3 of 3');
  assert.equal(playbackTitle({ ...st, nextIndex: 0 }), 'Playing · step 1 of 3');
});

await test('preflightSegment resolves every step up to the next navigate, reporting the ones that fail', () => {
  const a = new FakeControl(), b = new FakeControl();
  const steps = [step('set', 'a'), step('click', 'b'), { id: 'n', kind: 'navigate', locator: null, describe: {}, value: '/p', askAtPlay: false }, step('click', 'c')];
  const ok = preflightSegment(steps, 0, root({ '#a': a, '#b': b }));
  assert.deepEqual(ok, { ok: true, end: 2, failures: [] });
  const bad = preflightSegment(steps, 0, root({ '#a': a, '#b': [b, b] }));
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.failures.map(f => [f.index, f.tried[0].count]), [[1, 2]]);
  const seg2 = preflightSegment(steps, 3, root({}));
  assert.deepEqual(seg2.failures.map(f => f.index), [3]);
  assert.equal(seg2.end, 4);
});

await test('describeFailure explains a locator miss and a timeout in plain words', () => {
  assert.match(describeFailure({ index: 1, step: step('click', 'b'), tried: [{ count: 0 }, { count: 2 }] }), /Step 2.*Click “b”.*2 ways.*0.*2/s);
  assert.match(describeFailure({ index: 0, step: step('set', 'a'), reason: 'Option not found' }), /Step 1.*Option not found/s);
});

await test('setNativeValue uses the prototype setter even when the instance shadows it', () => {
  const el = new FakeControl();
  Object.defineProperty(el, 'value', { get() { return 'shadow'; }, set() { el.instanceSets++; }, configurable: true });
  FakeControl.protoSets = [];
  setNativeValue(el, 'real');
  assert.deepEqual(FakeControl.protoSets, ['real']);
  assert.equal(el.instanceSets, 0);
  const plain = { value: '' };
  setNativeValue(plain, 'x');
  assert.equal(plain.value, 'x', 'no accessor anywhere → plain assignment');
});

await test('performStep set: writes the value natively and fires input + change; ask-at-play reads askValues', async () => {
  const el = new FakeControl({ type: 'text' });
  await performStep(step('set', 'a', { value: 'Acme' }), el, {});
  assert.equal(el.value, 'Acme');
  assert.deepEqual(el.events, ['input', 'change']);
  const pw = new FakeControl({ type: 'password' });
  await performStep(step('set', 'p', { value: null, askAtPlay: true }), pw, { p: 's3cret' });
  assert.equal(pw.value, 's3cret');
});

await test('performStep set on a select fails loudly when the option is missing', async () => {
  const sel = new FakeControl({ tag: 'select', options: ['a', 'b'], value: 'a' });
  await performStep(step('set', 's', { value: 'b' }), sel, {});
  assert.equal(sel.value, 'b');
  await assert.rejects(performStep(step('set', 's', { value: 'zzz' }), sel, {}), /Option not found/);
});

await test('performStep check/choose click only when the state differs; click focuses then clicks', async () => {
  const cb = new FakeControl({ type: 'checkbox', checked: false });
  await performStep(step('check', 'c', { value: true }), cb, {});
  assert.equal(cb.clicks, 1); assert.equal(cb.checked, true);
  await performStep(step('check', 'c', { value: true }), cb, {});
  assert.equal(cb.clicks, 1, 'already checked → no click');
  const r = new FakeControl({ type: 'radio', checked: true });
  await performStep(step('choose', 'r', { value: 'x' }), r, {});
  assert.equal(r.clicks, 0);
  const btn = new FakeControl({ tag: 'button' });
  await performStep(step('click', 'b'), btn, {});
  assert.equal(btn.focused, true); assert.equal(btn.clicks, 1);
});

await test('session helpers round-trip and reject garbage', () => {
  const store = new Map();
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
  const st = newPlaybackState({ id: 'a', name: 'n', steps: [step('click', 'x')] }, { now: 1, runId: 'r' });
  writePlayback(storage, st);
  assert.deepEqual(readPlayback(storage), st);
  assert.ok(store.has(PLAYBACK_KEY));
  storage.setItem(PLAYBACK_KEY, '{');
  assert.equal(readPlayback(storage), null);
  storage.setItem(PLAYBACK_KEY, JSON.stringify({ v: 1, steps: 'nope' }));
  assert.equal(readPlayback(storage), null);
  clearPlayback(storage);
  assert.equal(readPlayback(storage), null);
});

console.log(`\n${passed} passed`);
