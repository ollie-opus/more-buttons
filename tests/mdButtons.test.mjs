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
    primary: false, newTab: false, colour: '', theme: 'default', border: 'default',
    style: 'default', indent: '', startLine: 0, endLine: 1,
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
    buttonLabel: 'Send', buttonColour: '', buttonTheme: 'default', buttonBorder: 'default',
    buttonStyle: 'default', buttonDestination: '/x', icon: 'lucide/send', buttonNewTab: 'yes',
  });
});

// ── custom colour + theme classes ────────────────────────────────────────────

test('build: custom colour emits .custom-button-<slug> (no --primary)', () => {
  const lines = buildButtonLines([{ label: 'Go', destination: '/x', colour: 'emerald', icon: null }]);
  assert.deepEqual(lines, ['', '[Go](/x){ .md-button .custom-button-emerald }']);
});

test('build: colour + theme, theme class before target/rel', () => {
  const lines = buildButtonLines([{ label: 'Go', destination: '/x', colour: 'emerald', theme: 'force-dark', newTab: true, icon: null }]);
  assert.deepEqual(lines, ['', '[Go](/x){ .md-button .custom-button-emerald .custom-button--force-dark target="_blank" rel="noopener" }']);
});

test('build: theme "default" emits no modifier class', () => {
  const lines = buildButtonLines([{ label: 'Go', destination: '/x', colour: 'red', theme: 'default', icon: null }]);
  assert.deepEqual(lines, ['', '[Go](/x){ .md-button .custom-button-red }']);
});

test('build: no colour + primary still emits the legacy classes', () => {
  const lines = buildButtonLines([{ label: 'Go', destination: '/x', colour: '', theme: 'default', primary: true, icon: null }]);
  assert.deepEqual(lines, ['', '[Go](/x){ .md-button .md-button--primary }']);
});

test('locate: reads colour + newTab from a hand-authored attr order', () => {
  const got = locateButtonLines('[Subscribe](/n){ .md-button .custom-button-cyan target="_blank" rel="noopener" }')[0];
  assert.equal(got.colour, 'cyan');
  assert.equal(got.theme, 'default');
  assert.equal(got.newTab, true);
  assert.equal(got.primary, false);
});

for (const theme of ['inversed', 'force-light', 'force-dark']) {
  test(`locate: theme modifier ${theme}, order-tolerant`, () => {
    const got = locateButtonLines(`[Go](/x){ .custom-button-red .custom-button--${theme} .md-button }`)[0];
    assert.equal(got.colour, 'red');
    assert.equal(got.theme, theme);
  });
}

test('locate: a theme modifier alone is NOT a colour', () => {
  const got = locateButtonLines('[Go](/x){ .md-button .custom-button--inversed }')[0];
  assert.equal(got.colour, '');
  assert.equal(got.theme, 'inversed');
});

test('locate: the real system-updates.md line (onclick attrs) parses', () => {
  const line = '[Contact us :lucide-send:](#){ .md-button .custom-button-emerald onclick="event.preventDefault(); window.groove.widget.open();" }';
  const got = locateButtonLines(line)[0];
  assert.equal(got.label, 'Contact us');
  assert.equal(got.icon, 'lucide/send');
  assert.equal(got.colour, 'emerald');
  assert.equal(got.theme, 'default');
});

test('round-trip: legacy primary and full custom lines are byte-identical', () => {
  for (const line of [
    '[Send :lucide-send:](/x){ .md-button .md-button--primary }',
    '[Docs](/d){ .md-button target="_blank" rel="noopener" }',
    '[Go](/x){ .md-button .custom-button-teal .custom-button--inversed }',
    '[Go](/x){ .md-button .custom-button-teal .custom-button--force-light target="_blank" rel="noopener" }',
  ]) {
    const got = locateButtonLines(line)[0];
    assert.equal(buildButtonLines([got])[1], line);
  }
});

test('rebuild: colour wins over a stray legacy --primary class', () => {
  const got = locateButtonLines('[Go](/x){ .md-button .md-button--primary .custom-button-red }')[0];
  assert.equal(got.colour, 'red');
  assert.equal(got.primary, true);
  assert.equal(buildButtonLines([got])[1], '[Go](/x){ .md-button .custom-button-red }');
});

test('dimFields: custom colour + theme map through; legacy maps to empty colour', () => {
  const custom = { label: 'Go', destination: '/x', colour: 'emerald', theme: 'force-dark', icon: '', newTab: false };
  assert.equal(buttonDimFields(custom).buttonColour, 'emerald');
  assert.equal(buttonDimFields(custom).buttonTheme, 'force-dark');
  // Legacy primary and secondary both baseline to '' + 'default' → no false-dirty.
  const primary = locateButtonLines('[Go](/x){ .md-button .md-button--primary }')[0];
  const secondary = locateButtonLines('[Go](/x){ .md-button }')[0];
  for (const legacy of [primary, secondary]) {
    assert.equal(buttonDimFields(legacy).buttonColour, '');
    assert.equal(buttonDimFields(legacy).buttonTheme, 'default');
  }
});

// ── border modifier classes ──────────────────────────────────────────────────

test('build: colour + border emits the border class after theme, before target/rel', () => {
  const lines = buildButtonLines([{ label: 'Go', destination: '/x', colour: 'emerald', theme: 'force-dark', border: 'border-light', newTab: true, icon: null }]);
  assert.deepEqual(lines, ['', '[Go](/x){ .md-button .custom-button-emerald .custom-button--force-dark .custom-button--border-light target="_blank" rel="noopener" }']);
});

test('build: border "default" emits no modifier class', () => {
  const lines = buildButtonLines([{ label: 'Go', destination: '/x', colour: 'red', border: 'default', icon: null }]);
  assert.deepEqual(lines, ['', '[Go](/x){ .md-button .custom-button-red }']);
});

test('build: border without a colour is dropped (legacy classes only)', () => {
  const lines = buildButtonLines([{ label: 'Go', destination: '/x', colour: '', border: 'bordered', primary: true, icon: null }]);
  assert.deepEqual(lines, ['', '[Go](/x){ .md-button .md-button--primary }']);
});

for (const border of ['bordered', 'borderless', 'border-light', 'border-dark']) {
  test(`locate: border modifier ${border}, order-tolerant`, () => {
    const got = locateButtonLines(`[Go](/x){ .custom-button--${border} .custom-button-red .md-button }`)[0];
    assert.equal(got.colour, 'red');
    assert.equal(got.border, border);
    assert.equal(got.theme, 'default');
  });
}

test('locate: a border modifier alone is NOT a colour, nor a theme', () => {
  const got = locateButtonLines('[Go](/x){ .md-button .custom-button--borderless }')[0];
  assert.equal(got.colour, '');
  assert.equal(got.theme, 'default');
  assert.equal(got.border, 'borderless');
});

test('locate: theme and border modifiers coexist', () => {
  const got = locateButtonLines('[Go](/x){ .md-button .custom-button-teal .custom-button--inversed .custom-button--bordered }')[0];
  assert.equal(got.colour, 'teal');
  assert.equal(got.theme, 'inversed');
  assert.equal(got.border, 'bordered');
});

test('round-trip: bordered custom lines are byte-identical', () => {
  for (const line of [
    '[Go](/x){ .md-button .custom-button-teal .custom-button--border-dark }',
    '[Go](/x){ .md-button .custom-button-teal .custom-button--inversed .custom-button--borderless }',
    '[Go](/x){ .md-button .custom-button-teal .custom-button--force-light .custom-button--bordered target="_blank" rel="noopener" }',
  ]) {
    const got = locateButtonLines(line)[0];
    assert.equal(buildButtonLines([got])[1], line);
  }
});

test('dimFields: border maps through; absent border baselines to default', () => {
  const custom = { label: 'Go', destination: '/x', colour: 'emerald', theme: 'default', border: 'border-light', icon: '', newTab: false };
  assert.equal(buttonDimFields(custom).buttonBorder, 'border-light');
  const plain = locateButtonLines('[Go](/x){ .md-button .custom-button-red }')[0];
  assert.equal(buttonDimFields(plain).buttonBorder, 'default');
});

// ── style modifier classes ───────────────────────────────────────────────────

test('build: colour + slim emits the style class after border, before target/rel', () => {
  const lines = buildButtonLines([{ label: 'Go', destination: '/x', colour: 'emerald', theme: 'inversed', border: 'bordered', style: 'slim', newTab: true, icon: null }]);
  assert.deepEqual(lines, ['', '[Go](/x){ .md-button .custom-button-emerald .custom-button--inversed .custom-button--bordered .custom-button--slim target="_blank" rel="noopener" }']);
});

test('build: style "default" emits no modifier class', () => {
  const lines = buildButtonLines([{ label: 'Go', destination: '/x', colour: 'red', style: 'default', icon: null }]);
  assert.deepEqual(lines, ['', '[Go](/x){ .md-button .custom-button-red }']);
});

test('build: style without a colour is dropped (legacy classes only)', () => {
  const lines = buildButtonLines([{ label: 'Go', destination: '/x', colour: '', style: 'slim', primary: true, icon: null }]);
  assert.deepEqual(lines, ['', '[Go](/x){ .md-button .md-button--primary }']);
});

test('locate: slim modifier, order-tolerant', () => {
  const got = locateButtonLines('[Go](/x){ .custom-button--slim .custom-button-red .md-button }')[0];
  assert.equal(got.colour, 'red');
  assert.equal(got.style, 'slim');
  assert.equal(got.theme, 'default');
  assert.equal(got.border, 'default');
});

test('locate: a slim modifier alone is NOT a colour, theme, or border', () => {
  const got = locateButtonLines('[Go](/x){ .md-button .custom-button--slim }')[0];
  assert.equal(got.colour, '');
  assert.equal(got.theme, 'default');
  assert.equal(got.border, 'default');
  assert.equal(got.style, 'slim');
});

test('locate: theme, border and style modifiers coexist', () => {
  const got = locateButtonLines('[Go](/x){ .md-button .custom-button-teal .custom-button--force-dark .custom-button--borderless .custom-button--slim }')[0];
  assert.equal(got.colour, 'teal');
  assert.equal(got.theme, 'force-dark');
  assert.equal(got.border, 'borderless');
  assert.equal(got.style, 'slim');
});

test('round-trip: slim custom lines are byte-identical', () => {
  for (const line of [
    '[Go](/x){ .md-button .custom-button-teal .custom-button--slim }',
    '[Go](/x){ .md-button .custom-button-teal .custom-button--inversed .custom-button--slim }',
    '[Go](/x){ .md-button .custom-button-teal .custom-button--inversed .custom-button--bordered .custom-button--slim target="_blank" rel="noopener" }',
  ]) {
    const got = locateButtonLines(line)[0];
    assert.equal(buildButtonLines([got])[1], line);
  }
});

test('dimFields: style maps through; absent style baselines to default', () => {
  const custom = { label: 'Go', destination: '/x', colour: 'emerald', theme: 'default', border: 'default', style: 'slim', icon: '', newTab: false };
  assert.equal(buttonDimFields(custom).buttonStyle, 'slim');
  const plain = locateButtonLines('[Go](/x){ .md-button .custom-button-red }')[0];
  assert.equal(buttonDimFields(plain).buttonStyle, 'default');
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
  const comp = { kind: 'button', btn: { uuid: 'u9', label: 'Go', destination: '/go', icon: 'lucide/star', primary: false, colour: '', theme: 'default', border: 'default', style: 'default', newTab: true } };
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
