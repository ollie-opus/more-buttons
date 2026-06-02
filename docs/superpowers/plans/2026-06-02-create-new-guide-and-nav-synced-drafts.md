# Create a new guide + nav-synced drafts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Create a new guide" flow to the Knowledge Base management page, and keep a `draft_nav` array in `zensical.toml` in sync across all draft operations so the tree and pills derive from the toml alone.

**Architecture:** A new pure module `scripts/navToml.js` owns all read/mutate/write of the `nav` and `draft_nav` inline-table arrays in `zensical.toml` (parse a block → mutate normalized nodes → re-serialize → replace only that block's text span). `guides.js` gains a create-guide flow and calls `navToml` to sync `draft_nav`/`nav` on create/publish/discard. `knowledgeBaseManagement.js` builds its tree from the union of `nav` + `draft_nav` (one API call) and derives pills by file value.

**Tech Stack:** Vanilla ES modules (Chrome extension), GitHub Contents API via `repoClient.js`/`github.js`, Node's built-in `node:assert` test runner (`.test.mjs` files run with `node`).

---

## File Structure

- **Create** `scripts/navToml.js` — pure nav-array parse/serialize/mutate. No network.
- **Create** `tests/navToml.test.mjs` — unit tests for the above.
- **Create** `config/forms/createGuide.html` — the new-guide form.
- **Modify** `scripts/guides.js` — create-guide form actions + nav sync in create/publish/discard.
- **Modify** `scripts/knowledgeBaseManagement.js` — import `navToml`, drop local `parseNav`, build tree from nav∪draft_nav, pills by value, "Create a new guide" button wiring.
- **Modify** `config/forms/knowledgeBaseManagement.html` — add the button.
- **Modify** `config/forms/formsStyling.css` — `.mb-path-field` / `.mb-path-suffix`.
- **Modify** `manifest.json` — add `scripts/navToml.js` to web_accessible_resources.

Normalized node form used throughout `navToml`:
- leaf: `{ name: string, value: string }`
- section: `{ name: string, children: Node[] }`

---

## Task 1: navToml — `slugify` and `titleCaseSegment`

**Files:**
- Create: `scripts/navToml.js`
- Test: `tests/navToml.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/navToml.test.mjs`:

```js
import assert from 'node:assert/strict';
import { slugify, titleCaseSegment } from '../scripts/navToml.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

test('slugify lowercases and hyphenates spaces', () => {
  assert.equal(slugify('Registering an employee'), 'registering-an-employee');
});
test('slugify strips punctuation and collapses hyphens', () => {
  assert.equal(slugify('  Hello,  World! __ Test '), 'hello-world-test');
});
test('slugify returns empty for symbol-only input', () => {
  assert.equal(slugify('!!!'), '');
});
test('titleCaseSegment title-cases hyphenated segment', () => {
  assert.equal(titleCaseSegment('annual-reports'), 'Annual Reports');
});
test('titleCaseSegment handles single word', () => {
  assert.equal(titleCaseSegment('employees'), 'Employees');
});

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/navToml.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/navToml.js'` (or similar).

- [ ] **Step 3: Write minimal implementation**

Create `scripts/navToml.js`:

```js
// scripts/navToml.js
// Structural read/write of the `nav` and `draft_nav` arrays in zensical.toml.
// Pure string/array functions — no network. Items are normalized to nodes:
//   leaf:    { name: string, value: string }
//   section: { name: string, children: Node[] }

export function slugify(title) {
  return String(title)
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function titleCaseSegment(segment) {
  return String(segment)
    .split('-')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/navToml.test.mjs`
Expected: PASS — `5 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/navToml.js tests/navToml.test.mjs
git commit -m "feat: navToml slugify + titleCaseSegment"
```

---

## Task 2: navToml — parse / serialize / replace block

**Files:**
- Modify: `scripts/navToml.js`
- Test: `tests/navToml.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/navToml.test.mjs` (before the final `console.log`):

```js
import { parseNavBlock, serializeNav, replaceNavBlock } from '../scripts/navToml.js';

const SAMPLE = `# comment line
nav = [
  {"Home" = "index.md"},
  {"Guides" = [
    {"Employees" = [
      {"Registering an employee" = "pages/registering-an-employee.md"}
    ]}
  ]}
]

draft_nav = [
  {"Guides" = [
    {"Employees" = [
      {"Registering an employee" = "pages/registering-an-employee.md"}
    ]}
  ]}
]
`;

test('parseNavBlock reads nav, not draft_nav, for key "nav"', () => {
  const { items } = parseNavBlock(SAMPLE, 'nav');
  assert.equal(items.length, 2);
  assert.equal(items[0].name, 'Home');
  assert.equal(items[0].value, 'index.md');
  assert.equal(items[1].name, 'Guides');
  assert.equal(items[1].children[0].name, 'Employees');
  assert.equal(items[1].children[0].children[0].value, 'pages/registering-an-employee.md');
});
test('parseNavBlock reads draft_nav independently', () => {
  const { items } = parseNavBlock(SAMPLE, 'draft_nav');
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'Guides');
});
test('parseNavBlock returns empty for missing key', () => {
  const { items, start } = parseNavBlock('x = 1\n', 'nav');
  assert.deepEqual(items, []);
  assert.equal(start, -1);
});
test('serializeNav round-trips through parseNavBlock', () => {
  const { items } = parseNavBlock(SAMPLE, 'nav');
  const text = `nav = ${serializeNav(items)}\n`;
  const reparsed = parseNavBlock(text, 'nav').items;
  assert.deepEqual(reparsed, items);
});
test('replaceNavBlock preserves surrounding text', () => {
  const { items } = parseNavBlock(SAMPLE, 'draft_nav');
  const out = replaceNavBlock(SAMPLE, 'draft_nav', items);
  assert.ok(out.startsWith('# comment line'));
  assert.ok(out.includes('nav = ['));
  assert.equal(parseNavBlock(out, 'nav').items.length, 2);
});
test('replaceNavBlock appends an absent block', () => {
  const base = 'nav = [\n  {"Home" = "index.md"}\n]\n';
  const out = replaceNavBlock(base, 'draft_nav', [{ name: 'A', value: 'pages/a.md' }]);
  assert.ok(out.includes('draft_nav = ['));
  assert.equal(parseNavBlock(out, 'draft_nav').items[0].value, 'pages/a.md');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/navToml.test.mjs`
Expected: FAIL — `parseNavBlock is not a function` (export missing).

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/navToml.js`:

```js
function toNode(obj) {
  const [name, val] = Object.entries(obj)[0];
  if (Array.isArray(val)) return { name, children: val.map(toNode) };
  return { name, value: val };
}

const escStr = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

// Find a top-level `key = [ … ]` assignment. The `(^|\n)\s*` anchor prevents
// the key "nav" from matching inside "draft_nav".
export function parseNavBlock(tomlText, key) {
  const re = new RegExp(`(^|\\n)\\s*${key}\\s*=\\s*\\[`);
  const m = re.exec(tomlText);
  if (!m) return { items: [], start: -1, end: -1 };
  const arrStart = tomlText.indexOf('[', m.index);
  let depth = 0, arrEnd = -1;
  for (let i = arrStart; i < tomlText.length; i++) {
    if (tomlText[i] === '[') depth++;
    else if (tomlText[i] === ']') { depth--; if (depth === 0) { arrEnd = i; break; } }
  }
  if (arrEnd === -1) return { items: [], start: -1, end: -1 };
  const arrStr = tomlText.slice(arrStart, arrEnd + 1);
  // Convert TOML inline-table syntax to JSON: "key" = value → "key": value
  const jsonStr = arrStr
    .replace(/"(\s*=\s*)/g, '": ')
    .replace(/,(\s*[}\]])/g, '$1');
  try {
    const raw = JSON.parse(jsonStr);
    return { items: Array.isArray(raw) ? raw.map(toNode) : [], start: arrStart, end: arrEnd };
  } catch {
    return { items: [], start: arrStart, end: arrEnd };
  }
}

// Serialize normalized nodes back to TOML inline-table form, 2-space nested.
export function serializeNav(nodes, { indent = 0 } = {}) {
  const pad = '  '.repeat(indent + 1);
  const closePad = '  '.repeat(indent);
  const lines = nodes.map(node => {
    if (node.children) {
      return `${pad}{"${escStr(node.name)}" = ${serializeNav(node.children, { indent: indent + 1 })}}`;
    }
    return `${pad}{"${escStr(node.name)}" = "${escStr(node.value)}"}`;
  });
  return `[\n${lines.join(',\n')}\n${closePad}]`;
}

export function replaceNavBlock(tomlText, key, items) {
  const { start, end } = parseNavBlock(tomlText, key);
  const serialized = serializeNav(items);
  if (start === -1) {
    const sep = tomlText.endsWith('\n') ? '' : '\n';
    return `${tomlText}${sep}\n${key} = ${serialized}\n`;
  }
  return tomlText.slice(0, start) + serialized + tomlText.slice(end + 1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/navToml.test.mjs`
Expected: PASS — `11 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/navToml.js tests/navToml.test.mjs
git commit -m "feat: navToml parse/serialize/replace block"
```

---

## Task 3: navToml — `insertPath`, `removeByValue`, `findPathOfValue`

**Files:**
- Modify: `scripts/navToml.js`
- Test: `tests/navToml.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/navToml.test.mjs` (before the final `console.log`):

```js
import { insertPath, removeByValue, findPathOfValue } from '../scripts/navToml.js';

test('insertPath merges into existing section matched by slug', () => {
  const items = [{ name: 'Guides', children: [{ name: 'Employees', children: [] }] }];
  insertPath(items, ['guides', 'employees'], 'Registering an employee', 'pages/registering-an-employee.md');
  assert.equal(items.length, 1);
  assert.equal(items[0].children.length, 1);
  assert.equal(items[0].children[0].children[0].value, 'pages/registering-an-employee.md');
});
test('insertPath creates missing sections with title-cased names', () => {
  const items = [];
  insertPath(items, ['guides', 'annual-reports'], 'Q1', 'pages/q1.md');
  assert.equal(items[0].name, 'Guides');
  assert.equal(items[0].children[0].name, 'Annual Reports');
  assert.equal(items[0].children[0].children[0].value, 'pages/q1.md');
});
test('insertPath with empty segments adds a root leaf', () => {
  const items = [];
  insertPath(items, [], 'Top', 'pages/top.md');
  assert.deepEqual(items, [{ name: 'Top', value: 'pages/top.md' }]);
});
test('insertPath replaces an existing leaf by value', () => {
  const items = [{ name: 'Old name', value: 'pages/x.md' }];
  insertPath(items, [], 'New name', 'pages/x.md');
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'New name');
});
test('removeByValue removes leaf and prunes empty parents', () => {
  const items = [{ name: 'Guides', children: [{ name: 'Employees', children: [{ name: 'R', value: 'pages/r.md' }] }] }];
  removeByValue(items, 'pages/r.md');
  assert.deepEqual(items, []);
});
test('removeByValue keeps siblings', () => {
  const items = [{ name: 'G', children: [{ name: 'A', value: 'pages/a.md' }, { name: 'B', value: 'pages/b.md' }] }];
  removeByValue(items, 'pages/a.md');
  assert.equal(items[0].children.length, 1);
  assert.equal(items[0].children[0].value, 'pages/b.md');
});
test('findPathOfValue returns segments and leaf name', () => {
  const items = [{ name: 'Guides', children: [{ name: 'Employees', children: [{ name: 'R', value: 'pages/r.md' }] }] }];
  assert.deepEqual(findPathOfValue(items, 'pages/r.md'), { segments: ['guides', 'employees'], leafName: 'R' });
});
test('findPathOfValue returns null when absent', () => {
  assert.equal(findPathOfValue([], 'pages/none.md'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/navToml.test.mjs`
Expected: FAIL — `insertPath is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/navToml.js`:

```js
// Walk/create the section hierarchy for `segments`, then insert or replace the
// leaf {leafName: value} at the deepest level. Matches existing sections by
// slug; creates missing ones with a title-cased display name. Mutates + returns.
export function insertPath(nodes, segments, leafName, value) {
  let level = nodes;
  for (const seg of segments) {
    const segSlug = slugify(seg);
    let section = level.find(n => n.children && slugify(n.name) === segSlug);
    if (!section) {
      section = { name: titleCaseSegment(segSlug), children: [] };
      level.push(section);
    }
    level = section.children;
  }
  const existing = level.find(n => n.value !== undefined && n.value === value);
  if (existing) existing.name = leafName;
  else level.push({ name: leafName, value });
  return nodes;
}

// Remove the leaf whose value === value; prune sections left empty. Mutates.
export function removeByValue(nodes, value) {
  const recurse = (level) => {
    for (let i = level.length - 1; i >= 0; i--) {
      const n = level[i];
      if (n.children) {
        recurse(n.children);
        if (n.children.length === 0) level.splice(i, 1);
      } else if (n.value === value) {
        level.splice(i, 1);
      }
    }
  };
  recurse(nodes);
  return nodes;
}

// Locate a leaf by value; return { segments (slugs), leafName } or null.
export function findPathOfValue(nodes, value, trail = []) {
  for (const n of nodes) {
    if (n.children) {
      const found = findPathOfValue(n.children, value, [...trail, slugify(n.name)]);
      if (found) return found;
    } else if (n.value === value) {
      return { segments: trail, leafName: n.name };
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/navToml.test.mjs`
Expected: PASS — `19 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/navToml.js tests/navToml.test.mjs
git commit -m "feat: navToml insertPath/removeByValue/findPathOfValue"
```

---

## Task 4: Register navToml in manifest + refactor knowledgeBaseManagement to use it

**Files:**
- Modify: `manifest.json` (web_accessible_resources scripts list)
- Modify: `scripts/knowledgeBaseManagement.js:1-84` (imports + remove local `parseNav`/`navItemToNode`)

- [ ] **Step 1: Add navToml to manifest**

In `manifest.json`, in the `web_accessible_resources` resources array, add `"scripts/navToml.js"` right after `"scripts/repoClient.js"`:

```json
"scripts/repoClient.js", "scripts/navToml.js", "scripts/staleSuppression.js",
```

- [ ] **Step 2: Update knowledgeBaseManagement imports**

In `scripts/knowledgeBaseManagement.js`, change the import block at the top (lines 1-4) to add navToml:

```js
import { createForm } from './form.js';
import { readRepoText } from './repoClient.js';
import { getFormAction } from './formActions.js';
import { renderTree, applySearch } from './kbTree.js';
import { parseNavBlock } from './navToml.js';
```

(Note: `readRepoDir` import is removed — it is no longer used after Task 5.)

- [ ] **Step 3: Delete the local `parseNav` and `navItemToNode`, add node converter**

In `scripts/knowledgeBaseManagement.js`, delete the entire `parseNav` function (the old lines 32-56) and the `navItemToNode` function (old lines 58-80). Replace them with a converter from normalized navToml nodes to kbTree nodes:

```js
// Convert a normalized navToml node ({name,value} | {name,children}) to a
// generic kbTree node.
function navNodeToKbNode(node) {
  if (node.children) {
    return { kind: 'folder', label: node.name, children: node.children.map(navNodeToKbNode) };
  }
  return {
    kind: 'file',
    label: node.name,
    attrs: { 'data-kb-file': node.value, 'data-kb-label': node.name },
  };
}
```

- [ ] **Step 4: Update `renderKbHierarchy` to use the new converter**

In `scripts/knowledgeBaseManagement.js`, change `renderKbHierarchy`:

```js
function renderKbHierarchy(nodes) {
  return renderTree(nodes.map(navNodeToKbNode), { emptyMessage: 'No articles found.' });
}
```

- [ ] **Step 5: Verify the extension still loads (manual)**

Reload the unpacked extension in Chrome. Open the Knowledge Base management page.
Expected: it still loads without console errors about missing modules. (Tree behavior changes in Task 5 — for now it may error on the still-old body of `openKnowledgeBaseManagement`; if so, proceed directly to Task 5 which rewrites that body, then verify.)

- [ ] **Step 6: Commit**

```bash
git add manifest.json scripts/knowledgeBaseManagement.js
git commit -m "refactor: knowledgeBaseManagement uses navToml.parseNavBlock"
```

---

## Task 5: Build tree from nav ∪ draft_nav; pills by value; single API call

**Files:**
- Modify: `scripts/knowledgeBaseManagement.js` (`decorateKbPills`, the body of `openKnowledgeBaseManagement` loading block)

- [ ] **Step 1: Add a merge helper + value collector**

In `scripts/knowledgeBaseManagement.js`, add near `navNodeToKbNode`:

```js
// Merge two lists of normalized nav nodes. Sections are merged by slug of their
// display name (so nav "Guides" and draft_nav "Guides" combine); leaves are
// unioned by value (first display name wins).
function mergeNavNodes(listA, listB) {
  const out = [];
  for (const node of [...listA, ...listB]) {
    if (node.children) {
      const existing = out.find(n => n.children && slugify(n.name) === slugify(node.name));
      if (existing) existing.children = mergeNavNodes(existing.children, node.children);
      else out.push({ name: node.name, children: mergeNavNodes(node.children, []) });
    } else if (!out.some(n => n.value === node.value)) {
      out.push({ name: node.name, value: node.value });
    }
  }
  return out;
}

// Collect every leaf value in a node list into `set`.
function collectValues(nodes, set) {
  for (const n of nodes) {
    if (n.children) collectValues(n.children, set);
    else set.add(n.value);
  }
  return set;
}
```

Add `slugify` to the navToml import:

```js
import { parseNavBlock, slugify } from './navToml.js';
```

- [ ] **Step 2: Rewrite `decorateKbPills` to match by value**

Replace the existing `decorateKbPills` function with:

```js
// Tag each tree leaf with Live / Drafting pills. navFiles/draftFiles are sets of
// nav leaf *values* (e.g. "pages/foo.md"), so no folder listing is needed.
function decorateKbPills(panel, draftFiles, navFiles) {
  panel.querySelectorAll('[data-kb-leaf]').forEach(leaf => {
    const file = leaf.dataset.kbFile || '';
    const base = file.split('/').pop();
    if (!file) return;
    const pills = [];
    if (!DRAFT_PILL_EXEMPT.has(base) && draftFiles.has(file)) {
      pills.push('<span class="mb-kb-pill --drafting">Drafting</span>');
    }
    if (navFiles.has(file)) {
      pills.push('<span class="mb-kb-pill --live">Live</span>');
    }
    if (pills.length) {
      leaf.insertAdjacentHTML('beforeend', `<span class="mb-kb-pills">${pills.join('')}</span>`);
    }
  });
}
```

- [ ] **Step 3: Rewrite the loading block of `openKnowledgeBaseManagement`**

Replace the `try { … } catch { … }` block that currently does `Promise.all([readRepoText, readRepoDir, readRepoDir])` (old lines ~98-134) with:

```js
    try {
      // One fetch of zensical.toml drives everything: the tree is the union of
      // nav (live) and draft_nav (in-progress), and pills come from membership
      // in each set of leaf values — no per-folder listing needed.
      const tomlText = await readRepoText('zensical.toml');
      const nav = parseNavBlock(tomlText, 'nav').items;
      const draftNav = parseNavBlock(tomlText, 'draft_nav').items;
      const navFiles = collectValues(nav, new Set());
      const draftFiles = collectValues(draftNav, new Set());

      if (livePanel) {
        const guideNav = nav.filter(n => !EXCLUDED_SECTIONS.has(n.name));
        const merged = mergeNavNodes(guideNav, draftNav);
        livePanel.innerHTML = renderKbHierarchy(merged);
        decorateKbPills(livePanel, draftFiles, navFiles);
      }

      if (systemPanel) {
        const systemEntry = nav.find(n => n.name === 'System' && n.children);
        if (systemEntry) {
          systemPanel.innerHTML = renderKbHierarchy([systemEntry]);
          decorateKbPills(systemPanel, draftFiles, navFiles);
        } else {
          systemPanel.innerHTML = '<p class="more-buttons-description">No system pages found.</p>';
        }
      }
    } catch {
      if (livePanel) livePanel.innerHTML = '<p class="more-buttons-description">Failed to load articles.</p>';
      if (systemPanel) systemPanel.innerHTML = '<p class="more-buttons-description">Failed to load system pages.</p>';
    }
```

- [ ] **Step 4: Verify (manual)**

Reload the extension. Open Knowledge Base management.
Expected: the Guides tree shows the same live pages as before, each with a "Live" pill; the existing draft (`registering-an-employee.md`) shows a "Drafting" pill. The System tab still lists system pages. Check the Network tab: only one request to `contents/zensical.toml`, no `contents/docs/drafts` or `contents/docs/pages` directory listings.

- [ ] **Step 5: Commit**

```bash
git add scripts/knowledgeBaseManagement.js
git commit -m "feat: KB tree from nav union draft_nav, pills by value, one API call"
```

---

## Task 6: createGuide form HTML + path-field CSS

**Files:**
- Create: `config/forms/createGuide.html`
- Modify: `config/forms/formsStyling.css` (append new rules)

- [ ] **Step 1: Create the form**

Create `config/forms/createGuide.html`:

```html
<form data-nav id="create-guide-form" data-storage-key="moreButtonsCreateGuide" data-width="90vw" data-height="90vh">
  <h2>Create a new guide</h2>

  <div class="more-buttons-form-group">
    <label class="more-buttons-label">Title</label>
    <input type="text" name="guideTitle" required placeholder="Registering an employee" />
  </div>

  <div class="more-buttons-form-group">
    <label class="more-buttons-label">Path</label>
    <div class="mb-path-field">
      <input type="text" name="guidePath" placeholder="guides/employees" />
      <span class="mb-path-suffix" data-path-suffix>/…md</span>
    </div>
  </div>

  <div class="more-buttons-form-actions">
    <button type="button" class="more-buttons-button" data-action="submitCreateGuide" data-validate>Create draft</button>
  </div>
</form>
```

- [ ] **Step 2: Append the CSS**

Append to the end of `config/forms/formsStyling.css`:

```css
/* ── Create-guide path field ──────────────────────────────────────────────── */
.mb-path-field {
  display: flex;
  align-items: stretch;
  border: 1px solid var(--mb-border);
  border-radius: 6px;
  background-color: var(--mb-bg-input);
  overflow: hidden;
}
.mb-path-field:focus-within {
  border-color: #3b82f6;
  box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.5);
}
.more-buttons-overlay-content .mb-path-field input[type="text"] {
  flex: 1 1 auto;
  border: none;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
  min-width: 0;
}
.more-buttons-overlay-content .mb-path-field input[type="text"]:focus {
  border: none;
  box-shadow: none;
}
.mb-path-suffix {
  display: inline-flex;
  align-items: center;
  padding: 0 9px;
  white-space: nowrap;
  color: var(--mb-text-placeholder);
  font-size: 0.875rem;
  background-color: var(--mb-bg-input);
  border-left: 1px dashed var(--mb-border);
}
```

- [ ] **Step 3: Verify CSS loads (manual, after Task 7 wires the button)**

Deferred to Task 7 Step 5 (the form can't be opened until the action is registered).

- [ ] **Step 4: Commit**

```bash
git add config/forms/createGuide.html config/forms/formsStyling.css
git commit -m "feat: createGuide form + path-field styling"
```

---

## Task 7: openCreateGuide / submitCreateGuide form actions + KB button

**Files:**
- Modify: `scripts/guides.js` (imports + new form actions, after the existing draft helpers)
- Modify: `config/forms/knowledgeBaseManagement.html` (add button)
- Modify: `scripts/knowledgeBaseManagement.js` (wire button click)

- [ ] **Step 1: Extend guides.js imports**

In `scripts/guides.js`, update the `repoClient`/`form` imports and add navToml:

```js
import { registerFormAction, getFormAction } from './formActions.js';
import { createForm, replaceCurrentOpener, setCrumbLabel, isFormReplay, navigateBack, confirmDiscardIfDirty } from './form.js';
import { readRepoText } from './repoClient.js';
import { githubFetchAndPushFile, githubDeleteFile } from './github.js';
import { parseNavBlock, replaceNavBlock, insertPath, slugify } from './navToml.js';
```

(The `sections.js` / `admonitions.js` / `captures.js` / `cardRenderer.js` import blocks are unchanged. `ensureSectionUUIDs` is already imported from `./sections.js`.)

- [ ] **Step 2: Add the create-guide form actions**

In `scripts/guides.js`, add after the `discardGuideDraft` function (around line 278, before the `// ── Section editor ──` banner):

```js
// ── Create a brand-new guide ────────────────────────────────────────────────

registerFormAction('openCreateGuide', async () => {
  if (!isFormReplay()) {
    await chrome.storage.local.set({
      moreButtonsCreateGuide: { guideTitle: '', guidePath: '' },
    });
  }
  const { formEl } = await createForm('createGuide');
  if (!formEl) return;

  const suffix = formEl.querySelector('[data-path-suffix]');
  const titleInput = formEl.querySelector('[name="guideTitle"]');
  const renderSuffix = () => {
    const slug = slugify(titleInput?.value ?? '');
    if (suffix) suffix.textContent = slug ? `/${slug}.md` : '/…md';
  };
  formEl.addEventListener('input', e => {
    if (e.target.name === 'guideTitle') renderSuffix();
  });
  renderSuffix();
});

registerFormAction('submitCreateGuide', async ({ formEl, content }) => {
  const btn = content.querySelector('[data-action="submitCreateGuide"]');
  const originalText = btn?.textContent;
  const title = formEl.querySelector('[name="guideTitle"]')?.value.trim() ?? '';
  const pathRaw = formEl.querySelector('[name="guidePath"]')?.value ?? '';
  const slug = slugify(title);
  if (!slug) { alert('Please enter a title.'); return; }

  const segments = pathRaw.split('/').map(s => s.trim()).filter(Boolean);
  const value = `pages/${slug}.md`;
  const draftPath = `docs/drafts/${slug}.md`;

  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
  try {
    // Conflict check: a flat-by-slug file may already be live (in nav) or a draft.
    const tomlText = await readRepoText('zensical.toml');
    const nav = parseNavBlock(tomlText, 'nav').items;
    const liveValues = new Set();
    (function collect(nodes) {
      for (const n of nodes) { if (n.children) collect(n.children); else liveValues.add(n.value); }
    })(nav);
    if (liveValues.has(value)) {
      alert(`A live page with the name "${slug}.md" already exists.`);
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
      return;
    }
    const existingDraft = await readRepoText(draftPath);
    if (existingDraft) {
      alert(`A draft named "${slug}.md" already exists. Choose a different title.`);
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
      return;
    }

    // Write the draft file (H1 = title, UUID span injected so the tree renders).
    if (btn) btn.textContent = 'Creating draft…';
    await githubFetchAndPushFile(draftPath, s => { if (btn) btn.textContent = s; },
      () => ensureSectionUUIDs(`# ${title}\n`));

    // Add to draft_nav.
    if (btn) btn.textContent = 'Updating navigation…';
    await githubFetchAndPushFile('zensical.toml', s => { if (btn) btn.textContent = s; }, md => {
      const items = parseNavBlock(md, 'draft_nav').items;
      insertPath(items, segments, title, value);
      return replaceNavBlock(md, 'draft_nav', items);
    });

    await chrome.storage.local.remove('moreButtonsCreateGuide');
    // Behave like an open draft from here on.
    await getFormAction('openGuideEntry')({ filePath: value, label: title });
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    alert('Failed to create guide: ' + e.message);
  }
});
```

- [ ] **Step 3: Add the button to the KB form**

In `config/forms/knowledgeBaseManagement.html`, change the form-actions block to include the new button (bottom-right, primary):

```html
  <div class="more-buttons-form-actions">
    <button type="button" class="more-buttons-button secondary" data-kb-open-capture-library>Capture Library</button>
    <button type="button" class="more-buttons-button" data-kb-create-guide>+ Create a new guide</button>
  </div>
```

- [ ] **Step 4: Wire the button click**

In `scripts/knowledgeBaseManagement.js`, inside the `formEl.parentElement?.addEventListener('click', …)` handler, add a branch at the top of the handler (right after the capture-library branch):

```js
      if (e.target.closest('[data-kb-create-guide]')) {
        await getFormAction('openCreateGuide')?.();
        return;
      }
```

- [ ] **Step 5: Verify (manual)**

Reload the extension. Open Knowledge Base management → click "+ Create a new guide".
Expected: the form opens. Typing "Registering an employee" in Title updates the greyed suffix to `/registering-an-employee.md`. With that exact title (a draft already exists) clicking "Create draft" warns about an existing draft. Change the title to something new (e.g. "Test guide alpha"), set Path to `guides/employees`, click "Create draft": it creates `docs/drafts/test-guide-alpha.md`, adds it to `draft_nav` under Guides > Employees, and transitions into the guide editor showing the title with an "+ Add new section" button. Re-open KB management: the new guide appears under Guides > Employees with a "Drafting" pill (no "Live").

- [ ] **Step 6: Commit**

```bash
git add scripts/guides.js config/forms/knowledgeBaseManagement.html scripts/knowledgeBaseManagement.js
git commit -m "feat: create-new-guide flow (form actions + KB button)"
```

---

## Task 8: Sync draft_nav / nav in create-draft, publish, discard

**Files:**
- Modify: `scripts/guides.js` (`createGuideDraft`, `publishGuideDraft`, `discardGuideDraft`; add `findPathOfValue`, `removeByValue` imports + a helper)

- [ ] **Step 1: Extend the navToml import**

In `scripts/guides.js`, extend the navToml import added in Task 7:

```js
import { parseNavBlock, replaceNavBlock, insertPath, removeByValue, findPathOfValue, slugify } from './navToml.js';
```

- [ ] **Step 2: Add a value-from-path helper near the top helpers**

In `scripts/guides.js`, after `guideBaseName` (around line 85), add:

```js
// Nav leaf value for the current guide, e.g. 'pages/foo.md' (drops leading docs/).
function navValueOf(livePath) {
  return livePath.replace(/^docs\//, '');
}
```

- [ ] **Step 3: Sync draft_nav when creating a draft of an existing live page**

In `scripts/guides.js`, in `createGuideDraft`, after the existing
`await githubFetchAndPushFile(currentGuide.draftPath, …, () => migrated);` line and before `await renderGuideEntryContent(formEl);`, add:

```js
    // Mirror the page's nav location into draft_nav so it shows a Drafting pill.
    if (btn) btn.textContent = 'Updating navigation…';
    const value = navValueOf(currentGuide.livePath);
    await githubFetchAndPushFile('zensical.toml', s => { if (btn) btn.textContent = s; }, md => {
      const navItems = parseNavBlock(md, 'nav').items;
      const draftItems = parseNavBlock(md, 'draft_nav').items;
      const loc = findPathOfValue(navItems, value);
      insertPath(draftItems, loc?.segments ?? [], loc?.leafName ?? guideBaseName(currentGuide.livePath), value);
      return replaceNavBlock(md, 'draft_nav', draftItems);
    });
```

- [ ] **Step 4: Sync on publish (add to nav, remove from draft_nav)**

In `scripts/guides.js`, in `publishGuideDraft`, after the
`await githubDeleteFile(currentGuide.draftPath, …);` line and before
`await renderGuideEntryContent(formEl);`, add:

```js
    // Promote into nav (mirroring its draft_nav location) and drop from draft_nav.
    if (btn) btn.textContent = 'Updating navigation…';
    const value = navValueOf(currentGuide.livePath);
    await githubFetchAndPushFile('zensical.toml', s => { if (btn) btn.textContent = s; }, md => {
      const navItems = parseNavBlock(md, 'nav').items;
      const draftItems = parseNavBlock(md, 'draft_nav').items;
      const loc = findPathOfValue(draftItems, value);
      if (!findPathOfValue(navItems, value)) {
        insertPath(navItems, loc?.segments ?? [], loc?.leafName ?? guideBaseName(currentGuide.livePath), value);
      }
      removeByValue(draftItems, value);
      let out = replaceNavBlock(md, 'nav', navItems);
      out = replaceNavBlock(out, 'draft_nav', draftItems);
      return out;
    });
```

- [ ] **Step 5: Sync on discard (remove from draft_nav only)**

In `scripts/guides.js`, in `discardGuideDraft`, after the
`await githubDeleteFile(currentGuide.draftPath, …);` line and before
`await renderGuideEntryContent(formEl);`, add:

```js
    if (btn) btn.textContent = 'Updating navigation…';
    const value = navValueOf(currentGuide.livePath);
    await githubFetchAndPushFile('zensical.toml', s => { if (btn) btn.textContent = s; }, md => {
      const draftItems = parseNavBlock(md, 'draft_nav').items;
      removeByValue(draftItems, value);
      return replaceNavBlock(md, 'draft_nav', draftItems);
    });
```

- [ ] **Step 6: Verify (manual)**

Reload the extension. Test the full lifecycle on a throwaway guide:
1. **Create draft of a live page:** open an existing live guide with no draft → "Create draft". Re-open KB management → it now shows both "Live" and "Drafting" pills, nested at its nav location.
2. **Discard:** open it → "Discard draft". Re-open KB management → only "Live" remains; `draft_nav` no longer lists it.
3. **New guide → publish:** create a new guide (Task 7), add a section, then "Publish draft to live". Re-open KB management → it now shows "Live" (and no "Drafting"); it appears in `nav` under its path, and is gone from `draft_nav`.

Inspect `zensical.toml` on GitHub after each step to confirm the arrays are well-formed and comments/other keys are preserved.

- [ ] **Step 7: Run the full unit suite**

Run: `node tests/navToml.test.mjs`
Expected: PASS — `19 passed`.

- [ ] **Step 8: Commit**

```bash
git add scripts/guides.js
git commit -m "feat: sync draft_nav/nav on create-draft, publish, discard"
```

---

## Self-Review Notes

- **Spec §1 navToml module:** Tasks 1-3 (all functions: slugify, titleCaseSegment, parseNavBlock, serializeNav, replaceNavBlock, insertPath, removeByValue, findPathOfValue). ✓
- **Spec §2 UI (button + form):** Task 6 (form + CSS), Task 7 (button + wiring). ✓
- **Spec §3 create-draft flow:** Task 7 Step 2 (`submitCreateGuide`: slug, conflict check on nav + draft, write draft, draft_nav insert, transition). ✓
- **Spec §4 sync existing ops:** Task 8 (create-draft mirror, publish add-to-nav + remove-from-draft_nav, discard remove). ✓
- **Spec §5 tree + pills:** Task 5 (union tree, pills by value, single API call, readRepoDir removed). ✓
- **Spec §6 manifest:** Task 4 Step 1. ✓
- **Spec §7 testing:** Tasks 1-3 cover all listed navToml unit cases; manual flows in Tasks 5/7/8. ✓
- **Type consistency:** normalized node `{name,value}`/`{name,children}` used consistently; `navValueOf`, `findPathOfValue` (returns `{segments, leafName}`), `insertPath(nodes, segments, leafName, value)` signatures consistent across guides.js and tests. ✓
- **Empty-path & symbol-only-title** handled (Task 3 empty-segments test; Task 7 empty-slug guard). ✓
