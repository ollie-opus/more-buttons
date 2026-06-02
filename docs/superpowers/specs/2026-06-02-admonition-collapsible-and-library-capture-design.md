# Design: Admonition collapsible setting + "Add a new capture" to library

Date: 2026-06-02

Two independent features in the More Buttons extension's form layer.

---

## Feature 1 — Collapsible setting on the edit-admonition form

### Background

"Collapsibility" of an MkDocs admonition is encoded in its markdown prefix:

| Prefix | Behaviour                         | Control value |
| ------ | --------------------------------- | ------------- |
| `!!!`  | Static — always open              | `static`      |
| `???`  | Collapsible, collapsed by default | `collapsed`   |
| `???+` | Collapsible, expanded by default  | `expanded`    |

Today the shared create/edit form (`editGuideAdmonition.html`) has no control for
this. `scripts/guides.js` **hardcodes `!!!` on create** (`submitEditGuideAdmonition`,
~line 946) and **preserves the existing prefix on edit** (~line 995, via
`cur.prefix`). The admonition parser only recognizes `!!!` and `???` — not `???+`.

### Changes

**1. `config/forms/editGuideAdmonition.html`**

Add a 3-way control named `admonitionCollapsible`, placed after the Type group.
Use the existing horizontal `more-buttons-radio-btn-group-row` pattern (matches the
form-layout convention: label on the left, control to the right). Values:

- `static` (label "Static") — default
- `collapsed` (label "Collapsible (closed)")
- `expanded` (label "Collapsible (open)")

**2. `scripts/admonitions.js`** — teach the parser about the optional `+`:

- `parseAdmonitions` header regex (~line 81): `(\\?\\?\\?|!!!)` → `(\\?\\?\\?\\+?|!!!)`
- `locateBlockByUUID` walk-up regex (~line 258): `/^\s*(\?\?\?|!!!) /` →
  `/^\s*(\?\?\?\+?|!!!) /`

`buildAdmonition` needs no change — it concatenates the prefix string verbatim, so
`???+` round-trips once parsing captures it. Update the doc comments that say
"`???` or `!!!`" to mention `???+`.

**3. `scripts/guides.js`**

- Add a prefix⇄value mapping helper (e.g. `prefixToCollapsible(prefix)` /
  `collapsibleToPrefix(value)`):
  - `!!!` ⇄ `static`
  - `???` ⇄ `collapsed`
  - `???+` ⇄ `expanded`
- `openCreateGuideAdmonition`: seed `admonitionCollapsible: 'static'` into the
  `moreButtonsEditGuideAdmonition` storage object.
- `openEditGuideAdmonition`: seed `admonitionCollapsible` from
  `prefixToCollapsible(adm.prefix)`.
- `submitEditGuideAdmonition`: read the selected `admonitionCollapsible` value and
  derive `const prefix = collapsibleToPrefix(value)`. Use it for **both** the create
  path (replaces hardcoded `!!!`) and the edit path (replaces `cur.prefix`), so the
  control actually drives the prefix on save.

### Data flow

Open edit → `adm.prefix` → control value (seeded via storage, restored by form.js's
existing radio-restore at form.js:936-937) → user toggles → submit reads checked
radio → `collapsibleToPrefix` → `buildAdmonition(prefix, …)` → `replaceAdmonitionByUUID`
→ GitHub.

### Notes / non-goals

- Sub-admonition round-tripping is unaffected: those paths already rebuild via
  `buildAdmonition(a.prefix, …)`, preserving whatever prefix was parsed.
- No migration needed — existing `!!!`/`???` blocks parse and map cleanly; the only
  new capability is producing/recognizing `???+`.

---

## Feature 2 — "Add a new capture" on the capture library

### Flow

Capture Library → **Add a new capture** → Capture Mode (single shot) → preview page
(light/dark cards) → **Save to Library** → back to refreshed library.

This reuses existing infrastructure:

- `enterCaptureMode({ saveTarget:'session', maxCaptures:1, returnTo })` returns a
  buffer whose item already carries `lightDataUrl`/`darkDataUrl` **and**
  library-relative `lightFilename`/`darkFilename` (derived from the current page path
  under `occ-captures/…` by `captureElement.deriveFilename`).
- `captures.pushCaptures([item])` writes `docs/assets/<lightFilename>` +
  `<darkFilename>` to GitHub via `githubPushImageIfNotExists` — exactly the library
  path the tree view reads from (`CAPTURE_ROOT = docs/assets/occ-captures`).

### Changes

**1. `config/forms/captureLibrary.html`**

Add a `.more-buttons-form-actions` bar with a bottom-right button:

```html
<div class="more-buttons-form-actions">
  <button type="button" class="more-buttons-button" data-action="startLibraryCapture">Add a new capture</button>
</div>
```

form.js's delegated `data-action` handler (form.js:605-625) dispatches this to the
registered form action with a `{ formEl, overlay, content }` context.

**2. `scripts/captureLibrary.js`**

Register `startLibraryCapture` (mirrors `captureEntry.startOverride`):

- `snapshotFormStack()`, hide the overlay, clear body overflow.
- `enterCaptureMode({ saveTarget:'session', maxCaptures:1, formStackSnapshot, returnTo:{ onComplete } })`.
- `onComplete(buffer)`: if `buffer.length`, hand `buffer[0]` to the new preview form
  via the `openCaptureNew` form action; if empty (user pressed Esc / cancelled), just
  re-show the library overlay.

**3. New `config/forms/captureNew.html` + `scripts/captureNew.js`**

A captureEntry-style preview page:

- Renders light/dark cards from the pending capture's `lightDataUrl`/`darkDataUrl`.
- Action bar bottom-right: **Cancel** and **Save to Library**.
  - Cancel → `navigateBack()` (returns to the library).
  - Save to Library → `pushCaptures([capture])` with a status callback on the button;
    on success → `navigateBack()`, which replays `openCaptureLibrary` and re-fetches
    the tree so the new capture appears.
- Registers `openCaptureNew({ capture })` as a form action.

**4. New `scripts/captureCards.js`**

Extract the `themeCard` + grid renderer currently private in `captureEntry.js` into a
shared helper (e.g. `renderCaptureGrid([{theme,title,src,alt}, …])`). Used by both
`captureEntry.js` and `captureNew.js`. Small, justified DRY since the new page is a
direct sibling of the existing one.

### Edge cases

- Empty buffer from Capture Mode (Esc) → no preview; library overlay restored.
- GitHub git/trees API briefly stale right after a push → the just-saved capture might
  not appear until a manual reload. Acceptable and rare; not worth special-casing.
- Form detached mid-capture by a hard nav → the existing form-stack snapshot /
  `replayFormStack` cold-exit path (already used by `captures.js` and `captureEntry.js`)
  applies; `onComplete` should guard on `formEl.isConnected` the same way.

### Non-goals

- No new capture-path configuration UI — the save path is whatever Capture Mode already
  derives from the current page (`occ-captures/<page-path>/<slug>-<theme>.png`).
- No editing of dimensions/library categorization on this page — it's a straight
  "save this shot to the library" action. (The existing in-form captures list keeps its
  richer controls.)

---

## Files touched

**Feature 1:** `config/forms/editGuideAdmonition.html`, `scripts/admonitions.js`,
`scripts/guides.js`.

**Feature 2:** `config/forms/captureLibrary.html`, `scripts/captureLibrary.js`,
`scripts/captureEntry.js` (refactor to shared cards), new `config/forms/captureNew.html`,
new `scripts/captureNew.js`, new `scripts/captureCards.js`.
