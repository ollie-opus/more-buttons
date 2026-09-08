import assert from 'node:assert/strict';
import {
  buildCodeBlockLines, locateCodeBlockLines, ensureCodeBlockUUIDs,
  locateCodeBlockByUUID, replaceCodeBlockByUUID, deleteCodeBlockByUUID,
  codeBlockDimFields, codeBlockFromDimFields, parseFenceInfo, buildFenceOpen,
  ANNOTATION_SEP,
} from '../scripts/mdCodeBlocks.js';
import { parseComponents, buildComponentBody, uuidOfComponent, parsePastedComponents, componentMarkdown } from '../scripts/components.js';
import { GUIDE_ADMONITION_TYPES_RE } from '../scripts/admonitions.js';
import { parseSections, ensureSectionUUIDs } from '../scripts/sections.js';
import { parseDoc, renderDocHtml } from '../scripts/markdownInline.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// ── parseFenceInfo / buildFenceOpen ──────────────────────────────────────────

test('info: language only', () => {
  assert.deepEqual(parseFenceInfo('python'), { language: 'python', title: '', linenums: '', hlLines: '', extra: '' });
});

test('info: language + all attrs, any order', () => {
  const a = parseFenceInfo('python title="a.py" linenums="1" hl_lines="2 3"');
  const b = parseFenceInfo('python hl_lines="2 3" title="a.py" linenums="1"');
  assert.deepEqual(a, { language: 'python', title: 'a.py', linenums: '1', hlLines: '2 3', extra: '' });
  assert.deepEqual(b, a);
});

test('info: attrs without a language', () => {
  assert.deepEqual(parseFenceInfo('title=".browserslistrc"'),
    { language: '', title: '.browserslistrc', linenums: '', hlLines: '', extra: '' });
});

test('info: unmodelled attrs survive in extra', () => {
  const p = parseFenceInfo('yaml title="x" .no-copy');
  assert.equal(p.language, 'yaml');
  assert.equal(p.title, 'x');
  assert.equal(p.extra, '.no-copy');
});

test('info: brace form is entirely opaque (rides in extra verbatim)', () => {
  const p = parseFenceInfo('{ .yaml .annotate title="kept-inside" }');
  assert.deepEqual(p, { language: '', title: '', linenums: '', hlLines: '', extra: '{ .yaml .annotate title="kept-inside" }' });
  assert.equal(buildFenceOpen(p), '```{ .yaml .annotate title="kept-inside" }');
});

test('buildFenceOpen: canonical emit order, bare fence when empty', () => {
  assert.equal(buildFenceOpen({ language: 'py', title: 't', linenums: '5', hlLines: '1-2', extra: '.x' }),
    '```py title="t" linenums="5" hl_lines="1-2" .x');
  assert.equal(buildFenceOpen({}), '```');
});

// ── build ────────────────────────────────────────────────────────────────────

test('build: fenced block with uuid + attrs', () => {
  const lines = buildCodeBlockLines([{ uuid: 'u1', language: 'python', title: 'a.py', linenums: '1', hlLines: '2', code: 'x = 1\ny = 2' }]);
  assert.deepEqual(lines, [
    '',
    '<span data-uuid="u1" style="display:none"></span>',
    '```python title="a.py" linenums="1" hl_lines="2"',
    'x = 1',
    'y = 2',
    '```',
  ]);
});

test('build: annotations renumber and follow after a blank line', () => {
  const lines = buildCodeBlockLines([{ language: 'yaml', code: 'a: 1 # (1)!', annotations: ['First', '', '  Second  '] }]);
  assert.deepEqual(lines, [
    '', '```yaml', 'a: 1 # (1)!', '```', '', '1. First', '2. Second',
  ]);
});

// ── locate ───────────────────────────────────────────────────────────────────

test('locate: plain block, language only', () => {
  const found = locateCodeBlockLines('```js\nconst x = 1;\n```');
  assert.equal(found.length, 1);
  assert.equal(found[0].language, 'js');
  assert.equal(found[0].code, 'const x = 1;');
  assert.deepEqual([found[0].startLine, found[0].endLine], [0, 3]);
});

test('locate: bare fence (no language) is a code block', () => {
  const found = locateCodeBlockLines('```\nplain\n```');
  assert.equal(found.length, 1);
  assert.equal(found[0].language, '');
  assert.equal(found[0].code, 'plain');
});

test('locate: mermaid fences are skipped whole (they stay diagrams)', () => {
  const md = '```mermaid\ngraph TD\n```\n\n```js\n1\n```';
  const found = locateCodeBlockLines(md);
  assert.equal(found.length, 1);
  assert.equal(found[0].language, 'js');
});

test('locate: a mermaid close fence is never misread as a bare open', () => {
  // Only a mermaid block: no code blocks at all.
  assert.equal(locateCodeBlockLines('```mermaid\ngraph TD\n```').length, 0);
});

test('locate: unterminated fence ignored', () => {
  assert.equal(locateCodeBlockLines('```python\nx = 1').length, 0);
});

test('locate: preceding uuid span swallowed', () => {
  const md = '<span data-uuid="u1" style="display:none"></span>\n```toml\nkey = 1\n```';
  const found = locateCodeBlockLines(md);
  assert.equal(found[0].uuid, 'u1');
  assert.equal(found[0].startLine, 0);
});

test('locate: dedents nested block to fence indent', () => {
  const md = [
    '    ```python',
    '    if x:',
    '        y()',
    '    ```',
  ].join('\n');
  const found = locateCodeBlockLines(md);
  assert.equal(found[0].indent, '    ');
  assert.equal(found[0].code, 'if x:\n    y()');
});

test('locate: annotation list swallowed only when the code carries a marker', () => {
  const withMarker = '```yaml\na: 1 # (1)!\n```\n\n1. Note one\n2. Note two';
  const got = locateCodeBlockLines(withMarker)[0];
  assert.deepEqual(got.annotations, ['Note one', 'Note two']);
  assert.equal(got.endLine, 6);

  const noMarker = '```yaml\na: 1\n```\n\n1. Ordinary list';
  const got2 = locateCodeBlockLines(noMarker)[0];
  assert.deepEqual(got2.annotations, []);
  assert.equal(got2.endLine, 3); // list left to the description
});

test('locate: bare (n) at end of line does NOT gate the swallow', () => {
  const md = '```yaml\na: 1 # (1)\n```\n\n1. Note';
  const got = locateCodeBlockLines(md)[0];
  assert.deepEqual(got.annotations, []);
  assert.equal(got.endLine, 3); // list left to the description
});

test('locate: sys.exit(1) does not swallow a following numbered list', () => {
  const md = '```python\nimport sys\nsys.exit(1)\n```\n\n1. Step one\n2. Step two';
  const got = locateCodeBlockLines(md)[0];
  assert.deepEqual(got.annotations, []);
  assert.equal(got.endLine, 4); // list left to the description
});

test('locate: wrapped bang-less marker gates the swallow', () => {
  const md = '```css\na { color: red; } /* (1) */\n```\n\n1. Why red';
  assert.deepEqual(locateCodeBlockLines(md)[0].annotations, ['Why red']);
});

// ── multiline annotations ────────────────────────────────────────────────────

test('build: multiline annotation emits 4-space continuations (blank lines stay blank)', () => {
  const lines = buildCodeBlockLines([{ language: 'yaml', code: 'a: 1 # (1)!', annotations: ['First line\ncontinued\n\nsecond paragraph'] }]);
  assert.deepEqual(lines, [
    '', '```yaml', 'a: 1 # (1)!', '```', '',
    '1. First line',
    '    continued',
    '',
    '    second paragraph',
  ]);
});

test('locate: multiline items — continuations and interior paragraph breaks belong to the item', () => {
  const md = [
    '```yaml',
    'a: 1 # (1)!',
    'b: 2 # (2)!',
    '```',
    '',
    '1. First line',
    '    continued',
    '',
    '    second paragraph',
    '2. Short one',
    '',
    'Plain description after.',
  ].join('\n');
  const got = locateCodeBlockLines(md)[0];
  assert.deepEqual(got.annotations, ['First line\ncontinued\n\nsecond paragraph', 'Short one']);
  assert.equal(got.endLine, 10); // trailing blank + description NOT swallowed
});

test('locate: blank lines BETWEEN items are list formatting, dropped on parse', () => {
  const md = [
    '```yaml',
    'a: 1 # (1)!',
    '```',
    '',
    '1. One',
    '',
    '2. Two',
  ].join('\n');
  const got = locateCodeBlockLines(md)[0];
  assert.deepEqual(got.annotations, ['One', 'Two']);
  assert.equal(got.endLine, 7);
});

test('round-trip: multiline annotations are stable through build → locate', () => {
  const anns = ['Para one\n\nPara two\n- with a bullet', 'Second note\ncontinued'];
  const md = buildCodeBlockLines([{ uuid: 'm', language: 'python', code: 'x = 1  # (1)!\ny = 2  # (2)!', annotations: anns }]).join('\n');
  assert.deepEqual(locateCodeBlockLines(md)[0].annotations, anns);
});

test('replace: nested block re-indents multiline annotation continuations', () => {
  const md = [
    '    <span data-uuid="u1" style="display:none"></span>',
    '    ```python',
    '    x = 1',
    '    ```',
  ].join('\n');
  const out = replaceCodeBlockByUUID(md, 'u1', { language: 'python', title: '', linenums: '', hlLines: '', code: 'y = 2  # (1)!', annotations: ['Line one\nline two'] });
  assert.deepEqual(out.split('\n'), [
    '    <span data-uuid="u1" style="display:none"></span>',
    '    ```python',
    '    y = 2  # (1)!',
    '    ```',
    '',
    '    1. Line one',
    '        line two',
  ]);
  // And it survives a re-locate at that indent.
  assert.deepEqual(locateCodeBlockLines(out)[0].annotations, ['Line one\nline two']);
});

// ── round-trip ───────────────────────────────────────────────────────────────

test('round-trip: build → locate is stable (attrs + annotations)', () => {
  const cb = { uuid: 'r', language: 'python', title: 'x.py', linenums: '10', hlLines: '1 3', extra: '', code: 'a = 1  # (1)!\nb = 2', annotations: ['A note'] };
  const md = buildCodeBlockLines([cb]).join('\n');
  const got = locateCodeBlockLines(md)[0];
  assert.equal(got.uuid, 'r');
  assert.equal(got.language, 'python');
  assert.equal(got.title, 'x.py');
  assert.equal(got.linenums, '10');
  assert.equal(got.hlLines, '1 3');
  assert.equal(got.code, cb.code);
  assert.deepEqual(got.annotations, ['A note']);
});

// ── ensure ───────────────────────────────────────────────────────────────────

test('ensure: backfills a uuid span; idempotent', () => {
  const out = ensureCodeBlockUUIDs('```js\n1\n```');
  const loc = locateCodeBlockLines(out)[0];
  assert.ok(loc.uuid);
  assert.equal(ensureCodeBlockUUIDs(out), out);
});

test('ensure: leaves mermaid blocks alone', () => {
  const md = '```mermaid\ngraph TD\n```';
  assert.equal(ensureCodeBlockUUIDs(md), md);
});

// ── replace / delete ─────────────────────────────────────────────────────────

test('replace: rewrites the addressed block (attrs + annotations), keeps span + siblings', () => {
  const md = [
    '<span data-uuid="u1" style="display:none"></span>',
    '```js',
    'old();',
    '```',
    '',
    '<span data-uuid="u2" style="display:none"></span>',
    '```css',
    'a { color: red }',
    '```',
  ].join('\n');
  const out = replaceCodeBlockByUUID(md, 'u1', { language: 'python', title: 'n.py', linenums: '1', hlLines: '', code: 'new()  # (1)!', annotations: ['Why'] });
  const byUuid = Object.fromEntries(locateCodeBlockLines(out).map(c => [c.uuid, c]));
  assert.equal(byUuid.u1.language, 'python');
  assert.equal(byUuid.u1.title, 'n.py');
  assert.equal(byUuid.u1.code, 'new()  # (1)!');
  assert.deepEqual(byUuid.u1.annotations, ['Why']);
  assert.equal(byUuid.u2.code, 'a { color: red }'); // untouched
});

test('replace: preserves unmodelled extra attrs from the located fence', () => {
  const md = '<span data-uuid="u1" style="display:none"></span>\n```yaml .no-copy\na: 1\n```';
  const out = replaceCodeBlockByUUID(md, 'u1', { language: 'yaml', title: '', linenums: '', hlLines: '', code: 'b: 2', annotations: [] });
  assert.ok(out.includes('```yaml .no-copy'));
  assert.equal(locateCodeBlockLines(out)[0].code, 'b: 2');
});

test('replace: re-indents fence, code, and annotations for a nested block', () => {
  const md = [
    '=== "Tab A"',
    '',
    '    <span data-uuid="u1" style="display:none"></span>',
    '    ```python',
    '    x = 1',
    '    ```',
  ].join('\n');
  const out = replaceCodeBlockByUUID(md, 'u1', { language: 'python', title: '', linenums: '', hlLines: '', code: 'y = 2  # (1)!', annotations: ['Note'] });
  assert.deepEqual(out.split('\n'), [
    '=== "Tab A"',
    '',
    '    <span data-uuid="u1" style="display:none"></span>',
    '    ```python',
    '    y = 2  # (1)!',
    '    ```',
    '',
    '    1. Note',
  ]);
});

test('locate→replace: save-unchanged is idempotent (no indent creep, no attr churn)', () => {
  const md = [
    '    <span data-uuid="u1" style="display:none"></span>',
    '    ```python title="a.py" linenums="1"',
    '    if x:',
    '        y()',
    '    ```',
  ].join('\n');
  const loc = locateCodeBlockByUUID(md, 'u1');
  assert.equal(replaceCodeBlockByUUID(md, 'u1', loc), md);
});

test('delete: removes span + block + annotations + one trailing blank', () => {
  const md = [
    'Intro.',
    '',
    '<span data-uuid="u1" style="display:none"></span>',
    '```yaml',
    'a: 1 # (1)!',
    '```',
    '',
    '1. Note',
    '',
    'Outro.',
  ].join('\n');
  const out = deleteCodeBlockByUUID(md, 'u1');
  assert.equal(out, 'Intro.\n\nOutro.');
});

// ── dim fields ───────────────────────────────────────────────────────────────

test('dimFields: mode/start split mirrors captureDimFields', () => {
  assert.deepEqual(codeBlockDimFields({ language: 'py', title: 't', linenums: '3', hlLines: '2', code: 'x', annotations: ['a', 'b'] }), {
    codeLanguage: 'py', codeTitle: 't', codeLinenumsMode: 'on', codeLinenumsStart: '3',
    codeHlLines: '2', codeSource: 'x', codeAnnotations: 'a' + ANNOTATION_SEP + 'b',
  });
  assert.deepEqual(codeBlockDimFields(null), {
    codeLanguage: '', codeTitle: '', codeLinenumsMode: 'off', codeLinenumsStart: '',
    codeHlLines: '', codeSource: '', codeAnnotations: '',
  });
});

test('dimFields: inverse defaults a blank start to 1 and drops empty annotations', () => {
  const cb = codeBlockFromDimFields({ codeLanguage: ' py ', codeTitle: '', codeLinenumsMode: 'on', codeLinenumsStart: '', codeHlLines: '', codeSource: 'x', codeAnnotations: ['a', ' ', ''].join(ANNOTATION_SEP) });
  assert.equal(cb.language, 'py');
  assert.equal(cb.linenums, '1');
  assert.deepEqual(cb.annotations, ['a']);
});

test('dimFields: a multiline annotation survives the scalar round-trip', () => {
  const ann = 'First paragraph\n\nSecond paragraph\n- bullet';
  const dim = codeBlockDimFields({ language: 'py', linenums: '', code: 'x # (1)!', annotations: [ann, 'short'] });
  assert.equal(dim.codeAnnotations, ann + ANNOTATION_SEP + 'short');
  assert.deepEqual(codeBlockFromDimFields(dim).annotations, [ann, 'short']);
});

test('dimFields: parsed block → fields → block compares equal (merge baseline)', () => {
  const md = buildCodeBlockLines([{ uuid: 'u', language: 'toml', title: 'x', linenums: '2', hlLines: '1', code: 'k = 1 # (1)!', annotations: ['n'] }]).join('\n');
  const loc = locateCodeBlockByUUID(md, 'u');
  const back = codeBlockFromDimFields(codeBlockDimFields(loc));
  assert.equal(replaceCodeBlockByUUID(md, 'u', back), md);
});

// ── components.js integration ────────────────────────────────────────────────

test('parseComponents: recognises a code block interleaved with an admonition', () => {
  const body = [
    'Intro.',
    '',
    '<span data-uuid="u1" style="display:none"></span>',
    '```bash title="run.sh"',
    'echo hi',
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
  assert.equal(components[0].kind, 'codeblock');
  assert.equal(components[0].cb.language, 'bash');
  assert.equal(components[0].cb.title, 'run.sh');
  assert.equal(uuidOfComponent(components[0]), 'u1');
  assert.equal(components[1].kind, 'admonition');
});

test('parseComponents: fence content is masked — component-looking lines inside code stay code', () => {
  const body = [
    '<span data-uuid="u1" style="display:none"></span>',
    '```markdown',
    '!!! note "Example"',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    '[Btn](x){ .md-button }',
    '```',
  ].join('\n');
  const { description, components } = parseComponents(body, GUIDE_ADMONITION_TYPES_RE);
  assert.equal(description, '');
  assert.equal(components.length, 1);
  assert.equal(components[0].kind, 'codeblock');
  assert.equal(components[0].cb.code.split('\n').length, 7);
});

test('parseComponents: mermaid stays a diagram next to a code block', () => {
  const body = [
    '```mermaid',
    'graph TD',
    '```',
    '',
    '```python',
    'x = 1',
    '```',
  ].join('\n');
  const { components } = parseComponents(body, GUIDE_ADMONITION_TYPES_RE);
  assert.deepEqual(components.map(c => c.kind), ['diagram', 'codeblock']);
});

test('buildComponentBody → parseComponents round-trips a code block component', () => {
  const comp = { kind: 'codeblock', cb: { uuid: 'u9', language: 'python', title: 'a.py', linenums: '1', hlLines: '2', extra: '', code: 'x = 1  # (1)!', annotations: ['Note'] } };
  const body = buildComponentBody(null, 'Desc', [comp]);
  const { description, components } = parseComponents(body, GUIDE_ADMONITION_TYPES_RE);
  assert.equal(description, 'Desc');
  assert.equal(components.length, 1);
  assert.deepEqual(components[0].cb, comp.cb);
});

test('parsePastedComponents: accepts a pasted code block (mints a fresh uuid)', () => {
  const { components, error } = parsePastedComponents('```python title="a.py"\nx = 1\n```');
  assert.equal(error, null);
  assert.equal(components.length, 1);
  assert.equal(components[0].kind, 'codeblock');
  assert.ok(components[0].cb.uuid);
});

test('componentMarkdown: Copy payload strips the uuid span', () => {
  const comp = { kind: 'codeblock', cb: { uuid: 'u1', language: 'js', title: '', linenums: '', hlLines: '', extra: '', code: '1', annotations: [] } };
  assert.equal(componentMarkdown(comp), '```js\n1\n```');
});

// ── sections.js fence mask ───────────────────────────────────────────────────

test('sections: a column-0 # comment inside a fence is NOT a heading', () => {
  const md = [
    '# Page',
    '',
    '```bash',
    '# this is a comment, not a heading',
    'echo hi',
    '```',
  ].join('\n');
  const sections = parseSections(md);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].title, 'Page');
});

test('sections: ensureSectionUUIDs never injects a span inside a fence', () => {
  const md = [
    '# Page',
    '<span data-uuid="s1" style="display:none"></span>',
    '',
    '```python',
    '# comment',
    'x = 1',
    '```',
  ].join('\n');
  assert.equal(ensureSectionUUIDs(md), md);
});

// ── markdownInline fence hardening ───────────────────────────────────────────

test('parseDoc: a fence is a verbatim block, not inline code', () => {
  const src = 'Before.\n```python\nprint("hi")\n```\nAfter.';
  const blocks = parseDoc(src);
  assert.deepEqual(blocks.map(b => b.type), ['text', 'fence', 'text']);
  assert.equal(blocks[1].text, '```python\nprint("hi")\n```');
  const html = renderDocHtml(src);
  assert.ok(!html.includes('<code>'), 'no inline code span from fence backticks');
  assert.ok(html.includes('mb-rte-fencesrc'));
});

test('parseDoc: fence round-trips through render as literal text with <br>s', () => {
  const src = '```js\nconst a = `x`;\n```';
  const html = renderDocHtml(src);
  // Reconstruct: strip tags, <br> → \n — what buildSource would serialize.
  const textBack = html.replace(/<br>/g, '\n').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  assert.equal(textBack, src);
});

test('parseDoc: unterminated fence stays plain text (old behaviour)', () => {
  const blocks = parseDoc('```python\nno close');
  assert.deepEqual(blocks.map(b => b.type), ['text']);
});

console.log(`\n${passed} passed`);
