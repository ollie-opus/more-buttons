import assert from 'node:assert/strict';
import {
  resolveScope, spliceReplacement, normalizeModelOutput, stripInventedHeadings,
  validatePromptsConfig, createAiUndo, deriveUi, samplingOptions,
} from '../scripts/aiReword.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// resolveScope
test('collapsed caret resolves to the whole value', () => {
  assert.deepEqual(resolveScope({ value: 'hello world', selStart: 4, selEnd: 4 }),
    { kind: 'whole', text: 'hello world', start: 0, end: 11 });
});
test('non-collapsed selection resolves to the slice', () => {
  assert.deepEqual(resolveScope({ value: 'hello world', selStart: 6, selEnd: 11 }),
    { kind: 'selection', text: 'world', start: 6, end: 11 });
});
test('backwards selection normalizes start/end', () => {
  assert.deepEqual(resolveScope({ value: 'hello world', selStart: 11, selEnd: 6 }),
    { kind: 'selection', text: 'world', start: 6, end: 11 });
});
test('empty value resolves to whole with empty text', () => {
  assert.deepEqual(resolveScope({ value: '', selStart: 0, selEnd: 0 }),
    { kind: 'whole', text: '', start: 0, end: 0 });
});

// spliceReplacement
test('splice mid-string selects the replacement', () => {
  assert.deepEqual(spliceReplacement('one two three', 4, 7, 'TWO!'),
    { value: 'one TWO! three', selStart: 4, selEnd: 8 });
});
test('splice at the start', () => {
  assert.deepEqual(spliceReplacement('abc', 0, 1, 'X'),
    { value: 'Xbc', selStart: 0, selEnd: 1 });
});
test('splice at the end', () => {
  assert.deepEqual(spliceReplacement('abc', 2, 3, 'YZ'),
    { value: 'abYZ', selStart: 2, selEnd: 4 });
});
test('whole-value replace', () => {
  assert.deepEqual(spliceReplacement('old', 0, 3, 'brand new'),
    { value: 'brand new', selStart: 0, selEnd: 9 });
});

// normalizeModelOutput
test('plain output passes through trimmed', () => {
  assert.equal(normalizeModelOutput('  Rewritten text.\n'), 'Rewritten text.');
});
test('wrapping code fence is stripped', () => {
  assert.equal(normalizeModelOutput('```\nRewritten text.\n```'), 'Rewritten text.');
});
test('language-tagged fence is stripped', () => {
  assert.equal(normalizeModelOutput('```markdown\n# Title\n\nBody\n```'), '# Title\n\nBody');
});
test('inner fences survive (only a full wrap is stripped)', () => {
  const text = 'Before\n```js\ncode\n```\nAfter';
  assert.equal(normalizeModelOutput(text), text);
});
test('null/undefined become empty string', () => {
  assert.equal(normalizeModelOutput(null), '');
  assert.equal(normalizeModelOutput(undefined), '');
});

// validatePromptsConfig
test('valid config normalizes to an array of {label, system} in file order', () => {
  const out = validatePromptsConfig([
    { label: 'Simple', system: 'be simple' },
    { label: 'Advanced', system: 'be advanced' },
  ]);
  assert.deepEqual(out, [
    { label: 'Simple', system: 'be simple' },
    { label: 'Advanced', system: 'be advanced' },
  ]);
});
test('extra fields on an entry are dropped', () => {
  const out = validatePromptsConfig([{ label: 'A', system: 's', note: 'ignored' }]);
  assert.deepEqual(out, [{ label: 'A', system: 's' }]);
});
test('empty array throws', () => {
  assert.throws(() => validatePromptsConfig([]), /at least one/);
});
test('object without a prompts array throws', () => {
  assert.throws(
    () => validatePromptsConfig({ simple: { label: 'S', system: 's' } }),
    /"prompts"/);
});
test('object shape: shared is appended to every system with a blank line', () => {
  const out = validatePromptsConfig({
    shared: 'formatting rules',
    prompts: [
      { label: 'Simple', system: 'be simple' },
      { label: 'Advanced', system: 'be advanced' },
    ],
  });
  assert.deepEqual(out, [
    { label: 'Simple', system: 'be simple\n\nformatting rules' },
    { label: 'Advanced', system: 'be advanced\n\nformatting rules' },
  ]);
});
test('object shape without shared leaves systems untouched', () => {
  assert.deepEqual(
    validatePromptsConfig({ prompts: [{ label: 'A', system: 's' }] }),
    [{ label: 'A', system: 's' }]);
});
test('blank shared is ignored', () => {
  assert.deepEqual(
    validatePromptsConfig({ shared: '   ', prompts: [{ label: 'A', system: 's' }] }),
    [{ label: 'A', system: 's' }]);
});
test('non-string shared throws', () => {
  assert.throws(
    () => validatePromptsConfig({ shared: 42, prompts: [{ label: 'A', system: 's' }] }),
    /"shared"/);
});
test('object shape with empty prompts throws', () => {
  assert.throws(() => validatePromptsConfig({ shared: 'x', prompts: [] }), /at least one/);
});
test('entry description is passed through', () => {
  assert.deepEqual(
    validatePromptsConfig([{ label: 'A', system: 's', description: 'Shortens the text.' }]),
    [{ label: 'A', system: 's', description: 'Shortens the text.' }]);
});
test('entry without description stays description-free', () => {
  assert.deepEqual(validatePromptsConfig([{ label: 'A', system: 's' }]),
    [{ label: 'A', system: 's' }]);
});
test('non-string description throws', () => {
  assert.throws(
    () => validatePromptsConfig([{ label: 'A', system: 's', description: 7 }]),
    /entry 0 "description"/);
});
test('blank description throws', () => {
  assert.throws(
    () => validatePromptsConfig([{ label: 'A', system: 's', description: '  ' }]),
    /entry 0 "description"/);
});
test('entry with shared:false skips the shared block', () => {
  assert.deepEqual(
    validatePromptsConfig({
      shared: 'formatting rules',
      prompts: [
        { label: 'Rewrite', system: 'rewrite it' },
        { label: 'Proofread', system: 'fix errors only', shared: false },
      ],
    }),
    [
      { label: 'Rewrite', system: 'rewrite it\n\nformatting rules' },
      { label: 'Proofread', system: 'fix errors only' },
    ]);
});
test('non-boolean entry shared throws', () => {
  assert.throws(
    () => validatePromptsConfig({ prompts: [{ label: 'A', system: 's', shared: 'yes' }] }),
    /entry 0 "shared"/);
});
test('object shape entry errors keep their index', () => {
  assert.throws(
    () => validatePromptsConfig({ prompts: [{ label: 'A', system: 's' }, { label: '' }] }),
    /entry 1 "label"/);
});
test('non-object entry throws with its index', () => {
  assert.throws(() => validatePromptsConfig([{ label: 'A', system: 's' }, 'nope']), /entry 1/);
});
test('missing label throws', () => {
  assert.throws(() => validatePromptsConfig([{ system: 's' }]), /entry 0 "label"/);
});
test('blank label throws', () => {
  assert.throws(() => validatePromptsConfig([{ label: '  ', system: 's' }]), /entry 0 "label"/);
});
test('non-string system throws', () => {
  assert.throws(() => validatePromptsConfig([{ label: 'A', system: 42 }]), /entry 0 "system"/);
});
test('blank system throws', () => {
  assert.throws(() => validatePromptsConfig([{ label: 'A', system: '   ' }]), /entry 0 "system"/);
});
test('null throws', () => {
  assert.throws(() => validatePromptsConfig(null), /must be an array/);
});

// samplingOptions
test('normal params clamp to the low-variance editing profile', () => {
  assert.deepEqual(
    samplingOptions({ defaultTemperature: 1, maxTemperature: 2, defaultTopK: 3, maxTopK: 8 }),
    { temperature: 0.3, topK: 3 });
});
test('tight caps are respected', () => {
  assert.deepEqual(
    samplingOptions({ defaultTemperature: 0.2, maxTemperature: 0.2, defaultTopK: 1, maxTopK: 1 }),
    { temperature: 0.2, topK: 1 });
});
test('missing params yield no overrides (create() uses its defaults)', () => {
  assert.deepEqual(samplingOptions(null), {});
  assert.deepEqual(samplingOptions(undefined), {});
});
test('non-numeric fields yield no overrides', () => {
  assert.deepEqual(samplingOptions({ maxTemperature: 'x', maxTopK: 8 }), {});
});

// stripInventedHeadings
test('invented leading heading is dropped entirely', () => {
  assert.equal(
    stripInventedHeadings('plain paragraph text.', '## Reminder Tasks\n\nYou cannot fix it manually.'),
    'You cannot fix it manually.');
});
test('invented mid-text heading keeps its text, loses the marker', () => {
  assert.equal(
    stripInventedHeadings('a. b.', 'First part.\n\n### Next Steps\n\nSecond part.'),
    'First part.\n\nNext Steps\n\nSecond part.');
});
test('output untouched when the source itself has headings', () => {
  const out = '## Kept\n\nBody.';
  assert.equal(stripInventedHeadings('# Original\n\ntext', out), out);
});
test('output untouched when it has no headings', () => {
  assert.equal(stripInventedHeadings('text', 'Just a rewrite.'), 'Just a rewrite.');
});
test('# lines inside code fences are not touched', () => {
  const out = 'Run this:\n\n```sh\n# install it\nnpm i\n```';
  assert.equal(stripInventedHeadings('run npm i', out), out);
});
test('hashes without a following space are not headings', () => {
  assert.equal(stripInventedHeadings('text', 'Issue #12 is fixed.'), 'Issue #12 is fixed.');
});

// createAiUndo
test('capture makes the snapshot pending', () => {
  const u = createAiUndo();
  assert.equal(u.pending, false);
  u.capture({ value: 'v', selStart: 0, selEnd: 1 });
  assert.equal(u.pending, true);
});
test('consume returns the snapshot once', () => {
  const u = createAiUndo();
  const snap = { value: 'v', selStart: 0, selEnd: 1 };
  u.capture(snap);
  assert.equal(u.consume(), snap);
  assert.equal(u.pending, false);
  assert.equal(u.consume(), null);
});
test('invalidate clears a pending snapshot', () => {
  const u = createAiUndo();
  u.capture({ value: 'v', selStart: 0, selEnd: 0 });
  u.invalidate();
  assert.equal(u.pending, false);
  assert.equal(u.consume(), null);
});

// deriveUi
test('checking: disabled + spinner', () => {
  const ui = deriveUi({ kind: 'checking' });
  assert.equal(ui.actionsEnabled, false);
  assert.equal(ui.spin, true);
});
test('ready: enabled, no status', () => {
  assert.deepEqual(deriveUi({ kind: 'ready' }),
    { actionsEnabled: true, statusText: '', spin: false, isError: false });
});
test('downloadable: enabled with a download warning', () => {
  const ui = deriveUi({ kind: 'downloadable' });
  assert.equal(ui.actionsEnabled, true);
  assert.match(ui.statusText, /download/i);
});
test('downloading: disabled + spinner', () => {
  const ui = deriveUi({ kind: 'downloading' });
  assert.equal(ui.actionsEnabled, false);
  assert.equal(ui.spin, true);
});
test('unavailable: disabled with an explanation', () => {
  const ui = deriveUi({ kind: 'unavailable' });
  assert.equal(ui.actionsEnabled, false);
  assert.match(ui.statusText, /not available/i);
});
test('empty: disabled with a hint', () => {
  const ui = deriveUi({ kind: 'empty' });
  assert.equal(ui.actionsEnabled, false);
  assert.match(ui.statusText, /nothing to rewrite/i);
});
test('working without progress says Rewriting', () => {
  const ui = deriveUi({ kind: 'working' });
  assert.equal(ui.actionsEnabled, false);
  assert.equal(ui.spin, true);
  assert.match(ui.statusText, /rewriting/i);
});
test('working with partial progress shows the download percentage', () => {
  assert.match(deriveUi({ kind: 'working', progress: 0.42 }).statusText, /42%/);
});
test('working with complete progress goes back to Rewriting', () => {
  assert.match(deriveUi({ kind: 'working', progress: 1 }).statusText, /rewriting/i);
});
test('error: enabled again, marked as error, custom message', () => {
  const ui = deriveUi({ kind: 'error', message: 'boom' });
  assert.equal(ui.actionsEnabled, true);
  assert.equal(ui.isError, true);
  assert.equal(ui.statusText, 'boom');
});
test('error without message gets a fallback', () => {
  assert.match(deriveUi({ kind: 'error' }).statusText, /try again/i);
});
test('discarded: enabled, marked as error', () => {
  const ui = deriveUi({ kind: 'discarded' });
  assert.equal(ui.actionsEnabled, true);
  assert.equal(ui.isError, true);
  assert.match(ui.statusText, /discarded/i);
});

console.log(`\naiReword: ${passed} tests passed`);
