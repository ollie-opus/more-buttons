import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveUpdateGroups } from '../scripts/kbUpdates.js';
import { renderGuidePage } from '../scripts/kbPageRender.js';

const sp = id => `<span data-uuid="${id}" style="display:none"></span>`;
const LIVE = ['---', 'tags:', '    - System', '---', '', '# System Updates', '', 'This page highlights the main improvements.', '',
  sp('grid'), '<div class="grid" markdown>', '', '!!! question "Have an idea?"', '', '    ' + sp('q'), '', '    We\'d love to hear from you!', '</div>', '',
  '## 2026', '', '---', '### November 2026', '',
  '??? improvement "Improvement: Faster reports<span class="meta">12th November 2026</span>"', '', '    ' + sp('u1'), '', '    ' + sp('u1t'), '    Reports are faster.', '',
  '    ## Not a page heading', '',
  '### October 2026', '',
  '??? new-addition "New addition: Line management<span class="meta">29th October 2026</span>"', '', '    ' + sp('u2'), '', '    Body two.', '',
  '!!! note "Not an update"', '', '    Skipped.', '',
  '??? feature-release "Feature release: Contractors<span class="meta">30th October 2026</span>"', '', '    Body three, with no identity.', ''].join('\n');

test('the live System Updates page is its headings and the updates under each', () => {
  const groups = liveUpdateGroups(LIVE);
  assert.deepEqual(groups.map(g => [g.level, g.heading, g.updates.map(u => u.uuid)]), [
    [2, '2026', []],
    [3, 'November 2026', ['u1']],
    [3, 'October 2026', ['u2', null]],
  ]);
  assert.deepEqual(liveUpdateGroups(''), []);
});

test('drawn: title, headings and updates; the introduction and its tiles are left out', () => {
  const { html, title } = renderGuidePage(LIVE, { updatesLive: true });
  assert.equal(title, 'System Updates');
  assert.ok(!html.includes('Have an idea') && !html.includes('highlights the main') && !html.includes('Not an update'));
  assert.ok(html.indexOf('<h2') < html.indexOf('November 2026') && html.indexOf('November 2026') < html.indexOf('Faster reports'));
  assert.ok(html.indexOf('Faster reports') < html.indexOf('October 2026') && html.indexOf('October 2026') < html.indexOf('Line management'));
  assert.equal(html.match(/<details /g).length, 3, 'an update with no identity is still shown');
  assert.ok(!html.includes('mb-kb-insert'), 'nothing is added to it');
});

test('a live update copied into the drafts takes the place that keeps the live order', async () => {
  const { draftPlaceFor } = await import('../scripts/kbUpdates.js');
  const u = (uuid, date) => ({ uuid, type: 'improvement', title: `Improvement: ${uuid}${date ? `<span class="meta">${date}</span>` : ''}` });
  const live = [u('a', '12th November 2026'), u('b', '29th October 2026'), u('c', '29th October 2026'), u('d', '1st August 2026')];
  assert.equal(draftPlaceFor([], live, 'b'), 0);
  assert.equal(draftPlaceFor([u('a', '12th November 2026'), u('d', '1st August 2026')], live, 'b'), 1, 'between the two it stands between on the live page');
  assert.equal(draftPlaceFor([u('c', '29th October 2026')], live, 'b'), 0, 'same date: the live order decides');
  assert.equal(draftPlaceFor([u('b', '29th October 2026')], live, 'c'), 1);
  // Drafts that are not on the live page: by date, and one with no date yet stays above.
  assert.equal(draftPlaceFor([u('new', ''), u('n2', '30th October 2026'), u('n3', '2nd September 2026')], live, 'b'), 2);
  assert.equal(draftPlaceFor([u('n3', '2nd September 2026')], live, 'd'), 1);
  assert.equal(draftPlaceFor([u('x', '1st January 2020')], live, 'gone'), 0, 'not on the live page: first');
});
