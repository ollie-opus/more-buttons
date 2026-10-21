// scripts/lucideIcons.js — the extension's ONE icon source: lucide, inlined as SVG.
//
// Every piece of extension chrome writes an icon the same way it always did:
//
//     <span class="more-buttons-icon">trash-2</span>
//
// but the text is now a lucide name instead of an icon-font ligature. A
// MutationObserver per document (watchIconSpans) swaps that text for the inline
// SVG the moment the span lands in the DOM, and again whenever its text is
// reassigned (toggle buttons do `icon.textContent = 'pin'`). Until the swap the
// stylesheet hides the bare name (`.more-buttons-icon:not(:has(> svg))`), so
// there is never a flash of icon names as text.
//
// Two bodies maps, both lazy:
//   config/lucideIconBodies.json    stock lucide OUTLINES (from the zensical
//                                   install the KB builds with — see
//                                   tools/regen-lucide-icons.sh). The only map
//                                   KB content previews use, so the editor
//                                   shows exactly what the site renders.
//   config/lucideFilledBodies.json  FILLED variants from applifted/lucide-extended
//                                   (tools/regen-lucide-filled-icons.sh). Chrome
//                                   prefers these and falls back to the outline
//                                   when no filled twin exists.
//
// Leaf module: no chrome.* / document access at module scope, and the DOM it
// touches is reached through arguments, so it imports cleanly in Node for tests.

const ICON_CLASS = 'more-buttons-icon';

let bodies = null;            // outline {name: innerSVG} once loaded (or primed)
let bodiesPromise = null;
let filledBodies = null;      // filled {name: innerSVG}, or null when absent/failed
let filledSettled = false;    // true once the filled load/prime has concluded either way
let filledPromise = null;
let chromePromise = null;
const pendingRoots = new Set(); // roots painted before the maps were ready
const warnedNames = new Set();

const bundledUrl = file => chrome.runtime.getURL('config/' + file);
const hasChrome = () => typeof chrome !== 'undefined' && !!chrome.runtime?.getURL;

/** Stock lucide envelope (asserted by the regen script); outline bodies are
 *  stored without it and re-wrapped here. width/height attrs size the glyph
 *  even where no extension stylesheet reaches; CSS overrides them where it does. */
export function wrapLucideBody(name, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="lucide lucide-${name}" viewBox="0 0 24 24">${body}</svg>`;
}

/** Filled envelope: solid paths, no stroke (the paths carry fill="currentColor"). */
export function wrapLucideFilledBody(name, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" class="lucide lucide-filled lucide-${name}">${body}</svg>`;
}

/** Drop every cached map and in-flight load (tests; a regen at runtime). */
export function resetLucideIcons() {
  bodies = null; bodiesPromise = null;
  filledBodies = null; filledSettled = false; filledPromise = null; chromePromise = null;
  pendingRoots.clear();
}

/** Install the outline map synchronously. `null` = not loaded. */
export function primeLucideBodies(map) {
  bodies = map && typeof map === 'object' ? map : null;
  bodiesPromise = bodies ? Promise.resolve(bodies) : null;
  if (bodies) flushPending();
}

/** Install the filled map synchronously; `null` settles it as "none available"
 *  (outline fallback everywhere). Either way the painter may proceed. */
export function primeLucideFilledBodies(map) {
  filledBodies = map && typeof map === 'object' ? map : null;
  filledSettled = true;
  filledPromise = Promise.resolve(filledBodies);
  flushPending();
}

/** Fetch the outline map once. Resolves null on failure — never rejects. */
export function loadLucideBodies() {
  bodiesPromise ??= fetch(bundledUrl('lucideIconBodies.json'))
    .then(r => r.json())
    .then(map => { bodies = map && typeof map === 'object' ? map : null; flushPending(); return bodies; })
    .catch(() => null);
  return bodiesPromise;
}

/** Fetch the filled map once. Resolves null on failure (outline fallback). */
export function loadLucideFilledBodies() {
  filledPromise ??= fetch(bundledUrl('lucideFilledBodies.json'))
    .then(r => r.json())
    .then(map => (map && typeof map === 'object' ? map : null))
    .catch(() => null)
    .then(map => { filledBodies = map; filledSettled = true; flushPending(); return map; });
  return filledPromise;
}

/** Everything the chrome painter needs: [outline, filled]. Never rejects. The
 *  page dock gates its first reveal on this. */
export function loadChromeIcons() {
  chromePromise ??= Promise.all([loadLucideBodies(), loadLucideFilledBodies()]);
  return chromePromise;
}

// Bodies come from the repo's own generated files, but the markup lands in the
// host page via innerHTML, so the no-script/no-handler check stays as
// belt-and-braces.
function safeBody(map, name) {
  if (!map || !name) return '';
  const body = typeof map[name] === 'string' ? map[name] : '';
  return !body || /<script|\bon\w+\s*=/i.test(body) ? '' : body;
}

/** Synchronous OUTLINE markup, or '' when not loaded / unknown. */
export function lucideSvg(name) {
  const body = safeBody(bodies, name);
  return body ? wrapLucideBody(name, body) : '';
}

/** Synchronous FILLED markup, or '' when no filled twin exists (or not loaded). */
export function lucideFilledSvg(name) {
  const body = safeBody(filledBodies, name);
  return body ? wrapLucideFilledBody(name, body) : '';
}

/** What extension chrome shows: filled when available, else the outline. */
export function chromeIconSvg(name) {
  return lucideFilledSvg(name) || lucideSvg(name);
}

/** Promise-returning OUTLINE markup for callers that don't care that the map
 *  is lazy (picker dropdown, RTE icon popover, button preview tiles). Always
 *  the outline: these preview KB content, and the site renders outlines. */
export function getLucideSvgMarkup(name) {
  return loadLucideBodies().then(() => lucideSvg(name));
}

const isIconSpan = n => !!n && n.nodeType === 1 && !!n.classList?.contains(ICON_CLASS);

// Paint one span. Returns false while either map is still unknown (the caller
// queues its root for a flush), so an icon never paints outline and then flips
// to filled a frame later.
function paintSpan(span) {
  const name = (span.textContent || '').trim();
  if (!name) return true;                                  // already painted / empty
  if (!bodies || !filledSettled) return false;
  const filled = lucideFilledSvg(name);
  const svg = filled || lucideSvg(name);
  if (!svg) {
    if (!warnedNames.has(name)) {
      warnedNames.add(name);
      console.warn(`MB Warn: unknown lucide icon "${name}"`);
    }
    return true;
  }
  span.dataset.mbIcon = name;
  span.dataset.mbIconStyle = filled ? 'filled' : 'outline';
  span.innerHTML = svg;
  return true;
}

/**
 * Fill every `.more-buttons-icon` span under `root` (or `root` itself) whose
 * text is still a lucide name. Idempotent. If the maps haven't loaded yet the
 * loads are kicked off and the root is repainted once they land.
 */
export function paintIconSpans(root) {
  if (!root) return;
  const spans = isIconSpan(root) ? [root] : (root.querySelectorAll ? [...root.querySelectorAll('.' + ICON_CLASS)] : []);
  let deferred = false;
  for (const span of spans) if (!paintSpan(span)) deferred = true;
  if (deferred) {
    pendingRoots.add(root);
    if (hasChrome()) loadChromeIcons();
  }
}

function flushPending() {
  if (!bodies || !filledSettled) return;
  const roots = [...pendingRoots];
  pendingRoots.clear();
  roots.forEach(paintIconSpans);
}

const watched = new WeakSet();

/**
 * Start the per-document painter: paints what's already there, then observes
 * `doc.documentElement` (the dock and capture bar mount there, not on body)
 * for added icon spans and for text reassigned on painted ones. Idempotent per
 * document. Without a MutationObserver (tests) it just paints once.
 */
export function watchIconSpans(doc) {
  if (!doc || watched.has(doc)) return;
  watched.add(doc);
  const rootEl = doc.documentElement;
  paintIconSpans(rootEl);
  const MO = doc.defaultView?.MutationObserver ?? globalThis.MutationObserver;
  if (typeof MO !== 'function') return;
  const observer = new MO(records => {
    for (const m of records) {
      if (m.type === 'characterData') {
        const span = m.target?.parentNode;
        if (isIconSpan(span)) paintIconSpans(span);
        continue;
      }
      if (isIconSpan(m.target)) { paintIconSpans(m.target); continue; }
      for (const n of m.addedNodes || []) {
        if (n.nodeType !== 1) continue;
        paintIconSpans(n);
      }
    }
  });
  observer.observe(rootEl, { childList: true, subtree: true, characterData: true });
}
