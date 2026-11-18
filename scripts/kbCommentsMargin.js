/**
 * kbCommentsMargin.js — where the comments go in edit mode (kbPageEditor.js):
 * beside the text, in the empty left-hand margin. The theme's navigation keeps
 * its room there in edit mode but is hidden (formsStyling.css), so the room is
 * free; this draws a column over it, on <body>, that scrolls with the page.
 *
 * Each card stands level with the top of its words where it can, otherwise
 * just below the card above it (kbComments.js stackTops). The card clicked, or
 * a comment box being written, keeps its exact place and its neighbours give
 * way; none is ever drawn above the article (clampTops), and the stack is moved
 * up to end at the article's bottom rather than run over the footer (boundTops). Comments whose words
 * cannot be found follow the last one placed.
 *
 * kbCommentsUi.js decides when this placement is used (marginRoom) and says
 * where each card wants to be (`wants`); this file only measures and places.
 * Nothing is added to the article: the editor's content, its undo and its
 * Save never see any of it.
 */

import { stackTops, clampTops, boundTops } from './kbComments.js';

const GAP = 8;
// The navigation's room is narrower than this only when the theme is about to
// fold it away: too little to read a comment in.
const MIN_WIDTH = 140;

/**
 * The left-hand margin's box in the window, when the view has one beside the
 * article: the theme's primary sidebar is on the page, not `hidden` (as under
 * `hide: [navigation]`), takes its room in the flow (not the off-canvas drawer
 * of a narrow window) and is wide enough. Null otherwise. Its `visibility` is
 * not asked: edit mode hides it on purpose, and the room is what is used.
 *
 * @param {Document} doc
 * @returns {DOMRect|null}
 */
export function marginRoom(doc) {
  const side = doc.querySelector('.md-sidebar--primary');
  if (!side || side.hidden || !side.getClientRects().length) return null;
  const style = doc.defaultView.getComputedStyle(side);
  if (style.display === 'none' || style.position === 'fixed' || style.position === 'absolute') return null;
  const room = side.getBoundingClientRect();
  return room.width >= MIN_WIDTH ? room : null;
}

/**
 * The column, with `list` (the core's `<ol>` of cards) in it.
 *
 * @param {Document} doc
 * @param {HTMLElement} list
 * @param {{article: HTMLElement, wants: () => Map<Element, number|null>, pinned: () => Element|null,
 *   room?: () => DOMRect|null, floor?: () => number, side?: 'left'|'right'}} opts
 *   `wants`: for each card in the list, the page y its words start at (null: not on the page);
 *   `pinned`: the card that keeps its exact place, or null;
 *   `room`: the column's box in the window (the left-hand margin when not given);
 *   `floor`: a page y no card is placed above (the article's top is always one);
 *   `side`: which margin it is, for the column's own padding (kbComments.css)
 * @returns {{el: HTMLElement, refresh(): void, remove(): void}}
 */
export function mountMargin(doc, list, { article, wants, pinned, room: roomOf = () => marginRoom(doc), floor: floorOf = null, side = 'left' }) {
  const win = doc.defaultView;
  const host = doc.createElement('div');
  host.className = `mb-kb-comments-margin --${side}`;
  host.setAttribute('role', 'complementary');
  host.setAttribute('aria-label', 'Comments');
  host.append(list);
  doc.body.append(host);

  let dead = false;
  let timer = 0;
  let frame = 0;

  function layout() {
    if (dead) return;
    const room = roomOf();
    if (!room) return; // the core moves the list on (its resize handler asks placement() again)
    const box = article.getBoundingClientRect();
    const floor = box.top + win.scrollY;
    host.style.left = `${Math.round(room.left + win.scrollX)}px`;
    host.style.width = `${Math.round(room.width)}px`;
    host.style.top = `${Math.round(floor)}px`;
    const want = wants();
    const items = [];
    let last = 0;
    for (const li of list.children) {
      const y = want.get(li);
      const top = y == null ? last : y - floor; // not on the page: after the one placed last
      if (y != null) last = top;
      items.push({ id: li, want: top, height: li.offsetHeight });
    }
    const pin = pinned();
    const min = floorOf ? Math.max(0, floorOf() - floor + GAP) : 0; // in the column's own px
    const stacked = clampTops(items, stackTops(items, { gap: GAP, pinned: items.some(it => it.id === pin) ? pin : null }), { gap: GAP, floor: min });
    const tops = boundTops(items, stacked, { gap: GAP, floor: min, ceiling: box.height });
    for (const it of items) {
      const top = `${Math.round(tops.get(it.id))}px`;
      if (it.id.style.top !== top) it.id.style.top = top;
    }
    // Moves are eased from here on; the first placing is not.
    if (!host.classList.contains('--placed')) frame = win.requestAnimationFrame(() => { frame = 0; host.classList.add('--placed'); });
  }

  // A card that changes height (opened, closed, its replies loaded, a box
  // growing as it is typed in) moves the ones under it before the next paint.
  const watched = new Set();
  const cards = new win.ResizeObserver(() => layout());
  const watch = () => {
    for (const li of list.children) if (!watched.has(li)) { watched.add(li); cards.observe(li); }
    for (const li of watched) if (li.parentNode !== list) { watched.delete(li); cards.unobserve(li); }
  };
  const lists = new win.MutationObserver(() => { watch(); layout(); });
  lists.observe(list, { childList: true });
  watch();

  // The article changing height (typing a line more, an image loading) moves
  // the words under it: the cards follow once it has settled for a moment, so
  // the text model is not read again on every key.
  const later = () => {
    if (timer) win.clearTimeout(timer);
    timer = win.setTimeout(() => { timer = 0; layout(); }, 150);
  };
  const page = new win.ResizeObserver(later);
  page.observe(article);
  article.addEventListener('load', later, true);

  layout();
  return {
    el: host,
    refresh: layout,
    remove() {
      dead = true;
      if (timer) win.clearTimeout(timer);
      if (frame) win.cancelAnimationFrame(frame);
      cards.disconnect();
      lists.disconnect();
      page.disconnect();
      article.removeEventListener('load', later, true);
      for (const li of list.children) li.style.removeProperty('top');
      host.remove();
    },
  };
}
