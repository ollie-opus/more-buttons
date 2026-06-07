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

console.log(`\n${passed} passed`);
