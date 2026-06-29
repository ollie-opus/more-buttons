/**
 * diagramEditor.js — the "Diagram" component overlay (a Zensical ```mermaid block).
 *
 * The simplest single-field component: one plain textarea holding Mermaid source,
 * no children. Because a diagram holds no sub-components it needs neither a
 * component container registration nor a save-gate `_componentSaver` (it is never
 * a parent in a child navigation).
 *
 * Create splices one fenced block into the parent container then flips to edit in
 * place, so an inserted diagram lands in its editor like every other component
 * kind. Edit rewrites that block through the merge engine; delete removes the
 * block + its identity span.
 *
 * Markdown round-trip lives in mdDiagrams.js (pure). This module is the
 * DOM/network lifecycle only — a trimmed-down mirror of buttonEditor.js.
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
import {
  locateDiagramByUUID, replaceDiagramByUUID, deleteDiagramByUUID, diagramDimFields,
} from './mdDiagrams.js';

const STORAGE_KEY = 'moreButtonsEditDiagram';

// ── Form ↔ data ────────────────────────────────────────────────────────────

function emptyFields() {
  return { diagramCode: '' };
}

function readDiagramFields(formEl) {
  return {
    code: formEl.querySelector('[name="diagramCode"]')?.value ?? '',
  };
}

// A short, single-line crumb label for an otherwise unnamed diagram.
function crumbFor(code) {
  const first = (code ?? '').split('\n').map(l => l.trim()).find(Boolean);
  return first ? first.slice(0, 40) : 'Diagram';
}

function seedStorage(fields) {
  return chrome.storage.local.set({ [STORAGE_KEY]: fields });
}

// ── Openers ──────────────────────────────────────────────────────────────────

registerFormAction('openCreateDiagram', async ({ container, insertAtIndex } = {}) => {
  if (!container?.file) return;
  if (!isFormReplay()) await seedStorage(emptyFields());

  const { formEl } = await createForm('editDiagram');
  if (!formEl) return;
  formEl.dataset.mode = 'create';
  formEl.dataset.parentKind = container.kind;
  formEl.dataset.parentUuid = container.uuid;
  formEl.dataset.parentFile = container.file;
  formEl.dataset.insertAtIndex = insertAtIndex == null ? '' : String(insertAtIndex);
  formEl.dataset.editUuid = '';

  const heading = formEl.querySelector('[data-diagram-heading]');
  if (heading) heading.textContent = 'Add diagram';
  // Delete (lives in the moved form-actions) only applies once the diagram exists.
  formEl.parentElement?.querySelector('[data-delete-diagram-btn]')?.style.setProperty('display', 'none');

  resetDirtyBaseline(formEl);
});

registerFormAction('openEditDiagram', async ({ uuid, file } = {}) => {
  if (!uuid || !file) return;
  let md;
  try {
    md = await fetchFileMigratingIdentity(file);
  } catch (e) {
    alert('Failed to load file: ' + e.message);
    return;
  }
  const dia = locateDiagramByUUID(md, uuid);
  if (!dia) { alert('Diagram not found.'); return; }

  if (!isFormReplay()) await seedStorage(diagramDimFields(dia));

  const { formEl } = await createForm('editDiagram');
  if (!formEl) return;
  formEl.dataset.mode = 'edit';
  formEl.dataset.editUuid = uuid;
  formEl.dataset.containerFile = file;

  const heading = formEl.querySelector('[data-diagram-heading]');
  if (heading) heading.textContent = 'Edit diagram';
  setCrumbLabel(crumbFor(dia.code));

  resetDirtyBaseline(formEl);
});

// ── Persistence ──────────────────────────────────────────────────────────────

async function persistNewDiagram(formEl, onProgress = () => {}) {
  const { code } = readDiagramFields(formEl);
  if (!code.trim()) { alert('Mermaid code is required.'); return null; }
  const newUuid = generateUUID();
  const parent = {
    kind: formEl.dataset.parentKind,
    uuid: formEl.dataset.parentUuid,
    file: formEl.dataset.parentFile,
  };
  const insertAtRaw = formEl.dataset.insertAtIndex;
  const insertAt = insertAtRaw === '' || insertAtRaw == null ? null : parseInt(insertAtRaw, 10);
  const dia = { uuid: newUuid, code };
  await spliceIntoContainer(parent, insertAt, [{ kind: 'diagram', dia }], onProgress);
  return { newUuid, file: parent.file };
}

// Flip the create form into an edit-of-new-diagram form in place, so an inserted
// diagram lands in its editor (matching buttons / admonitions / grids).
async function transitionDiagramCreateToEdit(formEl, newUuid, file) {
  formEl.dataset.mode = 'edit';
  formEl.dataset.editUuid = newUuid;
  formEl.dataset.containerFile = file;
  replaceCurrentOpener('openEditDiagram', { uuid: newUuid, file });
  const heading = formEl.querySelector('[data-diagram-heading]');
  if (heading) heading.textContent = 'Edit diagram';
  formEl.parentElement?.querySelector('[data-delete-diagram-btn]')?.style.removeProperty('display');
  const { code } = readDiagramFields(formEl);
  setCrumbLabel(crumbFor(code));
  await seedStorage({ diagramCode: code });
  resetDirtyBaseline(formEl);
}

async function persistDiagramEdit(formEl, onProgress = () => {}) {
  const { code } = readDiagramFields(formEl);
  if (!code.trim()) { alert('Mermaid code is required.'); return null; }
  const editUuid = formEl.dataset.editUuid;
  const file = formEl.dataset.containerFile;

  await mergeSave({
    formEl,
    file,
    onProgress,
    fieldSpecs: [
      { name: 'diagramCode', type: 'scalar', label: 'Mermaid code' },
    ],
    readFresh: md => diagramDimFields(locateDiagramByUUID(md, editUuid) ?? {}),
    build: (md, resolved) => {
      if (!locateDiagramByUUID(md, editUuid)) throw new Error('Diagram no longer exists.');
      return replaceDiagramByUUID(md, editUuid, resolved.diagramCode);
    },
  });
  return { editUuid, file };
}

// ── Form actions ──────────────────────────────────────────────────────────────

registerFormAction('submitEditDiagram', async ({ formEl, content }) => {
  const saveBtn = content.querySelector('[data-save-state]');
  setButtonBusy(saveBtn, 'Saving…');
  try {
    if (formEl.dataset.mode === 'create') {
      const res = await persistNewDiagram(formEl, s => setButtonBusy(saveBtn, s));
      if (!res) { formEl._refreshSaveState?.(); return; }
      await transitionDiagramCreateToEdit(formEl, res.newUuid, res.file);
    } else {
      const res = await persistDiagramEdit(formEl, s => setButtonBusy(saveBtn, s));
      if (!res) { formEl._refreshSaveState?.(); return; }
    }
    formEl._refreshSaveState?.();
  } catch (e) {
    formEl._refreshSaveState?.();
    alert('Failed to save diagram: ' + e.message);
  }
});

registerFormAction('deleteDiagram', async ({ formEl, content }) => {
  const editUuid = formEl.dataset.editUuid;
  const file = formEl.dataset.containerFile;
  if (!editUuid || !file) return;
  if (!confirm('Delete this diagram?')) return;
  const btn = content.querySelector('[data-action="deleteDiagram"]');
  const snap = snapshotButton(btn);
  setButtonBusy(btn, 'Deleting…');
  try {
    await githubFetchAndPushFile(file, s => setButtonBusy(btn, s), md => deleteDiagramByUUID(md, editUuid));
    await chrome.storage.local.remove(STORAGE_KEY);
    await navigateBack();
  } catch (e) {
    restoreButton(btn, snap);
    alert('Failed to delete diagram: ' + e.message);
  }
});
