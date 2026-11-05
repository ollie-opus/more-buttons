import assert from 'node:assert/strict';
import { insertTriggerHtml, railRowHtml, listSelectionBarHtml, deleteButtonHtml, stripNonCopyFootButtons, captureComponentCard } from '../scripts/cardRenderer.js';

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

test('railRowHtml: selectable adds the checkbox column as the first child of the row (before the rail)', () => {
  const html = railRowHtml({ rowAttrs: 'data-component-uuid="U-1"', isFirst: true, isLast: true, moveAttr: 'data-move-component', cardHtml: '<div>card</div>', selectable: true });
  const box = html.indexOf('<div class="mb-component-select"><input type="checkbox" class="mb-component-select__box" data-select-row aria-label="Select" /></div>');
  assert.ok(box > 0);
  assert.ok(box < html.indexOf('mb-component-rail"'));
  assert.ok(!railRowHtml({ rowAttrs: '', isFirst: true, isLast: true, moveAttr: 'm', cardHtml: '' }).includes('data-select-row'), 'off by default (Actions timeline)');
});

test('listSelectionBarHtml: select-all + summary, Copy, Delete (red) — both hidden at rest; canDelete:false drops Delete', () => {
  const html = listSelectionBarHtml();
  assert.ok(html.includes('class="mb-list-bar"'));
  assert.ok(html.includes('<input type="checkbox" data-select-all aria-label="Select all" /><span data-select-summary>Select all</span>'));
  assert.ok(html.includes('<button type="button" class="mb-incident-card__edit" data-copy-selected hidden title="Copy the selected items">Copy</button>'));
  assert.ok(html.includes('<button type="button" class="mb-incident-card__edit --danger" data-delete-selected hidden title="Delete the selected items">Delete</button>'));
  const copyOnly = listSelectionBarHtml({ canDelete: false });
  assert.ok(copyOnly.includes('data-copy-selected'));
  assert.ok(!copyOnly.includes('data-delete-selected'));
});

test('deleteButtonHtml: a red ghost button carrying the attribute, or nothing without one', () => {
  assert.equal(deleteButtonHtml('data-delete-component="U"').trim(), '<button type="button" class="mb-incident-card__edit --danger" data-delete-component="U">Delete</button>');
  assert.equal(deleteButtonHtml(''), '');
});

test('card builders: deleteAttr renders Delete after Edit; omitted → no Delete', () => {
  const card = captureComponentCard({ thumbSrc: 'x.png', btnAttr: 'data-edit-component="U"', copyAttr: 'data-copy-component-md="U"', deleteAttr: 'data-delete-component="U"' });
  assert.ok(card.indexOf('data-copy-component-md') < card.indexOf('data-edit-component'));
  assert.ok(card.indexOf('data-edit-component') < card.indexOf('data-delete-component'));
  assert.ok(!captureComponentCard({ thumbSrc: 'x.png', btnAttr: 'a' }).includes('--danger'));
});

test('stripNonCopyFootButtons: drops the red Delete too (modifier class), keeps Copy', () => {
  const card = captureComponentCard({ thumbSrc: 'x.png', btnAttr: 'data-edit-component="U"', copyAttr: 'data-copy-component-md="U"', deleteAttr: 'data-delete-component="U"' });
  const out = stripNonCopyFootButtons(card);
  assert.ok(out.includes('data-copy-component-md="U"'));
  assert.ok(!out.includes('data-delete-component'));
  assert.ok(!out.includes('data-edit-component'));
  assert.equal((out.match(/<button/g) || []).length, 1);
});

test('stripNonCopyFootButtons: keeps Copy, drops Edit, keeps the foot wrapper', () => {
  const card = captureComponentCard({ thumbSrc: 'x.png', btnAttr: 'data-edit-component="U"', copyAttr: 'data-copy-component-md="U"' });
  const out = stripNonCopyFootButtons(card);
  assert.ok(out.includes('data-copy-component-md="U"'));
  assert.ok(!out.includes('data-edit-component'));
  assert.ok(out.includes('mb-incident-card__foot'));
  assert.equal((out.match(/class="mb-incident-card__edit"/g) || []).length, 1);
});

test('stripNonCopyFootButtons: a card with only an Edit button ends up with an empty foot', () => {
  const card = captureComponentCard({ thumbSrc: 'x.png', btnAttr: 'data-edit-component="U"' });
  const out = stripNonCopyFootButtons(card);
  assert.equal((out.match(/<button/g) || []).length, 0);
  assert.ok(out.includes('mb-incident-card__foot'));
});

console.log(`\n${passed} passed`);
