import assert from 'node:assert/strict';
import { tokenDiff, stripIdentityLines, sectionRedline, itemRedline } from '../scripts/textDiff.js';
import { STATUS_BLOCK_TYPE_RE } from '../scripts/statusEvents.js';
let passed = 0; async function test(name, fn) { await fn(); passed++; console.log('  ok -', name); }
const span = id => `<span data-uuid="${id}" style="display:none"></span>`;
const doc = (setupTitle, body = 'Body') => `# Guide\n${span('u1')}\n\n## ${setupTitle}\n${span('u2')}\n\n${body}\n`;

await test('tokenDiff: word-level ins/del with merged runs; identical → one eq', () => {
  assert.deepEqual(tokenDiff('a b c', 'a b c'), [{ op: 'eq', text: 'a b c' }]);
  assert.deepEqual(tokenDiff('Setup guide', 'Setup manual'), [{ op: 'eq', text: 'Setup ' }, { op: 'del', text: 'guide' }, { op: 'ins', text: 'manual' }]);
});
await test('tokenDiff: over the cap falls back to line-level ops', () => {
  const mk = changed => Array.from({ length: 100 }, (_, i) => (i === 50 && changed ? 'CHANGED ' : '') + Array.from({ length: 25 }, (_, k) => `w${i}x${k}`).join(' ')).join('\n') + '\n';
  const ops = tokenDiff(mk(false), mk(true));
  const del = ops.find(o => o.op === 'del'), ins = ops.find(o => o.op === 'ins');
  assert.ok(del.text.endsWith('\n') && ins.text.endsWith('\n'));
  assert.ok(ins.text.startsWith('CHANGED '));
  assert.equal(ops.filter(o => o.op !== 'eq').length, 2);
  assert.equal(ops.map(o => o.text).join('').length, ops.filter(o => o.op !== 'del').map(o => o.text).join('').length + del.text.length);
});
await test('stripIdentityLines drops uuid span lines only', () => {
  assert.equal(stripIdentityLines(`a\n${span('x')}\nb`), 'a\nb');
});
await test('sectionRedline: title edit yields one changed block headed by the new title, uuid span lines hidden', () => {
  const blocks = sectionRedline(doc('Setup'), doc('Setup guide'));
  assert.equal(blocks.length, 1); assert.equal(blocks[0].title, 'Setup guide'); assert.equal(blocks[0].status, 'changed');
  assert.ok(blocks[0].ops.some(o => o.op === 'ins' && o.text.includes('guide')));
  assert.ok(!JSON.stringify(blocks).includes('data-uuid'));
});
await test('sectionRedline: added/removed are single-colour; child edit attributed to child only', () => {
  const base = `# Guide\n${span('u1')}\n\nIntro\n\n## Child\n${span('u2')}\n\nOld\n`;
  const edited = base.replace('Old', 'New');
  const e = sectionRedline(base, edited);
  assert.equal(e.length, 1); assert.equal(e[0].title, 'Child'); assert.equal(e[0].status, 'changed');
  const added = sectionRedline(base, base + `\n## Extra\n${span('u3')}\n\nHi\n`);
  assert.equal(added.length, 1); assert.equal(added[0].status, 'added');
  assert.deepEqual(added[0].ops.map(o => o.op), ['ins']); assert.ok(added[0].ops[0].text.includes('Hi'));
  const removed = sectionRedline(base + `\n## Extra\n${span('u3')}\n\nHi\n`, base);
  assert.equal(removed.length, 1); assert.equal(removed[0].status, 'removed'); assert.equal(removed[0].title, 'Extra');
  assert.deepEqual(removed[0].ops.map(o => o.op), ['del']);
});
await test('sectionRedline: frontmatter-only → "Page settings"; uuid-less legacy → "Whole page"', () => {
  const fm = t => `---\ntitle: ${t}\n---\n\n${doc('Setup')}`;
  const p = sectionRedline(fm('A'), fm('B'));
  assert.equal(p.length, 1); assert.equal(p[0].title, 'Page settings'); assert.equal(p[0].status, 'changed');
  assert.ok(p[0].ops.some(o => o.op === 'ins' && o.text === 'B'));
  const w = sectionRedline('# Old\n\nText\n', '# Old\n\nTexts\n');
  assert.equal(w.length, 1); assert.equal(w[0].title, 'Whole page'); assert.equal(w[0].status, 'changed');
});
await test('sectionRedline: empty before/after → whole-page added/removed; identical → []', () => {
  const d = doc('Setup');
  const a = sectionRedline('', d);
  assert.deepEqual(a, [{ title: 'Whole page', status: 'added', ops: [{ op: 'ins', text: stripIdentityLines(d) }] }]);
  const r = sectionRedline(d, '');
  assert.deepEqual(r, [{ title: 'Whole page', status: 'removed', ops: [{ op: 'del', text: stripIdentityLines(d) }] }]);
  assert.deepEqual(sectionRedline(d, d), []);
});
await test('itemRedline: scoped to uuid block; added/removed single colour; missing both → Whole page', () => {
  const blk = (desc, extra = '') => `!!! status-outage "x"\n    ${span('i1')}\n\n    - **Description:** ${desc}\n${extra}`;
  const other = `\n!!! status-outage "y"\n    ${span('i2')}\n\n    - **Description:** same\n`;
  const c = itemRedline(blk('Old') + other, blk('New') + other.replace('same', 'diff'), 'i1', STATUS_BLOCK_TYPE_RE);
  assert.equal(c.length, 1); assert.equal(c[0].status, 'changed'); assert.equal(c[0].title, 'x');
  assert.ok(!JSON.stringify(c).includes('diff') && !JSON.stringify(c).includes('data-uuid'));
  assert.ok(c[0].ops.some(o => o.op === 'ins' && o.text === 'New'));
  assert.deepEqual(itemRedline(blk('Old'), blk('Old'), 'i1', STATUS_BLOCK_TYPE_RE), []);
  const ad = itemRedline(other, other + '\n' + blk('Old'), 'i1', STATUS_BLOCK_TYPE_RE);
  assert.equal(ad[0].status, 'added'); assert.deepEqual(ad[0].ops.map(o => o.op), ['ins']);
  const rm = itemRedline(other + '\n' + blk('Old'), other, 'i1', STATUS_BLOCK_TYPE_RE);
  assert.equal(rm[0].status, 'removed'); assert.deepEqual(rm[0].ops.map(o => o.op), ['del']);
  const none = itemRedline('a\n', 'b\n', 'zz', STATUS_BLOCK_TYPE_RE);
  assert.equal(none[0].title, 'Whole page');
  const pill = '!!! status-outage "<span class="mb-label mb-label-outage">OUTAGE</span>"\n    ' + span('i3') + '\n\n    - **Description:** a\n';
  const pt = itemRedline('', pill, 'i3', STATUS_BLOCK_TYPE_RE);
  assert.equal(pt[0].title, 'OUTAGE');
});
await test('sectionRedline: a two-section swap yields one "Section order" block (old titles del, new titles ins), no uuid text', () => {
  const A = `## One\n${span('u2')}\n\nAlpha\n`, B = `## Two\n${span('u3')}\n\nBeta\n`;
  const before = `# Guide\n${span('u1')}\n\nIntro\n\n${A}\n${B}`;
  const after = `# Guide\n${span('u1')}\n\nIntro\n\n${B}\n${A}`;
  const blocks = sectionRedline(before, after);
  assert.deepEqual(blocks, [{ title: 'Section order', status: 'changed', ops: [
    { op: 'del', text: 'Guide\nOne\nTwo\n' },
    { op: 'ins', text: 'Guide\nTwo\nOne\n' },
  ] }]);
  assert.ok(!JSON.stringify(blocks).includes('data-uuid'));
  // a reorder that also edits a section reports the edit, not the order block
  const edited = sectionRedline(before, after.replace('Beta', 'Gamma'));
  assert.ok(!edited.some(b => b.title === 'Section order'));
  assert.ok(edited.some(b => b.title === 'Two' && b.status === 'changed'));
});
await test('sectionRedline: the whole-page fallback diffs identity-stripped text', () => {
  // duplicated uuids collapse in the section map, so no block is found: whole-file fallback
  const before = `# A\n${span('d1')}\n\nx\n\n# B\n${span('d1')}\n\ny\n`;
  const after = `# A\n${span('d1')}\n\nx\n\n# B\n${span('d1')}\n\nz\n`;
  const w = sectionRedline(before, after);
  assert.equal(w.length, 1); assert.equal(w[0].title, 'Whole page'); assert.equal(w[0].status, 'changed');
  assert.ok(!JSON.stringify(w).includes('data-uuid'));
  assert.ok(w[0].ops.some(o => o.op === 'ins' && o.text === 'z'));
});
console.log(`${passed} passed`);
