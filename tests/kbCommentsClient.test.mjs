import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIssue } from '../scripts/kbComments.js';
import {
  listOpenComments, createComment, updateCommentBody, closeComment,
  listReplies, addReply, editReply, deleteReply, commentsAccess,
} from '../scripts/kbCommentsClient.js';

const BASE = 'https://api.github.com/repos/opus-safety/opus-knowledge-base-comments';
const auth = async () => 'token T';
const ANCHOR = { guide: 'g', page: 'p', blockId: 'b', start: 0, end: 3, quote: 'abc' };

// Records each call and answers from a queue of { status, json } (or an Error to throw).
function stub(queue) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body === undefined ? undefined : JSON.parse(init.body), cache: init.cache });
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.json };
  };
  return { calls, deps: { fetchImpl, auth } };
}

function issue(n, text = 'hello') {
  const { body } = buildIssue({ text, guideTitle: 'Guide', liveUrl: 'https://x/y/', anchor: ANCHOR });
  return { number: n, body, user: { login: 'a' }, created_at: '2026-11-17T10:00:00Z', comments: 0, html_url: `https://github.com/i/${n}` };
}

test('lists every page of open issues, skipping pull requests and foreign issues', async () => {
  const p1 = [];
  for (let i = 1; i <= 98; i++) p1.push(issue(i));
  p1.push({ ...issue(99), pull_request: {} });
  p1.push({ number: 100, body: 'just a plain issue', user: { login: 'a' } });
  const p2 = [issue(101), issue(102), issue(103)];
  const { calls, deps } = stub([{ status: 200, json: p1 }, { status: 200, json: p2 }]);
  const result = await listOpenComments(deps);
  assert.equal(result.ok, true);
  assert.equal(result.comments.length, 101);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /page=1/);
  assert.match(calls[1].url, /page=2/);
  assert.ok(calls[0].url.startsWith(`${BASE}/issues?state=open&per_page=100`));
  for (const c of calls) {
    assert.equal(c.headers.Authorization, 'token T');
    assert.equal(c.headers.Accept, 'application/vnd.github+json');
    assert.equal(c.cache, 'no-store');
  }
});

test('403 and 404 mean no access; a thrown fetch or 500 means error', async () => {
  assert.deepEqual(await listOpenComments(stub([{ status: 404, json: {} }]).deps), { ok: false, reason: 'no-access', status: 404 });
  assert.deepEqual(await listOpenComments(stub([{ status: 403, json: {} }]).deps), { ok: false, reason: 'no-access', status: 403 });
  assert.deepEqual(await listOpenComments(stub([{ status: 500, json: {} }]).deps), { ok: false, reason: 'error', status: 500 });
  assert.deepEqual(await listOpenComments(stub([new Error('offline')]).deps), { ok: false, reason: 'error' });
});

test('a missing token reports an error rather than throwing', async () => {
  const { deps } = stub([]);
  const result = await listOpenComments({ ...deps, auth: async () => { throw new Error('No GitHub PAT configured'); } });
  assert.deepEqual(result, { ok: false, reason: 'error' });
  await assert.rejects(createComment({ title: 't', body: 'b' }, { ...deps, auth: async () => { throw new Error('No GitHub PAT configured'); } }), /No GitHub PAT configured/);
});

test('createComment posts title and body to the comments repo', async () => {
  const { calls, deps } = stub([{ status: 201, json: issue(5) }]);
  const made = await createComment({ title: 'T', body: issue(5).body }, deps);
  assert.equal(calls[0].url, `${BASE}/issues`);
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, { title: 'T', body: issue(5).body });
  assert.equal(calls[0].headers.Authorization, 'token T');
  assert.equal(made.number, 5);
});

test('updateCommentBody patches the issue body', async () => {
  const { calls, deps } = stub([{ status: 200, json: issue(7) }]);
  const c = await updateCommentBody(7, 'new body', deps);
  assert.equal(calls[0].url, `${BASE}/issues/7`);
  assert.equal(calls[0].method, 'PATCH');
  assert.deepEqual(calls[0].body, { body: 'new body' });
  assert.equal(c.number, 7);
});

test('closeComment sends the state reason', async () => {
  for (const reason of ['completed', 'not_planned']) {
    const { calls, deps } = stub([{ status: 200, json: {} }]);
    assert.equal(await closeComment(7, reason, deps), undefined);
    assert.equal(calls[0].method, 'PATCH');
    assert.ok(calls[0].url.endsWith('/issues/7'));
    assert.deepEqual(calls[0].body, { state: 'closed', state_reason: reason });
  }
});

test('replies: list maps fields, add posts, edit patches, delete deletes', async () => {
  const raw = { id: 1, body: 'hi', user: { login: 'a' }, created_at: '2026-11-17T10:00:00Z' };
  const mapped = { id: 1, text: 'hi', author: 'a', createdAt: '2026-11-17T10:00:00Z' };
  let s = stub([{ status: 200, json: [raw] }]);
  assert.deepEqual(await listReplies(7, s.deps), [mapped]);
  assert.equal(s.calls[0].url, `${BASE}/issues/7/comments?per_page=100&page=1`);

  s = stub([{ status: 201, json: raw }]);
  assert.deepEqual(await addReply(7, 'hi', s.deps), mapped);
  assert.equal(s.calls[0].method, 'POST');
  assert.equal(s.calls[0].url, `${BASE}/issues/7/comments`);
  assert.deepEqual(s.calls[0].body, { body: 'hi' });

  s = stub([{ status: 200, json: raw }]);
  assert.deepEqual(await editReply(1, 'hi', s.deps), mapped);
  assert.equal(s.calls[0].method, 'PATCH');
  assert.ok(s.calls[0].url.endsWith('/issues/comments/1'));

  s = stub([{ status: 204, json: null }]);
  assert.equal(await deleteReply(1, s.deps), undefined);
  assert.equal(s.calls[0].method, 'DELETE');
  assert.ok(s.calls[0].url.endsWith('/issues/comments/1'));
});

test('listReplies follows pages until a short one', async () => {
  const full = Array.from({ length: 100 }, (_, i) => ({ id: i, body: 'x', user: { login: 'a' }, created_at: '' }));
  const { calls, deps } = stub([{ status: 200, json: full }, { status: 200, json: [full[0]] }]);
  assert.equal((await listReplies(7, deps)).length, 101);
  assert.match(calls[1].url, /page=2/);
});

test('a failed write throws a message a person can read', async () => {
  await assert.rejects(addReply(7, 'x', stub([{ status: 403, json: {} }]).deps), /can't write to the comments repository/);
  await assert.rejects(addReply(7, 'x', stub([{ status: 500, json: {} }]).deps), { message: 'GitHub error 500.' });
  await assert.rejects(addReply(7, 'x', stub([new Error('offline')]).deps), { message: "Couldn't reach GitHub." });
  await assert.rejects(closeComment(7, 'completed', stub([{ status: 404, json: {} }]).deps), /can't write/);
});

test('commentsAccess: ok, no-access, error', async () => {
  const s = stub([{ status: 200, json: [] }]);
  assert.equal(await commentsAccess(s.deps), 'ok');
  assert.equal(s.calls[0].url, `${BASE}/issues?state=open&per_page=1`);
  assert.equal(await commentsAccess(stub([{ status: 404, json: {} }]).deps), 'no-access');
  assert.equal(await commentsAccess(stub([{ status: 500, json: {} }]).deps), 'error');
  assert.equal(await commentsAccess(stub([new Error('x')]).deps), 'error');
});
