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

const { renderComponents, onComponentEditorClick, setOpenComponentEditor, renderGuideSectionTree, liveLinkHtml, guideStatusPillHtml, guideModeToggleHtml, writeGuideDraft, renderPageSettingsNode, parentOptionsForSection, VIEW_ONLY_INSERT_HINT } = await import('../scripts/guides.js');
const { ensureSectionUUIDs } = await import('../scripts/sections.js');
const { parseComponents } = await import('../scripts/components.js');
const { GUIDE_ADMONITION_TYPES_RE } = await import('../scripts/admonitions.js');

const span = (u, ind = '') => `${ind}<span data-uuid="${u}" style="display:none"></span>`;
const TWO = parseComponents(['!!! note "A"', '', span('U-1', '    '), '', '    Alpha.', '', '!!! note "B"', '', span('U-2', '    '), '', '    Beta.', ''].join('\n'), GUIDE_ADMONITION_TYPES_RE).components;

function fakeList(viewOnly) {
  const form = { hasAttribute: n => viewOnly && n === 'data-view-only', querySelector: () => null };
  const l = { _html: '', sets: 0, querySelectorAll: () => [], querySelector: () => null, closest: sel => (sel === 'form' ? form : null),
    get innerHTML() { return l._html; }, set innerHTML(v) { l._html = v; l.sets++; } };
  return l;
}
const count = (s, re) => (s.match(re) || []).length;

await test('view-only renderComponents: the draft list shape with inert chrome — insert rules without a trigger, rails fully disabled; Copy and (containers) View are the only foot buttons; rows keep their checkboxes', () => {
  const list = fakeList(true);
  renderComponents(list, TWO, true, { viewOnly: true });
  const html = list.innerHTML;
  assert.ok(!html.includes('data-insert-component-at'));
  assert.equal(count(html, /class="mb-insert-component" aria-hidden="true"/g), 3, 'a rule before each row and after the last, like the draft list');
  assert.equal(count(html, /mb-component-rail"/g), 2, 'rails keep the layout');
  assert.equal(count(html, /mb-component-rail__btn" data-move-component="(?:up|down)" disabled/g), 4, 'every rail button inert');
  assert.equal(count(html, /data-copy-component-md="U-[12]"/g), 2);
  assert.equal(count(html, /data-view-component="[01]"/g), 2);
  assert.equal(count(html, /class="mb-incident-card__edit"/g), 4, '2× Copy, 2× View; the selection actions live in the dock');
  assert.equal(count(html, /data-edit-guide-admonition/g), 0);
  assert.equal(count(html, /data-delete-component/g), 0, 'no Delete on a view-only card');
  assert.equal(count(html, /class="mb-component-row" data-component-uuid="U-[12]"/g), 2);
  assert.equal(count(html, /data-select-row/g), 2, 'each row keeps its checkbox (Copy selected works live)');
  assert.equal(count(html, /class="mb-list-tile__head"/g), 1, 'the tile head (select all) is the first row');
  assert.ok(!html.includes('data-copy-selected') && !html.includes('data-delete-selected'), 'no actions in the list; they live in the dock');
  assert.equal(count(html, /data-card-expand/g), 2, 'Show more survives');
});

await test('view-only renderComponents: the flag is read from the form when the option is omitted', () => {
  const list = fakeList(true);
  renderComponents(list, TWO);
  assert.ok(!list.innerHTML.includes('data-insert-component-at'));
  assert.ok(list.innerHTML.includes('data-view-component="0"'));
});

await test('view-only renderComponents: an empty list keeps the insert tile, disabled, labelled with why', () => {
  const list = fakeList(true);
  renderComponents(list, [], true, { viewOnly: true });
  assert.equal(list.innerHTML, `<button type="button" class="mb-insert-component__empty" disabled><span class="mb-adm-empty__icon">+</span> ${VIEW_ONLY_INSERT_HINT}</button>`);
  assert.equal(VIEW_ONLY_INSERT_HINT, 'Switch to draft to insert components');
  renderComponents(list, [], true, { viewOnly: true, insertHint: 'Create a draft <first>' });
  assert.ok(list.innerHTML.includes('> Create a draft &lt;first&gt;</button>'), 'hint is escaped');
  assert.ok(!list.innerHTML.includes('data-insert-component-at'));
});

await test('editable renderComponents: insert triggers, rails, Copy · Edit · Delete per card, checkbox per row, and the full selection bar', () => {
  const list = fakeList(false);
  renderComponents(list, TWO);
  const html = list.innerHTML;
  assert.equal(count(html, /data-insert-component-at="[012]"/g), 3);
  assert.equal(count(html, /mb-component-rail"/g), 2);
  assert.equal(count(html, /data-edit-guide-admonition="U-[12]"/g), 2);
  assert.equal(count(html, /class="mb-incident-card__edit --danger" data-delete-component="U-[12]"/g), 2);
  assert.equal(count(html, /data-select-row/g), 2);
  assert.equal(count(html, /class="mb-list-tile__head"/g), 1);
  assert.ok(html.indexOf('class="mb-list-tile__head"') < html.indexOf('data-insert-component-at="0"'), 'the tile head comes first');
  assert.ok(!html.includes('data-view-component'));
  // Foot order on an admonition card: Copy, Edit, Delete.
  const foot = html.slice(html.indexOf('data-copy-component-md="U-1"'));
  assert.ok(foot.indexOf('data-edit-guide-admonition="U-1"') < foot.indexOf('data-delete-component="U-1"'));
});

await test('renderComponents: an empty editable list is just the insert tile — no bar', () => {
  const list = fakeList(false);
  renderComponents(list, []);
  assert.ok(list.innerHTML.startsWith('<button type="button" class="mb-insert-component__empty"'));
  assert.ok(!list.innerHTML.includes('mb-list-tile__head'), 'no select-all row on an empty list');
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
  assert.equal(guideStatusPillHtml('live'), '<span class="mb-kb-pills" data-guide-side><span class="mb-kb-pill --live">Live</span></span>');
  assert.equal(guideStatusPillHtml('draft'), '<span class="mb-kb-pills" data-guide-side><span class="mb-kb-pill --drafting">Draft</span></span>');
  const a = liveLinkHtml('docs/pages/x.md');
  assert.ok(a.includes('/pages/x/"') && a.includes('>globe</span>View live</a>'));
});

await test('guideModeToggleHtml: Live, switch, Draft; inactive side greyed, switch checked on draft', () => {
  const order = h => ['>Live<', 'data-guide-mode-toggle', '>Draft<'].map(t => h.indexOf(t));
  const onLive = guideModeToggleHtml('live');
  const onDraft = guideModeToggleHtml('draft');
  for (const h of [onLive, onDraft]) {
    const [a, b, c] = order(h);
    assert.ok(a >= 0 && a < b && b < c, h);
    assert.equal(count(h, /<button/g), 1); // only the switch is clickable
  }
  assert.ok(onLive.includes('--live"') && onLive.includes('--drafting --off') && onLive.includes('aria-checked="false"'));
  assert.ok(onDraft.includes('--live --off') && onDraft.includes('--drafting"') && onDraft.includes('aria-checked="true"'));
  const deep = guideModeToggleHtml('live', { attr: 'data-guide-side-switch' });
  assert.ok(deep.includes('data-guide-side-switch') && !deep.includes('data-guide-mode-toggle'));
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

await test('liveInsertHint: points at the switch once a draft exists, else at Create draft; no banner remains', () => {
  assert.equal(live.liveInsertHint(true), 'Switch to draft to insert components');
  assert.equal(live.liveInsertHint(false), 'Create a draft to insert components');
  assert.equal(live.liveBannerHtml, undefined);
  const src = readFileSync(new URL('../scripts/guideLiveView.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /mb-live-banner|Nothing here can be edited/);
});

await test('liveComponentFormName: admonitions reuse their draft editor, the rest the view form', () => {
  assert.equal(live.liveComponentFormName('admonition'), 'editGuideAdmonition');
  for (const k of ['tabs', 'tab', 'grid', 'grid-cell']) assert.equal(live.liveComponentFormName(k), 'viewComponent');
});



await test('liveDockHtml: View live then Create draft, separated; drafted drops Create draft', () => {
  const dock = live.liveDockHtml('docs/pages/x.md');
  assert.ok(dock.indexOf('View live') < dock.indexOf('mb-dock-sep') && dock.indexOf('mb-dock-sep') < dock.indexOf('data-guide-live-create'));
  assert.equal(count(dock, /data-guide-live-create/g), 1);
  const drafted = live.liveDockHtml('docs/pages/x.md', { drafted: true });
  assert.ok(drafted.includes('View live') && !drafted.includes('data-guide-live-create') && !drafted.includes('mb-dock-sep'));
});

await test('openGuideLiveView: forwards to the guide entry without forcing a side (a replayed slot must land on a new draft), no writes', async () => {
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

await test('liveSectionModel: level, parent and hide-title ride along for the frozen section fields', () => {
  const md = ['# T', '', span('SEC-T'), '', '## A', '', span('SEC-A'), '', '### A.1', '', span('SEC-A1'), '', '## B', '', span('SEC-B'), ''].join('\n');
  const t = live.liveSectionModel(md, 0);
  assert.equal(t.level, 1);
  assert.equal(t.parentUuid, '');
  const a = live.liveSectionModel(md, 1);
  assert.equal(a.level, 2);
  assert.equal(a.parentUuid, 'SEC-T');
  assert.equal(a.hideTitle, false);
  const a1 = live.liveSectionModel(md, 2);
  assert.equal(a1.level, 3);
  assert.equal(a1.parentUuid, 'SEC-A');
  // The same parent dropdown as the draft screen, built from the live page.
  const opts = parentOptionsForSection(a1.md, a1.uuid, a1.level);
  assert.deepEqual(opts.map(o => o.value), ['SEC-T', 'SEC-A', 'SEC-B']);
  assert.ok(opts.some(o => o.value === a1.parentUuid));
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
  assert.equal(m.prefix, '!!!', 'collapsible state for the frozen editor pills');
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
  assert.equal(cell.spill, false);
  assert.equal(cell.valign, 'default');
  assert.equal(cell.description.trim(), 'Cell text.');
  assert.equal(cell.components[0].kind, 'admonition');
  assert.ok(cell.components[0].adm.uuid, 'admonition inside a cell inside a tab has a uuid');
  const deep = live.liveComponentModel(NEST, [1, 0, 0, 0, 0, 0]);
  assert.equal(deep.kind, 'admonition');
  assert.equal(deep.title, 'Deep');
});

await test('liveComponentModel: past-a-leaf, missing, out-of-range and malformed paths are null', () => {
  assert.equal(live.liveComponentModel(NEST, [1, 2, 0]), null, 'past the table leaf');
  assert.equal(live.liveComponentModel(NEST, [1, 1, 0, 0]), null, 'past the code block leaf inside the admonition');
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

await test('view-only renderComponents: View on container and leaf cards, keyed by list index, never Edit', () => {
  const m = live.liveSectionModel(NEST, 1);
  assert.deepEqual(m.components.map(c => c.kind), ['tabs', 'admonition', 'table']);
  const list = fakeList(true);
  renderComponents(list, m.components, true, { viewOnly: true });
  const html = list.innerHTML;
  assert.deepEqual([...html.matchAll(/data-view-component="(\d+)"/g)].map(x => x[1]), ['0', '1', '2']);
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
  await getFormAction('openComponentLiveView')({ file: 'docs/pages/x.md', path: [1, 2, 0], label: 'X' });
  assert.deepEqual(alerts, ['Component not found.']);
  assert.ok(calls.every(c => c.method === 'GET'));
});

await test('openComponentLiveView / openGuideSectionLiveView: a drafted page stays live (no redirect to the draft)', async () => {
  stubFetch({ 'docs/drafts/x.md': '# X\n', 'docs/pages/x.md': NEST });
  const seen = [];
  registerFormAction('openGuideEntry', async args => { seen.push(args); });
  const alerts = [];
  globalThis.alert = m => alerts.push(m);
  // Out-of-range paths stop before createForm (no DOM here); reaching the
  // live model lookup at all proves the draft no longer diverts the open.
  await getFormAction('openComponentLiveView')({ file: 'docs/pages/x.md', path: [1, 9], label: 'X' });
  await getFormAction('openGuideSectionLiveView')({ file: 'docs/pages/x.md', index: 9, label: 'X' });
  assert.deepEqual(seen, []);
  assert.deepEqual(alerts, ['Component not found.', 'Section not found.']);
});

// ── Media screen (capture / video / image) ─────────────────────────────────

const MEDIA = [
  '# T', '', '## A', '',
  '![](../assets/media/occ-captures/a-light-mode.png#only-dark){ style="height: 120px; border-radius: 8px" loading=lazy }',
  '![](../assets/media/occ-captures/a-dark-mode.png#only-light){ style="height: 120px; border-radius: 8px" loading=lazy }', '',
  '<video src="../assets/media/videos/v-light-mode.mp4#only-light" controls playsinline preload="metadata" style="width: 400px"></video>',
  '<video src="../assets/media/videos/v-dark-mode.mp4#only-dark" controls playsinline preload="metadata" style="width: 400px"></video>', '',
  '![](../assets/media/buttons/x.png){ style="border-radius: 8px" loading=lazy }', '',
  '| a | b |', '| - | - |', '| 1 | 2 |', '',
  '```bash', 'echo hi', '```', '',
  '[Label](x.md){ .md-button }', '',
  '!!! note "Holder"', '', '    Text.', '',
  '    ![](../assets/media/buttons/y.png){ loading=lazy }', '',
].join('\n');

await test('liveComponentModel: a capture, a video and an image at the end of a path resolve to media models', () => {
  const kinds = live.liveSectionModel(MEDIA, 1).components.map(c => c.kind);
  assert.deepEqual(kinds, ['capture', 'video', 'image', 'table', 'codeblock', 'button', 'admonition']);
  const cap = live.liveComponentModel(MEDIA, [1, 0]);
  assert.equal(cap.kind, 'media');
  assert.equal(cap.mediaKind, 'capture');
  assert.equal(cap.component.cap.lightFilename, 'media/occ-captures/a-light-mode.png');
  assert.equal(cap.component.cap.inversed, true);
  assert.ok(cap.uuid && cap.uuid === cap.component.cap.uuid);
  const vid = live.liveComponentModel(MEDIA, [1, 1]);
  assert.equal(vid.mediaKind, 'video');
  assert.equal(vid.component.vid.playback, 'clip');
  assert.ok(vid.uuid);
  const img = live.liveComponentModel(MEDIA, [1, 2]);
  assert.equal(img.mediaKind, 'image');
  assert.equal(img.component.img.filename, 'media/buttons/x.png');
  assert.ok(img.uuid);
  const nested = live.liveComponentModel(MEDIA, [1, 6, 0]);
  assert.equal(nested.mediaKind, 'image', 'an image inside an admonition');
  assert.equal(live.liveComponentModel(MEDIA, [1, 0, 0]), null, 'a path cannot continue past a capture');
  assert.equal(live.liveComponentModel(MEDIA, [1, 2, 0]), null, 'nor past an image');
  for (const i of [3, 4, 5]) assert.equal(live.liveComponentModel(MEDIA, [1, i]).kind, 'leaf', 'the other leaves resolve to leaf models');
  assert.equal(live.liveComponentHeading(cap).crumb, 'Capture');
  assert.equal(live.liveComponentHeading(vid).html, 'Video');
  assert.equal(live.liveComponentHeading(img).crumb, 'Image');
  assert.equal(live.liveComponentFormName('media'), 'editCaptureComponent');
});

await test('view-only renderComponents: View on capture, video and image cards, and on table, code block and button', () => {
  const m = live.liveSectionModel(MEDIA, 1);
  const list = fakeList(true);
  renderComponents(list, m.components, true, { viewOnly: true });
  const html = list.innerHTML;
  assert.deepEqual([...html.matchAll(/data-view-component="(\d+)"/g)].map(x => x[1]), ['0', '1', '2', '3', '4', '5', '6']);
  assert.equal(count(html, /data-copy-component-md=/g), 7);
  assert.equal(count(html, /data-edit-/g), 0);
});

await test('media screen helpers: the editor preview grid, the Copy host and the shared field values', async () => {
  const { mediaPreviewHtml, mediaPreviewPaths, mediaDimFields, mediaFormatPillHtml } = await import('../scripts/captureComponent.js');
  const cap = live.liveComponentModel(MEDIA, [1, 0]).component.cap;
  assert.deepEqual(mediaPreviewPaths(cap), { light: 'docs/assets/media/occ-captures/a-light-mode.png', dark: 'docs/assets/media/occ-captures/a-dark-mode.png' });
  assert.deepEqual(mediaPreviewPaths({ filename: 'media/buttons/x.png' }), { light: 'docs/assets/media/buttons/x.png', dark: '' });
  const grid = mediaPreviewHtml('capture', cap, { lightUrl: 'blob:l', darkUrl: 'blob:d' });
  assert.ok(grid.startsWith('<div class="mb-capture-entry-grid">'));
  assert.ok(grid.includes('>Light mode</figcaption>') && grid.includes('src="blob:d"'));
  assert.ok(mediaPreviewHtml('video', cap, { lightUrl: 'blob:l' }).includes('<video'), 'video kind uses the video card; missing dark url drops its card');
  assert.ok(!mediaPreviewHtml('video', cap, { lightUrl: 'blob:l' }).includes('Dark mode'));
  assert.deepEqual(mediaDimFields('capture', cap), { dimMode: 'height', dimValue: '120', captureTheme: 'inversed', captureCorner: 'enabled' });
  assert.equal(mediaDimFields('video', live.liveComponentModel(MEDIA, [1, 1]).component.vid).videoPlayback, 'clip');
  assert.equal(mediaFormatPillHtml(cap), '<span class="mb-kb-pills"><span class="mb-kb-pill --format">.png</span></span>');
  assert.equal(live.liveMediaCopyHtml('U-<1>'), '<div class="mb-view-media-copy" data-view-media-copy><button type="button" class="more-buttons-button" data-copy-component-md="U-&lt;1&gt;">Copy</button></div>');
});

// ── Live/Draft switch below the entry (guideSideSwitch.js) ──────────────────

const sw = await import('../scripts/guideSideSwitch.js');
const { liveIdentity } = live;

// A published page: the draft shares its spans, then adds an admonition to
// section A and a code block inside the existing tip; live keeps the original.
const PUB_LIVE = [
  '# T', '', span('S-T'), '', '## A', '', span('S-A'), '',
  '!!! tip "Tip"', '', span('ADM-1', '    '), '', '    Tip body.', '',
  span('TABS-1'), '=== "One"', '', span('TAB-1', '    '), '    One.', '',
  '=== "Two"', '', span('TAB-2', '    '), '    Two.', '',
].join('\n');

await test('guideNodeIndex: sections, containers, tabs and leaves with ordinal paths and parents', () => {
  const idx = sw.guideNodeIndex(liveIdentity(NEST));
  const kinds = [...idx.byPath.values()].map(n => `${n.path.join('.')}:${n.kind}`);
  assert.ok(kinds.includes('0:section') && kinds.includes('1:section'));
  assert.ok(kinds.includes('1.0:tabs') && kinds.includes('1.0.0:tab') && kinds.includes('1.0.1:tab'));
  assert.ok(kinds.includes('1.0.0.0:grid') && kinds.includes('1.0.0.0.0:cell') && kinds.includes('1.0.0.0.0.0:admonition'));
  assert.ok(kinds.includes('1.1:admonition') && kinds.includes('1.1.0:leaf') && kinds.includes('1.2:leaf'));
  const deep = idx.byPath.get('1.0.0.0.0.0');
  assert.equal(idx.byUuid.get(deep.parent).kind, 'cell');
  assert.equal(deep.label, 'Deep');
});

await test('counterpartNode: same uuid is exact; a draft-only item falls back to its nearest shared ancestor', () => {
  const liveIdx = sw.guideNodeIndex(liveIdentity(PUB_LIVE));
  const draftMd = PUB_LIVE.replace('    Tip body.', ['    Tip body.', '', span('CB-NEW', '    '), '    ```bash', '    echo', '    ```'].join('\n'));
  const draftIdx = sw.guideNodeIndex(liveIdentity(draftMd));
  assert.deepEqual(sw.counterpartNode(draftIdx.byUuid.get('ADM-1'), draftIdx, liveIdx), { node: liveIdx.byUuid.get('ADM-1'), exact: true });
  const cb = [...draftIdx.byUuid.values()].find(n => n.kind === 'leaf' && n.compKind === 'codeblock');
  const r = sw.counterpartNode(cb, draftIdx, liveIdx);
  assert.equal(r.exact, false);
  assert.equal(r.node.uuid, 'ADM-1');
  assert.deepEqual(sw.counterpartNode(null, draftIdx, liveIdx), { node: null, exact: false });
});

await test('sideTrail: live trail is entry(live) → section → component, tabs carry the active tab', () => {
  const idx = sw.guideNodeIndex(liveIdentity(PUB_LIVE));
  const opts = { livePath: 'docs/pages/x.md', title: 'X' };
  const t = sw.sideTrail(idx.byUuid.get('TAB-2'), idx, 'live', opts);
  assert.deepEqual(t.map(e => e.name), ['openGuideEntry', 'openGuideSectionLiveView', 'openComponentLiveView']);
  assert.deepEqual(t[0].args, { filePath: 'docs/pages/x.md', label: 'X', mode: 'live' });
  assert.deepEqual(t[1].args, { file: 'docs/pages/x.md', index: 1, label: 'X' });
  assert.deepEqual(t[2].args, { file: 'docs/pages/x.md', path: [1, 1], label: 'X', tab: 1 });
  assert.equal(t[1].label, 'Section 1: A');
  // Entry only when nothing below the page matches.
  assert.deepEqual(sw.sideTrail(null, idx, 'live', opts).map(e => e.name), ['openGuideEntry']);
});

await test('sideTrail: draft trail uses the draft editors by uuid; cells by grid uuid + index; a live leaf ends at its own screen', () => {
  const idx = sw.guideNodeIndex(liveIdentity(NEST));
  const opts = { livePath: 'docs/pages/x.md', title: 'X' };
  const deep = idx.byPath.get('1.0.0.0.0.0');
  const t = sw.sideTrail(deep, idx, 'draft', opts);
  assert.deepEqual(t.map(e => e.name), ['openGuideEntry', 'openEditGuideSection', 'openEditContentTabs', 'openEditGrid', 'openEditGridCell', 'openEditGuideAdmonition']);
  assert.deepEqual(t[0].args, { filePath: 'docs/pages/x.md', label: 'X' });
  assert.equal(t[2].args.tab, 0);
  const grid = idx.byPath.get('1.0.0.0');
  assert.deepEqual(t[4].args, { uuid: grid.uuid, file: 'docs/drafts/x.md', index: 0 });
  assert.ok(t.slice(1).every(e => e.args.file === 'docs/drafts/x.md'));
  const leaf = idx.byPath.get('1.1.0');
  assert.equal(sw.sideTrail(leaf, idx, 'live', opts).at(-1).args.path.join('.'), '1.1.0');
});

await test('sideTrail: a capture / image leaf opens its own live media screen; on the draft side it ends at its container', () => {
  const idx = sw.guideNodeIndex(liveIdentity(MEDIA));
  const opts = { livePath: 'docs/pages/x.md', title: 'X' };
  const t = sw.sideTrail(idx.byPath.get('1.6.0'), idx, 'live', opts);
  assert.deepEqual(t.map(e => e.name), ['openGuideEntry', 'openGuideSectionLiveView', 'openComponentLiveView', 'openComponentLiveView']);
  assert.deepEqual(t.at(-1), { name: 'openComponentLiveView', args: { file: 'docs/pages/x.md', path: [1, 6, 0], label: 'X' }, label: 'Image', formName: 'editCaptureComponent' });
  assert.equal(sw.sideTrail(idx.byPath.get('1.0'), idx, 'draft', opts).at(-1).name, 'openEditGuideSection');
  assert.equal(sw.sideTrail(idx.byPath.get('1.3'), idx, 'live', opts).at(-1).formName, 'editDataTable', 'a table opens its own live screen');
});

await test('switchTitle: a media leaf with no draft screen names its holder — section when top-level, container when nested', () => {
  const idx = sw.guideNodeIndex(liveIdentity(MEDIA));
  const title = path => sw.switchTitle({ spec: { locate: () => idx.byPath.get(path) }, args: {}, formEl: {}, side: 'live', idx: { live: idx, draft: idx } });
  assert.equal(title('1.0'), 'Switch to draft (opens the section holding this component)');
  assert.equal(title('1.6.0'), 'Switch to draft (opens the container holding this component)');
  assert.equal(title('1.3'), 'Switch to draft', 'a table has a draft editor of its own');
});

await test('onFormActionComplete: before/after bracket a resolved action, a throw skips after', async () => {
  const { onFormActionComplete } = await import('../scripts/formActions.js');
  const seen = [];
  onFormActionComplete({ before: () => 'mark', after: (name, args, mark) => seen.push([name, args, mark]) });
  registerFormAction('hookProbeOk', async () => 1);
  registerFormAction('hookProbeThrow', async () => { throw new Error('x'); });
  assert.equal(await getFormAction('hookProbeOk')({ a: 1 }), 1);
  await assert.rejects(getFormAction('hookProbeThrow')({}));
  assert.deepEqual(seen.filter(s => s[0].startsWith('hookProbe')), [['hookProbeOk', { a: 1 }, 'mark']]);
});

await test('component screen bodies mirror their draft editors, every control frozen', () => {
  const tab = live.tabBodyHtml({ title: 'Two <b>', description: 'Two *text*' });
  assert.ok(tab.includes('<label class="more-buttons-label">Title</label><input type="text" readonly value="Two &lt;b&gt;" />'));
  assert.ok(tab.includes('<label class="more-buttons-label">Description</label><textarea rows="6" readonly data-richtext>Two *text*</textarea>'));
  assert.ok(tab.includes('<label class="more-buttons-label">Components</label><div><div data-view-components></div></div>'));

  const cell = live.gridCellBodyHtml({ description: 'Cell.', spill: true, valign: 'middle' });
  for (const l of ['Cell content', 'Allow Spill', 'Vertical alignment', 'Components']) assert.ok(cell.includes(`<label class="more-buttons-label">${l}</label>`), l);
  assert.equal(count(cell, /<input type="radio" disabled/g), 6, 'two spill pills + four alignment pills');
  assert.equal(count(cell, /<input type="radio" disabled checked/g), 2);
  assert.ok(cell.includes('disabled checked /> True') && cell.includes('disabled checked /> Middle'));
  assert.ok(!cell.includes('name='), 'nameless pills: nothing to hydrate or submit');

  const grid = live.gridBodyHtml('card');
  assert.ok(grid.includes('disabled /> Plain') && grid.includes('disabled checked /> Cards'));
  assert.ok(grid.includes('<label class="more-buttons-label">Cells</label><div><div data-view-grid-cells></div></div>'));

  const cells = live.gridCellListHtml([{ description: 'A', nComponents: 1 }, { description: '', nComponents: 0 }]);
  assert.equal(count(cells, /class="mb-insert-component" aria-hidden="true"/g), 3);
  assert.equal(count(cells, /data-grid-move-cell="(?:up|down)" disabled/g), 4);
  assert.equal(count(cells, /data-view-grid-cell="[01]"/g), 2);
  assert.equal(count(cells, /data-copy-grid-cell="[01]"/g), 2);
  assert.ok(cells.includes('<div class="mb-component-row" data-grid-cell="0">'));
});

await test('setRteDisabled readOnly: readonly textarea (not disabled), buttons off, both classes; plain disable is unchanged', async () => {
  const { setRteDisabled } = await import('../scripts/richTextEditor.js');
  const mkRte = () => {
    const cls = new Set();
    const rte = { textarea: { disabled: false, readOnly: false }, buttons: [{ disabled: false }, { disabled: false }], surface: { contentEditable: 'true', closest: () => ({ classList: { toggle: (c, on) => { on ? cls.add(c) : cls.delete(c); } } }) } };
    return { rte, cls, textarea: { closest: () => ({ _rte: rte }) } };
  };
  let { rte, cls, textarea } = mkRte();
  setRteDisabled(textarea, true, { readOnly: true });
  assert.equal(rte.textarea.disabled, false);
  assert.equal(rte.textarea.readOnly, true);
  assert.equal(rte.surface.contentEditable, 'false');
  assert.ok(rte.buttons.every(b => b.disabled));
  assert.deepEqual([...cls].sort(), ['mb-rte--disabled', 'mb-rte--readonly']);
  setRteDisabled(textarea, false);
  assert.equal(rte.textarea.readOnly, false);
  assert.ok(rte.buttons.every(b => !b.disabled));
  assert.deepEqual([...cls], []);
  ({ rte, cls, textarea } = mkRte());
  setRteDisabled(textarea, true);
  assert.equal(rte.textarea.disabled, true);
  assert.equal(rte.textarea.readOnly, false);
  assert.deepEqual([...cls], ['mb-rte--disabled']);
  // Before the upgrade ran: the flags are carried on the raw textarea.
  const raw = { closest: () => null, disabled: false, readOnly: false };
  setRteDisabled(raw, true, { readOnly: true });
  assert.deepEqual([raw.disabled, raw.readOnly], [false, true]);
});

// ── Leaf screens (table, code block, button, nav links, diagram) + page settings ──

// (Text ahead of the table: a table first in a section gets no in-memory uuid,
// a known liveIdentity quirk outside this screen.)
const LEAVES = [
  '# T', '', '## A', '', 'Intro.', '',
  '| a | b |', '| :- | -: |', '| 1 | 2 |', '',
  '```python title="sort.py"', 'print(1)', '```', '',
  '[Go](x.md){ .md-button }', '',
  '<div class="mb-nav-links" data-nav-path="guides/employees"></div>', '',
  '```mermaid', 'graph TD', '  A --> B', '```', '',
  '!!! note "Box"', '', '    ```bash', '    echo', '    ```', '',
].join('\n');

await test('liveComponentModel: table, code block, button, nav links and diagram resolve to leaf models; paths past them are null', () => {
  const kinds = live.liveSectionModel(LEAVES, 1).components.map(c => c.kind);
  assert.deepEqual(kinds, ['table', 'codeblock', 'button', 'navlinks', 'diagram', 'admonition']);
  ['table', 'codeblock', 'button', 'navlinks', 'diagram'].forEach((k, i) => {
    const m = live.liveComponentModel(LEAVES, [1, i]);
    assert.equal(m.kind, 'leaf');
    assert.equal(m.compKind, k);
    assert.equal(m.component.kind, k);
    assert.ok(m.uuid, `${k} has an in-memory uuid`);
    assert.equal(live.liveComponentModel(LEAVES, [1, i, 0]), null, `a path cannot continue past a ${k}`);
  });
  const nested = live.liveComponentModel(LEAVES, [1, 5, 0]);
  assert.equal(nested.compKind, 'codeblock', 'a code block inside an admonition');
  assert.equal(nested.component.cb.code, 'echo');
  assert.equal(live.liveComponentModel(LEAVES, [1, 0]).component.tbl.align[1], 'right');
});

await test('liveComponentHeading: leaf wording follows the editors (code block title, button label, nav path, diagram first line)', () => {
  const h = i => live.liveComponentHeading(live.liveComponentModel(LEAVES, [1, i]));
  assert.deepEqual(h(0), { html: 'Data table', crumb: 'Data table' });
  assert.deepEqual(h(1), { html: 'sort.py', crumb: 'sort.py' });
  assert.deepEqual(h(2), { html: 'Go', crumb: 'Go' });
  assert.deepEqual(h(3), { html: 'guides/employees', crumb: 'guides/employees' });
  assert.deepEqual(h(4), { html: 'Diagram', crumb: 'graph TD' });
  assert.deepEqual(live.liveComponentHeading(live.liveComponentModel(LEAVES, [1, 5, 0])), { html: 'Code block', crumb: 'bash' }, 'untitled: Code block heading, editor crumb (language)');
});

await test('liveComponentFormName: each leaf reuses its draft editor template; media kinds the capture editor', () => {
  assert.deepEqual(['table', 'codeblock', 'button', 'navlinks', 'diagram'].map(live.liveComponentFormName),
    ['editDataTable', 'editCodeBlock', 'editButton', 'editNavLinks', 'editDiagram']);
  for (const k of ['capture', 'video', 'image', 'media']) assert.equal(live.liveComponentFormName(k), 'editCaptureComponent');
});

await test('liveLeafSeed: the same storage dict the draft openers seed', async () => {
  const { codeBlockDimFields } = await import('../scripts/mdCodeBlocks.js');
  const m = i => live.liveComponentModel(LEAVES, [1, i]).component;
  assert.deepEqual(JSON.parse(live.liveLeafSeed('table', m(0)).moreButtonsEditDataTable.tableState),
    { align: ['left', 'right'], header: ['a', 'b'], rows: [['1', '2']], wrap: m(0).tbl.wrap });
  assert.deepEqual(live.liveLeafSeed('codeblock', m(1)), { moreButtonsEditCodeBlock: codeBlockDimFields(m(1).cb) });
  assert.equal(live.liveLeafSeed('codeblock', m(1)).moreButtonsEditCodeBlock.codeTitle, 'sort.py');
  assert.equal(live.liveLeafSeed('button', m(2)).moreButtonsEditButton.buttonLabel, 'Go');
  assert.equal(live.liveLeafSeed('navlinks', m(3)).moreButtonsEditNavLinks.navPath, 'guides/employees');
  assert.deepEqual(live.liveLeafSeed('diagram', m(4)), { moreButtonsEditDiagram: { diagramCode: 'graph TD\n  A --> B' } });
});

await test('view-only renderComponents: View on every leaf card (table, code block, button, nav links, diagram)', () => {
  const list = fakeList(true);
  renderComponents(list, live.liveSectionModel(LEAVES, 1).components, true, { viewOnly: true });
  assert.deepEqual([...list.innerHTML.matchAll(/data-view-component="(\d+)"/g)].map(x => x[1]), ['0', '1', '2', '3', '4', '5']);
  assert.equal(count(list.innerHTML, /data-edit-/g), 0);
});

await test('sideTrail: a live leaf opens its own screen; the same leaf on the draft side opens its editor by uuid', () => {
  const idx = sw.guideNodeIndex(liveIdentity(LEAVES));
  const opts = { livePath: 'docs/pages/x.md', title: 'X' };
  const cb = idx.byPath.get('1.5.0');
  const t = sw.sideTrail(cb, idx, 'live', opts);
  assert.deepEqual(t.map(e => e.name), ['openGuideEntry', 'openGuideSectionLiveView', 'openComponentLiveView', 'openComponentLiveView']);
  assert.deepEqual(t.at(-1), { name: 'openComponentLiveView', args: { file: 'docs/pages/x.md', path: [1, 5, 0], label: 'X' }, label: 'Code block', formName: 'editCodeBlock' });
  const d = sw.sideTrail(idx.byPath.get('1.0'), idx, 'draft', opts);
  assert.deepEqual(d.at(-1), { name: 'openEditDataTable', args: { uuid: idx.byPath.get('1.0').uuid, file: 'docs/drafts/x.md' }, label: 'Data table', formName: 'editDataTable' });
  assert.equal(sw.sideTrail(cb, idx, 'draft', opts).at(-1).name, 'openEditCodeBlock');
});

await test('sideTrail / counterpartNode: page settings is entry → settings on both sides, its own counterpart', () => {
  const idx = sw.guideNodeIndex(liveIdentity(LEAVES));
  const opts = { livePath: 'docs/pages/x.md', title: 'X' };
  assert.deepEqual(sw.counterpartNode(sw.PAGE_SETTINGS_NODE, idx, idx), { node: sw.PAGE_SETTINGS_NODE, exact: true });
  assert.deepEqual(sw.sideTrail(sw.PAGE_SETTINGS_NODE, idx, 'live', opts), [
    { name: 'openGuideEntry', args: { filePath: 'docs/pages/x.md', label: 'X', mode: 'live' }, label: 'X', formName: 'guideEntry' },
    { name: 'openPageSettingsLiveView', args: { file: 'docs/pages/x.md', label: 'X' }, label: 'Page settings', formName: 'editPageSettings' },
  ]);
  assert.deepEqual(sw.sideTrail(sw.PAGE_SETTINGS_NODE, idx, 'draft', opts).map(e => [e.name, e.args]), [
    ['openGuideEntry', { filePath: 'docs/pages/x.md', label: 'X' }],
    ['openEditPageSettings', { file: 'docs/drafts/x.md' }],
  ]);
});

await test('pageSettingsDimFields: frontmatter + zensical.toml → the settings form values (the live screen reads the live file)', async () => {
  const { pageSettingsDimFields } = await import('../scripts/guides.js');
  const md = ['---', 'icon: lucide/star', 'tags:', '  - Using OCC', '  - System', 'hide:', '  - toc', '  - written-for', '---', '', '# T', ''].join('\n');
  const toml = ['[project]', 'nav = []', 'unlisted_nav = [', '  { "Guides" = [', '    { "X" = "pages/x.md" },', '  ] },', ']', ''].join('\n');
  const f = pageSettingsDimFields(md, toml, 'docs/pages/x.md');
  assert.deepEqual(f, { icon: 'lucide/star', writtenFor: 'users', tags: 'System', hideNavigation: false, hideToc: true, hidePath: false, hideWrittenFor: true, visibility: 'unlisted' });
  assert.equal(pageSettingsDimFields(md, '', 'docs/pages/x.md').visibility, 'public');
});

await test('live entry: the page settings row opens the read-only settings screen; the opener is registered and GET-only', async () => {
  assert.ok(renderPageSettingsNode().includes('<button class="mb-kb-node-row" type="button" data-edit-page-settings>'), 'the draft entry keeps the edit row');
  assert.ok(renderPageSettingsNode({ view: true }).includes('type="button" data-view-page-settings>'));
  assert.ok(!renderPageSettingsNode({ view: true }).includes('data-edit-page-settings'));
  assert.ok(getFormAction('openPageSettingsLiveView'));
  const calls = stubFetch({ 'zensical.toml': '' });
  const alerts = [];
  globalThis.alert = m => alerts.push(m);
  await getFormAction('openPageSettingsLiveView')({ file: 'docs/pages/missing.md', label: 'M' });
  assert.deepEqual(alerts, ['Live page not found at docs/pages/missing.md']);
  assert.ok(calls.every(c => c.method === 'GET'));
});

// ── Write safety of the editor modules the live screens reuse ───────────────

// A small element tree: enough of the DOM for tagChips / codeRichEditor to
// build their widgets. querySelector on an innerHTML-filled element hands back
// one stable stand-in per selector (those templates are never re-parsed).
function fakeDom() {
  const kids = el => el.children.filter(c => c.nodeType === 1);
  const desc = el => kids(el).flatMap(c => [c, ...desc(c)]);
  const matches = (el, sel) => sel.startsWith('.') && sel.slice(1).split('.').every(c => el.classList.contains(c));
  const detach = n => { if (n.parentNode) { n.parentNode.children.splice(n.parentNode.children.indexOf(n), 1); n.parentNode = null; } };
  const adopt = (parent, n, at) => {
    const list = n.frag ? n.children.splice(0) : [n];
    list.forEach(x => detach(x));
    parent.children.splice(at, 0, ...list);
    list.forEach(x => { x.parentNode = parent; });
  };
  const text = t => ({ nodeType: 3, nodeName: '#text', nodeValue: t, parentNode: null, remove() { detach(this); } });
  const mk = tag => {
    const attrs = {}, listeners = {}, memo = {};
    const el = {
      nodeType: 1, tagName: tag.toUpperCase(), nodeName: tag.toUpperCase(), children: [], parentNode: null,
      className: '', textContent: '', hidden: false, disabled: false, dataset: {}, listeners, attrs, _html: '',
      style: { setProperty(k, v) { this[k] = v; } }, scrollWidth: 0, clientWidth: 0, scrollLeft: 0,
      get childNodes() { return el.children; },
      get firstChild() { return el.children[0] ?? null; },
      get innerHTML() { return el._html; }, set innerHTML(v) { el._html = v; el.children.splice(0); },
      classList: {
        list: () => el.className.split(/\s+/).filter(Boolean),
        contains: c => el.classList.list().includes(c),
        add: (...cs) => { el.className = [...new Set([...el.classList.list(), ...cs])].join(' '); },
        remove: (...cs) => { el.className = el.classList.list().filter(x => !cs.includes(x)).join(' '); },
        toggle: (c, on = !el.classList.contains(c)) => { on ? el.classList.add(c) : el.classList.remove(c); return on; },
      },
      setAttribute(k, v) { attrs[k] = String(v); }, getAttribute: k => attrs[k] ?? null,
      addEventListener(t, fn) { (listeners[t] ??= []).push(fn); }, removeEventListener() {},
      dispatchEvent: () => true, focus() {}, closest: () => null,
      appendChild(n) { adopt(el, n, el.children.length); return n; },
      append(...ns) { ns.forEach(n => adopt(el, typeof n === 'string' ? text(n) : n, el.children.length)); },
      insertBefore(n, ref) { const i = ref ? el.children.indexOf(ref) : -1; adopt(el, n, i < 0 ? el.children.length : i); return n; },
      replaceChildren(...ns) { el.children.splice(0).forEach(c => { c.parentNode = null; }); el.append(...ns); },
      insertAdjacentElement(where, n) { const p = el.parentNode; adopt(p, n, p.children.indexOf(el) + (where === 'afterend' ? 1 : 0)); return n; },
      remove() { detach(el); },
      contains: n => n === el || desc(el).includes(n),
      querySelector(sel) {
        if (el._html) return (memo[sel] ??= mk('div'));
        return desc(el).find(c => matches(c, sel)) ?? null;
      },
      querySelectorAll(sel) {
        const direct = sel.startsWith(':scope > ');
        const s = sel.replace(':scope > ', '');
        return (direct ? kids(el) : desc(el)).filter(c => matches(c, s));
      },
    };
    return el;
  };
  const doc = {
    createElement: mk, createTextNode: text,
    createDocumentFragment: () => Object.assign(mk('#fragment'), { frag: true }),
    addEventListener() {}, removeEventListener() {}, execCommand: () => false,
  };
  doc.body = mk('body');
  return { doc, mk, desc };
}

await test('attachTagChips readOnly: chips only — the add button is hidden and no chip has a remove ×', async () => {
  const { attachTagChips } = await import('../scripts/tagChips.js');
  const { doc, mk, desc } = fakeDom();
  const field = mk('div');
  const input = Object.assign(mk('input'), { ownerDocument: doc, value: 'System, Using OCC' });
  field.appendChild(input);
  const api = attachTagChips(input, { readOnly: true, removable: true });
  const chips = api.host.querySelectorAll(':scope > .mb-tag-chip');
  assert.deepEqual(chips.map(c => c.dataset.tag), ['System', 'Using OCC']);
  assert.ok(chips.every(c => c.classList.contains('--static')));
  assert.equal(desc(api.host).filter(c => c.classList.contains('mb-tag-chip__remove')).length, 0, 'no remove affordance');
  const add = desc(api.host).find(c => c.classList.contains('mb-tag-chips__add'));
  assert.ok(add.hidden && add.style.display === 'none', 'the add control is not offered');
  // The editable widget, for contrast: a × per chip and a visible add button.
  const input2 = Object.assign(mk('input'), { ownerDocument: doc, value: 'System' });
  mk('div').appendChild(input2);
  const api2 = attachTagChips(input2, {});
  assert.equal(desc(api2.host).filter(c => c.classList.contains('mb-tag-chip__remove')).length, 1);
  assert.ok(!desc(api2.host).find(c => c.classList.contains('mb-tag-chips__add')).hidden);
});

await test('wireTableEditor view-only: Delete, a typed key, Cmd-X and paste leave the table unchanged; Cmd/Ctrl-C and Cmd-X still copy the TSV', async () => {
  const { wireTableEditor } = await import('../scripts/dataTablesEditor.js');
  const on = () => { const l = {}; return { l, addEventListener(t, fn) { (l[t] ??= []).push(fn); } }; };
  const wrap = on();
  const form = on();
  const formEl = { ...form, _dtViewOnly: true, _refreshSaveState() { throw new Error('no save-state refresh in view-only'); },
    querySelector: sel => (sel === '[data-dt-grid-wrap]' ? wrap : null),
    _dt: { uuid: 'T', file: 'docs/pages/x.md', align: ['left', 'right'], header: ['a', 'b'], rows: [['1', '2']], wrap: true, selected: { row: 0, col: 0 }, anchor: { row: 0, col: 1 } } };
  wireTableEditor(formEl);
  const before = structuredClone(formEl._dt);
  const writes = [];
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: t => { writes.push(t); return Promise.resolve(); } } } });
  try {
    const key = (k, mods = {}) => {
      let prevented = false;
      const e = { key: k, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...mods, preventDefault() { prevented = true; } };
      wrap.l.keydown.forEach(fn => fn(e));
      return prevented;
    };
    for (const k of ['Delete', 'Backspace', 'Enter', 'F2', 'q']) {
      assert.equal(key(k), false, `${k} is not handled`);
      assert.deepEqual(formEl._dt, before, `${k} leaves the table alone`);
    }
    key('x', { metaKey: true });
    assert.deepEqual(formEl._dt, before, 'Cmd-X does not clear');
    key('c', { ctrlKey: true });
    key('c', { metaKey: true });
    assert.deepEqual(writes, ['1\t2', '1\t2', '1\t2'], 'Cmd-X, Ctrl-C and Cmd-C each write the range as TSV');
    let pasted = false;
    wrap.l.paste.forEach(fn => fn({ clipboardData: { getData: () => { pasted = true; return 'z'; } }, preventDefault() {} }));
    assert.equal(pasted, false, 'paste never reads the clipboard');
    form.l.dblclick.forEach(fn => fn({ target: { closest: () => { throw new Error('dblclick must bail first'); } } }));
    form.l.contextmenu.forEach(fn => fn({ target: { closest: () => { throw new Error('contextmenu must bail first'); } } }));
    assert.deepEqual(formEl._dt, before);
  } finally {
    if (prev) Object.defineProperty(globalThis, 'navigator', prev); else delete globalThis.navigator;
  }
});

await test('upgradeCodeTextarea readOnly: the surface is not editable, Add annotation and Delete annotation are hidden, orphans get no Insert/Remove', async () => {
  const { upgradeCodeTextarea } = await import('../scripts/codeRichEditor.js');
  const { doc, mk, desc } = fakeDom();
  const savedDoc = globalThis.document;
  const savedRO = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.document = doc;
  try {
    const build = readOnly => {
      const form = mk('form');
      const field = mk('div');
      form.appendChild(field);
      const ta = Object.assign(mk('textarea'), { value: 'echo hi', placeholder: '', readOnly: false, closest: s => (s === 'form' ? form : null) });
      field.appendChild(ta);
      const annotationsInput = Object.assign(mk('input'), { value: 'Lost note' });
      const langInput = Object.assign(mk('input'), { value: 'bash' });
      const res = upgradeCodeTextarea(ta, { langInput, annotationsInput, readOnly });
      const addBtn = desc(res.wrapper).find(c => c.getAttribute('aria-label') === 'Add annotation');
      const pop = desc(res.wrapper).find(c => c.classList.contains('mb-codeann-popover'));
      const orphanBtns = desc(res.wrapper).filter(c => c.classList.contains('mb-cre__orphan-btn'));
      return { ta, res, addBtn, pop, orphanBtns };
    };
    const ro = build(true);
    assert.equal(ro.res.surface.contentEditable, 'false');
    assert.equal(ro.res.surface.getAttribute('aria-readonly'), 'true');
    assert.equal(ro.ta.readOnly, true, 'Raw mode is read-only too');
    assert.equal(ro.addBtn.style.display, 'none', 'no Add annotation control');
    assert.equal(ro.pop.querySelector('[data-codeann-delete]').style.display, 'none');
    assert.equal(ro.orphanBtns.length, 0, 'an orphan annotation shows without Insert / Remove');
    const ed = build(false);
    assert.equal(ed.res.surface.contentEditable, 'true');
    assert.notEqual(ed.addBtn.style.display, 'none');
    assert.equal(ed.orphanBtns.length, 2);
  } finally {
    globalThis.document = savedDoc;
    globalThis.ResizeObserver = savedRO;
  }
});


// ── View draft in every draft dock ───────────────────────────────────────────

await test('draftLinkHtml: published draft URL, marked for the dock decorator', async () => {
  const { draftLinkHtml } = await import('../scripts/guides.js');
  const a = draftLinkHtml('docs/pages/x.md');
  assert.ok(a.includes('data-view-draft-link') && a.includes('View draft') && a.includes('target="_blank"'));
  assert.ok(a.includes('drafts/x'), a);
  assert.ok(!a.includes('View live'));
});

await test('draftFileOf: draft edit and create screens resolve their draft file; live screens and unrelated actions do not', () => {
  assert.equal(sw.draftFileOf('openEditGuideSection', { uuid: 'U', file: 'docs/drafts/x.md' }), 'docs/drafts/x.md');
  assert.equal(sw.draftFileOf('openEditCaptureComponent', { container: { file: 'docs/drafts/x.md' }, uuid: 'U' }), 'docs/drafts/x.md');
  assert.equal(sw.draftFileOf('openEditPageSettings', { file: 'docs/drafts/x.md' }), 'docs/drafts/x.md');
  assert.equal(sw.draftFileOf('openCreateGuideSection', { parentUuid: 'P', file: 'docs/drafts/x.md' }), 'docs/drafts/x.md');
  assert.equal(sw.draftFileOf('openCreateButton', { container: { kind: 'guide-section', uuid: 'U', file: 'docs/drafts/x.md' } }), 'docs/drafts/x.md');
  assert.equal(sw.draftFileOf('openCreateGuide', { label: 'New' }), null);
  assert.equal(sw.draftFileOf('openComponentLiveView', { file: 'docs/pages/x.md', path: [1, 0] }), null);
  assert.equal(sw.draftFileOf('openKnowledgeBaseManagement', {}), null);
});

await test('draftDockPrefixHtml: the link then a dock separator', () => {
  const h = sw.draftDockPrefixHtml('docs/pages/x.md');
  assert.ok(h.startsWith('<a class="more-buttons-button"') && h.endsWith('<span class="mb-dock-sep" aria-hidden="true"></span>'));
});


console.log(`\n${passed} passed`);
