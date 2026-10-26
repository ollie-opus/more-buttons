import assert from 'node:assert/strict';
import {
  RECORDING_KEY, OWN_UI_SELECTOR, classifyClick, stepFromChange, submitStepFor,
  newRecordingState, recordStep, recordNavigation, readRecording, writeRecording, clearRecording, recordingTitle,
} from '../scripts/actionRecorder.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// ── Fake DOM: compounds (tag/.class/#id/[attr]/[attr="v"]) with comma lists ─
function el(tag, attrs = {}, children = []) {
  const node = {
    tagName: tag.toUpperCase(), attrs: { ...attrs }, children: [], parentElement: null, _text: '', labels: [], control: null,
    checked: attrs.checked === 'true', selectedIndex: -1, options: [],
    get id() { return node.attrs.id ?? ''; }, get name() { return node.attrs.name ?? ''; },
    get value() { return node.attrs.value ?? ''; }, set value(v) { node.attrs.value = v; },
    get textContent() { return node._text + node.children.map(c => c.textContent).join(''); },
    getAttribute: k => node.attrs[k] ?? null, hasAttribute: k => k in node.attrs,
    appendChild(c) { c.parentElement = node; node.children.push(c); return c; },
    closest(sel) { for (let n = node; n; n = n.parentElement) if (matchesList(n, sel)) return n; return null; },
    matches: sel => matchesList(node, sel),
    querySelector: sel => all(node).find(n => n !== node && matchesList(n, sel)) ?? null,
    querySelectorAll: sel => all(node).filter(n => n !== node && matchesList(n, sel)),
    isConnected: true, offsetParent: {}, getClientRects: () => [{}],
  };
  children.forEach(c => (typeof c === 'string' ? (node._text += c) : node.appendChild(c)));
  return node;
}
const all = n => [n, ...n.children.flatMap(all)];
const matchesList = (n, sel) => sel.split(',').some(s => matchesCompound(n, s.trim()));
function matchesCompound(n, sel) {
  const not = /^(.*?):not\(([^)]*)\)$/.exec(sel);
  if (not) return matchesCompound(n, not[1] || '*') && !matchesCompound(n, not[2]);
  if (sel === '*') return true;
  const m = /^([a-z]*)((?:[#.][\w-]+)*)((?:\[[^\]]+\])*)(?::nth-of-type\((\d+)\))?$/i.exec(sel);
  if (!m) throw new Error('fake: ' + sel);
  if (m[1] && n.tagName !== m[1].toUpperCase()) return false;
  for (const t of m[2].match(/[#.][\w-]+/g) || []) { if (t[0] === '#' ? n.id !== t.slice(1) : !(n.attrs.class || '').split(/\s+/).includes(t.slice(1))) return false; }
  for (const a of m[3].matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) { if (!(a[1] in n.attrs)) return false; if (a[2] != null && n.attrs[a[1]] !== a[2]) return false; }
  return true;
}
const ids = () => { let i = 0; return () => `s${++i}`; };

test('RECORDING_KEY is the per-tab session key content.js gates on', () => {
  assert.equal(RECORDING_KEY, 'moreButtonsActionRecording');
  assert.ok(OWN_UI_SELECTOR.includes('.more-buttons-overlay') && OWN_UI_SELECTOR.includes('.mb-capture-bar'));
  assert.ok(!/\[class\*=/.test(OWN_UI_SELECTOR), 'explicit roots only (Tailwind mb-* collision)');
});

test('classifyClick: own UI and plain form controls are ignored; file inputs flash', () => {
  const bar = el('div', { class: 'mb-capture-bar' }, [el('button')]);
  assert.deepEqual(classifyClick(bar.children[0]), { kind: 'ignore' });
  const text = el('input', { type: 'text' }); el('form', {}, [text]);
  assert.deepEqual(classifyClick(text), { kind: 'ignore' });
  const sel = el('select'); el('form', {}, [sel]);
  assert.deepEqual(classifyClick(sel), { kind: 'ignore' });
  const file = el('input', { type: 'file' }); el('form', {}, [file]);
  assert.equal(classifyClick(file).kind, 'flash');
});

test('classifyClick: input[type=submit|button] and buttons are clicks, resolved to the interactive ancestor', () => {
  const submit = el('input', { type: 'submit', value: 'Save' }); el('form', {}, [submit]);
  assert.deepEqual(classifyClick(submit), { kind: 'click', el: submit });
  const inner = el('span', {}, ['Save']);
  const btn = el('button', {}, [inner]); el('form', {}, [btn]);
  assert.deepEqual(classifyClick(inner), { kind: 'click', el: btn });
  const icon = el('i'); const link = el('a', { href: '/x' }, [icon]); el('nav', {}, [link]);
  assert.equal(classifyClick(icon).el, link);
  const div = el('div', { role: 'button' }); el('body', {}, [div]);
  assert.equal(classifyClick(div).el, div);
});

test('classifyClick: a label that owns a control is ignored (its change is the step); a bare label is a click', () => {
  const cb = el('input', { type: 'checkbox' });
  const owning = el('label', {}, ['Weekly', cb]); owning.control = cb;
  el('form', {}, [owning]);
  assert.deepEqual(classifyClick(owning), { kind: 'ignore' });
  const forLabel = el('label', { for: 'x' }, ['X']); el('form', {}, [forLabel]);
  assert.deepEqual(classifyClick(forLabel), { kind: 'ignore' });
  const bare = el('label', {}, ['Just text']); el('form', {}, [bare]);
  assert.equal(classifyClick(bare).kind, 'click');
});

test('stepFromChange: text → set, checkbox → check, radio → choose (group + option text), select → set with option text', () => {
  const nid = ids();
  const text = el('input', { id: 'site_name', type: 'text', value: 'Acme' }); el('form', {}, [text]);
  const t = stepFromChange(text, nid).step;
  assert.equal(t.kind, 'set'); assert.equal(t.value, 'Acme'); assert.equal(t.askAtPlay, false); assert.equal(t.locator.key, '#site_name');
  const cb = el('input', { id: 'tick', type: 'checkbox', value: 'on' }); cb.checked = true; el('form', {}, [cb]);
  const c = stepFromChange(cb, nid).step;
  assert.equal(c.kind, 'check'); assert.equal(c.value, true);
  const radio = el('input', { id: 'loc_ho', type: 'radio', name: 'site[location]', value: 'ho' }); radio.checked = true;
  const lbl = el('label', {}, ['Head office', radio]); lbl.control = radio; radio.labels = [lbl]; el('form', {}, [lbl]);
  const r = stepFromChange(radio, nid).step;
  assert.equal(r.kind, 'choose'); assert.equal(r.value, 'ho'); assert.equal(r.describe.group, 'site[location]'); assert.equal(r.describe.optionText, 'Head office');
  const opt1 = el('option', { value: 'a' }, ['Alpha']), opt2 = el('option', { value: 'b' }, ['Beta']);
  const select = el('select', { id: 'kind', value: 'b' }, [opt1, opt2]); select.options = [opt1, opt2]; select.selectedIndex = 1; el('form', {}, [select]);
  const s = stepFromChange(select, nid).step;
  assert.equal(s.kind, 'set'); assert.equal(s.value, 'b'); assert.equal(s.describe.optionText, 'Beta');
  const ta = el('textarea', { id: 'notes', value: 'hi' }); el('form', {}, [ta]);
  assert.equal(stepFromChange(ta, nid).step.value, 'hi');
});

test('stepFromChange: password → ask-at-play set with no value plus a flash; hidden inputs are ignored', () => {
  const pw = el('input', { id: 'user_password', type: 'password', value: 'hunter2' }); el('form', {}, [pw]);
  const r = stepFromChange(pw, ids());
  assert.equal(r.step.kind, 'set'); assert.equal(r.step.value, null); assert.equal(r.step.askAtPlay, true);
  assert.match(r.flash, /ask at play/i);
  assert.ok(!JSON.stringify(r.step).includes('hunter2'));
  const hidden = el('input', { type: 'hidden', value: 'tok' }); el('form', {}, [hidden]);
  assert.deepEqual(stepFromChange(hidden, ids()), { step: null });
});

test('submitStepFor: skips when the submitter was just clicked; otherwise records the submitter or default button; flashes when none', () => {
  const nid = ids();
  const save = el('button', { id: 'save_btn', type: 'submit' }, ['Save']);
  const form = el('form', {}, [el('input', { type: 'text' }), save]);
  const justClicked = { kind: 'click', locator: { key: '#save_btn' } };
  assert.equal(submitStepFor(form, save, { lastStep: justClicked, lastStepAt: 1000, now: 1200 }, nid), null);
  const late = submitStepFor(form, save, { lastStep: justClicked, lastStepAt: 1000, now: 2000 }, nid);
  assert.equal(late.step.kind, 'click'); assert.equal(late.step.locator.key, '#save_btn');
  const enter = submitStepFor(form, null, { lastStep: null, lastStepAt: 0, now: 5 }, nid);
  assert.equal(enter.step.locator.key, '#save_btn', 'default submit button');
  const none = el('form', {}, [el('input', { type: 'text' })]);
  assert.match(submitStepFor(none, null, { lastStep: null, lastStepAt: 0, now: 5 }, nid).flash, /couldn.t be recorded/i);
});

test('newRecordingState / recordStep / recordNavigation reducers', () => {
  const nid = ids();
  let st = newRecordingState({ mode: 'new', path: '/a', now: 100 });
  assert.deepEqual(st, { v: 1, phase: 'recording', mode: 'new', insert: null, steps: [], lastPath: '/a', startedAt: 100, lastStepAt: 0 });
  const clickStep = { id: nid(), kind: 'click', locator: { key: '#go', candidates: [] }, describe: { label: 'Go', tag: 'button', type: null }, value: null, askAtPlay: false };
  st = recordStep(st, clickStep, 150);
  assert.equal(st.steps.length, 1); assert.equal(st.lastStepAt, 150);
  assert.equal(recordNavigation(st, '/a'), st, 'same path: no marker');
  st = recordNavigation(st, '/b');
  assert.equal(st.steps.at(-1).kind, 'navigate'); assert.equal(st.steps.at(-1).value, '/b'); assert.equal(st.lastPath, '/b');
  const ins = newRecordingState({ mode: 'insert', insert: { actionId: 'a1', name: 'N', draftSteps: [], insertAt: 2 }, path: '/a', now: 1 });
  assert.equal(ins.mode, 'insert'); assert.equal(ins.insert.insertAt, 2);
});

test('recordingTitle reads Recording/Paused/Inserting with the step count', () => {
  const st = newRecordingState({ mode: 'new', path: '/', now: 0 });
  assert.equal(recordingTitle(st), 'Recording · 0 steps');
  assert.equal(recordingTitle({ ...st, steps: [{}], phase: 'paused' }), 'Paused · 1 step');
  assert.equal(recordingTitle({ ...st, mode: 'insert', steps: [{}, {}] }), 'Inserting · 2 steps');
});

test('session helpers round-trip through a sessionStorage-like store and tolerate garbage', () => {
  const store = new Map();
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
  const st = newRecordingState({ mode: 'new', path: '/', now: 1 });
  writeRecording(storage, st);
  assert.deepEqual(readRecording(storage), st);
  assert.ok(store.has(RECORDING_KEY));
  storage.setItem(RECORDING_KEY, '{not json');
  assert.equal(readRecording(storage), null);
  storage.setItem(RECORDING_KEY, JSON.stringify({ v: 1, phase: 'recording' }));
  assert.equal(readRecording(storage), null, 'missing steps/mode → not a session');
  clearRecording(storage);
  assert.equal(readRecording(storage), null);
});

console.log(`\n${passed} passed`);
