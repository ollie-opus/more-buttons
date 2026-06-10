import assert from 'node:assert/strict';
import { registerComponentContainer, containerExists } from '../scripts/componentContainers.js';
import { readTabComponents, tabContainerExists } from '../scripts/components.js';
import { locateSectionByUUID } from '../scripts/sections.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const span = (uuid, indent = '') => `${indent}<span data-uuid="${uuid}" style="display:none"></span>`;

// A two-tab group: T1 has content, T2 exists but is EMPTY (identity span only).
const TABS_MD = [
  span('GRP'),
  '=== "One"',
  '',
  span('T1', '    '),
  '    First tab text.',
  '',
  '=== "Two"',
  '',
  span('T2', '    '),
].join('\n');

// SEC-1 has body content, SEC-2 exists but is EMPTY (identity span only).
const SECTIONS_MD = [
  '## Alpha',
  '',
  span('SEC-1'),
  '',
  'Body text.',
  '',
  '## Empty',
  '',
  span('SEC-2'),
].join('\n');

// ── tabContainerExists (the 'content-tab' exists handler) ────────────────────

test('tabContainerExists: true for a present tab', () => {
  assert.equal(tabContainerExists(TABS_MD, 'T1'), true);
});

test('tabContainerExists: false for a vanished tab', () => {
  assert.equal(tabContainerExists(TABS_MD, 'NOPE'), false);
});

test('tabContainerExists: true for an exists-but-EMPTY tab (readTabComponents cannot tell)', () => {
  // The read helper returns the same empty shape for both cases…
  assert.deepEqual(readTabComponents(TABS_MD, 'T2'), { description: '', components: [] });
  assert.deepEqual(readTabComponents(TABS_MD, 'NOPE'), { description: '', components: [] });
  // …exists() is the disambiguator: empty ≠ gone.
  assert.equal(tabContainerExists(TABS_MD, 'T2'), true);
});

// ── containerExists registry dispatch ─────────────────────────────────────────
// Register the kinds with the same exists handlers production wires up
// (contentTabsEditor.js / guides.js — those modules are DOM-coupled, so the
// wiring is mirrored here).

registerComponentContainer('content-tab', { exists: tabContainerExists });
registerComponentContainer('guide-section', { exists: (md, uuid) => !!locateSectionByUUID(md, uuid) });

test('containerExists: dispatches by kind — present tab is found', () => {
  assert.equal(containerExists(TABS_MD, { kind: 'content-tab', uuid: 'T1' }), true);
});

test('containerExists: vanished container reports false', () => {
  assert.equal(containerExists(TABS_MD, { kind: 'content-tab', uuid: 'NOPE' }), false);
});

test('containerExists: empty-but-present container still exists (inserts must work)', () => {
  assert.equal(containerExists(TABS_MD, { kind: 'content-tab', uuid: 'T2' }), true);
  assert.equal(containerExists(SECTIONS_MD, { kind: 'guide-section', uuid: 'SEC-2' }), true);
});

test('containerExists: guide-section found vs vanished', () => {
  assert.equal(containerExists(SECTIONS_MD, { kind: 'guide-section', uuid: 'SEC-1' }), true);
  assert.equal(containerExists(SECTIONS_MD, { kind: 'guide-section', uuid: 'GONE' }), false);
});

test('containerExists: unregistered kind reports false', () => {
  assert.equal(containerExists(TABS_MD, { kind: 'no-such-kind', uuid: 'T1' }), false);
});

console.log(`\n${passed} passed`);
