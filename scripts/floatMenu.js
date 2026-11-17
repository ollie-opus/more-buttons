/**
 * floatMenu.js — the floating menu of the Knowledge Base in-page editor: loose
 * pills on the page with no box around them, gathered in groups under a small
 * heading, while the rest of the page is washed back with its own colour and
 * the thing the menu is for is left clear.
 *
 * Everything that opens on the page as a menu is drawn with these pieces: an
 * admonition's types (kbTypePicker.js), a label's colours (labelPills.js), the
 * icons (iconPills.js) and a block's settings (kbPageEditor.js). The
 * look is `.mb-fm*` in formsStyling.css; what a pill means and what choosing
 * it does stay with each owner.
 *
 * nextPill (the arrow-key geometry) and placeAround are pure and Node-tested;
 * the rest needs a DOM.
 */

import { getLucideSvgMarkup } from './lucideIcons.js';

export const MENU_GAP = 10;        // px between a thing and its menu
export const MENU_EDGE = 8;        // px a menu keeps inside the window
export const MENU_MIN_WIDTH = 340; // px a menu may spread over, however narrow its thing
export const MENU_MAX_WIDTH = 560;

/**
 * Where an arrow key goes from pill `i`. `rects` are the pills' boxes in page
 * order ({ left, top, width }). Left / Right step through that order and wrap;
 * Up / Down go to the nearest pill across in the next row that way, staying
 * put at the first / last row. -1 for any other key.
 */
export function nextPill(rects, i, key) {
  const n = rects.length;
  if (!n) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  if (key === 'ArrowRight') return (i + 1) % n;
  if (key === 'ArrowLeft') return (i - 1 + n) % n;
  if (key !== 'ArrowDown' && key !== 'ArrowUp') return -1;
  const cur = rects[i];
  if (!cur) return 0;
  const down = key === 'ArrowDown';
  const beyond = rects.map((r, j) => ({ r, j })).filter(({ r }) => (down ? r.top > cur.top + 1 : r.top < cur.top - 1));
  if (!beyond.length) return i;
  const rowTop = down ? Math.min(...beyond.map(({ r }) => r.top)) : Math.max(...beyond.map(({ r }) => r.top));
  const mid = cur.left + cur.width / 2;
  let best = i;
  let bestGap = Infinity;
  for (const { r, j } of beyond) {
    if (Math.abs(r.top - rowTop) > 1) continue;
    const gap = Math.abs(r.left + r.width / 2 - mid);
    if (gap < bestGap) { bestGap = gap; best = j; }
  }
  return best;
}

const SPILL_ROOM = 140; // px of a tall menu that must show for it to run on past the view

/**
 * Where a menu of `size` ({ w, h }) goes for a thing at `box` ({ left, top,
 * bottom }), all in window px. Just above the thing, which stays whole and in
 * view; with no room there, below it. A menu too tall for either:
 *   - with `spill`, goes on the side with more room and runs on past the view
 *     (it is placed on the page, so scrolling brings the rest), as long as a
 *     fair part of it shows; `pageTop` is how far the page is scrolled, so it
 *     never starts above the page itself;
 *   - otherwise stands at `fallbackTop` (over the thing), kept inside the view.
 * `wantLeft` is where its left edge would like to be (the thing's own left
 * when not given).
 * @returns {{ x: number, y: number, up: boolean }}
 */
export function placeAround(box, size, view, { gap = MENU_GAP, edge = MENU_EDGE, wantLeft = box.left, fallbackTop = box.top, spill = false, pageTop = 0 } = {}) {
  const x = Math.max(edge, Math.min(wantLeft, view.width - size.w - edge));
  const above = box.top - gap - size.h;
  const below = box.bottom + gap;
  if (above >= view.top) return { x, y: above, up: true };
  if (below + size.h <= view.bottom) return { x, y: below, up: false };
  if (spill) {
    const roomAbove = box.top - gap - view.top;
    const roomBelow = view.bottom - below;
    if (roomBelow >= roomAbove && roomBelow >= SPILL_ROOM) return { x, y: below, up: false };
    if (roomAbove >= SPILL_ROOM && above + pageTop >= 0) return { x, y: above, up: true };
    if (roomBelow >= SPILL_ROOM) return { x, y: below, up: false };
  }
  return { x, y: Math.max(view.top, Math.min(fallbackTop, view.bottom - size.h)), up: false };
}

/** The part of the window a menu may stand in: under the site's header, over the editor's foot row. */
export function menuView() {
  const header = document.querySelector('.md-header')?.getBoundingClientRect();
  const foot = document.querySelector('.mb-kb-foot')?.getBoundingClientRect();
  return {
    top: Math.max(0, header && header.top <= 0 ? header.bottom : 0) + MENU_EDGE,
    bottom: (foot?.height && foot.top > 0 && foot.top < window.innerHeight ? foot.top : window.innerHeight) - MENU_EDGE,
    width: document.documentElement.clientWidth,
  };
}

/** The width a menu may spread over, for a thing `width` px wide. */
export const menuMaxWidth = width => Math.min(Math.max(width, MENU_MIN_WIDTH), MENU_MAX_WIDTH, document.documentElement.clientWidth - MENU_EDGE * 2);

// The tick's art is the extension's own bundled lucide `check`, read once, the
// first time a tick is wanted.
let check = '';
let checkAsked = false;
const waitingTicks = new Set();

/** The tick a chosen pill ends with (the stylesheet shows it only on the pill that is chosen). */
export function menuTick() {
  const tick = document.createElement('span');
  tick.className = 'mb-fm__tick';
  tick.setAttribute('aria-hidden', 'true');
  if (check) { tick.innerHTML = check; return tick; }
  waitingTicks.add(tick);
  if (!checkAsked) {
    checkAsked = true;
    getLucideSvgMarkup('check').then(svg => {
      check = svg || '';
      waitingTicks.forEach(t => { t.innerHTML = check; });
      waitingTicks.clear();
    }).catch(() => {});
  }
  return tick;
}

/** A menu's host: it only lays its groups out, and takes no clicks between them. */
export function menuHost(extraClass = '') {
  const host = document.createElement('div');
  host.className = `mb-fm${extraClass ? ` ${extraClass}` : ''}`;
  host.hidden = true;
  return host;
}

/**
 * A group: a small heading over a row of pills.
 * @returns {{ el: HTMLElement, row: HTMLElement }}
 */
export function menuGroup(title, hint) {
  const el = document.createElement('div');
  el.className = 'mb-fm__group';
  if (title) {
    const head = document.createElement('div');
    head.className = 'mb-fm__head';
    head.textContent = title;
    if (hint) {
      const small = document.createElement('span');
      small.className = 'mb-fm__hint';
      small.textContent = hint;
      head.append(small);
    }
    el.append(head);
  }
  const row = menuRow();
  el.append(row);
  return { el, row };
}

export function menuRow() {
  const row = document.createElement('div');
  row.className = 'mb-fm__row';
  return row;
}

/** A break in a row of pills: what follows starts a new line. */
export function menuBreak() {
  const gap = document.createElement('span');
  gap.className = 'mb-fm__break';
  return gap;
}

/** A pill that is a button. `icon` is an element put before its text. */
export function menuPill(label, { icon = null, extraClass = '' } = {}) {
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = `mb-fm__pill${extraClass ? ` ${extraClass}` : ''}`;
  if (icon) pill.append(icon);
  const text = document.createElement('span');
  text.className = 'mb-fm__text';
  text.textContent = label;
  pill.append(text);
  return pill;
}

/**
 * A pill that is a radio or a checkbox: the input is in it, unseen, so the
 * browser keeps the group's own keys (arrows step through radios, Space
 * ticks) and the pill that is chosen ends with a tick.
 */
export function menuOption(type, name, value, label, { icon = null, extraClass = '' } = {}) {
  const pill = document.createElement('label');
  pill.className = `mb-fm__pill --option${extraClass ? ` ${extraClass}` : ''}`;
  const input = document.createElement('input');
  input.type = type;
  input.name = name;
  input.value = value;
  pill.append(input);
  if (icon) pill.append(icon);
  const text = document.createElement('span');
  text.className = 'mb-fm__text';
  text.textContent = label;
  pill.append(text, menuTick());
  return pill;
}

/** A field typed into, shaped as a pill. */
export function menuInput(type = 'text', placeholder = '') {
  const input = document.createElement('input');
  input.type = type;
  input.className = 'mb-fm__input';
  if (placeholder) input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.spellcheck = false;
  return input;
}

/**
 * The wash: a box laid exactly over the thing a menu is for, painting nothing
 * itself and throwing the page's own colour over all that is around it.
 * @returns {{ show(box: {left, top, width, height}, radius?: string): void, hide(): void, el: HTMLElement }}
 *   `box` is in window px.
 */
// The veils showing now: while there is one, the root says so (`mb-fm-open`),
// and the editor's foot row (the Add card, Save) steps out of the way.
const veilsOpen = new Set();
// The veils that give way (`yields`): each steps out while any other veil is
// showing and comes back when that one has gone, so the page is never washed twice.
const yielders = new Map(); // veil element → (others: boolean) => void
const markOpen = (veil, on) => {
  if (on) veilsOpen.add(veil); else veilsOpen.delete(veil);
  document.documentElement.classList.toggle('mb-fm-open', veilsOpen.size > 0);
  const others = [...veilsOpen].some(v => !yielders.has(v));
  for (const sync of yielders.values()) sync(others);
};

/**
 * @param {{ yields?: boolean }} [opts] `yields`: a veil for something that
 *   stays on the page a while (a capture in progress), not for a menu: it
 *   steps out for as long as any other veil is showing.
 */
export function createVeil({ yields = false } = {}) {
  const el = document.createElement('div');
  el.className = 'mb-fm-veil';
  el.hidden = true;
  // The blur: a layer over the window with the thing's box cut out of it (the
  // wash is a shadow thrown by `el`, and a shadow cannot blur what is behind
  // it). It stands beside `el` on the body, never inside it: `el` fades in,
  // and a thing being faded is all that anything inside it can blur. It is
  // the window's size, not the page's, so the hole is moved as the page scrolls.
  const blur = document.createElement('div');
  blur.className = 'mb-fm-veil__blur';
  blur.hidden = true;
  document.body.append(el, blur);
  let hole = null; // { left, top, width, height, r } on the page
  let wanted = false;
  if (yields) yielders.set(el, others => { if (wanted) { el.hidden = others; blur.hidden = others; } });
  const cut = () => {
    if (!hole) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    blur.style.clipPath = `path(evenodd, "M0 0H${w}V${h}H0Z ${holePath(hole.left - window.scrollX, hole.top - window.scrollY, hole.width, hole.height, hole.r)}")`;
  };
  return {
    el,
    show(box, radius = '0px') {
      const left = box.left + window.scrollX;
      const top = box.top + window.scrollY;
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      el.style.width = `${box.width}px`;
      el.style.height = `${box.height}px`;
      el.style.borderRadius = radius;
      if (!hole) {
        window.addEventListener('scroll', cut, { passive: true, capture: true });
        window.addEventListener('resize', cut);
      }
      hole = { left, top, width: box.width, height: box.height, r: parseFloat(radius) || 0 };
      cut();
      wanted = true;
      el.hidden = false;
      blur.hidden = false;
      markOpen(el, true);
    },
    hide() {
      wanted = false;
      el.hidden = true;
      blur.hidden = true;
      markOpen(el, false);
      if (!hole) return;
      hole = null;
      window.removeEventListener('scroll', cut, { capture: true });
      window.removeEventListener('resize', cut);
    },
    /** Take the veil off the page for good. */
    remove() { this.hide(); yielders.delete(el); el.remove(); blur.remove(); },
  };
}

/** The outline of a box with rounded corners, as SVG path data (the hole a veil's blur leaves). */
export function holePath(x, y, w, h, r = 0) {
  const n = v => Math.round(v * 100) / 100;
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (!r) return `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`;
  return `M${n(x + r)} ${n(y)}h${n(w - 2 * r)}a${r} ${r} 0 0 1 ${r} ${r}v${n(h - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${r}h${n(2 * r - w)}a${r} ${r} 0 0 1 ${-r} ${-r}v${n(2 * r - h)}a${r} ${r} 0 0 1 ${r} ${-r}Z`;
}

/**
 * Arrow keys among a menu's pills (buttons that can be pressed), by where they
 * stand. Returns true when the key was one of them and was spent.
 */
export function stepPills(host, e) {
  const list = [...host.querySelectorAll('button.mb-fm__pill:not(:disabled)')];
  const i = list.indexOf(document.activeElement);
  const to = nextPill(list.map(p => { const r = p.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width }; }), i, e.key);
  if (to < 0) return false;
  e.preventDefault();
  e.stopPropagation();
  list[to].focus({ preventScroll: true });
  return true;
}

/** Let a menu's pills come in one after another, this once (a redraw of an open menu does not replay it). */
export function playIn(host) {
  [...host.querySelectorAll('.mb-fm__pill, .mb-fm__input')].forEach((p, i) => p.style.setProperty('--i', String(i)));
  host.classList.add('--fresh');
  clearTimeout(host._mbFresh);
  host._mbFresh = setTimeout(() => host.classList.remove('--fresh'), 600);
}
