// scripts/internalPages.js
// Data layer for the link popover's "Internal Page" tab: maps zensical.toml nav
// entries to insertable hrefs and kbTree nodes, and resolves an existing href
// back to its nav leaf. Pure functions except loadInternalNav (memoized fetch).

import { parseNavBlock, baseOf } from './navToml.js';
import { readRepoText } from './repoClient.js';

// Nav value → the relative href to author in page markdown. Guide markdown
// lives one level deep (docs/pages/, docs/drafts/) and live pages are flat in
// docs/pages/, so the bare filename is correct — except Home (docs/index.md),
// which sits a level above.
export function navValueToHref(value) {
  const base = baseOf(value);
  return base === 'index.md' ? '../index.md' : base;
}

// Cheap synchronous shape test: could this href be an internal page link?
// Usable before the nav data has loaded.
export function isInternalHrefShape(href) {
  const h = String(href ?? '').trim();
  if (!h || h.startsWith('#') || h.startsWith('/')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return false; // https:, mailto:, etc.
  return /\.md$/i.test(h);
}

function navNodeToKbNode(node) {
  if (node.children) {
    return { kind: 'folder', label: node.name, children: node.children.map(navNodeToKbNode) };
  }
  return {
    kind: 'file',
    label: node.name,
    attrs: { 'data-kb-file': navValueToHref(node.value), 'data-kb-label': node.name },
  };
}

// Two group roots — Listed (nav) and Unlisted (unlisted_nav) — kept as separate
// trees. No section exclusions: Home and System are linkable pages too.
export function buildInternalTreeNodes(listedItems, unlistedItems) {
  const nodes = [];
  if (listedItems?.length) {
    nodes.push({ kind: 'folder', label: 'Live pages', attrs: { 'data-kb-group': '1' }, children: listedItems.map(navNodeToKbNode) });
  }
  if (unlistedItems?.length) {
    nodes.push({ kind: 'folder', label: 'Unlisted pages', attrs: { 'data-kb-group': '1' }, children: unlistedItems.map(navNodeToKbNode) });
  }
  return nodes;
}

function findLeafByBase(nodes, base) {
  for (const n of nodes ?? []) {
    if (n.children) {
      const hit = findLeafByBase(n.children, base);
      if (hit) return hit;
    } else if (baseOf(n.value) === base) {
      return n;
    }
  }
  return null;
}

// Existing href → its nav leaf as { href, label }, or null when unknown.
// Tolerates 'pages/foo.md', './foo.md' and '../index.md' spellings; the
// returned href is normalized to the navValueToHref form.
export function resolveInternalHref(href, listedItems, unlistedItems) {
  if (!isInternalHrefShape(href)) return null;
  const base = baseOf(String(href).trim());
  const leaf = findLeafByBase(listedItems, base) ?? findLeafByBase(unlistedItems, base);
  return leaf ? { href: navValueToHref(leaf.value), label: leaf.name } : null;
}

// Memoized for the page-load lifetime (same trade-off as navLinksEditor's nav
// cache). draft_nav is deliberately not parsed: drafts-only pages would make
// broken links until published; a page being re-drafted still has its live
// `nav` entry.
let _navPromise = null;
export function loadInternalNav() {
  _navPromise ??= readRepoText('zensical.toml')
    .then(toml => ({
      listed: parseNavBlock(toml, 'nav').items,
      unlisted: parseNavBlock(toml, 'unlisted_nav').items,
    }))
    .catch(() => ({ listed: [], unlisted: [] }));
  return _navPromise;
}
