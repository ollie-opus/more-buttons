import assert from 'node:assert/strict';
import { insertTriggerHtml, railRowHtml } from '../scripts/cardRenderer.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

test('insertTriggerHtml: component defaults match the historical guides.js literal', () => {
  const html = insertTriggerHtml(3, { attr: 'data-insert-component-at', label: '+ Insert Component' });
  assert.equal(html, `<div class="mb-insert-component" data-insert-component-at="3"><button type="button" class="mb-insert-component__btn">+ Insert Component</button></div>`);
});

test('insertTriggerHtml: grid cells use their own attribute + label', () => {
  const html = insertTriggerHtml(0, { attr: 'data-insert-cell-at', label: '+ Insert cell' });
  assert.ok(html.includes('data-insert-cell-at="0"'));
  assert.ok(html.includes('>+ Insert cell<'));
  assert.ok(!html.includes('data-insert-component-at'));
});

test('railRowHtml: component defaults match the historical guides.js literal', () => {
  const html = railRowHtml({ rowAttrs: 'data-component-uuid="U-1"', isFirst: true, isLast: false, moveAttr: 'data-move-component', cardHtml: '<div>card</div>' });
  assert.equal(html, `
    <div class="mb-component-row" data-component-uuid="U-1">
      <div class="mb-component-rail">
        <button type="button" class="mb-component-rail__btn" data-move-component="up" disabled aria-label="Move up">↑</button>
        <button type="button" class="mb-component-rail__btn" data-move-component="down"  aria-label="Move down">↓</button>
      </div>
      <div>card</div>
    </div>`);
});

test('railRowHtml: last row disables down, custom move attribute', () => {
  const html = railRowHtml({ rowAttrs: 'data-grid-cell="2"', isFirst: false, isLast: true, moveAttr: 'data-grid-move-cell', cardHtml: '' });
  assert.ok(html.includes('data-grid-move-cell="up"  aria-label'));
  assert.ok(html.includes('data-grid-move-cell="down" disabled'));
  assert.ok(html.includes('data-grid-cell="2"'));
});

console.log(`\n${passed} passed`);
