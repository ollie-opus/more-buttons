import assert from 'node:assert/strict';
import { applyMetaUpserts, captureMetaPills } from '../scripts/captureMeta.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const P1 = 'docs/assets/occ-captures/a-light-mode.png';
const P2 = 'docs/assets/occ-captures/b-light-mode.png';

// ── applyMetaUpserts ──────────────────────────────────────────────────────────
test('applyMetaUpserts adds a resized+padded entry', () => {
  const out = applyMetaUpserts({}, [{ lightPath: P1, resized: true, padding: 24 }]);
  assert.deepEqual(out, { [P1]: { resized: true, padding: 24 } });
});
test('applyMetaUpserts omits resized when false and padding when 0', () => {
  const out = applyMetaUpserts({}, [{ lightPath: P1, resized: false, padding: 16 }]);
  assert.deepEqual(out, { [P1]: { padding: 16 } });
  const out2 = applyMetaUpserts({}, [{ lightPath: P1, resized: true, padding: 0 }]);
  assert.deepEqual(out2, { [P1]: { resized: true } });
});
test('applyMetaUpserts stores nothing for a plain capture', () => {
  const out = applyMetaUpserts({}, [{ lightPath: P1, resized: false, padding: 0 }]);
  assert.deepEqual(out, {});
});
test('applyMetaUpserts DELETES a stale entry when the new capture is plain', () => {
  const prior = { [P1]: { resized: true, padding: 24 }, [P2]: { padding: 8 } };
  const out = applyMetaUpserts(prior, [{ lightPath: P1, resized: false, padding: 0 }]);
  assert.deepEqual(out, { [P2]: { padding: 8 } });
});
test('applyMetaUpserts overwrites a stale entry with new metadata', () => {
  const prior = { [P1]: { resized: true, padding: 24 } };
  const out = applyMetaUpserts(prior, [{ lightPath: P1, resized: false, padding: 8 }]);
  assert.deepEqual(out, { [P1]: { padding: 8 } });
});
test('applyMetaUpserts does not mutate its input', () => {
  const prior = { [P1]: { resized: true } };
  applyMetaUpserts(prior, [{ lightPath: P1, resized: false, padding: 0 }]);
  assert.deepEqual(prior, { [P1]: { resized: true } });
});
test('applyMetaUpserts applies a batch of mixed upserts', () => {
  const out = applyMetaUpserts({}, [
    { lightPath: P1, resized: true, padding: 0 },
    { lightPath: P2, resized: false, padding: 12 },
  ]);
  assert.deepEqual(out, { [P1]: { resized: true }, [P2]: { padding: 12 } });
});

// ── captureMetaPills ──────────────────────────────────────────────────────────
test('captureMetaPills returns empty string for no/empty meta', () => {
  assert.equal(captureMetaPills(undefined), '');
  assert.equal(captureMetaPills({}), '');
});
test('captureMetaPills renders a resized pill', () => {
  const html = captureMetaPills({ resized: true });
  assert.ok(html.includes('mb-kb-pills'));
  assert.ok(html.includes('mb-kb-pill --resized'));
  assert.ok(html.includes('>Resized<'));
  assert.ok(!html.includes('--padded'));
});
test('captureMetaPills renders a padded pill with the px value', () => {
  const html = captureMetaPills({ padding: 24 });
  assert.ok(html.includes('mb-kb-pill --padded'));
  assert.ok(html.includes('Padded: 24px'));
  assert.ok(!html.includes('--resized'));
});
test('captureMetaPills renders both pills, resized before padded', () => {
  const html = captureMetaPills({ resized: true, padding: 16 });
  assert.ok(html.indexOf('--resized') < html.indexOf('--padded'));
});

console.log(`\n${passed} passed`);
