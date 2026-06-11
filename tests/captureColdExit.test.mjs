import assert from 'node:assert/strict';

// captureMode.js touches window.sessionStorage at call time only, but import
// is side-effect free — a minimal window stub is enough to load the module.
globalThis.window = {
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
};
const { planColdExit } = await import('../scripts/captureMode.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const INTENT = {
  action: 'completeComponentCaptureInsert',
  container: { kind: 'guide-admonition', uuid: 'ADM-1', file: 'docs/guide.md' },
  insertAt: 2,
};
const SNAPSHOT = [{ name: 'openEditGuideAdmonition', args: { uuid: 'ADM-1' }, label: 'Step 1', formName: 'guideAdmonition' }];
const BUFFER = [{ lightDataUrl: 'data:image/png;base64,AAA', darkDataUrl: 'data:image/png;base64,BBB' }];

// ── The cold-commit case the bug report hit ───────────────────────────────────

test('cold Done with intent + buffer dispatches the intent action', () => {
  const plan = planColdExit({
    cancelled: false,
    hasLiveReturnTo: false,
    intent: INTENT,
    formStackSnapshot: SNAPSHOT,
    sessionBuffer: BUFFER,
  });
  assert.ok(plan, 'expected a dispatch plan, got null');
  assert.equal(plan.action, 'completeComponentCaptureInsert');
  assert.deepEqual(plan.payload, { intent: INTENT, formStackSnapshot: SNAPSHOT, sessionBuffer: BUFFER });
});

// ── Paths that must stay closure-owned or do nothing ─────────────────────────

test('live returnTo owns the exit — no cold dispatch even with an intent', () => {
  const plan = planColdExit({
    cancelled: false,
    hasLiveReturnTo: true,
    intent: INTENT,
    formStackSnapshot: SNAPSHOT,
    sessionBuffer: BUFFER,
  });
  assert.equal(plan, null);
});

test('cold cancel (✕ / Esc after a hard nav) discards — no dispatch', () => {
  const plan = planColdExit({
    cancelled: true,
    hasLiveReturnTo: false,
    intent: INTENT,
    formStackSnapshot: SNAPSHOT,
    sessionBuffer: BUFFER,
  });
  assert.equal(plan, null);
});

test('cold Done with an empty buffer — nothing to commit, no dispatch', () => {
  const plan = planColdExit({
    cancelled: false,
    hasLiveReturnTo: false,
    intent: INTENT,
    formStackSnapshot: SNAPSHOT,
    sessionBuffer: [],
  });
  assert.equal(plan, null);
});

test('cold Done with no recorded intent (legacy / standalone session) — no dispatch', () => {
  const plan = planColdExit({
    cancelled: false,
    hasLiveReturnTo: false,
    intent: null,
    formStackSnapshot: SNAPSHOT,
    sessionBuffer: BUFFER,
  });
  assert.equal(plan, null);
});

test('intent without an action name is inert', () => {
  const plan = planColdExit({
    cancelled: false,
    hasLiveReturnTo: false,
    intent: { container: INTENT.container, insertAt: 0 },
    formStackSnapshot: SNAPSHOT,
    sessionBuffer: BUFFER,
  });
  assert.equal(plan, null);
});

console.log(`\n${passed} passed`);
