# KB Description — True inline WYSIWYG editor (markdown stays source of truth)

**Date:** 2026-06-03
**Status:** Approved (design)
**Builds on:** `docs/superpowers/specs/2026-06-02-kb-description-markdown-editor-design.md`

## Problem

The KB Description field currently uses a markdown-source editor (GitHub
Write/Preview model): a visible textarea holds raw markdown (the single source of
truth), and a read-only Preview tab renders it via `parseInline` → `renderHtml`.
This works well and has a mature engine — pure string transforms with clipping,
toggle-through-nesting, and cross-formatting rules
(`scripts/markdownToolbarActions.js`, `scripts/markdownInline.js`), all unit
tested.

We want to **invert the default view**: edit in a true inline WYSIWYG surface
(bold *looks* bold while you type), with the ability to switch to raw markdown on
demand for debugging. Crucially, **all existing formatting logic must be
retained** — we are adding an editable rendered surface on top of the engine, not
replacing the engine.

## Why this is not the old (removed) WYSIWYG

A hand-rolled contentEditable WYSIWYG was deliberately removed in the
`04e9159` rewrite because it had structural bugs. The root cause there was that
**the DOM was the source of truth** and formatting was done by DOM-range surgery
(`extractContents`/`insertNode`), which left un-normalized / nested marks that
serialized to broken markdown.

This design does **not** repeat that. The **markdown string remains the single
source of truth**; the contentEditable surface is a disposable *rendered
projection* of it. Every formatting operation routes through the existing pure
string transforms (`applyMarker`/`applyLink`), never through DOM surgery. This
structurally retains 100% of the current rules and avoids the old corruption
class.

## Decisions

- **Content scope:** inline marks (`**`, `*`, `^^`, `~~`, `==`) + links + line
  breaks only — matches the current `parseInline`/`renderHtml` scope. No block
  elements (lists, headings, admonitions). Same out-of-scope boundary as today.
- **Typing model:** **native typing + sync** (semi-controlled). The browser
  handles plain typing/deletion natively in the contentEditable; on each `input`
  the DOM is serialized back to the markdown source to keep the hidden textarea
  (form value) in sync. The surface is re-rendered only on formatting operations,
  not on every keystroke — so the caret is never disturbed while typing.
- **No markdown auto-format while typing:** typing literal `*x*` stays literal
  text; it does not auto-italicize. Formatting is applied via toolbar buttons and
  Ctrl/Cmd shortcuts only.
- **Toggle UI:** segmented **Rich | Markdown** tabs (Rich is the default). Rich
  shows the contentEditable surface; Markdown shows the raw textarea.
- **Toolbar works in both modes:** in Rich mode it operates on the surface
  selection (via the position map); in Markdown mode it operates directly on the
  textarea (today's behavior).

## Architecture

### Roles (the inversion)

| Element | Role before | Role after |
| --- | --- | --- |
| Hidden `<textarea>` (raw markdown) | source of truth, visible in Edit mode | **still source of truth**, hidden by default; shown only in Markdown mode |
| Rendered HTML pane | read-only Preview | **editable `contentEditable` surface**, visible by default |
| Toolbar + tabs | Edit \| Preview | **Rich \| Markdown** (Rich default) |

The markdown string never stops being the truth. The contentEditable is a
rendered projection; the DOM is disposable.

### Modules & boundaries

- **`scripts/markdownInline.js`** — engine, essentially unchanged. `parseInline`
  / `renderHtml` / `markSpans` / `domToNodes` / `renderMarkdown` are all reused.
  One *additive, opt-in* capability may be needed: text-node source positions for
  the source→DOM caret mapping (see below). It must be added in a way that does
  not change existing call sites or break existing tests — either a new sibling
  function or an optional flag whose default path is byte-for-byte the current
  behavior. Exact shape confirmed in the implementation plan.

- **`scripts/markdownToolbarActions.js`** — **unchanged**. `applyMarker` /
  `applyLink` and all their clipping / toggle-through-nesting / cross-formatting
  rules are reused verbatim. This is the proof the rules are retained.

- **`scripts/richEditorMapping.js`** — **NEW**. The bidirectional position map —
  the only genuinely new logic, and the new testable core (mirrors how
  `markdownToolbarActions.js` is split from its DOM consumer):

  ```
  serializeWithSelection(surface, selection)
      -> { value, selStart, selEnd }     // DOM -> source string + caret offsets
  placeCaret(surface, value, selStart, selEnd)
      -> void                            // source offsets -> DOM Range, applied
  ```

  - `serializeWithSelection` walks the contentEditable in document order,
    rebuilding the markdown string (reusing the `domToNodes` → `renderMarkdown`
    logic), and records where the live selection's anchor/focus fall within that
    string. Used (a) on every `input` to sync the hidden textarea, and (b) at the
    moment a format button/shortcut fires, to obtain `selStart`/`selEnd` for
    `applyMarker`/`applyLink`.
  - `placeCaret` runs only immediately after a re-render (when the DOM exactly
    matches the source), walking the fresh text nodes to position the
    caret/selection at the source offsets the transform returned. It needs to
    know each rendered text node's source range; that is what the additive
    `markdownInline` capability provides.

- **`scripts/richTextEditor.js`** — **REWRITTEN** (DOM wiring only):
  - `upgradeTextarea(textarea)` keeps the same signature and `dataset.rteReady`
    idempotency, so `form.js:988` needs **zero changes**.
  - Builds `.mb-rte` wrapper → toolbar (Rich|Markdown tabs + format buttons +
    link button) → `contentEditable` surface (visible default) → the original
    textarea (hidden default, kept as form value).
  - Wires: native `input` → `serializeWithSelection` → write back to
    `textarea.value` → dispatch bubbling `input` on the textarea (so dirty-guard
    + char counter fire); `paste` handler; link-click suppression in edit mode.
  - Format buttons + Ctrl/Cmd+B/I/U + Ctrl/Cmd+K in Rich mode:
    `serializeWithSelection` → `applyMarker`/`applyLink` → re-render surface via
    `renderHtml(parseInline(value))` → `placeCaret`.
  - In Markdown mode the toolbar/shortcuts operate on the textarea directly
    (current behavior preserved).
  - Tabs: Markdown→Rich re-renders the surface from the textarea; Rich→Markdown
    just reveals the textarea (already synced).

### Data flow

```
TYPING (plain):
  key -> browser edits DOM natively -> input event
       -> serializeWithSelection -> textarea.value synced
       -> bubbling input on textarea -> dirty-guard + char counter
       (no re-render; caret untouched)

FORMATTING (Rich mode):
  select + click Bold (or Ctrl/Cmd+B)
       -> serializeWithSelection                 (DOM -> source + offsets)
       -> applyMarker(value, selStart, selEnd, '**')   [existing code]
       -> renderHtml(parseInline(value)) -> replace surface innerHTML
       -> placeCaret(returned selStart, selEnd)

LINK (Rich mode):
  Ctrl/Cmd+K / link button -> popover -> on insert:
       -> serializeWithSelection -> applyLink(...) -> re-render -> placeCaret

TOGGLE:
  Markdown -> Rich : render surface from textarea.value
  Rich -> Markdown : textarea already synced -> reveal textarea
```

The textarea is the only persisted state. The DOM is a rebuildable projection.

### Integration points (unchanged)

- `form.js:988` —
  `formEl.querySelectorAll('textarea[data-richtext]').forEach(upgradeTextarea)`
  works as-is. The hidden textarea remains the live value holder, so the
  dirty-guard snapshot taken just after upgrade still sees the original markdown
  (no false-dirty), and `[data-maxlength]` counters keep functioning against the
  markdown source length.

## Error handling / edge cases

- **Paste:** intercept `paste`, take `text/plain` only, splice it into the source
  at the mapped selection, re-render, place caret after the inserted text. No
  foreign HTML ever enters the surface (this also sidesteps pasted-span issues the
  old approach had).
- **Enter / line breaks:** native contentEditable may insert `div`/`p`/`br`;
  `domToNodes` already maps all of these to `\n`, and the next render normalizes
  the DOM to `<br>`. No special handling required.
- **Clicking a link while editing:** `preventDefault` on link clicks in Rich mode
  (no navigation). Links are created/edited via the existing popover.
- **Selection straddling an existing mark's boundary:** handled by the existing
  `applyMarker`/`wrapSelection` clipping — unchanged.
- **Empty value:** surface shows a placeholder; source is empty string.
- **Toggling Rich→Markdown mid-edit:** source is already synced on input, so the
  textarea is current; if any sync is pending, run `serializeWithSelection` on
  toggle to be safe.
- **Char counter / maxlength:** counts the markdown source length (current
  behavior) — unchanged, because the textarea remains the counted value.

## Testing

- **NEW `tests/richEditorMapping.test.mjs`** (plain-assert style, mirrors
  `markdownInline.test.mjs`):
  - `serializeWithSelection` round-trips a rendered DOM (plain text, nested marks,
    links, `<br>`/`div` line breaks) to the correct markdown string;
  - the captured `selStart`/`selEnd` match the intended source offsets for
    selections at mark boundaries, inside nested marks, and across `<br>`;
  - `placeCaret` lands the caret in the correct text node + offset for a given
    source offset (boundary, nested, post-link cases).
- **Existing suites stay green** — `tests/markdownToolbarActions.test.mjs` and
  `tests/markdownInline.test.mjs` must pass unchanged, demonstrating the engine
  (and therefore all formatting rules) is retained.
- **Manual QA:** type/delete in Rich mode (caret stable, source synced); each
  format button + shortcut; link insert; paste plain + rich; Enter for line
  breaks; Rich⇄Markdown toggle parity; dirty-guard and char counter fire; form
  submit persists correct markdown.

## Cleanup

- `config/forms/formsStyling.css` — update the `.mb-rte` block: style the
  contentEditable surface as the primary visible element (rendered-text styling),
  hide the textarea by default and reveal it in Markdown mode, rename/keep the
  segmented tabs as **Rich | Markdown**, reuse the existing popover styles.
- `manifest.json` — add `scripts/richEditorMapping.js` to
  `web_accessible_resources` (required for every new script module).

## Out of scope (YAGNI)

- Block-level editing (lists, headings, admonitions) — engine stays inline-only.
- Markdown auto-format while typing (typing `*x*` auto-italicizing).
- Fully controlled editor (intercepting every keystroke / IME composition) — the
  native-typing-plus-sync model is sufficient for an inline-only field.
- Native undo/redo across formatting re-renders (a formatting op replaces the
  surface; per-keystroke native undo within plain typing is unaffected).
