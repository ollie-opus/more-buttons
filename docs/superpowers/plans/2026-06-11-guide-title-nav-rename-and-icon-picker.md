# Guide Title → Nav Rename + Icon Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task (execution mode chosen by the user on 2026-06-11: Subagent-Driven — fresh subagent per task, review between tasks). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a guide's H1 title is saved, also rename its display name in `nav`/`draft_nav` in `zensical.toml`; add an Icon input (searchable lucide picker with SVG previews) that reads/writes the `icon:` frontmatter key at the top of the guide's markdown file.

**Architecture:** Two pure-function modules carry the logic (`renameByValue` in `scripts/navToml.js`; new `scripts/frontmatter.js`), unit-tested with the repo's plain-node test convention. The Edit-section form (`editGuideSection`) gains a hidden Icon row shown only for H1 edits; persistence rides the existing `mergeSave` pipeline; the nav rename is an extra `zensical.toml` push after a successful H1 markdown save. The picker UI (`scripts/iconPicker.js`) filters a bundled name list (`config/lucideIcons.json`, generated from the zensical venv) and previews SVGs from jsdelivr.

**Tech Stack:** Chrome MV3 extension, ES modules, `node:assert/strict` tests run with plain `node`, GitHub contents API via existing `githubFetchAndPushFile`.

**Spec:** `docs/superpowers/specs/2026-06-11-guide-title-nav-rename-and-icon-picker-design.md`

**Conventions that bite (from project memory):**
- Every new `scripts/*.js` AND every runtime-fetched `config/*.json` must be added **individually** to `web_accessible_resources` in `manifest.json`. Omission → "Failed to fetch dynamically imported module". Same error with a correct manifest = stale extension → reload at `chrome://extensions`.
- Overlay form label+input rows are horizontal: `.more-buttons-form-group` grid, label left.
- Tests: `tests/<name>.test.mjs`, `node:assert/strict`, local `test(name, fn)` helper, `console.log(`\n${passed} passed`)` at the end. Run with `node tests/<name>.test.mjs`.

---

### Task 1: `renameByValue` in navToml.js

**Files:**
- Modify: `scripts/navToml.js` (append after `findPathOfValue`, ~line 135)
- Test: `tests/navToml-rename.test.mjs` (create)

- [x] **Step 1: Write the failing test**

Create `tests/navToml-rename.test.mjs`:

```js
import assert from 'node:assert/strict';
import { parseNavBlock, replaceNavBlock, renameByValue } from '../scripts/navToml.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const TOML = `site_name = "Opus KB"

nav = [
  {"Home" = "index.md"},
  {"Guides" = [
    {"Adding an Employee" = "pages/adding-employee.md"},
    {"Manager Steps" = [
      {"Approvals" = "pages/approvals.md"}
    ]}
  ]}
]

draft_nav = [
  {"Guides" = [
    {"Adding an Employee" = "pages/adding-employee.md"}
  ]}
]
`;

test('renames a top-level leaf', () => {
  const { items } = parseNavBlock(TOML, 'nav');
  const changed = renameByValue(items, 'index.md', 'Welcome');
  assert.equal(changed, 1);
  assert.equal(items[0].name, 'Welcome');
  assert.equal(items[0].value, 'index.md');
});

test('renames a nested leaf, preserving tree order', () => {
  const { items } = parseNavBlock(TOML, 'nav');
  const changed = renameByValue(items, 'pages/approvals.md', 'Approving Things');
  assert.equal(changed, 1);
  // Order intact: Home first, then Guides → [leaf, Manager Steps].
  assert.equal(items[0].name, 'Home');
  assert.equal(items[1].name, 'Guides');
  assert.equal(items[1].children[0].name, 'Adding an Employee');
  assert.equal(items[1].children[1].name, 'Manager Steps');
  assert.equal(items[1].children[1].children[0].name, 'Approving Things');
});

test('nav and draft_nav blocks rename independently on the same value', () => {
  const nav = parseNavBlock(TOML, 'nav').items;
  const draft = parseNavBlock(TOML, 'draft_nav').items;
  assert.equal(renameByValue(nav, 'pages/adding-employee.md', 'Adding Employees'), 1);
  assert.equal(renameByValue(draft, 'pages/adding-employee.md', 'Adding Employees'), 1);
  assert.equal(nav[1].children[0].name, 'Adding Employees');
  assert.equal(draft[0].children[0].name, 'Adding Employees');
});

test('returns 0 when the value is not present', () => {
  const { items } = parseNavBlock(TOML, 'nav');
  assert.equal(renameByValue(items, 'pages/nope.md', 'Whatever'), 0);
});

test('returns 0 when the name already matches (no churn → caller skips the toml write)', () => {
  const { items } = parseNavBlock(TOML, 'nav');
  assert.equal(renameByValue(items, 'pages/approvals.md', 'Approvals'), 0);
});

test('round-trips through replaceNavBlock', () => {
  const { items } = parseNavBlock(TOML, 'nav');
  renameByValue(items, 'pages/approvals.md', 'Approving Things');
  const out = replaceNavBlock(TOML, 'nav', items);
  const reread = parseNavBlock(out, 'nav').items;
  assert.equal(reread[1].children[1].children[0].name, 'Approving Things');
  // draft_nav untouched.
  assert.equal(parseNavBlock(out, 'draft_nav').items[0].children[0].name, 'Adding an Employee');
});

console.log(`\n${passed} passed`);
```

- [x] **Step 2: Run test to verify it fails**

Run: `node tests/navToml-rename.test.mjs`
Expected: FAIL — `SyntaxError: The requested module '../scripts/navToml.js' does not provide an export named 'renameByValue'`

- [x] **Step 3: Write minimal implementation**

Append to `scripts/navToml.js` (after `findPathOfValue`):

```js
// Rename every leaf whose value === value to newName. Returns the number of
// leaves actually changed (an already-matching name doesn't count, so callers
// can skip the toml write entirely when nothing moved). Renames in place —
// unlike removeByValue + insertPath, which would reorder the tree. Mutates.
export function renameByValue(nodes, value, newName) {
  let changed = 0;
  const recurse = (level) => {
    for (const n of level) {
      if (n.children) recurse(n.children);
      else if (n.value === value && n.name !== newName) { n.name = newName; changed++; }
    }
  };
  recurse(nodes);
  return changed;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node tests/navToml-rename.test.mjs`
Expected: `6 passed`

- [x] **Step 5: Run the existing suite to check nothing broke**

Run: `for t in tests/*.test.mjs; do node "$t" > /dev/null || echo "FAIL: $t"; done`
Expected: no `FAIL:` lines

- [x] **Step 6: Commit**

```bash
git add scripts/navToml.js tests/navToml-rename.test.mjs
git commit -m "feat(navToml): renameByValue — in-place leaf rename preserving tree order"
```

---

### Task 2: Wire title save → nav/draft_nav rename

**Files:**
- Modify: `scripts/guides.js:21` (import) and `scripts/guides.js:1178-1209` (`saveSectionForComponent` edit path)

- [x] **Step 1: Add `renameByValue` to the navToml import**

In `scripts/guides.js` line 21, change:

```js
import { parseNavBlock, replaceNavBlock, insertPath, removeByValue, findPathOfValue, slugify } from './navToml.js';
```

to:

```js
import { parseNavBlock, replaceNavBlock, insertPath, removeByValue, findPathOfValue, renameByValue, slugify } from './navToml.js';
```

- [x] **Step 2: Capture mergeSave's resolved values and push the rename**

In `saveSectionForComponent` (guides.js ~line 1178), change `await mergeSave({` to:

```js
  const resolved = await mergeSave({
```

(the rest of the call is unchanged), then insert between the end of the `mergeSave` call (`});`, ~line 1208) and the final `return { container: ... }` line:

```js
  // The H1 title is also the guide's display name in zensical.toml — keep
  // nav and draft_nav in step. Skipped when the title didn't change, when
  // the resolver was cancelled (resolved == null), and for H2/H3 edits.
  if (resolved && section.level === 1) {
    const newTitle = (resolved.sectionTitle ?? '').trim();
    if (newTitle && newTitle !== section.title) {
      onProgress('Updating navigation…');
      const value = navValueOf(currentGuide.livePath);
      await githubFetchAndPushFile('zensical.toml', onProgress, md => {
        let out = md;
        for (const key of ['nav', 'draft_nav']) {
          const { items } = parseNavBlock(out, key);
          // Only reserialize a block that actually changed — replaceNavBlock
          // normalizes formatting, which would otherwise make an empty-diff
          // commit. (githubFetchAndPushFile also skips byte-identical output.)
          if (renameByValue(items, value, newTitle)) out = replaceNavBlock(out, key, items);
        }
        return out;
      });
    }
  }
```

Notes for the implementer:
- `section` was read fresh at guides.js:1151-1152 just before `mergeSave`, so `section.title` is the pre-save title — comparing it to the resolved title detects a real change.
- `navValueOf` (guides.js:106) maps `docs/pages/foo.md` → `pages/foo.md`, the leaf value used by **both** `nav` and `draft_nav`.
- `mergeSave` returns the resolved values object, or `null` if the user cancelled the conflict resolver (`mergeSave.js:52`).

- [x] **Step 3: Sanity-check the suite still passes**

Run: `for t in tests/*.test.mjs; do node "$t" > /dev/null || echo "FAIL: $t"; done`
Expected: no `FAIL:` lines

- [x] **Step 4: Commit**

```bash
git add scripts/guides.js
git commit -m "feat(guides): H1 title save renames the guide in nav/draft_nav (zensical.toml)"
```

---

### Task 3: `scripts/frontmatter.js` — read/write the icon key

**Files:**
- Create: `scripts/frontmatter.js`
- Modify: `manifest.json` (web_accessible_resources)
- Test: `tests/frontmatter.test.mjs` (create)

- [x] **Step 1: Write the failing test**

Create `tests/frontmatter.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFrontmatterIcon, writeFrontmatterIcon } from '../scripts/frontmatter.js';
import { buildSection, replaceSectionByUUID } from '../scripts/sections.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const NO_FM = `# Adding an Employee
<span data-uuid="T1" style="display:none"></span>

Body text.
`;

const WITH_ICON = `---
icon: lucide/user-plus
---

${NO_FM}`;

const MULTI_KEY = `---
icon: lucide/user-plus
hide:
  - toc
---

${NO_FM}`;

// ── read ─────────────────────────────────────────────────────────────────────

test('read: no frontmatter → empty string', () => {
  assert.equal(readFrontmatterIcon(NO_FM), '');
});

test('read: returns the icon value', () => {
  assert.equal(readFrontmatterIcon(WITH_ICON), 'lucide/user-plus');
});

test('read: block without an icon key → empty string', () => {
  assert.equal(readFrontmatterIcon(`---\nhide:\n  - toc\n---\n\n${NO_FM}`), '');
});

// ── write ────────────────────────────────────────────────────────────────────

test('write: creates a block when the file has none', () => {
  const out = writeFrontmatterIcon(NO_FM, 'lucide/users');
  assert.equal(out, `---\nicon: lucide/users\n---\n\n${NO_FM}`);
  assert.equal(readFrontmatterIcon(out), 'lucide/users');
});

test('write: updates an existing icon line in place', () => {
  const out = writeFrontmatterIcon(WITH_ICON, 'lucide/users');
  assert.equal(readFrontmatterIcon(out), 'lucide/users');
  assert.match(out, /^---\nicon: lucide\/users\n---\n/);
});

test('write: preserves other frontmatter keys', () => {
  const out = writeFrontmatterIcon(MULTI_KEY, 'lucide/users');
  assert.match(out, /hide:\n  - toc/);
  assert.equal(readFrontmatterIcon(out), 'lucide/users');
});

test('write: adds an icon line to a block that lacks one', () => {
  const out = writeFrontmatterIcon(`---\nhide:\n  - toc\n---\n\n${NO_FM}`, 'lucide/users');
  assert.equal(readFrontmatterIcon(out), 'lucide/users');
  assert.match(out, /hide:\n  - toc/);
});

test('write: clearing removes the line but keeps a block with other keys', () => {
  const out = writeFrontmatterIcon(MULTI_KEY, '');
  assert.equal(readFrontmatterIcon(out), '');
  assert.match(out, /^---\nhide:\n  - toc\n---\n/);
});

test('write: clearing the only key removes the whole block', () => {
  const out = writeFrontmatterIcon(WITH_ICON, '');
  assert.equal(out, NO_FM);
});

test('write: clearing a file with no frontmatter is a no-op', () => {
  assert.equal(writeFrontmatterIcon(NO_FM, ''), NO_FM);
});

// ── interplay with section edits ─────────────────────────────────────────────

test('frontmatter survives an H1 title save (replaceSectionByUUID)', () => {
  const updated = replaceSectionByUUID(WITH_ICON, 'T1', buildSection(1, 'New Title', 'T1', 'Body text.'));
  assert.match(updated, /^---\nicon: lucide\/user-plus\n---\n/);
  assert.match(updated, /# New Title/);
});

test('writeFrontmatterIcon composes after replaceSectionByUUID (the build() order)', () => {
  let updated = replaceSectionByUUID(WITH_ICON, 'T1', buildSection(1, 'New Title', 'T1', 'Body text.'));
  updated = writeFrontmatterIcon(updated, 'lucide/users');
  assert.equal(readFrontmatterIcon(updated), 'lucide/users');
  assert.match(updated, /# New Title/);
});

console.log(`\n${passed} passed`);
```

- [x] **Step 2: Run test to verify it fails**

Run: `node tests/frontmatter.test.mjs`
Expected: FAIL — `Cannot find module .../scripts/frontmatter.js`

- [x] **Step 3: Write the implementation**

Create `scripts/frontmatter.js`:

```js
// scripts/frontmatter.js
// Read/write the `icon:` key in a leading YAML frontmatter block:
//
//   ---
//   icon: lucide/user-plus
//   ---
//
// Pure string functions — no network, no DOM. Only the icon line is owned by
// these helpers; every other line in the block passes through untouched.
// (A degenerate empty block `---\n---` is treated as no frontmatter.)

const FM_RE = /^---\n([\s\S]*?)\n---\n?/;
const ICON_LINE_RE = /^icon:[ \t]*(\S.*?)[ \t]*$/m;

/** @returns {string} the icon value, or '' when absent. */
export function readFrontmatterIcon(md) {
  const m = FM_RE.exec(md);
  if (!m) return '';
  const icon = ICON_LINE_RE.exec(m[1]);
  return icon ? icon[1] : '';
}

/**
 * Set, replace, or (icon = '') remove the icon line. Creates the block when
 * needed; drops it when removal leaves it empty.
 * @returns {string} updated markdown
 */
export function writeFrontmatterIcon(md, icon) {
  const value = (icon ?? '').trim();
  const m = FM_RE.exec(md);

  if (!m) {
    if (!value) return md;
    return `---\nicon: ${value}\n---\n\n${md}`;
  }

  const lines = m[1].split('\n');
  const idx = lines.findIndex(l => /^icon:/.test(l));

  if (value) {
    if (idx === -1) lines.unshift(`icon: ${value}`);
    else lines[idx] = `icon: ${value}`;
  } else {
    if (idx === -1) return md;
    lines.splice(idx, 1);
    if (lines.every(l => l.trim() === '')) {
      // Block emptied — remove it and the blank separator line it owned.
      let rest = md.slice(m[0].length);
      if (rest.startsWith('\n')) rest = rest.slice(1);
      return rest;
    }
  }

  return `---\n${lines.join('\n')}\n---\n` + md.slice(m[0].length);
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node tests/frontmatter.test.mjs`
Expected: `12 passed`

- [x] **Step 5: Add the manifest entry**

In `manifest.json`, in the first `web_accessible_resources` block's `resources` array, after `"scripts/mergeSave.js"` add:

```json
        "scripts/mergeSave.js",
        "scripts/frontmatter.js"
```

(i.e. append `"scripts/frontmatter.js"` as a new last entry — mind the comma on the previous line.)

- [x] **Step 6: Run the whole suite**

Run: `for t in tests/*.test.mjs; do node "$t" > /dev/null || echo "FAIL: $t"; done`
Expected: no `FAIL:` lines

- [x] **Step 7: Commit**

```bash
git add scripts/frontmatter.js tests/frontmatter.test.mjs manifest.json
git commit -m "feat(frontmatter): read/write the icon key in leading YAML frontmatter"
```

---

### Task 4: Icon field in the form — persistence wiring (plain text input first)

**Files:**
- Modify: `config/forms/editGuideSection.html` (new row above Title)
- Modify: `scripts/guides.js` — imports (~line 32), `openEditGuideSection` (lines 543-601), `saveSectionForComponent` (lines 1183-1207)

- [x] **Step 1: Add the Icon row to the form HTML**

In `config/forms/editGuideSection.html`, insert between the section-parent group (ends line 7) and the Title group (starts line 9):

```html
  <div class="more-buttons-form-group" data-section-icon-row style="display: none">
    <label class="more-buttons-label">Icon</label>
    <input type="text" name="sectionIcon" placeholder="Search lucide icons…" autocomplete="off" />
  </div>
```

Hidden by default — create mode and H2/H3 edits never show it (frontmatter is per-file, so only the H1 owns it).

- [x] **Step 2: Import the frontmatter helpers in guides.js**

Near the other script imports at the top of `scripts/guides.js` (after the `./mergeSave.js` import or alongside the admonitions import at line 32), add:

```js
import { readFrontmatterIcon, writeFrontmatterIcon } from './frontmatter.js';
```

- [x] **Step 3: Seed the icon value when opening an H1 edit**

In `openEditGuideSection` (guides.js:560-568), extend the storage seed object:

```js
  if (!isFormReplay()) {
    await chrome.storage.local.set({
      moreButtonsEditGuideSection: {
        sectionTitle: section.title,
        sectionDescription: description,
        sectionParent: parentDefault,
        sectionIcon: section.level === 1 ? readFrontmatterIcon(draftMarkdown) : '',
      },
    });
  }
```

(The `: ''` arm matters: the storage key is shared across opens, so an H2 edit must not inherit a stale icon from a previous H1 edit.)

- [x] **Step 4: Show the row for H1 edits**

In the same function, extend the level-1 block (guides.js:587-590):

```js
  // Title sections: hide parent dropdown + Delete; show the Icon row (the
  // icon lives in the file's frontmatter, which only the H1 owns).
  if (section.level === 1) {
    formEl.querySelector('[data-section-parent-row]')?.style.setProperty('display', 'none');
    formEl.parentElement?.querySelector('[data-delete-section-btn]')?.style.setProperty('display', 'none');
    formEl.querySelector('[data-section-icon-row]')?.style.removeProperty('display');
  }
```

- [x] **Step 5: Add the field to the mergeSave pipeline**

In `saveSectionForComponent`:

a) fieldSpecs (guides.js:1183-1187) — include `sectionIcon` only for H1 edits, so a hidden empty input on H2/H3 never participates in merging:

```js
    fieldSpecs: [
      { name: 'sectionTitle', type: 'scalar', label: 'Title' },
      ...(section.level === 1 ? [{ name: 'sectionIcon', type: 'scalar', label: 'Icon' }] : []),
      { name: 'sectionDescription', type: 'scalar', label: 'Description' },
      { name: 'componentOrder', type: 'orderedUuidList', label: 'Component order' },
    ],
```

b) readFresh (guides.js:1188-1197) — add one line to the returned object:

```js
      return {
        sectionTitle: sec?.title ?? '',
        sectionIcon: readFrontmatterIcon(md),
        sectionDescription: parseComponents(readSectionDescription(md, editUuid).descriptionMarkdown ?? '', GUIDE_ADMONITION_TYPES_RE).description ?? '',
        componentOrder: components.map(uuidOfComponent).join(','),
      };
```

c) build (guides.js:1198-1207) — apply the icon after the section replacement, before the `parentChanged` move:

```js
    build: (md, resolved) => {
      const sec = locateSectionByUUID(md, editUuid);
      if (!sec) throw new Error('Section no longer exists.');
      const { components } = readContainerComponents(md, { kind: 'guide-section', uuid: editUuid });
      const ordered = reorderComponents(components, (resolved.componentOrder ?? '').split(',').filter(Boolean));
      const newBody = buildComponentBody(null, (resolved.sectionDescription ?? '').trim(), ordered);
      let updated = replaceSectionByUUID(md, editUuid, buildSection(sec.level, (resolved.sectionTitle ?? '').trim(), editUuid, newBody));
      if (sec.level === 1) updated = writeFrontmatterIcon(updated, (resolved.sectionIcon ?? '').trim());
      if (parentChanged) updated = moveSectionToParent(updated, editUuid, requestedParent);
      return updated;
    },
```

Why this is all that's needed: the opener's storage seed → form.js hydration fills the input; `_initialSnapshot` (form.js:1120) then includes `sectionIcon`, so the dirty guard and merge baseline work; `mergeSave`'s `rehydrateFields` pushes the merged value back after save.

- [x] **Step 6: Run the suite**

Run: `for t in tests/*.test.mjs; do node "$t" > /dev/null || echo "FAIL: $t"; done`
Expected: no `FAIL:` lines

- [x] **Step 7: Commit**

```bash
git add config/forms/editGuideSection.html scripts/guides.js
git commit -m "feat(guides): Icon field on H1 edits — frontmatter icon read/written via mergeSave"
```

---

### Task 5: Bundled lucide name list + regeneration tool

**Files:**
- Create: `tools/regen-lucide-icons.sh`
- Create: `config/lucideIcons.json` (generated)
- Modify: `manifest.json`

- [x] **Step 1: Write the regeneration script**

Create `tools/regen-lucide-icons.sh`:

```bash
#!/usr/bin/env bash
# Regenerate config/lucideIcons.json from the lucide icon set bundled with the
# zensical install in the opus-knowledge-base repo. Run after a zensical
# upgrade so the picker offers exactly the icons the site build can resolve.
#
# Usage: tools/regen-lucide-icons.sh [path-to-lucide-icons-dir]
set -euo pipefail

DEFAULT_DIR="$HOME/Desktop/stuff/opus-knowledge-base/.venv/lib/python3.14/site-packages/zensical/templates/.icons/lucide"
ICONS_DIR="${1:-$DEFAULT_DIR}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/config/lucideIcons.json"

ls "$ICONS_DIR" | grep '\.svg$' | sed 's/\.svg$//' | sort | python3 -c '
import json, sys
names = [line.strip() for line in sys.stdin if line.strip()]
json.dump(names, open(sys.argv[1], "w"))
print(f"Wrote {len(names)} icon names")
' "$OUT"
echo "→ $OUT"
```

- [x] **Step 2: Make it executable and run it**

```bash
chmod +x tools/regen-lucide-icons.sh
tools/regen-lucide-icons.sh
```

Expected output: `Wrote 1912 icon names` (1913 dir entries minus the LICENSE file), then the output path.

- [x] **Step 3: Spot-check the JSON**

Run: `python3 -c "import json; n = json.load(open('config/lucideIcons.json')); print(len(n), n[:3], 'user-plus' in n)"`
Expected: `1912 ['a-arrow-down', 'a-arrow-up', 'a-large-small'] True`

- [x] **Step 4: Add the manifest entry**

In `manifest.json`, in the first `web_accessible_resources` block, after `"config/labelColours.json"` add:

```json
        "config/labelColours.json",
        "config/lucideIcons.json",
```

- [x] **Step 5: Commit**

```bash
git add tools/regen-lucide-icons.sh config/lucideIcons.json manifest.json
git commit -m "feat(config): bundle lucide icon name list + regeneration tool"
```

---

### Task 6: Icon picker combobox (search + SVG previews)

**Files:**
- Create: `scripts/iconPicker.js`
- Modify: `manifest.json`
- Modify: `config/forms/formsStyling.css` (append)
- Modify: `scripts/guides.js` (import + attach in `openEditGuideSection`)

- [x] **Step 1: Create `scripts/iconPicker.js`**

```js
// scripts/iconPicker.js
// Type-to-search combobox for lucide icon names on a plain text input.
// Names come from the bundled config/lucideIcons.json (generated from the
// zensical install — see tools/regen-lucide-icons.sh). Previews are lucide
// SVGs fetched lazily from jsdelivr and INLINED (inline SVG is exempt from
// the page's img-src CSP; jsdelivr serves CORS *). Selecting a row writes
// `lucide/<name>` into the input. If the name list fails to load, the input
// simply stays a plain text input — saving still works.

const MAX_RESULTS = 30;
const CDN = 'https://cdn.jsdelivr.net/npm/lucide-static/icons/';

let namesPromise = null;
function loadNames() {
  namesPromise ??= fetch(chrome.runtime.getURL('config/lucideIcons.json'))
    .then(r => r.json())
    .catch(() => null);
  return namesPromise;
}

// name → Promise<string> ('' = fetch failed; that row just shows no preview)
const svgCache = new Map();
function fetchSvg(name) {
  if (!svgCache.has(name)) {
    svgCache.set(name, fetch(`${CDN}${encodeURIComponent(name)}.svg`)
      .then(r => (r.ok ? r.text() : ''))
      .catch(() => ''));
  }
  return svgCache.get(name);
}

// Prefix matches outrank substring matches; `lucide/` is ignored while typing
// so a saved value like "lucide/user-plus" still filters sensibly on refocus.
function rankMatches(names, query) {
  const q = query.toLowerCase().trim().replace(/^lucide\//, '');
  if (!q) return names.slice(0, MAX_RESULTS);
  const prefix = [], substr = [];
  for (const n of names) {
    if (n.startsWith(q)) { if (prefix.length < MAX_RESULTS) prefix.push(n); }
    else if (n.includes(q) && substr.length < MAX_RESULTS) substr.push(n);
  }
  return [...prefix, ...substr].slice(0, MAX_RESULTS);
}

/** Upgrade a text input into a lucide-icon search combobox. Idempotent. */
export async function attachIconPicker(input) {
  if (!input || input._iconPicker) return;
  const names = await loadNames();
  if (!Array.isArray(names) || !names.length) return; // degrade: plain input
  input._iconPicker = true;

  const wrap = document.createElement('div');
  wrap.className = 'more-buttons-icon-picker';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const dropdown = document.createElement('div');
  dropdown.className = 'more-buttons-icon-picker-dropdown';
  dropdown.style.display = 'none';
  wrap.appendChild(dropdown);

  let rows = [];
  let active = -1;

  const close = () => { dropdown.style.display = 'none'; active = -1; };

  const select = (name) => {
    input.value = `lucide/${name}`;
    // Real input/change events so the dirty guard + save-state button react.
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    close();
  };

  const setActive = (i) => {
    rows[active]?.classList.remove('active');
    active = i;
    if (rows[active]) {
      rows[active].classList.add('active');
      rows[active].scrollIntoView({ block: 'nearest' });
    }
  };

  const render = () => {
    const matches = rankMatches(names, input.value);
    rows = [];
    active = -1;
    dropdown.replaceChildren();
    if (!matches.length) { close(); return; }
    for (const name of matches) {
      const row = document.createElement('div');
      row.className = 'more-buttons-icon-picker-row';
      row.dataset.name = name;
      const glyph = document.createElement('span');
      glyph.className = 'more-buttons-icon-picker-glyph';
      row.appendChild(glyph);
      row.appendChild(document.createTextNode(name));
      // mousedown (not click) beats the input's blur, so the pick lands.
      row.addEventListener('mousedown', e => { e.preventDefault(); select(name); });
      dropdown.appendChild(row);
      rows.push(row);
      fetchSvg(name).then(svg => {
        if (svg.trimStart().startsWith('<svg')) glyph.innerHTML = svg;
      });
    }
    dropdown.style.display = '';
  };

  let debounce = null;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(render, 120);
  });
  input.addEventListener('focus', render);
  input.addEventListener('blur', close);
  input.addEventListener('keydown', e => {
    if (dropdown.style.display === 'none') return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(active + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(active - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0) select(rows[active].dataset.name); }
    else if (e.key === 'Escape') { e.stopPropagation(); close(); }
  });
}
```

- [x] **Step 2: Add the manifest entry**

In `manifest.json`, in the first `web_accessible_resources` block, after `"scripts/frontmatter.js"` (added in Task 3) add:

```json
        "scripts/frontmatter.js",
        "scripts/iconPicker.js"
```

- [x] **Step 3: Append the picker styles to `config/forms/formsStyling.css`**

```css
/* ── Icon picker (lucide search combobox) ─────────────────────────────────── */

.more-buttons-icon-picker {
  position: relative;
}

.more-buttons-icon-picker-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 260px;
  overflow-y: auto;
  background: var(--mb-bg-input);
  border: 1px solid var(--mb-border);
  border-radius: 6px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.14);
  z-index: 30;
}

.more-buttons-icon-picker-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 6px 9px;
  cursor: pointer;
  font-size: 0.875rem;
  color: var(--mb-text);
}

.more-buttons-icon-picker-row:hover,
.more-buttons-icon-picker-row.active {
  background: rgba(127, 127, 127, 0.14);
}

.more-buttons-icon-picker-glyph {
  width: 18px;
  height: 18px;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.more-buttons-icon-picker-glyph svg {
  width: 18px;
  height: 18px;
  stroke: currentColor;
}
```

- [x] **Step 4: Attach the picker for H1 edits in guides.js**

Add the import near the frontmatter import:

```js
import { attachIconPicker } from './iconPicker.js';
```

Extend the level-1 block in `openEditGuideSection` (the one edited in Task 4 Step 4):

```js
  if (section.level === 1) {
    formEl.querySelector('[data-section-parent-row]')?.style.setProperty('display', 'none');
    formEl.parentElement?.querySelector('[data-delete-section-btn]')?.style.setProperty('display', 'none');
    formEl.querySelector('[data-section-icon-row]')?.style.removeProperty('display');
    attachIconPicker(formEl.querySelector('[name="sectionIcon"]')); // fire-and-forget; degrades to plain input
  }
```

- [x] **Step 5: Run the suite**

Run: `for t in tests/*.test.mjs; do node "$t" > /dev/null || echo "FAIL: $t"; done`
Expected: no `FAIL:` lines

- [x] **Step 6: Commit**

```bash
git add scripts/iconPicker.js manifest.json config/forms/formsStyling.css scripts/guides.js
git commit -m "feat(iconPicker): lucide search combobox with CDN SVG previews"
```

---

### Task 7: Manual verification in the extension

The picker/save UX is DOM- and GitHub-coupled; verify by hand. **The manifest changed in Tasks 3/5/6 — reload the extension at `chrome://extensions` first**, then hard-refresh the cloud.opus-safety.co.uk tab.

- [ ] **Step 1: Icon row appears only on H1.** Open Knowledge Base Management → pick a guide → click its title. The form shows `Icon` above `Title` (horizontal label, left). Open an H2/H3 section: no Icon row.

- [ ] **Step 2: Search works.** Focus the Icon input, type `user`. Dropdown lists prefix matches first (`user`, `user-check`, …) with rendered SVG previews. Arrow keys + Enter select; Escape closes without closing the overlay; clicking a row sets the input to `lucide/<name>` and flips the Save button to unsaved (green).

- [ ] **Step 3: Icon persists.** Pick `lucide/user-plus`, Save to draft. Check the draft file on GitHub (`docs/drafts/<name>.md`): it starts with `---\nicon: lucide/user-plus\n---`, H1 and body unchanged. Reopen the title form: the input shows `lucide/user-plus`.

- [ ] **Step 4: Icon clears.** Empty the input, Save. Draft file no longer has a frontmatter block (or keeps other keys if it had any).

- [ ] **Step 5: Title renames nav.** Change the Title, Save. `zensical.toml` on GitHub: the guide's leaf in `nav` AND `draft_nav` (if drafting) shows the new display name, in its original position. The KB management list shows the new name after refresh.

- [ ] **Step 6: No-op saves stay clean.** Save again without changing anything: no new commits on `zensical.toml` (check the file's commit history on GitHub).

- [ ] **Step 7: Zensical accepts the output.** In `~/Desktop/stuff/opus-knowledge-base`, pull and build/serve zensical; the page shows the lucide icon in the nav next to its (renamed) entry.

- [ ] **Step 8: Commit any fixups, then finish**

Use the superpowers:finishing-a-development-branch skill if on a branch; otherwise ensure `git status` is clean.
