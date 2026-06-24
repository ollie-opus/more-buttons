/**
 * sections.js — Pure helpers for parsing, building, and mutating heading-based
 * sections (h1 / h2 / h3) in a markdown document.
 *
 * Mirrors the API style of admonitions.js. Sections are identified by a
 * hidden UUID span injected as the first non-empty line after each heading:
 *
 *   ## My Section
 *   <span data-uuid="..." style="display:none"></span>
 *
 *   body...
 *
 * All functions are pure (no side-effects) except generateUUID().
 */

import { generateUUID } from './admonitions.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const HEADING_RE = /^(#{1,3})\s+(.+?)\s*$/;

// ── Hide section title ──────────────────────────────────────────────────────────
// "Hide title" is a per-section flag (every heading — h1 page title, h2, h3 — can
// be hidden independently). Unlike the page-level hide (a preamble <style> that
// uses `marker + h1`), a section marker must live INSIDE the section's owned
// content so it survives section moves and rename. The UUID span is required to
// stay the first non-empty line under the heading (getSectionUUID only inspects
// that line), so the marker is injected just after it.
//
// The renderer wraps the inline UUID span in its own <p> and keeps a <style>
// block as an unwrapped sibling, giving a deterministic shape:
//   <h2>…</h2>  <p><span data-uuid></span></p>  <style data-mb-hide-section-title>
// so the rule hides the heading via the previous-sibling `:has(+ p + style…)`
// combinator, self-scoped to its own marker (each hidden section carries an
// identical, harmless copy).
const HIDE_SECTION_TITLE_BLOCK =
  '<style data-mb-hide-section-title>:is(h1,h2,h3):has(+ p + style[data-mb-hide-section-title]){display:none}</style>';
const HIDE_SECTION_TITLE_RE = /^[ \t]*<style data-mb-hide-section-title>.*?<\/style>[ \t]*\n?\n?/m;

export { HIDE_SECTION_TITLE_BLOCK };

/** @returns {boolean} whether a section body carries the hide-title marker. */
export function readHideSectionTitle(body) {
  return /<style data-mb-hide-section-title>/.test(body);
}

/**
 * Add or remove the hide-title marker at the top of a section body. Idempotent:
 * any existing marker is stripped first, so a re-write never duplicates it and a
 * stale marker (older CSS rule) is re-normalized.
 * @param {string} body - the section's owned content (description + components),
 *                        i.e. everything after the heading + UUID span.
 * @param {boolean} hidden
 * @returns {string}
 */
export function writeHideSectionTitle(body, hidden) {
  const stripped = body.replace(HIDE_SECTION_TITLE_RE, '');
  if (!hidden) return stripped;
  const rest = stripped.replace(/^\n+/, '');
  return rest ? `${HIDE_SECTION_TITLE_BLOCK}\n\n${rest}` : HIDE_SECTION_TITLE_BLOCK;
}

// A `<div …>` opener / closer on its own line. Grid components and their cells
// are `<div class="grid" markdown>` / `<div … markdown>` blocks; md_in_html keeps
// their content at column 0, so a markdown heading typed inside a grid cell looks
// (to a naive `^#` scan) like a top-level section heading. These let us track
// `<div>` DEPTH and ignore any heading that lives inside such a container.
const DIV_OPEN_RE = /^\s*<div(?:\s|>)/;
const DIV_CLOSE_RE = /^\s*<\/div>\s*$/;

/**
 * Flags every line that sits INSIDE a `<div … markdown>` container block (a grid
 * or one of its cells), by `<div>`-depth. The open/close lines themselves are the
 * container boundary, not body, so they are NOT flagged. Callers use this to skip
 * headings that belong to grid-cell content rather than to the section tree.
 *
 * (Tab/admonition bodies need no such handling — their content is indented 4
 * spaces, so the column-anchored HEADING_RE never matches a heading inside them.)
 */
function markContainerLines(lines) {
  const inside = new Array(lines.length).fill(false);
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (DIV_CLOSE_RE.test(line)) { depth = Math.max(0, depth - 1); continue; }
    if (depth > 0) inside[i] = true;
    if (DIV_OPEN_RE.test(line)) depth++;
  }
  return inside;
}

// ── UUID helpers ──────────────────────────────────────────────────────────────

/**
 * Reads the UUID from the first non-empty, non-heading line of `bodyAfterHeading`.
 * Returns null if no UUID span is present.
 */
export function getSectionUUID(bodyAfterHeading) {
  const lines = bodyAfterHeading.split('\n');
  for (const line of lines) {
    if (line === '') continue;
    if (HEADING_RE.test(line)) return null; // we've hit the next heading without finding a UUID
    const m = line.match(/data-uuid="([^"]+)"/);
    return m ? m[1] : null;
  }
  return null;
}

/** Builds a UUID-span line. */
export function buildSectionUUIDSpan(uuid) {
  return `<span data-uuid="${uuid}" style="display:none"></span>`;
}

/**
 * Ensures every heading (h1/h2/h3) in `markdown` has a UUID span as its
 * first non-empty line. Headings that already have a UUID are left untouched.
 *
 * The injection inserts the span on a new line directly under the heading,
 * with a blank separator line after it (matching the existing repo style).
 *
 * @param {string} markdown
 * @returns {string}
 */
export function ensureSectionUUIDs(markdown) {
  const lines = markdown.split('\n');
  const inside = markContainerLines(lines);
  const result = [];
  let i = 0;
  let modified = false;

  while (i < lines.length) {
    const line = lines[i];
    const headingMatch = line.match(HEADING_RE);
    if (!headingMatch || inside[i]) { // never treat a grid-cell heading as a section
      result.push(line);
      i++;
      continue;
    }

    // Push the heading line.
    result.push(line);
    i++;

    // Look ahead for an existing UUID span at the first non-empty line.
    let j = i;
    while (j < lines.length && lines[j] === '') j++;
    if (j < lines.length && /data-uuid="[^"]+"/.test(lines[j])) {
      continue; // already has UUID; leave the structure alone
    }

    // Inject a fresh UUID span on the line directly under the heading.
    result.push(buildSectionUUIDSpan(generateUUID()));
    modified = true;
    // Ensure there's a blank line between span and following content.
    if (i < lines.length && lines[i] !== '') {
      result.push('');
    }
  }

  return modified ? result.join('\n') : markdown;
}

// ── Parse ─────────────────────────────────────────────────────────────────────

/**
 * Parses all sections (h1, h2, h3) in `markdown`.
 *
 * @param {string} markdown
 * @returns {Array<{
 *   uuid: string|null,
 *   level: 1|2|3,
 *   title: string,
 *   headerLine: number,
 *   ownedEndLine: number,   // first line not part of this section's own description
 *                            // (== start of first child section, OR start of next
 *                            //  sibling/ancestor heading)
 *   fullEndLine: number,    // first line not part of this section's full subtree
 *                            // (== start of next sibling/ancestor heading)
 * }>}
 */
export function parseSections(markdown) {
  const lines = markdown.split('\n');
  const inside = markContainerLines(lines);
  const sections = [];

  // Collect heading positions first.
  for (let i = 0; i < lines.length; i++) {
    if (inside[i]) continue; // a heading inside a grid cell is content, not a section
    const m = lines[i].match(HEADING_RE);
    if (!m) continue;
    const level = m[1].length;
    if (level < 1 || level > 3) continue;

    sections.push({
      uuid: null,
      level,
      title: m[2].trim(),
      headerLine: i,
      ownedEndLine: lines.length,
      fullEndLine: lines.length,
    });
  }

  // Compute ownedEndLine / fullEndLine for each section.
  for (let k = 0; k < sections.length; k++) {
    const s = sections[k];

    // ownedEndLine: first subsequent heading at any level (children or
    // sibling/ancestor). Since this section's *own* description ends as soon
    // as ANY new heading appears.
    for (let j = k + 1; j < sections.length; j++) {
      s.ownedEndLine = sections[j].headerLine;
      break;
    }

    // fullEndLine: first subsequent heading at level <= self.level (sibling
    // or ancestor — skipping children which have a deeper level).
    for (let j = k + 1; j < sections.length; j++) {
      if (sections[j].level <= s.level) {
        s.fullEndLine = sections[j].headerLine;
        break;
      }
    }
  }

  // Extract UUIDs from the owned-content region of each section.
  for (const s of sections) {
    const bodyLines = lines.slice(s.headerLine + 1, s.ownedEndLine).join('\n');
    s.uuid = getSectionUUID(bodyLines);
  }

  return sections;
}

// ── Locate / replace / delete ────────────────────────────────────────────────

/**
 * Finds the section with the given UUID. Returns the parsed entry or null.
 * @param {string} markdown
 * @param {string} uuid
 * @returns {Object|null}
 */
export function locateSectionByUUID(markdown, uuid) {
  return parseSections(markdown).find(s => s.uuid === uuid) ?? null;
}

/**
 * Reads a section's body lines (the lines between header+UUID-span and the
 * end of owned content). A trailing `---` is kept — it is a user-inserted
 * separator (horizontal rule), real body content, not an auto-managed divider
 * (nothing auto-adds separators between sections).
 *
 * @param {string} markdown
 * @param {string} uuid
 * @returns {{ section: Object|null, descriptionMarkdown: string }}
 */
export function readSectionDescription(markdown, uuid) {
  const section = locateSectionByUUID(markdown, uuid);
  if (!section) return { section: null, descriptionMarkdown: '' };

  const lines = markdown.split('\n');
  const bodyStart = section.headerLine + 1;
  const bodyEnd = section.ownedEndLine;
  let body = lines.slice(bodyStart, bodyEnd);

  // Remove the UUID-span line (always the first non-empty line under the header).
  let removedSpan = false;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '') continue;
    if (/data-uuid="[^"]+"/.test(body[i])) {
      body.splice(i, 1);
      removedSpan = true;
    }
    break;
  }
  // Trim leading blank lines after span removal (canonical form: span on first
  // line, blank, then content).
  if (removedSpan) {
    while (body.length > 0 && body[0] === '') body.shift();
  }

  // Trim trailing blank lines (canonical form). A trailing `---` is real body
  // content — a user-inserted separator (horizontal rule) — and is kept: nothing
  // auto-adds separators between sections, so there is none to strip.
  while (body.length > 0 && body[body.length - 1] === '') {
    body.pop();
  }

  // The hide-title marker (if any) sits at the top of the owned body, right after
  // the span. It is managed by the hide-title flag, never edited as description,
  // so report it separately and keep it out of descriptionMarkdown.
  const ownedBody = body.join('\n');
  const hideTitle = readHideSectionTitle(ownedBody);
  return { section, descriptionMarkdown: writeHideSectionTitle(ownedBody, false), hideTitle };
}

/**
 * Builds the canonical text of a section's header + UUID span + body
 * (description, admonitions, etc. — whatever the caller assembled).
 *
 * @param {1|2|3} level
 * @param {string} title
 * @param {string} uuid
 * @param {string} body - everything that comes after the UUID span and the
 *                        blank line under it. No leading/trailing whitespace
 *                        manipulation is performed.
 * @returns {string}
 */
export function buildSection(level, title, uuid, body) {
  const header = `${'#'.repeat(level)} ${title}`;
  const span = buildSectionUUIDSpan(uuid);
  const bodyPart = body ? `\n\n${body}` : '';
  // Canonical format: heading, UUID span on the very next line, blank, body.
  return `${header}\n${span}${bodyPart}`;
}

/**
 * Replaces a section's owned content (header + UUID span + description, NOT
 * including child sections) with `newSectionMarkdown`.
 *
 * Child sections (anything from ownedEndLine onward up to fullEndLine) are
 * preserved exactly as-is.
 *
 * @param {string} markdown
 * @param {string} uuid
 * @param {string} newSectionMarkdown - full replacement starting with the
 *                                       heading line (typically built by
 *                                       buildSection).
 * @returns {string}
 */
export function replaceSectionByUUID(markdown, uuid, newSectionMarkdown) {
  const lines = markdown.split('\n');
  const section = locateSectionByUUID(markdown, uuid);
  if (!section) return markdown;

  const before = lines.slice(0, section.headerLine);
  const after = lines.slice(section.ownedEndLine);
  const newLines = newSectionMarkdown.split('\n');
  // Trim trailing blanks from new content; we'll add a single blank separator.
  while (newLines.length > 0 && newLines[newLines.length - 1] === '') newLines.pop();
  while (after.length > 0 && after[0] === '') after.shift();
  while (before.length > 0 && before[before.length - 1] === '') before.pop();

  const parts = [];
  if (before.length) parts.push(...before, '');
  parts.push(...newLines);
  if (after.length) parts.push('', ...after);
  return parts.join('\n');
}

/**
 * Deletes a section. Cascade (default): removes the whole subtree
 * (headerLine .. fullEndLine). Non-cascade: removes only own content
 * (headerLine .. ownedEndLine), leaving children orphaned (rarely useful).
 *
 * @param {string} markdown
 * @param {string} uuid
 * @param {{cascade?: boolean}} [opts]
 * @returns {string}
 */
export function deleteSectionByUUID(markdown, uuid, { cascade = true } = {}) {
  const lines = markdown.split('\n');
  const section = locateSectionByUUID(markdown, uuid);
  if (!section) return markdown;

  const removeEnd = cascade ? section.fullEndLine : section.ownedEndLine;

  // Drop the removed range, then squash trailing blanks in `before` and leading
  // blanks in `after` and rejoin with a single blank-line gap. Whatever sits at
  // `removeEnd` (e.g. a following section's `---` separator) is left untouched.
  const before = lines.slice(0, section.headerLine);
  const after = lines.slice(removeEnd);
  while (before.length > 0 && before[before.length - 1] === '') before.pop();
  while (after.length > 0 && after[0] === '') after.shift();

  if (before.length === 0) return after.join('\n');
  if (after.length === 0) return before.join('\n') + '\n';
  return [...before, '', ...after].join('\n');
}

// ── Insert / move ────────────────────────────────────────────────────────────

/**
 * Inserts a new section as the last child of `parentUuid`. If parentUuid is
 * null, the new section is appended at the end of the document at the
 * caller-specified level (used for top-level insertions when Title section
 * doesn't yet exist — rare).
 *
 * The section is placed at the END of the parent's owned content (i.e. just
 * before the parent's first child, or at fullEndLine if it has no children).
 *
 * @param {string} markdown
 * @param {string|null} parentUuid
 * @param {1|2|3} level
 * @param {string} title
 * @param {string} [description='']
 * @returns {{ markdown: string, uuid: string }}
 */
export function insertSectionUnderParent(markdown, parentUuid, level, title, description = '') {
  const newUUID = generateUUID();
  const newSection = buildSection(level, title, newUUID, description);

  if (!parentUuid) {
    const md = markdown.replace(/\n+$/, '');
    const result = md.length ? `${md}\n\n${newSection}\n` : `${newSection}\n`;
    return { markdown: result, uuid: newUUID };
  }

  const parent = locateSectionByUUID(markdown, parentUuid);
  if (!parent) return { markdown, uuid: newUUID };

  const lines = markdown.split('\n');

  // Insert position: end of parent's full subtree (so the new section is added
  // AFTER all existing children — appearing at the bottom of the parent's
  // hierarchy). For new h2s under Title, this means at the end of the doc
  // (or before the next h1, if any). For new h3s under an h2, after the h2's
  // existing h3 children.
  const insertAt = parent.fullEndLine;

  // Build the spliced output with one blank line of separation before and after.
  const before = lines.slice(0, insertAt);
  const after = lines.slice(insertAt);

  while (before.length > 0 && before[before.length - 1] === '') before.pop();

  const insertLines = newSection.split('\n');
  const result = [
    ...before,
    '',
    ...insertLines,
    ...(after.length > 0 ? ['', ...after] : []),
  ];

  return { markdown: result.join('\n'), uuid: newUUID };
}

/**
 * Moves the section identified by `sectionUuid` to live under `newParentUuid`.
 * The level of the moved section (and any children it carries) is adjusted to
 * fit the new parent (parent.level + 1 for the moved section, recursively).
 *
 * Throws if moving would create a section deeper than h3.
 *
 * @param {string} markdown
 * @param {string} sectionUuid
 * @param {string|null} newParentUuid - null for "move to Title (h1)" → level becomes 2
 * @returns {string}
 */
export function moveSectionToParent(markdown, sectionUuid, newParentUuid) {
  const all = parseSections(markdown);
  const section = all.find(s => s.uuid === sectionUuid);
  if (!section) return markdown;

  let newLevel;
  if (!newParentUuid) {
    newLevel = 2; // Top-level under Title (the implicit h1).
  } else {
    const newParent = all.find(s => s.uuid === newParentUuid);
    if (!newParent) return markdown;
    newLevel = Math.min(3, newParent.level + 1);
  }

  // Collect the subtree we're moving (header .. fullEndLine).
  const lines = markdown.split('\n');
  const inside = markContainerLines(lines);
  const subtreeLines = lines.slice(section.headerLine, section.fullEndLine);

  // Compute level shift for each heading in the subtree.
  const levelShift = newLevel - section.level;

  // Reject moves that would push descendants beyond h3.
  for (const sub of all) {
    if (sub.headerLine < section.headerLine || sub.headerLine >= section.fullEndLine) continue;
    if (sub.level + levelShift > 3 || sub.level + levelShift < 1) {
      throw new Error('Cannot move section: would create a heading deeper than h3 or shallower than h1.');
    }
  }

  // Apply the level shift in-place.
  const shifted = subtreeLines.map((line, idx) => {
    if (inside[section.headerLine + idx]) return line; // leave grid-cell headings alone
    const m = line.match(HEADING_RE);
    if (!m) return line;
    const oldLevel = m[1].length;
    const newL = oldLevel + levelShift;
    return `${'#'.repeat(newL)} ${m[2]}`;
  });

  // Build the document with the subtree removed.
  let withoutSubtree = [
    ...lines.slice(0, section.headerLine),
    ...lines.slice(section.fullEndLine),
  ];
  // Strip trailing blank lines at the removed location to keep formatting tidy.
  // Squash multiple consecutive blanks to a single blank around the seam.
  const seam = section.headerLine;
  while (withoutSubtree[seam - 1] === '' && withoutSubtree[seam] === '') {
    withoutSubtree.splice(seam, 1);
  }
  const tempMd = withoutSubtree.join('\n');

  // Find the new parent in the updated markdown.
  const targetParent = newParentUuid ? locateSectionByUUID(tempMd, newParentUuid) : null;
  const tempLines = tempMd.split('\n');

  const insertAt = targetParent ? targetParent.fullEndLine : tempLines.length;
  const before = tempLines.slice(0, insertAt);
  const after = tempLines.slice(insertAt);
  while (before.length > 0 && before[before.length - 1] === '') before.pop();

  const result = [
    ...before,
    '',
    ...shifted,
    ...(after.length > 0 ? ['', ...after] : []),
  ];

  return result.join('\n');
}

/**
 * Reorders a section among its same-level siblings by swapping its whole subtree
 * (heading + UUID span + body + any child sections) with the adjacent sibling's
 * subtree. "Siblings" share both `level` and `parentUuid` (per buildSectionTree),
 * so an h2 only swaps with another h2, an h3 only with an h3 under the same h2.
 *
 * No-op (returns markdown unchanged) when: the uuid is unknown, the section is the
 * Title (h1, fixed), or it is already first/last among its siblings.
 *
 * Adjacent siblings' subtrees are contiguous in the file (`lower.fullEndLine ===
 * upper.headerLine`, since fullEndLine runs to the next heading at level ≤ self),
 * so the move is a block swap. Each block's trailing blank lines are dropped and
 * the two blocks rejoined with a single blank line — mirroring the seam handling
 * in moveSectionToParent / insertSectionUnderParent (guides separate sections with
 * blank lines). A trailing `---` is real body content and travels with its block.
 *
 * @param {string} markdown
 * @param {string} uuid
 * @param {'up'|'down'} dir
 * @returns {string}
 */
export function moveSectionAmongSiblings(markdown, uuid, dir) {
  const { sections } = buildSectionTree(markdown);
  const target = sections.find(s => s.uuid === uuid);
  if (!target || target.level === 1) return markdown; // unknown or fixed Title

  const siblings = sections.filter(
    s => s.level === target.level && s.parentUuid === target.parentUuid,
  );
  const idx = siblings.findIndex(s => s.uuid === uuid);
  const neighborIdx = idx + (dir === 'up' ? -1 : 1);
  if (neighborIdx < 0 || neighborIdx >= siblings.length) return markdown; // at an end

  const a = target;
  const b = siblings[neighborIdx];
  const lower = a.headerLine < b.headerLine ? a : b;
  const upper = a.headerLine < b.headerLine ? b : a;

  const lines = markdown.split('\n');
  const before = lines.slice(0, lower.headerLine);
  const lowerBlock = lines.slice(lower.headerLine, lower.fullEndLine);
  const upperBlock = lines.slice(upper.headerLine, upper.fullEndLine);
  const after = lines.slice(upper.fullEndLine);

  // Drop trailing blank lines from each block; we re-add a single blank-line seam
  // below so swapping never duplicates or orphans them. A trailing `---` is real
  // body content (a user-inserted separator) and stays with its block.
  const trimTail = (block) => {
    const c = block.slice();
    while (c.length && c[c.length - 1] === '') c.pop();
    return c;
  };
  const upperT = trimTail(upperBlock);
  const lowerT = trimTail(lowerBlock);

  while (before.length && before[before.length - 1] === '') before.pop();
  while (after.length && after[0] === '') after.shift();

  const parts = [];
  if (before.length) parts.push(...before, '');
  parts.push(...upperT, '', ...lowerT);
  if (after.length) parts.push('', ...after);
  let out = parts.join('\n');
  if (markdown.endsWith('\n') && !out.endsWith('\n')) out += '\n';
  return out;
}

// ── Tree with visual labels ───────────────────────────────────────────────────

/**
 * Builds a tree of sections with computed visual labels.
 *
 *   Title section: { label: 'Title', visualLabel: 'Title: <title>' }
 *   h2 section:    { label: 'Section N', visualLabel: 'Section N: <title>' }
 *   h3 section:    { label: 'Section N.M', visualLabel: 'Section N.M: <title>' }
 *
 * N is the 1-indexed position among h2s; M is the 1-indexed position among
 * h3s within that h2.
 *
 * @param {string} markdown
 * @returns {{
 *   title: {uuid, title, label, visualLabel, children: Array}|null,
 *   sections: Array  // flat list with hierarchical info, ordered by file position
 * }}
 */
export function buildSectionTree(markdown) {
  const sections = parseSections(markdown);

  const title = sections.find(s => s.level === 1) ?? null;
  let h2Idx = 0;
  let h3Idx = 0;
  let currentH2 = null;

  const annotated = sections.map(s => {
    if (s.level === 1) {
      return { ...s, label: 'Title', visualLabel: `Title: ${s.title}`, parentUuid: null };
    }
    if (s.level === 2) {
      h2Idx++;
      h3Idx = 0;
      currentH2 = s;
      return {
        ...s,
        label: `Section ${h2Idx}`,
        visualLabel: `Section ${h2Idx}: ${s.title}`,
        parentUuid: title?.uuid ?? null,
      };
    }
    // level === 3
    h3Idx++;
    return {
      ...s,
      label: `Section ${h2Idx}.${h3Idx}`,
      visualLabel: `Section ${h2Idx}.${h3Idx}: ${s.title}`,
      parentUuid: currentH2?.uuid ?? null,
    };
  });

  // Build a tree view too (Title at top, h2s below, h3s nested under each h2).
  const h2s = annotated.filter(s => s.level === 2);
  const h3s = annotated.filter(s => s.level === 3);

  for (const h2 of h2s) {
    h2.children = h3s.filter(h3 => h3.parentUuid === h2.uuid);
  }

  const titleNode = annotated.find(s => s.level === 1) ?? null;
  if (titleNode) titleNode.children = h2s;

  return { title: titleNode, sections: annotated };
}

/**
 * Returns true if section `uuid` has any h3 children.
 */
export function hasH3Children(markdown, uuid) {
  const sections = parseSections(markdown);
  const target = sections.find(s => s.uuid === uuid);
  if (!target || target.level !== 2) return false;
  return sections.some(s => s.level === 3 && s.headerLine > target.headerLine && s.headerLine < target.fullEndLine);
}
