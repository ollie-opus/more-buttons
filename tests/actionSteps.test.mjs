import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  STEP_KINDS, KIND_META, makeStep, sameTarget, appendStep, appendNavigate,
  segmentBounds, askAtPlaySteps, spliceSteps, moveStep, removeStep, setAskAtPlay, summariseStep,
} from '../scripts/actionSteps.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

let n = 0;
const nextId = () => `s${++n}`;
const loc = key => ({ key, candidates: [{ type: 'id', selector: key }] });
const set = (key, value, extra = {}) => makeStep('set', { locator: loc(key), describe: { label: key, tag: 'input', type: 'text' }, value, ...extra }, nextId);
const click = key => makeStep('click', { locator: loc(key), describe: { label: key, tag: 'button', type: null } }, nextId);
const check = (key, value) => makeStep('check', { locator: loc(key), describe: { label: key, tag: 'input', type: 'checkbox' }, value }, nextId);
const choose = (key, group, value) => makeStep('choose', { locator: loc(key), describe: { label: key, tag: 'input', type: 'radio', group }, value }, nextId);

test('STEP_KINDS lists the five kinds and KIND_META covers each with a bundled lucide icon', () => {
  assert.deepEqual(STEP_KINDS, ['click', 'set', 'check', 'choose', 'navigate']);
  const names = new Set(JSON.parse(readFileSync(fileURLToPath(new URL('../config/lucideIcons.json', import.meta.url)), 'utf8')));
  for (const k of STEP_KINDS) {
    assert.ok(KIND_META[k]?.icon && names.has(KIND_META[k].icon), `${k} icon`);
    assert.ok(KIND_META[k].colour && KIND_META[k].label);
  }
});

test('makeStep fills defaults and uses the id factory', () => {
  const s = makeStep('click', { locator: loc('#a'), describe: { label: 'Save', tag: 'button', type: null } }, () => 'id-1');
  assert.deepEqual(s, { id: 'id-1', kind: 'click', locator: loc('#a'), describe: { label: 'Save', tag: 'button', type: null }, value: null, askAtPlay: false });
  assert.throws(() => makeStep('bogus', {}, () => 'x'));
});

test('sameTarget compares locator keys and is false for navigate/null locators', () => {
  assert.ok(sameTarget(set('#a', '1'), set('#a', '2')));
  assert.ok(!sameTarget(set('#a', '1'), set('#b', '1')));
  const nav = makeStep('navigate', { value: '/x' }, nextId);
  assert.ok(!sameTarget(nav, nav));
});

test('appendStep: a second set on the same target replaces the value in place and keeps the id', () => {
  const a = set('#name', 'Ac');
  const b = click('#other');
  const steps = appendStep(appendStep([], a), b);
  const out = appendStep(steps, set('#name', 'Acme'));
  assert.equal(out.length, 2);
  assert.equal(out[0].id, a.id);
  assert.equal(out[0].value, 'Acme');
  assert.equal(out[1], b);
  assert.notEqual(out, steps, 'immutable: returns a new array');
  assert.equal(steps[0].value, 'Ac', 'input untouched');
});

test('appendStep: set on a different target appends', () => {
  const out = appendStep([set('#a', '1')], set('#b', '2'));
  assert.equal(out.length, 2);
});

test('appendStep: check on the same target replaces the boolean', () => {
  const out = appendStep([check('#tick', true)], check('#tick', false));
  assert.equal(out.length, 1);
  assert.equal(out[0].value, false);
});

test('appendStep: choose in the same radio group replaces locator and value, keeping the id', () => {
  const first = choose('#loc_a', 'site[location]', 'a');
  const out = appendStep([first], choose('#loc_b', 'site[location]', 'b'));
  assert.equal(out.length, 1);
  assert.equal(out[0].id, first.id);
  assert.equal(out[0].locator.key, '#loc_b');
  assert.equal(out[0].value, 'b');
  const other = appendStep(out, choose('#sev_1', 'site[severity]', '1'));
  assert.equal(other.length, 2);
});

test('appendStep: clicks never coalesce', () => {
  const out = appendStep([click('#save')], click('#save'));
  assert.equal(out.length, 2);
});

test('appendStep: coalescing stops at a navigate marker', () => {
  let steps = appendStep([], set('#name', 'a'));
  steps = appendNavigate(steps, '/page2');
  steps = appendStep(steps, set('#name', 'b'));
  assert.equal(steps.length, 3);
  assert.equal(steps[0].value, 'a');
  assert.equal(steps[2].value, 'b');
});

test('appendStep: set replacement carries askAtPlay (password re-entry) and nulls the value', () => {
  const out = appendStep([set('#pw', 'x')], set('#pw', null, { askAtPlay: true }));
  assert.equal(out.length, 1);
  assert.equal(out[0].askAtPlay, true);
  assert.equal(out[0].value, null);
});

test('appendNavigate: ignored on an empty recording, collapses consecutive navigates to the latest path', () => {
  assert.deepEqual(appendNavigate([], '/x'), []);
  let steps = appendStep([], click('#go'));
  steps = appendNavigate(steps, '/a');
  steps = appendNavigate(steps, '/b');
  assert.equal(steps.length, 2);
  assert.equal(steps[1].kind, 'navigate');
  assert.equal(steps[1].value, '/b');
  assert.equal(steps[1].locator, null);
});

test('segmentBounds: end is the first navigate at/after from, or length', () => {
  let steps = appendStep([], click('#a'));
  steps = appendStep(steps, click('#b'));
  steps = appendNavigate(steps, '/p');
  steps = appendStep(steps, click('#c'));
  assert.deepEqual(segmentBounds(steps, 0), { end: 2, navigateAt: 2 });
  assert.deepEqual(segmentBounds(steps, 3), { end: 4, navigateAt: -1 });
  assert.deepEqual(segmentBounds(steps, 2), { end: 2, navigateAt: 2 }, 'from pointing at a navigate yields an empty segment');
});

test('askAtPlaySteps returns only flagged steps', () => {
  const pw = set('#pw', null, { askAtPlay: true });
  const steps = [set('#a', '1'), pw, click('#b')];
  assert.deepEqual(askAtPlaySteps(steps), [pw]);
});

test('spliceSteps inserts at an index without mutating', () => {
  const a = click('#a'), b = click('#b'), c = click('#c');
  const base = [a, b];
  const out = spliceSteps(base, 1, [c]);
  assert.deepEqual(out.map(s => s.id), [a.id, c.id, b.id]);
  assert.deepEqual(base.map(s => s.id), [a.id, b.id]);
  assert.deepEqual(spliceSteps(base, 99, [c]).map(s => s.id), [a.id, b.id, c.id], 'clamped to the end');
});

test('moveStep swaps with the neighbour and ignores out-of-range moves', () => {
  const a = click('#a'), b = click('#b');
  const base = [a, b];
  assert.deepEqual(moveStep(base, 0, 1).map(s => s.id), [b.id, a.id]);
  assert.equal(moveStep(base, 0, -1), base);
  assert.equal(moveStep(base, 1, 1), base);
});

test('removeStep drops the index without mutating', () => {
  const a = click('#a'), b = click('#b');
  const base = [a, b];
  assert.deepEqual(removeStep(base, 0).map(s => s.id), [b.id]);
  assert.equal(base.length, 2);
  assert.equal(removeStep(base, 5), base);
});

test('setAskAtPlay on a set step clears the stored value; off leaves value null; other kinds unchanged', () => {
  const s = set('#pw', 'secret');
  const on = setAskAtPlay([s], 0, true);
  assert.equal(on[0].askAtPlay, true);
  assert.equal(on[0].value, null);
  const off = setAskAtPlay(on, 0, false);
  assert.equal(off[0].askAtPlay, false);
  assert.equal(off[0].value, null);
  const c = click('#x');
  assert.equal(setAskAtPlay([c], 0, true)[0].askAtPlay, false);
});

test('summariseStep: titles per kind, masked value when askAtPlay', () => {
  assert.deepEqual(summariseStep(set('#name', 'Acme')), { icon: 'text-cursor-input', kindLabel: 'Set value', title: 'Set “#name”', valueText: 'Acme', masked: false });
  const pw = summariseStep(set('#pw', null, { askAtPlay: true }));
  assert.equal(pw.valueText, '••••');
  assert.equal(pw.masked, true);
  assert.equal(summariseStep(click('#save')).title, 'Click “#save”');
  assert.equal(summariseStep(click('#save')).valueText, null);
  assert.equal(summariseStep(check('#t', true)).valueText, 'Checked');
  assert.equal(summariseStep(check('#t', false)).valueText, 'Unchecked');
  const ch = makeStep('choose', { locator: loc('#r'), describe: { label: 'Location', tag: 'input', type: 'radio', group: 'g', optionText: 'Head office' }, value: 'ho' }, nextId);
  assert.equal(summariseStep(ch).title, 'Choose “Location”');
  assert.equal(summariseStep(ch).valueText, 'Head office');
  const nav = summariseStep(makeStep('navigate', { value: '/admin/sites' }, nextId));
  assert.equal(nav.title, 'Page change');
  assert.equal(nav.valueText, '/admin/sites');
});

console.log(`\n${passed} passed`);
