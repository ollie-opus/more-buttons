// The placed page title: a page whose own title is hidden may show one title
// somewhere in its content (kbPageRender.js readPageTitle, kbPageOps.js).
import assert from 'node:assert/strict';
import {
  OPS, applyOps, dropEmptyText, findComponent, readContainer, parsePastedPage,
  findPageTitle, pageTitleHidden, canPlacePageTitle, newPageTitle, withoutPageTitles,
} from '../scripts/kbPageOps.js';
import { TEXT_KIND, renderGuidePage, readPageTitle, pageTitleBody } from '../scripts/kbPageRender.js';
import { buildSectionTree, readSectionDescription } from '../scripts/sections.js';
import { componentsMarkdown } from '../scripts/components.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const span = id => `<span data-uuid="${id}" style="display:none"></span>`;
const HIDE = '<style data-mb-hide-section-title>:is(h1,h2,h3):has(+ p + style[data-mb-hide-section-title]){display:none}</style>';

// A page as it was written before there was a block: the title hidden, a
// `# Title` line typed into a grid cell's text.
const RAW = [
  '# Contractors Overview', span('h1'), '', HIDE, '',
  span('g1'), '', '<div class="grid" markdown>', '', '<div markdown>', '', span('c1'), '',
  span('t1'), 'A label line', '', '# Opus Contractor Management', '', 'Stay on top of it.', '',
  '</div>', '', '<div markdown>', '', span('c2'), '', span('t2'), 'Right side.', '', '</div>', '', '</div>', '',
  '## Next', span('s2'), '', span('t3'), 'More text.', '',
].join('\n');
const SHOWN = RAW.replace(HIDE + '\n\n', '');
const cell = { kind: TEXT_KIND.cell, uuid: 'c1' };
const section = { kind: TEXT_KIND.section, uuid: 's2' };

test('body round trip, escaped', () => {
  assert.equal(pageTitleBody('  A <b> & "c"  '), '<h1 class="mb-page-title">A &lt;b&gt; &amp; "c"</h1>');
  assert.equal(readPageTitle(pageTitleBody('A <b> & "c"')), 'A <b> & "c"');
  assert.equal(readPageTitle('Just text'), null);
  assert.equal(readPageTitle('<h1 class="mb-page-title">A</h1>\n\nmore'), null);
});

test('only a page with its title hidden may take one', () => {
  assert.equal(pageTitleHidden(RAW), true);
  assert.equal(pageTitleHidden(SHOWN), false);
  assert.equal(canPlacePageTitle(RAW), true);
  assert.equal(canPlacePageTitle(SHOWN), false);
});

const lifted = applyOps(RAW, [OPS.liftPageTitle()]);

test('a typed # line is lifted into the block, text above and below kept', () => {
  const list = readContainer(lifted, cell).components;
  assert.deepEqual(list.map(c => c.txt.body), ['A label line', pageTitleBody('Opus Contractor Management'), 'Stay on top of it.']);
  assert.equal(list[0].txt.uuid, 't1');
  assert.equal(findPageTitle(lifted).component.txt.uuid, list[1].txt.uuid);
  assert.equal(canPlacePageTitle(lifted), false);
  // The page's sections are what they were: the line is no heading.
  assert.deepEqual(buildSectionTree(lifted).sections.map(s => s.title), buildSectionTree(RAW).sections.map(s => s.title));
  // Done once: a second run changes nothing, and the same identities come out each time.
  assert.equal(applyOps(lifted, [OPS.liftPageTitle()]), lifted);
  assert.equal(applyOps(RAW, [OPS.liftPageTitle()]), lifted);
  assert.equal(dropEmptyText(lifted), lifted);
});

test('nothing is lifted on a page that shows its title, or out of a code fence', () => {
  assert.equal(applyOps(SHOWN, [OPS.liftPageTitle()]), SHOWN);
  const fenced = RAW.replace('# Opus Contractor Management', '```\n# not a title\n```');
  assert.equal(applyOps(fenced, [OPS.liftPageTitle()]), fenced);
});

test('it is drawn as an h1 typed in place, at the top of a section too', () => {
  const uuid = findPageTitle(lifted).component.txt.uuid;
  const { html, title } = renderGuidePage(lifted);
  assert.ok(html.includes(`data-mb-comp="title"><h1 class="mb-page-title" data-mb-edit="page-title" data-mb-uuid="${uuid}">Opus Contractor Management</h1>`));
  assert.equal(title, 'Contractors Overview');
  assert.ok(!html.includes('# Opus'));
  const moved = applyOps(lifted, [OPS.moveTo(uuid, section, 0)]);
  assert.deepEqual(buildSectionTree(moved).sections.map(s => [s.level, s.title]), [[1, 'Contractors Overview'], [2, 'Next']]);
  assert.equal(readContainer(moved, section).components[0].txt.uuid, uuid);
  assert.equal(findPageTitle(moved).container.uuid, 's2');
});

test('a page holds one: a second is not inserted, and a paste leaves it out', () => {
  const second = newPageTitle('Another');
  assert.equal(applyOps(lifted, [OPS.insertComponents(section, 0, [second])]), lifted);
  assert.equal(applyOps(SHOWN, [OPS.insertComponents(section, 0, [second])]), SHOWN);
  const added = applyOps(RAW.replace('# Opus Contractor Management', 'Plain'), [OPS.insertComponents(section, 0, [second])]);
  assert.equal(findPageTitle(added).component.txt.uuid, second.txt.uuid);
  // Copied inside its grid, it is not in what is copied; pasted markdown never brings one.
  const grid = findComponent(lifted, 'g1').component;
  const copied = withoutPageTitles(componentsMarkdown([grid]));
  assert.ok(!copied.includes('mb-page-title'));
  assert.ok(copied.includes('Stay on top of it.'));
  const pasted = parsePastedPage(`Before\n\n${pageTitleBody('X')}\n\nAfter`);
  assert.ok(!JSON.stringify(pasted).includes('mb-page-title'));
});

test('typed over, and never joined with the text beside it', () => {
  const uuid = findPageTitle(lifted).component.txt.uuid;
  const renamed = applyOps(lifted, [OPS.putText(uuid, pageTitleBody('New name'))]);
  assert.equal(readPageTitle(findPageTitle(renamed).component.txt.body), 'New name');
  const below = readContainer(lifted, cell).components[2].txt.uuid;
  assert.equal(applyOps(lifted, [OPS.joinText(below)]), lifted);
  assert.equal(applyOps(lifted, [OPS.joinText(uuid)]), lifted);
});

test("the page's own title stays hidden while one is placed", () => {
  assert.equal(applyOps(lifted, [OPS.setHideTitle('h1', false)]), lifted);
  const uuid = findPageTitle(lifted).component.txt.uuid;
  const freed = applyOps(lifted, [OPS.deleteComponent(uuid), OPS.setHideTitle('h1', false)]);
  assert.equal(readSectionDescription(freed, 'h1').hideTitle, false);
  assert.equal(findPageTitle(freed), null);
});

console.log(`kbPageTitle: ${passed} passed`);
