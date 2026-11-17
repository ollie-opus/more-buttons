/**
 * captureIsolate.js — Isolator mode's page state (capture mode).
 *
 * Isolation shows the marked elements alone on a flat backdrop so they can be
 * captured without the page around them. Nothing is lifted or cloned: an
 * element nested in the page can't be raised above an overlay without
 * rewriting its ancestors' stacking, which is what shifts shadows and layout.
 * Instead the backdrop sits BEHIND the page (lowest z-index in the root
 * stacking context) and every element outside the marked subtrees is
 * `visibility: hidden` — the marked elements paint exactly as they always did
 * (shadows, rounding, hover states), and hidden elements keep their layout
 * box, so nothing moves.
 *
 * Three phases, driven by two classes on <html> (rules in formsStyling.css):
 *   off   — page untouched; marks are remembered (attribute stays, no rule bites)
 *   solid — html.mb-isolating: page hidden, backdrop opaque behind the marks
 *   peek  — html.mb-isolate-peek: page visible under a faint veil, marks outlined
 *
 * The backdrop colour is the page's own ground colour, re-read every frame
 * while isolation is on so the light and dark shots (forced one after the
 * other by the service worker) each get their own.
 */

import { compositeColorStack, parseCssColor } from './captureElement.js';

export const ISOLATED_ATTR = 'data-mb-isolated';

/** Which phase the page should be in. Peeking only happens in Isolator mode. */
export function isolationPhase({ on, mode, armed }) {
  if (!on) return 'off';
  return mode === 'isolate' && armed ? 'peek' : 'solid';
}

/**
 * Index of the first rect covering at least `min` of the viewport's area
 * (the part of it inside the viewport is what counts), or -1. Exported for
 * tests.
 */
export function coveringIndex(rects, vw, vh, min = 0.6) {
  const need = vw * vh * min;
  return rects.findIndex(r => {
    const w = Math.min(r.left + r.width, vw) - Math.max(r.left, 0);
    const h = Math.min(r.top + r.height, vh) - Math.max(r.top, 0);
    return w > 0 && h > 0 && w * h >= need;
  });
}

const OURS = '[class^="mb-"], [class*=" mb-"], #mb-page-dock';

/**
 * The elements that paint the page's ground: <html>, <body>, then down
 * through whichever child fills most of the viewport (app shells often carry
 * the page colour on a wrapper, not on body). First covering child in DOM
 * order — app wrappers come first, modal scrims are appended later. Pure
 * layout reads, so it works while the page is hidden too.
 */
function groundChain() {
  const chain = [document.documentElement];
  let node = document.body;
  for (let depth = 0; node && depth < 8; depth++) {
    chain.push(node);
    const kids = [...node.children].filter(k => !k.matches(OURS));
    const i = coveringIndex(kids.map(k => k.getBoundingClientRect()), window.innerWidth, window.innerHeight);
    node = i < 0 ? null : kids[i];
  }
  return chain;
}

function groundColour(chain) {
  const stack = []; // nearest layer first
  for (let i = chain.length - 1; i >= 0; i--) {
    const bg = getComputedStyle(chain[i]).backgroundColor;
    if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') continue;
    const parsed = parseCssColor(bg);
    if (parsed[3] <= 0) continue;
    stack.push(parsed);
    if (parsed[3] >= 1) break;
  }
  // Nothing painted: the page is showing the browser's own canvas colour
  // (which follows color-scheme), so the backdrop does the same.
  return stack.length ? compositeColorStack(stack) : 'Canvas';
}

export function createIsolation() {
  const html = document.documentElement;
  const marked = new Set();
  const backdrop = document.createElement('div');
  backdrop.className = 'mb-isolate-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');

  let phase = 'off';
  let chain = null;
  let raf = 0;
  let lastColour = '';

  function paint() {
    // A Turbo body swap detaches the chain — find the new page's ground.
    if (!chain || chain.some(n => !n.isConnected)) chain = groundChain();
    const colour = groundColour(chain);
    if (colour !== lastColour) {
      lastColour = colour;
      backdrop.style.backgroundColor = colour;
    }
  }
  function loop() {
    paint();
    raf = requestAnimationFrame(loop);
  }

  function sync(next) {
    if (next === phase) return;
    phase = next;
    html.classList.toggle('mb-isolating', next === 'solid');
    html.classList.toggle('mb-isolate-peek', next === 'peek');
    if (next === 'off') {
      cancelAnimationFrame(raf);
      raf = 0;
      backdrop.remove();
      return;
    }
    chain = groundChain();
    // On <html>, beside <body>, so a Turbo body swap doesn't sweep it.
    if (!backdrop.isConnected) html.appendChild(backdrop);
    if (!raf) loop();
  }

  function toggleMark(el) {
    if (marked.has(el)) {
      marked.delete(el);
      el.removeAttribute(ISOLATED_ATTR);
    } else {
      marked.add(el);
      el.setAttribute(ISOLATED_ATTR, '');
    }
  }

  return {
    sync,
    toggleMark,
    /** Hovering inside a marked element targets that element, so a second
     *  pick un-marks it rather than marking one of its children. */
    pickTarget: el => el.closest(`[${ISOLATED_ATTR}]`) ?? el,
    /** True when a marked element is still on the page (marks die with a
     *  Turbo body swap). */
    hasLiveMarks() {
      for (const el of marked) if (!el.isConnected) marked.delete(el);
      return marked.size > 0;
    },
    /** The marked elements still on the page, in marking order. */
    marks() {
      return [...marked].filter(el => el.isConnected);
    },
    destroy() {
      sync('off');
      for (const el of marked) el.removeAttribute(ISOLATED_ATTR);
      marked.clear();
    },
  };
}
