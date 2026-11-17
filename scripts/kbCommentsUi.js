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
 * Where the list goes is one swappable piece (PLACEMENTS): under the theme's
 * "On this page" list for now.
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

import { buildIssue, makeAnchor, findAnchor, commentsForGuide, orderComments } from './kbComments.js';
import { loadLucideBodies, lucideSvg } from './lucideIcons.js';
import { setThemeTip, KB_HOST } from './kbSite.js';
import { currentGithubLogin } from './repoClient.js';

const HIGHLIGHT = 'mb-kb-comment';
const STYLESHEET_ID = 'mb-kb-comments-stylesheet';
const SAVE_FAILED = "Couldn't save the comment.";

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

function skipped(el, view) {
  if (SKIPPED.has(el.tagName) || el.namespaceURI === 'http://www.w3.org/2000/svg' || el.hidden) return true;
  if ([...el.classList].some(c => c.startsWith('mb-kb-comments'))) return true;
  // A content tab that is not showing is display:none, but its words are on
  // the page all the same: a comment on them shows the tab when clicked.
  if (el.classList.contains('tabbed-block')) return false;
  return view.getComputedStyle(el).display === 'none';
}

function walk(article) {
  const view = article.ownerDocument.defaultView;
  const out = [];
  const visit = el => {
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) { out.push({ text: n.data, node: n }); continue; }
      if (n.nodeType !== 1) continue;
      if (n.matches(MARKER)) out.push({ marker: n.dataset.uuid ?? n.dataset.mbNode ?? '' });
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
 * after the H1: `article > h1 + p > span[data-uuid]:first-child` (checked on
 * /pages/overview/, 2026-11-17: `<h1 id="overview">Overview</h1>
 * <p><span data-uuid="f00a359d-…" style="display:none"></span></p>`; every
 * section's span sits alone in its paragraph like that, the first text
 * block's span starts the next one). The page's own buttons (kbSite.js) go in
 * before the H1, never between it and that paragraph.
 * Editor: the title is drawn as `h1[data-mb-kind="section"][data-mb-node]`.
 * '' when there is neither (a page never given ids).
 */
function guideIdOf(article) {
  const span = article.querySelector(':scope > h1 + p > span[data-uuid]:first-child');
  if (span) return span.dataset.uuid || '';
  return article.querySelector(':scope > h1[data-mb-kind="section"][data-mb-node]')?.dataset.mbNode || '';
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
  /** Under the theme's "On this page", as a second list of the same kind: its title is the same element. */
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

const placement = () => 'toc';

// ── The comments on the page ─────────────────────────────────────────────────

function loadSheet(doc) {
  if (doc.getElementById(STYLESHEET_ID)) return Promise.resolve(null);
  const link = doc.createElement('link');
  link.id = STYLESHEET_ID;
  link.rel = 'stylesheet';
  link.href = chrome.runtime.getURL('config/forms/kbComments.css');
  (doc.head || doc.documentElement).append(link);
  return new Promise(resolve => {
    link.addEventListener('load', () => resolve(link), { once: true });
    link.addEventListener('error', () => resolve(link), { once: true });
  });
}

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
 *   canResolve?: () => boolean, shown?: () => boolean, client?: object}} opts
 * @returns {{reanchor(): void, destroy(): void}|null} null when there is no article or page
 */
export function startKbComments(opts) {
  const { article, page } = opts ?? {};
  if (!article || !page?.livePath) return null;
  const shown = opts.shown ?? (() => true);
  const doc = article.ownerDocument;
  const win = doc.defaultView;

  let dead = false;
  let client = null;
  let login = null;
  let comments = [];       // every comment on this guide, as loaded and as posted
  const cards = new Map(); // comment number → its card
  let compose = null;      // the open comment box: { li, anchor, busy }
  let active = null;       // the number of the card clicked
  let host = null;         // the placement holding the list, while it has anything in it
  let sheet = null;        // our stylesheet, when we added it
  let pop = null;          // the selection's comment icon
  let pending = null;      // the anchor the icon would comment on
  let pointerDown = false;
  let checkTimer = 0;
  let observer = null;
  const off = [];          // listeners to take away again

  const list = el(doc, 'ol', 'md-nav__list mb-kb-comments__list');

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
    const want = shown() && els.length > 0;
    if (want && !host) host = PLACEMENTS[placement()]?.(doc, list) ?? null;
    if (!want && host) { host.remove(); host = null; }
  }

  function makeCard(c) {
    const li = el(doc, 'li', 'mb-kb-comment');
    li.tabIndex = 0;
    li.dataset.number = String(c.number);
    const meta = el(doc, 'div', 'mb-kb-comment__meta');
    meta.append(el(doc, 'span', 'mb-kb-comment__author', c.author));
    const time = el(doc, 'time', 'mb-kb-comment__date', relativeDate(c.createdAt));
    if (c.createdAt) time.dateTime = c.createdAt;
    meta.append(time);
    li.append(meta, el(doc, 'p', 'mb-kb-comment__text', c.text));
    // Filled by the replies (a later piece of work); shown while the card is open.
    li.append(el(doc, 'div', 'mb-kb-comment__replies'));
    return li;
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

  function scrollToRange(range) {
    let r = range.getBoundingClientRect();
    if (!r.width && !r.height) {
      const holder = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
      r = holder.getBoundingClientRect();
    }
    const reduce = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    win.scrollTo({ top: Math.max(0, win.scrollY + r.top + r.height / 2 - win.innerHeight / 2), behavior: reduce ? 'auto' : 'smooth' });
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

  function activate(card) {
    const c = comments.find(x => String(x.number) === card.dataset.number);
    if (!c) return;
    clearActive();
    active = c.number;
    card.classList.add('--active');
    const at = findAnchor(getModel(), c.anchor);
    if (at) highlight(at, { scroll: true });
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
    const who = el(doc, 'span', 'mb-kb-comment__author', login ?? '');
    meta.append(who);
    const quote = el(doc, 'blockquote', 'mb-kb-comment__quote', anchor.quote);
    const box = el(doc, 'textarea', 'mb-kb-comments__input');
    box.rows = 2;
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
        const guideTitle = (article.querySelector(':scope > h1')?.textContent ?? '').replace(/\s+/g, ' ').trim();
        const made = await client.createComment(buildIssue({ text, guideTitle, liveUrl: liveLink(page), anchor }));
        if (!made) throw new Error(SAVE_FAILED);
        if (dead || compose !== mine) return;
        comments.push(made);
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
    if (pop) pop.hidden = true;
  }

  /** The selection's range, when it is words in the article (not in our own elements). */
  function articleSelection() {
    const sel = doc.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const inside = n => article.contains(n) && !isOurs(n.nodeType === 1 ? n : n.parentElement);
    return inside(range.startContainer) && inside(range.endContainer) ? range : null;
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

  function checkSelection() {
    checkTimer = 0;
    if (dead || !shown()) return hidePop();
    const range = articleSelection();
    if (!range) return hidePop();
    const m = getModel();
    const at = m.offsetsOf(range);
    const anchor = at && makeAnchor(m, at.start, at.end, { guide: m.guideId, page: page.livePath });
    if (!anchor) return hidePop();
    pending = anchor;
    placePop(range);
  }
  const queueCheck = () => { if (!checkTimer) checkTimer = win.setTimeout(checkSelection, 0); };

  function follow() {
    if (!pending || !pop) return;
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
      if (!t?.closest('li.mb-kb-comment')) clearActive();
    }, true);
    listen(doc, 'pointerup', () => { pointerDown = false; queueCheck(); }, true);
    listen(doc, 'keyup', queueCheck, true);
    listen(win, 'scroll', follow, { capture: true, passive: true });
    listen(win, 'resize', follow, { passive: true });
    list.addEventListener('click', e => {
      const card = e.target.closest('li.mb-kb-comment');
      if (card && !e.target.closest('button, a, textarea, input')) activate(card);
    });
    list.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('li.mb-kb-comment')) { e.preventDefault(); activate(e.target); }
    });
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
      const m = getModel();
      comments = commentsForGuide(res.comments, { guide: m.guideId, page: page.livePath, blockIds: m.blockIds });
      const [link] = await Promise.all([loadSheet(doc), loadLucideBodies(), currentGithubLogin().then(l => { login = l; }, () => {})]);
      sheet = link;
      if (dead) { sheet?.remove(); return; }
      wire();
      draw();
    } catch (err) {
      console.warn('MB Warn: could not load the comments on this page', err);
    }
  }

  load();

  return {
    /** The article has been drawn again: find every comment's words afresh. */
    reanchor() {
      if (dead) return;
      model = null;
      if (!client || !observer) return; // still loading: it draws when it is ready
      if (!shown()) hidePop();
      draw();
      if (active != null) {
        win.CSS?.highlights?.delete(HIGHLIGHT);
        const c = comments.find(x => x.number === active);
        const at = c && findAnchor(getModel(), c.anchor);
        if (at) highlight(at, { scroll: false });
      }
    },
    /** Take away everything this added: elements, listeners, the highlight, the stylesheet. */
    destroy() {
      if (dead) return;
      dead = true;
      if (checkTimer) win.clearTimeout(checkTimer);
      off.splice(0).forEach(f => f());
      observer?.disconnect();
      host?.remove();
      host = null;
      pop?.remove();
      list.remove();
      if (active != null) win.CSS?.highlights?.delete(HIGHLIGHT);
      sheet?.remove();
    },
  };
}
