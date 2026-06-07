import assert from 'node:assert/strict';
import { mergeFields, ConflictNeeded } from '../scripts/formMerge.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const SPECS = [
  { name: 'title', type: 'scalar', label: 'Title' },
  { name: 'desc', type: 'scalar', label: 'Description' },
];

test('untouched field takes fresh (theirs)', () => {
  const snap  = { title: 'A', desc: 'D' };
  const cur   = { title: 'A', desc: 'D' };           // user changed nothing
  const fresh = { title: 'A2', desc: 'D' };          // someone else changed title
  const { resolved, conflicts } = mergeFields(snap, cur, fresh, SPECS);
  assert.equal(conflicts.length, 0);
  assert.equal(resolved.title, 'A2');                // theirs
  assert.equal(resolved.desc, 'D');
});

test('only-you-changed takes yours', () => {
  const snap  = { title: 'A', desc: 'D' };
  const cur   = { title: 'A', desc: 'D2' };          // you changed desc
  const fresh = { title: 'A', desc: 'D' };           // theirs unchanged
  const { resolved, conflicts } = mergeFields(snap, cur, fresh, SPECS);
  assert.equal(conflicts.length, 0);
  assert.equal(resolved.desc, 'D2');                 // yours
});

test('same edit both sides is not a conflict', () => {
  const snap  = { title: 'A', desc: 'D' };
  const cur   = { title: 'A', desc: 'SAME' };
  const fresh = { title: 'A', desc: 'SAME' };
  const { resolved, conflicts } = mergeFields(snap, cur, fresh, SPECS);
  assert.equal(conflicts.length, 0);
  assert.equal(resolved.desc, 'SAME');
});

test('true collision is reported as a conflict (not auto-resolved)', () => {
  const snap  = { title: 'A', desc: 'D' };
  const cur   = { title: 'MINE', desc: 'D' };
  const fresh = { title: 'THEIRS', desc: 'D' };
  const { resolved, conflicts } = mergeFields(snap, cur, fresh, SPECS);
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0], { field: 'title', label: 'Title', mine: 'MINE', theirs: 'THEIRS' });
  assert.equal('title' in resolved, false);          // unresolved field is omitted
});

test('recorded resolution choose-mine applies when fresh is stable', () => {
  const snap  = { title: 'A' };
  const cur   = { title: 'MINE' };
  const fresh = { title: 'THEIRS' };
  const resolutions = { title: { choice: 'mine', theirsShown: 'THEIRS' } };
  const { resolved, conflicts } = mergeFields(snap, cur, fresh, [SPECS[0]], resolutions);
  assert.equal(conflicts.length, 0);
  assert.equal(resolved.title, 'MINE');
});

test('recorded resolution choose-theirs applies when fresh is stable', () => {
  const snap  = { title: 'A' };
  const cur   = { title: 'MINE' };
  const fresh = { title: 'THEIRS' };
  const resolutions = { title: { choice: 'theirs', theirsShown: 'THEIRS' } };
  const { resolved, conflicts } = mergeFields(snap, cur, fresh, [SPECS[0]], resolutions);
  assert.equal(conflicts.length, 0);
  assert.equal(resolved.title, 'THEIRS');
});

test('recorded resolution re-prompts when fresh moved again', () => {
  const snap  = { title: 'A' };
  const cur   = { title: 'MINE' };
  const fresh = { title: 'THEIRS_V2' };              // changed since user resolved
  const resolutions = { title: { choice: 'mine', theirsShown: 'THEIRS' } };
  const { conflicts } = mergeFields(snap, cur, fresh, [SPECS[0]], resolutions);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].theirs, 'THEIRS_V2');
});

test('ConflictNeeded carries the conflicts array', () => {
  const e = new ConflictNeeded([{ field: 'x' }]);
  assert.ok(e instanceof Error);
  assert.equal(e.name, 'ConflictNeeded');
  assert.deepEqual(e.conflicts, [{ field: 'x' }]);
});

const ORDER_SPEC = [{ name: 'componentOrder', type: 'orderedUuidList', label: 'Component order' }];
const order = (snap, cur, fresh, resolutions) =>
  mergeFields({ componentOrder: snap }, { componentOrder: cur }, { componentOrder: fresh }, ORDER_SPEC, resolutions);

test('orderedUuidList: you did not reorder → take fresh order (their add wins)', () => {
  const { resolved, conflicts } = order('A,B', 'A,B', 'A,B,C');
  assert.equal(conflicts.length, 0);
  assert.equal(resolved.componentOrder, 'A,B,C');
});

test('orderedUuidList: you did not reorder, they deleted → fresh wins', () => {
  const { resolved, conflicts } = order('A,B,C', 'A,B,C', 'A,C');
  assert.equal(conflicts.length, 0);
  assert.equal(resolved.componentOrder, 'A,C');
});

test('orderedUuidList: only you reordered → your order', () => {
  const { resolved, conflicts } = order('A,B,C', 'C,B,A', 'A,B,C');
  assert.equal(conflicts.length, 0);
  assert.equal(resolved.componentOrder, 'C,B,A');
});

test('orderedUuidList: only you reordered + they added → your order, new slotted at fresh position', () => {
  const { resolved, conflicts } = order('A,B', 'B,A', 'A,B,C');
  assert.equal(conflicts.length, 0);
  assert.equal(resolved.componentOrder, 'B,C,A');
});

test('orderedUuidList: you reordered, they only deleted one of yours → your order minus deleted', () => {
  const { resolved, conflicts } = order('A,B,C', 'C,B,A', 'A,C');
  assert.equal(conflicts.length, 0);
  assert.equal(resolved.componentOrder, 'C,A');
});

test('orderedUuidList: both reordered the same way → no conflict', () => {
  const { resolved, conflicts } = order('A,B,C', 'C,B,A', 'C,B,A');
  assert.equal(conflicts.length, 0);
  assert.equal(resolved.componentOrder, 'C,B,A');
});

test('orderedUuidList: both reordered differently → one conflict with array mine/theirs', () => {
  const { resolved, conflicts } = order('A,B,C', 'B,A,C', 'C,B,A');
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].field, 'componentOrder');
  assert.deepEqual(conflicts[0].theirs, ['C', 'B', 'A']);
  assert.deepEqual(conflicts[0].mine, ['B', 'A', 'C']);
  assert.equal('componentOrder' in resolved, false);
});

test('orderedUuidList: recorded choice mine applies while fresh stable; re-prompts when it moves', () => {
  const stable = order('A,B,C', 'B,A,C', 'C,B,A', { componentOrder: { choice: 'mine', theirsShown: ['C', 'B', 'A'] } });
  assert.equal(stable.conflicts.length, 0);
  assert.equal(stable.resolved.componentOrder, 'B,A,C');
  const moved = order('A,B,C', 'B,A,C', 'C,A,B', { componentOrder: { choice: 'mine', theirsShown: ['C', 'B', 'A'] } });
  assert.equal(moved.conflicts.length, 1);
});

test('orderedUuidList: multiple consecutive new uuids land in fresh-relative order', () => {
  // You reordered A,B → B,A. They inserted X,Y between A and B (fresh A,X,Y,B).
  // X,Y are new; each must follow its fresh-predecessor, preserving X-before-Y.
  const { resolved, conflicts } = order('A,B', 'B,A', 'A,X,Y,B');
  assert.equal(conflicts.length, 0);
  assert.equal(resolved.componentOrder, 'B,A,X,Y');
});

test('orderedUuidList: recorded choice theirs applies while fresh stable', () => {
  const { resolved, conflicts } = order('A,B,C', 'B,A,C', 'C,B,A', { componentOrder: { choice: 'theirs', theirsShown: ['C', 'B', 'A'] } });
  assert.equal(conflicts.length, 0);
  assert.equal(resolved.componentOrder, 'C,B,A');
});

console.log(`\n${passed} passed`);
