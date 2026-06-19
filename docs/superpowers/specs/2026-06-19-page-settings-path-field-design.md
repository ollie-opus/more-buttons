# Page settings: Path field

**Date:** 2026-06-19
**Status:** Approved, ready for implementation plan

## Goal

Add a **Path** input to the KB guide **Page settings** form, above the existing
Icon input. It mirrors the Path field in the Create Guide form: the value is the
guide's folder location in the toml nav tree (e.g. `guides/employees`). Editing
and saving it moves the guide's `draft_nav` entry to the new folder in
`zensical.toml`.

The filename (`<slug>.md`) is fixed — only the folder path moves.

## Scope decision: `draft_nav` only

Saving the path moves the guide's leaf in **`draft_nav` only**, not `nav`.

- **Draft-only guide** (created via Create Guide, not yet published): there is no
  `nav` entry, so moving `draft_nav` is complete and clean. This is the common case.
- **Published-and-re-drafted guide**: the live `nav` leaf stays in its old folder.

### Known limitation (accepted)

For a guide that is already published *and* being re-drafted, moving only
`draft_nav` causes divergence:

- The KB tree (`mergeNavNodes`, `knowledgeBaseManagement.js`) merges `nav` +
  `draft_nav` leaves by filename **only within the same folder**. A guide whose
  draft moved to a different folder than its live entry will appear **twice** —
  once in the old folder, once in the new — and pill decoration (`decorateKbPills`)
  keys on basename globally, so both copies show both Live and Drafting pills.
- Publish does **not** reconcile this: `publishGuideDraft` (`guides.js:376`) only
  inserts into `nav` when the value isn't already present there, so the live entry
  stays at the old location permanently until an H1-title rename or a manual toml
  edit moves it.

This is acceptable for the current need (the field is primarily for organising
in-progress drafts). Documented here so it isn't mistaken for a bug.

## Components

### 1. Form markup — `config/forms/editPageSettings.html`

Add a Path field **above** the Icon field, mirroring `createGuide.html`'s
`.mb-path-field` structure:

```html
<div class="more-buttons-form-group">
  <label class="more-buttons-label">Path</label>
  <div class="mb-path-field">
    <input type="text" name="path" placeholder="guides/employees" autocomplete="off" />
    <span class="mb-path-suffix" data-path-suffix>/…md</span>
  </div>
</div>
```

The field is optional — an empty path means the guide sits at the nav root.

### 2. Prefill on open — `openEditPageSettings` (`guides.js`)

When the form opens for `currentGuide`:

- Read `zensical.toml`, parse `draft_nav`, and locate the guide via
  `findPathByValueSlug(draftItems, slug)` where
  `slug = guideBaseName(currentGuide.livePath)` (the filename slug, e.g. `foo`).
- Seed the stored form value with the existing folder path:
  `moreButtonsEditPageSettings: { icon: …, path: (loc?.segments ?? []).join('/') }`.
- After `createForm`, set the suffix span to the real filename so the user sees
  what will not change: `formEl.querySelector('[data-path-suffix]').textContent = '/' + slug + '.md'`.

The toml read happens in the same `!isFormReplay()` guard that currently seeds the
icon, so replays don't re-fetch.

### 3. Save on submit — `submitEditPageSettings` (`guides.js`)

After the existing icon `mergeSave` succeeds (gated on its `resolved` result, like
the H1-rename in `saveSectionForComponent`), perform a best-effort `draft_nav`
reconciliation:

- Read the `path` input value; split on `/`, trim, drop empties → `newSegments`.
- Parse `draft_nav`, locate the current entry via `findPathByValueSlug(draftItems, slug)`.
- Compare `newSegments` to `loc.segments` by `slugify`. If identical, **skip the
  write entirely** (no empty-diff commit).
- Otherwise:
  - `removeByValueSlug(draftItems, slug)`
  - `insertPath(draftItems, newSegments, loc?.leafName ?? guideBaseName(currentGuide.livePath), draftNavValueOf(currentGuide.livePath))`
  - `replaceNavBlock(md, 'draft_nav', draftItems)` and push via `githubFetchAndPushFile`.
- The display name (`leafName`) is preserved from the located entry; the leaf value
  is normalised to the canonical `drafts/<slug>.md`.
- Wrap the toml step in its own `try/catch` with a non-fatal alert (e.g. "Icon
  saved, but updating the path failed: …. Re-saving retries it."), mirroring the
  H1-rename pattern — the icon save must not be rolled back if the path push fails.

### 4. No manifest / import changes

Only existing files are touched. `editPageSettings.html` is already registered.
The required `navToml.js` exports (`findPathByValueSlug`, `removeByValueSlug`,
`insertPath`, `slugify`) are already imported in `guides.js`.

## Files touched

- `config/forms/editPageSettings.html` — add Path field.
- `scripts/guides.js` — prefill in `openEditPageSettings`; save in `submitEditPageSettings`.

## Testing

- **Draft-only guide, set a path:** create a guide, open Page settings, enter a
  folder path, save → `draft_nav` entry moves to that folder; tree shows it there.
- **Re-save same path:** no new commit (empty-diff skip).
- **Clear the path:** guide moves to nav root.
- **Prefill:** reopening Page settings shows the current folder path and the real
  `/<slug>.md` suffix.
- **Icon + path together:** both persist; a failing toml push surfaces a non-fatal
  alert and leaves the icon saved.
