import assert from 'node:assert/strict';
import { captureTabLabel, captureMenuItem, captureTabChoices, captureTabPick, deliveredCaptureComponent } from '../scripts/kbCaptureTabs.js';

globalThis.window = { sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } };
const { planColdExit } = await import('../scripts/captureMode.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const TABS = [
  { id: 11, title: 'Sites · Opus', url: 'https://cloud.opus-safety.co.uk/admin/sites' },
  { id: 12, title: '', url: 'https://cloud.opus-safety.co.uk/admin/users/4' },
];

test('a tab is named by its title, else its path', () => {
  assert.equal(captureTabLabel(TABS[0]), 'Sites · Opus');
  assert.equal(captureTabLabel(TABS[1]), '/admin/users/4');
  assert.equal(captureTabLabel({ id: 1, title: ' ', url: 'https://cloud.opus-safety.co.uk/' }), 'Opus webapp');
});

test('the tab choices: new, last, then the open tabs', () => {
  const c = captureTabChoices(TABS, false);
  assert.deepEqual(c.map(x => x.label), ['Open a new tab', 'Reopen last tab', 'Sites · Opus', '/admin/users/4']);
  assert.equal(c[1].disabled, true);
  assert.equal(captureTabChoices(TABS, true)[1].disabled, undefined);
  assert.deepEqual(captureTabPick(c[2].id), { tabId: 11 });
  assert.deepEqual(captureTabPick(c[0].id), { tabId: null });
});

test('a long title is cut to fit the menu', () => {
  const label = captureTabLabel({ id: 1, title: 'x'.repeat(90) });
  assert.equal(label.length, 48);
  assert.ok(label.endsWith('…'));
});

test('Capture holds "Create a new capture" (new tab, rule, open tabs) and the library', () => {
  const item = captureMenuItem(TABS);
  assert.equal(item.label, 'Capture');
  const [create, library] = item.submenu;
  assert.equal(create.label, 'Create a new capture');
  assert.deepEqual(create.submenu, [
    { id: 'capture-tab:new', label: 'Open a new tab' },
    { id: 'capture-tab:last', label: 'Reopen last tab', disabled: true },
    { divider: true },
    { id: 'capture-tab:11', label: 'Sites · Opus' },
    { id: 'capture-tab:12', label: '/admin/users/4' },
  ]);
  assert.deepEqual(library, { id: 'capture', label: 'Add from library' });
});

test('with no webapp tab open there are only the two new-tab rows, and no rule', () => {
  const rows = [{ id: 'capture-tab:new', label: 'Open a new tab' }, { id: 'capture-tab:last', label: 'Reopen last tab', disabled: true }];
  assert.deepEqual(captureMenuItem([]).submenu[0].submenu, rows);
  assert.deepEqual(captureMenuItem().submenu[0].submenu, rows);
});

test('"Reopen last tab" stands under "Open a new tab", enabled once there is a last capture', () => {
  assert.deepEqual(captureMenuItem(TABS, true).submenu[0].submenu.slice(0, 3), [
    { id: 'capture-tab:new', label: 'Open a new tab' },
    { id: 'capture-tab:last', label: 'Reopen last tab' },
    { divider: true },
  ]);
  assert.deepEqual(captureMenuItem([], true).submenu[0].submenu.map(i => i.id), ['capture-tab:new', 'capture-tab:last']);
});

test('every tab row picks its own tab; other ids are not capture picks', () => {
  assert.deepEqual(captureTabPick('capture-tab:new'), { tabId: null });
  assert.deepEqual(captureTabPick('capture-tab:last'), { tabId: null, reopen: true });
  assert.deepEqual(captureTabPick('capture-tab:12'), { tabId: 12 });
  assert.equal(captureTabPick('capture'), null);
  assert.equal(captureTabPick('capture-tab:abc'), null);
  assert.equal(captureTabPick(undefined), null);
});

test('a handed-back button capture is 50px tall with square corners', () => {
  assert.deepEqual(deliveredCaptureComponent({
    lightFilename: 'media/occ-captures/sites/add-light-mode.png',
    darkFilename: 'media/occ-captures/sites/add-dark-mode.png',
    preset: 'button',
  }, 'U-1'), {
    kind: 'capture',
    cap: {
      uuid: 'U-1',
      lightFilename: 'media/occ-captures/sites/add-light-mode.png',
      darkFilename: 'media/occ-captures/sites/add-dark-mode.png',
      dimMode: 'height', dimValue: 50, rounded: false, inversed: false,
    },
  });
});

test('any other capture arrives auto-sized and rounded; the dark name is derived', () => {
  for (const preset of ['auto', undefined, 'nonsense']) {
    const c = deliveredCaptureComponent({ lightFilename: 'docs/assets/media/occ-captures/a-light-mode.png', preset }, 'U-2').cap;
    assert.equal(c.lightFilename, 'media/occ-captures/a-light-mode.png');
    assert.equal(c.darkFilename, 'media/occ-captures/a-dark-mode.png');
    assert.deepEqual([c.dimMode, c.dimValue, c.rounded, c.inversed], ['none', null, true, false]);
  }
  assert.equal(deliveredCaptureComponent({}, 'U'), null);
  assert.equal(deliveredCaptureComponent(null, 'U'), null);
});

// ── Cold exits of a Knowledge Base capture (captureMode.planColdExit) ────────

const INTENT = { action: 'completeKbSiteCapture', cancelAction: 'cancelKbSiteCapture', kb: { tabId: 7, token: 'T' } };

test('a cold ✕ / Esc goes back to the Knowledge Base tab', () => {
  assert.deepEqual(
    planColdExit({ cancelled: true, hasLiveReturnTo: false, intent: INTENT, formStackSnapshot: null, sessionBuffer: [] }),
    { action: 'cancelKbSiteCapture', payload: { intent: INTENT } },
  );
});

test('a cold Done delivers the buffer; a live returnTo still owns its own exit', () => {
  const buffer = [{ lightDataUrl: 'data:,' }];
  assert.equal(planColdExit({ cancelled: false, hasLiveReturnTo: false, intent: INTENT, formStackSnapshot: null, sessionBuffer: buffer }).action, 'completeKbSiteCapture');
  assert.equal(planColdExit({ cancelled: true, hasLiveReturnTo: true, intent: INTENT, sessionBuffer: [] }), null);
});

test('a cancel with no cancelAction (a form\'s own capture) still does nothing', () => {
  assert.equal(planColdExit({ cancelled: true, hasLiveReturnTo: false, intent: { action: 'completeComponentCaptureInsert' }, sessionBuffer: [{}] }), null);
});

console.log(`kbCaptureTabs: ${passed} passed`);
