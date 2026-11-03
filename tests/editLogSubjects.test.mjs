// Source lint: every guide / component save site passes a descriptive commit
// (the edit log renders subjects verbatim; four prefixes are milestone rules).
// Presence checks only (lower bounds), never exact counts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0; async function test(name, fn) { await fn(); passed++; console.log('  ok -', name); }
const src = f => readFileSync(new URL(`../scripts/${f}`, import.meta.url), 'utf8');
const count = (s, re) => (s.match(re) || []).length;

await test('guides.js: the rule-line prefixes and section/settings subjects are written by the right flows', () => {
  const g = src('guides.js');
  assert.match(g, /commit: `Create guide: \$\{title\}`/);
  assert.match(g, /commit: `Create draft: \$\{guideDisplayTitle\(formEl\)\}`/);
  assert.ok(count(g, /commit: `Publish: \$\{guideDisplayTitle\(formEl\)\}`/g) >= 2, 'live PUT and draft DELETE');
  assert.match(g, /commit: `Discard draft: \$\{guideDisplayTitle\(formEl\)\}`/);
  assert.match(g, /commit: 'Reordered sections'/);
  assert.ok(count(g, /commit: 'Edited page settings'/g) >= 2, 'draft mergeSave and live PUT');
  assert.match(g, /Reordered components in '\$\{resolved\.sectionTitle\.trim\(\)\}'/);
  assert.match(g, /Added section '\$\{title\}' under '\$\{sectionParentTitle\(before, parentUuid\)\}'/);
  assert.match(g, /commit: `Deleted section '\$\{section\.title\}'`/);
  assert.match(g, /function guideDisplayTitle\(formEl\)/);
});

await test('guides.js: container mutate forwards a commit and splice derives an Added subject', () => {
  const g = src('guides.js');
  assert.match(g, /mutate: async \(container, transform, onProgress, commit\)/);
  assert.match(g, /commit: commit \|\| \(\(\{ before \}\) => reorderCommit\(before, container\.uuid\)\)/);
  assert.match(g, /componentCommit\('Added',\s*items\.length === 1 \? componentKindLabel\(items\[0\]\)/);
  assert.match(src('dataTablesEditor.js'), /mutate: async \(container, transform, onProgress, commit\)/);
});

await test('every component editor passes a componentCommit on edit and delete', () => {
  for (const f of ['codeBlockEditor.js', 'buttonEditor.js', 'navLinksEditor.js', 'diagramEditor.js', 'contentTabsEditor.js', 'dataTablesEditor.js', 'gridEditor.js', 'captureComponent.js', 'guides.js']) {
    const s = src(f);
    assert.ok(/componentCommit\('Edited'/.test(s), f + ' edit');
    assert.ok(/componentCommit\('Deleted'/.test(s), f + ' delete');
    assert.match(s, /from '\.\/editLogDescribe\.js'/, f + ' imports the helpers');
  }
});

await test('media library inserts commit as Added', () => {
  for (const f of ['captures.js', 'images.js', 'videos.js']) {
    const s = src(f);
    assert.match(s, /componentCommit\('Added',/, f);
    assert.match(s, /from '\.\/editLogDescribe\.js'/, f + ' imports the helpers');
  }
});

console.log(`\n${passed} passed`);
