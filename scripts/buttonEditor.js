/**
 * buttonEditor.js — the "Button" component overlay (a Zensical .md-button link).
 *
 * The simplest form-authored component: a single markdown line, no children. The
 * form has four fields — Label, Type (Primary/Secondary), Destination, and an
 * optional Icon (the lucide picker reused from page settings). Because a button
 * holds no sub-components, it needs neither a component container registration nor
 * a save-gate `_componentSaver` (it is never a parent in a child navigation).
 *
 * Create splices one line into the parent container then flips to edit in place,
 * so an inserted button lands in its editor like every other component kind
 * (captures are the only deliberate exception). Edit rewrites that one line
 * through the merge engine; delete removes the line + its identity span.
 *
 * Markdown round-trip lives in mdButtons.js (pure). This module is the DOM/network
 * lifecycle only.
 */

import { registerFormAction } from './formActions.js';
import {
  createForm, replaceCurrentOpener, setCrumbLabel, isFormReplay, navigateBack,
  resetDirtyBaseline, setButtonBusy, snapshotButton, restoreButton,
} from './form.js';
import { githubFetchAndPushFile, fetchFileMigratingIdentity } from './github.js';
import { generateUUID } from './admonitions.js';
import { mergeSave } from './mergeSave.js';
import { spliceIntoContainer } from './guides.js';
import { attachIconPicker } from './iconPicker.js';
import {
  buildButtonLines, locateButtonByUUID, replaceButtonByUUID, deleteButtonByUUID, buttonDimFields,
} from './mdButtons.js';

const STORAGE_KEY = 'moreButtonsEditButton';

// ── Form ↔ data ────────────────────────────────────────────────────────────

function emptyFields() {
  return { buttonLabel: '', buttonType: 'primary', buttonDestination: '', icon: '', buttonNewTab: 'no' };
}

function readButtonFields(formEl) {
  return {
    label: formEl.querySelector('[name="buttonLabel"]')?.value.trim() ?? '',
    type: formEl.querySelector('[name="buttonType"]:checked')?.value ?? '',
    destination: formEl.querySelector('[name="buttonDestination"]')?.value.trim() ?? '',
    icon: formEl.querySelector('[name="icon"]')?.value.trim() ?? '',
    newTab: formEl.querySelector('[name="buttonNewTab"]:checked')?.value === 'yes',
  };
}

// The single link line (no identity span — replaceButtonByUUID keeps the span).
function buttonLineFrom({ label, destination, icon, primary, newTab }) {
  return buildButtonLines([{ label, destination, icon, primary, newTab }])[1];
}

function seedStorage(fields) {
  return chrome.storage.local.set({ [STORAGE_KEY]: fields });
}

// ── Openers ──────────────────────────────────────────────────────────────────

registerFormAction('openCreateButton', async ({ container, insertAtIndex } = {}) => {
  if (!container?.file) return;
  if (!isFormReplay()) await seedStorage(emptyFields());

  const { formEl } = await createForm('editButton');
  if (!formEl) return;
  formEl.dataset.mode = 'create';
  formEl.dataset.parentKind = container.kind;
  formEl.dataset.parentUuid = container.uuid;
  formEl.dataset.parentFile = container.file;
  formEl.dataset.insertAtIndex = insertAtIndex == null ? '' : String(insertAtIndex);
  formEl.dataset.editUuid = '';

  const heading = formEl.querySelector('[data-button-heading]');
  if (heading) heading.textContent = 'Add button';
  // Delete (lives in the moved form-actions) only applies once the button exists.
  formEl.parentElement?.querySelector('[data-delete-button-btn]')?.style.setProperty('display', 'none');

  attachIconPicker(formEl.querySelector('[name="icon"]'));
  resetDirtyBaseline(formEl);
});

registerFormAction('openEditButton', async ({ uuid, file } = {}) => {
  if (!uuid || !file) return;
  let md;
  try {
    md = await fetchFileMigratingIdentity(file);
  } catch (e) {
    alert('Failed to load file: ' + e.message);
    return;
  }
  const btn = locateButtonByUUID(md, uuid);
  if (!btn) { alert('Button not found.'); return; }

  if (!isFormReplay()) await seedStorage(buttonDimFields(btn));

  const { formEl } = await createForm('editButton');
  if (!formEl) return;
  formEl.dataset.mode = 'edit';
  formEl.dataset.editUuid = uuid;
  formEl.dataset.containerFile = file;

  const heading = formEl.querySelector('[data-button-heading]');
  if (heading) heading.textContent = 'Edit button';
  setCrumbLabel(btn.label || 'Button');

  attachIconPicker(formEl.querySelector('[name="icon"]'));
  resetDirtyBaseline(formEl);
});

// ── Persistence ──────────────────────────────────────────────────────────────

async function persistNewButton(formEl, onProgress = () => {}) {
  const { label, type, destination, icon, newTab } = readButtonFields(formEl);
  if (!type) { alert('Type is required.'); return null; }
  if (!destination) { alert('Destination is required.'); return null; }
  const newUuid = generateUUID();
  const parent = {
    kind: formEl.dataset.parentKind,
    uuid: formEl.dataset.parentUuid,
    file: formEl.dataset.parentFile,
  };
  const insertAtRaw = formEl.dataset.insertAtIndex;
  const insertAt = insertAtRaw === '' || insertAtRaw == null ? null : parseInt(insertAtRaw, 10);
  const btn = { uuid: newUuid, label, destination, icon, primary: type === 'primary', newTab };
  await spliceIntoContainer(parent, insertAt, [{ kind: 'button', btn }], onProgress);
  return { newUuid, file: parent.file };
}

// Flip the create form into an edit-of-new-button form in place, so an inserted
// button lands in its editor (matching admonitions / grids).
async function transitionButtonCreateToEdit(formEl, newUuid, file) {
  formEl.dataset.mode = 'edit';
  formEl.dataset.editUuid = newUuid;
  formEl.dataset.containerFile = file;
  replaceCurrentOpener('openEditButton', { uuid: newUuid, file });
  const heading = formEl.querySelector('[data-button-heading]');
  if (heading) heading.textContent = 'Edit button';
  formEl.parentElement?.querySelector('[data-delete-button-btn]')?.style.removeProperty('display');
  const f = readButtonFields(formEl);
  setCrumbLabel(f.label || 'Button');
  await seedStorage({
    buttonLabel: f.label, buttonType: f.type || 'primary',
    buttonDestination: f.destination, icon: f.icon,
    buttonNewTab: f.newTab ? 'yes' : 'no',
  });
  resetDirtyBaseline(formEl);
}

async function persistButtonEdit(formEl, onProgress = () => {}) {
  const { type, destination } = readButtonFields(formEl);
  if (!type) { alert('Type is required.'); return null; }
  if (!destination) { alert('Destination is required.'); return null; }
  const editUuid = formEl.dataset.editUuid;
  const file = formEl.dataset.containerFile;

  await mergeSave({
    formEl,
    file,
    onProgress,
    fieldSpecs: [
      { name: 'buttonLabel', type: 'scalar', label: 'Label' },
      { name: 'buttonType', type: 'scalar', label: 'Type' },
      { name: 'buttonDestination', type: 'scalar', label: 'Destination' },
      { name: 'icon', type: 'scalar', label: 'Icon' },
      { name: 'buttonNewTab', type: 'scalar', label: 'Open in new tab' },
    ],
    readFresh: md => buttonDimFields(locateButtonByUUID(md, editUuid) ?? {}),
    build: (md, resolved) => {
      if (!locateButtonByUUID(md, editUuid)) throw new Error('Button no longer exists.');
      const line = buttonLineFrom({
        label: resolved.buttonLabel,
        destination: resolved.buttonDestination,
        icon: resolved.icon,
        primary: resolved.buttonType === 'primary',
        newTab: resolved.buttonNewTab === 'yes',
      });
      return replaceButtonByUUID(md, editUuid, line);
    },
  });
  return { editUuid, file };
}

// ── Form actions ──────────────────────────────────────────────────────────────

registerFormAction('submitEditButton', async ({ formEl, content }) => {
  const saveBtn = content.querySelector('[data-save-state]');
  setButtonBusy(saveBtn, 'Saving…');
  try {
    if (formEl.dataset.mode === 'create') {
      const res = await persistNewButton(formEl, s => setButtonBusy(saveBtn, s));
      if (!res) { formEl._refreshSaveState?.(); return; }
      await transitionButtonCreateToEdit(formEl, res.newUuid, res.file);
    } else {
      const res = await persistButtonEdit(formEl, s => setButtonBusy(saveBtn, s));
      if (!res) { formEl._refreshSaveState?.(); return; }
    }
    formEl._refreshSaveState?.();
  } catch (e) {
    formEl._refreshSaveState?.();
    alert('Failed to save button: ' + e.message);
  }
});

registerFormAction('deleteButton', async ({ formEl, content }) => {
  const editUuid = formEl.dataset.editUuid;
  const file = formEl.dataset.containerFile;
  if (!editUuid || !file) return;
  if (!confirm('Delete this button?')) return;
  const btn = content.querySelector('[data-action="deleteButton"]');
  const snap = snapshotButton(btn);
  setButtonBusy(btn, 'Deleting…');
  try {
    await githubFetchAndPushFile(file, s => setButtonBusy(btn, s), md => deleteButtonByUUID(md, editUuid));
    await chrome.storage.local.remove(STORAGE_KEY);
    await navigateBack();
  } catch (e) {
    restoreButton(btn, snap);
    alert('Failed to delete button: ' + e.message);
  }
});
