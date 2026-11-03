import assert from 'node:assert/strict';
import { makeFetchPage, mergeRecentCommits, detailCacheable } from '../scripts/editLogPanel.js';
import { createThread, openThread, threadView } from '../scripts/editLog.js';
let passed = 0; async function test(name, fn) { await fn(); passed++; }

await test('makeFetchPage forwards page and perPage', async () => {
  const calls = [];
  const fp = makeFetchPage(async (path, opts) => { calls.push([path, opts]); return []; });
  await fp('a.md', 2, 100);
  await fp('b.md', 1, 30);
  assert.deepEqual(calls, [['a.md', { page: 2, perPage: 100 }], ['b.md', { page: 1, perPage: 30 }]]);
});

await test('item thread asks for 100-commit pages through the adapter; guide thread for 30', async () => {
  const calls = [];
  const fp = makeFetchPage(async (path, opts) => { calls.push(opts.perPage); return []; });
  await openThread(createThread({ paths: ['a'], itemUuid: 'U' }), { fetchPage: fp });
  await openThread(createThread({ paths: ['a'] }), { fetchPage: fp });
  assert.deepEqual(calls, [100, 30]);
});

const mk = (sha, path, date, over = {}) => ({ sha, parentSha: 'p', path, subject: 'Edit', body: '', trailers: {}, date, login: null, name: 'N', own: false, ...over });

await test('mergeRecentCommits surfaces a just-made save and is idempotent', async () => {
  const t = createThread({ paths: ['d', 'l'] });
  await openThread(t, { fetchPage: async (p) => p === 'd' ? [mk('a', 'd', 100), mk('b', 'd', 50)] : [] });
  assert.equal(t.shown, 2);
  const memo = { d: [mk('new', 'd', 200, { own: true, subject: 'Reordered sections' })], l: [] };
  assert.equal(mergeRecentCommits(t, p => memo[p]), 1);
  assert.equal(t.shown, 3);
  assert.equal(threadView(t, { now: 200 }).items.filter(i => i.type === 'bubble')[0].sha, 'new');
  assert.equal(mergeRecentCommits(t, p => memo[p]), 0);
  assert.equal(t.shown, 3);
});

await test('detailCacheable: an empty own-sha read with a parent is not cached; created file and normal reads are', () => {
  assert.equal(detailCacheable('p1', ''), false);
  assert.equal(detailCacheable('p1', 'text'), true);
  assert.equal(detailCacheable('', ''), true);
  assert.equal(detailCacheable(null, 'x'), true);
});

console.log(`editLogPanelAdapter: ${passed} passed`);
