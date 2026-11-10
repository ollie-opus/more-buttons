/**
 * builderPickMode.js — step 1 of the Selenium command builder: picking the
 * inputs a sheet will fill.
 *
 * Modelled on capture mode and its extract mode, and built from the same
 * parts: the action bar (actionToolbar.js) in its own violet hue, and the
 * capture selector (captureElement.js installSelector) restricted to what
 * builderPickables.js says is pickable.
 *
 *   - Without Shift the page behaves normally, so a tab or panel can be
 *     opened to reach an input.
 *   - With Shift held, hovering outlines whatever a click would add (an
 *     input, a whole radio / checkbox group, a button) and a small tag names
 *     it. Everything else gets no outline.
 *   - Shift + click adds it; again, or the ✕ on its chip in the bar, removes
 *     it. Picked inputs keep a solid outline and their number. The number is
 *     the pick order, which is the column order and the order the command
 *     runs the actions in.
 *   - Continue hands the picks to the sheet. Esc, the close control, the
 *     dock button again, or leaving the page ends the mode without a trace.
 *
 * All the judgement (what an element is, how it is addressed, its choices)
 * lives in builderPickables.js and is tested there; this file is the wiring.
 */
import { installSelector } from './captureElement.js';
import { mountActionBar } from './actionToolbar.js';
import { isOwnUi } from './actionRecorder.js';
import { describePick, commonAncestor } from './builderPickables.js';

const MODE_CLASS = 'mb-builder-pick-mode';
const HINT = 'hold shift and click an input, group or button to add it';
const MARKER_OUTSET = 3; // px a picked outline sits outside its element
const TAG_GAP = 6;       // px between the hover tag and the outlined rect
const BAR_CLEARANCE = 44; // the tag never sits under the top bar

// The two document lookups builderPickables.js needs.
const look = {
  byName: name => [...document.getElementsByName(name)],
  count: selector => { try { return document.querySelectorAll(selector).length; } catch { return 0; } },
};

let active = null; // { exit } while pick mode is on

/** The dock action: start picking, or leave pick mode when it is already on. */
export function openSeleniumCommandBuilder() {
  if (active) { active.exit(); return; }
  enterPickMode();
}

const titleFor = n => `Selenium command builder · ${n} picked`;

function tagTextFor(pick) {
  const n = pick.choices?.length;
  return `${pick.typeLabel} · ${pick.title}${pick.choices ? ` · ${n} choice${n === 1 ? '' : 's'}` : ''}`;
}

function make(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * Start pick mode. `picks` and `rows` are what the sheet hands back through
 * "Back to picking", so both survive the round trip: the picks show as
 * picked again and the rows are passed on untouched at Continue.
 */
export function enterPickMode({ picks = [], rows = null } = {}) {
  if (active) active.exit();

  const state = { picks: [...picks], rows };
  let hovered = null; // the pick under the cursor, as last resolved
  let armed = false;  // Shift held
  let frame = 0;
  const markers = new Map(); // pick.key → marker element

  document.documentElement.classList.add(MODE_CLASS);

  const bar = mountActionBar({
    variant: 'picking',
    title: titleFor(state.picks.length),
    controls: [
      { id: 'continue', icon: 'arrow-right', label: 'Continue' },
      { id: 'cancel', icon: 'x', label: 'Close', kind: 'close' },
    ],
    escapeControl: 'cancel',
    onControl: id => (id === 'continue' ? proceed() : exit()),
  });

  const chips = make('div', 'mb-builder-chips');
  bar.bar.insertBefore(chips, bar.bar.querySelector('.mb-capture-bar__spacer'));

  const tag = make('div', 'mb-builder-hover-tag');
  tag.hidden = true;
  document.documentElement.appendChild(tag);

  // ── Hover tag ─────────────────────────────────────────────────────────────
  function paintTag() {
    if (!armed || !hovered) { tag.hidden = true; return; }
    tag.textContent = tagTextFor(hovered);
    tag.hidden = false;
    const rect = commonAncestor(hovered.elements).getBoundingClientRect();
    const above = rect.top - tag.offsetHeight - TAG_GAP;
    const top = above >= BAR_CLEARANCE ? above : rect.bottom + TAG_GAP;
    const left = Math.max(4, Math.min(rect.left, window.innerWidth - tag.offsetWidth - 4));
    tag.style.top = `${top}px`;
    tag.style.left = `${left}px`;
  }

  // ── Picked markers ────────────────────────────────────────────────────────
  function placeMarkers() {
    frame = 0;
    for (const pick of state.picks) {
      const marker = markers.get(pick.key);
      const anchor = commonAncestor(pick.elements);
      const rect = anchor?.isConnected ? anchor.getBoundingClientRect() : null;
      if (!marker) continue;
      if (!rect || (rect.width === 0 && rect.height === 0)) { marker.hidden = true; continue; }
      marker.hidden = false;
      Object.assign(marker.style, {
        top: `${rect.top - MARKER_OUTSET}px`, left: `${rect.left - MARKER_OUTSET}px`,
        width: `${rect.width + MARKER_OUTSET * 2}px`, height: `${rect.height + MARKER_OUTSET * 2}px`,
      });
    }
  }
  const schedulePlace = () => { if (!frame) frame = requestAnimationFrame(placeMarkers); };

  function paintMarkers() {
    markers.forEach(marker => marker.remove());
    markers.clear();
    state.picks.forEach((pick, i) => {
      const marker = make('div', 'mb-builder-marker');
      marker.appendChild(make('span', 'mb-builder-marker__n', String(i + 1)));
      document.documentElement.appendChild(marker);
      markers.set(pick.key, marker);
    });
    placeMarkers();
  }

  // ── Chips ─────────────────────────────────────────────────────────────────
  function paintChips() {
    chips.replaceChildren(...state.picks.map((pick, i) => {
      const chip = make('span', 'mb-builder-chip');
      chip.title = tagTextFor(pick);
      const remove = make('button', 'mb-builder-chip__x');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove ${pick.title}`);
      remove.appendChild(make('span', 'more-buttons-icon', 'x'));
      remove.addEventListener('click', () => toggle(pick));
      chip.append(make('b', 'mb-builder-chip__n', String(i + 1)), make('span', 'mb-builder-chip__name', pick.title), remove);
      return chip;
    }));
  }

  function render() {
    bar.setTitle(titleFor(state.picks.length));
    bar.setControl('continue', { hidden: state.picks.length === 0 });
    paintChips();
    paintMarkers();
  }

  // Shift + click on something picked removes it; on anything else adds it.
  function toggle(pick) {
    const at = state.picks.findIndex(p => p.key === pick.key);
    if (at >= 0) state.picks.splice(at, 1); else state.picks.push(pick);
    render();
  }

  // ── Selector ──────────────────────────────────────────────────────────────
  const removeSelector = installSelector({
    resolveTarget(el) {
      hovered = isOwnUi(el) ? null : describePick(el, look);
      paintTag();
      return hovered ? commonAncestor(hovered.elements) : null;
    },
    onPick() { if (hovered) toggle(hovered); },
    onArmedChange(on) { armed = on; bar.setArmed(on); paintTag(); },
  });

  // ── Leaving ───────────────────────────────────────────────────────────────
  const resizeWatch = typeof ResizeObserver === 'function' ? new ResizeObserver(schedulePlace) : null;
  resizeWatch?.observe(document.body);
  document.addEventListener('scroll', schedulePlace, true);
  window.addEventListener('resize', schedulePlace);
  document.addEventListener('turbo:visit', exit);
  window.addEventListener('popstate', exit);

  function exit() {
    if (active !== handle) return;
    active = null;
    resizeWatch?.disconnect();
    document.removeEventListener('scroll', schedulePlace, true);
    window.removeEventListener('resize', schedulePlace);
    document.removeEventListener('turbo:visit', exit);
    window.removeEventListener('popstate', exit);
    if (frame) cancelAnimationFrame(frame);
    removeSelector();
    markers.forEach(marker => marker.remove());
    tag.remove();
    bar.remove();
    document.documentElement.classList.remove(MODE_CLASS);
  }

  // Continue: hand the picks to the sheet. Until the sheet exists (Task 6 of
  // the plan) the picks are logged so pick mode can be tried on its own.
  function proceed() {
    if (!state.picks.length) return;
    console.log('[MB builder] picked:', state.picks);
    exit();
  }

  const handle = { exit };
  active = handle;

  render();
  bar.flash(HINT);
}
