# Plan 2 Debug Map — Capture UUIDs & Component Reorder

> **For a fresh session debugging bugs the user found during manual browser verification.**
> Plan 2 is fully implemented + reviewed + committed on `main` (`140610c`…`cd0b802`, 19
> commits). Pure tests green (`node --test tests/formMerge.test.mjs` = 18,
> `tests/captureUuid.test.mjs` = 13); all touched scripts pass `node --check`. The bugs are
> UI/behavioral — found in the real extension, NOT caught by the pure tests (there is no DOM
> test harness). Use **superpowers:systematic-debugging** / the **diagnose** skill.
>
> Read first: the plan
> `docs/superpowers/plans/2026-06-07-kb-conflict-merge-2-capture-uuids-and-reorder.md`
> and the design spec `docs/superpowers/specs/2026-06-07-kb-form-conflict-merge-design.md`
> ("Plan 2 brainstorming decisions" addendum). The HANDOVER doc
> (`2026-06-07-kb-conflict-merge-2-reorder-HANDOVER.md`) has the "what shipped" + known
> follow-ups.

## How to verify / iterate
- Pure logic: `node --test tests/formMerge.test.mjs` (merge engine, incl. `orderedUuidList`)
  and `node --test tests/captureUuid.test.mjs` (capture parse/build/migrate + reorder helpers).
- DOM/wiring: `node --check scripts/<file>.js` (parse only — these import chrome/DOM).
- UI: manual browser (load unpacked extension). No automated DOM tests.
- Vanilla-ESM MV3, no build step. Every new `scripts/*.js` must be added to `manifest.json`
  `web_accessible_resources` individually — but Plan 2 added NO new script files.

## The componentOrder data-flow round-trip (the heart of reorder)
Trace this loop when a reorder bug appears:
1. **Render writes the field.** `renderComponents(listEl, components, numberSteps)`
   (`scripts/guides.js`) writes `listEl.closest('form') [name="componentOrder"].value =
   components.map(uuidOfComponent).join(',')` at the TOP (before the empty-state return), then
   wraps each card in `componentRow(uuid, isFirst, isLast, cardHtml)` (a `.mb-component-row`
   with a `.mb-component-rail` of `[data-move-component="up|down"]` buttons).
2. **Arrow click mutates the in-memory working copy.** `onComponentEditorClick` (guides.js)
   has a top branch catching `[data-move-component]` → `moveComponentInEditor(formEl, uuid,
   dir)` swaps a `.slice()` copy in `openComponentEditor.components`, re-renders (which
   re-writes the hidden field), and calls `formEl._refreshSaveState?.()`.
3. **Save merges.** The three savers call `mergeSave(...)` with a fieldSpec
   `{ name:'componentOrder', type:'orderedUuidList', label:'Component order' }`. `readFresh`
   returns `componentOrder: freshComponents.map(uuidOfComponent).join(',')`; the engine
   (`scripts/formMerge.js` `mergeOrderedUuidList`) merges your field vs fresh.
4. **Build reorders fresh.** `build(md, resolved)` does `reorderComponents(freshComponents,
   resolved.componentOrder.split(','))` — membership from FRESH, order from RESOLVED — then
   `buildComponentBody(containerUuid, description, ordered)`.
5. **Rehydrate writes back.** `mergeSave`'s `rehydrateFields` (`scripts/mergeSave.js`) on an
   `orderedUuidList` field sets the hidden input + calls `formEl._reorderRehydrate?.(uuidArray)`
   → `reorderOpenComponentEditor(order)` (exported from guides.js) re-renders in resolved order.

If any link breaks, the symptom localizes:
- order not persisting at all → step 1 (field not written) or step 4 (build not reordering).
- order lost on a concurrent edit → step 3/4 (membership-vs-order mix-up).
- on-screen order stale after save/merge → step 5 (`_reorderRehydrate` not attached/firing).
- arrows visible but do nothing → step 2 (working copy `components`/hook not attached at that
  mount site — see below).

## Mount sites (where the working copy + rehydrate hook attach)
Every editor that renders the rail MUST store `components` on `openComponentEditor` AND set
`_reorderRehydrate`. The wired sites:
- `guides.js`: `openEditGuideSection`, `openEditGuideAdmonition`, `transitionSectionCreateToEdit`,
  `transitionAdmonitionCreateToEdit` (all via `attachReorderState(formEl)`), and
  `rerenderOpenComponentEditor` refreshes `ed.components`.
- `systemUpdates.js`: `mountUpdateComponentsEditor` stores `components` + sets `_reorderRehydrate
  = order => reorderOpenComponentEditor(order)` (imported from guides.js).
A mount path that renders the rail without these → dead arrows / no-op rehydrate.

## numberSteps rule
Only `guide-section` numbers steps. `renderComponents`'s 3rd arg + `moveComponentInEditor` /
`reorderOpenComponentEditor` / `rerenderOpenComponentEditor` all derive it from
`container.kind === 'guide-section'`. Admonition + system-update pass `false`.

## The three savers (scalar + componentOrder)
- Section: `saveSectionForComponent` (guides.js) — fields `sectionTitle`, `sectionDescription`,
  `componentOrder`.
- Admonition: `persistAdmonitionEdit` (guides.js) — `admonitionType/Title/Meta/Collapsible/
  Description` + `componentOrder`. (`saveAdmonitionForComponent` create-branch unchanged.)
- System update / draft: `saveUpdateForComponent` (systemUpdates.js) — `updateTitle/Date/Type`,
  `description`, `componentOrder`; kind `'system-update'|'system-draft'` dispatches
  `replaceUpdateInMarkdown` vs `replaceDraftInMarkdown`. Gate handlers `submitEditSystemUpdate`
  + `saveDraftEditSystemUpdate` both route here.
- **Scalar-merge invariant:** fieldSpec `name` === form `name=` attr === `_initialSnapshot` key
  === `readFresh` key. A mismatch → phantom conflict every save OR a field that never merges.
  Date is normalized to ISO on BOTH sides (form `<input type=date>` is ISO; `parseUpdateBlocks`
  gives a display string → `readFresh` converts via `parseDateStr`). If updates phantom-conflict
  on date, check this normalization.

## Capture UUIDs (Part A)
- Span format: `<span data-uuid="…" style="display:none"></span>` on the line IMMEDIATELY
  before the light-mode image, same indent, NO blank line between (else it's not attributed).
- `locateCaptureLines` / `parseComponents` (read), `buildCaptureLines` (emit) in
  `scripts/components.js` + `scripts/captures.js`. `ensureCaptureUUIDs` migration runs ONLY at
  `createGuideDraft` (guides.js). New captures born with uuid in `commitCapturesIntoContainer`
  (captures.js).
- Capture edit/delete keyed by `cap.uuid` (cardRenderer.js `data-edit-component`,
  captureComponent.js). Dim edit routes through `mergeSave` (UUID-keyed scalar) in
  `submitEditCaptureComponent`.

## Resolver (conflict UI)
`scripts/conflictResolver.js` `showConflictResolver(formEl, conflicts, options)`:
- Renders inline into `formEl.parentElement` (NOT `formEl`). Per-field Keep theirs / Keep mine +
  a **Cancel** that rejects `ResolveCancelled` (mergeSave catches → restores save button,
  returns null).
- `renderSide` renders array values (order conflicts) as a numbered `<ol>`; captures show a
  thumbnail + "Capture", admonitions show title — via `options.describe(uuid)` (the savers
  build a `labelMap` from `noteLabels`). Unlabeled uuid → falls back to raw uuid (escaped).
- Scalar conflicts push string mine/theirs; orderedUuidList pushes ARRAYS. `theirsShown` is
  stored verbatim and compared in-kind.

## KNOWN gaps from the final review (check these against the user's symptoms FIRST)
1. **`publishDraftSystemUpdate` (systemUpdates.js) bypasses `mergeSave`** — rebuilds body from
   committed `draftMd` via `rebuildUpdateBody`. Reorder-a-draft-then-Publish-without-Save →
   the in-memory reorder is DROPPED. (Deliberately out of plan scope; the edit/draft-edit paths
   merge fine.)
2. **Legacy uuid-less captures** inside pre-existing `system-updates.md`/drafts aren't migrated
   until touched (`ensureCaptureUUIDs` only runs at guide-draft creation). `reorderComponents`
   preserves them but they're non-reorderable and migrate to the bottom on first order-save.
3. **Snapshot/render timing** — dirty baseline captured in the async storage callback after
   `componentOrder` is populated; opening a container shouldn't show false "unsaved". If it
   DOES, this ordering is the suspect.

## Plan deviations already made (so they're not "bugs")
- `mergeMine` in formMerge.js is position-based (insert new uuid after its nearest surviving
  fresh-predecessor), NOT the plan's count-based template (which was wrong). Locked by tests.
- Arrow-rail CSS uses theme tokens (`--mb-bg-input`/`--mb-text-muted`/`--mb-bg-subtle`) not the
  plan's hardcoded hex; `.mb-component-row > .mb-incident-card` resets `margin-bottom:0`. NOTE:
  in dark mode `--mb-bg-subtle` == `--mb-bg-input`, so rail-button hover shows no tint in dark
  mode (cosmetic).
