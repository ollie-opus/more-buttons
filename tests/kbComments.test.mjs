import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildIssue, parseIssue, withText, withPage } from '../scripts/kbComments.js';

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
