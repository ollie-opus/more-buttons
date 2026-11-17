import assert from 'node:assert/strict';
import {
  OPS, TABLE, CODE, applyOps, dropEmptyText, commitForOps, findComponent, findOwner, readContainer, walkPage,
  newComponent, newTab, newCell, mediaComponent, mediaFiles, parsePastedPage, readPageSettings,
} from '../scripts/kbPageOps.js';
import { TEXT_KIND, renderGuidePage } from '../scripts/kbPageRender.js';
import { readSectionDescription, buildSectionTree } from '../scripts/sections.js';
import { parsePastedComponents, uuidOfComponent } from '../scripts/components.js';

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
  out = run(out, edit(c => CODE.addAnnotation(c, 'Top note', 0)));
  cb = findComponent(out, 'code').component.cb;
  assert.deepEqual(cb.annotations, ['Top note', 'Second note'], 'a marker added above takes the first number');
  out = run(out, edit(c => CODE.removeAnnotation(c, 0)));
  cb = findComponent(out, 'code').component.cb;
  assert.deepEqual([cb.code, cb.annotations], ['print(1)\nprint(2) # (1)!', ['Second note']], 'removed with its marker');
  out = run(out, edit(c => CODE.setLanguage(c, 'js')));
  cb = findComponent(out, 'code').component.cb;
  assert.equal(cb.code, 'print(1)\nprint(2) // (1)!', 'a new language writes its own comments');
});

test('media picks become components; a replacement keeps the size settings', () => {
  const cap = mediaComponent('capture', { light: 'docs/assets/media/occ-captures/x-light-mode.png', dark: 'docs/assets/media/occ-captures/x-dark-mode.png' });
  const img = mediaComponent('image', { single: 'docs/assets/media/buttons/save.svg' });
  const vid = mediaComponent('video', { single: 'docs/assets/media/videos/demo.mp4' });
  const out = run(PAGE, OPS.insertComponents(section('s2'), 0, [cap, img, vid]));
  assert.deepEqual(kinds(out, section('s2')), ['capture', 'image', 'video', 'grid', 'codeblock']);
  // A library capture starts as the Auto preset: its own size, corners rounded.
  assert.match(out, /!\[\]\(\.\.\/assets\/media\/occ-captures\/x-light-mode\.png#only-light\)\{ style="border-radius: 8px" loading=lazy \}\n!\[\]\(\.\.\/assets\/media\/occ-captures\/x-dark-mode\.png#only-dark\)\{ style="border-radius: 8px" loading=lazy \}/);
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

test('pasted headings become sections of their own, each with an identity', () => {
  const pasted = parsePastedPage('Lead in.\n\n## Pasted one\n\nUnder one.\n\n```md\n## not a heading\n```\n\n### Pasted deeper\n\n!!! tip "Hi"\n\n    Body.\n\n## Pasted empty');
  assert.equal(pasted.error, null);
  assert.deepEqual(pasted.sections.map(s => [s.level, s.title, s.components.map(c => c.kind)]),
    [[2, 'Pasted one', ['text', 'codeblock']], [3, 'Pasted deeper', ['admonition']], [2, 'Pasted empty', ['text']]]);
  assert.deepEqual(pasted.components.map(c => c.kind), ['text']);

  const before = blocks(PAGE, section('s1'));
  const op = OPS.pasteSections(section('s1'), 1, pasted.components, pasted.sections);
  const out = run(PAGE, op);
  assert.equal(run(PAGE, op), out); // replayed, it is the same page
  // Every heading on the page has an identity, and the page keeps its end.
  const all = buildSectionTree(out).sections;
  assert.ok(all.every(s => s.uuid));
  assert.equal(out.endsWith('\n'), PAGE.endsWith('\n'));
  // What stood above the paste stays; what stood below follows the last pasted section.
  const [one, deeper, empty] = pasted.sections.map(s => section(s.uuid));
  assert.deepEqual(blocks(out, section('s1')), [before[0], 'text']);
  assert.deepEqual(texts(out, one), ['Under one.']);
  assert.deepEqual(kinds(out, deeper), ['admonition']);
  assert.deepEqual(blocks(out, empty), ['text', ...before.slice(1)]);
  assert.ok(readContainer(out, section('s2'))); // the sections after are as they were
  assert.deepEqual(blocks(out, section('s2')), blocks(PAGE, section('s2')));
  // Drawn, each new heading is a thing of the page.
  const { html } = renderGuidePage(out);
  for (const s of pasted.sections) assert.ok(html.includes(`data-mb-node="${s.uuid}" data-mb-kind="section"`));
  assert.ok(!html.includes('data-mb-node=""'));
  assert.equal(commitForOps(PAGE, [op]), "Added 3 sections after 'First'");
});

test('a pasted page title moves every pasted heading one level down', () => {
  const pasted = parsePastedPage('# Page\n\nIntro.\n\n## Part\n\n### Detail');
  assert.deepEqual(pasted.sections.map(s => [s.level, s.title]), [[2, 'Page'], [3, 'Part'], [3, 'Detail']]);
  assert.deepEqual(parsePastedPage('Just text.').sections, []);
  assert.ok(parsePastedPage('  ').error);
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

// ── Empty text blocks ───────────────────────────────────────────────────────

test('a new section, admonition, tab and cell each open with an empty text block', () => {
  let out = run(PAGE, OPS.addSection({ uuid: 'new', title: 'Added', parentUuid: 'h1', level: 2, textUuid: 'newtext' }));
  assert.deepEqual(readContainer(out, section('new')).components, [{ kind: 'text', txt: { uuid: 'newtext', body: '' } }]);
  for (const kind of ['admonition', 'tabs', 'grid']) {
    const comp = newComponent(kind);
    out = run(out, OPS.insertComponents(section('new'), 1, [comp]));
    const inside = kind === 'admonition' ? [{ kind: TEXT_KIND.admonition, uuid: comp.adm.uuid }]
      : kind === 'tabs' ? comp.grp.tabs.map(t => ({ kind: TEXT_KIND.tab, uuid: t.uuid }))
        : comp.grid.cells.map(c => ({ kind: TEXT_KIND.cell, uuid: c.uuid }));
    for (const c of inside) assert.deepEqual(texts(out, c), [''], `${kind} opens with one empty text block`);
  }
});

test('an empty text block survives edits around it, takes typing, stays when emptied, and can be deleted', () => {
  let out = run(PAGE, OPS.addSection({ uuid: 'new', title: 'Added', parentUuid: 'h1', level: 2, textUuid: 'newtext' }));
  out = run(out, OPS.insertComponents(section('new'), 1, [newComponent('table')]), OPS.setSectionTitle('new', 'Renamed'));
  assert.deepEqual(blocks(out, section('new')), ['text', 'table']);
  assert.equal(findComponent(out, 'newtext').component.txt.body, '');
  out = run(out, OPS.putText('newtext', 'Hello.'));
  assert.deepEqual(texts(out, section('new')), ['Hello.']);
  out = run(out, OPS.putText('newtext', ''));
  assert.deepEqual(texts(out, section('new')), [''], 'emptied, the block stays');
  out = run(out, OPS.deleteComponent('newtext'));
  assert.deepEqual(blocks(out, section('new')), ['table']);
});

test('dropEmptyText: empty text blocks are not saved, at any depth; everything else is', () => {
  assert.equal(dropEmptyText(PAGE), PAGE);
  const adm = newComponent('admonition');
  const grid = newComponent('grid');
  const out = run(PAGE,
    OPS.addSection({ uuid: 'new', title: 'Added', parentUuid: 'h1', level: 2, textUuid: 'newtext' }),
    OPS.insertComponents(section('new'), 1, [adm, grid]));
  const saved = dropEmptyText(out);
  assert.ok(!saved.includes('<!-- -->'));
  // A row whose columns held nothing else is not saved either.
  assert.deepEqual(blocks(saved, section('new')), ['admonition']);
  assert.deepEqual(blocks(saved, { kind: TEXT_KIND.admonition, uuid: adm.adm.uuid }), []);
  assert.deepEqual(texts(saved, section('s1')), texts(PAGE, section('s1')));
});

// ── Rows (blocks side by side) ───────────────────────────────────────────────

const ids = (md, container) => readContainer(md, container).components.map(uuidOfComponent);
const cell = uuid => ({ kind: TEXT_KIND.cell, uuid });
const columns = (md, block) => {
  const owner = findOwner(md, 'cell', findComponent(md, block).container.uuid);
  return owner.component.grid.cells.map(c => ids(md, cell(c.uuid)));
};

test('moveBeside: a block dropped beside one in no row makes a row of the two', () => {
  const s1 = ids(PAGE, section('s1'));
  const right = OPS.moveBeside(['btn'], { block: 'adm' }, 'right');
  const out = right.apply(PAGE);
  assert.deepEqual(columns(out, 'btn'), [['adm'], ['btn']]);
  assert.equal(right.apply(PAGE), out, 'the same page each time it is applied');
  const row = findOwner(out, 'cell', findComponent(out, 'btn').container.uuid);
  assert.equal(row.component.grid.flavor, 'generic');
  assert.deepEqual(row.container, section('s1'));
  assert.equal(ids(out, section('s1')).length, s1.length - 1, 'the row stands where the block stood');
  assert.deepEqual(columns(OPS.moveBeside(['btn'], { block: 'adm' }, 'left').apply(PAGE), 'btn'), [['btn'], ['adm']]);
  // Several go into the one column, in page order; what was inside a block goes with it.
  const many = OPS.moveBeside(['btn', 'tbl'], { block: 'adm' }, 'right').apply(PAGE);
  assert.deepEqual(columns(many, 'btn'), [['adm'], ['btn', 'tbl']]);
  assert.ok(findComponent(many, 'cap'), 'the capture inside the admonition is still there');
  // Beside itself, or beside something inside itself: nowhere to go.
  assert.equal(OPS.moveBeside(['adm'], { block: 'adm' }, 'left').apply(PAGE), PAGE);
  assert.equal(OPS.moveBeside(['adm'], { block: 'cap' }, 'left').apply(PAGE), PAGE);
});

// The fixture's second column holds nothing: here it holds a line of text.
const ROW = run(PAGE, OPS.setText(cell('c2'), 'Cell two.'));

test('moveBeside: a column added to a row; a row keeps its style and its columns their settings', () => {
  let out = run(ROW, OPS.editChildren('cell', 'c1', (cells, i) => { cells[i].valign = 'middle'; }));
  out = run(out, OPS.moveBeside(['btn'], { cell: 'c1' }, 'right'));
  const grid = findComponent(out, 'grid').component.grid;
  assert.equal(grid.cells.length, 3);
  assert.deepEqual([grid.cells[0].uuid, grid.cells[2].uuid], ['c1', 'c2']);
  assert.deepEqual(ids(out, cell(grid.cells[1].uuid)), ['btn']);
  assert.equal(grid.flavor, 'card');
  assert.equal(grid.cells[0].valign, 'middle');
  // Beside a block that is in a column is beside its column: no row inside a row.
  const inner = ids(out, cell('c1'))[0];
  const again = run(out, OPS.moveBeside(['tbl'], { block: inner }, 'left'));
  const cells = findComponent(again, 'grid').component.grid.cells;
  assert.equal(cells.length, 4);
  assert.deepEqual(ids(again, cell(cells[0].uuid)), ['tbl']);
  assert.equal(cells[1].uuid, 'c1');
});

test('a column that loses its last block goes; a row down to one column is no row', () => {
  // Three columns: the button's own goes when the button leaves.
  const three = run(ROW, OPS.moveBeside(['btn'], { cell: 'c2' }, 'right'));
  let out = run(three, OPS.moveTo('btn', section('s1'), 0));
  assert.deepEqual(findComponent(out, 'grid').component.grid.cells.map(c => c.uuid), ['c1', 'c2']);
  assert.deepEqual(findComponent(run(three, OPS.deleteComponent('btn')), 'grid').component.grid.cells.map(c => c.uuid), ['c1', 'c2']);
  // Two columns: with one emptied, what the other holds stands where the row stood.
  const s2 = ids(ROW, section('s2'));
  const [one] = ids(ROW, cell('c1'));
  const two = ids(ROW, cell('c2'));
  out = run(ROW, OPS.moveTo(one, section('s1'), 0));
  assert.equal(findComponent(out, 'grid'), null);
  assert.deepEqual(ids(out, section('s2')), s2.flatMap(u => (u === 'grid' ? two : [u])));
  // Swapping two columns: the block dropped the other side of its neighbour.
  out = run(ROW, OPS.moveBeside(ids(ROW, cell('c1')), { cell: 'c2' }, 'right'));
  const cells = findComponent(out, 'grid').component.grid.cells;
  assert.deepEqual(cells.map(c => ids(out, cell(c.uuid))), [two, ids(ROW, cell('c1'))]);
  // All a column holds, dropped beside that same column: nothing moves.
  assert.equal(OPS.moveBeside(ids(ROW, cell('c1')), { cell: 'c1' }, 'left').apply(ROW), ROW);
  // Every block of a row moved away: the row goes.
  out = run(ROW, OPS.moveManyTo([...ids(ROW, cell('c1')), ...two], section('s1'), 0));
  assert.equal(findComponent(out, 'grid'), null);
  // A row that lost nothing is left alone, one column or not.
  out = run(ROW, OPS.editChildren('cell', 'c2', (list, i) => { list.splice(i, 1); }), OPS.moveTo('btn', section('s2'), 0));
  assert.equal(findComponent(out, 'grid').component.grid.cells.length, 1);
});

test('moveCellBeside: a cell moves whole, within its grid, to another, or beside a block', () => {
  const base = run(ROW, OPS.editChildren('cell', 'c1', (cells, i) => { cells[i].valign = 'bottom'; cells[i].spill = true; }));
  const cellsOf = (md, grid = 'grid') => findComponent(md, grid).component.grid.cells;
  const held = { c1: ids(base, cell('c1')), c2: ids(base, cell('c2')) };
  // Within its own grid: the other side of its neighbour. Where it is already: nothing moves.
  let out = run(base, OPS.moveCellBeside('c1', { cell: 'c2' }, 'right'));
  assert.deepEqual(cellsOf(out).map(c => [c.uuid, c.valign, c.spill]), [['c2', 'default', false], ['c1', 'bottom', true]]);
  assert.deepEqual(ids(out, cell('c1')), held.c1);
  assert.equal(OPS.moveCellBeside('c1', { cell: 'c2' }, 'left').apply(base), base);
  assert.equal(OPS.moveCellBeside('c1', { cell: 'c1' }, 'left').apply(base), base);
  assert.equal(OPS.moveCellBeside('c1', { block: held.c1[0] }, 'left').apply(base), base, 'beside something it holds');
  // Beside a block in no grid: a new grid of the same style; the grid it left, down to one cell, is no grid.
  out = run(base, OPS.moveCellBeside('c1', { block: 'btn' }, 'left'));
  assert.equal(findComponent(out, 'grid'), null);
  assert.deepEqual(ids(out, section('s2')).filter(u => held.c2.includes(u)), held.c2, 'what the other cell held stands in the section');
  const made = findOwner(out, 'cell', 'c1');
  assert.equal(made.component.grid.flavor, 'card');
  assert.deepEqual(made.component.grid.cells.map(c => c.uuid === 'c1' ? 'c1' : ids(out, cell(c.uuid))), ['c1', ['btn']]);
  assert.deepEqual([made.component.grid.cells[0].valign, made.component.grid.cells[0].spill], ['bottom', true]);
  assert.deepEqual(ids(out, cell('c1')), held.c1);
  // Into another grid: from a grid of three, which keeps its other two.
  const two = run(base, OPS.moveBeside(['btn'], { block: 'adm' }, 'right'), OPS.moveBeside(['tbl'], { cell: 'c2' }, 'right'));
  const dest = findOwner(two, 'cell', findComponent(two, 'btn').container.uuid);
  out = run(two, OPS.moveCellBeside('c1', { block: 'btn' }, 'left'));
  assert.equal(cellsOf(out).length, 2);
  assert.deepEqual(cellsOf(out, dest.component.grid.uuid).map(c => ids(out, cell(c.uuid))), [['adm'], held.c1, ['btn']]);
  // Deleted: the same rule for the grid it leaves.
  assert.equal(cellsOf(run(two, OPS.deleteCell('c1'))).length, 2);
  out = run(base, OPS.deleteCell('c1'));
  assert.equal(findComponent(out, 'grid'), null);
  assert.equal(findComponent(out, held.c1[0]), null);
  assert.ok(findComponent(out, held.c2[0]));
});

// ── Several at once (a selection, dragged) ───────────────────────────────────

const secs = md => buildSectionTree(md).sections.filter(x => x.level > 1).map(x => x.uuid);

test('moveManyTo: blocks from here and there land together, in page order', () => {
  const s1 = ids(PAGE, section('s1'));
  const s2 = ids(PAGE, section('s2'));
  // The button and the table (both in First) to the top of Second.
  const out = OPS.moveManyTo(['btn', 'tbl'], section('s2'), 0).apply(PAGE);
  assert.deepEqual(ids(out, section('s2')), ['btn', 'tbl', ...s2]);
  assert.deepEqual(ids(out, section('s1')), s1.filter(u => u !== 'btn' && u !== 'tbl'));
  // Within their own section: gathered at the place, counted before the move.
  const at = s1.indexOf('tbl') + 1;
  const same = OPS.moveManyTo(['btn', 'tbl'], section('s1'), at).apply(PAGE);
  const rest = s1.filter(u => u !== 'btn' && u !== 'tbl');
  const expect = [...s1.slice(0, at).filter(u => u !== 'btn' && u !== 'tbl'), 'btn', 'tbl', ...s1.slice(at).filter(u => u !== 'btn' && u !== 'tbl')];
  assert.deepEqual(ids(same, section('s1')), expect);
  assert.equal(rest.length + 2, s1.length);
  // One from inside an admonition and one from the section, into a tab.
  const mixed = OPS.moveManyTo(['cap', 'btn'], { kind: TEXT_KIND.tab, uuid: 't2' }, 0).apply(PAGE);
  assert.deepEqual(ids(mixed, { kind: TEXT_KIND.tab, uuid: 't2' }).slice(0, 2), ['cap', 'btn']);
  assert.ok(!ids(mixed, section('s1')).includes('btn'));
});

test('moveManyTo: nothing moves into one of the moved, or when already there together', () => {
  assert.equal(OPS.moveManyTo(['btn', 'tabs'], { kind: TEXT_KIND.tab, uuid: 't1' }, 0).apply(PAGE), PAGE);
  const s1 = ids(PAGE, section('s1'));
  const i = s1.indexOf('btn');
  assert.equal(s1[i + 1], 'tabs');
  assert.equal(OPS.moveManyTo(['btn', 'tabs'], section('s1'), i).apply(PAGE), PAGE);
  assert.throws(() => OPS.moveManyTo(['btn', 'nope'], section('s2'), 0).apply(PAGE));
});

test('moveSectionsTo: sections of a level land together, in order', () => {
  let md = PAGE;
  md = OPS.addSection({ uuid: 'sa', title: 'Aa', parentUuid: 'h1', level: 2 }).apply(md);
  md = OPS.addSection({ uuid: 'sb', title: 'Bb', parentUuid: 'h1', level: 2 }).apply(md);
  const was = secs(md).filter(u => ['s1', 's2', 'sa', 'sb'].includes(u));
  assert.deepEqual(was, ['s1', 's2', 'sa', 'sb']);
  const top = out => buildSectionTree(out).sections.filter(x => x.level === 2).map(x => x.uuid);
  assert.deepEqual(top(OPS.moveSectionsTo(['s2', 'sb'], null, 0).apply(md)), ['s2', 'sb', 's1', 'sa']);
  assert.deepEqual(top(OPS.moveSectionsTo(['s1', 'sa'], null, 4).apply(md)), ['s2', 'sb', 's1', 'sa']);
  assert.deepEqual(top(OPS.moveSectionsTo(['s1', 'sb'], null, 2).apply(md)), ['s2', 's1', 'sb', 'sa']);
});

test('moveSectionTo: a section dropped on another becomes its last subsection', () => {
  // What the "Insert as a sub-section under" tile does: an index past the end.
  const END = Number.MAX_SAFE_INTEGER;
  let md = PAGE;
  for (const [uuid, title] of [['sa', 'Aa'], ['sb', 'Bb'], ['sc', 'Cc'], ['sd', 'Dd']]) {
    md = OPS.addSection({ uuid, title, parentUuid: 'h1', level: 2 }).apply(md);
  }
  const under = (out, parent) => buildSectionTree(out).sections.filter(x => x.level === 3 && x.parentUuid === parent).map(x => x.uuid);
  const one = OPS.moveSectionTo('sb', 'sa', END);
  assert.equal(one.subject(md), "Moved section 'Bb' under 'Aa'");
  md = one.apply(md);
  assert.deepEqual(under(md, 'sa'), ['sb']);
  // The next lands after it, and several land together in page order.
  md = OPS.moveSectionsTo(['sc', 'sd'], 'sa', END).apply(md);
  assert.deepEqual(under(md, 'sa'), ['sb', 'sc', 'sd']);
  assert.ok(!buildSectionTree(md).sections.some(x => x.level === 2 && ['sb', 'sc', 'sd'].includes(x.uuid)));
  // And out again: a subsection dropped between the sections of the page is one of them, with nothing else taken along.
  const top = out => buildSectionTree(out).sections.filter(x => x.level === 2).map(x => x.uuid);
  const before = top(md);
  const at = before.indexOf('sa');
  const out = OPS.moveSectionTo('sc', null, at + 1).apply(md);
  assert.deepEqual(top(out), [...before.slice(0, at + 1), 'sc', ...before.slice(at + 1)]);
  assert.deepEqual(under(out, 'sa'), ['sb', 'sd']);
  assert.deepEqual(top(OPS.moveSectionTo('sc', null, 0).apply(md)), ['sc', ...before]);
  assert.deepEqual(top(OPS.moveSectionsTo(['sb', 'sd'], null, before.length).apply(md)), [...before, 'sb', 'sd']);
});

test('together: several changes are one op, and the commit lists each', () => {
  const op = OPS.together([OPS.deleteComponent('btn'), OPS.deleteSection('s2')]);
  const out = op.apply(PAGE);
  assert.ok(!findComponent(out, 'btn') && !secs(out).includes('s2'));
  const commit = commitForOps(PAGE, [op]);
  assert.equal(commit.subject, 'Made 2 changes to the page');
  assert.deepEqual(commit.bodyLines, ["- Deleted Button 'Go' in 'First'", "- Deleted section 'Second'"]);
  assert.equal(commitForOps(PAGE, [OPS.together([OPS.deleteComponent('btn')])]), "Deleted Button 'Go' in 'First'");
});

// The editor shows Save only while the page differs from the saved draft
// (kbPageEditor isDirty), so an edit undone by hand must leave the very same file.
test('a block moved and moved back leaves the page exactly as it was', () => {
  // A page whose text blocks all carry their span already (a first move gives one to any that does not).
  let base = PAGE;
  for (const h of [...walkPage(PAGE)]) {
    const u = uuidOfComponent(h.component);
    try { base = OPS.moveComponent(u, 'down').apply(OPS.moveComponent(u, 'up').apply(base)); } catch { /* cannot move */ }
  }
  let trips = 0;
  for (const h of [...walkPage(base)]) {
    const u = uuidOfComponent(h.component);
    if (!u) continue;
    const list = readContainer(base, h.container).components;
    const from = list.findIndex(c => uuidOfComponent(c) === u);
    for (let at = 0; at <= list.length; at++) {
      const moved = OPS.moveTo(u, h.container, at).apply(base);
      if (moved === base) continue;
      const now = readContainer(moved, h.container).components.findIndex(c => uuidOfComponent(c) === u);
      assert.equal(OPS.moveTo(u, h.container, from > now ? from + 1 : from).apply(moved), base, `${h.component.kind} ${from} → ${at} and back`);
      trips++;
    }
  }
  assert.ok(trips > 10);
});

test('pageSettings changes only what it is given, keeping the audience tag apart and other hides in place', () => {
  const md = '---\nicon: lucide/book\ntags:\n  - Using OCC\n  - System\nhide:\n  - toc\n  - footer\n---\n\n# Hi\n';
  assert.deepEqual(readPageSettings(md), {
    icon: 'lucide/book', writtenFor: 'users', tags: ['System'],
    hide: { navigation: false, toc: true, path: false, writtenFor: false },
  });
  const out = OPS.pageSettings({ writtenFor: 'admins', tags: ['System', 'Other'], hide: { toc: false, path: true } }).apply(md);
  assert.deepEqual(readPageSettings(out), {
    icon: 'lucide/book', writtenFor: 'admins', tags: ['System', 'Other'],
    hide: { navigation: false, toc: false, path: true, writtenFor: false },
  });
  assert.match(out, /hide:\n  - footer\n  - path\n/); // a hide value with no pill is kept
  const none = OPS.pageSettings({ writtenFor: 'none', icon: '' }).apply(out);
  assert.deepEqual(readPageSettings(none).tags, ['System', 'Other']);
  assert.equal(readPageSettings(none).writtenFor, 'none');
  assert.doesNotMatch(none, /icon:/);
  assert.equal(OPS.pageSettings({}).subject(md), 'Edited page settings');
});

console.log(`\nkbPageOps: ${passed} passed`);
