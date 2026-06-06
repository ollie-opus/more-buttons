# Capture metadata pills — design

**Date:** 2026-06-06
**Status:** Approved (design)

## Goal

Every capture should record two pieces of metadata, surfaced as pills on the
capture-library tree (styled exactly like the Knowledge Base `Drafting`/`Live`
pills):

1. **Resized** — a boolean: was the capture *actually* resized? Entering resize
   mode but not changing the dimensions does **not** count.
2. **Padding** — the px padding that was *actually applied* to the capture
   (numeric).

Pills shown on a capture-library tree entry:

- `resized === true` → yellow **RESIZED** pill (same yellow as `Drafting`).
- `padding > 0` → blue **PADDED: N PX** pill.
- Neither → no pills (row unchanged).

## Why a JSON manifest (not filename / not PNG-embedded)

The capture library is expected to hold **hundreds+** of captures, and the
existing PNG paths are referenced elsewhere (markdown image links, the
recapture/override flow) and must not change.

- **PNG-embedded metadata** would force the library to download and parse every
  PNG on open (the library currently reads only the git tree — paths only, no
  blob content). Hundreds of requests per open → rejected.
- **Filename-encoded metadata** would change paths, which breaks existing
  references → rejected.
- **A single JSON manifest** keeps reads to exactly one extra fetch, never
  touches paths or images, and degrades gracefully. → chosen.

## The manifest file

- Path: `docs/assets/occ-captures/.captures-meta.json`
- Keyed by the **light PNG's full repo-relative path** (light + dark always share
  identical settings, so one entry covers the pair).
- `resized` omitted when false; `padding` omitted when 0; an entry with neither
  is not stored.

```json
{
  "docs/assets/occ-captures/sites/uuid/save-button-light-mode.png": { "resized": true, "padding": 24 },
  "docs/assets/occ-captures/sites/uuid/header-light-mode.png": { "padding": 16 }
}
```

The manifest lives *inside* `CAPTURE_ROOT`, so it must be **excluded** from
`listCaptureTree` / `buildNodes` so it never renders as a tree leaf.

## Write rule — authoritative upsert (prevents staleness)

Every time a capture is written to a path (fresh push **or** recapture), the
manifest entry for that path is **replaced** with exactly the new metadata:

- resized OR padded → `manifest[lightPath] = { resized?, padding? }`
- neither → **delete** `manifest[lightPath]`

This covers the staleness cases:

- **Recapture** (override flow) reuses the same path → entry overwritten with the
  recapture's real metadata (or removed if the recapture is plain).
- **Delete then re-capture the same element** → same path → upsert
  overwrites/clears, so no stale `RESIZED` lingers.

The only orphanable key is a PNG that is deleted and never recaptured — harmless,
because the library only renders pills for files that exist in the tree, so an
unused key sits inert.

## Capturing the two values

### resized (real dimension change)

In `enterResizeMode` (`scripts/captureElement.js`), the element's initial rect is
already snapshotted as `initRect` and the live `box` mutates as the user drags.
On confirm, compute:

```
resized = Math.round(box.width)  !== Math.round(initRect.width)
       || Math.round(box.height) !== Math.round(initRect.height)
```

Width/height only — position-only moves do not count as resized. This boolean is
passed through the confirm callback → `onPick` (`scripts/captureMode.js`) →
`handleCapture`. The non-resize capture path always reports `resized = false`.

### padding (actually applied)

`screenshotElement` already gates real padding on `padding > 0 && sampledBgColor`
(padding is skipped when no background colour could be sampled). It will return
the **effective** padding (the requested value if applied, else 0) alongside its
existing result:

```
{ dataUrl, filename, appliedPadding }
```

`handleCapture` reads `light.appliedPadding`. Light and dark sample the same live
DOM, so the effective padding is identical across the pair.

### Buffer entry

`sessionBuffer` entries gain two fields next to the existing
`lightFilename`/`darkFilename`:

```
{ ..., resized: <bool>, padding: <number> }
```

## Library read + pills

- On `openCaptureLibrary`, after the existing tree fetch, do one extra
  `readRepoText` of the manifest (missing file → `{}`).
- Add `decorateCapturePills(panel, metaMap)`, mirroring
  `decorateKbPills` in `knowledgeBaseManagement.js`: iterate `[data-kb-leaf]`,
  read `data-capture-light`, look up the manifest entry, append pills.

### Pill CSS (in `config/forms/formsStyling.css`)

Reuse the existing `.mb-kb-pill` system; add two accents:

```css
.mb-kb-pill.--resized { --mb-pill-accent: rgb(255, 179, 0); }  /* same yellow as Drafting */
.mb-kb-pill.--padded  { --mb-pill-accent: rgb(66, 165, 245); } /* Material blue */
```

Pill text:

- `<span class="mb-kb-pill --resized">Resized</span>` → renders **RESIZED**
- `<span class="mb-kb-pill --padded">Padded: 24px</span>` → renders **PADDED: 24PX**

## Plumbing

### New module `scripts/captureMeta.js`

Read/upsert helpers over the GitHub Contents API:

- `readCaptureMeta()` → returns the parsed manifest object (`{}` if the file is
  missing).
- `upsertCaptureMeta(entries)` → applies a batch of `{ lightPath, resized,
  padding }` upserts to the manifest using the authoritative rule above, then
  writes it back. GET for current sha + content, PUT with sha; on a 409 conflict,
  re-read the sha and retry once.

Used by:

- `scripts/captures.js` `pushCaptures` — after pushing the batch of images, write
  the manifest **once** with all of the batch's upserts.
- `scripts/captureEntry.js` `saveChanges` (recapture) — after
  `githubReplaceImage`, upsert the single path from the pending capture's
  `resized`/`padding`.

### manifest.json

Per the project rule, register `scripts/captureMeta.js` in
`manifest.json` `web_accessible_resources` (scripts listed individually).

## Files touched

- `scripts/captureElement.js` — `enterResizeMode` reports `resized`;
  `screenshotElement` returns `appliedPadding`.
- `scripts/captureMode.js` — thread `resized` through `onPick`/`handleCapture`;
  add `resized`/`padding` to the buffer entry.
- `scripts/captures.js` — write manifest upserts after `pushCaptures`.
- `scripts/captureEntry.js` — upsert manifest on recapture save.
- `scripts/captureLibrary.js` — fetch manifest, exclude it from the tree,
  `decorateCapturePills`.
- `scripts/captureMeta.js` — **new** module.
- `config/forms/formsStyling.css` — `--resized` / `--padded` pill accents.
- `manifest.json` — register the new module.

## Out of scope

- No UI for manually editing metadata.
- No backfill of metadata for captures that already exist without an entry (they
  simply show no pills).
- Orphan-key cleanup for manually-deleted-and-never-recaptured PNGs (harmless).
