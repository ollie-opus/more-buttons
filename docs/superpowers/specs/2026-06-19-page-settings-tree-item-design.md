# Page settings tree item — design

## Goal

Give the guide entry form a standalone "Page settings" tree node, rendered as a
separate block **above** the existing section tree. Clicking it opens its own
form (the same way clicking the Title node opens the section editor). The
**Icon** input moves out of the Title section form into this Page settings form.

The icon continues to live in the file's frontmatter (page-level, owned by the
H1 today). Conceptually it belongs to the page, not the H1 section — so a Page
settings home is cleaner, and it leaves room for more page-level settings later.

## Layout

```
┌─────────────────────────────┐
│  ⚙ Page settings            │   separate .mb-kb-tree block (rendered first)
└─────────────────────────────┘

┌─────────────────────────────┐
│  📄 Title: <guide title>     │   existing section tree
│     └ Section 1: …           │
└─────────────────────────────┘
```

Page settings only appears when a draft (and therefore a title) exists.

## Changes

### 1. Tree render — `scripts/guides.js`

In `renderGuideEntryContent`, prepend a separate `.mb-kb-tree` block above the
section tree HTML. The block holds one `.mb-kb-node`:

- icon: `tune` (material-symbols-outlined)
- label: `Page settings`
- button attribute: `data-edit-page-settings` (no uuid needed)

A small helper `renderPageSettingsNode()` returns the block. `contentEl.innerHTML
= pageSettingsHtml + treeHtml`.

### 2. Click handler — `onGuideEntryClick`

Add a branch for `[data-edit-page-settings]` that shows `formLoading`, dispatches
`getFormAction('openEditPageSettings')?.({ file: formEl.dataset.draftPath })`,
and dismisses the veil in `.finally` — mirroring the existing
`data-edit-guide-section` branch.

### 3. New form — `config/forms/editPageSettings.html`

```html
<form data-nav data-dirty-guard id="edit-page-settings-form"
      data-storage-key="moreButtonsEditPageSettings" data-width="90vw" data-height="90vh">
  <h2>Page settings</h2>

  <div class="more-buttons-form-group">
    <label class="more-buttons-label">Icon</label>
    <input type="text" name="icon" placeholder="Search lucide icons…" autocomplete="off" />
  </div>

  <div class="more-buttons-form-actions">
    <button type="button" class="more-buttons-button success"
            data-action="submitEditPageSettings" data-validate data-save-state
            data-saved-label="Draft saved" data-unsaved-label="Save to draft">
      <span class="more-buttons-icon">outbound</span>Save to draft
    </button>
  </div>
</form>
```

No delete, no components. Extensible: more page settings = more form-groups +
more entries in the save field specs. `config/forms/*` is globbed in the
manifest, so no manifest change is needed.

### 4. New actions — `scripts/guides.js`

`openEditPageSettings({ file })`:
- `adoptGuideFromDraftPath(file)`; bail if no `currentGuide`.
- read draft markdown; if not a replay, store `{ icon: readFrontmatterIcon(md) }`
  under `moreButtonsEditPageSettings`.
- `createForm('editPageSettings')`; set `formEl.dataset.containerFile`.
- `attachIconPicker(formEl.querySelector('[name="icon"]'))`.
- optional: `setCrumbLabel('Page settings')`.

`submitEditPageSettings({ formEl, content })`:
- `mergeSave({ file: currentGuide.draftPath, fieldSpecs: [{ name: 'icon', type:
  'scalar', label: 'Icon' }], readFresh: md => ({ icon: readFrontmatterIcon(md) }),
  build: (md, resolved) => writeFrontmatterIcon(md, (resolved.icon ?? '').trim()) })`.
- drive the save-state button via `setButtonBusy`, matching
  `submitEditGuideSection`.

### 5. Remove icon from the section form

- `config/forms/editGuideSection.html`: delete the `data-section-icon-row` group.
- `openEditGuideSection`: remove the `sectionIcon` storage line and the H1-only
  icon-row reveal + `attachIconPicker` lines.
- `saveSectionForComponent`: remove the `sectionIcon` field spec, its `readFresh`
  entry, and the `writeFrontmatterIcon` line in `build`. H1 save no longer
  touches the icon.

The H1 → `zensical.toml` nav rename on title save is untouched.

## Out of scope

Only the icon moves now. No additional page settings are added in this pass.
