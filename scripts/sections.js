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

/**
 * Matches a thematic-break line: `---` (with optional surrounding whitespace).
 * Used when stripping auto-managed separators between h2 sections.
 */
const HR_RE = /^\s*---\s*$/;

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
  const result = [];
  let i = 0;
  let modified = false;

  while (i < lines.length) {
    const line = lines[i];
    const headingMatch = line.match(HEADING_RE);
    if (!headingMatch) {
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
  const sections = [];

  // Collect heading positions first.
  for (let i = 0; i < lines.length; i++) {
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
 * end of owned content, excluding any auto-managed `---` separators that
 * appear immediately before the boundary).
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

  // Strip trailing thematic-break separators (auto-managed between h2 sections).
  while (body.length > 0 && (body[body.length - 1] === '' || HR_RE.test(body[body.length - 1]))) {
    body.pop();
  }

  return { section, descriptionMarkdown: body.join('\n') };
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

  // Eat one trailing blank line if present, then any number of `---` separators
  // (auto-managed between h2s) and the blank line after them.
  let trailingEnd = removeEnd;
  while (trailingEnd < lines.length && lines[trailingEnd] === '') trailingEnd++;
  while (trailingEnd < lines.length && HR_RE.test(lines[trailingEnd])) {
    trailingEnd++;
    while (trailingEnd < lines.length && lines[trailingEnd] === '') trailingEnd++;
  }
  // Then peel one blank back to restore a single newline gap.
  if (trailingEnd > removeEnd && trailingEnd <= lines.length) {
    // Keep a single blank line of separation between the surrounding regions
    // by inserting one '' line below.
  }

  const before = lines.slice(0, section.headerLine);
  const after = lines.slice(trailingEnd);

  // Squash any trailing blank lines in `before` and any leading blank lines in
  // `after`, then rejoin with a single blank line separator (unless one side
  // is empty).
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
  const shifted = subtreeLines.map(line => {
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
