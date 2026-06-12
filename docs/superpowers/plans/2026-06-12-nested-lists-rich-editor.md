# Nested lists in the Description rich-text editor

## Goal
Let users nest ordered/unordered list items in the Description editor. The editor
is markdown-as-truth: a contenteditable surface renders markdown → HTML and
serializes HTML → markdown. Nesting must round-trip through the whole pipeline.

## Markdown representation
A nested item is its parent's marker indented by **4 spaces per level**:
```
- a
    - b
        - c
```
The editor owns its parser, so the rule is exact: **leading spaces ÷ 4 = depth**.
A line whose leading-space count is not a multiple of 4 is treated as plain text
(the editor never produces such lines). List type may differ per level.

## Changes

### 1. Parser + renderer — `scripts/markdownInline.js`
- New `matchListLine(line)` → `{ depth, kind, content }` or `null`
  (`/^( *)(- |\d+\. )(.*)$/`, reject indent % 4 ≠ 0).
- `parseDoc`: a list starts only at a depth-0 list line; `parseListBlock(lines, i,
  depth)` builds nested blocks. Items become `{ nodes, children: block[] }`.
  A deeper line attaches as a child block of the preceding item; a same-depth line
  of a different kind ends the block (stays separate, as today).
- `renderDocHtml`: nest child lists *inside* the `<li>`:
  `<li>text<ul><li>child</li></ul></li>`.
- Backward compatible: flat input renders exactly as before.

### 2. Serializer — `scripts/richEditorMapping.js`
- Thread `depth` through `buildSource.walk`.
- `<li>` emits `'    '.repeat(depth)` + prefix + inline content.
- A nested `<ul>/<ol>` inside an `<li>` (`inListItem === true`) emits a leading
  `\n` and recurses at `depth + 1`; a top-level list recurses at the same depth.
- Newline ownership verified to round-trip: `- a\n    - b\n- c` ⇄ DOM. The
  `onText`/`onBoundary` caret-mapping hooks stay consistent (indentation is plain
  `out` text, like the existing prefix).

### 3. Indent action + toggle tolerance — `scripts/markdownToolbarActions.js`
- New pure `indentSelection(value, selStart, selEnd, dir)` (`dir` = +1 indent / −1
  outdent). For each selected list line: indent only up to `prevItemDepth + 1`
  (no orphan jumps; first item of a list can't indent); outdent floors at depth 0
  (does not un-list). Non-list lines untouched. Remaps the selection across the
  per-line indentation delta.
- `toggleList`: make item detection, prefix-stripping, and ul↔ol conversion
  tolerant of leading indentation so nesting survives a type-toggle and un-list.
  (Run-renumbering stays depth-0; nested ordered digits self-heal on re-serialize.)
- New `isListLineAt(value, pos)` helper for the Tab handler.

### 4. Wiring — `scripts/richTextEditor.js` + `config/forms/formsStyling.css`
- `keydown`: Tab / Shift+Tab runs `indentSelection(±1)` **only when the caret's
  source line is a list item**; otherwise native Tab (focus move) is preserved.
- Two toolbar buttons: `format_indent_decrease` / `format_indent_increase`, wired
  through `runTransform`; disabled when the caret is not inside a list (`li` tag
  absent from the caret's ancestors).
- CSS: zero out margins on nested `li > ul`/`li > ol` so depth doesn't add gaps.

## Out of scope
- Enter behavior (native contenteditable already continues lists).
- Outdent-to-unlist (the list buttons own that).

## Testing
Extend `tests/markdownLists.test.mjs`: nested parse/render round-trips, nested
serialize round-trips, and `indentSelection` (indent, outdent, parent constraint,
depth-0 floor, selection mapping, type-toggle preserving nesting). Pure functions
are unit-tested; Tab/button DOM wiring is manual QA. Run every `tests/*.mjs`.
