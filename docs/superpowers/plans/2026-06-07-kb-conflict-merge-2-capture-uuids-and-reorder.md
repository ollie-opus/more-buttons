# KB Conflict Merge — Plan 2: Capture UUIDs & Component Reorder

> **For agentic workers:** REQUIRED SUB-SKILL: Use **superpowers:subagent-driven-development** to implement this plan task-by-task — this is the chosen execution mode (same as Plan 1): a fresh subagent per task, a two-stage review between tasks (spec compliance → code quality), and a commit per task. Steps use checkbox (`- [ ]`) syntax for tracking. Do the tasks strictly in order (A1 → A8 → B1 → B8); the dependency notes in "Self-review notes" are binding.

**Goal:** Give captures stable UUIDs (killing the latent wrong-target bug and making capture edits a UUID-keyed scalar merge), then add up/down reorder of the components inside every component-container (guide section, admonition, system-update body) routed through the conflict-merge engine so reorder can never reintroduce last-write-wins clobbering.

**Architecture:** Two parts in one plan. **Part A (capture UUIDs)** is pure-markdown work + a DOM addressing switch, shippable on its own. **Part B (reorder)** adds an `orderedUuidList` strategy to the existing `formMerge.js` engine, a hidden `componentOrder` field on each container form, an up/down arrow rail on each card, order-aware writes through `mergeSave`, and (rollout step 3) wires the admonition and system-update savers through the scalar engine so they can carry `componentOrder`. A resolver Cancel/abort path (a folded-in Plan 1 follow-up) is added along the way.

**Tech Stack:** Vanilla ESM Chrome extension (MV3), no build step. Pure logic tested with `node --test` using the repo's custom `test()` idiom + `node:assert/strict`. DOM/wiring verified with `node --check`. UI verified manually in the browser.

**Spec:** `docs/superpowers/specs/2026-06-07-kb-form-conflict-merge-design.md` (see "Plan 2 brainstorming decisions", "Reordering components", "Capture identity (UUIDs)", "Engine: pluggable field types", rollout steps 4–5).

---

## Conventions for every task

- **Test idiom** (copy verbatim into each new `*.test.mjs`, matching `tests/formMerge.test.mjs`):
  ```js
  import assert from 'node:assert/strict';
  let passed = 0;
  function test(name, fn) { fn(); passed++; console.log('  ok -', name); }
  // … tests …
  console.log(`\n${passed} passed`);
  ```
- **Run pure tests:** `node --test tests/<file>.test.mjs` (a thrown assert fails the file).
- **Run a DOM/wiring check:** `node --check scripts/<file>.js` (syntax/parse only — these files import `chrome`/DOM and can't be executed in Node).
- **No new `scripts/*.js` files are created in this plan**, so no `manifest.json` edits are required. (If you ever split a module out, you MUST add it to `manifest.json` `web_accessible_resources` individually — see Plan 1 gotcha #1.)
- **Commit after every task** with the message shown in its final step.

---

## File-structure map

**Modified — pure logic (Node-importable, unit-tested):**
- `scripts/components.js` — capture `uuid` in parse; `ensureCaptureUUIDs` migration; `uuidOfComponent` + `reorderComponents` helpers.
- `scripts/captures.js` — `buildCaptureLines` emits the UUID span.
- `scripts/formMerge.js` — `orderedUuidList` strategy + `spec.type` dispatch.

**Modified — DOM/wiring (`node --check`):**
- `scripts/cardRenderer.js` — capture card keyed by UUID; arrow-rail-friendly.
- `scripts/guides.js` — migration call sites; index→UUID addressing; arrow rail in `renderComponents`; reorder click handler; `componentOrder` wiring in `saveSectionForComponent`; step-3 wiring in `saveAdmonitionForComponent`; `_reorderRehydrate` hook.
- `scripts/captureComponent.js` — open/submit/delete by UUID; capture scalar merge via `mergeSave`.
- `scripts/systemUpdates.js` — step-3 + `componentOrder` wiring in `saveUpdateForComponent` (and the draft saver).
- `scripts/mergeSave.js` — `orderedUuidList` rehydrate; forward resolver options.
- `scripts/conflictResolver.js` — Cancel/abort; numbered-list rendering of an order conflict.

**Modified — form templates / CSS:**
- `config/forms/editGuideSection.html`, `editGuideAdmonition.html`, `editSystemUpdate.html`, `editDraftSystemUpdate.html` — hidden `componentOrder` input.
- `config/forms/formsStyling.css` — arrow rail styles.

**New — tests:**
- `tests/captureUuid.test.mjs` — Part A pure logic.
- `tests/formMerge.test.mjs` — extended with `orderedUuidList` cases (Part B).

---

# PART A — Capture UUIDs

A capture is migrated to carry a hidden span on the line **immediately preceding** its light-mode image, at the same indent, folded into the capture's line range:

```
<span data-uuid="…" style="display:none"></span>
![](../assets/foo-light-mode.png#only-light){ width="800" }
![](../assets/foo-dark-mode.png#only-dark)
```

Canonical output (from `buildComponentBody`) always puts a blank line before each component, so a capture's span is never adjacent to a neighbouring component's span.

---

## Task A1: `locateCaptureLines` reads the preceding UUID span

**Files:**
- Modify: `scripts/components.js:52-72` (`locateCaptureLines`)
- Test: `tests/captureUuid.test.mjs` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/captureUuid.test.mjs`:
```js
import assert from 'node:assert/strict';
import { locateCaptureLines } from '../scripts/components.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

test('locateCaptureLines: capture with no span has uuid=null and startLine on the light line', () => {
  const body = [
    '![](../assets/a-light-mode.png#only-light){ width="800" }',
    '![](../assets/a-dark-mode.png#only-dark)',
  ].join('\n');
  const [c] = locateCaptureLines(body);
  assert.equal(c.uuid, null);
  assert.equal(c.startLine, 0);
  assert.equal(c.endLine, 2);
});

test('locateCaptureLines: preceding span is read as uuid and folded into startLine', () => {
  const body = [
    '<span data-uuid="CAP-1" style="display:none"></span>',
    '![](../assets/a-light-mode.png#only-light){ width="800" }',
    '![](../assets/a-dark-mode.png#only-dark)',
  ].join('\n');
  const [c] = locateCaptureLines(body);
  assert.equal(c.uuid, 'CAP-1');
  assert.equal(c.startLine, 0);   // extended back to include the span
  assert.equal(c.endLine, 3);
});

test('locateCaptureLines: a blank line before the light line means no span (uuid=null)', () => {
  const body = [
    '<span data-uuid="SECTION" style="display:none"></span>',
    '',
    '![](../assets/a-light-mode.png#only-light){ width="800" }',
    '![](../assets/a-dark-mode.png#only-dark)',
  ].join('\n');
  const [c] = locateCaptureLines(body);
  assert.equal(c.uuid, null);
  assert.equal(c.startLine, 2);
});

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/captureUuid.test.mjs`
Expected: FAIL — `c.uuid` is `undefined` (the field doesn't exist yet), so the first assert (`assert.equal(c.uuid, null)`) throws.

- [ ] **Step 3: Implement**

In `scripts/components.js`, add a span matcher near the other line matchers (after line 26):
```js
const UUID_SPAN_LINE_RE = /^\s*<span[^>]*data-uuid="([^"]+)"[^>]*><\/span>\s*$/;
```
Then in `locateCaptureLines`, after computing `endLine` and before the `out.push(...)`, detect an immediately-preceding span line and fold it in:
```js
    // A hidden data-uuid span on the line immediately before the light image is
    // this capture's identity; extend startLine to swallow it.
    let startLine = i;
    let uuid = null;
    if (i > 0) {
      const sm = lines[i - 1].match(UUID_SPAN_LINE_RE);
      if (sm) { uuid = sm[1]; startLine = i - 1; }
    }

    out.push({ lightFilename, darkFilename, dimMode, dimValue, indent, uuid, startLine, endLine });
    i = endLine - 1;
```
(Replace the existing `out.push({ …, startLine: i, endLine });` line.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/captureUuid.test.mjs`
Expected: PASS — `3 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/components.js tests/captureUuid.test.mjs
git commit -m "feat(captures): locateCaptureLines reads the preceding data-uuid span"
```

---

## Task A2: `parseComponents` carries `cap.uuid`

**Files:**
- Modify: `scripts/components.js:95-102` (the `topCaptures.map` inside `parseComponents`)
- Test: `tests/captureUuid.test.mjs`

- [ ] **Step 1: Add the failing test**

Append to `tests/captureUuid.test.mjs` (before the final `console.log`):
```js
import { parseComponents } from '../scripts/components.js';

test('parseComponents: capture component carries its uuid', () => {
  const body = [
    'Intro text.',
    '',
    '<span data-uuid="CAP-9" style="display:none"></span>',
    '![](../assets/x-light-mode.png#only-light){ width="800" }',
    '![](../assets/x-dark-mode.png#only-dark)',
  ].join('\n');
  const { components } = parseComponents(body, /step|note/);
  assert.equal(components.length, 1);
  assert.equal(components[0].kind, 'capture');
  assert.equal(components[0].cap.uuid, 'CAP-9');
});
```
(Move the `import { parseComponents }` to the top with the other imports.)

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/captureUuid.test.mjs`
Expected: FAIL — `components[0].cap.uuid` is `undefined`.

- [ ] **Step 3: Implement**

In `scripts/components.js`, in `parseComponents`, add `uuid` to the capture object built from `topCaptures` (around line 99):
```js
    ...topCaptures.map(c => ({
      kind: 'capture',
      cap: { uuid: c.uuid ?? null, lightFilename: c.lightFilename, darkFilename: c.darkFilename, dimMode: c.dimMode, dimValue: c.dimValue },
      startLine: c.startLine,
      endLine: c.endLine,
    })),
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/captureUuid.test.mjs`
Expected: PASS — `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/components.js tests/captureUuid.test.mjs
git commit -m "feat(captures): parseComponents carries cap.uuid"
```

---

## Task A3: `buildCaptureLines` emits the span; round-trip is stable

**Files:**
- Modify: `scripts/captures.js:24-39` (`buildCaptureLines`)
- Test: `tests/captureUuid.test.mjs`

- [ ] **Step 1: Add the failing test**

Append to `tests/captureUuid.test.mjs`:
```js
import { buildCaptureLines } from '../scripts/captures.js';
import { buildComponentBody } from '../scripts/components.js';

test('buildCaptureLines: emits a uuid span before the light line when cap.uuid is set', () => {
  const lines = buildCaptureLines([{ uuid: 'CAP-7', lightFilename: 'a-light-mode.png', darkFilename: 'a-dark-mode.png', dimMode: 'width', dimValue: 800 }]);
  // ['', span, light, dark]
  assert.equal(lines[0], '');
  assert.match(lines[1], /data-uuid="CAP-7"/);
  assert.match(lines[2], /a-light-mode\.png#only-light/);
  assert.match(lines[3], /a-dark-mode\.png#only-dark/);
});

test('buildCaptureLines: no span when cap.uuid is absent', () => {
  const lines = buildCaptureLines([{ lightFilename: 'a-light-mode.png', darkFilename: 'a-dark-mode.png', dimMode: 'none', dimValue: null }]);
  assert.equal(lines.length, 3); // '', light, dark
  assert.ok(!lines.some(l => /data-uuid/.test(l)));
});

test('round-trip: parseComponents → buildComponentBody preserves capture uuid + order', () => {
  const body = buildComponentBody(null, 'Desc.', [
    { kind: 'capture', cap: { uuid: 'C1', lightFilename: 'p-light-mode.png', darkFilename: 'p-dark-mode.png', dimMode: 'width', dimValue: 800 } },
    { kind: 'capture', cap: { uuid: 'C2', lightFilename: 'q-light-mode.png', darkFilename: 'q-dark-mode.png', dimMode: 'none', dimValue: null } },
  ]);
  const { components } = parseComponents(body, /step|note/);
  assert.deepEqual(components.map(c => c.cap.uuid), ['C1', 'C2']);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/captureUuid.test.mjs`
Expected: FAIL — `lines[1]` is the light image (no span emitted yet).

- [ ] **Step 3: Implement**

Replace `scripts/captures.js` `buildCaptureLines` (lines 24-39) with:
```js
export function buildCaptureLines(list = []) {
  return list.flatMap(c => {
    const light = `![](../assets/${c.lightFilename}#only-light)`;
    const dark  = `![](../assets/${c.darkFilename}#only-dark)`;
    const spanLines = c.uuid ? [`<span data-uuid="${c.uuid}" style="display:none"></span>`] : [];
    if (c.dimMode === 'none') {
      return ['', ...spanLines, light, dark];
    }
    const v = c.dimValue ?? 50;
    const dimAttr = c.dimMode === 'width' ? `width="${v}"` : `style="height: ${v}px"`;
    return [
      '',
      ...spanLines,
      `${light}{ ${dimAttr} loading=lazy }`,
      `${dark}{ ${dimAttr} loading=lazy }`,
    ];
  });
}
```
`buildComponentBody` already does `buildCaptureLines([c.cap]).slice(1)` (dropping the leading `''`), so the emitted order becomes `[span, light, dark]` — span immediately before the light line, as required.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/captureUuid.test.mjs`
Expected: PASS — `7 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/captures.js tests/captureUuid.test.mjs
git commit -m "feat(captures): buildCaptureLines emits the data-uuid span; round-trip stable"
```

---

## Task A4: `ensureCaptureUUIDs` migration

**Files:**
- Modify: `scripts/components.js` (add `ensureCaptureUUIDs` export; import `generateUUID`)
- Test: `tests/captureUuid.test.mjs`

- [ ] **Step 1: Add the failing test**

Append to `tests/captureUuid.test.mjs`:
```js
import { ensureCaptureUUIDs } from '../scripts/components.js';

test('ensureCaptureUUIDs: injects a span before an unmigrated capture', () => {
  const body = [
    'Intro.',
    '',
    '![](../assets/a-light-mode.png#only-light){ width="800" }',
    '![](../assets/a-dark-mode.png#only-dark)',
  ].join('\n');
  const out = ensureCaptureUUIDs(body);
  const lines = out.split('\n');
  const lightIdx = lines.findIndex(l => /a-light-mode/.test(l));
  assert.match(lines[lightIdx - 1], /data-uuid="[0-9a-f-]{36}"/i);
});

test('ensureCaptureUUIDs: idempotent (already-migrated capture is untouched)', () => {
  const body = [
    '<span data-uuid="CAP-X" style="display:none"></span>',
    '![](../assets/a-light-mode.png#only-light){ width="800" }',
    '![](../assets/a-dark-mode.png#only-dark)',
  ].join('\n');
  assert.equal(ensureCaptureUUIDs(body), body);
});

test('ensureCaptureUUIDs: migrates multiple captures, each with a distinct uuid', () => {
  const body = [
    '![](../assets/a-light-mode.png#only-light)',
    '![](../assets/a-dark-mode.png#only-dark)',
    '',
    '![](../assets/b-light-mode.png#only-light)',
    '![](../assets/b-dark-mode.png#only-dark)',
  ].join('\n');
  const out = ensureCaptureUUIDs(body);
  const uuids = [...out.matchAll(/data-uuid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(uuids.length, 2);
  assert.notEqual(uuids[0], uuids[1]);
  // Re-running is a no-op.
  assert.equal(ensureCaptureUUIDs(out), out);
});

test('ensureCaptureUUIDs: a nested (indented) capture gets a span at matching indent', () => {
  const body = [
    '!!! note "N"',
    '',
    '    <span data-uuid="ADM" style="display:none"></span>',
    '',
    '    ![](../assets/c-light-mode.png#only-light){ width="800" }',
    '    ![](../assets/c-dark-mode.png#only-dark)',
  ].join('\n');
  const out = ensureCaptureUUIDs(body);
  const lines = out.split('\n');
  const lightIdx = lines.findIndex(l => /c-light-mode/.test(l));
  assert.match(lines[lightIdx - 1], /^    <span[^>]*data-uuid="[0-9a-f-]{36}"/i); // 4-space indent preserved
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/captureUuid.test.mjs`
Expected: FAIL — `ensureCaptureUUIDs` is not exported.

- [ ] **Step 3: Implement**

In `scripts/components.js`:
1. Extend the admonitions import (line 18) to include `generateUUID`:
   ```js
   import { parseAdmonitions, buildAdmonition, generateUUID } from './admonitions.js';
   ```
2. Add the migration function (place it after `locateCaptureLines`, ~line 72):
   ```js
   /**
    * Backfills a hidden data-uuid span before every capture that lacks one.
    * Idempotent; matches captures at any indent (so nested captures inside
    * admonitions / system-updates are covered in one whole-document pass).
    * Reverse-order splice keeps earlier line indices valid. Mirrors
    * ensureSectionUUIDs / ensureAdmonitionUUIDs.
    *
    * @param {string} markdown
    * @returns {string}
    */
   export function ensureCaptureUUIDs(markdown) {
     const caps = locateCaptureLines(markdown);
     if (caps.length === 0) return markdown;
     const lines = (markdown ?? '').split('\n');
     let modified = false;
     for (let k = caps.length - 1; k >= 0; k--) {
       const c = caps[k];
       if (c.uuid) continue; // already migrated
       const span = `${c.indent}<span data-uuid="${generateUUID()}" style="display:none"></span>`;
       lines.splice(c.startLine, 0, span); // insert immediately before the light line
       modified = true;
     }
     return modified ? lines.join('\n') : markdown;
   }
   ```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/captureUuid.test.mjs`
Expected: PASS — `11 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/components.js tests/captureUuid.test.mjs
git commit -m "feat(captures): ensureCaptureUUIDs migration (idempotent, any-indent)"
```

---

## Task A5: run `ensureCaptureUUIDs` at the migration points

**Files:**
- Modify: `scripts/guides.js:234-237` (draft-creation migration) and `scripts/guides.js:415-416` (new-guide draft)

- [ ] **Step 1: Wire into draft creation**

In `scripts/guides.js`, import `ensureCaptureUUIDs` alongside the components imports (line 35):
```js
import { parseComponents, buildComponentBody, ensureCaptureUUIDs } from './components.js';
```
Then in `createGuideDraft`, wrap the existing migration (lines 234-237):
```js
    const migrated = ensureCaptureUUIDs(
      ensureAdmonitionUUIDs(
        ensureSectionUUIDs(liveMarkdown),
        GUIDE_ADMONITION_TYPES_RE,
      ),
    );
```

- [ ] **Step 2: Wire into new-guide creation**

In `submitCreateGuide` (line 415-416), the new draft body is just `# ${title}\n` with no captures, so no capture migration is needed there — leave it. (Captures only ever enter a draft that already exists, and `createGuideDraft` covers the clone path.) No change.

- [ ] **Step 3: Verify it parses**

Run: `node --check scripts/guides.js`
Expected: no output (success).

- [ ] **Step 4: Commit**

```bash
git add scripts/guides.js
git commit -m "feat(captures): migrate capture UUIDs on draft creation"
```

---

## Task A6: newly-inserted captures get a UUID at creation

**Files:**
- Modify: `scripts/captures.js:82-99` (`commitCapturesIntoContainer`)

When a capture is added (screenshot or library), it must be born with a UUID so reorder can track it immediately.

- [ ] **Step 1: Implement**

In `scripts/captures.js`, `commitCapturesIntoContainer` builds `caps` from `resolved` (lines 87-92). Add a `uuid`:
```js
  const caps = resolved.map(c => ({
    uuid: generateUUID(),
    lightFilename: c.lightFilename,
    darkFilename: c.darkFilename,
    dimMode: c.dimMode ?? 'height',
    dimValue: c.dimMode === 'none' ? null : (c.dimValue ?? 50),
  }));
```
`generateUUID` is already imported in `captures.js` (line 19).

- [ ] **Step 2: Verify it parses**

Run: `node --check scripts/captures.js`
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add scripts/captures.js
git commit -m "feat(captures): assign a UUID to newly-inserted captures"
```

---

## Task A7: address captures by UUID (kills the wrong-target bug)

**Files:**
- Modify: `scripts/cardRenderer.js:34-46` (`captureComponentCard`)
- Modify: `scripts/guides.js` — `captureComponentCardFor` (695-700), `renderComponents` capture branch (720), `onComponentEditorClick` edit-capture (801-805), `runChildAction` edit-capture (785-787), `openCaptureComponentEditor` (820-826)
- Modify: `scripts/captureComponent.js` — `openEditCaptureComponent`, `readContainerRef`, `deleteCaptureComponent` (capture scalar-merge submit is Task A8)

The capture card's `data-edit-component` attribute changes from the list index to the capture UUID; every consumer switches to `find-by-uuid`.

- [ ] **Step 1: `captureComponentCardFor` emits the UUID**

In `scripts/guides.js`, change `captureComponentCardFor` (line 695) to key on UUID and drop the index param:
```js
function captureComponentCardFor(cap) {
  return captureComponentCard({
    thumbSrc: assetCdnUrl('docs/assets/' + cap.lightFilename),
    btnAttr: `data-edit-component="${escapeHtml(cap.uuid ?? '')}"`,
  });
}
```
And in `renderComponents` (line 720), call it without the index:
```js
    } else {
      parts.push(captureComponentCardFor(c.cap));
    }
```

- [ ] **Step 2: `onComponentEditorClick` reads the UUID**

In `scripts/guides.js`, the edit-capture branch (lines 801-805):
```js
  const editCap = e.target.closest('[data-edit-component]');
  if (editCap) {
    beginChildNavigation(formEl, { type: 'edit-capture', uuid: editCap.dataset.editComponent });
    return;
  }
```

- [ ] **Step 3: `runChildAction` + `openCaptureComponentEditor` find by UUID**

In `runChildAction` (line 785-787):
```js
  } else if (action.type === 'edit-capture') {
    openCaptureComponentEditor(container, action.uuid);
  }
```
And `openCaptureComponentEditor` (lines 820-826):
```js
async function openCaptureComponentEditor(container, uuid) {
  const md = await readRepoText(container.file);
  const { components } = readContainerComponents(md, container);
  const c = components.find(x => x.kind === 'capture' && x.cap.uuid === uuid);
  if (!c) return;
  getFormAction('openEditCaptureComponent')?.({ container, uuid, cap: c.cap });
}
```

- [ ] **Step 4: `openEditCaptureComponent` stores the UUID**

In `scripts/captureComponent.js`, change the signature + dataset (lines 34-47). Replace `index` with `uuid`:
```js
export async function openEditCaptureComponent({ container, uuid, cap } = {}) {
  if (!container || !cap) return;
  const opener = () => openEditCaptureComponent({ container, uuid, cap });
  // … unchanged storage.set …
  const { formEl } = await createForm('editCaptureComponent', opener);
  if (!formEl) return;
  formEl.dataset.containerKind = container.kind;
  formEl.dataset.containerUuid = container.uuid;
  formEl.dataset.containerFile = container.file;
  formEl.dataset.componentUuid = uuid;
```
Update the JSDoc `@param` block above it: replace `@param {number} opts.index` with `@param {string} opts.uuid - the capture component's UUID`.

And `readContainerRef` (lines 75-85) returns `uuid` instead of `index`:
```js
function readContainerRef(formEl) {
  return {
    handler: getComponentContainer(formEl.dataset.containerKind),
    container: {
      kind: formEl.dataset.containerKind,
      uuid: formEl.dataset.containerUuid,
      file: formEl.dataset.containerFile,
    },
    uuid: formEl.dataset.componentUuid,
  };
}
```

- [ ] **Step 5: `deleteCaptureComponent` deletes by UUID**

In `scripts/captureComponent.js`, `deleteCaptureComponent` (lines 113-135), replace the `index`-based mutate with a UUID filter:
```js
registerFormAction('deleteCaptureComponent', async ({ formEl, content }) => {
  if (!confirm('Delete this capture? This removes it from the page (the image stays in the library).')) return;
  const { handler, container, uuid } = readContainerRef(formEl);
  if (!handler) return;
  const btn = content?.querySelector('[data-action="deleteCaptureComponent"]');
  const originalText = btn?.textContent;
  if (btn) btn.disabled = true;
  try {
    await handler.mutate(container, (components) =>
      components.filter(c => !(c.kind === 'capture' && c.cap.uuid === uuid)),
      s => { if (btn) btn.textContent = s; });

    await chrome.storage.local.remove('moreButtonsEditCaptureComponent');
    await navigateBack();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    alert('Failed to delete capture: ' + e.message);
  }
});
```

> **Note:** `submitEditCaptureComponent` still references `index` after this task — that's rewritten in Task A8. To keep the tree buildable between commits, in this task ONLY, update `submitEditCaptureComponent`'s destructure to `const { handler, container, uuid } = readContainerRef(formEl);` and change its mutate body to find by uuid:
> ```js
>     await handler.mutate(container, (components) =>
>       components.map(c =>
>         (c.kind === 'capture' && c.cap.uuid === uuid)
>           ? { kind: 'capture', cap: { ...c.cap, dimMode: mode, dimValue } }
>           : c),
>       s => setButtonBusy(btn, s));
> ```
> Task A8 then replaces this immediate-save with the merge path.

- [ ] **Step 6: Verify both files parse**

Run: `node --check scripts/guides.js && node --check scripts/cardRenderer.js && node --check scripts/captureComponent.js`
Expected: no output (success).

- [ ] **Step 7: Manual smoke (browser)**

Open a guide draft with ≥2 captures in one section. Edit the **second** capture's dimension and save. Confirm the second capture changed (not the first) — the wrong-target bug is gone. Delete a capture and confirm the correct one is removed.

- [ ] **Step 8: Commit**

```bash
git add scripts/guides.js scripts/cardRenderer.js scripts/captureComponent.js
git commit -m "fix(captures): address captures by UUID instead of list index"
```

---

## Task A8: capture dim edit becomes a UUID-keyed scalar merge

**Files:**
- Modify: `scripts/captureComponent.js` — `submitEditCaptureComponent` (87-111)

Route the capture edit through `mergeSave` so concurrent dim edits merge instead of clobber. Fields: `dimMode`, `dimValue`. The `dimValue` input is normalized to `''` when the mode is `none` so `fresh` and `cur` compare equal (Plan 1 gotcha #3).

- [ ] **Step 1: Implement**

In `scripts/captureComponent.js`:
1. Add imports at the top:
   ```js
   import { mergeSave } from './mergeSave.js';
   ```
2. Replace `submitEditCaptureComponent` (lines 87-111) with:
   ```js
   registerFormAction('submitEditCaptureComponent', async ({ formEl, content }) => {
     const { handler, container, uuid } = readContainerRef(formEl);
     if (!handler) return;
     const btn = content?.querySelector('[data-save-state]');
     setButtonBusy(btn, 'Saving…');

     // Normalize the form so dimValue is '' whenever the mode is 'none' — this
     // keeps `cur` and `fresh` equal for an untouched auto capture (no false
     // conflict). The number input is disabled in 'none' mode but still reports
     // its stale .value to readFormValues, so blank it explicitly.
     const modeSel = formEl.querySelector('[name="dimMode"]');
     const valInput = formEl.querySelector('[name="dimValue"]');
     if (modeSel?.value === 'none' && valInput) valInput.value = '';

     try {
       await mergeSave({
         formEl,
         file: container.file,
         onProgress: s => setButtonBusy(btn, s),
         fieldSpecs: [
           { name: 'dimMode', type: 'scalar', label: 'Dimension mode' },
           { name: 'dimValue', type: 'scalar', label: 'Dimension value' },
         ],
         readFresh: md => {
           const { components } = handler.readComponents(md, container.uuid);
           const cap = components.find(c => c.kind === 'capture' && c.cap.uuid === uuid)?.cap;
           const mode = cap?.dimMode ?? 'none';
           return { dimMode: mode, dimValue: mode === 'none' ? '' : String(cap?.dimValue ?? '') };
         },
         build: (md, resolved) => {
           const { description, components } = handler.readComponents(md, container.uuid);
           const mode = resolved.dimMode ?? 'none';
           const raw = parseInt(resolved.dimValue, 10);
           const dimValue = mode === 'none' ? null : (Number.isFinite(raw) && raw > 0 ? raw : 50);
           const next = components.map(c =>
             (c.kind === 'capture' && c.cap.uuid === uuid)
               ? { kind: 'capture', cap: { ...c.cap, dimMode: mode, dimValue } }
               : c);
           return handler.writeBody(md, container.uuid, description, next);
         },
       });
       formEl._refreshSaveState?.();
     } catch (e) {
       formEl._refreshSaveState?.();
       alert('Failed to save capture: ' + e.message);
     }
   });
   ```
   `handler.readComponents` / `handler.writeBody` are exposed by `makeContainerHandler` (guides.js:653-665), so the capture form reaches the container's markdown without importing the editors (no cycle). `mergeSave` itself triggers `rerenderOpenComponentEditor`? No — `mergeSave` rehydrates the *capture* form's own fields and `resetDirtyBaseline`s; the parent editor re-renders when navigated back to (existing behaviour). Keep the post-save `navigateBack` out — the capture form stays open and shows the green saved state, matching the section editor.

- [ ] **Step 2: Verify it parses**

Run: `node --check scripts/captureComponent.js`
Expected: no output (success).

- [ ] **Step 3: Manual smoke (browser)**

Open the same capture in two tabs. In tab 1 change dim to width=400, save. In tab 2 (opened before tab 1 saved) change dim to height=120, save → expect the conflict resolver with a "Dimension mode/value" row, not a silent overwrite. Resolve and confirm.

- [ ] **Step 4: Commit**

```bash
git add scripts/captureComponent.js
git commit -m "feat(captures): merge capture dim edits via mergeSave (UUID-keyed scalar)"
```

---

# PART B — Component reorder

Order is held in a hidden `componentOrder` input (comma-joined UUIDs) on each container form, three-way merged via a new `orderedUuidList` strategy, and written by reordering the fresh-read component list. The in-memory working copy lives on `openComponentEditor.components`.

---

## Task B1: `uuidOfComponent` + `reorderComponents` helpers

**Files:**
- Modify: `scripts/components.js` (add two exports)
- Test: `tests/captureUuid.test.mjs`

- [ ] **Step 1: Add the failing test**

Append to `tests/captureUuid.test.mjs`:
```js
import { uuidOfComponent, reorderComponents } from '../scripts/components.js';

test('uuidOfComponent: returns admonition or capture uuid', () => {
  assert.equal(uuidOfComponent({ kind: 'admonition', adm: { uuid: 'A1' } }), 'A1');
  assert.equal(uuidOfComponent({ kind: 'capture', cap: { uuid: 'C1' } }), 'C1');
});

test('reorderComponents: reorders by a uuid sequence; unknown uuids dropped, extras appended', () => {
  const comps = [
    { kind: 'admonition', adm: { uuid: 'A' } },
    { kind: 'capture', cap: { uuid: 'B' } },
    { kind: 'admonition', adm: { uuid: 'C' } },
  ];
  const out = reorderComponents(comps, ['C', 'A', 'B']);
  assert.deepEqual(out.map(uuidOfComponent), ['C', 'A', 'B']);
  // A uuid not present in comps is ignored; a comp missing from the order is appended.
  const out2 = reorderComponents(comps, ['C', 'ZZZ']);
  assert.deepEqual(out2.map(uuidOfComponent), ['C', 'A', 'B']);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/captureUuid.test.mjs`
Expected: FAIL — exports don't exist.

- [ ] **Step 3: Implement**

In `scripts/components.js`, add at the end:
```js
/** The stable UUID of a component (admonition or capture). */
export function uuidOfComponent(c) {
  return c.kind === 'admonition' ? c.adm.uuid : c.cap.uuid;
}

/**
 * Returns `components` reordered to match the `order` UUID sequence. UUIDs in
 * `order` not present in `components` are ignored; components whose UUID is not
 * in `order` are appended in their original relative order (safety net).
 */
export function reorderComponents(components, order) {
  const byUuid = new Map(components.map(c => [uuidOfComponent(c), c]));
  const out = [];
  for (const u of order) { const c = byUuid.get(u); if (c) { out.push(c); byUuid.delete(u); } }
  for (const c of components) { if (byUuid.has(uuidOfComponent(c))) out.push(c); }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/captureUuid.test.mjs`
Expected: PASS — `15 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/components.js tests/captureUuid.test.mjs
git commit -m "feat(components): uuidOfComponent + reorderComponents helpers"
```

---

## Task B2: `orderedUuidList` merge strategy

**Files:**
- Modify: `scripts/formMerge.js` (add `spec.type` dispatch + strategy)
- Test: `tests/formMerge.test.mjs`

**Semantics** (all values are comma-joined UUID strings on input):
- Membership is always reconciled from `fresh` (others' adds/deletes always win).
- `mergeMine(B, F)` = your order `B` filtered to fresh membership, with fresh-new UUIDs (in `F`, not in `B`) inserted after their surviving fresh-predecessors.
- you-reordered = `B !== A`. they-reordered = the common (snap∩fresh) UUIDs appear in a different relative order in `A` vs `F`.
- Resolution table:
  - not you-reordered → `resolved = F`.
  - you-reordered, not they-reordered → `resolved = mergeMine(B, F)`.
  - both reordered, but `mergeMine(B, F) === F` → `resolved = F` (no conflict).
  - both reordered, differing → **one** conflict `{ field, label, mine: mergeMine(B,F) (array), theirs: F (array) }`.
- `resolved[field]` is a **comma-joined string**; conflict `mine`/`theirs` are **arrays** (so the resolver can render a numbered list).
- Recorded resolution: honour the stored choice only while the joined `fresh` equals the joined `theirsShown`; else re-prompt.

- [ ] **Step 1: Add the failing tests**

Append to `tests/formMerge.test.mjs` (before the final `console.log`):
```js
const ORDER_SPEC = [{ name: 'componentOrder', type: 'orderedUuidList', label: 'Component order' }];
const order = (snap, cur, fresh, resolutions) =>
  mergeFields({ componentOrder: snap }, { componentOrder: cur }, { componentOrder: fresh }, ORDER_SPEC, resolutions);

test('orderedUuidList: you did not reorder → take fresh order (their add wins)', () => {
  const { resolved, conflicts } = order('A,B', 'A,B', 'A,B,C');
  assert.equal(conflicts.length, 0);
  assert.equal(resolved.componentOrder, 'A,B,C');
});

test('orderedUuidList: you did not reorder, they deleted → fresh wins', () => {
  const { resolved, conflicts } = order('A,B,C', 'A,B,C', 'A,C');
  assert.equal(conflicts.length, 0);
  assert.equal(resolved.componentOrder, 'A,C');
});

test('orderedUuidList: only you reordered → your order', () => {
  const { resolved, conflicts } = order('A,B,C', 'C,B,A', 'A,B,C');
  assert.equal(conflicts.length, 0);
  assert.equal(resolved.componentOrder, 'C,B,A');
});

test('orderedUuidList: only you reordered + they added → your order, new slotted at fresh position', () => {
  // You: B,A. They added C after B (fresh A,B,C). New C follows its fresh-predecessor B.
  const { resolved, conflicts } = order('A,B', 'B,A', 'A,B,C');
  assert.equal(conflicts.length, 0);
  assert.equal(resolved.componentOrder, 'B,C,A');
});

test('orderedUuidList: you reordered, they only deleted one of yours → your order minus deleted', () => {
  const { resolved, conflicts } = order('A,B,C', 'C,B,A', 'A,C');
  assert.equal(conflicts.length, 0);
  assert.equal(resolved.componentOrder, 'C,A');
});

test('orderedUuidList: both reordered the same way → no conflict', () => {
  const { resolved, conflicts } = order('A,B,C', 'C,B,A', 'C,B,A');
  assert.equal(conflicts.length, 0);
  assert.equal(resolved.componentOrder, 'C,B,A');
});

test('orderedUuidList: both reordered differently → one conflict with array mine/theirs', () => {
  const { resolved, conflicts } = order('A,B,C', 'B,A,C', 'C,B,A');
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].field, 'componentOrder');
  assert.deepEqual(conflicts[0].theirs, ['C', 'B', 'A']);
  assert.deepEqual(conflicts[0].mine, ['B', 'A', 'C']);
  assert.equal('componentOrder' in resolved, false);
});

test('orderedUuidList: recorded choice mine applies while fresh stable; re-prompts when it moves', () => {
  const stable = order('A,B,C', 'B,A,C', 'C,B,A', { componentOrder: { choice: 'mine', theirsShown: ['C', 'B', 'A'] } });
  assert.equal(stable.conflicts.length, 0);
  assert.equal(stable.resolved.componentOrder, 'B,A,C');
  const moved = order('A,B,C', 'B,A,C', 'C,A,B', { componentOrder: { choice: 'mine', theirsShown: ['C', 'B', 'A'] } });
  assert.equal(moved.conflicts.length, 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/formMerge.test.mjs`
Expected: FAIL — `orderedUuidList` is treated as scalar (string `===`), so e.g. the first test resolves to `'A,B'` not `'A,B,C'`.

- [ ] **Step 3: Implement**

In `scripts/formMerge.js`, refactor `mergeFields` to dispatch on `spec.type`, and add the `orderedUuidList` strategy. Replace the body of the `for (const spec of fieldSpecs)` loop (lines 37-54) so it delegates:
```js
  for (const spec of fieldSpecs) {
    if (spec.type === 'orderedUuidList') {
      mergeOrderedUuidList(spec, snap, cur, fresh, resolutions, resolved, conflicts);
      continue;
    }
    mergeScalar(spec, snap, cur, fresh, resolutions, resolved, conflicts);
  }
```
Extract the existing scalar logic into `mergeScalar` (same behaviour as today):
```js
function mergeScalar(spec, snap, cur, fresh, resolutions, resolved, conflicts) {
  const { name, label } = spec;
  const s = snap[name], c = cur[name], f = fresh[name];
  if (scalarEqual(c, s)) { resolved[name] = f; return; }
  if (scalarEqual(f, s)) { resolved[name] = c; return; }
  if (scalarEqual(f, c)) { resolved[name] = c; return; }
  const r = resolutions[name];
  if (r && scalarEqual(f, r.theirsShown)) { resolved[name] = r.choice === 'mine' ? c : f; return; }
  conflicts.push({ field: name, label, mine: c, theirs: f });
}
```
Add the ordered-list strategy:
```js
const splitUuids = v => String(v ?? '').split(',').filter(Boolean);
const arraysEqual = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * `mergeMine` = your order, filtered to fresh membership, with fresh-new UUIDs
 * inserted after their surviving fresh-predecessors.
 */
function mergeMine(B, F) {
  const freshSet = new Set(F), bSet = new Set(B);
  const out = B.filter(u => freshSet.has(u)); // your order, deletions dropped
  F.forEach((u, i) => {
    if (bSet.has(u)) return; // not new
    const before = F.slice(0, i).filter(x => out.includes(x)).length; // surviving predecessors
    out.splice(before, 0, u);
  });
  return out;
}

function commonOrder(order, otherSet) {
  return order.filter(u => otherSet.has(u));
}

function mergeOrderedUuidList(spec, snap, cur, fresh, resolutions, resolved, conflicts) {
  const { name, label } = spec;
  const A = splitUuids(snap[name]), B = splitUuids(cur[name]), F = splitUuids(fresh[name]);
  const snapSet = new Set(A), freshSet = new Set(F);

  const youReordered = !arraysEqual(A, B);
  const theyReordered = !arraysEqual(commonOrder(A, freshSet), commonOrder(F, snapSet));

  if (!youReordered) { resolved[name] = F.join(','); return; }

  const mine = mergeMine(B, F);
  if (!theyReordered || arraysEqual(mine, F)) { resolved[name] = mine.join(','); return; }

  // Both reordered differently → conflict.
  const r = resolutions[name];
  if (r && arraysEqual(F, splitUuids((r.theirsShown ?? []).join(',')))) {
    resolved[name] = (r.choice === 'mine' ? mine : F).join(',');
    return;
  }
  conflicts.push({ field: name, label, mine, theirs: F });
}
```

- [ ] **Step 4: Run both pure test files**

Run: `node --test tests/formMerge.test.mjs && node --test tests/captureUuid.test.mjs`
Expected: PASS — the original 8 scalar tests still pass, plus the 8 new ordered-list tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/formMerge.js tests/formMerge.test.mjs
git commit -m "feat(merge): orderedUuidList strategy with spec.type dispatch"
```

---

## Task B3: resolver Cancel/abort (folded-in Plan 1 follow-up)

**Files:**
- Modify: `scripts/conflictResolver.js`
- Modify: `scripts/mergeSave.js`

- [ ] **Step 1: Implement the Cancel in the resolver**

In `scripts/conflictResolver.js`, the promise currently never rejects. Replace `showConflictResolver` so it (a) takes an options arg, (b) adds a Cancel button that rejects with a tagged error. Replace the whole function:
```js
export class ResolveCancelled extends Error {
  constructor() { super('Conflict resolution cancelled'); this.name = 'ResolveCancelled'; }
}

/**
 * @param {HTMLElement} formEl
 * @param {Array<{field,label,mine,theirs}>} conflicts
 * @param {{ describe?: (uuid:string)=>{kind?:string,title?:string,thumbSrc?:string} }} [options]
 * @returns {Promise<{ [field]: 'mine'|'theirs' }>}  rejects with ResolveCancelled on cancel
 */
export function showConflictResolver(formEl, conflicts, options = {}) {
  return new Promise((resolve, reject) => {
    const host = formEl.parentElement || formEl;
    host.querySelector('[data-conflict-panel]')?.remove();

    const panel = document.createElement('div');
    panel.setAttribute('data-conflict-panel', '');
    panel.style.cssText =
      'border:1px solid #d97706;background:#fffbeb;border-radius:8px;padding:12px;margin:12px 0;';

    const rows = conflicts.map(c => `
      <div data-conflict-field="${esc(c.field)}" style="padding:8px 0;border-top:1px solid #fde68a;">
        <p style="margin:0 0 4px;font-weight:600;">⚠ "${esc(c.label)}" was changed elsewhere since you opened this (another tab, device, or person):</p>
        <div style="margin:0 0 2px;"><strong>current (theirs):</strong> ${renderSide(c, c.theirs, options)}</div>
        <div style="margin:0 0 6px;"><strong>yours (mine):</strong> ${renderSide(c, c.mine, options)}</div>
        <div style="display:flex;gap:8px;">
          <button type="button" class="more-buttons-button" data-choose="theirs">Keep theirs (current)</button>
          <button type="button" class="more-buttons-button success" data-choose="mine">Keep mine (overwrite)</button>
        </div>
      </div>`).join('');

    panel.innerHTML =
      `<div style="font-weight:700;margin-bottom:4px;">Resolve conflicts to save</div>${rows}` +
      `<div style="margin-top:10px;text-align:right;"><button type="button" class="more-buttons-button secondary" data-conflict-cancel>Cancel</button></div>`;
    host.prepend(panel);

    const chosen = {};
    panel.addEventListener('click', e => {
      if (e.target.closest('[data-conflict-cancel]')) {
        panel.remove();
        reject(new ResolveCancelled());
        return;
      }
      const btn = e.target.closest('[data-choose]');
      if (!btn) return;
      const row = btn.closest('[data-conflict-field]');
      chosen[row.dataset.conflictField] = btn.dataset.choose;
      row.querySelectorAll('[data-choose]').forEach(b => { b.disabled = true; });
      btn.style.outline = '2px solid #2563eb';
      if (conflicts.every(c => chosen[c.field])) {
        panel.remove();
        resolve(chosen);
      }
    });
  });
}
```
Add a `renderSide` helper above `showConflictResolver` (the numbered-list rendering for array values is fleshed out in Task B7 — for now render scalars as today and arrays as a plain joined list):
```js
function renderSide(conflict, value, options) {
  if (Array.isArray(value)) {
    const describe = options.describe || (u => ({ title: u }));
    const items = value.map(u => {
      const d = describe(u) || {};
      const label = d.kind === 'capture'
        ? `${d.thumbSrc ? `<img src="${esc(d.thumbSrc)}" alt="" style="height:20px;vertical-align:middle;border-radius:3px;margin-right:4px;" />` : ''}Capture`
        : esc(d.title || u);
      return `<li>${label}</li>`;
    }).join('');
    return `<ol style="margin:4px 0 0;padding-left:20px;">${items}</ol>`;
  }
  return esc(value);
}
```

- [ ] **Step 2: `mergeSave` handles the cancel**

In `scripts/mergeSave.js`, import the cancel error and forward resolver options. Update the import (line 12):
```js
import { showConflictResolver, ResolveCancelled } from './conflictResolver.js';
```
Change the `mergeSave` signature to accept `resolverOptions` and pass it through (lines 27 + 45), and handle cancel in the catch:
```js
export async function mergeSave({ formEl, file, fieldSpecs, readFresh, build, onProgress = () => {}, resolverOptions = {} }) {
```
```js
      if (e instanceof ConflictNeeded) {
        let choices;
        try {
          choices = await showConflictResolver(formEl, e.conflicts, resolverOptions);
        } catch (cancel) {
          if (cancel instanceof ResolveCancelled) {
            formEl._refreshSaveState?.();   // restore the save button; abort the save
            return null;
          }
          throw cancel;
        }
        for (const c of e.conflicts) {
          resolutions[c.field] = { choice: choices[c.field], theirsShown: c.theirs };
        }
        continue;
      }
```

- [ ] **Step 3: Verify both parse**

Run: `node --check scripts/conflictResolver.js && node --check scripts/mergeSave.js`
Expected: no output (success).

- [ ] **Step 4: Commit**

```bash
git add scripts/conflictResolver.js scripts/mergeSave.js
git commit -m "feat(merge): resolver Cancel/abort restores the save button"
```

---

## Task B4: hidden `componentOrder` field on container forms + arrow CSS

**Files:**
- Modify: `config/forms/editGuideSection.html`, `editGuideAdmonition.html`, `editSystemUpdate.html`, `editDraftSystemUpdate.html`
- Modify: `config/forms/formsStyling.css`

- [ ] **Step 1: Add the hidden input to each container form**

In each of the four templates, add this line immediately after the components container div (`<div data-section-components></div>` / `<div data-admonition-components></div>` / `<div data-update-components></div>`), still inside the `<form>`:
```html
      <input type="hidden" name="componentOrder" />
```
(Per-file: `editGuideSection.html` after line 22; `editGuideAdmonition.html` after line 51; `editSystemUpdate.html` and `editDraftSystemUpdate.html` after line 31.)

- [ ] **Step 2: Add the arrow-rail styles**

Append to `config/forms/formsStyling.css`:
```css
/* Component reorder rail (Plan 2) — vertical up/down arrows on each card's left edge. */
.mb-component-row { display: flex; align-items: stretch; gap: 6px; }
.mb-component-row > .mb-incident-card { flex: 1 1 auto; }
.mb-component-rail { display: flex; flex-direction: column; justify-content: center; gap: 4px; flex: 0 0 auto; }
.mb-component-rail__btn {
  width: 28px; height: 28px; padding: 0; line-height: 1;
  border: 1px solid var(--mb-border, #d0d5dd); border-radius: 6px;
  background: #fff; cursor: pointer; color: #475467; font-size: 16px;
  display: inline-flex; align-items: center; justify-content: center;
}
.mb-component-rail__btn:hover:not(:disabled) { background: #f2f4f7; }
.mb-component-rail__btn:disabled { opacity: 0.35; cursor: default; }
```

- [ ] **Step 3: Sanity-check the HTML**

Run: `grep -c 'name="componentOrder"' config/forms/editGuideSection.html config/forms/editGuideAdmonition.html config/forms/editSystemUpdate.html config/forms/editDraftSystemUpdate.html`
Expected: each file reports `1`.

- [ ] **Step 4: Commit**

```bash
git add config/forms/editGuideSection.html config/forms/editGuideAdmonition.html config/forms/editSystemUpdate.html config/forms/editDraftSystemUpdate.html config/forms/formsStyling.css
git commit -m "feat(reorder): hidden componentOrder field + arrow-rail styles"
```

---

## Task B5: render the arrow rail; sync `componentOrder`; reorder in memory

**Files:**
- Modify: `scripts/guides.js` — `renderComponents` (706-725); add `moveComponentInEditor`; `onComponentEditorClick` (792-818); store `components` + `_reorderRehydrate` on the open editor at every mount site.

- [ ] **Step 1: `renderComponents` wraps each card in a rail and writes `componentOrder`**

In `scripts/guides.js`, import the helper (extend the components import on line 35):
```js
import { parseComponents, buildComponentBody, ensureCaptureUUIDs, uuidOfComponent, reorderComponents } from './components.js';
```
Replace `renderComponents` (lines 706-725) with:
```js
export function renderComponents(listEl, components, numberSteps = true) {
  if (!listEl) return;
  // Keep the form's hidden order field in lockstep with what's rendered.
  const orderField = listEl.closest('form')?.querySelector('[name="componentOrder"]');
  if (orderField) orderField.value = components.map(uuidOfComponent).join(',');

  if (components.length === 0) {
    listEl.innerHTML = `<button type="button" class="mb-insert-component__empty" data-insert-component-at="0"><span class="mb-adm-empty__icon">+</span> Insert Component</button>`;
    return;
  }
  const parts = [];
  let stepN = 0;
  const last = components.length - 1;
  components.forEach((c, i) => {
    parts.push(insertComponentTrigger(i));
    const card = (c.kind === 'admonition')
      ? admonitionCard(c.adm, (numberSteps && c.adm.type === 'step') ? ++stepN : null)
      : captureComponentCardFor(c.cap);
    parts.push(componentRow(uuidOfComponent(c), i === 0, i === last, card));
  });
  parts.push(insertComponentTrigger(components.length));
  listEl.innerHTML = parts.join('');
}

// Wraps a component card with a vertical up/down reorder rail on its left edge.
function componentRow(uuid, isFirst, isLast, cardHtml) {
  return `
    <div class="mb-component-row" data-component-uuid="${escapeHtml(uuid)}">
      <div class="mb-component-rail">
        <button type="button" class="mb-component-rail__btn" data-move-component="up" ${isFirst ? 'disabled' : ''} aria-label="Move up">↑</button>
        <button type="button" class="mb-component-rail__btn" data-move-component="down" ${isLast ? 'disabled' : ''} aria-label="Move down">↓</button>
      </div>
      ${cardHtml}
    </div>`;
}
```

- [ ] **Step 2: Add `moveComponentInEditor`**

In `scripts/guides.js`, near `rerenderOpenComponentEditor` (after line 647), add:
```js
// In-memory reorder: swap a component with its neighbour in the open editor's
// working list, re-render, and mark the form dirty. Order is BATCH — it is not
// committed here; it rides the parent form's next save through the merge engine.
function moveComponentInEditor(formEl, uuid, dir) {
  const ed = openComponentEditor;
  if (!ed || ed.formEl !== formEl || !Array.isArray(ed.components)) return;
  const i = ed.components.findIndex(c => uuidOfComponent(c) === uuid);
  if (i < 0) return;
  const j = dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= ed.components.length) return;
  const next = ed.components.slice();
  [next[i], next[j]] = [next[j], next[i]];
  ed.components = next;
  renderComponents(ed.listEl, next, ed.container.kind === 'guide-section');
  formEl._refreshSaveState?.(); // programmatic field change doesn't fire input/change
}
```

- [ ] **Step 3: Route arrow clicks in `onComponentEditorClick`**

In `scripts/guides.js`, add a branch at the TOP of `onComponentEditorClick` (after `const formEl = e.currentTarget;`, line 793):
```js
  const moveBtn = e.target.closest('[data-move-component]');
  if (moveBtn) {
    if (moveBtn.disabled) return;
    const row = moveBtn.closest('[data-component-uuid]');
    moveComponentInEditor(formEl, row?.dataset.componentUuid, moveBtn.dataset.moveComponent);
    return;
  }
```

- [ ] **Step 4: Carry `components` + `_reorderRehydrate` on every open-editor mount**

The reorder working copy and the post-merge re-render hook must be attached wherever an editor is mounted. Add `components` to each `openComponentEditor` / `setOpenComponentEditor` assignment and define `_reorderRehydrate` once per mount. Concretely:

(a) Add — near `setOpenComponentEditor` (line 639) — ONE exported re-render used by every host's post-merge hook, plus a tiny `attachReorderState(formEl)` that wires it. This single export is reused by the system-update host in Task B7 (no duplicated hook bodies):
```js
// Post-merge / post-arrow re-render of the open editor in a given UUID order.
// Exported so non-guide hosts (system updates) reuse the exact same re-render.
export function reorderOpenComponentEditor(order) {
  const ed = openComponentEditor;
  if (!ed) return;
  ed.components = reorderComponents(ed.components, order);
  renderComponents(ed.listEl, ed.components, ed.container.kind === 'guide-section');
}

// Wires the form's mergeSave reorder-rehydrate hook to the shared re-render.
function attachReorderState(formEl) {
  formEl._reorderRehydrate = (order) => reorderOpenComponentEditor(order);
}
```

(b) `setOpenComponentEditor` should accept and keep `components`. It already stores the object verbatim; ensure callers include `components`. Update each site:
- `openEditGuideSection` (line 562-563):
  ```js
  renderComponents(listEl, components);
  openComponentEditor = { formEl, listEl, container: { kind: 'guide-section', uuid, file: currentGuide.draftPath }, components };
  attachReorderState(formEl);
  ```
- `openEditGuideAdmonition` (line 1119-1121):
  ```js
  renderComponents(listEl, components, false);
  openComponentEditor = { formEl, listEl, container: { kind: 'guide-admonition', uuid, file: containerFile }, components };
  attachReorderState(formEl);
  ```
- `transitionSectionCreateToEdit` (line 872-874) and `transitionAdmonitionCreateToEdit` (line 1207-1209): update those `setOpenComponentEditor({ formEl, listEl, container })` calls to include `components: []`, then call `attachReorderState(formEl)` right after.
- `rerenderOpenComponentEditor` (line 641-647): after computing `components`, refresh the stored working copy:
  ```js
  async function rerenderOpenComponentEditor() {
    const ed = openComponentEditor;
    if (!ed?.formEl?.isConnected) return;
    const md = await readRepoText(ed.container.file);
    const { components } = readContainerComponents(md, ed.container);
    ed.components = components;
    renderComponents(ed.listEl, components, ed.container.kind === 'guide-section');
  }
  ```
- `mountUpdateComponentsEditor` (systemUpdates.js) sets the open editor via `setOpenComponentEditor` — handled in Task B7 (it reuses the same `reorderOpenComponentEditor` export).

- [ ] **Step 5: Verify it parses**

Run: `node --check scripts/guides.js`
Expected: no output (success).

- [ ] **Step 6: Manual smoke (browser)**

Open a section with 3 components. Click ↑/↓ on the middle card — it swaps and the save button flips to the green "unsaved" state. Top card's ↑ and bottom card's ↓ are disabled. Don't save yet; proceed to B6.

- [ ] **Step 7: Commit**

```bash
git add scripts/guides.js
git commit -m "feat(reorder): arrow rail + in-memory reorder of the open editor"
```

---

## Task B6: `mergeSave` rehydrates `orderedUuidList`; section saver writes order

**Files:**
- Modify: `scripts/mergeSave.js` — `rehydrateFields`
- Modify: `scripts/guides.js` — `saveSectionForComponent` (890-949)

- [ ] **Step 1: `rehydrateFields` handles the order field**

In `scripts/mergeSave.js`, extend `rehydrateFields` (lines 61-78) to set the hidden order input and trigger the editor's re-render hook:
```js
function rehydrateFields(formEl, fieldSpecs, resolved) {
  if (!resolved) return;
  for (const spec of fieldSpecs) {
    if (spec.type === 'orderedUuidList') {
      const val = resolved[spec.name];
      if (val === undefined) continue;
      const field = formEl.querySelector(`[name="${spec.name}"]`);
      if (field) field.value = val;
      formEl._reorderRehydrate?.(String(val).split(',').filter(Boolean));
      continue;
    }
    if (spec.type !== 'scalar') continue;
    // … existing scalar rehydrate unchanged …
  }
}
```

- [ ] **Step 2: Wire `componentOrder` into `saveSectionForComponent`**

In `scripts/guides.js`, in the edit branch of `saveSectionForComponent` (the `mergeSave` call at lines 923-947), add the order field spec, read it from fresh, build a label-describer for the resolver, and reorder the fresh components in `build`:
```js
  // Map UUID → display descriptor for the order-conflict resolver. Built from
  // the union of the open editor's working components and whatever readFresh last
  // parsed, so both "mine" and "theirs" UUIDs resolve to a label/thumbnail.
  const labelMap = {};
  const noteLabels = comps => {
    for (const c of comps) {
      if (c.kind === 'admonition') {
        const { title } = splitTitleMeta(c.adm.title || '');
        labelMap[c.adm.uuid] = { kind: 'admonition', title: title || (ADMONITION_TYPE_LABELS[c.adm.type] ?? c.adm.type) };
      } else {
        labelMap[c.cap.uuid] = { kind: 'capture', thumbSrc: assetCdnUrl('docs/assets/' + c.cap.lightFilename) };
      }
    }
  };
  noteLabels(openComponentEditor?.components ?? []);

  await mergeSave({
    formEl,
    file: currentGuide.draftPath,
    onProgress,
    resolverOptions: { describe: (uuid) => labelMap[uuid] },
    fieldSpecs: [
      { name: 'sectionTitle', type: 'scalar', label: 'Title' },
      { name: 'sectionDescription', type: 'scalar', label: 'Description' },
      { name: 'componentOrder', type: 'orderedUuidList', label: 'Component order' },
    ],
    readFresh: md => {
      const sec = locateSectionByUUID(md, editUuid);
      const { components } = readContainerComponents(md, { kind: 'guide-section', uuid: editUuid });
      noteLabels(components);
      return {
        sectionTitle: sec?.title ?? '',
        sectionDescription: parseComponents(readSectionDescription(md, editUuid).descriptionMarkdown ?? '', GUIDE_ADMONITION_TYPES_RE).description ?? '',
        componentOrder: components.map(uuidOfComponent).join(','),
      };
    },
    build: (md, resolved) => {
      const sec = locateSectionByUUID(md, editUuid);
      if (!sec) throw new Error('Section no longer exists.');
      const { components } = readContainerComponents(md, { kind: 'guide-section', uuid: editUuid });
      const ordered = reorderComponents(components, (resolved.componentOrder ?? '').split(',').filter(Boolean));
      const newBody = buildComponentBody(null, (resolved.sectionDescription ?? '').trim(), ordered);
      let updated = replaceSectionByUUID(md, editUuid, buildSection(sec.level, (resolved.sectionTitle ?? '').trim(), editUuid, newBody));
      if (parentChanged) updated = moveSectionToParent(updated, editUuid, requestedParent);
      return updated;
    },
  });
```
`ADMONITION_TYPE_LABELS`, `splitTitleMeta`, `assetCdnUrl` are already imported in `guides.js`.

- [ ] **Step 3: Verify both parse**

Run: `node --check scripts/mergeSave.js && node --check scripts/guides.js`
Expected: no output (success).

- [ ] **Step 4: Manual smoke (browser) — the core scenario**

1. **Clean reorder:** reorder components in a section, Save → reload the guide → order persisted.
2. **Reorder + concurrent add:** Tab 1 opens a section, reorders. Tab 2 (opened before) inserts a new admonition into the same section (immediate-save). Tab 1 saves → the new admonition is present AND tab 1's order is honoured (new one slotted at its fresh position). No clobber.
3. **Order conflict:** Tab 1 reorders A,B,C→C,B,A. Tab 2 reorders A,B,C→B,A,C and saves. Tab 1 saves → the resolver shows a single "Component order" row with two numbered lists (admonition titles; captures show a thumbnail + "Capture"). Choose one; confirm the saved order.
4. **Cancel:** trigger an order conflict, click **Cancel** → the panel closes, the save button returns to its normal state, nothing is written.

- [ ] **Step 5: Commit**

```bash
git add scripts/mergeSave.js scripts/guides.js
git commit -m "feat(reorder): merge + write component order on the section saver"
```

---

## Task B7: extend reorder to admonition & system-update hosts (rollout step 3 + order)

**Files:**
- Modify: `scripts/guides.js` — `saveAdmonitionForComponent` (1225-1236) / `persistAdmonitionEdit` (1179-1193)
- Modify: `scripts/systemUpdates.js` — `saveUpdateForComponent` (165-179) / `mountUpdateComponentsEditor` (136-146)

These savers don't yet route through `mergeSave`. Wire their scalar fields through the engine and add `componentOrder`, so reorder works in admonition bodies and system-update bodies (the update's own list position stays date-driven and is untouched).

- [ ] **Step 1: Admonition edit → `mergeSave`**

In `scripts/guides.js`, replace `persistAdmonitionEdit` (lines 1179-1193) with a merge-based edit. Keep `saveAdmonitionForComponent`'s create branch as-is (create mints a fresh UUID — never merged):
```js
async function persistAdmonitionEdit(formEl, onProgress = () => {}) {
  const { type, title, description, prefix } = readAdmonitionFields(formEl);
  if (!type) { alert('Type is required.'); return null; }
  const editUuid = formEl.dataset.editUuid;
  const file = formEl.dataset.containerFile || currentGuide?.draftPath;
  const draftMarkdown = await readRepoText(file);
  if (!locateGuideAdmonition(draftMarkdown, editUuid)) { alert('Admonition no longer exists.'); return null; }

  const labelMap = {};
  const noteLabels = comps => {
    for (const c of comps) {
      if (c.kind === 'admonition') {
        const { title: t } = splitTitleMeta(c.adm.title || '');
        labelMap[c.adm.uuid] = { kind: 'admonition', title: t || (ADMONITION_TYPE_LABELS[c.adm.type] ?? c.adm.type) };
      } else {
        labelMap[c.cap.uuid] = { kind: 'capture', thumbSrc: assetCdnUrl('docs/assets/' + c.cap.lightFilename) };
      }
    }
  };
  noteLabels(openComponentEditor?.components ?? []);

  await mergeSave({
    formEl, file, onProgress,
    resolverOptions: { describe: (uuid) => labelMap[uuid] },
    fieldSpecs: [
      { name: 'admonitionType', type: 'scalar', label: 'Type' },
      { name: 'admonitionTitle', type: 'scalar', label: 'Title' },
      { name: 'admonitionMeta', type: 'scalar', label: 'Note' },
      { name: 'admonitionCollapsible', type: 'scalar', label: 'Collapsible' },
      { name: 'admonitionDescription', type: 'scalar', label: 'Description' },
      { name: 'componentOrder', type: 'orderedUuidList', label: 'Component order' },
    ],
    readFresh: md => {
      const adm = locateGuideAdmonition(md, editUuid);
      const { components } = readContainerComponents(md, { kind: 'guide-admonition', uuid: editUuid });
      noteLabels(components);
      const { title: t, meta } = splitTitleMeta(adm?.title || '');
      const { description: d } = parseComponents(adm?.body ?? '', GUIDE_ADMONITION_TYPES_RE);
      return {
        admonitionType: adm?.type ?? type,
        admonitionTitle: adm?.type === 'step' ? '' : (t ?? ''),
        admonitionMeta: meta ?? '',
        admonitionCollapsible: prefixToCollapsible(adm?.prefix ?? '!!!'),
        admonitionDescription: d ?? '',
        componentOrder: components.map(uuidOfComponent).join(','),
      };
    },
    build: (md, resolved) => {
      if (!locateGuideAdmonition(md, editUuid)) throw new Error('Admonition no longer exists.');
      const { components } = readContainerComponents(md, { kind: 'guide-admonition', uuid: editUuid });
      const ordered = reorderComponents(components, (resolved.componentOrder ?? '').split(',').filter(Boolean));
      const mergedTitle = joinTitleMeta(resolved.admonitionType === 'step' ? '' : resolved.admonitionTitle, resolved.admonitionMeta);
      const body = buildComponentBody(editUuid, resolved.admonitionDescription, ordered);
      return replaceAdmonitionByUUID(md, editUuid, buildAdmonition(collapsibleToPrefix(resolved.admonitionCollapsible), resolved.admonitionType, mergedTitle, body));
    },
  });
  return { editUuid, file };
}
```
`saveAdmonitionForComponent` already calls `persistAdmonitionEdit` then `resetDirtyBaseline` — `mergeSave` resets the baseline itself, so remove the now-redundant `resetDirtyBaseline(formEl)` from `saveAdmonitionForComponent`'s edit branch (line 1234) to avoid a double reset (Plan 1 gotcha #5).

- [ ] **Step 2: `mountUpdateComponentsEditor` carries the working list + reorder hook**

In `scripts/systemUpdates.js`, `mountUpdateComponentsEditor` (lines 136-146): the open editor needs `components` in its stored object + the `_reorderRehydrate` hook, reusing the `reorderOpenComponentEditor` export added to `guides.js` in Task B5. Extend the `guides.js` import (line 11-14) to include `reorderOpenComponentEditor`, then:
```js
function mountUpdateComponentsEditor(formEl, { uuid, file, kind, components }) {
  formEl.dataset.editUuid = uuid;
  formEl.dataset.componentContainerKind = kind;
  formEl.dataset.containerFile = file;
  formEl.dataset.mode = 'edit';
  formEl._componentSaver = () => saveUpdateForComponent(formEl);
  const listEl = formEl.querySelector('[data-update-components]');
  renderComponents(listEl, components, false);
  setOpenComponentEditor({ formEl, listEl, container: { kind, uuid, file }, components });
  formEl._reorderRehydrate = (order) => reorderOpenComponentEditor(order);
  formEl.addEventListener('click', onComponentEditorClick);
}
```

- [ ] **Step 3: `saveUpdateForComponent` → `mergeSave` (scalar incl. ISO date + order)**

In `scripts/systemUpdates.js`, replace `saveUpdateForComponent` (lines 165-179) with a merge-based save covering both `system-update` and `system-draft`. The display/ISO date is normalized on both sides (Plan 1 gotcha #3 + the spec's date-normalization note):
```js
async function saveUpdateForComponent(formEl) {
  const { title, date, type, description } = readUpdateFormFields(formEl); // date is ISO from the form
  if (!title || !date || !type) { alert('Please fill in all required fields.'); return null; }
  const uuid = formEl.dataset.editUuid;
  const kind = formEl.dataset.componentContainerKind; // 'system-update' | 'system-draft'
  const file = formEl.dataset.containerFile;

  // Label map for the order-conflict resolver. readFresh populates it before any
  // conflict is surfaced (the merge runs inside the build loop, after readFresh),
  // so no pre-fetch is needed.
  const labelMap = {};
  const noteLabels = comps => {
    for (const c of comps) {
      if (c.kind === 'admonition') labelMap[c.adm.uuid] = { kind: 'admonition', title: (c.adm.title || c.adm.type) };
      else labelMap[c.cap.uuid] = { kind: 'capture', thumbSrc: assetCdnUrl('docs/assets/' + c.cap.lightFilename) };
    }
  };

  await mergeSave({
    formEl, file,
    resolverOptions: { describe: (u) => labelMap[u] },
    fieldSpecs: [
      { name: 'updateTitle', type: 'scalar', label: 'Title' },
      { name: 'updateDate', type: 'scalar', label: 'Date' },
      { name: 'updateType', type: 'scalar', label: 'Type' },
      { name: 'description', type: 'scalar', label: 'Description' },
      { name: 'componentOrder', type: 'orderedUuidList', label: 'Component order' },
    ],
    readFresh: md => {
      const block = parseUpdateBlocks(md).find(u => u.uuid === uuid);
      const di = block ? parseDateStr(block.date) : null;
      const isoDate = di ? `${di.year}-${String(di.month).padStart(2,'0')}-${String(di.day).padStart(2,'0')}` : '';
      const { description, components } = readUpdateComponents(md, uuid);
      noteLabels(components);
      return {
        updateTitle: block?.title ?? '',
        updateDate: isoDate,
        updateType: block?.type ?? '',
        description: description ?? '',
        componentOrder: components.map(uuidOfComponent).join(','),
      };
    },
    build: (md, resolved) => {
      const { components } = readUpdateComponents(md, uuid);
      const ordered = reorderComponents(components, (resolved.componentOrder ?? '').split(',').filter(Boolean));
      const body = buildComponentBody(uuid, resolved.description, ordered);
      const upd = { title: resolved.updateTitle, date: resolved.updateDate, type: resolved.updateType, uuid, description: body };
      return kind === 'system-update'
        ? replaceUpdateInMarkdown(md, uuid, upd, [])
        : replaceDraftInMarkdown(md, uuid, upd, []);
    },
  });
  return { container: { kind, uuid, file }, formEl };
}
```
Add the needed imports to `systemUpdates.js`: `import { mergeSave } from './mergeSave.js';`, `import { assetCdnUrl } from './repoClient.js';`, and extend the components import with `uuidOfComponent, reorderComponents`. Remove the now-unused `resetDirtyBaseline` call from this saver (mergeSave handles it).

> **Scope note:** the Save button handlers `submitEditSystemUpdate` (509-530) and `saveDraftEditSystemUpdate` (617-638) still call the old `rebuildUpdateBody` + `replaceUpdateInMarkdown` path directly. Point them at `saveUpdateForComponent` so the merge path is the single source of truth: replace their body with `const res = await saveUpdateForComponent(formEl); formEl._refreshSaveState?.();` (wrapped in the existing try/catch + `setButtonBusy`). This keeps one save path per form (Plan 1 gotcha #6).

- [ ] **Step 4: Verify both parse**

Run: `node --check scripts/guides.js && node --check scripts/systemUpdates.js`
Expected: no output (success).

- [ ] **Step 5: Run the full pure suite (no regressions)**

Run: `node --test tests/formMerge.test.mjs && node --test tests/captureUuid.test.mjs`
Expected: PASS — all tests green.

- [ ] **Step 6: Manual smoke (browser)**

- **Admonition:** open an admonition with sub-components, reorder them, save → persisted. Concurrent add into the same admonition from another tab → merged, order honoured.
- **System update:** open a system update (and a draft) with ≥2 inner components, reorder, save → persisted; the update's position in the dated list is unchanged. Force a title conflict on the update → resolver appears (proves step-3 scalar merge is live).

- [ ] **Step 7: Commit**

```bash
git add scripts/guides.js scripts/systemUpdates.js
git commit -m "feat(reorder): merge-based saves + reorder for admonition & system-update hosts"
```

---

## Task B8: whole-feature verification pass

**Files:** none (verification only)

- [ ] **Step 1: Pure suites green**

Run: `node --test tests/formMerge.test.mjs && node --test tests/captureUuid.test.mjs`
Expected: all PASS.

- [ ] **Step 2: All touched scripts parse**

Run: `for f in components captures formMerge mergeSave conflictResolver guides captureComponent systemUpdates cardRenderer; do node --check scripts/$f.js || echo "FAIL $f"; done`
Expected: no `FAIL` lines.

- [ ] **Step 3: Manual end-to-end matrix (browser)**

Confirm each, on a real draft:
- [ ] Capture wrong-target bug fixed (edit 2nd of two captures hits the right one).
- [ ] Capture dim edit merges across two tabs (resolver, not clobber).
- [ ] Reorder persists in a section, an admonition, and a system-update body.
- [ ] Reorder + concurrent add merges (new component kept, your order honoured).
- [ ] Order conflict shows the numbered two-list resolver with admonition titles + capture thumbnails.
- [ ] Resolver **Cancel** restores the save button and writes nothing.
- [ ] System-update list order (by date) is never altered by component reorder.
- [ ] A pending reorder is persisted (not lost) when you then insert/edit a child component (save-gate fires).

- [ ] **Step 4: Update the handover status (optional housekeeping)**

If keeping the handover doc current, note Plan 2 complete and which manual checks passed. Commit:
```bash
git add docs/superpowers/plans/2026-06-07-kb-conflict-merge-2-reorder-HANDOVER.md
git commit -m "docs(plans): mark Plan 2 (capture UUIDs + reorder) complete"
```

---

## Self-review notes (for the executor)

- **Plan 1 gotchas honoured:** no new script files (no manifest churn) #1; reads already use the `github.js` cache-bust pattern unchanged #2; `readFresh`/hydration normalization matched for `componentOrder` (join) and capture `dimValue` (`''` for `none`) #3; resolver/handlers operate on `formEl.parentElement` #4; `resetDirtyBaseline` owned by `mergeSave` — redundant calls removed in B7 #5; reorder rides the shared `_componentSaver`/`beginChildNavigation` save-gate, never a side channel #6; pure logic via `node --test`, wiring via `node --check` #7; engine dispatches on `spec.type` #8.
- **Dependency order:** Part A (esp. A1–A4, A6) must land before B (orderedUuidList needs capture UUIDs to track captures in mixed lists). B1 before B2/B6/B7. B3 before B6 (resolver options/cancel). B4 before B5. B5 before B6/B7.
- **Batch-reorder asymmetry** (reorder is in-memory until the container saves) is intentional per spec; the save-gate (B5 working copy + B6/B7 merge writes) prevents silent loss.
