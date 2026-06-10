import assert from 'node:assert/strict';
import {
  locateTabGroups, buildTabGroup, getTabGroupByUUID, locateTabByUUID,
  replaceTabGroupByUUID, deleteTabGroupByUUID, ensureTabUUIDs,
} from '../scripts/contentTabs.js';
import {
  parseComponents, buildComponentBody, uuidOfComponent,
  readTabComponents, writeTabBody,
} from '../scripts/components.js';
import { migrateComponentIdentity } from '../scripts/github.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const span = (uuid, indent = '') => `${indent}<span data-uuid="${uuid}" style="display:none"></span>`;

// A canonical two-tab group, fully migrated.
const GROUP_MD = [
  span('GRP'),
  '=== "One"',
  '',
  span('T1', '    '),
  '    First tab text.',
  '',
  '=== "Two"',
  '',
  span('T2', '    '),
  '    Second tab text.',
].join('\n');

// ── locateTabGroups ───────────────────────────────────────────────────────────

test('locateTabGroups: group span + per-tab spans, titles, dedented bodies', () => {
  const [g] = locateTabGroups(GROUP_MD);
  assert.equal(g.uuid, 'GRP');
  assert.equal(g.indent, '');
  assert.equal(g.startLine, 0);
  assert.equal(g.endLine, 10);
  assert.deepEqual(g.tabs.map(t => t.title), ['One', 'Two']);
  assert.deepEqual(g.tabs.map(t => t.uuid), ['T1', 'T2']);
  assert.equal(g.tabs[0].body, `${span('T1')}\nFirst tab text.`);
  assert.equal(g.tabs[1].body, `${span('T2')}\nSecond tab text.`);
});

test('locateTabGroups: group without identity span has uuid=null, startLine on the header', () => {
  const md = ['=== "Solo"', '', '    Text.'].join('\n');
  const [g] = locateTabGroups(md);
  assert.equal(g.uuid, null);
  assert.equal(g.startLine, 0);
  assert.equal(g.tabs[0].uuid, null);
});

test('locateTabGroups: consecutive same-indent headers are ONE group (matches skipTabBlocks)', () => {
  const md = ['=== "A"', '', '    a', '', '=== "B"', '', '    b'].join('\n');
  const groups = locateTabGroups(md);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].tabs.length, 2);
});

test('locateTabGroups: an adjacent group with its own span line is a SEPARATE group', () => {
  const md = [
    span('G1'), '=== "A"', '', '    a', '',
    span('G2'), '=== "B"', '', '    b',
  ].join('\n');
  const groups = locateTabGroups(md);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(g => g.uuid), ['G1', 'G2']);
});

test('locateTabGroups: a nested group inside a tab body is consumed, not a sibling', () => {
  const md = [
    '=== "Outer"', '',
    '    === "Inner"', '',
    '        Inner text.',
  ].join('\n');
  const groups = locateTabGroups(md);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].tabs[0].title, 'Outer');
  assert.match(groups[0].tabs[0].body, /=== "Inner"/);
});

test('locateTabGroups: a group inside an admonition body is found at its deeper indent', () => {
  const md = [
    '!!! note "N"', '',
    span('ADM', '    '), '',
    span('G', '    '),
    '    === "X"', '',
    span('TX', '        '),
    '        x',
  ].join('\n');
  const [g] = locateTabGroups(md);
  assert.equal(g.uuid, 'G');
  assert.equal(g.indent, '    ');
  assert.equal(g.tabs[0].uuid, 'TX');
});

// ── buildTabGroup round-trip ──────────────────────────────────────────────────

test('buildTabGroup: inverse of locateTabGroups (byte-for-byte round-trip)', () => {
  const [g] = locateTabGroups(GROUP_MD);
  assert.equal(buildTabGroup(g.uuid, g.tabs), GROUP_MD);
});

// ── getTabGroupByUUID / locateTabByUUID ───────────────────────────────────────

test('getTabGroupByUUID: parses a nested group out of the raw document', () => {
  const md = [
    '!!! note "N"', '',
    span('ADM', '    '), '',
    span('G', '    '),
    '    === "X"', '',
    span('TX', '        '),
    '        x',
  ].join('\n');
  const grp = getTabGroupByUUID(md, 'G');
  assert.equal(grp.uuid, 'G');
  assert.equal(grp.indent, '    ');
  assert.deepEqual(grp.tabs.map(t => t.uuid), ['TX']);
  assert.equal(grp.tabs[0].body, `${span('TX')}\nx`);
});

test('getTabGroupByUUID: a TAB uuid is not mistaken for a group', () => {
  assert.equal(getTabGroupByUUID(GROUP_MD, 'T1'), null);
});

test('locateTabByUUID: finds a top-level tab (header, extent, title)', () => {
  const lines = GROUP_MD.split('\n');
  const loc = locateTabByUUID(lines, 'T1');
  assert.equal(loc.headerLine, 1);
  assert.equal(loc.endLine, 5);
  assert.equal(loc.headerIndent, '');
  assert.equal(loc.title, 'One');
});

test('locateTabByUUID: finds a tab nested inside an admonition', () => {
  const lines = [
    '!!! note "N"', '',
    span('ADM', '    '), '',
    span('G', '    '),
    '    === "X"', '',
    span('TX', '        '),
    '        x',
  ];
  const loc = locateTabByUUID(lines, 'TX');
  assert.equal(loc.headerLine, 5);
  assert.equal(loc.headerIndent, '    ');
  assert.equal(loc.title, 'X');
});

test('locateTabByUUID: a GROUP uuid is not mistaken for a tab', () => {
  assert.equal(locateTabByUUID(GROUP_MD.split('\n'), 'GRP'), null);
});

// ── replace / delete by UUID ──────────────────────────────────────────────────

test('replaceTabGroupByUUID: replaces in place, re-indented to the original depth', () => {
  const md = [
    '!!! note "N"', '',
    span('ADM', '    '), '',
    span('G', '    '),
    '    === "X"', '',
    span('TX', '        '),
    '        x',
  ].join('\n');
  const out = replaceTabGroupByUUID(md, 'G', buildTabGroup('G', [{ title: 'Y', body: `${span('TX')}\ny2` }]));
  assert.match(out, /^ {4}=== "Y"$/m);
  assert.match(out, /^ {8}y2$/m);
  assert.ok(!out.includes('=== "X"'));
  assert.ok(out.startsWith('!!! note "N"'));
});

test('deleteTabGroupByUUID: removes the block plus one trailing blank line', () => {
  const md = ['Before.', '', GROUP_MD, '', 'After.'].join('\n');
  const out = deleteTabGroupByUUID(md, 'GRP');
  assert.equal(out, ['Before.', '', 'After.'].join('\n'));
});

test('replace/delete: unknown uuid leaves the document unchanged', () => {
  assert.equal(replaceTabGroupByUUID(GROUP_MD, 'NOPE', 'x'), GROUP_MD);
  assert.equal(deleteTabGroupByUUID(GROUP_MD, 'NOPE'), GROUP_MD);
});

// ── ensureTabUUIDs ────────────────────────────────────────────────────────────

test('ensureTabUUIDs: backfills the group span and every per-tab span', () => {
  const bare = ['=== "One"', '', '    Text one.', '', '=== "Two"', '', '    Text two.'].join('\n');
  const out = ensureTabUUIDs(bare);
  const [g] = locateTabGroups(out);
  assert.ok(g.uuid, 'group should have a uuid');
  assert.ok(g.tabs[0].uuid && g.tabs[1].uuid, 'both tabs should have uuids');
  assert.notEqual(g.tabs[0].uuid, g.tabs[1].uuid);
  // span, blank (capture-rule guard, see injectTabUUID), then the original text
  assert.deepEqual(g.tabs[0].body.split('\n').slice(1), ['', 'Text one.']);
});

test('ensureTabUUIDs: idempotent (a migrated group reads through unchanged)', () => {
  const once = ensureTabUUIDs(['=== "One"', '', '    Text.'].join('\n'));
  assert.equal(ensureTabUUIDs(once), once);
  assert.equal(ensureTabUUIDs(GROUP_MD), GROUP_MD);
});

test('ensureTabUUIDs: recurses into nested groups (tabs inside tabs)', () => {
  const nested = ['=== "Outer"', '', '    === "Inner"', '', '        Inner text.'].join('\n');
  const out = ensureTabUUIDs(nested);
  // outer group + outer tab + inner group + inner tab = 4 identity spans
  assert.equal((out.match(/data-uuid=/g) || []).length, 4);
  assert.equal(ensureTabUUIDs(out), out);
  // The outer tab's own span must not be confused with the inner group's span.
  const [outer] = locateTabGroups(out);
  const innerGroups = locateTabGroups(outer.tabs[0].body);
  assert.equal(innerGroups.length, 1);
  assert.notEqual(outer.tabs[0].uuid, innerGroups[0].uuid);
});

// ── parseComponents / buildComponentBody integration ──────────────────────────

const INTEGRATION_BODY = [
  'Intro description.',
  '',
  '!!! note "A note"',
  '',
  span('ADM', '    '),
  '    Note text.',
  '',
  span('GRP'),
  '=== "One"',
  '',
  span('T1', '    '),
  '    Tab text.',
  '',
  '    !!! tip "Nested"',
  '',
  span('NEST', '        '),
  '        Nested tip.',
  '',
  span('CAP'),
  '![](../assets/x-light-mode.png#only-light){ width="800" }',
  '![](../assets/x-dark-mode.png#only-dark)',
].join('\n');

test('parseComponents: tabs interleave with admonitions + captures in document order', () => {
  const { description, components } = parseComponents(INTEGRATION_BODY, /step|note|tip/);
  assert.equal(description, 'Intro description.');
  assert.deepEqual(components.map(c => c.kind), ['admonition', 'tabs', 'capture']);
  assert.deepEqual(components.map(uuidOfComponent), ['ADM', 'GRP', 'CAP']);
});

test('parseComponents: an admonition inside a tab is NOT a sibling component', () => {
  const { components } = parseComponents(INTEGRATION_BODY, /step|note|tip/);
  assert.ok(!components.some(c => c.kind === 'admonition' && c.adm.uuid === 'NEST'));
  const tabs = components.find(c => c.kind === 'tabs');
  assert.match(tabs.grp.tabs[0].body, /Nested tip\./);
});

test('buildComponentBody: kind=tabs round-trips through parseComponents', () => {
  const { description, components } = parseComponents(INTEGRATION_BODY, /step|note|tip/);
  const rebuilt = buildComponentBody(null, description, components);
  const again = parseComponents(rebuilt, /step|note|tip/);
  assert.equal(again.description, description);
  assert.deepEqual(again.components.map(c => c.kind), ['admonition', 'tabs', 'capture']);
  assert.deepEqual(again.components.map(uuidOfComponent), ['ADM', 'GRP', 'CAP']);
  assert.deepEqual(again.components.find(c => c.kind === 'tabs').grp.tabs,
                   components.find(c => c.kind === 'tabs').grp.tabs);
});

test('uuidOfComponent: tabs branch returns the group uuid', () => {
  assert.equal(uuidOfComponent({ kind: 'tabs', grp: { uuid: 'G9', tabs: [] } }), 'G9');
});

// ── Tab containers: readTabComponents / writeTabBody ──────────────────────────

test('readTabComponents: a tab body parses as a container (description + components)', () => {
  const { description, components } = readTabComponents(INTEGRATION_BODY, 'T1');
  assert.equal(description, 'Tab text.');
  assert.equal(components.length, 1);
  assert.equal(components[0].kind, 'admonition');
  assert.equal(components[0].adm.uuid, 'NEST');
});

test('writeTabBody: rewrites a tab description, preserving its components', () => {
  const out = writeTabBody(INTEGRATION_BODY, 'T1', 'Edited tab text.', readTabComponents(INTEGRATION_BODY, 'T1').components);
  const { description, components } = readTabComponents(out, 'T1');
  assert.equal(description, 'Edited tab text.');
  assert.equal(components[0].adm.uuid, 'NEST');
  // Siblings outside the tab untouched.
  const { components: top } = parseComponents(out, /step|note|tip/);
  assert.deepEqual(top.map(uuidOfComponent), ['ADM', 'GRP', 'CAP']);
});

test('writeTabBody: unknown tab uuid is a no-op', () => {
  assert.equal(writeTabBody(INTEGRATION_BODY, 'NOPE', 'x', []), INTEGRATION_BODY);
});

// ── Identity migration ────────────────────────────────────────────────────────

test('migrateComponentIdentity: pre-existing tab blocks in guide markdown get uuids', () => {
  const md = ['# Title', '', '=== "One"', '', '    Hello.'].join('\n');
  const out = migrateComponentIdentity('docs/drafts/some-guide.md', md);
  const [g] = locateTabGroups(out);
  assert.ok(g.uuid, 'group uuid backfilled');
  assert.ok(g.tabs[0].uuid, 'tab uuid backfilled');
  assert.equal(migrateComponentIdentity('docs/drafts/some-guide.md', out), out);
});

test('migrateComponentIdentity: tab blocks in system-updates bodies get uuids', () => {
  const md = [
    '??? feature-release "Feature release: X<span class="meta">5th June 2026</span>"',
    '',
    '    === "One"',
    '',
    '        Hello.',
  ].join('\n');
  const out = migrateComponentIdentity('docs/drafts/system-updates.md', md);
  const [g] = locateTabGroups(out);
  assert.ok(g.uuid && g.tabs[0].uuid, 'group + tab uuids backfilled inside the update body');
  assert.equal(migrateComponentIdentity('docs/drafts/system-updates.md', out), out);
});

test('migrateComponentIdentity: a capture as a tab\'s first content is not stolen as the tab uuid', () => {
  const md = [
    '# Title', '',
    '=== "One"', '',
    '    ![](../assets/a-light-mode.png#only-light){ width="800" }',
    '    ![](../assets/a-dark-mode.png#only-dark)',
  ].join('\n');
  const out = migrateComponentIdentity('docs/drafts/g.md', md);
  const [g] = locateTabGroups(out);
  const { components } = readTabComponents(out, g.tabs[0].uuid);
  assert.equal(components.length, 1);
  assert.equal(components[0].kind, 'capture');
  assert.notEqual(g.tabs[0].uuid, components[0].cap.uuid);
  assert.equal(migrateComponentIdentity('docs/drafts/g.md', out), out);
});

console.log(`\n${passed} passed`);
