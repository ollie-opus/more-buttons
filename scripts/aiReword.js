// AI Rewrite engine for the rich text editor — rewords a markdown string with
// the Google Gemini API (gemini-2.5-flash unless config overrides it). The
// prompt profiles live in config/aiPrompts.json — each entry ({label, system})
// becomes a rewrite button, so both the wording and the set of actions can be
// changed without a code change; the file's top-level "model" picks the model.
//
// The API key is per-user, stored in chrome.storage.local under
// GEMINI_STORAGE_KEY by the Google Gemini integration form. The rewrite is a
// plain in-context fetch: generativelanguage.googleapis.com is CORS-permissive
// the same way api.github.com is (integrations.js relies on that today), so no
// background-worker routing or host permission is needed. Thinking is disabled
// (thinkingBudget 0) — an editing task gains nothing from it, and the latency
// matters in a popover.
//
// Everything above the "engine" divider is pure and unit-tested; the module
// touches fetch/chrome only inside function bodies so importing it in node
// tests is safe (same rule as richTextEditor.js).

export const GEMINI_STORAGE_KEY = 'moreButtonsGeminiIntegration';
export const DEFAULT_MODEL = 'gemini-3.5-flash';

// ── Pure helpers ─────────────────────────────────────────────────────────────

// What the rewrite operates on: the selection when one exists, else the whole
// value. `start`/`end` are the source offsets the replacement splices into.
export function resolveScope({ value, selStart, selEnd }) {
  if (selStart !== selEnd) {
    const start = Math.min(selStart, selEnd);
    const end = Math.max(selStart, selEnd);
    return { kind: 'selection', text: value.slice(start, end), start, end };
  }
  return { kind: 'whole', text: value, start: 0, end: value.length };
}

// Splice the rewritten text into the source, selecting the inserted range so
// the result is visible (and immediately re-rewritable) after applyResult.
export function spliceReplacement(value, start, end, replacement) {
  return {
    value: value.slice(0, start) + replacement + value.slice(end),
    selStart: start,
    selEnd: start + replacement.length,
  };
}

// Models sometimes wrap their answer in a code fence despite instructions;
// unwrap it and drop stray surrounding whitespace.
export function normalizeModelOutput(text) {
  let out = String(text ?? '').trim();
  const fence = out.match(/^```[\w-]*\r?\n([\s\S]*?)\r?\n?```$/);
  if (fence) out = fence[1].trim();
  return out;
}

// Models sometimes invent structure despite the prompts telling them not to.
// If the source had no markdown headings, any heading in the output is made
// up: a LEADING heading is an invented title (drop the whole line), a later
// one is restructured content (keep the text, strip the marker so nothing is
// lost). Lines inside code fences are left alone.
export function stripInventedHeadings(source, output) {
  const HEADING = /^ {0,3}#{1,6}\s+/;
  const FENCE = /^\s*(```|~~~)/;
  if (source.split('\n').some(l => HEADING.test(l))) return output;
  let lines = output.split('\n');
  if (lines.length && HEADING.test(lines[0])) {
    lines.shift();
    while (lines.length && !lines[0].trim()) lines.shift();
  }
  let inFence = false;
  lines = lines.map(l => {
    if (FENCE.test(l)) { inFence = !inFence; return l; }
    return inFence ? l : l.replace(HEADING, '');
  });
  return lines.join('\n');
}

// Validate + normalize config/aiPrompts.json. Throws with a pointed message on
// a bad shape so a hand-edited config fails loudly instead of half-working.
// The file is {model?, shared?, prompts: [{label, system, description?}]} —
// `shared` holds the formatting rules common to every prompt and is appended
// to each system prompt here, so the rules live in one place as the editor's
// feature set grows; an entry can opt out with "shared": false (e.g. a
// proofread action that must not receive the may-add-formatting rules).
// `model` names the Gemini model, defaulting to DEFAULT_MODEL. A plain array
// of {label, system} is still accepted. Returns {model, prompts}; each prompt
// becomes a rewrite action, in file order — adding an entry adds a button.
export function validatePromptsConfig(json) {
  let entries = json, shared = '', model = DEFAULT_MODEL;
  if (json && !Array.isArray(json) && typeof json === 'object') {
    if (json.model != null) {
      if (typeof json.model !== 'string' || !json.model.trim()) throw new Error('aiPrompts.json "model" must be a non-empty string');
      model = json.model.trim();
    }
    if (json.shared != null) {
      if (typeof json.shared !== 'string') throw new Error('aiPrompts.json "shared" must be a string');
      shared = json.shared.trim();
    }
    entries = json.prompts;
    if (!Array.isArray(entries)) throw new Error('aiPrompts.json "prompts" must be an array of {label, system} entries');
  }
  if (!Array.isArray(entries)) throw new Error('aiPrompts.json must be an array of {label, system} entries');
  if (!entries.length) throw new Error('aiPrompts.json must define at least one prompt');
  const prompts = entries.map((entry, i) => {
    if (!entry || typeof entry !== 'object') throw new Error(`aiPrompts.json entry ${i} must be an object`);
    if (typeof entry.label !== 'string' || !entry.label.trim()) {
      throw new Error(`aiPrompts.json entry ${i} "label" must be a non-empty string`);
    }
    if (typeof entry.system !== 'string' || !entry.system.trim()) {
      throw new Error(`aiPrompts.json entry ${i} "system" must be a non-empty string`);
    }
    if (entry.shared != null && typeof entry.shared !== 'boolean') {
      throw new Error(`aiPrompts.json entry ${i} "shared" must be a boolean`);
    }
    if (entry.description != null && (typeof entry.description !== 'string' || !entry.description.trim())) {
      throw new Error(`aiPrompts.json entry ${i} "description" must be a non-empty string`);
    }
    const useShared = shared && entry.shared !== false;
    const out = { label: entry.label, system: useShared ? `${entry.system}\n\n${shared}` : entry.system };
    if (entry.description != null) out.description = entry.description;
    return out;
  });
  return { model, prompts };
}

// The generateContent request for one rewrite. The key travels in a header
// rather than the documented ?key= query param so it never lands in URLs
// (history, logs, error messages). Temperature is pinned low for the same
// reason samplingOptions existed under Nano: editing wants determinism, and
// the default sampling restructures the same text differently run to run.
// Thinking is kept as close to off as each model family allows — the popover
// is latency-sensitive and an editing task gains nothing from reasoning. The
// two families use mutually exclusive fields (mixing them is a 400): 2.x takes
// thinkingBudget (0 = off), 3.x takes thinkingLevel ('minimal' is its floor).
export function buildGeminiRequest({ model, apiKey, system, text }) {
  const thinkingConfig = /^gemini-2\./.test(model)
    ? { thinkingBudget: 0 }
    : { thinkingLevel: 'minimal' };
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: { temperature: 0.3, thinkingConfig },
    },
  };
}

// Map a generateContent response to the output text, or throw the message the
// popover should show. Key problems must mention Integrations (that's where
// the fix lives); a 429 is transient on the free tier's requests-per-minute
// cap, so it says to wait rather than reading like a failure.
export function parseGeminiResponse(status, json) {
  if (status === 429) throw new Error('The Gemini rate limit was reached — wait a minute and try again.');
  const err = json?.error;
  const keyInvalid = status === 403 || (status === 400 && (
    err?.details?.some(d => d?.reason === 'API_KEY_INVALID') ||
    /API_KEY_INVALID/.test(`${err?.status ?? ''} ${err?.message ?? ''}`)
  ));
  if (keyInvalid) throw new Error('Your Google Gemini API key is missing or invalid — add a valid key in Integrations.');
  if (status < 200 || status >= 300) {
    throw new Error(err?.message ? `The AI request failed: ${err.message}` : `The AI request failed (HTTP ${status}).`);
  }
  if (json?.promptFeedback?.blockReason) throw new Error('The AI declined this text (safety block) — please try different text.');
  const parts = json?.candidates?.[0]?.content?.parts;
  if (!parts?.length) throw new Error('The AI returned no rewrite — please try again.');
  return parts.map(p => p.text ?? '').join('');
}

// One-shot undo snapshot for the rewrite. Native undo never survives a surface
// re-render (every applyResult replaces innerHTML wholesale), so the pre-rewrite
// {value, selStart, selEnd} is kept here and restored by the next Cmd+Z; any
// other edit invalidates it.
export function createAiUndo() {
  let snap = null;
  return {
    capture(s) { snap = s; },
    invalidate() { snap = null; },
    consume() { const s = snap; snap = null; return s; },
    get pending() { return snap !== null; },
  };
}

// Popover UI state → what the controls should show. Pure so the state machine
// is testable without a DOM. `state.kind` is one of: checking | ready |
// no-key | empty | working | error | discarded.
export function deriveUi(state) {
  const ui = { actionsEnabled: false, statusText: '', spin: false, isError: false };
  switch (state.kind) {
    case 'checking':
      return { ...ui, statusText: 'Checking AI availability…', spin: true };
    case 'ready':
      return { ...ui, actionsEnabled: true };
    case 'no-key':
      return { ...ui, statusText: 'Add your Google Gemini API key in Integrations to enable AI rewrite.' };
    case 'empty':
      return { ...ui, statusText: 'Nothing to rewrite yet.' };
    case 'working':
      return { ...ui, spin: true, statusText: 'Rewriting…' };
    case 'error':
      return { ...ui, actionsEnabled: true, statusText: state.message || 'Rewrite failed — please try again.', isError: true };
    case 'discarded':
      return { ...ui, actionsEnabled: true, statusText: 'The text changed while rewriting — result discarded.', isError: true };
    default:
      return ui;
  }
}

// ── Engine (fetch/chrome — lazy, nothing runs at import) ─────────────────────

let _promptsPromise = null;
export function loadAiPrompts() {
  _promptsPromise ??= fetch(chrome.runtime.getURL('config/aiPrompts.json'))
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(validatePromptsConfig)
    .catch(err => {
      _promptsPromise = null; // a transient failure shouldn't poison every later attempt
      console.error('MB Error: Failed to load aiPrompts.json:', err);
      throw new Error('Could not load the AI prompt configuration.');
    });
  return _promptsPromise;
}

async function getStoredKey() {
  const store = await chrome.storage.local.get(GEMINI_STORAGE_KEY);
  return store[GEMINI_STORAGE_KEY]?.geminiApiKey || '';
}

export async function getAvailability() {
  try {
    return (await getStoredKey()) ? 'available' : 'no-key';
  } catch {
    return 'no-key';
  }
}

// Reword `text` under the given system prompt. Resolves with the raw model
// output (pass through normalizeModelOutput before splicing it in).
export async function rewrite({ model, system, text, signal }) {
  const apiKey = await getStoredKey().catch(() => '');
  if (!apiKey) throw new Error('Your Google Gemini API key is missing or invalid — add a valid key in Integrations.');
  const { url, headers, body } = buildGeminiRequest({ model: model || DEFAULT_MODEL, apiKey, system, text });
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  const json = await res.json().catch(() => ({}));
  return parseGeminiResponse(res.status, json);
}
