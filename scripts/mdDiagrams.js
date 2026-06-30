/**
 * mdDiagrams.js — Zensical "diagram" component markdown round-trip.
 *
 * A diagram is a Mermaid fenced code block:
 *   ```mermaid
 *   graph TD
 *     A --> B
 *   ```
 *
 * Like the button (see mdButtons.js) it is a leaf component — it holds no
 * sub-components and is always form-authored. Identity is a hidden
 * `<span data-uuid>` on the line BEFORE the opening fence, the same convention
 * captures/videos/buttons use.
 *
 * The one structural difference from buttons: a diagram is a multi-line block
 * (fence-open → fence-close), so locate/replace/delete work on a LINE RANGE, not
 * a single line. Mermaid source never itself contains ``` fences, so "open at
 * ```mermaid, close at the next bare ``` at the same indent" is unambiguous.
 *
 * All functions here are pure (no DOM, no network) except generateUUID.
 */

import { generateUUID } from './admonitions.js';

// The opening fence: optional indent, ``` then `mermaid` (allowing surrounding
// whitespace), nothing else. Group 1 is the indent.
const FENCE_OPEN_RE = /^(\s*)```\s*mermaid\s*$/;
// A bare closing fence: optional indent, ``` and nothing but whitespace after.
// Never matches the open line (which carries `mermaid`).
const FENCE_CLOSE_RE = /^(\s*)```\s*$/;

const UUID_SPAN_LINE_RE = /^\s*<span[^>]*data-uuid="([^"]+)"[^>]*><\/span>\s*$/;

/**
 * Emits the markdown lines for each diagram. Mirrors buildButtonLines: a leading
 * '' separator, then an optional uuid span, then the fenced block.
 * buildComponentBody slices off the leading ''.
 *
 * @param {Array<{uuid?,code}>} list
 * @returns {string[]}
 */
export function buildDiagramLines(list = []) {
  return list.flatMap(d => {
    const codeLines = (d.code ?? '').split('\n');
    const spanLines = d.uuid ? [`<span data-uuid="${d.uuid}" style="display:none"></span>`] : [];
    return ['', ...spanLines, '```mermaid', ...codeLines, '```'];
  });
}

/**
 * Locates every top-level diagram in `body`, returning line-addressable entries.
 * A preceding own-line uuid span is swallowed into startLine (its identity).
 *
 * @param {string} body
 * @returns {Array<{uuid,code,indent,startLine,endLine}>}
 */
export function locateDiagramLines(body) {
  const lines = (body ?? '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(FENCE_OPEN_RE);
    if (!m) continue;
    const indent = m[1];

    // Find the matching close fence at the same indent.
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const cm = lines[j].match(FENCE_CLOSE_RE);
      if (cm && cm[1] === indent) { close = j; break; }
    }
    if (close === -1) continue; // unterminated fence — not a complete diagram

    // Dedent the code to the fence indent so `code` is the author's canonical
    // source (what the textarea shows / the merge baseline compares), never the
    // ancestor's indent. replaceDiagramByUUID re-adds loc.indent exactly once,
    // so this also keeps a nested diagram from gaining 4 spaces on every save.
    const code = lines.slice(i + 1, close)
      .map(l => (indent && l.startsWith(indent)) ? l.slice(indent.length) : l)
      .join('\n');

    let startLine = i;
    let uuid = null;
    if (i > 0) {
      const sm = lines[i - 1].match(UUID_SPAN_LINE_RE);
      if (sm) { uuid = sm[1]; startLine = i - 1; }
    }

    out.push({ uuid, code, indent, startLine, endLine: close + 1 });
    i = close; // resume scanning after the close fence
  }
  return out;
}

/**
 * Backfills a hidden data-uuid span before every diagram that lacks one.
 * Idempotent; reverse-order splice keeps earlier indices valid. Mirrors
 * ensureButtonUUIDs.
 */
export function ensureDiagramUUIDs(markdown) {
  const diags = locateDiagramLines(markdown);
  if (diags.length === 0) return markdown;
  const lines = (markdown ?? '').split('\n');
  let modified = false;
  for (let k = diags.length - 1; k >= 0; k--) {
    const d = diags[k];
    if (d.uuid) continue;
    const span = `${d.indent}<span data-uuid="${generateUUID()}" style="display:none"></span>`;
    lines.splice(d.startLine, 0, span);
    modified = true;
  }
  return modified ? lines.join('\n') : markdown;
}

/** Finds the diagram identified by `uuid` anywhere in `md`, or null. */
export function locateDiagramByUUID(md, uuid) {
  return locateDiagramLines(md).find(d => d.uuid === uuid) ?? null;
}

/**
 * Replaces the fenced block of the diagram identified by `uuid` with a fresh
 * fence wrapping `code`. Leaves the identity span in place. Returns the original
 * markdown if the uuid is absent.
 */
export function replaceDiagramByUUID(md, uuid, code) {
  const lines = (md ?? '').split('\n');
  const loc = locateDiagramByUUID(md, uuid);
  if (!loc) return md;
  // The open fence is the line after a swallowed span, else startLine itself;
  // the close fence is endLine - 1.
  const openLine = loc.uuid ? loc.startLine + 1 : loc.startLine;
  const closeLine = loc.endLine - 1;
  // Re-indent the code lines to the diagram's own indent so a nested diagram
  // (inside a content tab, grid cell, …) stays within its ancestor's block.
  // The fences and the form-canonical (dedented) code carry no indent of their
  // own, so we add loc.indent uniformly — mirroring how container writeBody
  // re-indents children. Blank lines stay blank.
  const newFence = [
    `${loc.indent}\`\`\`mermaid`,
    ...(code ?? '').split('\n').map(l => (l.length ? loc.indent + l : l)),
    `${loc.indent}\`\`\``,
  ];
  lines.splice(openLine, closeLine - openLine + 1, ...newFence);
  return lines.join('\n');
}

/**
 * Deletes the diagram identified by `uuid` (its identity span + fenced block),
 * plus one trailing blank line if present. Mirrors deleteButtonByUUID. Returns
 * the original markdown if the uuid is absent.
 */
export function deleteDiagramByUUID(md, uuid) {
  const lines = (md ?? '').split('\n');
  const loc = locateDiagramByUUID(md, uuid);
  if (!loc) return md;
  let end = loc.endLine;
  if (end < lines.length && lines[end] === '') end++; // eat one trailing blank
  lines.splice(loc.startLine, end - loc.startLine);
  return lines.join('\n');
}

/** Builds a fresh diagram component from a diagram object. */
export function diagramComponent(dia) {
  return { kind: 'diagram', dia };
}

/**
 * Canonical form/merge representation of a diagram's editable fields. Mirrors
 * buttonDimFields — the edit form seeds its baseline from this AND parses fresh
 * markdown through it, so an untouched diagram compares equal.
 */
export function diagramDimFields(dia) {
  return { diagramCode: dia?.code ?? '' };
}
