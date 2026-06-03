// Pure, DOM-free string transforms for the KB Description markdown toolbar.
// Each function takes the current value + selection range and returns the new
// value and the selection range to restore. No DOM, no side effects — unit
// tested in tests/markdownToolbarActions.test.mjs.

// Wrap (or unwrap) the selection in `marker` (e.g. '**', '*', '^^', '~~', '==').
// - Collapsed selection  -> insert paired markers, caret between them.
// - Already wrapped       -> strip the markers (toggle off).
// - Otherwise             -> wrap the selection, keeping the inner text selected.
export function applyMarker(value, selStart, selEnd, marker) {
  const len = marker.length;

  // Collapsed: insert "marker+marker" and drop the caret in the middle.
  if (selStart === selEnd) {
    const caret = selStart + len;
    return {
      value: value.slice(0, selStart) + marker + marker + value.slice(selEnd),
      selStart: caret,
      selEnd: caret,
    };
  }

  const selected = value.slice(selStart, selEnd);

  // Toggle off: markers immediately OUTSIDE the selection.
  if (
    value.slice(selStart - len, selStart) === marker &&
    value.slice(selEnd, selEnd + len) === marker
  ) {
    return {
      value: value.slice(0, selStart - len) + selected + value.slice(selEnd + len),
      selStart: selStart - len,
      selEnd: selEnd - len,
    };
  }

  // Toggle off: markers INSIDE the selection edges.
  if (
    selected.length >= 2 * len &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    const inner = selected.slice(len, selected.length - len);
    return {
      value: value.slice(0, selStart) + inner + value.slice(selEnd),
      selStart,
      selEnd: selStart + inner.length,
    };
  }

  // Wrap, keeping the inner text selected.
  return {
    value: value.slice(0, selStart) + marker + selected + marker + value.slice(selEnd),
    selStart: selStart + len,
    selEnd: selStart + len + selected.length,
  };
}

// Splice a `[text](url)` markdown link at the selection, replacing it.
// Caret is placed after the inserted snippet.
export function applyLink(value, selStart, selEnd, text, url) {
  const snippet = `[${text}](${url})`;
  const caret = selStart + snippet.length;
  return {
    value: value.slice(0, selStart) + snippet + value.slice(selEnd),
    selStart: caret,
    selEnd: caret,
  };
}
