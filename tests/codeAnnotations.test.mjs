import assert from 'node:assert/strict';
import {
  commentStyleFor, markerFor, tokenizeAnnotatedCode, serializeTokens,
  bindMarkersToAnnotations, normalizeForSave, langWarningFor,
  NO_COMMENT_LANGS, CONSOLE_LANGS,
  hasAnnotationMarker,
} from '../scripts/codeAnnotations.js';
import { buildCodeBlockLines, locateCodeBlockLines } from '../scripts/mdCodeBlocks.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// ── commentStyleFor ──────────────────────────────────────────────────────────

test('style: line-prefix languages', () => {
  assert.deepEqual(commentStyleFor('python'), { kind: 'line', open: '#' });
  assert.deepEqual(commentStyleFor('bash'), { kind: 'line', open: '#' });
  assert.deepEqual(commentStyleFor('yaml'), { kind: 'line', open: '#' });
  assert.deepEqual(commentStyleFor('javascript'), { kind: 'line', open: '//' });
  assert.deepEqual(commentStyleFor('rust'), { kind: 'line', open: '//' });
  assert.deepEqual(commentStyleFor('sql'), { kind: 'line', open: '--' });
  assert.deepEqual(commentStyleFor('ini'), { kind: 'line', open: ';' });
});

test('style: wrapped languages', () => {
  assert.deepEqual(commentStyleFor('css'), { kind: 'wrap', open: '/*', close: '*/' });
  assert.deepEqual(commentStyleFor('html'), { kind: 'wrap', open: '<!--', close: '-->' });
  assert.deepEqual(commentStyleFor('xml'), { kind: 'wrap', open: '<!--', close: '-->' });
});

test('style: lookup is case-insensitive and trims', () => {
  assert.deepEqual(commentStyleFor(' Python '), { kind: 'line', open: '#' });
  assert.deepEqual(commentStyleFor('CSS'), { kind: 'wrap', open: '/*', close: '*/' });
});

test('style: unknown and no-comment languages fall back to #', () => {
  assert.deepEqual(commentStyleFor('some-future-lang'), { kind: 'line', open: '#' });
  assert.deepEqual(commentStyleFor('text'), { kind: 'line', open: '#' });
  assert.deepEqual(commentStyleFor(''), { kind: 'line', open: '#' });
});

test('style: console langs use #', () => {
  assert.deepEqual(commentStyleFor('console'), { kind: 'line', open: '#' });
  assert.deepEqual(commentStyleFor('shell-session'), { kind: 'line', open: '#' });
});

// ── markerFor ────────────────────────────────────────────────────────────────

test('markerFor: all four shapes', () => {
  assert.equal(markerFor('python', 1), '# (1)!');
  assert.equal(markerFor('typescript', 2), '// (2)!');
  assert.equal(markerFor('css', 3), '/* (3)! */');
  assert.equal(markerFor('html', 1), '<!-- (1)! -->');
  assert.equal(markerFor('sql', 1), '-- (1)!');
  assert.equal(markerFor('ini', 1), '; (1)!');
});

test('markerFor: fallback languages get #', () => {
  assert.equal(markerFor('', 1), '# (1)!');
  assert.equal(markerFor('text', 1), '# (1)!');
});

// ── tokenizeAnnotatedCode ────────────────────────────────────────────────────

test('tokenize: hash marker with the preceding space consumed', () => {
  assert.deepEqual(tokenizeAnnotatedCode('x = 1 # (1)!'), [
    { type: 'text', text: 'x = 1' },
    { type: 'marker', num: 1 },
  ]);
});

test('tokenize: slash marker', () => {
  assert.deepEqual(tokenizeAnnotatedCode('const x = 1; // (2)!'), [
    { type: 'text', text: 'const x = 1;' },
    { type: 'marker', num: 2 },
  ]);
});

test('tokenize: wrapped css marker, bang optional', () => {
  assert.deepEqual(tokenizeAnnotatedCode('color: red; /* (1)! */'), [
    { type: 'text', text: 'color: red;' },
    { type: 'marker', num: 1 },
  ]);
  assert.deepEqual(tokenizeAnnotatedCode('color: red; /* (1) */'), [
    { type: 'text', text: 'color: red;' },
    { type: 'marker', num: 1 },
  ]);
});

test('tokenize: wrapped html marker', () => {
  assert.deepEqual(tokenizeAnnotatedCode('<div> <!-- (3)! -->'), [
    { type: 'text', text: '<div>' },
    { type: 'marker', num: 3 },
  ]);
});

test('tokenize: bare bang marker without a comment prefix still tokenizes', () => {
  assert.deepEqual(tokenizeAnnotatedCode('a: 1 (1)!'), [
    { type: 'text', text: 'a: 1' },
    { type: 'marker', num: 1 },
  ]);
});

test('tokenize: no-space and tight variants', () => {
  assert.deepEqual(tokenizeAnnotatedCode('x=1 #(1)!'), [
    { type: 'text', text: 'x=1' },
    { type: 'marker', num: 1 },
  ]);
});

test('tokenize: only one preceding space is consumed', () => {
  assert.deepEqual(tokenizeAnnotatedCode('x = 1  # (1)!'), [
    { type: 'text', text: 'x = 1 ' },
    { type: 'marker', num: 1 },
  ]);
});

test('tokenize: multiple markers across lines keep surrounding text', () => {
  assert.deepEqual(tokenizeAnnotatedCode('a = 1 # (1)!\nplain line\nb = 2 # (2)!\n'), [
    { type: 'text', text: 'a = 1' },
    { type: 'marker', num: 1 },
    { type: 'text', text: '\nplain line\nb = 2' },
    { type: 'marker', num: 2 },
    { type: 'text', text: '\n' },
  ]);
});

test('tokenize: bare EOL (n) without bang is NOT a marker (code like exit(1) stays intact)', () => {
  assert.deepEqual(tokenizeAnnotatedCode('sys.exit(1)'), [
    { type: 'text', text: 'sys.exit(1)' },
  ]);
  assert.deepEqual(tokenizeAnnotatedCode('x = foo(2)\ny = 1'), [
    { type: 'text', text: 'x = foo(2)\ny = 1' },
  ]);
});

test('tokenize: non-markers left alone', () => {
  assert.deepEqual(tokenizeAnnotatedCode('tuple = (1, 2) # a comment'), [
    { type: 'text', text: 'tuple = (1, 2) # a comment' },
  ]);
  assert.deepEqual(tokenizeAnnotatedCode(''), []);
});

// ── serializeTokens ──────────────────────────────────────────────────────────

test('serialize: marker mid-line gets a single leading space', () => {
  const tokens = [{ type: 'text', text: 'x = 1' }, { type: 'marker', num: 1 }];
  assert.equal(serializeTokens(tokens, 'python'), 'x = 1 # (1)!');
});

test('serialize: no doubled space when the text already ends with one', () => {
  const tokens = [{ type: 'text', text: 'x = 1 ' }, { type: 'marker', num: 1 }];
  assert.equal(serializeTokens(tokens, 'python'), 'x = 1 # (1)!');
});

test('serialize: marker at line start gets no leading space', () => {
  const tokens = [
    { type: 'text', text: 'a\n' }, { type: 'marker', num: 1 },
    { type: 'text', text: '\nb' },
  ];
  assert.equal(serializeTokens(tokens, 'python'), 'a\n# (1)!\nb');
  assert.equal(serializeTokens([{ type: 'marker', num: 1 }], 'python'), '# (1)!');
});

test('serialize: renumbers 1..n in token order by default', () => {
  const tokens = [
    { type: 'text', text: 'a' }, { type: 'marker', num: 7 },
    { type: 'text', text: '\nb' }, { type: 'marker', num: 3 },
  ];
  assert.equal(serializeTokens(tokens, 'js'), 'a // (1)!\nb // (2)!');
});

test('serialize: renumber:false keeps original numbers (raw-mode language restyle)', () => {
  const tokens = [
    { type: 'text', text: 'a' }, { type: 'marker', num: 2 },
    { type: 'text', text: '\nb' }, { type: 'marker', num: 1 },
  ];
  assert.equal(serializeTokens(tokens, 'js', { renumber: false }), 'a // (2)!\nb // (1)!');
});

test('serialize: language restyle round trip (# → // → /* */)', () => {
  const py = 'x = 1 # (1)!\ny = 2 # (2)!';
  const tokens = tokenizeAnnotatedCode(py);
  assert.equal(serializeTokens(tokens, 'javascript'), 'x = 1 // (1)!\ny = 2 // (2)!');
  assert.equal(serializeTokens(tokens, 'css'), 'x = 1 /* (1)! */\ny = 2 /* (2)! */');
  assert.equal(serializeTokens(tokenizeAnnotatedCode(serializeTokens(tokens, 'css')), 'python'), py);
});

// ── bindMarkersToAnnotations ─────────────────────────────────────────────────

test('bind: markers pick their numbered item; unreferenced items become orphans', () => {
  const tokens = tokenizeAnnotatedCode('a # (2)!\nb # (1)!');
  const { chips, orphans } = bindMarkersToAnnotations(tokens, ['first', 'second', 'third']);
  assert.deepEqual(chips, [{ num: 2, text: 'second' }, { num: 1, text: 'first' }]);
  assert.deepEqual(orphans, ['third']);
});

test('bind: duplicate marker numbers copy the same text', () => {
  const tokens = tokenizeAnnotatedCode('a # (1)!\nb # (1)!');
  const { chips, orphans } = bindMarkersToAnnotations(tokens, ['only']);
  assert.deepEqual(chips, [{ num: 1, text: 'only' }, { num: 1, text: 'only' }]);
  assert.deepEqual(orphans, []);
});

test('bind: out-of-range marker gets empty text', () => {
  const tokens = tokenizeAnnotatedCode('a # (9)!');
  const { chips, orphans } = bindMarkersToAnnotations(tokens, ['first']);
  assert.deepEqual(chips, [{ num: 9, text: '' }]);
  assert.deepEqual(orphans, ['first']);
});

test('bind: no markers → everything is an orphan', () => {
  const { chips, orphans } = bindMarkersToAnnotations(tokenizeAnnotatedCode('plain'), ['a', 'b']);
  assert.deepEqual(chips, []);
  assert.deepEqual(orphans, ['a', 'b']);
});

// ── normalizeForSave ─────────────────────────────────────────────────────────

test('normalize: drops empty-text markers (marker and item) and renumbers', () => {
  const res = normalizeForSave('a # (1)!\nb # (2)!\nc # (3)!', ['first', '  ', 'third'], 'python');
  assert.equal(res.code, 'a # (1)!\nb\nc # (2)!');
  assert.deepEqual(res.annotations, ['first', 'third']);
});

test('normalize: drops empty orphans, keeps real ones at the tail', () => {
  const res = normalizeForSave('a # (1)!', ['first', ' ', 'stray'], 'python');
  assert.equal(res.code, 'a # (1)!');
  assert.deepEqual(res.annotations, ['first', 'stray']);
});

test('normalize: canonicalizes marker style to the language', () => {
  const res = normalizeForSave('a #(1)!', ['first'], 'javascript');
  assert.equal(res.code, 'a // (1)!');
  assert.deepEqual(res.annotations, ['first']);
});

test('normalize: no markers, no annotations — untouched', () => {
  const res = normalizeForSave('plain code', [], 'python');
  assert.equal(res.code, 'plain code');
  assert.deepEqual(res.annotations, []);
});

// ── langWarningFor ───────────────────────────────────────────────────────────

test('warning: empty for languages where annotations just work', () => {
  assert.equal(langWarningFor('python'), '');
  assert.equal(langWarningFor('javascript'), '');
  assert.equal(langWarningFor('css'), '');
});

test('warning: console and no-comment languages', () => {
  assert.ok(langWarningFor('console').includes('$ '));
  assert.ok(langWarningFor('shell-session').includes('$ '));
  assert.ok(langWarningFor('text').includes('no comment highlighting'));
  assert.ok(langWarningFor('').includes('no comment highlighting'));
});

test('warning: sets are exported for the UI', () => {
  assert.ok(NO_COMMENT_LANGS.has('text'));
  assert.ok(NO_COMMENT_LANGS.has(''));
  assert.ok(CONSOLE_LANGS.has('console'));
});

// ── round trip against mdCodeBlocks ──────────────────────────────────────────

test('round trip: serialized code + annotations survive build → locate → tokenize → bind', () => {
  const tokens = [
    { type: 'text', text: 'a = 1' }, { type: 'marker', num: 1 },
    { type: 'text', text: '\nb = 2' }, { type: 'marker', num: 2 },
  ];
  const code = serializeTokens(tokens, 'python');
  const annotations = ['First **bold**', 'Second\nwith a continuation'];
  const md = buildCodeBlockLines([{ language: 'python', code, annotations }]).join('\n');
  const [found] = locateCodeBlockLines(md);
  assert.equal(found.code, code);
  assert.deepEqual(found.annotations, annotations);
  const { chips, orphans } = bindMarkersToAnnotations(tokenizeAnnotatedCode(found.code), found.annotations);
  assert.deepEqual(chips.map(c => c.text), annotations);
  assert.deepEqual(orphans, []);
});

console.log(`\ncodeAnnotations: ${passed} tests passed`);

// ── hasAnnotationMarker (the mdCodeBlocks swallow gate) ──────────────────────

test('hasAnnotationMarker: tokenizer-aligned truth table', () => {
  assert.equal(hasAnnotationMarker('x = 1  # (1)!'), true);
  assert.equal(hasAnnotationMarker('done (2)!'), true);
  assert.equal(hasAnnotationMarker('a { color: red; } /* (1) */'), true);
  assert.equal(hasAnnotationMarker('<b>hi</b> <!-- (2) -->'), true);
  assert.equal(hasAnnotationMarker('sys.exit(1)'), false);
  assert.equal(hasAnnotationMarker('a: 1 # (1)'), false);
  assert.equal(hasAnnotationMarker('tuple = (1, 2)  # a comment'), false);
});
