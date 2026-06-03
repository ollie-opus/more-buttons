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
  const walk = (parent) => {
    const kids = parent.childNodes;
    if (onBoundary) onBoundary(parent, 0, out.length);
    for (let k = 0; k < kids.length; k++) {
      const child = kids[k];
      if (child.nodeType === TEXT_NODE) {
        if (child.nodeValue) { if (onText) onText(child, out.length); out += child.nodeValue; }
      } else if (child.nodeType === ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'br') {
          out += '\n';
        } else {
          const marker = TAG_MARKER[tag];
          if (marker) { out += marker; walk(child); out += marker; }
          else if (tag === 'a') { out += '['; walk(child); out += '](' + (child.getAttribute('href') || '') + ')'; }
          else if (tag === 'div' || tag === 'p') { if (out.length) out += '\n'; walk(child); }
          else { walk(child); } // unknown element -> unwrap to contents
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
