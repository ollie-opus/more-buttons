/**
 * admonitions.js — Shared primitives for parsing, building, and mutating
 * MkDocs-style admonition blocks in markdown strings.
 *
 * All functions are pure (no side-effects) except generateUUID().
 * Designed for Chrome Extension MV3 — no npm imports, native Web Crypto only.
 */

// ── UUID helpers ──────────────────────────────────────────────────────────────

/**
 * Generates a new random UUID using the native Web Crypto API.
 * @returns {string} A UUID v4 string, e.g. "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
 */
export function generateUUID() {
  return crypto.randomUUID();
}

// The admonition types valid as *components* inside guide sections and system-
// update bodies (distinct from the top-level system-update/status block types in
// github.js's ADMONITION_TYPE_BY_FILE). Lives here — the lowest-level admonition
// module — so the central migration in github.js can reference it without
// importing the high-level guides.js (which would create an import cycle).
// Re-exported from guides.js for existing callers.
export const GUIDE_ADMONITION_TYPES_RE =
  /step|outline|note|abstract|info|tip|success|question|warning|failure|danger|bug|example|quote/;

/**
 * Scans the first non-empty line of `body` for a `data-uuid` attribute and
 * returns its value, or `null` if no UUID span is present.
 *
 * The expected span format is:
 *   <span data-uuid="<uuid>" style="display:none"></span>
 *
 * @param {string} body - The admonition body (base-indent already stripped).
 * @returns {string|null} The UUID string, or null if not found.
 */
export function getAdmonitionUUID(body) {
  const lines = body.split('\n');
  for (const line of lines) {
    if (line === '') continue;
    const m = line.match(/data-uuid="([^"]+)"/);
    return m ? m[1] : null;
  }
  return null;
}

/**
 * Prepends a UUID hidden-span as the very first line of `body`.
 * The span is stored without any leading indent — callers that store body
 * lines with a 4-space prefix should strip that before calling this, and
 * re-add it when writing back.
 *
 * @param {string} body - The admonition body (base-indent already stripped).
 * @param {string} uuid - The UUID to embed.
 * @returns {string} Updated body with the UUID span prepended.
 */
export function injectAdmonitionUUID(body, uuid) {
  const span = `<span data-uuid="${uuid}" style="display:none"></span>`;
  return body.length ? `${span}\n${body}` : span;
}

// ── Parse / build ─────────────────────────────────────────────────────────────

/**
 * Parses all admonition blocks in `markdown` whose type matches `typeRegex`.
 * Handles any indent level (e.g. blocks nested inside `??? outline "..."`).
 *
 * Header pattern matched per line (title is optional — MkDocs allows
 * `!!! step` for an auto-titled block, in addition to `!!! step "Title"`):
 *   /^(\s*)(\?\?\?\+?|!!!) (<typeRegex source>)(?:\s+"(.*)")?\s*$/
 * (prefix is `???`, `???+`, or `!!!`)
 *
 * Body lines are those that start with (header-indent + 4 spaces) or are
 * blank lines within the block. The base-indent + 4-space prefix is stripped
 * from body lines before storing. Trailing blank lines are trimmed from body.
 *
 * Options:
 *   skipTabBlocks - when true, `=== "..."` content-tab blocks at any indent
 *                   are skipped over (so admonitions buried inside a tab
 *                   block are not returned as siblings of the tab).
 *
 * @param {string} markdown - Full markdown document.
 * @param {RegExp} typeRegex - Regex matching the admonition type field.
 * @param {{skipTabBlocks?: boolean}} [opts]
 * @returns {Array<{prefix: string, type: string, title: string, body: string, uuid: string|null, indent: string, headerLine: number, endLine: number}>}
 */
export function parseAdmonitions(markdown, typeRegex, { skipTabBlocks = false } = {}) {
  const lines = markdown.split('\n');
  const results = [];
  const headerRe = new RegExp(`^(\\s*)(\\?\\?\\?\\+?|!!!) (${typeRegex.source})(?:\\s+"(.*)")?\\s*$`);
  const tabRe = /^(\s*)=== "(.+)"\s*$/;

  let i = 0;
  while (i < lines.length) {
    if (skipTabBlocks) {
      const tabMatch = lines[i].match(tabRe);
      if (tabMatch) {
        const tabIndent = tabMatch[1].length;
        const tabContentIndent = tabIndent + 4;
        i++; // past the === line
        // Skip lines at or deeper than tabContentIndent (the tab's content),
        // plus blank lines, plus consecutive sibling tab headers at the same
        // indent (the same tab group).
        while (i < lines.length) {
          const line = lines[i];
          if (line === '') { i++; continue; }
          const lineIndent = (line.match(/^(\s*)/) || ['', ''])[1].length;
          if (lineIndent >= tabContentIndent) { i++; continue; }
          if (lineIndent === tabIndent && /^=== "(.+)"\s*$/.test(line.slice(tabIndent))) {
            i++; // sibling tab header
            continue;
          }
          break;
        }
        continue;
      }
    }

    const m = lines[i].match(headerRe);
    if (m) {
      const indent = m[1];       // leading whitespace of the header line
      const prefix = m[2];       // '???', '???+' or '!!!'
      const type   = m[3];       // admonition type string
      const title  = m[4] ?? ''; // quoted title content (empty when title is omitted)
      const bodyIndent = indent + '    '; // 4 more spaces than header
      const headerLine = i;

      i++;
      const bodyLines = [];
      while (i < lines.length) {
        const line = lines[i];
        if (line.startsWith(bodyIndent)) {
          bodyLines.push(line.slice(bodyIndent.length));
          i++;
        } else if (line === '') {
          // A blank line may be within the block — peek ahead to decide
          // whether the block continues. We collect it tentatively.
          bodyLines.push('');
          i++;
        } else {
          // Non-blank line that doesn't carry the expected indent: block ended.
          break;
        }
      }

      // Trim trailing blank lines from the body AND walk endLine back so the
      // splice/replace operations don't swallow the blank-line separator
      // before whatever content follows this block.
      while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1] === '') {
        bodyLines.pop();
      }
      let endLine = i;
      while (endLine > headerLine + 1 && lines[endLine - 1] === '') {
        endLine--;
      }
      const body = bodyLines.join('\n');
      const uuid = getAdmonitionUUID(body);

      results.push({ prefix, type, title, body, uuid, indent, headerLine, endLine });
    } else {
      i++;
    }
  }

  return results;
}

/**
 * Builds a complete admonition block string from its parts.
 * Body lines are indented 4 spaces; empty lines are left bare.
 *
 * Output format:
 *   ${prefix} ${type} "${title}"   (or `${prefix} ${type}` when title is empty —
 *                                   MkDocs auto-titles from the type)
 *
 *       ${body line 1}
 *       ${body line 2}
 *       ...
 *
 * @param {string} prefix - '???', '???+' or '!!!'
 * @param {string} type   - Admonition type, e.g. 'feature-release'
 * @param {string} title  - Title string (unquoted). Empty string ⇒ no quoted title.
 * @param {string} body   - Body content with NO leading indent
 * @returns {string} Full admonition block (no outer indent)
 */
export function buildAdmonition(prefix, type, title, body) {
  const header = title ? `${prefix} ${type} "${title}"` : `${prefix} ${type}`;
  const indentedBody = body
    .split('\n')
    .map(line => (line.length ? '    ' + line : line))
    .join('\n');
  return `${header}\n\n${indentedBody}`;
}

// ── Title / meta ──────────────────────────────────────────────────────────────

/**
 * Matches a trailing `<span class="meta">…</span>` on a title string. Group 1
 * is the visible title (may be empty); group 2 is the meta text. The meta span
 * must be the last thing on the line.
 */
const META_SPAN_RE = /^(.*?)<span class="meta"\s*>(.*?)<\/span>\s*$/;

/**
 * Splits an admonition's raw title into its visible title and trailing meta.
 * Meta is stored inline as `<span class="meta">…</span>` at the end of the
 * title (rendered muted on the docs site), e.g.
 *   `Configure access<span class="meta">(optional)</span>`
 * Titles with no meta span return `{ title: <raw>, meta: '' }`.
 *
 * @param {string} rawTitle
 * @returns {{ title: string, meta: string }}
 */
export function splitTitleMeta(rawTitle) {
  const m = (rawTitle ?? '').match(META_SPAN_RE);
  return m ? { title: m[1], meta: m[2] } : { title: rawTitle ?? '', meta: '' };
}

/**
 * Joins a visible title and meta back into a raw title string. When `meta` is
 * empty (after trimming) the title is returned unchanged — no span emitted.
 *
 * @param {string} title
 * @param {string} meta
 * @returns {string}
 */
export function joinTitleMeta(title, meta) {
  const t = title ?? '';
  const m = (meta ?? '').trim();
  return m ? `${t}<span class="meta">${m}</span>` : t;
}

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Re-indents every non-empty line of `block` by prepending `indent`.
 * Empty lines are left bare. Returns `block` unchanged when `indent` is falsy.
 *
 * @param {string} block  - Block text (may contain newlines).
 * @param {string} indent - Whitespace prefix to add.
 * @returns {string}
 */
function reindent(block, indent) {
  if (!indent) return block;
  return block.split('\n').map(l => (l.length ? indent + l : l)).join('\n');
}

// ── Locate helpers (internal) ─────────────────────────────────────────────────

/**
 * Locates the line range [headerLine, endLine) for the admonition that
 * contains a `data-uuid="${uuid}"` span.  endLine is exclusive (first line
 * AFTER the block).
 *
 * @param {string[]} lines - The markdown split into lines.
 * @param {string}   uuid  - The UUID to search for.
 * @returns {{ headerLine: number, endLine: number, headerIndent: string } | null}
 */
function locateBlockByUUID(lines, uuid) {
  // 1. Find the line containing the UUID span
  const uuidLineIdx = lines.findIndex(l => l.includes(`data-uuid="${uuid}"`));
  if (uuidLineIdx === -1) return null;

  // 2. Walk UP from the UUID line to find the nearest ??? / !!! header line
  let headerLine = -1;
  for (let i = uuidLineIdx; i >= 0; i--) {
    if (/^\s*(\?\?\?\+?|!!!) /.test(lines[i])) {
      headerLine = i;
      break;
    }
  }
  if (headerLine === -1) return null;

  // 3. Derive indents from the header line itself
  const headerIndent = lines[headerLine].match(/^(\s*)/)[1];
  const bodyIndent = headerIndent + '    ';

  // 4. Walk DOWN from the line after the header to find end of block
  let endLine = headerLine + 1;
  while (endLine < lines.length) {
    const line = lines[endLine];
    if (line === '' || line.startsWith(bodyIndent)) {
      endLine++;
    } else {
      break;
    }
  }
  // Trim trailing blank lines from the block interior
  while (endLine > headerLine + 1 && lines[endLine - 1] === '') {
    endLine--;
  }

  return { headerLine, endLine, headerIndent };
}

// ── Replace / delete by UUID ──────────────────────────────────────────────────

/**
 * Replaces the admonition block identified by `uuid` with `newBlock`.
 *
 * `newBlock` should be provided WITHOUT outer indentation. This function
 * re-indents it to match the original header's indent level before splicing.
 *
 * @param {string} markdown - Full markdown document.
 * @param {string} uuid     - UUID of the block to replace.
 * @param {string} newBlock - Replacement block text (no outer indent).
 * @returns {string} Updated markdown, or original if UUID not found.
 */
export function replaceAdmonitionByUUID(markdown, uuid, newBlock) {
  const lines = markdown.split('\n');
  const loc = locateBlockByUUID(lines, uuid);
  if (!loc) return markdown;

  const { headerLine, endLine, headerIndent } = loc;

  // Re-indent newBlock to match the original header's indent
  const indentedBlock = reindent(newBlock, headerIndent);

  return [
    ...lines.slice(0, headerLine),
    ...indentedBlock.split('\n'),
    ...lines.slice(endLine),
  ].join('\n');
}

/**
 * Deletes the admonition block identified by `uuid` from `markdown`.
 * Also removes one trailing blank line after the block if present.
 *
 * @param {string} markdown - Full markdown document.
 * @param {string} uuid     - UUID of the block to delete.
 * @returns {string} Updated markdown, or original if UUID not found.
 */
export function deleteAdmonitionByUUID(markdown, uuid) {
  const lines = markdown.split('\n');
  const loc = locateBlockByUUID(lines, uuid);
  if (!loc) return markdown;

  const { headerLine, endLine } = loc;

  // Remove one trailing blank line after the block if present
  let trailingEnd = endLine;
  if (trailingEnd < lines.length && lines[trailingEnd] === '') {
    trailingEnd++;
  }

  return [
    ...lines.slice(0, headerLine),
    ...lines.slice(trailingEnd),
  ].join('\n');
}

// ── Insert into parent ────────────────────────────────────────────────────────

/**
 * Inserts `newBlock` as the last child within the body of the admonition
 * identified by `parentUuid`. The new block is re-indented so it sits at
 * the parent body's indent level (header indent + 4).
 *
 * @param {string} markdown
 * @param {string} parentUuid
 * @param {string} newBlock - Replacement block text (no outer indent).
 * @returns {string}
 */
export function insertAdmonitionIntoParentByUUID(markdown, parentUuid, newBlock) {
  const lines = markdown.split('\n');
  const loc = locateBlockByUUID(lines, parentUuid);
  if (!loc) return markdown;

  const { endLine, headerIndent } = loc;
  const bodyIndent = headerIndent + '    ';
  const indentedBlock = reindent(newBlock, bodyIndent);

  return [
    ...lines.slice(0, endLine),
    '',
    ...indentedBlock.split('\n'),
    ...lines.slice(endLine),
  ].join('\n');
}

// ── UUID injection ────────────────────────────────────────────────────────────

/**
 * Ensures every admonition block matching `typeRegex` has an embedded UUID
 * span — at every nesting level. Blocks that already contain a UUID are
 * left untouched (but their bodies are still recursively visited).
 *
 * For each block:
 *   1. Recursively ensure UUIDs inside its body (so nested children are
 *      processed before the parent is rebuilt).
 *   2. If the block itself has no UUID, inject one at the top of the body.
 *   3. If anything changed, rebuild via `buildAdmonition` and splice back
 *      into the result.
 *
 * Blocks are processed in reverse order so earlier line indices remain valid
 * as we splice in replacement text.
 *
 * @param {string} markdown   - Full markdown document.
 * @param {RegExp} typeRegex  - Regex matching the admonition type field.
 * @returns {string} Updated markdown (unchanged if every block at every depth already has a UUID).
 */
export function ensureAdmonitionUUIDs(markdown, typeRegex) {
  const all = parseAdmonitions(markdown, typeRegex);
  if (all.length === 0) return markdown;

  let result = markdown.split('\n');
  let modified = false;
  for (let k = all.length - 1; k >= 0; k--) {
    const { headerLine, endLine, prefix, type, title, body, indent, uuid } = all[k];

    const bodyWithSubUUIDs = ensureAdmonitionUUIDs(body, typeRegex);
    const bodyChanged = bodyWithSubUUIDs !== body;
    const needsOwnUUID = uuid === null;
    if (!bodyChanged && !needsOwnUUID) continue;

    const finalBody = needsOwnUUID
      ? injectAdmonitionUUID(bodyWithSubUUIDs, generateUUID())
      : bodyWithSubUUIDs;
    const newBlock = buildAdmonition(prefix, type, title, finalBody);

    result = [
      ...result.slice(0, headerLine),
      ...reindent(newBlock, indent).split('\n'),
      ...result.slice(endLine),
    ];
    modified = true;
  }

  return modified ? result.join('\n') : markdown;
}
