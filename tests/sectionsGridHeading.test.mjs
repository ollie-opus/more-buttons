import assert from 'node:assert/strict';
import { parseSections, ensureSectionUUIDs } from '../scripts/sections.js';
import { parseComponents, componentMarkdown } from '../scripts/components.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const ADM_RE = /^(note|tip|warning|danger|info|example|abstract|question|quote|success|failure|bug)$/;

// A grid cell holds rich content at column 0 (md_in_html does not indent cell
// bodies). A markdown heading typed inside a cell must NOT be mistaken for a
// top-level section — doing so used to split the section mid-grid, truncating the
// grid before its `</div>` so it parsed with ZERO cells (cell open, never closed).
const DOC = `# test-guide
<span data-uuid="sec-1" style="display:none"></span>


<span data-uuid="grid-1" style="display:none"></span>
<div class="grid" markdown>

<div style="align-self: center" markdown>

<span data-uuid="cell-1" style="display:none"></span>
Manage your contractors effortlessly

# Opus Contractor Management

Body copy for the first cell.

</div>

<div class="spill" style="align-self: center" markdown>

<span data-uuid="cell-2" style="display:none"></span>
![](../assets/media/x-light-mode.png#only-light){ style="height: 50px" }

</div>

</div>
`;

test('parseSections ignores a heading inside a grid cell', () => {
  const secs = parseSections(DOC);
  assert.equal(secs.length, 1, 'only the real h1 is a section');
  assert.equal(secs[0].title, 'test-guide');
});

test('the grid parses with both cells intact (not truncated by the in-cell heading)', () => {
  const lines = DOC.split('\n');
  const sec = parseSections(DOC)[0];
  const body = lines.slice(sec.headerLine + 1, sec.ownedEndLine).join('\n');
  const { components } = parseComponents(body, ADM_RE);
  const grid = components.find(c => c.kind === 'grid');
  assert.ok(grid, 'a grid component is found');
  assert.equal(grid.grid.cells.length, 2, 'both cells survive');
});

test('copying the grid yields a complete block, not an empty one', () => {
  const lines = DOC.split('\n');
  const sec = parseSections(DOC)[0];
  const body = lines.slice(sec.headerLine + 1, sec.ownedEndLine).join('\n');
  const grid = parseComponents(body, ADM_RE).components.find(c => c.kind === 'grid');
  const md = componentMarkdown(grid);
  assert.match(md, /# Opus Contractor Management/, 'in-cell heading is preserved');
  assert.match(md, /class="spill"/, 'second cell is preserved');
  // The empty-grid regression looked exactly like this:
  assert.notEqual(md.replace(/\s/g, ''), '<divclass="grid"markdown></div>');
});

test('ensureSectionUUIDs does not inject a span after an in-cell heading', () => {
  assert.equal(ensureSectionUUIDs(DOC), DOC, 'a fully-identified doc is left untouched');
});

console.log(`\n${passed} passed`);
