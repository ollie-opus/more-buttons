// Pure, DOM-free string transforms for the KB Description markdown toolbar.
// Each function takes the current value + selection range and returns the new
// value and the selection range to restore. No DOM, no side effects — unit
// tested in tests/markdownToolbarActions.test.mjs.

import { markSpans, matchLink, matchGroove, grooveMarkup, grooveTextOffset, matchLabel, labelMarkup, labelTextOffset, LIST_ITEM_RE } from './markdownInline.js';

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

  // Block partial nesting (renders poorly in Zensical): do nothing rather than
  // leave some of the enclosing mark's text outside the new one. Toggles/merges
  // above have already returned; coextensive stacking falls through to the wrap.
  if (nestsPartially(value, selStart, selEnd, marker)) return { value, selStart, selEnd };

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

// True when wrapping [selStart, selEnd] in `marker` would nest it only PARTLY
// inside a DIFFERENT existing mark — i.e. that mark keeps RENDERED text outside
// the new mark on either side (e.g. underlining "ing" in **testing** ->
// **test^^ing^^**). Markdown can represent this, but Zensical renders it poorly,
// so the toolbar blocks it. "Rendered" ignores mark delimiters and link syntax,
// so COEXTENSIVE stacking — where the new mark covers ALL of the enclosing
// mark's text, e.g. adding italic over the whole word in ^^**testing**^^ — is
// NOT partial and stays allowed.
function nestsPartially(value, selStart, selEnd, marker) {
  const spans = markSpans(value);
  // Source indices that are delimiters or link syntax, never rendered as text.
  const structural = new Array(value.length).fill(false);
  for (const sp of spans) {
    for (let p = sp.open[0]; p < sp.open[1]; p++) structural[p] = true;
    for (let p = sp.close[0]; p < sp.close[1]; p++) structural[p] = true;
  }
  for (const lk of scanLinks(value)) {
    structural[lk.textStart - 1] = true;                        // '['
    for (let p = lk.textEnd; p < lk.end; p++) structural[p] = true; // '](url)'
  }
  const renderedBetween = (from, to) => {
    for (let p = from; p < to; p++) if (!structural[p]) return true;
    return false;
  };
  return spans.some(sp =>
    sp.marker !== marker &&
    sp.open[1] <= selStart && selEnd <= sp.close[0] && // selection sits inside this mark
    (renderedBetween(sp.open[1], selStart) || renderedBetween(selEnd, sp.close[0])));
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
// link. Label pills are atomic the same way: touching any of a label's text
// unwraps the whole pill to its plain text (the colour is discarded).
// Pure: (value, selStart, selEnd) -> { value, selStart, selEnd }.
export function stripFormatting(value, selStart, selEnd) {
  if (selStart >= selEnd) return { value, selStart, selEnd }; // nothing selected

  const spans = markSpans(value); // marks, outer-first
  const links = scanLinks(value);
  const labels = scanLabels(value); // atomic, like links

  // Identity tokens carrying their open/close delimiter text. Mark delimiters
  // are symmetric (open === close); a link opens with '[' and closes with its
  // '](url)'. Built once per span/link so the emit loop can compare by identity
  // (===) and never merge two distinct adjacent marks into one.
  const markToken = new Map(spans.map(sp => [sp, { open: sp.marker, close: sp.marker }]));
  const linkToken = new Map(links.map(lk => [lk, { open: '[', close: '](' + lk.href + ')' }]));
  // A label opens with its `<span class="mb-label mb-label-slug">` tag (read
  // straight from the source) and closes with `</span>`.
  const labelToken = new Map(labels.map(l => [l, { open: value.slice(l.start, l.textStart), close: '</span>' }]));

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
  for (const l of labels) {
    for (let p = l.start; p < l.textStart; p++) structural[p] = true; // '<span ...>'
    for (let p = l.textEnd; p < l.end; p++) structural[p] = true;     // '</span>'
  }

  // A link / label is selected wholesale if any of its text falls in the selection.
  const linkSelected = new Map(
    links.map(lk => [lk, selStart < lk.textEnd && selEnd > lk.textStart]),
  );
  const labelSelected = new Map(
    labels.map(l => [l, selStart < l.textEnd && selEnd > l.textStart]),
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
    const label = labels.find(l => l.textStart <= pos && pos < l.textEnd);
    if (label) stack.push(labelToken.get(label));
    const selected = (pos >= selStart && pos < selEnd)
      || (link && linkSelected.get(link))
      || (label && labelSelected.get(label));
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

// Toggle ordered ('ol') / unordered ('ul') list formatting on the lines the
// selection covers. Pure: (value, selStart, selEnd, kind) -> {value, selStart, selEnd}.
//
// - Every covered non-blank line already an item of `kind` -> toggle OFF
//   (strip the prefixes).
// - Otherwise toggle ON: prefix every covered non-blank line, converting items
//   of the other kind in place.
// - A collapsed caret on a blank line starts a new empty item ('- ' / '1. ').
// - Blank-line guards keep Zensical's block parsing clean: toggling ON inserts
//   a blank line between the new list and adjacent plain text / other-kind
//   items; toggling OFF inserts one between the de-listed lines and items that
//   remain (otherwise they'd lazily continue the neighbouring item).
// - Ordered runs touching the edit are renumbered 1..n (the rich surface
//   re-serializes to canonical numbering anyway; this keeps markdown mode clean).
// A list line split into its parts, indentation-aware so nesting survives the
// transform. `indent` is the leading whitespace, `marker` is '- ' / 'N. ',
// `content` is the rest. Returns null for a non-item line.
function splitItem(line) {
  const m = line.match(/^( *)(- |\d+\. )(.*)$/);
  return m ? { indent: m[1], marker: m[2], content: m[3] } : null;
}
const markerKind = marker => (marker === '- ' ? 'ul' : 'ol');
// Length of a line's full list prefix (indentation + marker), 0 if not an item.
function listPrefixLen(line) {
  const si = splitItem(line);
  return si ? si.indent.length + si.marker.length : 0;
}

export function toggleList(value, selStart, selEnd, kind) {
  const lines = value.split('\n');
  const starts = [];
  { let acc = 0; for (const l of lines) { starts.push(acc); acc += l.length + 1; } }
  const lineOf = pos => {
    for (let i = 0; i < lines.length; i++) {
      if (pos <= starts[i] + lines[i].length) return i;
    }
    return lines.length - 1;
  };

  const lo = Math.min(selStart, selEnd), hi = Math.max(selStart, selEnd);
  const first = lineOf(lo);
  let last = lineOf(hi);
  // A selection ending exactly at a line's start doesn't include that line.
  if (last > first && hi === starts[last]) last--;

  const nonBlank = [];
  for (let i = first; i <= last; i++) if (lines[i] !== '') nonBlank.push(i);

  const next = lines.slice();
  let turnedOn = false;
  if (nonBlank.length === 0) {
    // Blank line(s). A collapsed caret starts an empty item to type into;
    // a blank-only selection has nothing to format.
    if (selStart !== selEnd) return { value, selStart, selEnd };
    next[first] = kind === 'ol' ? '1. ' : '- ';
    turnedOn = true;
  } else if (nonBlank.every(i => { const si = splitItem(lines[i]); return si && markerKind(si.marker) === kind; })) {
    // Every covered line is already an item of `kind` → toggle OFF (drop the whole
    // prefix, indentation included, so a de-listed nested item becomes plain text).
    for (const i of nonBlank) next[i] = splitItem(lines[i]).content;
  } else {
    // Toggle ON, preserving each line's existing indentation so nesting is kept
    // when converting between ordered/unordered.
    let n = 1;
    for (const i of nonBlank) {
      const si = splitItem(lines[i]);
      const indent = si ? si.indent : '';
      const content = si ? si.content : lines[i];
      next[i] = indent + (kind === 'ol' ? `${n++}. ` : '- ') + content;
    }
    turnedOn = true;
  }

  // Renumber every top-level ordered run that touches the edited range (merging
  // with an adjacent list continues its numbering; runs split by a toggle-off
  // restart). Nested ordered items renumber per-level on re-serialize instead.
  const seen = new Set();
  for (let i = Math.max(0, first - 1); i <= Math.min(next.length - 1, last + 1); i++) {
    if (!LIST_ITEM_RE.ol.test(next[i]) || seen.has(i)) continue;
    let s = i; while (s > 0 && LIST_ITEM_RE.ol.test(next[s - 1])) s--;
    let e = i; while (e < next.length - 1 && LIST_ITEM_RE.ol.test(next[e + 1])) e++;
    let n = 1;
    for (let k = s; k <= e; k++) { seen.add(k); next[k] = `${n++}. ` + next[k].replace(/^\d+\. /, ''); }
  }

  // Blank-line guards at the edited range's edges. A gap separates the edit from
  // plain text (always) and from a same-depth list of the other kind; it is NOT
  // inserted between a nested item and its parent/child (a different depth), which
  // would break the nesting.
  const firstSI = splitItem(next[first]), lastSI = splitItem(next[last]);
  const gapOn = (neighbour, edge) => {
    const nb = splitItem(neighbour);
    return !nb || (edge && nb.indent.length === edge.indent.length && markerKind(nb.marker) !== kind);
  };
  const needsGapAbove = first > 0 && next[first - 1] !== '' &&
    (turnedOn ? gapOn(next[first - 1], firstSI) : !!splitItem(next[first - 1]));
  const needsGapBelow = last < next.length - 1 && next[last + 1] !== '' &&
    (turnedOn ? gapOn(next[last + 1], lastSI) : !!splitItem(next[last + 1]));
  if (needsGapBelow) next.splice(last + 1, 0, '');
  if (needsGapAbove) next.splice(first, 0, '');

  // Map the selection: keep each endpoint's offset within its line's CONTENT
  // (clamping positions that sat inside a removed/changed prefix), then re-seat
  // it after the line's new prefix at the line's new position.
  const newIndexOf = i =>
    i < first ? i
      : i <= last ? i + (needsGapAbove ? 1 : 0)
      : i + (needsGapAbove ? 1 : 0) + (needsGapBelow ? 1 : 0);
  const newStarts = [];
  { let acc = 0; for (const l of next) { newStarts.push(acc); acc += l.length + 1; } }
  const mapPos = pos => {
    const i = lineOf(pos);
    const ni = newIndexOf(i);
    const oldPfx = listPrefixLen(lines[i]);
    let off = pos - starts[i] - oldPfx;
    off = Math.max(0, Math.min(off, lines[i].length - oldPfx));
    return newStarts[ni] + listPrefixLen(next[ni]) + off;
  };
  const ns = mapPos(selStart), ne = mapPos(selEnd);
  return { value: next.join('\n'), selStart: Math.min(ns, ne), selEnd: Math.max(ns, ne) };
}

// Indent (dir = +1) or outdent (dir = -1) every list line the selection covers,
// by one nesting level (4 spaces). Pure: (value, selStart, selEnd, dir) ->
// {value, selStart, selEnd}. Non-list lines are left untouched.
//
// Guard rails keep the structure valid markdown:
//   - Indent only to (depth of the item above) + 1 — so the first item of a list,
//     or a sole child with no sibling above it, can't nest deeper (no parent).
//   - Outdent floors at depth 0; it never strips the marker (un-listing is the
//     list button's job, not Tab's).
export function indentSelection(value, selStart, selEnd, dir) {
  const lines = value.split('\n');
  const starts = [];
  { let acc = 0; for (const l of lines) { starts.push(acc); acc += l.length + 1; } }
  const lineOf = pos => {
    for (let i = 0; i < lines.length; i++) {
      if (pos <= starts[i] + lines[i].length) return i;
    }
    return lines.length - 1;
  };
  const depthOf = line => { const si = splitItem(line); return si ? si.indent.length / 4 : null; };

  const lo = Math.min(selStart, selEnd), hi = Math.max(selStart, selEnd);
  const first = lineOf(lo);
  let last = lineOf(hi);
  if (last > first && hi === starts[last]) last--;

  const next = lines.slice();
  for (let i = first; i <= last; i++) {
    const si = splitItem(lines[i]);
    if (!si) continue; // not a list line
    const depth = si.indent.length / 4;
    let newDepth;
    if (dir > 0) {
      const aboveDepth = i > 0 ? depthOf(next[i - 1]) : null; // parent must already exist
      const maxDepth = aboveDepth === null ? 0 : aboveDepth + 1;
      newDepth = Math.min(depth + 1, maxDepth);
    } else {
      newDepth = Math.max(0, depth - 1);
    }
    if (newDepth === depth) continue;
    next[i] = '    '.repeat(newDepth) + si.marker + si.content;
  }

  // Indentation only changes leading spaces (line count is unchanged), so map each
  // endpoint by preserving its offset within the line's content.
  const newStarts = [];
  { let acc = 0; for (const l of next) { newStarts.push(acc); acc += l.length + 1; } }
  const mapPos = pos => {
    const i = lineOf(pos);
    const oldPfx = listPrefixLen(lines[i]);
    const off = Math.max(0, Math.min(pos - starts[i] - oldPfx, lines[i].length - oldPfx));
    return newStarts[i] + listPrefixLen(next[i]) + off;
  };
  const ns = mapPos(selStart), ne = mapPos(selEnd);
  return { value: next.join('\n'), selStart: Math.min(ns, ne), selEnd: Math.max(ns, ne) };
}

// Is the source position `pos` on a list-item line? Used to decide whether Tab /
// Shift+Tab should indent (vs. fall through to the browser's default).
export function isListLineAt(value, pos) {
  const lines = value.split('\n');
  let acc = 0;
  for (const l of lines) {
    if (pos <= acc + l.length) return splitItem(l) !== null;
    acc += l.length + 1;
  }
  return false;
}

// Insert a thematic break (`---`) as its own block at the caret, replacing any
// selection. The rule is forced onto its own line with a blank line on each side
// so it reads as a thematic break — never a setext-heading underline (`text\n---`
// renders as an H2) — and the existing newlines around the caret are reused rather
// than doubled. The caret lands on the empty line after the rule, ready to type.
// Pure: (value, selStart, selEnd) -> { value, selStart, selEnd }.
export function insertHorizontalRule(value, selStart, selEnd) {
  const lo = Math.min(selStart, selEnd), hi = Math.max(selStart, selEnd);
  const before = value.slice(0, lo).replace(/[ \t]+$/, ''); // no trailing space on the paragraph above
  const after = value.slice(hi);
  const lead = before === '' ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const trail = after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const insert = lead + '---' + trail;
  const caret = before.length + insert.length;
  return { value: before + insert + after, selStart: caret, selEnd: caret };
}

// Find the link whose rendered text the selection sits within, so the toolbar
// can EDIT an existing link instead of nesting a new one inside it. Matches a
// collapsed caret anywhere in the link text, or a selection fully contained in
// it. Returns `{ start, end, text, href }` where [start, end) is the link's full
// `[text](url)` source range (so applyLink over it replaces the whole link), or
// null when the selection isn't inside a single link.
export function linkAt(value, selStart, selEnd) {
  const lo = Math.min(selStart, selEnd), hi = Math.max(selStart, selEnd);
  for (const lk of scanLinks(value)) {
    if (lo >= lk.textStart && hi <= lk.textEnd) {
      return { start: lk.textStart - 1, end: lk.end, text: value.slice(lk.textStart, lk.textEnd), href: lk.href };
    }
  }
  return null;
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

// Every Groove anchor in `value`, left-to-right, with source ranges. `text` is
// the rendered range between '>' and '</a>'; [start, end) is the whole anchor.
function scanGroove(value) {
  const out = [];
  let i = 0;
  while (i < value.length) {
    if (value[i] === '<') {
      const g = matchGroove(value, i);
      if (g) {
        const textStart = i + grooveTextOffset;
        out.push({ start: i, end: g.end, textStart, textEnd: textStart + g.text.length, text: g.text });
        i = g.end;
        continue;
      }
    }
    i++;
  }
  return out;
}

// Find the Groove anchor whose rendered text the selection sits within, so the
// toolbar can EDIT it instead of nesting a new one. Mirror of linkAt. Returns
// `{ start, end, text }` (the whole `[start, end)` anchor range), or null.
export function grooveAt(value, selStart, selEnd) {
  const lo = Math.min(selStart, selEnd), hi = Math.max(selStart, selEnd);
  for (const g of scanGroove(value)) {
    if (lo >= g.textStart && hi <= g.textEnd) return { start: g.start, end: g.end, text: g.text };
  }
  return null;
}

// Splice the canonical Groove anchor at the selection, replacing it. Caret after
// the inserted snippet. Mirror of applyLink.
export function applyGroove(value, selStart, selEnd, text) {
  const snippet = grooveMarkup(text);
  const caret = selStart + snippet.length;
  return {
    value: value.slice(0, selStart) + snippet + value.slice(selEnd),
    selStart: caret,
    selEnd: caret,
  };
}

// Every label pill in `value`, left-to-right, with source ranges. `text` is the
// rendered range between '>' and '</span>'; [start, end) is the whole span.
// Mirror of scanGroove.
function scanLabels(value) {
  const out = [];
  let i = 0;
  while (i < value.length) {
    if (value[i] === '<') {
      const l = matchLabel(value, i);
      if (l) {
        const textStart = i + labelTextOffset(l.slug);
        out.push({ start: i, end: l.end, slug: l.slug, textStart, textEnd: textStart + l.text.length, text: l.text });
        i = l.end;
        continue;
      }
    }
    i++;
  }
  return out;
}

// Find the label pill whose rendered text the selection sits within, so the
// toolbar can EDIT/recolour it instead of nesting a new one. Mirror of grooveAt.
// Returns `{ start, end, text, slug }` (the whole `[start, end)` span range), or null.
export function labelAt(value, selStart, selEnd) {
  const lo = Math.min(selStart, selEnd), hi = Math.max(selStart, selEnd);
  for (const l of scanLabels(value)) {
    if (lo >= l.textStart && hi <= l.textEnd) return { start: l.start, end: l.end, text: l.text, slug: l.slug };
  }
  return null;
}

// Splice the canonical label span at the selection, replacing it. Caret after
// the inserted snippet. Mirror of applyGroove.
export function applyLabel(value, selStart, selEnd, text, slug) {
  const snippet = labelMarkup(slug, text);
  const caret = selStart + snippet.length;
  return {
    value: value.slice(0, selStart) + snippet + value.slice(selEnd),
    selStart: caret,
    selEnd: caret,
  };
}
