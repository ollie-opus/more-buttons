import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildIssue, parseIssue, withText, withPage, makeAnchor, findAnchor, commentsForGuide, orderComments, stackTops } from '../scripts/kbComments.js';

const anchor = { guide: 'g1', page: 'docs/pages/overview.md', block: 'b1', quote: 'click Save', before: 'Then ', after: ' to finish' };
const issueOf = (built, extra = {}) => ({ number: 7, body: built.body, title: built.title, user: { login: 'ollie-opus' }, created_at: '2026-11-17T10:00:00Z', comments: 2, html_url: 'https://github.com/x/y/issues/7', ...extra });

test('build then parse gives back the text and the anchor', () => {
  const built = buildIssue({ text: 'Out of date', guideTitle: 'Overview', liveUrl: 'https://support.opus-safety.co.uk/pages/overview/', anchor });
  assert.equal(built.title, 'Overview: "click Save"');
  const c = parseIssue(issueOf(built));
  assert.equal(c.text, 'Out of date');
  assert.deepEqual(c.anchor, anchor);
  assert.equal(c.author, 'ollie-opus');
  assert.equal(c.replyCount, 2);
  assert.equal(c.number, 7);
});

test('awkward characters in the quote survive', () => {
  const quote = 'a --> b "q" \\ <b>x</b>\nline two';
  const built = buildIssue({ text: 't', guideTitle: 'G', liveUrl: 'u', anchor: { ...anchor, quote } });
  const data = built.body.split('<!-- mb-comment ')[1]; // the hidden block: its only "-->" is the one that closes it
  assert.equal(data.indexOf('-->'), data.length - 3);
  assert.equal(parseIssue(issueOf(built)).anchor.quote, quote);
});

test('comment text holding markdown, a quote line and html is kept verbatim', () => {
  const text = '> not the quote\n**bold** <img src=x onerror=1>';
  assert.equal(parseIssue(issueOf(buildIssue({ text, guideTitle: 'G', liveUrl: 'u', anchor }))).text, text);
});

test('a long quote is cut in the title only', () => {
  const quote = 'x'.repeat(100);
  const built = buildIssue({ text: 't', guideTitle: 'G', liveUrl: 'u', anchor: { ...anchor, quote } });
  assert.equal(built.title, `G: "${'x'.repeat(60)}…"`);
  assert.equal(parseIssue(issueOf(built)).anchor.quote, quote);
});

test('pull requests and foreign issues are ignored', () => {
  const built = buildIssue({ text: 't', guideTitle: 'G', liveUrl: 'u', anchor });
  assert.equal(parseIssue(issueOf(built, { pull_request: {} })), null);
  assert.equal(parseIssue(issueOf({ title: 'x', body: 'just an issue' })), null);
  assert.equal(parseIssue(issueOf({ title: 'x', body: null })), null);
  assert.equal(parseIssue(issueOf({ title: 'x', body: '<!-- mb-comment {broken -->' })), null);
});

test('withText changes only the text; withPage only the path and link', () => {
  const built = buildIssue({ text: 'old', guideTitle: 'G', liveUrl: 'https://s/pages/a/', anchor });
  const edited = parseIssue(issueOf({ ...built, body: withText(built.body, 'new') }));
  assert.equal(edited.text, 'new');
  assert.deepEqual(edited.anchor, anchor);
  const moved = withPage(built.body, 'docs/pages/b.md', 'https://s/pages/b/', 'G2');
  assert.equal(parseIssue(issueOf({ ...built, body: moved })).anchor.page, 'docs/pages/b.md');
  assert.ok(moved.includes('[G2](https://s/pages/b/)'));
  assert.ok(!moved.includes('https://s/pages/a/'));
  assert.equal(parseIssue(issueOf({ ...built, body: moved })).text, 'old');
});

test('comment text holding the end marker round-trips; withText keeps the anchor', () => {
  const text = 'before <!-- mb-text-end --> after';
  const built = buildIssue({ text, guideTitle: 'G', liveUrl: 'u', anchor });
  const c = parseIssue(issueOf(built));
  assert.equal(c.text, text);
  assert.deepEqual(c.anchor, anchor);
  const edited = parseIssue(issueOf({ ...built, body: withText(built.body, 'new') }));
  assert.equal(edited.text, 'new');
  assert.deepEqual(edited.anchor, anchor);
});

const crlf = s => s.replace(/\n/g, '\r\n');

test('a body saved with CRLF line endings parses like its LF twin', () => {
  const text = 'line one\nline two';
  const built = buildIssue({ text, guideTitle: 'G', liveUrl: 'https://s/pages/a/', anchor });
  const c = parseIssue(issueOf({ ...built, body: crlf(built.body) }));
  assert.equal(c.text, text);
  assert.deepEqual(c.anchor, anchor);
  const edited = parseIssue(issueOf({ ...built, body: withText(crlf(built.body), 'new') }));
  assert.equal(edited.text, 'new');
  assert.deepEqual(edited.anchor, anchor);
  const moved = parseIssue(issueOf({ ...built, body: withPage(crlf(built.body), 'docs/pages/b.md', 'https://s/pages/b/', 'G2') }));
  assert.equal(moved.anchor.page, 'docs/pages/b.md');
  assert.equal(moved.text, text);
});

test('text holding the marker and a quote line round-trips', () => {
  const text = 'a <!-- mb-text-end -->\n\n> x';
  const built = buildIssue({ text, guideTitle: 'G', liveUrl: 'u', anchor });
  assert.equal(parseIssue(issueOf(built)).text, text);
});

test('a quote holding the marker round-trips', () => {
  const quote = 'q <!-- mb-text-end --> r\nsecond';
  const built = buildIssue({ text: 'mine', guideTitle: 'G', liveUrl: 'u', anchor: { ...anchor, quote } });
  const c = parseIssue(issueOf(built));
  assert.equal(c.text, 'mine');
  assert.equal(c.anchor.quote, quote);
});

test('a body with the data block but no end marker is not a comment and is not rewritten', () => {
  const built = buildIssue({ text: 't', guideTitle: 'G', liveUrl: 'u', anchor });
  const body = built.body.replace('<!-- mb-text-end -->', '');
  assert.equal(parseIssue(issueOf({ ...built, body })), null);
  assert.equal(withText(body, 'new'), body);
});

const model = (() => {
  const parts = [['b1', 'Open the form and click Save.'], ['b2', 'Then click Save again to click Save twice.'], ['b3', 'Done.']];
  let text = ''; const blocks = [];
  for (const [id, t] of parts) { const start = text.length; text += t + ' '; blocks.push({ id, start, end: start + t.length }); }
  return { text, blocks };
})();
const at = (needle, nth = 0) => { let i = -1; for (let n = 0; n <= nth; n++) i = model.text.indexOf(needle, i + 1); return i; };

test('makeAnchor records block, quote and neighbours; blank is null', () => {
  const s = at('click Save', 1);
  const a = makeAnchor(model, s, s + 10, { guide: 'g', page: 'p' });
  assert.equal(a.block, 'b2');
  assert.equal(a.quote, 'click Save');
  assert.equal(a.before, model.text.slice(s - 32, s));
  assert.equal(a.after, model.text.slice(s + 10, s + 42));
  assert.equal(makeAnchor(model, 5, 6, { guide: 'g', page: 'p' }).block, 'b1');
  assert.equal(makeAnchor(model, model.blocks[0].end, model.blocks[0].end + 1, { guide: 'g', page: 'p' }), null);
});

test('repeated words: the selected occurrence is found again', () => {
  for (const nth of [1, 2]) {
    const s = at('click Save', nth);
    const a = makeAnchor(model, s, s + 10, { guide: 'g', page: 'p' });
    assert.deepEqual(findAnchor(model, a), { start: s, end: s + 10, found: true });
  }
});

test('a moved block is still found by its id; a deleted block falls back to the whole text', () => {
  const s = at('Done.');
  const a = makeAnchor(model, s, s + 5, { guide: 'g', page: 'p' });
  const moved = { text: 'Done. ' + model.text.slice(0, model.blocks[2].start), blocks: [{ id: 'b3', start: 0, end: 5 }, { id: 'b1', start: 6, end: 35 }, { id: 'b2', start: 36, end: 78 }] };
  assert.equal(findAnchor(moved, a).start, 0);
  assert.equal(findAnchor({ text: 'x Done. y', blocks: [{ id: 'z', start: 0, end: 9 }] }, a).start, 2);
});

test('changed words: not found, at the block if it survives, else null', () => {
  const a = { guide: 'g', page: 'p', block: 'b2', quote: 'words no longer here', before: '', after: '' };
  assert.deepEqual(findAnchor(model, a), { start: model.blocks[1].start, found: false });
  assert.equal(findAnchor(model, { ...a, block: 'gone' }), null);
});

test('a selection across two blocks is found from its first block', () => {
  const s = at('Save.'), e = at('Then') + 4;
  const a = makeAnchor(model, s, e, { guide: 'g', page: 'p' });
  assert.equal(a.block, 'b1');
  assert.deepEqual(findAnchor(model, a), { start: s, end: e, found: true });
});

test('an empty quote is never found; a long quote is capped at 300', () => {
  assert.deepEqual(findAnchor(model, { guide: '', page: '', block: 'b1', quote: '', before: '', after: '' }), { start: 0, found: false });
  const big = { text: 'x'.repeat(400), blocks: [{ id: 'a', start: 0, end: 400 }] };
  assert.equal(makeAnchor(big, 0, 400, { guide: '', page: '' }).quote.length, 300);
});

test('commentsForGuide matches by guide id, then block, then path', () => {
  const c = (n, anchor) => ({ number: n, anchor });
  const list = [c(1, { guide: 'g', page: 'old', block: 'x' }), c(2, { guide: '', page: 'old', block: 'b2' }), c(3, { guide: '', page: 'p', block: 'x' }), c(4, { guide: 'other', page: 'q', block: 'y' })];
  assert.deepEqual(commentsForGuide(list, { guide: 'g', page: 'p', blockIds: new Set(['b1', 'b2']) }).map(x => x.number), [1, 2, 3]);
  assert.deepEqual(commentsForGuide(list, { guide: '', page: 'p', blockIds: new Set() }).map(x => x.number), [3]);
});

test('order is page order, unplaceable last and oldest first', () => {
  const e = (n, at, createdAt = '2026-01-01') => ({ comment: { number: n, createdAt }, at });
  const out = orderComments([e(1, null, '2026-02-01'), e(2, { start: 50, end: 60, found: true }), e(3, null, '2026-01-01'), e(4, { start: 10, found: false })]);
  assert.deepEqual(out.map(x => x.comment.number), [4, 2, 3, 1]);
});

test('stackTops never overlaps and honours the pinned card', () => {
  const items = [{ id: 1, want: 100, height: 80 }, { id: 2, want: 120, height: 50 }, { id: 3, want: 400, height: 40 }];
  assert.deepEqual([...stackTops(items)], [[1, 100], [2, 188], [3, 400]]);
  assert.deepEqual([...stackTops(items, { pinned: 2 })], [[1, 32], [2, 120], [3, 400]]);
  assert.deepEqual([...stackTops([], {})], []);
});
