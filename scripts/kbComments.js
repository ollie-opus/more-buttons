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
  return { title: `${guideTitle}: "${cut}"`, body };
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

/** The body with the page path and the guide link changed; the text and the rest of the anchor are untouched. */
export function withPage(body, page, liveUrl, guideTitle) {
  const at = dataStart(body);
  const anchor = readAnchor(body);
  if (at < 0 || !anchor) return body;
  const head = body.slice(0, at);
  const linkAt = head.trimEnd().lastIndexOf('\n') + 1; // the link line is the last line before the data block
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  return head.slice(0, linkAt) + linkLine(guideTitle, liveUrl) + eol + eol + dataBlock({ ...anchor, page });
}
