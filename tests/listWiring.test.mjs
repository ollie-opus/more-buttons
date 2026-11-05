// Source-text guards for the list chrome that no unit test can reach: the
// selection actions live in the tile header (no dock bar), every list group
// gets the tile, the header is sticky, and Escape clears a selection before it
// closes the overlay.
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

test('the selection actions live in the tile header, inside the form: no dock bar anywhere', () => {
  for (const f of ['scripts/guides.js', 'scripts/contentTabsEditor.js', 'scripts/systemUpdates.js', 'scripts/gridEditor.js', 'scripts/guideLiveView.js', 'scripts/listSelection.js', 'scripts/form.js']) {
    const t = src(f);
    for (const bad of ['wireSelectionBar', 'wireCellSelectionBar', 'mb-selection-bar', 'data-select-all-btn', 'data-clear-selection']) {
      assert.ok(!t.includes(bad), `${f} still mentions ${bad}`);
    }
  }
  assert.ok(!src('scripts/listSelection.js').includes('more-buttons-form-actions'), 'listSelection.js never touches the dock');
  const css = src('config/forms/formsStyling.css');
  assert.ok(!css.includes('mb-selection-bar') && !css.includes('.--selecting >'), 'dock bar CSS gone');
});

test('the tile header is sticky under the navbar: top:-1px (stuck detection), squared while --stuck, no form padding-top', () => {
  const css = src('config/forms/formsStyling.css');
  const head = css.match(/\n\.mb-list-tile__head \{([^}]*)\}/)?.[1] ?? '';
  assert.ok(/position:\s*sticky/.test(head), 'sticky');
  assert.ok(/top:\s*-1px/.test(head), 'top: -1px');
  assert.ok(/\.mb-list-tile__head\.--stuck \{[^}]*border-radius:\s*0/.test(css), '--stuck squares the corners');
  assert.ok(/\.mb-list-tile__head:not\(\.--selecting\) > \.mb-list-tile__btn/.test(css), 'actions hidden until something is selected');
  const form = css.match(/\n\.more-buttons-overlay-content > form \{([^}]*)\}/)?.[1] ?? '';
  assert.ok(!/padding-top/.test(form) && !/padding:\s*[1-9]/.test(form), 'the scrolling form has no top padding (sticky inset)');
});

test('Escape clears a selection before it closes the overlay', () => {
  assert.ok(src('scripts/form.js').includes('clearSelectionIfSelecting(content)'));
});
console.log(`${passed} passed`);
