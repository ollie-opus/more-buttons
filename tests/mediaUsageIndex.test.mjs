import assert from 'node:assert/strict';
import { applyUsageUpsert, parseUsageIndex, serializeUsageIndex } from '../scripts/mediaUsage.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const PAGE = 'docs/pages/alpha.md';
const M1 = 'docs/assets/media/occ-captures/a-light-mode.png';
const M2 = 'docs/assets/media/occ-captures/a-dark-mode.png';
const M3 = 'docs/assets/media/buttons/logo.png';

// ── applyUsageUpsert ──────────────────────────────────────────────────────────
test('applyUsageUpsert adds a page entry with its media list sorted', () => {
  assert.deepEqual(applyUsageUpsert({}, PAGE, [M1, M2]), { [PAGE]: [M2, M1] }); // dark < light
});

test('applyUsageUpsert replaces an entry wholesale (authoritative)', () => {
  const prior = { [PAGE]: [M1, M2] };
  assert.deepEqual(applyUsageUpsert(prior, PAGE, [M3]), { [PAGE]: [M3] });
});

test('applyUsageUpsert deletes the key on an empty media list', () => {
  const prior = { [PAGE]: [M1], 'docs/pages/beta.md': [M3] };
  assert.deepEqual(applyUsageUpsert(prior, PAGE, []), { 'docs/pages/beta.md': [M3] });
});

test('applyUsageUpsert does not mutate its input', () => {
  const prior = { [PAGE]: [M1] };
  applyUsageUpsert(prior, PAGE, []);
  applyUsageUpsert(prior, PAGE, [M3]);
  assert.deepEqual(prior, { [PAGE]: [M1] });
});

// ── parseUsageIndex ───────────────────────────────────────────────────────────
test('parseUsageIndex parses a valid index', () => {
  assert.deepEqual(parseUsageIndex(`{"${PAGE}": ["${M1}"]}`), { [PAGE]: [M1] });
});

test('parseUsageIndex returns {} for empty, garbage, or non-object text', () => {
  assert.deepEqual(parseUsageIndex(''), {});
  assert.deepEqual(parseUsageIndex('not json'), {});
  assert.deepEqual(parseUsageIndex('[1,2]'), {});
  assert.deepEqual(parseUsageIndex('null'), {});
  assert.deepEqual(parseUsageIndex(undefined), {});
});

// ── serializeUsageIndex ───────────────────────────────────────────────────────
test('serializeUsageIndex sorts keys and media lists, ends with a newline', () => {
  const a = serializeUsageIndex({ 'docs/pages/z.md': [M2, M1], 'docs/pages/a.md': [M3] });
  const b = serializeUsageIndex({ 'docs/pages/a.md': [M3], 'docs/pages/z.md': [M1, M2] });
  assert.equal(a, b); // deterministic regardless of insertion/list order
  assert.ok(a.endsWith('\n'));
  assert.ok(a.indexOf('docs/pages/a.md') < a.indexOf('docs/pages/z.md'));
});

test('serializeUsageIndex round-trips through parseUsageIndex byte-identically', () => {
  const idx = { [PAGE]: [M1, M2], 'docs/drafts/beta.md': [M3] };
  const text = serializeUsageIndex(idx);
  assert.equal(serializeUsageIndex(parseUsageIndex(text)), text);
});

console.log(`\n${passed} passed`);
