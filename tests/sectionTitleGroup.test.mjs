// The section editor's Title is an ordinary eyebrow group under Section parent
// (the input-as-heading identity row was tried and rejected: it did not read
// as an input). The h2 carries the heading text and the status pill again.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../config/forms/editGuideSection.html', import.meta.url), 'utf8');
const guides = readFileSync(new URL('../scripts/guides.js', import.meta.url), 'utf8');
const live = readFileSync(new URL('../scripts/guideLiveView.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../config/forms/formsStyling.css', import.meta.url), 'utf8');
let passed = 0; const test = (n, f) => { f(); passed++; console.log('  ok -', n); };
test('section editor: h2 heading, then Section parent, then a Title group holding the input + Hide title', () => {
  assert.ok(/<h2 data-guide-section-heading>Edit section<\/h2>/.test(html));
  assert.ok(!html.includes('mb-ident'));
  const parent = html.indexOf('data-section-parent-row'), title = html.indexOf('<label class="more-buttons-label">Title</label>'), desc = html.indexOf('<label class="more-buttons-label">Description</label>');
  assert.ok(parent > -1 && title > parent && desc > title, 'Section parent · Title · Description');
  const row = html.slice(title, desc);
  assert.ok(/<div class="mb-title-row">\s*<input type="text" name="sectionTitle" required \/>\s*<label class="more-buttons-radio-btn"/.test(row), 'plain text input, Hide title pill beside it');
  assert.ok(row.includes('name="hideSectionTitle"'));
});
test('guides.js and guideLiveView.js write the heading text and append the pill (no innerHTML-only slot)', () => {
  assert.ok(guides.includes("heading.textContent = 'Add section'"));
  assert.ok(guides.includes('heading.textContent = treeMatch'));
  assert.ok(!guides.includes("heading.innerHTML = guideStatusPillHtml('draft')"));
  assert.ok(live.includes('heading.textContent = model.visualLabel'));
  assert.ok(!live.includes("heading.innerHTML = guideStatusPillHtml('live')"));
});
test('CSS: .mb-title-row is back (input grows, pill stretches to its height); .mb-ident is gone', () => {
  assert.ok(!css.includes('.mb-ident'));
  assert.match(css, /\.mb-title-row \{[^}]*display:\s*flex/);
  assert.match(css, /\.mb-title-row > input\[type="text"\] \{[^}]*flex:\s*1 1 auto/);
  assert.match(css, /\.mb-title-row > \.more-buttons-radio-btn \{[^}]*align-self:\s*stretch/);
});
console.log(`${passed} passed`);
