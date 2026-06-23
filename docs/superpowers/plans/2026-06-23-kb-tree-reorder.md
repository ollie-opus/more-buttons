# KB Tree Reorder & Move Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task (chosen execution mode: subagent-driven — fresh subagent per task, two-stage review between tasks). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users reorder guides/folders among siblings and move them across sections directly in the Knowledge Base tree, batched into a single `zensical.toml` commit, replacing the edit-page-settings Path field.

**Architecture:** Pure tree functions in `navToml.js` reproject an edited display tree back into the `nav` and `draft_nav` arrays (membership-filtered, exact value strings reused, non-guide entries preserved). A new `kbReorder.js` controller holds an editable working copy of the merged tree, applies index-path move/reparent ops, tracks a dirty flag, and builds the two-array save payload. `kbTree.js` gains a `reorderable` render option; `knowledgeBaseManagement.js` wires controls, a footer bar, and the save.

**Tech Stack:** Vanilla ES modules (Chrome extension, no build step). Tests are plain `.mjs` files using `node:assert/strict`, run with `node tests/<file>.test.mjs`. No test framework, no package.json.

## Global Constraints

- **No package.json / no framework.** Tests are standalone: `import assert from 'node:assert/strict';`, a tiny `test(name, fn)` helper, `console.log` summary. Run each with `node tests/<file>.test.mjs`. Match `tests/readYourWrites.test.mjs` exactly.
- **Every new `scripts/*.js` MUST be added to `manifest.json` `web_accessible_resources`** (scripts listed individually, not globbed). Omission → "Failed to fetch dynamically imported module: actions.js".
- **Never fabricate nav values.** Reuse the exact value strings parsed from the toml. Write a leaf into `nav` only if its filename is already a `nav` member; into `draft_nav` only if already a `draft_nav` member.
- **`EXCLUDED_SECTIONS` = `Home`, `System`** are anchors: never reordered, moved, or dropped. Likewise any top-level entry not part of the displayed guide tree.
- **`nav` is the order authority**; `draft_nav` mirrors the same relative order. `mergeNavNodes` is NOT changed (draft-only pages stay appended after live siblings).
- Save runs behind the existing centered `formLoading` veil — no inline spinners.
- Node addressing inside the working copy is **index-path** (e.g. `[0,2,1]` = `root[0].children[2].children[1]`), re-derived on every render so it is never stale.

---

### Task 1: Pure projection helpers in `navToml.js`

Reproject an edited tree onto one array's membership and splice it back preserving anchors.

**Files:**
- Modify: `scripts/navToml.js` (add exports near the existing leaf helpers, after `renameByValueSlug`)
- Test: `tests/navProjection.test.mjs` (create)

**Interfaces:**
- Consumes: existing `slugify`, `valueSlug`, `serializeNav`, `parseNavBlock` from `navToml.js`.
- Produces:
  - `baseOf(value: string): string` — filename, e.g. `'pages/a.md' → 'a.md'`.
  - `valueMapByBase(nodes): Map<string,string>` — `baseOf(value) → exact value`, recursing into folders.
  - `leafBases(nodes): Set<string>` — every leaf's `baseOf(value)`.
  - `projectTree(edited, valueMap): Node[]` — clone of `edited` keeping only leaves whose `baseOf(value) ∈ valueMap` (value replaced with `valueMap.get(base)`), pruning folders left empty.
  - `spliceGuideBlock(original, projected, editedTopSlugs): Node[]` — walk `original`; a node is *managed* iff it has children and `editedTopSlugs.has(slugify(node.name))`; replace the managed run (in place, at the first managed index) with `projected`, preserve every other node verbatim; if no managed node exists, append `projected` at the end.

- [ ] **Step 1: Write the failing test**

Create `tests/navProjection.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import {
  baseOf, valueMapByBase, leafBases, projectTree, spliceGuideBlock, slugify,
} from '../scripts/navToml.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const nav = [
  { name: 'Home', value: 'pages/index.md' },
  { name: 'Guides', children: [
    { name: 'Employees', children: [
      { name: 'Registering', value: 'pages/registering.md' },
      { name: 'Offboarding', value: 'pages/offboarding.md' },
    ] },
  ] },
  { name: 'System', children: [ { name: 'Status', value: 'pages/system-status.md' } ] },
];
const draftNav = [
  { name: 'Guides', children: [
    { name: 'Employees', children: [
      { name: 'Onboarding (draft)', value: 'drafts/onboarding.md' },
    ] },
  ] },
];

test('baseOf strips the directory', () => {
  assert.equal(baseOf('pages/registering.md'), 'registering.md');
});

test('valueMapByBase keys on filename → exact value', () => {
  const m = valueMapByBase(nav);
  assert.equal(m.get('registering.md'), 'pages/registering.md');
  assert.equal(m.get('system-status.md'), 'pages/system-status.md');
});

test('leafBases collects every leaf filename', () => {
  assert.deepEqual([...leafBases(draftNav)], ['onboarding.md']);
});

test('projectTree keeps only members, reuses exact values, prunes empties', () => {
  // edited tree: Offboarding moved above Registering, plus a draft-only leaf.
  const edited = [
    { name: 'Guides', children: [
      { name: 'Employees', children: [
        { name: 'Offboarding', value: 'pages/offboarding.md' },
        { name: 'Registering', value: 'pages/registering.md' },
        { name: 'Onboarding (draft)', value: 'drafts/onboarding.md' },
      ] },
    ] },
  ];
  const liveMap = valueMapByBase(nav);
  const projected = projectTree(edited, liveMap);
  // draft-only leaf dropped from the live projection; order preserved.
  assert.deepEqual(projected, [
    { name: 'Guides', children: [
      { name: 'Employees', children: [
        { name: 'Offboarding', value: 'pages/offboarding.md' },
        { name: 'Registering', value: 'pages/registering.md' },
      ] },
    ] },
  ]);
});

test('projectTree prunes a folder with no surviving members', () => {
  const edited = [ { name: 'Empties', children: [
    { name: 'Only draft', value: 'drafts/x.md' },
  ] } ];
  assert.deepEqual(projectTree(edited, valueMapByBase(nav)), []);
});

test('spliceGuideBlock preserves Home/System anchors in place', () => {
  const projected = [
    { name: 'Guides', children: [ { name: 'Offboarding', value: 'pages/offboarding.md' } ] },
  ];
  const out = spliceGuideBlock(nav, projected, new Set(['guides']));
  assert.deepEqual(out, [
    { name: 'Home', value: 'pages/index.md' },
    { name: 'Guides', children: [ { name: 'Offboarding', value: 'pages/offboarding.md' } ] },
    { name: 'System', children: [ { name: 'Status', value: 'pages/system-status.md' } ] },
  ]);
});

test('spliceGuideBlock appends projected when no managed node exists', () => {
  const original = [ { name: 'Home', value: 'pages/index.md' } ];
  const projected = [ { name: 'Guides', children: [ { name: 'A', value: 'pages/a.md' } ] } ];
  const out = spliceGuideBlock(original, projected, new Set(['guides']));
  assert.deepEqual(out, [
    { name: 'Home', value: 'pages/index.md' },
    { name: 'Guides', children: [ { name: 'A', value: 'pages/a.md' } ] },
  ]);
});

test('spliceGuideBlock drops an emptied managed section (projection omits it)', () => {
  // 'Guides' is managed (in editedTopSlugs) but projected has no Guides → dropped.
  const out = spliceGuideBlock(nav, [], new Set(['guides']));
  assert.deepEqual(out, [
    { name: 'Home', value: 'pages/index.md' },
    { name: 'System', children: [ { name: 'Status', value: 'pages/system-status.md' } ] },
  ]);
});

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/navProjection.test.mjs`
Expected: FAIL — `SyntaxError`/`does not provide an export named 'baseOf'`.

- [ ] **Step 3: Add the implementations to `navToml.js`**

Append after `renameByValueSlug` (end of file, before nothing — these are new top-level exports):

```javascript
// Filename of a value: 'pages/a.md' and 'drafts/a.md' → 'a.md'. The identity
// key uniting a live leaf with its draft counterpart (filenames are globally
// unique). Shared by the reorder projection.
export function baseOf(value) {
  return String(value).split('/').pop();
}

// Map every leaf's filename → its EXACT value string. Used so the reorder save
// reuses the value already in the toml rather than reconstructing a prefix.
export function valueMapByBase(nodes) {
  const map = new Map();
  const walk = (level) => {
    for (const n of level) {
      if (n.children) walk(n.children);
      else map.set(baseOf(n.value), n.value);
    }
  };
  walk(nodes);
  return map;
}

// Set of every leaf filename in the tree.
export function leafBases(nodes) {
  const set = new Set();
  const walk = (level) => {
    for (const n of level) {
      if (n.children) walk(n.children);
      else set.add(baseOf(n.value));
    }
  };
  walk(nodes);
  return set;
}

// Clone `edited`, keeping only leaves whose filename is a key in `valueMap`
// (value replaced by the exact mapped string), and pruning folders left empty.
// This is how the edited display tree is projected onto one array's membership.
export function projectTree(edited, valueMap) {
  const out = [];
  for (const n of edited) {
    if (n.children) {
      const kids = projectTree(n.children, valueMap);
      if (kids.length) out.push({ name: n.name, children: kids });
    } else {
      const base = baseOf(n.value);
      if (valueMap.has(base)) out.push({ name: n.name, value: valueMap.get(base) });
    }
  }
  return out;
}

// Replace the run of "managed" top-level sections in `original` with `projected`,
// preserving every other entry (Home/System and anything not part of the edited
// guide tree) verbatim and in place. A node is managed iff it is a section whose
// slug is in `editedTopSlugs`. The projected block lands at the first managed
// index; if nothing is managed it is appended.
export function spliceGuideBlock(original, projected, editedTopSlugs) {
  const isManaged = (node) =>
    Array.isArray(node.children) && editedTopSlugs.has(slugify(node.name));
  const out = [];
  let inserted = false;
  for (const node of original) {
    if (isManaged(node)) {
      if (!inserted) { out.push(...projected); inserted = true; }
      // otherwise drop — replaced by the projected block
    } else {
      out.push(node);
    }
  }
  if (!inserted) out.push(...projected);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/navProjection.test.mjs`
Expected: `8 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/navToml.js tests/navProjection.test.mjs
git commit -m "feat(nav): tree projection helpers for KB reorder

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Pure index-path mutation helpers in `navToml.js`

Move a node among siblings and reparent it (to an existing section by index-path, or a new path by segments).

**Files:**
- Modify: `scripts/navToml.js` (add after the Task 1 exports)
- Test: `tests/navTreeOps.test.mjs` (create)

**Interfaces:**
- Consumes: existing `slugify`, `titleCaseSegment`.
- Produces:
  - `nodeAtPath(tree, idxPath): Node|null` — walk `idxPath` (array of indices) through `children`.
  - `moveSibling(tree, idxPath, dir): boolean` — swap the node at `idxPath` with its `dir` (`-1`/`+1`) neighbor among its siblings; returns `false` (no-op) at an end.
  - `detachAtPath(tree, idxPath): Node|null` — splice out and return the node at `idxPath`.
  - `attachUnderPath(tree, idxPath|null, node): void` — push `node` into the children of the section at `idxPath` (or top level if `null`).
  - `attachUnderSegments(tree, segments, node): void` — walk/create sections by slug (title-cased display names for new ones), push `node` at the deepest level.

- [ ] **Step 1: Write the failing test**

Create `tests/navTreeOps.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import {
  nodeAtPath, moveSibling, detachAtPath, attachUnderPath, attachUnderSegments,
} from '../scripts/navTree.js'; // re-exported from navToml; see Step 3 note

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const fresh = () => ([
  { name: 'Guides', children: [
    { name: 'A', value: 'pages/a.md' },
    { name: 'B', value: 'pages/b.md' },
    { name: 'C', value: 'pages/c.md' },
  ] },
  { name: 'Reference', children: [
    { name: 'D', value: 'pages/d.md' },
  ] },
]);

test('nodeAtPath walks indices through children', () => {
  assert.equal(nodeAtPath(fresh(), [0, 1]).name, 'B');
  assert.equal(nodeAtPath(fresh(), [1]).name, 'Reference');
  assert.equal(nodeAtPath(fresh(), [0, 9]), null);
});

test('moveSibling swaps with the next neighbour', () => {
  const t = fresh();
  assert.equal(moveSibling(t, [0, 0], +1), true);
  assert.deepEqual(t[0].children.map(n => n.name), ['B', 'A', 'C']);
});

test('moveSibling is a no-op past the end', () => {
  const t = fresh();
  assert.equal(moveSibling(t, [0, 2], +1), false);
  assert.deepEqual(t[0].children.map(n => n.name), ['A', 'B', 'C']);
});

test('detachAtPath removes and returns the node', () => {
  const t = fresh();
  const n = detachAtPath(t, [0, 1]);
  assert.equal(n.name, 'B');
  assert.deepEqual(t[0].children.map(x => x.name), ['A', 'C']);
});

test('attachUnderPath pushes into the target section', () => {
  const t = fresh();
  const n = detachAtPath(t, [0, 1]);          // pull B out of Guides
  attachUnderPath(t, [1], n);                  // into Reference (now index 1)
  assert.deepEqual(t[1].children.map(x => x.name), ['D', 'B']);
});

test('attachUnderSegments creates missing sections title-cased', () => {
  const t = fresh();
  const n = detachAtPath(t, [0, 0]);          // pull A out
  attachUnderSegments(t, ['guides', 'contractors'], n);
  const contractors = t[0].children.find(x => x.name === 'Contractors');
  assert.ok(contractors, 'Contractors section created');
  assert.deepEqual(contractors.children.map(x => x.name), ['A']);
});

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/navTreeOps.test.mjs`
Expected: FAIL — cannot find module `../scripts/navTree.js`.

- [ ] **Step 3: Implement the ops in `navToml.js` and re-export**

> Note: keep these in `navToml.js` (cohesive with the other tree functions). The test imports from `navTree.js` only to keep the test's import list short — create a 1-line re-export file `scripts/navTree.js`:
> ```javascript
> // Convenience re-export of the tree-op subset of navToml.js.
> export { nodeAtPath, moveSibling, detachAtPath, attachUnderPath, attachUnderSegments } from './navToml.js';
> ```

Append to `navToml.js`:

```javascript
// Walk an index-path (array of child indices) to a node, or null if out of range.
export function nodeAtPath(tree, idxPath) {
  let level = tree, node = null;
  for (const i of idxPath) {
    node = level?.[i];
    if (!node) return null;
    level = node.children;
  }
  return node;
}

// Swap the node at idxPath with its dir (-1/+1) sibling. Returns false at an end.
export function moveSibling(tree, idxPath, dir) {
  const parentPath = idxPath.slice(0, -1);
  const i = idxPath[idxPath.length - 1];
  const siblings = parentPath.length ? nodeAtPath(tree, parentPath)?.children : tree;
  if (!siblings) return false;
  const j = i + dir;
  if (j < 0 || j >= siblings.length) return false;
  [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
  return true;
}

// Splice out and return the node at idxPath (null if not found).
export function detachAtPath(tree, idxPath) {
  const parentPath = idxPath.slice(0, -1);
  const i = idxPath[idxPath.length - 1];
  const siblings = parentPath.length ? nodeAtPath(tree, parentPath)?.children : tree;
  if (!siblings || i < 0 || i >= siblings.length) return null;
  return siblings.splice(i, 1)[0];
}

// Push node into the children of the section at idxPath (top level if null).
export function attachUnderPath(tree, idxPath, node) {
  if (!idxPath || idxPath.length === 0) { tree.push(node); return; }
  const target = nodeAtPath(tree, idxPath);
  if (target && target.children) target.children.push(node);
}

// Walk/create sections by slug (title-cased display name for new ones), then
// push node at the deepest level. Mirrors insertPath's section-walk.
export function attachUnderSegments(tree, segments, node) {
  let level = tree;
  for (const seg of segments) {
    const segSlug = slugify(seg);
    let section = level.find(n => n.children && slugify(n.name) === segSlug);
    if (!section) { section = { name: titleCaseSegment(segSlug), children: [] }; level.push(section); }
    level = section.children;
  }
  level.push(node);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/navTreeOps.test.mjs`
Expected: `6 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/navToml.js scripts/navTree.js tests/navTreeOps.test.mjs
git commit -m "feat(nav): index-path move/reparent tree ops for KB reorder

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `reorderable` render option in `kbTree.js`

Emit per-row reorder controls and an index-path data attribute, without affecting other callers.

**Files:**
- Modify: `scripts/kbTree.js`
- Test: `tests/kbTreeReorderable.test.mjs` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces: `renderTree(nodes, { emptyMessage, reorderable })` — when `reorderable` is true, each `.mb-kb-node-row` is followed by a `.mb-kb-row-controls` block containing `[data-kb-move-up]`, `[data-kb-move-down]`, `[data-kb-move-to]` buttons; every `.mb-kb-node-row` carries `data-kb-path="0.2.1"` (dot-joined index path). Up is `disabled` on the first sibling, Down on the last. Default (`reorderable` omitted/false) output is byte-identical to today.

- [ ] **Step 1: Write the failing test**

Create `tests/kbTreeReorderable.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import { renderTree } from '../scripts/kbTree.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const nodes = [
  { kind: 'folder', label: 'Employees', children: [
    { kind: 'file', label: 'A', attrs: { 'data-kb-file': 'pages/a.md' } },
    { kind: 'file', label: 'B', attrs: { 'data-kb-file': 'pages/b.md' } },
  ] },
];

test('default render has no reorder controls (unchanged)', () => {
  const html = renderTree(nodes);
  assert.ok(!html.includes('data-kb-move-up'));
  assert.ok(!html.includes('data-kb-path'));
});

test('reorderable render adds controls and index paths', () => {
  const html = renderTree(nodes, { reorderable: true });
  assert.ok(html.includes('data-kb-move-up'));
  assert.ok(html.includes('data-kb-move-to'));
  assert.ok(html.includes('data-kb-path="0"'));     // the folder
  assert.ok(html.includes('data-kb-path="0.0"'));   // leaf A
  assert.ok(html.includes('data-kb-path="0.1"'));   // leaf B
});

test('first sibling Up disabled, last sibling Down disabled', () => {
  const html = renderTree(nodes, { reorderable: true });
  // A (0.0) is first → its Up is disabled; B (0.1) is last → its Down disabled.
  const aUp = html.match(/data-kb-path="0\.0"[\s\S]*?data-kb-move-up[^>]*>/)[0];
  assert.ok(aUp.includes('disabled'));
  const bDown = html.match(/data-kb-path="0\.1"[\s\S]*?data-kb-move-down[^>]*>/)[0];
  assert.ok(bDown.includes('disabled'));
});

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/kbTreeReorderable.test.mjs`
Expected: FAIL — `data-kb-move-up` not present in reorderable output.

- [ ] **Step 3: Implement the option**

Replace the body of `kbTree.js` `renderNode`/`renderTree` so `renderNode` takes an `idxPath` array and an `opts` carrying `reorderable` plus the current `siblingCount`. Concretely:

```javascript
function controlsHtml(idxPath, isFirst, isLast) {
  const path = idxPath.join('.');
  return `<span class="mb-kb-row-controls">
      <button class="mb-kb-ctl" type="button" data-kb-move-up data-kb-path="${path}" title="Move up"${isFirst ? ' disabled' : ''}><span class="material-symbols-outlined">keyboard_arrow_up</span></button>
      <button class="mb-kb-ctl" type="button" data-kb-move-down data-kb-path="${path}" title="Move down"${isLast ? ' disabled' : ''}><span class="material-symbols-outlined">keyboard_arrow_down</span></button>
      <button class="mb-kb-ctl" type="button" data-kb-move-to data-kb-path="${path}" title="Move to…"><span class="material-symbols-outlined">drive_file_move</span></button>
    </span>`;
}

function renderNode(node, idxPath, opts) {
  const ro = opts.reorderable;
  const pathAttr = ro ? ` data-kb-path="${idxPath.join('.')}"` : '';
  if (node.kind === 'file') {
    const attrPairs = Object.entries(node.attrs ?? {})
      .map(([k, v]) => `${k}="${escapeAttr(v)}"`).join(' ');
    return `<div class="mb-kb-node">
      <button class="mb-kb-node-row" type="button" data-kb-leaf ${attrPairs}${pathAttr}>
        <span class="mb-kb-node-icon material-symbols-outlined">description</span>
        <span class="mb-kb-node-label">${escapeHtml(node.label)}</span>
      </button>${ro ? controlsHtml(idxPath, opts.isFirst, opts.isLast) : ''}
    </div>`;
  }
  const kids = node.children ?? [];
  const childrenHtml = kids
    .map((c, i) => renderNode(c, [...idxPath, i], { ...opts, isFirst: i === 0, isLast: i === kids.length - 1 }))
    .join('');
  return `<div class="mb-kb-node">
    <button class="mb-kb-node-row" type="button" data-kb-section${pathAttr}>
      <span class="mb-kb-node-icon mb-kb-arrow material-symbols-outlined">chevron_right</span>
      <span class="mb-kb-node-label">${escapeHtml(node.label)}</span>
    </button>${ro ? controlsHtml(idxPath, opts.isFirst, opts.isLast) : ''}
    <div class="mb-kb-node-children">${childrenHtml}</div>
  </div>`;
}

export function renderTree(nodes, { emptyMessage = 'Nothing found.', reorderable = false } = {}) {
  if (!nodes || nodes.length === 0) {
    return `<p class="more-buttons-description">${escapeHtml(emptyMessage)}</p>`;
  }
  const inner = nodes
    .map((n, i) => renderNode(n, [i], { reorderable, isFirst: i === 0, isLast: i === nodes.length - 1 }))
    .join('');
  return `
    <input type="search" class="mb-kb-search" placeholder="Search…" aria-label="Search">
    <div class="mb-kb-tree">${inner}</div>
  `;
}
```

> The reorder controls sit OUTSIDE the `.mb-kb-node-row` button (sibling span), so a click on a control is never a click on the row's open/toggle button — no nested-button or propagation issue.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/kbTreeReorderable.test.mjs`
Expected: `3 passed`. Also re-run `node tests/navProjection.test.mjs` and confirm the capture-library caller is unaffected (default path unchanged).

- [ ] **Step 5: Commit**

```bash
git add scripts/kbTree.js tests/kbTreeReorderable.test.mjs
git commit -m "feat(kbtree): reorderable render option (arrows + move + index path)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `kbReorder.js` working-copy controller

Hold the editable tree, apply ops by index-path, track dirty state, build the two-array save payload.

**Files:**
- Create: `scripts/kbReorder.js`
- Modify: `manifest.json` (add `scripts/kbReorder.js` to `web_accessible_resources`)
- Test: `tests/kbReorder.test.mjs` (create)

**Interfaces:**
- Consumes: Task 1 (`valueMapByBase`, `projectTree`, `spliceGuideBlock`, `slugify`), Task 2 (`nodeAtPath`, `moveSibling`, `detachAtPath`, `attachUnderPath`, `attachUnderSegments`).
- Produces a factory `createReorderState({ tree, navItems, draftItems })` returning:
  - `getTree()` — current working-copy nav-node tree.
  - `isDirty()` — `true` once any op has mutated the tree.
  - `move(pathStr, dir)` — `dir` is `'up'|'down'`; applies `moveSibling`, sets dirty if it changed.
  - `moveToPath(pathStr, targetIdxPathStr|null)` — detach the node and attach under an existing section index-path (or top level if `null`/`''`).
  - `moveToSegments(pathStr, segments)` — detach and attach under a (possibly new) slug path.
  - `sectionTargets()` — `[{ pathStr, label }]` for every folder, label = full slash path of display names; used to build the Move… picker.
  - `buildPayload()` — `{ nav, draftNav }` via projection + splice for both arrays.

- [ ] **Step 1: Write the failing test**

Create `tests/kbReorder.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import { createReorderState } from '../scripts/kbReorder.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const navItems = () => ([
  { name: 'Home', value: 'pages/index.md' },
  { name: 'Guides', children: [
    { name: 'Employees', children: [
      { name: 'A', value: 'pages/a.md' },
      { name: 'B', value: 'pages/b.md' },
    ] },
    { name: 'Contractors', children: [
      { name: 'C', value: 'pages/c.md' },
    ] },
  ] },
]);
const draftItems = () => ([
  { name: 'Guides', children: [
    { name: 'Employees', children: [
      { name: 'D draft', value: 'drafts/d.md' },
    ] },
  ] },
]);
// Merged display tree (what the panel renders): live A,B then draft D under Employees.
const tree = () => ([
  { name: 'Guides', children: [
    { name: 'Employees', children: [
      { name: 'A', value: 'pages/a.md' },
      { name: 'B', value: 'pages/b.md' },
      { name: 'D draft', value: 'drafts/d.md' },
    ] },
    { name: 'Contractors', children: [
      { name: 'C', value: 'pages/c.md' },
    ] },
  ] },
]);

test('starts clean', () => {
  const s = createReorderState({ tree: tree(), navItems: navItems(), draftItems: draftItems() });
  assert.equal(s.isDirty(), false);
});

test('move down reorders siblings and marks dirty', () => {
  const s = createReorderState({ tree: tree(), navItems: navItems(), draftItems: draftItems() });
  s.move('0.0.0', 'down');                       // A down past B
  assert.equal(s.isDirty(), true);
  assert.deepEqual(s.getTree()[0].children[0].children.map(n => n.name), ['B', 'A', 'D draft']);
});

test('buildPayload writes nav order, drops draft-only leaf from nav', () => {
  const s = createReorderState({ tree: tree(), navItems: navItems(), draftItems: draftItems() });
  s.move('0.0.0', 'down');                       // A,B → B,A
  const { nav, draftNav } = s.buildPayload();
  const emp = nav[1].children[0];                // Home anchor at [0], Guides at [1]
  assert.equal(nav[0].name, 'Home');             // anchor preserved
  assert.deepEqual(emp.children.map(n => n.value), ['pages/b.md', 'pages/a.md']);
  // draft_nav keeps only the draft member, exact value reused.
  assert.deepEqual(draftNav[0].children[0].children.map(n => n.value), ['drafts/d.md']);
});

test('moveToSegments reparents a leaf into a new section', () => {
  const s = createReorderState({ tree: tree(), navItems: navItems(), draftItems: draftItems() });
  s.moveToSegments('0.0.0', ['guides', 'archive']);  // move A to Guides/Archive
  const { nav } = s.buildPayload();
  const archive = nav[1].children.find(n => n.name === 'Archive');
  assert.ok(archive);
  assert.deepEqual(archive.children.map(n => n.value), ['pages/a.md']);
  // A removed from Employees in nav.
  assert.deepEqual(nav[1].children[0].children.map(n => n.value), ['pages/b.md']);
});

test('sectionTargets lists folders with full-path labels', () => {
  const s = createReorderState({ tree: tree(), navItems: navItems(), draftItems: draftItems() });
  const labels = s.sectionTargets().map(t => t.label);
  assert.ok(labels.includes('Guides'));
  assert.ok(labels.includes('Guides/Employees'));
  assert.ok(labels.includes('Guides/Contractors'));
});

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/kbReorder.test.mjs`
Expected: FAIL — cannot find module `../scripts/kbReorder.js`.

- [ ] **Step 3: Implement `scripts/kbReorder.js`**

```javascript
// scripts/kbReorder.js
// Working-copy controller for KB tree reordering. Holds an editable merged
// nav-node tree, applies index-path move/reparent ops, tracks dirty state, and
// builds the { nav, draftNav } payload by projecting the edited tree onto each
// array's membership (exact values reused; Home/System and non-guide entries
// preserved). Pure — no DOM, no network.
import {
  slugify, valueMapByBase, projectTree, spliceGuideBlock,
  nodeAtPath, moveSibling, detachAtPath, attachUnderPath, attachUnderSegments,
} from './navToml.js';

const parsePath = (s) => String(s).split('.').filter(x => x !== '').map(Number);

export function createReorderState({ tree, navItems, draftItems }) {
  let dirty = false;
  const liveMap = valueMapByBase(navItems);
  const draftMap = valueMapByBase(draftItems);

  const move = (pathStr, dir) => {
    if (moveSibling(tree, parsePath(pathStr), dir === 'up' ? -1 : +1)) dirty = true;
  };

  const moveToPath = (pathStr, targetIdxPathStr) => {
    const node = detachAtPath(tree, parsePath(pathStr));
    if (!node) return;
    const target = targetIdxPathStr ? parsePath(targetIdxPathStr) : null;
    attachUnderPath(tree, target, node);
    dirty = true;
  };

  const moveToSegments = (pathStr, segments) => {
    const node = detachAtPath(tree, parsePath(pathStr));
    if (!node) return;
    attachUnderSegments(tree, segments, node);
    dirty = true;
  };

  const sectionTargets = () => {
    const out = [];
    const walk = (level, idxTrail, labelTrail) => {
      level.forEach((n, i) => {
        if (!n.children) return;
        const idxPath = [...idxTrail, i];
        const label = [...labelTrail, n.name].join('/');
        out.push({ pathStr: idxPath.join('.'), label });
        walk(n.children, idxPath, [...labelTrail, n.name]);
      });
    };
    walk(tree, [], []);
    return out;
  };

  const buildPayload = () => {
    const editedTopSlugs = new Set(
      tree.filter(n => n.children).map(n => slugify(n.name))
    );
    const nav = spliceGuideBlock(navItems, projectTree(tree, liveMap), editedTopSlugs);
    const draftNav = spliceGuideBlock(draftItems, projectTree(tree, draftMap), editedTopSlugs);
    return { nav, draftNav };
  };

  return {
    getTree: () => tree,
    isDirty: () => dirty,
    move, moveToPath, moveToSegments, sectionTargets, buildPayload,
  };
}
```

- [ ] **Step 4: Add the manifest entry**

In `manifest.json`, find the `web_accessible_resources` array's `resources` list (where `scripts/knowledgeBaseManagement.js` is listed) and add `"scripts/kbReorder.js"` and `"scripts/navTree.js"` alongside it (keep alphabetical-ish ordering consistent with neighbours).

- [ ] **Step 5: Run test to verify it passes**

Run: `node tests/kbReorder.test.mjs`
Expected: `6 passed`.

- [ ] **Step 6: Commit**

```bash
git add scripts/kbReorder.js manifest.json tests/kbReorder.test.mjs
git commit -m "feat(kb): reorder working-copy controller + save payload builder

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Wire reorder UI into `knowledgeBaseManagement.js`

Render the Guides panel reorderable, route control clicks to the controller, show the unsaved-changes footer, and commit both blocks in one push.

**Files:**
- Modify: `scripts/knowledgeBaseManagement.js`
- Modify: `config/forms/formsStyling.css` (controls, footer bar, Move… picker)
- (No new test — covered by manual smoke; controller/projection logic is already unit-tested.)

**Interfaces:**
- Consumes: `createReorderState` (Task 4), `renderTree(..., { reorderable: true })` (Task 3), existing `replaceNavBlock`, `parseNavBlock`, `formLoading`, and `githubFetchAndPushFile` (import from `./github.js` — confirm the export name there; it is the same function `guides.js` uses).

- [ ] **Step 1: Hold the controller + raw arrays at render time**

In `renderKnowledgeBaseManagement`, after parsing `nav`/`draftNav` and computing `merged`, create the controller and render reorderable. Replace the `livePanel` block:

```javascript
let reorder = null;
if (livePanel) {
  const guideNav = pruneLeavesByBase(nav.filter(n => !EXCLUDED_SECTIONS.has(n.name)), draftFiles);
  const merged = mergeNavNodes(guideNav, draftNav).filter(n => !EXCLUDED_SECTIONS.has(n.name));
  reorder = createReorderState({ tree: merged, navItems: nav, draftItems: draftNav });
  livePanel.innerHTML =
    renderTree(merged.map(navNodeToKbNode), { emptyMessage: 'No articles found.', reorderable: true })
    + footerBarHtml();
  decorateKbPills(livePanel, draftFiles, navFiles);
}
```

Add a module-level helper:

```javascript
function footerBarHtml() {
  return `<div class="mb-kb-reorder-bar" hidden>
    <span class="mb-kb-reorder-status"><span class="mb-kb-reorder-dot"></span>Unsaved changes</span>
    <span class="mb-kb-reorder-actions">
      <button type="button" class="more-buttons-button secondary" data-kb-reorder-discard>Discard</button>
      <button type="button" class="more-buttons-button" data-kb-reorder-save>Save order</button>
    </span>
  </div>`;
}
```

Import additions at the top: `import { renderTree, applySearch } from './kbTree.js';` (already there) and add `replaceNavBlock` to the `navToml.js` import, `import { createReorderState } from './kbReorder.js';`, and `import { githubFetchAndPushFile } from './github.js';`.

- [ ] **Step 2: Re-render + footer helpers**

Add inside `renderKnowledgeBaseManagement` (closures over `reorder`, `livePanel`, `draftFiles`, `navFiles`):

```javascript
const rerenderGuides = () => {
  livePanel.innerHTML =
    renderTree(reorder.getTree().map(navNodeToKbNode), { emptyMessage: 'No articles found.', reorderable: true })
    + footerBarHtml();
  decorateKbPills(livePanel, draftFiles, navFiles);
  const bar = livePanel.querySelector('.mb-kb-reorder-bar');
  if (bar) bar.hidden = !reorder.isDirty();
};
```

- [ ] **Step 3: Route control clicks**

Extend the existing `formEl.parentElement?.addEventListener('click', …)` handler. BEFORE the `data-kb-section`/`data-kb-leaf` branches, add:

```javascript
const up = e.target.closest('[data-kb-move-up]');
const down = e.target.closest('[data-kb-move-down]');
const moveTo = e.target.closest('[data-kb-move-to]');
if (up || down) {
  const el = up || down;
  reorder.move(el.dataset.kbPath, up ? 'up' : 'down');
  rerenderGuides();
  return;
}
if (moveTo) {
  openMoveToPicker(moveTo, reorder, rerenderGuides);
  return;
}
if (e.target.closest('[data-kb-reorder-discard]')) {
  await getFormAction('openKnowledgeBaseManagement')();   // reload from toml
  return;
}
if (e.target.closest('[data-kb-reorder-save]')) {
  await saveReorder(reorder, formEl);
  return;
}
```

> Note: the `data-kb-section`/`data-kb-leaf` branches still work because the controls live OUTSIDE the row buttons; a click on a control matches the guards above and returns before reaching them.

- [ ] **Step 4: Move… picker + save**

Add these module-level functions:

```javascript
// Build a small popover anchored to the Move… button: existing sections + a
// "new path" input. Calls reorder.moveToPath / moveToSegments then re-renders.
function openMoveToPicker(anchorBtn, reorder, rerender) {
  document.querySelector('.mb-kb-move-pop')?.remove();
  const srcPath = anchorBtn.dataset.kbPath;
  const targets = reorder.sectionTargets()
    .filter(t => t.pathStr !== srcPath);   // can't move into itself
  const pop = document.createElement('div');
  pop.className = 'mb-kb-move-pop';
  pop.innerHTML = `
    <div class="mb-kb-move-title">Move to…</div>
    <button type="button" class="mb-kb-move-opt" data-target="">— Top level —</button>
    ${targets.map(t => `<button type="button" class="mb-kb-move-opt" data-target="${t.pathStr}">${t.label}</button>`).join('')}
    <div class="mb-kb-move-new">
      <input type="text" class="mb-kb-move-input" placeholder="Type a new path… e.g. guides/contractors" />
    </div>`;
  anchorBtn.closest('.mb-kb-node').appendChild(pop);

  pop.addEventListener('click', e => {
    const opt = e.target.closest('.mb-kb-move-opt');
    if (!opt) return;
    reorder.moveToPath(srcPath, opt.dataset.target || null);
    pop.remove();
    rerender();
  });
  pop.querySelector('.mb-kb-move-input').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const segments = e.target.value.split('/').map(s => s.trim()).filter(Boolean);
    if (segments.length) reorder.moveToSegments(srcPath, segments);
    pop.remove();
    rerender();
  });
  // Dismiss on outside click.
  setTimeout(() => document.addEventListener('click', function dismiss(ev) {
    if (!pop.contains(ev.target) && ev.target !== anchorBtn) {
      pop.remove(); document.removeEventListener('click', dismiss);
    }
  }), 0);
}

// Commit both nav and draft_nav in a single zensical.toml push, behind the veil.
async function saveReorder(reorder, formEl) {
  const { nav, draftNav } = reorder.buildPayload();
  formLoading.show();
  try {
    await githubFetchAndPushFile('zensical.toml', () => {}, md => {
      const out1 = replaceNavBlock(md, 'nav', nav);
      return replaceNavBlock(out1, 'draft_nav', draftNav);
    });
    await getFormAction('openKnowledgeBaseManagement')();  // reload fresh tree
  } catch (e) {
    alert('Failed to save order: ' + e.message);
  } finally {
    formLoading.dismiss();
  }
}
```

> `getFormAction('openKnowledgeBaseManagement')()` re-enters the render path, which re-fetches `zensical.toml` and rebuilds the tree + controller from the just-saved state, clearing dirty.

- [ ] **Step 5: CSS**

Append to `config/forms/formsStyling.css`:

```css
/* KB tree reorder controls */
.mb-kb-node { position: relative; }
.mb-kb-row-controls { display: inline-flex; gap: 2px; margin-left: 6px; vertical-align: middle; }
.mb-kb-ctl { display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border: none; background: transparent; border-radius: 6px;
  cursor: pointer; color: var(--mb-muted, #667); }
.mb-kb-ctl:hover { background: rgba(0,0,0,0.06); }
.mb-kb-ctl:disabled { opacity: 0.3; cursor: default; }
.mb-kb-ctl .material-symbols-outlined { font-size: 18px; }

.mb-kb-reorder-bar { display: flex; align-items: center; justify-content: space-between;
  gap: 12px; margin-top: 12px; padding: 10px 14px; border-radius: 10px;
  background: rgba(0,0,0,0.04); }
.mb-kb-reorder-status { display: inline-flex; align-items: center; gap: 8px; font-size: 0.9em; }
.mb-kb-reorder-dot { width: 8px; height: 8px; border-radius: 50%; background: #e0a106; }
.mb-kb-reorder-actions { display: inline-flex; gap: 8px; }

.mb-kb-move-pop { position: absolute; right: 0; z-index: 20; min-width: 240px;
  background: var(--mb-surface, #fff); border: 1px solid rgba(0,0,0,0.12);
  border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,0.18); padding: 6px; }
.mb-kb-move-title { font-size: 0.8em; color: var(--mb-muted, #667); padding: 4px 8px; }
.mb-kb-move-opt { display: block; width: 100%; text-align: left; border: none;
  background: transparent; padding: 7px 8px; border-radius: 6px; cursor: pointer; }
.mb-kb-move-opt:hover { background: rgba(0,0,0,0.06); }
.mb-kb-move-new { padding: 6px; }
.mb-kb-move-input { width: 100%; box-sizing: border-box; }
```

> If `formsStyling.css` defines theme variables under different names, reuse the existing ones rather than the `var(... , fallback)` defaults shown here — check the neighbouring rules.

- [ ] **Step 6: Manual smoke test (Chrome for Testing, GitHub-connected)**

Reload the extension at `chrome://extensions` (manifest changed in Task 4). Open Knowledge Base → Guides. Verify:
- Each guide/folder row shows up/down arrows + a Move… button; ends are disabled correctly.
- Arrow clicks reorder instantly; the footer bar appears with "Unsaved changes".
- Move… lists existing sections and a new-path input; both relocate the row.
- "Save order" produces ONE `zensical.toml` commit; the tree reloads in the new order and the footer disappears.
- "Discard" reverts to the saved order.
- Clicking a guide *label* still opens its entry; clicking a folder label still toggles collapse.

- [ ] **Step 7: Commit**

```bash
git add scripts/knowledgeBaseManagement.js config/forms/formsStyling.css
git commit -m "feat(kb): in-tree reorder + move UI with batched single-commit save

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Remove the Path field from edit page settings

The tree's Move… is now the only place to relocate an existing guide. Create-guide keeps its own path picker (untouched).

**Files:**
- Modify: `config/forms/editPageSettings.html`
- Modify: `scripts/guides.js` (`openEditPageSettings` ~1472-1509, `submitEditPageSettings` ~1511-1585)

**Interfaces:**
- Consumes: nothing new.
- Produces: page settings form with no `[name="path"]`; no `draft_nav` write on submit.

- [ ] **Step 1: Remove the Path markup**

In `config/forms/editPageSettings.html`, delete the entire first `more-buttons-form-group` (the `<label>Path</label>` block with `.mb-path-field`, lines 4-10). Leave Icon, Hide elements, and the actions.

- [ ] **Step 2: Remove the path prefill in `openEditPageSettings`**

In `scripts/guides.js`, in the `openEditPageSettings` action: delete the `let pathValue = '';` … `catch { … }` block that reads `zensical.toml` and `findPathByValueSlug`, and remove `path: pathValue,` from the `moreButtonsEditPageSettings` storage object. Also remove the suffix-setting lines that target `[data-path-suffix]` (the suffix span is gone with the field):

Remove:
```javascript
    let pathValue = '';
    try {
      const tomlText = await readRepoText('zensical.toml');
      const draftItems = parseNavBlock(tomlText, 'draft_nav').items;
      const loc = findPathByValueSlug(draftItems, slug);
      pathValue = (loc?.segments ?? []).join('/');
    } catch { /* best-effort prefill; empty path = root */ }
```
and the `path: pathValue,` line, and:
```javascript
  const suffix = formEl.querySelector('[data-path-suffix]');
  if (suffix) suffix.textContent = `/${slug}.md`;
```

> `slug` may now be unused in `openEditPageSettings`; if so, remove its declaration too (`const slug = guideBaseName(currentGuide.livePath);`) to avoid a lint warning. Keep it only if still referenced.

- [ ] **Step 3: Remove the path write in `submitEditPageSettings`**

In `submitEditPageSettings`, delete the entire `try { … } catch { … }` block that reads `[name="path"]`, calls `setPathByValueSlug`, and pushes `draft_nav` (the block beginning `// Path lives in zensical.toml (draft_nav)…` through its `catch`). The icon/hide `mergeSave` above it stays.

- [ ] **Step 4: Prune now-unused imports**

Check whether `setPathByValueSlug`, `replaceNavBlock`, `draftNavValueOf`, `findPathByValueSlug`, `parseNavBlock` are still used elsewhere in `guides.js` (grep). Remove from the import only those no longer referenced anywhere in the file. (`parseNavBlock`/`replaceNavBlock` are likely still used by create-guide — keep those.)

Run: `grep -n "setPathByValueSlug\|draftNavValueOf\|findPathByValueSlug" scripts/guides.js`
Remove any import that returns zero remaining references.

- [ ] **Step 5: Manual smoke test**

Reload extension. Open a guide → Page settings. Verify: no Path field; Icon and Hide toggles still save (green "Draft saved"); no console error about a missing `[name="path"]`. Then relocate the same guide via the tree's Move… and confirm it works.

- [ ] **Step 6: Commit**

```bash
git add config/forms/editPageSettings.html scripts/guides.js
git commit -m "refactor(kb): drop Path field from page settings (tree Move… owns moves)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Reorder guides + folders among siblings → Task 2 (`moveSibling`), Task 3 (arrows), Task 5 (wiring). ✓
- Move across sections incl. create-new-path → Task 2 (`attachUnderSegments`), Task 4 (`moveToSegments`/`moveToPath`), Task 5 (Move… picker). ✓
- Batched single commit → Task 4 (`buildPayload`), Task 5 (`saveReorder`, one `githubFetchAndPushFile`). ✓
- nav authority + draft mirror, exact values, anchors preserved, no merge change → Task 1 (`projectTree`/`spliceGuideBlock` + tests). ✓
- Centered loading veil → Task 5 (`formLoading`). ✓
- Remove Path field; keep create-guide picker → Task 6 (only edits `editPageSettings`, leaves `createGuide`). ✓
- New scripts in manifest → Task 4 Step 4 (`kbReorder.js`, `navTree.js`). ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. The CSS variable fallbacks and the manifest/import grep steps are explicit verification actions, not placeholders.

**Type consistency:** `pathStr` (dot-joined) is produced by `data-kb-path` (Task 3) and consumed by `createReorderState.move/moveToPath/moveToSegments` (Task 4) via `parsePath`. `buildPayload` returns `{ nav, draftNav }`, consumed by `saveReorder` (Task 5). `projectTree(edited, valueMap)`, `spliceGuideBlock(original, projected, editedTopSlugs)`, `valueMapByBase(nodes)` signatures match between Task 1 definitions and Task 4 usage. `navNodeToKbNode` (existing) feeds `renderTree` in Task 5.

One spec nuance carried forward: a draft-only page under a *guide* section is always present in the merged display tree (the merge never prunes draft leaves), so projecting the edited tree onto `draft_nav` never silently drops it; draft entries under `Home`/`System` are preserved as non-managed anchors. Confirm this holds against the real `zensical.toml` during Task 5 Step 6.
