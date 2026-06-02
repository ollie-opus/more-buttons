// scripts/navToml.js
// Structural read/write of the `nav` and `draft_nav` arrays in zensical.toml.
// Pure string/array functions — no network. Items are normalized to nodes:
//   leaf:    { name: string, value: string }
//   section: { name: string, children: Node[] }

export function slugify(title) {
  return String(title)
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function titleCaseSegment(segment) {
  return String(segment)
    .split('-')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
