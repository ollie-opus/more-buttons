/**
 * contentTabs.js — Pure primitives for parsing, building, and mutating
 * Zensical/MkDocs content-tab blocks (`=== "Title"`) in markdown strings.
 *
 * A tab GROUP is one component: an optional hidden group-identity span on the
 * line immediately before the first header, followed by consecutive `=== "…"`
 * headers at the same indent whose body lines are blank or indented ≥ +4.
 * Each TAB carries its own identity span as the first body line (admonition-
 * style), which makes every tab an addressable component container:
 *
 *   <span data-uuid="GROUP-UUID" style="display:none"></span>
 *   === "Tab one"
 *
 *       <span data-uuid="TAB1-UUID" style="display:none"></span>
 *       Tab one description…
 *
 *   === "Tab two"
 *   …
 *
 * Span disambiguation: a group span's next non-blank line is a `=== "` header
 * at the same indent; a tab's own span has the `=== "` header as its nearest
 * non-blank line ABOVE; admonition spans sit under `!!!`/`???` headers — so the
 * three never collide.
 *
 * Leaf module: must NOT import components.js (which imports this) — tab bodies
 * are opaque strings at this layer. Mirrors admonitions.js; matches the
 * sibling-header grouping of parseAdmonitions' skipTabBlocks walk.
 */

import { generateUUID } from './admonitions.js';

// Same title matcher as parseAdmonitions' skipTabBlocks tabRe — the two MUST
// agree on what constitutes a tab header or grouping drifts between modules.
export const TAB_HEADER_RE = /^(\s*)=== "(.+)"\s*$/;

const UUID_SPAN_LINE_RE = /^\s*<span[^>]*data-uuid="([^"]+)"[^>]*><\/span>\s*$/;

function lineIndent(line) {
  return (line.match(/^(\s*)/) || ['', ''])[1];
}

/** Re-indents every non-empty line of `block`; blank lines stay bare. */
function reindent(block, indent) {
  if (!indent) return block;
  return block.split('\n').map(l => (l.length ? indent + l : l)).join('\n');
}

/**
 * The tab's own identity span, read from the first non-blank line of its
 * (dedented) body. A span whose next non-blank line is a `=== "` header at the
 * same indent is a nested GROUP's identity, not this tab's — returns null so
 * migration still backfills the tab's own span.
 */
function getTabBodyUUID(body) {
  const lines = (body ?? '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '') continue;
    const m = lines[i].match(UUID_SPAN_LINE_RE);
    if (!m) return null;
    const spanIndent = lineIndent(lines[i]);
    let j = i + 1;
    while (j < lines.length && lines[j] === '') j++;
    const hm = j < lines.length ? lines[j].match(TAB_HEADER_RE) : null;
    if (hm && hm[1] === spanIndent) return null;
    return m[1];
  }
  return null;
}

/**
 * Locates every tab group in `markdown` with a linear, non-recursive scan
 * (mirrors parseAdmonitions: groups nested inside another group's body are
 * consumed as body lines and NOT returned — recurse into tab bodies to reach
 * them). Groups nested inside admonitions are returned with their deeper
 * indent, so callers wanting immediate children filter on `indent === ''`.
 *
 * @param {string} markdown
 * @returns {Array<{uuid: string|null, indent: string, tabs: Array<{uuid: string|null, title: string, body: string}>, startLine: number, endLine: number}>}
 *   `body` is dedented by indent+4 with leading/trailing blank lines trimmed.
 *   `startLine` includes the group span line when present; `endLine` is
 *   exclusive and excludes trailing blank lines.
 */
export function locateTabGroups(markdown) {
  const lines = (markdown ?? '').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const first = lines[i].match(TAB_HEADER_RE);
    if (!first) { i++; continue; }
    const indent = first[1];
    const bodyIndent = indent + '    ';

    // Group identity: a hidden span on the line immediately before the first
    // header, at the same indent (capture-style identity).
    let startLine = i;
    let uuid = null;
    if (i > 0) {
      const sm = lines[i - 1].match(UUID_SPAN_LINE_RE);
      if (sm && lineIndent(lines[i - 1]) === indent) { uuid = sm[1]; startLine = i - 1; }
    }

    const tabs = [];
    while (i < lines.length) {
      const hm = lines[i].match(TAB_HEADER_RE);
      if (!hm || hm[1] !== indent) break;
      const title = hm[2];
      i++;
      const bodyLines = [];
      while (i < lines.length) {
        const line = lines[i];
        if (line.startsWith(bodyIndent)) { bodyLines.push(line.slice(bodyIndent.length)); i++; }
        else if (line === '') { bodyLines.push(''); i++; }
        else break;
      }
      while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1] === '') bodyLines.pop();
      while (bodyLines.length > 0 && bodyLines[0] === '') bodyLines.shift();
      const body = bodyLines.join('\n');
      tabs.push({ uuid: getTabBodyUUID(body), title, body });
    }

    let endLine = i;
    while (endLine > startLine + 1 && lines[endLine - 1] === '') endLine--;

    out.push({ uuid, indent, tabs, startLine, endLine });
  }
  return out;
}

/**
 * Builds a complete tab-group block (no outer indent) from its parts. Inverse
 * of locateTabGroups for a single group. Tab bodies are provided dedented
 * (callers build them via components.js' buildComponentBody, which embeds the
 * tab's own uuid span as the first line).
 *
 * @param {string} uuid - the group's identity span value.
 * @param {Array<{title: string, body: string}>} tabs
 * @returns {string}
 */
export function buildTabGroup(uuid, tabs) {
  const lines = [`<span data-uuid="${uuid}" style="display:none"></span>`];
  tabs.forEach((t, i) => {
    if (i > 0) lines.push('');
    lines.push(`=== "${t.title}"`);
    lines.push('');
    const body = (t.body ?? '').replace(/^\n+/, '').replace(/\n+$/, '');
    if (body.length) lines.push(reindent(body, '    '));
  });
  return lines.join('\n');
}

// ── Locate / replace / delete by UUID ─────────────────────────────────────────

/**
 * Locates the line range [startLine, endLine) of the tab GROUP whose identity
 * span carries `uuid`, at any nesting depth in the raw document. Returns null
 * when the uuid isn't a group span (e.g. it's a tab's own span).
 *
 * @param {string[]} lines
 * @param {string} uuid
 * @returns {{startLine: number, endLine: number, indent: string} | null}
 */
export function locateTabGroupByUUID(lines, uuid) {
  const spanIdx = lines.findIndex(l => l.includes(`data-uuid="${uuid}"`));
  if (spanIdx === -1) return null;
  const indent = lineIndent(lines[spanIdx]);

  // Group span ⇔ next non-blank line is a tab header at the same indent.
  let h = spanIdx + 1;
  while (h < lines.length && lines[h] === '') h++;
  const hm = h < lines.length ? lines[h].match(TAB_HEADER_RE) : null;
  if (!hm || hm[1] !== indent) return null;

  const bodyIndent = indent + '    ';
  let endLine = h;
  while (endLine < lines.length) {
    const line = lines[endLine];
    const tm = line.match(TAB_HEADER_RE);
    const isSiblingHeader = !!tm && tm[1] === indent;
    if (line === '' || line.startsWith(bodyIndent) || isSiblingHeader) endLine++;
    else break;
  }
  while (endLine > spanIdx + 1 && lines[endLine - 1] === '') endLine--;

  return { startLine: spanIdx, endLine, indent };
}

/**
 * Parses the group identified by `uuid` out of the raw document (any nesting
 * depth) into `{ uuid, tabs, indent }` with dedented tab bodies, or null.
 */
export function getTabGroupByUUID(markdown, uuid) {
  const lines = (markdown ?? '').split('\n');
  const loc = locateTabGroupByUUID(lines, uuid);
  if (!loc) return null;
  const block = lines.slice(loc.startLine, loc.endLine)
    .map(l => (loc.indent && l.startsWith(loc.indent)) ? l.slice(loc.indent.length) : l)
    .join('\n');
  const [g] = locateTabGroups(block);
  return g ? { uuid: g.uuid ?? uuid, tabs: g.tabs, indent: loc.indent } : null;
}

/**
 * Replaces the tab group identified by `uuid` with `newBlock` (provided
 * WITHOUT outer indent; re-indented here to match the original group).
 */
export function replaceTabGroupByUUID(markdown, uuid, newBlock) {
  const lines = markdown.split('\n');
  const loc = locateTabGroupByUUID(lines, uuid);
  if (!loc) return markdown;
  return [
    ...lines.slice(0, loc.startLine),
    ...reindent(newBlock, loc.indent).split('\n'),
    ...lines.slice(loc.endLine),
  ].join('\n');
}

/**
 * Deletes the tab group identified by `uuid`, plus one trailing blank line if
 * present (mirrors deleteAdmonitionByUUID).
 */
export function deleteTabGroupByUUID(markdown, uuid) {
  const lines = markdown.split('\n');
  const loc = locateTabGroupByUUID(lines, uuid);
  if (!loc) return markdown;
  let trailingEnd = loc.endLine;
  if (trailingEnd < lines.length && lines[trailingEnd] === '') trailingEnd++;
  return [...lines.slice(0, loc.startLine), ...lines.slice(trailingEnd)].join('\n');
}

/**
 * Locates the single TAB whose own identity span carries `uuid`, at any
 * nesting depth in the raw document. The span must be the first non-blank
 * body line under its `=== "` header (walk UP skipping blanks to the header,
 * DOWN by header indent + 4 for the extent).
 *
 * @param {string[]} lines
 * @param {string} uuid
 * @returns {{headerLine: number, endLine: number, headerIndent: string, title: string} | null}
 *   endLine is exclusive and excludes trailing blank lines.
 */
export function locateTabByUUID(lines, uuid) {
  const spanIdx = lines.findIndex(l => l.includes(`data-uuid="${uuid}"`));
  if (spanIdx === -1) return null;

  let h = spanIdx - 1;
  while (h >= 0 && lines[h] === '') h--;
  const hm = h >= 0 ? lines[h].match(TAB_HEADER_RE) : null;
  if (!hm) return null;
  const headerIndent = hm[1];
  const bodyIndent = headerIndent + '    ';
  if (!lines[spanIdx].startsWith(bodyIndent)) return null;

  let endLine = h + 1;
  while (endLine < lines.length) {
    const line = lines[endLine];
    if (line === '' || line.startsWith(bodyIndent)) endLine++;
    else break;
  }
  while (endLine > h + 1 && lines[endLine - 1] === '') endLine--;

  return { headerLine: h, endLine, headerIndent, title: hm[2] };
}

// ── UUID injection ────────────────────────────────────────────────────────────

/**
 * Prepends a tab's identity span as the very first body line, followed by a
 * blank line. The blank mirrors buildComponentBody's shape and keeps
 * locateCaptureLines's "span on the line immediately before the image" rule
 * from stealing the tab's identity when the tab's first content is a capture.
 */
function injectTabUUID(body, uuid) {
  const span = `<span data-uuid="${uuid}" style="display:none"></span>`;
  return body.length ? `${span}\n\n${body}` : span;
}

/**
 * Ensures every tab group has a group identity span and every tab its own
 * body span — at every nesting depth (recurses into tab bodies for groups
 * nested inside tabs; groups nested inside admonitions are reached by the
 * linear scan at their deeper indent). Idempotent: a fully-migrated document
 * is returned unchanged, byte-for-byte. Reverse-order splice keeps earlier
 * line indices valid. Mirrors ensureAdmonitionUUIDs / ensureCaptureUUIDs.
 *
 * NOTE: in github.js' migrateComponentIdentity this must run BEFORE
 * ensureCaptureUUIDs — a capture span injected as a tab's first body line
 * would otherwise be misread as the tab's own identity.
 *
 * @param {string} markdown
 * @returns {string}
 */
export function ensureTabUUIDs(markdown) {
  const groups = locateTabGroups(markdown);
  if (groups.length === 0) return markdown;

  let result = markdown.split('\n');
  let modified = false;
  for (let k = groups.length - 1; k >= 0; k--) {
    const g = groups[k];
    let changed = g.uuid === null;
    const tabs = g.tabs.map(t => {
      let body = ensureTabUUIDs(t.body);
      let uuid = t.uuid;
      if (!uuid) { uuid = generateUUID(); body = injectTabUUID(body, uuid); }
      if (uuid !== t.uuid || body !== t.body) changed = true;
      return { uuid, title: t.title, body };
    });
    if (!changed) continue;

    const newBlock = buildTabGroup(g.uuid ?? generateUUID(), tabs);
    result = [
      ...result.slice(0, g.startLine),
      ...reindent(newBlock, g.indent).split('\n'),
      ...result.slice(g.endLine),
    ];
    modified = true;
  }
  return modified ? result.join('\n') : markdown;
}
