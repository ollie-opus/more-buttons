// AI Rewrite engine for the rich text editor — rewords a markdown string with
// Chrome's built-in on-device Prompt API (Gemini Nano). The prompt profiles
// live in config/aiPrompts.json — each entry ({label, system}) becomes a
// rewrite button, so both the wording and the set of actions can be changed
// without a code change.
//
// `rewrite`/`getAvailability` run in the background service worker by default
// (sendMessage for the availability check, a long-lived Port for the rewrite —
// each port message resets the MV3 idle timer, keeping the worker alive through
// a multi-second prompt or a multi-minute model download). Two reasons the SW
// is primary rather than a fallback: on Chrome 138–149 the content-script
// world may not expose LanguageModel at all (web exposure was origin-trial-
// gated), and calling availability() in a page renderer was observed to block
// the main thread while the model download is in flight (CDP-verified on
// Chrome 150) — a stall in the worker leaves the form UI responsive, the same
// stall in-page freezes it. Direct in-context LanguageModel is kept only as
// the fallback for when the extension messaging channel itself fails.
//
// Everything above the "engine" divider is pure and unit-tested; the module
// touches fetch/chrome only inside function bodies so importing it in node
// tests is safe (same rule as richTextEditor.js).

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

// The on-device model sometimes invents structure despite the prompts telling
// it not to. If the source had no markdown headings, any heading in the output
// is made up: a LEADING heading is an invented title (drop the whole line), a
// later one is restructured content (keep the text, strip the marker so
// nothing is lost). Lines inside code fences are left alone.
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
// The file is {shared, prompts: [{label, system, description?}]} — `shared`
// (optional) holds
// the formatting rules common to every prompt and is appended to each system
// prompt here, so the rules live in one place as the editor's feature set
// grows; an entry can opt out with "shared": false (e.g. a proofread action
// that must not receive the may-add-formatting rules). A plain array of
// {label, system} is still accepted. Each entry becomes a rewrite action, in
// file order — adding an entry adds a button.
export function validatePromptsConfig(json) {
  let entries = json, shared = '';
  if (json && !Array.isArray(json) && typeof json === 'object') {
    if (json.shared != null) {
      if (typeof json.shared !== 'string') throw new Error('aiPrompts.json "shared" must be a string');
      shared = json.shared.trim();
    }
    entries = json.prompts;
    if (!Array.isArray(entries)) throw new Error('aiPrompts.json "prompts" must be an array of {label, system} entries');
  }
  if (!Array.isArray(entries)) throw new Error('aiPrompts.json must be an array of {label, system} entries');
  if (!entries.length) throw new Error('aiPrompts.json must define at least one prompt');
  return entries.map((entry, i) => {
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
}

// Sampling overrides for LanguageModel.create, from LanguageModel.params().
// Editing wants determinism, not variety: the default sampling is tuned for
// creative tasks and makes the same prompt restructure text differently run to
// run. Low temperature + small topK pin it down. The API requires temperature
// and topK together and rejects out-of-range values, so both are clamped to
// the device caps; when params are unavailable, return no overrides so
// create() falls back to its own defaults instead of throwing.
export function samplingOptions(params) {
  const maxTemp = params?.maxTemperature, maxTopK = params?.maxTopK;
  if (typeof maxTemp !== 'number' || typeof maxTopK !== 'number') return {};
  return { temperature: Math.min(0.3, maxTemp), topK: Math.max(1, Math.min(3, maxTopK)) };
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
// downloadable | downloading | unavailable | empty | working | error | discarded.
export function deriveUi(state) {
  const ui = { actionsEnabled: false, statusText: '', spin: false, isError: false };
  switch (state.kind) {
    case 'checking':
      return { ...ui, statusText: 'Checking on-device AI availability…', spin: true };
    case 'ready':
      return { ...ui, actionsEnabled: true };
    case 'downloadable':
      return { ...ui, actionsEnabled: true, statusText: 'First use downloads the on-device AI model (a few GB, one-time).' };
    case 'downloading':
      return { ...ui, statusText: 'The on-device AI model is downloading — try again shortly.', spin: true };
    case 'unavailable':
      return { ...ui, statusText: 'AI rewrite is not available on this device. It needs Chrome 138+ with on-device AI support and enough free disk space.' };
    case 'empty':
      return { ...ui, statusText: 'Nothing to rewrite yet.' };
    case 'working':
      return {
        ...ui,
        spin: true,
        statusText: state.progress != null && state.progress < 1
          ? `Downloading AI model… ${Math.round(state.progress * 100)}%`
          : 'Rewriting…',
      };
    case 'error':
      return { ...ui, actionsEnabled: true, statusText: state.message || 'Rewrite failed — please try again.', isError: true };
    case 'discarded':
      return { ...ui, actionsEnabled: true, statusText: 'The text changed while rewriting — result discarded.', isError: true };
    default:
      return ui;
  }
}

// ── Engine (fetch/chrome/LanguageModel — lazy, nothing runs at import) ───────

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

export async function getAvailability() {
  try {
    const viaWorker = await chrome.runtime.sendMessage({ type: 'aiAvailability' });
    if (viaWorker != null) return viaWorker;
  } catch { /* messaging failed — try the local context below */ }
  if (typeof LanguageModel !== 'undefined') {
    try { return await LanguageModel.availability(); } catch { /* fall through */ }
  }
  return 'unavailable';
}

async function rewriteLocal({ system, text, signal, onProgress }) {
  const session = await LanguageModel.create({
    initialPrompts: [{ role: 'system', content: system }],
    ...samplingOptions(await LanguageModel.params().catch(() => null)),
    monitor(m) { m.addEventListener('downloadprogress', e => onProgress?.(e.loaded)); },
    signal,
  });
  try {
    return await session.prompt(text, { signal });
  } finally {
    session.destroy();
  }
}

function rewriteViaBackground({ system, text, signal, onProgress }) {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: 'mb-ai' });
    let settled = false;
    const settle = (fn, arg) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      try { port.disconnect(); } catch { /* already gone */ }
      fn(arg);
    };
    const onAbort = () => settle(reject, new DOMException('Aborted', 'AbortError'));
    signal?.addEventListener('abort', onAbort);
    port.onMessage.addListener(msg => {
      if (msg.type === 'progress' && msg.loaded != null) onProgress?.(msg.loaded);
      else if (msg.type === 'result') settle(resolve, msg.text);
      else if (msg.type === 'error') settle(reject, new Error(msg.message));
    });
    port.onDisconnect.addListener(() => settle(reject, new Error('The AI rewrite was interrupted — please try again.')));
    port.postMessage({ type: 'rewrite', system, text });
  });
}

// Reword `text` under the given system prompt. Resolves with the raw model
// output (pass through normalizeModelOutput before splicing it in).
export function rewrite(opts) {
  if (typeof chrome !== 'undefined' && chrome.runtime?.connect) return rewriteViaBackground(opts);
  return rewriteLocal(opts);
}
