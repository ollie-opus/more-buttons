import assert from 'node:assert/strict';
import { applyMetaUpserts, captureMetaPills, captureFlagSuffix, appendCaptureSuffix, captureBaseSlug } from '../scripts/captureMeta.js';
import { dimensionsChanged, slugifyLabel } from '../scripts/captureElement.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const P1 = 'docs/assets/media/occ-captures/a-light-mode.png';
const P2 = 'docs/assets/media/occ-captures/b-light-mode.png';

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
test('applyMetaUpserts stores annotated and zapped flags', () => {
  const out = applyMetaUpserts({}, [{ lightPath: P1, annotated: true, zapped: true }]);
  assert.deepEqual(out, { [P1]: { annotated: true, zapped: true } });
});
test('applyMetaUpserts DELETES a stale annotated/zapped entry on a plain recapture', () => {
  const prior = { [P1]: { annotated: true, zapped: true } };
  const out = applyMetaUpserts(prior, [{ lightPath: P1, resized: false, padding: 0, annotated: false, zapped: false }]);
  assert.deepEqual(out, {});
});

// ── captureFlagSuffix / appendCaptureSuffix ───────────────────────────────────
test('captureFlagSuffix covers all four combinations', () => {
  assert.equal(captureFlagSuffix(false, false), '');
  assert.equal(captureFlagSuffix(true, false), '-a');
  assert.equal(captureFlagSuffix(false, true), '-z');
  assert.equal(captureFlagSuffix(true, true), '-a-z');
});
test('appendCaptureSuffix inserts before the light/dark theme tail', () => {
  assert.equal(
    appendCaptureSuffix('media/occ-captures/foo/bar-light-mode.png', '-a-z'),
    'media/occ-captures/foo/bar-a-z-light-mode.png',
  );
  assert.equal(
    appendCaptureSuffix('media/occ-captures/foo/bar-dark-mode.png', '-z'),
    'media/occ-captures/foo/bar-z-dark-mode.png',
  );
});
test('appendCaptureSuffix is a no-op for an empty suffix or non-capture name', () => {
  assert.equal(appendCaptureSuffix('media/occ-captures/foo-light-mode.png', ''), 'media/occ-captures/foo-light-mode.png');
  assert.equal(appendCaptureSuffix('media/docs/diagram.svg', '-a'), 'media/docs/diagram.svg');
});
test('appendCaptureSuffix splices a named suffix before the terminal tail only', () => {
  assert.equal(
    appendCaptureSuffix('media/occ-captures/foo/bar-light-mode.png', '-a-time-clock-z'),
    'media/occ-captures/foo/bar-a-time-clock-z-light-mode.png',
  );
  // annotation slug ending in "light-mode" must not confuse the $-anchored tail regex
  assert.equal(
    appendCaptureSuffix('media/occ-captures/foo/bar-light-mode.png', '-a-light-mode'),
    'media/occ-captures/foo/bar-a-light-mode-light-mode.png',
  );
});

// ── captureFlagSuffix with annotation names ───────────────────────────────────
test('captureFlagSuffix appends annotation names after -a', () => {
  assert.equal(captureFlagSuffix(true, false, ['time', 'clock']), '-a-time-clock');
});
test('captureFlagSuffix keeps -z terminal after annotation names', () => {
  assert.equal(captureFlagSuffix(true, true, ['time']), '-a-time-z');
});
test('captureFlagSuffix caps annotation names at 3', () => {
  assert.equal(captureFlagSuffix(true, false, ['one', 'two', 'three', 'four']), '-a-one-two-three');
});
test('captureFlagSuffix dedupes names against the base slug', () => {
  assert.equal(captureFlagSuffix(true, false, ['system', 'time'], 'system'), '-a-time');
});
test('captureFlagSuffix dedupes among names; dupes do not consume cap slots', () => {
  assert.equal(captureFlagSuffix(true, false, ['x', 'x', 'y', 'z', 'w']), '-a-x-y-z');
});
test('captureFlagSuffix skips empty names without consuming slots', () => {
  assert.equal(captureFlagSuffix(true, false, ['', 'time']), '-a-time');
  assert.equal(captureFlagSuffix(true, false, ['', '', '']), '-a');
});
test('captureFlagSuffix ignores names when not annotated', () => {
  assert.equal(captureFlagSuffix(false, true, ['time']), '-z');
  assert.equal(captureFlagSuffix(false, false, ['time']), '');
});

// ── captureBaseSlug ───────────────────────────────────────────────────────────
test('captureBaseSlug extracts the base from a light path', () => {
  assert.equal(captureBaseSlug('media/occ-captures/foo/system-light-mode.png'), 'system');
});
test('captureBaseSlug extracts the base from a dark path', () => {
  assert.equal(captureBaseSlug('media/occ-captures/foo/nav-bar-dark-mode.png'), 'nav-bar');
});
test('captureBaseSlug returns empty for a non-capture name', () => {
  assert.equal(captureBaseSlug('media/docs/diagram.svg'), '');
  assert.equal(captureBaseSlug(''), '');
});

// ── slugifyLabel ──────────────────────────────────────────────────────────────
test('slugifyLabel lowercases and collapses punctuation runs to single hyphens', () => {
  assert.equal(slugifyLabel('System Status!'), 'system-status');
  assert.equal(slugifyLabel('Time  &  Date'), 'time-date');
});
test('slugifyLabel trims edge hyphens', () => {
  assert.equal(slugifyLabel('  (Time) '), 'time');
  assert.equal(slugifyLabel('!!!'), '');
});
test('slugifyLabel slices to 50 chars and tolerates null/empty', () => {
  assert.equal(slugifyLabel('x'.repeat(80)).length, 50);
  assert.equal(slugifyLabel(null), '');
  assert.equal(slugifyLabel(''), '');
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
test('captureMetaPills renders the grey format pill last, even without meta', () => {
  const bare = captureMetaPills(undefined, 'svg');
  assert.ok(bare.includes('mb-kb-pill --format'));
  assert.ok(bare.includes('>.svg<'));
  const both = captureMetaPills({ resized: true }, 'png');
  assert.ok(both.indexOf('--resized') < both.indexOf('--format'));
  assert.ok(both.includes('>.png<'));
});
test('captureMetaPills renders an annotated pill', () => {
  const html = captureMetaPills({ annotated: true });
  assert.ok(html.includes('mb-kb-pill --annotated'));
  assert.ok(html.includes('>Annotated<'));
  assert.ok(!html.includes('--zapped'));
});
test('captureMetaPills renders a zapped pill', () => {
  const html = captureMetaPills({ zapped: true });
  assert.ok(html.includes('mb-kb-pill --zapped'));
  assert.ok(html.includes('>Zapped<'));
  assert.ok(!html.includes('--annotated'));
});
test('captureMetaPills orders resized, padded, annotated, zapped, format', () => {
  const html = captureMetaPills({ resized: true, padding: 8, annotated: true, zapped: true }, 'png');
  const order = ['--resized', '--padded', '--annotated', '--zapped', '--format'].map(c => html.indexOf(c));
  assert.ok(order.every(i => i >= 0));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

// ── dimensionsChanged ─────────────────────────────────────────────────────────
test('dimensionsChanged is false when width and height are unchanged', () => {
  assert.equal(dimensionsChanged({ width: 100, height: 50 }, { width: 100, height: 50 }), false);
});
test('dimensionsChanged ignores sub-pixel jitter (rounds)', () => {
  assert.equal(dimensionsChanged({ width: 100.2, height: 50.4 }, { width: 100.1, height: 49.6 }), false);
});
test('dimensionsChanged is true when width changes', () => {
  assert.equal(dimensionsChanged({ width: 100, height: 50 }, { width: 140, height: 50 }), true);
});
test('dimensionsChanged is true when height changes', () => {
  assert.equal(dimensionsChanged({ width: 100, height: 50 }, { width: 100, height: 80 }), true);
});
test('dimensionsChanged ignores position-only differences', () => {
  // box carries top/left too, but only size counts
  assert.equal(dimensionsChanged({ width: 100, height: 50 }, { width: 100, height: 50, top: 999, left: 7 }), false);
});

console.log(`\n${passed} passed`);
