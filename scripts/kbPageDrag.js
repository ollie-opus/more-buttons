/**
 * kbPageDrag.js — dragging a block or a section to a new place in the in-page
 * editor (kbPageEditor.js), by a press on it with Shift held.
 *
 * Such a press that moves a few pixels becomes a drag: what is being
 * moved dims where it stands and a small copy of it goes with the pointer
 * (carryBlocks; a tab's label goes whole, and draws in what its tab is showing:
 * carryTab; a thing dragged from the Add card's icons, not on the page yet, goes as a small
 * tile of its icon and name: carryChip), a line shows where it would land, and the window scrolls when the
 * pointer nears its top or bottom edge. Letting go there makes the move (one
 * op, see kbPageOps moveTo / moveSectionTo); Escape, or letting go where there
 * is nowhere to land, leaves the page as it was.
 *
 * Where something can land is read off the page as kbPageRender.js drew it:
 *
 *   - a block (a component or a text block) goes between any two blocks of any
 *     container: a section, an admonition, the tab that is showing, a column
 *     of a row. The container is the innermost one under the pointer, so
 *     nesting follows the pointer sideways as well as down;
 *   - or beside one: held at the left or right edge of a block, or of a column
 *     of a row, it lands in a column of its own there (an upright line shows
 *     where: sideTarget). That is how blocks come to stand side by side;
 *   - a section goes between the sections of the page; a subsection between
 *     the subsections of its own section, or out of it, between the sections
 *     of the page (it becomes one). Under another section, either goes by
 *     that section's tile, to its end (kbPageEditor nestOpen).
 *
 * A tab is moved among its group's labels by its own label (tabTarget), and
 * a block being dragged can be held over a label to show that tab (labelAt).
 *
 * The geometry is pure (gapIndex, edgeSpeed, gapLineY, rowGap, sideOf,
 * carriedScale, drawnIn) and Node-tested; the
 * rest needs a DOM.
 */

const THRESHOLD = 4;   // px the pointer travels before a press is a drag
export const EDGE = 80; // px from the top / bottom of the view where scrolling starts
const MAX_SPEED = 24;  // px per frame at the very edge
const NEAR = 6;        // px inside a box's top / bottom that still mean "beside it"
const ROW_GAP = 4;     // px the line stands off the first / last label of a tab row
const ROW_REACH = 40;  // px above / below a tab row that still mean "in the row"
const GAP = 5;         // px the line stands off the first / last block of a list
const OUTSIDE = 8;     // px more at the end of the page, where the line would lie on the faint line round the last section

const SIDE_PART = 0.18; // of a block's width, at each end, that means "beside it"...
const SIDE_MIN = 14;    // ...never less than this many px,
const SIDE_MAX = 48;    // nor more
const SIDE_OUT = 44;    // px out past a block's end, in the margin where its upright line stands, that still mean "beside it"
const SIDE_PROBE = 22;  // px apart the points looked at, in towards the block, from a pointer out there
const SIDE_COLUMN = 16; // px at each end of a column that mean "beside it": the gap between two columns means it as well
const SIDE_GAP = 8;     // px the upright line stands off a block with nothing beside it

const CARRY_WIDTH = 180;   // px wide a carried copy of a block is, about
const CARRY_HEIGHT = 90;   // px of it that show: the rest is cut off
const DRAW_MS = 340;       // how long one piece of a tab takes to be drawn into its label
const DRAW_STAGGER = 45;   // ms each piece sets off after the one before
const DRAW_LATEST = 6;     // pieces after this many set off together

const BLOCK_KINDS = new Set(['leaf', 'admonition', 'tabs', 'grid']);
const BOX_SEL = '.admonition[data-mb-node], details[data-mb-node], .tabbed-block[data-mb-node], [data-mb-kind="cell"]';

// ── Geometry (pure) ──────────────────────────────────────────────────────────

/** How many of `mids` (the vertical middles of a list's blocks, in order) lie above `y`. */
export function gapIndex(mids, y) {
  let n = 0;
  while (n < mids.length && mids[n] < y) n++;
  return n;
}

/** Scroll speed (px per frame, negative is up) for a pointer at `y` in a view from `top` to `bottom`. */
export function edgeSpeed(y, top, bottom) {
  if (bottom - top < EDGE * 2) return 0;
  const ramp = d => Math.round(MAX_SPEED * Math.min(1, Math.max(0, (EDGE - d) / EDGE)) ** 2);
  if (y < top + EDGE) return -ramp(y - top);
  if (y > bottom - EDGE) return ramp(bottom - y);
  return 0;
}

/**
 * Where the line is drawn for gap `i` of a list whose blocks have these
 * `{ top, bottom }` boxes: midway between two blocks, just clear of the first
 * or the last, or at `empty` when the list has none.
 */
export function gapLineY(boxes, i, empty) {
  const prev = boxes[i - 1];
  const next = boxes[i];
  if (prev && next) return (prev.bottom + next.top) / 2;
  if (next) return next.top - GAP;
  if (prev) return prev.bottom + GAP;
  return empty;
}

/**
 * A row of tab labels (`{ left, right }` boxes, in order) and a pointer at
 * `x`: the gap it is at, counted from the labels' middles, and where that
 * gap's line stands (midway between two labels, just clear of the first or
 * the last; null for a row with no labels).
 */
export function rowGap(boxes, x) {
  const at = gapIndex(boxes.map(b => (b.left + b.right) / 2), x);
  const prev = boxes[at - 1];
  const next = boxes[at];
  const lineX = prev && next ? (prev.right + next.left) / 2 : next ? next.left - ROW_GAP : prev ? prev.right + ROW_GAP : null;
  return { at, lineX };
}

/**
 * Which end of a box (`{ left, right }`) a pointer at `x` is at: 'left' or
 * 'right' within a strip at each end (`strip` px; left out, a share of the
 * box's width, within limits), null in between. In a box too narrow for both strips, the nearer end.
 */
export function sideOf(box, x, strip = Math.min(SIDE_MAX, Math.max(SIDE_MIN, (box.right - box.left) * SIDE_PART))) {
  const fromLeft = x - box.left;
  const fromRight = box.right - x;
  if (fromLeft > strip && fromRight > strip) return null;
  return fromLeft <= fromRight ? 'left' : 'right';
}

/** How much smaller a block `width` px wide is carried: never full size, never too small to tell what it is. */
export function carriedScale(width) {
  return Math.min(0.35, Math.max(0.2, CARRY_WIDTH / Math.max(1, width)));
}

/**
 * How far (0 to 1) piece `i` of a tab has gone into the label `ms` after the
 * drag began: each sets off a little after the one before, and gathers speed.
 */
export function drawnIn(ms, i) {
  const t = Math.min(1, Math.max(0, (ms - Math.min(i, DRAW_LATEST) * DRAW_STAGGER) / DRAW_MS));
  return t * t * t;
}

// ── Reading the page ─────────────────────────────────────────────────────────

const isBlock = el => !!el.dataset?.mbNode && BLOCK_KINDS.has(el.dataset.mbKind);
const isHeading = el => el.dataset?.mbKind === 'section';
const levelOf = heading => Number(heading.tagName[1]);
const boxOf = el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
const midOf = b => (b.top + b.bottom) / 2;

// The inside of a box, sideways: where its blocks run from and to.
function innerSpan(el) {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const left = r.left + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.borderLeftWidth) || 0);
  const right = r.right - (parseFloat(cs.paddingRight) || 0) - (parseFloat(cs.borderRightWidth) || 0);
  return { left, width: Math.max(0, right - left) };
}

// A tab's own box is only as tall as what it holds: the labels above it and
// the padding round it belong to the group. So the whole group is the way into
// the tab that is showing, and the group's edges are the tab's.
const TABS_SEL = '.tabbed-set[data-mb-node]';
const outerOf = box => (box.matches('.tabbed-block') ? box.closest(TABS_SEL) ?? box : box);
function shownTab(set) {
  const i = [...set.querySelectorAll(':scope > input')].findIndex(input => input.checked);
  return set.querySelector(':scope > .tabbed-content')?.children[Math.max(0, i)] ?? null;
}
/**
 * The innermost box at `el`: an admonition, a grid cell, or the showing tab of
 * a tab group. A collapsed admonition is not one: nothing lands in what can't
 * be seen, so the pointer over it is the way to land beside it.
 */
function boxAt(el) {
  for (let hit = el.closest(`${BOX_SEL}, ${TABS_SEL}`); hit; hit = hit.parentElement?.closest(`${BOX_SEL}, ${TABS_SEL}`) ?? null) {
    if (hit instanceof HTMLDetailsElement && !hit.open) continue;
    if (!hit.matches(TABS_SEL)) return hit;
    const tab = shownTab(hit);
    if (tab?.matches(BOX_SEL)) return tab;
  }
  return null;
}

const isColumn = el => el.dataset?.mbKind === 'cell';
const columnsOf = row => [...row.children].filter(isColumn);
const inColumn = el => !!el.parentElement?.closest('[data-mb-kind="cell"]');

/**
 * Where the things being moved would land beside something, with the pointer
 * at (x, y): at the left or right end of a block that is in no row, or of a
 * column of a row (the gap between two columns is the end of the nearer one).
 * Null when the pointer is at no such end, or the things are there already.
 * A column holds no rows of its own: inside one, only the column's own ends count.
 *
 * @param {HTMLElement} article
 * @param {HTMLElement[]} moving - every block going, or the one cell (a cell goes whole, to stand as a cell
 *   wherever it lands: it has nowhere else to go than beside something)
 * @param {(el: HTMLElement) => boolean} allowed - whether a block may have something beside it
 * @returns {null | { beside: {cell: string} | {block: string}, side: 'left'|'right', line: {left: number, y: number, height: number} }}
 */
export function sideTarget(article, x, y, moving, allowed = () => true) {
  // On the block first; then, for a pointer out in the margin beside one
  // (where its line is drawn), a little way in towards it on either side.
  // Not when the pointer is over another block, though: that block's own
  // ends are what count there.
  const own = document.elementFromPoint(x, y)?.closest('[data-mb-node]') ?? null;
  for (const dx of sideProbes()) {
    const hit = sideTargetAt(article, x + dx, x, y, moving, allowed);
    if (!hit) continue;
    if (dx === 0) return hit.target;
    const outside = x < hit.box.left || x > hit.box.right;
    const clear = !own || !article.contains(own) || own.contains(hit.el) || moving.some(m => m.contains(own));
    if (outside && clear && Math.min(Math.abs(x - hit.box.left), Math.abs(x - hit.box.right)) <= SIDE_OUT) return hit.target;
  }
  return null;
}

/** The sideways offsets looked at, nearest first: 0, then ± each step out to SIDE_OUT. */
export function sideProbes() {
  const out = [0];
  for (let d = SIDE_PROBE; d <= SIDE_OUT; d += SIDE_PROBE) out.push(d, -d);
  return out;
}

// sideTarget for what is at (px, y), judged by the pointer's own x: so a
// pointer out past a block's end is at that end. Returns the target with the
// element it is beside (`el`) and that element's box.
function sideTargetAt(article, px, x, y, moving, allowed) {
  const under = document.elementFromPoint(px, y);
  if (!under || !article.contains(under)) return null;
  const going = el => moving.some(m => m.contains(el));
  for (let n = under.closest('[data-mb-node]'); n && n !== article && article.contains(n); n = n.parentElement?.closest('[data-mb-node]') ?? null) {
    if (!n.dataset.mbNode || going(n)) continue;
    let at = n;
    let side = null;
    if (n.dataset.mbKind === 'grid') {
      // In the gap between two columns: the nearer one, at that end of it.
      if (inColumn(n)) continue;
      const level = columnsOf(n).filter(c => !going(c)).map(c => ({ c, r: boxOf(c) })).filter(({ r }) => r.top <= y && y <= r.bottom);
      const near = level.sort((a, b) => Math.min(Math.abs(x - a.r.left), Math.abs(x - a.r.right)) - Math.min(Math.abs(x - b.r.left), Math.abs(x - b.r.right)))[0];
      const reach = near ? Math.min(Math.abs(x - near.r.left), Math.abs(x - near.r.right)) : Infinity;
      if (!near || reach > SIDE_COLUMN * 2 || (x > near.r.left && x < near.r.right)) continue; // the row's empty space, not a gap
      at = near.c;
      side = Math.abs(x - near.r.left) <= Math.abs(x - near.r.right) ? 'left' : 'right';
    } else if (isColumn(n) ? inColumn(n) : !isBlock(n) || inColumn(n) || !allowed(n)) {
      continue;
    } else {
      side = isColumn(n) ? sideOf(boxOf(n), x, SIDE_COLUMN) : sideOf(boxOf(n), x);
    }
    if (!side) continue;
    const r = boxOf(at);
    if (!isColumn(at)) {
      return { el: at, box: r, target: { beside: { block: at.dataset.mbNode }, side, line: { left: side === 'left' ? r.left - SIDE_GAP : r.right + SIDE_GAP, y: r.top, height: r.bottom - r.top } } };
    }
    // Already there: all the column holds is what is going, or all its
    // neighbour on that side holds is.
    const columns = columnsOf(at.parentElement);
    const i = columns.indexOf(at);
    const held = c => [...c.children].filter(isBlock);
    const whole = c => !!c && held(c).length > 0 && held(c).every(b => moving.includes(b)) && moving.every(m => m.parentElement === c);
    const next = columns[i + (side === 'left' ? -1 : 1)];
    if (whole(at) || whole(next) || moving.includes(next)) return null;
    // The line runs the height of the columns standing level with this one,
    // midway to the neighbour when that is one of them.
    const row = columns.map(boxOf).filter(b => b.top < r.bottom && b.bottom > r.top);
    const nb = next ? boxOf(next) : null;
    const beside = nb && nb.top < r.bottom && nb.bottom > r.top ? nb : null;
    const edge = side === 'left' ? r.left : r.right;
    const left = beside ? (edge + (side === 'left' ? beside.right : beside.left)) / 2 : edge + (side === 'left' ? -SIDE_GAP : SIDE_GAP);
    const top = Math.min(...row.map(b => b.top));
    return { el: at, box: r, target: { beside: { cell: at.dataset.mbNode }, side, line: { left, y: top, height: Math.max(...row.map(b => b.bottom)) - top } } };
  }
  return null;
}

/**
 * Where a dragged block would land with the pointer at (x, y), or null when
 * that is nowhere (or where it already is): between two blocks of a container
 * (`container`, `at`), or beside a block or a column (`beside`, `side`).
 *
 * @param {HTMLElement} article
 * @param {number} x @param {number} y - client coordinates
 * @param {HTMLElement} source - the block being dragged
 * @param {Record<string, string>} kinds - TEXT_KIND (kbPageRender.js)
 * @param {HTMLElement[]} [others] - the other blocks going with it (a selection): with any,
 *   beside the dragged one is somewhere to land too (the rest gather there)
 * @param {null | ((el: HTMLElement) => boolean)} [beside] - whether a block may have something beside
 *   it; null when what is dragged goes beside nothing
 * @returns {null | { container: {kind: string, uuid: string}, at: number, line: {left: number, width: number, y: number} }
 *   | { beside: {cell: string} | {block: string}, side: 'left'|'right', line: {left: number, y: number, height: number} }}
 */
export function blockTarget(article, x, y, source, kinds, others = [], beside = () => true) {
  const aside = beside && sideTarget(article, x, y, [source, ...others], beside);
  if (aside) return aside;
  const under = document.elementFromPoint(x, y);
  let box = under && article.contains(under) ? boxAt(under) : null;
  const up = el => { const from = outerOf(el).parentElement; return from ? boxAt(from) : null; };
  // Nothing lands inside itself, and the very top or bottom of a box is the
  // way to land beside it rather than in it.
  while (box) {
    const r = outerOf(box).getBoundingClientRect();
    if (source.contains(box) || others.some(o => o.contains(box)) || y - r.top < NEAR || r.bottom - y < NEAR) box = up(box); else break;
  }

  let container;
  let blocks;
  let span;
  let empty;
  if (box) {
    const kind = box.dataset.mbKind === 'admonition' ? kinds.admonition : box.dataset.mbKind === 'tab' ? kinds.tab : kinds.cell;
    container = { kind, uuid: box.dataset.mbNode };
    blocks = [...box.children].filter(isBlock);
    span = innerSpan(box);
    const last = [...box.children].filter(c => c.getBoundingClientRect().height > 0).pop();
    empty = (last ? last.getBoundingClientRect().bottom : box.getBoundingClientRect().top) + GAP;
  } else {
    // A section: the heading at or above the pointer, and the blocks up to the next heading.
    const kids = [...article.children];
    const headings = kids.filter(isHeading);
    if (!headings.length) return null;
    let heading = headings[0];
    for (const h of headings) if (h.getBoundingClientRect().top <= y) heading = h;
    blocks = [];
    for (let n = heading.nextElementSibling; n && !isHeading(n); n = n.nextElementSibling) if (isBlock(n)) blocks.push(n);
    container = { kind: kinds.section, uuid: heading.dataset.mbNode };
    span = innerSpan(article);
    empty = heading.getBoundingClientRect().bottom + GAP;
  }
  if (!container.uuid) return null;

  const boxes = blocks.map(boxOf);
  const at = gapIndex(boxes.map(midOf), y);
  if (!others.length && (blocks[at] === source || blocks[at - 1] === source)) return null; // where it already is
  return { container, at, line: { ...span, y: gapLineY(boxes, at, empty) } };
}

/**
 * Where a dragged section would land with the pointer at height `y`, or null.
 * `at` is its place among the sections of `parentUuid` (null: the top level).
 *
 * @returns {null | { parentUuid: string|null, at: number, line: {left: number, width: number, y: number} }}
 */
export function sectionTarget(article, y, source, many = false) {
  const level = levelOf(source);
  const kids = [...article.children];
  const headings = kids.filter(isHeading);
  // The page's content ends where what the site adds under it begins.
  // (Read off the last thing of the content: the foot itself may be held at the
  // bottom of the window, away from where the page window.)
  // The last thing with a size, that is: the page's own markers for where to
  // add (hidden until used) stand between the blocks and have none.
  const tail = kids.find(k => k.matches('.md-tags, .mb-kb-foot'));
  const last = kids.slice(0, tail ? kids.indexOf(tail) : kids.length).filter(k => k.getBoundingClientRect().height > 0).pop();
  const pageEnd = last ? last.getBoundingClientRect().bottom + GAP : (tail ? tail.getBoundingClientRect().top : article.getBoundingClientRect().bottom) - GAP;
  const span = innerSpan(article);
  const topOf = h => h.getBoundingClientRect().top;
  // Between two sections the line lies halfway from the end of the one to the
  // heading of the next: clear of the faint lines drawn round the sections
  // while one is dragged (kbPageEditor nestOpen), which stand just off both.
  const between = h => {
    let prev = h.previousElementSibling;
    while (prev && !(prev.getBoundingClientRect().height > 0)) prev = prev.previousElementSibling;
    return prev ? (prev.getBoundingClientRect().bottom + topOf(h)) / 2 : topOf(h) - GAP;
  };

  let parentUuid = null;
  let siblings;
  let end = pageEnd;
  if (level === 2) {
    siblings = headings.filter(h => levelOf(h) === 2);
  } else {
    // A subsection: among the subsections of its own section while the pointer
    // is in that section; anywhere outside it, between the sections of the
    // page, where it becomes a section itself. (Under another section it goes
    // by that section's tile, to its end: kbPageEditor nestOpen.)
    const parents = headings.filter(h => levelOf(h) === 2);
    const from = kids.indexOf(source);
    const parent = parents.filter(p => kids.indexOf(p) < from).pop();
    if (!parent) return null;
    const next = parents[parents.indexOf(parent) + 1];
    const stop = next ? kids.indexOf(next) : tail ? kids.indexOf(tail) : kids.length;
    const lastIn = kids.slice(kids.indexOf(parent), stop).filter(k => k.getBoundingClientRect().height > 0).pop();
    if (y < topOf(parent) || y > lastIn.getBoundingClientRect().bottom) {
      const boxes = parents.map((h, i) => ({ top: topOf(h), bottom: parents[i + 1] ? topOf(parents[i + 1]) : pageEnd }));
      const at = gapIndex(boxes.map(midOf), y);
      const lineY = parents[at] ? between(parents[at]) : pageEnd + OUTSIDE;
      return { parentUuid: null, at, line: { ...span, y: lineY } };
    }
    if (next) end = topOf(next) - GAP;
    parentUuid = parent.dataset.mbNode;
    siblings = [];
    for (let n = parent.nextElementSibling; n && n !== next; n = n.nextElementSibling) if (isHeading(n) && levelOf(n) === 3) siblings.push(n);
  }

  // A section runs from its heading to the next sibling's (or the end of the list).
  const boxes = siblings.map((h, i) => ({ top: topOf(h), bottom: siblings[i + 1] ? topOf(siblings[i + 1]) : end }));
  const at = gapIndex(boxes.map(midOf), y);
  if (!many && (siblings[at] === source || siblings[at - 1] === source)) return null; // (several gather there)
  const lineY = level === 3 ? (siblings[at] ? boxes[at].top - GAP : end)
    : siblings[at] ? between(siblings[at]) : end + OUTSIDE;
  return { parentUuid, at, line: { ...span, y: lineY } };
}

/** Whether a point of the page is on `el` (a place to let go that is not between blocks). */
export function isOver(el, x, y) {
  const r = el?.getBoundingClientRect();
  return !!r && r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

/** The tab label under a point of the page, or null. */
export function labelAt(article, x, y) {
  const under = document.elementFromPoint(x, y);
  return under && article.contains(under) ? under.closest('.tabbed-labels > label') : null;
}

/**
 * Where a dragged tab label would land with the pointer at (x, y): on the
 * Delete area (`zone`), at a place among its group's labels (with an upright
 * line), or nowhere (null: away from the row, or where it already is).
 *
 * @param {HTMLElement} set - the tab group
 * @param {HTMLElement} source - the label being dragged
 * @param {HTMLElement|null} zone - the Delete area
 * @returns {null | { delete: true } | { at: number, line: {left: number, y: number, height: number} }}
 */
export function tabTarget(set, x, y, source, zone) {
  const z = zone?.getBoundingClientRect();
  if (z && x >= z.left && x <= z.right && y >= z.top && y <= z.bottom) return { delete: true };
  const row = set.querySelector(':scope > .tabbed-labels');
  if (!row) return null;
  const r = row.getBoundingClientRect();
  if (y < r.top - ROW_REACH || y > r.bottom + ROW_REACH || x < r.left - ROW_REACH || x > r.right + ROW_REACH) return null;
  const labels = [...row.children].filter(el => el.tagName === 'LABEL');
  const { at, lineX } = rowGap(labels.map(boxOf), x);
  if (lineX === null || labels[at] === source || labels[at - 1] === source) return null;
  return { at, line: { left: Math.min(Math.max(lineX, r.left), r.right), y: r.top, height: r.height } };
}

// ── What goes with the pointer ───────────────────────────────────────────────
// A carrier is `{ move(x, y), end(landed) }`: followDrag tells it where the
// pointer is and when the drag is over (landed: it was dropped somewhere).

const stillMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// Sent back to where it came from, then gone.
function sendBack(ghost, keyframes) {
  const anim = stillMotion() ? null : ghost.animate?.(keyframes, { duration: 170, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  if (!anim) { ghost.remove(); return; }
  anim.onfinish = anim.oncancel = () => ghost.remove();
  setTimeout(() => ghost.remove(), 260); // a page that draws no frames finishes nothing
}

/**
 * A small copy of what is dragged (a block, or a section from its heading
 * down), shrinking towards the pointer as the drag begins and then going
 * where the pointer goes.
 *
 * @param {Element[]} els - what is being moved, in order
 * @param {PointerEvent} press
 * @param {{ anchor?: Element, count?: number }} [opts] - the one taken hold of (the copy
 *   starts where it stands), and how many things go when there are several (shown on the copy)
 * @returns {null | { move(x: number, y: number): void, over(del: boolean): void, end(landed: boolean): void }}
 */
export function carryBlocks(els, press, { anchor = els[0], count = 1 } = {}) {
  if (!els.length) return null;
  const first = (anchor ?? els[0]).getBoundingClientRect();
  const width = Math.max(...els.map(el => el.getBoundingClientRect().width));
  if (!width) return null;
  const scale = carriedScale(width);
  const ghost = document.createElement('div');
  ghost.className = 'mb-kb-ghost';
  ghost.inert = true;
  ghost.style.left = `${first.left}px`;
  ghost.style.top = `${first.top}px`;
  ghost.style.width = `${width}px`;
  const card = document.createElement('div');
  card.className = 'mb-kb-ghost__card md-typeset';
  card.style.setProperty('--mb-kb-carry', String(scale));
  card.style.maxHeight = `${CARRY_HEIGHT / scale}px`;
  // It shrinks towards where it was taken hold of.
  card.style.transformOrigin = `${press.clientX - first.left}px ${press.clientY - first.top}px`;
  let tall = 0;
  for (const el of els) {
    if (tall * scale > CARRY_HEIGHT) break; // the rest would not show
    const copy = el.cloneNode(true);
    copy.classList.remove('mb-kb-picked', 'mb-kb-picked--section'); // the ground of a selected block stays behind
    // A copy must not answer for the original: a radio of the same name would
    // take the tick from a tab on the page.
    for (const n of [copy, ...copy.querySelectorAll('[id], [name], [for]')]) {
      for (const attr of ['id', 'name', 'for']) if (n.hasAttribute?.(attr)) n.setAttribute(attr, `${n.getAttribute(attr)}--carried`);
    }
    card.append(copy);
    tall += el.getBoundingClientRect().height;
  }
  ghost.append(card);
  if (count > 1) {
    const badge = document.createElement('div');
    badge.className = 'mb-kb-ghost__count';
    badge.textContent = String(count);
    // Where the copy's top right corner will be once it has shrunk.
    const ox = press.clientX - first.left;
    const oy = press.clientY - first.top;
    badge.style.left = `${ox + (width - ox) * scale}px`;
    badge.style.top = `${oy - oy * scale}px`;
    ghost.append(badge);
  }
  document.body.append(ghost);
  // Drawn full size where it stood first, so the shrinking is seen.
  if (!stillMotion()) void card.offsetWidth;
  card.classList.add('--carried');

  let dx = 0;
  let dy = 0;
  return {
    move(x, y) {
      dx = x - press.clientX;
      dy = y - press.clientY;
      ghost.style.transform = `translate(${dx}px, ${dy}px)`;
    },
    /**
     * Held over somewhere that deletes it: it wears a red line round it. Over
     * a section's "sub-section under" tile (`nest`): a purple one.
     */
    over(del, nest = false) {
      ghost.classList.toggle('--delete', del);
      ghost.classList.toggle('--nest', nest);
    },
    end(landed) {
      if (landed) { ghost.remove(); return; }
      card.classList.remove('--carried');
      sendBack(ghost, [{ transform: `translate(${dx}px, ${dy}px)`, opacity: 1 }, { transform: 'translate(0, 0)', opacity: 0 }]);
    },
  };
}

/**
 * Something that is not on the page yet (a thing taken from the Add card's
 * icons), going where the pointer goes: a small tile of its icon and name.
 *
 * @param {string} label
 * @param {Element|null} icon - its icon as drawn (copied)
 * @param {PointerEvent} press
 * @returns {{ move(x: number, y: number): void, end(landed: boolean): void }}
 */
export function carryChip(label, icon, press) {
  const ghost = document.createElement('div');
  ghost.className = 'mb-kb-addghost';
  ghost.inert = true;
  if (icon) ghost.append(icon.cloneNode(true));
  const text = document.createElement('span');
  text.textContent = label;
  ghost.append(text);
  document.body.append(ghost);
  // Held by its top left corner, a little off the pointer: the line it would
  // land on stays in sight.
  const at = (x, y) => `translate(${x + 10}px, ${y + 10}px)`;
  let last = at(press.clientX, press.clientY);
  ghost.style.transform = last;
  return {
    move(x, y) { last = at(x, y); ghost.style.transform = last; },
    end(landed) {
      if (landed) { ghost.remove(); return; }
      sendBack(ghost, [{ transform: last, opacity: 1 }, { transform: at(press.clientX, press.clientY), opacity: 0 }]);
    },
  };
}

/**
 * A tab's label, going where the pointer goes. What its tab is showing
 * (`pieces`, in order) is drawn into it as the drag begins, and stays away
 * until the drag is over: put back at once when the tab was dropped (the page
 * is redrawn, or a question is asked over it), let out again when it was not.
 *
 * @param {HTMLElement} label
 * @param {PointerEvent} press
 * @param {HTMLElement[]} pieces
 * @returns {{ move(x: number, y: number): void, over(del: boolean): void, end(landed: boolean): void }}
 */
export function carryTab(label, press, pieces) {
  const r = label.getBoundingClientRect();
  const cs = getComputedStyle(label);
  const ghost = document.createElement('div');
  ghost.className = 'mb-kb-tabghost';
  const face = document.createElement('div');
  face.className = 'mb-kb-tabghost__face';
  face.textContent = label.textContent.trim() || 'Tab';
  // Each on its own: the shorthand reads back empty for some theme fonts.
  for (const prop of ['fontFamily', 'fontWeight', 'fontStyle', 'letterSpacing', 'color']) face.style[prop] = cs[prop];
  ghost.append(face);
  document.body.append(ghost);
  // Smaller than the label it came from (its own size, by its text), and held
  // at the same spot along it as the label was taken hold of.
  const w = ghost.offsetWidth;
  const h = ghost.offsetHeight;
  const along = (v, lo, len) => Math.min(Math.max((v - lo) / Math.max(1, len), 0), 1);
  const gripX = along(press.clientX, r.left, r.width) * w;
  const gripY = along(press.clientY, r.top, r.height) * h;
  let at = { x: press.clientX, y: press.clientY };
  const place = () => { ghost.style.transform = `translate(${at.x - gripX}px, ${at.y - gripY}px)`; };
  place();

  // The pieces: where each stood on the page, and the styles it had of its own.
  const still = stillMotion();
  const view = window.innerHeight;
  const held = pieces.map(el => {
    const b = el.getBoundingClientRect();
    return {
      el,
      x: b.left + b.width / 2 + window.scrollX,
      y: b.top + b.height / 2 + window.scrollY,
      seen: b.bottom > 0 && b.top < view,
      was: { transform: el.style.transform, opacity: el.style.opacity, visibility: el.style.visibility },
      gone: false,
    };
  });
  const away = p => {
    p.gone = true;
    p.el.style.transform = p.was.transform;
    p.el.style.opacity = p.was.opacity;
    p.el.style.visibility = 'hidden';
  };
  // What is off the screen has nowhere to be seen going from.
  const flying = held.filter(p => p.seen && !still);
  held.filter(p => !flying.includes(p)).forEach(away);
  // Where a piece is headed, from where it stands: the middle of the label.
  const pull = p => ({
    x: at.x - gripX + w / 2 - (p.x - window.scrollX),
    y: at.y - gripY + h / 2 - (p.y - window.scrollY),
  });
  let frame = 0;
  const began = performance.now();
  const draw = now => {
    frame = 0;
    let busy = false;
    flying.forEach((p, i) => {
      if (p.gone) return;
      const e = drawnIn(now - began, i);
      if (e >= 1) { away(p); return; }
      busy = true;
      const to = pull(p);
      p.el.style.transform = `translate(${to.x * e}px, ${to.y * e}px) scale(${1 - e})`;
      p.el.style.opacity = String(1 - e * e);
    });
    if (busy) frame = requestAnimationFrame(draw);
    else if (flying.length) ghost.classList.add('--full'); // it has swallowed the lot
  };
  if (flying.length) frame = requestAnimationFrame(draw);

  return {
    move(x, y) { at = { x, y }; place(); },
    over(del) { ghost.classList.toggle('--delete', del); },
    end(landed) {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      for (const p of held) {
        const from = pull(p);
        Object.assign(p.el.style, p.was);
        // Not dropped anywhere: what was drawn in comes back out of the label.
        if (!landed && !still && p.seen && p.el.isConnected) {
          p.el.animate?.([{ transform: `translate(${from.x}px, ${from.y}px) scale(0)`, opacity: 0 }, { transform: 'none', opacity: 1 }],
            { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
        }
      }
      const home = label.isConnected ? label.getBoundingClientRect() : null;
      if (landed || !home) { ghost.remove(); return; }
      sendBack(ghost, [{ transform: ghost.style.transform }, { transform: `translate(${home.left}px, ${home.top}px)` }]);
    },
  };
}

// ── The drag ─────────────────────────────────────────────────────────────────

/**
 * Follow a press. Nothing happens until the pointer has moved
 * THRESHOLD px; from then on it is a drag.
 *
 * @param {PointerEvent} press
 * @param {{
 *   els: () => Element[],              what is being moved (dimmed while dragged)
 *   view: () => {top: number, bottom: number},   the part of the window the page shows in
 *   targetAt: (x: number, y: number) => null | {line: {left: number, width: number, y: number}},
 *   handle: Element,                   takes the pointer once the press is a drag, and not before (a press
 *                                      let go where it began stays a click: a tab label's, a selection's)
 *   over?: (target: object|null) => void,   what the pointer is over, after each look
 *   carry?: (els: Element[], press: PointerEvent) => null | {move(x: number, y: number): void, end(landed: boolean): void},
 *                                      what goes with the pointer (carryBlocks, carryTab), made as the drag begins
 *   start?: () => void,                the press has become a drag
 *   drop: (target: object) => void,    let go over a place to land
 *   end?: (dragged: boolean) => void,  always, last
 * }} opts
 */
export function followDrag(press, opts) {
  const { handle } = opts;
  // The press is let go wherever the pointer then is, on the page or off it:
  // the window hears that.
  const capture = () => { try { handle.setPointerCapture(press.pointerId); } catch { /* a synthetic press has no pointer to capture */ } };
  let dragging = false;
  let pointer = { x: press.clientX, y: press.clientY };
  let target = null;
  let frame = 0;
  let line = null;
  let dimmed = [];
  let carried = null;

  const paint = () => {
    carried?.move(pointer.x, pointer.y);
    target = opts.targetAt(pointer.x, pointer.y);
    opts.over?.(target);
    // A target may have no line of its own (the Delete area of a tab row).
    const at = target?.line;
    line.hidden = !at;
    if (!at) return;
    // Between blocks the line lies flat; between tab labels it stands upright.
    const upright = at.height !== undefined;
    line.classList.toggle('--upright', upright);
    line.style.left = `${at.left}px`;
    line.style.top = `${at.y}px`;
    line.style.width = upright ? '' : `${at.width}px`;
    line.style.height = upright ? `${at.height}px` : '';
  };
  const tick = () => {
    frame = 0;
    if (!dragging) return;
    const { top, bottom } = opts.view();
    // Held over where it would be deleted (the foot of the page, at the very
    // bottom of the view): the page stays still under it.
    const speed = target?.delete ? 0 : edgeSpeed(pointer.y, top, bottom);
    if (speed) window.scrollBy(0, speed);
    paint();
    if (speed) frame = requestAnimationFrame(tick); // keep scrolling while the pointer rests at the edge
  };
  const queue = () => { if (!frame) frame = requestAnimationFrame(tick); };

  const begin = () => {
    dragging = true;
    capture();
    opts.start?.();
    document.documentElement.classList.add('mb-kb-dragging');
    dimmed = opts.els();
    carried = opts.carry?.(dimmed, press) ?? null; // copied before it dims
    dimmed.forEach(el => el.classList.add('mb-kb-dragged'));
    line = document.createElement('div');
    line.className = 'mb-kb-dropline';
    line.hidden = true;
    document.body.appendChild(line);
  };
  const finish = drop => {
    handle.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', queue);
    try { handle.releasePointerCapture(press.pointerId); } catch { /* already let go */ }
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    const was = dragging;
    const landed = drop && dragging ? target : null;
    dragging = false;
    document.documentElement.classList.remove('mb-kb-dragging');
    dimmed.forEach(el => el.classList.remove('mb-kb-dragged'));
    line?.remove();
    carried?.end(!!landed);
    carried = null;
    if (landed) opts.drop(landed);
    opts.end?.(was);
  };
  const onMove = e => {
    if (!dragging && e.buttons === 0 && e.isTrusted) { finish(false); return; } // let go somewhere unheard
    pointer = { x: e.clientX, y: e.clientY };
    if (!dragging) {
      if (Math.hypot(e.clientX - press.clientX, e.clientY - press.clientY) < THRESHOLD) return;
      begin();
    }
    e.preventDefault();
    queue();
  };
  const onUp = e => {
    if (dragging) { pointer = { x: e.clientX, y: e.clientY }; paint(); }
    finish(true);
  };
  const onCancel = () => finish(false);
  const onKey = e => {
    if (e.key !== 'Escape' || !dragging) return;
    e.preventDefault();
    e.stopPropagation();
    finish(false);
  };

  handle.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', queue, { passive: true });
}
