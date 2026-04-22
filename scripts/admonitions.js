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
 * Header pattern matched per line:
 *   /^(\s*)(\?\?\?|!!!) (<typeRegex source>) "(.+)"$/
 *
 * Body lines are those that start with (header-indent + 4 spaces) or are
 * blank lines within the block. The base-indent + 4-space prefix is stripped
 * from body lines before storing. Trailing blank lines are trimmed from body.
 *
 * @param {string} markdown - Full markdown document.
 * @param {RegExp} typeRegex - Regex matching the admonition type field.
 * @returns {Array<{prefix: string, type: string, title: string, body: string, uuid: string|null, indent: string, headerLine: number, endLine: number}>}
 */
export function parseAdmonitions(markdown, typeRegex) {
  const lines = markdown.split('\n');
  const results = [];
  const headerRe = new RegExp(`^(\\s*)(\\?\\?\\?|!!!) (${typeRegex.source}) "(.+)"$`);

  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(headerRe);
    if (m) {
      const indent = m[1];       // leading whitespace of the header line
      const prefix = m[2];       // '???' or '!!!'
      const type   = m[3];       // admonition type string
      const title  = m[4];       // quoted title content
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

      // Trim trailing blank lines
      while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1] === '') {
        bodyLines.pop();
      }

      const endLine = i; // first line index after the block
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
 *   ${prefix} ${type} "${title}"
 *
 *       ${body line 1}
 *       ${body line 2}
 *       ...
 *
 * @param {string} prefix - '???' or '!!!'
 * @param {string} type   - Admonition type, e.g. 'feature-release'
 * @param {string} title  - Title string (unquoted)
 * @param {string} body   - Body content with NO leading indent
 * @returns {string} Full admonition block (no outer indent)
 */
export function buildAdmonition(prefix, type, title, body) {
  const header = `${prefix} ${type} "${title}"`;
  const indentedBody = body
    .split('\n')
    .map(line => (line.length ? '    ' + line : line))
    .join('\n');
  return `${header}\n\n${indentedBody}`;
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
    if (/^\s*(\?\?\?|!!!) /.test(lines[i])) {
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

// ── UUID injection ────────────────────────────────────────────────────────────

/**
 * Ensures every admonition block matching `typeRegex` has an embedded UUID
 * span. Blocks that already contain a UUID are left untouched.
 *
 * For blocks without a UUID, a new UUID is generated, injected into the body,
 * the block is rebuilt with `buildAdmonition`, re-indented to the block's
 * original indent level, and spliced back in by direct line-range replacement
 * (since these blocks have no UUID yet, we use the line positions from the
 * initial parse pass, processing in reverse order so earlier indices remain
 * stable).
 *
 * @param {string} markdown   - Full markdown document.
 * @param {RegExp} typeRegex  - Regex matching the admonition type field.
 * @returns {string} Updated markdown (unchanged if all blocks already have UUIDs).
 */
export function ensureAdmonitionUUIDs(markdown, typeRegex) {
  const needsUUID = parseAdmonitions(markdown, typeRegex).filter(b => b.uuid === null);

  if (needsUUID.length === 0) return markdown;

  // Process in reverse order so line indices of earlier blocks remain valid
  // as we splice in replacement text.
  let result = markdown.split('\n');
  for (let k = needsUUID.length - 1; k >= 0; k--) {
    const { headerLine, endLine, prefix, type, title, body, indent } = needsUUID[k];
    const newUUID  = generateUUID();
    const newBody  = injectAdmonitionUUID(body, newUUID);
    const newBlock = buildAdmonition(prefix, type, title, newBody);

    result = [
      ...result.slice(0, headerLine),
      ...reindent(newBlock, indent).split('\n'),
      ...result.slice(endLine),
    ];
  }

  return result.join('\n');
}
