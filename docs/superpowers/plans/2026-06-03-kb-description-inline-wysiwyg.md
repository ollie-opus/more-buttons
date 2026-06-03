# KB Description — True Inline WYSIWYG Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the KB Description editor a true inline WYSIWYG surface (rendered text is what you type into) with a toggle to raw markdown, while keeping the markdown string as the source of truth and reusing the existing formatting engine unchanged.

**Architecture:** The hidden `<textarea>` stays the source of truth (raw markdown). A `contentEditable` surface is a *rendered projection* of it. Plain typing is native and synced back to the textarea on `input`; formatting routes through the existing `applyMarker`/`applyLink` string transforms via a new bidirectional position-map module (`richEditorMapping.js`). The DOM is disposable — re-rendered on every formatting op.

**Tech Stack:** Plain ES modules (browser extension), no build step. Tests are standalone Node scripts using `node:assert/strict` (run with `node tests/<file>.test.mjs`); no test framework, no `package.json`.

**Design doc:** `docs/superpowers/specs/2026-06-03-kb-description-inline-wysiwyg-design.md`

---

## File Structure

- **Create `scripts/richEditorMapping.js`** — the only new logic. Pure(ish) DOM↔source mapping:
  - `buildSource(root, onText?, onBoundary?)` — walk a contentEditable DOM in document order, reconstruct the markdown source string; fire hooks so callers can capture positions.
  - `serialize(root)` — convenience: `buildSource(root)` → markdown string (used for `input` sync).
  - `serializeWithSelection(root, sel)` — DOM selection → `{ value, selStart, selEnd }` (used to feed `applyMarker`/`applyLink`).
  - `locateOffset(root, target)` — source offset → `{ node, offset }` in the rendered DOM.
  - `placeCaret(root, selStart, selEnd)` — thin DOM wrapper applying a `Range` (not unit-tested; needs live `document`/`window`).
- **Create `tests/richEditorMapping.test.mjs`** — unit tests for the four pure functions above, with an inline fake-DOM helper (no jsdom dependency).
- **Modify `manifest.json:17`** — register `scripts/richEditorMapping.js` in `web_accessible_resources`.
- **Rewrite `scripts/richTextEditor.js`** — DOM wiring only; same `upgradeTextarea` export/signature. Surface + Rich/Markdown tabs + hidden textarea; routes formatting through the engine via the mapping module.
- **Modify `config/forms/formsStyling.css:2259-2362`** — add `.mb-rte__surface` styles, rename tab comment, drop dead `.mb-rte__preview*` rules, keep popover/tab/button styles.

`scripts/markdownInline.js` and `scripts/markdownToolbarActions.js` are **NOT modified** — the engine and all its rules are reused verbatim.

---

## Task 1: `buildSource` + `serialize` (DOM → markdown string)

**Files:**
- Create: `scripts/richEditorMapping.js`
- Test: `tests/richEditorMapping.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/richEditorMapping.test.mjs`:

```js
import assert from 'node:assert/strict';
import { buildSource, serialize } from '../scripts/richEditorMapping.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// --- Minimal fake DOM (mirrors the Node interface buildSource reads) ---
const TEXT_NODE = 3, ELEMENT_NODE = 1;
function txt(value) {
  return { nodeType: TEXT_NODE, nodeValue: value, childNodes: [],
           get textContent() { return value; } };
}
function el(tag, ...children) {
  return {
    nodeType: ELEMENT_NODE, tagName: tag.toUpperCase(), childNodes: children, _attrs: {},
    getAttribute(n) { return this._attrs[n] ?? null; },
    setAttribute(n, v) { this._attrs[n] = v; },
    get firstChild() { return children[0] || null; },
    get textContent() { return children.map(c => c.textContent).join(''); },
  };
}
function link(href, text) { const a = el('a', txt(text)); a.setAttribute('href', href); return a; }
// Export-ish helpers reused by later tasks live in this same file.
globalThis.__rteFake = { txt, el, link, TEXT_NODE, ELEMENT_NODE };

test('serialize plain text', () => {
  assert.equal(serialize(el('root', txt('foo'))), 'foo');
});
test('serialize bold (strong -> **)', () => {
  assert.equal(serialize(el('root', el('strong', txt('foo')))), '**foo**');
});
test('serialize nested strong>em -> ***x***', () => {
  assert.equal(serialize(el('root', el('strong', el('em', txt('x'))))), '***x***');
});
test('serialize all marks', () => {
  assert.equal(serialize(el('root', el('u', txt('a')))), '^^a^^');
  assert.equal(serialize(el('root', el('s', txt('a')))), '~~a~~');
  assert.equal(serialize(el('root', el('mark', txt('a')))), '==a==');
  assert.equal(serialize(el('root', el('em', txt('a')))), '*a*');
});
test('serialize link -> [text](href)', () => {
  assert.equal(serialize(el('root', link('https://x', 'y'))), '[y](https://x)');
});
test('serialize <br> -> newline', () => {
  assert.equal(serialize(el('root', txt('a'), el('br'), txt('b'))), 'a\nb');
});
test('serialize div block -> newline boundary', () => {
  assert.equal(serialize(el('root', txt('a'), el('div', txt('b')))), 'a\nb');
});
test('serialize unknown element unwraps to contents', () => {
  assert.equal(serialize(el('root', el('span', txt('a')))), 'a');
});
test('buildSource onText reports source start offsets', () => {
  const fooNode = txt('foo');
  const seen = [];
  buildSource(el('root', el('strong', fooNode)), (node, start) => seen.push([node.nodeValue, start]));
  assert.deepEqual(seen, [['foo', 2]]); // after the leading '**'
});

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/richEditorMapping.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/richEditorMapping.js'` (or `buildSource is not a function`).

- [ ] **Step 3: Write minimal implementation**

Create `scripts/richEditorMapping.js`:

```js
// Bidirectional position map between the rich-text contentEditable surface and
// the markdown source string. The markdown string is the source of truth; this
// module translates DOM selections to source offsets (to feed the existing
// markdownToolbarActions transforms) and back (to restore the caret after a
// re-render). DOM-free except placeCaret, so the rest is unit tested with a
// fake DOM in tests/richEditorMapping.test.mjs.

const TEXT_NODE = 3, ELEMENT_NODE = 1;

// Editor tag -> markdown delimiter. Mirrors renderHtml's TAG map and
// renderMarkdown's MARK_DELIM, plus the browser synonyms (b/i, del/strike) that
// contentEditable / paste can produce.
const TAG_MARKER = {
  strong: '**', b: '**',
  em: '*', i: '*',
  u: '^^',
  s: '~~', strike: '~~', del: '~~',
  mark: '==',
};

// Walk `root`'s descendants in document order, reconstructing the markdown
// source string. Hooks let callers capture source positions during the walk:
//   onText(textNode, srcStart)          — fired for each non-empty text node
//   onBoundary(parentEl, childIndex, srcLen) — fired at every child slot
//                                          (0..childCount) of every element,
//                                          so element-anchored selections map.
// Returns the reconstructed markdown string.
export function buildSource(root, onText, onBoundary) {
  let out = '';
  const walk = (parent) => {
    const kids = parent.childNodes;
    if (onBoundary) onBoundary(parent, 0, out.length);
    for (let k = 0; k < kids.length; k++) {
      const child = kids[k];
      if (child.nodeType === TEXT_NODE) {
        if (child.nodeValue) { if (onText) onText(child, out.length); out += child.nodeValue; }
      } else if (child.nodeType === ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'br') {
          out += '\n';
        } else {
          const marker = TAG_MARKER[tag];
          if (marker) { out += marker; walk(child); out += marker; }
          else if (tag === 'a') { out += '['; walk(child); out += '](' + (child.getAttribute('href') || '') + ')'; }
          else if (tag === 'div' || tag === 'p') { if (out.length) out += '\n'; walk(child); }
          else { walk(child); } // unknown element -> unwrap to contents
        }
      }
      if (onBoundary) onBoundary(parent, k + 1, out.length);
    }
  };
  walk(root);
  return out;
}

// Convenience: just the markdown string (used to sync the textarea on input).
export function serialize(root) { return buildSource(root); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/richEditorMapping.test.mjs`
Expected: PASS — `9 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/richEditorMapping.js tests/richEditorMapping.test.mjs
git commit -m "feat: buildSource/serialize — DOM-to-markdown for inline editor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `serializeWithSelection` (DOM selection → source offsets)

**Files:**
- Modify: `scripts/richEditorMapping.js`
- Test: `tests/richEditorMapping.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/richEditorMapping.test.mjs`, BEFORE the final `console.log` line. First extend the import at the top of the file to:

```js
import { buildSource, serialize, serializeWithSelection } from '../scripts/richEditorMapping.js';
```

Then add the tests (reusing the fake-DOM helpers already defined above):

```js
// A fake Selection: anchor/focus are {node, offset} pairs.
function sel(aNode, aOff, fNode, fOff) {
  return { anchorNode: aNode, anchorOffset: aOff, focusNode: fNode ?? aNode, focusOffset: fNode ? fOff : aOff };
}

test('selection over whole bold inner text', () => {
  const t = txt('foo');
  const root = el('root', el('strong', t));
  assert.deepEqual(serializeWithSelection(root, sel(t, 0, t, 3)),
    { value: '**foo**', selStart: 2, selEnd: 5 });
});
test('partial selection inside a mark', () => {
  const t = txt('foo');
  const root = el('root', el('strong', t));
  assert.deepEqual(serializeWithSelection(root, sel(t, 1, t, 3)),
    { value: '**foo**', selStart: 3, selEnd: 5 });
});
test('selection spanning two text nodes', () => {
  const a = txt('a'); const b = txt('b');
  const root = el('root', a, el('strong', b));
  assert.deepEqual(serializeWithSelection(root, sel(a, 0, b, 1)),
    { value: 'a**b**', selStart: 0, selEnd: 4 }); // 'a'=1 + '**'=2 -> b starts at 3, +1
});
test('reversed selection (focus before anchor) normalizes', () => {
  const t = txt('foo');
  const root = el('root', t);
  assert.deepEqual(serializeWithSelection(root, sel(t, 3, t, 0)),
    { value: 'foo', selStart: 0, selEnd: 3 });
});
test('collapsed caret at element boundary (empty surface)', () => {
  const root = el('root');
  assert.deepEqual(serializeWithSelection(root, sel(root, 0)),
    { value: '', selStart: 0, selEnd: 0 });
});
test('caret at element child boundary between nodes', () => {
  const a = txt('a'); const strong = el('strong', txt('b'));
  const root = el('root', a, strong);
  // caret at root, childIndex 1 -> just after 'a', before '**b**'
  assert.deepEqual(serializeWithSelection(root, sel(root, 1)),
    { value: 'a**b**', selStart: 1, selEnd: 1 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/richEditorMapping.test.mjs`
Expected: FAIL — `serializeWithSelection is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/richEditorMapping.js`:

```js
// Translate a DOM Selection (anchor/focus) into source offsets within the
// reconstructed markdown string. Handles text-node anchors (offset = chars into
// the node) and element anchors (offset = child index). Returns the normalized
// { value, selStart<=selEnd }. If a boundary is not found (detached node), it
// falls back to the end of the value.
export function serializeWithSelection(root, selection) {
  let a = null, f = null;
  const onText = (node, srcStart) => {
    if (selection.anchorNode === node && node.nodeType === TEXT_NODE) a = srcStart + selection.anchorOffset;
    if (selection.focusNode === node && node.nodeType === TEXT_NODE) f = srcStart + selection.focusOffset;
  };
  const onBoundary = (parent, idx, srcLen) => {
    if (selection.anchorNode === parent && parent.nodeType !== TEXT_NODE && selection.anchorOffset === idx) a = srcLen;
    if (selection.focusNode === parent && parent.nodeType !== TEXT_NODE && selection.focusOffset === idx) f = srcLen;
  };
  const value = buildSource(root, onText, onBoundary);
  if (a === null) a = value.length;
  if (f === null) f = value.length;
  return { value, selStart: Math.min(a, f), selEnd: Math.max(a, f) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/richEditorMapping.test.mjs`
Expected: PASS — `15 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/richEditorMapping.js tests/richEditorMapping.test.mjs
git commit -m "feat: serializeWithSelection — DOM selection to source offsets

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `locateOffset` + `placeCaret` (source offset → DOM position)

**Files:**
- Modify: `scripts/richEditorMapping.js`
- Test: `tests/richEditorMapping.test.mjs`

- [ ] **Step 1: Write the failing test**

Extend the import at the top of `tests/richEditorMapping.test.mjs` to:

```js
import { buildSource, serialize, serializeWithSelection, locateOffset } from '../scripts/richEditorMapping.js';
```

Append these tests before the final `console.log`:

```js
test('locateOffset into plain text', () => {
  const t = txt('foo');
  assert.deepEqual(locateOffset(el('root', t), 2), { node: t, offset: 2 });
});
test('locateOffset maps source offset past a marker to text-node start', () => {
  const t = txt('foo'); // value '**foo**', text starts at source 2
  const root = el('root', el('strong', t));
  assert.deepEqual(locateOffset(root, 2), { node: t, offset: 0 });
  assert.deepEqual(locateOffset(root, 5), { node: t, offset: 3 });
});
test('locateOffset in a delimiter gap clamps to next text node start', () => {
  const foo = txt('foo'); const bar = txt('bar');
  const root = el('root', el('strong', foo), bar); // '**foo**bar', bar starts at 7
  // source offset 6 sits inside the closing '**' -> clamp to start of next text
  assert.deepEqual(locateOffset(root, 6), { node: bar, offset: 0 });
});
test('locateOffset past the end returns end of last text node', () => {
  const t = txt('foo');
  assert.deepEqual(locateOffset(el('root', t), 99), { node: t, offset: 3 });
});
test('locateOffset on empty surface returns root,0', () => {
  const root = el('root');
  assert.deepEqual(locateOffset(root, 0), { node: root, offset: 0 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/richEditorMapping.test.mjs`
Expected: FAIL — `locateOffset is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/richEditorMapping.js`:

```js
// Map a source offset to a position in the (freshly rendered) DOM. Valid only
// right after a render, when the DOM round-trips to the same source string.
// Walks the text nodes in document order; returns the first text node whose
// source span reaches `target`, clamped into that node. Offsets sitting in a
// delimiter/link-syntax gap clamp to the start of the following text node;
// offsets past the end clamp to the end of the last text node.
export function locateOffset(root, target) {
  const texts = [];
  buildSource(root, (node, start) => texts.push({ node, start, len: node.nodeValue.length }));
  for (const t of texts) {
    if (target <= t.start + t.len) {
      return { node: t.node, offset: Math.max(0, Math.min(target - t.start, t.len)) };
    }
  }
  const last = texts[texts.length - 1];
  if (last) return { node: last.node, offset: last.len };
  return { node: root, offset: 0 };
}

// Apply a selection at the given source offsets to the live document. DOM-only
// (needs document/window) so it is exercised by manual QA, not unit tests.
export function placeCaret(root, selStart, selEnd) {
  const s = locateOffset(root, selStart);
  const e = locateOffset(root, selEnd);
  const range = document.createRange();
  range.setStart(s.node, s.offset);
  range.setEnd(e.node, e.offset);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/richEditorMapping.test.mjs`
Expected: PASS — `20 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/richEditorMapping.js tests/richEditorMapping.test.mjs
git commit -m "feat: locateOffset/placeCaret — source offset to DOM caret

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Register the new module in the manifest

**Files:**
- Modify: `manifest.json:17`

- [ ] **Step 1: Add the module to `web_accessible_resources`**

In `manifest.json` line 17, find `"scripts/richTextEditor.js"` and insert `"scripts/richEditorMapping.js"` immediately after it:

```
"scripts/markdownToolbarActions.js", "scripts/richTextEditor.js", "scripts/richEditorMapping.js", "scripts/buttons.js",
```

- [ ] **Step 2: Verify the JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('valid')"`
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add manifest.json
git commit -m "chore: register richEditorMapping.js in manifest

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Rewrite `richTextEditor.js` as the inline WYSIWYG surface

**Files:**
- Modify (full rewrite): `scripts/richTextEditor.js`

This file is DOM wiring with no unit tests (matching the existing file); it is verified by manual QA in Task 7. Replace the entire file contents.

- [ ] **Step 1: Replace the file with the new implementation**

Overwrite `scripts/richTextEditor.js` with:

```js
import { parseInline, renderHtml } from './markdownInline.js';
import { applyMarker, applyLink } from './markdownToolbarActions.js';
import { serialize, serializeWithSelection, placeCaret } from './richEditorMapping.js';

// Toolbar marks: { marker } is the literal markdown delimiter the toolbar
// applies (via the pure markdownToolbarActions transforms). Order matches the
// old toolbar.
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

  // Segmented Rich | Markdown tabs (left). Rich is the default editing view.
  const tabs = document.createElement('div');
  tabs.className = 'mb-rte__tabs';
  const richTab = makeTab('Rich', true);
  const mdTab = makeTab('Markdown', false);
  tabs.append(richTab, mdTab);
  toolbar.appendChild(tabs);

  // Format buttons (right).
  const btnGroup = document.createElement('div');
  btnGroup.className = 'mb-rte__btns';
  toolbar.appendChild(btnGroup);

  // Editable rendered surface — the WYSIWYG view, visible by default.
  const surface = document.createElement('div');
  surface.className = 'mb-rte__surface';
  surface.contentEditable = 'true';
  surface.setAttribute('role', 'textbox');
  surface.setAttribute('aria-multiline', 'true');
  if (textarea.placeholder) surface.dataset.placeholder = textarea.placeholder;

  // The textarea stays the form value / source of truth (raw markdown); hidden
  // in Rich mode, shown in Markdown mode.
  textarea.classList.add('mb-rte__input');

  textarea.parentNode.insertBefore(wrapper, textarea);
  wrapper.appendChild(toolbar);
  wrapper.appendChild(surface);
  wrapper.appendChild(textarea);

  const rte = { textarea, surface, toolbar, btnGroup, richTab, mdTab, buttons: [], mode: 'rich' };

  buildButtons(rte);
  attachLinkPopover(rte);
  buildTabs(rte);
  attachSurfaceEvents(rte);
  attachShortcuts(rte);
  setMode(rte, 'rich', { focus: false }); // initial render, no focus steal during hydration

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
  btn.addEventListener('mousedown', e => e.preventDefault()); // keep surface/textarea selection
  btn.addEventListener('click', onClick);
  return btn;
}

function renderSurface(rte) {
  rte.surface.innerHTML = renderHtml(parseInline(rte.textarea.value || ''));
}

// Sync the hidden textarea from the surface and fire input so the dirty-guard
// and char counter update. Called on every native edit in the surface.
function syncFromSurface(rte) {
  rte.textarea.value = serialize(rte.surface);
  rte.textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

// Read the current selection as { value, selStart, selEnd } for the active mode.
function currentSelection(rte) {
  if (rte.mode === 'markdown') {
    const ta = rte.textarea;
    return { value: ta.value, selStart: ta.selectionStart, selEnd: ta.selectionEnd };
  }
  return serializeWithSelection(rte.surface, window.getSelection());
}

// Write a transformed value back, restoring selection appropriately per mode.
function applyResult(rte, res) {
  rte.textarea.value = res.value;
  if (rte.mode === 'markdown') {
    rte.textarea.focus();
    rte.textarea.setSelectionRange(res.selStart, res.selEnd);
  } else {
    rte.surface.innerHTML = renderHtml(parseInline(res.value));
    rte.surface.focus();
    placeCaret(rte.surface, res.selStart, res.selEnd);
  }
  rte.textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

// Apply a pure string transform (value, selStart, selEnd) -> {value, selStart, selEnd}.
function runTransform(rte, transform) {
  const { value, selStart, selEnd } = currentSelection(rte);
  applyResult(rte, transform(value, selStart, selEnd));
}

function runMarker(rte, marker) {
  runTransform(rte, (v, s, e) => applyMarker(v, s, e, marker));
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
  rte.richTab.addEventListener('click', () => setMode(rte, 'rich'));
  rte.mdTab.addEventListener('click', () => setMode(rte, 'markdown'));
}

function setMode(rte, mode, { focus = true } = {}) {
  // Sync the textarea from the surface before leaving Rich mode so Markdown
  // mode shows the current value.
  if (rte.mode === 'rich' && mode === 'markdown') rte.textarea.value = serialize(rte.surface);
  rte.mode = mode;
  const rich = mode === 'rich';
  rte.richTab.classList.toggle('--active', rich);
  rte.mdTab.classList.toggle('--active', !rich);
  rte.richTab.setAttribute('aria-pressed', String(rich));
  rte.mdTab.setAttribute('aria-pressed', String(!rich));
  rte.surface.hidden = !rich;
  rte.textarea.hidden = rich;
  if (rich) {
    renderSurface(rte);
    if (focus) rte.surface.focus();
  } else if (focus) {
    rte.textarea.focus();
  }
}

function attachSurfaceEvents(rte) {
  const { surface } = rte;
  surface.addEventListener('input', () => syncFromSurface(rte));

  // Plain-text paste only — no foreign HTML enters the surface.
  surface.addEventListener('paste', e => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    const { value, selStart, selEnd } = serializeWithSelection(surface, window.getSelection());
    const caret = selStart + text.length;
    applyResult(rte, { value: value.slice(0, selStart) + text + value.slice(selEnd), selStart: caret, selEnd: caret });
  });

  // Don't navigate when clicking a link while editing.
  surface.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a');
    if (a) e.preventDefault();
  });
}

function attachShortcuts(rte) {
  const handler = e => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const key = e.key.toLowerCase();
    if (SHORTCUT[key]) { e.preventDefault(); runMarker(rte, SHORTCUT[key]); }
    else if (key === 'k') { e.preventDefault(); rte.openLinkPopover?.(); }
  };
  rte.surface.addEventListener('keydown', handler);
  rte.textarea.addEventListener('keydown', handler);
}

function attachLinkPopover(rte) {
  const { toolbar } = rte;
  let saved = null; // { value, selStart, selEnd } captured when the popover opens

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
  const onDocMouseDown = e => {
    if (!popover.hidden && !popover.contains(e.target) && !toolbar.contains(e.target)) close();
  };
  const close = () => { popover.hidden = true; document.removeEventListener('mousedown', onDocMouseDown); };

  rte.openLinkPopover = () => {
    saved = currentSelection(rte); // capture before focus moves to the popover inputs
    textInput.value = saved.value.slice(saved.selStart, saved.selEnd);
    urlInput.value = '';
    popover.hidden = false;
    document.addEventListener('mousedown', onDocMouseDown);
    urlInput.focus();
  };

  popover.querySelector('[data-link-cancel]').addEventListener('click', close);

  popover.querySelector('[data-link-insert]').addEventListener('click', () => {
    const url = urlInput.value.trim();
    const text = textInput.value.trim() || url;
    if (!url) { close(); return; } // empty URL → no-op
    close();
    applyResult(rte, applyLink(saved.value, saved.selStart, saved.selEnd, text, url));
  });

  // Esc dismiss (click-outside is wired in openLinkPopover/close).
  popover.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}
```

- [ ] **Step 2: Syntax-check the module**

Run: `node --check scripts/richTextEditor.js`
Expected: no output (exit 0).

- [ ] **Step 3: Confirm the engine tests still pass (engine untouched)**

Run: `node tests/markdownToolbarActions.test.mjs && node tests/markdownInline.test.mjs`
Expected: both print their pass counts (`18 passed` and the markdownInline count), no failures.

- [ ] **Step 4: Commit**

```bash
git add scripts/richTextEditor.js
git commit -m "feat: rewrite KB description editor as inline WYSIWYG surface

contentEditable surface is the default view (rendered markdown); textarea
stays the hidden source of truth. Native typing syncs to the textarea on
input; formatting routes through applyMarker/applyLink via richEditorMapping.
Rich | Markdown tabs toggle the surface and raw textarea.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Style the surface and drop dead preview CSS

**Files:**
- Modify: `config/forms/formsStyling.css:2259-2362`

- [ ] **Step 1: Update the tabs comment**

Replace:

```css
/* Segmented Edit | Preview tabs (left side of the toolbar). */
```

with:

```css
/* Segmented Rich | Markdown tabs (left side of the toolbar). */
```

- [ ] **Step 2: Add surface styles and toggle the textarea by default**

Replace this block:

```css
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
```

with:

```css
/* The editable rendered surface (Rich mode) — the default WYSIWYG view. */
.mb-rte__surface {
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
  overflow-wrap: anywhere;
  white-space: pre-wrap;
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

/* The raw-markdown textarea (Markdown mode) — hidden until the tab is chosen. */
.mb-rte__input {
  display: block;
  width: 100%;
  min-height: 8.5rem;
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
```

- [ ] **Step 3: Remove the dead preview rules**

Delete this block entirely (the read-only preview no longer exists):

```css
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

Note: the `[hidden]` attribute (set by `setMode`) hides whichever of `.mb-rte__surface` / `.mb-rte__input` is inactive — the browser's default `[hidden] { display: none }` applies, so no extra CSS is needed for the toggle.

- [ ] **Step 4: Commit**

```bash
git add config/forms/formsStyling.css
git commit -m "style: style inline WYSIWYG surface; drop dead preview CSS

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Full verification — tests + manual QA

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run:

```bash
for f in tests/*.test.mjs; do echo "== $f =="; node "$f" || exit 1; done
```

Expected: every file prints its pass line; the loop exits 0. Specifically `richEditorMapping.test.mjs` → `20 passed`; `markdownToolbarActions.test.mjs` → `18 passed`; `markdownInline.test.mjs` and `admonitions-prefix.test.mjs` and `navToml.test.mjs` unchanged.

- [ ] **Step 2: Load the extension and open a KB Description form**

Load the unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked → this directory), open a page with a KB Description field (`textarea[data-richtext]`). Confirm the editor opens in **Rich** mode showing rendered text, with the textarea hidden.

- [ ] **Step 3: Manual QA checklist** (tick each)

  - [ ] Typing plain text: characters appear, caret stays put, no flicker.
  - [ ] Select a word, click **Bold** → it renders bold; click again → toggles off. Same for Italic, Underline, Strikethrough, Highlight.
  - [ ] Ctrl/Cmd+B / +I / +U apply the same formats; Ctrl/Cmd+K opens the link popover.
  - [ ] Partial-word selection formats only the selection (regression for the engine's clip rule).
  - [ ] Insert a link via popover → renders as a blue link; clicking it while editing does NOT navigate.
  - [ ] Press Enter → a line break appears; switching to Markdown shows it as a newline.
  - [ ] Paste rich content (e.g. copied from a webpage) → only plain text is inserted, no foreign styling.
  - [ ] Toggle to **Markdown** → textarea shows the exact raw markdown matching what's rendered; edit it, toggle back to **Rich** → changes reflected.
  - [ ] Use a toolbar button while in **Markdown** mode → it edits the textarea (parity with old behavior).
  - [ ] Character counter (`[data-maxlength]`) updates as you type/format in both modes.
  - [ ] Make an edit, then try to close/navigate → dirty-guard prompts (proves `input` events fire).
  - [ ] Save the form → persisted value is the correct markdown.

- [ ] **Step 4: Final commit (only if QA surfaced fixes)**

If any QA item required a code change, commit it with a descriptive message; otherwise no commit is needed — the feature is complete.

---

## Self-Review

**Spec coverage:**
- Inversion (surface default, textarea hidden source of truth) → Task 5 (`setMode`, structure). ✓
- Native typing + sync → Task 5 (`syncFromSurface` on `input`). ✓
- Formatting through existing engine via position map → Tasks 1-3 (mapping) + Task 5 (`runTransform`/`applyResult`). ✓
- Rich | Markdown toggle, toolbar works in both modes → Task 5 (`setMode`, `currentSelection`, `applyResult` branches). ✓
- Paste plain-text only, link-click suppression, Enter→newline → Task 5 (`attachSurfaceEvents`). ✓
- Inline-only scope, no markdown auto-format → no auto-format code added; engine unchanged. ✓
- Engine untouched (spec allowed an additive `markdownInline` helper; plan avoids it — mapping module is self-contained) → Tasks 1-3 in `richEditorMapping.js` only. ✓ (improves on spec)
- CSS surface styling + drop dead preview rules → Task 6. ✓
- Manifest registration → Task 4. ✓
- Tests: new `richEditorMapping.test.mjs`, existing suites stay green → Tasks 1-3, Task 7. ✓
- Integration unchanged (`form.js:988`, dirty-guard, counter) → `upgradeTextarea` signature/idempotency preserved in Task 5; verified Task 7. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code and exact commands.

**Type/name consistency:** `buildSource`/`serialize`/`serializeWithSelection`/`locateOffset`/`placeCaret` used consistently across mapping tasks and imported by name in Task 5. `currentSelection`/`applyResult`/`runTransform`/`runMarker`/`setMode`/`syncFromSurface` defined and called consistently within Task 5. Return shape `{ value, selStart, selEnd }` is uniform across the engine, the mapping module, and the wiring.

**Known minor (documented, acceptable):** a caret placed by `locateOffset` exactly at the trailing edge of a link that is the last node lands at the end of the link text node; refinement is out of scope (YAGNI), noted in the design's edge cases.
