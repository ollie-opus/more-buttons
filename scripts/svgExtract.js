/**
 * svgExtract.js — Extract Mode's SVG serializer.
 *
 * Capture mode screenshots pixels; Extract mode lifts the picked <svg>'s
 * markup instead, producing the same light/dark file pair the capture
 * pipeline already understands (…-light-mode.svg / …-dark-mode.svg).
 *
 * The hard part is colour. Sites paint icons through CSS classes
 * (class="size-5 text-green-600 dark:text-green-400") plus
 * fill="currentColor" — markup that means nothing once the file renders in
 * an <img> where no page stylesheet applies. So the serializer:
 *   - strips class, data-* and on* attributes (ids are KEPT — url(#…) gradients,
 *     clipPaths and <use href="#…"> break without them, and the KB renders
 *     these files via <img> so ids can never collide across documents);
 *   - bakes the root's computed `color` onto the <svg> so currentColor
 *     resolves to the same ink the page showed;
 *   - bakes CSS-driven fill/stroke/opacity values on descendants as
 *     presentation attributes (explicit attributes are left alone).
 *
 * Theme pairs work exactly like screenshots: the controller calls
 * extractSvgForTheme once per theme, and the service worker flips
 * prefers-color-scheme via CDP (runExtractTheme in extractFlow.js) around
 * the serialization, so each file bakes its own theme's resolved colours.
 *
 * Pure helpers live at the top with no DOM access — tests/svgExtract.test.mjs
 * imports this module under plain Node, so the module top level must stay
 * side-effect-free (same discipline captureMode.js keeps for its tests).
 */

import { deriveFilename } from './captureElement.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// ── Pure helpers (Node-testable) ─────────────────────────────────────────────

/**
 * Attributes dropped from every element of the serialized copy. Classes are
 * the whole reason this module exists (their CSS is unreachable from an
 * <img>); data-* is framework bookkeeping; on* is script — never ship it.
 */
export function shouldDropAttribute(name) {
  const n = String(name || '').toLowerCase();
  return n === 'class' || n.startsWith('data-') || n.startsWith('on');
}

/**
 * Decide whether a paint property needs baking as a presentation attribute.
 * Returns the value to bake, or null to leave the element untouched.
 *
 * - An existing presentation attribute (fill="#f00", fill="currentColor",
 *   stroke="none") already survives serialization — leave it (currentColor
 *   is resolved by the root `color` bake instead).
 * - No attribute, and the computed value matches the parent's computed value
 *   or the SVG initial → inheritance/defaults reproduce it for free.
 * - Otherwise the value came from CSS (a class or stylesheet rule that the
 *   saved file won't have) → bake the computed value.
 */
export function bakePaintDecision({ attrValue, computed, parentComputed, initial }) {
  if (attrValue != null && attrValue !== '') return null;
  if (computed == null || computed === '') return null;
  if (computed === parentComputed) return null;
  if (computed === initial) return null;
  return computed;
}

/**
 * Resolve the viewBox for the saved file. An explicit viewBox wins; else a
 * numeric width/height attribute pair; else the rendered bounding box. A
 * viewBox is what lets the KB's `height: 50px` markdown styling scale the
 * icon instead of clipping it.
 */
export function ensureViewBox({ viewBoxAttr, widthAttr, heightAttr, bboxRect }) {
  if (viewBoxAttr) return viewBoxAttr;
  const w = parseFloat(widthAttr);
  const h = parseFloat(heightAttr);
  if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
    return `0 0 ${w} ${h}`;
  }
  if (bboxRect && bboxRect.width > 0 && bboxRect.height > 0) {
    const n = v => Math.round(v * 100) / 100;
    return `${n(bboxRect.x)} ${n(bboxRect.y)} ${n(bboxRect.width)} ${n(bboxRect.height)}`;
  }
  return null;
}

/**
 * SVG text → base64 data URL, via the same UTF-8-safe transform github.js
 * uses for markdown pushes. pushCaptures splits on the comma and hands the
 * base64 tail to the Contents API, so this must NOT be plain btoa(text) —
 * page SVGs routinely carry non-Latin1 <title>/<desc> text.
 */
export function svgTextToDataUrl(text) {
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(text)));
}

// ── DOM serialization ────────────────────────────────────────────────────────

// Paint properties that CSS can set out from under the markup. Initials are
// getComputedStyle's serializations of the SVG defaults. `opacity` is not
// inherited, so its "parent" comparison is pinned to the initial instead.
const PAINT_PROPS = [
  { name: 'fill',           initial: 'rgb(0, 0, 0)', inherited: true },
  { name: 'stroke',         initial: 'none',         inherited: true },
  { name: 'fill-opacity',   initial: '1',            inherited: true },
  { name: 'stroke-opacity', initial: '1',            inherited: true },
  { name: 'stroke-width',   initial: '1px',          inherited: true },
  { name: 'opacity',        initial: '1',            inherited: false },
];

function externalHref(el) {
  const href = el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? '';
  if (!href || href.startsWith('#')) return null;
  return href;
}

/**
 * Serialize the picked <svg> under whatever theme is currently emulated.
 * Computed styles are read off the ORIGINAL rendered tree (a detached clone
 * computes nothing), then applied to a clone walked in the same
 * querySelectorAll order.
 */
export function serializeSvgElement(svg) {
  const win = svg.ownerDocument.defaultView;
  const rootColor = win.getComputedStyle(svg).color;

  // Pass 1 — original tree: record per-element bake decisions while the
  // page's CSS is still in effect.
  const originals = [svg, ...svg.querySelectorAll('*')];
  const decisions = originals.map(el => {
    const cs = win.getComputedStyle(el);
    const parentCs = el.parentElement ? win.getComputedStyle(el.parentElement) : null;
    const bakes = [];
    for (const { name, initial, inherited } of PAINT_PROPS) {
      const value = bakePaintDecision({
        attrValue: el.getAttribute(name),
        computed: cs.getPropertyValue(name),
        parentComputed: (inherited && parentCs) ? parentCs.getPropertyValue(name) : initial,
        initial,
      });
      if (value != null) bakes.push([name, value]);
    }
    return bakes;
  });

  // Pass 2 — clone: strip, sanitise, bake. Same element order as pass 1.
  const clone = svg.cloneNode(true);
  const cloned = [clone, ...clone.querySelectorAll('*')];
  let spriteDefs = null;
  cloned.forEach((el, i) => {
    const tag = el.tagName.toLowerCase();

    // Script vectors have no place in a stored asset.
    if (tag === 'script' || tag === 'foreignobject') { el.remove(); return; }

    if (tag === 'use' || tag === 'image') {
      if (externalHref(el)) { el.remove(); return; } // cross-file ref: unresolvable offline
      if (tag === 'use') {
        const id = (el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? '').slice(1);
        const target = id ? svg.ownerDocument.getElementById(id) : null;
        if (!target) { el.remove(); return; }
        // Document-level sprite (<symbol> outside the picked svg): carry the
        // definition along so the reference still resolves in the saved file.
        if (!svg.contains(target)) {
          spriteDefs ??= svg.ownerDocument.createElementNS(SVG_NS, 'defs');
          if (!spriteDefs.querySelector(`#${CSS.escape(id)}`)) {
            spriteDefs.appendChild(target.cloneNode(true));
          }
        }
      }
    }

    for (const attr of [...el.attributes]) {
      if (shouldDropAttribute(attr.name)) el.removeAttribute(attr.name);
    }
    for (const [name, value] of decisions[i] ?? []) el.setAttribute(name, value);
  });
  if (spriteDefs) clone.insertBefore(spriteDefs, clone.firstChild);

  // Root colour: resolves every surviving currentColor (fill/stroke) to the
  // ink the page actually showed under the emulated theme. Both the
  // presentation attribute and inline style so nothing can out-specify it.
  clone.setAttribute('color', rootColor);
  clone.style.color = rootColor;

  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', SVG_NS);

  let bboxRect = null;
  try { bboxRect = svg.getBBox(); } catch { /* display:none etc. — fall through */ }
  const viewBox = ensureViewBox({
    viewBoxAttr: clone.getAttribute('viewBox'),
    widthAttr: clone.getAttribute('width'),
    heightAttr: clone.getAttribute('height'),
    bboxRect,
  });
  if (viewBox) clone.setAttribute('viewBox', viewBox);

  // Icons sized purely by CSS (Tailwind's size-5) lose their dimensions with
  // their classes — pin the rendered size as intrinsic dimensions so <img>
  // previews and the KB's height styling scale rather than default to 300×150.
  if (!clone.getAttribute('width') || !clone.getAttribute('height')) {
    const r = svg.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      clone.setAttribute('width', String(Math.round(r.width)));
      clone.setAttribute('height', String(Math.round(r.height)));
    }
  }

  return new XMLSerializer().serializeToString(clone);
}

/**
 * Extract the SVG for one theme. Mirrors screenshotElement's shape: the
 * controller awaits this once per theme; the service worker owns the CDP
 * theme flip (captureExtractTheme → runExtractTheme) and pings back
 * serializeSvgForExtract between the themeDelay settle and the emulation
 * reset. The serialized text stays in this closure — nothing large rides
 * through the SW.
 *
 * @returns {Promise<{ dataUrl, filename } | null>} null on failure, matching
 *   screenshotElement's contract (the controller bails unless both themes land).
 */
export async function extractSvgForTheme(svg, { theme, settings }) {
  let svgText = null;
  let localError = null;

  const listener = (msg, _sender, sendResponse) => {
    if (msg.type !== 'serializeSvgForExtract') return false;
    chrome.runtime.onMessage.removeListener(listener);
    try {
      // A theme flip can make the site re-render (replace) the node; computed
      // styles of a detached element read empty, so fail loudly instead.
      if (!svg.isConnected) throw new Error('SVG left the page during the theme flip');
      svgText = serializeSvgElement(svg);
      sendResponse({});
    } catch (err) {
      localError = err;
      sendResponse({ error: err.message || 'serialize failed' });
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(listener);

  const response = await new Promise(resolve =>
    chrome.runtime.sendMessage({
      type: 'captureExtractTheme',
      forcedTheme: theme,
      themeDelay: theme ? (settings.themeDelay ?? 500) : 0,
    }, resolve)
  );

  // Covers the paths where the SW errors before the serialize leg — a stale
  // listener must never answer a later pass with this element's markup.
  chrome.runtime.onMessage.removeListener(listener);

  if (!response || response.error || localError || svgText == null) {
    console.error('[svgExtract] Extract failed:', response?.error || localError?.message);
    return null;
  }

  return {
    dataUrl: svgTextToDataUrl(svgText),
    filename: deriveFilename(svg, theme, 'svg'),
  };
}
