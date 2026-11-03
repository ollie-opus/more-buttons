import assert from 'node:assert/strict';
import { EDIT_LOG_COPY, editLogPanelHtml, editLogToggleHtml, editLogDrawerHtml, itemHtml, bubbleDetailHtml, redlineHtml, nametag } from '../scripts/editLogView.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const MIN = 60_000, DAY = 24 * 60 * MIN;
const now = 10 * DAY;
const bubble = (over = {}) => ({ type: 'bubble', sha: 'c1', path: 'docs/pages/a.md', parentSha: 'p0', text: 'Edit', muted: false, mine: true, nametag: 'bob', date: now - 3 * MIN, ...over });
const empty = { items: [], showHistory: false, showMore: false, error: false, empty: false };

test('panel shell: bare thread wrapper keyed by data-edit-log (the drawer owns the header)', () => {
  const html = editLogPanelHtml(empty, { now });
  assert.ok(html.startsWith('<div class="mb-editlog-panel" data-edit-log><div class="mb-editlog">'));
  assert.ok(!html.includes('mb-editlog__head'));
});

test('navbar toggle: nav-arrow button with the history icon, collapsed, controlling the drawer', () => {
  const html = editLogToggleHtml();
  assert.ok(html.startsWith('<button type="button" class="more-buttons-nav-arrow mb-editlog__toggle" data-editlog-toggle aria-label="Edit log" title="Edit log" aria-expanded="false" aria-controls="mb-editlog-drawer">'));
  assert.ok(html.includes('<span class="more-buttons-icon">history</span></button>'));
});

test('drawer: hidden layer with a close scrim, a labelled focusable aside, header with close, and the body slot', () => {
  const html = editLogDrawerHtml();
  assert.ok(html.startsWith('<div class="mb-editlog-layer" data-editlog-layer hidden><div class="mb-editlog-scrim" data-editlog-close></div>'));
  assert.ok(html.includes('<aside class="mb-editlog-drawer" id="mb-editlog-drawer" data-editlog-drawer role="region" aria-label="Edit log" tabindex="-1">'));
  assert.ok(html.includes('<div class="mb-editlog__head"><span class="more-buttons-icon">history</span><span class="mb-editlog__title">Edit log</span><button type="button" class="more-buttons-nav-arrow mb-editlog__close" data-editlog-close aria-label="Close edit log"><span class="more-buttons-icon">x</span></button></div>'));
  assert.ok(html.includes('<div class="mb-editlog-drawer__body" data-editlog-body></div></aside></div>'));
});

test('mine bubble: right row, "Me (login)" nametag, meta row with expand button then relative time', () => {
  const html = itemHtml(bubble(), { now });
  assert.ok(html.includes('class="mb-editlog__row --mine"'));
  assert.ok(html.includes('data-editlog-sha="c1" data-editlog-path="docs/pages/a.md" data-editlog-parent="p0"'));
  assert.ok(html.includes('<div class="mb-editlog__name">Me (bob)</div>'));
  assert.ok(html.includes('<div class="mb-editlog__meta"><button type="button" class="mb-editlog__more" data-editlog-expand="c1" aria-expanded="false">Show more</button><span class="mb-editlog__time"'));
  assert.ok(html.includes('>3 min ago</span></div>'));
  assert.ok(html.includes(`title="${new Date(now - 3 * MIN).toLocaleString()}"`));
  assert.ok(html.includes('<div class="mb-editlog__detail" hidden></div>'));
  assert.equal(nametag({ mine: true, nametag: '' }), 'Me');
  assert.equal(nametag({ mine: true, nametag: null }), 'Me');
  assert.equal(nametag({ mine: false, nametag: 'bob' }), 'bob');
});

test('theirs bubble has the nametag; missing parent renders empty attribute', () => {
  const html = itemHtml(bubble({ mine: false, parentSha: null }), { now });
  assert.ok(html.includes('class="mb-editlog__row --theirs"'));
  assert.ok(html.includes('<div class="mb-editlog__name">bob</div>'));
  assert.ok(html.includes('data-editlog-parent=""'));
});

test('muted bubble and escaping', () => {
  const html = itemHtml(bubble({ muted: true, text: '<b>"hi"</b>', nametag: '<i>', mine: false }), { now });
  assert.ok(html.includes('class="mb-editlog__bubble --muted"'));
  assert.ok(html.includes('&lt;b&gt;'));
  assert.ok(!html.includes('<b>') && !html.includes('<i>'));
  assert.ok(!itemHtml(bubble(), { now }).includes('--muted'));
});

test('rule and day items; history/more actions; error and empty copy', () => {
  assert.equal(itemHtml({ type: 'rule', rule: 'published', label: 'Published to live', sha: 's', date: 1 }, { now }),
    '<div class="mb-editlog__rule" data-editlog-rule="published">Published to live</div>');
  assert.equal(itemHtml({ type: 'rule', rule: 'draft-discarded', label: 'Draft discarded', by: 'bob<', sha: 's', date: 1 }, { now }),
    '<div class="mb-editlog__rule" data-editlog-rule="draft-discarded">Draft discarded (by bob&lt;)</div>');
  assert.equal(itemHtml({ type: 'day', label: 'Today' }, { now }), '<div class="mb-editlog__day">Today</div>');
  const h = editLogPanelHtml({ ...empty, items: [{ type: 'day', label: 'Today' }], showHistory: true }, { now });
  assert.ok(h.includes('<button type="button" class="mb-editlog__action" data-editlog-history>Show history</button>'));
  assert.ok(!h.includes('data-editlog-more'));
  const m = editLogPanelHtml({ ...empty, showMore: true }, { now });
  assert.ok(m.includes('<button type="button" class="mb-editlog__action" data-editlog-more>Show more</button>'));
  assert.ok(editLogPanelHtml({ ...empty, error: true }, { now }).includes('<p class="more-buttons-description mb-editlog__error">Couldn\'t load edit history.</p>'));
  assert.ok(editLogPanelHtml({ ...empty, empty: true }, { now }).includes('<p class="more-buttons-description mb-editlog__empty">No edit history recorded yet.</p>'));
  assert.equal(EDIT_LOG_COPY.history, 'Show history');
});

test('redlineHtml: ins/del wrapped and escaped, titles per block, empty -> No text changes.', () => {
  const html = redlineHtml([
    { title: 'Intro <x>', status: 'changed', ops: [{ op: 'eq', text: 'a ' }, { op: 'del', text: 'old' }, { op: 'ins', text: '<new>' }] },
    { title: 'Added', status: 'added', ops: [{ op: 'ins', text: 'all' }] },
  ]);
  assert.ok(html.startsWith('<div class="mb-editlog__diff">'));
  assert.ok(html.includes('<div class="mb-editlog__diff-section --changed"><div class="mb-editlog__diff-title">Intro &lt;x&gt;</div>'));
  assert.ok(html.includes('<pre class="mb-editlog__diff-body">a <del>old</del><ins>&lt;new&gt;</ins></pre>'));
  assert.ok(html.includes('--added"><div class="mb-editlog__diff-title">Added</div><pre class="mb-editlog__diff-body"><ins>all</ins></pre>'));
  assert.equal(redlineHtml([]), '<p class="more-buttons-description">No text changes.</p>');
});

test('bubbleDetailHtml: Changed line above redline; error mode shows error and plain body', () => {
  const blocks = [{ title: 'T', status: 'added', ops: [{ op: 'ins', text: 'x' }] }];
  const html = bubbleDetailHtml({ changed: 'Title, Tags', blocks });
  assert.ok(html.indexOf('<div class="mb-editlog__changed">Changed: Title, Tags</div>') === 0);
  assert.ok(html.indexOf('mb-editlog__diff"') > html.indexOf('mb-editlog__changed'));
  const err = bubbleDetailHtml({ error: "Couldn't load this change.", body: 'a<b' });
  assert.ok(err.includes('<p class="mb-editlog__error">Couldn\'t load this change.</p><pre class="mb-editlog__body">a&lt;b</pre>'));
  assert.ok(!bubbleDetailHtml({ error: 'e' }).includes('__body'));
});

console.log(`${passed} passed`);
