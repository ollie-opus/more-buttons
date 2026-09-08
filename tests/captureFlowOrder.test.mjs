import assert from 'node:assert/strict';
import { runCaptureTab } from '../scripts/captureFlow.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }
async function atest(name, fn) { await fn(); passed++; console.log('  ok -', name); }

// Fake deps that log every step. The ordering assertions below are the point:
// they pin the capture pipeline order that two real bugs depended on —
//   * sleep AFTER getRect: the rect handler de-promotes GPU layers and the
//     delay lets the re-raster commit (intermittent blank popovers), and the
//     rect handler must run right after the theme flip to pin popovers open;
//   * sampleBg AFTER sleep: sampling at rect time read the pre-flip theme's
//     colours, painting a white padding band on every dark-mode capture.
function makeDeps(log, overrides = {}) {
  return {
    sessionHeld: false,
    attach: async () => { log.push('attach'); },
    detach: async () => { log.push('detach'); },
    resetEmulation: async () => { log.push('resetEmulation'); },
    cmd: async (method) => {
      log.push(method);
      if (method === 'Page.captureScreenshot') return { data: 'AAAA' };
      return {};
    },
    getRect: async () => { log.push('getRect'); return { x: 10, y: 20, width: 300, height: 200 }; },
    sampleBg: async () => { log.push('sampleBg'); },
    getZoom: async () => { log.push('getZoom'); return 1; },
    sleep: async (ms) => { log.push(`sleep(${ms})`); },
    ...overrides,
  };
}

const BASE_MSG = { scale: 2, devicePixelRatio: 2, forcedTheme: 'dark', themeDelay: 500, tight: false, wantBgSample: true };

await atest('forced theme + padding: emulate → rect → sleep → sampleBg → shot', async () => {
  const log = [];
  const res = await runCaptureTab(makeDeps(log), BASE_MSG);
  assert.deepEqual(log, [
    'attach',
    'Emulation.setEmulatedMedia',
    'getRect',
    'sleep(500)',
    'sampleBg',
    'getZoom',
    'Page.captureScreenshot',
    'resetEmulation',
    'detach',
  ]);
  assert.equal(res.dataUrl, 'data:image/png;base64,AAAA');
  assert.ok(res.cropDip);
});

await atest('wantBgSample:false skips the sample round-trip', async () => {
  const log = [];
  await runCaptureTab(makeDeps(log), { ...BASE_MSG, wantBgSample: false });
  assert.ok(!log.includes('sampleBg'));
  assert.ok(log.includes('sleep(500)'), 'themeDelay still honoured');
});

await atest('themeDelay:0 skips the sleep but still samples between rect and shot', async () => {
  const log = [];
  await runCaptureTab(makeDeps(log), { ...BASE_MSG, themeDelay: 0 });
  assert.ok(!log.some(l => l.startsWith('sleep')));
  const rectAt = log.indexOf('getRect');
  const sampleAt = log.indexOf('sampleBg');
  const shotAt = log.indexOf('Page.captureScreenshot');
  assert.ok(rectAt < sampleAt && sampleAt < shotAt);
});

await atest('no forced theme: no sleep; sample still runs when padding is wanted', async () => {
  const log = [];
  await runCaptureTab(makeDeps(log), { ...BASE_MSG, forcedTheme: undefined, themeDelay: 0 });
  assert.ok(!log.some(l => l.startsWith('sleep')));
  assert.ok(log.includes('sampleBg'));
});

await atest('sessionHeld reuses the attach', async () => {
  const log = [];
  await runCaptureTab(makeDeps(log, { sessionHeld: true }), BASE_MSG);
  assert.ok(!log.includes('attach'));
});

await atest('error mid-flow: responds {error}, still resets emulation + detaches', async () => {
  const log = [];
  const deps = makeDeps(log, {
    getRect: async () => { log.push('getRect'); throw new Error('tab gone'); },
  });
  const res = await runCaptureTab(deps, BASE_MSG);
  assert.equal(res.error, 'tab gone');
  assert.ok(!log.includes('sampleBg'), 'no sample after failure');
  assert.ok(log.includes('resetEmulation'));
  assert.ok(log.includes('detach'));
});

console.log(`\n${passed} passed`);
