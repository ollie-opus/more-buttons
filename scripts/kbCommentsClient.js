// GitHub issue calls for Knowledge Base comments. One issue per comment, one
// issue comment per reply, all in the private COMMENTS_REPO (never the
// knowledge-base repo itself). Every function takes a last optional
// `deps = { fetchImpl, auth }` so tests need neither `fetch` nor `chrome`.
import { COMMENTS_REPO, parseIssue, goneMessage } from './kbComments.js';
import { authHeader } from './repoClient.js';

const API = `https://api.github.com/repos/${COMMENTS_REPO.owner}/${COMMENTS_REPO.name}`;
const PAGE_SIZE = 100;
const NO_ACCESS = [401, 403, 404];

const NO_WRITE_MESSAGE = "Your GitHub token can't write to the comments repository.";
// What authHeader() throws when no token is saved; shown to the person as is.
const NO_TOKEN_MESSAGE = 'No GitHub PAT configured';
const UNREACHABLE_MESSAGE = "Couldn't reach GitHub.";
const RATE_LIMIT_MESSAGE = 'GitHub is rate limiting requests. Try again in a minute.';
const TOO_LONG_MESSAGE = 'GitHub rejected that: it may be too long.';

// GitHub answers a primary or secondary rate limit with 429, or with 403 and
// either no requests left or a Retry-After: that is not a token without access.
function rateLimited(res) {
  const header = name => res.headers?.get?.(name) ?? null;
  if (res.status === 429) return true;
  if (res.status !== 403) return false;
  return header('x-ratelimit-remaining') === '0' || header('retry-after') !== null;
}

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
// `gone`: a 404 means it is already gone, which is what was wanted. `long`: a 422
// most likely means the text is over GitHub's limit. `any`: the answer is returned whatever it is.
async function write(method, path, body, deps, { gone = false, long = false, any = false } = {}) {
  let res;
  try {
    res = await request(method, path, body, deps);
  } catch (err) {
    if (err?.message === NO_TOKEN_MESSAGE) throw err;
    throw new Error(UNREACHABLE_MESSAGE);
  }
  if (any || res.ok || (gone && res.status === 404)) return res;
  throw failure(res, long);
}

// What a turned-down request is told to the person as.
function failure(res, long = false) {
  if (rateLimited(res)) return new Error(RATE_LIMIT_MESSAGE);
  if (long && res.status === 422) return new Error(TOO_LONG_MESSAGE);
  return new Error(NO_ACCESS.includes(res.status) ? NO_WRITE_MESSAGE : `GitHub error ${res.status}.`);
}

// ── Is a comment still there? ──
// A comment someone else resolved or deleted stays on a page that was loaded
// before: Resolve and Delete close its issue, and an issue can also be deleted
// outright on GitHub. GitHub takes a reply to a closed issue without complaint,
// and answers for a deleted one with the same 404 as for a token with no access.

// What the answer to "GET this issue" says: 'open' | 'resolved' | 'deleted' | null (it doesn't say).
async function statusFrom(res, deps) {
  if (res.ok) {
    let issue;
    try { issue = await res.json(); } catch { return null; }
    if (issue?.state !== 'closed') return issue?.state === 'open' ? 'open' : null;
    return issue.state_reason === 'completed' ? 'resolved' : 'deleted';
  }
  if (res.status === 410) return 'deleted';
  // A 404 for one issue while the repository's list still answers: the issue was deleted.
  if (res.status === 404 && await commentsAccess(deps) === 'ok') return 'deleted';
  return null;
}

const isGone = status => status === 'resolved' || status === 'deleted';
const goneError = how => Object.assign(new Error(goneMessage(how)), { gone: how });

/** Is this comment still open? 'open' | 'resolved' | 'deleted' | null when GitHub couldn't be asked. Never throws. */
export async function commentStatus(number, deps) {
  try {
    return await statusFrom(await request('GET', `/issues/${number}`, undefined, deps), deps);
  } catch {
    return null;
  }
}

// Before a write to a comment: throws (with `gone` set) when it has been resolved or deleted,
// and the usual readable Error when GitHub can't be asked at all.
async function mustBeOpen(number, deps) {
  const res = await write('GET', `/issues/${number}`, undefined, deps, { any: true });
  const status = await statusFrom(res, deps);
  if (isGone(status)) throw goneError(status);
  if (!res.ok) throw failure(res);
}

// Every page of a list endpoint, following pages until one is short.
// Resolves to { ok: true, items } or { ok: false, reason, status?, limited? }
// (`limited`: rate limited, read as an error, never as no access).
async function readAllPages(path, deps) {
  const items = [];
  for (let page = 1; ; page++) {
    let res;
    try {
      res = await request('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=${PAGE_SIZE}&page=${page}`, undefined, deps);
    } catch {
      return { ok: false, reason: 'error' };
    }
    if (!res.ok) {
      if (rateLimited(res)) return { ok: false, reason: 'error', status: res.status, limited: true };
      return { ok: false, reason: NO_ACCESS.includes(res.status) ? 'no-access' : 'error', status: res.status };
    }
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
  return parseIssue(await (await write('POST', '/issues', { title, body }, deps, { long: true })).json());
}

export async function updateCommentBody(number, body, deps) {
  await mustBeOpen(number, deps);
  return parseIssue(await (await write('PATCH', `/issues/${number}`, { body }, deps, { long: true })).json());
}

/** reason: 'completed' (Resolve) or 'not_planned' (Delete). */
export async function closeComment(number, reason, deps) {
  const res = await write('PATCH', `/issues/${number}`, { state: 'closed', state_reason: reason }, deps, { any: true });
  if (res.ok) return;
  if (await statusFrom(res, deps) === 'deleted') return; // deleted on GitHub: already gone, which is what was wanted
  throw failure(res);
}

export async function listReplies(number, deps) {
  const res = await readAllPages(`/issues/${number}/comments`, deps);
  if (!res.ok) {
    if (res.limited) throw new Error(RATE_LIMIT_MESSAGE);
    if (res.reason === 'no-access') throw new Error(NO_WRITE_MESSAGE);
    throw new Error(res.status ? `GitHub error ${res.status}.` : UNREACHABLE_MESSAGE);
  }
  return res.items.map(toReply);
}

export async function addReply(number, text, deps) {
  await mustBeOpen(number, deps);
  return toReply(await (await write('POST', `/issues/${number}/comments`, { body: text }, deps, { long: true })).json());
}

export async function editReply(id, text, deps) {
  return toReply(await (await write('PATCH', `/issues/comments/${id}`, { body: text }, deps, { long: true })).json());
}

export async function deleteReply(id, deps) {
  await write('DELETE', `/issues/comments/${id}`, undefined, deps, { gone: true }); // a 404: already deleted
}

/** Can this token read the comments repository? 'ok' | 'no-access' | 'error'. */
export async function commentsAccess(deps) {
  try {
    const res = await request('GET', '/issues?state=open&per_page=1', undefined, deps);
    if (res.ok) return 'ok';
    if (rateLimited(res)) return 'error';
    return NO_ACCESS.includes(res.status) ? 'no-access' : 'error';
  } catch {
    return 'error';
  }
}

/**
 * What a write probe's answer says about the token: a request that asks for a
 * write but is missing everything a write needs. GitHub checks the token's
 * permission before the request's contents, so with write permission it is
 * turned down as invalid (422) and without it as forbidden; nothing is ever
 * written either way. 'ok' | 'read-only' | 'error'.
 */
export function probeResult(res) {
  if (res.status === 422) return 'ok';
  if (rateLimited(res)) return 'error';
  return NO_ACCESS.includes(res.status) ? 'read-only' : 'error';
}

/**
 * Can this token read AND write the comments repository's issues?
 * 'ok' | 'read-only' (Issues is Read-only) | 'no-access' | 'error'.
 */
export async function commentsWriteAccess(deps) {
  const read = await commentsAccess(deps);
  if (read !== 'ok') return read;
  try {
    return probeResult(await request('POST', '/issues', {}, deps)); // no title: can never make an issue
  } catch {
    return 'error';
  }
}

