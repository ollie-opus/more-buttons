# KB tree: reorder & move guides/sections

**Date:** 2026-06-23
**Status:** Approved design — ready for implementation plan

## Problem

The Knowledge Base management form renders a tree of guides built from the `nav`
and `draft_nav` arrays in `zensical.toml`. Today you can change *which path* a
guide lives in (via the **Path** text field in edit page settings), but you
**cannot change the order** of guides within a path — the tree just reflects the
array order in the toml, and nothing in the UI lets you resequence it.

This design adds in-tree reordering and folds cross-section moves into the same
UI, replacing the page-settings Path field as the single way to relocate an
existing guide.

## Scope

In scope:
- Reorder any guide **or** folder among its siblings.
- Move any guide or folder to a different section (reparent), including creating
  a new section by typing a path (parity with today's Path field).
- Batch all edits into a single commit.
- Remove the **Path** field from *edit page settings*.

Out of scope (v1):
- Reworking `mergeNavNodes` for full live/draft interleaving (see "Order
  authority" below). Draft-only pages keep today's "appended after live
  siblings" behaviour.
- Renaming or deleting sections from this UI (creating a section via "type a new
  path" is the only structural section operation).
- Changing the *create new guide* flow — it keeps its own path picker so new
  guides still land in the right place.

## Interaction

The Guides tree rows gain controls on their right edge:

```
  ▾ Employees                        [↑][↓] [↦ Move…]
    ▒ Registering an Employee        [↑][↓] [↦ Move…]
    ▒ Offboarding                    [↑][↓] [↦ Move…]
    ▒ Payroll setup                  [↑][↓] [↦ Move…]

  ┌────────────────────────────────────┐
  │  ● Unsaved changes   [Discard] [Save] │
  └────────────────────────────────────┘
```

- **Arrows** (`↑`/`↓`) move the row up/down among its current siblings. Disabled
  at the ends (top sibling has no `↑`, last has no `↓`). Both guides and folders
  reorder.
- **Move…** opens a small picker anchored to the row:
  - A radio list of existing sections, labelled by full path
    (`Guides`, `Guides/Employees`, `Guides/Contractors`, …).
  - A "Type a new path…" field that creates the section(s) on save — same
    semantics as today's Path field (slug match on existing segments,
    title-cased display name for new ones via `insertPath`).
  - Choosing a target reparents the row (and its subtree, for folders) to the
    end of that section in the local tree.
- **Controls are always visible** (not hover-only) for accessibility and touch.
- Clicking the row **label** keeps today's behaviour (open guide entry / toggle
  folder). The controls are separate `<button>`s that `stopPropagation()` so they
  never trigger the row's open/toggle handler.

All edits mutate a **local working copy** of the tree and re-render instantly —
no network per move. A footer bar appears only while the working copy differs
from the loaded toml:
- **Save** commits everything in one push.
- **Discard** drops the working copy and re-renders from the loaded toml.

The save runs behind the existing centered `formLoading` veil (consistent with
the loading-states-always-centered convention — no inline spinners).

## Save model

This is the careful part: tree order is currently *derived* by `mergeNavNodes`
(within a section: live-only pages first in `nav` order, then drafted pages in
`draft_nav` order). We make the edited tree the desired structure and **reproject
it back into both arrays** at save time.

### On load
Capture, from the single `zensical.toml` fetch already performed in
`renderKnowledgeBaseManagement`:
- the parsed `nav` items and `draft_nav` items;
- `liveValueByBase`: map of `baseOf(value) → exact nav value string`;
- `draftValueByBase`: map of `baseOf(value) → exact draft_nav value string`;
- the merged display tree (existing `mergeNavNodes` + prune path), which becomes
  the editable working copy for the Guides panel.

### On save
For each array (`nav`, then `draft_nav`):
1. **Project** the edited guide tree onto that array's membership: include a leaf
   only if its `baseOf(file)` is present in that array's value map; set its value
   to the **exact string** from the map (never reconstruct a `pages/`/`drafts/`
   prefix). Recurse into folders; **prune folders left empty** after filtering.
2. **Splice** the projected guide sections back into the original array,
   preserving non-guide anchors:
   - Top-level entries in `EXCLUDED_SECTIONS` (`Home`, `System`) — and, for
     `draft_nav`, any entry whose page is not part of the displayed guide tree
     (e.g. a System draft) — are **anchors**: never moved, reordered, or dropped.
   - The projected guide sections fill the slots originally occupied by guide
     sections, in the user's new order. (Guide sections are normally a contiguous
     block, e.g. `Home`, …guides…, `System`; the implementation treats non-guide
     top-level entries as fixed anchors and fills the remaining positions with
     the reordered guide block. New sections created via "type a new path" extend
     the guide block; sections that project to empty drop out of that array.)
3. Rewrite the block with `replaceNavBlock(md, key, projected)`.

Both blocks are rewritten in a **single** `githubFetchAndPushFile('zensical.toml',
…)` commit.

### Order authority
`nav` is the order authority — the published order readers see matches what you
set. `draft_nav` is reprojected with the **same relative order** for the siblings
it shares, so the two never disagree. Because `mergeNavNodes` is unchanged, a
page that exists **only** as a draft still renders appended after live siblings;
it is reorderable among other draft-only pages but cannot sit above a live page
until published. This is the accepted v1 limitation.

### Why this is safe
The prior nav/draft_nav data-loss bug came from value invention / stale
placement. This model:
- reuses **exact** value strings from the loaded toml (no fabrication);
- only writes a node into an array if it was **already a member** of that array;
- treats `Home`/`System` and other non-guide entries as untouchable anchors;
- writes both blocks atomically in one commit.

## Code layout

- **`scripts/navToml.js`** — add pure helpers (no network):
  - reproject the edited tree onto a `{ base → value }` membership map, pruning
    empty folders;
  - small sibling operations used by the controller (move up/down within a
    siblings array; reparent a node to a target path, creating sections as
    `insertPath` does).
  - These get unit tests.
- **`scripts/kbReorder.js`** *(new)* — the working-copy controller: holds the
  editable tree, applies move-up/down/reparent, tracks dirty state, builds the
  save payload (calls the `navToml.js` reprojection helpers for both arrays).
  Keeps `knowledgeBaseManagement.js` lean.
  **Must be added to `manifest.json` `web_accessible_resources`** (scripts are
  listed individually; omission breaks the dynamic import of `actions.js`).
- **`scripts/kbTree.js`** — `renderNode` gains a `reorderable` option that emits
  the `↑`/`↓` and `Move…` controls (with the right `data-` hooks and
  end-disabled state). Default off, so other `renderTree` callers are unaffected.
- **`scripts/knowledgeBaseManagement.js`** — render the Guides panel with
  `reorderable: true`; in the existing delegated click handler on
  `formEl.parentElement`, route arrow / Move… / Save / Discard clicks to the
  `kbReorder` controller; render and toggle the unsaved-changes footer bar; call
  the batched save behind `formLoading`. System panel stays read-only (not
  reorderable).
- **`config/forms/editPageSettings.html`** — remove the **Path** input.
- **`scripts/guides.js`** — remove the Path read/prefill in `openEditPageSettings`
  and the path write in `submitEditPageSettings` (drop the
  `setPathByValueSlug` / `draft_nav` rewrite that field drove). Leave the rest of
  page settings (icon, hide toggles) intact.

## Testing

Pure-function tests (no network), in `tests/`:
- **Round-trip:** parse `nav`/`draft_nav` → merge → reproject unchanged →
  serialize byte-stable (no spurious diff).
- **Reorder within a section:** moving a leaf up/down reorders the matching
  entries in `nav`, and mirrors order into `draft_nav` for drafted siblings.
- **Reparent:** moving a guide to another section relocates it in both arrays;
  creating a new section via a typed path produces a title-cased section node;
  empty source sections are pruned.
- **Membership filtering:** a live-only page is written to `nav` only; a
  draft-only page to `draft_nav` only; a page in both to both — values are the
  exact loaded strings.
- **Anchors preserved:** `Home`/`System` and other non-guide top-level entries
  keep their position and are never dropped, even after reordering/moving guide
  sections.
- **Folder move:** moving a folder relocates its whole subtree's entries in both
  arrays.

Manual smoke (Chrome for Testing, per the project's render-verify convention):
reorder a few guides, move one across sections, create a section via typed path,
Save, confirm a single clean `zensical.toml` commit and that the tree reloads in
the new order; confirm Discard reverts; confirm edit page settings no longer
shows a Path field and the guide is still relocatable via Move….
