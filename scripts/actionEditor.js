/**
 * actionEditor.js — the "Edit action" form: name + a vertical timeline of
 * steps with ask-at-play / delete / reorder, and insert bars that start an
 * insert-mode recording whose steps are spliced back in on Stop.
 *
 * State lives on formEl._action and is mirrored into the hidden
 * `actionState` input so form.js's dirty tracking / Save button see every
 * edit (same trick as gridEditor.js). A draft returned from an insert
 * recording opens against the SAVED action as baseline, so it reads dirty.
 */

import { createForm, resetDirtyBaseline, closeActiveForm } from './form.js';
import { registerFormAction, getFormAction } from './formActions.js';
import { showDangerConfirm } from './confirmPanel.js';
import { loadLibrary, upsertAction, removeAction, newAction } from './actionsLibrary.js';
import { moveStep, removeStep, setAskAtPlay, spliceSteps } from './actionSteps.js';
import { timelineHtml, STEP_INSERT_ATTR, stepCountText } from './actionCards.js';
import { watchIconSpans } from './lucideIcons.js';
import { startRecording, clearRecording } from './actionRecorder.js';

const serialise = steps => JSON.stringify(steps);

function syncState(formEl) {
  const inp = formEl.querySelector('[name="actionState"]');
  if (inp) inp.value = serialise(formEl._action.steps);
  formEl._refreshSaveState?.();
}

function render(formEl) {
  const host = formEl.querySelector('[data-action-steps]');
  if (!host) return;
  host.innerHTML = timelineHtml(formEl._action.steps);
  watchIconSpans(host);
}

function update(formEl, steps) {
  formEl._action.steps = steps;
  render(formEl);
  syncState(formEl);
}

function startInsert(formEl, insertAt) {
  const st = formEl._action;
  const name = formEl.querySelector('[name="actionName"]')?.value.trim() || st.name;
  closeActiveForm();
  startRecording({ mode: 'insert', insert: { actionId: st.id, name, draftSteps: st.steps, insertAt } });
}

function wire(formEl) {
  formEl.addEventListener('input', e => { if (e.target.name === 'actionName') formEl._refreshSaveState?.(); });
  formEl.addEventListener('click', e => {
    const move = e.target.closest('[data-move-step]');
    if (move) {
      if (move.disabled) return;
      const i = parseInt(move.closest('[data-step-index]')?.dataset.stepIndex ?? '-1', 10);
      update(formEl, moveStep(formEl._action.steps, i, move.dataset.moveStep === 'up' ? -1 : 1));
      return;
    }
    const del = e.target.closest('[data-step-delete]');
    if (del) { update(formEl, removeStep(formEl._action.steps, parseInt(del.dataset.stepDelete, 10))); return; }
    const ask = e.target.closest('[data-step-ask]');
    if (ask) {
      const on = ask.getAttribute('aria-pressed') !== 'true';
      update(formEl, setAskAtPlay(formEl._action.steps, parseInt(ask.dataset.stepAsk, 10), on));
      return;
    }
    const insert = e.target.closest(`[${STEP_INSERT_ATTR}]`);
    if (insert) startInsert(formEl, parseInt(insert.getAttribute(STEP_INSERT_ATTR), 10));
  });
}

/**
 * @param {{ id: string, draft?: { name, steps } }} args — `draft` is an unsaved
 *   working copy (insert-mode return); without it the saved action is edited.
 */
export async function openEditAction({ id, draft = null } = {}) {
  const lib = await loadLibrary();
  const saved = lib.actions.find(a => a.id === id) ?? null;
  if (!saved && !draft) return getFormAction('openManageActions')?.();

  const name = draft?.name ?? saved.name;
  const steps = draft?.steps ?? saved.steps;
  const baseline = { actionName: saved?.name ?? '', actionState: serialise(saved?.steps ?? []) };
  const opener = () => getFormAction('openEditAction')({ id });
  const { formEl } = await createForm('editAction', opener, { baseline });
  if (!formEl) return;

  formEl._action = { id, name, steps, createdAt: saved?.createdAt };
  formEl.querySelector('[data-action-heading]').textContent = saved ? `Edit “${saved.name}”` : 'New action';
  const nameInput = formEl.querySelector('[name="actionName"]');
  if (nameInput) nameInput.value = name;
  render(formEl);
  syncState(formEl);
  wire(formEl);
}

registerFormAction('openEditAction', openEditAction);

registerFormAction('saveEditAction', async ({ formEl }) => {
  const st = formEl?._action;
  if (!st) return;
  const name = formEl.querySelector('[name="actionName"]')?.value.trim();
  if (!name) return;
  const lib = await loadLibrary();
  const existing = lib.actions.find(a => a.id === st.id);
  const action = existing ? { ...existing, name, steps: st.steps } : { ...newAction({ name, steps: st.steps }), id: st.id };
  await upsertAction(action);
  st.name = name;
  formEl.querySelector('[data-action-heading]').textContent = `Edit “${name}”`;
  resetDirtyBaseline(formEl);
  formEl._refreshSaveState?.();
});

registerFormAction('deleteActionFromEditor', async ({ formEl }) => {
  const st = formEl?._action;
  if (!st) return;
  const ok = await showDangerConfirm(formEl.parentElement ?? formEl, {
    title: `Delete “${st.name}”?`,
    message: `This removes the action and its ${stepCountText(st.steps.length)}. It cannot be undone.`,
  });
  if (!ok) return;
  await removeAction(st.id);
  await getFormAction('openManageActions')?.();
});

// Insert-mode recording stopped: splice the new steps into the draft at the
// insert point and reopen the editor (unsaved until Save).
registerFormAction('finishInsertRecording', async ({ state }) => {
  const ins = state?.insert;
  clearRecording(window.sessionStorage);
  if (!ins) return getFormAction('openManageActions')?.();
  const steps = spliceSteps(ins.draftSteps ?? [], ins.insertAt ?? 0, state.steps ?? []);
  await openEditAction({ id: ins.actionId, draft: { name: ins.name, steps } });
});
