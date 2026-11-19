import assert from 'node:assert/strict';
import {
  isUpdatesPage, isUpdateType, UPDATE_TYPES, UPDATES_ROOT, formatUpdateDate, isoOfUpdateDate,
  splitUpdateTitle, joinUpdateTitle, updateComponents, updatesPageTitle, missingUpdateFields, missingMessage, commitForUpdates,
  PUBLISH_WATCH, liveShowsUpdate, pendingPublishes,
} from '../scripts/kbUpdates.js';
import { OPS, newUpdate, newComponent, newTab, findComponent, readContainer, dropEmptyText, seedEmptyText, walkPage } from '../scripts/kbPageOps.js';
import { renderGuidePage, TEXT_KIND } from '../scripts/kbPageRender.js';
import { parseUpdateBlocks, insertUpdateIntoMarkdown } from '../scripts/systemUpdates.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const span = (id, indent = '') => `${indent}<span data-uuid="${id}" style="display:none"></span>`;

const DRAFTS = [
  '---',
  'search:',
  '  exclude: true',
  '---',
  '',
  '# System update drafts',
  '',
  '??? improvement "Improvement: Faster reports<span class="meta">12th November 2026</span>"',
  '',
  span('u1', '    '),
  '',
  span('t1', '    '),
  '    Reports load faster.',
  '',
  '??? new-addition "New addition: Site maps<span class="meta">3rd October 2026</span>"',
  '',
  span('u2', '    '),
  '',
  span('t2', '    '),
  '    Maps are here.',
  '',
].join('\n');

test('the updates page is told by its slug', () => {
  assert.equal(isUpdatesPage({ slug: 'system-updates' }), true);
  assert.equal(isUpdatesPage({ slug: 'permits-to-work' }), false);
  assert.equal(isUpdatesPage(null), false);
  assert.deepEqual(UPDATE_TYPES.map(t => t[0]), ['improvement', 'feature-release', 'new-addition']);
  assert.equal(isUpdateType('improvement'), true);
  assert.equal(isUpdateType('note'), false);
});

test('dates go between the calendar and the page both ways', () => {
  assert.equal(formatUpdateDate('2026-11-01'), '1st November 2026');
  assert.equal(formatUpdateDate('2026-11-12'), '12th November 2026');
  assert.equal(formatUpdateDate('2026-06-23'), '23rd June 2026');
  assert.equal(formatUpdateDate(''), '');
  assert.equal(formatUpdateDate('soon'), '');
  assert.equal(isoOfUpdateDate('3rd October 2026'), '2026-10-03');
  assert.equal(isoOfUpdateDate('Date of release'), '');
  assert.equal(isoOfUpdateDate(''), '');
  for (const iso of ['2026-01-02', '2026-12-31', '2027-02-11']) assert.equal(isoOfUpdateDate(formatUpdateDate(iso)), iso);
});

test("an update's title string is its type's name, its title and its date", () => {
  assert.deepEqual(splitUpdateTitle('improvement', 'Improvement: Faster reports<span class="meta">12th November 2026</span>'),
    { title: 'Faster reports', date: '12th November 2026' });
  assert.deepEqual(splitUpdateTitle('improvement', 'Improvement:'), { title: '', date: '' });
  assert.deepEqual(splitUpdateTitle('feature-release', 'Feature release:<span class="meta">1st May 2026</span>'), { title: '', date: '1st May 2026' });
  assert.equal(joinUpdateTitle('new-addition', '  Site  "maps" ', '3rd October 2026'), `New addition: Site 'maps'<span class="meta">3rd October 2026</span>`);
  assert.equal(joinUpdateTitle('improvement', '', ''), 'Improvement:');
  const raw = joinUpdateTitle('feature-release', 'Hello', '');
  assert.deepEqual(splitUpdateTitle('feature-release', raw), { title: 'Hello', date: '' });
});

test('the page reads as its title and its updates, in order', () => {
  assert.equal(updatesPageTitle(DRAFTS), 'System update drafts');
  assert.deepEqual(updateComponents(DRAFTS).map(c => [c.adm.uuid, c.adm.type]), [['u1', 'improvement'], ['u2', 'new-addition']]);
  assert.deepEqual(readContainer(DRAFTS, UPDATES_ROOT).components.map(c => c.adm.uuid), ['u1', 'u2']);
  // What is inside an update is found like anything inside an admonition.
  assert.deepEqual(findComponent(DRAFTS, 't1').container, { kind: TEXT_KIND.admonition, uuid: 'u1' });
  assert.deepEqual(findComponent(DRAFTS, 'u2').container, UPDATES_ROOT);
  // A guide has no updates: nothing is added to its walk.
  const guide = ['# Guide', span('h1'), '', 'Text.', ''].join('\n');
  assert.equal(updateComponents(guide).length, 0);
  assert.equal([...walkPage(guide)].every(h => h.container.kind === TEXT_KIND.section), true);
});

test('a new update joins the end of the list with no title or date, and is not ready', () => {
  const u = newUpdate('feature-release');
  const md = OPS.insertComponents(UPDATES_ROOT, null, [u]).apply(DRAFTS);
  assert.deepEqual(updateComponents(md).map(c => c.adm.uuid), ['u1', 'u2', u.adm.uuid]);
  assert.match(md, /\?\?\? feature-release "Feature release:"\n/);
  assert.deepEqual(missingUpdateFields(md), [{ uuid: u.adm.uuid, title: true, date: false }]);
  assert.deepEqual(missingUpdateFields(md, { forPublish: true }), [{ uuid: u.adm.uuid, title: true, date: true }]);
  assert.deepEqual(missingUpdateFields(DRAFTS), []);
  assert.deepEqual(missingUpdateFields(DRAFTS, { forPublish: true }), []);
  // The frontmatter and the title stay where they are.
  assert.equal(md.startsWith('---\nsearch:\n  exclude: true\n---\n\n# System update drafts\n'), true);
  // Its empty text block is only there while the page is open.
  assert.equal(dropEmptyText(md).includes('<!-- -->'), false);
  assert.equal(updateComponents(dropEmptyText(md)).length, 3);
});

test('title, date and type are edits of the update; the rest of the file is untouched', () => {
  const u = newUpdate('improvement');
  let md = OPS.insertComponents(UPDATES_ROOT, null, [u]).apply(DRAFTS);
  md = OPS.editComponent(u.adm.uuid, c => { c.adm.title = joinUpdateTitle(c.adm.type, 'Quicker saves', splitUpdateTitle(c.adm.type, c.adm.title).date); }).apply(md);
  // A titled update with no date saves to the draft, but may not go live.
  assert.deepEqual(missingUpdateFields(md), []);
  assert.deepEqual(missingUpdateFields(md, { forPublish: true }), [{ uuid: u.adm.uuid, title: false, date: true }]);
  assert.deepEqual(commitForUpdates(DRAFTS, md), { subject: "Saved draft update 'Quicker saves'", bodyLines: [`Item: ${u.adm.uuid}`] });
  assert.deepEqual(updateComponents(dropEmptyText(md)).map(c => splitUpdateTitle(c.adm.type, c.adm.title)).at(-1), { title: 'Quicker saves', date: '' });
  md = OPS.editComponent(u.adm.uuid, c => { c.adm.title = joinUpdateTitle(c.adm.type, splitUpdateTitle(c.adm.type, c.adm.title).title, formatUpdateDate('2026-11-13')); }).apply(md);
  assert.deepEqual(missingUpdateFields(md, { forPublish: true }), []);
  md = OPS.editComponent(u.adm.uuid, c => {
    const t = splitUpdateTitle(c.adm.type, c.adm.title);
    c.adm.type = 'new-addition';
    c.adm.title = joinUpdateTitle('new-addition', t.title, t.date);
  }).apply(md);
  assert.match(md, /\?\?\? new-addition "New addition: Quicker saves<span class="meta">13th November 2026<\/span>"/);
  assert.equal(md.startsWith(DRAFTS.trimEnd()), true);
  // Editing a saved update's title leaves its body exactly as it was (no blank lines creep in).
  const retitled = OPS.editComponent('u1', c => { c.adm.title = joinUpdateTitle(c.adm.type, 'Faster reports', '12th November 2026'); }).apply(DRAFTS);
  assert.equal(retitled, DRAFTS);
  const renamed = OPS.editComponent('u1', c => { c.adm.title = joinUpdateTitle(c.adm.type, 'Fast reports', '12th November 2026'); }).apply(DRAFTS);
  assert.equal(renamed, DRAFTS.replace('Faster reports', 'Fast reports'));
  // Deleting it gives the file back.
  assert.equal(OPS.deleteComponent(u.adm.uuid).apply(md).trimEnd(), DRAFTS.trimEnd());
});

test('an update saved empty is given a line to type on when the draft is opened again', () => {
  const u = newUpdate('improvement');
  let open = OPS.insertComponents(UPDATES_ROOT, null, [u]).apply(DRAFTS);
  open = OPS.editComponent(u.adm.uuid, c => { c.adm.title = joinUpdateTitle(c.adm.type, 'Quicker saves', ''); }).apply(open);
  const own = { kind: TEXT_KIND.admonition, uuid: u.adm.uuid };
  const saved = dropEmptyText(open);
  assert.deepEqual(readContainer(saved, own).components, []);
  // Opened again: one empty text block, which typing fills and a save keeps.
  const again = seedEmptyText(saved);
  const [block] = readContainer(again, own).components;
  assert.equal(readContainer(again, own).components.length, 1);
  assert.equal(block.kind, 'text');
  assert.equal(block.txt.body, '');
  assert.equal(dropEmptyText(again), saved); // nothing to save, and nothing of it reaches the file
  const typed = OPS.putText(block.txt.uuid, 'Saving is quicker.').apply(again);
  assert.equal(dropEmptyText(typed).includes('Saving is quicker.'), true);
  // The save replays the typing over the file as it is on GitHub (no such block there), held the same way.
  assert.equal(dropEmptyText(OPS.putText(block.txt.uuid, 'Saving is quicker.').apply(seedEmptyText(saved, again))), dropEmptyText(typed));
  assert.throws(() => OPS.putText(block.txt.uuid, 'Saving is quicker.').apply(saved));
  // Straight after the save the block is the one that was showing, so the page does not change.
  assert.equal(seedEmptyText(saved, open), open);
  // Updates with something in them are left alone, and so is a page with nothing empty.
  assert.equal(seedEmptyText(DRAFTS), DRAFTS);
  assert.equal(seedEmptyText(seedEmptyText(saved, open)), open);
});

test('an empty admonition or tab inside an update gets its line back too', () => {
  const adm = newComponent('admonition');
  const tabs = newComponent('tabs');
  const open = OPS.insertComponents({ kind: TEXT_KIND.admonition, uuid: 'u1' }, 1, [adm, tabs]).apply(DRAFTS);
  const saved = dropEmptyText(open);
  assert.equal(saved.includes('<!-- -->'), false);
  assert.equal(seedEmptyText(saved, open), open);
  const fresh = seedEmptyText(saved);
  assert.equal(readContainer(fresh, { kind: TEXT_KIND.admonition, uuid: adm.adm.uuid }).components.length, 1);
  for (const t of tabs.grp.tabs) assert.equal(readContainer(fresh, { kind: TEXT_KIND.tab, uuid: t.uuid }).components.length, 1);
  assert.equal(dropEmptyText(fresh), saved);
});

test('components go into an update as into any admonition', () => {
  const adm = newComponent('admonition');
  const md = OPS.insertComponents({ kind: TEXT_KIND.admonition, uuid: 'u1' }, 1, [adm]).apply(DRAFTS);
  assert.deepEqual(readContainer(md, { kind: TEXT_KIND.admonition, uuid: 'u1' }).components.map(c => c.kind), ['text', 'admonition']);
  assert.deepEqual(updateComponents(md).map(c => c.adm.uuid), ['u1', 'u2']);
  // Deleting a saved update takes it, and only it, out.
  const less = OPS.deleteComponent('u1').apply(md);
  assert.deepEqual(updateComponents(less).map(c => c.adm.uuid), ['u2']);
  assert.equal(less.includes('Maps are here.'), true);
});

test('what is missing is said in words', () => {
  assert.equal(missingMessage([{ uuid: 'a', title: true, date: true }]), 'This update needs a title and a date of release before it can go live.');
  assert.equal(missingMessage([{ uuid: 'a', title: false, date: true }]), 'This update needs a date of release before it can go live.');
  assert.equal(missingMessage([{ uuid: 'a', title: true, date: false }]), 'This update still needs a title.');
  assert.equal(missingMessage([{ uuid: 'a', title: true, date: false }, { uuid: 'b', title: true, date: false }]), '2 updates still need a title.');
});

test('the save is described update by update', () => {
  const u = newUpdate('improvement');
  let md = OPS.insertComponents(UPDATES_ROOT, null, [u]).apply(DRAFTS);
  md = OPS.editComponent(u.adm.uuid, c => { c.adm.title = joinUpdateTitle(c.adm.type, 'Quicker saves', '13th November 2026'); }).apply(md);
  assert.deepEqual(commitForUpdates(DRAFTS, md), { subject: "Saved draft update 'Quicker saves'", bodyLines: [`Item: ${u.adm.uuid}`] });
  const edited = OPS.putText('t2', 'Maps are here now.').apply(DRAFTS);
  assert.deepEqual(commitForUpdates(DRAFTS, edited), { subject: "Edited draft update 'Site maps'", bodyLines: ['Item: u2'] });
  const both = OPS.deleteComponent('u1').apply(edited);
  assert.deepEqual(commitForUpdates(DRAFTS, both), {
    subject: 'Made 2 changes to the page',
    bodyLines: ["- Edited draft update 'Site maps'", "- Deleted draft update 'Faster reports'"],
  });
  assert.equal(commitForUpdates(DRAFTS, DRAFTS), 'Edited the page');
});

test('the page draws each update with its title line in three pieces, and no title to edit', () => {
  const u = newUpdate('improvement');
  const md = OPS.insertComponents(UPDATES_ROOT, null, [u]).apply(DRAFTS);
  const { html, title } = renderGuidePage(md, { updates: true, insertSlots: true });
  assert.equal(title, 'System update drafts');
  assert.match(html, /^<h1>System update drafts<\/h1>/);
  assert.equal(/<h1[^>]*data-mb-node/.test(html), false);
  assert.match(html, /<details class="improvement" data-mb-node="u1" data-mb-kind="admonition" data-mb-update>/);
  assert.match(html, /<span class="mb-kb-upd-label">Improvement: <\/span><span class="mb-kb-upd-title" data-mb-edit="adm-title" data-mb-uuid="u1">Faster reports<\/span>/);
  assert.match(html, /<span class="meta mb-kb-upd-date" data-mb-date="u1"[^>]*>12th November 2026<\/span>/);
  // The new one: an empty title, and the date's placeholder.
  assert.equal(html.includes(`data-mb-uuid="${u.adm.uuid}"></span><span class="meta mb-kb-upd-date --empty" data-mb-date="${u.adm.uuid}"`), true);
  assert.match(html, />Date of release<\/span>/);
  // Places to add are inside the updates only: none between them.
  assert.equal(html.includes(`data-mb-insert-kind="${TEXT_KIND.admonition}" data-mb-insert-uuid="u1"`), true);
  assert.equal(html.includes(`data-mb-insert-kind="${TEXT_KIND.section}"`), false);
  assert.match(renderGuidePage('# System update drafts\n', { updates: true }).html, /No updates are waiting/);
});

test('a saved update goes to the live page as the update form would publish it', () => {
  const adm = updateComponents(DRAFTS)[0].adm;
  const { title, date } = splitUpdateTitle(adm.type, adm.title);
  const live = insertUpdateIntoMarkdown('# System Updates\n\n## 2026\n\n---\n### October 2026\n',
    { type: adm.type, title, date: isoOfUpdateDate(date), description: adm.body.replace(/^\n+/, ''), uuid: adm.uuid }, []);
  assert.match(live, /### November 2026\n\n\?\?\? improvement "Improvement: Faster reports<span class="meta">12th November 2026<\/span>"/);
  const block = parseUpdateBlocks(live).find(u => u.uuid === 'u1');
  assert.equal(block.title, 'Faster reports');
  assert.equal(block.body, adm.body);
});

test('a published update is on the live page once its identity is in the built page', () => {
  assert.equal(liveShowsUpdate('<details class="improvement"><summary>x</summary><p><span data-uuid="u1" style="display:none"></span></p></details>', 'u1'), true);
  assert.equal(liveShowsUpdate('<span data-uuid="u10"></span>', 'u1'), false);
  assert.equal(liveShowsUpdate('', 'u1'), false);
  assert.equal(liveShowsUpdate('<span data-uuid=""></span>', ''), false);
});

test('the kept copies of published updates: old ones and ones back in the drafts are dropped', () => {
  const adm = id => ({ uuid: id, prefix: '???', type: 'improvement', title: 'Improvement: X', body: '' });
  const now = 1_000_000_000;
  const list = [
    { uuid: 'p1', adm: adm('p1'), index: 0, at: now - 60_000 },
    { uuid: 'old', adm: adm('old'), index: 0, at: now - PUBLISH_WATCH.forget - 1 },
    { uuid: 'u1', adm: adm('u1'), index: 0, at: now - 1000 },          // in the drafts again
    { uuid: 'bad', adm: { uuid: 'other', type: 'improvement' }, index: 0, at: now },
    { uuid: 'note', adm: { ...adm('note'), type: 'note' }, index: 0, at: now },
    null,
  ];
  assert.deepEqual(pendingPublishes(list, DRAFTS, now).map(p => p.uuid), ['p1']);
  assert.deepEqual(pendingPublishes(undefined, DRAFTS, now), []);
  assert.deepEqual(pendingPublishes('nonsense', DRAFTS, now), []);
});

test('an update being published is drawn in its place, with nothing to edit or point at', () => {
  const [first] = updateComponents(DRAFTS);
  const rest = OPS.deleteComponent('u1').apply(DRAFTS);
  const { html } = renderGuidePage(rest, { updates: true, insertSlots: true, publishing: [{ adm: first.adm, index: 0, open: true }] });
  const ghost = html.indexOf('data-mb-ghost="u1"');
  assert.equal(ghost > 0 && ghost < html.indexOf('data-mb-node="u2"'), true);
  const end = html.indexOf('data-mb-node="u2"');
  const drawn = html.slice(ghost, end);
  assert.match(drawn, /Publishing: building and deploying/);
  assert.match(drawn, /<div class="mb-kb-upd-ghost__body"><details open class="improvement">/);
  assert.match(drawn, /Faster reports/);
  assert.equal(/data-mb-(node|edit|date|update|insert|uuid)/.test(drawn.slice(drawn.indexOf('mb-kb-upd-ghost__body'))), false);
  // The update after it keeps its own places to add.
  assert.equal(html.includes('data-mb-insert-uuid="u2"'), true);
  // Alone, it is still a list with something in it.
  const only = renderGuidePage('# System update drafts\n', { updates: true, publishing: [{ adm: first.adm, index: 3, open: false }] }).html;
  assert.equal(/No updates are waiting/.test(only), false);
  assert.match(only, /mb-kb-upd-ghost__body"><details class="improvement">/);
});

console.log(`\n${passed} passed`);
