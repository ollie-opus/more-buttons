# Form Loading Tile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a centered "Loading…" form tile during slow form-to-form navigations (e.g. library insert → capture editor), centralized so every form action gets it automatically.

**Architecture:** A new `scripts/loadingTile.js` module owns the show/dismiss state machine (200ms anti-flicker grace timer, singleton tile) with injectable `doc`/timer deps so it's unit-testable in plain node. `scripts/form.js` creates the singleton, arms it around the delegated `data-action` click dispatcher (the single funnel all form-button actions flow through), and dismisses it in `createForm()` the moment the new form's HTML renders. The tile layers ON TOP of the current overlay — it never touches the old form's DOM, because action handlers read the old form's fields mid-flight.

**Tech Stack:** Vanilla ES modules (Chrome extension content scripts), plain-node test files (`node tests/<file>.test.mjs`, no test framework — see `tests/captureResizeBox.test.mjs` for the house pattern), CSS in `config/forms/formsStyling.css`.

**Spec:** `docs/superpowers/specs/2026-06-10-form-loading-tile-design.md`

---

### Task 1: `loadingTile.js` module (TDD)

**Files:**
- Create: `scripts/loadingTile.js`
- Test: `tests/loadingTile.test.mjs`
- Modify: `manifest.json` (web_accessible_resources — REQUIRED or form.js's import of the new module fails with "Failed to fetch dynamically imported module")

- [ ] **Step 1: Write the failing test**

Create `tests/loadingTile.test.mjs`:

```js
import assert from 'node:assert/strict';
import { createLoadingTile } from '../scripts/loadingTile.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// Minimal stand-ins for the two browser deps the module touches: a document
// that can create/append/remove elements, and cancellable timers we fire by
// hand. No jsdom — same plain-node style as the other test files.
function fakeDoc() {
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
  return { body: makeEl('body'), createElement: (tag) => makeEl(tag) };
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

function setup() {
  const doc = fakeDoc();
  const timers = fakeTimers();
  const tile = createLoadingTile({ doc, schedule: timers.schedule, cancel: timers.cancel });
  return { doc, timers, tile };
}

test('show: nothing appended before the grace timer fires', () => {
  const { doc, timers, tile } = setup();
  tile.show();
  assert.equal(doc.body.children.length, 0);
  assert.equal(timers.count(), 1);
});

test('show: tile appended after grace fires, with overlay + tile classes', () => {
  const { doc, timers, tile } = setup();
  tile.show();
  timers.fire();
  assert.equal(doc.body.children.length, 1);
  const overlay = doc.body.children[0];
  assert.equal(overlay.className, 'more-buttons-overlay');
  assert.equal(overlay.children.length, 1);
  const content = overlay.children[0];
  assert.equal(content.className, 'more-buttons-overlay-content more-buttons-loading-tile');
  assert.match(content.innerHTML, /more-buttons-icon--spin/);
  assert.match(content.innerHTML, /Loading…/);
});

test('dismiss before grace fires: timer cancelled, nothing ever appended', () => {
  const { doc, timers, tile } = setup();
  tile.show();
  tile.dismiss();
  assert.equal(timers.count(), 0);
  timers.fire(); // no-op; nothing pending
  assert.equal(doc.body.children.length, 0);
});

test('dismiss after tile visible: tile removed from body', () => {
  const { doc, timers, tile } = setup();
  tile.show();
  timers.fire();
  tile.dismiss();
  assert.equal(doc.body.children.length, 0);
});

test('show is a singleton: double show arms one timer and appends one tile', () => {
  const { doc, timers, tile } = setup();
  tile.show();
  tile.show();
  assert.equal(timers.count(), 1);
  timers.fire();
  tile.show(); // already visible — must not arm another timer
  assert.equal(timers.count(), 0);
  assert.equal(doc.body.children.length, 1);
});

test('dismiss with nothing pending is a safe no-op', () => {
  const { tile } = setup();
  tile.dismiss(); // must not throw
});

test('show works again after a full show/dismiss cycle', () => {
  const { doc, timers, tile } = setup();
  tile.show(); timers.fire(); tile.dismiss();
  tile.show(); timers.fire();
  assert.equal(doc.body.children.length, 1);
});

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/loadingTile.test.mjs`
Expected: FAIL — `Cannot find module '.../scripts/loadingTile.js'`

- [ ] **Step 3: Write the implementation**

Create `scripts/loadingTile.js`:

```js
// Full-screen "Loading…" tile shown during slow form-to-form navigations
// (e.g. library insert → capture editor: parent replay + GitHub fetches can
// take 1-2s with no feedback). The tile layers ON TOP of any open overlay and
// never touches the current form's DOM — action handlers read the old form's
// fields while the navigation is in flight.
//
// form.js owns the singleton: the data-action click dispatcher show()s before
// running action steps and dismiss()es in a finally; createForm() dismiss()es
// as soon as the destination form's HTML renders, so the form is interactive
// the moment it exists.
//
// Deps are injectable so the grace/dismiss state machine is testable in plain
// node (see tests/loadingTile.test.mjs).
export function createLoadingTile({
  doc = globalThis.document,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (id) => clearTimeout(id),
  graceMs = 200,
} = {}) {
  let timer = null;
  let overlay = null;

  // Arm the grace timer; the tile only appears if a navigation is still in
  // flight when it fires, so fast actions never flash it. No-op while a show
  // is already pending or visible.
  function show() {
    if (timer !== null || overlay) return;
    timer = schedule(() => {
      timer = null;
      overlay = doc.createElement('div');
      overlay.className = 'more-buttons-overlay';
      const content = doc.createElement('div');
      content.className = 'more-buttons-overlay-content more-buttons-loading-tile';
      content.innerHTML =
        '<span class="more-buttons-icon more-buttons-icon--spin">progress_activity</span>' +
        '<p class="more-buttons-description">Loading…</p>';
      overlay.appendChild(content);
      doc.body.appendChild(overlay);
    }, graceMs);
  }

  function dismiss() {
    if (timer !== null) { cancel(timer); timer = null; }
    if (overlay) { overlay.remove(); overlay = null; }
  }

  return { show, dismiss };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/loadingTile.test.mjs`
Expected: PASS — `7 passed`

- [ ] **Step 5: Add the manifest entry**

In `manifest.json`, in the `web_accessible_resources[0].resources` array, add a line directly after `"scripts/form.js",`:

```json
        "scripts/loadingTile.js",
```

(Scripts are listed individually in this manifest, not globbed. Omitting this makes form.js's import fail at runtime with "Failed to fetch dynamically imported module".)

- [ ] **Step 6: Commit**

```bash
git add scripts/loadingTile.js tests/loadingTile.test.mjs manifest.json
git commit -m "feat(forms): loading tile module with grace-timer state machine"
```

---

### Task 2: Loading tile CSS

**Files:**
- Modify: `config/forms/formsStyling.css` (add a block after `.more-buttons-icon--spin`, which ends around line 725)

- [ ] **Step 1: Add the CSS block**

In `config/forms/formsStyling.css`, directly after the `.more-buttons-icon--spin` rule (the `display: inline-block; animation: more-buttons-spin ...` block, ~line 722–725), add:

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
  font-size: 28px;
  color: var(--mb-text-muted);
}

.more-buttons-loading-tile .more-buttons-description {
  margin: 0;
}
```

Notes for the implementer: `.more-buttons-overlay-content` is already `display: flex; flex-direction: column; max-width: 540px` (formsStyling.css:93), so the block above only needs to center its two children. No `--animate-in` class is used by the tile, so there is no intro fade to suppress.

- [ ] **Step 2: Commit**

```bash
git add config/forms/formsStyling.css
git commit -m "feat(forms): loading tile styling"
```

---

### Task 3: Wire into form.js dispatcher and createForm

**Files:**
- Modify: `scripts/form.js` (imports ~line 1–5; createForm HTML render ~line 433–444; delegated action dispatcher ~line 743–772)

- [ ] **Step 1: Import and create the singleton**

At the top of `scripts/form.js`, after the existing imports (line 5, `import { upgradeTextarea } from './richTextEditor.js';`), add:

```js
import { createLoadingTile } from './loadingTile.js';
```

After the module-level state declarations (just after `let activeNavbarRefresh = null;`, ~line 24), add:

```js
// Singleton "Loading…" tile for slow form-to-form navigations. Exported so
// programmatic open paths that bypass the click dispatcher can opt in later.
export const loadingTile = createLoadingTile();
```

- [ ] **Step 2: Dismiss in createForm when the new form renders**

In `createForm()`, the HTML load currently reads (form.js:432–444):

```js
  // Load form HTML file
  let formHtml;
  try {
    const resp = await fetch(chrome.runtime.getURL(`config/forms/${formName}.html`));
    if (!resp.ok) throw new Error(`Failed to load form HTML: ${resp.status}`);
    formHtml = await resp.text();
  } catch (err) {
    console.error(err);
    content.textContent = 'Failed to load form.';
    return;
  }

  content.innerHTML = formHtml;
```

Change it to dismiss the tile on both outcomes — success (form HTML is on screen, form should be interactive immediately even though the action may still be fetching sub-content) and failure (the error message must not be hidden under the tile):

```js
  // Load form HTML file
  let formHtml;
  try {
    const resp = await fetch(chrome.runtime.getURL(`config/forms/${formName}.html`));
    if (!resp.ok) throw new Error(`Failed to load form HTML: ${resp.status}`);
    formHtml = await resp.text();
  } catch (err) {
    console.error(err);
    loadingTile.dismiss();
    content.textContent = 'Failed to load form.';
    return;
  }

  content.innerHTML = formHtml;
  // The destination form exists now — drop the loading tile so the form is
  // interactive immediately; slower sub-content (e.g. capture preview blobs)
  // falls back to its own in-container "Loading…" labels.
  loadingTile.dismiss();
```

- [ ] **Step 3: Arm/dismiss around the delegated action dispatcher**

The dispatcher currently reads (form.js:743–772):

```js
  content.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn || !content.contains(btn)) return;
    if (btn.hasAttribute('data-validate') && !validateForm()) return;

    const steps = btn.getAttribute('data-action').split(',').map(s => s.trim());
    for (const step of steps) {
      let stepName = step;
      let stepParam = null;

      if (step.includes(':')) {
        [stepName, stepParam] = step.split(':');
      }

      if (actionSteps[stepName]) {
        await actionSteps[stepName](stepParam);
      } else {
        const ctx = { formEl, overlay, content, cleanup, storageKey, validateForm, conditionalEls };
        const registryFn = getFormAction(stepName);
        if (registryFn) {
          await registryFn(ctx);
        } else {
          const mod = window.__mbActionsModule;
          const modFn = mod && typeof mod[stepName] === 'function' ? mod[stepName] : null;
          if (modFn) await modFn(stepParam);
          else console.warn(`createForm: Unknown action step "${stepName}"`);
        }
      }
    }
  });
```

Wrap the steps loop — show before, dismiss in `finally` (safety net for actions that throw or never call createForm; also removes the tile after post-createForm awaits finish in case createForm was never reached):

```js
  content.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn || !content.contains(btn)) return;
    if (btn.hasAttribute('data-validate') && !validateForm()) return;

    const steps = btn.getAttribute('data-action').split(',').map(s => s.trim());
    // Slow navigations (GitHub fetches, parent-form saves) get a "Loading…"
    // tile if still in flight after the grace period; createForm() drops it
    // as soon as the destination form renders. The finally covers actions
    // that throw or never open a form. Bonus: the tile's backdrop blocks
    // double-clicks on this form mid-action.
    loadingTile.show();
    try {
      for (const step of steps) {
        let stepName = step;
        let stepParam = null;

        if (step.includes(':')) {
          [stepName, stepParam] = step.split(':');
        }

        if (actionSteps[stepName]) {
          await actionSteps[stepName](stepParam);
        } else {
          const ctx = { formEl, overlay, content, cleanup, storageKey, validateForm, conditionalEls };
          const registryFn = getFormAction(stepName);
          if (registryFn) {
            await registryFn(ctx);
          } else {
            const mod = window.__mbActionsModule;
            const modFn = mod && typeof mod[stepName] === 'function' ? mod[stepName] : null;
            if (modFn) await modFn(stepParam);
            else console.warn(`createForm: Unknown action step "${stepName}"`);
          }
        }
      }
    } finally {
      loadingTile.dismiss();
    }
  });
```

- [ ] **Step 4: Run the full test suite (regression check)**

Run: `for f in tests/*.test.mjs; do echo "== $f"; node "$f" || break; done`
Expected: every file prints its `N passed` line; no failures. (form.js itself isn't node-importable — these tests cover the modules around it plus the new loadingTile tests.)

- [ ] **Step 5: Commit**

```bash
git add scripts/form.js
git commit -m "feat(forms): show loading tile during slow form navigations"
```

---

### Task 4: Manual verification in the browser

**Files:** none (verification only)

- [ ] **Step 1: Reload the extension**

Open `chrome://extensions`, hit reload on the unpacked extension. (Required — manifest.json changed in Task 1; a stale extension will throw "Failed to fetch dynamically imported module".)

- [ ] **Step 2: Verify the slow path shows the tile**

DevTools → Network tab → throttle to "Slow 4G". Then:
1. Open a guide section editor → "+ Insert Component" → add a capture from the library. Expected: after picking the capture, a blank form tile with a spinner and "Loading…" appears (no dead gap with the stale form), then the capture editor replaces it; the capture preview inside may still show its own in-container "Loading…" while blobs fetch.
2. From a guide form, open "edit section". Expected: same tile during the draft fetch, then the section editor.

- [ ] **Step 3: Verify fast actions never flash the tile**

Throttling off. Click quick actions (tab switches use `data-tab` not `data-action`, so instead use a fast `data-action` button such as opening a form that needs no network, or back/forward nav). Expected: no visible flash of the loading tile (grace timer is 200ms).

- [ ] **Step 4: Verify error + escape paths leave no orphaned tile**

1. With throttling on, trigger a navigation and press Escape mid-load if the old form accepts it. Expected: when the action settles (or fails), no loading tile remains on screen.
2. Simulate a failure (e.g. DevTools offline mode, then attempt edit section). Expected: action errors, tile is dismissed by the dispatcher `finally`, old form remains usable.

- [ ] **Step 5: Report results**

No commit. Report any visual issues (tile size, spinner color, jarring swap) back for adjustment before closing out the feature.
