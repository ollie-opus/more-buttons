import assert from 'node:assert/strict';
import {
  buildNavLinksLines, locateNavLinksLines, ensureNavLinksUUIDs,
  locateNavLinksByUUID, replaceNavLinksByUUID, deleteNavLinksByUUID,
  navLinksLineFrom, navLinksDimFields,
} from '../scripts/navLinks.js';
import { parseComponents, buildComponentBody, uuidOfComponent, parsePastedComponents, componentMarkdown } from '../scripts/components.js';
import { GUIDE_ADMONITION_TYPES_RE } from '../scripts/admonitions.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// ── buildNavLinksLines: form data → markdown ─────────────────────────────────

test('build: nav-links block, no uuid', () => {
  const lines = buildNavLinksLines([{ path: 'guides/employees' }]);
  assert.deepEqual(lines, ['', '<div class="mb-nav-links" data-nav-path="guides/employees"></div>']);
});

test('build: nav-links block with uuid span', () => {
  const lines = buildNavLinksLines([{ uuid: 'u1', path: 'guides' }]);
  assert.deepEqual(lines, [
    '',
    '<span data-uuid="u1" style="display:none"></span>',
    '<div class="mb-nav-links" data-nav-path="guides"></div>',
  ]);
});

test('build: a stray double-quote in the path is dropped (cannot break the attr)', () => {
  const lines = buildNavLinksLines([{ path: 'gui"des' }]);
  assert.deepEqual(lines, ['', '<div class="mb-nav-links" data-nav-path="guides"></div>']);
});

// ── locateNavLinksLines: markdown → form data ────────────────────────────────

test('locate: bare nav-links block', () => {
  const found = locateNavLinksLines('<div class="mb-nav-links" data-nav-path="guides/employees"></div>');
  assert.equal(found.length, 1);
  assert.deepEqual(found[0], {
    uuid: null, path: 'guides/employees', tag: null, layout: null, indent: '', startLine: 0, endLine: 1,
  });
});

test('locate: nav-links block with uuid span', () => {
  const md = '<span data-uuid="u1" style="display:none"></span>\n<div class="mb-nav-links" data-nav-path="guides"></div>';
  const found = locateNavLinksLines(md);
  assert.equal(found.length, 1);
  assert.equal(found[0].uuid, 'u1');
  assert.equal(found[0].path, 'guides');
  assert.equal(found[0].startLine, 0);
  assert.equal(found[0].endLine, 2);
});

test('locate: an unrelated div is NOT a nav-links block', () => {
  assert.equal(locateNavLinksLines('<div class="grid"></div>').length, 0);
  assert.equal(locateNavLinksLines('<div data-nav-path="x"></div>').length, 0);
});

// ── round-trip: build → locate is stable ─────────────────────────────────────

for (const n of [
  { uuid: 'a', path: 'guides' },
  { uuid: 'b', path: 'guides/employees' },
  { uuid: 'c', path: 'system' },
]) {
  test(`round-trip: ${n.path}`, () => {
    const md = buildNavLinksLines([n]).join('\n');
    const got = locateNavLinksLines(md)[0];
    assert.equal(got.uuid, n.uuid);
    assert.equal(got.path, n.path);
  });
}

// ── ensureNavLinksUUIDs: backfill identity ───────────────────────────────────

test('ensure: backfills a uuid span before a span-less block', () => {
  const out = ensureNavLinksUUIDs('<div class="mb-nav-links" data-nav-path="guides"></div>');
  const loc = locateNavLinksLines(out)[0];
  assert.ok(loc.uuid, 'should have a uuid');
  assert.equal(loc.path, 'guides');
});
test('ensure: idempotent when a uuid already present', () => {
  const md = '<span data-uuid="keep" style="display:none"></span>\n<div class="mb-nav-links" data-nav-path="guides"></div>';
  assert.equal(ensureNavLinksUUIDs(md), md);
});

// ── locate/replace by uuid (edit path) ───────────────────────────────────────

test('replace: rewrites only the addressed block, keeping its span', () => {
  const md = [
    '<span data-uuid="u1" style="display:none"></span>',
    '<div class="mb-nav-links" data-nav-path="guides"></div>',
    '',
    '<span data-uuid="u2" style="display:none"></span>',
    '<div class="mb-nav-links" data-nav-path="system"></div>',
  ].join('\n');
  const newLine = navLinksLineFrom({ path: 'guides/employees' });
  const out = replaceNavLinksByUUID(md, 'u1', newLine);
  const byUuid = Object.fromEntries(locateNavLinksLines(out).map(b => [b.uuid, b]));
  assert.equal(byUuid.u1.path, 'guides/employees');
  assert.equal(byUuid.u2.path, 'system'); // untouched
  assert.ok(out.includes('data-uuid="u1"')); // span preserved
});

test('delete: removes the addressed block (span + line + trailing blank), keeps siblings', () => {
  const md = [
    'Intro.',
    '',
    '<span data-uuid="u1" style="display:none"></span>',
    '<div class="mb-nav-links" data-nav-path="guides"></div>',
    '',
    '<span data-uuid="u2" style="display:none"></span>',
    '<div class="mb-nav-links" data-nav-path="system"></div>',
  ].join('\n');
  const out = deleteNavLinksByUUID(md, 'u1');
  const left = locateNavLinksLines(out);
  assert.equal(left.length, 1);
  assert.equal(left[0].uuid, 'u2');
  assert.ok(!out.includes('data-uuid="u1"'));
  assert.ok(out.startsWith('Intro.'));
});

// ── navLinksDimFields: merge baseline ─────────────────────────────────────────

test('dimFields: maps a parsed path block to its scalar form fields', () => {
  assert.deepEqual(navLinksDimFields({ path: 'guides/employees' }), {
    navMode: 'path', navPath: 'guides/employees', navTag: '', navLayout: 'flat',
  });
  assert.deepEqual(navLinksDimFields({}), {
    navMode: 'path', navPath: '', navTag: '', navLayout: 'flat',
  });
});

test('dimFields: maps a parsed tag block to its scalar form fields', () => {
  assert.deepEqual(navLinksDimFields({ tag: 'System', layout: 'grouped' }), {
    navMode: 'tag', navPath: '', navTag: 'System', navLayout: 'grouped',
  });
});

// ── tag mode ──────────────────────────────────────────────────────────────────

test('build: tag block emits the canonical tag + layout line', () => {
  const lines = buildNavLinksLines([{ tag: 'System', layout: 'flat' }]);
  assert.deepEqual(lines, ['', '<div class="mb-nav-links" data-nav-tag="System" data-nav-layout="flat"></div>']);
});

test('build: tag block with uuid span and grouped layout', () => {
  const lines = buildNavLinksLines([{ uuid: 't1', tag: 'System', layout: 'grouped' }]);
  assert.deepEqual(lines, [
    '',
    '<span data-uuid="t1" style="display:none"></span>',
    '<div class="mb-nav-links" data-nav-tag="System" data-nav-layout="grouped"></div>',
  ]);
});

test('build: a stray double-quote in the tag is dropped, unknown layout coerced to flat', () => {
  const lines = buildNavLinksLines([{ tag: 'Sys"tem', layout: 'bogus' }]);
  assert.deepEqual(lines, ['', '<div class="mb-nav-links" data-nav-tag="System" data-nav-layout="flat"></div>']);
});

test('locate: tag block with layout attr', () => {
  const found = locateNavLinksLines('<div class="mb-nav-links" data-nav-tag="System" data-nav-layout="grouped"></div>');
  assert.equal(found.length, 1);
  assert.equal(found[0].tag, 'System');
  assert.equal(found[0].layout, 'grouped');
  assert.equal(found[0].path, null);
});

test('locate: tag block without layout attr defaults to flat', () => {
  const found = locateNavLinksLines('<div class="mb-nav-links" data-nav-tag="System"></div>');
  assert.equal(found.length, 1);
  assert.equal(found[0].tag, 'System');
  assert.equal(found[0].layout, 'flat');
});

test('locate: path block reports tag/layout as null', () => {
  const found = locateNavLinksLines('<div class="mb-nav-links" data-nav-path="guides"></div>');
  assert.equal(found[0].path, 'guides');
  assert.equal(found[0].tag, null);
  assert.equal(found[0].layout, null);
});

for (const n of [
  { uuid: 't1', tag: 'System', layout: 'flat' },
  { uuid: 't2', tag: 'Contractors', layout: 'grouped' },
]) {
  test(`round-trip: tag ${n.tag} (${n.layout})`, () => {
    const md = buildNavLinksLines([n]).join('\n');
    const got = locateNavLinksLines(md)[0];
    assert.equal(got.uuid, n.uuid);
    assert.equal(got.tag, n.tag);
    assert.equal(got.layout, n.layout);
  });
}

test('ensure: backfills a uuid span before a span-less tag block', () => {
  const out = ensureNavLinksUUIDs('<div class="mb-nav-links" data-nav-tag="System" data-nav-layout="flat"></div>');
  const loc = locateNavLinksLines(out)[0];
  assert.ok(loc.uuid, 'should have a uuid');
  assert.equal(loc.tag, 'System');
});

test('replace: flips a path block to a tag block in place, keeping its span', () => {
  const md = [
    '<span data-uuid="u1" style="display:none"></span>',
    '<div class="mb-nav-links" data-nav-path="guides"></div>',
  ].join('\n');
  const newLine = navLinksLineFrom({ mode: 'tag', tag: 'System', layout: 'grouped' });
  const out = replaceNavLinksByUUID(md, 'u1', newLine);
  const got = locateNavLinksLines(out)[0];
  assert.equal(got.uuid, 'u1');
  assert.equal(got.tag, 'System');
  assert.equal(got.layout, 'grouped');
  assert.equal(got.path, null);
});

test('navLinksLineFrom: explicit mode wins when both fields are populated', () => {
  assert.equal(
    navLinksLineFrom({ mode: 'path', path: 'guides', tag: 'System', layout: 'flat' }),
    '<div class="mb-nav-links" data-nav-path="guides"></div>');
  assert.equal(
    navLinksLineFrom({ mode: 'tag', path: 'guides', tag: 'System', layout: 'flat' }),
    '<div class="mb-nav-links" data-nav-tag="System" data-nav-layout="flat"></div>');
});

test('parseComponents: a tag block carries tag + layout on its nav object', () => {
  const body = [
    '<span data-uuid="t1" style="display:none"></span>',
    '<div class="mb-nav-links" data-nav-tag="System" data-nav-layout="grouped"></div>',
  ].join('\n');
  const { components } = parseComponents(body, GUIDE_ADMONITION_TYPES_RE);
  assert.equal(components.length, 1);
  assert.equal(components[0].nav.tag, 'System');
  assert.equal(components[0].nav.layout, 'grouped');
});

test('buildComponentBody → parseComponents round-trips a tag component', () => {
  const comp = { kind: 'navlinks', nav: { uuid: 't9', tag: 'System', layout: 'flat' } };
  const body = buildComponentBody(null, 'Desc', [comp]);
  const { components } = parseComponents(body, GUIDE_ADMONITION_TYPES_RE);
  assert.equal(components.length, 1);
  assert.equal(components[0].nav.uuid, 't9');
  assert.equal(components[0].nav.tag, 'System');
  assert.equal(components[0].nav.layout, 'flat');
});

test('componentMarkdown: Copy payload for a tag block strips the uuid span', () => {
  const comp = { kind: 'navlinks', nav: { uuid: 't1', tag: 'System', layout: 'grouped' } };
  assert.equal(componentMarkdown(comp), '<div class="mb-nav-links" data-nav-tag="System" data-nav-layout="grouped"></div>');
});

// ── components.js integration: nav-links as an ordered component ──────────────

test('parseComponents: recognises a nav-links block interleaved with an admonition', () => {
  const body = [
    'Intro.',
    '',
    '<span data-uuid="u1" style="display:none"></span>',
    '<div class="mb-nav-links" data-nav-path="guides"></div>',
    '',
    '!!! note "Hi"',
    '',
    '    <span data-uuid="a1" style="display:none"></span>',
    '',
    '    Body.',
  ].join('\n');
  const { description, components } = parseComponents(body, GUIDE_ADMONITION_TYPES_RE);
  assert.equal(description, 'Intro.');
  assert.equal(components.length, 2);
  assert.equal(components[0].kind, 'navlinks');
  assert.equal(components[0].nav.path, 'guides');
  assert.equal(components[1].kind, 'admonition');
  assert.equal(uuidOfComponent(components[0]), 'u1');
});

test('buildComponentBody → parseComponents round-trips a nav-links component', () => {
  const comp = { kind: 'navlinks', nav: { uuid: 'u9', path: 'guides/employees' } };
  const body = buildComponentBody(null, 'Desc', [comp]);
  const { description, components } = parseComponents(body, GUIDE_ADMONITION_TYPES_RE);
  assert.equal(description, 'Desc');
  assert.equal(components.length, 1);
  assert.deepEqual(components[0].nav, comp.nav);
});

test('parsePastedComponents: accepts a pasted nav-links block (mints a fresh uuid)', () => {
  const { components, error } = parsePastedComponents('<div class="mb-nav-links" data-nav-path="guides"></div>');
  assert.equal(error, null);
  assert.equal(components.length, 1);
  assert.equal(components[0].kind, 'navlinks');
  assert.ok(components[0].nav.uuid, 'fresh uuid minted');
});

test('componentMarkdown: Copy payload strips the uuid span', () => {
  const comp = { kind: 'navlinks', nav: { uuid: 'u1', path: 'guides' } };
  assert.equal(componentMarkdown(comp), '<div class="mb-nav-links" data-nav-path="guides"></div>');
});

// ── multi-tag (comma-separated data-nav-tag) ──────────────────────────────────

test('build: several tags are authored comma+space separated, normalised + deduped', () => {
  const lines = buildNavLinksLines([{ tag: 'System,RAMS , system,, Overview', layout: 'flat' }]);
  assert.deepEqual(lines, ['', '<div class="mb-nav-links" data-nav-tag="System, RAMS, Overview" data-nav-layout="flat"></div>']);
});

test('locate: a multi-tag line round-trips its tag CSV verbatim', () => {
  const [b] = locateNavLinksLines('<div class="mb-nav-links" data-nav-tag="System, RAMS" data-nav-layout="grouped"></div>');
  assert.equal(b.tag, 'System, RAMS');
  assert.equal(b.layout, 'grouped');
  assert.deepEqual(navLinksDimFields(b), { navMode: 'tag', navPath: '', navTag: 'System, RAMS', navLayout: 'grouped' });
});

test('navLinksLineFrom: tag mode with a CSV keeps the list', () => {
  assert.equal(navLinksLineFrom({ mode: 'tag', path: '', tag: 'A, B', layout: 'flat' }),
    '<div class="mb-nav-links" data-nav-tag="A, B" data-nav-layout="flat"></div>');
});

console.log(`\n${passed} passed`);
