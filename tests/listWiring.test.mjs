// Source-text guards for the list chrome that no unit test can reach: every
// list-owning screen wires the dock's selection bar, every list group gets the
// tile, and Escape clears a selection before it closes the overlay.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const src = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
let passed = 0; const test = (n, f) => { f(); passed++; console.log('  ok -', n); };

test('every template group holding a component list carries data-list-row (the tile + count)', () => {
  const dir = new URL('../config/forms/', import.meta.url);
  for (const f of readdirSync(dir).filter(f => f.endsWith('.html'))) {
    const html = readFileSync(new URL(f, dir), 'utf8');
    const re = /<div class="more-buttons-form-group"([^>]*)>\s*<label class="more-buttons-label">[^<]*<\/label>\s*<div>\s*<div data-[a-z-]*components>/g;
    for (const m of html.matchAll(re)) assert.ok(/\bdata-list-row\b/.test(m[1]), `${f}: list group without data-list-row`);
  }
});

test('every component-editor click site is paired with wireSelectionBar (the bar lives in the dock)', () => {
  for (const f of ['scripts/guides.js', 'scripts/contentTabsEditor.js', 'scripts/systemUpdates.js', 'scripts/gridEditor.js']) {
    const lines = src(f).split('\n');
    lines.forEach((l, i) => {
      const m = l.match(/^\s*(\w+)\.addEventListener\('click', onComponentEditorClick\);/);
      if (m) assert.ok(lines.slice(i + 1, i + 3).some(x => x.includes(`wireSelectionBar(${m[1]})`)), `${f}:${i + 1} not followed by wireSelectionBar(${m[1]})`);
    });
  }
  const live = src('scripts/guideLiveView.js');
  // The grid-cell / tabs-body fallthrough at the end of openComponentLiveView renders a selectable list too.
  const tail = live.slice(live.indexOf("mountContainer(formEl, host, model.kind === 'grid-cell'"));
  const block = tail.slice(0, tail.indexOf('\n});'));
  assert.ok(block.includes('wireSelectionBar(formEl)'), 'live grid-cell screen does not wire the selection bar');
});

test('Escape clears a selection before it closes the overlay', () => {
  assert.ok(src('scripts/form.js').includes('clearSelectionIfSelecting(content)'));
});
console.log(`${passed} passed`);
