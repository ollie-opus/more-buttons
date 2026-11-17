// GitHub issue calls for Knowledge Base comments. One issue per comment, one
// issue comment per reply, all in the private COMMENTS_REPO (never the
// knowledge-base repo itself). Every function takes a last optional
// `deps = { fetchImpl, auth }` so tests need neither `fetch` nor `chrome`.
import { COMMENTS_REPO, parseIssue } from './kbComments.js';
import { authHeader } from './repoClient.js';

const API = `https://api.github.com/repos/${COMMENTS_REPO.owner}/${COMMENTS_REPO.name}`;
const PAGE_SIZE = 100;
const NO_ACCESS = [401, 403, 404];

const NO_WRITE_MESSAGE = "Your GitHub token can't write to the comments repository.";
// What authHeader() throws when no token is saved; shown to the person as is.
const NO_TOKEN_MESSAGE = 'No GitHub PAT configured';
const UNREACHABLE_MESSAGE = "Couldn't reach GitHub.";

// The one place a request is made: auth, headers, JSON body, no HTTP caching.
// A missing token makes `auth` throw, and that error is left to the caller.
async function request(method, path, body, { fetchImpl = fetch, auth = authHeader } = {}) {
  const headers = { Authorization: await auth(), Accept: 'application/vnd.github+json' };
  const init = { method, headers, cache: 'no-store' };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return fetchImpl(API + path, init);
}

// A write: throws a short readable Error unless GitHub answers 2xx; returns the response.
async function write(method, path, body, deps) {
  let res;
  try {
    res = await request(method, path, body, deps);
  } catch (err) {
    if (err?.message === NO_TOKEN_MESSAGE) throw err;
    throw new Error(UNREACHABLE_MESSAGE);
  }
  if (res.ok) return res;
  throw new Error(NO_ACCESS.includes(res.status) ? NO_WRITE_MESSAGE : `GitHub error ${res.status}.`);
}

// Every page of a list endpoint, following pages until one is short.
// Resolves to { ok: true, items } or { ok: false, reason, status? }.
async function readAllPages(path, deps) {
  const items = [];
  for (let page = 1; ; page++) {
    let res;
    try {
      res = await request('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=${PAGE_SIZE}&page=${page}`, undefined, deps);
    } catch {
      return { ok: false, reason: 'error' };
    }
    if (!res.ok) return { ok: false, reason: NO_ACCESS.includes(res.status) ? 'no-access' : 'error', status: res.status };
    let batch;
    try { batch = await res.json(); } catch { return { ok: false, reason: 'error' }; }
    if (!Array.isArray(batch)) return { ok: false, reason: 'error' };
    items.push(...batch);
    if (batch.length < PAGE_SIZE) return { ok: true, items };
  }
}

const toReply = c => ({ id: c.id, text: c.body || '', author: c.user?.login || '', createdAt: c.created_at || '' });

/** Every open comment issue; pull requests and issues that are not ours are dropped. */
export async function listOpenComments(deps) {
  const res = await readAllPages('/issues?state=open', deps);
  if (!res.ok) return res;
  return { ok: true, comments: res.items.map(parseIssue).filter(Boolean) };
}

export async function createComment({ title, body }, deps) {
  return parseIssue(await (await write('POST', '/issues', { title, body }, deps)).json());
}

export async function updateCommentBody(number, body, deps) {
  return parseIssue(await (await write('PATCH', `/issues/${number}`, { body }, deps)).json());
}

/** reason: 'completed' (Resolve) or 'not_planned' (Delete). */
export async function closeComment(number, reason, deps) {
  await write('PATCH', `/issues/${number}`, { state: 'closed', state_reason: reason }, deps);
}

export async function listReplies(number, deps) {
  const res = await readAllPages(`/issues/${number}/comments`, deps);
  if (!res.ok) throw new Error(res.reason === 'no-access' ? NO_WRITE_MESSAGE : UNREACHABLE_MESSAGE);
  return res.items.map(toReply);
}

export async function addReply(number, text, deps) {
  return toReply(await (await write('POST', `/issues/${number}/comments`, { body: text }, deps)).json());
}

export async function editReply(id, text, deps) {
  return toReply(await (await write('PATCH', `/issues/comments/${id}`, { body: text }, deps)).json());
}

export async function deleteReply(id, deps) {
  await write('DELETE', `/issues/comments/${id}`, undefined, deps);
}

/** Can this token read the comments repository? 'ok' | 'no-access' | 'error'. */
export async function commentsAccess(deps) {
  try {
    const res = await request('GET', '/issues?state=open&per_page=1', undefined, deps);
    if (res.ok) return 'ok';
    return NO_ACCESS.includes(res.status) ? 'no-access' : 'error';
  } catch {
    return 'error';
  }
}
