# Unified Form Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate full-screen loading tile with a veil centered inside the open form tile, cover back/forward/breadcrumb navigation, and consolidate every loading state in the extension behind one module (`scripts/loading.js`).

**Architecture:** A new `scripts/loading.js` owns all loading UX: a `formLoading` singleton (200ms grace timer; renders a translucent veil INSIDE the currently-open `.more-buttons-overlay-content`, falling back to a standalone tile only when no form is open), a `loadingMarkup()` helper that is the single source of truth for inline "Loading…" placeholders, and the button-busy helpers (`setButtonBusy`/`snapshotButton`/`restoreButton`) moved out of form.js. form.js arms `formLoading` in its action dispatcher (existing) and — new — in `navigateTo()` (covers back/forward/crumb). All ~10 scattered inline `'<p class="more-buttons-description">Loading…</p>'` strings are replaced with `loadingMarkup()`.

**Tech Stack:** Vanilla ES modules (Chrome MV3 content scripts, no bundler), plain-node test files (`node tests/<file>.test.mjs`, no framework/jsdom — house pattern in `tests/captureResizeBox.test.mjs`), CSS in `config/forms/formsStyling.css`.

---

## Critical repo facts (read before starting)

1. **Dirty working tree.** `manifest.json` and `config/forms/formsStyling.css` (and several capture scripts) carry unrelated uncommitted WIP. NEVER `git add -A`. Stage only the files each task names; for manifest.json and formsStyling.css stage only your own hunks (`git add -p`, verify with `git diff --cached` before committing, and verify the WIP hunks survive unstaged after).
2. **Workflow commits directly to `main`.**
3. **Every script in `scripts/` must be listed individually in manifest.json `web_accessible_resources[0].resources`.** A missing entry fails at runtime with "Failed to fetch dynamically imported module". The same error with a correct manifest means a stale extension — reload at chrome://extensions after any manifest change.
4. **Old-form constraint:** while a navigation action is in flight, handlers read fields from the CURRENT form (e.g. `_componentSaver`). The veil overlays the tile; it must never replace or mutate the form's DOM.
5. `.more-buttons-overlay-content` is `display:flex; flex-direction:column; max-width:540px; overflow:hidden; position:relative` (formsStyling.css:93–107) — an absolutely-positioned veil with `inset:0` works without layout changes.
6. Existing loading-tile feature history: spec `docs/superpowers/specs/2026-06-10-form-loading-tile-design.md`, commits `1555acc`…`ca2aa98`. This plan supersedes the standalone-tile presentation.

## Design decisions (already made — do not relitigate)

- **Veil over tile:** when the grace timer fires and a form tile is open, append `<div class="more-buttons-loading-veil">` INSIDE the last open `.more-buttons-overlay-content` (excluding a fallback loading tile itself). Translucent background so the form ghosts through; spinner + "Loading…" centered. When NO form is open, fall back to the existing standalone tile presentation.
- **`navigateTo()` arms loading** — single chokepoint that covers the navbar back/forward arrows, breadcrumb clicks, and programmatic `navigateBack()`/`navigateForward()` (e.g. after deletes).
- **Busy buttons win:** `setButtonBusy()` calls `formLoading.dismiss()` as its first act, so a save that shows fine-grained amber-button progress never gets a competing veil. (The dispatcher armed the veil; the action signals it has its own loading UX.)
- **`createForm` keeps dismissing at HTML render** (form is interactive immediately; slower sub-content uses inline loaders), the fetch-error path and overlay `cleanup()` keep dismissing too. Re-arm-after-replay calls in captures.js stay.
- **`scripts/loadingTile.js` is deleted**, replaced by `scripts/loading.js` (manifest entry swapped). The singleton moves out of form.js into loading.js; form.js re-exports the button helpers so existing importers (`guides.js`, `systemUpdates.js`, `contentTabsEditor.js`, etc.) don't churn.
- **Wording standard:** `Loading…` (single ellipsis character), with contextual variants allowed as the label argument (`Loading draft…`, `Loading drafts…`). Plain-text placeholders that are already `Loading…` and too small for a spinner (guideEntry.html `<h2>` title, integrations.html rate-limit meta) stay as plain text.

## Audit catalogue (what exists today — basis for Task 5)

| Site | Mechanism | Covers |
|---|---|---|
| scripts/loadingTile.js (whole file) | standalone overlay tile | form-to-form navigation (to be replaced) |
| form.js:~770/796 dispatcher, ~427 cleanup, ~448/457 createForm | loadingTile show/dismiss | data-action navigations |
| guides.js:~146,~153 (section cards), ~865 (component cards) | loadingTile show/dismiss | card navigations |
| captures.js:~138,~150,~156,~198,~204 | loadingTile show/dismiss + re-arm | capture/library insert chains |
| form.js:~1033 data-fetch-path | inline `Loading...` (3 dots — inconsistent) | markdown panel fetch |
| guides.js:168 | inline `Loading draft…` | guide entry draft fetch |
| systemUpdates.js:420 | inline `Loading drafts...` (3 dots) | drafts panel |
| captureComponent.js:61 | inline `Loading…` | preview blob fetches |
| captureLibrary.js:112 | inline `Loading…` | library tree |
| captureEntry.js:197 | inline `Loading…` | repo image fetch |
| knowledgeBaseManagement.js:85–86 | inline `Loading…` ×2 | KB hierarchy panels |
| config/forms/guideEntry.html:2,4 | static `Loading…` | template placeholders |
| config/forms/integrations.html:25 + integrations.js:31 | static/text `Loading…` | rate-limit meta (leave as-is) |
| form.js:288–313 setButtonBusy/snapshotButton/restoreButton | amber busy button | GitHub commits |
| guides.js:~1160, captureComponent.js:~148, contentTabsEditor.js:~481 | ad-hoc `btn.disabled`/`textContent` restore | delete commits (loses CSS classes/icons on restore — Task 6) |
| Back/forward/crumb (form.js navigateTo:325, navbar wiring ~615–630) | NOTHING | slow opener replays (Task 3 fixes) |

---

### Task 1: `scripts/loading.js` module (TDD) — veil/tile state machine + `loadingMarkup`

**Files:**
- Create: `scripts/loading.js`
- Test: `tests/loading.test.mjs`
- Delete: `scripts/loadingTile.js`, `tests/loadingTile.test.mjs`
- Modify: `manifest.json` (swap web_accessible_resources entry)

Note: deleting `loadingTile.js` makes form.js/guides.js/captures.js momentarily broken at runtime (they import it) until Tasks 3–4. That's fine — tests don't import those files, and tasks commit in sequence on main within one sitting. Do NOT reload/exercise the extension between Tasks 1 and 4.

- [ ] **Step 1: Write the failing test**

Create `tests/loading.test.mjs`:

```js
import assert from 'node:assert/strict';
import { createFormLoading, loadingMarkup } from '../scripts/loading.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// Minimal stand-ins for the browser deps: a document that can create/append/
// remove elements and answer the one querySelectorAll the module issues, and
// hand-fired cancellable timers. No jsdom — house plain-node test style.
function makeEl(tag) {
  return {
    tag, className: '', innerHTML: '', children: [], parent: null,
    appendChild(child) { this.children.push(child); child.parent = this; },
    remove() {
      if (!this.parent) return;
      const i = this.parent.children.indexOf(this);
      if (i >= 0) this.parent.children.splice(i, 1);
      this.parent = null;
    },
  };
}

const TILE_SELECTOR = '.more-buttons-overlay-content:not(.more-buttons-loading-tile)';

function fakeDoc({ openTiles = [] } = {}) {
  return {
    body: makeEl('body'),
    openTiles, // elements returned for the open-form-tile query
    createElement: (tag) => makeEl(tag),
    querySelectorAll(selector) {
      assert.equal(selector, TILE_SELECTOR); // module must use exactly this query
      return this.openTiles;
    },
  };
}

function fakeTimers() {
  let nextId = 1;
  const pending = new Map();
  return {
    schedule: (fn, ms) => { const id = nextId++; pending.set(id, fn); return id; },
    cancel: (id) => { pending.delete(id); },
    fire() { const fns = [...pending.values()]; pending.clear(); fns.forEach(fn => fn()); },
    count: () => pending.size,
  };
}

function setup(docOpts) {
  const doc = fakeDoc(docOpts);
  const timers = fakeTimers();
  const loading = createFormLoading({ doc, schedule: timers.schedule, cancel: timers.cancel });
  return { doc, timers, loading };
}

test('show: nothing rendered before the grace timer fires', () => {
  const { doc, timers, loading } = setup();
  loading.show();
  assert.equal(doc.body.children.length, 0);
  assert.equal(timers.count(), 1);
});

test('veil: with a form tile open, grace fire appends a veil INSIDE the last tile', () => {
  const tileA = makeEl('div');
  const tileB = makeEl('div');
  const { doc, timers, loading } = setup({ openTiles: [tileA, tileB] });
  loading.show();
  timers.fire();
  assert.equal(doc.body.children.length, 0);       // nothing appended to body
  assert.equal(tileA.children.length, 0);
  assert.equal(tileB.children.length, 1);          // last tile hosts the veil
  const veil = tileB.children[0];
  assert.equal(veil.className, 'more-buttons-loading-veil');
  assert.match(veil.innerHTML, /more-buttons-icon--spin/);
  assert.match(veil.innerHTML, /Loading…/);
});

test('fallback: with no form tile open, grace fire appends a standalone tile to body', () => {
  const { doc, timers, loading } = setup({ openTiles: [] });
  loading.show();
  timers.fire();
  assert.equal(doc.body.children.length, 1);
  const overlay = doc.body.children[0];
  assert.equal(overlay.className, 'more-buttons-overlay');
  const content = overlay.children[0];
  assert.equal(content.className, 'more-buttons-overlay-content more-buttons-loading-tile');
  assert.match(content.innerHTML, /more-buttons-icon--spin/);
  assert.match(content.innerHTML, /Loading…/);
});

test('dismiss before grace fires: timer cancelled, nothing ever rendered', () => {
  const tile = makeEl('div');
  const { doc, timers, loading } = setup({ openTiles: [tile] });
  loading.show();
  loading.dismiss();
  assert.equal(timers.count(), 0);
  timers.fire();
  assert.equal(tile.children.length, 0);
  assert.equal(doc.body.children.length, 0);
});

test('dismiss removes a visible veil', () => {
  const tile = makeEl('div');
  const { timers, loading } = setup({ openTiles: [tile] });
  loading.show();
  timers.fire();
  loading.dismiss();
  assert.equal(tile.children.length, 0);
});

test('dismiss removes a visible fallback tile', () => {
  const { doc, timers, loading } = setup({ openTiles: [] });
  loading.show();
  timers.fire();
  loading.dismiss();
  assert.equal(doc.body.children.length, 0);
});

test('dismiss is safe when the veil host was already torn down', () => {
  const tile = makeEl('div');
  const { timers, loading } = setup({ openTiles: [tile] });
  loading.show();
  timers.fire();
  tile.children.length = 0;          // host tile destroyed externally (createForm
                                     // teardown); the veil's parent ref goes stale
  loading.dismiss();                 // must not throw
  loading.show();                    // and must be re-armable
  assert.equal(timers.count(), 1);
});

test('show is a singleton: double show arms one timer, no re-arm while visible', () => {
  const tile = makeEl('div');
  const { timers, loading } = setup({ openTiles: [tile] });
  loading.show();
  loading.show();
  assert.equal(timers.count(), 1);
  timers.fire();
  loading.show();
  assert.equal(timers.count(), 0);
  assert.equal(tile.children.length, 1);
});

test('dismiss with nothing pending is a safe no-op', () => {
  const { loading } = setup();
  loading.dismiss();
});

test('show works again after a full cycle, re-querying the CURRENT tile', () => {
  const tileA = makeEl('div');
  const { doc, timers, loading } = setup({ openTiles: [tileA] });
  loading.show(); timers.fire(); loading.dismiss();
  const tileB = makeEl('div');
  doc.openTiles = [tileB];           // navigation replaced the open form
  loading.show(); timers.fire();
  assert.equal(tileA.children.length, 0);
  assert.equal(tileB.children.length, 1);
});

test('loadingMarkup: default label, spinner, description classes', () => {
  const html = loadingMarkup();
  assert.match(html, /more-buttons-loading-inline/);
  assert.match(html, /more-buttons-icon--spin/);
  assert.match(html, /progress_activity/);
  assert.match(html, /Loading…/);
});

test('loadingMarkup: custom label', () => {
  assert.match(loadingMarkup('Loading drafts…'), /Loading drafts…/);
});

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/loading.test.mjs`
Expected: FAIL — `Cannot find module '.../scripts/loading.js'`

- [ ] **Step 3: Write the implementation**

Create `scripts/loading.js`:

```js
// loading.js — the single owner of every loading affordance in the extension.
//
//   1. formLoading (singleton): the navigation loading state. show() arms a
//      200ms grace timer; if the navigation is still in flight when it fires,
//      a translucent veil with a spinner is centered INSIDE the open form
//      tile (.more-buttons-overlay-content) — the form's DOM is never touched,
//      because in-flight handlers still read the old form's fields. If no form
//      is open (fresh entry), a standalone loading tile is shown instead.
//      dismiss() cancels/removes either. Idempotent both ways.
//
//      Arming sites: form.js's data-action dispatcher, form.js navigateTo()
//      (back/forward/crumb), guides.js card navigations, captures.js insert
//      chains. Dismissal: createForm() at HTML render + fetch error, overlay
//      cleanup(), every arming site's finally, and setButtonBusy() (a busy
//      button is richer feedback than the veil, so it takes over).
//
//   2. loadingMarkup(label): canonical inline placeholder for content areas
//      that load after their form renders (previews, panels, trees).
//
//   3. setButtonBusy / snapshotButton / restoreButton: amber busy-button
//      progress for GitHub commits (moved from form.js; form.js re-exports).
//
// Deps are injectable so the state machine is testable in plain node
// (see tests/loading.test.mjs).

const SPINNER =
  '<span class="more-buttons-icon more-buttons-icon--spin">progress_activity</span>';

// Open form tiles, excluding the standalone loading tile itself.
const TILE_SELECTOR = '.more-buttons-overlay-content:not(.more-buttons-loading-tile)';

export function loadingMarkup(label = 'Loading…') {
  return `<p class="more-buttons-description more-buttons-loading-inline">${SPINNER}${label}</p>`;
}

export function createFormLoading({
  doc = globalThis.document,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (id) => clearTimeout(id),
  graceMs = 200,
} = {}) {
  let timer = null;
  let element = null; // the veil, or the fallback overlay

  function show() {
    if (timer !== null || element) return;
    timer = schedule(() => {
      timer = null;
      const tiles = doc.querySelectorAll(TILE_SELECTOR);
      const host = tiles.length ? tiles[tiles.length - 1] : null;
      if (host) {
        element = doc.createElement('div');
        element.className = 'more-buttons-loading-veil';
        element.innerHTML = `${SPINNER}<p class="more-buttons-description">Loading…</p>`;
        host.appendChild(element);
      } else {
        element = doc.createElement('div');
        element.className = 'more-buttons-overlay';
        const content = doc.createElement('div');
        content.className = 'more-buttons-overlay-content more-buttons-loading-tile';
        content.innerHTML = `${SPINNER}<p class="more-buttons-description">Loading…</p>`;
        element.appendChild(content);
        doc.body.appendChild(element);
      }
    }, graceMs);
  }

  function dismiss() {
    if (timer !== null) { cancel(timer); timer = null; }
    if (element) { element.remove(); element = null; }
  }

  return { show, dismiss };
}

// Shared singleton. Module-eval-safe outside the browser: the defaults only
// dereference `document` inside show(), which tests never reach (they inject).
export const formLoading = createFormLoading();

// ── Busy buttons (moved verbatim from form.js, plus the dismiss handoff) ────

// Put a save/publish button into the amber "working" state while a GitHub
// commit runs: disabled, amber, spinning change_circle icon, and a progress message.
// The icon is built once (so the spin doesn't restart on each message tick) and
// only the message span updates on subsequent calls.
export function setButtonBusy(btn, message) {
  // A busy button is the action's own loading UX — drop any pending/visible
  // navigation veil so the two never compete.
  formLoading.dismiss();
  if (!btn) return;
  btn.disabled = true;
  if (!btn.classList.contains('busy')) {
    btn.classList.remove('info', 'success', 'publish', 'danger', 'secondary');
    btn.classList.add('busy');
    btn.innerHTML = '<span class="more-buttons-icon more-buttons-icon--spin">change_circle</span><span data-busy-msg></span>';
  }
  const msgEl = btn.querySelector('[data-busy-msg]');
  if (msgEl) msgEl.textContent = message;
  else btn.textContent = message;
}

// Capture/restore a button's look so a non-dynamic (publish) button can be put
// back after a busy state on error. Dynamic save buttons use _refreshSaveState
// instead.
export function snapshotButton(btn) {
  return btn ? { html: btn.innerHTML, className: btn.className } : null;
}

export function restoreButton(btn, snap) {
  if (!btn || !snap) return;
  btn.className = snap.className;
  btn.innerHTML = snap.html;
  btn.disabled = false;
}
```

IMPORTANT: before writing, open the CURRENT `scripts/form.js` and copy its `setButtonBusy`/`snapshotButton`/`restoreButton` bodies verbatim (lines ~288–313) in case they drifted from the snapshot above — the only intended change is the added `formLoading.dismiss();` first line and its comment.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/loading.test.mjs`
Expected: PASS — `12 passed`

- [ ] **Step 5: Delete the old module and test; swap the manifest entry**

```bash
git rm scripts/loadingTile.js tests/loadingTile.test.mjs
```

In `manifest.json` `web_accessible_resources[0].resources`, change the line `"scripts/loadingTile.js",` to `"scripts/loading.js",` (same position, after `"scripts/form.js",`). Stage ONLY that hunk (`git add -p manifest.json`) — the file may carry unrelated WIP hunks which must remain unstaged.

- [ ] **Step 6: Commit**

```bash
git add scripts/loading.js tests/loading.test.mjs
# manifest.json hunk already staged via add -p; loadingTile deletions staged by git rm
git commit -m "feat(forms): unified loading module — veil-in-tile + inline markup + busy buttons"
```

---

### Task 2: CSS — veil, inline placeholder, generalized reduced-motion

**Files:**
- Modify: `config/forms/formsStyling.css` (the "Form loading tile" section, ~lines 727–752)

- [ ] **Step 1: Extend the Form loading tile section**

Find the existing section (directly after the `.more-buttons-icon--spin` rule):

```css
/* ── Form loading tile ────────────────────────────────────────────────────
   Full-screen tile shown during slow form-to-form navigations (see
   scripts/loadingTile.js). Same surface/width as a real form tile so the
   swap to the destination form isn't jarring. */
.more-buttons-overlay-content.more-buttons-loading-tile {
  min-height: 200px;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.more-buttons-loading-tile .more-buttons-icon {
  font-size: 1.75rem;
  color: var(--mb-text-muted);
}

.more-buttons-loading-tile .more-buttons-description {
  margin: 0;
}

@media (prefers-reduced-motion: reduce) {
  .more-buttons-loading-tile .more-buttons-icon--spin {
    animation: none;
  }
}
```

Replace that whole block with:

```css
/* ── Loading states ───────────────────────────────────────────────────────
   Owned by scripts/loading.js. Three surfaces:
   - .more-buttons-loading-veil: translucent cover centered INSIDE the open
     form tile during slow navigations (the form ghosts through beneath).
   - .more-buttons-loading-tile: standalone fallback when no form is open.
   - .more-buttons-loading-inline: loadingMarkup() placeholder for content
     areas that stream in after their form renders. */
.more-buttons-loading-veil {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: color-mix(in srgb, var(--mb-bg) 88%, transparent);
  border-radius: 12px;
}

.more-buttons-overlay-content.more-buttons-loading-tile {
  min-height: 200px;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.more-buttons-loading-veil .more-buttons-icon,
.more-buttons-loading-tile .more-buttons-icon {
  font-size: 1.75rem;
  color: var(--mb-text-muted);
}

.more-buttons-loading-veil .more-buttons-description,
.more-buttons-loading-tile .more-buttons-description {
  margin: 0;
}

.more-buttons-loading-inline {
  display: flex;
  align-items: center;
  gap: 6px;
}

@media (prefers-reduced-motion: reduce) {
  .more-buttons-icon--spin {
    animation: none;
  }
}
```

Notes: the `border-radius: 12px` matches the tile's own radius so the veil doesn't poke out of the rounded corners; `z-index: 10` clears in-tile content (the tile creates its own stacking context via `position: relative`). The reduced-motion rule is deliberately generalized to ALL spinning icons (veil, tile, inline placeholders, busy buttons) — a static glyph still reads as "working".

- [ ] **Step 2: Commit (partial-stage — file carries unrelated WIP)**

```bash
git add -p config/forms/formsStyling.css   # stage ONLY this section's hunks
git diff --cached                          # verify: only the loading section changed
git commit -m "feat(forms): loading veil styling; generalize reduced-motion to all spinners"
git diff config/forms/formsStyling.css     # verify: pre-existing WIP hunks still unstaged
```

---

### Task 3: form.js — adopt loading.js, arm navigateTo, unify fetch-path markup

**Files:**
- Modify: `scripts/form.js` (imports ~1–29; helpers ~283–313; navigateTo ~325; createForm dismiss sites ~427/448/457; dispatcher ~770/796; data-fetch-path ~1033)

`scripts/form.js` has no unrelated WIP — plain staging is fine. All `loadingTile` references in form.js become `formLoading`.

- [ ] **Step 1: Swap the import and remove the local singleton + helper definitions**

Replace:

```js
import { createLoadingTile } from './loadingTile.js';
```

with:

```js
import { formLoading, loadingMarkup } from './loading.js';
```

Delete the singleton block:

```js
// Singleton "Loading…" tile for slow form-to-form navigations. Exported so
// programmatic open paths that bypass the click dispatcher can opt in later.
export const loadingTile = createLoadingTile();
```

Delete the three helper definitions (`setButtonBusy`, `snapshotButton`, `restoreButton`, ~lines 283–313 including their comments) and replace them with a re-export so the many existing importers (`guides.js`, `systemUpdates.js`, `contentTabsEditor.js`, …) keep working unchanged:

```js
// Busy-button helpers live in loading.js now; re-exported here because most
// form modules already import them from form.js.
export { setButtonBusy, snapshotButton, restoreButton } from './loading.js';
```

- [ ] **Step 2: Rename the remaining call sites**

Replace every remaining `loadingTile.` in form.js with `formLoading.` — there are five: `cleanup()` (~427), createForm fetch-error path (~448), createForm post-`innerHTML` (~457), dispatcher `show()` (~770), dispatcher `finally` (~796). Verify none remain:

Run: `grep -n "loadingTile" scripts/form.js`
Expected: no output.

- [ ] **Step 3: Arm navigateTo (back/forward/breadcrumb coverage)**

Current code (~line 321):

```js
// Jump to a history index by replaying that entry's opener. We deliberately do
// NOT clean up the current overlay here: re-running the opener calls createForm,
// which tears down the current overlay itself. That keeps `activeFormCleanup`
// set during the replay so createForm treats it as in-session navigation.
async function navigateTo(index) {
  if (index < 0 || index >= history.length) return;
  navMode = 'replay';
  cursor = index;
  await history[index].opener();
}
```

Change to:

```js
// Jump to a history index by replaying that entry's opener. We deliberately do
// NOT clean up the current overlay here: re-running the opener calls createForm,
// which tears down the current overlay itself. That keeps `activeFormCleanup`
// set during the replay so createForm treats it as in-session navigation.
async function navigateTo(index) {
  if (index < 0 || index >= history.length) return;
  navMode = 'replay';
  cursor = index;
  // Back/forward/crumb replays bypass the action dispatcher, so arm the
  // loading veil here; slow openers (GitHub re-fetches before createForm)
  // get feedback, fast ones never outlive the grace period. createForm
  // drops it at render; the finally mops up failures.
  formLoading.show();
  try {
    await history[index].opener();
  } finally {
    formLoading.dismiss();
  }
}
```

- [ ] **Step 4: Unify the data-fetch-path placeholder**

In the data-fetch-path block (~line 1033), replace:

```js
      // Show loading state
      el.innerHTML = '<p class="more-buttons-description">Loading...</p>';
```

with:

```js
      // Show loading state
      el.innerHTML = loadingMarkup();
```

- [ ] **Step 5: Parse-check and run the suite**

```bash
cp scripts/form.js /tmp/form_check.mjs && node --check /tmp/form_check.mjs
for f in tests/*.test.mjs; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done; echo SUITE-DONE
```
Expected: no parse error; only `SUITE-DONE`.

- [ ] **Step 6: Commit**

```bash
git add scripts/form.js
git commit -m "feat(forms): veil on back/forward/crumb navigation; form.js adopts loading.js"
```

---

### Task 4: guides.js + captures.js — rename to formLoading, import from loading.js

**Files:**
- Modify: `scripts/guides.js` (import line ~16; call sites ~146–155, ~865–869)
- Modify: `scripts/captures.js` (import line ~15; call sites ~138–161, ~198–208)

Neither file carries unrelated WIP at plan time — but re-check `git status` first.

- [ ] **Step 1: guides.js**

In the form.js import line, remove `loadingTile` from the named imports (keep all the others exactly as they are), and add a new import line after it:

```js
import { formLoading } from './loading.js';
```

Then replace all `loadingTile.` with `formLoading.` (sites: the two section-card branches in `onGuideEntryClick`, and `beginChildNavigation`'s show/finally).

Run: `grep -n "loadingTile" scripts/guides.js`
Expected: no output.

- [ ] **Step 2: captures.js**

Change:

```js
import { snapshotFormStack, replayFormStack, loadingTile } from './form.js';
```

to:

```js
import { snapshotFormStack, replayFormStack } from './form.js';
import { formLoading } from './loading.js';
```

Then replace all `loadingTile.` with `formLoading.` (sites: `runComponentCaptureFlow`'s `onComplete` warm + cold paths, and `completeLibraryInsert` including its re-arm).

Run: `grep -n "loadingTile" scripts/captures.js scripts/*.js`
Expected: no output anywhere.

- [ ] **Step 3: Parse-check both files and run the suite**

```bash
cp scripts/guides.js /tmp/g.mjs && node --check /tmp/g.mjs && echo G-OK
cp scripts/captures.js /tmp/c.mjs && node --check /tmp/c.mjs && echo C-OK
for f in tests/*.test.mjs; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done; echo SUITE-DONE
```
Expected: `G-OK`, `C-OK`, only `SUITE-DONE`.

- [ ] **Step 4: Commit**

```bash
git add scripts/guides.js scripts/captures.js
git commit -m "refactor(forms): guides/captures adopt formLoading from loading.js"
```

---

### Task 5: Unify the inline loading placeholders

**Files:**
- Modify: `scripts/guides.js:168`, `scripts/systemUpdates.js:420`, `scripts/captureComponent.js:61`, `scripts/captureLibrary.js:112`, `scripts/captureEntry.js:197`, `scripts/knowledgeBaseManagement.js:85–86`
- Modify: `config/forms/guideEntry.html:4`
- Leave unchanged: `config/forms/guideEntry.html:2` (`<h2>` title), `config/forms/integrations.html:25` + `scripts/integrations.js:31` (plain text is right for those small slots)

- [ ] **Step 1: Add the import to each touched script**

In each of `systemUpdates.js`, `captureComponent.js`, `captureLibrary.js`, `captureEntry.js`, `knowledgeBaseManagement.js`, add to the existing import block (guides.js already imports `formLoading`; extend that line):

```js
import { loadingMarkup } from './loading.js';
```

(For guides.js change its Task-4 line to `import { formLoading, loadingMarkup } from './loading.js';`.)

- [ ] **Step 2: Replace each placeholder string**

| File:line | Old | New |
|---|---|---|
| guides.js:168 | `contentEl.innerHTML = `<p class="more-buttons-description">Loading draft…</p>`;` | `contentEl.innerHTML = loadingMarkup('Loading draft…');` |
| systemUpdates.js:420 | `panel.innerHTML = `<p class="more-buttons-description">Loading drafts...</p>`;` | `panel.innerHTML = loadingMarkup('Loading drafts…');` |
| captureComponent.js:61 | `previewEl.innerHTML = '<p class="more-buttons-description">Loading…</p>';` | `previewEl.innerHTML = loadingMarkup();` |
| captureLibrary.js:112 | `panel.innerHTML = '<p class="more-buttons-description">Loading…</p>';` | `panel.innerHTML = loadingMarkup();` |
| captureEntry.js:197 | `bodyEl.innerHTML = '<p class="more-buttons-description">Loading…</p>';` | `bodyEl.innerHTML = loadingMarkup();` |
| knowledgeBaseManagement.js:85 | `if (livePanel) livePanel.innerHTML = '<p class="more-buttons-description">Loading…</p>';` | `if (livePanel) livePanel.innerHTML = loadingMarkup();` |
| knowledgeBaseManagement.js:86 | `if (systemPanel) systemPanel.innerHTML = '<p class="more-buttons-description">Loading…</p>';` | `if (systemPanel) systemPanel.innerHTML = loadingMarkup();` |

(Line numbers are pre-plan; re-locate by grepping the old string if they've shifted.)

- [ ] **Step 3: Update the static template placeholder**

In `config/forms/guideEntry.html`, replace line 4:

```html
    <p class="more-buttons-description">Loading…</p>
```

with the static equivalent of `loadingMarkup()` (templates can't call JS — keep this markup in sync with loading.js):

```html
    <p class="more-buttons-description more-buttons-loading-inline"><span class="more-buttons-icon more-buttons-icon--spin">progress_activity</span>Loading…</p>
```

- [ ] **Step 4: Parse-check all touched scripts and run the suite**

```bash
for s in guides systemUpdates captureComponent captureLibrary captureEntry knowledgeBaseManagement; do
  cp scripts/$s.js /tmp/$s.mjs && node --check /tmp/$s.mjs || echo "PARSE FAIL: $s"; done; echo PARSE-DONE
for f in tests/*.test.mjs; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done; echo SUITE-DONE
```
Expected: only `PARSE-DONE` and `SUITE-DONE`.

- [ ] **Step 5: Commit**

```bash
git add scripts/guides.js scripts/systemUpdates.js scripts/captureComponent.js scripts/captureLibrary.js scripts/captureEntry.js scripts/knowledgeBaseManagement.js config/forms/guideEntry.html
git commit -m "refactor(forms): all inline loading placeholders via loadingMarkup()"
```

---

### Task 6: Consistent busy-button restore in the three delete handlers

**Files:**
- Modify: `scripts/guides.js` (`deleteGuideSection` handler, ~lines 1159–1169)
- Modify: `scripts/captureComponent.js` (`deleteCaptureComponent` handler, ~lines 144–162)
- Modify: `scripts/contentTabsEditor.js` (`deleteContentTabs` handler, ~lines 475–491)

These handlers restore buttons by hand (`btn.disabled = false; btn.textContent = originalText`), which loses the button's CSS classes and icon markup. Convert them to the house pattern: `snapshotButton` before, `setButtonBusy` for progress, `restoreButton` on error. All three files already import from form.js; extend those imports with `setButtonBusy, snapshotButton, restoreButton` (they re-export from loading.js — check each file's existing form.js import line and add only the missing names).

- [ ] **Step 1: guides.js deleteGuideSection**

Replace:

```js
  const btn = content.querySelector('[data-action="deleteGuideSection"]');
  const originalText = btn?.textContent;
  if (btn) btn.disabled = true;
  try {
    await githubFetchAndPushFile(currentGuide.draftPath, s => { if (btn) btn.textContent = s; }, md => deleteSectionByUUID(md, editUuid, { cascade: true }));
    await chrome.storage.local.remove('moreButtonsEditGuideSection');
    await navigateBack();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    alert('Failed to delete section: ' + e.message);
  }
```

with:

```js
  const btn = content.querySelector('[data-action="deleteGuideSection"]');
  const snap = snapshotButton(btn);
  try {
    await githubFetchAndPushFile(currentGuide.draftPath, s => setButtonBusy(btn, s), md => deleteSectionByUUID(md, editUuid, { cascade: true }));
    await chrome.storage.local.remove('moreButtonsEditGuideSection');
    await navigateBack();
  } catch (e) {
    restoreButton(btn, snap);
    alert('Failed to delete section: ' + e.message);
  }
```

- [ ] **Step 2: captureComponent.js deleteCaptureComponent**

Replace:

```js
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
```

with:

```js
  const btn = content?.querySelector('[data-action="deleteCaptureComponent"]');
  const snap = snapshotButton(btn);
  try {
    await handler.mutate(container, (components) =>
      components.filter(c => !(c.kind === 'capture' && c.cap.uuid === uuid)),
      s => setButtonBusy(btn, s));

    await chrome.storage.local.remove('moreButtonsEditCaptureComponent');
    await navigateBack();
  } catch (e) {
    restoreButton(btn, snap);
    alert('Failed to delete capture: ' + e.message);
  }
```

- [ ] **Step 3: contentTabsEditor.js deleteContentTabs**

Replace:

```js
  const btn = content?.querySelector('[data-action="deleteContentTabs"]');
  const originalText = btn?.textContent;
  if (btn) btn.disabled = true;
  try {
    await githubFetchAndPushFile(file, s => { if (btn) btn.textContent = s; }, md => deleteTabGroupByUUID(md, groupUuid));
    await chrome.storage.local.remove(STORAGE_KEY);
    await navigateBack();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    alert('Failed to delete content tabs: ' + e.message);
  }
```

with:

```js
  const btn = content?.querySelector('[data-action="deleteContentTabs"]');
  const snap = snapshotButton(btn);
  try {
    await githubFetchAndPushFile(file, s => setButtonBusy(btn, s), md => deleteTabGroupByUUID(md, groupUuid));
    await chrome.storage.local.remove(STORAGE_KEY);
    await navigateBack();
  } catch (e) {
    restoreButton(btn, snap);
    alert('Failed to delete content tabs: ' + e.message);
  }
```

Behavior note: with `setButtonBusy` in the progress callback, these delete buttons now also turn amber + spin during the commit (instead of bare text swaps), AND — because `setButtonBusy` dismisses `formLoading` — the dispatcher-armed veil won't cover the progress. The subsequent `navigateBack()` re-arms the veil for the replay, which is correct.

- [ ] **Step 4: Parse-check and run the suite**

```bash
for s in guides captureComponent contentTabsEditor; do
  cp scripts/$s.js /tmp/$s.mjs && node --check /tmp/$s.mjs || echo "PARSE FAIL: $s"; done; echo PARSE-DONE
for f in tests/*.test.mjs; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done; echo SUITE-DONE
```
Expected: only `PARSE-DONE` and `SUITE-DONE`.

- [ ] **Step 5: Commit**

```bash
git add scripts/guides.js scripts/captureComponent.js scripts/contentTabsEditor.js
git commit -m "refactor(forms): delete handlers use busy-button snapshot/restore pattern"
```

---

### Task 7: Docs + final verification

**Files:**
- Modify: `docs/superpowers/specs/2026-06-10-form-loading-tile-design.md` (status note)

- [ ] **Step 1: Mark the old spec superseded**

At the top of `docs/superpowers/specs/2026-06-10-form-loading-tile-design.md`, change `**Status:** Approved` to:

```markdown
**Status:** Superseded by docs/superpowers/plans/2026-06-10-unified-form-loading.md
(standalone tile became a veil inside the open form tile; loading consolidated
into scripts/loading.js)
```

```bash
git add docs/superpowers/specs/2026-06-10-form-loading-tile-design.md
git commit -m "docs(specs): mark loading tile spec superseded by unified loading plan"
```

- [ ] **Step 2: Full verification sweep**

```bash
grep -rn "loadingTile" scripts/ tests/ manifest.json   # expect: no output
grep -rn 'more-buttons-description">Loading' scripts/  # expect: no output (all via loadingMarkup)
for f in tests/*.test.mjs; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done; echo SUITE-DONE
python3 -c "import json;json.load(open('manifest.json'));print('MANIFEST-OK')"
```

- [ ] **Step 3: Manual browser verification (requires the user / a logged-in Chrome)**

Reload the extension at chrome://extensions first (manifest changed). With DevTools network throttling (Slow 4G):

1. **Veil placement:** edit a capture card in a section editor → spinner + "Loading…" centered INSIDE the current form tile (translucent, form ghosting through), NOT a separate blank tile; editor replaces it.
2. **Back/crumb:** from a section editor, click the navbar back arrow and a breadcrumb segment → veil during the replay's re-fetch.
3. **Library insert:** insert-from-library → veil through pick → commit → editor.
4. **Save with busy button:** save a section → amber busy button progress, NO veil over it.
5. **Delete:** delete a section → amber busy progress on the delete button, veil only after, during the back-replay.
6. **Fresh open fallback:** open Manage Knowledge Base from the popup on a throttled connection → standalone loading tile (no form open yet to host a veil).
7. **Fast actions:** throttling off — no veil flashes anywhere (200ms grace).
8. **Escape/error:** Escape mid-load and a forced failure (offline) → no orphaned veil/tile.
9. **Inline placeholders:** guide entry draft, capture preview, KB management panels, capture library, system updates drafts tab → all show the same spinner+text inline style.
10. **Reduced motion:** with the OS reduced-motion setting on, spinners are static (veil, tile, inline, busy buttons).
