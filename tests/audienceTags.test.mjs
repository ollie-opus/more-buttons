import assert from 'node:assert/strict';
import {
  AUDIENCES, AUDIENCE_TAG_NAMES, isAudienceTag, splitAudience, composeTags, withoutAudienceTags,
} from '../scripts/audienceTags.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

test('AUDIENCES: three ordered entries with the OCC tag names', () => {
  assert.deepEqual(AUDIENCES.map(a => a.value), ['users', 'managers', 'admins']);
  assert.deepEqual(AUDIENCE_TAG_NAMES, ['Using OCC', 'Managing OCC', 'Administering OCC']);
});

test('isAudienceTag: case-insensitive, trims', () => {
  assert.equal(isAudienceTag('Using OCC'), true);
  assert.equal(isAudienceTag('  managing occ '), true);
  assert.equal(isAudienceTag('System'), false);
  assert.equal(isAudienceTag(''), false);
  assert.equal(isAudienceTag(null), false);
});

test('splitAudience: no audience tag → none, all tags kept', () => {
  assert.deepEqual(splitAudience(['System', 'RAMS']), { audience: 'none', rest: ['System', 'RAMS'] });
  assert.deepEqual(splitAudience([]), { audience: 'none', rest: [] });
  assert.deepEqual(splitAudience(undefined), { audience: 'none', rest: [] });
});

test('splitAudience: one audience tag anywhere in the list', () => {
  assert.deepEqual(splitAudience(['System', 'Managing OCC', 'RAMS']),
    { audience: 'managers', rest: ['System', 'RAMS'] });
  assert.deepEqual(splitAudience(['administering occ']), { audience: 'admins', rest: [] });
});

test('splitAudience: legacy page with several audience tags → first in AUDIENCES order wins, ALL removed from rest', () => {
  assert.deepEqual(splitAudience(['Administering OCC', 'Using OCC', 'X']),
    { audience: 'users', rest: ['X'] });
});

test('composeTags: audience tag goes first, rest follows, deduped case-insensitively', () => {
  assert.deepEqual(composeTags('managers', ['System', 'RAMS']), ['Managing OCC', 'System', 'RAMS']);
  assert.deepEqual(composeTags('none', ['System']), ['System']);
  assert.deepEqual(composeTags('', ['System']), ['System']);
  assert.deepEqual(composeTags(undefined, ['System']), ['System']);
  assert.deepEqual(composeTags('users', []), ['Using OCC']);
});

test('composeTags: a stray audience tag in rest is dropped (radios are the only source)', () => {
  assert.deepEqual(composeTags('users', ['Managing OCC', 'System', ' using occ ']), ['Using OCC', 'System']);
  assert.deepEqual(composeTags('none', ['Managing OCC', 'System']), ['System']);
});

test('withoutAudienceTags: filters the three names, keeps order and spelling', () => {
  assert.deepEqual(withoutAudienceTags(['System', 'Managing OCC', 'RAMS', 'using occ']), ['System', 'RAMS']);
  assert.deepEqual(withoutAudienceTags([]), []);
});

console.log(`\n${passed} passed`);
