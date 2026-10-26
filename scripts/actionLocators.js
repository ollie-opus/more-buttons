/**
 * actionLocators.js — how a recorded step finds its element again.
 *
 * A locator is an ORDERED list of candidates, most specific first. Recording
 * builds every candidate it can; playback walks the list and takes the first
 * one that matches exactly one element. That keeps a step working when the
 * host app shuffles its markup, as long as something stable survives.
 *
 *   id     #stable_id                 (generated-looking ids are skipped)
 *   name   input[name="…"]            (+ [value="…"] for radio/checkbox)
 *   attr   tag[data-testid|aria-label|data-action|data-controller="…"], a[href="/path"]
 *   label  the control's <label> text (form controls)
 *   text   trimmed text content, same tag (buttons, links, anything else)
 *   css    tag:nth-of-type(n) path up to the nearest stable-id ancestor — always
 *          present, always last
 *
 * Everything takes DOM-shaped arguments and uses only the DOM surface the
 * fake in tests/actionLocators.test.mjs provides: tagName, getAttribute,
 * textContent, parentElement/children, labels/control/htmlFor, closest,
 * querySelector(All). No document/window at module scope.
 */

const FORM_CONTROLS = new Set(['input', 'select', 'textarea']);
const NAMED_TAGS = new Set(['input', 'select', 'textarea', 'button']);
const ATTR_CANDIDATES = ['data-testid', 'aria-label', 'data-action', 'data-controller'];
const MAX_TEXT = 80;
const GENERATED_PREFIX = /^(radix-|headlessui-|react-|:r|ember|mui-|__)/;

export const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();

/** An id worth relying on: identifier-shaped and free of hex/digit runs that smell generated. */
export function isStableId(id) {
  if (!id || !/^[A-Za-z_][\w:-]*$/.test(id)) return false;
  if (GENERATED_PREFIX.test(id)) return false;
  if (/[0-9a-f]{8,}/i.test(id) || /\d{4,}/.test(id)) return false;
  return true;
}

/** CSS identifier escape (hand-rolled so it runs under Node). */
export function escapeCss(s) {
  return String(s).replace(/[^\w-]/g, ch => '\\' + ch);
}

const escAttr = v => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const tagOf = el => el.tagName.toLowerCase();

function nthOfType(el) {
  const sibs = el.parentElement ? Array.from(el.parentElement.children).filter(s => s.tagName === el.tagName) : [el];
  return sibs.indexOf(el) + 1;
}

/** Structural path: `#anchor > div:nth-of-type(2) > button:nth-of-type(1)`, anchored at the nearest stable-id ancestor or <body>. */
export function cssPathFor(el) {
  const parts = [];
  let node = el;
  while (node) {
    const tag = tagOf(node);
    const parent = node.parentElement;
    if (node !== el && isStableId(node.id)) { parts.unshift('#' + escapeCss(node.id)); break; }
    if (tag === 'body' || tag === 'html' || !parent) { parts.unshift(tag); break; }
    parts.unshift(`${tag}:nth-of-type(${nthOfType(node)})`);
    node = parent;
  }
  return parts.join(' > ');
}

function topOf(el) {
  let n = el;
  while (n.parentElement) n = n.parentElement;
  return n;
}

/** Visible label text for a form control: <label> association, wrapping label, for=, aria-labelledby. */
export function labelTextFor(el, root = null) {
  const scope = root ?? el.ownerDocument ?? topOf(el);
  const own = el.labels?.[0];
  if (own) return norm(own.textContent);
  const wrap = el.closest?.('label');
  if (wrap) return norm(wrap.textContent);
  const id = el.getAttribute('id');
  if (id) {
    const forLabel = scope.querySelector?.(`label[for="${escAttr(id)}"]`);
    if (forLabel) return norm(forLabel.textContent);
  }
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const texts = by.split(/\s+/).map(i => scope.querySelector?.('#' + escapeCss(i))?.textContent ?? '').filter(Boolean);
    if (texts.length) return norm(texts.join(' '));
  }
  return '';
}

function hrefPath(href) {
  try { const u = new URL(href, 'http://mb.local'); return u.pathname + u.search; } catch { return null; }
}

const keyOf = c => c.selector ?? `${c.type}:${c.tag}:${c.text}`;

/** Ordered candidates for re-finding `el`. */
export function buildLocator(el) {
  const tag = tagOf(el);
  const type = (el.getAttribute('type') ?? '').toLowerCase();
  const C = [];

  const id = el.getAttribute('id');
  if (isStableId(id)) C.push({ type: 'id', selector: '#' + escapeCss(id) });

  const name = el.getAttribute('name');
  if (name && NAMED_TAGS.has(tag)) {
    let sel = `${tag}[name="${escAttr(name)}"]`;
    if (type === 'radio' || type === 'checkbox') sel += `[value="${escAttr(el.getAttribute('value') ?? el.value ?? '')}"]`;
    C.push({ type: 'name', selector: sel });
  }

  for (const attr of ATTR_CANDIDATES) {
    const v = el.getAttribute(attr);
    if (v) C.push({ type: 'attr', selector: `${tag}[${attr}="${escAttr(v)}"]` });
  }
  if (tag === 'a') {
    const path = hrefPath(el.getAttribute('href') ?? '');
    if (path) C.push({ type: 'attr', selector: `a[href="${escAttr(path)}"]` });
  }

  if (FORM_CONTROLS.has(tag)) {
    const text = labelTextFor(el);
    if (text && text.length <= MAX_TEXT) C.push({ type: 'label', tag, text });
  } else {
    const text = norm(el.textContent);
    if (text && text.length <= MAX_TEXT) C.push({ type: 'text', tag, text });
  }

  C.push({ type: 'css', selector: cssPathFor(el) });
  return { key: keyOf(C[0]), candidates: C };
}

/** Human description for the timeline: { label, tag, type }. */
export function describeElement(el) {
  const tag = tagOf(el);
  const label = labelTextFor(el) || norm(el.getAttribute('aria-label')) || norm(el.getAttribute('placeholder'))
    || norm(el.textContent) || norm(el.getAttribute('name')) || norm(el.getAttribute('id')) || tag;
  const type = el.getAttribute('type');
  return { label, tag, type: type ? type.toLowerCase() : null };
}

export function defaultIsVisible(el) {
  if (el.isConnected === false) return false;
  return el.offsetParent !== null || (el.getClientRects?.().length ?? 0) > 0;
}

function controlOfLabel(label, root) {
  if (label.control) return label.control;
  const f = label.htmlFor || label.getAttribute?.('for');
  return f ? root.querySelector('#' + escapeCss(f)) : null;
}

function matchesFor(cand, root) {
  try {
    if (cand.type === 'text') {
      return Array.from(root.querySelectorAll(cand.tag)).filter(n => norm(n.textContent) === cand.text);
    }
    if (cand.type === 'label') {
      return Array.from(root.querySelectorAll('label'))
        .filter(l => norm(l.textContent) === cand.text)
        .map(l => controlOfLabel(l, root))
        .filter(c => c && tagOf(c) === cand.tag);
    }
    return Array.from(root.querySelectorAll(cand.selector));
  } catch {
    return [];
  }
}

/**
 * First candidate matching exactly one element wins. A tie is first thinned
 * to visible elements (hidden duplicates: mobile navs, template rows).
 * Returns { el, candidate, tried: [{ candidate, count }] }.
 */
export function resolveLocator(locator, root, { isVisible = defaultIsVisible } = {}) {
  const tried = [];
  for (const candidate of locator?.candidates ?? []) {
    let matches = matchesFor(candidate, root);
    if (matches.length > 1) matches = matches.filter(isVisible);
    if (matches.length === 1) return { el: matches[0], candidate, tried };
    tried.push({ candidate, count: matches.length });
  }
  return { el: null, candidate: null, tried };
}
