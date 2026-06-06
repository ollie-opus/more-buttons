# KB form save-button strategy — dynamic save-state + consistent vocabulary

**Date:** 2026-06-06
**Status:** Approved design, pre-implementation

## Goal

Make the "Save" buttons on knowledge-base forms *informational*: a single button that
reflects the form's save state live. When the form is clean, the button is a disabled
green "Draft saved" pill; when there are unsaved edits, it becomes a clickable blue
"Save to draft" button. While we're there, give every action button across KB forms a
consistent colour/role vocabulary, since today only dark / grey / red exist and the
buttons are entirely static.

## Background — current state (audited)

The form builder (`scripts/form.js`, `config/forms/formsStyling.css`) supports three
static button styles via class: default dark `primary`, `.secondary` grey, `.danger`
red. Buttons never change appearance except that save handlers disable the button and
swap its text to "Fetching…/Pushing…" during the GitHub commit, restoring on error.

Dirty state is **already tracked** but never visualised:
- `readFormValues()` / `isFormDirty()` / `resetDirtyBaseline()` in `form.js:147‑208`
- opt-in via the `data-dirty-guard` attribute on `<form>`; a snapshot
  (`formEl._initialSnapshot`) is taken at init and compared on demand.

KB action buttons today:

| Form | Writes to | Buttons |
|---|---|---|
| Guide entry (no draft) | — | `Create draft` (dark) |
| Guide entry (draft) | — | `Publish draft to live` (dark) · `Discard draft` (red) |
| Section create/edit | `docs/drafts/*.md` | `Save` (dark) · `Delete` (red) |
| Admonition create/edit | draft file | `Save` (dark) · `Delete` (red) |
| Capture component edit | container markdown (inherits draft) | `Save` (dark) · `Delete` (red) |
| System update — log (create) | live *or* draft | `Publish update` (dark) · `Save draft` (grey) |
| System update — draft edit | draft file | `Publish update` (dark) · `Save draft` (grey) · `Delete` (red) |
| System update — published edit | **live file (no draft)** | `Save & Publish` (dark) · `Delete` (red) |

Two facts the strategy must respect:
1. The **published** system-update edit form saves straight to the live file — there is
   no draft for an already-published update.
2. `Publish` buttons promote draft→live; that is a distinct action from saving, not a
   dirty-state save.

All save handlers route nested-component navigation through the shared save-gate
(`beginChildNavigation` / `formEl._componentSaver`, `guides.js:755‑818`). That flow is
**unchanged** by this work.

## Button vocabulary (4 roles)

| Role | Colour | Icon | Notes |
|---|---|---|---|
| **Save-state** (dynamic) | blue ⇄ green | `cloud_upload` ⇄ `cloud_done` | Bound to form dirty state |
| **Publish** | indigo | `publish` | Always clickable; uses existing save-gate confirm when dirty |
| **Delete / Discard** | red (`danger`) | — | Unchanged |
| **Create / start** (e.g. `Create draft`) | blue (`info`, static) | — | Hub action, not dirty-bound |

Non-KB forms keep the existing dark default primary — this work does not touch them.

## The dynamic save-state button

### States

```
CREATE mode  →  [ ☁⬆  Save to draft ]   blue,  enabled
DIRTY        →  [ ☁⬆  Save to draft ]   blue,  enabled
SAVED/CLEAN  →  [ ☁✓  Draft saved   ]   green, disabled   (cloud_done)
during commit →  [ …  Pushing…       ]   blue,  disabled   (existing progress text)
```

- **Create mode** (no saved baseline yet) renders as unsaved/blue and enabled.
- After a successful save the handler calls `resetDirtyBaseline(formEl)` then refreshes
  the button → green "Draft saved" / disabled.
- On save error the button refreshes back to blue "Save to draft" (form is still dirty).
- The **published system-update edit** form (live, no draft) runs the *same* mechanic
  with adapted copy: clean → `All changes saved` (green); dirty → `Save & Publish` (blue).

### Form-builder additions

**1. CSS variants** in `config/forms/formsStyling.css`:
- New theme tokens (light + dark) for green, blue, indigo:
  - `--mb-btn-success-bg` / `-fg` (green), `--mb-btn-info-btn-bg` / `-hover` / `-fg` (blue),
    `--mb-btn-publish-bg` / `-hover` / `-fg` (indigo). (Token names final at implementation;
    note the existing `--mb-info-bg` is an admonition background, distinct from the new
    blue *button* token.)
- New classes alongside `.secondary` / `.danger`:
  - `.more-buttons-button.success` — green; **plus a `.success:disabled` override** that
    keeps it green (slightly muted) instead of the generic `opacity:.45`, because the
    resting saved state is intentionally disabled.
  - `.more-buttons-button.info` — blue.
  - `.more-buttons-button.publish` — indigo.

**2. `bindSaveStateButton(formEl)` in `form.js`:**
- Auto-invoked from form init when a button carries `data-save-state`.
- Reads optional `data-saved-label` / `data-unsaved-label` (defaults "Draft saved" /
  "Save to draft") and renders icon + label.
- Listens to the form's `input` / `change`; re-evaluates `isFormDirty()`; in create mode
  always unsaved. Toggles class (`success`⇄`info`), icon (`cloud_done`⇄`cloud_upload`),
  label, and `disabled`.
- Exposes `formEl._refreshSaveState()` so existing save handlers flip it to green on
  success and back to blue on error — this replaces today's manual textContent
  save-and-restore in each handler.
- Requires `data-dirty-guard` (the snapshot source). Any form using `data-save-state`
  must also set `data-dirty-guard`.

**3. Capture-component form** gains `data-dirty-guard` + the snapshot wiring
(`editCaptureComponent.html`, `scripts/captureComponent.js`) so it can host the dynamic
button — it's the one save form without dirty tracking today.

### Button order convention

Within the right-aligned `.more-buttons-form-actions` cluster, DOM order left→right:
**save-state → publish → delete**. Applied consistently across all multi-button KB forms.

## Per-form application

| Form (HTML / JS) | Save-state button | Other buttons |
|---|---|---|
| `editGuideSection.html` | `Save` → `data-save-state` blue/green | `Delete` red |
| `editGuideAdmonition.html` | `Save` → dynamic | `Delete` red |
| `editCaptureComponent.html` + `captureComponent.js` | `Save` → dynamic (add dirty-guard) | `Delete` red |
| `logSystemUpdate.html` | `Save draft` → dynamic | `Publish update` → `.publish` indigo |
| `editDraftSystemUpdate.html` | `Save draft` → dynamic | `Publish update` indigo · `Delete` red |
| `editSystemUpdate.html` | `Save & Publish` → dynamic, copy `All changes saved`/`Save & Publish` | `Delete` red |
| Guide entry buttons (`guides.js`) | — | `Create draft` → `.info` blue · `Publish draft to live` → `.publish` indigo · `Discard draft` red |

Save handlers affected (replace manual text restore with `_refreshSaveState()` on
success/error, keep the progress-text behaviour during the commit):
`submitEditGuideSection`, `submitEditGuideAdmonition`, `submitEditCaptureComponent`,
`saveDraftSystemUpdate`, `saveDraftEditSystemUpdate`, `submitEditSystemUpdate`.

## Edge cases & decisions

- **Publish stays clickable while dirty.** No save-before-publish gating. If the form is
  dirty when Publish is clicked, the existing save-gate confirm handles it. (Decided.)
- **Disabled-green styling**: must override the generic disabled opacity so the saved
  state reads as a finished pill, not a greyed-out button.
- **Create→edit transition** (section/admonition/log): after first save the form stays
  mounted, `resetDirtyBaseline` runs, button flips to green. No special-casing needed
  beyond calling `_refreshSaveState()` post-transition.
- **Progress text** ("Pushing…") during the GitHub commit is preserved; `_refreshSaveState()`
  is only called at the end (success or error).

## Out of scope

- The save-gate confirm flow and `_componentSaver` mechanics (unchanged).
- Non-KB forms (keep dark default primary).
- Any change to where files are written or the draft/live publish workflow.

## Testing

- Manual: open each KB form; verify clean→green-disabled, edit a field→blue-enabled,
  save→green, error→blue, create-mode→blue, create→edit transition→green.
- Verify Publish (indigo) still works clean and dirty (save-gate confirm appears).
- Verify capture-component dirty tracking now toggles the button.
- Light + dark theme check for all three new colours.
