# HANDOVER: Content Tabs component (3rd component kind)

**Status:** designed, not implemented. Research is complete — this doc contains the full design;
the implementing session should not need to re-derive any of it (verify line refs still hold, then build).

## The request (user's words, condensed)

Add a third component kind, **Content Tabs**, alongside admonitions and captures in the Components
form group. Target repo is a Zensical KB (https://zensical.org/docs/authoring/content-tabs/).
Content tabs work like admonitions: create/insert them, but the content is tabbed. **In each tab**:
a Title input (the tab label), a Description (rich editor), and a Components input (to nest
admonitions, captures, or more content tabs). No type/meta fields (don't apply). Use "the tabbed
styling we have on our side". Free to add other tab-form options that make sense (recommend: add
tab / delete tab / reorder tabs left-right).

## Zensical syntax

```
=== "Tab title"
    content indented 4 spaces

=== "Second tab"
    more content; tabs stack consecutively; nesting (admonitions, lists, tabs) allowed at +4 indent
```

## Already done this session (context)

- System-update description textareas now have `data-richtext` (logSystemUpdate.html,
  editSystemUpdate.html, editDraftSystemUpdate.html).
- Rich editor gained ordered/unordered list buttons: `toggleList` in markdownToolbarActions.js,
  `parseDoc`/`renderDocHtml`/`LIST_ITEM_RE` in markdownInline.js, list-aware
  `buildSource`/`locateOffset` in richEditorMapping.js, `LISTS` buttons in richTextEditor.js,
  tests in tests/markdownLists.test.mjs. All 12 test files pass (`for f in tests/*.test.mjs; do node $f; done`).

## Architecture map (verified this session)

- **components.js** — pure markdown⇄component-list model. `parseComponents(body, typeRegex, {skipTabBlocks})`
  → `{ description, components }` where each component is `{kind:'admonition',adm}` or `{kind:'capture',cap}`.
  `buildComponentBody(uuid, description, components)` is the inverse. `uuidOfComponent`, `reorderComponents`,
  `ensureCaptureUUIDs`. **Crucially `parseAdmonitions(..., {skipTabBlocks:true})` already skips `=== "..."`
  blocks** (admonitions.js:88-118), so admonitions inside tabs are already not mis-parsed as siblings.
- **admonitions.js** — the model to mirror for a new block kind: `parseAdmonitions`, `buildAdmonition`,
  `locateBlockByUUID` (find uuid span → walk up to header → walk down by indent), `replaceAdmonitionByUUID`,
  `deleteAdmonitionByUUID`, `ensureAdmonitionUUIDs`, `generateUUID`.
- **guides.js** — orchestrator. Key pieces:
  - `renderComponents(listEl, components, numberSteps)` (~line 763) renders cards + insert triggers;
    writes `[name="componentOrder"]` hidden field if present.
  - `onComponentEditorClick` (~line 868) — shared click delegation: move rails, edit buttons,
    `[data-insert-component-at]` → `openInsertMenu(anchor, idx, handlers)`.
  - Save-gate: `beginChildNavigation` → `ensureContainerReady` (saves via `formEl._componentSaver()` if
    create-mode or dirty) → `runChildAction(container, formEl, action)`. Container = `{kind, uuid, file}`
    derived from `formEl.dataset.componentContainerKind` + `dataset.editUuid` + `dataset.containerFile`.
  - `openEditorForComponent(container, component)` (~line 909) — kind-keyed dispatch; **insert must land
    in the editor** (project rule): new kinds add a branch here AND get a create-form (like admonitions).
  - `makeContainerHandler(readComponents, writeBody)` + `registerComponentContainer(kind, handler)` —
    handler.mutate(container, transform) commits one transform and re-renders the open editor.
  - `setOpenComponentEditor({formEl, listEl, container, components})`, `reorderOpenComponentEditor`,
    `moveComponentInEditor` (batch in-memory reorder; calls `formEl._refreshSaveState`).
  - `CONTAINER_NOUN` map (~line 812) for save-gate prompts.
  - Admonition editor (create→edit transition pattern): `openCreateGuideAdmonition`,
    `persistNewAdmonition` (splices into parent container at insertAtIndex via
    readContainerComponents/writeContainerBody), `transitionAdmonitionCreateToEdit`
    (`replaceCurrentOpener`, dataset flips, `resetDirtyBaseline`), `persistAdmonitionEdit` (mergeSave),
    `deleteGuideAdmonition`.
- **systemUpdates.js** — registers 'system-update'/'system-draft' container kinds with the same machinery.
- **componentContainers.js** — tiny registry decoupling capture flows from editors.
- **captures.js** — `runComponentCaptureFlow` / `runComponentLibraryInsert` /
  `openInsertedComponentEditor` → `getFormAction('openComponentEditor')`.
- **insertMenu.js** — `openInsertMenu(triggerEl, insertAtIndex, handlers)`; currently
  `{admonition, captureNew, captureLibrary}` handlers; menu HTML hardcoded.
- **captureComponent.js** — the model for a standalone component edit form module (registers form
  actions, reads container off formEl.dataset, uses `getComponentContainer`).
- **form.js** — `createForm(name)` loads `config/forms/<name>.html`. Has a **generic tab switcher
  already** (~line 450): clicks on `[data-tab]` inside `.more-buttons-tabs` toggle `--active` and show
  matching `[data-tab-panel]`. CSS: `.more-buttons-tabs/.more-buttons-tab-list/.more-buttons-tab[.--active]/.more-buttons-tab-panel`
  at formsStyling.css ~line 2059. This is "the tabbed styling on our side".
  Also: `FORM_LABELS` map (~line 38), storage hydration → `upgradeTextarea` on `textarea[data-richtext]`
  → dirty baseline snapshot → `bindSaveStateButton` (in chrome.storage.get callback, async — races
  caller code after `createForm` returns; callers end with explicit `resetDirtyBaseline(formEl)` like
  captureComponent.js:80). `readFormValues` only reads **named** inputs. `isFormReplay()` guards
  storage seeding. `replaceCurrentOpener(name, args)`.
- **github.js** — `migrateComponentIdentity(filePath, markdown)` (~line 57): the single identity
  backfill choke-point run on EVERY fetch+push; `fetchFileMigratingIdentity` for editor-open paths.
- **richTextEditor.js** — `upgradeTextarea`, `syncSurfaceFromTextarea(textarea)` (call after
  programmatically setting textarea.value).
- **mergeSave.js / formMerge.js / conflictResolver.js** — field-level conflict-aware save. Field specs
  are flat named-input scalars + 'orderedUuidList'; **doesn't fit a dynamic multi-tab form** (see Save model).
- **actions.js** — module registration: `import './captureComponent.js';` etc. New editor module must be
  imported here.
- **manifest.json** — every new scripts/*.js must be added to web_accessible_resources individually
  (project memory: omission → "Failed to fetch dynamically imported module"). `config/forms/*` is globbed ✓.

## Designed markdown model

A tab **group** is one component. Group identity = hidden span on the line immediately before the
first `===` (capture-style). Each **tab** has its own UUID span as the first body line (admonition-style),
making each tab an addressable component container for nesting:

```
<span data-uuid="GROUP-UUID" style="display:none"></span>
=== "Tab one"

    <span data-uuid="TAB1-UUID" style="display:none"></span>
    Tab one description…

    !!! note "Nested admonition"

        <span data-uuid="..." style="display:none"></span>
        …

=== "Tab two"

    <span data-uuid="TAB2-UUID" style="display:none"></span>
    …
```

Component shape: `{ kind: 'tabs', grp: { uuid, tabs: [{ uuid, title, body }] } }` (body dedented by 4).
`uuidOfComponent` → `c.grp.uuid`.

Disambiguating spans: a group span is a span line whose next non-blank line is a `=== "` header at the
same indent. A tab's own span is found by walking UP from the span line (skipping blanks) to a `=== "`
header. Admonition spans sit directly under `!!!`/`???` headers, so the three never collide.
`buildComponentBody` always emits a blank line between the container span/description and the first
component, which keeps `locateCaptureLines`'s "span on the line immediately before" rule from eating
a tab/admonition span.

## New files

1. **scripts/contentTabs.js** (pure, admonitions.js-style):
   - `TAB_HEADER_RE = /^(\s*)=== "(.*)"\s*$/`
   - `locateTabGroups(markdown)` → groups at indent 0 (used by parseComponents on dedented bodies);
     a group = optional preceding group-span line + consecutive `=== ` headers at that indent whose
     body lines are blank or indented ≥ indent+4 (mirror parseAdmonitions' body-walk + trailing-blank
     trim, and its skipTabBlocks sibling logic for nested groups).
   - `buildTabGroup(uuid, tabs)` — inverse; group span line, then per tab: header, blank, body
     reindented +4, blank between tabs. Tab body built by callers via `buildComponentBody(tabUuid, desc, comps)`.
   - `locateTabGroupByUUID(lines, uuid)` / `replaceTabGroupByUUID(md, uuid, newBlock)` /
     `deleteTabGroupByUUID(md, uuid)` — find group span line, extent = until a non-blank line at
     indent ≤ group indent that isn't a tab header of the group; reindent newBlock to match.
   - `locateTabByUUID(lines, uuid)` → `{headerLine, endLine, headerIndent, title}` (span → up to
     nearest `===` skipping blanks; down by indent+4) — works at ANY nesting depth on the raw file.
   - `ensureTabUUIDs(markdown)` — backfill group spans + per-tab spans, reverse-order splice,
     idempotent (mirror ensureCaptureUUIDs/ensureAdmonitionUUIDs).
2. **scripts/contentTabsEditor.js** (form wiring; imports from guides.js like systemUpdates.js does —
   registry lookups avoid cycles):
   - Registers container kind **'content-tab'** (uuid = TAB uuid):
     `readTabComponents(md, tabUuid)` → locate tab, dedent body, `parseComponents(body, GUIDE_ADMONITION_TYPES_RE)`
     (its own span is stripped by extractDescription, same as admonition bodies);
     `writeTabBody(md, tabUuid, description, components)` → `buildComponentBody(tabUuid, …)`, reindent +4,
     splice under header. Register via `makeContainerHandler`.
   - Registers form actions `openCreateContentTabs({container, insertAtIndex})`,
     `openEditContentTabs({uuid, file})`, `submitEditContentTabs`, `deleteContentTabs`.
3. **config/forms/editContentTabs.html** — `data-nav data-dirty-guard`,
   `data-storage-key="moreButtonsEditContentTabs"`, 90vw/90vh. Contains: h2 `[data-content-tabs-heading]`;
   tab strip `.more-buttons-tabs > .more-buttons-tab-list` rendered dynamically into
   `[data-ct-strip]` (use the existing `.more-buttons-tab` classes but **custom data attrs**
   `data-ct-tab="i"` / `data-ct-add` — do NOT use `data-tab`, form.js's generic switcher would fight
   the dynamic strip); per-tab management row (move-left / move-right / delete-tab buttons); ONE
   active panel: Title `<input data-ct-title>` (**no name**), Description
   `<textarea data-ct-description data-richtext>` (**no name**), Components `div[data-tab-components]`;
   `<input type="hidden" name="tabsState">` (the ONLY named field — see state model); standard
   `.more-buttons-form-actions` with save (`data-save-state`) + delete buttons.
4. **tests/contentTabs.test.mjs** — parse/build round-trips, replace/delete by uuid, ensureTabUUIDs
   idempotence, nested groups, parseComponents integration (tabs interleaved with admonitions+captures,
   description extraction), buildComponentBody('tabs') round-trip.

## Editor state & save model (the key decisions)

- **Single active panel, JS state array.** `formEl._ct = { groupUuid, tabs: [{uuid, title, description, order?}], active }`.
  Tab switch: stash active fields into state → load target tab's title/description into the inputs
  (set `textarea.value` then `syncSurfaceFromTextarea(textarea)`) → re-read file md and render that
  tab's components → `setOpenComponentEditor({formEl, listEl, container:{kind:'content-tab', uuid:tab.uuid, file}, components})`
  → set `formEl.dataset.editUuid = tab.uuid` (so containerFromForm targets the ACTIVE tab; keep the
  GROUP uuid in `formEl.dataset.groupUuid` for save/delete).
- **Dirty tracking via one hidden `tabsState` input** holding
  `JSON.stringify({tabs: state.tabs})` refreshed on every title/description input, tab add/remove/reorder,
  and component reorder. Visible inputs are UNNAMED so `readFormValues` never sees per-tab values
  (otherwise switching tabs would false-dirty the form). No `componentOrder` named input for the same
  reason — instead store per-tab order in `state.tabs[i].order`. Hook component reorders by wrapping
  `formEl._refreshSaveState` AFTER `bindSaveStateButton` ran (or set the wrapper before; bindSaveStateButton
  overwrites `_refreshSaveState`, so wrap on first use or after the storage callback — captureComponent's
  end-of-open `resetDirtyBaseline` pattern shows the timing): sync order from the open editor's
  `components` into state + tabsState, then call the original.
  Seed `chrome.storage.local.set({ moreButtonsEditContentTabs: { tabsState } })` in openers when
  `!isFormReplay()` (capture-mode round-trips restore in-flight edits); on open, initialise state from
  storage if present, else from markdown.
- **Save = whole-group last-write-wins, components preserved per tab** (mergeSave's flat field model
  can't represent a dynamic tab list; document this as a known v1 limitation): via
  `githubFetchAndPushFile(file, onProgress, md => …)`:
  - create: build group (each tab body = `buildComponentBody(tabUuid, desc, [])`), splice into parent
    container at `insertAtIndex` via `readContainerComponents`/`writeContainerBody` with
    `{kind:'tabs', grp}` — exactly `persistNewAdmonition`'s shape; then
    `transitionTabsCreateToEdit` (replaceCurrentOpener('openEditContentTabs', {uuid: groupUuid, file}),
    dataset.mode='edit', resetDirtyBaseline) — mirrors `transitionAdmonitionCreateToEdit`.
  - edit: read fresh md; for each state tab that still exists, re-read its CURRENT components from
    fresh md (`readTabComponents`), apply `reorderComponents(components, state.tabs[i].order)`;
    new tabs → empty components; rebuild group in state order; `replaceTabGroupByUUID`. Deleted tabs
    drop with their components (confirm() on delete-tab).
  - `_componentSaver` returns `{ container: {kind:'content-tab', uuid: ACTIVE tab uuid, file}, formEl }`
    so the save-gate's child flows (insert capture/admonition/nested tabs into the active tab) work.
- **Delete group**: confirm → `githubFetchAndPushFile(file, …, md => deleteTabGroupByUUID(md, groupUuid))`
  → `navigateBack()` (mirror deleteGuideAdmonition).

## Integration edits (existing files)

- **components.js**: `parseComponents` — also collect indent-0 tab groups (excluding ranges inside
  admonitions, and extend `inAnyRange` exclusion the other way: captures/admonitions inside group
  ranges are already excluded by indent/skipTabBlocks). `buildComponentBody` — `kind==='tabs'` branch
  → `buildTabGroup`. `uuidOfComponent` — tabs branch. (Import from contentTabs.js — keep contentTabs.js
  leaf-level, no import cycle: contentTabs.js must NOT import components.js; group bodies are opaque
  strings at that layer.)
- **guides.js**: card branch in `renderComponents` → `tabsComponentCard(grp)` (mb-incident-card,
  colour `--cyan`-ish, badge "Tabs", title "Content tabs", description = tab titles joined " · ",
  Edit button `data-edit-content-tabs="<uuid>"`); `onComponentEditorClick` — handle
  `[data-edit-content-tabs]` → `beginChildNavigation(formEl, {type:'edit-tabs', uuid})`;
  `runChildAction` — `insert kind:'tabs'` → `getFormAction('openCreateContentTabs')({container, insertAtIndex})`,
  `edit-tabs` → `getFormAction('openEditContentTabs')({uuid, file: container.file})`;
  insert-menu handlers gain `contentTabs: (i) => beginChildNavigation(formEl, {type:'insert', kind:'tabs', insertAt:i})`;
  `openEditorForComponent` — `kind==='tabs'` branch (insert→editor rule);
  both `noteLabels` labelMap builders (~line 1029 and ~line 1319) — add tabs branch
  `{kind:'admonition', title:'Content tabs'}` (else they CRASH on `c.cap.uuid`);
  `CONTAINER_NOUN` — `'content-tab': 'tab'` (and set `dataset.componentNoun='tab group'` on the tabs
  form for a better gate prompt).
- **systemUpdates.js**: its `noteLabels` (~line 180) — same tabs branch (crash otherwise).
- **insertMenu.js**: add `<button data-pick="content-tabs">Content tabs</button>` + pick routing →
  `handlers.contentTabs?.(insertAtIndex)`.
- **github.js**: `migrateComponentIdentity` — add `ensureTabUUIDs` to BOTH branches (system-updates
  files and guide markdown), so pre-existing `=== ` blocks become editable.
- **form.js**: `FORM_LABELS.editContentTabs = 'Edit Content Tabs'`.
- **actions.js**: `import './contentTabsEditor.js';`
- **manifest.json**: add `scripts/contentTabs.js`, `scripts/contentTabsEditor.js`.
- **formsStyling.css**: small additions — add-tab button in the strip, tab-management row; reuse
  `.more-buttons-tab` classes for the strip itself. Active strip label should live-update from the
  Title input (input listener re-renders the strip).

## Gotchas / rules to respect

- Insert must land in the component's editor (project rule; the create-form IS the editor, like admonitions).
- `renderComponents(listEl, comps, numberSteps=false)` for tabs (steps don't number outside sections).
- `sectionStepNumber` and card preview helpers already skip non-admonition kinds safely; the labelMap
  builders do NOT (fix per above).
- Storage hydration is async (chrome.storage.get callback) — opener code after `createForm` may run
  before or after it; do your own `await chrome.storage.local.get(...)` for state init and finish the
  opener with `resetDirtyBaseline(formEl)`.
- `parseAdmonitions(..., {skipTabBlocks:true})` consumes sibling tab headers at the SAME indent as one
  group — match that grouping in locateTabGroups.
- User leans robust/structural over quick fixes (memory note) — but whole-group LWW save is the agreed
  v1 trade-off; call it out in the final summary.
- Run the suite after: `for f in tests/*.test.mjs; do node "$f"; done` (all pass as of this handover).
