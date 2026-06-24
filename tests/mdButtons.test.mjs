import assert from 'node:assert/strict';
import {
  buildButtonLines, locateButtonLines, ensureButtonUUIDs,
  locateButtonByUUID, replaceButtonByUUID, deleteButtonByUUID,
  iconToShortcode, shortcodeToIcon, buttonDimFields,
} from '../scripts/mdButtons.js';
import { parseComponents, buildComponentBody, uuidOfComponent, parsePastedComponents, componentMarkdown } from '../scripts/components.js';
import { GUIDE_ADMONITION_TYPES_RE } from '../scripts/admonitions.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// ── buildButtonLines: form data → markdown ───────────────────────────────────

test('build: secondary button, no icon', () => {
  const lines = buildButtonLines([{ label: 'Subscribe', destination: '/signup', primary: false, icon: null }]);
  assert.deepEqual(lines, ['', '[Subscribe](/signup){ .md-button }']);
});

test('build: primary button with icon + uuid span', () => {
  const lines = buildButtonLines([{ uuid: 'u1', label: 'Send', destination: '/x', primary: true, icon: 'lucide/send' }]);
  assert.deepEqual(lines, [
    '',
    '<span data-uuid="u1" style="display:none"></span>',
    '[Send :lucide-send:](/x){ .md-button .md-button--primary }',
  ]);
});

test('build: icon-only label (empty label, icon set)', () => {
  const lines = buildButtonLines([{ label: '', destination: '/x', primary: false, icon: 'lucide/send' }]);
  assert.deepEqual(lines, ['', '[:lucide-send:](/x){ .md-button }']);
});

test('build: newTab appends target="_blank" rel="noopener" after the classes', () => {
  const sec = buildButtonLines([{ label: 'Docs', destination: '/d', primary: false, icon: null, newTab: true }]);
  assert.deepEqual(sec, ['', '[Docs](/d){ .md-button target="_blank" rel="noopener" }']);
  const pri = buildButtonLines([{ label: 'Docs', destination: '/d', primary: true, icon: null, newTab: true }]);
  assert.deepEqual(pri, ['', '[Docs](/d){ .md-button .md-button--primary target="_blank" rel="noopener" }']);
});

// ── iconToShortcode ↔ shortcodeToIcon ────────────────────────────────────────

test('icon: lucide/arrow-left ↔ :lucide-arrow-left:', () => {
  assert.equal(iconToShortcode('lucide/arrow-left'), ':lucide-arrow-left:');
  assert.equal(shortcodeToIcon(':lucide-arrow-left:'), 'lucide/arrow-left');
});
test('icon: empty stays empty', () => {
  assert.equal(iconToShortcode(''), '');
  assert.equal(iconToShortcode(null), '');
});

// ── locateButtonLines: markdown → form data ──────────────────────────────────

test('locate: secondary button', () => {
  const found = locateButtonLines('[Subscribe](/signup){ .md-button }');
  assert.equal(found.length, 1);
  assert.deepEqual(found[0], {
    uuid: null, label: 'Subscribe', destination: '/signup', icon: '',
    primary: false, newTab: false, indent: '', startLine: 0, endLine: 1,
  });
});

test('locate: primary button with icon + uuid span', () => {
  const md = '<span data-uuid="u1" style="display:none"></span>\n[Send :lucide-send:](/x){ .md-button .md-button--primary }';
  const found = locateButtonLines(md);
  assert.equal(found.length, 1);
  assert.equal(found[0].uuid, 'u1');
  assert.equal(found[0].label, 'Send');
  assert.equal(found[0].icon, 'lucide/send');
  assert.equal(found[0].primary, true);
  assert.equal(found[0].startLine, 0);
  assert.equal(found[0].endLine, 2);
});

test('locate: reads newTab from target="_blank"', () => {
  assert.equal(locateButtonLines('[Docs](/d){ .md-button target="_blank" }')[0].newTab, true);
  assert.equal(locateButtonLines('[Docs](/d){ .md-button .md-button--primary target="_blank" }')[0].newTab, true);
  assert.equal(locateButtonLines('[Docs](/d){ .md-button }')[0].newTab, false);
});

test('locate: a plain link is NOT a button', () => {
  assert.equal(locateButtonLines('[hi](/x){ .foo }').length, 0);
  assert.equal(locateButtonLines('[hi](/x)').length, 0);
});

// ── round-trip: build → locate is stable ─────────────────────────────────────

for (const b of [
  { uuid: 'a', label: 'Go', destination: 'https://example.com', primary: false, icon: '', newTab: false },
  { uuid: 'b', label: 'Send', destination: '/x', primary: true, icon: 'lucide/send', newTab: true },
  { uuid: 'c', label: '', destination: '/icononly', primary: false, icon: 'lucide/star', newTab: false },
]) {
  test(`round-trip: ${b.label || '(icon-only)'}`, () => {
    const md = buildButtonLines([b]).join('\n');
    const got = locateButtonLines(md)[0];
    assert.equal(got.uuid, b.uuid);
    assert.equal(got.label, b.label);
    assert.equal(got.destination, b.destination);
    assert.equal(got.primary, b.primary);
    assert.equal(got.icon, b.icon);
    assert.equal(got.newTab, b.newTab);
  });
}

// ── ensureButtonUUIDs: backfill identity ─────────────────────────────────────

test('ensure: backfills a uuid span before a span-less button', () => {
  const out = ensureButtonUUIDs('[Go](/x){ .md-button }');
  const loc = locateButtonLines(out)[0];
  assert.ok(loc.uuid, 'should have a uuid');
  assert.equal(loc.label, 'Go');
});
test('ensure: idempotent when a uuid already present', () => {
  const md = '<span data-uuid="keep" style="display:none"></span>\n[Go](/x){ .md-button }';
  assert.equal(ensureButtonUUIDs(md), md);
});

// ── locate/replace by uuid (edit path) ───────────────────────────────────────

test('replace: rewrites only the addressed button, keeping its span', () => {
  const md = [
    '<span data-uuid="u1" style="display:none"></span>',
    '[Old](/old){ .md-button }',
    '',
    '<span data-uuid="u2" style="display:none"></span>',
    '[Keep](/keep){ .md-button }',
  ].join('\n');
  const newLine = buildButtonLines([{ label: 'New', destination: '/new', primary: true, icon: null }])[1];
  const out = replaceButtonByUUID(md, 'u1', newLine);
  const byUuid = Object.fromEntries(locateButtonLines(out).map(b => [b.uuid, b]));
  assert.equal(byUuid.u1.label, 'New');
  assert.equal(byUuid.u1.primary, true);
  assert.equal(byUuid.u2.label, 'Keep'); // untouched
  assert.ok(out.includes('data-uuid="u1"')); // span preserved
});

test('delete: removes the addressed button (span + line + trailing blank), keeps siblings', () => {
  const md = [
    'Intro.',
    '',
    '<span data-uuid="u1" style="display:none"></span>',
    '[Gone](/x){ .md-button }',
    '',
    '<span data-uuid="u2" style="display:none"></span>',
    '[Keep](/keep){ .md-button }',
  ].join('\n');
  const out = deleteButtonByUUID(md, 'u1');
  const left = locateButtonLines(out);
  assert.equal(left.length, 1);
  assert.equal(left[0].uuid, 'u2');
  assert.ok(!out.includes('data-uuid="u1"'));
  assert.ok(out.startsWith('Intro.'));
});

// ── buttonDimFields: merge baseline ──────────────────────────────────────────

test('dimFields: maps a parsed button to scalar form fields', () => {
  const btn = { label: 'Send', destination: '/x', primary: true, icon: 'lucide/send', newTab: true };
  assert.deepEqual(buttonDimFields(btn), {
    buttonLabel: 'Send', buttonType: 'primary', buttonDestination: '/x', icon: 'lucide/send',
    buttonNewTab: 'yes',
  });
});

// ── components.js integration: button as an ordered component ────────────────

test('parseComponents: recognises a button interleaved with an admonition', () => {
  const body = [
    'Intro.',
    '',
    '<span data-uuid="u1" style="display:none"></span>',
    '[Send :lucide-send:](/x){ .md-button .md-button--primary }',
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
  assert.equal(components[0].kind, 'button');
  assert.equal(components[0].btn.label, 'Send');
  assert.equal(components[0].btn.primary, true);
  assert.equal(components[0].btn.icon, 'lucide/send');
  assert.equal(components[1].kind, 'admonition');
  assert.equal(uuidOfComponent(components[0]), 'u1');
});

test('buildComponentBody → parseComponents round-trips a button component', () => {
  const comp = { kind: 'button', btn: { uuid: 'u9', label: 'Go', destination: '/go', icon: 'lucide/star', primary: false, newTab: true } };
  const body = buildComponentBody(null, 'Desc', [comp]);
  const { description, components } = parseComponents(body, GUIDE_ADMONITION_TYPES_RE);
  assert.equal(description, 'Desc');
  assert.equal(components.length, 1);
  assert.deepEqual(components[0].btn, comp.btn);
});

test('parsePastedComponents: accepts a pasted button (mints a fresh uuid)', () => {
  const { components, error } = parsePastedComponents('[Go](/x){ .md-button }');
  assert.equal(error, null);
  assert.equal(components.length, 1);
  assert.equal(components[0].kind, 'button');
  assert.ok(components[0].btn.uuid, 'fresh uuid minted');
});

test('componentMarkdown: Copy payload strips the uuid span', () => {
  const comp = { kind: 'button', btn: { uuid: 'u1', label: 'Send', destination: '/x', icon: 'lucide/send', primary: true } };
  assert.equal(componentMarkdown(comp), '[Send :lucide-send:](/x){ .md-button .md-button--primary }');
});

console.log(`\n${passed} passed`);
