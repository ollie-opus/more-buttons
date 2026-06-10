# Form Loading Tile — Design

**Date:** 2026-06-10
**Status:** Approved

## Problem

In multi-form flows (knowledge base forms, component editing), there is a visible
dead gap between triggering a form navigation and the destination form appearing.
Example: inserting a capture component into a section via the library — after
picking the capture, the chain (replay parent form stack → commit into markdown →
`openEditCaptureComponent` → storage set → `createForm` → 2× GitHub blob fetches)
takes 1–2s on a slow connection with no feedback. The old form just sits there,
still clickable.

There is no full-form loading state today — only scattered per-container
`"Loading…"` paragraphs (`.more-buttons-description`) and the `.busy` button
spinner used during saves.

## Decision

Centralize a loading tile in the form infrastructure (Approach A), so **all**
form-to-form navigations get it automatically — no per-form work, future forms
included.

### Key constraint

During a form-to-form action the old form must stay intact in the DOM — action
handlers read its fields (e.g. `saveSectionForComponent`). The loading tile
therefore **layers on top** of the existing overlay; it never replaces or mutates
the current form's content.

## Mechanism

All form button actions funnel through the delegated click handler in
`scripts/form.js` (~line 743). Entire multi-step chains (library insert → parent
replay → editor open) run inside that one click's promise.

1. **`showLoadingTile()` / `dismissLoadingTile()`** — module-level singleton in
   `form.js` (a second `show` while one is pending/visible is a no-op).
   - `showLoadingTile()` arms a **200ms grace timer**; only when it fires is the
     tile appended to `document.body`. Fast actions never flash it.
   - The tile: a `.more-buttons-overlay` containing
     `.more-buttons-overlay-content.more-buttons-loading-tile` with a spinning
     `.more-buttons-icon--spin` icon and "Loading…" text. No intro animation.
   - `dismissLoadingTile()` cancels the pending timer and/or removes the tile.
2. **Dispatcher wrap**: the action loop at form.js:743 calls `showLoadingTile()`
   before the steps loop and `dismissLoadingTile()` in a `finally` — safety net
   for actions that throw or never open a form.
3. **`createForm` handoff**: `createForm()` calls `dismissLoadingTile()`
   immediately after `content.innerHTML = formHtml` (~line 444), so the new form
   becomes interactive as soon as it exists. Slower sub-content (capture preview
   blobs) falls back to its existing in-container "Loading…" labels.

### Bonus behavior

The tile's full-screen backdrop blocks clicks on the old form mid-action, which
prevents double-dispatch that is currently possible.

## CSS

One small block in `config/forms/formsStyling.css`:
`.more-buttons-loading-tile` — same 540px max-width as a form tile, modest
min-height (~200px), centered spinner + muted text so the swap to the real form
isn't jarring.

## Error handling

Dismissal lives in the dispatcher's `finally`: a thrown action removes the tile
and leaves the old form visible and usable, same as today.

## Out of scope

- Programmatic form opens that don't pass through the click dispatcher (e.g.
  popup-triggered root opens) — the helpers are exported so such paths can opt
  in later, but no call sites are added now.
- Skeleton placeholders for individual form sections.

## Testing

- Unit-test the grace/dismiss state machine if it can be exercised without
  chrome APIs; otherwise manual.
- Manual: DevTools network throttling → run (a) library insert → capture editor,
  (b) edit section, (c) a fast action (tab switch / toggle) to confirm no
  flicker. Verify ESC and error paths leave no orphaned tile.
- No manifest change needed (no new script file).
