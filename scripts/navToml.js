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
