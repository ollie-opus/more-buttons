// Inline Markdown ⇄ AST conversion for the KB Description rich-text editor.
// AST node shapes:
//   { type: 'text', value: string }
//   { type: 'strong'|'em'|'underline'|'strike'|'highlight', children: node[] }
//   { type: 'link', href: string, children: node[] }

// Delimiter table, ordered so longer markers match before shorter ('**' before '*').
const DELIMS = [
  ['**', 'strong'],
  ['==', 'highlight'],
  ['^^', 'underline'],
  ['~~', 'strike'],
  ['*', 'em'],
];

function matchDelim(text, i) {
  for (const [marker, type] of DELIMS) {
    if (text.startsWith(marker, i)) return { marker, type, len: marker.length };
  }
  return null;
}

function findClosing(text, start, marker) {
  for (let j = text.length - marker.length; j >= start; j--) {
    if (text.startsWith(marker, j)) return j;
  }
  return -1;
}

// [text](url) — no nested brackets in v1; link text is plain.
function matchLink(text, i) {
  if (text[i] !== '[') return null;
  const closeBracket = text.indexOf(']', i + 1);
  if (closeBracket === -1 || text[closeBracket + 1] !== '(') return null;
  const closeParen = text.indexOf(')', closeBracket + 2);
  if (closeParen === -1) return null;
  const linkText = text.slice(i + 1, closeBracket);
  const href = text.slice(closeBracket + 2, closeParen);
  if (!href) return null;
  return { text: linkText, href, end: closeParen + 1 };
}

export function parseInline(text) {
  const nodes = [];
  let buf = '';
  const flush = () => { if (buf) { nodes.push({ type: 'text', value: buf }); buf = ''; } };

  let i = 0;
  while (i < text.length) {
    if (text[i] === '[') {
      const link = matchLink(text, i);
      if (link) {
        flush();
        nodes.push({ type: 'link', href: link.href, children: [{ type: 'text', value: link.text }] });
        i = link.end;
        continue;
      }
    }

    const delim = matchDelim(text, i);
    if (delim) {
      const close = findClosing(text, i + delim.len, delim.marker);
      const inner = close === -1 ? '' : text.slice(i + delim.len, close);
      if (close !== -1 && inner.length > 0) {
        flush();
        nodes.push({ type: delim.type, children: parseInline(inner) });
        i = close + delim.len;
        continue;
      }
      // No closing or empty → treat the opening marker as literal text.
      buf += delim.marker;
      i += delim.len;
      continue;
    }

    buf += text[i];
    i++;
  }
  flush();
  return nodes;
}
