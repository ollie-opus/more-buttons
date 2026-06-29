// Inline Markdown ⇄ AST conversion for the KB Description rich-text editor.
// AST node shapes:
//   { type: 'text', value: string }
//   { type: 'strong'|'em'|'underline'|'strike'|'highlight'|'code', children: node[] }
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
  ['`', 'code'],
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

// Groove-support links. The published page needs a raw HTML anchor that opens
// the Groove widget on click — markdown link syntax can't carry the onclick — so
// the anchor is stored verbatim in the source and treated as one atomic node.
// Only the inner text varies; everything else is fixed boilerplate.
const GROOVE_OPEN = '<a href="#" onclick="event.preventDefault(); window.groove.widget.open();">';
const GROOVE_CLOSE = '</a>';
// Recognise the canonical anchor (tolerant of minor whitespace). Inner text is
// plain — no '<', so the lazy `[^<]*` can't swallow a following tag.
const GROOVE_RE = /^<a\s+href="#"\s+onclick="event\.preventDefault\(\);\s*window\.groove\.widget\.open\(\);\s*">([^<]*)<\/a>/;

// Build the canonical Groove anchor around `text`.
export function grooveMarkup(text) {
  return GROOVE_OPEN + text + GROOVE_CLOSE;
}

// Source-offset distance from a Groove anchor's start to its inner text, so the
// DOM->source mapping can place a caret that sits inside the rendered badge.
export const grooveTextOffset = GROOVE_OPEN.length;

// Match a Groove anchor at `i`. Returns { text, end } (end = past '</a>') or null.
export function matchGroove(text, i) {
  if (text[i] !== '<') return null;
  const m = GROOVE_RE.exec(text.slice(i));
  return m ? { text: m[1], end: i + m[0].length } : null;
}

// Coloured "label" pills. Like the Groove anchor these are stored as a raw HTML
// span in the source (md_in_html renders it on the published Zensical site) and
// treated as one atomic node — plain text only, no nested formatting. The colour
// lives entirely in the class: `mb-label` (shape) + `mb-label-<slug>` (palette
// colour). The in-editor preview reads the slug from the class and paints the
// pill from labelColours.json; serialize re-emits this canonical, class-only form.
// Inner text is plain — no '<', so the lazy `[^<]*` can't swallow a following tag.
const LABEL_RE = /^<span class="mb-label mb-label-([a-z0-9-]+)">([^<]*)<\/span>/;

// Build the canonical label span around `text` for the given colour `slug`.
export function labelMarkup(slug, text) {
  return `<span class="mb-label mb-label-${slug}">${text}</span>`;
}

// Source-offset distance from a label span's start to its inner text, so the
// DOM->source mapping can place a caret inside the rendered pill. Varies with the
// slug length, so it's a function (unlike the fixed grooveTextOffset).
export function labelTextOffset(slug) {
  return `<span class="mb-label mb-label-${slug}">`.length;
}

// Match a label span at `i`. Returns { slug, text, end } (end = past '</span>') or null.
export function matchLabel(text, i) {
  if (text[i] !== '<') return null;
  const m = LABEL_RE.exec(text.slice(i));
  return m ? { slug: m[1], text: m[2], end: i + m[0].length } : null;
}

// [text](url) — no nested brackets in v1; link text is plain.
export function matchLink(text, i) {
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
    if (text[i] === '<') {
      const groove = matchGroove(text, i);
      if (groove) {
        flush();
        nodes.push({ type: 'groove', text: groove.text });
        i = groove.end;
        continue;
      }
      const label = matchLabel(text, i);
      if (label) {
        flush();
        nodes.push({ type: 'label', slug: label.slug, text: label.text });
        i = label.end;
        continue;
      }
    }

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

// Find every matched delimiter pair with its source positions, mirroring
// parseInline's matching rules (links skipped, lazy nearest close, '***' > '**' >
// '*'). Nested pairs are included, outer before inner. The toolbar uses these
// boundaries to split a newly-applied mark so it never spans across an existing
// mark's edge — which would otherwise produce overlapping, non-nesting markdown.
export function markSpans(value) {
  const spans = [];
  const walk = (text, base) => {
    let i = 0;
    while (i < text.length) {
      if (text[i] === '<') {
        const groove = matchGroove(text, i);
        if (groove) { i = groove.end; continue; } // skip groove anchors; their raw HTML holds no marks
        const label = matchLabel(text, i);
        if (label) { i = label.end; continue; } // skip label pills; atomic raw HTML, no marks inside
      }
      if (text[i] === '[') {
        const link = matchLink(text, i);
        if (link) { i = link.end; continue; } // skip links; markers in URLs aren't marks
      }
      const delim = matchDelim(text, i);
      if (delim) {
        const close = findClosing(text, i + delim.len, delim.marker);
        if (close !== -1 && close > i + delim.len) {
          spans.push({
            marker: delim.marker,
            open: [base + i, base + i + delim.len],
            close: [base + close, base + close + delim.len],
          });
          walk(text.slice(i + delim.len, close), base + i + delim.len);
          i = close + delim.len;
          continue;
        }
        i += delim.len; // unmatched delimiter → literal text
        continue;
      }
      i++;
    }
  };
  walk(value, 0);
  return spans;
}

const MARK_DELIM = {
  strong: '**',
  em: '*',
  underline: '^^',
  strike: '~~',
  highlight: '==',
  code: '`',
};

export function renderMarkdown(nodes) {
  return nodes.map(n => {
    if (n.type === 'text') return n.value;
    if (n.type === 'groove') return grooveMarkup(n.text);
    if (n.type === 'label') return labelMarkup(n.slug, n.text);
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
  code: 'code',
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
    // Editor preview only: render WITHOUT the onclick so the widget can't fire
    // while authoring; `data-groove` is the round-trip marker for domToNodes /
    // buildSource. The real onclick anchor is re-emitted by renderMarkdown.
    if (n.type === 'groove') return `<a href="#" class="mb-groove-link" data-groove="1">${escapeHtml(n.text)}</a>`;
    // Editor preview: same class-only span the source carries (the round-trip
    // marker is the `mb-label` class itself); richTextEditor paints the colour.
    if (n.type === 'label') return `<span class="mb-label mb-label-${n.slug}">${escapeHtml(n.text)}</span>`;
    if (n.type === 'link') return `<a href="${escapeAttr(n.href)}">${renderHtml(n.children)}</a>`;
    return `<${TAG[n.type]}>${renderHtml(n.children)}</${TAG[n.type]}>`;
  }).join('');
}

// ── Block-level lists ─────────────────────────────────────────────────────────
//
// The block constructs the editor understands are ordered/unordered lists, now
// with nesting: a list line is `- ` or `N. ` optionally indented by a multiple of
// 4 spaces, where `indent / 4` is the nesting depth. Everything else stays a
// "text" run whose newlines render as <br>, exactly as before. Newline ownership
// is what makes the mapping round-trip exactly: the '\n' BEFORE a list belongs to
// the preceding text run, the '\n's WITHIN the list (between items and around
// nested sub-lists) belong to the list, and the '\n' AFTER the last item opens
// the following text run.

export const LIST_ITEM_RE = {
  ul: /^- (.*)$/,
  ol: /^\d+\. (.*)$/,
};

// A list line with its nesting depth. Indentation that isn't a clean multiple of
// 4 spaces is NOT a nested item (the editor never emits such lines) — it stays
// plain text so a stray indent can't be misread as a level.
const LIST_LINE_RE = /^( *)(- |\d+\. )(.*)$/;
export function matchListLine(line) {
  const m = line.match(LIST_LINE_RE);
  if (!m || m[1].length % 4 !== 0) return null;
  return { depth: m[1].length / 4, kind: m[2] === '- ' ? 'ul' : 'ol', content: m[3] };
}

// Build one list block starting at lines[i], whose items sit at `depth`. A deeper
// line attaches as a child block of the item above it; a shallower line, or a
// same-depth line of a different kind, ends the block. Returns [block, nextIndex].
//   block = { type: 'ul'|'ol', items: { nodes: inlineNode[], children: block[] }[] }
function parseListBlock(lines, i, depth) {
  const kind = matchListLine(lines[i]).kind;
  const items = [];
  while (i < lines.length) {
    const it = matchListLine(lines[i]);
    if (!it || it.depth < depth) break;
    if (it.depth > depth) {
      if (!items.length) break; // orphan deeper line with no parent — leave to caller
      const [sub, next] = parseListBlock(lines, i, it.depth);
      items[items.length - 1].children.push(sub);
      i = next;
      continue;
    }
    if (it.kind !== kind) break; // sibling list of the other kind starts a new block
    items.push({ nodes: parseInline(it.content), children: [] });
    i++;
  }
  return [{ type: kind, items }, i];
}

/**
 * Parses `text` into block nodes:
 *   { type: 'text', nodes: inlineNode[] }   — newlines preserved
 *   { type: 'ul'|'ol', items: ItemNode[] }  — ItemNode = { nodes, children: block[] }
 */
export function parseDoc(text) {
  const lines = (text ?? '').split('\n');
  const blocks = [];
  let textRun = null;
  const flushText = () => {
    if (textRun !== null) { blocks.push({ type: 'text', nodes: parseInline(textRun) }); textRun = null; }
  };

  let i = 0;
  while (i < lines.length) {
    const it = matchListLine(lines[i]);
    if (it && it.depth === 0) { // a list starts only at a top-level item line
      if (textRun !== null) textRun += '\n'; // newline before the list stays in the text run
      flushText();
      const [block, next] = parseListBlock(lines, i, 0);
      blocks.push(block);
      i = next;
      if (i < lines.length) textRun = ''; // newline after the list opens the next run
      continue;
    }
    textRun = textRun === null ? lines[i] : textRun + '\n' + lines[i];
    i++;
  }
  flushText();
  return blocks;
}

function renderListBlock(b) {
  return `<${b.type}>${b.items.map(it =>
    `<li>${renderHtml(it.nodes)}${it.children.map(renderListBlock).join('')}</li>`).join('')}</${b.type}>`;
}

/** Full-document render: list blocks as nested <ul>/<ol>, text runs as before. */
export function renderDocHtml(text) {
  return parseDoc(text).map(b => b.type === 'text' ? renderHtml(b.nodes) : renderListBlock(b)).join('');
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
  code: 'code',
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
      if (child.getAttribute('data-groove') != null) { out.push({ type: 'groove', text: child.textContent }); return; }
      out.push({ type: 'link', href: child.getAttribute('href') || '', children: [{ type: 'text', value: child.textContent }] });
      return;
    }

    if (tag === 'span') {
      const cls = (child.getAttribute && child.getAttribute('class')) || '';
      if (/(?:^|\s)mb-label(?:\s|$)/.test(cls)) {
        const slug = (cls.match(/mb-label-([a-z0-9-]+)/) || [])[1] || '';
        out.push({ type: 'label', slug, text: child.textContent });
        return;
      }
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
