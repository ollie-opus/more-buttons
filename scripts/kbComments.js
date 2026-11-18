/**
 * kbComments.js — comments on Knowledge Base guides, kept as GitHub issues.
 *
 * Each comment is one issue in the comments repo. The body reads well on
 * GitHub (the text, the passage it is about, a link to the guide) and ends
 * with a hidden data block holding the anchor, which is what the extension
 * reads back. This file is the one place that knows that layout.
 *
 * Pure: no DOM, no chrome, no imports. Node-tested.
 */

export const COMMENTS_REPO = { owner: 'opus-safety', name: 'opus-knowledge-base-comments' };

const TEXT_END = '<!-- mb-text-end -->';
const DATA_OPEN = '<!-- mb-comment ';
const DATA_CLOSE = ' -->';
const TITLE_QUOTE_MAX = 60;
// GitHub's limits are 256 characters for a title and 65,536 for a body; the body
// also carries the quote, the link and the data block, so the text boxes stop short.
const TITLE_MAX = 250;
export const BODY_MAX = 60000;

/** What a person is told about a comment that someone has since 'resolved' or 'deleted'. */
export const goneMessage = how => (how === 'resolved' ? 'This comment has been resolved.' : 'This comment has been deleted.');

/** The anchor as one line of JSON, with < and > escaped so "-->" can never close the comment early. */
function dataBlock(anchor) {
  const { guide, page, block, quote, before, after } = anchor;
  const json = JSON.stringify({ v: 1, guide, page, block, quote, before, after })
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  return DATA_OPEN + json + DATA_CLOSE;
}

/** The "[guide title](live url)" line. */
const linkLine = (guideTitle, liveUrl) => `[${guideTitle}](${liveUrl})`;

/** The quote as a markdown block quote, every line prefixed. */
const quoteBlock = quote => String(quote).split('\n').map(l => '> ' + l).join('\n');

/**
 * The title and body of the issue for a new comment.
 *
 * @param {{text: string, guideTitle: string, liveUrl: string, anchor: {guide: string, page: string, block: string, quote: string, before: string, after: string}}} c
 * @returns {{title: string, body: string}}
 */
export function buildIssue({ text, guideTitle, liveUrl, anchor }) {
  const flat = String(anchor.quote).replace(/\s+/g, ' ').trim();
  const cut = flat.length > TITLE_QUOTE_MAX ? flat.slice(0, TITLE_QUOTE_MAX) + '…' : flat;
  const body = [text, TEXT_END, quoteBlock(anchor.quote), linkLine(guideTitle, liveUrl), dataBlock(anchor)].join('\n\n');
  // Over the title limit: the guide's title is cut, never the `: "…"` around the quote.
  const room = TITLE_MAX - (cut.length + 4);
  const name = String(guideTitle);
  const shown = name.length > room ? name.slice(0, room - 1).replace(/[\uD800-\uDBFF]$/, '') + '…' : name;
  return { title: `${shown}: "${cut}"`, body };
}

/**
 * Where the text ends: the last end marker before the data block that is followed by the quote block
 * (a blank line, then ">"). The one buildIssue writes is always that one, so a marker typed into the
 * text or the quote is harmless. Line endings may be CRLF, as GitHub's web editor saves them. When no
 * marker is followed by a quote block, the last bare marker; -1 when there is none.
 */
function textEnd(body) {
  const at = dataStart(body);
  const head = at < 0 ? body : body.slice(0, at);
  let last = -1;
  for (const m of head.matchAll(/<!-- mb-text-end -->(?=\r?\n\r?\n>)/g)) last = m.index;
  return last >= 0 ? last : head.lastIndexOf(TEXT_END);
}

/** Where the hidden data block starts in a body, or -1. */
const dataStart = body => body.lastIndexOf(DATA_OPEN);

/** The anchor held in a body's data block, or null when absent or unreadable. */
function readAnchor(body) {
  const at = dataStart(body);
  if (at < 0) return null;
  const end = body.indexOf(DATA_CLOSE, at);
  if (end < 0) return null;
  try {
    const d = JSON.parse(body.slice(at + DATA_OPEN.length, end));
    if (!d || typeof d !== 'object') return null;
    const s = k => (typeof d[k] === 'string' ? d[k] : '');
    return { guide: s('guide'), page: s('page'), block: s('block'), quote: s('quote'), before: s('before'), after: s('after') };
  } catch { return null; }
}

/**
 * A GitHub issue read as a comment.
 *
 * @param {object} issue - a GitHub issue object
 * @returns {{number: number, text: string, author: string, createdAt: string, replyCount: number, url: string, anchor: object, body: string}|null}
 *   null for a pull request, or an issue with no readable data block
 */
export function parseIssue(issue) {
  if (!issue || issue.pull_request || typeof issue.body !== 'string') return null;
  const anchor = readAnchor(issue.body);
  if (!anchor) return null;
  const end = textEnd(issue.body);
  if (end < 0) return null;
  const text = issue.body.slice(0, end).replace(/\r\n/g, '\n').trim();
  return {
    number: issue.number,
    text,
    author: issue.user?.login || '',
    createdAt: issue.created_at || '',
    replyCount: issue.comments || 0,
    url: issue.html_url || '',
    anchor,
    body: issue.body,
  };
}

/** The body with its comment text replaced; everything from the text's end marker on is untouched. A body with no end marker is returned unchanged. */
export function withText(body, newText) {
  const end = textEnd(body);
  if (end < 0) return body;
  return newText + (body.includes('\r\n') ? '\r\n\r\n' : '\n\n') + body.slice(end);
}

/** The body with the page path and the guide link changed (the link stays as it was when `guideTitle` is empty); the text and the rest of the anchor are untouched. */
export function withPage(body, page, liveUrl, guideTitle) {
  const at = dataStart(body);
  const anchor = readAnchor(body);
  if (at < 0 || !anchor) return body;
  const head = body.slice(0, at);
  const linkAt = head.trimEnd().lastIndexOf('\n') + 1; // the link line is the last line before the data block
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  // With no title to write, the link line already in the body stays as it is (never `[](url)`).
  const line = guideTitle ? linkLine(guideTitle, liveUrl) : head.slice(linkAt).trimEnd();
  return head.slice(0, linkAt) + line + eol + eol + dataBlock({ ...anchor, page });
}

const CONTEXT_LEN = 32;

/**
 * The anchor for a selection. `model` is `{ text, blocks: [{ id, start, end }] }`: the article's text with
 * whitespace runs collapsed, and each block's span in it, in page order. Null when the selection is blank.
 */
export function makeAnchor(model, start, end, { guide, page }) {
  const raw = model.text.slice(start, end);
  const quote = raw.trim(); // whole, however long: the marked run is the selection
  if (!quote) return null;
  const from = start + (raw.length - raw.trimStart().length);
  const to = from + quote.length;
  let block = '';
  for (const b of model.blocks) if (b.start <= from) block = b.id; else break;
  return {
    guide, page, block, quote,
    before: model.text.slice(Math.max(0, from - CONTEXT_LEN), from),
    after: model.text.slice(to, to + CONTEXT_LEN),
  };
}

/** Every place `quote` sits wholly inside text[lo, hi), overlaps included. */
function occurrences(text, quote, lo, hi) {
  const found = [];
  for (let i = text.indexOf(quote, lo); i >= 0 && i + quote.length <= hi; i = text.indexOf(quote, i + 1)) found.push(i);
  return found;
}

/** How many characters next to an occurrence agree with the anchor's saved neighbours. */
function contextScore(text, i, len, { before, after }) {
  let score = 0;
  for (let k = 1; k <= before.length && i - k >= 0 && text[i - k] === before[before.length - k]; k++) score++;
  for (let k = 0; k < after.length && text[i + len + k] === after[k]; k++) score++;
  return score;
}

/**
 * Where an anchor's quote is now: in its own block, else anywhere in the text. Several matches: the one
 * whose neighbours fit best; on a tie, one at or after the block's start (a selection that ran across
 * blocks), then the earliest. The whole text is searched, not just from the block on, because the views
 * put a heading on opposite sides of its marker (on the built page the section's id span follows the
 * heading; in the editor the heading is the marker), and because a quote can move to an earlier block.
 *
 * @returns {{start: number, end: number, found: true}|{start: number, found: false}|null}
 *   `found: false` points at the block's start; null when the quote and the block are both gone
 */
export function findAnchor(model, anchor) {
  const { text } = model;
  const quote = anchor.quote;
  const block = model.blocks.find(b => b.id === anchor.block);
  if (quote) {
    let hits = block ? occurrences(text, quote, block.start, block.end) : [];
    const own = hits.length > 0;
    if (!own) hits = occurrences(text, quote, 0, text.length);
    const from = !own && block ? block.start : 0; // ties go to a match at or after this
    let best = -1, bestScore = -1, bestAfter = false;
    for (const i of hits) {
      const s = contextScore(text, i, quote.length, anchor);
      const after = i >= from;
      if (s > bestScore || (s === bestScore && after && !bestAfter)) { best = i; bestScore = s; bestAfter = after; }
    }
    if (best >= 0) return { start: best, end: best + quote.length, found: true };
  }
  return block ? { start: block.start, found: false } : null;
}

/** The comments that belong to a guide: same guide id, or one of its block ids, or the same page path. */
export function commentsForGuide(comments, { guide, page, blockIds }) {
  return comments.filter(c => {
    const a = c.anchor;
    // Never on an empty id or path: a comment made before the first marker has block ''.
    return (a.guide && a.guide === guide) || (a.block && blockIds.has(a.block)) || (a.page && a.page === page);
  });
}

/** Entries `{ comment, at }` in page order; those with no place (`at` null) last, oldest first. */
export function orderComments(entries) {
  const byAge = (x, y) => (x.comment.createdAt < y.comment.createdAt ? -1 : x.comment.createdAt > y.comment.createdAt ? 1 : 0);
  return [...entries].sort((x, y) => {
    if (!x.at || !y.at) return x.at ? -1 : y.at ? 1 : byAge(x, y);
    return x.at.start - y.at.start || byAge(x, y);
  });
}

/**
 * Tops for cards given in page order so none overlap. Each card sits at its wanted top or just below the
 * one above. The pinned card keeps exactly its wanted top; cards after it stack down, cards before it up.
 *
 * @param {{id: *, want: number, height: number}[]} items
 * @returns {Map<*, number>} id to top
 */
export function stackTops(items, { gap = 8, pinned = null } = {}) {
  const tops = new Map();
  const pin = pinned === null ? -1 : items.findIndex(it => it.id === pinned);
  const down = (from, floor) => {
    let min = floor;
    for (let i = from; i < items.length; i++) {
      const top = Math.max(items[i].want, min);
      tops.set(items[i].id, top);
      min = top + items[i].height + gap;
    }
  };
  if (pin < 0) { down(0, -Infinity); return tops; }
  tops.set(items[pin].id, items[pin].want);
  down(pin + 1, items[pin].want + items[pin].height + gap);
  let limit = items[pin].want;
  for (let i = pin - 1; i >= 0; i--) {
    const top = Math.min(items[i].want, limit - gap - items[i].height);
    tops.set(items[i].id, top);
    limit = top;
  }
  // restore page order in the map
  return new Map(items.map(it => [it.id, tops.get(it.id)]));
}

/**
 * Tops from stackTops kept at or below `floor` (the top of the room the cards are drawn in): cards that
 * stacked upward past it from a pinned card are pushed back down, in page order, each just below the
 * one above, so none is drawn above the room and none overlaps. Tops already clear of it stay as they are.
 *
 * @param {{id: *, height: number}[]} items - in page order, as given to stackTops
 * @param {Map<*, number>} tops - from stackTops
 * @returns {Map<*, number>} id to top
 */
export function clampTops(items, tops, { gap = 8, floor = 0 } = {}) {
  const out = new Map();
  let min = floor;
  for (const it of items) {
    const top = Math.max(tops.get(it.id) ?? min, min);
    out.set(it.id, top);
    min = top + it.height + gap;
  }
  return out;
}

/**
 * Tops from clampTops kept inside the room: a stack that would run past `ceiling` (the room's bottom) is
 * moved up just enough to end there. Working up from the bottom, each card moves only as far as the one
 * under it needs, so the cards higher up, and a pinned card, keep their places whenever the cards below
 * them fit under them. None goes above `floor` or overlaps: a stack taller than the room starts at the
 * floor and runs on past the ceiling.
 *
 * @param {{id: *, height: number}[]} items - in page order, as given to clampTops
 * @param {Map<*, number>} tops - from clampTops
 * @returns {Map<*, number>} id to top
 */
export function boundTops(items, tops, { gap = 8, floor = 0, ceiling = Infinity } = {}) {
  const up = new Map();
  let limit = ceiling + gap; // the next card up ends a gap above this
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    const top = Math.min(tops.get(it.id) ?? floor, limit - gap - it.height);
    up.set(it.id, top);
    limit = top;
  }
  return clampTops(items, new Map(items.map(it => [it.id, up.get(it.id)])), { gap, floor });
}

// The hues a name can take (oklch degrees), spaced to stay apart from each
// other; the lightness and chroma are the stylesheet's (kbComments.css), one
// pair for each scheme.
export const AUTHOR_HUES = [25, 55, 95, 145, 185, 225, 260, 295, 325, 355];

// People given a colour of their own (lower-case login → hue); everyone else gets one from their login.
export const AUTHOR_OWN_HUES = { 'ollie-opus': 235 }; // light (sky) blue
// A lighter shade than the rest on the light scheme, for those who asked (oklch lightness; the dark scheme's is already light).
const AUTHOR_OWN_LIGHT = { 'ollie-opus': 0.62 };

/**
 * The hue of a GitHub user's name: always the same for the same login (logins
 * are not case sensitive), on every page. Two people can share one; null for
 * no login.
 */
export function authorHue(login) {
  const name = String(login ?? '').trim().toLowerCase();
  if (!name) return null;
  if (Object.hasOwn(AUTHOR_OWN_HUES, name)) return AUTHOR_OWN_HUES[name];
  let h = 2166136261; // FNV-1a
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return AUTHOR_HUES[(h >>> 0) % AUTHOR_HUES.length];
}

/** An element for a user's name, in that user's colour. */
export function authorEl(doc, login) {
  const span = doc.createElement('span');
  span.className = 'mb-kb-comment__author';
  span.textContent = login ?? '';
  const hue = authorHue(login);
  if (hue != null) span.style.setProperty('--mb-kb-author-hue', String(hue));
  const light = AUTHOR_OWN_LIGHT[String(login ?? '').trim().toLowerCase()];
  if (light) span.style.setProperty('--mb-kb-author-light', String(light));
  return span;
}
