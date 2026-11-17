/**
 * iconPills.js — choosing an inline lucide icon (`:lucide-<name>:`) in a rich
 * surface typed into where it stands (richTextEditor.js attachRichSurface):
 * the icons float by the text as loose pills, the way an admonition's types
 * and a label's colours do (floatMenu.js). There is no popup box.
 *
 * Under an "Icon" heading is a field to search in and the icons that match,
 * each a pill of its art and its name. Choosing one puts it in the text (or
 * swaps the icon the menu was opened on, which is ticked); "Remove icon" takes
 * that one out. While the menu is open the rest of the page is washed back
 * round the text being typed.
 *
 * Keys: typing searches; Enter takes the first match; Down goes into the
 * pills, the arrows move among them, Up from their first row goes back to the
 * field; Escape puts the menu away and the caret back.
 *
 * The form editors' toolbar keeps its own icon popover (attachIconPopover).
 */

import { applyIcon, iconAt } from './markdownToolbarActions.js';
import { getLucideSvgMarkup, loadLucideNames, rankMatches } from './iconPicker.js';
import { createVeil, menuGroup, menuHost, menuInput, menuMaxWidth, menuPill, menuRow, menuTick, menuView, placeAround, playIn, stepPills } from './floatMenu.js';

const MAX_SHOWN = 24;  // icons offered at once
const SEARCH_WAIT = 90; // ms after a keystroke before the matches are redrawn

/** An icon's art in a span, drawn when it has loaded. */
export function iconGlyph(name) {
  const glyph = document.createElement('span');
  glyph.className = 'mb-fm__glyph';
  glyph.setAttribute('aria-hidden', 'true');
  getLucideSvgMarkup(name).then(svg => { if (svg) glyph.innerHTML = svg; }).catch(() => {});
  return glyph;
}

/**
 * The icons matching `query` as pills, each carrying its name in
 * `data-icon-name`; `current` is ticked (and comes first while nothing is
 * searched for). Empty when the name list is not in yet.
 */
export function iconMatchPills(names, query, current = '', max = MAX_SHOWN) {
  if (!Array.isArray(names)) return [];
  let found = rankMatches(names, query);
  // With nothing searched for, the icon it is now leads the ones offered.
  if (current && !String(query).trim() && names.includes(current)) found = [current, ...found.filter(n => n !== current)];
  return found.slice(0, max).map(name => {
    const pill = menuPill(name, { icon: iconGlyph(name) });
    pill.dataset.iconName = name;
    pill.tabIndex = -1;
    pill.setAttribute('aria-pressed', String(name === current));
    pill.append(menuTick());
    return pill;
  });
}

/** What was typed as an icon's bare name: `lucide/<name>` and `:lucide-<name>:` are read too. */
export const typedIconName = text => {
  const m = String(text ?? '').trim().toLowerCase().match(/^(?:lucide\/|:lucide-)?([a-z0-9]+(?:-[a-z0-9]+)*):?$/);
  return m ? m[1] : '';
};

/**
 * @param {object} rte   the editor (richTextEditor.js), with its float (attachFloat)
 * @param {object} api
 * @param {(rte, res) => void} api.applyResult      write a new source value and selection
 * @param {(rte) => {value, selStart, selEnd}} api.currentSelection
 * @param {(rte) => void} api.clearArmed            drop a format waiting for the next typed text
 * @returns {{ open(): void, close(): void, isOpen(): boolean }}
 */
export function attachIconMenu(rte, api) {
  const { surface } = rte;
  let saved = null;    // { value, selStart, selEnd } when the menu opened
  let existing = null; // the icon the menu was opened on
  let names = null;
  let timer = 0;

  const host = menuHost('mb-icon-pills');
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-label', 'Icon');
  const group = menuGroup('Icon');
  const input = menuInput('text', 'Search icons…');
  input.setAttribute('aria-label', 'Search icons');
  const off = menuPill('Remove icon', { extraClass: '--remove' });
  off.dataset.remove = '';
  off.prepend(iconGlyph('x'));
  group.row.append(input, off);
  const matches = menuRow();
  group.el.append(matches);
  host.append(group.el);
  document.body.append(host);
  const veil = createVeil();
  loadLucideNames().then(list => { names = list; if (!host.hidden) draw(); }).catch(() => {});

  const isOpen = () => !host.hidden;

  function draw() {
    const pills = iconMatchPills(names, input.value, existing?.name ?? '');
    matches.replaceChildren(...pills);
    matches.hidden = !pills.length;
    place();
  }

  function place() {
    const at = rte.float?.at;
    if (host.hidden || !at) return;
    const box = { left: at.left - window.scrollX, top: at.top - window.scrollY, bottom: at.bottom - window.scrollY };
    host.style.maxWidth = `${menuMaxWidth(surface.getBoundingClientRect().width)}px`;
    host.style.left = '0px';
    host.style.top = '0px';
    // Under the text (the matches grow downwards as they are searched), above it with no room there.
    const size = { w: host.offsetWidth, h: host.offsetHeight };
    const view = menuView();
    const below = box.bottom + 8 + size.h <= view.bottom || box.top - 8 - size.h < view.top;
    const spot = below
      ? { x: Math.max(8, Math.min(box.left, view.width - size.w - 8)), y: box.bottom + 8, up: false }
      : placeAround(box, size, view, { gap: 8 });
    host.classList.toggle('--up', spot.up);
    host.style.left = `${Math.round(spot.x + window.scrollX)}px`;
    host.style.top = `${Math.round(spot.y + window.scrollY)}px`;
    veil.show(surface.getBoundingClientRect(), getComputedStyle(surface).borderRadius);
  }

  function open() {
    saved = api.currentSelection(rte);
    existing = iconAt(saved.value, saved.selStart, saved.selEnd);
    // On an icon: the whole shortcode is what a choice swaps.
    if (existing) { saved.selStart = existing.start; saved.selEnd = existing.end; }
    input.value = '';
    off.hidden = !existing;
    host.hidden = false;
    draw();
    playIn(host);
    document.addEventListener('mousedown', onDocDown, true);
    input.focus({ preventScroll: true });
  }

  function close({ refocus = false } = {}) {
    if (host.hidden) return;
    clearTimeout(timer);
    host.hidden = true;
    veil.hide();
    matches.replaceChildren();
    document.removeEventListener('mousedown', onDocDown, true);
    if (!refocus || !surface.isConnected) return;
    // The caret goes back where it was in the text.
    surface.focus({ preventScroll: true });
    const range = rte.float?.range;
    if (range && surface.contains(range.startContainer) && surface.contains(range.endContainer)) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  function choose(name) {
    if (!name) return;
    close();
    api.clearArmed(rte);
    api.applyResult(rte, applyIcon(saved.value, saved.selStart, saved.selEnd, name));
  }

  function remove() {
    const caret = saved.selStart;
    close();
    api.clearArmed(rte);
    api.applyResult(rte, { value: saved.value.slice(0, saved.selStart) + saved.value.slice(saved.selEnd), selStart: caret, selEnd: caret });
  }

  const onDocDown = e => { if (e.target instanceof Node && !host.contains(e.target)) close(); };

  // A press on a pill must not take the focus from the field.
  host.addEventListener('mousedown', e => { if (e.target !== input) e.preventDefault(); });
  host.addEventListener('click', e => {
    const pill = e.target instanceof Element ? e.target.closest('.mb-fm__pill') : null;
    if (!pill) return;
    if (pill.dataset.remove != null) remove(); else choose(pill.dataset.iconName);
  });
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(draw, SEARCH_WAIT);
  });
  host.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close({ refocus: true }); return; }
    if (e.target === input) {
      if (e.isComposing) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        clearTimeout(timer);
        // What is typed, when it is an icon's whole name; else the first match.
        const typed = typedIconName(input.value);
        const first = Array.isArray(names) ? (names.includes(typed) ? typed : rankMatches(names, input.value)[0]) : typed;
        if (input.value.trim() && first) choose(first);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        clearTimeout(timer);
        draw();
        matches.querySelector('.mb-fm__pill')?.focus({ preventScroll: true });
      }
      return;
    }
    // Up from the pills' first row goes back to the field.
    if (e.key === 'ArrowUp') {
      const top = matches.firstElementChild?.getBoundingClientRect().top;
      if (document.activeElement?.getBoundingClientRect().top <= top + 1 || document.activeElement === off) {
        e.preventDefault();
        input.focus({ preventScroll: true });
        return;
      }
    }
    stepPills(host, e);
  });

  const onResize = () => place();
  window.addEventListener('resize', onResize);
  rte.cleanups?.push(() => {
    clearTimeout(timer);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('mousedown', onDocDown, true);
    host.remove();
    veil.remove();
  });

  return { open, close, isOpen };
}
