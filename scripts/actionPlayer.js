/**
 * actionPlayer.js — replays a saved Action on the current page.
 *
 * Safety first: before anything runs, every step in the current page SEGMENT
 * (up to the next `navigate` marker) must resolve to exactly one element, or
 * an error form lists the misses and nothing is touched. Steps then run with
 * realistic DOM events (native value setter + input/change, real .click()) so
 * the host's Stimulus controllers react as they would to a person.
 *
 * Multi-page: a step followed by a `navigate` marker persists progress to the
 * tab's sessionStorage (PLAYBACK_KEY) BEFORE it runs, then waits for the new
 * page to settle. A Turbo visit keeps this context alive and the loop just
 * continues; a hard navigation kills it, and the next document's content.js
 * sees the key and calls resumeActionSession → resumePlayback(), which skips
 * the marker, preflights the new segment and carries on. Nothing is shared
 * across tabs, so several tabs can play at once.
 *
 * Pure parts (state, preflight, performStep, setNativeValue, session helpers)
 * are tested in tests/actionPlayer.test.mjs; the controller is thin.
 */

import { segmentBounds, summariseStep } from './actionSteps.js';
import { resolveLocator } from './actionLocators.js';
import { mountActionBar } from './actionToolbar.js';
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

// ── Preflight ───────────────────────────────────────────────────────────────────

/** Resolve every step in [from, next navigate). { ok, end, failures: [{ index, step, tried }] }. */
export function preflightSegment(steps, from, root, opts = {}) {
  const { end } = segmentBounds(steps, from);
  const failures = [];
  for (let i = from; i < end; i++) {
    const r = resolveLocator(steps[i].locator, root, opts);
    if (!r.el) failures.push({ index: i, step: steps[i], tried: r.tried });
  }
  return { ok: failures.length === 0, end, failures };
}

export function describeFailure(f) {
  const { title } = summariseStep(f.step);
  const head = `Step ${f.index + 1} · ${title}`;
  if (f.reason) return `${head} — ${f.reason}`;
  const counts = (f.tried ?? []).map(t => t.count);
  return `${head} — no element found: tried ${counts.length} way${counts.length === 1 ? '' : 's'} (matches: ${counts.join(', ') || 'none'})`;
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

export async function performStep(step, el, askValues = {}) {
  switch (step.kind) {
    case 'set': {
      const value = step.askAtPlay ? String(askValues?.[step.id] ?? '') : String(step.value ?? '');
      setNativeValue(el, value);
      fire(el, 'input');
      fire(el, 'change');
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
    mountBar: env.mountBar ?? mountActionBar,
    watcherFactory: env.watcherFactory ?? createNavigationWatcher,
    showError: env.showError ?? showErrorForm,
  };
}

async function waitFor(locator, root, { step, deadline }) {
  for (;;) {
    const { el } = resolveLocator(locator, root);
    if (el && !el.disabled && !(step.kind === 'set' && el.readOnly)) return el;
    if (Date.now() >= deadline) return null;
    await sleep(STEP_POLL_MS);
  }
}

// Resolves when a DIFFERENT page has settled (body swapped or href changed).
function waitForNavigationSettle(env, timeoutMs) {
  const { doc, win } = env;
  const bodyBefore = doc.body, hrefBefore = win.location.href;
  return new Promise(resolve => {
    let done = false;
    const finish = ok => { if (done) return; done = true; clearTimeout(timer); watcher.stop(); resolve(ok); };
    const watcher = env.watcherFactory({ doc, win, onNavigate: () => {}, onSettle: url => { if (doc.body !== bodyBefore || url !== hrefBefore) finish(true); } });
    const timer = setTimeout(() => finish(false), timeoutMs);
    watcher.start();
  });
}

// Resolves when THIS page has settled (used on resume, where content.js may run at document_start).
function waitForCurrentSettle(env) {
  const { doc, win } = env;
  return new Promise(resolve => {
    let done = false;
    const watcher = env.watcherFactory({ doc, win, onNavigate: () => {}, onSettle: () => { if (done) return; done = true; watcher.stop(); resolve(); } });
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
  const persist = () => writePlayback(storage, persistedState(state));

  const bar = env.mountBar({
    variant: 'playing', title: playbackTitle(state),
    controls: [{ id: 'stop', icon: 'square', label: 'Stop playback', kind: 'close' }],
    escapeControl: 'stop',
    onControl: () => { aborted = true; },
    doc: env.doc, win: env.win,
  });
  bar.setArmed(true);
  const teardown = () => { clearPlayback(storage); bar.remove(); active = null; };
  const fail = failures => { teardown(); return env.showError(state, failures); };
  active = { stop: () => { aborted = true; } };

  const steps = state.steps;
  while (state.nextIndex < steps.length) {
    if (aborted) return teardown();
    if (steps[state.nextIndex].kind === 'navigate') { state = { ...state, nextIndex: state.nextIndex + 1 }; persist(); continue; }

    const pre = preflightSegment(steps, state.nextIndex, doc);
    if (!pre.ok) return fail(pre.failures);
    const { end, navigateAt } = segmentBounds(steps, state.nextIndex);

    for (let i = state.nextIndex; i < end; i++) {
      if (aborted) return teardown();
      const step = steps[i];
      const navNext = navigateAt === i + 1;
      bar.setTitle(playbackTitle({ ...state, nextIndex: i }));
      // A step that will navigate may kill this context: record where to pick up first.
      if (navNext) { state = { ...state, nextIndex: i + 1 }; persist(); }
      const el = await waitFor(step.locator, doc, { step, deadline: Date.now() + STEP_WAIT_MS });
      if (!el) return fail([{ index: i, step, reason: 'element disappeared or stayed disabled' }]);
      try { await performStep(step, el, state.askValues); }
      catch (e) { return fail([{ index: i, step, reason: e.message }]); }
      state = { ...state, log: [...state.log, { index: i, ok: true }], nextIndex: navNext ? i + 1 : i + 1 };
      if (!navNext) persist();
      if (navNext) {
        const moved = await waitForNavigationSettle(env, NAV_WAIT_MS);
        if (!moved) return fail([{ index: i, step, reason: 'expected the page to change after this step, but it did not' }]);
        await sleep(SETTLE_GRACE_MS);
        state = { ...state, nextIndex: navigateAt + 1 }; persist();
      }
    }
  }
  bar.setTitle(`Played · ${steps.length} step${steps.length === 1 ? '' : 's'}`);
  await sleep(900);
  teardown();
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
