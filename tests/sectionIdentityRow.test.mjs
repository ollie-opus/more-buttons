import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../config/forms/editGuideSection.html', import.meta.url), 'utf8');
const guides = readFileSync(new URL('../scripts/guides.js', import.meta.url), 'utf8');
let passed = 0; const test = (n, f) => { f(); passed++; console.log('  ok -', n); };
test('section editor has no h2 and no Title group; the title input is the identity row', () => {
  assert.ok(!/<h2/.test(html));
  assert.ok(!/<label class="more-buttons-label">Title<\/label>/.test(html));
  assert.ok(/<div class="mb-ident">\s*<input type="text" name="sectionTitle" class="mb-ident__title" required placeholder="Section title"/.test(html));
});
test('Hide title stays directly after the title input, pills slot last', () => {
  const i = html.indexOf('name="sectionTitle"'), h = html.indexOf('name="hideSectionTitle"'), p = html.indexOf('data-guide-section-heading');
  assert.ok(i < h && h < p);
});
test('guides.js no longer writes heading text into the pill slot', () => {
  assert.ok(!guides.includes("heading.textContent = 'Add section'"));
  assert.ok(!guides.includes('heading.textContent = treeMatch'));
});
console.log(`${passed} passed`);
