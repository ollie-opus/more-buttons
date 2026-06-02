# KB Description — Markdown-source editor with toggleable preview

**Date:** 2026-06-02
**Status:** Approved (design)
**Supersedes:** the contentEditable WYSIWYG approach in
`docs/superpowers/plans/2026-06-02-kb-description-rich-text.md`

## Problem

The KB Description field currently uses a hand-rolled contentEditable WYSIWYG
(`scripts/richTextEditor.js`) that mutates DOM ranges and serializes back to
inline markdown via `domToNodes` (`scripts/markdownInline.js`). It has structural
bugs that are inherent to hand-rolled rich text, not incidental:

1. **Clicking a format button with no selection does nothing.** `toggleMark`
   returns early on a collapsed range (`richTextEditor.js:133`). There is no
   "pending mark" concept, so you cannot click Bold and then type.
2. **Toggling a mark on part of a word reformats the whole run.** `toggleMark`
   finds the nearest ancestor mark and `unwrap`s the entire element
   (`richTextEditor.js:129-131`); there is no range-splitting.
3. **Latent corruption:** multi-node selections mis-detect active state;
   `extractContents`/`insertNode` leaves un-normalized / nested marks that
   serialize to broken markdown (`****…****`), which `parseInline` then
   misreads.

These are the genuinely hard parts of rich text (selection algebra, mark
splitting/joining, normalization, pending formats). We are choosing not to
reimplement a rich-text engine.

## Approach

Replace the WYSIWYG with a **markdown-source editor** (the GitHub Write/Preview
model). The textarea stays visible and is the single source of truth holding raw
markdown. Toolbar buttons are pure string transforms on the textarea value and
selection. Preview is render-only and behind a toggle.

This **structurally eliminates** all three bug classes: there is no rich-text
selection model to get wrong. A collapsed-cursor format inserts paired markers
and places the cursor between them (fixes #1); wrapping/unwrapping operates on
exact string ranges (fixes #2); the stored value is always literal markdown
typed/edited by the user, never a DOM round-trip (fixes #3).

**Tradeoff (accepted):** in Edit mode the user sees raw `**bold**`, not rendered
bold. Rendered output appears only in Preview.

## Decisions

- **Preview fidelity:** inline-only for now. Reuse
  `renderHtml(parseInline(value))`. Block-level pymarkdown (admonitions, lists,
  headings) renders as raw text in preview until the renderer is extended later.
- **Preview mode behavior:** formatting buttons disable (grey out); the
  Edit | Preview tabs stay live. No editing while previewing.
- **Toggle UI:** GitHub-style segmented **Edit | Preview** tabs at the top-left
  of the toolbar; format buttons to the right.

## Architecture

### Modules & boundaries

- **`scripts/markdownInline.js`** — unchanged. `parseInline` / `renderHtml`
  power the preview. (`domToNodes` / `renderMarkdown` become unused by the editor
  but remain; their tests stay green.)

- **`scripts/markdownToolbarActions.js`** — NEW. Pure, DOM-free transforms that
  take a value + selection and return a new value + selection. This is the
  testable core (mirrors how `markdownInline.js` is split from its DOM consumer).

  ```
  applyMarker(value, selStart, selEnd, marker) -> { value, selStart, selEnd }
  applyLink(value, selStart, selEnd, text, url) -> { value, selStart, selEnd }
  ```

  `applyMarker` behavior:
  - Non-empty selection, not already wrapped → wrap in `marker…marker`; new
    selection spans the inner text.
  - Non-empty selection already wrapped by `marker` (immediately outside or
    exactly inside) → strip the markers (toggle-off); selection spans the
    now-unwrapped text.
  - Collapsed selection → insert `marker+marker`; place the caret between them.

  `marker` is the literal delimiter from the existing table: `**`, `*`, `^^`,
  `~~`, `==`.

- **`scripts/richTextEditor.js`** — REWRITTEN. DOM wiring only:
  - `upgradeTextarea(textarea)` keeps the same signature and idempotency
    (`dataset.rteReady`), so `form.js:988` needs **zero changes**.
  - Builds: `.mb-rte` wrapper → toolbar (segmented tabs + format buttons + link
    button) → the original textarea (kept visible) → a `.mb-rte__preview` div.
  - Format buttons and Ctrl/Cmd+B/I/U route through
    `markdownToolbarActions.applyMarker`, write the result back into
    `textarea.value`, restore the selection, and dispatch a bubbling `input`
    event (so dirty-guard and character counters update).
  - Link: reuse the existing popover markup/CSS, but on insert call
    `applyLink` to splice `[text](url)` into the textarea. Ctrl/Cmd+K opens it.
  - Tabs: Preview hides the textarea, renders
    `renderHtml(parseInline(textarea.value))` into the preview div, and disables
    the format/link buttons. Edit reverses it.

### Data flow

```
user types / clicks toolbar
  -> markdownToolbarActions (pure)        [Edit mode]
  -> textarea.value (source of truth)
  -> input event -> dirty-guard + char counter
  -> [toggle Preview] parseInline -> renderHtml -> preview div
```

The textarea is the only persisted state. No mirror, no DOM serialization.

### Integration points (unchanged)

- `form.js:988` — `formEl.querySelectorAll('textarea[data-richtext]').forEach(upgradeTextarea)`
  still works as-is. Because the textarea remains the live value holder, the
  dirty-guard snapshot taken just after upgrade still sees the original markdown
  (no false-dirty), and `[data-maxlength]` counters keep functioning.

## Error handling / edge cases

- Empty value + Preview → render empty (preview shows nothing / placeholder).
- Selection spanning existing markers when wrapping: v1 wraps the raw selected
  substring; we do not attempt to merge adjacent identical marks. Output is valid
  markdown that round-trips through `parseInline`.
- `applyLink` with empty URL → no-op (close popover), matching current behavior.
- Toggle-off detection is literal/string-based (markers immediately around or at
  the edges of the selection); ambiguous cases fall back to wrapping. Documented
  as a v1 limitation.

## Testing

- NEW `tests/markdownToolbarActions.test.mjs` (mirrors
  `markdownInline.test.mjs` plain-assert style), covering:
  - wrap non-empty selection (each marker),
  - collapsed-cursor insert places caret between markers (bug #1),
  - partial-word wrap affects only the selection (bug #2),
  - toggle-off strips markers,
  - `applyLink` splices `[text](url)` at the selection,
  - returned selection offsets are correct.

## Cleanup

- `config/forms/formsStyling.css` — update the `.mb-rte` block: style the
  visible textarea, add segmented-tab styles and `.mb-rte__preview` styles, reuse
  the popover styles, and remove the dead `.mb-rte__surface` contentEditable
  rules.
- `manifest.json` — add `scripts/markdownToolbarActions.js` to
  `web_accessible_resources` (required for every new script module).

## Out of scope (YAGNI)

- Block-level markdown rendering in preview (admonitions, lists, headings).
- Merging/normalizing adjacent or overlapping marks.
- Live (always-on) preview — preview is toggle-only by request.
