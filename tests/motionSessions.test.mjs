import assert from 'node:assert/strict';
import { createMotionSessionRegistry } from '../scripts/motionSessions.js';

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('  ok -', name); }

const fakeStorage = (seed = {}) => {
  const data = { ...seed };
  return {
    data,
    get: async key => (key in data ? { [key]: data[key] } : {}),
    set: async items => { Object.assign(data, items); },
  };
};

await test('hydrates the set from storage on ready', async () => {
  const store = fakeStorage({ mbMotionSessions: [7, 9] });
  const reg = createMotionSessionRegistry(store);
  await reg.ready;
  assert.equal(reg.has(7), true);
  assert.equal(reg.has(9), true);
  assert.equal(reg.has(8), false);
  assert.deepEqual(reg.all().sort(), [7, 9]);
});

await test('add/remove persist to storage', async () => {
  const store = fakeStorage();
  const reg = createMotionSessionRegistry(store);
  await reg.ready;
  reg.add(3);
  await Promise.resolve(); // let the fire-and-forget persist settle
  assert.deepEqual(store.data.mbMotionSessions, [3]);
  reg.remove(3);
  await Promise.resolve();
  assert.deepEqual(store.data.mbMotionSessions, []);
  assert.equal(reg.has(3), false);
});

await test('remove of an unknown tab does not touch storage', async () => {
  const store = fakeStorage();
  const reg = createMotionSessionRegistry(store);
  await reg.ready;
  reg.remove(99);
  await Promise.resolve();
  assert.equal('mbMotionSessions' in store.data, false);
});

await test('a second instance sees state persisted by the first (SW restart)', async () => {
  const store = fakeStorage();
  const first = createMotionSessionRegistry(store);
  await first.ready;
  first.add(42);
  await Promise.resolve();
  const second = createMotionSessionRegistry(store);
  await second.ready;
  assert.equal(second.has(42), true); // release after a SW restart still works
  second.remove(42);
  await Promise.resolve();
  assert.deepEqual(store.data.mbMotionSessions, []);
});

console.log(`motionSessions: ${passed} passed`);
