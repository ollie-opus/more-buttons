# Capture insert decision form — design

**Date:** 2026-06-11
**Status:** Approved (pending user review of this doc)

## Problem

In the Components flow (Insert component → Capture → Create a new capture), a
shift-click in capture mode immediately pushes the capture's PNG pair to GitHub
and opens the component editor. There is no chance to review the capture, set
its size, or notice that an identical capture already exists in the library —
the library accumulates near-duplicate files, and sizing requires a second form
visit.

## Goal

After the shift-click, **nothing is pushed**. Instead the flow checks whether
the capture already exists in the library (its derived path is deterministic:
`media/occ-captures/{page-path}/{element-label}-{theme}-mode.png`, no UUID) and
opens one of two review forms. Pushing — markdown, and files when needed —
happens only when the user clicks **Insert this capture**.

## Flow

### Create-new-capture route (changed)

1. Insert component → Capture → Create a new capture → `runComponentCaptureFlow`
   → capture mode → shift-click → light/dark screenshots buffered → auto-exit
   at 1 capture (all unchanged).
2. `onComplete` no longer commits. It re-shows the overlay, raises the
   `formLoading` veil, and probes `githubPathExists` for the capture's derived
   **light and dark** repo paths.
3. **Both exist → "in library" branch:** open `captureEntry` in insert mode —
   the exact form the from-library route uses — showing the **stored** repo
   tiles (fetched via the contents API, not the in-memory screenshots), the
   capture path (disabled), the size field, and bottom-right buttons
   Cancel / Insert this capture.
4. **Otherwise → "new" branch:** open the new `captureInsertNew` form —
   editable proposed-path field (with the existing rename warning), in-memory
   dataURL tiles, size field, bottom-right Cancel / Insert this capture.
5. **Insert this capture:**
   - In-library branch: commit capture-component markdown into the container at
     `insertAt`, referencing the stored files (no upload), with the form's
     `dimMode`/`dimValue`.
   - New branch: re-probe the (possibly renamed) target path; on collision run
     the conflict resolver (same UX as `captureNew`); then `pushCaptures`
     (PNG pair + metadata manifest upsert) and commit the markdown with the
     form's size values.
   - Both branches then return to the container's form. **The component editor
     does not open** — deliberate deviation from the "insert lands in editor"
     standard, because size is now set at insert time. Other component kinds
     keep the standard.
6. **Cancel:** discard the pending capture and re-enter capture mode with the
   same container/`insertAt` intent so another element can be picked. Esc/✕
   from capture mode still falls back to the container form as today.

### From-library route (extended)

Insert component → Captures → From library → select. `captureEntry` insert mode
gains the same size field and a Cancel button:

- **Cancel** → `navigateBack()` (returns to the library tree).
- **Insert this capture** → commits markdown with the chosen size; editor does
  not open.

`captureEntry`'s edit/recapture mode is untouched.

## Components

### `captureCards.js` — shared size field

- `captureSizeField({ dimMode = 'height', dimValue = 50 })` → markup helper
  emitting the existing Dimension control (form-group label + `dimMode` select
  height/width/auto + `dimValue` number input + px unit), identical to the
  markup currently hardcoded in `config/forms/editCaptureComponent.html`.
- A small wire/read pair: bind the "value input disabled when mode is none"
  behaviour, and read back `{ dimMode, dimValue }`.
- `config/forms/editCaptureComponent.html` replaces its static Dimension
  form-group with a placeholder that `captureComponent.js` fills via the
  helper — one source of truth for the control.

### `captureInsertNew.js` (new module) + `config/forms/captureInsertNew.html`

The "new" branch form. Reuses `capturePathField`, `captureGrid`, `captureCard`,
`captureSizeField` from `captureCards.js`, `pushCaptures` from `captures.js`,
and the conflict-resolver pattern from `captureNew.js` (extract the shared
"probe + resolve + overwrite" piece rather than copy it). Receives the pending
capture (dataURLs + derived filenames + resized/padding) and the insert intent
(container, `insertAt`).

- **Manifest:** `scripts/captureInsertNew.js` must be added individually to
  `manifest.json` `web_accessible_resources`. The form HTML needs no entry
  (`config/forms/*` is globbed).

### `captureEntry.js` — insert mode additions

- Size field (defaults height/50) rendered in insert mode only.
- Cancel button; behaviour depends on origin:
  - `origin: 'library'` (existing route) → `navigateBack()`.
  - `origin: 'captureMode'` (new route) → discard pending capture, re-enter
    capture mode with the original intent.
- Insert passes `{ lightFilename, darkFilename, dimMode, dimValue }` (no
  dataURLs) so `commitCapturesIntoContainer` uploads nothing.

### `captures.js` — decision point + commit path

- `runComponentCaptureFlow`'s commit step becomes **probe → open decision
  form** (under the `formLoading` veil). `commitCapturesIntoContainer` remains
  the single markdown-commit path; it already skips uploads for dataURL-less
  captures, which the in-library branch exploits.
- `openInsertedComponentEditor` is dropped from both capture insert routes
  (capture-mode and library); admonitions/content-tabs are unaffected.
- Size values flow through the existing capture object fields
  (`dimMode`/`dimValue` → `buildCaptureLines`).

### Cold-exit machinery (recently added, currently uncommitted)

`planColdExit`, intent serialisation, and `captureColdExit.test.mjs` stay
exactly as-is. Only the `completeComponentCaptureInsert` handler body changes:
from "replay form stack + commit" to "replay form stack + probe + open decision
form". The buffered dataURLs already survive in sessionStorage, so a hard nav
during capture mode still lands in the right form. **The pending cold-exit work
must be committed before this design's implementation starts.**

Once the decision form is open, capture mode's session slot is cleared; a hard
navigation while the form is open loses the pending capture. This matches
`captureNew`'s existing behaviour and is accepted.

## Edge cases & errors

- **Half-pair** (only one theme file exists, e.g. after a partial manual
  rename): treated as *not* in library → new branch; the insert-time conflict
  resolver offers overwrite/keep for the colliding half.
- **Race on insert (new branch):** path created between probe and push, or the
  user renames onto an existing path → re-probe at insert time, conflict
  resolver on collision. `pushCaptures` stays create-only.
- **Probe failure** (network/auth): fail loudly — alert with the error and
  re-show the container form (matches existing failure handling in this flow).
- **Loading:** every async stretch (probe, replay, push, commit) sits under the
  `formLoading` veil per the project standard — no inline placeholders.

## Testing

Unit tests (node, `tests/*.test.mjs`):

- Branch decision: (lightExists, darkExists) → in-library / new mapping
  (both → in-library; any other combination → new).
- `captureSizeField` round-trip: render → wire → read returns the entered
  `{ dimMode, dimValue }`; value input disabled when mode is `none`.
- Markdown commit: form-chosen `dimMode`/`dimValue` flow through
  `buildCaptureLines` (height/width/none variants).

Manual verification end-to-end (extension reload required — manifest change):
both branches of the capture-mode route, the library route, both Cancel
behaviours, and a cold exit (hard nav during capture mode) landing in the
decision form.

## Out of scope

- Updating stored library files from the in-library branch (an "overwrite with
  this capture" action) — possible later addition.
- Any change to capture geometry/screenshotting, the recapture/compare flow, or
  other component kinds' insert-lands-in-editor behaviour.
