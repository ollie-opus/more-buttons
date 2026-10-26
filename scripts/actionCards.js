/**
 * actionCards.js — pure HTML builders for the Actions forms: the library cards
 * in Manage saved actions and the relative "updated … ago" meta. Same card
 * chrome as the KB component list (.mb-incident-card); no DOM access, so the
 * markup is pinned by tests/actionCards.test.mjs.
 */

import { escapeHtml, insertTriggerHtml, railRowHtml } from './cardRenderer.js';
import { KIND_META, summariseStep } from './actionSteps.js';

const MIN = 60_000, HR = 60 * MIN, DAY = 24 * HR;

/** "just now" · "3 min ago" · "2 hr ago" · "yesterday" · "5 days ago"; '' for a missing timestamp. */
export function relativeTime(ts, now = Date.now()) {
  if (ts == null || Number.isNaN(Number(ts))) return '';
  const diff = Math.max(0, now - Number(ts));
  if (diff < MIN) return 'just now';
  if (diff < HR) return `${Math.floor(diff / MIN)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HR)} hr ago`;
  if (diff < 2 * DAY) return 'yesterday';
  return `${Math.floor(diff / DAY)} days ago`;
}

export const stepCountText = n => `${n} step${n === 1 ? '' : 's'}`;

/** One library card. Green + pressed "Active" toggle for the active action, grey otherwise. */
export function actionCardHtml(action, { active = false, now = Date.now() } = {}) {
  const id = escapeHtml(action.id);
  const updated = relativeTime(action.updatedAt, now);
  const meta = `${stepCountText(action.steps?.length ?? 0)}${updated ? ` · updated ${updated}` : ''}`;
  return `
  <div class="mb-incident-card --${active ? 'green' : 'grey'} mb-action-card" data-action-id="${id}">
    <div class="mb-incident-card__head">
      <strong class="mb-incident-card__title">${escapeHtml(action.name)}</strong>
      <span class="mb-incident-card__badge">${active ? 'Active' : 'Inactive'}</span>
    </div>
    <div class="mb-incident-card__foot">
      <span class="mb-incident-card__meta">${escapeHtml(meta)}</span>
      <span class="mb-incident-card__foot-actions">
        <button type="button" class="mb-incident-card__edit" data-action-active="${id}" aria-pressed="${active ? 'true' : 'false'}">${active ? 'Active' : 'Set active'}</button>
        <button type="button" class="mb-incident-card__edit" data-action-edit="${id}">Edit</button>
        <button type="button" class="mb-incident-card__edit" data-action-delete="${id}">Delete</button>
      </span>
    </div>
  </div>`;
}

/** The whole list, or the empty state that doubles as a Record button. */
export function actionsListHtml(lib, { now = Date.now() } = {}) {
  if (!lib.actions.length) {
    return `<button type="button" class="mb-adm-empty mb-action-empty" data-action="startActionRecording"><span class="mb-adm-empty__icon more-buttons-icon">disc</span><span>No actions yet — record your first</span></button>`;
  }
  return lib.actions.map(a => actionCardHtml(a, { active: a.id === lib.activeId, now })).join('');
}

// ── Edit form: vertical timeline ───────────────────────────────────────────────

export const STEP_INSERT_ATTR = 'data-insert-steps-at';
const INSERT_LABEL = '+ Record steps here';

/** One step card: kind icon + title, kind badge, value chip (masked when ask-at-play), Step N meta, controls. */
export function stepCardHtml(step, i) {
  const s = summariseStep(step);
  const meta = KIND_META[step.kind];
  const tagInfo = step.describe?.tag ? `${step.describe.tag}${step.describe.type ? `[${step.describe.type}]` : ''}` : '';
  const showValue = s.valueText != null && s.valueText !== '' && step.kind !== 'click';
  const value = showValue ? `<p class="mb-incident-card__body"><code class="mb-action-step__value${s.masked ? ' --masked' : ''}">${escapeHtml(s.valueText)}</code></p>` : '';
  const ask = step.kind === 'set'
    ? `<button type="button" class="mb-incident-card__edit" data-step-ask="${i}" aria-pressed="${step.askAtPlay ? 'true' : 'false'}" title="Never store this value; ask for it when playing">Ask at play</button>`
    : '';
  return `
  <div class="mb-incident-card --${meta.colour} mb-action-step">
    <div class="mb-incident-card__head">
      <strong class="mb-incident-card__title"><span class="more-buttons-icon">${s.icon}</span>${escapeHtml(s.title)}</strong>
      <span class="mb-incident-card__badge">${escapeHtml(s.kindLabel)}</span>
    </div>
    ${value}
    <div class="mb-incident-card__foot">
      <span class="mb-incident-card__meta">${escapeHtml(`Step ${i + 1}${tagInfo ? ` · ${tagInfo}` : ''}`)}</span>
      <span class="mb-incident-card__foot-actions">
        ${ask}
        <button type="button" class="mb-incident-card__edit" data-step-delete="${i}">Delete</button>
      </span>
    </div>
  </div>`;
}

/** The whole timeline: an insert bar before every step and after the last; each row wrapped in the shared reorder rail. */
export function timelineHtml(steps) {
  if (!steps.length) {
    return `<p class="mb-action-timeline__empty">No steps yet.</p>${insertTriggerHtml(0, { attr: STEP_INSERT_ATTR, label: INSERT_LABEL })}`;
  }
  const parts = [];
  const last = steps.length - 1;
  steps.forEach((step, i) => {
    parts.push(insertTriggerHtml(i, { attr: STEP_INSERT_ATTR, label: INSERT_LABEL }));
    parts.push(railRowHtml({
      rowAttrs: `data-step-index="${i}" style="--mb-step-accent: var(--mb-col-${KIND_META[step.kind].colour})"`,
      isFirst: i === 0, isLast: i === last, moveAttr: 'data-move-step', cardHtml: stepCardHtml(step, i),
    }));
  });
  parts.push(insertTriggerHtml(steps.length, { attr: STEP_INSERT_ATTR, label: INSERT_LABEL }));
  return parts.join('');
}
