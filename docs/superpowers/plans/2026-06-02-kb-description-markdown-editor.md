# KB Description Markdown-Source Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the buggy contentEditable WYSIWYG in the KB Description field with a GitHub-style markdown-source editor (visible textarea + toolbar that inserts markdown markers) and a toggleable Edit | Preview pane.

**Architecture:** The textarea stays visible and is the single source of truth holding raw markdown. Toolbar buttons are pure string transforms (`markdownToolbarActions.js`) on the textarea value + selection. Preview is render-only via the existing `markdownInline.js` (`renderHtml(parseInline(value))`), shown behind a segmented Edit | Preview tab. `richTextEditor.js` is rewritten to be DOM wiring only and keeps the same `upgradeTextarea(textarea)` entry point, so `form.js` is untouched.

**Tech Stack:** Vanilla ES modules (no bundler), MV3 Chrome extension, plain-assert Node test files run with `node tests/<name>.test.mjs`, CSS in `config/forms/formsStyling.css` using `--mb-*` custom properties.

**Execution mode:** Subagent-driven (superpowers:subagent-driven-development) — one fresh subagent per task with a review checkpoint between tasks. Work happens on branch `feat/kb-description-markdown-editor`. Task 5 is manual QA performed by the human, not a subagent.

---

## File Structure

- **Create** `scripts/markdownToolbarActions.js` — pure, DOM-free string transforms. `applyMarker` and `applyLink`. The testable core.
- **Create** `tests/markdownToolbarActions.test.mjs` — plain-assert tests mirroring `tests/markdownInline.test.mjs`.
- **Rewrite** `scripts/richTextEditor.js` — DOM wiring only: wrapper, segmented tabs, toolbar buttons, link popover, preview pane. Same `upgradeTextarea` signature.
- **Modify** `manifest.json` — add `scripts/markdownToolbarActions.js` to `web_accessible_resources`.
- **Modify** `config/forms/formsStyling.css` — restyle the `.mb-rte` block for a visible textarea, segmented tabs, and preview pane; remove dead `.mb-rte__surface` rules.
- **Untouched:** `scripts/markdownInline.js` (reused as-is), `scripts/form.js:988` (entry point unchanged).

---

## Task 1: Pure markdown toolbar actions (TDD)

**Files:**
- Create: `scripts/markdownToolbarActions.js`
- Test: `tests/markdownToolbarActions.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/markdownToolbarActions.test.mjs`:

```js
import assert from 'node:assert/strict';
import { applyMarker, applyLink } from '../scripts/markdownToolbarActions.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// applyMarker — wrap a non-empty selection
test('wrap whole value in bold', () => {
  assert.deepEqual(applyMarker('foo', 0, 3, '**'),
    { value: '**foo**', selStart: 2, selEnd: 5 });
});

// applyMarker — partial word only (bug #2 regression)
test('wrap only the selected part of a word', () => {
  assert.deepEqual(applyMarker('foobar', 0, 3, '**'),
    { value: '**foo**bar', selStart: 2, selEnd: 5 });
});

// applyMarker — collapsed cursor inserts markers and sits between them (bug #1)
test('collapsed cursor inserts paired markers with caret between', () => {
  assert.deepEqual(applyMarker('', 0, 0, '**'),
    { value: '****', selStart: 2, selEnd: 2 });
});
test('collapsed cursor mid-text', () => {
  assert.deepEqual(applyMarker('ab', 1, 1, '*'),
    { value: 'a**b', selStart: 2, selEnd: 2 });
});

// applyMarker — toggle off when markers sit OUTSIDE the selection
test('toggle off: markers immediately outside selection', () => {
  assert.deepEqual(applyMarker('**foo**', 2, 5, '**'),
    { value: 'foo', selStart: 0, selEnd: 3 });
});

// applyMarker — toggle off when markers are INSIDE the selection edges
test('toggle off: selection includes the markers', () => {
  assert.deepEqual(applyMarker('**foo**', 0, 7, '**'),
    { value: 'foo', selStart: 0, selEnd: 3 });
});

// applyMarker — different markers
test('highlight marker', () => {
  assert.deepEqual(applyMarker('hi', 0, 2, '=='),
    { value: '==hi==', selStart: 2, selEnd: 4 });
});

// applyLink — splice [text](url) at the selection, caret after snippet
test('applyLink splices markdown link at caret', () => {
  assert.deepEqual(applyLink('see ', 4, 4, 'docs', 'https://x'),
    { value: 'see [docs](https://x)', selStart: 21, selEnd: 21 });
});
test('applyLink replaces a selection', () => {
  assert.deepEqual(applyLink('see here', 4, 8, 'here', 'https://x'),
    { value: 'see [here](https://x)', selStart: 21, selEnd: 21 });
});

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/markdownToolbarActions.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/markdownToolbarActions.js'` (or `applyMarker is not a function`).

- [ ] **Step 3: Write minimal implementation**

Create `scripts/markdownToolbarActions.js`:

```js
// Pure, DOM-free string transforms for the KB Description markdown toolbar.
// Each function takes the current value + selection range and returns the new
// value and the selection range to restore. No DOM, no side effects — unit
// tested in tests/markdownToolbarActions.test.mjs.

// Wrap (or unwrap) the selection in `marker` (e.g. '**', '*', '^^', '~~', '==').
// - Collapsed selection  -> insert paired markers, caret between them.
// - Already wrapped       -> strip the markers (toggle off).
// - Otherwise             -> wrap the selection, keeping the inner text selected.
export function applyMarker(value, selStart, selEnd, marker) {
  const len = marker.length;

  // Collapsed: insert "marker+marker" and drop the caret in the middle.
  if (selStart === selEnd) {
    const caret = selStart + len;
    return {
      value: value.slice(0, selStart) + marker + marker + value.slice(selEnd),
      selStart: caret,
      selEnd: caret,
    };
  }

  const selected = value.slice(selStart, selEnd);

  // Toggle off: markers immediately OUTSIDE the selection.
  if (
    value.slice(selStart - len, selStart) === marker &&
    value.slice(selEnd, selEnd + len) === marker
  ) {
    return {
      value: value.slice(0, selStart - len) + selected + value.slice(selEnd + len),
      selStart: selStart - len,
      selEnd: selEnd - len,
    };
  }

  // Toggle off: markers INSIDE the selection edges.
  if (
    selected.length >= 2 * len &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    const inner = selected.slice(len, selected.length - len);
    return {
      value: value.slice(0, selStart) + inner + value.slice(selEnd),
      selStart,
      selEnd: selStart + inner.length,
    };
  }

  // Wrap, keeping the inner text selected.
  return {
    value: value.slice(0, selStart) + marker + selected + marker + value.slice(selEnd),
    selStart: selStart + len,
    selEnd: selStart + len + selected.length,
  };
}

// Splice a `[text](url)` markdown link at the selection, replacing it.
// Caret is placed after the inserted snippet.
export function applyLink(value, selStart, selEnd, text, url) {
  const snippet = `[${text}](${url})`;
  const caret = selStart + snippet.length;
  return {
    value: value.slice(0, selStart) + snippet + value.slice(selEnd),
    selStart: caret,
    selEnd: caret,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/markdownToolbarActions.test.mjs`
Expected: PASS — `9 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/markdownToolbarActions.js tests/markdownToolbarActions.test.mjs
git commit -m "feat: pure markdown toolbar actions (applyMarker/applyLink)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Register the new module in the manifest

**Files:**
- Modify: `manifest.json`

- [ ] **Step 1: Add the module to web_accessible_resources**

In `manifest.json`, find `"scripts/markdownInline.js"` inside the first
`web_accessible_resources` `resources` array and add the new module immediately
after it. Change:

```
"scripts/markdownInline.js", "scripts/richTextEditor.js",
```

to:

```
"scripts/markdownInline.js", "scripts/markdownToolbarActions.js", "scripts/richTextEditor.js",
```

- [ ] **Step 2: Verify the JSON is still valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('valid')"`
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add manifest.json
git commit -m "chore: register markdownToolbarActions.js in manifest

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Rewrite richTextEditor.js as DOM wiring

**Files:**
- Modify (full rewrite): `scripts/richTextEditor.js`

This module has no automated tests in this project (DOM wiring; the project's
tests are pure-logic only). It is verified manually in Task 5. The pure logic it
depends on is already covered by Task 1.

- [ ] **Step 1: Replace the entire file contents**

Overwrite `scripts/richTextEditor.js` with:

```js
import { parseInline, renderHtml } from './markdownInline.js';
import { applyMarker, applyLink } from './markdownToolbarActions.js';

// Toolbar marks: { marker } is the literal markdown delimiter inserted into the
// textarea (the single source of truth). Order matches the old toolbar.
const MARKS = [
  { marker: '**', icon: 'format_bold', label: 'Bold (Ctrl/Cmd+B)' },
  { marker: '*', icon: 'format_italic', label: 'Italic (Ctrl/Cmd+I)' },
  { marker: '^^', icon: 'format_underlined', label: 'Underline (Ctrl/Cmd+U)' },
  { marker: '~~', icon: 'strikethrough_s', label: 'Strikethrough' },
  { marker: '==', icon: 'format_ink_highlighter', label: 'Highlight' },
];

const SHORTCUT = { b: '**', i: '*', u: '^^' };

export function upgradeTextarea(textarea) {
  if (textarea.dataset.rteReady === '1') return; // idempotent
  textarea.dataset.rteReady = '1';

  const wrapper = document.createElement('div');
  wrapper.className = 'mb-rte';

  const toolbar = document.createElement('div');
  toolbar.className = 'mb-rte__toolbar';

  // Segmented Edit | Preview tabs (left).
  const tabs = document.createElement('div');
  tabs.className = 'mb-rte__tabs';
  const editTab = makeTab('Edit', true);
  const previewTab = makeTab('Preview', false);
  tabs.append(editTab, previewTab);
  toolbar.appendChild(tabs);

  // Format buttons (right).
  const btnGroup = document.createElement('div');
  btnGroup.className = 'mb-rte__btns';
  toolbar.appendChild(btnGroup);

  // Render-only preview pane (hidden until Preview is selected).
  const preview = document.createElement('div');
  preview.className = 'mb-rte__preview';
  preview.hidden = true;

  // Keep the textarea visible — it stays the form value / source of truth.
  textarea.classList.add('mb-rte__input');
  textarea.parentNode.insertBefore(wrapper, textarea);
  wrapper.appendChild(toolbar);
  wrapper.appendChild(textarea);
  wrapper.appendChild(preview);

  const rte = { textarea, toolbar, preview, btnGroup, editTab, previewTab, buttons: [] };

  buildButtons(rte);
  attachLinkPopover(rte);
  buildTabs(rte);
  attachShortcuts(rte);

  wrapper._rte = rte; // expose for tests / later wiring
  return rte;
}

function makeTab(text, active) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mb-rte__tab' + (active ? ' --active' : '');
  b.setAttribute('aria-pressed', String(active));
  b.textContent = text;
  return b;
}

function makeBtn(icon, label, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mb-rte__btn';
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.innerHTML = `<span class="more-buttons-icon">${icon}</span>`;
  btn.addEventListener('mousedown', e => e.preventDefault()); // keep textarea selection
  btn.addEventListener('click', onClick);
  return btn;
}

// Apply a marker transform to the textarea and restore selection + fire input.
function runMarker(rte, marker) {
  const { textarea } = rte;
  const res = applyMarker(textarea.value, textarea.selectionStart, textarea.selectionEnd, marker);
  textarea.value = res.value;
  textarea.focus();
  textarea.setSelectionRange(res.selStart, res.selEnd);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function buildButtons(rte) {
  MARKS.forEach(m => {
    const btn = makeBtn(m.icon, m.label, () => runMarker(rte, m.marker));
    rte.btnGroup.appendChild(btn);
    rte.buttons.push(btn);
  });
  const linkBtn = makeBtn('link', 'Link (Ctrl/Cmd+K)', () => rte.openLinkPopover?.());
  rte.btnGroup.appendChild(linkBtn);
  rte.buttons.push(linkBtn);
}

function buildTabs(rte) {
  rte.editTab.addEventListener('click', () => setMode(rte, 'edit'));
  rte.previewTab.addEventListener('click', () => setMode(rte, 'preview'));
}

function setMode(rte, mode) {
  const previewing = mode === 'preview';
  rte.editTab.classList.toggle('--active', !previewing);
  rte.previewTab.classList.toggle('--active', previewing);
  rte.editTab.setAttribute('aria-pressed', String(!previewing));
  rte.previewTab.setAttribute('aria-pressed', String(previewing));
  rte.textarea.hidden = previewing;
  rte.preview.hidden = !previewing;
  rte.buttons.forEach(b => { b.disabled = previewing; });
  if (previewing) {
    const html = renderHtml(parseInline(rte.textarea.value || ''));
    rte.preview.innerHTML = html || '<span class="mb-rte__preview-empty">Nothing to preview</span>';
  }
}

function attachShortcuts(rte) {
  rte.textarea.addEventListener('keydown', e => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const key = e.key.toLowerCase();
    if (SHORTCUT[key]) { e.preventDefault(); runMarker(rte, SHORTCUT[key]); }
    else if (key === 'k') { e.preventDefault(); rte.openLinkPopover?.(); }
  });
}

function attachLinkPopover(rte) {
  const { textarea, toolbar } = rte;
  let savedStart = 0, savedEnd = 0;

  const popover = document.createElement('div');
  popover.className = 'mb-rte__popover';
  popover.hidden = true;
  popover.innerHTML = `
    <label class="mb-rte__field"><span>Text</span><input type="text" data-link-text></label>
    <label class="mb-rte__field"><span>URL</span><input type="text" data-link-url placeholder="https://"></label>
    <div class="mb-rte__popover-actions">
      <button type="button" class="mb-rte__popover-btn" data-link-cancel>Cancel</button>
      <button type="button" class="mb-rte__popover-btn --primary" data-link-insert>Insert</button>
    </div>`;
  toolbar.parentNode.insertBefore(popover, toolbar.nextSibling);

  const textInput = popover.querySelector('[data-link-text]');
  const urlInput = popover.querySelector('[data-link-url]');
  const close = () => { popover.hidden = true; };

  rte.openLinkPopover = () => {
    savedStart = textarea.selectionStart;
    savedEnd = textarea.selectionEnd;
    textInput.value = textarea.value.slice(savedStart, savedEnd);
    urlInput.value = '';
    popover.hidden = false;
    urlInput.focus();
  };

  popover.querySelector('[data-link-cancel]').addEventListener('click', close);

  popover.querySelector('[data-link-insert]').addEventListener('click', () => {
    const url = urlInput.value.trim();
    const text = textInput.value.trim() || url;
    if (!url) { close(); return; } // empty URL → no-op
    const res = applyLink(textarea.value, savedStart, savedEnd, text, url);
    textarea.value = res.value;
    close();
    textarea.focus();
    textarea.setSelectionRange(res.selStart, res.selEnd);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // Esc / click-outside dismiss.
  popover.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  document.addEventListener('mousedown', e => {
    if (!popover.hidden && !popover.contains(e.target) && !toolbar.contains(e.target)) close();
  });
}
```

- [ ] **Step 2: Syntax-check the module**

Run: `node --check scripts/richTextEditor.js`
Expected: no output (exit 0). (It imports browser-only globals but `--check`
only parses, it does not execute.)

- [ ] **Step 3: Confirm the existing inline-markdown tests still pass**

Run: `node tests/markdownInline.test.mjs`
Expected: PASS — `24 passed` (unchanged; this module was not modified).

- [ ] **Step 4: Commit**

```bash
git add scripts/richTextEditor.js
git commit -m "feat: rewrite KB description editor as markdown-source + preview

Textarea is now the single source of truth; toolbar inserts markdown
markers via markdownToolbarActions; Edit | Preview tabs toggle a
render-only pane. Removes the contentEditable selection model that
caused the collapsed-selection and partial-word toggle bugs.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Restyle the .mb-rte CSS block

**Files:**
- Modify: `config/forms/formsStyling.css:2291-2314` (the `.mb-rte__surface*` rules)

- [ ] **Step 1: Replace the surface rules with input + tabs + preview styles**

In `config/forms/formsStyling.css`, replace this block (the contentEditable
surface rules, currently lines 2291-2314):

```css
.mb-rte__surface {
  min-height: 8.5rem; /* ~ old rows="6" */
  padding: 8px 9px;
  border: 1px solid var(--mb-border);
  border-radius: 0 0 6px 6px;
  font-size: 0.875rem;
  color: var(--mb-text);
  background-color: var(--mb-bg-input);
  outline: none;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.mb-rte__surface:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.5);
}
.mb-rte__surface:empty::before {
  content: attr(data-placeholder);
  color: var(--mb-text-placeholder);
}
.mb-rte__surface mark { background-color: #fef08a; color: inherit; }
.mb-rte__surface u { text-decoration: underline; }
.mb-rte__surface s { text-decoration: line-through; }
.mb-rte__surface a { color: #3b82f6; text-decoration: underline; }
```

with:

```css
/* Segmented Edit | Preview tabs (left side of the toolbar). */
.mb-rte__tabs {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: 6px;
  background-color: var(--mb-border-subtle);
}
.mb-rte__tab {
  padding: 3px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--mb-text-label);
  font-size: 0.8rem;
  cursor: pointer;
}
.mb-rte__tab.--active {
  background-color: var(--mb-bg-input);
  color: var(--mb-text);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
}

/* Format buttons sit to the right of the tabs. */
.mb-rte__btns {
  display: flex;
  gap: 2px;
  margin-left: auto;
}
.mb-rte__btn:disabled { opacity: 0.4; cursor: default; }
.mb-rte__btn:disabled:hover { background: transparent; }

/* The textarea is now visible and the source of truth (raw markdown). */
.mb-rte__input {
  display: block;
  width: 100%;
  min-height: 8.5rem; /* ~ old rows="6" */
  padding: 8px 9px;
  box-sizing: border-box;
  border: 1px solid var(--mb-border);
  border-top: none;
  border-radius: 0 0 6px 6px;
  font-family: inherit;
  font-size: 0.875rem;
  color: var(--mb-text);
  background-color: var(--mb-bg-input);
  outline: none;
  resize: vertical;
}
.mb-rte__input:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.5);
}

/* Render-only preview pane (shown when Preview tab is active). */
.mb-rte__preview {
  min-height: 8.5rem;
  padding: 8px 9px;
  border: 1px solid var(--mb-border);
  border-top: none;
  border-radius: 0 0 6px 6px;
  font-size: 0.875rem;
  color: var(--mb-text);
  background-color: var(--mb-bg-input);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.mb-rte__preview-empty { color: var(--mb-text-placeholder); }
.mb-rte__preview mark { background-color: #fef08a; color: inherit; }
.mb-rte__preview u { text-decoration: underline; }
.mb-rte__preview s { text-decoration: line-through; }
.mb-rte__preview a { color: #3b82f6; text-decoration: underline; }
```

- [ ] **Step 2: Confirm no stale `mb-rte__surface` references remain**

Run: `grep -rn "mb-rte__surface" scripts config`
Expected: no matches (the rewritten `richTextEditor.js` no longer emits it).

- [ ] **Step 3: Commit**

```bash
git add config/forms/formsStyling.css
git commit -m "style: restyle .mb-rte for visible textarea + Edit/Preview tabs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Manual verification in the extension

**Files:** none (manual QA).

- [ ] **Step 1: Load the unpacked extension**

Open `chrome://extensions`, enable Developer mode, "Load unpacked" → select the
`more-buttons-unpacked` directory (or click the reload icon if already loaded).

- [ ] **Step 2: Open a KB Description form and verify each fix**

Navigate to the Knowledge Base management form that renders a
`textarea[data-richtext]` Description field, then confirm:

1. **Bug #1 fixed:** With the description empty, click **Bold**, then type — the
   text appears between `**…**` markers (caret was placed between them).
2. **Bug #2 fixed:** Type `foobar`, select only `foo`, click **Bold** → value is
   `**foo**bar` (only the selection is wrapped).
3. **Toggle off:** Select `foo` inside `**foo**` and click **Bold** again → the
   markers are removed.
4. **Shortcuts:** Ctrl/Cmd+B, +I, +U wrap the selection; Ctrl/Cmd+K opens the
   link popover; inserting fills `[text](url)`.
5. **Preview:** Click the **Preview** tab → the markdown renders (bold/italic/
   highlight/link); format buttons are greyed out; click **Edit** → textarea
   returns with content intact.
6. **Dirty guard / counter:** Editing marks the form dirty (navigation warns),
   and any character counter updates as you type.

- [ ] **Step 3: Confirm the full test suite passes**

Run: `node tests/markdownToolbarActions.test.mjs && node tests/markdownInline.test.mjs`
Expected: `9 passed` then `24 passed`.

---

## Self-Review Notes

- **Spec coverage:** markdown-source model (Task 3), pure transforms + tests
  (Task 1), inline-only preview reusing `renderHtml(parseInline)` (Task 3),
  preview disables format buttons + segmented tabs (Tasks 3-4), new module in
  manifest (Task 2), CSS cleanup of dead surface rules (Task 4), manual verify
  including dirty-guard/counter (Task 5). All spec sections map to a task.
- **No false-dirty:** `form.js:988` runs `upgradeTextarea` before the dirty-guard
  snapshot; the textarea value is unchanged by the upgrade (we only wrap it in
  DOM and add a class), so the snapshot still sees the original markdown.
- **Naming consistency:** `applyMarker` / `applyLink` signatures and the
  `{ value, selStart, selEnd }` return shape are identical across the test
  (Task 1), the implementation (Task 1), and the consumers (Task 3).
