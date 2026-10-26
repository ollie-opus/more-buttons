/**
 * actionsManage.js — the "Manage saved actions" form and the dock's Play
 * button. The library (actionsLibrary.js) is the truth; this module renders it
 * as cards (actionCards.js), owns the Active toggle / Edit / Delete, and
 * opens the Play confirm.
 */

import { createForm } from './form.js';
import { registerFormAction, getFormAction } from './formActions.js';
import { showDangerConfirm } from './confirmPanel.js';
import { loadLibrary, removeAction, setActiveAction, getActiveAction, upsertAction, newAction } from './actionsLibrary.js';
import { actionsListHtml, stepCountText } from './actionCards.js';
import { watchIconSpans } from './lucideIcons.js';
import { startRecording, resumeRecording, readRecording, clearRecording } from './actionRecorder.js';

async function renderList(formEl) {
  const host = formEl.querySelector('[data-actions-list]');
  if (!host) return;
  host.innerHTML = actionsListHtml(await loadLibrary());
  watchIconSpans(host);
}

function wireList(formEl) {
  // Cards live inside the form (the dock does not), so delegate on formEl.
  formEl.addEventListener('click', async (e) => {
    const toggle = e.target.closest('[data-action-active]');
    if (toggle) {
      const pressed = toggle.getAttribute('aria-pressed') === 'true';
      await setActiveAction(pressed ? null : toggle.dataset.actionActive);
      await renderList(formEl);
      return;
    }
    const edit = e.target.closest('[data-action-edit]');
    if (edit) {
      const open = getFormAction('openEditAction');
      if (open) await open({ id: edit.dataset.actionEdit });
      else console.warn('[MB actions] editor not available');
      return;
    }
    const del = e.target.closest('[data-action-delete]');
    if (del) {
      const id = del.dataset.actionDelete;
      const lib = await loadLibrary();
      const action = lib.actions.find(a => a.id === id);
      if (!action) return;
      const ok = await showDangerConfirm(formEl.parentElement ?? formEl, {
        title: `Delete “${action.name}”?`,
        message: `This removes the action and its ${stepCountText(action.steps.length)}. It cannot be undone.`,
      });
      if (!ok) return;
      await removeAction(id);
      await renderList(formEl);
    }
  });
}

export async function openManageActions() {
  const { formEl } = await createForm('manageActions', openManageActions, { rootEntry: true });
  if (!formEl) return;
  await renderList(formEl);
  wireList(formEl);
}

// ── Play ──────────────────────────────────────────────────────────────────────

// content.js appends the dock click's modifier state as a trailing object only
// when a modifier was held; Ctrl/Cmd skips the confirm.
const skipConfirm = a => !!a && typeof a === 'object' && (a.ctrlKey === true || a.metaKey === true);

async function runAction(action) {
  // Wired to the player once actionPlayer.js lands.
  console.warn('[MB actions] player not built yet; would play', action.name);
}

export async function playActiveAction(...args) {
  const action = await getActiveAction();
  if (action && skipConfirm(args.at(-1))) return runAction(action);

  const { content } = await createForm('confirmPlayAction');
  if (!content) return;
  const ready = content.querySelector('[data-play-ready]');
  const none = content.querySelector('[data-play-none]');
  const playBtn = content.querySelector('[data-play-btn]');
  const manageBtn = content.querySelector('[data-manage-btn]');
  if (action) {
    ready?.removeAttribute('hidden');
    content.querySelector('[data-action-name]').textContent = action.name;
    content.querySelector('[data-step-count]').textContent = stepCountText(action.steps.length);
    manageBtn?.remove();
  } else {
    none?.removeAttribute('hidden');
    playBtn?.remove();
  }
}

// ── Recording hand-offs ───────────────────────────────────────────────────────
// The recorder dispatches these by name (it may be running in a page load that
// never saw the form that started it), reading everything from the session.

const session = () => window.sessionStorage;

async function openNamePrompt(state) {
  const { formEl } = await createForm('actionName');
  if (!formEl) return;
  formEl.querySelector('[data-step-count]').textContent = stepCountText(state.steps.length);
  formEl.querySelector('input[name="actionName"]')?.focus();
}

// Dock "Record new" (and the empty-state button): close the form, start recording.
registerFormAction('startActionRecording', async ({ cleanup } = {}) => {
  cleanup?.();
  startRecording({ mode: 'new' });
});

registerFormAction('finishActionRecording', async ({ state }) => {
  if (state.mode === 'insert') {
    const splice = getFormAction('finishInsertRecording');
    if (splice) return splice({ state });
    console.warn('[MB actions] editor not available; recording kept in session');
    return;
  }
  await openNamePrompt(state);
});

registerFormAction('cancelActionRecording', async ({ state }) => {
  if (state?.mode === 'insert') {
    const open = getFormAction('openEditAction');
    if (open) return open({ id: state.insert.actionId, draft: { name: state.insert.name, steps: state.insert.draftSteps } });
  }
  await openManageActions();
});

registerFormAction('submitActionName', async ({ formEl }) => {
  const name = formEl?.querySelector('input[name="actionName"]')?.value.trim();
  const state = readRecording(session());
  if (!name || !state) { clearRecording(session()); return openManageActions(); }
  await upsertAction(newAction({ name, steps: state.steps }));
  clearRecording(session());
  await openManageActions();
});

registerFormAction('discardRecording', async () => {
  clearRecording(session());
  await openManageActions();
});

/**
 * Called by content.js on a page load that found an Actions session key in
 * sessionStorage: a recording (or, later, a playback) survived a hard
 * navigation and must carry on in this document.
 */
export async function resumeActionSession() {
  const rec = readRecording(session());
  if (rec) {
    if (rec.phase === 'naming') return openNamePrompt(rec);
    resumeRecording();
  }
}

registerFormAction('openManageActions', openManageActions);
registerFormAction('runActiveAction', async () => {
  const action = await getActiveAction();
  if (action) await runAction(action);
});
