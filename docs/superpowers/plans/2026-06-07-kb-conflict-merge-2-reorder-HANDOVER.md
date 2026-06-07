# Handover → KB Conflict Merge Plan 2+: Capture UUIDs & Component Reordering

> **Paste this whole file's path (or contents) into a fresh session to begin.**
> It is self-contained. Start by reading the referenced spec, then brainstorm,
> then write the plan(s), then execute with subagent-driven-development.

## What you're being asked to build

The **up/down arrow reordering of components** (capture/admonition cards) on the KB
parent forms — and the **capture-UUID work it depends on**. This is steps **4 and 5** of
the rollout in the design spec:

`docs/superpowers/specs/2026-06-07-kb-form-conflict-merge-design.md`

Read that spec in full first. The directly relevant sections:
- **"Reordering components (batch model)"** (~line 139)
- **"Capture identity (UUIDs) — a prerequisite"** (~line 164)
- **"Engine: pluggable field types"** (~line 199)
- **"Rollout order"** (~line 274) — steps 4 and 5 are your scope.

## Why reorder is not a quick UI add

Component **order is parent-owned form state**. A naive "write my order" would delete
components other sessions added and resurrect ones they deleted — the exact
last-write-wins clobbering that this whole effort exists to kill. The spec is firm:
*"Reorder ships with this merge so it cannot reintroduce clobbering"* (spec:162), and the
merge is *"foundational and lands before reorder"* (spec:181). So order must go through the
merge engine as an `orderedUuidList` field — which in turn requires **every component to
have a stable UUID**. Captures currently don't (they're addressed by list index), hence the
capture-UUID prerequisite.

---

## Plan 1 — DONE (what you can build on)

Plan 1 (`docs/superpowers/plans/2026-06-07-kb-conflict-merge-1-engine-and-section.md`,
rollout steps 1–2) is implemented, reviewed, and committed on `main`
(commits `3dd2cba` → `76a5d25`). It delivered the reusable machinery:

- **`scripts/formMerge.js`** — pure engine.
  `mergeFields(snap, cur, fresh, fieldSpecs, resolutions) → { resolved, conflicts }`
  and `class ConflictNeeded`. fieldSpec shape: `{ name, type, label }`.
  **Only the `scalar` strategy exists** (equality is `===`). The engine does **not yet
  branch on `spec.type`** — you must add an `orderedUuidList` strategy and a type switch.
  Unit-tested in `tests/formMerge.test.mjs` (8 tests, `node --test`).
- **`scripts/conflictResolver.js`** — `showConflictResolver(formEl, conflicts) →
  Promise<{ [field]: 'mine'|'theirs' }>`. Renders an inline panel into
  `formEl.parentElement`, one row per conflict, resolves when every field has a choice.
  Copy is device-neutral; buttons read **"Keep theirs (current)" / "Keep mine
  (overwrite)"**. Row currently shows raw `mine`/`theirs` values — for an order conflict
  those are UUID lists, so you'll likely want a friendlier render (component titles). It
  is self-styled inline (no CSS-file dependency).
- **`scripts/mergeSave.js`** — the descriptor-driven save loop:
  `mergeSave({ formEl, file, fieldSpecs, readFresh, build, onProgress })`.
  Reads baseline from `formEl._initialSnapshot`, loops `githubFetchAndPushFile`, throws/
  catches `ConflictNeeded`, records `resolutions[field] = { choice, theirsShown }`, retries,
  then `rehydrateFields` + `resetDirtyBaseline`.
  **`rehydrateFields` only handles scalar inputs (radio/text) today.** For reorder it must
  also: write the resolved order into the hidden `componentOrder` field **and re-render the
  component cards in the resolved order**. This is the main orchestrator extension point.
- **`scripts/form.js`** — `readFormValues` is now exported.
- **`scripts/guides.js`** — `saveSectionForComponent` edit-mode branch routes through
  `mergeSave` with fields `[sectionTitle, sectionDescription]` (both scalar). This is your
  **reference example** of wiring a form into the engine. Note: `readFresh` strips
  components via `parseComponents(...).description` so it matches how the textarea was
  hydrated — see gotcha #3.
- **`manifest.json`** — the three new scripts are registered (see gotcha #1).
- **`scripts/github.js`** — robustness fixes you should preserve and follow:
  all contents-API reads now go through `contentsReadUrl()` (a per-call `&_cb=` cache-bust)
  with an explicit `Accept: application/vnd.github+json`; and the PUT is skipped when the
  built markdown equals the current file (no empty commits). Reason in gotcha #2.

The airtight save flow (merge runs **inside** the `githubFetchAndPushFile` builder against
the same fetch the PUT commits with) is in the spec under "Airtight save flow". Reuse it
via `mergeSave` — don't reinvent.

---

## Step 4 — Capture UUIDs (do this first; it's a self-contained slice)

**Problem.** Captures are addressed by **list index**, not identity:
- `scripts/captureComponent.js` — `formEl.dataset.componentIndex`, then `components[index]`
  inside the mutation (`const c = components[index]; if (!c || c.kind !== 'capture') return`).
- Capture markdown carries **no `data-uuid`**; the dark filename is *derived* from the light
  one (`-light-mode` → `-dark-mode`).

This causes (1) a **latent wrong-target bug today**: if another session inserts/deletes/
reorders a component above this capture between open and save, the index points elsewhere;
the `kind !== 'capture'` guard saves admonitions but you can silently edit the **wrong
capture's** dimensions. And (2) `orderedUuidList` can't track captures across snap/cur/fresh
without a UUID.

**Resolution — give captures UUIDs, mirroring section/admonition.**
- **Format:** a hidden span on the line immediately *preceding* the light-mode image line,
  same indent, folded into the capture's line range:
  ```
  <span data-uuid="…" style="display:none"></span>
  ![](../assets/foo-light-mode.png#only-light){ width="800" }
  ![](../assets/foo-dark-mode.png#only-dark)
  ```
- **Migration:** `ensureCaptureUUIDs(markdown)` — idempotent, reverse-order splice, the same
  shape as `ensureAdmonitionUUIDs` (`scripts/admonitions.js:395`) and `ensureSectionUUIDs`
  (`scripts/sections.js`). Run it from the **same migration point those already use** — find
  where `ensureSectionUUIDs`/`ensureAdmonitionUUIDs` are invoked (the draft-creation /
  on-first-touch path) and add capture migration alongside.
- **Parse/build:**
  - `locateCaptureLines(body)` (`scripts/components.js:52`) — detect and return the adjacent
    span, extending `startLine` to include it.
  - `parseComponents(body, …)` (`scripts/components.js:83`) — carry `cap.uuid`.
  - `buildCaptureLines(list)` (`scripts/captures.js:24`) — emit the span.
  - `buildComponentBody(uuid, description, components)` (`scripts/components.js:152`) — uses
    `buildCaptureLines` already; should round-trip the span unchanged.
- **Addressing switch:** `editCaptureComponent` (`scripts/captureComponent.js`) and the
  capture mutation in `scripts/componentContainers.js` / `scripts/captures.js` locate by
  `cap.uuid`, not `index`. This fixes the wrong-target bug **and** lets capture
  `dimMode`/`dimValue` become a normal UUID-keyed **scalar** merge — wire the
  `editCaptureComponent` save through `mergeSave` exactly like `saveSectionForComponent`.

**Testable as pure logic:** `ensureCaptureUUIDs`, `locateCaptureLines`, `parseComponents`,
`buildCaptureLines` round-trips → `node --test` with the repo's custom `test()` idiom (see
`tests/formMerge.test.mjs` for the idiom). The `editCaptureComponent` rewiring is DOM/network
→ `node --check` + manual browser.

> Step 4 ships value on its own (kills the wrong-target bug + gives captures a scalar merge),
> so it's a clean standalone plan even before reorder.

---

## Step 5 — Batch reorder (depends on step 4)

- **UX:** up/down arrows on each component card; reorder happens **in memory**; the order is
  pushed when the **parent form** is saved.
- **Representation:** a hidden `name="componentOrder"` field holding comma-joined UUIDs,
  updated on each arrow click. Because it's a normal named input, the existing
  `_initialSnapshot` / `readFormValues` machinery tracks it automatically as a field.
- **New engine strategy `orderedUuidList`** in `formMerge.js`:
  - **Membership** is always reconciled from `fresh` — other sessions' adds/deletes always
    win, never a conflict (this is what protects a concurrently-added component).
  - **Order** is three-way merged on the relative sequence of surviving UUIDs:
    - you didn't reorder → take fresh order
    - only you reordered → your order, filtered to fresh membership, with fresh-new UUIDs
      slotted in at their fresh position
    - both reordered differently → **one** conflict entry: *"Component order changed…"*
      (Keep mine = your relative order of known components, new ones slotted in, deleted
      dropped)
  - Add a `spec.type` switch in `mergeFields` (currently scalar-only) + unit tests.
- **Write:** the saver builds components in the resolved order — reorder the **fresh-read**
  component list by the resolved UUID sequence; component **content stays fresh** as always.
- **Orchestrator:** extend `mergeSave`'s `rehydrateFields` to handle `orderedUuidList` —
  set the hidden `componentOrder` field to the resolved order **and re-render the cards** in
  that order.
- **Resolver:** an order conflict is one field (`componentOrder`, label "Component order").
  Its `mine`/`theirs` are UUID lists — render them as component **titles/labels**, not raw
  UUIDs, or the panel is unreadable.
- **Host forms** (parent forms that own components, so they get arrows + `componentOrder` +
  order-aware writes): **guide section, admonition, system-update, draft system-update.**
  The capture-component form is a leaf (no children) — not a reorder host. Note this overlaps
  rollout **step 3** (extend scalar merge to those same forms); doing step 3 for a form and
  adding its reorder together is reasonable — a brainstorming call.

---

## Gotchas / lessons from Plan 1 (read before coding)

1. **Manifest is mandatory.** Every new `scripts/*.js` (e.g. a new `captures`/strategy module
   if you split one out) must be added to `manifest.json` `web_accessible_resources`
   individually (not globbed), or dynamic import fails at runtime with *"Failed to fetch
   dynamically imported module"*. (Editing existing files needs no manifest change.)
2. **github.js read pattern.** Reads use `contentsReadUrl()` (cache-bust) + explicit
   `Accept: application/vnd.github+json`. This fixed a real, confirmed bug: `github.js`'s
   GET shared its URL with `repoClient.js`'s **raw** reads (`Accept: …github.raw`), and the
   browser served the raw variant to the JSON GET — ignoring `Vary: Accept` *and*
   `cache: 'no-store'` — so `.json()` threw *"…is not valid JSON"* on raw markdown. If you
   add new reads, follow the `contentsReadUrl` + explicit-Accept pattern.
3. **`readFresh` must match the hydration representation.** If a form field is hydrated from
   a *transformed* value, `readFresh` must apply the same transform, or you get spurious
   conflicts every save. We hit this: the section description textarea is hydrated with
   `parseComponents(...).description` (components stripped), so `readFresh` must strip too.
   For `componentOrder`, ensure the hidden field's hydrated value and `readFresh`'s value are
   the **same normalization** (same surviving-UUID set, same join).
4. **Form actions live on `formEl.parentElement`** (the overlay-content wrapper), not on
   `formEl`. The conflict resolver prepends to `host = formEl.parentElement`. Put the card
   container / arrow handlers consistently (delegate on the parent where the project does).
   See project memory "Form actions moved out of form".
5. **`mergeSave` owns `resetDirtyBaseline`** and the no-op-push skip means resolving every
   field as "keep theirs" makes **no commit**. Don't double-call `resetDirtyBaseline`.
6. **One shared save-gate.** All component forms save through a single gate via
   `_componentSaver` / `beginChildNavigation` (see project memory "Components merge" —
   captures + admonitions are one "Components" group, markdown-as-truth, immediate-save).
   Reorder saves must go through the same gate, not a side channel.
7. **Testing seams.** Pure logic (`orderedUuidList` strategy, `ensureCaptureUUIDs`,
   parse/build round-trips) → `node --test tests/*.test.mjs` with the custom `test()` helper +
   `node:assert/strict`. DOM/wiring → `node --check`. UI → manual browser. There is no DOM
   test harness.
8. **Engine fieldSpec is `{ name, type, label }`.** `orderedUuidList` specs use the same
   shape. Add the `type` dispatch in `mergeFields` — Plan 1 reviewers flagged that the engine
   ignores `spec.type` today (it's the documented extension point).

---

## Recommended process for the fresh session

This is feature work with open UX/design decisions, so **don't jump to code**:

1. **`superpowers:brainstorming`** — settle: arrow placement & disabled-at-ends behaviour;
   how the order conflict is displayed (titles vs UUIDs); whether to split into **Plan 2
   (capture UUIDs)** + **Plan 3 (reorder)** or one plan; whether to fold rollout step 3
   (scalar merge for admonition/system-update) into the host-form work.
2. **`superpowers:writing-plans`** — write the plan file(s) under
   `docs/superpowers/plans/`, checkbox steps, pure-logic-first (failing test → impl), TDD for
   the engine strategy and migration.
3. **`superpowers:subagent-driven-development`** — execute as Plan 1 was: fresh subagent per
   task, two-stage review (spec compliance → code quality) between tasks, commit per task.

## Plan 2 — DONE (capture UUIDs + component reorder)

Plan 2 (`docs/superpowers/plans/2026-06-07-kb-conflict-merge-2-capture-uuids-and-reorder.md`,
rollout steps 4–5) is implemented, reviewed (two-stage spec + code-quality per task, plus a
final whole-implementation review), and committed on **`main`** (`140610c`…`2d03962`, 18
commits). All 16 tasks (A1–A8, B1–B8) done. Pure suites green: `tests/formMerge.test.mjs`
(18) + `tests/captureUuid.test.mjs` (13); all 9 touched scripts pass `node --check`; no new
script files (no manifest change).

**What shipped:**
- **Part A — capture UUIDs:** hidden `data-uuid` span before the light image;
  `locateCaptureLines`/`parseComponents`/`buildCaptureLines` read/carry/emit it;
  `ensureCaptureUUIDs` migration (idempotent, any-indent) runs at draft creation; new captures
  born with a UUID; capture edit/delete addressed by `cap.uuid` (wrong-target bug fixed);
  capture dim edits route through `mergeSave` (UUID-keyed scalar).
- **Part B — reorder:** `orderedUuidList` strategy in `formMerge.js` (`spec.type` dispatch);
  hidden `componentOrder` field + vertical arrow rail on each card; in-memory batch reorder;
  order-aware merge writes through the **section, admonition, and system-update** savers
  (admonition + system-update also gained their scalar merge = rollout step 3); resolver
  **Cancel/abort** + numbered-list/thumbnail rendering of an order conflict.
- The prior follow-up **"Resolver has no cancel/abort path"** is now **resolved** (Task B3).

**Open follow-ups from the final review (not blockers; decide before/with any next plan):**
- **`publishDraftSystemUpdate` bypasses `mergeSave`** (Important). It rebuilds the body from
  committed `draftMd`, so an **uncommitted in-memory reorder is dropped if the user reorders a
  draft system-update then clicks Publish without first clicking Save.** The edit/draft-edit
  paths route through `saveUpdateForComponent`/`mergeSave` correctly; only the draft→publish
  transition doesn't (deliberately left as-is per the plan). Fix: flush the save-gate before
  publish, or read order from the in-memory working copy.
- **Legacy uuid-less captures in `system-updates.md`/drafts** (Minor). `ensureCaptureUUIDs`
  only runs at `createGuideDraft`; pre-feature captures inside system updates stay uuid-less
  until touched. `reorderComponents` preserves them (no data loss), but they are
  non-reorderable and migrate to the bottom on the first order-affecting save.
- **Snapshot/render timing** (Minor, deterministic in practice): the dirty baseline is captured
  in the async storage callback after `componentOrder` is populated, so opening a container
  shouldn't show false "unsaved changes" — worth a manual confirm.

**Manual test matrix still owned by the user** (B8 step 3): reorder persists in section /
admonition / system-update; two-tab divergent reorder → resolver numbered list + capture
thumbnails, Keep mine / Keep theirs / Cancel; reorder-then-child-navigate flushes via the
save-gate; the publish-without-save case above; legacy uuid-less captures; capture
wrong-target fix; capture dim merge across tabs; system-update list order (by date) never
altered by component reorder.

## Status / housekeeping

- Plan 1 code + fixes are on **`main`** (`3dd2cba`…`76a5d25`). Decide a branch strategy
  before Plan 2 if you don't want to keep building on `main`.
- Plan 1 Task 7 (manual browser verification) was being done by the user; the motivating
  scenarios (clean non-conflicting merge, true title conflict + resolver, the raw-variant
  save bug) passed. Remaining Task-7 checks if you want full coverage: "components untouched
  by a title edit" and "edit-vs-delete guard".
- **Final whole-implementation review is done.** It found one real bug — `rehydrateFields`
  didn't re-render the rich-text *surface* (only the hidden textarea), so a merged
  description could be silently re-clobbered on the next keystroke. **Fixed** via
  `syncSurfaceFromTextarea` (commit `a5e0f67`). Two follow-ups were left open and you may
  want to fold them into Plan 2/3:
  - **Resolver has no cancel/abort path** (minor): `showConflictResolver` only resolves once
    every field is chosen; if the user abandons the form mid-resolution the `mergeSave`
    `await` never settles and the save button stays busy. Add a Cancel that rejects, and have
    `mergeSave` restore the save-state button. This matters more once reorder adds an
    order-conflict row.
  - **`parentChanged` from a pre-read** (low severity, accepted): computed before the fresh
    fetch; a concurrent section move could make it stale. `moveSectionToParent` is ~idempotent
    so it's noted, not fixed.
- Unrelated uncommitted working-tree changes exist (`background.js`,
  `scripts/captureElement.js`, `scripts/captureMode.js`) — not part of this effort; leave
  them alone.
