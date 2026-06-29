import assert from 'node:assert/strict';
import { applyMarker, applyLink, linkAt, applyGroove, grooveAt, applyLabel, labelAt, stripFormatting } from '../scripts/markdownToolbarActions.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// applyMarker — wrap a non-empty selection
test('wrap whole value in bold', () => {
  assert.deepEqual(applyMarker('foo', 0, 3, '**'),
    { value: '**foo**', selStart: 2, selEnd: 5 });
});

// applyMarker — partial word only (bug #2 regression)
test('wrap only the selected part of a word', () => {
  assert.deepEqual(applyMarker('foobar', 0, 3, '**'),
    { value: '**foo**bar', selStart: 2, selEnd: 5 });
});

// applyMarker — collapsed cursor inserts markers and sits between them (bug #1)
test('collapsed cursor inserts paired markers with caret between', () => {
  assert.deepEqual(applyMarker('', 0, 0, '**'),
    { value: '****', selStart: 2, selEnd: 2 });
});
test('collapsed cursor mid-text', () => {
  // The single '*' marker is inserted twice ('a' + '*' + '*' + 'b'): two
  // single-char markers, NOT a bold '**' delimiter.
  assert.deepEqual(applyMarker('ab', 1, 1, '*'),
    { value: 'a**b', selStart: 2, selEnd: 2 });
});

// applyMarker — toggle off when markers sit OUTSIDE the selection
test('toggle off: markers immediately outside selection', () => {
  assert.deepEqual(applyMarker('**foo**', 2, 5, '**'),
    { value: 'foo', selStart: 0, selEnd: 3 });
});

// applyMarker — toggle off when markers are INSIDE the selection edges
test('toggle off: selection includes the markers', () => {
  assert.deepEqual(applyMarker('**foo**', 0, 7, '**'),
    { value: 'foo', selStart: 0, selEnd: 3 });
});

// applyMarker — sub-delimiter must NOT toggle off a longer adjacent marker (fall back to wrapping)
test('italic inside bold wraps, not toggles (outside form)', () => {
  assert.deepEqual(applyMarker('**foo**', 2, 5, '*'),
    { value: '***foo***', selStart: 3, selEnd: 6 });
});
test('italic over whole bold span wraps, not toggles (inside form)', () => {
  assert.deepEqual(applyMarker('**foo**', 0, 7, '*'),
    { value: '***foo***', selStart: 1, selEnd: 8 });
});

// applyMarker — toggle off a marker that wraps the selection THROUGH nested
// layers (the selection is just the inner word, other markers sit between it
// and the marker being toggled).
test('toggle bold off through a nested italic layer (issue 1)', () => {
  // ***test*** with only `test` selected, click Bold -> remove the bold layer,
  // leaving the italic: *test*.
  assert.deepEqual(applyMarker('***test***', 3, 7, '**'),
    { value: '*test*', selStart: 1, selEnd: 5 });
});
test('toggle bold off through a nested underline layer (issue 2)', () => {
  // **^^test^^** with only `test` selected, click Bold -> remove the outer bold
  // layer through the inner ^^underline^^: ^^test^^.
  assert.deepEqual(applyMarker('**^^test^^**', 4, 8, '**'),
    { value: '^^test^^', selStart: 2, selEnd: 6 });
});
test('toggle inner italic off leaves the outer bold', () => {
  // ***test*** with only `test` selected, click Italic -> remove just the
  // italic layer, leaving the bold: **test**.
  assert.deepEqual(applyMarker('***test***', 3, 7, '*'),
    { value: '**test**', selStart: 2, selEnd: 6 });
});
test('selecting across TWO separate bold marks is not a false toggle-off', () => {
  // **a** ^^b^^ **c**, select the whole line, click Bold. The `**` ending at the
  // start (bold #1's OPEN) and the `**` at the end (bold #2's CLOSE) are NOT a
  // matched pair, so they must NOT be stripped (which produced broken `a** ^^b^^
  // **c`). It falls through to the merge: one bold containing the nested underline.
  assert.deepEqual(applyMarker('**a** ^^b^^ **c**', 2, 15, '**'),
    { value: '**a ^^b^^ c**', selStart: 2, selEnd: 11 });
});

// applyMarker — a selection that straddles an existing mark's boundary is
// CLIPPED to the clean part outside that mark (markdown can't represent
// overlap, and we don't want to nest the inside part either).
test('applying a mark across a bold close clips to the outside part', () => {
  // **testing** 12345 with `ng** 12345` (7..17) selected, click Underline:
  // only the part after the bold close is underlined; the bold is left intact.
  assert.deepEqual(applyMarker('**testing** 12345', 7, 17, '^^'),
    { value: '**testing** ^^12345^^', selStart: 14, selEnd: 19 });
});
test('applying a mark across a bold open clips to the outside part', () => {
  // 12345 **testing** with `12345 **te` (0..10) selected, click Underline:
  // only the part before the bold open is underlined.
  assert.deepEqual(applyMarker('12345 **testing**', 0, 10, '^^'),
    { value: '^^12345^^ **testing**', selStart: 2, selEnd: 7 });
});
test('a mark fully inside the selection just wraps (no clip)', () => {
  assert.deepEqual(applyMarker('a **b** c', 0, 9, '^^'),
    { value: '^^a **b** c^^', selStart: 2, selEnd: 11 });
});
// applyMarker — PARTIAL nesting is blocked: applying a mark to only part of an
// existing different mark's rendered text would produce e.g. **test^^ing^^**,
// which Zensical renders poorly. Such a click is a no-op. Coextensive stacking
// (the new mark covers ALL of the enclosing mark's text) is still allowed.
test('partial nesting inside a mark is blocked (no-op)', () => {
  // **testing**, select just "ing" (6..9), click Underline -> unchanged.
  assert.deepEqual(applyMarker('**testing**', 6, 9, '^^'),
    { value: '**testing**', selStart: 6, selEnd: 9 });
});
test('partial nesting blocked when rendered text remains on the right', () => {
  // **testing**, select "test" (2..6), click Underline -> unchanged ("ing" would
  // be left bold-only outside the underline).
  assert.deepEqual(applyMarker('**testing**', 2, 6, '^^'),
    { value: '**testing**', selStart: 2, selEnd: 6 });
});
test('coextensive stacking is allowed (covers all the mark\'s text)', () => {
  // **testing**, select all of "testing" (2..9), click Underline -> the underline
  // covers the whole bold word, so it nests cleanly.
  assert.deepEqual(applyMarker('**testing**', 2, 9, '^^'),
    { value: '**^^testing^^**', selStart: 4, selEnd: 11 });
});
test('coextensive stacking allowed through an existing nested mark', () => {
  // ^^**testing**^^, select all of "testing" (4..11) — the selection skips the
  // inner ** delimiters (not rendered text), so adding italic is coextensive.
  assert.deepEqual(applyMarker('^^**testing**^^', 4, 11, '*'),
    { value: '^^***testing***^^', selStart: 5, selEnd: 12 });
});

// applyMarker — SAME marker partially overlapping a mark MERGES into one clean
// mark (rather than clipping and leaving redundant adjacent delimiters). Markdown
// can't represent overlap, but it CAN represent the union as a single mark.
test('extending a bold over the unbolded tail merges into one mark', () => {
  // **Test**ing, select the whole word "Testing", click Bold -> **Testing**
  // (NOT **Test****ing**).
  assert.deepEqual(applyMarker('**Test**ing', 2, 11, '**'),
    { value: '**Testing**', selStart: 2, selEnd: 9 });
});
test('merging clips at a different mark instead of crossing into it', () => {
  // **Test**^^ing^^, select the whole word, click Bold -> bold can't extend past
  // "Test" without crossing into the underline, so nothing changes (the selection
  // is preserved). Same no-cross rule the different-marker wrap path uses.
  assert.deepEqual(applyMarker('**Test**^^ing^^', 2, 13, '**'),
    { value: '**Test**^^ing^^', selStart: 2, selEnd: 13 });
});
test('merging bolds a plain gap but stops at a different mark', () => {
  // **Test** x ^^ing^^, select all, click Bold -> the plain " x " joins the bold,
  // the underline is left alone: **Test x** ^^ing^^.
  assert.deepEqual(applyMarker('**Test** x ^^ing^^', 2, 16, '**'),
    { value: '**Test x** ^^ing^^', selStart: 2, selEnd: 8 });
});
test('a partial selection ending inside a different mark stays valid markdown', () => {
  // **Test**^^ing^^, select "estin" (3..12, crossing into the underline), click
  // Bold -> clips to the bold and changes nothing (previously produced the broken
  // overlapping **Test^^in**g^^).
  assert.deepEqual(applyMarker('**Test**^^ing^^', 3, 12, '**'),
    { value: '**Test**^^ing^^', selStart: 3, selEnd: 12 });
});
test('a different mark the union FULLY contains still nests', () => {
  // q **a** ^^b^^ **c** q, select the whole line, click Bold -> the two bolds and
  // the plain gaps merge into one bold; the underline (fully inside the union, no
  // boundary crossed) stays nested: **q a ^^b^^ c q**.
  assert.deepEqual(applyMarker('q **a** ^^b^^ **c** q', 0, 21, '**'),
    { value: '**q a ^^b^^ c q**', selStart: 2, selEnd: 15 });
});
// applyMarker — SAME marker over a region FULLY inside a mark toggles OFF just
// that region, splitting the mark (the natural inverse of the merge above).
test('toggling bold off a tail inside the mark splits it', () => {
  // **Testing**, select "ing", click Bold -> **Test**ing.
  assert.deepEqual(applyMarker('**Testing**', 6, 9, '**'),
    { value: '**Test**ing', selStart: 8, selEnd: 11 });
});
test('toggling bold off a head inside the mark splits it', () => {
  // **Testing**, select "Test", click Bold -> Test**ing**.
  assert.deepEqual(applyMarker('**Testing**', 2, 6, '**'),
    { value: 'Test**ing**', selStart: 0, selEnd: 4 });
});
test('toggling bold off a middle inside the mark splits it both ways', () => {
  // **Testing**, select "est", click Bold -> **T**est**ing**.
  assert.deepEqual(applyMarker('**Testing**', 3, 6, '**'),
    { value: '**T**est**ing**', selStart: 5, selEnd: 8 });
});

// applyMarker — different markers
test('highlight marker', () => {
  assert.deepEqual(applyMarker('hi', 0, 2, '=='),
    { value: '==hi==', selStart: 2, selEnd: 4 });
});
test('code marker wraps a selection', () => {
  assert.deepEqual(applyMarker('npm i', 0, 5, '`'),
    { value: '`npm i`', selStart: 1, selEnd: 6 });
});
test('code marker toggles off', () => {
  assert.deepEqual(applyMarker('`npm i`', 1, 6, '`'),
    { value: 'npm i', selStart: 0, selEnd: 5 });
});

// applyMarker — links are atomic: a mark wraps the whole [text](url), never
// part of its syntax. In rich mode selecting a link selects only its text node,
// so the offsets land INSIDE the brackets; the toggle must still see the marks
// sitting OUTSIDE the link.
test('toggle off a mark wrapping a fully-formatted link', () => {
  // ***^^~~==[testing](u)==~~^^*** with the link TEXT selected (source 10..17),
  // click Highlight to remove just the == layer. Previously the == was split
  // across the link syntax -> ==[==testing==](u)==, corrupting the link.
  assert.deepEqual(applyMarker('***^^~~==[testing](u)==~~^^***', 10, 17, '=='),
    { value: '***^^~~[testing](u)~~^^***', selStart: 7, selEnd: 19 });
});
test('toggle off a mark wrapping a link', () => {
  // ==[testing](u)== select the link text (source 3..10) -> [testing](u).
  assert.deepEqual(applyMarker('==[testing](u)==', 3, 10, '=='),
    { value: '[testing](u)', selStart: 0, selEnd: 12 });
});
test('wrap a mark around a whole link via its text selection', () => {
  // [testing](u) select the link text (source 1..8) -> **[testing](u)** (the
  // mark wraps the whole link, not just the text inside the brackets).
  assert.deepEqual(applyMarker('[testing](u)', 1, 8, '**'),
    { value: '**[testing](u)**', selStart: 2, selEnd: 14 });
});
test('format part of a link text stays inside the link', () => {
  // [testing](u) select just "test" (source 1..5) -> [**test**ing](u): a partial
  // selection is NOT atomic, so it formats inside the link as before.
  assert.deepEqual(applyMarker('[testing](u)', 1, 5, '**'),
    { value: '[**test**ing](u)', selStart: 3, selEnd: 7 });
});

// applyLink — splice [text](url) at the selection, caret after snippet
test('applyLink splices markdown link at caret', () => {
  assert.deepEqual(applyLink('see ', 4, 4, 'docs', 'https://x'),
    { value: 'see [docs](https://x)', selStart: 21, selEnd: 21 });
});
test('applyLink replaces a selection', () => {
  assert.deepEqual(applyLink('see here', 4, 8, 'here', 'https://x'),
    { value: 'see [here](https://x)', selStart: 21, selEnd: 21 });
});

// linkAt — detect the link enclosing the selection so the toolbar can edit it.
test('linkAt finds the link a collapsed caret sits in', () => {
  // 'go [docs](https://x) now', caret at source 6 (inside "docs").
  assert.deepEqual(linkAt('go [docs](https://x) now', 6, 6),
    { start: 3, end: 20, text: 'docs', href: 'https://x' });
});
test('linkAt matches a selection of the whole link text', () => {
  assert.deepEqual(linkAt('go [docs](https://x) now', 4, 8),
    { start: 3, end: 20, text: 'docs', href: 'https://x' });
});
test('linkAt returns null outside any link', () => {
  assert.equal(linkAt('go [docs](https://x) now', 1, 1), null);
});
test('linkAt returns null when the selection spills past the link text', () => {
  // Selection starts in "docs" but runs past the link into " now".
  assert.equal(linkAt('go [docs](https://x) now', 6, 22), null);
});
test('editing a link replaces the whole snippet via linkAt + applyLink', () => {
  const v = 'go [docs](https://x) now';
  const lk = linkAt(v, 6, 6);
  assert.deepEqual(applyLink(v, lk.start, lk.end, 'guide', 'https://y'),
    { value: 'go [guide](https://y) now', selStart: 21, selEnd: 21 });
});

// grooveAt / applyGroove — detect + insert the Groove-support anchor.
const G = t => `<a href="#" onclick="event.preventDefault(); window.groove.widget.open();">${t}</a>`;
const grooveTextStart = pre => pre + G('').indexOf('</a>'); // inner text start given a prefix length

test('grooveAt finds the anchor a caret sits in', () => {
  const v = 'go ' + G('chat') + ' now';
  const at = grooveTextStart(3) + 1;
  assert.deepEqual(grooveAt(v, at, at), { start: 3, end: 3 + G('chat').length, text: 'chat' });
});
test('grooveAt returns null outside any groove anchor', () => {
  assert.equal(grooveAt('go ' + G('chat') + ' now', 0, 0), null);
});
test('grooveAt returns null when the selection spills past the anchor text', () => {
  const v = 'go ' + G('chat') + ' now';
  assert.equal(grooveAt(v, grooveTextStart(3), v.length), null);
});
test('applyGroove splices the canonical anchor at a caret', () => {
  const end = 4 + G('support').length;
  assert.deepEqual(applyGroove('see ', 4, 4, 'support'),
    { value: 'see ' + G('support'), selStart: end, selEnd: end });
});
test('editing a groove link replaces the whole anchor via grooveAt + applyGroove', () => {
  const v = 'go ' + G('chat') + ' now';
  const at = grooveTextStart(3) + 1;
  const g = grooveAt(v, at, at);
  assert.equal(applyGroove(v, g.start, g.end, 'help').value, 'go ' + G('help') + ' now');
});

// stripFormatting — clear all inline formatting from the selection to bare text.
test('strip: two adjacent marks reduce to plain text', () => {
  // **Test** ^^ing^^ select all rendered text (source 2..14) -> Test ing.
  assert.deepEqual(stripFormatting('**Test** ^^ing^^', 2, 14),
    { value: 'Test ing', selStart: 0, selEnd: 8 });
});
test('strip: nested marks reduce to plain text', () => {
  // **Test ^^ing^^** select all (source 2..12) -> Test ing.
  assert.deepEqual(stripFormatting('**Test ^^ing^^**', 2, 12),
    { value: 'Test ing', selStart: 0, selEnd: 8 });
});
test('strip: partial selection inside a mark splits it', () => {
  // **Testing**, select just "ing" (source 6..9) -> **Test**ing (rest stays bold).
  assert.deepEqual(stripFormatting('**Testing**', 6, 9),
    { value: '**Test**ing', selStart: 8, selEnd: 11 });
});
test('strip: a word inside a sentence keeps the rest formatted', () => {
  // **a ^^b^^ c**, select just "b" (source 6..7) -> b loses bold+underline,
  // a and c stay bold: **a **b** c**.
  assert.deepEqual(stripFormatting('**a ^^b^^ c**', 6, 7),
    { value: '**a **b** c**', selStart: 6, selEnd: 7 });
});
test('strip: a link is unwrapped to its text (URL discarded)', () => {
  // see [Google](http://g.com)! select all (source 0..27) -> see Google!.
  assert.deepEqual(stripFormatting('see [Google](http://g.com)!', 0, 27),
    { value: 'see Google!', selStart: 0, selEnd: 11 });
});
test('strip: touching part of a link unwraps the whole link', () => {
  // [Google](http://g.com), select only "oog" inside the text (source 2..5) ->
  // the entire link collapses to plain Google (atomic: the whole word is left
  // selected since the link was unwrapped wholesale).
  assert.deepEqual(stripFormatting('[Google](http://g.com)', 2, 5),
    { value: 'Google', selStart: 0, selEnd: 6 });
});
test('strip: collapsed selection is a no-op', () => {
  assert.deepEqual(stripFormatting('**Test**', 3, 3),
    { value: '**Test**', selStart: 3, selEnd: 3 });
});

// ── Label pills ──────────────────────────────────────────────────────────────
const LBL = (slug, t) => `<span class="mb-label mb-label-${slug}">${t}</span>`;

test('applyLabel: wraps the selection in a label span, caret after', () => {
  // "hi there", select "there" (3..8)
  const res = applyLabel('hi there', 3, 8, 'there', 'green');
  assert.equal(res.value, 'hi ' + LBL('green', 'there'));
  assert.equal(res.selStart, res.value.length);
  assert.equal(res.selEnd, res.value.length);
});
test('applyLabel: insert at a collapsed caret', () => {
  const res = applyLabel('ab', 1, 1, 'X', 'red');
  assert.equal(res.value, 'a' + LBL('red', 'X') + 'b');
});
test('labelAt: caret inside a pill returns its full span range + slug', () => {
  const value = 'go ' + LBL('amber', 'WIP') + ' now';
  const open = 'go <span class="mb-label mb-label-amber">';
  const caret = open.length + 1; // inside "WIP"
  const hit = labelAt(value, caret, caret);
  assert.equal(hit.slug, 'amber');
  assert.equal(hit.text, 'WIP');
  assert.equal(value.slice(hit.start, hit.end), LBL('amber', 'WIP'));
});
test('labelAt: caret outside any pill returns null', () => {
  assert.equal(labelAt('plain text', 2, 2), null);
});
test('applyLabel over a labelAt range recolours the pill (no nesting)', () => {
  const value = LBL('red', 'Beta');
  const caret = '<span class="mb-label mb-label-red">'.length + 1; // inside "Beta"
  const hit = labelAt(value, caret, caret);
  const res = applyLabel(value, hit.start, hit.end, hit.text, 'blue');
  assert.equal(res.value, LBL('blue', 'Beta'));
});
test('strip: a label pill is unwrapped to its text (colour discarded)', () => {
  const value = 'a ' + LBL('green', 'Beta') + ' b';
  // select the whole thing
  assert.deepEqual(stripFormatting(value, 0, value.length),
    { value: 'a Beta b', selStart: 0, selEnd: 'a Beta b'.length });
});
test('strip: touching part of a label unwraps the whole pill', () => {
  const value = LBL('red', 'Beta');
  const inner = '<span class="mb-label mb-label-red">'.length;
  // select just "et" inside "Beta"
  assert.equal(stripFormatting(value, inner + 1, inner + 3).value, 'Beta');
});
test('strip: an unselected label pill is preserved verbatim', () => {
  const value = 'keep ' + LBL('slate', 'X') + ' **bold**';
  // select only the bold word at the end
  const at = value.indexOf('**bold**');
  const res = stripFormatting(value, at, at + '**bold**'.length);
  assert.equal(res.value, 'keep ' + LBL('slate', 'X') + ' bold');
});

console.log(`\n${passed} passed`);
