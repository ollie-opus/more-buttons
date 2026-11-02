import assert from 'node:assert/strict';
import {
  PAGE_SIZE, RULE_COLLAPSE_MS, createThread, addCommits, allExhausted, frontier, renderableCommits,
  fetchUntil, classifyCommit, collapseRules, logicalItems, addDayDividers, openThread, revealHistory,
  showMore, threadView,
} from '../scripts/editLog.js';
let passed = 0; async function test(name, fn) { await fn(); passed++; console.log('  ok -', name); }

const mk = (sha, path, subject, date, over = {}) => ({
  sha, parentSha: null, path, subject, body: '', trailers: {}, date, login: null, name: 'N', own: false, ...over,
});
const T0 = Date.UTC(2026, 10, 2, 12, 0, 0);
const MIN = 60000;
// n plain commits for a path, newest first, starting `startAgo` minutes before T0.
const run = (path, n, startAgo = 0, tag = path) =>
  Array.from({ length: n }, (_, i) => mk(`${tag}-${startAgo + i}`, path, `Edit ${tag} ${i}`, T0 - (startAgo + i) * MIN));
const pager = (pages, calls = []) => async (path, page) => { calls.push([path, page]); return pages[path]?.[page - 1] ?? []; };
const chunk = (arr) => { const out = []; for (let i = 0; i < arr.length; i += PAGE_SIZE) out.push(arr.slice(i, i + PAGE_SIZE)); return out; };

await test('constants', () => { assert.equal(PAGE_SIZE, 30); assert.equal(RULE_COLLAPSE_MS, 120000); });

await test('addCommits: dedupes by sha, sorts newest first, item filter keeps only Item: <uuid> commits', () => {
  const t = createThread({ paths: ['a'] });
  addCommits(t, [mk('s1', 'a', 'x', 100), mk('s2', 'a', 'y', 300), mk('s1', 'a', 'dup', 999)]);
  addCommits(t, [mk('s3', 'a', 'z', 200)]);
  assert.deepEqual(t.commits.map(c => c.sha), ['s2', 's3', 's1']);
  assert.equal(t.commits.find(c => c.sha === 's1').subject, 'x');
  const f = createThread({ paths: ['a'], itemUuid: 'U1' });
  assert.equal(f.maxPagesPerClick, 5);
  addCommits(f, [mk('a', 'a', 'x', 1, { trailers: { item: 'U1' } }), mk('b', 'a', 'x', 2, { trailers: { item: 'U2' } }), mk('c', 'a', 'x', 3)]);
  assert.deepEqual(f.commits.map(c => c.sha), ['a']);
  assert.equal(createThread({ paths: ['a'] }).maxPagesPerClick, 1);
});

await test('classifyCommit: rule kinds + labels; mine by login or own; author:null nametag = name; muted legacy', () => {
  const r = classifyCommit(mk('r', 'a', 'Create draft: X', 5), { login: 'ollie-opus' });
  assert.deepEqual(r, { type: 'rule', rule: 'draft-created', label: 'New draft created', sha: 'r', date: 5 });
  assert.equal(classifyCommit(mk('p', 'a', 'Publish update: X', 5), {}).label, 'Published to live');
  assert.equal(classifyCommit(mk('o', 'a', 'Edit', 1, { own: true }), { login: null }).mine, true);
  const mine = classifyCommit(mk('m', 'a', 'Edit', 1, { login: 'ollie-opus' }), { login: 'ollie-opus' });
  assert.equal(mine.mine, true);
  const theirs = classifyCommit(mk('t', 'a', 'Edit', 1, { login: 'bob' }), { login: 'ollie-opus' });
  assert.equal(theirs.mine, false); assert.equal(theirs.nametag, 'bob');
  const bot = classifyCommit(mk('b', 'a', 'Edit', 1, { login: null, name: 'CLI Bot' }), { login: 'ollie-opus' });
  assert.equal(bot.mine, false); assert.equal(bot.nametag, 'CLI Bot');
  assert.equal(classifyCommit(mk('n', 'a', 'Edit', 1), { login: null }).mine, false);
  const legacy = classifyCommit(mk('l', 'a', 'Update docs/x.md', 1, { trailers: { changed: 'Title, Body' }, body: 'bb' }), {});
  assert.equal(legacy.muted, true); assert.equal(legacy.text, 'Updated the page');
  assert.equal(legacy.changed, 'Title, Body'); assert.equal(legacy.body, 'bb');
  assert.equal(legacy.type, 'bubble'); assert.equal(legacy.path, 'a'); assert.equal(legacy.sha, 'l');
  assert.equal(classifyCommit(mk('e', 'a', 'Edit', 1), {}).changed, '');
});

await test('collapseRules: two Published rules 30 s apart -> one; 3 min apart -> two; different kinds never collapse', () => {
  const pub = (sha, date) => classifyCommit(mk(sha, 'a', 'Publish: X', date), {});
  assert.deepEqual(collapseRules([pub('p1', 100000), pub('p2', 70000)]).map(i => i.sha), ['p1']);
  assert.deepEqual(collapseRules([pub('p1', 300000), pub('p2', 120000)]).map(i => i.sha), ['p1', 'p2']);
  const mixed = [pub('p1', 100000), classifyCommit(mk('d1', 'a', 'Create draft: X', 99000), {})];
  assert.equal(collapseRules(mixed).length, 2);
});

await test('openThread on a draft: visible stops at and includes the first Create draft rule, history hidden; Create guide also starts a session', async () => {
  for (const [subj, rule] of [['Create draft: X', 'draft-created'], ['Create guide: X', 'guide-created']]) {
    const t = createThread({ paths: ['d'], session: true });
    const commits = [mk('c1', 'd', 'Edit 1', T0), mk('c2', 'd', 'Edit 2', T0 - MIN), mk('c3', 'd', subj, T0 - 2 * MIN), mk('c4', 'd', 'Old edit', T0 - 3 * MIN)];
    await openThread(t, { fetchPage: pager({ d: [commits] }) });
    assert.equal(t.historyHidden, true);
    assert.equal(t.shown, 3);
    const v = threadView(t, { now: T0 });
    const items = v.items.filter(i => i.type !== 'day');
    assert.deepEqual(items.map(i => i.sha), ['c1', 'c2', 'c3']);
    assert.equal(items[2].rule, rule);
    assert.equal(v.showHistory, true); // c4 is hidden history
  }
});

await test('showHistory true while hidden items remain; revealHistory shows the loaded rest', async () => {
  const t = createThread({ paths: ['d'], session: true });
  const commits = [mk('c1', 'd', 'Edit', T0), mk('c2', 'd', 'Create draft: X', T0 - MIN), mk('c3', 'd', 'Old', T0 - 2 * MIN)];
  await openThread(t, { fetchPage: pager({ d: [commits] }) });
  const v = threadView(t, { now: T0 });
  assert.equal(v.showHistory, true); assert.equal(v.showMore, false);
  revealHistory(t);
  assert.equal(t.historyHidden, false); assert.equal(t.shown, 3);
  const v2 = threadView(t, { now: T0 });
  assert.equal(v2.items.filter(i => i.type === 'bubble' || i.type === 'rule').length, 3);
  assert.equal(v2.showHistory, false); assert.equal(v2.showMore, false);
});

await test('openThread on a pre-feature draft (no session rule in the first page): everything loaded shown, history not hidden, showMore true while a path has pages', async () => {
  const t = createThread({ paths: ['d'], session: true });
  const all = run('d', 30);
  await openThread(t, { fetchPage: pager({ d: [all, run('d', 5, 30)] }) });
  assert.equal(t.historyHidden, false);
  assert.equal(t.shown, 30);
  const v = threadView(t, { now: T0 });
  assert.equal(v.items.filter(i => i.type === 'bubble').length, 30);
  assert.equal(v.showHistory, false); assert.equal(v.showMore, true);
  // fewer than a page loaded: everything shown
  const t2 = createThread({ paths: ['d'], session: true });
  await openThread(t2, { fetchPage: pager({ d: [run('d', 4)] }) });
  assert.equal(t2.shown, 4); assert.equal(t2.historyHidden, false);
  assert.equal(threadView(t2, { now: T0 }).showMore, false);
});

await test('openThread on a live page: first 30 shown, showMore true when a path is not exhausted', async () => {
  const t = createThread({ paths: ['l'] });
  await openThread(t, { fetchPage: pager({ l: chunk(run('l', 70)) }) });
  assert.equal(t.shown, 30);
  const v = threadView(t, { now: T0 });
  assert.equal(v.items.filter(i => i.type === 'bubble').length, 30);
  assert.equal(v.showMore, true); assert.equal(v.showHistory, false);
});

await test('frontier: a 3-commit draft path exhausted + a 30-commit live page 1 not exhausted holds back live commits older than its oldest fetched; after exhaustion all render', async () => {
  const t = createThread({ paths: ['draft', 'live'] });
  const draft = run('draft', 3, 0);
  const live1 = run('live', 30, 10);       // 10..39 minutes ago
  const live2 = run('live', 5, 40);
  t.paths.draft.page = 1; t.paths.draft.exhausted = true; t.paths.draft.oldest = draft[2].date;
  t.paths.live.page = 1; t.paths.live.oldest = live1[29].date;
  addCommits(t, [...draft, ...live1]);
  assert.equal(frontier(t), live1[29].date);
  assert.equal(renderableCommits(t).length, 33); // all newer than frontier
  // a draft commit OLDER than the live frontier must be held back
  const stale = mk('stale', 'draft', 'old draft edit', live1[29].date - MIN);
  addCommits(t, [stale]);
  assert.equal(renderableCommits(t).some(c => c.sha === 'stale'), false);
  await fetchUntil(t, pager({ live: [live1, live2] }), 100);
  assert.equal(t.paths.live.exhausted, true);
  assert.equal(allExhausted(t), true);
  assert.equal(frontier(t), -Infinity);
  assert.equal(renderableCommits(t).length, t.commits.length);
  assert.equal(renderableCommits(t).some(c => c.sha === 'stale'), true);
});

await test('frontier with unequal depth (300 vs 3 commits): fetching never surfaces a deep-path commit above an unfetched newer one', async () => {
  const deep = run('deep', 300, 5);
  const shallow = run('shallow', 3, 0);
  const t = createThread({ paths: ['deep', 'shallow'] });
  const calls = [];
  await openThread(t, { fetchPage: pager({ deep: chunk(deep), shallow: [shallow] }, calls) });
  assert.equal(t.paths.shallow.exhausted, true);
  assert.equal(t.paths.deep.exhausted, false);
  assert.equal(calls.filter(c => c[0] === 'deep').length, 1); // guide: one page per path
  const r = renderableCommits(t);
  assert.equal(r.length, 33);
  assert.deepEqual(r.slice(0, 3).map(c => c.path), ['shallow', 'shallow', 'shallow']);
  assert.ok(r.every(c => c.date >= frontier(t)));
  assert.equal(threadView(t, { now: T0 }).showMore, true);
  // the older deep page 1 commits must not be hidden behind anything unfetched
  await showMore(t, pager({ deep: chunk(deep), shallow: [shallow] }, calls));
  assert.equal(t.paths.deep.page, 2);
  assert.equal(t.shown, 60);
});

await test('fetchUntil (guide): at most one page per path per call; fetchUntil (item): up to 5 pages per path, stops when a path is exhausted or 30 matches found', async () => {
  const mismatch = (path) => chunk(Array.from({ length: 210 }, (_, i) => mk(`${path}${i}`, path, 'x', T0 - i * MIN, { trailers: { item: 'OTHER' } })));
  const calls = [];
  const t = createThread({ paths: ['p', 'q'], itemUuid: 'U' });
  await fetchUntil(t, pager({ p: mismatch('p'), q: mismatch('q') }, calls), PAGE_SIZE);
  assert.equal(calls.filter(c => c[0] === 'p').length, 5);
  assert.equal(calls.filter(c => c[0] === 'q').length, 5);
  assert.equal(renderableCommits(t).length, 0);
  assert.equal(t.commits.length, 0);
  assert.equal(allExhausted(t), false);
  // a second click continues from page 6
  await fetchUntil(t, pager({ p: mismatch('p'), q: mismatch('q') }, calls), PAGE_SIZE);
  assert.equal(t.paths.p.page, 8); // pages 6, 7 full, page 8 empty
  assert.equal(t.paths.p.exhausted, true);
  assert.equal(t.paths.q.exhausted, true);
  assert.equal(allExhausted(t), true);
  // guide thread: one page per path per call
  const g = createThread({ paths: ['p', 'q'] });
  const gc = [];
  await fetchUntil(g, pager({ p: chunk(run('p', 100)), q: chunk(run('q', 100, 1)) }, gc), 1000);
  assert.equal(gc.filter(c => c[0] === 'p').length, 1);
  assert.equal(gc.filter(c => c[0] === 'q').length, 1);
  // item thread stops early once 30 matches are renderable
  const m = createThread({ paths: ['p'], itemUuid: 'U' });
  const mc = [];
  const matching = run('p', 90).map(c => ({ ...c, trailers: { item: 'U' } }));
  await fetchUntil(m, pager({ p: chunk(matching) }, mc), PAGE_SIZE);
  assert.equal(mc.length, 1);
  assert.equal(renderableCommits(m).length, 30);
});

await test('empty history: fetchPage -> [] marks exhausted; threadView.empty true, showMore false', async () => {
  const t = createThread({ paths: ['a', 'b'] });
  await openThread(t, { fetchPage: async () => [] });
  assert.equal(allExhausted(t), true);
  const v = threadView(t, { now: T0 });
  assert.equal(v.empty, true); assert.equal(v.showMore, false); assert.equal(v.showHistory, false);
  assert.deepEqual(v.items, []);
});

await test('fetchPage rejection sets thread.error and threadView.error', async () => {
  const t = createThread({ paths: ['a'] });
  await openThread(t, { fetchPage: async () => { throw new Error('boom'); } });
  assert.equal(t.error, true);
  const v = threadView(t, { now: T0 });
  assert.equal(v.error, true); assert.equal(v.empty, false);
});

await test('openThread merges the recent write memo (deduped against fetched)', async () => {
  const t = createThread({ paths: ['a'] });
  const memo = mk('fresh', 'a', 'Edit', T0 + MIN, { own: true });
  await openThread(t, { fetchPage: pager({ a: [[memo, mk('old', 'a', 'Edit', T0)]] }), recent: [memo] });
  assert.deepEqual(t.commits.map(c => c.sha), ['fresh', 'old']);
});

await test('addDayDividers: Today / Yesterday / formatDay, one divider per calendar day', () => {
  const now = new Date(2026, 10, 10, 15, 0, 0).getTime();
  const at = (d, h) => new Date(2026, 10, d, h, 0, 0).getTime();
  const items = [
    { type: 'bubble', sha: 'a', date: at(10, 14) }, { type: 'bubble', sha: 'b', date: at(10, 9) },
    { type: 'bubble', sha: 'c', date: at(9, 20) }, { type: 'bubble', sha: 'd', date: at(5, 10) }, { type: 'bubble', sha: 'e', date: at(5, 8) },
  ];
  const out = addDayDividers(items, { now, formatDay: d => 'D' + new Date(d).getDate() });
  assert.deepEqual(out.map(i => i.type === 'day' ? i.label : i.sha), ['Today', 'a', 'b', 'Yesterday', 'c', 'D5', 'd', 'e']);
  const def = addDayDividers([items[3]], { now });
  assert.equal(def[0].label, new Date(at(5, 10)).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }));
});

await test('showMore reveals the next 30 logical items', async () => {
  const t = createThread({ paths: ['l'] });
  const f = pager({ l: chunk(run('l', 75)) });
  await openThread(t, { fetchPage: f });
  assert.equal(t.shown, 30);
  await showMore(t, f);
  assert.equal(t.shown, 60);
  assert.equal(logicalItems(t).length >= 60, true);
  await showMore(t, f);
  assert.equal(t.shown, 75);
  const v = threadView(t, { now: T0 });
  assert.equal(v.showMore, false);
});

console.log(`\n${passed} passed`);
