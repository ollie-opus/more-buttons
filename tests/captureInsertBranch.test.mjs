import assert from 'node:assert/strict';
import { chooseInsertBranch, buildCaptureLines } from '../scripts/captures.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// ── Branch decision: which review form opens after a component capture ──────

test('both theme files exist → library branch', () => {
  assert.equal(chooseInsertBranch(true, true), 'library');
});

test('half pairs and missing pairs → new branch', () => {
  assert.equal(chooseInsertBranch(true, false), 'new');
  assert.equal(chooseInsertBranch(false, true), 'new');
  assert.equal(chooseInsertBranch(false, false), 'new');
});

// ── Size values chosen on the review forms ride the capture object into the
//    committed markdown — pin all three dimMode variants. ────────────────────

const CAP = {
  lightFilename: 'media/occ-captures/p/a-light-mode.png',
  darkFilename: 'media/occ-captures/p/a-dark-mode.png',
  uuid: 'U1',
};

test('height dim renders the style attr on both theme lines', () => {
  const lines = buildCaptureLines([{ ...CAP, dimMode: 'height', dimValue: 64 }]);
  assert.ok(lines.some(l => l.includes('#only-light){ style="height: 64px" loading=lazy }')));
  assert.ok(lines.some(l => l.includes('#only-dark){ style="height: 64px" loading=lazy }')));
});

test('width dim renders the width attr', () => {
  const lines = buildCaptureLines([{ ...CAP, dimMode: 'width', dimValue: 120 }]);
  assert.ok(lines.some(l => l.includes('{ width="120" loading=lazy }')));
});

test('auto renders bare image lines (no dim attrs)', () => {
  const lines = buildCaptureLines([{ ...CAP, dimMode: 'none', dimValue: null }]);
  assert.ok(lines.some(l => l.endsWith('#only-light)')));
  assert.ok(lines.every(l => !l.includes('loading=lazy')));
});

console.log(`\n${passed} passed`);
