import assert from 'node:assert/strict';
import { STORAGE_KEY, emptyLibrary, normaliseLibrary, upsertInto, removeFrom, withActive, newAction } from '../scripts/actionsLibrary.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const step = (id, kind = 'click') => ({ id, kind, locator: { key: '#' + id, candidates: [{ type: 'id', selector: '#' + id }] }, describe: { label: id, tag: 'button', type: null }, value: null, askAtPlay: false });

test('STORAGE_KEY is the moreButtons-prefixed library key', () => {
  assert.equal(STORAGE_KEY, 'moreButtonsActions');
});

test('normaliseLibrary turns garbage into an empty library', () => {
  for (const raw of [undefined, null, 'x', 42, [], { actions: 'nope' }]) assert.deepEqual(normaliseLibrary(raw), emptyLibrary(), String(raw));
});

test('normaliseLibrary keeps well-formed actions, drops malformed ones, clears a dangling activeId', () => {
  const good = { id: 'a1', name: 'One', createdAt: 1, updatedAt: 2, steps: [step('s1')] };
  const lib = normaliseLibrary({ version: 1, activeId: 'zzz', actions: [good, { name: 'no id' }, null, { id: 'a2', name: 'Two', steps: 'bad' }] });
  assert.deepEqual(lib.actions.map(a => a.id), ['a1', 'a2']);
  assert.deepEqual(lib.actions[1].steps, [], 'bad steps repaired to empty');
  assert.equal(lib.activeId, null);
  assert.equal(normaliseLibrary({ activeId: 'a1', actions: [good] }).activeId, 'a1');
});

test('normaliseLibrary repairs step shape (missing askAtPlay/describe) and drops unknown kinds', () => {
  const lib = normaliseLibrary({ actions: [{ id: 'a', name: 'A', steps: [{ id: 's', kind: 'set', locator: { key: 'k', candidates: [] }, value: 'v' }, { id: 'x', kind: 'teleport' }] }] });
  assert.deepEqual(lib.actions[0].steps, [{ id: 's', kind: 'set', locator: { key: 'k', candidates: [] }, describe: { label: '', tag: null, type: null }, value: 'v', askAtPlay: false }]);
});

test('newAction builds an action with ids and timestamps from the injected factories', () => {
  const a = newAction({ name: '  Archive employee ', steps: [step('s1')] }, 1000, () => 'id-1');
  assert.deepEqual(a, { id: 'id-1', name: 'Archive employee', createdAt: 1000, updatedAt: 1000, steps: [step('s1')] });
});

test('upsertInto appends a new action and replaces an existing one in place, bumping updatedAt', () => {
  const a = newAction({ name: 'A', steps: [] }, 1, () => 'a');
  const b = newAction({ name: 'B', steps: [] }, 1, () => 'b');
  let lib = upsertInto(emptyLibrary(), a, 5);
  lib = upsertInto(lib, b, 6);
  assert.deepEqual(lib.actions.map(x => [x.id, x.updatedAt]), [['a', 5], ['b', 6]]);
  const lib2 = upsertInto(lib, { ...a, name: 'A2' }, 9);
  assert.deepEqual(lib2.actions.map(x => [x.id, x.name, x.updatedAt]), [['a', 'A2', 9], ['b', 'B', 6]]);
  assert.notEqual(lib2, lib, 'immutable');
  assert.equal(lib.actions[0].name, 'A');
});

test('upsertInto makes the first-ever action active, leaves activeId alone afterwards', () => {
  const a = newAction({ name: 'A', steps: [] }, 1, () => 'a');
  const b = newAction({ name: 'B', steps: [] }, 1, () => 'b');
  const lib = upsertInto(emptyLibrary(), a, 1);
  assert.equal(lib.activeId, 'a');
  assert.equal(upsertInto(lib, b, 2).activeId, 'a');
  assert.equal(upsertInto(withActive(lib, null), b, 2).activeId, null, 'an explicitly deactivated library stays so');
});

test('removeFrom drops the action and clears activeId if it was the active one', () => {
  const a = newAction({ name: 'A', steps: [] }, 1, () => 'a');
  const b = newAction({ name: 'B', steps: [] }, 1, () => 'b');
  const lib = withActive(upsertInto(upsertInto(emptyLibrary(), a, 1), b, 1), 'b');
  const out = removeFrom(lib, 'b');
  assert.deepEqual(out.actions.map(x => x.id), ['a']);
  assert.equal(out.activeId, null);
  assert.equal(removeFrom(lib, 'a').activeId, 'b');
  assert.equal(removeFrom(lib, 'nope'), lib);
});

test('withActive sets a known id, null to deactivate, and rejects unknown ids', () => {
  const a = newAction({ name: 'A', steps: [] }, 1, () => 'a');
  const lib = upsertInto(emptyLibrary(), a, 1);
  assert.equal(withActive(lib, 'a').activeId, 'a');
  assert.equal(withActive(lib, null).activeId, null);
  assert.equal(withActive(lib, 'ghost'), lib);
});

console.log(`\n${passed} passed`);
