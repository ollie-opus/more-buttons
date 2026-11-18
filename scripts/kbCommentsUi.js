/**
 * kbCommentsUi.js — comments on a Knowledge Base guide, on the guide itself.
 *
 * Select words in the article and a small comment icon comes up at the end of
 * the selection; it opens a comment box in the list of comments, at the place
 * the new comment will take. The list is in page order (kbComments.js
 * orderComments). Clicking a comment scrolls to its words and highlights them
 * (the CSS Custom Highlight API: nothing is added to the article); clicking
 * anywhere else clears that. Nothing is highlighted otherwise.
 *
 * The comments are GitHub issues (kbCommentsClient.js). They load in the
 * background: startKbComments returns at once, and a token that cannot reach
 * the comments repo leaves the page exactly as it was.
 *
 * Where the list goes is one swappable piece (PLACEMENTS): on the live page,
 * in the right-hand margin under the theme's "On this page" list, each card
 * level with its words (kbCommentsMargin.js), when the view has that margin; in edit
 * mode, beside the text in the empty left-hand margin (kbCommentsMargin.js);
 * otherwise in a pull-out panel opened from a button in the site's header
 * (kbCommentsPanel.js). In edit mode every card can also be resolved, and in
 * the draft the comment icon joins the format buttons that float over
 * highlighted text (richTextEditor.js) instead of standing on its own.
 *
 * One instance per document: starting one takes away any other still there.
 *
 * Everything that came from GitHub reaches the page as text (textContent),
 * never as markup, and nothing read back from an issue is used to build a url
 * or a path: it is only compared.
 *
 * The text model (textModel, articleModel) is what the anchors are measured
 * against: the article's words with whitespace runs collapsed to one space,
 * and its blocks. textModel, relativeDate and popupSpot are pure and
 * Node-tested; the rest needs a DOM.
 */

import { buildIssue, makeAnchor, findAnchor, commentsForGuide, orderComments, authorEl, BODY_MAX } from './kbComments.js';
import { loadLucideBodies, lucideSvg } from './lucideIcons.js';
import { setThemeTip, KB_HOST } from './kbSite.js';
import { currentGithubLogin } from './repoClient.js';
import { attachThread } from './kbCommentsThread.js';
import { mountHeaderButton, mountPanel, titleFromDocument } from './kbCommentsPanel.js';
import { mountMargin, marginRoom } from './kbCommentsMargin.js';

const HIGHLIGHT = 'mb-kb-comment';
const STYLESHEET_ID = 'mb-kb-comments-stylesheet';
const SAVE_FAILED = "Couldn't save the comment.";
// The room left between the site's header and the words a clicked comment scrolls to.
const SCROLL_GAP = 32;
// The open comments are asked for again this often while the page is in view, and when it comes
// back into view (never more often than the second figure): one small request each time.
const REFRESH_MS = 60000;
const REFRESH_MIN_MS = 15000;
// A comment just posted is not taken for deleted if GitHub's list is a moment behind.
const FRESH_MS = 120000;

// ── The text model ───────────────────────────────────────────────────────────

/**
 * The model from a walk of the article, given as pieces in page order:
 * `{ text, node }` (a text node's data), `{ marker: id }` (a block starts here)
 * and `{ gap: true }` (an edge of a block-level element, read as a space).
 *
 * @returns {{text: string, blocks: {id: string, start: number, end: number}[], segs: {node: *, start: number, offs: number[]}[]}}
 *   segs: for each text node that kept any characters, where they start in
 *   `text` and, per character kept, its offset in the node
 */
export function textModel(pieces) {
  let text = '';
  const blocks = [];
  const segs = [];
  const spaceBefore = () => text.length > 0 && text[text.length - 1] !== ' ';
  for (const p of pieces) {
    if (p.marker != null) {
      if (blocks.length) blocks[blocks.length - 1].end = text.length;
      blocks.push({ id: String(p.marker), start: text.length, end: text.length });
    } else if (p.gap) {
      if (spaceBefore()) text += ' ';
    } else if (typeof p.text === 'string') {
      let seg = null;
      for (let i = 0; i < p.text.length; i++) {
        const ch = p.text[i];
        const ws = /\s/.test(ch);
        if (ws && !spaceBefore()) continue;
        if (!seg) { seg = { node: p.node, start: text.length, offs: [] }; segs.push(seg); }
        seg.offs.push(i);
        text += ws ? ' ' : ch;
      }
    }
  }
  if (blocks.length) blocks[blocks.length - 1].end = text.length;
  return { text, blocks, segs };
}

/** The last seg starting at or before `x`, by index; -1 when none. */
function segIndex(segs, x) {
  let lo = 0, hi = segs.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid].start <= x) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

/**
 * Where a model offset is in the DOM, as `{ node, offset }`. `side: 'start'`
 * gives the point before character `x`; `'end'` the point after character
 * `x - 1`. An offset on a space the model added (between blocks) moves to the
 * nearest real character on its side. Null for an empty model.
 */
export function pointAt(model, x, side) {
  const { segs } = model;
  if (!segs.length) return null;
  const y = side === 'end' ? x - 1 : x;
  const i = segIndex(segs, y);
  if (i < 0) return { node: segs[0].node, offset: segs[0].offs[0] };
  const seg = segs[i];
  const k = y - seg.start;
  if (k < seg.offs.length) return { node: seg.node, offset: seg.offs[k] + (side === 'end' ? 1 : 0) };
  // y is on an added space after this seg.
  if (side === 'end' || i === segs.length - 1) return { node: seg.node, offset: seg.offs[seg.offs.length - 1] + 1 };
  return { node: segs[i + 1].node, offset: segs[i + 1].offs[0] };
}

/**
 * The model offset of a DOM point. `before(node)` says whether the start of a
 * text node lies before the point. Pure apart from what `before` does.
 */
export function offsetAt(model, container, offset, before) {
  for (const seg of model.segs) {
    if (seg.node === container) {
      let k = 0;
      while (k < seg.offs.length && seg.offs[k] < offset) k++;
      return seg.start + k;
    }
    if (!before(seg.node)) return seg.start;
  }
  return model.text.length;
}

// Elements that start and end a line: their edges read as a space, so the
// words either side never run together whatever whitespace the markup has.
const BREAKS = new Set(['ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'DD', 'DETAILS', 'DIV', 'DL', 'DT',
  'FIGCAPTION', 'FIGURE', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'IMG', 'LABEL', 'LI',
  'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'SUMMARY', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL', 'VIDEO']);
const SKIPPED = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'BUTTON']);
// A block starts at each of these: the built page's hidden id spans, the editor's nodes.
const MARKER = 'span[data-uuid], [data-mb-node]';

/** Is this one of this module's own elements (or inside one)? */
const isOurs = el => !!el?.closest?.('[class^="mb-kb-comments"], [class*=" mb-kb-comments"]');

// What the extension puts in the article around the guide's words: the icons
// by the title (kbSite.js), and in edit mode the Draft / Live tabs, the pill
// in the title, the foot row, the add slots, a capture being waited for and
// the layers under the blocks (kbPageEditor.js). Not the guide's: never read
// into the model, never commented on.
const CHROME = '.md-content__button, .mb-kb-modenav, .mb-kb-statepill, .mb-kb-foot, .mb-kb-insert, .mb-kb-newtab, '
  + '.mb-kb-panel, .mb-kb-capwait, .mb-kb-upd-ghost, .mb-kb-hintlayer, .mb-kb-picklayer';
const isChrome = el => !!el?.closest?.(CHROME);

function skipped(el, view) {
  if (SKIPPED.has(el.tagName) || el.namespaceURI === 'http://www.w3.org/2000/svg' || el.hidden) return true;
  if ([...el.classList].some(c => c.startsWith('mb-kb-comments')) || el.matches(CHROME)) return true;
  // A content tab that is not showing is display:none, but its words are on
  // the page all the same: a comment on them shows the tab when clicked.
  if (el.classList.contains('tabbed-block')) return false;
  return view.getComputedStyle(el).display === 'none';
}

/**
 * The block id an element starts, or null when it starts none. An element with
 * an empty id (kbPageRender.js can draw `data-mb-node=""`) is not a marker: an
 * empty id would match every comment made before the first marker on any page.
 */
export function markerId(el) {
  if (!el.matches(MARKER)) return null;
  return el.dataset.uuid || el.dataset.mbNode || null;
}

function walk(article) {
  const view = article.ownerDocument.defaultView;
  const out = [];
  const visit = el => {
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) { out.push({ text: n.data, node: n }); continue; }
      if (n.nodeType !== 1) continue;
      const id = markerId(n);
      if (id) out.push({ marker: id });
      if (skipped(n, view)) continue;
      const edge = BREAKS.has(n.tagName);
      if (edge) out.push({ gap: true });
      visit(n);
      if (edge) out.push({ gap: true });
    }
  };
  visit(article);
  return out;
}

/**
 * The guide's own id: the id of its title (H1) section, which a rename of the
 * file or the title does not change.
 *
 * Live page: the build writes the H1 section's hidden id span on a line of its
 * own straight after the title, so it is the first child of the paragraph
 * after the H1 (checked on /pages/overview/, 2026-11-17: `<h1 id="overview">
 * Overview</h1><p><span data-uuid="f00a359d-…" style="display:none"></span>
 * </p>`; every section's span sits alone in its paragraph like that, the first
 * text block's span starts the next one). The site's "Written for" line
 * (`p.mb-written-for`, from its content.html) comes between the two on a page
 * with an audience (checked on /pages/adding-a-contractor/), and a hidden
 * title's `<style data-mb-hide-section-title>` after the span. The page's own
 * buttons (kbSite.js) go in before the H1.
 * Editor (Draft and Live tabs): the title is drawn as
 * `h1[data-mb-kind="section"][data-mb-node]`, its node id the same span's id;
 * a hidden title is drawn too (`data-mb-title-hidden`), and a placed "Page
 * title" block is an `h1.mb-page-title` inside its own block, never this one.
 * '' when there is neither (a page never given ids, the page with no draft).
 */
function guideIdOf(article) {
  const drawn = article.querySelector(':scope > h1[data-mb-kind="section"][data-mb-node]');
  if (drawn) return drawn.dataset.mbNode || '';
  let next = article.querySelector(':scope > h1')?.nextElementSibling;
  while (next?.matches('.mb-written-for')) next = next.nextElementSibling;
  const span = next?.matches('p') ? next.querySelector(':scope > span[data-uuid]:first-child') : null;
  return span?.dataset.uuid || '';
}

/**
 * The article's text model (see textModel), and the way between it and the DOM.
 * Text inside this module's own elements, script, style, `[hidden]` and
 * display:none elements is left out (content tabs that are not showing are
 * kept). A block runs from its marker (`span[data-uuid]` on the live page,
 * `[data-mb-node]` in the editor) to the next one.
 *
 * @returns {{text: string, blocks: object[], rangeFor: (start: number, end: number) => Range|null,
 *   offsetsOf: (range: Range) => {start: number, end: number}|null, guideId: string, blockIds: Set<string>}}
 */
export function articleModel(article) {
  const doc = article.ownerDocument;
  const model = textModel(walk(article));
  const at = (node, offset) => {
    const r = doc.createRange();
    r.setStart(node, offset);
    return r;
  };
  return {
    text: model.text,
    blocks: model.blocks,
    segs: model.segs,
    guideId: guideIdOf(article),
    blockIds: new Set(model.blocks.map(b => b.id)),
    rangeFor(start, end) {
      const a = pointAt(model, start, 'start');
      const b = pointAt(model, Math.max(start, end), end > start ? 'end' : 'start');
      if (!a || !b) return null;
      const r = doc.createRange();
      r.setStart(a.node, a.offset);
      r.setEnd(b.node, b.offset);
      return r;
    },
    offsetsOf(range) {
      if (!range || !article.contains(range.startContainer) || !article.contains(range.endContainer)) return null;
      const point = (c, o) => { const p = at(c, o); return node => p.comparePoint(node, 0) < 0; };
      const start = offsetAt(model, range.startContainer, range.startOffset, point(range.startContainer, range.startOffset));
      const end = offsetAt(model, range.endContainer, range.endOffset, point(range.endContainer, range.endOffset));
      return end > start ? { start, end } : null;
    },
  };
}

// ── Small pure helpers ───────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "just now", "5 min ago", "3 hours ago", "yesterday", "4 days ago", then "12 Nov" (or "12 Nov 2025" in another year). */
export function relativeDate(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const min = Math.floor(Math.max(0, now - t) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const d = new Date(t), n = new Date(now);
  const day = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === n.getFullYear() ? day : `${day} ${d.getFullYear()}`;
}

/**
 * Where the selection's comment icon goes: its top left corner at the bottom
 * right of the selection's last line, kept inside the window (above the line
 * when there is no room below it). Null when the line is out of sight.
 *
 * @param {{top: number, right: number, bottom: number}} rect - the last client rect of the selection
 * @param {{w: number, h: number}} size - the icon's
 * @param {{w: number, h: number}} view - the window's
 */
export function popupSpot(rect, size, view, gap = 4) {
  if (rect.bottom < 0 || rect.top > view.h) return null;
  let top = rect.bottom + gap;
  if (top + size.h > view.h - gap) top = rect.top - gap - size.h;
  top = Math.min(Math.max(gap, top), view.h - gap - size.h);
  const left = Math.min(Math.max(gap, rect.right), view.w - gap - size.w);
  return { left, top };
}

/** The live page's full url, for the link in an issue (always the real site's, whatever host the page came from). */
const liveLink = page => `https://${KB_HOST}${page.liveUrl}`;

// ── Where the list goes ──────────────────────────────────────────────────────
// Each placement takes the list element and puts it on the page; it returns
// `{ remove() }`, or null when the page has no room of that kind.

const PLACEMENTS = {
  /** Over the right-hand side of the page, below the header (the header button toggles it). */
  panel: (doc, list, { close }) => mountPanel(doc, list, { onClose: close }),

  /** Edit mode: in the left-hand margin, each card level with its words. */
  margin: (doc, list, ctx) => mountMargin(doc, list, ctx),

  /**
   * The live page: beside the text in the right-hand margin, under the theme's
   * "On this page", each card level with its words where it can be. The cards
   * scroll with the page and pass under the list (which stays put); none is
   * placed where the list stands at the top of the page.
   */
  beside(doc, list, ctx) {
    const root = doc.documentElement;
    const side = doc.querySelector('.md-sidebar--secondary');
    let at = null; // as measured for the layout being done
    const room = () => {
      at = besideRoom(doc);
      // The ground the cards pass under: the sidebar's top, down to just under the list (kbComments.css).
      if (at) side.style.setProperty('--mb-kb-comments-cover', `${Math.round(at.under + 6)}px`);
      return at?.room ?? null;
    };
    // Not an `mb-kb-comments…` name: on the root that would make the whole page
    // "ours" (isOurs), and no words in it could be commented on.
    root.classList.add('mb-kb-beside-comments');
    const host = mountMargin(doc, list, { ...ctx, room, floor: () => at?.floor ?? 0, side: 'right' });
    return {
      ...host,
      remove() {
        host.remove();
        root.classList.remove('mb-kb-beside-comments');
        side.style.removeProperty('--mb-kb-comments-cover');
      },
    };
  },

  /** Under the theme's "On this page", as a second list of the same kind: its title is the same element (used when the list leaves too little room beside the text). */
  toc(doc, list) {
    const inner = doc.querySelector('.md-sidebar--secondary .md-sidebar__inner');
    if (!inner) return null;
    const nav = doc.createElement('nav');
    nav.className = 'md-nav md-nav--secondary mb-kb-comments';
    nav.setAttribute('aria-label', 'Comments');
    const title = doc.createElement('label');
    title.className = 'md-nav__title';
    title.textContent = 'Comments';
    nav.append(title, list);
    const toc = [...inner.children].find(el => el.matches('nav.md-nav--secondary') && !el.classList.contains('mb-kb-comments'));
    if (toc) toc.after(nav); else inner.append(nav);
    return { remove: () => nav.remove() };
  },
};

// Under "On this page" there must be this much of the window left for cards
// beside the text; with less (a long list of headings) they go in the list's
// own scrolling column instead.
const BESIDE_MIN = 240;

/**
 * The room beside the text on the live page: the right-hand sidebar's box in
 * the window, and the page y the cards may start at (just under "On this
 * page" as it stands with the page scrolled to the top: the sidebar is sticky,
 * so where it stands now is not asked). Null when there is too little window
 * left under the list.
 */
function besideRoom(doc) {
  const win = doc.defaultView;
  const side = doc.querySelector('.md-sidebar--secondary');
  if (!side) return null;
  const room = side.getBoundingClientRect();
  const toc = [...side.querySelectorAll('nav.md-nav--secondary')].find(n => !n.hidden && n.getClientRects().length);
  const under = toc ? toc.getBoundingClientRect().bottom - room.top : 0; // the list's height, from the sidebar's top
  const sticky = parseFloat(win.getComputedStyle(side).top) || 0;       // where the sidebar's top rests once stuck
  if (win.innerHeight - sticky - under < BESIDE_MIN) return null;
  const content = doc.querySelector('.md-content')?.getBoundingClientRect();
  const rest = Math.min(room.top, content?.top ?? room.top) + win.scrollY; // the sidebar's top with the page at the top
  return { room, under, floor: rest + under };
}

/**
 * Where the list can go in this view. On the live page: 'beside' when the
 * theme's right-hand sidebar is on the page beside the article and leaves room
 * under "On this page", 'toc' (in the sidebar itself) when it does not, 'panel'
 * when there is no sidebar. In
 * edit mode: 'margin' when the left-hand margin is there (marginRoom), 'panel'
 * otherwise; never 'toc' (edit mode adds nothing to the right-hand sidebar,
 * which kbToc.js redraws). The sidebars are asked, not a width: they are gone
 * (display: none) when the theme hides them on a narrow window, `hidden` on a
 * page that hides them (`hide: [toc]`, `hide: [navigation]`), and an
 * off-canvas drawer is not a margin either.
 */
function placement(doc, mode) {
  if (mode === 'edit') return marginRoom(doc) ? 'margin' : 'panel';
  const side = doc.querySelector('.md-sidebar--secondary');
  const inner = side?.querySelector('.md-sidebar__inner');
  if (!side || !inner || side.hidden || !side.getClientRects().length) return 'panel';
  const style = doc.defaultView.getComputedStyle(side);
  if (style.visibility === 'hidden' || style.position === 'fixed' || !inner.getClientRects().length) return 'panel';
  return besideRoom(doc) ? 'beside' : 'toc';
}

// ── The comments on the page ─────────────────────────────────────────────────

// The stylesheet is shared by every instance on a document and counted: the
// link goes only when the last instance using it lets go, so an instance that
// is destroyed (or replaced) while still loading can never take away the
// sheet a live one relies on.
const sheets = new WeakMap(); // document → { link, owned, users, ready }

function acquireSheet(doc) {
  let entry = sheets.get(doc);
  if (!entry) {
    let link = doc.getElementById(STYLESHEET_ID);
    const owned = !link;
    if (owned) {
      link = doc.createElement('link');
      link.id = STYLESHEET_ID;
      link.rel = 'stylesheet';
      link.href = chrome.runtime.getURL('config/forms/kbComments.css');
      (doc.head || doc.documentElement).append(link);
    }
    const ready = owned
      ? new Promise(resolve => {
        link.addEventListener('load', resolve, { once: true });
        link.addEventListener('error', resolve, { once: true });
      })
      : Promise.resolve();
    entry = { link, owned, users: 0, ready };
    sheets.set(doc, entry);
  }
  entry.users++;
  let held = true;
  return {
    ready: entry.ready,
    release() {
      if (!held) return;
      held = false;
      if (--entry.users > 0) return;
      sheets.delete(doc);
      if (entry.owned) entry.link.remove();
    },
  };
}

// The instance on each document: a second would fight the first over the
// highlight and the selection, so starting one ends the one before.
const instances = new WeakMap(); // document → handle

const el = (doc, tag, cls, text) => {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

/**
 * Comments on the guide in `article`.
 *
 * @param {{article: HTMLElement, mode: 'live'|'edit', page: {livePath: string, liveUrl: string},
 *   canResolve?: () => boolean, shown?: () => boolean, quiet?: () => boolean, client?: object}} opts
 *   `shown`: false hides the cards, the header button and the icon (the editor's Markdown view);
 *   `quiet`: true while a selection is not for commenting on (a block being dragged, a menu open)
 * @returns {{reanchor(): void, destroy(): void}|null} null when there is no article or page
 */
export function startKbComments(opts) {
  const { article, page } = opts ?? {};
  if (!article || !page?.livePath) return null;
  const mode = opts.mode === 'edit' ? 'edit' : 'live';
  const shown = opts.shown ?? (() => true);
  const quiet = opts.quiet ?? (() => false);
  const canResolve = opts.canResolve ?? (() => false);
  const doc = article.ownerDocument;
  const win = doc.defaultView;
  instances.get(doc)?.destroy();

  let dead = false;
  let client = null;
  let login = null;
  let comments = [];       // every comment on this guide, as loaded and as posted
  let pool = [];           // the open comments not (yet) known to be this guide's
  const cards = new Map(); // comment number → its card
  const threads = new Map(); // comment number → its replies and edit tools
  let compose = null;      // the open comment box: { li, anchor, busy }
  let active = null;       // the number of the card clicked
  let host = null;         // the placement holding the list, while it has anything in it
  let hostKind = null;     // which placement `host` is
  let panelOpen = false;   // the pull-out panel is open (only means anything in the 'panel' placement)
  let button = null;       // the header button, in the 'panel' placement
  let frame = 0;           // a resize waiting for its animation frame
  let sheet = null;        // our hold on the stylesheet
  let pop = null;          // the selection's comment icon
  let pending = null;      // the anchor the icon would comment on
  let onBar = false;       // the icon for `pending` is the one on the format bar
  let pointerDown = false;
  let checkTimer = 0;
  let observer = null;
  let queued = false;      // a reanchor waiting for the end of the editor's redraw
  let retry = 0;           // a second look for the format buttons, which show a moment after the selection
  const bars = new Set();  // the format bars our comment button has been put in
  const off = [];          // listeners to take away again
  let refreshing = false;  // the open comments are being asked for again
  let refreshedAt = 0;     // when they were last asked for
  let refreshTimer = 0;
  const posted = new Map(); // comment number → when it was posted from this page

  const list = el(doc, 'ol', 'md-nav__list mb-kb-comments__list');

  /** The guide's title: its heading's words (not the editor's pill and buttons in it), or, on a page that hides it, the document's (without the site's name). */
  const guideTitle = () => {
    const h1 = article.querySelector(':scope > h1')?.cloneNode(true);
    h1?.querySelectorAll(`${CHROME}, button, svg, style, script`).forEach(e => e.remove());
    return (h1?.textContent ?? '').replace(/\s+/g, ' ').trim() || titleFromDocument(doc.title);
  };

  // The model is built again only after the article has changed.
  let model = null;
  const getModel = () => (model ??= articleModel(article));

  const listen = (target, type, fn, options) => {
    target.addEventListener(type, fn, options);
    off.push(() => target.removeEventListener(type, fn, options));
  };

  // ── The list ──

  function entries() {
    const m = getModel();
    const all = comments.map(comment => ({ comment, at: findAnchor(m, comment.anchor) }));
    if (compose) all.push({ comment: { createdAt: '￿' }, at: findAnchor(m, compose.anchor), compose: true });
    return orderComments(all);
  }

  /** Put the list's children in order, moving only those out of place (an open box keeps its focus). */
  function arrange(els) {
    let ref = list.firstChild;
    for (const e of els) {
      if (e === ref) ref = ref.nextSibling;
      else list.insertBefore(e, ref);
    }
    while (ref) { const next = ref.nextSibling; ref.remove(); ref = next; }
  }

  function draw() {
    if (dead) return;
    const ordered = entries();
    const els = ordered.map(e => {
      if (e.compose) return compose.li;
      const card = cards.get(e.comment.number) ?? makeCard(e.comment);
      cards.set(e.comment.number, card);
      markChanged(card, e.comment, e.at);
      return card;
    });
    arrange(els);
    const where = shown() ? placement(doc, mode) : null;
    // The panel comes back closed after the view has had a margin again, but a
    // box being typed in goes with the list into it, and it opens so the box
    // stays in sight.
    if (where !== 'panel') panelOpen = false;
    else if (hostKind && hostKind !== 'panel' && compose) panelOpen = true;
    syncButton(where === 'panel');
    const want = where === 'panel' ? panelOpen : where != null && els.length > 0;
    if (host && (!want || hostKind !== where)) {
      // Moving the one list: an open box keeps its words, and its focus is put back.
      const had = list.contains(doc.activeElement) ? doc.activeElement : null;
      host.remove();
      host = null;
      if (want) mount(where, had);
    } else if (want && !host) mount(where, null);
    else host?.refresh?.();
  }

  function mount(where, had) {
    host = PLACEMENTS[where]?.(doc, list, { close: () => setPanel(false), article, wants, pinned: pinnedCard }) ?? null;
    hostKind = host ? where : null;
    if (had?.isConnected && doc.activeElement !== had) had.focus({ preventScroll: true });
  }

  /** The header button, present only while the list has no margin to be in. */
  function syncButton(want) {
    if (want && !button) button = mountHeaderButton(doc, { onToggle: () => setPanel(!panelOpen) });
    else if (!want && button) { button.remove(); button = null; }
    // A box closed away in the panel keeps its words: the button says one is waiting there.
    button?.set({ count: comments.length, open: panelOpen, unsent: !!compose && !panelOpen });
  }

  function setPanel(open) {
    if (panelOpen === open) return;
    panelOpen = open;
    draw();
    if (!open) button?.el.focus({ preventScroll: true });
    else compose?.li.querySelector('textarea')?.focus({ preventScroll: true });
  }

  /** Where each card's words start on the page (page y), or null when they are not on it. */
  function wants() {
    const out = new Map();
    for (const e of entries()) {
      const li = e.compose ? compose.li : cards.get(e.comment.number);
      if (li) out.set(li, topOf(e.at));
    }
    return out;
  }

  function topOf(at) {
    if (!at) return null;
    const range = getModel().rangeFor(at.start, at.found ? at.end : at.start);
    if (!range) return null;
    const box = [...range.getClientRects()].find(r => r.width || r.height);
    if (box) return box.top + win.scrollY;
    // Words not showing (a tab not shown, a closed admonition): the nearest box round them that is.
    for (let e = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement; e && article.contains(e); e = e.parentElement) {
      const r = e.getBoundingClientRect();
      if (r.width || r.height) return r.top + win.scrollY;
    }
    return null;
  }

  /** The card that keeps its exact place beside its words: the box being written, else the one clicked. */
  const pinnedCard = () => compose?.li ?? (active != null ? cards.get(active) : null) ?? null;

  /** Cards moved for a card opened or closed. */
  const relayout = () => host?.refresh?.();

  function makeCard(c) {
    const li = el(doc, 'li', 'mb-kb-comment');
    li.tabIndex = 0;
    li.dataset.number = String(c.number);
    // The head: the name with the date under it, and the card's buttons kept in the top right corner.
    const meta = el(doc, 'div', 'mb-kb-comment__meta');
    const who = el(doc, 'div', 'mb-kb-comment__who');
    const time = el(doc, 'time', 'mb-kb-comment__date', relativeDate(c.createdAt));
    if (c.createdAt) time.dateTime = c.createdAt;
    who.append(authorEl(doc, c.author), time);
    meta.append(who);
    const text = el(doc, 'p', 'mb-kb-comment__text', c.text);
    li.append(meta, text);
    if (canResolve()) addResolve(meta, text, c);
    // The replies, the reply box and the own-comment tools are in the thread; shown while the card is open.
    li.append(el(doc, 'div', 'mb-kb-comment__replies'));
    threads.set(c.number, attachThread(li, c, {
      doc, client, relativeDate, page,
      login: () => login,
      dead: () => dead,
      guideTitle,
      liveLink: () => liveLink(page),
      onRemoved: removeComment,
      onChanged: () => draw(),
    }));
    return li;
  }

  /** Resolve (edit mode only): closes the issue as done, and the card leaves the list. No confirm. */
  function addResolve(meta, text, c) {
    const btn = el(doc, 'button', 'mb-kb-comments__icon mb-kb-comment__resolve');
    btn.type = 'button';
    btn.innerHTML = lucideSvg('check'); // the extension's own bundled markup
    setThemeTip(doc, btn, 'Resolve');
    const err = el(doc, 'p', 'mb-kb-comments__error');
    err.setAttribute('role', 'alert');
    err.hidden = true;
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if (btn.disabled) return;
      btn.disabled = true;
      err.hidden = true;
      try {
        await client.closeComment(c.number, 'completed');
        if (dead) return;
        removeComment(c.number);
      } catch (failed) {
        if (dead) return;
        err.textContent = failed?.message || "Couldn't resolve that.";
        err.hidden = false;
        btn.disabled = false;
      }
    });
    meta.append(btn);
    text.after(err);
  }

  /** The "Original text changed" note and the old words, when the words are not on the page. */
  function markChanged(card, c, at) {
    const changed = !at || !at.found;
    let note = card.querySelector(':scope > .mb-kb-comment__changed');
    if (changed === !!note) return;
    if (!changed) {
      note.remove();
      card.querySelector(':scope > .mb-kb-comment__quote')?.remove();
      return;
    }
    note = el(doc, 'p', 'mb-kb-comment__changed', 'Original text changed');
    const quote = el(doc, 'blockquote', 'mb-kb-comment__quote', c.anchor.quote);
    card.querySelector(':scope > .mb-kb-comment__replies').before(note, quote);
  }

  // ── Clicking a comment ──

  function clearActive() {
    if (active == null) return;
    cards.get(active)?.classList.remove('--active');
    active = null;
    win.CSS?.highlights?.delete(HIGHLIGHT);
    relayout();
  }

  /** Show the content tabs and open the collapsed admonitions that hold `node`. */
  function reveal(node) {
    for (let e = node.nodeType === 1 ? node : node.parentElement; e && e !== article; e = e.parentElement) {
      if (e.tagName === 'DETAILS' && !e.open) e.open = true;
      if (e.classList.contains('tabbed-block')) {
        const content = e.parentElement;
        const input = content?.parentElement?.querySelectorAll(':scope > input')[[...content.children].indexOf(e)];
        if (input && !input.checked) input.click();
      }
    }
  }

  /** Brings the start of the words to the top of the screen, just clear of the site's sticky header. */
  function scrollToRange(range) {
    // The first line's box: a long selection's own box is the whole run, and its middle may be screens away.
    let r = range.getClientRects?.()[0] || range.getBoundingClientRect();
    if (!r.width && !r.height) {
      const holder = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
      r = holder.getBoundingClientRect();
    }
    const header = win.document.querySelector('.md-header')?.getBoundingClientRect();
    const clear = Math.max(0, header?.bottom || 0) + SCROLL_GAP;
    const reduce = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    win.scrollTo({ top: Math.max(0, win.scrollY + r.top - clear), behavior: reduce ? 'auto' : 'smooth' });
  }

  function highlight(at, { scroll }) {
    const range = getModel().rangeFor(at.start, at.found ? at.end : at.start);
    if (!range) return;
    if (scroll) reveal(range.startContainer);
    if (at.found && win.CSS?.highlights && typeof win.Highlight === 'function') {
      win.CSS.highlights.set(HIGHLIGHT, new win.Highlight(range));
    }
    if (scroll) scrollToRange(range);
  }

  /** A deleted comment: its card goes and the list closes up. */
  function removeComment(number) {
    comments = comments.filter(x => x.number !== number);
    if (active === number) clearActive();
    cards.get(number)?.remove();
    cards.delete(number);
    threads.delete(number);
    draw();
  }

  function activate(card) {
    const c = comments.find(x => String(x.number) === card.dataset.number);
    if (!c) return;
    clearActive();
    active = c.number;
    card.classList.add('--active');
    const at = findAnchor(getModel(), c.anchor);
    relayout(); // beside the text, it takes its words' line and the others give way
    if (at) highlight(at, { scroll: true });
    threads.get(c.number)?.open();
  }

  // ── The comment box ──

  function openCompose(anchor) {
    if (compose) {
      // A box with words in it is kept: those are not thrown away for a new selection.
      const kept = compose.li.querySelector('textarea');
      if (kept.value.trim()) { hidePop(); kept.focus(); return; }
      closeCompose();
    }
    const li = el(doc, 'li', 'mb-kb-comments__compose');
    const meta = el(doc, 'div', 'mb-kb-comment__meta');
    const who = el(doc, 'div', 'mb-kb-comment__who');
    who.append(authorEl(doc, login));
    meta.append(who);
    const quote = el(doc, 'blockquote', 'mb-kb-comment__quote', anchor.quote);
    const box = el(doc, 'textarea', 'mb-kb-comments__input');
    box.rows = 2;
    box.maxLength = BODY_MAX;
    box.placeholder = 'Add a comment';
    box.setAttribute('aria-label', 'Comment');
    const error = el(doc, 'p', 'mb-kb-comments__error');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    const actions = el(doc, 'div', 'mb-kb-comments__actions');
    const cancel = el(doc, 'button', 'mb-kb-comments__btn', 'Cancel');
    cancel.type = 'button';
    const send = el(doc, 'button', 'mb-kb-comments__btn --accent');
    send.type = 'button';
    send.disabled = true;
    const spin = el(doc, 'span', 'mb-kb-comments__spin');
    spin.innerHTML = lucideSvg('loader-circle'); // the extension's own bundled markup
    send.append(spin, el(doc, 'span', '', 'Comment'));
    actions.append(cancel, send);
    li.append(meta, quote, box, error, actions);
    if (!login) meta.hidden = true;

    compose = { li, anchor, busy: false };
    const setBusy = on => {
      compose.busy = on;
      send.classList.toggle('--busy', on);
      send.setAttribute('aria-busy', String(on));
      send.disabled = on || !box.value.trim();
      cancel.disabled = on;
      box.readOnly = on; // what is being posted is what was typed
    };
    const post = async () => {
      const text = box.value.trim();
      if (!text || !compose || compose.busy) return;
      const mine = compose;
      setBusy(true);
      error.hidden = true;
      try {
        const made = await client.createComment(buildIssue({ text, guideTitle: guideTitle(), liveUrl: liveLink(page), anchor }));
        if (!made) throw new Error(SAVE_FAILED);
        if (dead || compose !== mine) return;
        comments.push(made);
        posted.set(made.number, Date.now());
        const card = makeCard(made);
        cards.set(made.number, card);
        li.replaceWith(card); // the new card takes the box's place
        compose = null;
        draw();
      } catch (err) {
        if (dead || compose !== mine) return;
        error.textContent = err?.message || SAVE_FAILED;
        error.hidden = false;
        setBusy(false);
        box.focus();
      }
    };
    box.addEventListener('input', () => { if (!compose?.busy) send.disabled = !box.value.trim(); });
    box.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); post(); }
      else if (e.key === 'Escape') { e.preventDefault(); if (!compose?.busy) closeCompose(); }
    });
    cancel.addEventListener('click', () => { if (!compose?.busy) closeCompose(); });
    send.addEventListener('click', post);

    hidePop();
    if (shown() && placement(doc, mode) === 'panel') panelOpen = true; // the box must be where it can be seen
    draw();
    box.focus({ preventScroll: true });
    li.scrollIntoView?.({ block: 'nearest' });
  }

  function closeCompose() {
    if (!compose) return;
    compose.li.remove();
    compose = null;
    draw();
  }

  // ── The selection's comment icon ──

  function makePop() {
    pop = el(doc, 'div', 'mb-kb-comments-pop');
    pop.hidden = true;
    const btn = el(doc, 'button', 'mb-kb-comments-pop__btn');
    btn.type = 'button';
    btn.innerHTML = lucideSvg('message-square-plus'); // the extension's own bundled markup
    setThemeTip(doc, btn, 'Add a comment');
    // Pressing it must not take the selection away.
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', () => { if (pending) openCompose(pending); });
    pop.append(btn);
    doc.body.append(pop);
  }

  function hidePop() {
    pending = null;
    onBar = false;
    if (pop) pop.hidden = true;
    for (const bar of bars) {
      if (bar.isConnected) setBarButton(bar, false); else bars.delete(bar); // that text's editing has ended
    }
  }

  /** The selection's range, when it is words in the article (not in our own elements, nor the editor's around them). */
  function articleSelection() {
    const sel = doc.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const inside = n => {
      const e = n.nodeType === 1 ? n : n.parentElement;
      return article.contains(n) && !isOurs(e) && !isChrome(e);
    };
    return inside(range.startContainer) && inside(range.endContainer) ? range : null;
  }

  // ── The comment button on the draft's format buttons ──
  // In the draft the format buttons float over highlighted text
  // (richTextEditor.js attachRichSurface: one `.mb-rte-float` host per text
  // being typed in, on <body>). The comment icon joins the end of that bar,
  // after a line like the bar's own edge, instead of standing apart.

  /** The format bar showing over the selection, or null. */
  const formatBar = () => doc.querySelector('.mb-rte-float:not([hidden]) > .mb-rte-float__bar:not([hidden])');

  function setBarButton(bar, on) {
    let btn = bar.querySelector(':scope > .mb-kb-comments-barbtn');
    if (!btn && !on) return;
    if (!btn) {
      const line = el(doc, 'span', 'mb-kb-comments-barsep');
      line.setAttribute('aria-hidden', 'true');
      btn = el(doc, 'button', 'mb-rte__btn mb-kb-comments-barbtn');
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Add a comment');
      btn.innerHTML = lucideSvg('message-square-plus'); // the extension's own bundled markup
      setThemeTip(doc, btn, 'Add a comment');
      // Pressing it must not take the selection out of the text.
      btn.addEventListener('mousedown', e => e.preventDefault());
      btn.addEventListener('click', () => { if (pending) openCompose(pending); });
      bar.append(line, btn);
      bars.add(bar);
    }
    btn.hidden = !on;
    btn.previousElementSibling.hidden = !on;
  }

  function inSurface(range) {
    const n = range.commonAncestorContainer;
    return !!(n.nodeType === 1 ? n : n.parentElement)?.closest('[contenteditable="true"]');
  }

  function placePop(range) {
    const rects = [...range.getClientRects()];
    const last = rects.reverse().find(r => r.width > 0) ?? rects[0];
    if (!last) { pop.hidden = true; return; }
    pop.hidden = false;
    const spot = popupSpot(last, { w: pop.offsetWidth, h: pop.offsetHeight }, { w: doc.documentElement.clientWidth, h: win.innerHeight });
    if (!spot) { pop.hidden = true; return; }
    pop.style.left = `${spot.left}px`;
    pop.style.top = `${spot.top}px`;
  }

  function checkSelection(again = false) {
    checkTimer = 0;
    if (retry) { win.clearTimeout(retry); retry = 0; }
    if (dead || !shown() || quiet()) return hidePop();
    const range = articleSelection();
    if (!range) return hidePop();
    const m = getModel();
    const at = m.offsetsOf(range);
    const anchor = at && makeAnchor(m, at.start, at.end, { guide: m.guideId, page: page.livePath });
    if (!anchor) return hidePop();
    pending = anchor;
    const bar = formatBar();
    for (const b of bars) if (b !== bar) setBarButton(b, false);
    if (bar) {
      pop.hidden = true;
      onBar = true;
      setBarButton(bar, true);
      return;
    }
    onBar = false;
    // Text being typed in has its format buttons, which come up a moment
    // after the selection does: look once more before standing the icon alone.
    if (!again && inSurface(range)) {
      pop.hidden = true;
      retry = win.setTimeout(() => { retry = 0; checkSelection(true); }, 80);
      return;
    }
    placePop(range);
  }
  const queueCheck = () => { if (!checkTimer) checkTimer = win.setTimeout(checkSelection, 0); };

  function follow() {
    if (!pending || !pop || onBar) return; // the format bar follows its text itself
    const range = articleSelection();
    if (range) placePop(range); else hidePop();
  }

  // ── Start, re-anchor, stop ──

  function wire() {
    makePop();
    listen(doc, 'selectionchange', () => { if (pointerDown) hidePop(); else queueCheck(); });
    listen(doc, 'pointerdown', e => {
      const t = e.target instanceof win.Element ? e.target : null;
      if (pop?.contains(t)) return;
      pointerDown = true;
      if (!t?.closest('li.mb-kb-comment, .mb-kb-comments-panel, .mb-kb-comments-btn')) clearActive();
    }, true);
    listen(doc, 'pointerup', () => { pointerDown = false; queueCheck(); }, true);
    // A drag (the text's own, or a block's) or a cancelled pointer never sends a pointerup.
    listen(doc, 'pointercancel', () => { pointerDown = false; }, true);
    listen(doc, 'dragend', () => { pointerDown = false; }, true);
    listen(doc, 'keyup', queueCheck, true);
    listen(win, 'scroll', follow, { capture: true, passive: true });
    listen(win, 'resize', () => {
      follow();
      // The view may have gained or lost its margin: move the list (once per frame).
      if (!frame) frame = win.requestAnimationFrame(() => { frame = 0; draw(); });
    }, { passive: true });
    listen(doc, 'keydown', e => {
      // Escape closes the panel, unless a box in it has just used the key
      // itself, or it was pressed in a reply or an edit with words in it.
      if (e.key !== 'Escape' || !panelOpen || e.defaultPrevented) return;
      const t = e.target;
      if (t instanceof win.HTMLTextAreaElement && list.contains(t) && t.value.trim()) return;
      e.preventDefault();
      setPanel(false);
    });
    list.addEventListener('click', e => {
      const card = e.target.closest('li.mb-kb-comment');
      if (card && !e.target.closest('button, a, textarea, input, .mb-kb-comment__replies, .mb-kb-comment__edit')) activate(card);
    });
    list.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('li.mb-kb-comment')) { e.preventDefault(); activate(e.target); }
    });
    listen(doc, 'visibilitychange', () => { if (!doc.hidden) refresh(); });
    refreshTimer = win.setInterval(refresh, REFRESH_MS);
    const MO = win.MutationObserver;
    observer = new MO(() => { model = null; });
    observer.observe(article, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'style', 'class'] });
  }

  async function load() {
    try {
      client = opts.client ?? await import('./kbCommentsClient.js');
      const res = await client.listOpenComments();
      if (dead) return;
      if (!res?.ok) {
        if (res?.reason !== 'no-access') console.warn('MB Warn: could not load the comments on this page', res?.status ?? '');
        return;
      }
      pool = res.comments;
      adopt();
      sheet = acquireSheet(doc); // taken now, so a destroy while loading lets it go
      await Promise.all([sheet.ready, loadLucideBodies(), currentGithubLogin().then(l => { login = l; }, () => {})]);
      if (dead) return;
      wire();
      draw();
    } catch (err) {
      console.warn('MB Warn: could not load the comments on this page', err);
    }
  }

  /**
   * Ask for the open comments again, so what other people have done since the
   * page loaded shows without a reload: a comment resolved or deleted leaves
   * the list, a new one joins it. A card with something typed in it unsent is
   * left alone (its Reply says why it can't be sent). A failed request changes
   * nothing and says nothing; the next one tries again.
   */
  async function refresh() {
    if (dead || refreshing || !client || !observer || doc.hidden) return;
    if (Date.now() - refreshedAt < REFRESH_MIN_MS) return;
    refreshing = true;
    refreshedAt = Date.now();
    try {
      const res = await client.listOpenComments();
      if (dead || !res?.ok) return;
      const open = new Set(res.comments.map(c => c.number));
      for (const c of [...comments]) {
        if (open.has(c.number)) continue;
        if (Date.now() - (posted.get(c.number) ?? 0) < FRESH_MS) continue;
        if (threads.get(c.number)?.busy()) continue;
        removeComment(c.number); // draws
      }
      const have = new Set(comments.map(c => c.number));
      const before = comments.length;
      pool = res.comments.filter(c => !have.has(c.number));
      adopt();
      if (comments.length !== before) draw();
    } catch (err) {
      console.warn('MB Warn: could not refresh the comments on this page', err);
    } finally {
      refreshing = false;
    }
  }

  /**
   * Take on the open comments that belong to this guide as the article now
   * shows it. In edit mode the Draft and Live tabs hold different blocks: a
   * comment found by a block id in one stays in the list in the other (as
   * "Original text changed" there), it is never dropped again.
   */
  function adopt() {
    if (!pool.length) return;
    const m = getModel();
    const mine = new Set(commentsForGuide(pool, { guide: m.guideId, page: page.livePath, blockIds: m.blockIds }));
    if (!mine.size) return;
    comments.push(...pool.filter(c => mine.has(c)));
    pool = pool.filter(c => !mine.has(c));
  }

  function reanchorNow() {
    queued = false;
    if (dead) return;
    model = null;
    if (!client || !observer) return; // still loading: it draws when it is ready
    if (!shown()) hidePop();
    adopt();
    draw(); // also finds out again where the list belongs
    if (active != null) {
      win.CSS?.highlights?.delete(HIGHLIGHT);
      const c = comments.find(x => x.number === active);
      const at = c && findAnchor(getModel(), c.anchor);
      if (at) highlight(at, { scroll: false });
    }
  }

  load();

  const handle = {
    /**
     * The article has been drawn again: find every comment's words afresh.
     * Called several times in one redraw (the editor's render and the page
     * chrome after it), it is done once, when that redraw has finished and
     * before the page is painted.
     */
    reanchor() {
      if (dead || queued) return;
      queued = true;
      queueMicrotask(reanchorNow);
    },
    /** Take away everything this added: elements, listeners, the highlight, the stylesheet. */
    destroy() {
      if (dead) return;
      dead = true;
      if (instances.get(doc) === handle) instances.delete(doc);
      if (checkTimer) win.clearTimeout(checkTimer);
      if (retry) win.clearTimeout(retry);
      if (refreshTimer) win.clearInterval(refreshTimer);
      off.splice(0).forEach(f => f());
      observer?.disconnect();
      if (frame) win.cancelAnimationFrame(frame);
      host?.remove();
      host = null;
      button?.remove();
      button = null;
      pop?.remove();
      for (const bar of bars) bar.querySelectorAll(':scope > .mb-kb-comments-barbtn, :scope > .mb-kb-comments-barsep').forEach(e => e.remove());
      bars.clear();
      list.remove();
      if (active != null) win.CSS?.highlights?.delete(HIGHLIGHT);
      sheet?.release();
      sheet = null;
    },
  };
  instances.set(doc, handle);
  return handle;
}
