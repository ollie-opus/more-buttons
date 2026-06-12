// Bidirectional position map between the rich-text contentEditable surface and
// the markdown source string. The markdown string is the source of truth; this
// module translates DOM selections to source offsets (to feed the existing
// markdownToolbarActions transforms) and back (to restore the caret after a
// re-render). DOM-free except placeCaret, so the rest is unit tested with a
// fake DOM in tests/richEditorMapping.test.mjs.

const TEXT_NODE = 3, ELEMENT_NODE = 1;

// Editor tag -> markdown delimiter. Mirrors renderHtml's TAG map and
// renderMarkdown's MARK_DELIM, plus the browser synonyms (b/i, del/strike) that
// contentEditable / paste can produce.
const TAG_MARKER = {
  strong: '**', b: '**',
  em: '*', i: '*',
  u: '^^',
  s: '~~', strike: '~~', del: '~~',
  mark: '==',
  code: '`',
};

// Walk `root`'s descendants in document order, reconstructing the markdown
// source string. Hooks let callers capture source positions during the walk:
//   onText(textNode, srcStart)          — fired for each non-empty text node
//   onBoundary(parentEl, childIndex, srcLen) — fired at every child slot
//                                          (0..childCount) of every element,
//                                          so element-anchored selections map.
// Returns the reconstructed markdown string.
export function buildSource(root, onText, onBoundary) {
  let out = '';
  // `depth` is the current list-nesting level: each <li> emits 4 spaces per level
  // before its prefix, and a nested <ul>/<ol> inside an <li> recurses at depth+1.
  const walk = (parent, inListItem = false, depth = 0) => {
    const kids = parent.childNodes;
    if (onBoundary) onBoundary(parent, 0, out.length);
    for (let k = 0; k < kids.length; k++) {
      const child = kids[k];
      if (child.nodeType === TEXT_NODE) {
        if (child.nodeValue) { if (onText) onText(child, out.length); out += child.nodeValue; }
      } else if (child.nodeType === ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'br') {
          // Inside a list item a <br> is a browser placeholder (empty <li>) or a
          // soft break we can't represent on a single item line — emit nothing.
          if (!inListItem) out += '\n';
        } else {
          const marker = TAG_MARKER[tag];
          // Drop an emptied mark element (no text inside) rather than emit bare
          // delimiters: an empty <strong> must serialize to '' not '****', which
          // would corrupt the source and render literally. Happens when the user
          // deletes all the text inside a mark but the browser keeps the wrapper.
          if (marker) { if (child.textContent) { out += marker; walk(child, inListItem, depth); out += marker; } else { walk(child, inListItem, depth); } }
          else if (tag === 'a') { out += '['; walk(child, inListItem, depth); out += '](' + (child.getAttribute('href') || '') + ')'; }
          else if (tag === 'ul' || tag === 'ol') {
            // A nested list lives inside an <li>: open it with a newline and step
            // one level deeper. A top-level list keeps the current depth.
            if (inListItem) { out += '\n'; walk(child, false, depth + 1); }
            else { walk(child, false, depth); }
          }
          else if (tag === 'li') {
            // One source line per item: indentation (4 spaces × depth), a '- ' /
            // 'N. ' prefix, content (which may include a nested list), then a
            // newline between items. The list element itself emits no newlines —
            // those around it belong to the neighbouring text runs.
            const siblings = [];
            for (const n of parent.childNodes) {
              if (n.nodeType === ELEMENT_NODE && n.tagName.toLowerCase() === 'li') siblings.push(n);
            }
            const idx = siblings.indexOf(child);
            const ordered = parent.tagName.toLowerCase() === 'ol';
            out += '    '.repeat(depth) + (ordered ? `${idx + 1}. ` : '- ');
            walk(child, true, depth);
            if (idx < siblings.length - 1) out += '\n';
          }
          else if (tag === 'div' || tag === 'p') { if (out.length) out += '\n'; walk(child, inListItem, depth); }
          else { walk(child, inListItem, depth); } // unknown element -> unwrap to contents
        }
      }
      if (onBoundary) onBoundary(parent, k + 1, out.length);
    }
  };
  walk(root);
  return out;
}

// Convenience: just the markdown string (used to sync the textarea on input).
export function serialize(root) { return buildSource(root); }

// Translate a DOM Selection (anchor/focus) into source offsets within the
// reconstructed markdown string. Handles text-node anchors (offset = chars into
// the node) and element anchors (offset = child index). Returns the normalized
// { value, selStart<=selEnd }. If a boundary is not found (detached node), it
// falls back to the end of the value.
export function serializeWithSelection(root, selection) {
  let a = null, f = null;
  const onText = (node, srcStart) => {
    if (selection.anchorNode === node && node.nodeType === TEXT_NODE) a = srcStart + selection.anchorOffset;
    if (selection.focusNode === node && node.nodeType === TEXT_NODE) f = srcStart + selection.focusOffset;
  };
  const onBoundary = (parent, idx, srcLen) => {
    if (selection.anchorNode === parent && parent.nodeType !== TEXT_NODE && selection.anchorOffset === idx) a = srcLen;
    if (selection.focusNode === parent && parent.nodeType !== TEXT_NODE && selection.focusOffset === idx) f = srcLen;
  };
  const value = buildSource(root, onText, onBoundary);
  if (a === null) a = value.length;
  if (f === null) f = value.length;
  return { value, selStart: Math.min(a, f), selEnd: Math.max(a, f) };
}

// Map a source offset to a position in the (freshly rendered) DOM. Valid only
// right after a render, when the DOM round-trips to the same source string.
// Walks the text nodes in document order; returns the first text node whose
// source span reaches `target`, clamped into that node. Offsets sitting in a
// delimiter/link-syntax gap clamp to the start of the following text node;
// offsets past the end clamp to the end of the last text node.
export function locateOffset(root, target) {
  const texts = [];
  const bounds = [];
  buildSource(root,
    (node, start) => texts.push({ node, start, len: node.nodeValue.length }),
    (parent, idx, srcLen) => bounds.push({ parent, idx, srcLen }));
  for (const t of texts) {
    if (target <= t.start + t.len) {
      return { node: t.node, offset: Math.max(0, Math.min(target - t.start, t.len)) };
    }
  }
  // Past every text node. An element boundary may still sit deeper into the
  // source than the last text node — e.g. the caret belongs inside a trailing
  // empty <li>, whose '- ' prefix contributes source chars but holds no text
  // node. Prefer the deepest such boundary; otherwise keep the old behaviour
  // (end of last text node, or root for an empty surface).
  const lastEnd = texts.length ? texts[texts.length - 1].start + texts[texts.length - 1].len : -1;
  let best = null;
  for (const b of bounds) {
    if (b.srcLen <= target && b.srcLen > lastEnd && (!best || b.srcLen > best.srcLen)) best = b;
  }
  if (best) return { node: best.parent, offset: best.idx };
  const last = texts[texts.length - 1];
  if (last) return { node: last.node, offset: last.len };
  return { node: root, offset: 0 };
}

// Apply a selection at the given source offsets to the live document. DOM-only
// (needs document/window) so it is exercised by manual QA, not unit tests.
export function placeCaret(root, selStart, selEnd) {
  const s = locateOffset(root, selStart);
  const e = locateOffset(root, selEnd);
  const range = document.createRange();
  range.setStart(s.node, s.offset);
  range.setEnd(e.node, e.offset);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}
