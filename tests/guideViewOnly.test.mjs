import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.MutationObserver = class { constructor() {} observe(t) { if (!t || typeof t !== 'object') throw new TypeError('observe: parameter 1 is not of type Node'); } disconnect() {} };
const store = new Map();
globalThis.window = globalThis;
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.sessionStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
globalThis.document = { documentElement: { querySelectorAll: () => [] }, defaultView: globalThis, createElement: () => ({ style: {}, classList: { add() {} }, setAttribute() {}, appendChild() {} }), body: { style: {} }, addEventListener() {}, removeEventListener() {} };
globalThis.chrome = { runtime: { getURL: p => p }, storage: { local: { get: async () => ({ moreButtonsIntegrations: { githubPAT: 't' } }), set: async () => {} } } };

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('  ok -', name); }

// loadLabelPalette fetches the preset file; answer it with an empty palette.
globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });

const { renderComponents, onComponentEditorClick, setOpenComponentEditor, renderGuideSectionTree, liveLinkHtml, guideStatusPillHtml, writeGuideDraft } = await import('../scripts/guides.js');
const { ensureSectionUUIDs } = await import('../scripts/sections.js');
const { parseComponents } = await import('../scripts/components.js');
const { GUIDE_ADMONITION_TYPES_RE } = await import('../scripts/admonitions.js');

const span = (u, ind = '') => `${ind}<span data-uuid="${u}" style="display:none"></span>`;
const TWO = parseComponents(['!!! note "A"', '', span('U-1', '    '), '', '    Alpha.', '', '!!! note "B"', '', span('U-2', '    '), '', '    Beta.', ''].join('\n'), GUIDE_ADMONITION_TYPES_RE).components;

function fakeList(viewOnly) {
  const form = { hasAttribute: n => viewOnly && n === 'data-view-only', querySelector: () => null };
  const l = { _html: '', sets: 0, querySelectorAll: () => [], closest: () => form,
    get innerHTML() { return l._html; }, set innerHTML(v) { l._html = v; l.sets++; } };
  return l;
}
const count = (s, re) => (s.match(re) || []).length;

await test('view-only renderComponents: no insert triggers, no rail, Copy and (containers) View are the only foot buttons, rows keep the copySelection shape', () => {
  const list = fakeList(true);
  renderComponents(list, TWO, true, { viewOnly: true });
  const html = list.innerHTML;
  assert.ok(!html.includes('data-insert-component-at'));
  assert.ok(!html.includes('mb-component-rail'));
  assert.equal(count(html, /data-copy-component-md="U-[12]"/g), 2);
  assert.equal(count(html, /data-view-component="[01]"/g), 2);
  assert.equal(count(html, /class="mb-incident-card__edit"/g), 4);
  assert.equal(count(html, /data-edit-guide-admonition/g), 0);
  assert.equal(count(html, /class="mb-component-row" data-component-uuid="U-[12]"/g), 2);
  assert.equal(count(html, /data-card-expand/g), 2, 'Show more survives');
});

await test('view-only renderComponents: the flag is read from the form when the option is omitted', () => {
  const list = fakeList(true);
  renderComponents(list, TWO);
  assert.ok(!list.innerHTML.includes('mb-component-rail'));
});

await test('view-only renderComponents: an empty list is a plain line', () => {
  const list = fakeList(true);
  renderComponents(list, [], true, { viewOnly: true });
  assert.equal(list.innerHTML, '<p class="more-buttons-description">No components in this section.</p>');
});

await test('editable renderComponents output is unchanged', () => {
  const list = fakeList(false);
  renderComponents(list, TWO);
  const html = list.innerHTML;
  assert.equal(count(html, /data-insert-component-at="[012]"/g), 3);
  assert.equal(count(html, /mb-component-rail"/g), 2);
  assert.equal(count(html, /data-edit-guide-admonition="U-[12]"/g), 2);
  assert.ok(!html.includes('data-view-component'));
});

function moveClick(formEl) {
  const btn = { disabled: false, dataset: { moveComponent: 'down' }, closest: () => ({ dataset: { componentUuid: 'U-1' } }) };
  return { currentTarget: formEl, shiftKey: false, target: { closest: sel => (sel === '[data-move-component]' ? btn : null) } };
}

await test('onComponentEditorClick: a rail move on a view-only form is ignored', () => {
  const list = fakeList(true);
  let refreshed = 0;
  const formEl = { hasAttribute: n => n === 'data-view-only', dataset: {}, querySelector: () => null, _refreshSaveState: () => { refreshed++; } };
  setOpenComponentEditor({ formEl, listEl: list, container: { kind: 'guide-section', uuid: 'S', file: 'docs/pages/x.md' }, components: TWO.slice() });
  onComponentEditorClick(moveClick(formEl));
  assert.equal(list.sets, 0);
  assert.equal(refreshed, 0);
});

await test('onComponentEditorClick: the same move on an editable form re-renders in the new order', () => {
  const list = fakeList(false);
  const formEl = { hasAttribute: () => false, dataset: {}, querySelector: () => null, _refreshSaveState: () => {} };
  setOpenComponentEditor({ formEl, listEl: list, container: { kind: 'guide-section', uuid: 'S', file: 'docs/drafts/x.md' }, components: TWO.slice() });
  onComponentEditorClick(moveClick(formEl));
  assert.equal(list.sets, 1);
  assert.ok(list.innerHTML.indexOf('U-2') < list.innerHTML.indexOf('U-1'));
});

await test('renderGuideSectionTree viewOnly: rows keyed by document ordinal, no edit keys, no controls', () => {
  // Real guides always carry section UUIDs (children are matched to parents by them).
  const html = renderGuideSectionTree(ensureSectionUUIDs(['# T', '', '## A', '', '### A.1', '', '## B', ''].join('\n')), { viewOnly: true });
  const ords = [...html.matchAll(/data-view-guide-section="(\d+)"/g)].map(m => m[1]);
  assert.deepEqual(ords, ['0', '1', '2', '3']);
  assert.ok(!html.includes('data-edit-guide-section'));
  assert.ok(!html.includes('mb-kb-row-controls'));
});

await test('renderGuideSectionTree default: edit keys, no ordinals', () => {
  const html = renderGuideSectionTree(['# T', '', '## A', ''].join('\n'));
  assert.equal(count(html, /data-edit-guide-section=/g), 2);
  assert.ok(!html.includes('data-view-guide-section'));
});

await test('guideStatusPillHtml / liveLinkHtml', () => {
  assert.equal(guideStatusPillHtml('live'), '<span class="mb-kb-pills"><span class="mb-kb-pill --live">Live</span></span>');
  assert.equal(guideStatusPillHtml('drafting'), '<span class="mb-kb-pills"><span class="mb-kb-pill --drafting">Drafting</span></span>');
  const a = liveLinkHtml('docs/pages/x.md');
  assert.ok(a.includes('/pages/x/"') && a.includes('>globe</span>View live</a>'));
});

// Repo reads go through fetch; record every call so the no-write assertions are exact.
function stubFetch(byPath) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET' });
    for (const [p, text] of Object.entries(byPath)) if (String(url).includes(p)) return { ok: true, status: 200, text: async () => text, json: async () => ({}) };
    return { ok: false, status: 404, text: async () => '' };
  };
  return calls;
}

await test('writeGuideDraft: an existing draft is never overwritten', async () => {
  const calls = stubFetch({ 'docs/drafts/x.md': '# X\n' });
  assert.equal(await writeGuideDraft('docs/pages/x.md', () => {}, { title: 'X' }), 'exists');
  assert.ok(calls.every(c => c.method === 'GET'));
});

await test('writeGuideDraft: a missing live page writes nothing', async () => {
  const calls = stubFetch({});
  assert.equal(await writeGuideDraft('docs/pages/y.md', () => {}, { title: 'Y' }), 'missing-live');
  assert.ok(calls.every(c => c.method === 'GET'));
});

const live = await import('../scripts/guideLiveView.js');
const { registerFormAction, getFormAction } = await import('../scripts/formActions.js');

await test('guideLiveView registers the page opener and never imports a writer', () => {
  assert.ok(getFormAction('openGuideLiveView'));
  const src = readFileSync(new URL('../scripts/guideLiveView.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /githubFetchAndPushFile|fetchFileMigratingIdentity|githubDeleteFile|mergeSave/);
});

await test('liveBannerHtml: Create draft only on the page banner, text exact', () => {
  const text = 'Viewing the live page. Nothing here can be edited. Create a draft to make changes.';
  assert.ok(live.liveBannerHtml({ createDraft: true }).includes('data-guide-live-create'));
  assert.ok(!live.liveBannerHtml().includes('data-guide-live-create'));
  assert.ok(live.liveBannerHtml().includes(text) && !live.liveBannerHtml().includes('more-buttons-icon'));
});

await test('liveDockHtml: View live then Create draft, separated, on both view-only docks', () => {
  const dock = live.liveDockHtml('docs/pages/x.md');
  assert.ok(dock.indexOf('View live') < dock.indexOf('mb-dock-sep') && dock.indexOf('mb-dock-sep') < dock.indexOf('data-guide-live-create'));
  assert.equal(count(dock, /data-guide-live-create/g), 1);
});

await test('openGuideLiveView: a drafted page redirects to the normal draft entry before any form mounts', async () => {
  const calls = stubFetch({ 'docs/drafts/x.md': '# X\n' });
  const seen = [];
  registerFormAction('openGuideEntry', async args => { seen.push(args); });
  await getFormAction('openGuideLiveView')({ file: 'docs/pages/x.md', label: 'X' });
  assert.deepEqual(seen, [{ filePath: 'docs/pages/x.md', label: 'X' }]);
  assert.ok(calls.every(c => c.method === 'GET'));
});

const ADM = ['!!! note "N"', '', '    Body.', ''].join('\n');

await test('liveSectionModel: ordinal index on a uuid-less page, components parsed with in-memory uuids', () => {
  const md = ['# T', '', '## A', '', ADM, '', '## B', ''].join('\n');
  const m = live.liveSectionModel(md, 1);
  assert.equal(m.title, 'A');
  assert.equal(m.visualLabel, 'Section 1: A');
  assert.ok(m.uuid);
  assert.equal(m.components.length, 1);
  assert.ok(m.components[0].adm.uuid);
  assert.equal(live.liveSectionModel(md, 0).visualLabel, 'Title: T');
});

await test('liveSectionModel: code block and button get uuids, and view-only cards carry Copy', () => {
  const md = ['# T', '', '## A', '', '```bash', 'echo hi', '```', '', '[Label](x.md){ .md-button }', ''].join('\n');
  const m = live.liveSectionModel(md, 1);
  assert.equal(m.components.length, 2);
  const uuids = m.components.map(c => Object.values(c).find(v => v && typeof v === 'object' && v.uuid)?.uuid);
  assert.ok(uuids.every(Boolean), JSON.stringify(m.components));
  const list = fakeList(true);
  renderComponents(list, m.components, true, { viewOnly: true });
  assert.equal(count(list.innerHTML, /data-copy-component-md=/g), 2);
});

await test('liveSectionModel: an out-of-range ordinal is null', () => {
  assert.equal(live.liveSectionModel('# T\n\n## A\n', 5), null);
  assert.equal(live.liveSectionModel('', 0), null);
});

await test('liveSectionModel: a page that already carries uuids keeps them', () => {
  const md = ['# T', '', span('SEC-T'), '', '## A', '', span('SEC-A'), '', 'Text.', ''].join('\n');
  assert.equal(live.liveSectionModel(md, 1).uuid, 'SEC-A');
});

await test('guideLiveView registers the section opener', () => {
  assert.ok(getFormAction('openGuideSectionLiveView'));
});

await test('openGuideSectionLiveView: a missing section alerts and mounts nothing', async () => {
  stubFetch({ 'docs/pages/x.md': '# T\n\n## A\n' });
  const alerts = [];
  globalThis.alert = m => alerts.push(m);
  await getFormAction('openGuideSectionLiveView')({ file: 'docs/pages/x.md', index: 9 });
  assert.deepEqual(alerts, ['Section not found.']);
});

// ── Nested drill-down (spec section 6) ──────────────────────────────────────

const NEST = [
  '# T', '', '## A', '',
  '=== "One"', '', '    Tab one text.', '',
  '    <div class="grid" markdown>', '',
  '    <div markdown>', '', '    Cell text.', '',
  '    !!! note "Deep"', '', '        Deep body.', '',
  '    </div>', '',
  '    <div markdown>', '', '    Second.', '',
  '    </div>', '',
  '    </div>', '',
  '=== "Two"', '', '    Two text.', '',
  '!!! tip "Outer"', '', '    Outer desc.', '', '    ```bash', '    echo hi', '    ```', '',
  '| a | b |', '| - | - |', '| 1 | 2 |', '',
].join('\n');

await test('liveComponentModel: admonition with a nested code block, both with uuids', () => {
  const m = live.liveComponentModel(NEST, [1, 1]);
  assert.equal(m.kind, 'admonition');
  assert.equal(m.title, 'Outer');
  assert.ok(m.uuid);
  assert.equal(m.description.trim(), 'Outer desc.');
  assert.equal(m.components.length, 1);
  assert.equal(m.components[0].kind, 'codeblock');
  assert.ok(m.components[0].cb.uuid);
});

await test('liveComponentModel: tabs group, tab, grid, cell, and a deep admonition all resolve with uuids', () => {
  const g = live.liveComponentModel(NEST, [1, 0]);
  assert.equal(g.kind, 'tabs');
  assert.deepEqual(g.tabs.map(t => t.title), ['One', 'Two']);
  assert.ok(g.uuid && g.tabs.every(t => t.uuid));
  assert.equal(g.tabs[0].description.trim(), 'Tab one text.');
  const t = live.liveComponentModel(NEST, [1, 0, 1]);
  assert.equal(t.kind, 'tab');
  assert.equal(t.title, 'Two');
  assert.deepEqual(t.components, []);
  const grid = live.liveComponentModel(NEST, [1, 0, 0, 0]);
  assert.equal(grid.kind, 'grid');
  assert.equal(grid.cells.length, 2);
  assert.ok(grid.uuid && grid.cells.every(c => c.uuid));
  assert.equal(grid.cells[0].nComponents, 1);
  assert.equal(grid.cells[1].nComponents, 0);
  const cell = live.liveComponentModel(NEST, [1, 0, 0, 0, 0]);
  assert.equal(cell.kind, 'grid-cell');
  assert.equal(cell.index, 0);
  assert.equal(cell.description.trim(), 'Cell text.');
  assert.equal(cell.components[0].kind, 'admonition');
  assert.ok(cell.components[0].adm.uuid, 'admonition inside a cell inside a tab has a uuid');
  const deep = live.liveComponentModel(NEST, [1, 0, 0, 0, 0, 0]);
  assert.equal(deep.kind, 'admonition');
  assert.equal(deep.title, 'Deep');
});

await test('liveComponentModel: leaf, missing, out-of-range and malformed paths are null', () => {
  assert.equal(live.liveComponentModel(NEST, [1, 2]), null, 'table leaf');
  assert.equal(live.liveComponentModel(NEST, [1, 1, 0]), null, 'code block leaf inside the admonition');
  assert.equal(live.liveComponentModel(NEST, [1, 9]), null);
  assert.equal(live.liveComponentModel(NEST, [1, 0, 5]), null, 'tab index out of range');
  assert.equal(live.liveComponentModel(NEST, [1, 0, 0, 0, 7]), null, 'cell index out of range');
  assert.equal(live.liveComponentModel(NEST, [9, 0]), null, 'section out of range');
  assert.equal(live.liveComponentModel(NEST, [1]), null, 'a section is not a component');
  assert.equal(live.liveComponentModel(NEST, [1, -1]), null);
  assert.equal(live.liveComponentModel(NEST, [1, '0']), null);
  assert.equal(live.liveComponentModel(NEST, null), null);
});

await test('liveComponentHeading: wording per kind', () => {
  assert.equal(live.liveComponentHeading({ kind: 'admonition', title: 'Outer', type: 'tip' }).crumb, 'Outer');
  assert.equal(live.liveComponentHeading({ kind: 'admonition', title: '', type: 'note' }).crumb, 'Note');
  assert.equal(live.liveComponentHeading({ kind: 'admonition', title: '', type: 'zzz' }).crumb, 'Admonition');
  assert.equal(live.liveComponentHeading({ kind: 'tabs' }).crumb, 'Content tabs');
  assert.equal(live.liveComponentHeading({ kind: 'tab', title: 'Two' }).crumb, 'Two');
  assert.equal(live.liveComponentHeading({ kind: 'grid' }).crumb, 'Grid');
  assert.equal(live.liveComponentHeading({ kind: 'grid-cell', index: 2 }).crumb, 'Cell 3');
});

await test('view-only renderComponents: View only on container cards, keyed by list index, never Edit', () => {
  const m = live.liveSectionModel(NEST, 1);
  assert.deepEqual(m.components.map(c => c.kind), ['tabs', 'admonition', 'table']);
  const list = fakeList(true);
  renderComponents(list, m.components, true, { viewOnly: true });
  const html = list.innerHTML;
  assert.deepEqual([...html.matchAll(/data-view-component="(\d+)"/g)].map(x => x[1]), ['0', '1']);
  assert.equal(count(html, /data-copy-component-md=/g), 3);
  assert.equal(count(html, />Edit</g), 0);
  assert.equal(count(html, /data-edit-/g), 0);
  // View sits inside the foot, after Copy.
  const foot = html.slice(html.indexOf('mb-incident-card__foot'));
  assert.ok(foot.indexOf('data-copy-component-md') < foot.indexOf('data-view-component="0"'));
  const grid = live.liveComponentModel(NEST, [1, 0, 0]);
  const gl = fakeList(true);
  renderComponents(gl, grid.components, false, { viewOnly: true });
  assert.ok(gl.innerHTML.includes('data-view-component="0"'), 'grid card gets View');
});

await test('grid cell copy text: cell blocks with no uuid spans', () => {
  const grid = live.liveComponentModel(NEST, [1, 0, 0, 0]);
  assert.ok(grid.cells[0].body.includes('data-uuid'), 'fixture body carries in-memory spans');
  const one = live.liveGridCellsText(grid.flavor, [grid.cells[0]]);
  assert.ok(!one.includes('data-uuid'));
  assert.match(one, /^<div markdown>\n\nCell text\.\n\n!!! note "Deep"/);
  assert.ok(one.trimEnd().endsWith('</div>'));
  const both = live.liveGridCellsText(grid.flavor, grid.cells);
  assert.equal(count(both, /<div markdown>/g), 2);
  assert.ok(!both.includes('data-uuid'));
});

await test('openComponentLiveView: registered; a null model alerts "Component not found." without mounting or writing', async () => {
  assert.ok(getFormAction('openComponentLiveView'));
  const calls = stubFetch({ 'docs/pages/x.md': NEST });
  const alerts = [];
  globalThis.alert = m => alerts.push(m);
  await getFormAction('openComponentLiveView')({ file: 'docs/pages/x.md', path: [1, 2], label: 'X' });
  assert.deepEqual(alerts, ['Component not found.']);
  assert.ok(calls.every(c => c.method === 'GET'));
});

await test('openComponentLiveView / openGuideSectionLiveView: a drafted page redirects to the draft entry', async () => {
  stubFetch({ 'docs/drafts/x.md': '# X\n', 'docs/pages/x.md': NEST });
  const seen = [];
  registerFormAction('openGuideEntry', async args => { seen.push(args); });
  await getFormAction('openComponentLiveView')({ file: 'docs/pages/x.md', path: [1, 1], label: 'X' });
  await getFormAction('openGuideSectionLiveView')({ file: 'docs/pages/x.md', index: 1, label: 'X' });
  assert.deepEqual(seen, [{ filePath: 'docs/pages/x.md', label: 'X' }, { filePath: 'docs/pages/x.md', label: 'X' }]);
});

console.log(`\n${passed} passed`);
