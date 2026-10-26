/**
 * actionPlayer.js — replays a saved Action on the current page.
 *
 * Steps run one at a time, in order. Each step waits up to STEP_WAIT_MS for
 * its element to resolve to exactly one enabled match, then replays the
 * interaction a person would have produced (see playSet: focus → native value
 * setter → InputEvent → keyup → change → blur; real .click() for buttons and
 * toggles) so the host's Stimulus controllers and autosave hooks react as
 * they would to a person. The first step whose
 * element never appears (or that throws) stops the run: an error form names
 * it and lists what did run; nothing after it is attempted.
 *
 * There is deliberately NO up-front "does every element exist" check: steps
 * routinely target controls that only exist after an earlier step runs
 * (a popover's inputs, a dialog's confirm button), so checking the whole
 * segment first would refuse perfectly good actions.
 *
 * While a run is live a full-page veil (actionPlayVeil.js) blocks the person's
 * own clicks and keys and offers Cancel (also Escape). Cancel is honoured
 * immediately: the per-step wait and the navigation wait both race the abort.
 *
 * Multi-page: a step followed by a `navigate` marker persists progress to the
 * tab's sessionStorage (PLAYBACK_KEY) BEFORE it runs, then waits for the new
 * page to settle. A Turbo visit keeps this context alive and the loop just
 * continues; a hard navigation kills it, and the next document's content.js
 * sees the key and calls resumeActionSession → resumePlayback(), which skips
 * the marker and carries on. Nothing is shared across tabs, so several tabs
 * can play at once.
 *
 * Pure parts (state, performStep, setNativeValue, session helpers) are tested
 * in tests/actionPlayer.test.mjs; the controller is thin.
 */

import { segmentBounds, summariseStep } from './actionSteps.js';
import { resolveLocator, defaultIsVisible } from './actionLocators.js';
import { isOwnUi } from './actionRecorder.js';
import { mountPlayVeil } from './actionPlayVeil.js';
import { createNavigationWatcher } from './pageNavigation.js';
import { createForm } from './form.js';
import { escapeHtml } from './cardRenderer.js';

export const PLAYBACK_KEY = 'moreButtonsActionPlayback';

const STEP_WAIT_MS = 3000, STEP_POLL_MS = 100, NAV_WAIT_MS = 10000, SETTLE_GRACE_MS = 150;

// ── State ───────────────────────────────────────────────────────────────────────

const defaultId = () => (globalThis.crypto?.randomUUID?.() ?? `r-${Date.now().toString(36)}`);

export function newPlaybackState(action, { askValues = {}, now = Date.now(), runId = defaultId() } = {}) {
  return { v: 1, runId, actionId: action.id, name: action.name, steps: action.steps, nextIndex: 0, askValues, log: [], startedAt: now };
}

export function playbackTitle(state) {
  const n = state.steps.length;
  return `Playing · step ${Math.min(state.nextIndex + 1, n)} of ${n}`;
}
/** Veil copy: the action's name up top, progress underneath. */
export const veilTitle = state => `Playing “${state.name}”`;
export const veilSubtitle = state => `Step ${Math.min(state.nextIndex + 1, state.steps.length)} of ${state.steps.length}`;

/**
 * What goes to sessionStorage. Ask-at-play values are secrets typed for this
 * run: only the ones a step still to run needs are written, and each is
 * dropped from the record as soon as its step has run. The in-memory state
 * keeps the full set.
 */
export function persistedState(state) {
  const pending = new Set(state.steps.slice(state.nextIndex).filter(s => s.askAtPlay).map(s => s.id));
  const askValues = {};
  for (const [id, v] of Object.entries(state.askValues ?? {})) if (pending.has(id)) askValues[id] = v;
  return { ...state, askValues };
}

export function readPlayback(storage) {
  try {
    const raw = storage.getItem(PLAYBACK_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || s.v !== 1 || !Array.isArray(s.steps) || typeof s.nextIndex !== 'number') return null;
    return s;
  } catch { return null; }
}
export function writePlayback(storage, state) { try { storage.setItem(PLAYBACK_KEY, JSON.stringify(state)); } catch {} }
export function clearPlayback(storage) { try { storage.removeItem(PLAYBACK_KEY); } catch {} }

// ── Failures ────────────────────────────────────────────────────────────────────

/** Visibility for locator ties at playback: the extension's own bars/overlays never count. */
export const playerIsVisible = el => defaultIsVisible(el) && !isOwnUi(el);
const RESOLVE_OPTS = { isVisible: playerIsVisible };

/**
 * One line for the error form. `reason` wins when set; otherwise the locator
 * attempts are summarised ({ tried: [{ count }] } from resolveLocator, with
 * `waitedMs` when the step timed out waiting for the element).
 */
export function describeFailure(f) {
  const title = f.step ? summariseStep(f.step).title : 'unknown step';
  const head = `Step ${f.index + 1} · ${title}`;
  if (f.reason) return `${head} — ${f.reason}`;
  const counts = (f.tried ?? []).map(t => t.count);
  const waited = f.waitedMs ? ` after waiting ${Math.round(f.waitedMs / 1000)} s` : '';
  return `${head} — no element found${waited}: tried ${counts.length} way${counts.length === 1 ? '' : 's'} (matches: ${counts.join(', ') || 'none'})`;
}

// ── Step execution ───────────────────────────────────────────────────────────────

/** Set `value` through the element's PROTOTYPE setter so framework-level instance overrides (React et al.) don't swallow it. */
export function setNativeValue(el, value) {
  let proto = Object.getPrototypeOf(el);
  let desc = null;
  while (proto && proto !== Object.prototype) {
    desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc) break;
    proto = Object.getPrototypeOf(proto);
  }
  if (desc?.set) desc.set.call(el, value);
  else el.value = value;
}

const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
// Typed event when the platform has it (browsers), else a plain Event carrying
// the same fields (Node tests) so handlers reading ev.key / ev.inputType agree.
const typedEvent = (name, type, init) => {
  const C = globalThis[name];
  if (C) return new C(type, init);
  const { bubbles, cancelable, ...extra } = init;
  return Object.assign(new Event(type, { bubbles, cancelable }), extra);
};

/**
 * A `set` is played as the WHOLE interaction a person would produce, not just
 * the value flip, because live-save editors hook different points of it:
 *   focus → value → input (InputEvent, insertText) → keyup → change → blur
 * Stimulus `input->`/`change->` handlers see the first two; debounce-on-keyup
 * savers see the keyup; "save when the field is left" savers (focusout/blur,
 * the most common autosave trigger) see the blur. focus()/blur() are the real
 * methods, so the browser emits focusin/focus and blur/focusout itself.
 */
function playSet(el, value) {
  try { el.focus?.({ preventScroll: true }); } catch {}
  setNativeValue(el, value);
  el.dispatchEvent(typedEvent('InputEvent', 'input', { bubbles: true, inputType: 'insertText', data: value }));
  const key = value.length ? value.at(-1) : 'Unidentified';
  el.dispatchEvent(typedEvent('KeyboardEvent', 'keyup', { bubbles: true, cancelable: true, key }));
  fire(el, 'change');
  try { el.blur?.(); } catch {}
}

export async function performStep(step, el, askValues = {}) {
  switch (step.kind) {
    case 'set': {
      const value = step.askAtPlay ? String(askValues?.[step.id] ?? '') : String(step.value ?? '');
      playSet(el, value);
      if (el.tagName?.toLowerCase() === 'select' && el.value !== value) throw new Error('Option not found');
      return;
    }
    case 'check':
      if (!!el.checked !== !!step.value) el.click();
      return;
    case 'choose':
      if (!el.checked) el.click();
      return;
    case 'click':
      try { el.focus?.({ preventScroll: true }); } catch {}
      el.click();
      return;
    default:
      throw new Error(`Cannot play a "${step.kind}" step`);
  }
}

// ── Controller ───────────────────────────────────────────────────────────────────

let active = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function defaultEnv(env) {
  const doc = env.doc ?? document;
  const win = env.win ?? window;
  return {
    doc, win,
    storage: env.storage ?? win.sessionStorage,
    mountVeil: env.mountVeil ?? mountPlayVeil,
    watcherFactory: env.watcherFactory ?? createNavigationWatcher,
    showError: env.showError ?? showErrorForm,
  };
}

/**
 * Poll until the step's element resolves to exactly one usable match, the
 * deadline passes, or `aborted()` turns true. Returns { el } on success, else
 * { el: null, tried, reason?, aborted? } where `reason` is set when a match
 * existed but stayed disabled/read-only (so the error form can say which).
 */
async function waitFor(locator, root, { step, deadline, aborted = () => false }) {
  for (;;) {
    const { el, tried } = resolveLocator(locator, root, RESOLVE_OPTS);
    if (el && !el.disabled && !(step.kind === 'set' && el.readOnly)) return { el };
    if (aborted()) return { el: null, tried, aborted: true };
    if (Date.now() >= deadline) {
      if (el) return { el: null, tried, reason: el.disabled ? 'element stayed disabled' : 'field stayed read-only' };
      return { el: null, tried };
    }
    await sleep(STEP_POLL_MS);
  }
}

/**
 * Resolves true once a DIFFERENT page has settled, false on timeout. Only a
 * body swap counts: on a Turbo visit the href changes at turbo:visit while
 * the old body is still mounted, and the watcher's own fallback timer would
 * otherwise "settle" that stale body after 1.5 s on any slow server round
 * trip. The fallback is therefore pushed out to our own timeout. (A hard
 * navigation kills this context; resumePlayback picks up from the record.)
 * Exported for tests/actionPlayer.test.mjs.
 */
export function waitForNavigationSettle(env, timeoutMs) {
  const { doc, win } = env;
  const bodyBefore = doc.body;
  return new Promise(resolve => {
    let done = false;
    const finish = ok => { if (done) return; done = true; clearTimeout(timer); watcher.stop(); resolve(ok); };
    const watcher = env.watcherFactory({ doc, win, fallbackMs: timeoutMs, onNavigate: () => {}, onSettle: () => { if (doc.body !== bodyBefore) finish(true); } });
    const timer = setTimeout(() => finish(false), timeoutMs);
    watcher.start();
  });
}

// Resolves when THIS page has settled (used on resume, where content.js may
// run at document_start). Same long fallback: a slow page must not be
// preflighted half-loaded.
function waitForCurrentSettle(env) {
  const { doc, win } = env;
  return new Promise(resolve => {
    let done = false;
    const watcher = env.watcherFactory({ doc, win, fallbackMs: NAV_WAIT_MS, onNavigate: () => {}, onSettle: () => { if (done) return; done = true; watcher.stop(); resolve(); } });
    watcher.start();
  });
}

async function showErrorForm(state, failures) {
  const { content } = await createForm('errorActionPlayback');
  if (!content) return;
  const played = state.log.filter(l => l.ok).length;
  content.querySelector('[data-error-summary]').textContent =
    `“${state.name}” stopped${played ? ` after ${played} step${played === 1 ? '' : 's'}` : ' before running anything'}. Nothing else was changed.`;
  const list = content.querySelector('[data-failed-list]');
  if (list) list.innerHTML = failures.map(f => `<div class="mb-action-error__row">${escapeHtml(describeFailure(f))}</div>`).join('');
  const playedEl = content.querySelector('[data-played-list]');
  if (playedEl) {
    const rows = state.log.filter(l => l.ok).map(l => `<div class="mb-action-error__row --ok">Step ${l.index + 1} · ${escapeHtml(summariseStep(state.steps[l.index]).title)}</div>`);
    playedEl.innerHTML = rows.join('');
    playedEl.closest('[data-played-wrap]')?.toggleAttribute('hidden', rows.length === 0);
  }
}

async function run(initial, env) {
  const { doc, storage } = env;
  let state = initial;
  let aborted = false;
  let signalAbort = () => {};
  const abortP = new Promise(r => { signalAbort = r; });
  const abort = () => { aborted = true; signalAbort(); };
  const isAborted = () => aborted;
  const persist = () => writePlayback(storage, persistedState(state));

  const veil = env.mountVeil({ title: veilTitle(state), subtitle: veilSubtitle(state), onCancel: abort, doc: env.doc, win: env.win });
  const teardown = () => { clearPlayback(storage); veil.remove(); active = null; };
  const fail = failures => { teardown(); return env.showError(state, failures); };
  active = { stop: abort };

  const steps = state.steps;
  try {
  while (state.nextIndex < steps.length) {
    if (aborted) return teardown();
    if (steps[state.nextIndex].kind === 'navigate') { state = { ...state, nextIndex: state.nextIndex + 1 }; persist(); continue; }

    const { end, navigateAt } = segmentBounds(steps, state.nextIndex);

    for (let i = state.nextIndex; i < end; i++) {
      if (aborted) return teardown();
      const step = steps[i];
      const navNext = navigateAt === i + 1;
      veil.setSubtitle?.(veilSubtitle({ ...state, nextIndex: i }));
      // A step that will navigate may kill this context: record where to pick up first.
      if (navNext) { state = { ...state, nextIndex: i + 1 }; persist(); }
      const found = await waitFor(step.locator, doc, { step, deadline: Date.now() + STEP_WAIT_MS, aborted: isAborted });
      if (found.aborted) return teardown();
      if (!found.el) return fail([{ index: i, step, tried: found.tried, reason: found.reason, waitedMs: STEP_WAIT_MS }]);
      const el = found.el;
      try { await performStep(step, el, state.askValues); }
      catch (e) { return fail([{ index: i, step, reason: e.message }]); }
      state = { ...state, log: [...state.log, { index: i, ok: true }], nextIndex: navNext ? i + 1 : i + 1 };
      if (!navNext) persist();
      if (navNext) {
        const moved = await Promise.race([waitForNavigationSettle(env, NAV_WAIT_MS), abortP.then(() => null)]);
        if (aborted) return teardown();
        if (!moved) return fail([{ index: i, step, reason: 'expected the page to change after this step, but it did not' }]);
        await sleep(SETTLE_GRACE_MS);
        state = { ...state, nextIndex: navigateAt + 1 }; persist();
      }
    }
  }
  const done = `Played · ${steps.length} step${steps.length === 1 ? '' : 's'}`;
  if (veil.setDone) veil.setDone(done, `“${state.name}” finished`); else veil.setTitle(done);
  await sleep(900);
  teardown();
  } catch (e) {
    // Anything the loop didn't expect: never leave the veil up or `active` set.
    const i = Math.min(state.nextIndex, steps.length - 1);
    console.error('[MB actions] playback crashed:', e);
    if (active) return fail([{ index: Math.max(i, 0), step: steps[i], reason: `unexpected error: ${e?.message ?? e}` }]);
  }
}

/** Start playing `action` on this page. `askValues` = { [stepId]: value } for ask-at-play steps. */
export async function startPlayback(action, { askValues = {} } = {}, envIn = {}) {
  if (active) return;
  const env = defaultEnv(envIn);
  const state = newPlaybackState(action, { askValues });
  writePlayback(env.storage, persistedState(state));
  return run(state, env);
}

/** Continue a playback after a hard navigation. Returns false when there is nothing to resume. */
export async function resumePlayback(envIn = {}) {
  if (active) return true;
  const env = defaultEnv(envIn);
  const state = readPlayback(env.storage);
  if (!state) return false;
  await waitForCurrentSettle(env);
  await new Promise(r => (env.win.requestAnimationFrame ?? setTimeout)(r));
  await sleep(SETTLE_GRACE_MS);
  await run(state, env);
  return true;
}

export const stopPlayback = () => active?.stop();
export const isPlaying = () => !!active;
