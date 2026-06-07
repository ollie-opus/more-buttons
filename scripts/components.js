/**
 * components.js — Unified "Components" model for guide section / admonition
 * bodies (and, later, system-update bodies).
 *
 * A "component" is one of:
 *   - an admonition  (a `!!!`/`???` block — including steps, notes, and nested
 *                     sub-admonitions, which are themselves admonition components)
 *   - a capture      (a paired `![](…#only-light)` / `![](…#only-dark)` image)
 *
 * Historically captures and admonitions were stored segregated (description →
 * all captures → all sub-admonitions). This module parses a body into a single
 * ORDERED list of components and rebuilds it preserving that order, so the two
 * kinds can be freely interleaved.
 *
 * All functions here are pure (no DOM, no network) — markdown in, markdown out.
 */

import { parseAdmonitions, buildAdmonition } from './admonitions.js';
import { buildSectionUUIDSpan } from './sections.js';
import { buildCaptureLines } from './captures.js';

// Per-line light-capture matcher (mirrors captures.js' parseExistingCaptures,
// but line-addressable so we can interleave with admonitions by position).
const LIGHT_LINE_RE =
  /^(\s*)!\[\]\(\.\.\/assets\/([^)#]+)#only-light\)(?:\{\s*([^}]+?)\s*\})?\s*$/;
const DARK_LINE_RE = /^\s*!\[\]\(\.\.\/assets\/[^)#]+#only-dark\)/;
const UUID_SPAN_RE = /<span[^>]*data-uuid[^>]*><\/span>\n?/g;
const UUID_SPAN_LINE_RE = /^\s*<span[^>]*data-uuid="([^"]+)"[^>]*><\/span>\s*$/;

/** True when `line` falls within any `[start, end)` range. */
function inAnyRange(line, ranges) {
  return ranges.some(([start, end]) => line >= start && line < end);
}

/** Parses the dim mode/value out of a capture's `{ … }` attribute string. */
function parseDimAttrs(attrs) {
  if (!attrs) return { dimMode: 'none', dimValue: null };
  const widthMatch = attrs.match(/width="(\d+)"/);
  const heightMatch = attrs.match(/height:\s*(\d+)px/);
  const dimMode = widthMatch ? 'width' : 'height';
  const dimValue = widthMatch ? parseInt(widthMatch[1]) : (heightMatch ? parseInt(heightMatch[1]) : 50);
  return { dimMode, dimValue };
}

/**
 * Locates every top-level capture pair in `body`, returning line-addressable
 * entries. A pair is a `#only-light` line immediately followed (ignoring blanks)
 * by its `#only-dark` partner.
 *
 * @param {string} body
 * @returns {Array<{lightFilename,darkFilename,dimMode,dimValue,indent,startLine,endLine}>}
 */
export function locateCaptureLines(body) {
  const lines = (body ?? '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(LIGHT_LINE_RE);
    if (!m) continue;
    const indent = m[1];
    const lightFilename = m[2];
    const darkFilename = lightFilename.replace('-light-mode', '-dark-mode');
    const { dimMode, dimValue } = parseDimAttrs(m[3]);

    // The dark partner is the next non-blank line (if it is indeed a dark image).
    let j = i + 1;
    while (j < lines.length && lines[j] === '') j++;
    const endLine = (j < lines.length && DARK_LINE_RE.test(lines[j])) ? j + 1 : i + 1;

    // A hidden data-uuid span on the line immediately before the light image is
    // this capture's identity; extend startLine to swallow it.
    let startLine = i;
    let uuid = null;
    if (i > 0) {
      const sm = lines[i - 1].match(UUID_SPAN_LINE_RE);
      if (sm) { uuid = sm[1]; startLine = i - 1; }
    }

    out.push({ lightFilename, darkFilename, dimMode, dimValue, indent, uuid, startLine, endLine });
    i = endLine - 1;
  }
  return out;
}

/**
 * Parses `body` into an ordered component list plus the leading description.
 *
 * @param {string} body
 * @param {RegExp} typeRegex - admonition type matcher (e.g. GUIDE_ADMONITION_TYPES_RE)
 * @param {{skipTabBlocks?: boolean}} [opts]
 * @returns {{ description: string, components: Array }}
 *   Each component is `{ kind:'admonition', adm }` or `{ kind:'capture', cap }`.
 */
export function parseComponents(body, typeRegex, { skipTabBlocks = true } = {}) {
  const src = body ?? '';

  // Immediate-child admonitions (indent 0 within this dedented body).
  const adms = parseAdmonitions(src, typeRegex, { skipTabBlocks })
    .filter(a => a.indent === '');
  const admRanges = adms.map(a => [a.headerLine, a.endLine]);

  // Top-level captures: indent 0 and not buried inside an admonition block.
  const topCaptures = locateCaptureLines(src)
    .filter(c => c.indent === '' && !inAnyRange(c.startLine, admRanges));

  const items = [
    ...adms.map(adm => ({ kind: 'admonition', adm, startLine: adm.headerLine, endLine: adm.endLine })),
    ...topCaptures.map(c => ({
      kind: 'capture',
      cap: { lightFilename: c.lightFilename, darkFilename: c.darkFilename, dimMode: c.dimMode, dimValue: c.dimValue },
      startLine: c.startLine,
      endLine: c.endLine,
    })),
  ].sort((a, b) => a.startLine - b.startLine);

  const description = extractDescription(src, items);

  // Strip the internal line bookkeeping before handing components back.
  const components = items.map(it => it.kind === 'admonition'
    ? { kind: 'admonition', adm: it.adm }
    : { kind: 'capture', cap: it.cap });

  return { description, components };
}

/**
 * Returns the leading description text of `body` — everything that isn't part of
 * a component block. Mirrors splitSectionBody's removal logic.
 */
function extractDescription(body, items) {
  const lines = body.split('\n');
  const removed = items.map(it => ({ start: it.startLine, end: it.endLine }));
  removed.sort((a, b) => b.start - a.start); // descending so splices stay valid
  let descLines = lines.slice();
  for (const { start, end } of removed) {
    let extEnd = end;
    if (descLines[extEnd] === '') extEnd++; // eat one trailing blank
    descLines.splice(start, extEnd - start);
  }
  let desc = descLines.join('\n');
  desc = desc.replace(UUID_SPAN_RE, ''); // drop the admonition/section UUID span
  return desc.trim();
}

/**
 * Rebuilds a body from a description + ordered component list. Inverse of
 * parseComponents. Replaces both rebuildSectionBody and rebuildAdmonitionBody.
 *
 *   [uuidSpan?]
 *   description…
 *
 *   <component 1>
 *
 *   <component 2>
 *   …
 *
 * @param {string|null} uuid - admonition UUID to embed as a hidden span, or null
 *                             for sections (whose UUID lives in the heading).
 * @param {string} description
 * @param {Array} components - `{kind:'admonition', adm}` | `{kind:'capture', cap}`
 * @returns {string}
 */
export function buildComponentBody(uuid, description, components) {
  const lines = [];
  if (uuid) lines.push(buildSectionUUIDSpan(uuid));
  const desc = (description ?? '').trim();
  if (desc.length) lines.push(desc);

  for (const c of components) {
    lines.push(''); // one blank separator before each component
    if (c.kind === 'admonition') {
      const a = c.adm;
      // Strip leading blank lines from the parsed body before re-emitting:
      // parseAdmonitions captures the blank line under the header as part of
      // the body, and buildAdmonition re-adds its own header gap — so without
      // this, every round-trip accumulates an extra blank line inside the block.
      const body = (a.body ?? '').replace(/^\n+/, '');
      lines.push(buildAdmonition(a.prefix, a.type, a.title, body).trim());
    } else {
      // buildCaptureLines emits a leading '' we don't want (we add our own).
      lines.push(...buildCaptureLines([c.cap]).slice(1));
    }
  }
  return lines.join('\n');
}

/** Builds a fresh capture component from a (resolved) capture object. */
export function captureComponent(cap) {
  return { kind: 'capture', cap };
}

/** Builds an admonition component from a parsed admonition entry. */
export function admonitionComponent(adm) {
  return { kind: 'admonition', adm };
}
