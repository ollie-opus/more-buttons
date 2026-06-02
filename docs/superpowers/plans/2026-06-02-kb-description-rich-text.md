# KB Description Rich-Text Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a WYSIWYG inline rich-text editor to the two knowledge-base Description fields, rendering a fixed set of inline Markdown marks and serializing back to Markdown, with unsupported syntax preserved verbatim.

**Architecture:** A pure, unit-tested AST module (`markdownInline.js`) does Markdown ⇄ DOM conversion. A UI component (`richTextEditor.js`) hides each opted-in `<textarea>` and layers a toolbar + `contenteditable` surface over it, keeping the textarea as the form's source of truth. `form.js` upgrades `textarea[data-richtext]` after hydration; `guides.js`, the dirty-guard, and submit paths are untouched.

**Tech Stack:** Vanilla ES modules (Chrome extension, no build step). Tests are plain `node:assert/strict` `.mjs` files run with `node`, matching `tests/admonitions-prefix.test.mjs`.

**Supported marks (v1):**

| Mark | Markdown | Element |
|------|----------|---------|
| Bold | `**…**` | `<strong>` |
| Italic | `*…*` | `<em>` |
| Underline | `^^…^^` | `<u>` |
| Strikethrough | `~~…~~` | `<s>` |
| Highlight | `==…==` | `<mark>` |
| Link | `[text](url)` | `<a href>` |

**Key decisions (from spec):** italic is `*…*` only (underscores stay literal); only balanced pairs convert (unmatched/empty delimiters stay literal); link text is plain (no nested marks in v1); all unsupported syntax passes through as literal text; `renderMarkdown(parseInline(md)) === md` for canonical inputs.

---

## File Structure

- **Create `scripts/markdownInline.js`** — pure functions: `parseInline`, `renderMarkdown`, `renderHtml`, `domToNodes`. The first three are pure and unit-tested; `domToNodes` reads live DOM (browser-only, verified via integration).
- **Create `scripts/richTextEditor.js`** — exports `upgradeTextarea(textarea)`; builds toolbar + surface, applies marks, syncs to the textarea.
- **Create `tests/markdownInline.test.mjs`** — node-assert tests for the pure functions.
- **Modify `scripts/form.js`** — import `upgradeTextarea`; call it on `textarea[data-richtext]` inside the hydration callback, before the dirty-guard snapshot.
- **Modify `config/forms/editGuideSection.html`** & **`editGuideAdmonition.html`** — add `data-richtext` to the Description textareas.
- **Modify `config/forms/formsStyling.css`** — toolbar, surface, in-editor marks, link popover.
- **Modify `manifest.json`** — register `scripts/markdownInline.js` and `scripts/richTextEditor.js` in `web_accessible_resources`.

---

## Task 1: `markdownInline.js` — `parseInline`

**Files:**
- Create: `scripts/markdownInline.js`
- Test: `tests/markdownInline.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/markdownInline.test.mjs`:

```js
import assert from 'node:assert/strict';
import { parseInline } from '../scripts/markdownInline.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

test('plain text → single text node', () => {
  assert.deepEqual(parseInline('hello'), [{ type: 'text', value: 'hello' }]);
});
test('bold', () => {
  assert.deepEqual(parseInline('**x**'), [{ type: 'strong', children: [{ type: 'text', value: 'x' }] }]);
});
test('italic uses single asterisk only', () => {
  assert.deepEqual(parseInline('*x*'), [{ type: 'em', children: [{ type: 'text', value: 'x' }] }]);
});
test('underscores stay literal', () => {
  assert.deepEqual(parseInline('some_var_name'), [{ type: 'text', value: 'some_var_name' }]);
});
test('underline / strike / highlight', () => {
  assert.equal(parseInline('^^x^^')[0].type, 'underline');
  assert.equal(parseInline('~~x~~')[0].type, 'strike');
  assert.equal(parseInline('==x==')[0].type, 'highlight');
});
test('bold beats italic (** before *)', () => {
  assert.deepEqual(parseInline('**x**'), [{ type: 'strong', children: [{ type: 'text', value: 'x' }] }]);
});
test('nested marks', () => {
  assert.deepEqual(parseInline('**a*b***'), [{
    type: 'strong',
    children: [{ type: 'text', value: 'a' }, { type: 'em', children: [{ type: 'text', value: 'b' }] }],
  }]);
});
test('link with plain text', () => {
  assert.deepEqual(parseInline('[go](http://x)'), [{
    type: 'link', href: 'http://x', children: [{ type: 'text', value: 'go' }],
  }]);
});
test('unmatched delimiter stays literal', () => {
  assert.deepEqual(parseInline('a ** b'), [{ type: 'text', value: 'a ** b' }]);
});
test('empty delimiter stays literal', () => {
  assert.deepEqual(parseInline('****'), [{ type: 'text', value: '****' }]);
});
test('unsupported block markdown passes through', () => {
  assert.deepEqual(parseInline('- item'), [{ type: 'text', value: '- item' }]);
});
test('newlines preserved in text', () => {
  assert.deepEqual(parseInline('a\nb'), [{ type: 'text', value: 'a\nb' }]);
});

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/markdownInline.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/markdownInline.js'` (or `parseInline is not a function`).

- [ ] **Step 3: Write minimal implementation**

Create `scripts/markdownInline.js`:

```js
// Inline Markdown ⇄ AST conversion for the KB Description rich-text editor.
// AST node shapes:
//   { type: 'text', value: string }
//   { type: 'strong'|'em'|'underline'|'strike'|'highlight', children: node[] }
//   { type: 'link', href: string, children: node[] }

// Delimiter table, ordered so longer markers match before shorter ('**' before '*').
const DELIMS = [
  ['**', 'strong'],
  ['==', 'highlight'],
  ['^^', 'underline'],
  ['~~', 'strike'],
  ['*', 'em'],
];

function matchDelim(text, i) {
  for (const [marker, type] of DELIMS) {
    if (text.startsWith(marker, i)) return { marker, type, len: marker.length };
  }
  return null;
}

function findClosing(text, start, marker) {
  for (let j = start; j <= text.length - marker.length; j++) {
    if (text.startsWith(marker, j)) return j;
  }
  return -1;
}

// [text](url) — no nested brackets in v1; link text is plain.
function matchLink(text, i) {
  if (text[i] !== '[') return null;
  const closeBracket = text.indexOf(']', i + 1);
  if (closeBracket === -1 || text[closeBracket + 1] !== '(') return null;
  const closeParen = text.indexOf(')', closeBracket + 2);
  if (closeParen === -1) return null;
  const linkText = text.slice(i + 1, closeBracket);
  const href = text.slice(closeBracket + 2, closeParen);
  if (!href) return null;
  return { text: linkText, href, end: closeParen + 1 };
}

export function parseInline(text) {
  const nodes = [];
  let buf = '';
  const flush = () => { if (buf) { nodes.push({ type: 'text', value: buf }); buf = ''; } };

  let i = 0;
  while (i < text.length) {
    if (text[i] === '[') {
      const link = matchLink(text, i);
      if (link) {
        flush();
        nodes.push({ type: 'link', href: link.href, children: [{ type: 'text', value: link.text }] });
        i = link.end;
        continue;
      }
    }

    const delim = matchDelim(text, i);
    if (delim) {
      const close = findClosing(text, i + delim.len, delim.marker);
      const inner = close === -1 ? '' : text.slice(i + delim.len, close);
      if (close !== -1 && inner.length > 0) {
        flush();
        nodes.push({ type: delim.type, children: parseInline(inner) });
        i = close + delim.len;
        continue;
      }
      // No closing or empty → treat the opening marker as literal text.
      buf += delim.marker;
      i += delim.len;
      continue;
    }

    buf += text[i];
    i++;
  }
  flush();
  return nodes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/markdownInline.test.mjs`
Expected: PASS — all tests print `ok -` and `N passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/markdownInline.js tests/markdownInline.test.mjs
git commit -m "feat: parseInline for KB description marks

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `markdownInline.js` — `renderMarkdown` + round-trip

**Files:**
- Modify: `scripts/markdownInline.js`
- Test: `tests/markdownInline.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/markdownInline.test.mjs` (before the final `console.log`), and add `renderMarkdown` to the import at the top so it reads `import { parseInline, renderMarkdown } from '../scripts/markdownInline.js';`:

```js
test('renderMarkdown of text', () => {
  assert.equal(renderMarkdown([{ type: 'text', value: 'hi' }]), 'hi');
});
test('renderMarkdown of each mark', () => {
  assert.equal(renderMarkdown([{ type: 'strong', children: [{ type: 'text', value: 'x' }] }]), '**x**');
  assert.equal(renderMarkdown([{ type: 'em', children: [{ type: 'text', value: 'x' }] }]), '*x*');
  assert.equal(renderMarkdown([{ type: 'underline', children: [{ type: 'text', value: 'x' }] }]), '^^x^^');
  assert.equal(renderMarkdown([{ type: 'strike', children: [{ type: 'text', value: 'x' }] }]), '~~x~~');
  assert.equal(renderMarkdown([{ type: 'highlight', children: [{ type: 'text', value: 'x' }] }]), '==x==');
});
test('renderMarkdown of link', () => {
  assert.equal(renderMarkdown([{ type: 'link', href: 'http://x', children: [{ type: 'text', value: 'go' }] }]), '[go](http://x)');
});
test('round-trip: renderMarkdown(parseInline(md)) === md', () => {
  for (const md of [
    'plain text',
    '**bold** and *italic*',
    '^^under^^ ~~strike~~ ==hi==',
    '**a*b***',
    '[go](http://x)',
    'a ** b',
    '****',
    '- item\n- two',
    'some_var_name',
    'line one\nline two',
  ]) {
    assert.equal(renderMarkdown(parseInline(md)), md, `failed for: ${JSON.stringify(md)}`);
  }
});
test('parse is idempotent', () => {
  const once = parseInline('**a*b*** plain');
  const twice = parseInline(renderMarkdown(once));
  assert.deepEqual(twice, once);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/markdownInline.test.mjs`
Expected: FAIL — `renderMarkdown is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/markdownInline.js`:

```js
const MARK_DELIM = {
  strong: '**',
  em: '*',
  underline: '^^',
  strike: '~~',
  highlight: '==',
};

export function renderMarkdown(nodes) {
  return nodes.map(n => {
    if (n.type === 'text') return n.value;
    if (n.type === 'link') return `[${renderMarkdown(n.children)}](${n.href})`;
    const d = MARK_DELIM[n.type];
    return d + renderMarkdown(n.children) + d;
  }).join('');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/markdownInline.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/markdownInline.js tests/markdownInline.test.mjs
git commit -m "feat: renderMarkdown + round-trip guarantee

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `markdownInline.js` — `renderHtml` (escaping)

**Files:**
- Modify: `scripts/markdownInline.js`
- Test: `tests/markdownInline.test.mjs`

- [ ] **Step 1: Write the failing test**

Add `renderHtml` to the import line, then append:

```js
test('renderHtml escapes HTML in text', () => {
  assert.equal(renderHtml([{ type: 'text', value: 'a < b & c > d' }]), 'a &lt; b &amp; c &gt; d');
});
test('renderHtml maps marks to tags', () => {
  assert.equal(renderHtml(parseInline('**b** *i* ^^u^^ ~~s~~ ==h==')),
    '<strong>b</strong> <em>i</em> <u>u</u> <s>s</s> <mark>h</mark>');
});
test('renderHtml link escapes href quotes', () => {
  assert.equal(renderHtml([{ type: 'link', href: 'http://x?a="b"', children: [{ type: 'text', value: 'go' }] }]),
    '<a href="http://x?a=&quot;b&quot;">go</a>');
});
test('renderHtml maps newlines to <br>', () => {
  assert.equal(renderHtml([{ type: 'text', value: 'a\nb' }]), 'a<br>b');
});
test('renderHtml preserves literal markdown-looking HTML as escaped text', () => {
  assert.equal(renderHtml([{ type: 'text', value: '<div>raw</div>' }]), '&lt;div&gt;raw&lt;/div&gt;');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/markdownInline.test.mjs`
Expected: FAIL — `renderHtml is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/markdownInline.js`:

```js
const TAG = {
  strong: 'strong',
  em: 'em',
  underline: 'u',
  strike: 's',
  highlight: 'mark',
};

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

export function renderHtml(nodes) {
  return nodes.map(n => {
    if (n.type === 'text') return escapeHtml(n.value).replace(/\n/g, '<br>');
    if (n.type === 'link') return `<a href="${escapeAttr(n.href)}">${renderHtml(n.children)}</a>`;
    return `<${TAG[n.type]}>${renderHtml(n.children)}</${TAG[n.type]}>`;
  }).join('');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/markdownInline.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/markdownInline.js tests/markdownInline.test.mjs
git commit -m "feat: renderHtml with escaping for editor surface

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `markdownInline.js` — `domToNodes` (DOM → AST)

This reads the live `contenteditable` DOM into the AST so `renderMarkdown` can serialize it. It uses browser globals (`Node`), so it is not unit-tested here; it is verified via the integration steps in Task 8. It is kept thin so the tested `renderMarkdown` carries the formatting logic.

**Files:**
- Modify: `scripts/markdownInline.js`

- [ ] **Step 1: Write implementation**

Append to `scripts/markdownInline.js`:

```js
// Maps editor element tag names back to AST mark types. Includes the synonyms a
// browser may produce (b/i, del/strike) even though we only ever emit the canonical
// tags from renderHtml.
const TAG_TO_TYPE = {
  strong: 'strong', b: 'strong',
  em: 'em', i: 'em',
  u: 'underline',
  s: 'strike', strike: 'strike', del: 'strike',
  mark: 'highlight',
};

export function domToNodes(root) {
  const out = [];
  root.childNodes.forEach(child => {
    if (child.nodeType === Node.TEXT_NODE) {
      if (child.nodeValue) out.push({ type: 'text', value: child.nodeValue });
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;

    const tag = child.tagName.toLowerCase();
    if (tag === 'br') { out.push({ type: 'text', value: '\n' }); return; }

    const markType = TAG_TO_TYPE[tag];
    if (markType) { out.push({ type: markType, children: domToNodes(child) }); return; }

    if (tag === 'a') {
      out.push({ type: 'link', href: child.getAttribute('href') || '', children: [{ type: 'text', value: child.textContent }] });
      return;
    }

    if (tag === 'div' || tag === 'p') {
      // contenteditable wraps subsequent lines in block elements — treat as newline boundaries.
      if (out.length) out.push({ type: 'text', value: '\n' });
      out.push(...domToNodes(child));
      return;
    }

    // Unknown element (e.g. pasted span) → unwrap to its contents.
    out.push(...domToNodes(child));
  });
  return out;
}
```

- [ ] **Step 2: Verify the pure tests still pass (no regression)**

Run: `node tests/markdownInline.test.mjs`
Expected: PASS (unchanged — `domToNodes` is not exercised here).

- [ ] **Step 3: Commit**

```bash
git add scripts/markdownInline.js
git commit -m "feat: domToNodes for editor DOM serialization

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `richTextEditor.js` — scaffold (`upgradeTextarea`, render, sync)

Builds the editor shell and the load/sync cycle. No toolbar behavior yet — that's Task 6.

**Files:**
- Create: `scripts/richTextEditor.js`

- [ ] **Step 1: Write implementation**

Create `scripts/richTextEditor.js`:

```js
import { parseInline, renderMarkdown, renderHtml, domToNodes } from './markdownInline.js';

const MARKS = [
  { name: 'bold', tag: 'strong', icon: 'format_bold', label: 'Bold (Ctrl/Cmd+B)', key: 'b' },
  { name: 'italic', tag: 'em', icon: 'format_italic', label: 'Italic (Ctrl/Cmd+I)', key: 'i' },
  { name: 'underline', tag: 'u', icon: 'format_underlined', label: 'Underline (Ctrl/Cmd+U)', key: 'u' },
  { name: 'strike', tag: 's', icon: 'strikethrough_s', label: 'Strikethrough' },
  { name: 'highlight', tag: 'mark', icon: 'format_ink_highlighter', label: 'Highlight' },
];

export function upgradeTextarea(textarea) {
  if (textarea.dataset.rteReady === '1') return; // idempotent
  textarea.dataset.rteReady = '1';

  const wrapper = document.createElement('div');
  wrapper.className = 'mb-rte';

  const toolbar = document.createElement('div');
  toolbar.className = 'mb-rte__toolbar';

  const surface = document.createElement('div');
  surface.className = 'mb-rte__surface';
  surface.contentEditable = 'true';
  surface.setAttribute('role', 'textbox');
  surface.setAttribute('aria-multiline', 'true');
  if (textarea.placeholder) surface.dataset.placeholder = textarea.placeholder;

  // Initial content from the (already-hydrated) textarea value.
  surface.innerHTML = renderHtml(parseInline(textarea.value || ''));

  // Hide the textarea but keep it as the form value mirror.
  textarea.style.display = 'none';
  textarea.parentNode.insertBefore(wrapper, textarea);
  wrapper.appendChild(toolbar);
  wrapper.appendChild(surface);
  wrapper.appendChild(textarea);

  const sync = () => {
    textarea.value = renderMarkdown(domToNodes(surface));
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  };

  surface.addEventListener('input', sync);

  // Paste as plain text to keep the DOM clean.
  surface.addEventListener('paste', e => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  });

  // Expose for later tasks (toolbar wiring) and tests.
  wrapper._rte = { textarea, surface, toolbar, sync };
  buildToolbar(wrapper._rte);
  return wrapper._rte;
}

// Placeholder — implemented in Task 6.
function buildToolbar() {}
```

- [ ] **Step 2: Verify pure module tests still pass**

Run: `node tests/markdownInline.test.mjs`
Expected: PASS (this task adds no test failures; `richTextEditor.js` isn't imported by tests).

- [ ] **Step 3: Commit**

```bash
git add scripts/richTextEditor.js
git commit -m "feat: richTextEditor scaffold (surface + sync)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `richTextEditor.js` — toolbar, toggle, active state, shortcuts

**Files:**
- Modify: `scripts/richTextEditor.js`

- [ ] **Step 1: Write implementation**

Replace the placeholder `function buildToolbar() {}` in `scripts/richTextEditor.js` with the following, and add the helpers below it:

```js
function buildToolbar(rte) {
  const { toolbar, surface } = rte;

  const makeBtn = (icon, label, onClick) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mb-rte__btn';
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.innerHTML = `<span class="more-buttons-icon">${icon}</span>`;
    btn.addEventListener('mousedown', e => e.preventDefault()); // keep selection
    btn.addEventListener('click', onClick);
    return btn;
  };

  rte.markButtons = {};
  MARKS.forEach(m => {
    const btn = makeBtn(m.icon, m.label, () => { toggleMark(surface, m.tag); });
    btn.dataset.mark = m.tag;
    rte.markButtons[m.tag] = btn;
    toolbar.appendChild(btn);
  });

  // Link button is wired in Task 7; create it now so toolbar order is final.
  const linkBtn = makeBtn('link', 'Link (Ctrl/Cmd+K)', () => { rte.openLinkPopover?.(); });
  linkBtn.dataset.mark = 'a';
  rte.markButtons.a = linkBtn;
  toolbar.appendChild(linkBtn);

  // Keyboard shortcuts.
  surface.addEventListener('keydown', e => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const key = e.key.toLowerCase();
    const map = { b: 'strong', i: 'em', u: 'u' };
    if (map[key]) { e.preventDefault(); toggleMark(surface, map[key]); }
    else if (key === 'k') { e.preventDefault(); rte.openLinkPopover?.(); }
  });

  // Active-state reflection.
  const refresh = () => refreshActive(rte);
  document.addEventListener('selectionchange', () => {
    if (surface.contains(document.getSelection()?.anchorNode)) refresh();
  });
  surface.addEventListener('keyup', refresh);
  surface.addEventListener('mouseup', refresh);
}

// Walk up from node to surface; return the nearest ancestor element matching tagName.
function closestTag(node, tagName, surface) {
  let el = node;
  while (el && el !== surface) {
    if (el.nodeType === Node.ELEMENT_NODE && el.tagName.toLowerCase() === tagName) return el;
    el = el.parentNode;
  }
  return null;
}

function unwrap(el) {
  const parent = el.parentNode;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
  parent.normalize();
}

function toggleMark(surface, tagName) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (!surface.contains(range.commonAncestorContainer)) return;

  const existing = closestTag(range.commonAncestorContainer, tagName, surface);
  if (existing) {
    unwrap(existing);
  } else {
    if (range.collapsed) return; // nothing selected → no-op
    const el = document.createElement(tagName);
    try {
      el.appendChild(range.extractContents());
      range.insertNode(el);
      sel.removeAllRanges();
      const r = document.createRange();
      r.selectNodeContents(el);
      sel.addRange(r);
    } catch (err) {
      // Selection spans incompatible boundaries — best-effort for v1.
      return;
    }
  }
  surface.dispatchEvent(new Event('input', { bubbles: true }));
}

function refreshActive(rte) {
  const sel = window.getSelection();
  const node = sel?.anchorNode;
  Object.entries(rte.markButtons).forEach(([tag, btn]) => {
    const active = node ? !!closestTag(node, tag, rte.surface) : false;
    btn.classList.toggle('--active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}
```

- [ ] **Step 2: Verify pure module tests still pass**

Run: `node tests/markdownInline.test.mjs`
Expected: PASS (no change to the tested module).

- [ ] **Step 3: Commit**

```bash
git add scripts/richTextEditor.js
git commit -m "feat: rich-text toolbar, mark toggle, shortcuts, active state

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `richTextEditor.js` — link popover

**Files:**
- Modify: `scripts/richTextEditor.js`

- [ ] **Step 1: Write implementation**

In `upgradeTextarea`, after `buildToolbar(wrapper._rte);`, add:

```js
  attachLinkPopover(wrapper._rte);
```

Then append these functions to `scripts/richTextEditor.js`:

```js
function attachLinkPopover(rte) {
  const { surface, toolbar } = rte;
  let savedRange = null;

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
    const sel = window.getSelection();
    if (!sel.rangeCount || !surface.contains(sel.anchorNode)) return;
    savedRange = sel.getRangeAt(0).cloneRange();
    const existing = closestTag(sel.anchorNode, 'a', surface);
    if (existing) {
      textInput.value = existing.textContent;
      urlInput.value = existing.getAttribute('href') || '';
      savedRange.selectNode(existing);
    } else {
      textInput.value = savedRange.toString();
      urlInput.value = '';
    }
    popover.hidden = false;
    urlInput.focus();
  };

  popover.querySelector('[data-link-cancel]').addEventListener('click', close);

  popover.querySelector('[data-link-insert]').addEventListener('click', () => {
    const url = urlInput.value.trim();
    const text = textInput.value.trim() || url;
    if (!url || !savedRange) { close(); return; }
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const a = document.createElement('a');
    a.setAttribute('href', url);
    a.textContent = text;
    range.insertNode(a);
    sel.removeAllRanges();
    close();
    surface.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // Esc / click-outside dismiss.
  popover.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  document.addEventListener('mousedown', e => {
    if (!popover.hidden && !popover.contains(e.target) && !toolbar.contains(e.target)) close();
  });
}
```

- [ ] **Step 2: Verify pure module tests still pass**

Run: `node tests/markdownInline.test.mjs`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add scripts/richTextEditor.js
git commit -m "feat: rich-text link popover

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Wire into forms (`form.js`, HTML, manifest) + integration verify

**Files:**
- Modify: `scripts/form.js:1` (imports) and `scripts/form.js:970` (hydration callback)
- Modify: `config/forms/editGuideSection.html:16`
- Modify: `config/forms/editGuideAdmonition.html:45`
- Modify: `manifest.json:17`

- [ ] **Step 1: Add the import to `form.js`**

At the top of `scripts/form.js`, after the existing imports (line 4), add:

```js
import { upgradeTextarea } from './richTextEditor.js';
```

- [ ] **Step 2: Call `upgradeTextarea` in the hydration callback**

In `scripts/form.js`, inside the `chrome.storage.local.get(storageKey, result => { ... })` callback, locate the dirty-guard snapshot block (currently `form.js:968-972`):

```js
    // Snapshot baseline for dirty-guard forms after hydration completes so
    // later edits can be detected when the user tries to navigate away.
    if (formEl.hasAttribute('data-dirty-guard')) {
      formEl._initialSnapshot = readFormValues(formEl);
    }
```

Insert this **immediately before** that block (so the editor renders from the hydrated value, and the snapshot captures the unchanged textarea value):

```js
    // Upgrade opted-in Description textareas to the rich-text editor. Runs here,
    // after hydration set textarea.value, and before the dirty-guard snapshot so
    // the snapshot still sees the original markdown (no false-dirty).
    formEl.querySelectorAll('textarea[data-richtext]').forEach(upgradeTextarea);
```

- [ ] **Step 3: Add `data-richtext` to the two textareas**

In `config/forms/editGuideSection.html`, change line 16 to:

```html
    <textarea name="sectionDescription" rows="6" data-richtext placeholder="Markdown allowed — lists, defn lists, etc."></textarea>
```

In `config/forms/editGuideAdmonition.html`, change line 45 to:

```html
    <textarea name="admonitionDescription" rows="6" data-richtext placeholder="Markdown allowed"></textarea>
```

- [ ] **Step 4: Register the new scripts in `manifest.json`**

In `manifest.json`, in the `web_accessible_resources` `resources` array (line 17), add `"scripts/markdownInline.js"` and `"scripts/richTextEditor.js"`. Insert them right after `"scripts/guides.js",` so the entry reads:

```
"scripts/guides.js", "scripts/markdownInline.js", "scripts/richTextEditor.js",
```

- [ ] **Step 5: Reload the extension and verify end-to-end**

1. Load/reload the unpacked extension in Chrome (`chrome://extensions` → reload).
2. Open a guide → edit a section that already has a Description with mixed content (e.g. `**bold**`, a `^^underline^^`, a `- list item`, and a `[link](http://x)`).
3. Verify (expected results):
   - Bold/underline/highlight/strike render visually; the `- list item` shows as literal text `- list item`; the link shows as a link.
   - Selecting a word and clicking **Bold** (or Ctrl/Cmd+B) wraps it; clicking again unwraps it. Toolbar button shows active state when the caret is inside a mark.
   - **Link** button opens the popover; inserting fills `[text](url)`.
   - Save the section, reopen it: content is unchanged (round-trip holds), and the raw markdown committed to the draft is correct (check via the repo / network, or re-open and confirm the marks persist).
   - Open the form and immediately try to navigate back **without editing**: no "discard changes?" prompt appears (dirty-guard not falsely tripped).
4. Repeat for an **admonition** Description (`editGuideAdmonition`).

- [ ] **Step 6: Commit**

```bash
git add scripts/form.js config/forms/editGuideSection.html config/forms/editGuideAdmonition.html manifest.json
git commit -m "feat: enable rich-text editor on KB Description fields

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Styling (`formsStyling.css`)

**Files:**
- Modify: `config/forms/formsStyling.css` (append a new section)

- [ ] **Step 1: Add styles**

Append to `config/forms/formsStyling.css`:

```css
/* ---- Rich-text editor (KB Description fields) ---- */
.mb-rte {
  position: relative;
  width: 100%;
}

.mb-rte__toolbar {
  display: flex;
  gap: 2px;
  padding: 4px;
  border: 1px solid var(--mb-border);
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  background-color: var(--mb-bg-input);
}

.mb-rte__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--mb-text-label);
  cursor: pointer;
}
.mb-rte__btn:hover { background-color: var(--mb-border-subtle); }
.mb-rte__btn.--active { background-color: var(--mb-border-subtle); color: #3b82f6; }
.mb-rte__btn .more-buttons-icon { font-size: 18px; }

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

.mb-rte__popover {
  position: absolute;
  z-index: 10;
  top: 38px;
  left: 4px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  width: 260px;
  border: 1px solid var(--mb-border);
  border-radius: 8px;
  background-color: var(--mb-bg-input);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
}
.mb-rte__field { display: flex; flex-direction: column; gap: 3px; font-size: 0.8rem; color: var(--mb-text-label); }
.mb-rte__field input { width: 100%; padding: 6px 8px; border: 1px solid var(--mb-border); border-radius: 6px; box-sizing: border-box; background-color: var(--mb-bg-input); color: var(--mb-text); }
.mb-rte__popover-actions { display: flex; justify-content: flex-end; gap: 8px; }
.mb-rte__popover-btn { padding: 5px 12px; border: 1px solid var(--mb-border); border-radius: 6px; background: transparent; color: var(--mb-text); cursor: pointer; }
.mb-rte__popover-btn.--primary { background-color: #3b82f6; border-color: #3b82f6; color: #fff; }
```

- [ ] **Step 2: Reload and visually verify**

Reload the extension, open a KB Description field, and confirm: toolbar sits flush above the surface; surface matches the form's input border/focus styling; highlight/underline/strike/link render; placeholder shows when empty; the link popover is styled and readable in both light and dark mode.

- [ ] **Step 3: Commit**

```bash
git add config/forms/formsStyling.css
git commit -m "style: rich-text editor toolbar, surface, and link popover

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Notes

**Spec coverage:** mark set (Tasks 1–3, 6, 7), unsupported pass-through (Task 1 tests + `domToNodes` unwrap), round-trip guarantee (Task 2), HTML escaping (Task 3), textarea-as-source-of-truth + hydration timing + dirty-guard (Task 8 Step 2/Step 5), manifest registration (Task 8 Step 4), styling (Task 9), testing approach (Tasks 1–3). All spec sections map to a task.

**Type consistency:** AST node `type` values (`text`, `strong`, `em`, `underline`, `strike`, `highlight`, `link`) are identical across `parseInline`, `renderMarkdown`, `renderHtml`, and `domToNodes`. Element tag names (`strong`, `em`, `u`, `s`, `mark`, `a`) are consistent between `renderHtml`, `MARKS`, `toggleMark`, and `TAG_TO_TYPE`. `upgradeTextarea`/`buildToolbar`/`attachLinkPopover`/`toggleMark`/`closestTag`/`unwrap`/`refreshActive` signatures match their call sites.

**Known v1 limitations (documented, intentional):** underscores never italicize; literal `*x*` prose re-parses as italic on reload; multi-block selection toggles are best-effort; link text is plain (no nested marks).
