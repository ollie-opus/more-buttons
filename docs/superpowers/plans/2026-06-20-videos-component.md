# Videos Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a library-only **Video** component that inserts `<video>` HTML into Zensical KB Markdown pages, reusing the capture library browser and edit form while modelling `video` as a distinct component `kind`.

**Architecture:** Videos share the capture light/dark pairing convention and dimension model but emit `<video>` HTML instead of `![]()`. A new pure `videos.js` owns the markdown emit; `components.js` gains the parse/locate/round-trip branches. The capture library grows an Images/Videos tab strip (tree-building extracted into a pure `mediaTree.js`), a lean insert-review form (`videoEntry.js`) handles selection, and the existing edit form (`captureComponent.js` + `editCaptureComponent.html`) becomes kind-aware to edit images or videos.

**Tech Stack:** Vanilla ES modules (browser extension, no build step). Tests are standalone `node tests/*.test.mjs` files using `node:assert/strict` against pure functions.

## Global Constraints

- **No CSS added.** The project's `docs/assets/stylesheets/videos.css` already handles the theme swap and `max-width: 100%`. The extension only emits HTML.
- **Never emit `{ … }` attr_list braces on `<video>`.** Those are img/Markdown-only. All video options are real HTML attributes.
- **Path convention:** `<video src="../assets/media/videos/<filename>…">` (page-relative; `media/videos/…` is the stored filename, `docs/assets/` is the repo prefix).
- **Light/dark pairs** use the existing capture naming: `<name>-light-mode.<ext>` / `<name>-dark-mode.<ext>`. A file with neither suffix is a **single** theme-agnostic video.
- **Sizing:** width and height both via inline `style="width: Npx"` / `style="height: Npx"` (videos never use the `width="N"` attribute — that is image-only in Zensical). Corner rounding appends `border-radius: 8px` to the same `style`.
- **Animation** attrs: `autoplay loop muted playsinline preload="none"`. **Clip** attrs: `controls playsinline preload="metadata"`. Presence of `controls` ⇒ clip; presence of `autoplay` ⇒ animation (round-trip discriminator).
- **New `scripts/*.js` files must be registered** individually in `manifest.json` `web_accessible_resources` (form HTML under `config/forms/*` is already globbed). Omission → "Failed to fetch dynamically imported module"; reload the extension at `chrome://extensions` after.
- **v1 exclusions:** no caption/`<figure>`, no `poster`, no multi-`<source>`.

---

### Task 1: Video markdown emit (`buildVideoLines`)

**Files:**
- Create: `scripts/videos.js`
- Test: `tests/videoBuildLines.test.mjs`

**Interfaces:**
- Produces: `buildVideoLines(list: VideoSpec[]): string[]` and `export const VIDEO_CORNER_RADIUS = 8`.
  `VideoSpec = { uuid?, lightFilename, darkFilename|null, dimMode:'width'|'height'|'none', dimValue:number|null, inversed:boolean, rounded:boolean, playback:'animation'|'clip' }`.
  Returns `['', spanLine?, lightLine, darkLine?]` — a leading `''` then optional uuid span then one (single) or two (pair) `<video>` lines. Mirrors `buildCaptureLines`.

- [ ] **Step 1: Write the failing test**

Create `tests/videoBuildLines.test.mjs`:

```js
import assert from 'node:assert/strict';
import { buildVideoLines, VIDEO_CORNER_RADIUS } from '../scripts/videos.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const base = { uuid: 'VID-1', lightFilename: 'media/videos/a-light-mode.mp4', darkFilename: 'media/videos/a-dark-mode.mp4' };
// buildVideoLines returns ['', span, lightLine, darkLine?]; grab the <video> lines.
function vids(spec) {
  return buildVideoLines([spec]).filter(l => l.startsWith('<video'));
}

test('animation pair: default theme, width sizing', () => {
  const [light, dark] = vids({ ...base, dimMode: 'width', dimValue: 1000, inversed: false, rounded: false, playback: 'animation' });
  assert.equal(light, '<video src="../assets/media/videos/a-light-mode.mp4#only-light" autoplay loop muted playsinline preload="none" style="width: 1000px"></video>');
  assert.equal(dark,  '<video src="../assets/media/videos/a-dark-mode.mp4#only-dark" autoplay loop muted playsinline preload="none" style="width: 1000px"></video>');
});

test('inversed theme swaps the #only hashes onto the opposite files', () => {
  const [light, dark] = vids({ ...base, dimMode: 'width', dimValue: 1000, inversed: true, rounded: false, playback: 'animation' });
  assert.ok(light.includes('a-light-mode.mp4#only-dark'));
  assert.ok(dark.includes('a-dark-mode.mp4#only-light'));
});

test('clip pair: controls + metadata, no autoplay/loop', () => {
  const [light] = vids({ ...base, dimMode: 'height', dimValue: 500, inversed: false, rounded: false, playback: 'clip' });
  assert.equal(light, '<video src="../assets/media/videos/a-light-mode.mp4#only-light" controls playsinline preload="metadata" style="height: 500px"></video>');
});

test('rounding folds border-radius into the style', () => {
  const [light] = vids({ ...base, dimMode: 'width', dimValue: 1000, inversed: false, rounded: true, playback: 'animation' });
  assert.equal(light, `<video src="../assets/media/videos/a-light-mode.mp4#only-light" autoplay loop muted playsinline preload="none" style="width: 1000px; border-radius: ${VIDEO_CORNER_RADIUS}px"></video>`);
});

test('auto size with no rounding emits no style attribute', () => {
  const [light] = vids({ ...base, dimMode: 'none', dimValue: null, inversed: false, rounded: false, playback: 'animation' });
  assert.equal(light, '<video src="../assets/media/videos/a-light-mode.mp4#only-light" autoplay loop muted playsinline preload="none"></video>');
});

test('auto size WITH rounding emits a style holding only border-radius', () => {
  const [light] = vids({ ...base, dimMode: 'none', dimValue: null, inversed: false, rounded: true, playback: 'animation' });
  assert.equal(light, `<video src="../assets/media/videos/a-light-mode.mp4#only-light" autoplay loop muted playsinline preload="none" style="border-radius: ${VIDEO_CORNER_RADIUS}px"></video>`);
});

test('single video: one element, no #only fragment, no dark line', () => {
  const out = vids({ uuid: 'VID-2', lightFilename: 'media/videos/intro.mp4', darkFilename: null, dimMode: 'width', dimValue: 800, inversed: false, rounded: false, playback: 'animation' });
  assert.equal(out.length, 1);
  assert.equal(out[0], '<video src="../assets/media/videos/intro.mp4" autoplay loop muted playsinline preload="none" style="width: 800px"></video>');
});

test('uuid span is emitted before the first video line', () => {
  const out = buildVideoLines([{ ...base, dimMode: 'none', dimValue: null, inversed: false, rounded: false, playback: 'animation' }]);
  assert.equal(out[0], '');
  assert.equal(out[1], '<span data-uuid="VID-1" style="display:none"></span>');
});

console.log(`videoBuildLines: ${passed} passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/videoBuildLines.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/videos.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/videos.js`:

```js
/**
 * videos.js — Video markdown round-trip + Components video acquisition.
 *
 * Videos are library-only (no creation tool). This module owns the `<video>`
 * markdown emit (buildVideoLines) plus the library-insert flow that commits a
 * chosen video straight into a container's markdown. Mirrors captures.js, minus
 * all Capture-Mode / screenshot / image-upload code (videos are never created
 * or pushed by the extension — they are uploaded manually beforehand).
 */

import { registerFormAction, getFormAction } from './formActions.js';
import { snapshotFormStack, replayFormStack } from './form.js';
import { formLoading } from './loading.js';
import { generateUUID } from './admonitions.js';
import { getComponentContainer } from './componentContainers.js';

// Corner-rounding radius (px) applied to a rounded video's inline style. Single
// knob; the parser only detects `border-radius` presence so this can change
// freely without breaking already-saved videos.
export const VIDEO_CORNER_RADIUS = 8;

// Attribute sets keyed by playback mode (everything between src and style).
const PLAYBACK_ATTRS = {
  animation: 'autoplay loop muted playsinline preload="none"',
  clip: 'controls playsinline preload="metadata"',
};

export function buildVideoLines(list = []) {
  return list.flatMap(v => {
    const single = !v.darkFilename;
    const lightHash = single ? '' : (v.inversed ? '#only-dark' : '#only-light');
    const darkHash = v.inversed ? '#only-light' : '#only-dark';
    const attrs = PLAYBACK_ATTRS[v.playback] ?? PLAYBACK_ATTRS.animation;

    const styleParts = [];
    if (v.dimMode === 'width') styleParts.push(`width: ${v.dimValue ?? 50}px`);
    else if (v.dimMode === 'height') styleParts.push(`height: ${v.dimValue ?? 50}px`);
    if (v.rounded) styleParts.push(`border-radius: ${VIDEO_CORNER_RADIUS}px`);
    const styleAttr = styleParts.length ? ` style="${styleParts.join('; ')}"` : '';

    const el = (file, hash) =>
      `<video src="../assets/${file}${hash}" ${attrs}${styleAttr}></video>`;

    const spanLines = v.uuid ? [`<span data-uuid="${v.uuid}" style="display:none"></span>`] : [];
    const lines = ['', ...spanLines, el(v.lightFilename, lightHash)];
    if (!single) lines.push(el(v.darkFilename, darkHash));
    return lines;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/videoBuildLines.test.mjs`
Expected: PASS — `videoBuildLines: 8 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/videos.js tests/videoBuildLines.test.mjs
git commit -m "feat(videos): emit <video> markdown (buildVideoLines)"
```

---

### Task 2: Video markdown parse (`locateVideoLines`, `ensureVideoUUIDs`)

**Files:**
- Modify: `scripts/components.js` (add after the capture locate/ensure section, ~line 106 / ~line 131)
- Test: `tests/videoLocate.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  `locateVideoLines(body: string): Array<{ lightFilename, darkFilename|null, single:boolean, dimMode, dimValue, rounded, inversed, playback, indent, uuid|null, startLine, endLine }>`
  and `ensureVideoUUIDs(markdown: string): string`. Both exported.

- [ ] **Step 1: Write the failing test**

Create `tests/videoLocate.test.mjs`:

```js
import assert from 'node:assert/strict';
import { buildVideoLines } from '../scripts/videos.js';
import { locateVideoLines, ensureVideoUUIDs } from '../scripts/components.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

function bodyFor(spec) {
  // buildVideoLines yields ['', span?, light, dark?]; drop the leading ''.
  return buildVideoLines([spec]).slice(1).join('\n');
}

test('round-trips an animation pair with width + inversed + rounded', () => {
  const spec = { uuid: 'VID-1', lightFilename: 'media/videos/a-light-mode.mp4', darkFilename: 'media/videos/a-dark-mode.mp4', dimMode: 'width', dimValue: 1000, inversed: true, rounded: true, playback: 'animation' };
  const [v] = locateVideoLines(bodyFor(spec));
  assert.equal(v.lightFilename, 'media/videos/a-light-mode.mp4');
  assert.equal(v.darkFilename, 'media/videos/a-dark-mode.mp4');
  assert.equal(v.single, false);
  assert.equal(v.dimMode, 'width');
  assert.equal(v.dimValue, 1000);
  assert.equal(v.inversed, true);
  assert.equal(v.rounded, true);
  assert.equal(v.playback, 'animation');
  assert.equal(v.uuid, 'VID-1');
});

test('detects a clip pair via the controls attribute', () => {
  const spec = { uuid: 'VID-2', lightFilename: 'media/videos/b-light-mode.mp4', darkFilename: 'media/videos/b-dark-mode.mp4', dimMode: 'height', dimValue: 500, inversed: false, rounded: false, playback: 'clip' };
  const [v] = locateVideoLines(bodyFor(spec));
  assert.equal(v.playback, 'clip');
  assert.equal(v.dimMode, 'height');
  assert.equal(v.dimValue, 500);
});

test('detects a single (theme-agnostic) video', () => {
  const spec = { uuid: 'VID-3', lightFilename: 'media/videos/intro.mp4', darkFilename: null, dimMode: 'none', dimValue: null, inversed: false, rounded: false, playback: 'animation' };
  const found = locateVideoLines(bodyFor(spec));
  assert.equal(found.length, 1);
  assert.equal(found[0].single, true);
  assert.equal(found[0].darkFilename, null);
  assert.equal(found[0].dimMode, 'none');
});

test('a webm single video is recognised', () => {
  const body = '<video src="../assets/media/videos/clip.webm" controls playsinline preload="metadata"></video>';
  const [v] = locateVideoLines(body);
  assert.equal(v.single, true);
  assert.equal(v.lightFilename, 'media/videos/clip.webm');
  assert.equal(v.playback, 'clip');
});

test('ensureVideoUUIDs backfills a span before an unidentified video', () => {
  const body = '<video src="../assets/media/videos/intro.mp4" autoplay loop muted playsinline preload="none"></video>';
  const out = ensureVideoUUIDs(body);
  assert.match(out, /<span data-uuid="[^"]+" style="display:none"><\/span>\n<video/);
  // idempotent
  assert.equal(ensureVideoUUIDs(out), out);
});

console.log(`videoLocate: ${passed} passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/videoLocate.test.mjs`
Expected: FAIL — `locateVideoLines is not a function` (not exported yet).

- [ ] **Step 3: Write minimal implementation**

In `scripts/components.js`, add these regexes next to `LIGHT_LINE_RE` (after line 43):

```js
// Per-line video matchers. A <video> line carries its theme in the FILENAME
// (-light-mode / -dark-mode) like captures; the #only-* fragment is read
// separately to detect "inversed". Group 1 indent, group 2 filename (no hash),
// group 4 the #only side (light|dark) or undefined, group 5 the remaining attrs
// (used to read playback + style). A file with neither suffix is a single video.
const VIDEO_LINE_RE =
  /^(\s*)<video\s+src="\.\.\/assets\/([^"#]+?)(#only-(light|dark))?"\s*([^>]*?)\s*><\/video>\s*$/;
const VIDEO_LIGHT_SUFFIX_RE = /-light-mode\.[a-z0-9]+$/i;
const VIDEO_DARK_SUFFIX_RE = /-dark-mode\.[a-z0-9]+$/i;
```

Add the parse helpers (place after `parseDimAttrs`, ~line 65):

```js
/** Parse a <video>'s trailing attribute string into dim + rounding + playback. */
function parseVideoAttrs(attrs) {
  const a = attrs ?? '';
  const playback = /\bcontrols\b/.test(a) ? 'clip' : 'animation';
  const rounded = /border-radius/.test(a);
  const widthMatch = a.match(/width:\s*(\d+)px/);
  const heightMatch = a.match(/height:\s*(\d+)px/);
  let dimMode = 'none', dimValue = null;
  if (widthMatch) { dimMode = 'width'; dimValue = parseInt(widthMatch[1], 10); }
  else if (heightMatch) { dimMode = 'height'; dimValue = parseInt(heightMatch[1], 10); }
  return { dimMode, dimValue, rounded, playback };
}

/**
 * Locates every top-level video in `body`, returning line-addressable entries.
 * A `-light-mode` line whose next non-blank line is its `-dark-mode` partner is
 * a pair; a line with neither suffix is a single. `-dark-mode` lines are only
 * consumed as partners (never anchors), mirroring captures' DARK_LINE_RE.
 *
 * @param {string} body
 * @returns {Array<{lightFilename,darkFilename,single,dimMode,dimValue,rounded,inversed,playback,indent,uuid,startLine,endLine}>}
 */
export function locateVideoLines(body) {
  const lines = (body ?? '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(VIDEO_LINE_RE);
    if (!m) continue;
    const indent = m[1];
    const filename = m[2];
    // A dark-mode line is only ever a partner; never anchor a component on it.
    if (VIDEO_DARK_SUFFIX_RE.test(filename)) continue;

    const isLight = VIDEO_LIGHT_SUFFIX_RE.test(filename);
    const { dimMode, dimValue, rounded, playback } = parseVideoAttrs(m[5]);

    let single = true;
    let darkFilename = null;
    let inversed = false;
    let endLine = i + 1;

    if (isLight) {
      // The light file carrying #only-dark means the theme was inversed.
      inversed = m[4] === 'dark';
      const j = (() => { let k = i + 1; while (k < lines.length && lines[k] === '') k++; return k; })();
      const dm = j < lines.length ? lines[j].match(VIDEO_LINE_RE) : null;
      if (dm && VIDEO_DARK_SUFFIX_RE.test(dm[2])) {
        single = false;
        darkFilename = filename.replace('-light-mode', '-dark-mode');
        endLine = j + 1;
      }
    }

    // A hidden data-uuid span on the line immediately before this video is its
    // identity; extend startLine to swallow it.
    let startLine = i;
    let uuid = null;
    if (i > 0) {
      const sm = lines[i - 1].match(UUID_SPAN_LINE_RE);
      if (sm) { uuid = sm[1]; startLine = i - 1; }
    }

    out.push({ lightFilename: filename, darkFilename, single, dimMode, dimValue, rounded, inversed, playback, indent, uuid, startLine, endLine });
    i = endLine - 1;
  }
  return out;
}

/**
 * Backfills a hidden data-uuid span before every video that lacks one.
 * Idempotent; matches videos at any indent. Mirrors ensureCaptureUUIDs.
 */
export function ensureVideoUUIDs(markdown) {
  const vids = locateVideoLines(markdown);
  if (vids.length === 0) return markdown;
  const lines = (markdown ?? '').split('\n');
  let modified = false;
  for (let k = vids.length - 1; k >= 0; k--) {
    const v = vids[k];
    if (v.uuid) continue;
    const span = `${v.indent}<span data-uuid="${generateUUID()}" style="display:none"></span>`;
    lines.splice(v.startLine, 0, span);
    modified = true;
  }
  return modified ? lines.join('\n') : markdown;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/videoLocate.test.mjs`
Expected: PASS — `videoLocate: 5 passed`.

- [ ] **Step 5: Run the capture tests to confirm no regression**

Run: `node tests/captureThemeCorner.test.mjs && node tests/captureUuid.test.mjs`
Expected: both PASS (the new regexes/exports must not perturb capture parsing).

- [ ] **Step 6: Commit**

```bash
git add scripts/components.js tests/videoLocate.test.mjs
git commit -m "feat(videos): parse <video> markdown (locateVideoLines, ensureVideoUUIDs)"
```

---

### Task 3: Wire `video` kind into the component model

**Files:**
- Modify: `scripts/components.js` — import `buildVideoLines`; add the `video` branch to `parseComponents`, `buildComponentBody`, `uuidOfComponent`; add `videoDimFields`, `videoComponent`; extend `parsePastedComponents` ensure-chain.
- Test: `tests/videoComponent.test.mjs`

**Interfaces:**
- Consumes: `buildVideoLines` (Task 1); `locateVideoLines`, `ensureVideoUUIDs` (Task 2).
- Produces:
  `videoDimFields(vid): { dimMode, dimValue, captureTheme, captureCorner, videoPlayback }` (reuses `captureTheme`/`captureCorner` keys so the shared edit form's radios hydrate from them; adds `videoPlayback`).
  `videoComponent(vid): { kind:'video', vid }`. `parseComponents` now also returns `{ kind:'video', vid }` items; `buildComponentBody` and `uuidOfComponent` handle them.

- [ ] **Step 1: Write the failing test**

Create `tests/videoComponent.test.mjs`:

```js
import assert from 'node:assert/strict';
import { buildVideoLines } from '../scripts/videos.js';
import { parseComponents, buildComponentBody, videoDimFields, uuidOfComponent } from '../scripts/components.js';

const ADM_RE = /note|tip|step/;
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

test('videoDimFields maps a sized inversed clip to form-facing values', () => {
  const vid = { dimMode: 'width', dimValue: 800, inversed: true, rounded: true, playback: 'clip' };
  assert.deepEqual(videoDimFields(vid), { dimMode: 'width', dimValue: '800', captureTheme: 'inversed', captureCorner: 'enabled', videoPlayback: 'clip' });
});

test('videoDimFields of an auto/default video', () => {
  const vid = { dimMode: 'none', dimValue: null };
  assert.deepEqual(videoDimFields(vid), { dimMode: 'none', dimValue: '', captureTheme: 'default', captureCorner: 'disabled', videoPlayback: 'animation' });
});

test('a video round-trips through buildComponentBody / parseComponents', () => {
  const vid = { uuid: 'VID-1', lightFilename: 'media/videos/a-light-mode.mp4', darkFilename: 'media/videos/a-dark-mode.mp4', dimMode: 'width', dimValue: 1000, inversed: false, rounded: false, playback: 'animation' };
  const body = buildComponentBody(null, 'Desc', [{ kind: 'video', vid }]);
  const got = parseComponents(body, ADM_RE).components.find(c => c.kind === 'video')?.vid;
  assert.ok(got);
  assert.equal(got.lightFilename, 'media/videos/a-light-mode.mp4');
  assert.equal(got.darkFilename, 'media/videos/a-dark-mode.mp4');
  assert.equal(got.playback, 'animation');
  assert.equal(got.dimValue, 1000);
});

test('a single video round-trips', () => {
  const vid = { uuid: 'VID-2', lightFilename: 'media/videos/intro.mp4', darkFilename: null, dimMode: 'none', dimValue: null, inversed: false, rounded: false, playback: 'clip' };
  const body = buildComponentBody(null, '', [{ kind: 'video', vid }]);
  const got = parseComponents(body, ADM_RE).components.find(c => c.kind === 'video')?.vid;
  assert.equal(got.single, true);
  assert.equal(got.darkFilename, null);
  assert.equal(got.playback, 'clip');
});

test('a video interleaves with a capture in document order', () => {
  const cap = { uuid: 'CAP-1', lightFilename: 'a-light-mode.png', darkFilename: 'a-dark-mode.png', dimMode: 'none', dimValue: null, inversed: false, rounded: false };
  const vid = { uuid: 'VID-1', lightFilename: 'media/videos/b-light-mode.mp4', darkFilename: 'media/videos/b-dark-mode.mp4', dimMode: 'none', dimValue: null, inversed: false, rounded: false, playback: 'animation' };
  const body = buildComponentBody(null, '', [{ kind: 'capture', cap }, { kind: 'video', vid }]);
  const kinds = parseComponents(body, ADM_RE).components.map(c => c.kind);
  assert.deepEqual(kinds, ['capture', 'video']);
});

test('uuidOfComponent returns a video uuid', () => {
  assert.equal(uuidOfComponent({ kind: 'video', vid: { uuid: 'VID-9' } }), 'VID-9');
});

console.log(`videoComponent: ${passed} passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/videoComponent.test.mjs`
Expected: FAIL — `videoDimFields is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `scripts/components.js`:

(a) Extend the captures import (line 24) to also pull video emit:

```js
import { buildCaptureLines } from './captures.js';
import { buildVideoLines } from './videos.js';
```

(b) In `parseComponents`, after the `topCaptures` block (after line 167) add:

```js
  // Top-level videos: indent 0 and not buried inside an admonition or grid.
  const topVideos = locateVideoLines(src)
    .filter(v => v.indent === '' && !inContainer(v.startLine));
```

(c) In the `items` array literal, add a videos spread after the `topCaptures` spread (after line 200):

```js
    ...topVideos.map(v => ({
      kind: 'video',
      vid: { uuid: v.uuid ?? null, lightFilename: v.lightFilename, darkFilename: v.darkFilename, single: v.single, dimMode: v.dimMode, dimValue: v.dimValue, inversed: v.inversed, rounded: v.rounded, playback: v.playback },
      startLine: v.startLine,
      endLine: v.endLine,
    })),
```

(d) In the `components` mapping (after line 210, before the capture fallback `return`) add a video branch:

```js
    if (it.kind === 'video') return { kind: 'video', vid: it.vid };
```

(e) In `buildComponentBody`, add a `video` branch before the capture `else` (after the grid branch, ~line 275):

```js
    } else if (c.kind === 'video') {
      // buildVideoLines emits a leading '' we don't want (we add our own).
      lines.push(...buildVideoLines([c.vid]).slice(1));
```

(f) Add `videoDimFields` and `videoComponent` after `captureComponent` (after line 306):

```js
/**
 * Canonical form/merge representation of a video's editable fields. Reuses the
 * capture radio field names (captureTheme/captureCorner) so the SHARED edit form
 * hydrates both kinds from the same radios; adds videoPlayback for the
 * animation/clip toggle (video-only).
 */
export function videoDimFields(vid) {
  const dimMode = vid?.dimMode ?? 'none';
  return {
    dimMode,
    dimValue: dimMode === 'none' ? '' : String(vid?.dimValue ?? ''),
    captureTheme: vid?.inversed ? 'inversed' : 'default',
    captureCorner: vid?.rounded ? 'enabled' : 'disabled',
    videoPlayback: vid?.playback ?? 'animation',
  };
}

/** Builds a fresh video component from a (resolved) video object. */
export function videoComponent(vid) {
  return { kind: 'video', vid };
}
```

(g) In `uuidOfComponent`, add a video branch before the capture fallback (after line 318):

```js
  if (c.kind === 'video') return c.vid.uuid;
```

(h) Extend `parsePastedComponents`' ensure-chain (line 351) to include videos (outermost, after captures):

```js
  const withUuids = ensureVideoUUIDs(ensureCaptureUUIDs(ensureDataTableUUIDs(ensureGridUUIDs(ensureTabUUIDs(ensureAdmonitionUUIDs(stripped, GUIDE_ADMONITION_TYPES_RE))))));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/videoComponent.test.mjs`
Expected: PASS — `videoComponent: 6 passed`.

- [ ] **Step 5: Run the full pure-logic test suite for regressions**

Run: `for f in tests/capture*.test.mjs tests/video*.test.mjs tests/grid*.test.mjs; do node "$f" || break; done`
Expected: every file ends with `N passed` and no thrown assertion.

- [ ] **Step 6: Commit**

```bash
git add scripts/components.js tests/videoComponent.test.mjs
git commit -m "feat(videos): wire video kind into the component model (parse/build/dimFields)"
```

---

### Task 4: Video preview helpers (`videoCards.js`)

**Files:**
- Create: `scripts/videoCards.js`
- Test: `tests/videoBasePath.test.mjs`

**Interfaces:**
- Produces:
  `videoCard({ theme, title, src, alt? }): string` — a muted, paused `<video>` preview card (mirrors `captureCard`'s wrapper classes so existing CSS applies).
  `videoBasePath(path): string` — strips `media/videos/` (or `docs/assets/media/videos/`) prefix and the `-light-mode.<ext>`/`-dark-mode.<ext>` suffix (single videos keep their full name minus extension dir prefix).

- [ ] **Step 1: Write the failing test**

Create `tests/videoBasePath.test.mjs`:

```js
import assert from 'node:assert/strict';
import { videoBasePath } from '../scripts/videoCards.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

test('strips repo prefix and -light-mode suffix of a pair', () => {
  assert.equal(videoBasePath('docs/assets/media/videos/sites/x/tile-light-mode.mp4'), 'sites/x/tile');
});

test('strips library-relative prefix and -dark-mode suffix', () => {
  assert.equal(videoBasePath('media/videos/sites/x/tile-dark-mode.webm'), 'sites/x/tile');
});

test('a single video keeps its name (extension dropped)', () => {
  assert.equal(videoBasePath('media/videos/intro.mp4'), 'intro');
});

console.log(`videoBasePath: ${passed} passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/videoBasePath.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/videoCards.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/videoCards.js`:

```js
/**
 * videoCards.js — Shared video preview cards + path helper for the video insert
 * and edit forms. Reuses the capture card wrapper classes (so existing capture
 * CSS applies) but renders a muted, paused <video> instead of an <img>.
 */

const VIDEO_ROOT = 'docs/assets/media/videos';

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * One theme card holding a muted preview <video>. Returns '' when src is falsy
 * so callers can spread an array and let missing variants drop out.
 * @param {{theme:'light'|'dark', title:string, src:string, alt?:string}} opts
 */
export function videoCard({ theme, title, src, alt = '' }) {
  if (!src) return '';
  return `
    <figure class="mb-capture-card mb-capture-card--${theme}">
      <figcaption class="mb-capture-card__title">${title}</figcaption>
      <div class="mb-capture-card__image-wrap">
        <video class="mb-capture-card__img" src="${escapeAttr(src)}" muted playsinline preload="metadata" aria-label="${escapeAttr(alt)}"></video>
      </div>
    </figure>
  `;
}

/**
 * Reduce a stored video path to its theme-agnostic, root-relative base: strips
 * the media/videos prefix and the -light-mode/-dark-mode + extension suffix
 * (pairs), or just the prefix + extension (singles).
 * @param {string} path
 * @returns {string}
 */
export function videoBasePath(path) {
  if (!path) return '';
  let p = path;
  if (p.startsWith(VIDEO_ROOT + '/')) p = p.slice(VIDEO_ROOT.length + 1);
  else if (p.startsWith('media/videos/')) p = p.slice('media/videos/'.length);
  if (/-(light|dark)-mode\.[a-z0-9]+$/i.test(p)) return p.replace(/-(light|dark)-mode\.[a-z0-9]+$/i, '');
  return p.replace(/\.[a-z0-9]+$/i, '');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/videoBasePath.test.mjs`
Expected: PASS — `videoBasePath: 3 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/videoCards.js tests/videoBasePath.test.mjs
git commit -m "feat(videos): video preview card + base-path helper"
```

---

### Task 5: Pure media-tree builder (`mediaTree.js`) + library extraction

**Files:**
- Create: `scripts/mediaTree.js`
- Modify: `scripts/captureLibrary.js` (replace the inline `buildNodes` with an import + thin adapter; keep capture behaviour identical)
- Test: `tests/mediaTree.test.mjs`

**Interfaces:**
- Produces: `buildMediaNodes(blobPaths: string[], { root, exts }): Node[]` where
  `Node = { kind:'folder', label, children } | { kind:'file', label, attrs }`.
  Leaf `attrs` carry `data-media-base`, `data-media-light`, `data-media-dark`, `data-media-single` (full repo paths or `''`). Pairs collapse to one leaf (light+dark); non-suffixed files become single leaves (`data-media-single` set, light/dark `''`).
- Consumes (in captureLibrary): `buildMediaNodes`.

- [ ] **Step 1: Write the failing test**

Create `tests/mediaTree.test.mjs`:

```js
import assert from 'node:assert/strict';
import { buildMediaNodes } from '../scripts/mediaTree.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const IMG = { root: 'docs/assets/media/occ-captures', exts: ['png'] };
const VID = { root: 'docs/assets/media/videos', exts: ['mp4', 'webm'] };

test('image png pair collapses to one leaf with light+dark paths', () => {
  const nodes = buildMediaNodes([
    'docs/assets/media/occ-captures/x-light-mode.png',
    'docs/assets/media/occ-captures/x-dark-mode.png',
  ], IMG);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].kind, 'file');
  assert.equal(nodes[0].attrs['data-media-base'], 'x');
  assert.equal(nodes[0].attrs['data-media-light'], 'docs/assets/media/occ-captures/x-light-mode.png');
  assert.equal(nodes[0].attrs['data-media-dark'], 'docs/assets/media/occ-captures/x-dark-mode.png');
  assert.equal(nodes[0].attrs['data-media-single'], '');
});

test('video pair + single coexist, folders nest', () => {
  const nodes = buildMediaNodes([
    'docs/assets/media/videos/sites/tile-light-mode.mp4',
    'docs/assets/media/videos/sites/tile-dark-mode.mp4',
    'docs/assets/media/videos/intro.webm',
  ], VID);
  // folder "sites" first, then single "intro"
  assert.equal(nodes[0].kind, 'folder');
  assert.equal(nodes[0].label, 'sites');
  assert.equal(nodes[0].children[0].attrs['data-media-light'], 'docs/assets/media/videos/sites/tile-light-mode.mp4');
  const single = nodes.find(n => n.kind === 'file');
  assert.equal(single.attrs['data-media-single'], 'docs/assets/media/videos/intro.webm');
  assert.equal(single.attrs['data-media-light'], '');
});

test('extension filter excludes unrelated blobs', () => {
  const nodes = buildMediaNodes([
    'docs/assets/media/videos/a.mp4',
    'docs/assets/media/videos/notes.txt',
  ], VID);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].attrs['data-media-base'], 'a');
});

console.log(`mediaTree: ${passed} passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/mediaTree.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/mediaTree.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/mediaTree.js`:

```js
/**
 * mediaTree.js — Pure tree-builder for the media library (images + videos).
 *
 * Turns a flat list of repo blob paths into hierarchical folder/file nodes.
 * Light/dark pairs (-light-mode.<ext> / -dark-mode.<ext>) collapse to one leaf;
 * files with neither suffix become single leaves. Kept DOM-free so it can be
 * unit-tested and shared by the (DOM-bound) capture library.
 */

/**
 * @param {string[]} blobPaths - repo paths (already filtered to the media root).
 * @param {{root:string, exts:string[]}} cfg
 * @returns {Array<{kind:'folder',label:string,children:Array}|{kind:'file',label:string,attrs:object}>}
 */
export function buildMediaNodes(blobPaths, { root, exts }) {
  const extRe = new RegExp(`\\.(${exts.join('|')})$`, 'i');
  const lightRe = new RegExp(`-light-mode\\.(${exts.join('|')})$`, 'i');
  const darkRe = new RegExp(`-dark-mode\\.(${exts.join('|')})$`, 'i');

  const makeDir = () => ({ folders: new Map(), entries: new Map() });
  const tree = makeDir();

  for (const path of blobPaths) {
    if (!path.startsWith(root + '/') || !extRe.test(path)) continue;
    const relative = path.slice(root.length + 1);
    const parts = relative.split('/');
    const fileName = parts.pop();
    let cursor = tree;
    for (const part of parts) {
      if (!cursor.folders.has(part)) cursor.folders.set(part, makeDir());
      cursor = cursor.folders.get(part);
    }

    let baseId, variant;
    if (lightRe.test(fileName)) { baseId = fileName.replace(lightRe, ''); variant = 'light'; }
    else if (darkRe.test(fileName)) { baseId = fileName.replace(darkRe, ''); variant = 'dark'; }
    else { baseId = fileName; variant = 'single'; }

    if (!cursor.entries.has(baseId)) cursor.entries.set(baseId, { baseId });
    const entry = cursor.entries.get(baseId);
    if (variant === 'light') entry.light = path;
    else if (variant === 'dark') entry.dark = path;
    else entry.single = path;
  }

  function dirToNodes(dir) {
    const out = [];
    [...dir.folders.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([name, sub]) => {
      out.push({ kind: 'folder', label: name, children: dirToNodes(sub) });
    });
    [...dir.entries.values()].sort((a, b) => a.baseId.localeCompare(b.baseId)).forEach(entry => {
      // A single video's leaf label drops the file extension for readability.
      const label = entry.single ? entry.baseId.replace(/\.[a-z0-9]+$/i, '') : entry.baseId;
      out.push({
        kind: 'file',
        label,
        attrs: {
          'data-media-base': label,
          'data-media-light': entry.light ?? '',
          'data-media-dark': entry.dark ?? '',
          'data-media-single': entry.single ?? '',
        },
      });
    });
    return out;
  }

  return dirToNodes(tree);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/mediaTree.test.mjs`
Expected: PASS — `mediaTree: 3 passed`.

- [ ] **Step 5: Refactor `captureLibrary.js` to use it (keep capture behaviour identical)**

In `scripts/captureLibrary.js`:

Add the import near the top:

```js
import { buildMediaNodes } from './mediaTree.js';
```

Delete the inline `buildNodes` function (lines 25-83). Replace its single call site in `openCaptureLibrary` (line 125) and the leaf-attr reads in the click handler. Change the tree build (line 125-126) to:

```js
  const nodes = buildMediaNodes(blobs.map(b => b.path), { root: CAPTURE_ROOT, exts: ['png'] });
  panel.innerHTML = renderTree(nodes, { emptyMessage: 'No captures found.' });
```

Update `decorateCapturePills` (line 88) to read the new attr name:

```js
    const lightPath = leaf.dataset.mediaLight;
```

Update the click handler (lines 146-150) to read the new attrs:

```js
    const lightPath = fileEl.dataset.mediaLight;
    const darkPath = fileEl.dataset.mediaDark;
    const label = fileEl.dataset.mediaBase;
    if (!lightPath) return; // image library: a leaf with no light file isn't selectable
    getFormAction('openCaptureEntry')?.({ lightPath, darkPath, label, mode });
```

- [ ] **Step 6: Verify capture parsing tests + a node import smoke-check**

Run: `node tests/mediaTree.test.mjs && node -e "import('./scripts/mediaTree.js').then(()=>console.log('import ok'))"`
Expected: `mediaTree: 3 passed` then `import ok`.

(The library UI itself is verified manually in Task 10; `captureLibrary.js` imports DOM/chrome modules and is not unit-tested, matching the existing repo convention.)

- [ ] **Step 7: Commit**

```bash
git add scripts/mediaTree.js scripts/captureLibrary.js tests/mediaTree.test.mjs
git commit -m "refactor(library): extract pure buildMediaNodes; use data-media-* attrs"
```

---

### Task 6: Images/Videos tab strip in the library

**Files:**
- Modify: `config/forms/captureLibrary.html` (add a tab strip + a title that updates)
- Modify: `scripts/captureLibrary.js` (render the active media's tree; route video leaves to `openVideoEntry`; accept `{ media }` to preselect a tab)

**Interfaces:**
- Consumes: `buildMediaNodes` (Task 5); `getFormAction('openVideoEntry')` (Task 7 — wired by string, safe to reference before that task lands since it is only called at click time).
- Produces: `openCaptureLibrary({ mode, media })` where `media` is `'image'` (default) or `'video'`.

- [ ] **Step 1: Add the tab strip to the form HTML**

Replace the body of `config/forms/captureLibrary.html` with:

```html
<form data-nav id="capture-library-form" data-storage-key="moreButtonsCaptureLibrary" data-width="90vw" data-height="90vh">
  <h2 data-media-library-title>Media Library</h2>
  <div class="more-buttons-radio-btn-group-row" data-media-library-tabs>
    <button type="button" class="more-buttons-radio-btn --active" data-media-tab="image">Images</button>
    <button type="button" class="more-buttons-radio-btn" data-media-tab="video">Videos</button>
  </div>
  <div data-capture-library-panel></div>

  <div class="more-buttons-form-actions">
    <button type="button" class="more-buttons-button" data-action="startLibraryCapture"><span class="more-buttons-icon">add</span>Create new capture</button>
  </div>
</form>
```

- [ ] **Step 2: Make `openCaptureLibrary` media-aware**

In `scripts/captureLibrary.js`, add a media-config map near `CAPTURE_ROOT`:

```js
const VIDEO_ROOT = 'docs/assets/media/videos';
const MEDIA = {
  image: { root: CAPTURE_ROOT, exts: ['png'], empty: 'No captures found.', title: 'Capture Library' },
  video: { root: VIDEO_ROOT, exts: ['mp4', 'webm', 'mov', 'm4v'], empty: 'No videos found.', title: 'Video Library' },
};
```

Generalise the tree fetch so it can target either root. Replace `listCaptureTree` (lines 11-23) with:

```js
async function listMediaTree(root) {
  const auth = await authHeader();
  const url = `https://api.github.com/repos/${REPO.owner}/${REPO.name}/git/trees/${REPO.branch}?recursive=1`;
  const res = await fetch(url, { headers: { 'Authorization': auth }, cache: 'no-store' });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const data = await res.json();
  return (data.tree ?? [])
    .filter(e => e.type === 'blob' && e.path.startsWith(root + '/') && e.path !== MANIFEST_PATH)
    .map(e => e.path);
}
```

Rewrite `openCaptureLibrary` to render the active tab and re-render on tab clicks. Replace lines 96-152 with:

```js
export async function openCaptureLibrary({ mode, media = 'image' } = {}) {
  const insertMode = mode === 'insert';
  const opener = () => openCaptureLibrary({ mode, media });
  const { formEl } = await createForm('captureLibrary', opener);
  if (!formEl) return;

  const contentEl = formEl.parentElement ?? formEl;
  // "Create new capture" is image-only and routes away from this form, so hide
  // it in insert mode (and whenever the Videos tab is active — no create path).
  const createBtn = contentEl.querySelector('[data-action="startLibraryCapture"]');
  const panel = formEl.querySelector('[data-capture-library-panel]');
  const titleEl = formEl.querySelector('[data-media-library-title]');
  if (!panel) return;

  let current = media;

  function syncChrome() {
    formEl.querySelectorAll('[data-media-tab]').forEach(b =>
      b.classList.toggle('--active', b.dataset.mediaTab === current));
    if (titleEl) titleEl.textContent = MEDIA[current].title;
    // Hide the image-only "Create new capture" action in insert mode or on Videos.
    createBtn?.style.setProperty('display', (insertMode || current === 'video') ? 'none' : '');
  }

  async function renderMedia() {
    const cfg = MEDIA[current];
    syncChrome();
    formLoading.show();
    let paths;
    try {
      paths = await listMediaTree(cfg.root);
    } catch (e) {
      panel.innerHTML = `<p class="more-buttons-description">Failed to load ${current}s: ${e.message}</p>`;
      return;
    } finally {
      formLoading.dismiss();
    }
    const nodes = buildMediaNodes(paths, { root: cfg.root, exts: cfg.exts });
    panel.innerHTML = renderTree(nodes, { emptyMessage: cfg.empty });
    if (current === 'image') decorateCapturePills(panel, await readCaptureMeta());
  }

  formEl.addEventListener('input', e => {
    const searchEl = e.target.closest('.mb-kb-search');
    if (!searchEl) return;
    const tree = panel.querySelector('.mb-kb-tree');
    if (tree) applySearch(tree, searchEl.value);
  });

  formEl.addEventListener('click', e => {
    const tab = e.target.closest('[data-media-tab]');
    if (tab) {
      if (tab.dataset.mediaTab !== current) { current = tab.dataset.mediaTab; renderMedia(); }
      return;
    }
    const sectionRow = e.target.closest('[data-kb-section]');
    if (sectionRow) {
      sectionRow.closest('.mb-kb-node')?.classList.toggle('--collapsed');
      return;
    }
    const fileEl = e.target.closest('[data-kb-leaf]');
    if (!fileEl) return;
    if (current === 'video') {
      const lightPath = fileEl.dataset.mediaLight;
      const darkPath = fileEl.dataset.mediaDark;
      const singlePath = fileEl.dataset.mediaSingle;
      const label = fileEl.dataset.mediaBase;
      getFormAction('openVideoEntry')?.({ lightPath, darkPath, singlePath, label, mode });
    } else {
      const lightPath = fileEl.dataset.mediaLight;
      if (!lightPath) return;
      getFormAction('openCaptureEntry')?.({ lightPath, darkPath: fileEl.dataset.mediaDark, label: fileEl.dataset.mediaBase, mode });
    }
  });

  await renderMedia();
}
```

(`decorateCapturePills` keeps its Task-5 `data-media-light` read; the standalone `listCaptureTree` is now gone — confirm no other references remain.)

- [ ] **Step 3: Verify nothing else referenced the old name**

Run: `grep -rn "listCaptureTree\|buildNodes\b" scripts/`
Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add config/forms/captureLibrary.html scripts/captureLibrary.js
git commit -m "feat(library): Images/Videos tab strip; route video leaves to video entry"
```

---

### Task 7: Video insert-review form (`videoEntry.js`)

**Files:**
- Create: `scripts/videoEntry.js`
- Create: `config/forms/videoEntry.html`

**Interfaces:**
- Consumes: `videoCard`, `videoBasePath` (Task 4); `captureSizeField`, `wireCaptureSizeField`, `readCaptureSizeField` (existing `captureCards.js`); `readRepoBlob` (existing); `completeComponentVideoInsert` form action (Task 8).
- Produces: form action `openVideoEntry({ lightPath, darkPath, singlePath, label, mode })`. On "Insert this video" it dispatches `completeComponentVideoInsert({ video })` with
  `video = { lightFilename, darkFilename|null, dimMode, dimValue, inversed, rounded, playback }` (repo `docs/assets/` prefix stripped from filenames).

- [ ] **Step 1: Create the form template**

Create `config/forms/videoEntry.html`:

```html
<form data-nav id="video-entry-form" data-storage-key="moreButtonsVideoEntry" data-width="90vw" data-height="90vh">
  <h2 data-video-entry-title>Insert video</h2>
  <div data-video-entry-body></div>
  <div class="more-buttons-form-actions" data-video-entry-actions></div>
</form>
```

- [ ] **Step 2: Create the form script**

Create `scripts/videoEntry.js`:

```js
/**
 * videoEntry.js — the insert-review form for a library video. Unlike captures
 * there is no create/recapture path: videos are uploaded manually, so this form
 * only previews the chosen video(s) and lets the user set Size / Animation-Clip
 * / Theme / Corner before inserting. On insert it hands a resolved video spec to
 * videos.js (completeComponentVideoInsert), which commits it into the container.
 */

import { createForm, navigateBack } from './form.js';
import { readRepoBlob } from './repoClient.js';
import { registerFormAction, getFormAction } from './formActions.js';
import { captureGrid, captureSizeField, wireCaptureSizeField, readCaptureSizeField } from './captureCards.js';
import { videoCard, videoBasePath } from './videoCards.js';
import { formLoading } from './loading.js';

const STRIP = 'docs/assets/';
const stripPrefix = (p) => (p && p.startsWith(STRIP) ? p.slice(STRIP.length) : p);

// lightPath/darkPath/singlePath are full repo paths like
// "docs/assets/media/videos/foo-light-mode.mp4". Exactly one of (lightPath) or
// (singlePath) is set by the library: a pair carries light+dark, a single carries
// singlePath.
export async function openVideoEntry({ lightPath, darkPath, singlePath, label, mode } = {}) {
  const primaryPath = singlePath || lightPath;
  if (!primaryPath) return;
  const isSingle = !!singlePath && !lightPath;

  const opener = () => openVideoEntry({ lightPath, darkPath, singlePath, label, mode });
  const { formEl } = await createForm('videoEntry', opener);
  if (!formEl) return;

  const contentEl = formEl.parentElement ?? formEl;
  const titleEl = formEl.querySelector('[data-video-entry-title]');
  const bodyEl = formEl.querySelector('[data-video-entry-body]');
  const actionsEl = contentEl.querySelector('[data-video-entry-actions]');
  if (titleEl) titleEl.textContent = `Insert video — ${videoBasePath(primaryPath)}`;

  let lightUrl = '', darkUrl = '';
  const revoke = (u) => { if (u?.startsWith('blob:')) URL.revokeObjectURL(u); };

  function radioGroup(name, legend, options) {
    const items = options.map(([v, lbl, checked]) =>
      `<label class="more-buttons-radio-btn"><input type="radio" name="${name}" value="${v}"${checked ? ' checked' : ''} /> ${lbl}</label>`).join('');
    return `<div class="more-buttons-form-group"><label class="more-buttons-label">${legend}</label><div class="more-buttons-radio-btn-group-row">${items}</div></div>`;
  }

  function render() {
    const cards = isSingle
      ? [videoCard({ theme: 'light', title: 'Video', src: lightUrl, alt: label ?? 'video' })]
      : [
          videoCard({ theme: 'light', title: 'Light mode', src: lightUrl, alt: label ?? 'light mode' }),
          videoCard({ theme: 'dark', title: 'Dark mode', src: darkUrl, alt: `${label ?? 'video'} (dark)` }),
        ];
    bodyEl.innerHTML =
      captureGrid(cards) +
      captureSizeField({ dimMode: 'width', dimValue: 1000 }) +
      radioGroup('videoPlayback', 'Playback', [['animation', 'Animation', true], ['clip', 'Clip', false]]) +
      (isSingle ? '' : radioGroup('captureTheme', 'Theme', [['default', 'Default', true], ['inversed', 'Inversed', false]])) +
      radioGroup('captureCorner', 'Corner rounding', [['disabled', 'Disabled', true], ['enabled', 'Enabled', false]]);
    wireCaptureSizeField(bodyEl);
    actionsEl.innerHTML =
      `<button type="button" class="more-buttons-button secondary" data-video-entry-cancel><span class="more-buttons-icon">close</span>Cancel</button>
       <button type="button" class="more-buttons-button" data-video-entry-insert><span class="more-buttons-icon">add</span>Insert this video</button>`;
  }

  function readRadio(name, fallback) {
    return formEl.querySelector(`[name="${name}"]:checked`)?.value ?? fallback;
  }

  function insert() {
    const { dimMode, dimValue } = readCaptureSizeField(bodyEl);
    const video = {
      lightFilename: stripPrefix(primaryPath),
      darkFilename: isSingle ? null : stripPrefix(darkPath || lightPath.replace('-light-mode', '-dark-mode')),
      dimMode, dimValue,
      inversed: !isSingle && readRadio('captureTheme', 'default') === 'inversed',
      rounded: readRadio('captureCorner', 'disabled') === 'enabled',
      playback: readRadio('videoPlayback', 'animation'),
    };
    getFormAction('completeComponentVideoInsert')?.({ video });
  }

  (formEl.parentElement ?? formEl).addEventListener('click', (e) => {
    if (e.target.closest('[data-video-entry-insert]')) insert();
    else if (e.target.closest('[data-video-entry-cancel]')) navigateBack();
  });

  formLoading.show();
  try {
    const [lb, db] = await Promise.all([
      readRepoBlob(primaryPath).catch(() => null),
      (!isSingle && darkPath) ? readRepoBlob(darkPath).catch(() => null) : Promise.resolve(null),
    ]);
    revoke(lightUrl); revoke(darkUrl);
    lightUrl = lb ? URL.createObjectURL(lb) : '';
    darkUrl = db ? URL.createObjectURL(db) : '';
  } finally {
    formLoading.dismiss();
  }
  render();
}

registerFormAction('openVideoEntry', openVideoEntry);
```

- [ ] **Step 3: Import-smoke the module under node**

Run: `node -e "import('./scripts/videoEntry.js').then(()=>console.log('import ok')).catch(e=>{console.error(e);process.exit(1)})"`
Expected: `import ok` (top-level only registers a form action; no DOM access at import).

- [ ] **Step 4: Commit**

```bash
git add scripts/videoEntry.js config/forms/videoEntry.html
git commit -m "feat(videos): insert-review form (videoEntry)"
```

---

### Task 8: Video insert commit flow (in `videos.js`)

**Files:**
- Modify: `scripts/videos.js` (add the library-insert flow + commit + form action)

**Interfaces:**
- Consumes: `getComponentContainer`, `snapshotFormStack`, `replayFormStack`, `formLoading`, `generateUUID`, `getFormAction`/`registerFormAction` (all already imported in Task 1's `videos.js`).
- Produces:
  `runComponentVideoLibraryInsert({ container, insertAt })` — opens the library on the Videos tab in insert mode.
  Form action `completeComponentVideoInsert({ video })` — replays the origin form stack and splices a `{ kind:'video', vid }` component at `insertAt`.

- [ ] **Step 1: Append the insert flow to `videos.js`**

Add to the end of `scripts/videos.js`:

```js
// ── Components: video acquisition that commits immediately ─────────────────────
//
// Videos are library-only, so there is just ONE acquisition route: browse the
// library, pick a video, set its options on the review form, commit. No bytes
// are ever uploaded (the file already exists in the repo).

async function commitVideosIntoContainer(container, insertAt, vidList) {
  const handler = getComponentContainer(container.kind);
  if (!handler) return [];
  const inserted = vidList.map(v => ({
    kind: 'video',
    vid: {
      uuid: generateUUID(),
      lightFilename: v.lightFilename,
      darkFilename: v.darkFilename ?? null,
      single: !v.darkFilename,
      dimMode: v.dimMode ?? 'width',
      dimValue: v.dimMode === 'none' ? null : (v.dimValue ?? 1000),
      inversed: !!v.inversed,
      rounded: !!v.rounded,
      playback: v.playback ?? 'animation',
    },
  }));
  await handler.mutate(container, (components) => {
    const idx = Math.max(0, Math.min(insertAt, components.length));
    const next = components.slice();
    next.splice(idx, 0, ...inserted);
    return next;
  });
  return inserted;
}

// Single pending video-insert intent: where the chosen video commits. Set when
// the library opens in video insert mode; consumed by completeComponentVideoInsert.
let pendingVideoInsert = null; // { snapshot, container, insertAt } | null

// Commit the chosen video into the origin container. Called by videoEntry's
// Insert button. Mirrors captures' completeComponentInsert: replay the origin
// form stack, then splice the video component into the container's markdown.
registerFormAction('completeComponentVideoInsert', async ({ video } = {}) => {
  const intent = pendingVideoInsert;
  if (!intent || !video || !intent.snapshot?.length) return;
  formLoading.show();
  try {
    const ok = await replayFormStack(intent.snapshot);
    if (!ok) { alert('Failed to insert video: could not restore the originating form.'); return; }
    formLoading.show();
    await commitVideosIntoContainer(intent.container, intent.insertAt, [video]);
    pendingVideoInsert = null;
  } catch (e) {
    alert('Failed to insert video: ' + e.message);
  } finally {
    formLoading.dismiss();
  }
});

// "Video" insert → browse library (Videos tab) → review → commit at idx.
export function runComponentVideoLibraryInsert({ container, insertAt }) {
  pendingVideoInsert = { snapshot: snapshotFormStack(), container, insertAt };
  return getFormAction('openCaptureLibrary')?.({ mode: 'insert', media: 'video' });
}
```

- [ ] **Step 2: Import-smoke the module**

Run: `node -e "import('./scripts/videos.js').then(m=>console.log(typeof m.runComponentVideoLibraryInsert==='function'?'ok':'missing')).catch(e=>{console.error(e);process.exit(1)})"`
Expected: `ok`.

- [ ] **Step 3: Re-run the video markdown tests (no regression to buildVideoLines)**

Run: `node tests/videoBuildLines.test.mjs`
Expected: PASS — `videoBuildLines: 8 passed`.

- [ ] **Step 4: Commit**

```bash
git add scripts/videos.js
git commit -m "feat(videos): library-insert commit flow (completeComponentVideoInsert)"
```

---

### Task 9: Make the edit form kind-aware (images or videos)

**Files:**
- Modify: `config/forms/editCaptureComponent.html` (add a video-only Playback group + a heading hook)
- Modify: `scripts/captureComponent.js` (add `openEditVideoComponent`; branch save on media kind; video preview)

**Interfaces:**
- Consumes: `videoDimFields` (Task 3); `videoCard` (Task 4); `videoComponent` model.
- Produces: form action `openEditVideoComponent({ container, uuid, vid })`. The existing `submitEditCaptureComponent` / `deleteCaptureComponent` actions handle both kinds, branching on `formEl.dataset.mediaKind` (`'capture'` | `'video'`).

- [ ] **Step 1: Add the Playback group to the form HTML**

In `config/forms/editCaptureComponent.html`, change the heading (line 2) to a hookable element and add a Playback group (hidden by default — shown only for videos). Replace lines 2 and insert the group before the Theme group (after line 6 `<div data-capture-component-size></div>`):

```html
  <h2 data-edit-media-title>Edit capture</h2>
```

```html
  <div class="more-buttons-form-group" data-video-playback-group hidden>
    <label class="more-buttons-label">Playback</label>
    <div class="more-buttons-radio-btn-group-row">
      <label class="more-buttons-radio-btn"><input type="radio" name="videoPlayback" value="animation" checked /> Animation</label>
      <label class="more-buttons-radio-btn"><input type="radio" name="videoPlayback" value="clip" /> Clip</label>
    </div>
  </div>
```

- [ ] **Step 2: Generalise `captureComponent.js`**

In `scripts/captureComponent.js`:

(a) Extend imports (lines 14, 17) — this is the FINAL form of both lines (Step 2e
adds nothing further):

```js
import { captureCard, captureGrid, captureSizeField, wireCaptureSizeField } from './captureCards.js';
import { videoCard } from './videoCards.js';
import { captureDimFields, videoDimFields, uuidOfComponent } from './components.js';
```

(b) Refactor `openEditCaptureComponent` into a shared kind-aware opener. Replace lines 27-77 with:

```js
export async function openEditCaptureComponent({ container, uuid, cap } = {}) {
  return openEditMediaComponent({ kind: 'capture', container, uuid, media: cap });
}
registerFormAction('openEditCaptureComponent', openEditCaptureComponent);

export async function openEditVideoComponent({ container, uuid, vid } = {}) {
  return openEditMediaComponent({ kind: 'video', container, uuid, media: vid });
}
registerFormAction('openEditVideoComponent', openEditVideoComponent);

async function openEditMediaComponent({ kind, container, uuid, media } = {}) {
  if (!container || !media) return;
  const isVideo = kind === 'video';
  const fieldsFn = isVideo ? videoDimFields : captureDimFields;
  const opener = () => openEditMediaComponent({ kind, container, uuid, media });

  await chrome.storage.local.set({ moreButtonsEditCaptureComponent: fieldsFn(media) });

  const { formEl } = await createForm('editCaptureComponent', opener);
  if (!formEl) return;
  formEl.dataset.containerKind = container.kind;
  formEl.dataset.containerUuid = container.uuid;
  formEl.dataset.containerFile = container.file;
  formEl.dataset.componentUuid = uuid;
  formEl.dataset.mediaKind = kind;

  const titleEl = formEl.querySelector('[data-edit-media-title]');
  if (titleEl) titleEl.textContent = isVideo ? 'Edit video' : 'Edit capture';

  // Playback radios are video-only; Theme is meaningless for a single video.
  const playbackGroup = formEl.querySelector('[data-video-playback-group]');
  if (playbackGroup) playbackGroup.hidden = !isVideo;
  if (isVideo && !media.darkFilename) {
    formEl.querySelector('[name="captureTheme"]')?.closest('.more-buttons-form-group')?.setAttribute('hidden', '');
  }

  const previewEl = formEl.querySelector('[data-capture-component-preview]');
  if (previewEl) {
    formLoading.show();
    try {
      const [lightBlob, darkBlob] = await Promise.all([
        readRepoBlob('docs/assets/' + media.lightFilename).catch(() => null),
        media.darkFilename ? readRepoBlob('docs/assets/' + media.darkFilename).catch(() => null) : Promise.resolve(null),
      ]);
      const lightUrl = lightBlob ? URL.createObjectURL(lightBlob) : '';
      const darkUrl = darkBlob ? URL.createObjectURL(darkBlob) : '';
      const card = isVideo ? videoCard : captureCard;
      previewEl.innerHTML = captureGrid([
        card({ theme: 'light', title: media.darkFilename ? 'Light mode' : 'Preview', src: lightUrl, alt: 'light mode' }),
        card({ theme: 'dark', title: 'Dark mode', src: darkUrl, alt: 'dark mode' }),
      ]);
    } finally {
      formLoading.dismiss();
    }
  }

  const sizeHost = formEl.querySelector('[data-capture-component-size]');
  if (sizeHost) {
    const dim = fieldsFn(media);
    sizeHost.innerHTML = captureSizeField({ dimMode: dim.dimMode, dimValue: dim.dimValue });
    wireCaptureSizeField(formEl);
  }
  resetDirtyBaseline(formEl);
}
```

(c) Make the save action branch on kind. Replace the `submitEditCaptureComponent` body (lines 91-140) with a kind-aware version:

```js
registerFormAction('submitEditCaptureComponent', async ({ formEl, content }) => {
  const { handler, container, uuid } = readContainerRef(formEl);
  if (!handler) return;
  const isVideo = formEl.dataset.mediaKind === 'video';
  const btn = content?.querySelector('[data-save-state]');
  setButtonBusy(btn, 'Saving…');

  const modeSel = formEl.querySelector('[name="dimMode"]');
  const valInput = formEl.querySelector('[name="dimValue"]');
  if (modeSel?.value === 'none' && valInput) valInput.value = '';

  const baseSpecs = [
    { name: 'dimMode', type: 'scalar', label: 'Dimension mode' },
    { name: 'dimValue', type: 'scalar', label: 'Dimension value' },
    { name: 'captureTheme', type: 'scalar', label: 'Theme' },
    { name: 'captureCorner', type: 'scalar', label: 'Corner rounding' },
  ];
  const fieldSpecs = isVideo
    ? [...baseSpecs, { name: 'videoPlayback', type: 'scalar', label: 'Playback' }]
    : baseSpecs;

  try {
    await mergeSave({
      formEl,
      file: container.file,
      onProgress: s => setButtonBusy(btn, s),
      fieldSpecs,
      readFresh: md => {
        const { components } = handler.readComponents(md, container.uuid);
        if (isVideo) {
          const vid = components.find(c => c.kind === 'video' && c.vid.uuid === uuid)?.vid;
          return videoDimFields(vid);
        }
        const cap = components.find(c => c.kind === 'capture' && c.cap.uuid === uuid)?.cap;
        return captureDimFields(cap);
      },
      build: (md, resolved) => {
        const { description, components } = handler.readComponents(md, container.uuid);
        const mode = resolved.dimMode ?? 'none';
        const raw = parseInt(resolved.dimValue, 10);
        const dimValue = mode === 'none' ? null : (Number.isFinite(raw) && raw > 0 ? raw : 50);
        const inversed = resolved.captureTheme === 'inversed';
        const rounded = resolved.captureCorner === 'enabled';
        const next = components.map(c => {
          if (isVideo && c.kind === 'video' && c.vid.uuid === uuid) {
            return { kind: 'video', vid: { ...c.vid, dimMode: mode, dimValue, inversed: c.vid.single ? false : inversed, rounded, playback: resolved.videoPlayback ?? 'animation' } };
          }
          if (!isVideo && c.kind === 'capture' && c.cap.uuid === uuid) {
            return { kind: 'capture', cap: { ...c.cap, dimMode: mode, dimValue, inversed, rounded } };
          }
          return c;
        });
        return handler.writeBody(md, container.uuid, description, next);
      },
    });
    formEl._refreshSaveState?.();
  } catch (e) {
    formEl._refreshSaveState?.();
    alert('Failed to save: ' + e.message);
  }
});
```

(d) Make delete kind-aware. Replace the `deleteCaptureComponent` filter (lines 142-160) so it removes either kind by uuid:

```js
registerFormAction('deleteCaptureComponent', async ({ formEl, content }) => {
  const isVideo = formEl.dataset.mediaKind === 'video';
  const noun = isVideo ? 'video' : 'capture';
  if (!confirm(`Delete this ${noun}? This removes it from the page (the file stays in the library).`)) return;
  const { handler, container, uuid } = readContainerRef(formEl);
  if (!handler) return;
  const btn = content?.querySelector('[data-action="deleteCaptureComponent"]');
  const snap = snapshotButton(btn);
  setButtonBusy(btn, 'Deleting…');
  try {
    await handler.mutate(container, (components) =>
      components.filter(c => uuidOfComponent(c) !== uuid),
      s => setButtonBusy(btn, s));
    await chrome.storage.local.remove('moreButtonsEditCaptureComponent');
    await navigateBack();
  } catch (e) {
    restoreButton(btn, snap);
    alert(`Failed to delete ${noun}: ` + e.message);
  }
});
```

(e) (`uuidOfComponent` is already imported in Step 2a — used by the kind-agnostic
delete filter in (d). Nothing to add here.)

- [ ] **Step 2b: Verify the import line is not duplicated**

The file now imports from `./components.js` exactly once. Run:
Run: `grep -n "from './components.js'" scripts/captureComponent.js`
Expected: exactly one line.

- [ ] **Step 3: Import-smoke the module**

Run: `node -e "import('./scripts/captureComponent.js').then(()=>console.log('import ok')).catch(e=>{console.error(e);process.exit(1)})"`
Expected: `import ok`.

- [ ] **Step 4: Re-run the capture dim-fields test (capture save path unchanged)**

Run: `node tests/captureDimFields.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add config/forms/editCaptureComponent.html scripts/captureComponent.js
git commit -m "feat(videos): kind-aware edit form (edit images or videos)"
```

---

### Task 10: Menu item, dispatch, list rendering, manifest

**Files:**
- Modify: `scripts/insertMenu.js` (add a top-level **Video** item + handler key)
- Modify: `scripts/guides.js` (import video flow; `video` insert handler; `runChildAction` insert + `edit-video`; `openEditorForComponent` video branch; `renderComponents` video card; the two `labelMap` blocks; click delegation for `data-edit-video-component`)
- Modify: `manifest.json` (register `scripts/videos.js`, `scripts/videoEntry.js`, `scripts/videoCards.js`, `scripts/mediaTree.js`)

**Interfaces:**
- Consumes: `runComponentVideoLibraryInsert` (Task 8), `openEditVideoComponent` form action (Task 9), `videoComponentCard` rendering.

- [ ] **Step 1: Add the Video menu item**

In `scripts/insertMenu.js`, add a `Video` item after the Capture submenu (after line 45) in the non-`capturesOnly` template:

```js
    <button type="button" class="mb-popup-menu__item" data-pick="video" role="menuitem">Video</button>
```

Update the JSDoc handlers type (line 22) to include `video:Function`, and add a `pick` branch (after line 72):

```js
    else if (kind === 'video') handlers.video?.(insertAtIndex);
```

- [ ] **Step 2: Wire the insert handler + dispatch in guides.js**

In `scripts/guides.js`:

(a) Add a new import line beneath the captures import (line 35). Leave the
existing `runComponentCaptureFlow, runComponentLibraryInsert` import from
`./captures.js` untouched — `runComponentVideoLibraryInsert` lives in `videos.js`:

```js
import { runComponentVideoLibraryInsert } from './videos.js';
```

(b) Add the menu handler in `onComponentEditorClick` (after line 1083):

```js
      video: (i) => beginChildNavigation(formEl, { type: 'insert', kind: 'video', insertAt: i }),
```

(c) Add the insert branch in `runChildAction` (after line 999):

```js
    else if (action.kind === 'video') await runComponentVideoLibraryInsert({ container, insertAt: action.insertAt });
```

(d) Add an `edit-video` action in `runChildAction` (after the `edit-capture` branch, line 1007):

```js
  } else if (action.type === 'edit-video') {
    await openVideoComponentEditor(container, action.uuid);
```

(e) Add the click-delegation branch in `onComponentEditorClick` (after the `editCap` block, line 1056):

```js
  const editVid = e.target.closest('[data-edit-video-component]');
  if (editVid) {
    beginChildNavigation(formEl, { type: 'edit-video', uuid: editVid.dataset.editVideoComponent });
    return;
  }
```

(f) Add the `video` branch to `openEditorForComponent` (after line 1103):

```js
  } else if (component.kind === 'video') {
    await getFormAction('openEditVideoComponent')?.({ container, uuid: component.vid.uuid, vid: component.vid });
```

- [ ] **Step 3: Add `openVideoComponentEditor` (mirror `openCaptureComponentEditor`)**

The real `openCaptureComponentEditor` (scripts/guides.js:1115-1121) reads the
file fresh and looks the component up via `readContainerComponents`:

```js
async function openCaptureComponentEditor(container, uuid) {
  const md = await readRepoText(container.file);
  const { components } = readContainerComponents(md, container);
  const c = components.find(x => x.kind === 'capture' && x.cap.uuid === uuid);
  if (!c) return;
  await openEditorForComponent(container, c);
}
```

Add a video twin directly beneath it — identical shape, `kind:'video'`,
`c.vid.uuid`. `openEditorForComponent`'s video branch (Step 2f) already routes
to `openEditVideoComponent`, so this just finds the component:

```js
async function openVideoComponentEditor(container, uuid) {
  const md = await readRepoText(container.file);
  const { components } = readContainerComponents(md, container);
  const c = components.find(x => x.kind === 'video' && x.vid.uuid === uuid);
  if (!c) return;
  await openEditorForComponent(container, c);
}
```

- [ ] **Step 4a: Add a `videoComponentCard` to `cardRenderer.js`**

`captureComponentCard` (scripts/cardRenderer.js:34) hardcodes an `<img>` thumb
and a "Capture" badge, so videos get their own card. Add beneath it (the file
already imports `escapeHtml`):

```js
// A "Video" component card: same chrome as captureComponentCard but a muted
// inline <video> thumbnail (paused, first-frame poster) and a Video badge.
// `thumbSrc` is the light/single video's CDN url.
export function videoComponentCard({ thumbSrc, btnAttr, btnLabel = 'Edit', copyAttr = '' }) {
  return `
  <div class="mb-incident-card --grey mb-component-card--capture">
    <div class="mb-incident-card__head">
      <strong class="mb-incident-card__title">Video</strong>
      <span class="mb-incident-card__badge">Video</span>
    </div>
    ${thumbSrc ? `<div class="mb-incident-card__body mb-component-card__thumb-row"><video class="mb-component-card__thumb" src="${escapeHtml(thumbSrc)}" muted playsinline preload="metadata"></video></div>` : ''}
    <div class="mb-incident-card__foot --end">
      ${copyAttr ? `<button type="button" class="mb-incident-card__edit" ${copyAttr}>Copy</button>` : ''}
      <button type="button" class="mb-incident-card__edit" ${btnAttr}>${btnLabel}</button>
    </div>
  </div>`;
}
```

- [ ] **Step 4b: Render video components in the list**

In `scripts/guides.js`, extend the cardRenderer import (line 36) to also pull the
new card:

```js
import { escapeHtml, captureComponentCard, videoComponentCard } from './cardRenderer.js';
```

Add a `videoComponentCardFor` helper next to `captureComponentCardFor` (after line 880):

```js
function videoComponentCardFor(vid) {
  return videoComponentCard({
    thumbSrc: assetCdnUrl('docs/assets/' + vid.lightFilename),
    btnAttr: `data-edit-video-component="${escapeHtml(vid.uuid ?? '')}"`,
    copyAttr: vid.uuid ? `data-copy-component-md="${escapeHtml(vid.uuid)}"` : '',
  });
}
```

In `renderComponents`, add the video branch (after the grid branch, line 910):

```js
    } else if (c.kind === 'video') {
      card = videoComponentCardFor(c.vid);
```

(Change the trailing `} else {` capture fallback to remain the capture branch — it already is.)

- [ ] **Step 5: Add video to the two label maps**

In `scripts/guides.js` there are two `labelMap[...]` blocks (around lines 1324-1334 and 1819-1829) that set a thumb for captures. Add a video case to BOTH, right after the capture case:

```js
      } else if (c.kind === 'video') {
        labelMap[c.vid.uuid] = { kind: 'video', thumbSrc: assetCdnUrl('docs/assets/' + c.vid.lightFilename) };
```

> NOTE TO IMPLEMENTER: match the exact `if/else if` chain style at each site (one uses `c.kind === 'admonition'` ladders ending in a capture `else`/`else if`). Insert the video case as an `else if (c.kind === 'video')` before the capture fallback so captures still match.

- [ ] **Step 6: Register the new scripts in the manifest**

In `manifest.json`, inside the `web_accessible_resources[0].resources` array (alongside the other `scripts/*.js` near line 27-91), add:

```json
        "scripts/videos.js",
        "scripts/videoEntry.js",
        "scripts/videoCards.js",
        "scripts/mediaTree.js",
```

- [ ] **Step 7: Validate JSON + import the whole graph**

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')"`
Run: `node -e "import('./scripts/guides.js').then(()=>console.log('guides import ok')).catch(e=>{console.error(e);process.exit(1)})"`
Expected: `manifest ok` then `guides import ok`.

- [ ] **Step 8: Run the entire pure-logic test suite**

Run: `for f in tests/*.test.mjs; do node "$f" >/dev/null 2>&1 && echo "ok  $f" || echo "FAIL $f"; done`
Expected: every line starts with `ok` (no `FAIL`).

- [ ] **Step 9: Commit**

```bash
git add scripts/insertMenu.js scripts/guides.js manifest.json
git commit -m "feat(videos): Video insert menu item, dispatch, list rendering, manifest"
```

---

### Task 11: Manual smoke test in the extension

**Files:** none (verification only).

This feature's UI layers (`captureLibrary.js`, `videoEntry.js`, `captureComponent.js`, `guides.js`) are not unit-tested in this repo, matching the existing capture convention — so verify them in the running extension.

- [ ] **Step 1: Reload the extension**

Open `chrome://extensions`, reload the extension (required after any `manifest.json` change — otherwise dynamic imports 404 with the stale manifest).

- [ ] **Step 2: Insert a video pair**

In a guide section/admonition editor: **+ Insert Component → Video** → library opens on the **Videos** tab → pick a `-light-mode`/`-dark-mode` pair → set Width + Animation → **Insert this video**. Confirm the component appears with a muted `<video>` thumbnail and the page markdown contains two `<video … #only-light>` / `<#only-dark>` lines (no `{ … }` braces).

- [ ] **Step 3: Insert a single video + edit it**

Insert a single (no-suffix) video → confirm one `<video>` line, no `#only` fragment. Click **Edit** on it → confirm the Theme group is hidden, Playback shows, and switching to **Clip** + Save rewrites the line to `controls … preload="metadata"`.

- [ ] **Step 4: Confirm captures still work**

Insert a capture from the library (Images tab) and edit it — confirm no regression from the shared-form / tab changes.

- [ ] **Step 5: Final commit (if any doc tweaks)**

```bash
git commit --allow-empty -m "test(videos): manual smoke verified (pairs, singles, clip, capture regression)"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** emit format (Task 1), parse/round-trip incl. inversed/clip/single (Tasks 2-3), library tab + singles (Tasks 5-6), insert review with the four options (Task 7), commit (Task 8), kind-aware edit form (Task 9), menu/dispatch/list/manifest (Task 10). v1 exclusions (caption/poster/multi-source) are never emitted.
- **Type consistency:** `video.darkFilename === null` ⇔ single throughout; `videoDimFields` reuses `captureTheme`/`captureCorner` keys (shared radios) + adds `videoPlayback`; the edit save branches on `formEl.dataset.mediaKind`.
- **Known follow-ups (out of scope, note if touched):** like captures/grids, `ensureVideoUUIDs` does not skip leading YAML frontmatter (same accepted limitation as the other `ensure*UUIDs`).
```
