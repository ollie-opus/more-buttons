// Pure, DOM-free string transforms for the KB Description markdown toolbar.
// Each function takes the current value + selection range and returns the new
// value and the selection range to restore. No DOM, no side effects — unit
// tested in tests/markdownToolbarActions.test.mjs.

import { markSpans } from './markdownInline.js';

// Every delimiter the toolbar can insert. Order matters: longer delimiters that
// share a leading character ('**' before '*') must come first so the layer
// scan claims them greedily and never mistakes the inner half of '**' for '*'.
const MARKERS = ['**', '*', '^^', '~~', '=='];

// Read the run of known markers adjacent to a boundary, nearest-first.
// dir = -1 walks left from `pos` (markers ending at the boundary);
// dir = +1 walks right from `pos` (markers starting at the boundary).
// Returns [{ marker, start, len }] in the order encountered.
function markerLayers(value, pos, dir) {
  const layers = [];
  let i = pos;
  for (;;) {
    let hit = null;
    for (const m of MARKERS) {
      const start = dir < 0 ? i - m.length : i;
      if (start < 0 || start + m.length > value.length) continue;
      if (value.slice(start, start + m.length) === m) {
        hit = { marker: m, start, len: m.length };
        break;
      }
    }
    if (!hit) break;
    layers.push(hit);
    i += dir * hit.len;
  }
  return layers;
}

// Smallest depth at which `marker` wraps the selection symmetrically on both
// sides, requiring every shallower layer to mirror so we only strip a cleanly
// nested pair. `maxStart` (if given) rejects depths where the two marker runs
// would overlap. Returns -1 when there is no clean match (caller then wraps).
function matchDepth(left, right, marker, overlapGuard) {
  const n = Math.min(left.length, right.length);
  for (let k = 0; k < n; k++) {
    if (left[k].marker !== right[k].marker) break; // asymmetric nesting -> bail
    if (overlapGuard && left[k].start + left[k].len > right[k].start) break;
    if (left[k].marker === marker) return k;
  }
  return -1;
}

// Wrap (or unwrap) the selection in `marker` (e.g. '**', '*', '^^', '~~', '==').
// - Collapsed selection -> insert paired markers, caret between them.
// - Already wrapped      -> strip that marker's layer (toggle off), even when
//   it wraps the selection THROUGH other nested markers (e.g. bold around
//   ^^underline^^, or the bold within ***italic+bold***).
// - Otherwise            -> wrap the selection, keeping the inner text selected.
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

  // Toggle off when `marker` wraps the selection from OUTSIDE — possibly through
  // other markers nested between it and the selection. Walk the marker stack out
  // from each edge and strip the matching layer from both sides.
  const outLeft = markerLayers(value, selStart, -1);
  const outRight = markerLayers(value, selEnd, 1);
  const outDepth = matchDepth(outLeft, outRight, marker);
  if (outDepth !== -1) {
    const l = outLeft[outDepth];
    const r = outRight[outDepth];
    return {
      value:
        value.slice(0, l.start) +
        value.slice(l.start + l.len, r.start) +
        value.slice(r.start + r.len),
      selStart: selStart - l.len,
      selEnd: selEnd - l.len,
    };
  }

  // Toggle off when the markers are INSIDE the selection edges (the user
  // selected the markers too). Same idea, scanning inward from each edge.
  const inLeft = markerLayers(selected, 0, 1);
  const inRight = markerLayers(selected, selected.length, -1);
  const inDepth = matchDepth(inLeft, inRight, marker, true);
  if (inDepth !== -1) {
    const l = inLeft[inDepth];
    const r = inRight[inDepth];
    const stripped =
      selected.slice(0, l.start) +
      selected.slice(l.start + l.len, r.start) +
      selected.slice(r.start + r.len);
    return {
      value: value.slice(0, selStart) + stripped + value.slice(selEnd),
      selStart,
      selEnd: selStart + stripped.length,
    };
  }

  // Wrap. Markdown is a tree, so it can't represent overlapping marks. If the
  // selection straddles an existing mark's boundary, clip it to the clean part
  // outside that mark and wrap only that (we don't split/nest the inside part).
  return wrapSelection(value, selStart, selEnd, marker);
}

// Wrap the selection in `marker`, first CLIPPING it out of any mark it only
// partially covers so we never produce overlapping markdown. Leading/trailing
// whitespace is excluded from the markers. e.g. underlining `ing** 12345` in
// `**testing** 12345` formats only the part outside the bold ->
// `**testing** ^^12345^^` (the `ing` inside the bold is left untouched).
function wrapSelection(value, selStart, selEnd, marker) {
  let start = selStart;
  let end = selEnd;

  // For each matched pair with exactly one delimiter inside the selection (a
  // crossed boundary), drop the side of the selection that sits inside that mark.
  for (const sp of markSpans(value)) {
    const openInside = sp.open[0] >= selStart && sp.open[1] <= selEnd;
    const closeInside = sp.close[0] >= selStart && sp.close[1] <= selEnd;
    if (closeInside && !openInside) start = Math.max(start, sp.close[1]);
    else if (openInside && !closeInside) end = Math.min(end, sp.open[0]);
  }

  // Trim whitespace so the markers never wrap a bare space.
  while (start < end && /\s/.test(value[start])) start++;
  while (end > start && /\s/.test(value[end - 1])) end--;

  // Nothing cleanly formattable (e.g. the selection sat entirely inside a mark's
  // delimiters) → leave the value untouched.
  if (start >= end) return { value, selStart, selEnd };

  const core = value.slice(start, end);
  return {
    value: value.slice(0, start) + marker + core + marker + value.slice(end),
    selStart: start + marker.length,
    selEnd: start + marker.length + core.length,
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
