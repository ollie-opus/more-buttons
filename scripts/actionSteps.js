/**
 * actionSteps.js — the pure step model behind the Actions recorder.
 *
 * An Action is a named list of steps (sub-actions). This module owns the step
 * shape, the recording-time coalescing rules, segmenting around `navigate`
 * markers, and the editor's list operations. Every function is pure and
 * returns new arrays; nothing here touches the DOM or chrome.*, so it runs
 * under Node for tests/actionSteps.test.mjs.
 *
 * Step = { id, kind, locator: { key, candidates } | null, describe, value, askAtPlay }
 *   kind      click | set | check | choose | navigate
 *   locator   see actionLocators.js; null for navigate
 *   describe  { label, tag, type, group?, optionText? } — display only
 *   value     set: string (null when askAtPlay) · check: boolean · choose: radio
 *             value · navigate: pathname (display only) · click: null
 *   askAtPlay true = never stored; the player prompts for the value
 */

export const STEP_KINDS = ['click', 'set', 'check', 'choose', 'navigate'];

// Icon names are lucide (linted by tests/lucideIcons.test.mjs via the
// `icon: '…'` literal scan); colours are `--mb-col-*` palette keys.
export const KIND_META = {
  click:    { icon: 'mouse-pointer-click', colour: 'blue',   label: 'Click' },
  set:      { icon: 'text-cursor-input',   colour: 'teal',   label: 'Set value' },
  check:    { icon: 'square-check',        colour: 'green',  label: 'Checkbox' },
  choose:   { icon: 'circle-dot',          colour: 'purple', label: 'Choose' },
  navigate: { icon: 'navigation',          colour: 'grey',   label: 'Page change' },
};

const defaultId = () => (globalThis.crypto?.randomUUID?.() ?? `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

export function makeStep(kind, { locator = null, describe = {}, value = null, askAtPlay = false } = {}, newId = defaultId) {
  if (!STEP_KINDS.includes(kind)) throw new Error(`actionSteps: unknown kind "${kind}"`);
  return { id: newId(), kind, locator, describe: { label: '', tag: null, type: null, ...describe }, value, askAtPlay: !!askAtPlay };
}

/** Two steps aim at the same element when their locator keys agree. */
export function sameTarget(a, b) {
  const ka = a?.locator?.key;
  return !!ka && ka === b?.locator?.key;
}

// Index of the step a new one should replace, or -1. Only looks inside the
// current segment (back to the last navigate), so a field edited on two pages
// stays two steps.
function coalesceIndex(steps, step) {
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s.kind === 'navigate') return -1;
    if (s.kind !== step.kind) continue;
    if (step.kind === 'choose') {
      if (s.describe?.group && s.describe.group === step.describe?.group) return i;
    } else if ((step.kind === 'set' || step.kind === 'check') && sameTarget(s, step)) {
      return i;
    }
  }
  return -1;
}

/** Append a recorded step, coalescing repeat edits of the same target. */
export function appendStep(steps, step) {
  if (step.kind === 'navigate') return appendNavigate(steps, step.value);
  const i = step.kind === 'click' ? -1 : coalesceIndex(steps, step);
  if (i === -1) return [...steps, step];
  const prev = steps[i];
  const merged = step.kind === 'choose'
    ? { ...step, id: prev.id }
    : { ...prev, value: step.value, askAtPlay: step.askAtPlay };
  return steps.map((s, j) => (j === i ? merged : s));
}

/**
 * Append a page-change marker. Nothing recorded yet → nothing to mark (a
 * leading navigate could never be replayed). Consecutive navigates (redirects)
 * collapse into one carrying the latest path.
 */
export function appendNavigate(steps, path, newId = defaultId) {
  if (!steps.length) return steps;
  const last = steps[steps.length - 1];
  if (last.kind === 'navigate') return steps.map((s, j) => (j === steps.length - 1 ? { ...s, value: path } : s));
  return [...steps, makeStep('navigate', { value: path }, newId)];
}

/** Bounds of the page segment starting at `from`: [from, end) ends at the first navigate. */
export function segmentBounds(steps, from = 0) {
  for (let i = from; i < steps.length; i++) {
    if (steps[i].kind === 'navigate') return { end: i, navigateAt: i };
  }
  return { end: steps.length, navigateAt: -1 };
}

export function askAtPlaySteps(steps) {
  return steps.filter(s => s.askAtPlay);
}

export function spliceSteps(steps, at, newSteps) {
  const i = Math.max(0, Math.min(steps.length, at));
  return [...steps.slice(0, i), ...newSteps, ...steps.slice(i)];
}

export function moveStep(steps, i, dir) {
  const j = i + dir;
  if (i < 0 || i >= steps.length || j < 0 || j >= steps.length) return steps;
  const out = steps.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export function removeStep(steps, i) {
  if (i < 0 || i >= steps.length) return steps;
  return steps.filter((_, j) => j !== i);
}

/**
 * Flag a `set` step as ask-at-play. Turning it on drops the stored value
 * (that is the point of the flag); turning it off leaves it null until the
 * step is re-recorded. Other kinds are returned unchanged.
 */
export function setAskAtPlay(steps, i, on) {
  const s = steps[i];
  if (!s || s.kind !== 'set') return steps;
  const next = on ? { ...s, askAtPlay: true, value: null } : { ...s, askAtPlay: false };
  return steps.map((x, j) => (j === i ? next : x));
}

const MASK = '••••';

/** Display summary for a timeline card: { icon, kindLabel, title, valueText, masked }. */
export function summariseStep(step) {
  const meta = KIND_META[step.kind];
  const label = step.describe?.label || step.locator?.key || step.describe?.tag || '';
  const q = `“${label}”`;
  let title, valueText = null, masked = false;
  switch (step.kind) {
    case 'click':  title = `Click ${q}`; break;
    case 'set':
      title = `Set ${q}`;
      masked = !!step.askAtPlay;
      valueText = masked ? MASK : String(step.value ?? '');
      break;
    case 'check':  title = `${step.value ? 'Tick' : 'Untick'} ${q}`; valueText = step.value ? 'Checked' : 'Unchecked'; break;
    case 'choose': title = `Choose ${q}`; valueText = step.describe?.optionText ?? String(step.value ?? ''); break;
    case 'navigate': title = 'Page change'; valueText = step.value ?? ''; break;
    default: title = q;
  }
  return { icon: meta.icon, kindLabel: meta.label, title, valueText, masked };
}
