import assert from 'node:assert/strict';
import {
  PLAYBACK_KEY, newPlaybackState, playbackTitle, persistedState, describeFailure, performStep, setNativeValue,
  readPlayback, writePlayback, clearPlayback, waitForNavigationSettle, playerIsVisible, startPlayback, isPlaying, veilTitle, veilSubtitle,
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
  focus() { this.focused = true; this.events.push('focus'); }
  blur() { this.focused = false; this.events.push('blur'); }
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

await test('veil copy: name on top, progress underneath', () => {
  const st = newPlaybackState({ id: 'a', name: 'Weekly', steps: [{}, {}, {}] }, { now: 0, runId: 'r' });
  assert.equal(veilTitle(st), 'Playing “Weekly”');
  assert.equal(veilSubtitle({ ...st, nextIndex: 1 }), 'Step 2 of 3');
});

await test('playbackTitle counts the current step of the total', () => {
  const st = newPlaybackState({ id: 'a', name: 'n', steps: [{}, {}, {}] }, { now: 0, runId: 'r' });
  assert.equal(playbackTitle({ ...st, nextIndex: 2 }), 'Playing · step 3 of 3');
  assert.equal(playbackTitle({ ...st, nextIndex: 0 }), 'Playing · step 1 of 3');
});

await test('describeFailure explains a locator miss, a timed-out wait and a thrown reason in plain words', () => {
  assert.match(describeFailure({ index: 1, step: step('click', 'b'), tried: [{ count: 0 }, { count: 2 }] }), /Step 2.*Click “b”.*2 ways.*0.*2/s);
  assert.match(describeFailure({ index: 1, step: step('click', 'b'), tried: [{ count: 0 }], waitedMs: 3000 }), /after waiting 3 s.*1 way/s);
  assert.match(describeFailure({ index: 0, step: step('set', 'a'), reason: 'Option not found' }), /Step 1.*Option not found/s);
});

await test('playback has no up-front guard: a later step whose element only appears after an earlier step still plays', async () => {
  const opener = new FakeControl({ tag: 'button' });
  const popInput = new FakeControl({ type: 'text' });
  let popoverOpen = false;
  opener.click = () => { opener.clicks++; popoverOpen = true; };
  const doc = { querySelectorAll: sel => (sel === '#open' ? [opener] : sel === '#pop' && popoverOpen ? [popInput] : []) };
  const store = new Map();
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
  const errors = [];
  const bar = { setTitle() {}, setSubtitle() {}, remove() {} };
  await startPlayback({ id: 'a', name: 'n', steps: [step('click', 'open'), step('set', 'pop', { value: 'hi' })] }, {}, {
    doc, win: { location: { href: 'h' } }, storage, mountVeil: () => bar, watcherFactory: () => ({ start() {}, stop() {} }), showError: (st, f) => { errors.push(f); },
  });
  assert.deepEqual(errors, [], 'the popover input did not exist at start and that must not matter');
  assert.equal(opener.clicks, 1);
  assert.equal(popInput.value, 'hi');
});

await test('playback halts at the FIRST step whose element never appears; earlier steps stay run, later ones are not attempted', async () => {
  const a = new FakeControl({ tag: 'button' }), c = new FakeControl({ tag: 'button' });
  const doc = { querySelectorAll: sel => (sel === '#a' ? [a] : sel === '#c' ? [c] : []) };
  const store = new Map();
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
  const errors = []; let errState = null;
  const bar = { setTitle() {}, setSubtitle() {}, remove() { bar.removed = true; } };
  await startPlayback({ id: 'a', name: 'n', steps: [step('click', 'a'), step('click', 'missing'), step('click', 'c')] }, {}, {
    doc, win: { location: { href: 'h' } }, storage, mountVeil: () => bar, watcherFactory: () => ({ start() {}, stop() {} }), showError: (st, f) => { errState = st; errors.push(f); },
  });
  assert.equal(a.clicks, 1, 'step 1 ran');
  assert.equal(c.clicks, 0, 'step 3 was never attempted');
  assert.equal(errors.length, 1);
  assert.equal(errors[0][0].index, 1);
  assert.match(describeFailure(errors[0][0]), /Step 2.*no element found after waiting 3 s/s);
  assert.deepEqual(errState.log, [{ index: 0, ok: true }]);
  assert.equal(bar.removed, true);
  assert.equal(isPlaying(), false);
  assert.equal(store.has(PLAYBACK_KEY), false);
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

await test('performStep set replays the whole interaction: focus → value → input → keyup → change → blur; ask-at-play reads askValues', async () => {
  const el = new FakeControl({ type: 'text' });
  let valueAtInput = null, keyAtKeyup = null;
  el.dispatchEvent = ev => { el.events.push(ev.type); if (ev.type === 'input') valueAtInput = el.value; if (ev.type === 'keyup') keyAtKeyup = ev.key; return true; };
  await performStep(step('set', 'a', { value: 'Acme' }), el, {});
  assert.equal(el.value, 'Acme');
  assert.deepEqual(el.events, ['focus', 'input', 'keyup', 'change', 'blur'], 'live-save editors hook focusout/keyup, not just input/change');
  assert.equal(valueAtInput, 'Acme', 'value is already set when input fires');
  assert.equal(keyAtKeyup, 'e', 'keyup carries the last typed character');
  assert.equal(el.focused, false, 'field is left afterwards');
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

await test('persistedState keeps only ask-at-play values that a step still to run needs', () => {
  const steps = [step('set', 'p1', { askAtPlay: true }), step('click', 'c'), step('set', 'p2', { askAtPlay: true })];
  const st = newPlaybackState({ id: 'a', name: 'n', steps }, { askValues: { p1: 'one', p2: 'two', stale: 'x' }, now: 0, runId: 'r' });
  assert.deepEqual(persistedState(st).askValues, { p1: 'one', p2: 'two' }, 'nothing run yet: both kept, unknown ids dropped');
  assert.deepEqual(persistedState({ ...st, nextIndex: 1 }).askValues, { p2: 'two' }, 'p1 consumed');
  assert.deepEqual(persistedState({ ...st, nextIndex: 3 }).askValues, {}, 'all consumed');
  assert.deepEqual(st.askValues, { p1: 'one', p2: 'two', stale: 'x' }, 'in-memory state untouched');
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


await test('waitForNavigationSettle: watcher fallback is pushed past our timeout and only a body swap counts as "moved"', async () => {
  let opts = null;
  const body1 = {}, body2 = {};
  const doc = { body: body1 };
  const win = { location: { href: 'https://h/a' } };
  const env = { doc, win, watcherFactory: o => { opts = o; return { start() {}, stop() {} }; } };
  let settled = null;
  const p = waitForNavigationSettle(env, 500).then(v => { settled = v; });
  assert.equal(opts.fallbackMs, 500, 'the 1.5 s default fallback must never pre-empt the navigation wait');
  win.location.href = 'https://h/b';
  opts.onSettle('https://h/b');          // turbo:visit already changed the href, old body still mounted
  await new Promise(r => setTimeout(r, 0));
  assert.equal(settled, null, 'new href on the OLD body is not a settled new page');
  doc.body = body2;
  opts.onSettle('https://h/b');
  await p;
  assert.equal(settled, true);
});

await test('playerIsVisible rejects elements inside the extension\'s own UI', () => {
  const inBar = { isConnected: true, offsetParent: {}, closest: sel => (sel.includes('.mb-capture-bar') ? {} : null) };
  const onPage = { isConnected: true, offsetParent: {}, closest: () => null };
  assert.equal(playerIsVisible(inBar), false);
  assert.equal(playerIsVisible(onPage), true);
});

await test('Cancel on the veil halts a run that is mid-wait for a missing element: no error form, veil removed, well inside the 3 s wait', async () => {
  const a = new FakeControl({ tag: 'button' });
  const doc = { querySelectorAll: sel => (sel === '#a' ? [a] : []) };
  const store = new Map();
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
  const errors = [];
  let cancel = null;
  const veil = { setTitle() {}, setSubtitle() {}, setDone() { veil.done = true; }, remove() { veil.removed = true; } };
  const t0 = Date.now();
  const run = startPlayback({ id: 'a', name: 'n', steps: [step('click', 'a'), step('click', 'never')] }, {}, {
    doc, win: { location: { href: 'h' } }, storage, mountVeil: o => { cancel = o.onCancel; return veil; }, watcherFactory: () => ({ start() {}, stop() {} }), showError: (st, f) => { errors.push(f); },
  });
  await new Promise(r => setTimeout(r, 250));
  assert.equal(a.clicks, 1, 'step 1 ran before the cancel');
  assert.equal(isPlaying(), true);
  cancel();
  await run;
  assert.ok(Date.now() - t0 < 1500, 'cancel must not wait out the 3 s step timeout');
  assert.deepEqual(errors, [], 'a cancel is not a failure');
  assert.equal(veil.removed, true);
  assert.equal(veil.done, undefined, 'no completion tick on cancel');
  assert.equal(isPlaying(), false);
  assert.equal(store.has(PLAYBACK_KEY), false);
});

await test('a completed run shows the done tick on the veil before tearing down', async () => {
  const a = new FakeControl({ tag: 'button' });
  const store = new Map();
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
  const calls = [];
  const veil = { setTitle() {}, setSubtitle(t) { calls.push(['sub', t]); }, setDone(t, sub) { calls.push(['done', t, sub]); }, remove() { calls.push(['remove']); } };
  await startPlayback({ id: 'a', name: 'Go', steps: [step('click', 'a')] }, {}, {
    doc: { querySelectorAll: sel => (sel === '#a' ? [a] : []) }, win: { location: { href: 'h' } }, storage, mountVeil: () => veil, watcherFactory: () => ({ start() {}, stop() {} }), showError: () => {},
  });
  assert.deepEqual(calls, [['sub', 'Step 1 of 1'], ['done', 'Played · 1 step', '“Go” finished'], ['remove']]);
});

await test('an unexpected throw inside the run loop still tears down (error form shown, player idle)', async () => {
  const el = new FakeControl({ tag: 'button' });
  const store = new Map();
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
  const errors = [];
  const bar = { setTitle() {}, setSubtitle() { throw new Error('boom'); }, remove() { bar.removed = true; } };
  await startPlayback({ id: 'a', name: 'n', steps: [step('click', 'x')] }, {}, {
    doc: { querySelectorAll: sel => (sel === '#x' ? [el] : []) }, win: { location: { href: 'h' } }, storage,
    mountVeil: () => bar, watcherFactory: () => ({ start() {}, stop() {} }), showError: (st, failures) => { errors.push(failures); },
  });
  assert.equal(isPlaying(), false);
  assert.equal(bar.removed, true);
  assert.equal(store.has(PLAYBACK_KEY), false);
  assert.match(errors[0][0].reason, /boom/);
});

console.log(`\n${passed} passed`);
