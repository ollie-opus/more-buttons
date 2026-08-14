import assert from 'node:assert/strict';
import {
  resolveScope, spliceReplacement, normalizeModelOutput, stripInventedHeadings,
  validatePromptsConfig, createAiUndo, deriveUi, buildGeminiRequest,
  parseGeminiResponse, DEFAULT_MODEL,
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
test('valid config normalizes to prompts of {label, system} in file order', () => {
  const out = validatePromptsConfig([
    { label: 'Simple', system: 'be simple' },
    { label: 'Advanced', system: 'be advanced' },
  ]);
  assert.deepEqual(out.prompts, [
    { label: 'Simple', system: 'be simple' },
    { label: 'Advanced', system: 'be advanced' },
  ]);
});
test('extra fields on an entry are dropped', () => {
  const out = validatePromptsConfig([{ label: 'A', system: 's', note: 'ignored' }]);
  assert.deepEqual(out.prompts, [{ label: 'A', system: 's' }]);
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
  assert.deepEqual(out.prompts, [
    { label: 'Simple', system: 'be simple\n\nformatting rules' },
    { label: 'Advanced', system: 'be advanced\n\nformatting rules' },
  ]);
});
test('object shape without shared leaves systems untouched', () => {
  assert.deepEqual(
    validatePromptsConfig({ prompts: [{ label: 'A', system: 's' }] }).prompts,
    [{ label: 'A', system: 's' }]);
});
test('blank shared is ignored', () => {
  assert.deepEqual(
    validatePromptsConfig({ shared: '   ', prompts: [{ label: 'A', system: 's' }] }).prompts,
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
    validatePromptsConfig([{ label: 'A', system: 's', description: 'Shortens the text.' }]).prompts,
    [{ label: 'A', system: 's', description: 'Shortens the text.' }]);
});
test('entry without description stays description-free', () => {
  assert.deepEqual(validatePromptsConfig([{ label: 'A', system: 's' }]).prompts,
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
    }).prompts,
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
test('explicit model passes through trimmed', () => {
  assert.equal(
    validatePromptsConfig({ model: '  gemini-2.5-pro ', prompts: [{ label: 'A', system: 's' }] }).model,
    'gemini-2.5-pro');
});
test('absent model defaults', () => {
  assert.equal(
    validatePromptsConfig({ prompts: [{ label: 'A', system: 's' }] }).model,
    DEFAULT_MODEL);
});
test('legacy array shape defaults the model', () => {
  assert.equal(validatePromptsConfig([{ label: 'A', system: 's' }]).model, DEFAULT_MODEL);
});
test('non-string model throws', () => {
  assert.throws(
    () => validatePromptsConfig({ model: 7, prompts: [{ label: 'A', system: 's' }] }),
    /"model"/);
});
test('blank model throws', () => {
  assert.throws(
    () => validatePromptsConfig({ model: '  ', prompts: [{ label: 'A', system: 's' }] }),
    /"model"/);
});

// buildGeminiRequest
test('request targets the configured model', () => {
  const { url } = buildGeminiRequest({ model: 'gemini-3.5-flash', apiKey: 'k', system: 's', text: 't' });
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent');
});
test('the key travels in the x-goog-api-key header', () => {
  const { headers } = buildGeminiRequest({ model: 'm', apiKey: 'AIza-test', system: 's', text: 't' });
  assert.equal(headers['x-goog-api-key'], 'AIza-test');
  assert.equal(headers['Content-Type'], 'application/json');
});
test('request body carries system, text, and deterministic minimal-thinking config', () => {
  const { body } = buildGeminiRequest({ model: 'gemini-3.5-flash', apiKey: 'k', system: 'sys prompt', text: 'the text' });
  assert.deepEqual(body, {
    systemInstruction: { parts: [{ text: 'sys prompt' }] },
    contents: [{ role: 'user', parts: [{ text: 'the text' }] }],
    generationConfig: { temperature: 0.3, thinkingConfig: { thinkingLevel: 'minimal' } },
  });
});
test('2.x models get thinkingBudget 0, never thinkingLevel (mixing is a 400)', () => {
  const { body } = buildGeminiRequest({ model: 'gemini-2.5-flash', apiKey: 'k', system: 's', text: 't' });
  assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
});
test('non-2.x models get thinkingLevel minimal', () => {
  for (const model of ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3-pro']) {
    const { body } = buildGeminiRequest({ model, apiKey: 'k', system: 's', text: 't' });
    assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'minimal' });
  }
});

// parseGeminiResponse
test('happy path joins multi-part output', () => {
  assert.equal(
    parseGeminiResponse(200, { candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] }),
    'ab');
});
test('429 maps to a wait-a-minute message', () => {
  assert.throws(() => parseGeminiResponse(429, {}), /wait a minute/);
});
test('403 maps to the key message pointing at Integrations', () => {
  assert.throws(() => parseGeminiResponse(403, {}), /Integrations/);
});
test('400 with API_KEY_INVALID detail maps to the key message', () => {
  assert.throws(
    () => parseGeminiResponse(400, { error: { details: [{ reason: 'API_KEY_INVALID' }] } }),
    /Integrations/);
});
test('400 with API_KEY_INVALID in the message maps to the key message', () => {
  assert.throws(
    () => parseGeminiResponse(400, { error: { message: 'API key not valid [API_KEY_INVALID]' } }),
    /Integrations/);
});
test('other non-2xx surfaces the API error message', () => {
  assert.throws(() => parseGeminiResponse(500, { error: { message: 'backend exploded' } }),
    /backend exploded/);
  assert.throws(() => parseGeminiResponse(503, {}), /HTTP 503/);
});
test('safety block maps to a clear message', () => {
  assert.throws(
    () => parseGeminiResponse(200, { promptFeedback: { blockReason: 'SAFETY' } }),
    /safety/i);
});
test('missing or empty candidates map to a no-rewrite message', () => {
  assert.throws(() => parseGeminiResponse(200, {}), /no rewrite/);
  assert.throws(() => parseGeminiResponse(200, { candidates: [{ content: { parts: [] } }] }), /no rewrite/);
});
test('parts without text join as empty strings', () => {
  assert.equal(
    parseGeminiResponse(200, { candidates: [{ content: { parts: [{ text: 'a' }, {}] } }] }),
    'a');
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
test('no-key: disabled with the Integrations hint, not an error', () => {
  const ui = deriveUi({ kind: 'no-key' });
  assert.equal(ui.actionsEnabled, false);
  assert.equal(ui.isError, false);
  assert.match(ui.statusText, /Integrations/);
});
test('retired Nano download states fall through to the inert default', () => {
  for (const kind of ['downloadable', 'downloading', 'unavailable']) {
    assert.deepEqual(deriveUi({ kind }),
      { actionsEnabled: false, statusText: '', spin: false, isError: false });
  }
});
test('empty: disabled with a hint', () => {
  const ui = deriveUi({ kind: 'empty' });
  assert.equal(ui.actionsEnabled, false);
  assert.match(ui.statusText, /nothing to rewrite/i);
});
test('working says Rewriting with a spinner', () => {
  const ui = deriveUi({ kind: 'working' });
  assert.equal(ui.actionsEnabled, false);
  assert.equal(ui.spin, true);
  assert.match(ui.statusText, /rewriting/i);
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
