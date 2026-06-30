import assert from 'node:assert/strict';
import {
  buildDiagramLines, locateDiagramLines, ensureDiagramUUIDs,
  locateDiagramByUUID, replaceDiagramByUUID, deleteDiagramByUUID, diagramDimFields,
} from '../scripts/mdDiagrams.js';
import { parseComponents, buildComponentBody, uuidOfComponent, parsePastedComponents, componentMarkdown } from '../scripts/components.js';
import { GUIDE_ADMONITION_TYPES_RE } from '../scripts/admonitions.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// ── buildDiagramLines: form data → markdown ──────────────────────────────────

test('build: fenced block, no uuid', () => {
  const lines = buildDiagramLines([{ code: 'graph TD\n  A --> B' }]);
  assert.deepEqual(lines, ['', '```mermaid', 'graph TD', '  A --> B', '```']);
});

test('build: with uuid span', () => {
  const lines = buildDiagramLines([{ uuid: 'u1', code: 'graph LR\n  X --> Y' }]);
  assert.deepEqual(lines, [
    '',
    '<span data-uuid="u1" style="display:none"></span>',
    '```mermaid',
    'graph LR',
    '  X --> Y',
    '```',
  ]);
});

// ── locateDiagramLines: markdown → form data ─────────────────────────────────

test('locate: single diagram, no uuid', () => {
  const md = '```mermaid\ngraph TD\n  A --> B\n```';
  const found = locateDiagramLines(md);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0], {
    uuid: null, code: 'graph TD\n  A --> B', indent: '', startLine: 0, endLine: 4,
  });
});

test('locate: diagram with preceding uuid span', () => {
  const md = '<span data-uuid="u1" style="display:none"></span>\n```mermaid\nsequenceDiagram\n  A->>B: hi\n```';
  const found = locateDiagramLines(md);
  assert.equal(found.length, 1);
  assert.equal(found[0].uuid, 'u1');
  assert.equal(found[0].code, 'sequenceDiagram\n  A->>B: hi');
  assert.equal(found[0].startLine, 0); // span swallowed
  assert.equal(found[0].endLine, 5);
});

test('locate: dedents the code to its fence indent (nested diagram → canonical source)', () => {
  const md = [
    '    <span data-uuid="u1" style="display:none"></span>',
    '    ```mermaid',
    '    graph TD',
    '      A --> B',
    '    ```',
  ].join('\n');
  const found = locateDiagramLines(md);
  assert.equal(found.length, 1);
  assert.equal(found[0].indent, '    ');
  // The form/textarea must see the author's source, not the ancestor's indent.
  assert.equal(found[0].code, 'graph TD\n  A --> B');
});

test('locate: ignores a non-mermaid fence', () => {
  assert.equal(locateDiagramLines('```js\nconst x = 1;\n```').length, 0);
});

test('locate: ignores an unterminated mermaid fence', () => {
  assert.equal(locateDiagramLines('```mermaid\ngraph TD').length, 0);
});

test('locate: two diagrams in one body', () => {
  const md = '```mermaid\nA\n```\n\n```mermaid\nB\n```';
  const found = locateDiagramLines(md);
  assert.equal(found.length, 2);
  assert.equal(found[0].code, 'A');
  assert.equal(found[1].code, 'B');
});

// ── round-trip: build → locate is stable ─────────────────────────────────────

for (const code of ['graph TD\n  A --> B', 'pie\n  "a": 1\n  "b": 2', 'classDiagram\n  Animal <|-- Duck']) {
  test(`round-trip: ${code.split('\n')[0]}`, () => {
    const md = buildDiagramLines([{ uuid: 'r', code }]).join('\n');
    const got = locateDiagramLines(md)[0];
    assert.equal(got.uuid, 'r');
    assert.equal(got.code, code);
  });
}

// ── ensureDiagramUUIDs: backfill identity ────────────────────────────────────

test('ensure: backfills a uuid span before a span-less diagram', () => {
  const out = ensureDiagramUUIDs('```mermaid\ngraph TD\n```');
  const loc = locateDiagramLines(out)[0];
  assert.ok(loc.uuid, 'should have a uuid');
  assert.equal(loc.code, 'graph TD');
});

test('ensure: idempotent when a uuid already present', () => {
  const md = '<span data-uuid="keep" style="display:none"></span>\n```mermaid\ngraph TD\n```';
  assert.equal(ensureDiagramUUIDs(md), md);
});

// ── locate/replace by uuid (edit path) ───────────────────────────────────────

test('replace: rewrites only the addressed diagram (length change), keeping its span', () => {
  const md = [
    '<span data-uuid="u1" style="display:none"></span>',
    '```mermaid',
    'graph TD',
    '  A --> B',
    '```',
    '',
    '<span data-uuid="u2" style="display:none"></span>',
    '```mermaid',
    'graph LR',
    '```',
  ].join('\n');
  const out = replaceDiagramByUUID(md, 'u1', 'flowchart TB\n  X --> Y\n  Y --> Z');
  const byUuid = Object.fromEntries(locateDiagramLines(out).map(d => [d.uuid, d]));
  assert.equal(byUuid.u1.code, 'flowchart TB\n  X --> Y\n  Y --> Z');
  assert.equal(byUuid.u2.code, 'graph LR'); // untouched
  assert.ok(out.includes('data-uuid="u1"')); // span preserved
});

test('replace: re-indents the code lines to match an indented (nested) diagram', () => {
  // A diagram nested 4 spaces deep, as it lives inside a content tab / grid cell.
  const md = [
    '=== "Tab A"',
    '',
    '    <span data-uuid="u1" style="display:none"></span>',
    '    ```mermaid',
    '    graph TD',
    '      A --> B',
    '    ```',
  ].join('\n');
  const out = replaceDiagramByUUID(md, 'u1', 'flowchart TB\n  X --> Y');
  // Every emitted line (fences AND code) must carry the diagram's own indent so
  // the block stays inside its ancestor; blank lines stay blank.
  assert.deepEqual(out.split('\n'), [
    '=== "Tab A"',
    '',
    '    <span data-uuid="u1" style="display:none"></span>',
    '    ```mermaid',
    '    flowchart TB',
    '      X --> Y',
    '    ```',
  ]);
});

test('locate→replace: save-unchanged of a nested diagram is idempotent (no indent creep)', () => {
  const md = [
    '    <span data-uuid="u1" style="display:none"></span>',
    '    ```mermaid',
    '    graph TD',
    '      A --> B',
    '    ```',
  ].join('\n');
  // The form seeds from the located code; saving it back must reproduce md.
  const seeded = locateDiagramByUUID(md, 'u1').code;
  assert.equal(replaceDiagramByUUID(md, 'u1', seeded), md);
});

test('delete: removes the addressed diagram (span + block + trailing blank), keeps siblings', () => {
  const md = [
    'Intro.',
    '',
    '<span data-uuid="u1" style="display:none"></span>',
    '```mermaid',
    'graph TD',
    '```',
    '',
    '<span data-uuid="u2" style="display:none"></span>',
    '```mermaid',
    'graph LR',
    '```',
  ].join('\n');
  const out = deleteDiagramByUUID(md, 'u1');
  const left = locateDiagramLines(out);
  assert.equal(left.length, 1);
  assert.equal(left[0].uuid, 'u2');
  assert.ok(!out.includes('data-uuid="u1"'));
  assert.ok(out.startsWith('Intro.'));
});

// ── diagramDimFields: merge baseline ─────────────────────────────────────────

test('dimFields: maps a parsed diagram to the scalar form field', () => {
  assert.deepEqual(diagramDimFields({ code: 'graph TD' }), { diagramCode: 'graph TD' });
  assert.deepEqual(diagramDimFields(null), { diagramCode: '' });
});

// ── components.js integration: diagram as an ordered component ────────────────

test('parseComponents: recognises a diagram interleaved with an admonition', () => {
  const body = [
    'Intro.',
    '',
    '<span data-uuid="u1" style="display:none"></span>',
    '```mermaid',
    'graph TD',
    '  A --> B',
    '```',
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
  assert.equal(components[0].kind, 'diagram');
  assert.equal(components[0].dia.code, 'graph TD\n  A --> B');
  assert.equal(components[1].kind, 'admonition');
  assert.equal(uuidOfComponent(components[0]), 'u1');
});

test('buildComponentBody → parseComponents round-trips a diagram component', () => {
  const comp = { kind: 'diagram', dia: { uuid: 'u9', code: 'graph TD\n  A --> B' } };
  const body = buildComponentBody(null, 'Desc', [comp]);
  const { description, components } = parseComponents(body, GUIDE_ADMONITION_TYPES_RE);
  assert.equal(description, 'Desc');
  assert.equal(components.length, 1);
  assert.deepEqual(components[0].dia, comp.dia);
});

test('parsePastedComponents: accepts a pasted diagram (mints a fresh uuid)', () => {
  const { components, error } = parsePastedComponents('```mermaid\ngraph TD\n  A --> B\n```');
  assert.equal(error, null);
  assert.equal(components.length, 1);
  assert.equal(components[0].kind, 'diagram');
  assert.ok(components[0].dia.uuid, 'fresh uuid minted');
});

test('componentMarkdown: Copy payload strips the uuid span', () => {
  const comp = { kind: 'diagram', dia: { uuid: 'u1', code: 'graph TD\n  A --> B' } };
  assert.equal(componentMarkdown(comp), '```mermaid\ngraph TD\n  A --> B\n```');
});

console.log(`\n${passed} passed`);
