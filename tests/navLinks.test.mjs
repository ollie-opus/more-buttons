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
    uuid: null, path: 'guides/employees', indent: '', startLine: 0, endLine: 1,
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

test('dimFields: maps a parsed block to its scalar form field', () => {
  assert.deepEqual(navLinksDimFields({ path: 'guides/employees' }), { navPath: 'guides/employees' });
  assert.deepEqual(navLinksDimFields({}), { navPath: '' });
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

console.log(`\n${passed} passed`);
