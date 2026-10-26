/**
 * actionRecorder.js — records what the user does on the host page as steps.
 *
 * Listens on the document in the CAPTURE phase (so Stimulus/Turbo handlers
 * can't swallow anything), turns clicks / changes / submits into steps via
 * actionSteps.js, and shows the actionToolbar.js bar (Pause · Stop · Cancel).
 *
 * The in-flight recording lives in the tab's sessionStorage (RECORDING_KEY)
 * and is re-persisted on every change, so it survives Turbo visits (the bar
 * itself sits beside <body> and survives those too) and full page loads:
 * content.js sees the key and calls resumeActionSession → resumeRecording(),
 * which appends a `navigate` marker if the path moved while we were away.
 *
 * Hand-offs (Stop / Cancel) go through the form-action registry by NAME, not
 * closures, because the context that started a recording may be long gone:
 *   finishActionRecording({ state })   steps recorded → name prompt / editor splice
 *   cancelActionRecording({ state })   discarded → reopen the originating form
 *
 * The classification helpers and reducers are pure and tested in
 * tests/actionRecorder.test.mjs; the controller is thin over them.
 */

import { makeStep, appendStep, appendNavigate } from './actionSteps.js';
import { buildLocator, describeElement, labelTextFor, norm } from './actionLocators.js';
import { mountActionBar } from './actionToolbar.js';
import { createNavigationWatcher } from './pageNavigation.js';
import { getFormAction } from './formActions.js';

export const RECORDING_KEY = 'moreButtonsActionRecording';

// Explicit roots only. The host is Tailwind v4, where `mb-4` is a margin class,
// so a `[class*="mb-"]` ignore rule would swallow half the page.
export const OWN_UI_SELECTOR = '.mb-capture-bar, .mb-capture-tab, .mb-capture-bar__popover, .more-buttons-overlay, .more-buttons-loading-tile, #mb-page-dock, .mb-page-dock';
export const isOwnUi = target => !!target?.closest?.(OWN_UI_SELECTOR);

const CLICKABLE = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="option"], summary, input[type="button"], input[type="submit"], input[type="reset"]';
const BUTTON_INPUT_TYPES = new Set(['button', 'submit', 'reset']);
const SUBMIT_WINDOW_MS = 400;

const tagOf = el => el.tagName.toLowerCase();
const typeOf = el => (el.getAttribute('type') || '').toLowerCase();

// ── Classification (pure) ──────────────────────────────────────────────────────

/** What a click means: { kind: 'ignore' } | { kind: 'flash', message } | { kind: 'click', el }. */
export function classifyClick(target) {
  if (!target || isOwnUi(target)) return { kind: 'ignore' };
  const ctl = target.closest('input, textarea, select');
  if (ctl) {
    const type = typeOf(ctl);
    if (tagOf(ctl) === 'input' && BUTTON_INPUT_TYPES.has(type)) return { kind: 'click', el: ctl };
    if (type === 'file') return { kind: 'flash', message: 'File pickers aren’t recorded' };
    return { kind: 'ignore' }; // focusing / typing: the change event is the step
  }
  const label = target.closest('label');
  if (label && (label.control || label.getAttribute('for'))) return { kind: 'ignore' };
  return { kind: 'click', el: target.closest(CLICKABLE) ?? target };
}

export function clickStep(el, newId) {
  return makeStep('click', { locator: buildLocator(el), describe: describeElement(el) }, newId);
}

/** A change on a form control → { step, flash? } ({ step: null } when nothing to record). */
export function stepFromChange(el, newId) {
  const tag = tagOf(el);
  const type = typeOf(el);
  const base = { locator: buildLocator(el), describe: describeElement(el) };
  if (tag === 'input') {
    if (type === 'hidden') return { step: null };
    if (type === 'checkbox') return { step: makeStep('check', { ...base, value: !!el.checked }, newId) };
    if (type === 'radio') {
      const legend = el.closest?.('fieldset')?.querySelector?.('legend');
      const group = el.getAttribute('name') ?? '';
      const describe = { ...base.describe, label: norm(legend?.textContent) || group || base.describe.label, group, optionText: labelTextFor(el) || String(el.value ?? '') };
      return { step: makeStep('choose', { ...base, describe, value: String(el.value ?? '') }, newId) };
    }
    if (type === 'password') {
      return { step: makeStep('set', { ...base, value: null, askAtPlay: true }, newId), flash: 'Password field → ask at play' };
    }
    return { step: makeStep('set', { ...base, value: String(el.value ?? '') }, newId) };
  }
  if (tag === 'select') {
    const opt = el.options?.[el.selectedIndex];
    const describe = { ...base.describe, optionText: norm(opt?.textContent) || String(el.value ?? '') };
    return { step: makeStep('set', { ...base, describe, value: String(el.value ?? '') }, newId) };
  }
  if (tag === 'textarea') return { step: makeStep('set', { ...base, value: String(el.value ?? '') }, newId) };
  return { step: null };
}

/**
 * A form submission → the click that caused it, unless that click was just
 * recorded (button click → submit fires straight after). Enter-key submits
 * have no click, so the submitter / default submit button is recorded instead.
 */
export function submitStepFor(form, submitter, { lastStep, lastStepAt, now }, newId) {
  const el = submitter ?? form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
  if (!el) return { step: null, flash: 'Enter-submit couldn’t be recorded (no submit button)' };
  const key = buildLocator(el).key;
  if (lastStep?.kind === 'click' && lastStep.locator?.key === key && now - lastStepAt < SUBMIT_WINDOW_MS) return null;
  return { step: clickStep(el, newId) };
}

// ── Session state (pure reducers + storage helpers) ─────────────────────────────

export function newRecordingState({ mode = 'new', insert = null, path, now }) {
  return { v: 1, phase: 'recording', mode, insert: mode === 'insert' ? insert : null, steps: [], lastPath: path, startedAt: now, lastStepAt: 0 };
}

export function recordStep(state, step, now) {
  return { ...state, steps: appendStep(state.steps, step), lastStepAt: now };
}

export function recordNavigation(state, path) {
  if (path === state.lastPath) return state;
  return { ...state, steps: appendNavigate(state.steps, path), lastPath: path };
}

export function recordingTitle(state) {
  const n = state.steps.length;
  const word = state.phase === 'paused' ? 'Paused' : state.mode === 'insert' ? 'Inserting' : 'Recording';
  return `${word} · ${n} step${n === 1 ? '' : 's'}`;
}

const PHASES = new Set(['recording', 'paused', 'naming']);
const MODES = new Set(['new', 'insert']);

export function readRecording(storage) {
  try {
    const raw = storage.getItem(RECORDING_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || s.v !== 1 || !Array.isArray(s.steps) || !MODES.has(s.mode) || !PHASES.has(s.phase)) return null;
    return s;
  } catch { return null; }
}
export function writeRecording(storage, state) {
  try { storage.setItem(RECORDING_KEY, JSON.stringify(state)); } catch {}
}
export function clearRecording(storage) {
  try { storage.removeItem(RECORDING_KEY); } catch {}
}

// ── Controller ─────────────────────────────────────────────────────────────────

let active = null;

const curPath = win => win.location.pathname + win.location.search;
const pathOf = url => { try { const u = new URL(url); return u.pathname + u.search; } catch { return url; } };

function defaultEnv(env) {
  const doc = env.doc ?? document;
  const win = env.win ?? window;
  return {
    doc, win,
    storage: env.storage ?? win.sessionStorage,
    now: env.now ?? Date.now,
    mountBar: env.mountBar ?? mountActionBar,
    watcherFactory: env.watcherFactory ?? createNavigationWatcher,
    dispatch: env.dispatch ?? ((name, payload) => Promise.resolve(getFormAction(name)?.(payload)).catch(e => console.error('[MB actions] recorder hand-off failed:', name, e))),
    confirm: env.confirm ?? (msg => win.confirm(msg)),
  };
}

function attach(initial, env) {
  const { doc, win, storage, now } = env;
  let state = initial;
  const persist = () => writeRecording(storage, state);

  const bar = env.mountBar({
    variant: state.phase === 'paused' ? 'paused' : 'recording',
    title: recordingTitle(state),
    controls: [
      { id: 'pause', icon: 'pause', label: 'Pause' },
      { id: 'stop', icon: 'square', label: 'Stop' },
      { id: 'cancel', icon: 'x', label: 'Cancel recording', kind: 'close' },
    ],
    escapeControl: 'cancel',
    onControl: id => ({ pause: togglePause, stop: finish, cancel })[id]?.(),
    doc, win,
  });
  const paintPhase = () => {
    const paused = state.phase === 'paused';
    bar.setVariant(paused ? 'paused' : 'recording');
    bar.setArmed(!paused);
    bar.setControl('pause', paused ? { icon: 'play', label: 'Resume' } : { icon: 'pause', label: 'Pause' });
    bar.setTitle(recordingTitle(state));
  };
  paintPhase();
  if (state.mode === 'insert') {
    const at = state.insert?.insertAt ?? 0;
    bar.flash(at === 0 ? 'Recording steps to insert at the start' : `Recording steps to insert after step ${at}`, 3500);
  }

  const commit = res => {
    if (!res) return;
    if (res.flash) bar.flash(res.flash);
    if (res.step) { state = recordStep(state, res.step, now()); persist(); bar.setTitle(recordingTitle(state)); }
  };
  const paused = () => state.phase === 'paused';

  const onClick = e => {
    if (paused()) return;
    const c = classifyClick(e.target);
    if (c.kind === 'flash') bar.flash(c.message);
    else if (c.kind === 'click') commit({ step: clickStep(c.el) });
  };
  const onChange = e => {
    const t = e.target;
    if (paused() || isOwnUi(t) || !t?.matches?.('input, textarea, select')) return;
    commit(stepFromChange(t));
  };
  const onSubmit = e => {
    if (paused() || isOwnUi(e.target)) return;
    commit(submitStepFor(e.target, e.submitter ?? null, { lastStep: state.steps.at(-1), lastStepAt: state.lastStepAt, now: now() }));
  };
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('change', onChange, true);
  doc.addEventListener('submit', onSubmit, true);

  // Navigate markers are recorded even while paused: the segment structure has
  // to stay truthful or playback would look for page-2 elements on page 1.
  const watcher = env.watcherFactory({
    doc, win,
    onNavigate: url => { const next = recordNavigation(state, pathOf(url)); if (next !== state) { state = next; persist(); bar.setTitle(recordingTitle(state)); } },
    onSettle: () => {},
  });
  watcher.start();

  function detach() {
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('change', onChange, true);
    doc.removeEventListener('submit', onSubmit, true);
    watcher.stop();
    bar.remove();
    active = null;
  }
  function togglePause() {
    state = { ...state, phase: paused() ? 'recording' : 'paused' };
    persist();
    paintPhase();
  }
  function finish() {
    detach();
    if (state.mode === 'new' && !state.steps.length) {
      clearRecording(storage);
      env.dispatch('cancelActionRecording', { state });
      return;
    }
    state = { ...state, phase: 'naming' };
    persist();
    env.dispatch('finishActionRecording', { state });
  }
  function cancel() {
    if (state.steps.length && !env.confirm('Discard this recording?')) return;
    detach();
    clearRecording(storage);
    env.dispatch('cancelActionRecording', { state });
  }

  active = { get state() { return state; }, detach, finish, cancel };
  return active;
}

/** Start a fresh recording ('new') or one that will be spliced into an action ('insert'). */
export function startRecording({ mode = 'new', insert = null } = {}, envIn = {}) {
  if (active) return active;
  const env = defaultEnv(envIn);
  const state = newRecordingState({ mode, insert, path: curPath(env.win), now: env.now() });
  writeRecording(env.storage, state);
  return attach(state, env);
}

/** Continue a recording after a hard navigation. Returns false when there is nothing to resume. */
export function resumeRecording(envIn = {}) {
  if (active) return true;
  const env = defaultEnv(envIn);
  let state = readRecording(env.storage);
  if (!state || state.phase === 'naming') return false;
  state = recordNavigation(state, curPath(env.win));
  writeRecording(env.storage, state);
  attach(state, env);
  return true;
}

export const isRecording = () => !!active;
