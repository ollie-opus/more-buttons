import assert from 'node:assert/strict';
import { componentBodyHtml, cardBodyBlock, renderCard } from '../scripts/cardRenderer.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const SPAN = '<span data-uuid="U-1" style="display:none"></span>';

test('uuid marker span is stripped', () => {
  const html = componentBodyHtml(`${SPAN}\nSome text.`);
  assert.equal(html.includes('data-uuid'), false);
  assert.equal(html.includes('Some text.'), true);
});

test('indented uuid span line is stripped with its indent (no residue)', () => {
  const html = componentBodyHtml(`    ${SPAN}\nSome text.`);
  assert.equal(html.includes('data-uuid'), false);
  assert.equal(html.startsWith('Some text.'), true);
});

test('images are stripped, with and without {attrs}', () => {
  assert.equal(componentBodyHtml('![alt](img.png)'), '');
  assert.equal(componentBodyHtml('![](img.png){ width=300 }'), '');
  const html = componentBodyHtml('before\n\n![alt](img.png)\n\nafter');
  assert.equal(html.includes('img.png'), false);
  assert.equal(html.includes('before'), true);
  assert.equal(html.includes('after'), true);
});

test('image-only line leaves no blank-run gap', () => {
  const html = componentBodyHtml('before\n\n![alt](img.png)\n\nafter');
  assert.equal(/(<br\s*\/?>\s*){3,}/.test(html), false);
});

test('rich marks render via the RTE renderer', () => {
  assert.equal(componentBodyHtml('**b**').includes('<strong>b</strong>'), true);
  assert.equal(componentBodyHtml('`c`').includes('<code>c</code>'), true);
});

test('label pills survive as canonical spans', () => {
  const html = componentBodyHtml('<span class="mb-label mb-label-red">Hot</span> stuff');
  assert.equal(html.includes('class="mb-label mb-label-red"'), true);
  assert.equal(html.includes('Hot'), true);
});

test('lists render as real lists', () => {
  const html = componentBodyHtml('- a\n- b');
  assert.equal(html.includes('<ul'), true);
  assert.equal(html.includes('<li'), true);
});

test('raw HTML in the body is escaped', () => {
  const html = componentBodyHtml('<script>alert(1)</script>');
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('&lt;script&gt;'), true);
});

test('empty / whitespace / marker-only bodies give no block', () => {
  assert.equal(componentBodyHtml(''), '');
  assert.equal(componentBodyHtml(null), '');
  assert.equal(componentBodyHtml('   \n  '), '');
  assert.equal(componentBodyHtml(`${SPAN}\n`), '');
  assert.equal(cardBodyBlock(''), '');
  assert.equal(cardBodyBlock(`${SPAN}\n`), '');
});

test('cardBodyBlock emits clamped body + hidden Show more toggle', () => {
  const block = cardBodyBlock('text');
  assert.equal(block.includes('data-card-clamp'), true);
  assert.equal(block.includes('--mb-card-clamp:3'), true);
  assert.equal(block.includes('data-card-expand'), true);
  assert.equal(block.includes('aria-expanded="false"'), true);
  assert.equal(block.includes('hidden>Show more</button>'), true);
});

test('cardBodyBlock clamp lines are configurable', () => {
  assert.equal(cardBodyBlock('text', 4).includes('--mb-card-clamp:4'), true);
});

test('renderCard bodyMd embeds the rich block', () => {
  const card = renderCard({ colour: 'blue', title: 'T', badge: 'B', bodyMd: '**b**', btnAttr: '', btnLabel: 'Edit' });
  assert.equal(card.includes('<strong>b</strong>'), true);
  assert.equal(card.includes('data-card-expand'), true);
});

test('renderCard description path unchanged (systemStatus regression guard)', () => {
  const card = renderCard({ colour: 'blue', title: 'T', badge: 'B', description: 'a **b** <i>', btnAttr: '', btnLabel: 'Edit' });
  assert.equal(card.includes('<p class="mb-incident-card__body">a **b** &lt;i&gt;</p>'), true);
  assert.equal(card.includes('data-card-expand'), false);
});

console.log(`cardBodyPreview: ${passed} tests passed`);
