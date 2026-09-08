/**
 * mdCodeBlocks.js — Zensical "code block" component markdown round-trip.
 *
 * A code block is a pymdownx.superfences fenced block with optional
 * pymdownx.highlight options on the info line:
 *
 *   ```python title="bubble_sort.py" linenums="1" hl_lines="2 3"
 *   def bubble_sort(items):  # (1)!
 *       ...
 *   ```
 *
 *   1. Annotation text (markdown allowed)
 *
 * Like the diagram (see mdDiagrams.js) it is a leaf component — no children,
 * always form-authored. Identity is a hidden `<span data-uuid>` on the line
 * BEFORE the opening fence, the shared leaf convention.
 *
 * Two things distinguish it from a diagram:
 *   - The info line: a language plus `title` / `linenums` / `hl_lines` attrs,
 *     parsed with one regex per option (the mdButtons attr pattern). Attrs we
 *     don't model (e.g. a `{ .yaml .annotate }` brace form, `.no-copy`) are
 *     preserved verbatim in `extra` and re-emitted on save, never edited.
 *   - Annotations: when the code carries a `(n)`/`(n)!` marker, the ordered
 *     list directly after the close fence (one optional blank line between) is
 *     part of the block — content.code.annotate turns it into tooltips on the
 *     published page. Without a marker in the code a following list is plain
 *     description and is left alone.
 *
 * ```mermaid fences are NOT code blocks — they stay `kind: 'diagram'`. The
 * locator jumps over a whole mermaid block (open → close) so the mermaid close
 * fence can never be mistaken for a bare code-fence open.
 *
 * All functions here are pure (no DOM, no network) except generateUUID.
 */

import { generateUUID } from './admonitions.js';
import { hasAnnotationMarker } from './codeAnnotations.js';

// Any fence line: optional indent, ``` then the info string (may be empty —
// a bare ``` opens a plain, language-less block when encountered while not
// inside a fence). Group 1 indent, group 2 info.
const FENCE_LINE_RE = /^(\s*)```([^`\r\n]*?)\s*$/;
// A bare closing fence: optional indent, ``` and nothing but whitespace after.
const FENCE_CLOSE_RE = /^(\s*)```\s*$/;

const UUID_SPAN_LINE_RE = /^\s*<span[^>]*data-uuid="([^"]+)"[^>]*><\/span>\s*$/;

// Info-line attrs, one regex per option (house pattern: mdButtons.js).
const TITLE_ATTR_RE = /\btitle="([^"]*)"/;
const LINENUMS_ATTR_RE = /\blinenums="(\d+)"/;
const HL_LINES_ATTR_RE = /\bhl_lines="([^"]*)"/;
// A language id token: word chars plus the #+.- family (c#, c++, objective-c).
const LANGUAGE_TOKEN_RE = /^[\w#+.-]+$/;

// Joins the annotations into the single hidden `codeAnnotations` form/merge
// scalar. Annotations are full markdown and may contain newlines (even blank
// lines between paragraphs), so the separator is the ASCII unit separator —
// a character that can never appear in typed text.
export const ANNOTATION_SEP = '\u001f';

/**
 * Parses a fence info string into the modelled fields plus a verbatim `extra`
 * remainder. A brace-form info (`{ .yaml .annotate }`) is entirely opaque to
 * the form: everything rides in `extra` untouched.
 */
export function parseFenceInfo(info) {
  const src = (info ?? '').trim();
  if (src.startsWith('{')) {
    return { language: '', title: '', linenums: '', hlLines: '', extra: src };
  }
  const title = src.match(TITLE_ATTR_RE)?.[1] ?? '';
  const linenums = src.match(LINENUMS_ATTR_RE)?.[1] ?? '';
  const hlLines = src.match(HL_LINES_ATTR_RE)?.[1] ?? '';
  const rest = src
    .replace(TITLE_ATTR_RE, '')
    .replace(LINENUMS_ATTR_RE, '')
    .replace(HL_LINES_ATTR_RE, '')
    .trim();
  const tokens = rest.split(/\s+/).filter(Boolean);
  let language = '';
  if (tokens.length && LANGUAGE_TOKEN_RE.test(tokens[0])) language = tokens.shift();
  return { language, title, linenums, hlLines, extra: tokens.join(' ') };
}

/** Inverse of parseFenceInfo: the full opening-fence line (no indent). */
export function buildFenceOpen({ language = '', title = '', linenums = '', hlLines = '', extra = '' } = {}) {
  const parts = [];
  if (language) parts.push(language);
  if (title) parts.push(`title="${title}"`);
  if (linenums) parts.push(`linenums="${linenums}"`);
  if (hlLines) parts.push(`hl_lines="${hlLines}"`);
  if (extra) parts.push(extra);
  return parts.length ? '```' + parts.join(' ') : '```';
}

/**
 * Emits the markdown lines for each code block. Mirrors buildDiagramLines: a
 * leading '' separator, then an optional uuid span, the fenced block, and —
 * when there are annotations — a blank line plus the renumbered ordered list.
 * buildComponentBody slices off the leading ''.
 *
 * @param {Array<{uuid?,language?,title?,linenums?,hlLines?,extra?,code,annotations?}>} list
 * @returns {string[]}
 */
export function buildCodeBlockLines(list = []) {
  return list.flatMap(cb => {
    const codeLines = (cb.code ?? '').split('\n');
    const spanLines = cb.uuid ? [`<span data-uuid="${cb.uuid}" style="display:none"></span>`] : [];
    const anns = (cb.annotations ?? []).map(a => (a ?? '').trim()).filter(Boolean);
    // Annotations are full markdown: the first line rides on the list marker,
    // every further line (blank lines included — paragraph breaks) is a
    // 4-space-indented continuation of the item.
    const annLines = anns.length ? ['', ...anns.flatMap((a, i) => {
      const [first, ...rest] = a.split('\n');
      return [`${i + 1}. ${first}`, ...rest.map(l => (l.length ? '    ' + l : l))];
    })] : [];
    return ['', ...spanLines, buildFenceOpen(cb), ...codeLines, '```', ...annLines];
  });
}

/**
 * Locates every code block in `body` (any indent — parseComponents both
 * filters to indent '' for the component list AND uses the full set as a mask
 * so fence content is never misparsed as other components).
 *
 * A preceding own-line uuid span is swallowed into startLine (its identity);
 * a trailing annotation list is swallowed into endLine when the code carries a
 * marker. Mermaid blocks are skipped whole.
 *
 * @param {string} body
 * @returns {Array<{uuid,language,title,linenums,hlLines,extra,code,annotations,indent,startLine,endLine}>}
 */
export function locateCodeBlockLines(body) {
  const lines = (body ?? '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(FENCE_LINE_RE);
    if (!m) continue;
    const indent = m[1];
    const info = m[2].trim();

    // Find the matching close fence at the same indent.
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const cm = lines[j].match(FENCE_CLOSE_RE);
      if (cm && cm[1] === indent) { close = j; break; }
    }
    if (close === -1) continue; // unterminated fence — not a complete block

    if (info === 'mermaid') { i = close; continue; } // a diagram, not ours

    // Dedent the code to the fence indent (see locateDiagramLines for why:
    // the form/merge canonical source must not carry the ancestor's indent).
    const code = lines.slice(i + 1, close)
      .map(l => (indent && l.startsWith(indent)) ? l.slice(indent.length) : l)
      .join('\n');

    let startLine = i;
    let uuid = null;
    if (i > 0) {
      const sm = lines[i - 1].match(UUID_SPAN_LINE_RE);
      if (sm) { uuid = sm[1]; startLine = i - 1; }
    }

    // Swallow a trailing annotation list only when the code has a marker.
    // Items may be multiline: 4-space-indented continuation lines belong to
    // the item above, and so do interior blank lines (paragraph breaks) as
    // long as more list content follows. Blank lines between/after items are
    // list formatting, not content — dropped on parse, never re-emitted.
    let endLine = close + 1;
    const annotations = [];
    if (hasAnnotationMarker(code)) {
      let j = close + 1;
      if (j < lines.length && lines[j].trim() === '') j++;
      const itemRe = new RegExp('^' + indent + '(\\d+)[.] +(.*)$');
      const contRe = new RegExp('^' + indent + '    (.*)$');
      let k = j;
      let cur = null; // content lines of the item being collected
      let lastContent = -1; // last line that was item/continuation content
      const flush = () => {
        if (!cur) return;
        while (cur.length && cur[cur.length - 1] === '') cur.pop(); // trailing blanks are separators
        annotations.push(cur.join('\n'));
        cur = null;
      };
      while (k < lines.length) {
        const line = lines[k];
        const im = line.match(itemRe);
        if (im) { flush(); cur = [im[2]]; lastContent = k; k++; continue; }
        if (cur) {
          const cm = line.match(contRe);
          if (cm) { cur.push(cm[1]); lastContent = k; k++; continue; }
          if (line.trim() === '') {
            // A blank belongs to the list only if more list content follows.
            let t = k + 1;
            while (t < lines.length && lines[t].trim() === '') t++;
            if (t < lines.length && (itemRe.test(lines[t]) || contRe.test(lines[t]))) {
              cur.push('');
              k++;
              continue;
            }
          }
        }
        break;
      }
      flush();
      if (annotations.length) endLine = lastContent + 1;
    }

    out.push({
      uuid, ...parseFenceInfo(info), code, annotations,
      indent, startLine, endLine,
    });
    i = endLine - 1; // resume scanning after the block (incl. annotations)
  }
  return out;
}

/**
 * Backfills a hidden data-uuid span before every code block that lacks one.
 * Idempotent; reverse-order splice keeps earlier indices valid. Mirrors
 * ensureDiagramUUIDs.
 */
export function ensureCodeBlockUUIDs(markdown) {
  const blocks = locateCodeBlockLines(markdown);
  if (blocks.length === 0) return markdown;
  const lines = (markdown ?? '').split('\n');
  let modified = false;
  for (let k = blocks.length - 1; k >= 0; k--) {
    const cb = blocks[k];
    if (cb.uuid) continue;
    const span = `${cb.indent}<span data-uuid="${generateUUID()}" style="display:none"></span>`;
    lines.splice(cb.startLine, 0, span);
    modified = true;
  }
  return modified ? lines.join('\n') : markdown;
}

/** Finds the code block identified by `uuid` anywhere in `md`, or null. */
export function locateCodeBlockByUUID(md, uuid) {
  return locateCodeBlockLines(md).find(cb => cb.uuid === uuid) ?? null;
}

/**
 * Replaces the block of the code block identified by `uuid` (fence + code +
 * annotation list) with a fresh one built from `fields`. Leaves the identity
 * span in place and preserves the located block's unmodelled `extra` attrs.
 * Returns the original markdown if the uuid is absent.
 *
 * @param {string} md
 * @param {string} uuid
 * @param {{language,title,linenums,hlLines,code,annotations}} fields
 */
export function replaceCodeBlockByUUID(md, uuid, fields) {
  const lines = (md ?? '').split('\n');
  const loc = locateCodeBlockByUUID(md, uuid);
  if (!loc) return md;
  // The open fence is the line after a swallowed span, else startLine itself;
  // the block (incl. any annotation list) runs through endLine - 1.
  const openLine = loc.uuid ? loc.startLine + 1 : loc.startLine;
  // Re-indent to the block's own indent so a nested code block (inside a
  // content tab, grid cell, …) stays within its ancestor's block. Blank lines
  // stay blank — including the fence→annotations separator.
  const fresh = buildCodeBlockLines([{ ...fields, extra: loc.extra, uuid: null }])
    .slice(1) // drop the leading '' separator
    .map(l => (l.length ? loc.indent + l : l));
  lines.splice(openLine, loc.endLine - openLine, ...fresh);
  return lines.join('\n');
}

/**
 * Deletes the code block identified by `uuid` (its identity span + block +
 * annotations), plus one trailing blank line if present. Mirrors
 * deleteDiagramByUUID. Returns the original markdown if the uuid is absent.
 */
export function deleteCodeBlockByUUID(md, uuid) {
  const lines = (md ?? '').split('\n');
  const loc = locateCodeBlockByUUID(md, uuid);
  if (!loc) return md;
  let end = loc.endLine;
  if (end < lines.length && lines[end] === '') end++; // eat one trailing blank
  lines.splice(loc.startLine, end - loc.startLine);
  return lines.join('\n');
}

/** Builds a fresh code-block component from a code-block object. */
export function codeBlockComponent(cb) {
  return { kind: 'codeblock', cb };
}

/**
 * Canonical form/merge representation of a code block's editable fields.
 * Mirrors captureDimFields' mode/value split for line numbers — the edit form
 * seeds its baseline from this AND parses fresh markdown through it, so an
 * untouched block compares equal. Annotations (which are multiline markdown)
 * ride as one ANNOTATION_SEP-joined scalar; the form's dynamic textarea rows
 * are a view over a hidden input holding this value.
 */
export function codeBlockDimFields(cb) {
  const linenums = cb?.linenums ?? '';
  return {
    codeLanguage: cb?.language ?? '',
    codeTitle: cb?.title ?? '',
    codeLinenumsMode: linenums ? 'on' : 'off',
    codeLinenumsStart: linenums ? String(linenums) : '',
    codeHlLines: cb?.hlLines ?? '',
    codeSource: cb?.code ?? '',
    codeAnnotations: (cb?.annotations ?? []).join(ANNOTATION_SEP),
  };
}

/**
 * Inverse of codeBlockDimFields: form/merge field values → the code-block
 * field shape replaceCodeBlockByUUID / buildCodeBlockLines consume. An 'on'
 * line-numbers mode with a blank start defaults to 1.
 */
export function codeBlockFromDimFields(d = {}) {
  return {
    language: (d.codeLanguage ?? '').trim(),
    title: (d.codeTitle ?? '').trim(),
    linenums: d.codeLinenumsMode === 'on' ? ((d.codeLinenumsStart ?? '').trim() || '1') : '',
    hlLines: (d.codeHlLines ?? '').trim(),
    code: d.codeSource ?? '',
    annotations: (d.codeAnnotations ?? '').split(ANNOTATION_SEP).map(s => s.trim()).filter(Boolean),
  };
}
