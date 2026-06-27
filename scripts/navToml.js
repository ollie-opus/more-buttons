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

function toNode(obj) {
  const [name, val] = Object.entries(obj)[0];
  if (Array.isArray(val)) return { name, children: val.map(toNode) };
  return { name, value: val };
}

const escStr = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

// Find a top-level `key = [ … ]` assignment. The `(^|\n)\s*` anchor prevents
// the key "nav" from matching inside "draft_nav".
// Assumes the well-formed zensical.toml schema: each inline table has exactly
// one quoted key, plain-identifier keys (no regex metachars), and label/value
// strings free of '[' ']' (the depth walk does not skip string contents).
export function parseNavBlock(tomlText, key) {
  const re = new RegExp(`(^|\\n)\\s*${key}\\s*=\\s*\\[`);
  const m = re.exec(tomlText);
  if (!m) return { items: [], start: -1, end: -1 };
  const arrStart = tomlText.indexOf('[', m.index);
  let depth = 0, arrEnd = -1;
  for (let i = arrStart; i < tomlText.length; i++) {
    if (tomlText[i] === '[') depth++;
    else if (tomlText[i] === ']') { depth--; if (depth === 0) { arrEnd = i; break; } }
  }
  if (arrEnd === -1) return { items: [], start: -1, end: -1 };
  const arrStr = tomlText.slice(arrStart, arrEnd + 1);
  // Convert TOML inline-table syntax to JSON: "key" = value → "key": value
  const jsonStr = arrStr
    .replace(/"(\s*=\s*)/g, '": ')
    .replace(/,(\s*[}\]])/g, '$1');
  try {
    const raw = JSON.parse(jsonStr);
    return { items: Array.isArray(raw) ? raw.map(toNode) : [], start: arrStart, end: arrEnd };
  } catch {
    return { items: [], start: arrStart, end: arrEnd };
  }
}

// Serialize normalized nodes back to TOML inline-table form, 2-space nested.
export function serializeNav(nodes, { indent = 0 } = {}) {
  const pad = '  '.repeat(indent + 1);
  const closePad = '  '.repeat(indent);
  const lines = nodes.map(node => {
    if (node.children) {
      return `${pad}{"${escStr(node.name)}" = ${serializeNav(node.children, { indent: indent + 1 })}}`;
    }
    return `${pad}{"${escStr(node.name)}" = "${escStr(node.value)}"}`;
  });
  return `[\n${lines.join(',\n')}\n${closePad}]`;
}

export function replaceNavBlock(tomlText, key, items) {
  const { start, end } = parseNavBlock(tomlText, key);
  const serialized = serializeNav(items);
  if (start === -1) {
    const sep = tomlText.endsWith('\n') ? '' : '\n';
    return `${tomlText}${sep}\n${key} = ${serialized}\n`;
  }
  return tomlText.slice(0, start) + serialized + tomlText.slice(end + 1);
}

// Walk/create the section hierarchy for `segments`, then insert or replace the
// leaf {leafName: value} at the deepest level. Matches existing sections by
// slug; creates missing ones with a title-cased display name. Mutates + returns.
// Note: the existing-leaf check is scoped to the deepest section only. If `value`
// may already exist elsewhere in the tree, call removeByValue first to avoid a duplicate.
export function insertPath(nodes, segments, leafName, value) {
  let level = nodes;
  for (const seg of segments) {
    const segSlug = slugify(seg);
    let section = level.find(n => n.children && slugify(n.name) === segSlug);
    if (!section) {
      section = { name: titleCaseSegment(segSlug), children: [] };
      level.push(section);
    }
    level = section.children;
  }
  const existing = level.find(n => n.value !== undefined && n.value === value);
  if (existing) existing.name = leafName;
  else level.push({ name: leafName, value });
  return nodes;
}

// Remove ALL leaves whose value === value; prune sections left empty. Mutates + returns.
export function removeByValue(nodes, value) {
  const recurse = (level) => {
    for (let i = level.length - 1; i >= 0; i--) {
      const n = level[i];
      if (n.children) {
        recurse(n.children);
        if (n.children.length === 0) level.splice(i, 1);
      } else if (n.value === value) {
        level.splice(i, 1);
      }
    }
  };
  recurse(nodes);
  return nodes;
}

// Locate a leaf by value; return { segments (slugs), leafName } or null.
export function findPathOfValue(nodes, value, trail = []) {
  for (const n of nodes) {
    if (n.children) {
      const found = findPathOfValue(n.children, value, [...trail, slugify(n.name)]);
      if (found) return found;
    } else if (n.value === value) {
      return { segments: trail, leafName: n.name };
    }
  }
  return null;
}

// The slug identifying a logical page regardless of pages/ vs drafts/ prefix:
// 'pages/archiving-an-asset.md' and 'drafts/archiving-an-asset.md' both → 'archiving-an-asset'.
// Drafting state is which array an entry sits in, not its path, so draft_nav
// reconciliation matches on this slug — tolerating legacy/hand-authored entries
// whose value still carries a drafts/ prefix (which exact-value matching misses).
export function valueSlug(value) {
  return slugify(String(value).split('/').pop().replace(/\.md$/, ''));
}

// findPathOfValue, but matching on valueSlug instead of the exact value.
export function findPathByValueSlug(nodes, slug, trail = []) {
  for (const n of nodes) {
    if (n.children) {
      const found = findPathByValueSlug(n.children, slug, [...trail, slugify(n.name)]);
      if (found) return found;
    } else if (n.value !== undefined && valueSlug(n.value) === slug) {
      return { segments: trail, leafName: n.name };
    }
  }
  return null;
}

// removeByValue, but matching on valueSlug instead of the exact value.
export function removeByValueSlug(nodes, slug) {
  const recurse = (level) => {
    for (let i = level.length - 1; i >= 0; i--) {
      const n = level[i];
      if (n.children) {
        recurse(n.children);
        if (n.children.length === 0) level.splice(i, 1);
      } else if (n.value !== undefined && valueSlug(n.value) === slug) {
        level.splice(i, 1);
      }
    }
  };
  recurse(nodes);
  return nodes;
}

// Move (or create) the leaf identified by valueSlug === slug to the section path
// `newSegments`. Preserves the existing leaf's display name when found, else uses
// `fallbackName`; sets the leaf value to `value`. Returns { changed:false } and
// leaves nodes untouched when an existing leaf is already at the target path —
// callers skip the toml write to avoid an empty-diff commit. Mutates + returns
// { changed }. removeByValueSlug runs across the whole tree first, so the
// subsequent insertPath cannot create a duplicate.
export function setPathByValueSlug(nodes, slug, newSegments, { value, fallbackName } = {}) {
  const loc = findPathByValueSlug(nodes, slug);
  const targetSlugs = newSegments.map(slugify);
  if (loc) {
    const currSlugs = loc.segments.map(slugify);
    const same = currSlugs.length === targetSlugs.length
      && currSlugs.every((s, i) => s === targetSlugs[i]);
    if (same) return { changed: false };
  }
  const leafName = loc?.leafName ?? fallbackName ?? '';
  removeByValueSlug(nodes, slug);
  insertPath(nodes, newSegments, leafName, value);
  return { changed: true };
}

// Rename every leaf whose value === value to newName. Returns the number of
// leaves actually changed (an already-matching name doesn't count, so callers
// can skip the toml write entirely when nothing moved). Renames in place —
// unlike removeByValue + insertPath, which would reorder the tree. Mutates.
export function renameByValue(nodes, value, newName) {
  let changed = 0;
  const recurse = (level) => {
    for (const n of level) {
      if (n.children) recurse(n.children);
      else if (n.value === value && n.name !== newName) { n.name = newName; changed++; }
    }
  };
  recurse(nodes);
  return changed;
}

// renameByValue, but matching on valueSlug instead of the exact value.
export function renameByValueSlug(nodes, slug, newName) {
  let changed = 0;
  const recurse = (level) => {
    for (const n of level) {
      if (n.children) recurse(n.children);
      else if (n.value !== undefined && valueSlug(n.value) === slug && n.name !== newName) { n.name = newName; changed++; }
    }
  };
  recurse(nodes);
  return changed;
}

// Filename of a value: 'pages/a.md' and 'drafts/a.md' → 'a.md'. The identity
// key uniting a live leaf with its draft counterpart (filenames are globally
// unique). Shared by the reorder projection.
export function baseOf(value) {
  return String(value).split('/').pop();
}

// Map every leaf's filename → its EXACT value string. Used so the reorder save
// reuses the value already in the toml rather than reconstructing a prefix.
export function valueMapByBase(nodes) {
  const map = new Map();
  const walk = (level) => {
    for (const n of level) {
      if (n.children) walk(n.children);
      else map.set(baseOf(n.value), n.value);
    }
  };
  walk(nodes);
  return map;
}

// Set of every leaf filename in the tree.
export function leafBases(nodes) {
  const set = new Set();
  const walk = (level) => {
    for (const n of level) {
      if (n.children) walk(n.children);
      else set.add(baseOf(n.value));
    }
  };
  walk(nodes);
  return set;
}

// Clone `edited`, keeping only leaves whose filename is a key in `valueMap`
// (value replaced by the exact mapped string), and pruning folders left empty.
// This is how the edited display tree is projected onto one array's membership.
export function projectTree(edited, valueMap) {
  const out = [];
  for (const n of edited) {
    if (n.children) {
      const kids = projectTree(n.children, valueMap);
      if (kids.length) out.push({ name: n.name, children: kids });
    } else {
      const base = baseOf(n.value);
      if (valueMap.has(base)) out.push({ name: n.name, value: valueMap.get(base) });
    }
  }
  return out;
}

// Replace the run of "managed" top-level entries in `original` with `projected`,
// preserving every other entry (Home/System and anything not part of the edited
// guide tree) verbatim and in place. A node is managed iff it is a top-level
// section whose slug is in `editedTopSlugs`, OR a top-level LEAF whose filename is
// in `editedBases` (a guide placed directly at the root — e.g. a just-created
// draft with no path; without this it would survive verbatim and the projected
// move would duplicate it). The projected block lands at the first managed index;
// if nothing is managed it is appended.
export function spliceGuideBlock(original, projected, editedTopSlugs, editedBases = new Set()) {
  const isManaged = (node) =>
    (Array.isArray(node.children) && editedTopSlugs.has(slugify(node.name))) ||
    (node.value !== undefined && editedBases.has(baseOf(node.value)));
  const out = [];
  let inserted = false;
  for (const node of original) {
    if (isManaged(node)) {
      if (!inserted) { out.push(...projected); inserted = true; }
      // otherwise drop — replaced by the projected block
    } else {
      out.push(node);
    }
  }
  if (!inserted) out.push(...projected);
  return out;
}

// Walk an index-path (array of child indices) to a node, or null if out of range.
export function nodeAtPath(tree, idxPath) {
  let level = tree, node = null;
  for (const i of idxPath) {
    node = level?.[i];
    if (!node) return null;
    level = node.children;
  }
  return node;
}

// Swap the node at idxPath with its dir (-1/+1) sibling. Returns false at an end.
export function moveSibling(tree, idxPath, dir) {
  const parentPath = idxPath.slice(0, -1);
  const i = idxPath[idxPath.length - 1];
  const siblings = parentPath.length ? nodeAtPath(tree, parentPath)?.children : tree;
  if (!siblings) return false;
  const j = i + dir;
  if (j < 0 || j >= siblings.length) return false;
  [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
  return true;
}

// Splice out and return the node at idxPath (null if not found).
export function detachAtPath(tree, idxPath) {
  const parentPath = idxPath.slice(0, -1);
  const i = idxPath[idxPath.length - 1];
  const siblings = parentPath.length ? nodeAtPath(tree, parentPath)?.children : tree;
  if (!siblings || i < 0 || i >= siblings.length) return null;
  return siblings.splice(i, 1)[0];
}

// Push node into the children of the section at idxPath (top level if null).
export function attachUnderPath(tree, idxPath, node) {
  if (!idxPath || idxPath.length === 0) { tree.push(node); return; }
  const target = nodeAtPath(tree, idxPath);
  if (target && target.children) target.children.push(node);
}

// Walk/create sections by slug (title-cased display name for new ones), then
// push node at the deepest level. Mirrors insertPath's section-walk.
export function attachUnderSegments(tree, segments, node) {
  let level = tree;
  for (const seg of segments) {
    const segSlug = slugify(seg);
    let section = level.find(n => n.children && slugify(n.name) === segSlug);
    if (!section) { section = { name: titleCaseSegment(segSlug), children: [] }; level.push(section); }
    level = section.children;
  }
  level.push(node);
}
