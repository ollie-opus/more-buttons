# KB Description Rich-Text Editor — Design

**Date:** 2026-06-02
**Status:** Approved (pre-implementation)

## Summary

Add a WYSIWYG rich-text editor to the **Description** fields of the knowledge-base
(guide) forms. The editor renders a small set of inline Markdown marks visually and
serializes back to Markdown on edit. Markdown the editor does not understand is
preserved verbatim as literal text (pass-through), so existing content is never
mangled.

### Scope

Exactly two fields, both `<textarea>` elements storing raw Markdown:

| Form | Field name | Location |
|------|-----------|----------|
| `config/forms/editGuideSection.html` | `sectionDescription` | lines 14–17 |
| `config/forms/editGuideAdmonition.html` | `admonitionDescription` | lines 43–46 |

These descriptions are committed to `docs/drafts/<guide>.md` and rendered by
Zensical (MkDocs-Material lineage). The repo's `pymdownx` extensions for
**caret** (`^^…^^`), **mark** (`==…==`), and **tilde** (`~~…~~`) are enabled,
which is what makes underline / highlight / strikethrough round-trippable.

### First-iteration mark set

| Mark | Markdown | Element |
|------|----------|---------|
| Bold | `**…**` | `<strong>` |
| Italic | `*…*` | `<em>` |
| Underline | `^^…^^` | `<u>` |
| Strikethrough | `~~…~~` | `<s>` |
| Highlight | `==…==` | `<mark>` |
| Link | `[text](url)` | `<a href>` |

## Approach

Custom, dependency-free (chosen over `execCommand` and over bundling an editor
library). The tricky Markdown ⇄ DOM logic is isolated into pure, unit-tested
functions; formatting is applied to real DOM elements via the Selection/Range API.
The textarea remains the form's single source of truth — the editor is a face over
it — so `form.js` hydration, `guides.js` submit reads, and the dirty-guard all keep
working unchanged.

## Architecture & files

### New files

- **`scripts/markdownInline.js`** — pure core, no DOM side effects, an AST layer so
  it is testable under the existing Node harness:
  - `parseInline(md) → nodes[]` — tokenizes supported marks into AST nodes:
    `{type:'text', value}`, `{type:'strong'|'em'|'underline'|'strike'|'highlight', children}`,
    `{type:'link', href, children}`.
  - `renderHtml(nodes) → htmlString` — AST → escaped HTML for the editor surface.
  - `renderMarkdown(nodes) → md` — AST → Markdown.

- **`scripts/richTextEditor.js`** — the UI component. Exports `upgradeTextarea(textarea)`:
  hides the textarea, builds a toolbar + `contenteditable` surface, renders initial
  content, applies marks via toolbar/shortcuts, and syncs serialized Markdown back to
  the textarea. Uses a thin `domToNodes(surface)` to read the live DOM into the same
  AST, then `renderMarkdown`.

### Touched files

- **`scripts/form.js`** — inside the `storage.local.get` hydration callback, after
  values are set and **before** the dirty-guard snapshot (`form.js:970`):
  `formEl.querySelectorAll('textarea[data-richtext]').forEach(upgradeTextarea);`
  Plus one import. (Must run here, not in the opener, because hydration is async and
  the textarea value is not yet set when `createForm` returns.)
- **`config/forms/editGuideSection.html`** & **`editGuideAdmonition.html`** — add
  `data-richtext` to the Description textareas. No other change.
- **`config/forms/formsStyling.css`** — toolbar, editor surface, in-editor mark
  styling, link popover.
- **`manifest.json`** — register both new scripts in `web_accessible_resources`
  (scripts are listed individually; omission breaks dynamic import).

## Data flow

```
OPEN
  openEditGuideSection (guides.js)
    → stores sectionDescription (raw markdown) in chrome.storage.local
    → createForm('editGuideSection')
        → innerHTML form  →  hydration callback sets textarea.value = markdown
            → upgradeTextarea(textarea):
                 surface.innerHTML = renderHtml(parseInline(textarea.value))
                 (textarea untouched → no false-dirty)
            → dirty-guard snapshot taken (sees original markdown) ✓

EDIT
  user clicks Bold / types / inserts link
    → toggle <strong> etc. on the selection
    → textarea.value = renderMarkdown(domToNodes(surface)); dispatch 'input'

SAVE
  submitEditGuideSection (guides.js)
    → reads textarea.value  →  already markdown  →  pushed to repo (unchanged path)
```

## `markdownInline.js` — rules & decisions

**Parse**
- **Precedence:** `**` matched before `*`; longer delimiter runs win.
- **Italic = `*…*` only.** Underscores left literal to avoid false italics in
  identifiers (`some_var_name`). Deliberate v1 limitation; `_emphasis_` in existing
  docs displays literally. Revisitable.
- **Only balanced pairs convert.** Unmatched `**`, empty `****`, and lone delimiters
  stay literal.
- **Nesting:** marks may nest (e.g. bold-in-italic). Link text is plain in v1 (no
  nested marks inside `[...]`).
- **Unsupported syntax passes through verbatim** — block Markdown (`- item`, defn
  lists, tables), stray punctuation, and literal HTML (`<div>`) become plain text
  nodes. `renderHtml` escapes them for safe display; `renderMarkdown` emits them
  byte-for-byte (no Markdown-escaping) so they round-trip unchanged.
- **Newlines preserved:** `renderHtml` maps `\n`→`<br>` in the surface; `domToNodes`
  maps `<br>` / block boundaries back to `\n`.

**Round-trip guarantees (tested)**
- `renderMarkdown(parseInline(md)) === md` for canonical inputs (every mark, nesting,
  unsupported passthrough, unmatched delimiters).
- Idempotency: re-parsing yields the same AST.

**Accepted edge case:** literal `*x*` typed as plain prose re-parses as italic on
reload — inherent to Markdown, accepted for v1.

## `richTextEditor.js` — UI

**`upgradeTextarea(textarea)`**
1. Hide the textarea (kept as the form value mirror). Build wrapper = toolbar +
   `contenteditable` surface.
2. `surface.innerHTML = renderHtml(parseInline(textarea.value))`. Empty surface shows
   the textarea's `placeholder` via CSS.
3. On `input`/`paste`/format change: `textarea.value = renderMarkdown(domToNodes(surface))`,
   then dispatch a synthetic `input` event on the textarea (counters + dirty-guard react).
4. **Paste** intercepted → inserted as plain text (strips foreign HTML).

**Toolbar** — 6 `type="button"` buttons using existing `more-buttons-icon` glyphs
(`format_bold`, `format_italic`, `format_underlined`, `strikethrough_s`,
`format_ink_highlighter`, `link`). Each has `aria-label` and reflects `aria-pressed`
based on whether the caret/selection is inside that mark (updated on `selectionchange`).

**Toggle behavior** — select + activate wraps the selection in the mark element;
if the selection is already fully within that mark, it unwraps. Selection/Range API
on the single-block common case; multi-block selections best-effort (v1 limitation).

**Keyboard shortcuts** — `Cmd/Ctrl+B` bold, `+I` italic, `+U` underline, `+K` link.
Strike/highlight via toolbar (shortcuts addable later).

**Link popover** — small floating panel under the toolbar with **Text** + **URL**
fields and Insert/Cancel. Pre-fills Text from the selection (both fields when editing
an existing link). `Esc` / click-outside cancels. Inserts or updates an `<a href>`.

**Styling** — toolbar row (buttons + active state); surface reuses the textarea's
border/focus tokens with min-height ≈ the old `rows="6"`; in-editor mark styling;
link popover.

## Testing

- New `tests/markdownInline.test.mjs` (node-assert, matching
  `tests/admonitions-prefix.test.mjs`): parse cases per mark, nesting,
  unmatched/empty delimiters, unsupported passthrough, `renderHtml` escaping, and the
  round-trip + idempotency guarantees.
- Editor DOM behavior (toggle, popover, paste, sync, shortcuts) verified manually in
  the loaded extension; `domToNodes` kept thin so the tested `renderMarkdown` carries
  the formatting logic.

## Out of scope (v1)

Lists, definition lists, tables, headings, code blocks, images, underscore emphasis,
and multi-block toggle edge cases — all continue to work as raw Markdown pass-through.
A future iteration can promote some of these to first-class editing.
