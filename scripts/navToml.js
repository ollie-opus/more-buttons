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
