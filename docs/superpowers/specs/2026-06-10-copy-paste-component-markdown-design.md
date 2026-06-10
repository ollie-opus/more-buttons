# Copy Component Markdown → Paste as New Component

**Date:** 2026-06-10
**Status:** Approved

## Summary

Two connected features:

1. **Copy to clipboard** — a new button next to Edit on every component card (capture, admonition, content tabs) that copies the component's full markdown (including all nested subcomponents) to the system clipboard, with every `data-uuid` span stripped.
2. **Paste copied markdown** — a new option in the "insert a component" popup that opens a textarea form; submitting validates the pasted markdown, mints fresh uuids, and commits it into the page at the chosen insert position.

Mechanism is **system clipboard only** (`navigator.clipboard`): no internal buffer, no prefill. The paste form accepts markdown from any source, not just our copy button.

## 1. Copy to clipboard button

- Added to all three card renderers in `scripts/guides.js`: `captureComponentCardFor()`, `admonitionCard()`, `tabsComponentCard()`.
- Rendered next to the Edit button, using the same button classes/markup as Edit. Attribute: `data-copy-component="${uuid}"`.
- Click handled inside the existing `onComponentEditorClick()` delegation, but does **not** route through `beginChildNavigation()` — copying navigates nowhere and must not trigger the save-gate.
- Source of markdown: the in-memory component entry from `parseComponents()` (raw markdown including nested children). No fetch needed.
- Transform before copying: remove **every** `<span data-uuid="…"></span>` (the component's own and all nested ones) and the empty lines they leave behind; trim.
- Write via `navigator.clipboard.writeText()`.
- Feedback: button label swaps to "Copied ✓" for ~1.5 s, then reverts. On write failure (rare on this https origin), show "Copy failed" the same way. No new styling.

## 2. Insert menu addition

In `scripts/insertMenu.js`:

- Below the existing three options (Admonition / Capture submenu / Content tabs), add a divider (`<hr>` or border styled like existing menu separators).
- Below the divider: **"Paste copied markdown"**, `data-pick="paste-markdown"`.
- Dispatch follows the existing pattern: `handlers.pasteMarkdown?.(insertAtIndex)`.

## 3. Paste form

- New form HTML: `config/forms/paste-markdown.html`. Covered by the existing `config/forms/*` glob in `manifest.json` — no manifest change for the HTML.
- Contents:
  - One label-less, full-width **plain** textarea (`--full` layout variant). Not rich-text-upgraded — it holds raw markdown.
  - `.more-buttons-form-actions` with a single primary button bottom-right: **"+ Insert Markdown"** (plus icon + label).
- Opened via `createForm()` through `beginChildNavigation()` like every other child form, so the parent form's save-gate applies.

## 4. Insert action

On submit, in order:

1. **UUID backfill**: run the pasted text through the same `ensure…UUIDs` machinery used by `migrateComponentIdentity()` (captures, admonitions, content tabs). Copy strips uuids, so every pasted component gets a fresh uuid — pasting back into the same page can never duplicate a uuid.
2. **Validate** via `parseComponents()`:
   - Valid = at least one recognized component block AND no stray leading prose (the parser's `description` must be empty/whitespace).
   - Invalid → inline error in the form; form stays open; nothing is pushed.
3. **Commit**: through the parent container's `mutate()` — splice the parsed components into the component list at `insertAtIndex`, rebuild the body (`writeBody`), push via `githubFetchAndPushFile()`.
4. Loading uses the standard formLoading veil over the form tile (no inline placeholders).
5. On success: form closes, parent component list refreshes. **No editor opens** — the insert-opens-editor convention applies only to newly created blank components, not pasted content.

## 5. Edge cases & constraints

- **Capture images**: pasted capture markdown keeps its existing repo image references — shared assets, same model as "Add from library". No asset duplication.
- **Multi-component paste**: supported naturally; validation is "≥1 component, no stray prose".
- **Cross-page paste**: works — clipboard contents are plain markdown, and uuid backfill runs at insert time.
- **New script files**: handlers are expected to live in `guides.js` / `insertMenu.js`. If implementation adds a new `scripts/*.js`, it must be listed individually in manifest `web_accessible_resources`, and the extension reloaded at chrome://extensions.
- **No new styling systems**: reuse existing button, menu, form, and veil styles throughout.

## Testing

- Manual verification in the extension: copy each component type (including one with nested subcomponents), confirm clipboard contents have no `data-uuid` spans; paste into same page and a different page; confirm fresh uuids in the committed markdown and correct insert position.
- Negative cases: paste plain prose (rejected with inline error), paste empty (rejected), clipboard-permission failure on copy (button shows "Copy failed").
