import assert from 'node:assert/strict';
import {
  OPS, TABLE, CODE, applyOps, commitForOps, findComponent, findOwner, readContainer, walkPage,
  newComponent, newTab, newCell, mediaComponent, mediaFiles,
} from '../scripts/kbPageOps.js';
import { TEXT_KIND, renderGuidePage } from '../scripts/kbPageRender.js';
import { readSectionDescription, buildSectionTree } from '../scripts/sections.js';
import { parsePastedComponents } from '../scripts/components.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const span = (id, indent = '') => `${indent}<span data-uuid="${id}" style="display:none"></span>`;

const PAGE = [
  '---',
  'icon: lucide/user-plus',
  '---',
  '',
  '# Adding an employee',
  span('h1'),
  '',
  'Intro text.',
  '',
  '## First',
  span('s1'),
  '',
  'First text.',
  '',
  '!!! note "Heads up<span class="meta">(optional)</span>"',
  '',
  span('adm', '    '),
  '    Note text.',
  '',
  span('cap', '    '),
  '    ![](../assets/media/occ-captures/a-light-mode.png#only-light)',
  '    ![](../assets/media/occ-captures/a-dark-mode.png#only-dark)',
  '',
  span('btn'),
  '[Go](https://example.com){ .md-button .custom-button-blue }',
  '',
  span('tabs'),
  '=== "One"',
  '',
  span('t1', '    '),
  '    Tab one text.',
  '',
  '=== "Two"',
  '',
  span('t2', '    '),
  '',
  span('tbl'),
  '',
  '| A | B |',
  '| :--- | :--- |',
  '| 1 | 2 |',
  '',
  '## Second',
  span('s2'),
  '',
  '<style data-mb-hide-section-title>:is(h1,h2,h3):has(+ p + style[data-mb-hide-section-title]){display:none}</style>',
  '',
  'Second text.',
  '',
  span('grid'),
  '',
  '<div class="grid" markdown>',
  '',
  '<div class="card" markdown>',
  '',
  span('c1'),
  '',
  'Cell one.',
  '',
  '</div>',
  '',
  '<div class="card" markdown>',
  '',
  span('c2'),
  '',
  '</div>',
  '',
  '</div>',
  '',
  span('code'),
  '```python title="x.py"',
  'print(1)  # (1)!',
  '```',
  '',
  '1. First note',
  '',
  '### Child',
  span('s3'),
  '',
  'Child text.',
  '',
].join('\n');

const section = uuid => ({ kind: TEXT_KIND.section, uuid });
const run = (md, ...ops) => applyOps(md, ops);
// The components of a container, its text blocks left out (`blocks` keeps them).
const blocks = (md, container) => readContainer(md, container).components.map(c => c.kind);
const kinds = (md, container) => blocks(md, container).filter(k => k !== 'text');
const texts = (md, container) => readContainer(md, container).components.filter(c => c.kind === 'text').map(c => c.txt.body);

// ── Reading ─────────────────────────────────────────────────────────────────

test('walkPage reaches every component at every depth, with its container', () => {
  const seen = [...walkPage(PAGE)].map(h => `${h.component.kind}@${h.container.kind}:${h.container.uuid}#${h.index}`);
  assert.deepEqual(seen, [
    'text@guide-section:h1#0',
    'text@guide-section:s1#0',
    'admonition@guide-section:s1#1',
    'text@guide-admonition:adm#0',
    'capture@guide-admonition:adm#1',
    'button@guide-section:s1#2',
    'tabs@guide-section:s1#3',
    'text@content-tab:t1#0',
    'table@guide-section:s1#4',
    'text@guide-section:s2#0',
    'grid@guide-section:s2#1',
    'text@grid-cell:c1#0',
    'codeblock@guide-section:s2#2',
    'text@guide-section:s3#0',
  ]);
});

test('findComponent / findOwner / readContainer address by uuid; absent → null', () => {
  assert.equal(findComponent(PAGE, 'cap').container.uuid, 'adm');
  assert.equal(findComponent(PAGE, 'nope'), null);
  assert.equal(findOwner(PAGE, 'tab', 't2').childIndex, 1);
  assert.equal(findOwner(PAGE, 'cell', 'c1').component.grid.uuid, 'grid');
  assert.equal(findOwner(PAGE, 'tab', 'c1'), null);
  assert.equal(readContainer(PAGE, { kind: TEXT_KIND.tab, uuid: 't1' }).description, 'Tab one text.');
  assert.equal(readContainer(PAGE, { kind: TEXT_KIND.cell, uuid: 'c1' }).description, 'Cell one.');
  assert.equal(readContainer(PAGE, { kind: TEXT_KIND.admonition, uuid: 'adm' }).description, 'Note text.');
  assert.equal(readContainer(PAGE, section('gone')), null);
});

// ── Text and titles ─────────────────────────────────────────────────────────

test('setText rewrites only the text: components, hide-title and the rest of the page stay', () => {
  const out = run(PAGE, OPS.setText(section('s2'), 'New **second** text.'));
  assert.equal(readContainer(out, section('s2')).description, 'New **second** text.');
  assert.deepEqual(kinds(out, section('s2')), ['grid', 'codeblock']);
  assert.equal(readSectionDescription(out, 's2').hideTitle, true, 'hide-title marker survives');
  assert.equal(readContainer(out, section('s1')).description, 'First text.');
  assert.ok(out.startsWith('---\nicon: lucide/user-plus\n---'), 'frontmatter untouched');
});

test('setText works in every container kind', () => {
  const out = run(PAGE,
    OPS.setText({ kind: TEXT_KIND.admonition, uuid: 'adm' }, 'A'),
    OPS.setText({ kind: TEXT_KIND.tab, uuid: 't2' }, 'B'),
    OPS.setText({ kind: TEXT_KIND.cell, uuid: 'c2' }, 'C'));
  assert.equal(readContainer(out, { kind: TEXT_KIND.admonition, uuid: 'adm' }).description, 'A');
  assert.deepEqual(kinds(out, { kind: TEXT_KIND.admonition, uuid: 'adm' }), ['capture']);
  assert.equal(readContainer(out, { kind: TEXT_KIND.tab, uuid: 't2' }).description, 'B');
  assert.equal(readContainer(out, { kind: TEXT_KIND.cell, uuid: 'c2' }).description, 'C');
  assert.equal(readContainer(out, { kind: TEXT_KIND.tab, uuid: 't1' }).description, 'Tab one text.');
});

test('an op whose target is gone throws a message fit to show', () => {
  assert.throws(() => run(PAGE, OPS.setText(section('gone'), 'x')), /no longer in the draft/);
  assert.throws(() => run(PAGE, OPS.editComponent('gone', c => c)), /no longer in the draft/);
  assert.throws(() => run(PAGE, OPS.deleteSection('gone')), /no longer in the draft/);
  assert.throws(() => run(PAGE, OPS.editChildren('tab', 'gone', () => {})), /no longer in the draft/);
});

test('section title, hide title, add, move, reparent, delete', () => {
  let out = run(PAGE, OPS.setSectionTitle('s1', 'Renamed'));
  assert.match(out, /^## Renamed$/m);
  out = run(out, OPS.setHideTitle('s2', false), OPS.setHideTitle('s1', true));
  assert.equal(readSectionDescription(out, 's2').hideTitle, false);
  assert.equal(readSectionDescription(out, 's1').hideTitle, true);
  assert.deepEqual(kinds(out, section('s1')), ['admonition', 'button', 'tabs', 'table']);

  const add = OPS.addSection({ uuid: 'new', title: 'Added', parentUuid: 'h1', level: 2 });
  out = run(PAGE, add);
  const titles = md => buildSectionTree(md).sections.map(s => `${s.level}:${s.title}:${s.uuid}`);
  assert.deepEqual(titles(out), ['1:Adding an employee:h1', '2:First:s1', '2:Second:s2', '3:Child:s3', '2:Added:new']);
  assert.equal(run(PAGE, add), out, 'replaying an insert mints the same identity');

  out = run(PAGE, OPS.moveSection('s2', 'up'));
  assert.deepEqual(titles(out).slice(1), ['2:Second:s2', '3:Child:s3', '2:First:s1']);
  out = run(PAGE, OPS.reparentSection('s3', null));
  assert.deepEqual(titles(out).filter(t => t.startsWith('2:')), ['2:First:s1', '2:Second:s2', '2:Child:s3']);
  out = run(PAGE, OPS.deleteSection('s2'));
  assert.deepEqual(titles(out), ['1:Adding an employee:h1', '2:First:s1']);
});

// ── Components ──────────────────────────────────────────────────────────────

test('insert, move and delete components within a container', () => {
  const diagram = newComponent('diagram');
  let out = run(PAGE, OPS.insertComponents(section('s1'), 2, [diagram]));
  assert.deepEqual(kinds(out, section('s1')), ['admonition', 'diagram', 'button', 'tabs', 'table']);
  assert.equal(findComponent(out, diagram.dia.uuid).index, 2);
  out = run(out, OPS.moveComponent(diagram.dia.uuid, 'up'));
  assert.deepEqual(kinds(out, section('s1')), ['diagram', 'admonition', 'button', 'tabs', 'table']);
  out = run(out, OPS.moveComponent(diagram.dia.uuid, 'up'));
  assert.deepEqual(blocks(out, section('s1')).slice(0, 2), ['diagram', 'text'], 'a component can go above the text');
  assert.equal(run(out, OPS.moveComponent(diagram.dia.uuid, 'up')), out, 'already first: unchanged');
  out = run(out, OPS.deleteComponent('adm'), OPS.deleteComponent(diagram.dia.uuid));
  assert.deepEqual(kinds(out, section('s1')), ['button', 'tabs', 'table']);
  assert.equal(findComponent(out, 'cap'), null, 'a deleted admonition takes its contents');
  // Into a nested container, clamped to its length.
  out = run(PAGE, OPS.insertComponents({ kind: TEXT_KIND.cell, uuid: 'c2' }, 99, [newComponent('button')]));
  assert.deepEqual(kinds(out, { kind: TEXT_KIND.cell, uuid: 'c2' }), ['button']);
  assert.equal(readContainer(out, { kind: TEXT_KIND.cell, uuid: 'c1' }).description, 'Cell one.');
});

test('every insertable kind round-trips through the page parser', () => {
  for (const kind of ['admonition', 'tabs', 'grid', 'table', 'button', 'navlinks', 'diagram', 'codeblock']) {
    const comp = newComponent(kind);
    const out = run(PAGE, OPS.insertComponents(section('s2'), 0, [comp]));
    assert.deepEqual(kinds(out, section('s2')), [kind, 'grid', 'codeblock'], kind);
    assert.deepEqual(kinds(out, section('s1')), ['admonition', 'button', 'tabs', 'table'], kind + ': neighbours intact');
    assert.ok(renderGuidePage(out).html.length > 0);
  }
  assert.equal(newComponent('nope'), null);
});

test('editComponent: admonition header, button, media, nav links', () => {
  let out = run(PAGE, OPS.editComponent('adm', c => { c.adm.type = 'warning'; c.adm.prefix = '???'; c.adm.title = 'Careful'; }));
  const adm = findComponent(out, 'adm').component.adm;
  assert.deepEqual([adm.type, adm.prefix, adm.title], ['warning', '???', 'Careful']);
  assert.equal(findComponent(out, 'cap').container.uuid, 'adm', 'the body is kept');
  assert.equal(readContainer(out, { kind: TEXT_KIND.admonition, uuid: 'adm' }).description, 'Note text.');

  out = run(PAGE, OPS.editComponent('btn', c => { c.btn.label = 'Open'; c.btn.colour = 'red'; c.btn.newTab = true; }));
  assert.match(out, /\[Open\]\(https:\/\/example\.com\)\{ \.md-button \.custom-button-red target="_blank" rel="noopener" \}/);

  out = run(PAGE, OPS.editComponent('cap', c => { c.cap.dimMode = 'width'; c.cap.dimValue = 300; c.cap.rounded = true; c.cap.inversed = true; }));
  const cap = findComponent(out, 'cap').component.cap;
  assert.deepEqual([cap.dimMode, cap.dimValue, cap.rounded, cap.inversed], ['width', 300, true, true]);

  const nav = newComponent('navlinks');
  out = run(PAGE, OPS.insertComponents(section('s1'), 0, [nav]),
    OPS.editComponent(nav.nav.uuid, c => { c.nav = { uuid: c.nav.uuid, tag: 'System, RAMS', layout: 'grouped', newTab: true }; }));
  assert.match(out, /data-nav-tag="System, RAMS" data-nav-layout="grouped" data-nav-new-tab="true"/);
});

test('tabs: rename, add, move, delete; the last tab takes the group with it', () => {
  let out = run(PAGE, OPS.editChildren('tab', 't1', (tabs, i) => { tabs[i].title = 'Uno'; }));
  assert.deepEqual(findComponent(out, 'tabs').component.grp.tabs.map(t => t.title), ['Uno', 'Two']);
  assert.equal(readContainer(out, { kind: TEXT_KIND.tab, uuid: 't1' }).description, 'Tab one text.');
  const tab = newTab('Three');
  out = run(out, OPS.editChildren('tab', 't2', (tabs, i) => { tabs.splice(i + 1, 0, tab); }));
  out = run(out, OPS.editChildren('tab', tab.uuid, (tabs, i) => { tabs.unshift(...tabs.splice(i, 1)); }));
  assert.deepEqual(findComponent(out, 'tabs').component.grp.tabs.map(t => t.uuid), [tab.uuid, 't1', 't2']);
  out = run(out, OPS.setText({ kind: TEXT_KIND.tab, uuid: tab.uuid }, 'Typed'));
  assert.equal(readContainer(out, { kind: TEXT_KIND.tab, uuid: tab.uuid }).description, 'Typed');
  const drop = uuid => OPS.editChildren('tab', uuid, (tabs, i) => { tabs.splice(i, 1); });
  out = run(out, drop('t1'), drop('t2'));
  assert.equal(findComponent(out, 'tabs').component.grp.tabs.length, 1);
  out = run(out, drop(tab.uuid));
  assert.equal(findComponent(out, 'tabs'), null);
  assert.deepEqual(kinds(out, section('s1')), ['admonition', 'button', 'table']);
});

test('grid: cell flags, add, delete, flavour', () => {
  const cell = newCell();
  let out = run(PAGE,
    OPS.editChildren('cell', 'c1', (cells, i) => { cells[i].spill = true; cells[i].valign = 'middle'; }),
    OPS.editChildren('cell', 'c2', (cells, i) => { cells.splice(i + 1, 0, cell); }),
    OPS.editComponent('grid', c => { c.grid.flavor = 'generic'; }));
  const grid = findComponent(out, 'grid').component.grid;
  assert.equal(grid.flavor, 'generic');
  assert.deepEqual(grid.cells.map(c => [c.uuid, c.spill, c.valign]), [['c1', true, 'middle'], ['c2', false, 'default'], [cell.uuid, false, 'default']]);
  assert.equal(readContainer(out, { kind: TEXT_KIND.cell, uuid: 'c1' }).description, 'Cell one.');
  out = run(out, OPS.editChildren('cell', 'c1', (cells, i) => { cells.splice(i, 1); }));
  assert.deepEqual(findComponent(out, 'grid').component.grid.cells.map(c => c.uuid), ['c2', cell.uuid]);
});

test('table: cells, rows, columns, alignment', () => {
  const edit = fn => OPS.editComponent('tbl', c => { fn(c.tbl); });
  let out = run(PAGE,
    edit(t => TABLE.setCell(t, -1, 0, 'Name')),
    edit(t => TABLE.setCell(t, 0, 1, 'a | b')),
    edit(t => TABLE.insertRow(t, 1)),
    edit(t => TABLE.insertCol(t, 2)),
    edit(t => TABLE.setAlign(t, 1, 'right')));
  let tbl = findComponent(out, 'tbl').component.tbl;
  assert.deepEqual(tbl.header, ['Name', 'B', 'Column']);
  assert.deepEqual(tbl.rows, [['1', 'a | b', ''], ['', '', '']]);
  assert.deepEqual(tbl.align, ['left', 'right', 'left']);
  out = run(out, edit(t => TABLE.deleteRow(t, 0)), edit(t => TABLE.deleteCol(t, 0)), edit(t => TABLE.deleteCol(t, 0)), edit(t => TABLE.deleteCol(t, 0)));
  tbl = findComponent(out, 'tbl').component.tbl;
  assert.deepEqual(tbl.header, ['Column'], 'the last column cannot be deleted');
  assert.deepEqual(tbl.rows, [['']]);
});

test('code block: code, options and annotations stay bound to their markers', () => {
  const edit = fn => OPS.editComponent('code', c => { fn(c.cb); });
  let out = run(PAGE, edit(cb => { cb.code = 'print(1)  # (1)!\nprint(2)'; cb.language = 'py'; cb.linenums = '1'; }));
  let cb = findComponent(out, 'code').component.cb;
  assert.deepEqual([cb.language, cb.title, cb.linenums, cb.annotations], ['py', 'x.py', '1', ['First note']]);
  out = run(out, edit(c => CODE.addAnnotation(c, 'Second note')));
  cb = findComponent(out, 'code').component.cb;
  assert.deepEqual(cb.annotations, ['First note', 'Second note']);
  assert.match(cb.code, /print\(2\) # \(2\)!$/);
  out = run(out, edit(c => CODE.setAnnotation(c, 0, '')));
  cb = findComponent(out, 'code').component.cb;
  assert.deepEqual(cb.annotations, ['Second note'], 'an emptied annotation goes, the rest renumber');
  assert.equal(cb.code, 'print(1)\nprint(2) # (1)!');
});

test('media picks become components; a replacement keeps the size settings', () => {
  const cap = mediaComponent('capture', { light: 'docs/assets/media/occ-captures/x-light-mode.png', dark: 'docs/assets/media/occ-captures/x-dark-mode.png' });
  const img = mediaComponent('image', { single: 'docs/assets/media/buttons/save.svg' });
  const vid = mediaComponent('video', { single: 'docs/assets/media/videos/demo.mp4' });
  const out = run(PAGE, OPS.insertComponents(section('s2'), 0, [cap, img, vid]));
  assert.deepEqual(kinds(out, section('s2')), ['capture', 'image', 'video', 'grid', 'codeblock']);
  assert.match(out, /!\[\]\(\.\.\/assets\/media\/occ-captures\/x-light-mode\.png#only-light\)\n!\[\]\(\.\.\/assets\/media\/occ-captures\/x-dark-mode\.png#only-dark\)/);
  assert.match(out, /!\[\]\(\.\.\/assets\/media\/buttons\/save\.svg\)/);
  assert.equal(findComponent(out, vid.vid.uuid).component.vid.single, true);

  const swapped = run(PAGE,
    OPS.editComponent('cap', c => { c.cap.dimMode = 'height'; c.cap.dimValue = 40; }),
    OPS.editComponent('cap', c => { Object.assign(c.cap, mediaFiles('capture', { light: 'docs/assets/media/occ-captures/y-light-mode.png' })); }));
  const c = findComponent(swapped, 'cap').component.cap;
  assert.deepEqual([c.lightFilename, c.darkFilename, c.dimMode, c.dimValue],
    ['media/occ-captures/y-light-mode.png', 'media/occ-captures/y-dark-mode.png', 'height', 40]);
});

test('pasted component markdown inserts with fresh identities', () => {
  const { components } = parsePastedComponents('!!! tip "Pasted"\n\n    Body.\n\n[Go](x.md){ .md-button }');
  const out = run(PAGE, OPS.insertComponents(section('s2'), 3, components));
  assert.deepEqual(kinds(out, section('s2')), ['grid', 'codeblock', 'admonition', 'button']);
});

// ── Replaying and describing ────────────────────────────────────────────────

test('ops replay over a draft that changed underneath them', () => {
  const ops = [OPS.setText(section('s1'), 'Mine.'), OPS.editComponent('btn', c => { c.btn.label = 'Mine'; })];
  const theirs = run(PAGE, OPS.setText(section('s2'), 'Theirs.'), OPS.deleteComponent('tbl'));
  const merged = applyOps(theirs, ops);
  assert.equal(readContainer(merged, section('s1')).description, 'Mine.');
  assert.equal(readContainer(merged, section('s2')).description, 'Theirs.');
  assert.equal(findComponent(merged, 'btn').component.btn.label, 'Mine');
  assert.equal(findComponent(merged, 'tbl'), null);
});

test('commitForOps: one change keeps the form editors\' subject; several are counted and listed', () => {
  assert.equal(commitForOps(PAGE, []), 'Edited the page');
  assert.equal(commitForOps(PAGE, [OPS.setText(section('s1'), 'x')]), "Edited section 'First'");
  assert.equal(commitForOps(PAGE, [OPS.setText({ kind: TEXT_KIND.admonition, uuid: 'adm' }, 'x')]), "Edited Note admonition 'Heads up' in 'First'");
  assert.equal(commitForOps(PAGE, [OPS.setText({ kind: TEXT_KIND.tab, uuid: 't1' }, 'x')]), "Edited Content tabs in 'First'");
  assert.equal(commitForOps(PAGE, [OPS.deleteComponent('btn')]), "Deleted Button 'Go' in 'First'");
  assert.equal(commitForOps(PAGE, [OPS.moveComponent('btn', 'up')]), "Reordered components in 'First'");
  assert.equal(commitForOps(PAGE, [OPS.insertComponents(section('s2'), 0, [newComponent('table')])]), "Added Data table in 'Second'");
  assert.equal(commitForOps(PAGE, [OPS.addSection({ uuid: 'n', title: 'New', parentUuid: 'h1', level: 2 })]), "Added section 'New' under 'Adding an employee'");
  assert.equal(commitForOps(PAGE, [OPS.deleteSection('s2')]), "Deleted section 'Second'");
  // An edit to something added in the same save is described from the page as it then stands.
  const table = newComponent('table');
  const many = commitForOps(PAGE, [
    OPS.insertComponents(section('s2'), 0, [table]),
    OPS.editComponent(table.tbl.uuid, c => { TABLE.setCell(c.tbl, 0, 0, 'x'); }),
    OPS.setSectionTitle('s1', 'Renamed'),
    OPS.setText(section('s1'), 'x'),
  ]);
  // The rename and the text edit of the same section share a subject: listed once.
  assert.deepEqual(many, {
    subject: 'Made 3 changes to the page',
    bodyLines: ["- Added Data table in 'Second'", "- Edited Data table in 'Second'", "- Edited section 'Renamed'"],
  });
});

console.log(`\nkbPageOps: ${passed} passed`);
