# Concurrency-safe saves: three-way field merge for KB forms

**Date:** 2026-06-07
**Status:** Approved design (pending implementation plan)

## Problem

Knowledge-base forms push markdown to the GitHub repo with no protection against
concurrent edits. With 3–5 people editing through the extension, two sessions can edit
the same unit and silently overwrite each other.

Concrete failure (the motivating scenario):

1. Tab 1 opens a guide section, changes the **title**, saves to draft.
2. Tab 2 (opened *before* tab 1 saved) changes the **description**, saves and publishes.
3. Tab 2's save rebuilds the whole section from its **stale form state** — old title +
   new description — so tab 1's title change is lost.

The existing GitHub blob-`sha` + 409-retry in `githubFetchAndPushFile`
(`scripts/github.js`) does **not** catch this: tab 2 fetches fresh, gets tab 1's title,
then overwrites it with its own form value, all under a valid `sha`. No 409 fires. The
conflict is at the *logical field* level, not the *file* level.

## Why not a lock?

A pessimistic lock (an `app_locks`-style table) was considered and rejected. It requires
a shared, strongly-consistent, atomic store, which this architecture lacks — there is **no
backend**; the source of truth is GitHub markdown files, and the only other state is
per-profile Chrome local storage. The only cross-user lock store would be a repo lock
file, which inherits problems strictly worse than the conflicts it would prevent:

- **No reliable release.** Acquire on form-open, release on form-close — but "close"
  includes tab close, browser crash, sleep, network drop, extension reload. The web
  platform has no dependable "I'm leaving" signal, so locks leak.
- **Leaked locks force a TTL**, which is conflict-detection by another name, and a TTL
  shorter than an edit session expires mid-edit → conflict anyway → needs a heartbeat →
  periodic commits → repo-history churn + API rate-limit burn.
- **Eventual consistency** (the reason `scripts/staleSuppression.js` exists) allows
  double-acquire, defeating the purpose.
- **Coarse granularity** (guide-level) blocks unrelated edits; a "force unlock" escape
  hatch re-opens the conflict door.

A leaked lock fails *worse* than a missed merge (locked out of your own content vs. a
prompt). The optimistic merge needs no new infrastructure, so it is the chosen approach.

## Core insight: the dirty snapshot *is* the per-field baseline

The form framework already captures `formEl._initialSnapshot` at form-open — a flat
`{fieldName: value}` map in the exact shape `readFormValues` produces, re-baselined after
each save by `resetDirtyBaseline` (`scripts/form.js`). `isFormDirty` already does the
per-field comparison. So we need **no new baseline storage** and **no baseline-markdown
re-parsing**. Three values per field at save time:

- `snap` = `formEl._initialSnapshot[field]` — baseline (what you loaded)
- `cur`  = `readFormValues(formEl)[field]` — your current edit
- `fresh` = the field parsed out of the freshly re-fetched markdown

We parse markdown only for `fresh`, and only for the fields we actually merge.

## The merge rule (per field)

The merge runs in **edit mode only**. A create-mode save mints a brand-new UUID and
cannot collide with anything, so it is never merged — this applies uniformly to creating
a section, an admonition, a system update, and an incident.

| condition | meaning | action |
|---|---|---|
| `cur === snap` | you didn't touch it | **take `fresh`** (keep theirs) |
| `cur !== snap` and `fresh === snap` | only you changed it | **take `cur`** (keep yours) |
| `cur !== snap` and `fresh === cur` | both made the same edit | take `cur` (no-op) |
| `cur !== snap` and `fresh !== snap` and `fresh !== cur` | both changed differently | **conflict** |

## What is and isn't merged

**Merged (scalar fields):** section title/description; admonition title/meta/type/
collapsible/description; system-update title/date/type/description; incident fields;
capture dimension mode/value; each system-status **service status**.

**Not merged — handled by the existing fresh-read + UUID-splice pattern:**

- **Component content and membership.** Parent forms (section, admonition, update) do not
  own their child components — the saver re-reads them from fresh `md` and splices by
  UUID, so a concurrent add/edit/delete is never clobbered. Each component is itself a
  unit edited through its own saver, so it gets the scalar merge in its own right.
- **Section parent / structural moves.** Existing `parentChanged` path is unchanged.
- **Create-mode saves.** A brand-new unit gets a fresh UUID and cannot conflict.

**Component *order*** becomes merged once the reorder feature ships — see "Reordering".

## Airtight save flow (no TOCTOU window)

The merge runs **inside** the `githubFetchAndPushFile` builder, against the *same* fresh
fetch the PUT commits with. There is no separate pre-flight read and therefore no
read-then-write window.

```
saver(formEl):
  resolutions = {}                          # field -> { choice, theirsShown }
  loop:
    try:
      githubFetchAndPushFile(file, onProgress, freshMd => {
        fresh   = descriptor.readFresh(freshMd, uuid)     # {field: value}
        snap    = formEl._initialSnapshot
        cur     = readFormValues(formEl)
        { resolved, conflicts } = mergeFields(snap, cur, fresh, descriptor.fields, resolutions)
        if conflicts.length: throw new ConflictNeeded(conflicts)
        return descriptor.write(freshMd, uuid, resolved)  # build markdown from resolved
      })
      break                                  # success
    catch ConflictNeeded(conflicts):
      choices = await showConflictResolver(formEl, conflicts)   # inline UI, awaits user
      fold choices into resolutions          # records theirsShown = the value displayed
```

- A field with a recorded resolution counts as resolved on re-run **unless** `fresh` moved
  to yet another value since it was shown (`fresh[field] !== resolutions[field].theirsShown`
  and `!== chosenValue`) — then it re-enters `conflicts` and re-prompts.
- The existing 409 retry re-runs the same builder → re-runs the merge → consistent.
- Net guarantee: **no silent last-write-wins**, ever.

## Conflict resolver UI

Rendered inline into the form (not a separate overlay), one row per conflicting field:

```
⚠ "Title" changed in another tab since you opened this:
     theirs: Install on Linux
     mine:   Installing on Linux
   [ Use theirs ]   [ Keep mine ]
```

- Save stays blocked until every conflicting field has a choice; then the save re-runs
  with those choices folded in.
- Cleanly-merged fields are never shown.
- After any field resolves to **theirs** (clean auto-merge *or* explicit choice), the
  corresponding input is re-hydrated to the merged value and `resetDirtyBaseline` is
  called, so the form stops displaying a stale value and the next save compares correctly.

## Reordering components (batch model)

Up/down arrows on each component card reorder **in memory**; the order is pushed when the
parent form is saved. This makes order **parent-owned form state**, so it must go through
the merge — a naive "write my order" would delete components other tabs added and resurrect
ones they deleted.

- **Representation:** order is held in a hidden field `name="componentOrder"` (comma-joined
  UUIDs), updated on each arrow click, so the existing `_initialSnapshot` / `readFormValues`
  machinery tracks it automatically as a normal field.
- **Field type `orderedUuidList`:**
  - **Membership** is always reconciled from `fresh` — adds/deletes by other sessions
    always win, never a conflict (this is what protects a concurrently-added component).
  - **Order** is three-way merged on the relative sequence of the surviving UUIDs:
    - you didn't reorder → take fresh order
    - only you reordered → your order, filtered to fresh membership, with fresh-new UUIDs
      slotted in at their fresh position
    - both reordered differently → **one** conflict entry: "Component order changed in
      another tab — Use theirs / Keep mine" (Keep mine = your relative order of known
      components, new ones slotted in, deleted ones dropped)
- **Write:** the saver builds components in the resolved order — reorder the fresh-read
  component list by the resolved UUID sequence; component *content* stays fresh as always.

Reorder ships **with** this merge so it cannot reintroduce clobbering.

## Capture identity (UUIDs) — a prerequisite

Captures are the one component **without stable identity**: they are addressed by list
**index** (`captureComponent.js` — `componentIndex` / `components[index]`), and the capture
markdown carries no `data-uuid` span (the dark filename is even *derived* from the light
one via `-light-mode`→`-dark-mode`). This breaks two things:

1. **A latent wrong-target bug, today.** `editCaptureComponent` saves by re-reading fresh
   components and indexing `components[index]`. If another session inserts/deletes/reorders
   a component above this capture between open and save, that index points elsewhere. The
   `c.kind !== 'capture'` guard prevents corrupting an admonition, but if the item now at
   that index is *also* a capture, you silently edit the **wrong capture's** dimensions.
2. **Reorder cannot be correct on mixed lists.** A container's component list interleaves
   admonitions and captures, and `orderedUuidList` reconciles membership/order **by UUID**.
   With no UUID on captures, the strategy can't track them across snap/cur/fresh.

**Resolution — give captures UUIDs, mirroring the section/admonition pattern.** This is
foundational and lands **before** reorder, not as an optional extra.

- **Format:** a hidden `data-uuid` span on the line immediately preceding the light-mode
  image line, at the same indent, folded into the capture's line range:
  ```
  <span data-uuid="…" style="display:none"></span>
  ![](../assets/foo-light-mode.png#only-light){ width="800" }
  ![](../assets/foo-dark-mode.png#only-dark)
  ```
- **Migration:** `ensureCaptureUUIDs(markdown)` backfills existing captures on first touch —
  idempotent, reverse-order splice, same approach as `ensureAdmonitionUUIDs` /
  `ensureSectionUUIDs`. Run from the same migration point those already use.
- **Parse/build:** `locateCaptureLines` detects and returns the adjacent span (extending
  `startLine`); `parseComponents` carries `cap.uuid`; `buildCaptureLines` emits the span.
- **Addressing switch:** `editCaptureComponent` and the `componentContainers` capture
  mutation locate by `cap.uuid`, not index — fixing bug (1) and making capture
  `dimMode`/`dimValue` a normal UUID-keyed scalar merge.

## Engine: pluggable field types

`scripts/formMerge.js` exposes one engine with per-field-type strategies:

- `scalar` — equality is value equality; merge per the table above.
- `orderedUuidList` — equality/merge as described under Reordering.

```
mergeFields(snap, cur, fresh, fieldSpecs, resolutions) -> { resolved, conflicts }
  fieldSpecs: [{ name, type, label }]
  conflicts:  [{ field, label, mine, theirs }]
  resolved:   { fieldName: value }
```

Adding a future field type is a new strategy, not an engine rewrite.

## Scope — the complete inventory

Merge applies to **edit mode** only (see the merge-rule note); create-mode rows below are
listed as "create: none" for completeness.

| Form / saver | File | Merged fields |
|---|---|---|
| `editGuideSection` → `saveSectionForComponent` | `scripts/guides.js` | edit: title, description · create: none |
| `editGuideAdmonition` → `saveAdmonitionForComponent` | `scripts/guides.js` | edit: title, meta, type, collapsible, description · create: none |
| `editSystemUpdate` / `editDraftSystemUpdate` → `saveUpdateForComponent` | `scripts/systemUpdates.js` | title, date, type, description |
| `logSystemUpdate` → `saveLogUpdateForComponent` | `scripts/systemUpdates.js` | create-mode (no merge); transitions to draft edit |
| incidents `reportIncident` (create) / `updateIncident` | `scripts/systemStatus.js` | create: none · update: description, status, reported, resolved, causation |
| service-status toggles → `publishSystemStatus` | `scripts/systemStatus.js` | each service's status, keyed by service name |
| `editCaptureComponent` | `scripts/captureComponent.js` | dimMode, dimValue (UUID-keyed — requires capture UUIDs) |
| parent forms with components (section, admonition, update, draft-update) | as above | `componentOrder` (`orderedUuidList`) once reorder ships |

**Out of scope:** the same-browser "open in another tab" advisory nudge (the merge already
handles same-browser tabs; a `BroadcastChannel` nudge is pure polish and can be added
later, independently). Locking, in any form. Positional merge beyond `orderedUuidList`.

## Edge cases

- **Edit vs. delete:** if the unit was deleted by another session while you edited, the
  existing `locateSectionByUUID`/`locate…` guard returns "no longer exists" and aborts the
  save. Keep this behaviour; improve the message to name the unit and state that the edit
  could not be saved.
- **System updates share one file** (`docs/drafts/system-updates.md`): different blocks are
  isolated by UUID splice; same-block fields by the merge; file-level contention by the
  existing `sha` + 409 retry. Composes without new work.
- **Publish** (draft → live) is a whole-draft copy; the draft is already the merged source
  of truth, and concurrent publishes of the same guide are covered by file-level `sha`.

## Files

**New:**

- `scripts/formMerge.js` — engine: `mergeFields`, `scalar` + `orderedUuidList` strategies,
  `ConflictNeeded`.
- `scripts/conflictResolver.js` — renders the inline resolver into a form; returns a
  promise of `{field: 'mine'|'theirs'}`.

> Both new scripts **must** be added to `manifest.json` `web_accessible_resources`
> (listed individually, not globbed), or dynamic import fails.

**Changed:**

- `scripts/guides.js`, `scripts/systemUpdates.js`, `scripts/systemStatus.js`,
  `scripts/captureComponent.js` — add a per-form descriptor (mergeable fields +
  `readFresh` + `write`) and route each saver through the engine + resolver.
- `scripts/components.js`, `scripts/captures.js` — capture UUID support:
  `locateCaptureLines` reads/returns the span, `parseComponents` carries `cap.uuid`,
  `buildCaptureLines` emits it, plus an `ensureCaptureUUIDs` migration.
- `scripts/captureComponent.js` + `componentContainers` capture mutation — address
  captures by `cap.uuid` instead of list index.
- Parent component forms — add reorder arrows, the `componentOrder` hidden field, and
  order-aware writes.
- Small helper to normalise the system-update display date to ISO on both `fresh` and form
  sides so they compare as equal.

## Rollout order

1. **Engine + resolver** (no wiring): `formMerge.js`, `conflictResolver.js`, manifest
   entries.
2. **Wire `scalar` merge into `editGuideSection`** — proves the full loop end-to-end
   against the motivating scenario.
3. **Extend scalar** to admonition, system-update/draft/log, incident-update,
   per-service status.
4. **Capture UUIDs** (foundational): span format, `ensureCaptureUUIDs` migration,
   parse/build, and the `editCaptureComponent` index→UUID switch. Then wire capture
   `dimMode`/`dimValue` into the scalar merge.
5. **Batch reorder**: arrows UI + `componentOrder` field + `orderedUuidList` strategy +
   order-aware writes on the parent forms (depends on step 4 for capture identity).
