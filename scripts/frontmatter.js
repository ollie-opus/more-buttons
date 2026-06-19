// scripts/frontmatter.js
// Read/write page-level "head matter" of a guide's markdown — the leading YAML
// frontmatter block plus one body-level display marker that lives right after it:
//
//   ---
//   icon: lucide/user-plus
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
// (`icon:`, the `hide:` block, and the hide-title marker) are touched; every
// other line passes through untouched.
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
 * Parse the `hide:` value out of an already-extracted frontmatter block.
 * Understands the block style we write —
 *   hide:
 *     - navigation
 *     - toc
 * — and tolerates a hand-written inline flow list (`hide: [navigation, toc]`).
 * @returns {string[]} the hide values in document order ([] when absent).
 */
function parseHide(lines) {
  for (let i = 0; i < lines.length; i++) {
    const head = /^hide:[ \t]*(.*)$/.exec(lines[i]);
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

/** @returns {string[]} the `hide:` list values, or [] when absent. */
export function readFrontmatterHide(md) {
  const m = FM_RE.exec(md);
  if (!m) return [];
  return parseHide(m[1].split('\n'));
}

/** Drop the `hide:` line + its block-style items (or its inline flow list). */
function stripHide(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const head = /^hide:[ \t]*(.*)$/.exec(lines[i]);
    if (!head) { out.push(lines[i]); continue; }
    if (head[1].trim().startsWith('[')) continue;          // inline flow → one line
    while (i + 1 < lines.length && /^[ \t]+-/.test(lines[i + 1])) i++;
  }
  return out;
}

/**
 * Set, replace, or (empty list) remove the `hide:` block. Creates the
 * frontmatter block when needed; drops it when removal leaves it empty.
 * Always emitted block-style with two-space indentation. Other keys (and any
 * hide values not in `list`) are the caller's concern — this writes exactly the
 * list it is given.
 * @param {string[]} list
 * @returns {string} updated markdown
 */
export function writeFrontmatterHide(md, list) {
  const values = (Array.isArray(list) ? list : [])
    .map(v => String(v).trim()).filter(Boolean);
  const block = values.length ? ['hide:', ...values.map(v => `  - ${v}`)] : [];
  const m = FM_RE.exec(md);

  if (!m) {
    if (!values.length) return md;
    return `---\n${block.join('\n')}\n---\n\n${md}`;
  }

  const lines = stripHide(m[1].split('\n')).concat(block);

  if (lines.every(l => l.trim() === '')) {
    // Block emptied — remove it and the blank separator line it owned.
    let rest = md.slice(m[0].length);
    if (rest.startsWith('\n')) rest = rest.slice(1);
    return rest;
  }
  return `---\n${lines.join('\n')}\n---\n` + md.slice(m[0].length);
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
