# Guide title → nav rename + Icon picker — Design

**Date:** 2026-06-11
**Status:** Approved

## Problem

Two gaps in the Edit section form (`editGuideSection`) when it edits a guide's H1:

1. Saving the Title rewrites the H1 in the markdown file but does **not** update the
   guide's display name in `nav` / `draft_nav` inside `zensical.toml`, so the site
   navigation keeps showing the old name.
2. There is no way to set the page icon — the `icon:` key in the markdown
   frontmatter block (e.g. `icon: lucide/user-plus`, lucide set bundled with
   zensical) — without hand-editing the file.

## Scope

- Both features apply **only when the form is editing the H1** (guide level).
  H2/H3 edits are unaffected.
- All writes go through the existing GitHub flow (draft file + `zensical.toml`
  in `ollie-opus/opus-knowledge-base`).

## Feature 1: Title renames nav / draft_nav entries

- New pure helper in `scripts/navToml.js`:
  `renameByValue(nodes, value, newName)` — finds every leaf whose value matches
  (e.g. `pages/adding-employee.md`) and renames it **in place**, preserving its
  position in the tree (remove+insert would reorder; rename must not).
- In `saveSectionForComponent` (guides.js), after the markdown push succeeds,
  and only when the edited section is the H1 (level 1) and the resolved title
  is non-empty, fetch `zensical.toml` and apply `renameByValue` to both the
  `nav` and `draft_nav` blocks (both use the same leaf value,
  `navValueOf(livePath)` = `pages/<name>.md`), then push via
  `githubFetchAndPushFile`. This runs on **every** successful H1 save so that
  a previously-failed toml push self-heals on the next save. `renameByValue`
  returns 0 when the name already matches, so unchanged blocks are not
  reserialized; `githubFetchAndPushFile` skips the PUT when the file is
  byte-identical — the no-op case costs one GET and no PUT.
- **Accepted behaviour note:** the live `nav` entry renames immediately on save,
  even though the H1 text change sits in the draft until publish. The live
  site's nav label will lead its page H1 until the draft is published. This is
  intentional (user decision).

## Feature 2: Icon input with searchable lucide picker

### Data sources

- `config/lucideIcons.json` — flat array of the 1,913 lucide icon names,
  generated from the local zensical install
  (`.venv/lib/python3.14/site-packages/zensical/templates/.icons/lucide/*.svg`
  in the opus-knowledge-base repo). ~25KB. Added to
  `web_accessible_resources` in `manifest.json`.
- `tools/regen-lucide-icons.sh` — regenerates the JSON after a zensical
  upgrade (lists the venv icon dir, strips `.svg`, writes the JSON).
- Previews: SVGs fetched lazily from
  `https://cdn.jsdelivr.net/npm/lucide-static/icons/<name>.svg` and inserted as
  **inline SVG elements** (immune to page `img-src` CSP; jsdelivr sends CORS
  `*` so content-script fetch works). In-memory cache. Only the visible
  matches (~30) are fetched. A failed fetch = no preview for that row; search
  still works.

### UI

- New form group **above the Title input** in
  `config/forms/editGuideSection.html`. Horizontal label+input layout (label
  left), per form conventions. Visible **only for H1 edits** — same
  hide/show mechanism the parent dropdown uses.
- New `scripts/iconPicker.js` (+ individual entry in `manifest.json`
  `web_accessible_resources` — required, scripts are listed individually):
  upgrades the input into a type-to-search combobox:
  - Debounced filtering; top ~30 matches; prefix matches ranked before
    substring matches.
  - Each row: inline SVG preview + icon name. Selecting sets the input value
    to `lucide/<name>`.
  - Keyboard navigable (arrows + enter + escape).
- The input holds the **full frontmatter value** (`lucide/user-plus`). Manual
  free-text is allowed (escape hatch for e.g. `material/...` icons) — the
  picker suggests, it does not restrict. Empty input = no icon.
- If loading `lucideIcons.json` fails, the input degrades to a plain text
  input; saving still works.

### Persistence

- New `scripts/frontmatter.js` (+ manifest entry) with pure functions:
  - `readFrontmatterIcon(md)` → icon value or `''`.
  - `writeFrontmatterIcon(md, icon)` → updates/inserts the `icon:` line in the
    top `---` block, preserving any other keys (`hide:` etc.); creates the
    block if missing; removes the line — and the block, if then empty — when
    icon is cleared.
- **Open:** `openEditGuideSection` reads the icon from the draft markdown into
  the field when the section is the H1.
- **Save:** `sectionIcon` joins the existing `mergeSave` field specs (scalar),
  getting conflict resolution for free. The `build()` callback applies
  `writeFrontmatterIcon` after the section replacement.
- **Verified safe:** `parseSections` keys everything off heading lines
  (`sections.js`), so the frontmatter block above the H1 is never disturbed by
  section edits; draft-create and publish copy whole files, so frontmatter
  travels with them.

## Error handling

- toml rename failure after a successful md push: caught separately and
  surfaced via `alert` with a message distinguishing it from a section-save
  failure (e.g. "Section saved, but updating the navigation name failed: …
  Re-saving the title will retry it."). The toml push runs on every successful
  H1 save, so a previously-failed rename self-heals automatically on the next
  save without user intervention.
- Preview fetch failures are silent per-row (no preview shown).
- Icon list load failure degrades the picker to a plain text input.

## GitHub API cost

Zero API calls for icon data (names bundled in extension; previews via
jsdelivr CDN, no auth/rate limits). The only added API cost is one
`zensical.toml` GET on every H1 save; a PUT is only issued when the content
actually changes (title differs from current nav entry).

## Testing

Node tests alongside the existing suite (`tests/*.test.mjs`):

- `navToml-rename.test.mjs` — rename in `nav` and `draft_nav`, nested
  sections, value missing (no-op), tree order preserved.
- `frontmatter.test.mjs` — insert/update/remove icon; preserve other
  frontmatter keys; file with no frontmatter; frontmatter + H1 interplay with
  `replaceSectionByUUID` (frontmatter survives a title save).

The picker UI (search, previews, keyboard nav) is verified manually in the
extension.
