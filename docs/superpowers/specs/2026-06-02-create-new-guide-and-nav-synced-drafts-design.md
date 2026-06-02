# Create a new guide + nav-synced drafts — Design

**Date:** 2026-06-02
**Status:** Approved

## Problem

The Knowledge Base management page can edit and draft pages that already exist
in `zensical.toml`'s `nav`, but there is no way to author a brand-new guide from
scratch. Separately, the "is this page drafting / live?" pills are derived by
listing the `docs/drafts` and `docs/pages` folders (two GitHub API calls per
open), and the tree is built only from `nav` — so a page that exists only as a
draft cannot be represented at all.

We want a "Create a new guide" flow, and we want all draft operations to keep a
new `draft_nav` array in `zensical.toml` in sync, so the tree and pills can be
derived from the toml alone.

## Key facts about the existing system

- **Files are stored flat:** live pages at `docs/pages/<slug>.md`, drafts at
  `docs/drafts/<slug>.md`. A nav entry's *value* is always `pages/<slug>.md`.
  The folder path shown in nav (e.g. Guides > Employees) is **only** the display
  hierarchy — it is not encoded in the filename.
- `nav` and `draft_nav` are arrays of TOML inline-tables. A leaf is
  `{"Display name" = "pages/slug.md"}`; a section is `{"Display name" = [ … ]}`.
- Draft create / publish / discard live in `scripts/guides.js` and write through
  `githubFetchAndPushFile` / `githubDeleteFile` (`scripts/github.js`), which
  serialize on a shared `_opQueue`.
- Reads go through `scripts/repoClient.js` (`readRepoText`, `readRepoDir`).
- Forms are HTML files in `config/forms/`, loaded by `createForm(name)`; buttons
  with `data-action="x"` invoke form actions registered via `registerFormAction`.
  `.more-buttons-form-actions` is moved out of the `<form>` by `form.js`, so click
  delegation must be on `formEl.parentElement`.
- `knowledgeBaseManagement.js` currently has an inline `parseNav` that
  bracket-matches the `nav` array and converts TOML inline-table syntax to JSON.

## Decisions (from brainstorming)

1. **Path → nav mapping:** match each path segment against an existing child
   section by slug (`slugify(displayName) === segment`); reuse/merge when matched,
   otherwise create a new section. New-section display names are the segment
   title-cased on hyphens (`employees`→"Employees", `annual-reports`→"Annual
   Reports").
2. **Tree source:** the Guides panel renders the **union** of nav's guide sections
   and all of `draft_nav`. Live pill ⇔ value in `nav`; Drafting pill ⇔ value in
   `draft_nav`. New drafts therefore appear immediately.
3. **Conflict scope:** block creation if the slug exists in `docs/drafts` **or** is
   already a live page (value present in `nav`). Files are flat-by-slug, so two
   pages cannot share a slug regardless of folder path.
4. **Empty path allowed:** the guide nests as a leaf at the `draft_nav` root.
5. **TOML editing strategy:** a small structural `navToml.js` module
   (parse block → mutate array → re-serialize → replace only that block's span).
   No third-party TOML library; comments and the rest of the file are preserved.

## Components

### 1. `scripts/navToml.js` (new) — structural nav editing

Pure functions, no network:

- `slugify(title)` → lowercase, trim, spaces/underscores→`-`, strip
  non-`[a-z0-9-]`, collapse repeated `-`, trim leading/trailing `-`.
- `titleCaseSegment(segment)` → split on `-`, capitalize each word, join with
  space (`annual-reports` → "Annual Reports").
- `parseNavBlock(tomlText, key)` → `{ items, start, end }`. Generalizes the
  current inline `parseNav` (find `key`, bracket-match the `[...]`, convert
  inline-table syntax to JSON, `JSON.parse`). `start`/`end` are char offsets of
  the array `[` … `]`. Returns `{ items: [], start: -1, end: -1 }` if absent.
- `serializeNav(items, { baseIndent = '' })` → TOML text matching the existing
  2-space-nested inline-table style.
- `insertPath(items, segments, leafName, value)` → mutates/returns `items`:
  walk segments, matching existing child section by slug or creating a new one
  (title-cased); insert or replace the leaf `{leafName: value}` at the deepest
  section. Empty `segments` ⇒ leaf at root.
- `removeByValue(items, value)` → remove the leaf whose value equals `value`;
  prune sections left empty. Returns mutated `items`.
- `findPathOfValue(items, value)` → `{ segments, leafName } | null` — used by
  publish/create-draft to mirror a page's location from one nav into the other.
- `replaceNavBlock(tomlText, key, items)` → new toml text with that block
  re-serialized in place; if the block does not exist yet, append
  `\n<key> = [ … ]\n` (needed when publishing a brand-new guide into `nav`).

`knowledgeBaseManagement.js` imports `parseNavBlock`/`slugify` and deletes its
local `parseNav`.

### 2. UI

**`config/forms/knowledgeBaseManagement.html`** — add to the existing bottom-right
`.more-buttons-form-actions`:
```html
<button type="button" class="more-buttons-button" data-kb-create-guide>+ Create a new guide</button>
```
Handled in the existing delegated click listener on `formEl.parentElement` →
`getFormAction('openCreateGuide')()`.

**`config/forms/createGuide.html`** (new; covered by the existing `config/forms/*`
manifest rule) — two horizontal form-groups (label left, per the form-layout
convention):
- **Title:** `<input type="text" name="guideTitle" required>`.
- **Path:** composite `.mb-path-field` wrapper containing an editable
  `<input type="text" name="guidePath" placeholder="guides/employees">` (flex-grow)
  and a greyed, non-editable `<span class="mb-path-suffix">/<slug>.md</span>` that
  updates live from the Title.
- Bottom-right action: `<button data-action="submitCreateGuide" data-validate>Create draft</button>`.

New CSS in `formsStyling.css`: `.mb-path-field` (styled as one input) and
`.mb-path-suffix` (muted colour, non-interactive).

### 3. Create-draft flow — `guides.js`

`registerFormAction('openCreateGuide')`:
- `createForm('createGuide')`; wire an `input` listener so typing in Title
  re-renders the `.mb-path-suffix` as `/${slugify(title)}.md`.

`registerFormAction('submitCreateGuide', async ({ formEl, content, cleanup }))`:
1. Read Title + Path. `slug = slugify(title)`; if empty, alert and abort.
   `value = 'pages/' + slug + '.md'`; `draftPath = 'docs/drafts/' + slug + '.md'`.
   `segments = path.split('/').map(s => s.trim()).filter(Boolean)`.
2. **Conflict check:** fetch `zensical.toml`; if `value` is present in parsed
   `nav` → block ("a live page with this name already exists"). Fetch draft via
   `readRepoText(draftPath)`; if non-empty → block ("a draft with this name
   already exists"). Re-enable button on block.
3. Write the draft file: `githubFetchAndPushFile(draftPath, onProgress,
   () => ensureSectionUUIDs('# ' + title + '\n'))` (H1 = title; UUID span injected
   so the tree renders and "Add new section" works).
4. Add to `draft_nav`: read toml → `parseNavBlock(toml, 'draft_nav')` →
   `insertPath(items, segments, title, value)` → `replaceNavBlock` →
   `githubFetchAndPushFile('zensical.toml', …, () => newToml)`.
5. Transition in-place to the editor:
   `getFormAction('openGuideEntry')({ filePath: value, label: title })`.

### 4. Sync `draft_nav` / `nav` in existing ops — `guides.js`

A shared helper `updateNavToml(mutate)` reads `zensical.toml`, applies a callback
that may mutate parsed `nav` and/or `draft_nav`, and writes the changed blocks
back through `githubFetchAndPushFile('zensical.toml', …)` (same `_opQueue`).

- **createGuideDraft** (existing live-page → draft): after writing the draft,
  `insertPath(draft_nav, …)` mirroring the page's location found via
  `findPathOfValue(nav, value)` (fall back to root leaf if not found).
- **publishGuideDraft:** after writing live + deleting the draft file, in one toml
  write: if `value` not already in `nav`, `insertPath(nav, …)` mirroring its
  `draft_nav` location; then `removeByValue(draft_nav, value)`.
- **discardGuideDraft:** after deleting the draft file, `removeByValue(draft_nav,
  value)`. `nav` untouched (existing live page stays live; a never-published new
  guide simply disappears).

`value` for these flows is derived from `currentGuide.livePath`
(`livePath.replace(/^docs\//, '')`).

### 5. Tree + pills — `knowledgeBaseManagement.js`

- Replace the `Promise.all([readRepoText('zensical.toml'), readRepoDir('docs/drafts'),
  readRepoDir('docs/pages')])` with a single `readRepoText('zensical.toml')`.
- Parse `nav` and `draft_nav`. Compute `navFiles` / `draftFiles` as sets of leaf
  values.
- **Guides panel:** merge nav's guide items (nav minus `Home`/`System`) with all
  `draft_nav` items into one tree — a merge-by-display-name-hierarchy that dedupes
  sections (same display name at the same level) and unions leaves by value.
  **System panel:** nav's `System` section only (unchanged).
- `decorateKbPills` matches by **file value** against `navFiles` (Live) and
  `draftFiles` (Drafting). `DRAFT_PILL_EXEMPT` retained as a safety net, though
  system pages are not added to `draft_nav`.

### 6. Manifest

Add `scripts/navToml.js` to `web_accessible_resources` scripts list.
`config/forms/createGuide.html` is already covered by the `config/forms/*` rule.

## Error handling

- Network/toml-write failures in any flow: `alert(...)`, re-enable the triggering
  button, leave state recoverable (the toml write is the last step in create, so a
  failure there leaves an orphan draft file — acceptable; re-running create warns
  on the existing draft).
- `parseNavBlock` returns empty items on malformed/missing blocks; mutators no-op
  gracefully; `replaceNavBlock` can create an absent block.
- Empty slug after slugify → blocked with a message.

## Testing

Unit tests (`tests/navToml.test.mjs`, Node, matching existing `.test.mjs` style):
- `slugify` and `titleCaseSegment` cases.
- `parseNavBlock` round-trips the sample nav/draft_nav; offsets correct.
- `insertPath`: matches existing section by slug; creates new title-cased section;
  empty path → root leaf; replacing an existing leaf.
- `removeByValue`: removes leaf and prunes empty parents; no-op when absent.
- `findPathOfValue` locates nested leaves.
- `replaceNavBlock`: preserves surrounding comments/keys; creates an absent block.

Network/DOM flows (button, form, create/publish/discard, tree merge, pills)
verified manually against the live repo.

## Out of scope

- System pages (`system-updates.md`, `system-status.md`) drafting — unchanged.
- Renaming/moving an existing guide's path after creation.
- Reordering nav entries.
