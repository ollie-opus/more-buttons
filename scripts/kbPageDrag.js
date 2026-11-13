/**
 * kbPageDrag.js — dragging a block or a section to a new place in the in-page
 * editor (kbPageEditor.js), by the grip beside its settings cog.
 *
 * A press on the grip that moves a few pixels becomes a drag: what is being
 * moved dims, a line shows where it would land, and the window scrolls when the
 * pointer nears its top or bottom edge. Letting go there makes the move (one
 * op, see kbPageOps moveTo / moveSectionTo); Escape, or letting go where there
 * is nowhere to land, leaves the page as it was.
 *
 * Where something can land is read off the page as kbPageRender.js drew it:
 *
 *   - a block (a component or a text block) goes between any two blocks of any
 *     container: a section, an admonition, the tab that is showing, a grid
 *     cell. The container is the innermost one under the pointer, so nesting
 *     follows the pointer sideways as well as down;
 *   - a section goes between sections of its own level (a subsection may land
 *     under another section).
 *
 * The geometry is pure (gapIndex, edgeSpeed, gapLineY) and Node-tested; the
 * rest needs a DOM.
 */

const THRESHOLD = 4;   // px the pointer travels before a press is a drag
const EDGE = 80;       // px from the top / bottom of the view where scrolling starts
const MAX_SPEED = 24;  // px per frame at the very edge
const NEAR = 6;        // px inside a box's top / bottom that still mean "beside it"
const GAP = 5;         // px the line stands off the first / last block of a list

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

/**
 * Where a dragged block would land with the pointer at (x, y), or null when
 * that is nowhere (or where it already is).
 *
 * @param {HTMLElement} article
 * @param {number} x @param {number} y - client coordinates
 * @param {HTMLElement} source - the block being dragged
 * @param {Record<string, string>} kinds - TEXT_KIND (kbPageRender.js)
 * @returns {null | { container: {kind: string, uuid: string}, at: number, line: {left: number, width: number, y: number} }}
 */
export function blockTarget(article, x, y, source, kinds) {
  const under = document.elementFromPoint(x, y);
  let box = under && article.contains(under) ? under.closest(BOX_SEL) : null;
  const up = el => el.parentElement?.closest(BOX_SEL) ?? null;
  // Nothing lands inside itself, and the very top or bottom of a box is the
  // way to land beside it rather than in it.
  while (box) {
    const r = box.getBoundingClientRect();
    if (source.contains(box) || y - r.top < NEAR || r.bottom - y < NEAR) box = up(box); else break;
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
  if (blocks[at] === source || blocks[at - 1] === source) return null; // where it already is
  return { container, at, line: { ...span, y: gapLineY(boxes, at, empty) } };
}

/**
 * Where a dragged section would land with the pointer at height `y`, or null.
 * `at` is its place among the sections of `parentUuid` (null: the top level).
 *
 * @returns {null | { parentUuid: string|null, at: number, line: {left: number, width: number, y: number} }}
 */
export function sectionTarget(article, y, source) {
  const level = levelOf(source);
  const kids = [...article.children];
  const headings = kids.filter(isHeading);
  // The page's content ends where what the site adds under it begins.
  const tail = kids.find(k => k.matches('.md-tags, .mb-kb-addnew'));
  const pageEnd = (tail ? tail.getBoundingClientRect().top : article.getBoundingClientRect().bottom) - GAP;
  const span = innerSpan(article);
  const topOf = h => h.getBoundingClientRect().top;

  let parentUuid = null;
  let siblings;
  let end = pageEnd;
  if (level === 2) {
    siblings = headings.filter(h => levelOf(h) === 2);
  } else {
    // Under the section the pointer is in.
    const parents = headings.filter(h => levelOf(h) === 2);
    if (!parents.length) return null;
    let parent = parents[0];
    for (const p of parents) if (topOf(p) <= y) parent = p;
    const next = parents[parents.indexOf(parent) + 1];
    if (next) end = topOf(next) - GAP;
    parentUuid = parent.dataset.mbNode;
    siblings = [];
    for (let n = parent.nextElementSibling; n && n !== next; n = n.nextElementSibling) if (isHeading(n) && levelOf(n) === 3) siblings.push(n);
  }

  // A section runs from its heading to the next sibling's (or the end of the list).
  const boxes = siblings.map((h, i) => ({ top: topOf(h), bottom: siblings[i + 1] ? topOf(siblings[i + 1]) : end }));
  const at = gapIndex(boxes.map(midOf), y);
  if (siblings[at] === source || siblings[at - 1] === source) return null;
  const lineY = siblings[at] ? boxes[at].top - GAP : end;
  return { parentUuid, at, line: { ...span, y: lineY } };
}

// ── The drag ─────────────────────────────────────────────────────────────────

/**
 * Follow a press on a grip. Nothing happens until the pointer has moved
 * THRESHOLD px; from then on it is a drag.
 *
 * @param {PointerEvent} press
 * @param {{
 *   els: () => Element[],              what is being moved (dimmed while dragged)
 *   view: () => {top: number, bottom: number},   the part of the window the page shows in
 *   targetAt: (x: number, y: number) => null | {line: {left: number, width: number, y: number}},
 *   start?: () => void,                the press has become a drag
 *   drop: (target: object) => void,    let go over a place to land
 *   end?: (dragged: boolean) => void,  always, last
 * }} opts
 */
export function followDrag(press, opts) {
  const grip = press.currentTarget;
  let dragging = false;
  let pointer = { x: press.clientX, y: press.clientY };
  let target = null;
  let frame = 0;
  let line = null;
  let dimmed = [];

  const paint = () => {
    target = opts.targetAt(pointer.x, pointer.y);
    line.hidden = !target;
    if (!target) return;
    line.style.left = `${target.line.left}px`;
    line.style.width = `${target.line.width}px`;
    line.style.top = `${target.line.y}px`;
  };
  const tick = () => {
    frame = 0;
    if (!dragging) return;
    const { top, bottom } = opts.view();
    const speed = edgeSpeed(pointer.y, top, bottom);
    if (speed) window.scrollBy(0, speed);
    paint();
    if (speed) frame = requestAnimationFrame(tick); // keep scrolling while the pointer rests at the edge
  };
  const queue = () => { if (!frame) frame = requestAnimationFrame(tick); };

  const begin = () => {
    dragging = true;
    opts.start?.();
    document.documentElement.classList.add('mb-kb-dragging');
    dimmed = opts.els();
    dimmed.forEach(el => el.classList.add('mb-kb-dragged'));
    line = document.createElement('div');
    line.className = 'mb-kb-dropline';
    line.hidden = true;
    document.body.appendChild(line);
  };
  const finish = drop => {
    grip.removeEventListener('pointermove', onMove);
    grip.removeEventListener('pointerup', onUp);
    grip.removeEventListener('pointercancel', onCancel);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', queue);
    try { grip.releasePointerCapture(press.pointerId); } catch { /* already let go */ }
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    const was = dragging;
    const landed = drop && dragging ? target : null;
    dragging = false;
    document.documentElement.classList.remove('mb-kb-dragging');
    dimmed.forEach(el => el.classList.remove('mb-kb-dragged'));
    line?.remove();
    if (landed) opts.drop(landed);
    opts.end?.(was);
  };
  const onMove = e => {
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

  try { grip.setPointerCapture(press.pointerId); } catch { /* a synthetic press has no pointer to capture */ }
  grip.addEventListener('pointermove', onMove);
  grip.addEventListener('pointerup', onUp);
  grip.addEventListener('pointercancel', onCancel);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', queue, { passive: true });
}
