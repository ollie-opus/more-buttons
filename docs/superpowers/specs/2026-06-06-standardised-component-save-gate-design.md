# Standardised "save-to-add-component" across all KB component forms

**Date:** 2026-06-06
**Status:** Approved design (pending implementation plan)

## Problem

The knowledge-base editor uses a unified **Components** model: a *component* is an
admonition (`!!!`/`???` block) or a capture (paired light/dark images), held as an
ordered list inside a *container* (guide section, guide admonition, or system-update
block). Containers are immediate-save: a component is committed to the container's
markdown the moment it is added.

Behaviour is currently inconsistent across the forms that own these containers:

- **Guide sections / admonitions (create):** the Components list is *hidden* until the
  entity is first saved, because an immediate-save component needs a persisted parent to
  commit into. You must Save, then re-enter to add components.
- **Guide admonitions (create):** Save splices the admonition into its parent and
  `navigateBack`s — you cannot add sub-components during creation at all.
- **System updates (`logSystemUpdate`):** still uses the **legacy in-memory `captures[]`
  buffer** (`updateCapturesList`), with no Components list and no admonition support.

## Goal

Standardise all five component-bearing entity forms so that:

1. The Components list is **always visible** (create and edit).
2. Adding *or editing* a child component routes through **one shared gate** that, if the
   parent form is unsaved (create) or has unsaved field edits (dirty), prompts to save and
   then continues into the child flow.
3. `logSystemUpdate` is migrated off the legacy captures buffer onto the unified model,
   and the now-dead legacy code is removed.

## Scope — the complete inventory

Component-bearing **entity forms** (all change):

| Form | Container kind(s) | File |
|---|---|---|
| `editGuideSection` | `guide-section` | `docs/drafts/<name>.md` |
| `editGuideAdmonition` | `guide-admonition` | guide draft / update file |
| `logSystemUpdate` | `system-draft` (after save) | `docs/drafts/system-updates.md` |
| `editSystemUpdate` | `system-update` | `docs/pages/system-updates.md` |
| `editDraftSystemUpdate` | `system-draft` | `docs/drafts/system-updates.md` |

Capture **infrastructure forms** (unchanged): `captureLibrary`, `captureEntry`,
`captureNew`, `editCaptureComponent`. These are sources/editors of individual captures,
not entity forms.

## Decisions (confirmed with user)

1. **logSystemUpdate save target:** save as a **draft**, continue in `editDraftSystemUpdate`.
   The existing direct **"Log update"** (publish-to-live) button is retained for the
   no-component quick path; it is only reachable before any component is added.
2. **Gate scope:** unified — fires for brand-new (create) **and** already-saved-but-dirty
   forms. Replaces the existing "discard changes?" warning on child navigation.
3. **Popup timing:** the prompt fires **after** the Admonition/Capture type is chosen
   (inside the gate), not on the "+ Insert Component" click.
4. **Edit-existing child:** fully consistent — opening an existing child component for edit
   from a dirty/unsaved parent also save-and-continues (same gate).
5. **Legacy cleanup:** delete the dead legacy captures buffer in this change.

## Architecture

### The shared gate

A single entry point replaces the per-action wiring in `onComponentEditorClick`:

```
beginChildNavigation(formEl, action)
  // action describes what the user wants to do with a child:
  //   { type: 'insert', kind: 'admonition'|'capture-new'|'capture-library', insertAt }
  //   { type: 'edit-admonition', uuid }
  //   { type: 'edit-capture', index }
  ready = await ensureContainerReady(formEl)   // saves if needed; may navigate
  if (!ready) return                            // user cancelled
  runChildAction(ready.container, ready.formEl, action)
```

`ensureContainerReady(formEl) -> { container, formEl } | null`:

```
needsSave = formEl.dataset.mode === 'create' || isFormDirty(formEl)
if (!needsSave) return { container: containerFromForm(formEl), formEl }
msg = formEl.dataset.mode === 'create'
    ? `This ${noun} hasn’t been saved yet. Save it to continue?`
    : `You have unsaved changes. Save them to continue?`
if (!confirm(msg)) return null
return await formEl._componentSaver()   // persist; returns { container, formEl }
```

- `isFormDirty` is currently private in `form.js`; it will be **exported** (the existing
  `confirmDiscardIfDirty` / `resetDirtyBaseline` already are).
- `containerFromForm(formEl)` reads `{ kind: dataset.componentContainerKind,
  uuid: dataset.editUuid, file: dataset.containerFile }` — today's behaviour.

`runChildAction` dispatches to the existing flows, now always against a *saved* container:
- `insert/admonition`  → `openCreateGuideAdmonition({ container, insertAtIndex })`
- `insert/capture-new` → `runComponentCaptureFlow({ container, insertAt, formEl, overlay })`
- `insert/capture-library` → `runComponentLibraryInsert({ container, insertAt })`
- `edit-admonition` → `openEditGuideAdmonition({ uuid, file })`
- `edit-capture`    → `openEditCaptureComponent({ container, index, cap })`

### Per-form savers

Each opener attaches `formEl._componentSaver`. To avoid duplicating persistence, the
"persist" half of each existing submit handler is extracted into a reusable function; the
**Save button** = persist + navigate/transition, the **saver** = persist + return
`{ container, formEl }`. Each saver validates required fields first and returns `null`
(after an `alert`) on invalid input, aborting the child navigation.

| Form / mode | Saver behaviour |
|---|---|
| section, create | `insertSectionUnderParent` → flip to edit-in-place (logic already in `submitEditGuideSection` create branch) → `{ guide-section, newUuid }`, same formEl |
| section, dirty edit | rewrite section body (fields + existing components) → `resetDirtyBaseline` → container, same formEl |
| admonition, create | splice new admonition into its parent → **flip to edit-in-place** → `{ guide-admonition, newUuid }`, same formEl |
| admonition, dirty edit | rewrite admonition (fields + components) → rebaseline → container, same formEl |
| logSystemUpdate, create | validate → `saveNewDraft` → `openEditDraftSystemUpdate({ uuid })` → `{ system-draft, uuid }`, **new** formEl |
| editSystemUpdate / editDraftSystemUpdate, dirty edit | rewrite update body (fields + components) → rebaseline → container, same formEl |

Genuinely new transitions (everything else reuses existing code):
- **Admonition-create flips in place** on the gate path (today it `navigateBack`s). The
  plain Save button keeps `navigateBack` — only the gate introduces the in-place flip,
  mirroring how `editGuideSection` already transitions create→edit.
- **logSystemUpdate saves a draft then navigates** into the draft editor, and the child
  action continues against the now-mounted draft editor form.

### Components visible in create mode

- `openCreateGuideSection` / `openCreateGuideAdmonition`: stop hiding
  `[data-components-row]`; render an empty Components list (the "+ Insert Component" empty
  CTA). Delete remains hidden in create mode.
- `logSystemUpdate.html`: replace the legacy `#log-update-captures` block with a
  `[data-update-components]` Components list; `openLogSystemUpdate` renders it empty and
  wires the shared click delegation.

### Legacy captures buffer removal

After `logSystemUpdate` is migrated, these are dead and will be removed:
`captures[]`, `setExistingCaptures`, `resetCaptureState` (legacy callers),
`updateCapturesList`, `captureRowHtml`, `captureInsertZone`, `captureEmptyCta`,
`runCaptureFlow`, `runLibraryInsertFlow`, `completeLibraryInsert`'s legacy branch, and the
`captureMode.js` `updateCapturesList` re-render hook, plus `.mb-cap-insert` /
`#log-update-captures` CSS. `resolveCaptures` / `pushCaptures` are **retained** — they are
still used by the unified `commitCapturesIntoContainer` (and `captureNew`'s library save) —
but their now-unreachable callers in `systemUpdates.js`
(`publishNewUpdate`/`saveNewDraft`/`publishDraft` passing buffered captures) are simplified
to pass empty capture lists. The unified `runComponentCaptureFlow` /
`runComponentLibraryInsert` are retained.

> Note: `saveNewDraft` currently creates the draft *with* whatever captures were buffered.
> In the new model the draft is created from form fields only (no buffered captures), and
> components are added afterwards via the gate. Verify `buildUpdateBlock`/`insertDraftIntoMarkdown`
> still round-trips with an empty capture list.

## Edge cases

- **Empty/invalid form + add component:** saver validates first; on missing required
  fields it `alert`s and aborts (no entity created, no child flow).
- **Insert index after save:** create lists are empty → `insertAt` is 0; dirty-edit lists
  preserve components so the clicked index stays valid.
- **Capture flow form-stack snapshot:** taken inside `runComponentCaptureFlow` *after* any
  save/navigation, so it captures the correct (saved) form for replay.
- **Sub-admonition nesting:** a sub-admonition's container kind is `guide-admonition` in
  the same file; `locateGuideAdmonition` already recurses, so nested gate-saves work.
- **Cancel at the prompt:** nothing is persisted and no child flow opens; the form stays
  exactly as-is.

## Testing

- **Node round-trip:** `parseComponents` / `buildComponentBody` for an update block created
  draft-first with components added later (no `undefinedth undefined NaN` date regression —
  convert display date via `parseDateStr` before `buildUpdateBlock`).
- **Browser, per form:** create section → add admonition (prompts, saves, continues);
  create admonition → add sub-capture; dirty edit of each form → add component (prompts,
  saves field edits); dirty edit → edit existing child (prompts); logSystemUpdate → add
  component lands in draft editor; logSystemUpdate "Log update" direct-publish still works
  with no components.
- **Regression:** clean edit form → add/edit component proceeds with **no** prompt.

## Out of scope

- Capture infrastructure forms (`captureLibrary`/`captureEntry`/`captureNew`/
  `editCaptureComponent`) behaviour.
- Incident/status forms (no components).
- Reordering existing components (separate concern).
