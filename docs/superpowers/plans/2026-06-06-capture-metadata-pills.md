# Capture Metadata Pills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record per-capture `resized` (boolean) and `padding` (px) metadata in a single JSON manifest on GitHub, and show them as RESIZED / PADDED pills on the capture-library tree.

**Architecture:** Metadata is captured at screenshot time (resize-confirm computes whether dimensions actually changed; `screenshotElement` reports the padding it actually applied), threaded into the `sessionBuffer` entry, and written to `docs/assets/occ-captures/.captures-meta.json` via an authoritative upsert on every push/recapture (set entry when resized/padded, delete when plain — this prevents stale pills after recapture or delete-then-recapture). The library reads the manifest once on open and decorates tree leaves with pills, mirroring the existing KB Drafting/Live pill mechanism.

**Tech Stack:** Vanilla ES modules (Chrome MV3 extension, no build step). Tests are plain `.mjs` files using `node:assert/strict`, run with `node tests/<file>.test.mjs`. GitHub Contents API for storage. Pure logic is unit-tested; chrome/DOM/network glue is verified manually by loading the extension.

**Execution mode:** Subagent-driven (superpowers:subagent-driven-development) — a fresh subagent implements each task in order, with a two-stage review between tasks. Tasks 1, 2, 3, 4, 6, 7, 8, 9 are fully automatable (code + `node` checks). Tasks 5 and 10 contain manual Chrome-load verification steps that must be handed back to the human operator rather than run by a subagent.

---

## File Structure

- **Create** `scripts/captureMeta.js` — manifest path constant, pure helpers (`applyMetaUpserts`, `captureMetaPills`), and thin I/O (`readCaptureMeta`, `writeCaptureMeta`). One responsibility: the metadata manifest.
- **Create** `tests/captureMetadata.test.mjs` — unit tests for the pure helpers (`applyMetaUpserts`, `captureMetaPills`) and `dimensionsChanged`.
- **Modify** `scripts/captureElement.js` — add pure `dimensionsChanged` helper; `enterResizeMode` passes `resized` to its confirm callback; `screenshotElement` returns `appliedPadding`.
- **Modify** `scripts/captureMode.js` — thread `resized` through `onPick`/`finishCapture`/`handleCapture`; add `resized`/`padding` to the buffer entry.
- **Modify** `scripts/captures.js` — `pushCaptures` collects upserts and writes the manifest once.
- **Modify** `scripts/captureEntry.js` — recapture `saveChanges` upserts the manifest for the reused path.
- **Modify** `scripts/captureLibrary.js` — exclude the manifest from the tree; fetch it and decorate leaves with pills.
- **Modify** `config/forms/formsStyling.css` — `--resized` / `--padded` pill accent colors.
- **Modify** `manifest.json` — register `scripts/captureMeta.js` in `web_accessible_resources`.

---

## Task 1: captureMeta.js pure core (manifest path, upsert, pills)

**Files:**
- Create: `scripts/captureMeta.js`
- Test: `tests/captureMetadata.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/captureMetadata.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import { applyMetaUpserts, captureMetaPills } from '../scripts/captureMeta.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const P1 = 'docs/assets/occ-captures/a-light-mode.png';
const P2 = 'docs/assets/occ-captures/b-light-mode.png';

// ── applyMetaUpserts ──────────────────────────────────────────────────────────
test('applyMetaUpserts adds a resized+padded entry', () => {
  const out = applyMetaUpserts({}, [{ lightPath: P1, resized: true, padding: 24 }]);
  assert.deepEqual(out, { [P1]: { resized: true, padding: 24 } });
});
test('applyMetaUpserts omits resized when false and padding when 0', () => {
  const out = applyMetaUpserts({}, [{ lightPath: P1, resized: false, padding: 16 }]);
  assert.deepEqual(out, { [P1]: { padding: 16 } });
  const out2 = applyMetaUpserts({}, [{ lightPath: P1, resized: true, padding: 0 }]);
  assert.deepEqual(out2, { [P1]: { resized: true } });
});
test('applyMetaUpserts stores nothing for a plain capture', () => {
  const out = applyMetaUpserts({}, [{ lightPath: P1, resized: false, padding: 0 }]);
  assert.deepEqual(out, {});
});
test('applyMetaUpserts DELETES a stale entry when the new capture is plain', () => {
  const prior = { [P1]: { resized: true, padding: 24 }, [P2]: { padding: 8 } };
  const out = applyMetaUpserts(prior, [{ lightPath: P1, resized: false, padding: 0 }]);
  assert.deepEqual(out, { [P2]: { padding: 8 } });
});
test('applyMetaUpserts overwrites a stale entry with new metadata', () => {
  const prior = { [P1]: { resized: true, padding: 24 } };
  const out = applyMetaUpserts(prior, [{ lightPath: P1, resized: false, padding: 8 }]);
  assert.deepEqual(out, { [P1]: { padding: 8 } });
});
test('applyMetaUpserts does not mutate its input', () => {
  const prior = { [P1]: { resized: true } };
  applyMetaUpserts(prior, [{ lightPath: P1, resized: false, padding: 0 }]);
  assert.deepEqual(prior, { [P1]: { resized: true } });
});
test('applyMetaUpserts applies a batch of mixed upserts', () => {
  const out = applyMetaUpserts({}, [
    { lightPath: P1, resized: true, padding: 0 },
    { lightPath: P2, resized: false, padding: 12 },
  ]);
  assert.deepEqual(out, { [P1]: { resized: true }, [P2]: { padding: 12 } });
});

// ── captureMetaPills ──────────────────────────────────────────────────────────
test('captureMetaPills returns empty string for no/empty meta', () => {
  assert.equal(captureMetaPills(undefined), '');
  assert.equal(captureMetaPills({}), '');
});
test('captureMetaPills renders a resized pill', () => {
  const html = captureMetaPills({ resized: true });
  assert.ok(html.includes('mb-kb-pills'));
  assert.ok(html.includes('mb-kb-pill --resized'));
  assert.ok(html.includes('>Resized<'));
  assert.ok(!html.includes('--padded'));
});
test('captureMetaPills renders a padded pill with the px value', () => {
  const html = captureMetaPills({ padding: 24 });
  assert.ok(html.includes('mb-kb-pill --padded'));
  assert.ok(html.includes('Padded: 24px'));
  assert.ok(!html.includes('--resized'));
});
test('captureMetaPills renders both pills, resized before padded', () => {
  const html = captureMetaPills({ resized: true, padding: 16 });
  assert.ok(html.indexOf('--resized') < html.indexOf('--padded'));
});

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/captureMetadata.test.mjs`
Expected: FAIL — `Cannot find module '.../scripts/captureMeta.js'` (or similar import error).

- [ ] **Step 3: Create `scripts/captureMeta.js` with the pure helpers**

```javascript
/**
 * captureMeta.js — Capture metadata manifest.
 *
 * A single JSON file maps each capture's light-PNG repo path to its metadata
 * ({ resized?: true, padding?: number }). The library reads it once on open to
 * render RESIZED / PADDED pills; push/recapture flows write it with an
 * authoritative upsert (set when resized/padded, delete when plain) so a
 * recaptured or deleted-then-recaptured path never keeps stale metadata.
 *
 * Pure helpers (applyMetaUpserts, captureMetaPills) are unit-tested. The I/O
 * helpers below them use the GitHub Contents API and are verified manually.
 */

import { readRepoText } from './repoClient.js';
import { githubFetchAndPushFile } from './github.js';

export const MANIFEST_PATH = 'docs/assets/occ-captures/.captures-meta.json';

/**
 * Apply upserts to a manifest, returning a NEW object (input untouched).
 * Each upsert is { lightPath, resized, padding }. The rule is authoritative:
 * if the capture is resized or padded, its entry is set to exactly that
 * metadata; otherwise the key is deleted (clearing any stale entry).
 */
export function applyMetaUpserts(manifest, upserts) {
  const next = { ...manifest };
  for (const u of upserts) {
    const entry = {};
    if (u.resized) entry.resized = true;
    if (u.padding > 0) entry.padding = u.padding;
    if (Object.keys(entry).length) next[u.lightPath] = entry;
    else delete next[u.lightPath];
  }
  return next;
}

/**
 * Build the pills HTML for one capture's metadata. Returns '' when there is
 * nothing to show. Matches the KB pill structure (.mb-kb-pills > .mb-kb-pill).
 */
export function captureMetaPills(meta) {
  if (!meta) return '';
  const pills = [];
  if (meta.resized) pills.push('<span class="mb-kb-pill --resized">Resized</span>');
  if (meta.padding > 0) pills.push(`<span class="mb-kb-pill --padded">Padded: ${meta.padding}px</span>`);
  if (!pills.length) return '';
  return `<span class="mb-kb-pills">${pills.join('')}</span>`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/captureMetadata.test.mjs`
Expected: PASS — all `applyMetaUpserts` and `captureMetaPills` tests print `ok -`, ends with `N passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/captureMeta.js tests/captureMetadata.test.mjs
git commit -m "feat(captures): manifest upsert + pill helpers"
```

---

## Task 2: captureMeta.js I/O (read + write the manifest)

**Files:**
- Modify: `scripts/captureMeta.js`

No unit test — these wrap network/chrome calls. Verified manually at the end of the plan.

- [ ] **Step 1: Append the I/O helpers to `scripts/captureMeta.js`**

Add below `captureMetaPills`:

```javascript
/**
 * Read and parse the manifest. Returns {} if the file is missing or unparseable
 * (readRepoText returns '' on 404). Never throws — a metadata read failure must
 * not break the library.
 */
export async function readCaptureMeta() {
  try {
    const text = await readRepoText(MANIFEST_PATH);
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

/**
 * Apply a batch of upserts to the manifest on GitHub. No-op for an empty batch.
 * Reuses githubFetchAndPushFile (read-modify-write with sha, 409 retry, queued)
 * so the modify happens against server-fresh content.
 */
export async function writeCaptureMeta(upserts, onProgress) {
  if (!upserts || !upserts.length) return;
  await githubFetchAndPushFile(MANIFEST_PATH, onProgress, (currentText) => {
    let manifest = {};
    try { manifest = currentText ? JSON.parse(currentText) : {}; } catch { manifest = {}; }
    return JSON.stringify(applyMetaUpserts(manifest, upserts), null, 2) + '\n';
  });
}
```

- [ ] **Step 2: Sanity-check the module still imports cleanly**

Run: `node -e "import('./scripts/captureMeta.js').then(m => console.log(Object.keys(m).join(',')))"`
Expected: prints `MANIFEST_PATH,applyMetaUpserts,captureMetaPills,readCaptureMeta,writeCaptureMeta` (order may vary). No error.

- [ ] **Step 3: Re-run the unit test to confirm nothing broke**

Run: `node tests/captureMetadata.test.mjs`
Expected: PASS (same as Task 1 Step 4).

- [ ] **Step 4: Commit**

```bash
git add scripts/captureMeta.js
git commit -m "feat(captures): manifest read/write I/O"
```

---

## Task 3: Register captureMeta.js in manifest.json

**Files:**
- Modify: `manifest.json`

New `scripts/*.js` modules must be listed individually in `web_accessible_resources` or dynamic import fails at runtime ("Failed to fetch dynamically imported module").

- [ ] **Step 1: Find the resources list**

Run: `grep -n "scripts/captures.js\|scripts/captureMode.js\|web_accessible_resources" manifest.json`
Expected: shows the `web_accessible_resources[].resources` array containing the other `scripts/*.js` entries.

- [ ] **Step 2: Add the entry**

In `manifest.json`, inside the first `web_accessible_resources` entry's `resources` array, add `"scripts/captureMeta.js"` right after the `"scripts/captures.js"` line (line 25), matching the existing indentation and trailing-comma style. The result:

```json
        "scripts/captures.js",
        "scripts/captureMeta.js",
        "scripts/form.js",
```

(Exact neighbours don't matter — only that it's a sibling string entry with correct commas.)

- [ ] **Step 3: Verify the JSON is still valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('valid')"`
Expected: prints `valid`.

- [ ] **Step 4: Confirm the entry is present**

Run: `grep -n "scripts/captureMeta.js" manifest.json`
Expected: one matching line.

- [ ] **Step 5: Commit**

```bash
git add manifest.json
git commit -m "chore: register captureMeta.js as web-accessible"
```

---

## Task 4: dimensionsChanged helper (resize change detection)

**Files:**
- Modify: `scripts/captureElement.js`
- Test: `tests/captureMetadata.test.mjs`

- [ ] **Step 1: Add failing tests for `dimensionsChanged`**

In `tests/captureMetadata.test.mjs`, change the top import line to also import the helper:

```javascript
import { applyMetaUpserts, captureMetaPills } from '../scripts/captureMeta.js';
import { dimensionsChanged } from '../scripts/captureElement.js';
```

Then add these tests just before the final `console.log(...)` line:

```javascript
// ── dimensionsChanged ─────────────────────────────────────────────────────────
test('dimensionsChanged is false when width and height are unchanged', () => {
  assert.equal(dimensionsChanged({ width: 100, height: 50 }, { width: 100, height: 50 }), false);
});
test('dimensionsChanged ignores sub-pixel jitter (rounds)', () => {
  assert.equal(dimensionsChanged({ width: 100.2, height: 50.4 }, { width: 100.1, height: 49.6 }), false);
});
test('dimensionsChanged is true when width changes', () => {
  assert.equal(dimensionsChanged({ width: 100, height: 50 }, { width: 140, height: 50 }), true);
});
test('dimensionsChanged is true when height changes', () => {
  assert.equal(dimensionsChanged({ width: 100, height: 50 }, { width: 100, height: 80 }), true);
});
test('dimensionsChanged ignores position-only differences', () => {
  // box carries top/left too, but only size counts
  assert.equal(dimensionsChanged({ width: 100, height: 50 }, { width: 100, height: 50, top: 999, left: 7 }), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/captureMetadata.test.mjs`
Expected: FAIL — `dimensionsChanged is not a function` / import has no such export.

- [ ] **Step 3: Add the helper to `scripts/captureElement.js`**

Add near the top of the resize section (just above `// ── Resize mode (draggable box) ──`, around line 343):

```javascript
/**
 * Did the user actually change the capture's size? Compares the initial element
 * rect against the final resize box, width/height only (rounded so sub-pixel
 * layout jitter doesn't count). Position changes do not count as a resize.
 */
export function dimensionsChanged(initRect, box) {
  return Math.round(box.width) !== Math.round(initRect.width)
      || Math.round(box.height) !== Math.round(initRect.height);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/captureMetadata.test.mjs`
Expected: PASS — all tests print `ok -`, ends with `N passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/captureElement.js tests/captureMetadata.test.mjs
git commit -m "feat(captures): dimensionsChanged resize detector"
```

---

## Task 5: Capture-time metadata (engine + controller wiring)

**Files:**
- Modify: `scripts/captureElement.js:336-340` (`screenshotElement` return) and `enterResizeMode` confirm call (~line 446-458)
- Modify: `scripts/captureMode.js:368-419` (`onPick` resize/non-resize branches, `finishCapture`, `handleCapture`)

No unit test (DOM + chrome glue); verified by manual load at the end.

- [ ] **Step 1: Have `screenshotElement` report the padding it actually applied**

In `scripts/captureElement.js`, the return at the end of `screenshotElement` (currently lines 336-340) reads:

```javascript
  const finalDataUrl = (padding > 0 && sampledBgColor)
    ? await expandWithBackground(maskedDataUrl, sampledBgColor, padding, originalWidth)
    : maskedDataUrl;

  return { dataUrl: finalDataUrl, filename: deriveFilename(el, theme, settings) };
```

Replace it with (compute the effective padding once, reuse it, and return it):

```javascript
  const appliedPadding = (padding > 0 && sampledBgColor) ? padding : 0;
  const finalDataUrl = appliedPadding
    ? await expandWithBackground(maskedDataUrl, sampledBgColor, appliedPadding, originalWidth)
    : maskedDataUrl;

  return { dataUrl: finalDataUrl, filename: deriveFilename(el, theme, settings), appliedPadding };
```

- [ ] **Step 2: Pass `resized` from `enterResizeMode`'s confirm callback**

In `scripts/captureElement.js`, find the Enter handler inside `enterResizeMode` that calls `onConfirm` (around line 453-458). It currently passes the box snapshot, e.g.:

```javascript
      onConfirm?.({ ...box });
```

Change it to also pass the resized flag computed via the new helper:

```javascript
      onConfirm?.({ ...box }, dimensionsChanged(initRect, box));
```

(`initRect` and `box` are both in scope here — `initRect` is the const snapshot taken at the top of `enterResizeMode`.)

- [ ] **Step 3: Thread `resized` through `onPick` in `scripts/captureMode.js`**

In `scripts/captureMode.js`, update `finishCapture` and both capture branches inside `onPick` (currently lines 368-392).

Change `finishCapture` (line 368-371) to accept and forward `resized`:

```javascript
    const finishCapture = (light, dark, resized) => {
      if (!light || !dark) return;
      handleCapture(light, dark, resized);
    };
```

In the resize branch (lines 374-382), capture the second callback arg and pass it on:

```javascript
      if (settings.resizeMode) {
        await new Promise(resolve => {
          enterResizeMode(target, settings, async (rect, resized) => {
            const light = await screenshotElement(target, { theme: 'light', customRect: rect, settings });
            const dark  = await screenshotElement(target, { theme: 'dark',  customRect: rect, settings });
            finishCapture(light, dark, resized);
            resolve();
          }, () => resolve());
        });
      } else {
```

In the non-resize branch (lines 383-392), pass `false`:

```javascript
        const light = await screenshotElement(target, { theme: 'light', settings });
        const dark  = await screenshotElement(target, { theme: 'dark',  settings });
        finishCapture(light, dark, false);
```

- [ ] **Step 4: Store `resized`/`padding` on the buffer entry in `handleCapture`**

In `scripts/captureMode.js`, update `handleCapture` (lines 410-419) to accept `resized` and record both values (padding comes from the light frame's `appliedPadding`):

```javascript
  function handleCapture(light, dark, resized) {
    sessionBuffer.push({
      lightDataUrl: light.dataUrl,
      lightFilename: light.filename,
      darkDataUrl: dark.dataUrl,
      darkFilename: dark.filename,
      resized: !!resized,
      padding: light.appliedPadding || 0,
      dimMode: 'height',
      dimValue: 50,
      addToLibrary: true,
    });
    refreshCounter();
    pulseCounter();
    persistSession(snapshotForSession());
    if (ctx.maxCaptures && sessionBuffer.length >= ctx.maxCaptures) {
      sweepBottomBorder();
      exitCaptureMode();
      return;
    }
    sweepBottomBorder();
  }
```

- [ ] **Step 5: Confirm session persistence needs no change**

The buffer is persisted via `persistSession(snapshotForSession())`. `snapshotForSession` (line 283) copies the buffer with `sessionBuffer: sessionBuffer.slice()` — a shallow array copy that keeps each entry object intact, so the new `resized`/`padding` fields are persisted automatically.

Run: `grep -n "sessionBuffer: sessionBuffer.slice()" scripts/captureMode.js`
Expected: one match — confirms whole-entry copy. No edit needed in this step.

- [ ] **Step 6: Manual smoke test (load the extension)**

Load the unpacked extension in Chrome (`chrome://extensions` → Reload). In a page, open Capture Mode, and with DevTools open on the content script, capture one element normally and one in resize mode after dragging a handle. Add a temporary log if helpful, e.g. before `sessionBuffer.push` log `{ resized, padding: light.appliedPadding }`. Confirm: normal capture → `resized:false, padding:0` (with padding 0); resize-without-dragging → `resized:false`; resize-with-drag → `resized:true`; padding set in the bar and a sampleable background → `padding` equals the set value. Remove any temporary log.

Expected: the logged metadata matches the actions. No console errors.

- [ ] **Step 7: Commit**

```bash
git add scripts/captureElement.js scripts/captureMode.js
git commit -m "feat(captures): capture resized + applied padding metadata"
```

---

## Task 6: Write the manifest on push (captures.js)

**Files:**
- Modify: `scripts/captures.js` (imports + `pushCaptures`, lines 18-23 and 56-61)

`pushCaptures` is the single choke point for every library/system-update push, so writing the manifest here covers all push paths at once. Captures lacking the new fields default to no entry (safe).

- [ ] **Step 1: Import the writer**

In `scripts/captures.js`, add to the imports block (after the `githubPushImageIfNotExists` import, ~line 18):

```javascript
import { writeCaptureMeta } from './captureMeta.js';
```

- [ ] **Step 2: Collect upserts and write once after the image loop**

Replace `pushCaptures` (lines 56-61):

```javascript
export async function pushCaptures(list = [], onProgress) {
  const upserts = [];
  for (const c of list) {
    if (!c.lightDataUrl) continue;
    await githubPushImageIfNotExists(`docs/assets/${c.lightFilename}`, c.lightDataUrl.split(',')[1], onProgress);
    await githubPushImageIfNotExists(`docs/assets/${c.darkFilename}`, c.darkDataUrl.split(',')[1], onProgress);
    upserts.push({ lightPath: `docs/assets/${c.lightFilename}`, resized: !!c.resized, padding: c.padding || 0 });
  }
  await writeCaptureMeta(upserts, onProgress);
}
```

- [ ] **Step 3: Verify imports resolve**

Run: `node -e "import('./scripts/captures.js').then(()=>console.log('ok'))"`
Expected: prints `ok` (no missing-module error). (chrome/DOM refs are lazy, so import succeeds in node.)

- [ ] **Step 4: Commit**

```bash
git add scripts/captures.js
git commit -m "feat(captures): write metadata manifest on push"
```

---

## Task 7: Upsert the manifest on recapture (captureEntry.js)

**Files:**
- Modify: `scripts/captureEntry.js` (imports ~line 4, `saveChanges` lines 110-137)

The recapture/override flow reuses the existing path and writes via `githubReplaceImage` (not `pushCaptures`), so it needs its own upsert. This is the authoritative-write that clears or updates pills when an existing capture is recaptured.

- [ ] **Step 1: Import the writer**

In `scripts/captureEntry.js`, add after the `githubReplaceImage` import (line 4):

```javascript
import { writeCaptureMeta } from './captureMeta.js';
```

- [ ] **Step 2: Upsert after the image replace**

In `saveChanges` (lines 123-131), after both `githubReplaceImage` calls and before `setStatus('Saved. Refreshing preview…')`, add the upsert keyed on the (unchanged) `lightPath`:

```javascript
    try {
      await githubReplaceImage(lightPath, pendingCapture.lightDataUrl.split(',')[1], setStatus);
      if (darkPath && pendingCapture.darkDataUrl) {
        await githubReplaceImage(darkPath, pendingCapture.darkDataUrl.split(',')[1], setStatus);
      }
      await writeCaptureMeta(
        [{ lightPath, resized: !!pendingCapture.resized, padding: pendingCapture.padding || 0 }],
        setStatus,
      );
      setStatus('Saved. Refreshing preview…');
```

(The rest of the `try` block — `pendingCapture = null; await loadRepoImages(); renderPreview();` — is unchanged.)

- [ ] **Step 3: Verify imports resolve**

Run: `node -e "import('./scripts/captureEntry.js').then(()=>console.log('ok')).catch(e=>{console.error(e.message);process.exit(1)})"`
Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add scripts/captureEntry.js
git commit -m "feat(captures): upsert metadata on recapture"
```

---

## Task 8: Pill styles (formsStyling.css)

**Files:**
- Modify: `config/forms/formsStyling.css:2214-2215`

- [ ] **Step 1: Add the two accent rules**

In `config/forms/formsStyling.css`, immediately after the existing accents:

```css
.mb-kb-pill.--live     { --mb-pill-accent: rgb(102, 187, 106); }
.mb-kb-pill.--drafting { --mb-pill-accent: rgb(255, 179, 0); }
```

add:

```css
.mb-kb-pill.--resized  { --mb-pill-accent: rgb(255, 179, 0); }  /* same yellow as Drafting */
.mb-kb-pill.--padded   { --mb-pill-accent: rgb(66, 165, 245); } /* Material blue */
```

- [ ] **Step 2: Confirm the rules are present**

Run: `grep -n "mb-kb-pill.--resized\|mb-kb-pill.--padded" config/forms/formsStyling.css`
Expected: two matching lines.

- [ ] **Step 3: Commit**

```bash
git add config/forms/formsStyling.css
git commit -m "style(captures): RESIZED (yellow) + PADDED (blue) pill accents"
```

---

## Task 9: Show pills in the capture library (captureLibrary.js)

**Files:**
- Modify: `scripts/captureLibrary.js` (imports line 1-5, `listCaptureTree` line 19, `openCaptureLibrary` after line 110)

- [ ] **Step 1: Import the manifest helpers**

In `scripts/captureLibrary.js`, add after the existing imports (after line 5):

```javascript
import { MANIFEST_PATH, readCaptureMeta, captureMetaPills } from './captureMeta.js';
```

- [ ] **Step 2: Exclude the manifest from the tree listing**

In `listCaptureTree` (line 19), the return currently is:

```javascript
  return (data.tree ?? []).filter(e => e.type === 'blob' && e.path.startsWith(CAPTURE_ROOT + '/'));
```

Change it to skip the manifest file (it lives under `CAPTURE_ROOT` and must not appear as a leaf):

```javascript
  return (data.tree ?? []).filter(e =>
    e.type === 'blob' && e.path.startsWith(CAPTURE_ROOT + '/') && e.path !== MANIFEST_PATH);
```

- [ ] **Step 3: Add the pill decorator**

In `scripts/captureLibrary.js`, add this function above `export async function openCaptureLibrary` (e.g. after `buildNodes`, ~line 80):

```javascript
// Append RESIZED / PADDED pills to each capture leaf from the manifest. Mirrors
// decorateKbPills in knowledgeBaseManagement.js. Keyed by the leaf's light path.
function decorateCapturePills(panel, meta) {
  panel.querySelectorAll('[data-kb-leaf]').forEach(leaf => {
    const lightPath = leaf.dataset.captureLight;
    if (!lightPath) return;
    const html = captureMetaPills(meta[lightPath]);
    if (html) leaf.insertAdjacentHTML('beforeend', html);
  });
}
```

- [ ] **Step 4: Fetch the manifest and decorate after rendering the tree**

In `openCaptureLibrary`, the tree is rendered at line 110:

```javascript
  const nodes = buildNodes(blobs);
  panel.innerHTML = renderTree(nodes, { emptyMessage: 'No captures found.' });
```

Immediately after that `panel.innerHTML = renderTree(...)` line, add:

```javascript
  const captureMeta = await readCaptureMeta();
  decorateCapturePills(panel, captureMeta);
```

(`readCaptureMeta` never throws — it returns `{}` on any failure, so a metadata hiccup leaves the tree pill-less rather than broken.)

- [ ] **Step 5: Verify imports resolve**

Run: `node -e "import('./scripts/captureLibrary.js').then(()=>console.log('ok')).catch(e=>{console.error(e.message);process.exit(1)})"`
Expected: prints `ok`.

- [ ] **Step 6: Commit**

```bash
git add scripts/captureLibrary.js
git commit -m "feat(captures): show RESIZED/PADDED pills in capture library"
```

---

## Task 10: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Reload the extension**

`chrome://extensions` → Reload the unpacked extension. Confirm no manifest/load errors.

- [ ] **Step 2: New plain capture → no pills**

Capture an element with no resize and padding 0, save it to the library. Open the Capture Library and locate the new entry. Expected: no pills. Confirm `docs/assets/occ-captures/.captures-meta.json` either has no key for it (or does not exist yet if this is the first-ever capture).

- [ ] **Step 3: Resized + padded capture → both pills**

Capture another element: enable resize mode and drag a handle to change its size, set padding (e.g. 24px) in the bar over an element with a sampleable background, and save. Reopen the library. Expected: a yellow **RESIZED** pill and a blue **PADDED: 24PX** pill on that entry. Confirm the manifest has `{ "<light path>": { "resized": true, "padding": 24 } }`.

- [ ] **Step 4: Resize mode without dragging → no RESIZED pill**

Capture an element: enter resize mode but confirm without changing the size. Expected: no RESIZED pill on that entry.

- [ ] **Step 5: Recapture clears stale metadata**

Open the resized+padded entry from Step 3, choose Recapture, and recapture it plainly (no resize, padding 0). Save. Reopen the library. Expected: the pills are gone for that entry, and its key is removed from the manifest (its path is unchanged).

- [ ] **Step 6: Manifest is not a tree leaf**

In the Capture Library tree, confirm `.captures-meta.json` does **not** appear as an entry anywhere.

- [ ] **Step 7: Run the full unit suite once more**

Run: `node tests/captureMetadata.test.mjs`
Expected: PASS.

- [ ] **Step 8: Final commit (if any verification fixes were made)**

```bash
git add -A
git commit -m "test(captures): verify metadata pills end-to-end"
```

(Skip if Steps 1-7 required no code changes.)

---

## Self-Review Notes

- **Spec coverage:** manifest file (Task 1/2), exclusion from tree (Task 9), authoritative upsert incl. delete-on-plain (Task 1 tests + Tasks 6/7), resized detection ignoring no-op resize (Task 4/5), effective/applied padding (Task 5), library read + pills (Task 9), pill CSS yellow/blue (Task 8), new module registered (Task 3), recapture path (Task 7). All spec sections map to a task.
- **Type consistency:** `applyMetaUpserts(manifest, upserts)`, `captureMetaPills(meta)`, `readCaptureMeta()`, `writeCaptureMeta(upserts, onProgress)`, `dimensionsChanged(initRect, box)`, `MANIFEST_PATH`, and the upsert shape `{ lightPath, resized, padding }` and entry shape `{ resized?, padding? }` are used identically across Tasks 1, 2, 4, 6, 7, 9.
- **Known limitation (per spec, accepted):** a PNG that is manually deleted and never recaptured leaves an inert manifest key; harmless because the library only renders pills for files present in the tree.
