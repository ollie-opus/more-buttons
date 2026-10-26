/**
 * actionCards.js — pure HTML builders for the Actions forms: the library cards
 * in Manage saved actions and the relative "updated … ago" meta. Same card
 * chrome as the KB component list (.mb-incident-card); no DOM access, so the
 * markup is pinned by tests/actionCards.test.mjs.
 */

import { escapeHtml } from './cardRenderer.js';

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
