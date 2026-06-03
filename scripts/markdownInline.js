// Inline Markdown ⇄ AST conversion for the KB Description rich-text editor.
// AST node shapes:
//   { type: 'text', value: string }
//   { type: 'strong'|'em'|'underline'|'strike'|'highlight', children: node[] }
//   { type: 'link', href: string, children: node[] }

// Delimiter table, ordered so longer markers match before shorter ('***' before
// '**' before '*'). '***' is the combined bold+italic run the toolbar produces
// when Bold and Italic are stacked; it maps to nested strong>em.
const DELIMS = [
  ['***', 'strong-em'],
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

// Lazy first-match: the NEAREST closing marker wins. This keeps adjacent marks
// independent — `*a* and *b*` parses as two separate emphases, not one spanning the
// gap (which is what a greedy last-match would do, absorbing the text between).
// Trade-off (v1 limitation): the shared-endpoint triple `**a*b***` parses as
// strong["a*b"] + a literal "*" rather than nested strong>em. It still round-trips to
// the same Markdown, so there is no data loss — only an in-editor rendering quirk for
// that rare input.
function findClosing(text, start, marker) {
  for (let j = start; j <= text.length - marker.length; j++) {
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
        // '***' is sugar for nested strong>em; everything else is a single mark.
        const children = parseInline(inner);
        nodes.push(delim.type === 'strong-em'
          ? { type: 'strong', children: [{ type: 'em', children }] }
          : { type: delim.type, children });
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

const MARK_DELIM = {
  strong: '**',
  em: '*',
  underline: '^^',
  strike: '~~',
  highlight: '==',
};

export function renderMarkdown(nodes) {
  return nodes.map(n => {
    if (n.type === 'text') return n.value;
    if (n.type === 'link') return `[${renderMarkdown(n.children)}](${n.href})`;
    const d = MARK_DELIM[n.type];
    return d + renderMarkdown(n.children) + d;
  }).join('');
}

const TAG = {
  strong: 'strong',
  em: 'em',
  underline: 'u',
  strike: 's',
  highlight: 'mark',
};

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

export function renderHtml(nodes) {
  return nodes.map(n => {
    if (n.type === 'text') return escapeHtml(n.value).replace(/\n/g, '<br>');
    if (n.type === 'link') return `<a href="${escapeAttr(n.href)}">${renderHtml(n.children)}</a>`;
    return `<${TAG[n.type]}>${renderHtml(n.children)}</${TAG[n.type]}>`;
  }).join('');
}

// Maps editor element tag names back to AST mark types. Includes the synonyms a
// browser may produce (b/i, del/strike) even though we only ever emit the canonical
// tags from renderHtml.
const TAG_TO_TYPE = {
  strong: 'strong', b: 'strong',
  em: 'em', i: 'em',
  u: 'underline',
  s: 'strike', strike: 'strike', del: 'strike',
  mark: 'highlight',
};

export function domToNodes(root) {
  const out = [];
  root.childNodes.forEach(child => {
    if (child.nodeType === Node.TEXT_NODE) {
      if (child.nodeValue) out.push({ type: 'text', value: child.nodeValue });
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;

    const tag = child.tagName.toLowerCase();
    if (tag === 'br') { out.push({ type: 'text', value: '\n' }); return; }

    const markType = TAG_TO_TYPE[tag];
    if (markType) { out.push({ type: markType, children: domToNodes(child) }); return; }

    if (tag === 'a') {
      out.push({ type: 'link', href: child.getAttribute('href') || '', children: [{ type: 'text', value: child.textContent }] });
      return;
    }

    if (tag === 'div' || tag === 'p') {
      // contenteditable wraps subsequent lines in block elements — treat as newline boundaries.
      if (out.length) out.push({ type: 'text', value: '\n' });
      out.push(...domToNodes(child));
      return;
    }

    // Unknown element (e.g. pasted span) → unwrap to its contents.
    out.push(...domToNodes(child));
  });
  return out;
}
