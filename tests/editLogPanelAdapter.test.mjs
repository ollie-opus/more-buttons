import assert from 'node:assert/strict';
import { makeFetchPage } from '../scripts/editLogPanel.js';

const calls = [];
const fp = makeFetchPage(async (path, opts) => { calls.push([path, opts]); return []; });
await fp('a.md', 2);
assert.deepEqual(calls, [['a.md', { page: 2 }]]);
console.log('editLogPanelAdapter: 1 passed');
