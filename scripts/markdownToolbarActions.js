// Pure, DOM-free string transforms for the KB Description markdown toolbar.
// Each function takes the current value + selection range and returns the new
// value and the selection range to restore. No DOM, no side effects — unit
// tested in tests/markdownToolbarActions.test.mjs.

import { markSpans, matchLink } from './markdownInline.js';

// Every delimiter the toolbar can insert. Order matters: longer delimiters that
// share a leading character ('**' before '*') must come first so the layer
// scan claims them greedily and never mistakes the inner half of '**' for '*'.
const MARKERS = ['**', '*', '^^', '~~', '==', '`'];

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

// True when delimiter `l` is part of some span's OPEN run and `r` part of that
// SAME span's CLOSE run — i.e. they genuinely open/close one mark. Symmetric
// delimiter runs alone aren't enough: in `**a** ^^b^^ **c**` a `**` opens bold #1
// at the left and a `**` closes bold #2 at the right, mirroring each other without
// being a pair. (`***` parses as one span, so its `**`/`*` sub-runs validate here.)
function pairsSameSpan(text, l, r) {
  return markSpans(text).some((sp) =>
    sp.open[0] <= l.start && l.start + l.len <= sp.open[1] &&
    sp.close[0] <= r.start && r.start + r.len <= sp.close[1]);
}

// Smallest depth at which `marker` wraps the selection symmetrically on both
// sides, requiring every shallower layer to mirror so we only strip a cleanly
// nested pair. `overlapGuard` rejects depths where the two marker runs would
// overlap; `isValid` rejects depths whose two runs don't open/close one real span
// (skipping deeper for a genuine pair). Returns -1 when there is no clean match.
function matchDepth(left, right, marker, { overlapGuard, isValid } = {}) {
  const n = Math.min(left.length, right.length);
  for (let k = 0; k < n; k++) {
    if (left[k].marker !== right[k].marker) break; // asymmetric nesting -> bail
    if (overlapGuard && left[k].start + left[k].len > right[k].start) break;
    if (left[k].marker === marker && (!isValid || isValid(left[k], right[k]))) return k;
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

  // Links are atomic for marks: a mark wraps the whole `[text](url)`, never part
  // of its syntax. In rich mode, selecting a link selects only its text node, so
  // the offsets land INSIDE the brackets — between the mark delimiters (which sit
  // outside the link) and the selection. Widen such a selection to the link's
  // full syntax so the toggle/wrap logic below sees those outer delimiters
  // instead of splitting a mark across the `[` / `](url)` (which produced corrupt
  // output like `==[==testing==](url)==`). A selection covering only PART of a
  // link's text is left alone, so partial formatting still nests inside the link.
  [selStart, selEnd] = expandOverLinks(value, selStart, selEnd);

  const selected = value.slice(selStart, selEnd);

  // Toggle off when `marker` wraps the selection from OUTSIDE — possibly through
  // other markers nested between it and the selection. Walk the marker stack out
  // from each edge and strip the matching layer from both sides.
  const outLeft = markerLayers(value, selStart, -1);
  const outRight = markerLayers(value, selEnd, 1);
  const outDepth = matchDepth(outLeft, outRight, marker, {
    isValid: (l, r) => pairsSameSpan(value, l, r),
  });
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
  const inDepth = matchDepth(inLeft, inRight, marker, {
    overlapGuard: true,
    isValid: (l, r) => pairsSameSpan(selected, l, r),
  });
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

  // Toggle the SAME marker where the selection overlaps an existing run of it.
  // Partial overlap MERGES into one clean mark (e.g. **Test**ing -> **Testing**);
  // a region fully inside a mark toggles OFF, splitting it. Returns null when no
  // run of this marker meets the selection, leaving the wrap path below to run.
  const same = toggleSameMarker(value, selStart, selEnd, marker);
  if (same) return same;

  // Wrap. Markdown is a tree, so it can't represent overlapping marks. If the
  // selection straddles a DIFFERENT mark's boundary, clip it to the clean part
  // outside that mark and wrap only that (we don't split/nest the inside part).
  return wrapSelection(value, selStart, selEnd, marker);
}

// Toggle `marker` where the selection meets existing runs of the SAME marker.
// Two shapes, mirror images of each other:
//   - The selection sits fully inside one run's content -> toggle OFF that slice,
//     splitting the run into the (still-marked) head/tail around it.
//   - The selection overlaps/abuts one or more runs without being contained ->
//     toggle ON by MERGING: union the selection with every run it touches into a
//     single mark, dropping the now-internal delimiters and absorbing any plain
//     gap between them. The union CLIPS at a different mark's boundary rather than
//     crossing into it (a mark it fully contains still nests).
// Returns null when no run of `marker` overlaps the selection.
function toggleSameMarker(value, selStart, selEnd, marker) {
  const runs = markSpans(value).filter(
    (sp) => sp.marker === marker && sp.open[0] <= selEnd && sp.close[1] >= selStart,
  );
  if (runs.length === 0) return null;

  // Fully inside a single run's content -> toggle OFF (split).
  const container = runs.find((sp) => sp.open[1] <= selStart && sp.close[0] >= selEnd);
  if (container) {
    const { open, close } = container;
    const head = value.slice(open[1], selStart); // text before the selection, stays marked
    const tail = value.slice(selEnd, close[0]); // text after the selection, stays marked
    const left = head ? marker + head + marker : '';
    const right = tail ? marker + tail + marker : '';
    const middle = value.slice(selStart, selEnd);
    const segment = left + middle + right;
    return {
      value: value.slice(0, open[0]) + segment + value.slice(close[1]),
      selStart: open[0] + left.length,
      selEnd: open[0] + left.length + middle.length,
    };
  }

  // Otherwise toggle ON by merging the selection with every run it touches.
  let mergeStart = selStart;
  let mergeEnd = selEnd;
  const cuts = []; // delimiter ranges [start, end) to drop from the union
  for (const sp of runs) {
    mergeStart = Math.min(mergeStart, sp.open[0]);
    mergeEnd = Math.max(mergeEnd, sp.close[1]);
    cuts.push(sp.open, sp.close);
  }

  // The merge must not let `marker` cross INTO a different mark (markdown can't
  // represent overlap, and we don't engulf the other mark either). If a boundary
  // lands strictly inside another mark — e.g. selecting "Testing" in **Test**^^ing^^
  // lands the end between "ing" and its `^^` — clip it back to that mark's OUTER
  // edge so the union stops at the mark. Repeat until stable for nested marks. A
  // mark the union FULLY contains is never crossed, so it stays cleanly nested.
  const others = markSpans(value).filter((sp) => sp.marker !== marker);
  for (let changed = true; changed; ) {
    changed = false;
    for (const sp of others) {
      if (sp.open[0] < mergeEnd && mergeEnd < sp.close[1]) { mergeEnd = sp.open[0]; changed = true; }
      if (sp.open[0] < mergeStart && mergeStart < sp.close[1]) { mergeStart = sp.close[1]; changed = true; }
    }
  }
  if (mergeEnd <= mergeStart) return { value, selStart, selEnd };

  // Clipping can pull a boundary back past a same-marker delimiter we meant to
  // drop; keep only the cuts that still fall inside the (possibly clipped) union.
  const liveCuts = cuts.filter(([cs, ce]) => cs >= mergeStart && ce <= mergeEnd);
  liveCuts.sort((a, b) => a[0] - b[0]);
  let core = '';
  let pos = mergeStart;
  for (const [cs, ce] of liveCuts) {
    core += value.slice(pos, cs);
    pos = ce;
  }
  core += value.slice(pos, mergeEnd);

  // Keep whitespace from sitting just inside the markers.
  let lead = '', trail = '';
  while (core && /\s/.test(core[0])) { lead += core[0]; core = core.slice(1); }
  while (core && /\s/.test(core[core.length - 1])) { trail = core[core.length - 1] + trail; core = core.slice(0, -1); }
  if (!core) return { value, selStart, selEnd };

  const newValue = value.slice(0, mergeStart) + lead + marker + core + marker + trail + value.slice(mergeEnd);
  // Clipping can land us back on the original markdown (nothing to extend) —
  // leave the user's selection where it was rather than collapsing it onto `core`.
  if (newValue === value) return { value, selStart, selEnd };

  const caret = mergeStart + lead.length + marker.length;
  return { value: newValue, selStart: caret, selEnd: caret + core.length };
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
  // Same-marker overlaps are merged upstream, so only DIFFERENT marks reach here.
  for (const sp of markSpans(value)) {
    if (sp.marker === marker) continue;
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

// Widen [selStart, selEnd] to the full `[...](url)` syntax of every link whose
// rendered text the selection fully encloses, so marks treat such links as a
// single atomic unit. Selections covering only part of a link's text are
// untouched. Returns [start, end].
function expandOverLinks(value, selStart, selEnd) {
  let start = selStart, end = selEnd;
  for (const lk of scanLinks(value)) {
    if (selStart <= lk.textStart && selEnd >= lk.textEnd) {
      start = Math.min(start, lk.textStart - 1); // the '['
      end = Math.max(end, lk.end);               // past the ')'
    }
  }
  return [start, end];
}

// Every link in `value`, left-to-right, with the source ranges of its parts.
// `text` is the rendered (plain) range between the brackets; `syntax` are the
// two structural slices `[` and `](url)` that vanish when the link is stripped.
// Mirrors parseInline's link precedence: scan for `[`, take the first valid
// link, and jump past it (so `[`/`]` inside an already-claimed link/URL don't
// re-match). Mark delimiters never start with `[`, so they don't interfere.
function scanLinks(value) {
  const links = [];
  let i = 0;
  while (i < value.length) {
    if (value[i] === '[') {
      const link = matchLink(value, i);
      if (link) {
        const textStart = i + 1;
        const textEnd = textStart + link.text.length; // index of the ']'
        links.push({ textStart, textEnd, href: link.href, end: link.end }); // end = past the ')'
        i = link.end;
        continue;
      }
    }
    i++;
  }
  return links;
}

// Strip ALL inline formatting (bold/italic/underline/strike/highlight, and
// links) from the selection, leaving the bare rendered text. Outside the
// selection the markdown is preserved exactly. Robust to nesting and to
// selections that only partially cover a mark — the mark is then split so the
// unselected part stays formatted (e.g. **Testing** with "ing" selected ->
// **Test**ing). Links are atomic: touching any of a link's text unwraps the
// whole link to its plain text (the URL is discarded), so we never emit half a
// link. Pure: (value, selStart, selEnd) -> { value, selStart, selEnd }.
export function stripFormatting(value, selStart, selEnd) {
  if (selStart >= selEnd) return { value, selStart, selEnd }; // nothing selected

  const spans = markSpans(value); // marks, outer-first
  const links = scanLinks(value);

  // Identity tokens carrying their open/close delimiter text. Mark delimiters
  // are symmetric (open === close); a link opens with '[' and closes with its
  // '](url)'. Built once per span/link so the emit loop can compare by identity
  // (===) and never merge two distinct adjacent marks into one.
  const markToken = new Map(spans.map(sp => [sp, { open: sp.marker, close: sp.marker }]));
  const linkToken = new Map(links.map(lk => [lk, { open: '[', close: '](' + lk.href + ')' }]));

  // Which source indices are structural (delimiters / link syntax) and so never
  // emitted as content. Everything else is a rendered character.
  const structural = new Array(value.length).fill(false);
  for (const sp of spans) {
    for (let p = sp.open[0]; p < sp.open[1]; p++) structural[p] = true;
    for (let p = sp.close[0]; p < sp.close[1]; p++) structural[p] = true;
  }
  for (const lk of links) {
    for (let p = lk.textStart - 1; p < lk.textStart; p++) structural[p] = true; // '['
    for (let p = lk.textEnd; p < value.length; p++) { // '](url)'
      structural[p] = true;
      if (value[p] === ')') break;
    }
  }

  // A link is selected wholesale if any of its text falls in the selection.
  const linkSelected = new Map(
    links.map(lk => [lk, selStart < lk.textEnd && selEnd > lk.textStart]),
  );

  // Build the rendered units: each content char with its format stack
  // (outer->inner: enclosing marks, then the enclosing link) and whether the
  // selection clears it.
  const units = [];
  for (let pos = 0; pos < value.length; pos++) {
    if (structural[pos]) continue;
    const stack = [];
    for (const sp of spans) {
      if (sp.open[1] <= pos && pos < sp.close[0]) stack.push(markToken.get(sp));
    }
    const link = links.find(lk => lk.textStart <= pos && pos < lk.textEnd);
    if (link) stack.push(linkToken.get(link));
    const selected = (pos >= selStart && pos < selEnd) || (link && linkSelected.get(link));
    units.push({ ch: value[pos], stack: selected ? [] : stack, selected });
  }

  // Emit left-to-right, nesting-aware: close the open tokens the next char no
  // longer wants, open the ones it newly wants, append the char. The bare-text
  // span of the (now-stripped) selection is bracketed for the restored caret.
  let out = '';
  const open = [];
  let newStart = null, newEnd = null;
  for (const u of units) {
    let common = 0;
    while (common < open.length && common < u.stack.length && open[common] === u.stack[common]) common++;
    for (let k = open.length - 1; k >= common; k--) out += open[k].close;
    open.length = common;
    for (let k = common; k < u.stack.length; k++) { out += u.stack[k].open; open.push(u.stack[k]); }
    if (u.selected && newStart === null) newStart = out.length;
    out += u.ch;
    if (u.selected) newEnd = out.length;
  }
  for (let k = open.length - 1; k >= 0; k--) out += open[k].close;

  if (newStart === null) return { value, selStart, selEnd }; // selection held no content
  return { value: out, selStart: newStart, selEnd: newEnd };
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
