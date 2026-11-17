import assert from 'node:assert/strict';
import { test } from 'node:test';
import { textModel, pointAt, offsetAt, relativeDate, popupSpot } from '../scripts/kbCommentsUi.js';
import { makeAnchor, findAnchor } from '../scripts/kbComments.js';

// Stand-in text nodes: only their identity matters to the model.
const n = name => ({ name });

test('whitespace runs collapse to one space, across nodes too', () => {
  const a = n('a'), b = n('b');
  const m = textModel([{ text: '  Hello \n  big ', node: a }, { text: '  world', node: b }]);
  assert.equal(m.text, 'Hello big world');
  assert.deepEqual(m.segs.map(s => [s.node.name, s.start, s.offs.length]), [['a', 0, 10], ['b', 10, 5]]);
});

test('block edges read as a space; a block runs to the next marker', () => {
  const m = textModel([
    { marker: 'h1' }, { gap: true }, { text: 'Title', node: n('t') }, { gap: true },
    { marker: 's1' }, { marker: 'b1' }, { gap: true }, { text: 'One two', node: n('p') }, { gap: true },
    { marker: 'b2' }, { text: 'Three', node: n('q') },
  ]);
  assert.equal(m.text, 'Title One two Three');
  assert.deepEqual(m.blocks, [
    { id: 'h1', start: 0, end: 6 },
    { id: 's1', start: 6, end: 6 },
    { id: 'b1', start: 6, end: 14 },
    { id: 'b2', start: 14, end: 19 },
  ]);
});

test('pointAt maps model offsets back to node offsets', () => {
  const a = n('a'), b = n('b');
  const m = textModel([{ text: 'Hello   there', node: a }, { gap: true }, { text: 'next', node: b }]);
  assert.equal(m.text, 'Hello there next');
  assert.deepEqual(pointAt(m, 6, 'start'), { node: a, offset: 8 }); // "t" of there, after the collapsed run
  assert.deepEqual(pointAt(m, 11, 'end'), { node: a, offset: 13 }); // after "there"
  // The added space between blocks: start moves forward, end moves back.
  assert.deepEqual(pointAt(m, 11, 'start'), { node: b, offset: 0 });
  assert.deepEqual(pointAt(m, 12, 'end'), { node: a, offset: 13 });
  assert.deepEqual(pointAt(m, 16, 'end'), { node: b, offset: 4 });
  assert.equal(pointAt(textModel([]), 0, 'start'), null);
});

test('offsetAt turns a DOM point into a model offset', () => {
  const a = n('a'), b = n('b'), c = n('c');
  const m = textModel([{ text: 'Hello   there', node: a }, { gap: true }, { text: 'next', node: b }, { text: ' end', node: c }]);
  const order = [a, b, c];
  // A point in a text node: count the kept characters before it.
  assert.equal(offsetAt(m, a, 8, () => true), 6);
  assert.equal(offsetAt(m, b, 2, node => order.indexOf(node) < 1), 14);
  // A point between elements, before node b: b's first character.
  assert.equal(offsetAt(m, 'parent', 1, node => order.indexOf(node) < 1), 12);
  // Past everything.
  assert.equal(offsetAt(m, 'parent', 9, () => true), m.text.length);
});

test('a selection read through the model anchors and finds itself again', () => {
  const a = n('a');
  const m = textModel([{ marker: 'b1' }, { text: 'a compliance system and its compliance duties', node: a }]);
  const start = m.text.lastIndexOf('compliance');
  const anchor = makeAnchor(m, start, start + 10, { guide: 'g', page: 'docs/pages/x.md' });
  assert.equal(anchor.block, 'b1');
  assert.deepEqual(findAnchor(m, anchor), { start, end: start + 10, found: true });
});

test('relativeDate', () => {
  const now = Date.parse('2026-11-17T12:00:00Z');
  const ago = ms => new Date(now - ms).toISOString();
  const MIN = 60000, H = 60 * MIN, D = 24 * H;
  assert.equal(relativeDate(ago(20 * 1000), now), 'just now');
  assert.equal(relativeDate(ago(5 * MIN), now), '5 min ago');
  assert.equal(relativeDate(ago(H), now), '1 hour ago');
  assert.equal(relativeDate(ago(5 * H), now), '5 hours ago');
  assert.equal(relativeDate(ago(D + H), now), 'yesterday');
  assert.equal(relativeDate(ago(4 * D), now), '4 days ago');
  assert.equal(relativeDate('2026-11-02T09:00:00Z', now), '2 Nov');
  assert.equal(relativeDate('2025-03-09T09:00:00Z', now), '9 Mar 2025');
  assert.equal(relativeDate('', now), '');
  assert.equal(relativeDate(ago(-5 * MIN), now), 'just now'); // a clock a little ahead
});

test('popupSpot: bottom right of the line, kept in the window', () => {
  const size = { w: 32, h: 32 }, view = { w: 1000, h: 800 };
  assert.deepEqual(popupSpot({ top: 100, right: 400, bottom: 120 }, size, view), { left: 400, top: 124 });
  // No room to the right: pulled in.
  assert.deepEqual(popupSpot({ top: 100, right: 990, bottom: 120 }, size, view), { left: 964, top: 124 });
  // No room below: above the line.
  assert.deepEqual(popupSpot({ top: 770, right: 400, bottom: 790 }, size, view), { left: 400, top: 734 });
  // Out of sight.
  assert.equal(popupSpot({ top: -60, right: 400, bottom: -40 }, size, view), null);
  assert.equal(popupSpot({ top: 900, right: 400, bottom: 920 }, size, view), null);
});

// ── The thread inside an opened card (kbCommentsThread.js) ──
import { repliesLabel, isOwn, editedBody } from '../scripts/kbCommentsThread.js';
import { buildIssue, parseIssue } from '../scripts/kbComments.js';

test('repliesLabel counts replies, and says nothing for none', () => {
  assert.equal(repliesLabel(0), '');
  assert.equal(repliesLabel(1), '1 reply');
  assert.equal(repliesLabel(4), '4 replies');
});

test('isOwn compares logins without case, and never matches an empty one', () => {
  assert.equal(isOwn('Kb-Tester', 'kb-tester'), true);
  assert.equal(isOwn('kb-tester', 'sam-ops'), false);
  assert.equal(isOwn(null, 'sam-ops'), false);
  assert.equal(isOwn('', ''), false);
});

test('editedBody changes the text and the page path, and the rest of the anchor not at all', () => {
  const anchor = { guide: 'g1', page: 'docs/pages/old.md', block: 'b1', quote: 'some words', before: 'a ', after: ' b' };
  const { body } = buildIssue({ text: 'First text', guideTitle: 'Overview', liveUrl: 'https://x.test/pages/overview/', anchor });
  const next = editedBody(body, 'Second text\nwith two lines', { livePath: 'docs/pages/overview.md', liveUrl: 'https://x.test/pages/overview/', guideTitle: 'Overview' });
  const c = parseIssue({ number: 1, body: next, user: { login: 'a' }, created_at: '', comments: 0 });
  assert.equal(c.text, 'Second text\nwith two lines');
  assert.deepEqual(c.anchor, { ...anchor, page: 'docs/pages/overview.md' });
});

test('editedBody is null for a body with no text part (it must not be sent)', () => {
  assert.equal(editedBody('Just some words, edited on GitHub.', 'New', { livePath: 'p', liveUrl: 'u', guideTitle: 't' }), null);
});
