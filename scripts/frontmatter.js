// scripts/frontmatter.js
// Read/write the `icon:` key in a leading YAML frontmatter block:
//
//   ---
//   icon: lucide/user-plus
//   ---
//
// Pure string functions — no network, no DOM. Only the icon line is owned by
// these helpers; every other line in the block passes through untouched.
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
