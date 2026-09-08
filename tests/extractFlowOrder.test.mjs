import assert from 'node:assert/strict';
import { runExtractTheme } from '../scripts/extractFlow.js';

let passed = 0;
async function atest(name, fn) { await fn(); passed++; console.log('  ok -', name); }

// Fake deps that log every step. The ordering assertion is the point: the
// sleep must land AFTER the media flip and BEFORE the serialize round trip,
// or the content script bakes the pre-flip theme's computed colours into the
// SVG (the extract-mode twin of the screenshot pipeline's settle bug).
function makeDeps(log, overrides = {}) {
  return {
    sessionHeld: false,
    attach: async () => { log.push('attach'); },
    detach: async () => { log.push('detach'); },
    resetEmulation: async () => { log.push('resetEmulation'); },
    cmd: async (method, params) => { log.push(method); return { params }; },
    serialize: async () => { log.push('serialize'); return {}; },
    sleep: async (ms) => { log.push(`sleep(${ms})`); },
    ...overrides,
  };
}

const BASE_MSG = { forcedTheme: 'dark', themeDelay: 500 };

await atest('forced theme: attach → emulate → sleep → serialize → reset → detach', async () => {
  const log = [];
  const res = await runExtractTheme(makeDeps(log), BASE_MSG);
  assert.deepEqual(log, [
    'attach',
    'Emulation.setEmulatedMedia',
    'sleep(500)',
    'serialize',
    'resetEmulation',
    'detach',
  ]);
  assert.deepEqual(res, {});
});

await atest('the emulated features carry the forced theme', async () => {
  let captured = null;
  const deps = makeDeps([], {
    cmd: async (method, params) => { captured = params; return {}; },
  });
  await runExtractTheme(deps, BASE_MSG);
  assert.deepEqual(captured.features, [
    { name: 'prefers-reduced-motion', value: 'reduce' },
    { name: 'prefers-color-scheme', value: 'dark' },
  ]);
});

await atest('themeDelay:0 skips the sleep but keeps the order', async () => {
  const log = [];
  await runExtractTheme(makeDeps(log), { ...BASE_MSG, themeDelay: 0 });
  assert.ok(!log.some(l => l.startsWith('sleep')));
  assert.ok(log.indexOf('Emulation.setEmulatedMedia') < log.indexOf('serialize'));
});

await atest('sessionHeld reuses the attach', async () => {
  const log = [];
  await runExtractTheme(makeDeps(log, { sessionHeld: true }), BASE_MSG);
  assert.ok(!log.includes('attach'));
  assert.ok(log.includes('serialize'));
});

await atest('serialize {error}: responds {error}, still resets emulation + detaches', async () => {
  const log = [];
  const deps = makeDeps(log, {
    serialize: async () => { log.push('serialize'); return { error: 'svg gone' }; },
  });
  const res = await runExtractTheme(deps, BASE_MSG);
  assert.equal(res.error, 'svg gone');
  assert.ok(log.includes('resetEmulation'));
  assert.ok(log.includes('detach'));
});

await atest('cmd throw: responds {error}, still resets emulation + detaches', async () => {
  const log = [];
  const deps = makeDeps(log, {
    cmd: async () => { throw new Error('tab gone'); },
  });
  const res = await runExtractTheme(deps, BASE_MSG);
  assert.equal(res.error, 'tab gone');
  assert.ok(!log.includes('serialize'), 'no serialize after failure');
  assert.ok(log.includes('resetEmulation'));
  assert.ok(log.includes('detach'));
});

console.log(`\n${passed} passed`);
