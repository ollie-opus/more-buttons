// scripts/frontmatter.js
// Read/write page-level "head matter" of a guide's markdown — the leading YAML
// frontmatter block plus one body-level display marker that lives right after it:
//
//   ---
//   icon: lucide/user-plus
//   tags:
//     - System
//   hide:
//     - navigation
//     - toc
//   ---
//
//   <style data-mb-hide-title>…</style>   ← "hide page title" marker (preamble)
//
//   # Title
//
// Pure string functions — no network, no DOM. Only the things these helpers own
// (`icon:`, the `tags:` block, the `hide:` block, the `search:` mapping, and the
// hide-title marker) are touched; every other line passes through untouched.
// (A degenerate empty block `---\n---` is treated as no frontmatter.)

const FM_RE = /^---\n([\s\S]*?)\n---\n?/;
const ICON_LINE_RE = /^icon:[ \t]*(\S.*?)[ \t]*$/m;

/** @returns {string} the icon value, or '' when absent. */
export function readFrontmatterIcon(md) {
  const m = FM_RE.exec(md);
  if (!m) return '';
  const icon = ICON_LINE_RE.exec(m[1]);
  return icon ? icon[1] : '';
}

/**
 * Set, replace, or (icon = '') remove the icon line. Creates the block when
 * needed; drops it when removal leaves it empty.
 * @returns {string} updated markdown
 */
export function writeFrontmatterIcon(md, icon) {
  const value = (icon ?? '').trim();
  const m = FM_RE.exec(md);

  if (!m) {
    if (!value) return md;
    return `---\nicon: ${value}\n---\n\n${md}`;
  }

  const lines = m[1].split('\n');
  const idx = lines.findIndex(l => /^icon:/.test(l));

  if (value) {
    if (idx === -1) lines.unshift(`icon: ${value}`);
    else lines[idx] = `icon: ${value}`;
  } else {
    if (idx === -1) return md;
    lines.splice(idx, 1);
    if (lines.every(l => l.trim() === '')) {
      // Block emptied — remove it and the blank separator line it owned.
      let rest = md.slice(m[0].length);
      if (rest.startsWith('\n')) rest = rest.slice(1);
      return rest;
    }
  }

  return `---\n${lines.join('\n')}\n---\n` + md.slice(m[0].length);
}

const unquote = s => s.replace(/^(['"])([\s\S]*)\1$/, '$2');

/**
 * Parse a list-valued `<key>:` out of an already-extracted frontmatter block.
 * Understands the block style we write —
 *   hide:
 *     - navigation
 *     - toc
 * — and tolerates a hand-written inline flow list (`hide: [navigation, toc]`).
 * `key` is a trusted internal literal ('hide' | 'tags'), never user input.
 * @returns {string[]} the values in document order ([] when absent).
 */
function parseListKey(lines, key) {
  const headRe = new RegExp('^' + key + ':[ \\t]*(.*)$');
  for (let i = 0; i < lines.length; i++) {
    const head = headRe.exec(lines[i]);
    if (!head) continue;
    const inline = head[1].trim();
    if (inline.startsWith('[')) {
      return inline.replace(/^\[/, '').replace(/\]$/, '')
        .split(',').map(s => unquote(s.trim())).filter(Boolean);
    }
    const out = [];
    for (let j = i + 1; j < lines.length; j++) {
      const item = /^[ \t]+-[ \t]*(.*\S)[ \t]*$/.exec(lines[j]);
      if (!item) break;                 // first non-list line closes the block
      out.push(unquote(item[1]));
    }
    return out;
  }
  return [];
}

/** Drop the `<key>:` line + its block-style items (or its inline flow list). */
function stripListKey(lines, key) {
  const headRe = new RegExp('^' + key + ':[ \\t]*(.*)$');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const head = headRe.exec(lines[i]);
    if (!head) { out.push(lines[i]); continue; }
    if (head[1].trim().startsWith('[')) continue;          // inline flow → one line
    while (i + 1 < lines.length && /^[ \t]+-/.test(lines[i + 1])) i++;
  }
  return out;
}

/**
 * Set, replace, or (empty list) remove a list-valued `<key>:` block. Creates
 * the frontmatter block when needed; drops it when removal leaves it empty.
 * Always emitted block-style with two-space indentation; a rewrite moves the
 * key to the end of the block (strip-then-append). This writes exactly the
 * list it is given — filtering/deduping is the caller's concern.
 * @returns {string} updated markdown
 */
function writeListKey(md, key, values) {
  const block = values.length ? [`${key}:`, ...values.map(v => `  - ${v}`)] : [];
  const m = FM_RE.exec(md);

  if (!m) {
    if (!values.length) return md;
    return `---\n${block.join('\n')}\n---\n\n${md}`;
  }

  const lines = stripListKey(m[1].split('\n'), key).concat(block);

  if (lines.every(l => l.trim() === '')) {
    // Block emptied — remove it and the blank separator line it owned.
    let rest = md.slice(m[0].length);
    if (rest.startsWith('\n')) rest = rest.slice(1);
    return rest;
  }
  return `---\n${lines.join('\n')}\n---\n` + md.slice(m[0].length);
}

/** @returns {string[]} the `hide:` list values, or [] when absent. */
export function readFrontmatterHide(md) {
  const m = FM_RE.exec(md);
  if (!m) return [];
  return parseListKey(m[1].split('\n'), 'hide');
}

/**
 * Set, replace, or (empty list) remove the `hide:` block. Other keys (and any
 * hide values not in `list`) are the caller's concern — this writes exactly the
 * list it is given.
 * @param {string[]} list
 * @returns {string} updated markdown
 */
export function writeFrontmatterHide(md, list) {
  const values = (Array.isArray(list) ? list : [])
    .map(v => String(v).trim()).filter(Boolean);
  return writeListKey(md, 'hide', values);
}

/** @returns {string[]} the `tags:` list values, or [] when absent. */
export function readFrontmatterTags(md) {
  const m = FM_RE.exec(md);
  if (!m) return [];
  return parseListKey(m[1].split('\n'), 'tags');
}

/**
 * Set, replace, or (empty list) remove the `tags:` block. Trims, drops
 * empties, and dedupes case-insensitively (first spelling wins).
 * @param {string[]} list
 * @returns {string} updated markdown
 */
export function writeFrontmatterTags(md, list) {
  return writeListKey(md, 'tags', dedupeTags(list));
}

/**
 * The Page-settings frontmatter composition shared by the page-settings save
 * (mergeSave build) and Create guide: icon → tags → hide, in that order (the
 * order tests/frontmatter.test.mjs locks). `hide` is rebuilt from the four
 * managed booleans (navigation / toc / path are zensical's own; `written-for`
 * is ours — the KB build reads it and suppresses the "Written for" audience
 * pill line it renders under the H1 from the audience tag, see
 * audienceTags.js) while preserving, in place, any hide
 * value we have no checkbox for — an unrelated save must never silently drop
 * a flag.
 * @param {string} md
 * @param {{icon?: string, tags?: string[], hide?: {navigation?: boolean, toc?: boolean, path?: boolean, writtenFor?: boolean}}} settings
 * @returns {string} updated markdown
 */
export function applyPageSettingsFrontmatter(md, { icon = '', tags = [], hide = {} } = {}) {
  let out = writeFrontmatterIcon(md, String(icon ?? '').trim());
  out = writeFrontmatterTags(out, tags);
  const managed = ['navigation', 'toc', 'path', 'written-for'];
  const want = { navigation: !!hide.navigation, toc: !!hide.toc, path: !!hide.path, 'written-for': !!hide.writtenFor };
  const next = [];
  for (const v of readFrontmatterHide(out)) {
    if (!managed.includes(v)) next.push(v);              // unmanaged → keep
    else if (want[v] && !next.includes(v)) next.push(v); // still wanted → keep position
  }
  for (const k of managed) if (want[k] && !next.includes(k)) next.push(k);
  return writeFrontmatterHide(out, next);
}

// ── Search exclusion ───────────────────────────────────────────────────────────
// Zensical indexes every built page — including drafts under docs/drafts/ —
// unless the page opts out with a `search:` mapping:
//
//   search:
//     exclude: true
//
// Drafts are born with this so they never surface in the site search bar;
// publishing strips it (see publishGuideDraft). Unlike `hide:`/`tags:`, the
// value is a nested mapping, not a list, so it has its own strip/emit logic.
// These helpers own the WHOLE `search:` mapping — a hand-written sibling key
// (e.g. `boost:`) does not survive a rewrite.

const SEARCH_HEAD_RE = /^search:[ \t]*(.*)$/;

/** @returns {boolean} whether the page is excluded from the search index. */
export function readFrontmatterSearchExclude(md) {
  const m = FM_RE.exec(md);
  if (!m) return false;
  const lines = m[1].split('\n');
  for (let i = 0; i < lines.length; i++) {
    const head = SEARCH_HEAD_RE.exec(lines[i]);
    if (!head) continue;
    const inline = head[1].trim();
    if (inline) return /exclude:[ \t]*true/.test(inline); // hand-written `search: { exclude: true }`
    for (let j = i + 1; j < lines.length; j++) {
      if (!/^[ \t]+\S/.test(lines[j])) break;             // first unindented line closes the mapping
      if (/^[ \t]+exclude:[ \t]*true[ \t]*$/.test(lines[j])) return true;
    }
    return false;
  }
  return false;
}

/** Drop the `search:` line + its indented mapping children (or its inline form). */
function stripSearchKey(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!SEARCH_HEAD_RE.test(lines[i])) { out.push(lines[i]); continue; }
    while (i + 1 < lines.length && /^[ \t]+\S/.test(lines[i + 1])) i++;
  }
  return out;
}

/**
 * Set or (excluded = false) remove the search-exclusion mapping. Creates the
 * frontmatter block when needed; drops it when removal leaves it empty. As
 * with the list keys, a rewrite moves `search:` to the end of the block.
 * @returns {string} updated markdown
 */
export function writeFrontmatterSearchExclude(md, excluded) {
  const block = excluded ? ['search:', '  exclude: true'] : [];
  const m = FM_RE.exec(md);

  if (!m) {
    if (!excluded) return md;
    return `---\n${block.join('\n')}\n---\n\n${md}`;
  }

  const lines = stripSearchKey(m[1].split('\n')).concat(block);

  if (lines.every(l => l.trim() === '')) {
    // Block emptied — remove it and the blank separator line it owned.
    let rest = md.slice(m[0].length);
    if (rest.startsWith('\n')) rest = rest.slice(1);
    return rest;
  }
  return `---\n${lines.join('\n')}\n---\n` + md.slice(m[0].length);
}

/**
 * Canonical comma-separated-input → tag-list rule: trim, drop empties, dedupe
 * case-insensitively keeping the first spelling.
 * 'System, contractors,, System ' → ['System', 'contractors']
 * @returns {string[]}
 */
export function splitTagList(csv) {
  return dedupeTags(String(csv ?? '').split(','));
}

function dedupeTags(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const v = String(raw).trim();
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
  }
  return out;
}

// ── Hide page title ────────────────────────────────────────────────────────────
// "Hide page title" is NOT a zensical frontmatter flag — it injects a tiny
// page-scoped <style> block (tagged with a data attribute) into the preamble,
// after any frontmatter and before the first H1. Keeping it off the H1 line
// means: a title rename never disturbs it (the preamble is in the slice that
// replaceSectionByUUID preserves verbatim), it never leaks into the parsed
// heading text, and it never touches the zensical.toml nav name. The <style>
// only ships in this page's HTML, so it scopes to this page.
//
// The rule anchors on the marker element itself and hides the H1 *immediately
// after* it (`marker + h1`). Since the marker is injected directly before the
// first H1, this targets exactly the page title — and, unlike a page-wide
// `h1:first-of-type`, it can never match any later H1 regardless of how the
// theme nests headings.

const HIDE_TITLE_BLOCK = '<style data-mb-hide-title>style[data-mb-hide-title]+h1{display:none}</style>';
const HIDE_TITLE_RE = /^[ \t]*<style data-mb-hide-title>.*?<\/style>[ \t]*\n?\n?/m;

/** @returns {boolean} whether the hide-page-title marker is present. */
export function readHideTitle(md) {
  return /<style data-mb-hide-title>/.test(md);
}

/**
 * Add or remove the hide-page-title marker. Idempotent. The marker is inserted
 * immediately after a leading frontmatter block (or at the very top when there
 * is none), so it sits in the preamble that no section owns. Any pre-existing
 * marker is stripped first, so a re-save also re-normalizes a stale marker
 * (e.g. one written with an older CSS rule).
 * @returns {string} updated markdown
 */
export function writeHideTitle(md, hidden) {
  const stripped = md.replace(HIDE_TITLE_RE, '');
  if (!hidden) return stripped;

  const m = FM_RE.exec(stripped);
  if (m) {
    const head = stripped.slice(0, m[0].length).replace(/\n*$/, '\n'); // single trailing \n
    const body = stripped.slice(m[0].length).replace(/^\n+/, '');       // drop leading blanks
    return `${head}\n${HIDE_TITLE_BLOCK}\n\n${body}`;
  }
  return `${HIDE_TITLE_BLOCK}\n\n${stripped.replace(/^\n+/, '')}`;
}
