# Videos component — design spec

**Date:** 2026-06-20
**Status:** Approved (brainstorming) — pending implementation plan

## Goal

Add a **Video** component to the Knowledge Base "Components" system. It behaves
like a capture (image) but inserts a `<video>` element instead of an `<img>`,
and it can **only** be added from a library — there is no video-creation tool
(no equivalent of Capture Mode). Videos already live, manually uploaded, under
`docs/assets/media/videos/`; the extension only emits correct `<video>` HTML
referencing them.

## Decisions (settled during brainstorming)

1. **Architecture:** merge at the infrastructure level (one library browser, one
   edit form), but model `video` as a **distinct component `kind`** in the data
   model and markdown layer. Videos are *not* captures with a missing dark file —
   they share the light/dark pairing convention but emit different HTML.
2. **Entry point:** a **top-level "Video"** item in the Insert Component menu
   (no submenu — there is no "create" path), opening the shared library focused
   on a **Videos** tab.
3. **Pairing:** support **both** light/dark pairs *and* single theme-agnostic
   videos. `darkFilename === null` is the single-video signal.
4. **Form options (v1):** Size (width/height), Animation-vs-Clip toggle, Theme
   (default/inverse), Corner rounding. All four reuse the capture form's
   patterns; Animation/Clip is video-only.
5. **Edit form:** one **kind-aware** edit form edits images *or* videos
   (generalize `captureComponent.js` + `editCaptureComponent.html`).
6. **List thumbnails:** muted inline `<video>` (paused, first-frame poster).
7. **v1 exclusions (in the source spec, deliberately dropped):** caption
   (`<figure>`/`<figcaption>`), `poster`, multi-`<source>` videos. None are
   emitted or parsed in v1.

## Output format (what we emit)

Animation pair (the default):

```html
<span data-uuid="…" style="display:none"></span>
<video src="../assets/media/videos/status-tile-light-mode.mp4#only-light" autoplay loop muted playsinline preload="none" style="width: 1000px"></video>
<video src="../assets/media/videos/status-tile-dark-mode.mp4#only-dark" autoplay loop muted playsinline preload="none" style="width: 1000px"></video>
```

Single theme-agnostic animation:

```html
<span data-uuid="…" style="display:none"></span>
<video src="../assets/media/videos/intro.mp4" autoplay loop muted playsinline preload="none" style="width: 1000px"></video>
```

Clip variant (replaces `autoplay loop … preload="none"` with `controls preload="metadata"`):

```html
<video src="../assets/media/videos/intro.mp4" controls muted playsinline preload="metadata" style="width: 1000px"></video>
```

Notes:
- **Theme swap** reuses the capture mechanism: `inversed` swaps which file
  carries `#only-light`/`#only-dark` (same as `buildCaptureLines`). Inert
  without the project-side `videos.css`, which is already installed (the
  extension adds no CSS).
- **Size** uses inline `style="width: Npx"` or `style="height: Npx"` — **not**
  `{ … }` attr_list braces (those are img/Markdown-only and do nothing on raw
  HTML). When corner rounding is on, `border-radius: 8px` is appended to the
  same `style`. This differs from captures, which use a `width="N"` *attribute*
  for width mode; videos keep width in `style` for consistency with the spec.
- `muted` is always emitted (mandatory with autoplay; harmless for clips).
- Indentation: every emitted line matches the container indent, exactly as
  captures already do (handled by `buildComponentBody`'s container re-indent).

## Data model

New component kind alongside `'capture'`:

```js
{ kind: 'video', vid: {
    uuid,                 // hidden data-uuid span identity (as captures)
    lightFilename,        // 'media/videos/<dir>/<name>-light-mode.mp4' (or single file)
    darkFilename,         // 'media/videos/<dir>/<name>-dark-mode.mp4', or null when single
    dimMode,              // 'width' | 'height' | 'none'  (shared model with captures)
    dimValue,             // number | null
    inversed,             // boolean — theme swap; ignored/forced false when single
    rounded,              // boolean — border-radius applied
    playback,             // 'animation' | 'clip'
} }
```

`darkFilename === null` ⟺ single video: emit one `<video>` with no `#only`
fragment, and the edit/insert form hides the Theme control.

## Components touched

### New files
- **`scripts/videos.js`** — `buildVideoLines(list)` (emit), the insert flow
  (`runComponentVideoLibraryInsert`, `commitVideosIntoContainer`,
  `completeComponentVideoInsert` form action). Mirrors `captures.js` minus all
  Capture-Mode/screenshot/upload code (videos are never created or pushed).
- **`scripts/videoEntry.js`** — the insert **review** form (library → pick →
  preview + Size/Theme/Corner/Playback → "Insert this video"). Insert-only;
  none of `captureEntry.js`'s recapture/override machinery. Loads the real
  video via `readRepoBlob` → blob URL into a muted `<video>` (bypasses the
  raw-CDN cache, same reason captures use `readRepoBlob`).
- **`config/forms/videoEntry.html`** — review-form template (mirrors
  `captureEntry.html`).

### Modified files
- **`scripts/components.js`**
  - `VIDEO_LIGHT_LINE_RE` / `VIDEO_DARK_LINE_RE` / `VIDEO_SINGLE_LINE_RE` and
    `locateVideoLines(body)` — pairs (two consecutive `<video>` with matching
    `#only-*`) and singles (one `<video>`, no fragment). Reads the preceding
    `data-uuid` span; parses `style` for width/height + `border-radius`; infers
    `playback` (`controls` ⇒ clip, else animation); infers `inversed` from which
    file carries which `#only` hash (as captures do via `LIGHT_LINE_RE` group 3).
  - `ensureVideoUUIDs(markdown)` — backfill identity spans (mirror
    `ensureCaptureUUIDs`); add to the `parsePastedComponents` ensure-chain
    (admonitions → tabs → grids → tables → captures → **videos**).
  - `parseComponents` — locate top-level videos, exclude container-internal
    ones, push `{ kind:'video', vid }` items into the ordered list.
  - `buildComponentBody` — `c.kind === 'video'` branch calls `buildVideoLines`.
  - `videoDimFields(vid)` — canonical merge representation (mirror
    `captureDimFields`) including `videoPlayback`, theme, corner.
  - `uuidOfComponent` / `videoComponent(vid)` helpers — video branch.
- **`scripts/captureLibrary.js`** + **`config/forms/captureLibrary.html`**
  - Add an **Images / Videos** tab strip. Parameterize the tree fetch/build by a
    media config `{ root, exts, suffixDetect }` (`occ-captures`+`.png` vs
    `videos`+`.mp4|.webm`). `buildNodes` already handles non-pair "other" files,
    so single videos appear as standalone leaves.
  - Video leaf click → open `videoEntry`; image leaf click stays →
    `openCaptureEntry`. Captures behavior is otherwise unchanged.
- **`scripts/captureComponent.js`** + **`config/forms/editCaptureComponent.html`**
  - Make the existing **edit** form **kind-aware** (image | video): swap the
    preview between `<img>` and muted `<video>`; keep Size/Theme/Corner; add an
    **Animation / Clip** radio group shown only for videos; hide Theme for single
    videos. Merge-save reads `videoDimFields` for videos, `captureDimFields` for
    images. (Reuses the same concurrent-edit merge gate.)
- **`scripts/insertMenu.js`** — add a top-level `Video` item (`data-pick="video"`)
  and a `video` handler key.
- **`scripts/guides.js`**
  - `onComponentEditorClick` insert handlers: `video: (i) => beginChildNavigation(formEl, { type:'insert', kind:'video', insertAt:i })`.
  - `runChildAction`: `kind === 'video'` → `runComponentVideoLibraryInsert(...)`;
    new `edit-video` action → open the (shared) editor for the video.
  - `renderComponents`: a `c.kind === 'video'` branch → `videoComponentCardFor(vid)`
    rendering a muted inline `<video>` thumb with edit/copy affordances
    (`data-edit-video-component`).
  - `openEditorForComponent`: `component.kind === 'video'` branch → shared editor.
  - Label maps (the two `labelMap[...]` blocks) get a video entry.
- **`manifest.json`** — add `scripts/videos.js` and `scripts/videoEntry.js` to
  `web_accessible_resources` (individually listed — known gotcha: omission →
  "Failed to fetch dynamically imported module"; reload the extension after).

## Round-trip / parsing details

- Parsing anchors on the `media/videos/` path prefix + `<video` tag so video
  lines are never mistaken for capture `![]()` lines (different syntax entirely).
- Pair detection: a light `<video>` whose next non-blank line is a dark
  `<video>` with the partner `#only-*` fragment. Otherwise it is a single.
- `playback` is round-tripped from attribute presence (value-agnostic where
  possible) so emitting and re-parsing is stable.
- Corner rounding detected by `border-radius` presence in `style`, mirroring
  `parseDimAttrs`.

## Testing

Mirror the existing capture test style (pure markdown round-trip, no DOM):
- `tests/videoRoundTrip.test.mjs` — `locateVideoLines` ↔ `buildVideoLines` for:
  animation pair, clip pair, single animation, single clip, inversed theme,
  width vs height vs auto, rounded, with/without uuid span, and indented
  (inside-admonition) placement.
- `tests/videoDimFields.test.mjs` — canonical merge representation incl.
  `playback`, theme, corner; untouched video compares equal across a merge.
- `tests/parseComponentsVideo.test.mjs` — videos interleave correctly with
  captures/admonitions/grids/tabs/tables in document order; container-internal
  videos are excluded at top level; `ensureVideoUUIDs` backfill + paste flow.

## Out of scope (v1)

Caption/`<figure>`, `poster`, multi-`<source>` videos, any video creation/upload
or transcoding, and any CSS (the project's `videos.css` already handles the
theme swap and `max-width: 100%`).
