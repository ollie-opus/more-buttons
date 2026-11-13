/**
 * textEditor.js — the "Text" component overlay: a text block that stands among
 * a container's components (components.js parseBlocks).
 *
 * A container's LEADING text is its form's Description field. Text anywhere
 * else in the container shows in the component list as a Text card, and this
 * is that card's editor: one rich text field, no children, so it needs neither
 * a component container registration nor a save-gate `_componentSaver`.
 *
 * A text block is addressed through its container (the registry's read /
 * write pair), not by scanning the file, so it works alike in a section, an
 * admonition, a tab, a grid cell and a system update. Should the block have
 * become the container's leading text since the card was drawn (the component
 * above it was moved or deleted), it is still found and edited here.
 *
 * A trimmed-down mirror of diagramEditor.js.
 */

import { registerFormAction } from './formActions.js';
import {
  createForm, replaceCurrentOpener, setCrumbLabel, isFormReplay, navigateBack,
  resetDirtyBaseline, setButtonBusy, snapshotButton, restoreButton,
} from './form.js';
import { githubFetchAndPushFile, fetchFileMigratingIdentity } from './github.js';
import { generateUUID } from './admonitions.js';
import { mergeSave } from './mergeSave.js';
import { componentCommit } from './editLogDescribe.js';
import { getComponentContainer, containerExists } from './componentContainers.js';
import { spliceIntoContainer } from './guides.js';

const STORAGE_KEY = 'moreButtonsEditText';

// ── The block, through its container ─────────────────────────────────────────

const blocksOf = (md, container) => {
  const p = getComponentContainer(container.kind).readComponents(md, container.uuid);
  const lead = p.description ? [{ kind: 'text', txt: { uuid: p.descriptionUuid, body: p.description } }] : [];
  return { lead: lead[0] ?? null, parsed: p, all: [...lead, ...p.components] };
};

/** The words of text block `uuid` in `container`; null when it is not there. */
export function readTextBlock(md, container, uuid) {
  if (!getComponentContainer(container.kind) || !containerExists(md, container)) return null;
  return blocksOf(md, container).all.find(c => c.kind === 'text' && c.txt.uuid === uuid)?.txt.body ?? null;
}

/** `md` with text block `uuid` of `container` holding `body` (null or '' takes the block away). */
export function writeTextBlock(md, container, uuid, body) {
  const handler = getComponentContainer(container.kind);
  const { lead, parsed } = blocksOf(md, container);
  const text = String(body ?? '').trim();
  if (lead?.txt.uuid === uuid) return handler.writeBody(md, container.uuid, text, parsed.components);
  const next = parsed.components
    .map(c => (c.kind === 'text' && c.txt.uuid === uuid ? { kind: 'text', txt: { uuid, body: text } } : c))
    .filter(c => c.kind !== 'text' || c.txt.body.trim());
  return handler.writeBody(md, container.uuid, parsed.description, next);
}

// ── Form ↔ data ──────────────────────────────────────────────────────────────

const readBody = formEl => formEl.querySelector('[name="textBody"]')?.value ?? '';
const seedStorage = fields => chrome.storage.local.set({ [STORAGE_KEY]: fields });
const containerOf = formEl => ({
  kind: formEl.dataset.parentKind,
  uuid: formEl.dataset.parentUuid,
  file: formEl.dataset.parentFile,
});

// A short, single-line crumb label: the text's opening words.
export function crumbFor(body) {
  const first = (body ?? '').split('\n').map(l => l.replace(/[*_`#>\[\]]/g, '').trim()).find(Boolean);
  return first ? first.slice(0, 40) : 'Text';
}

// ── Openers ──────────────────────────────────────────────────────────────────

registerFormAction('openCreateText', async ({ container, insertAtIndex } = {}) => {
  if (!container?.file) return;
  if (!isFormReplay()) await seedStorage({ textBody: '' });

  const { formEl } = await createForm('editText');
  if (!formEl) return;
  formEl.dataset.mode = 'create';
  formEl.dataset.parentKind = container.kind;
  formEl.dataset.parentUuid = container.uuid;
  formEl.dataset.parentFile = container.file;
  formEl.dataset.insertAtIndex = insertAtIndex == null ? '' : String(insertAtIndex);
  formEl.dataset.editUuid = '';

  const heading = formEl.querySelector('[data-text-heading]');
  if (heading) heading.textContent = 'Add text';
  // Delete (lives in the moved form-actions) only applies once the text exists.
  formEl.parentElement?.querySelector('[data-delete-text-btn]')?.style.setProperty('display', 'none');

  resetDirtyBaseline(formEl);
});

registerFormAction('openEditText', async ({ container, uuid } = {}) => {
  if (!uuid || !container?.file) return;
  let md;
  try {
    md = await fetchFileMigratingIdentity(container.file);
  } catch (e) {
    alert('Failed to load file: ' + e.message);
    return;
  }
  const body = readTextBlock(md, container, uuid);
  if (body == null) { alert('Text not found.'); return; }

  if (!isFormReplay()) await seedStorage({ textBody: body });

  const { formEl } = await createForm('editText');
  if (!formEl) return;
  formEl.dataset.mode = 'edit';
  formEl.dataset.editUuid = uuid;
  formEl.dataset.parentKind = container.kind;
  formEl.dataset.parentUuid = container.uuid;
  formEl.dataset.parentFile = container.file;

  const heading = formEl.querySelector('[data-text-heading]');
  if (heading) heading.textContent = 'Edit text';
  setCrumbLabel(crumbFor(body));

  resetDirtyBaseline(formEl);
});

// ── Persistence ──────────────────────────────────────────────────────────────

async function persistNewText(formEl, onProgress = () => {}) {
  const body = readBody(formEl).trim();
  if (!body) { alert('Text is required.'); return null; }
  const newUuid = generateUUID();
  const parent = containerOf(formEl);
  const insertAtRaw = formEl.dataset.insertAtIndex;
  const insertAt = insertAtRaw === '' || insertAtRaw == null ? null : parseInt(insertAtRaw, 10);
  await spliceIntoContainer(parent, insertAt, [{ kind: 'text', txt: { uuid: newUuid, body } }], onProgress);
  return { newUuid, parent };
}

// Flip the create form into an edit-of-new-text form in place, so inserted text
// lands in its editor like every other component kind.
async function transitionTextCreateToEdit(formEl, newUuid, parent) {
  formEl.dataset.mode = 'edit';
  formEl.dataset.editUuid = newUuid;
  replaceCurrentOpener('openEditText', { container: parent, uuid: newUuid });
  const heading = formEl.querySelector('[data-text-heading]');
  if (heading) heading.textContent = 'Edit text';
  formEl.parentElement?.querySelector('[data-delete-text-btn]')?.style.removeProperty('display');
  const body = readBody(formEl);
  setCrumbLabel(crumbFor(body));
  await seedStorage({ textBody: body });
  resetDirtyBaseline(formEl);
}

async function persistTextEdit(formEl, onProgress = () => {}) {
  if (!readBody(formEl).trim()) { alert('Text is required.'); return null; }
  const editUuid = formEl.dataset.editUuid;
  const container = containerOf(formEl);

  await mergeSave({
    formEl,
    file: container.file,
    onProgress,
    fieldSpecs: [
      { name: 'textBody', type: 'scalar', label: 'Text' },
    ],
    readFresh: md => ({ textBody: readTextBlock(md, container, editUuid) ?? '' }),
    build: (md, resolved) => {
      if (readTextBlock(md, container, editUuid) == null) throw new Error('This text no longer exists.');
      return writeTextBlock(md, container, editUuid, resolved.textBody);
    },
    commit: ({ before }) => componentCommit('Edited', 'Text', before, container.uuid),
  });
  return { editUuid };
}

// ── Form actions ─────────────────────────────────────────────────────────────

registerFormAction('submitEditText', async ({ formEl, content }) => {
  const saveBtn = content.querySelector('[data-save-state]');
  setButtonBusy(saveBtn, 'Saving…');
  try {
    if (formEl.dataset.mode === 'create') {
      const res = await persistNewText(formEl, s => setButtonBusy(saveBtn, s));
      if (!res) { formEl._refreshSaveState?.(); return; }
      await transitionTextCreateToEdit(formEl, res.newUuid, res.parent);
    } else {
      const res = await persistTextEdit(formEl, s => setButtonBusy(saveBtn, s));
      if (!res) { formEl._refreshSaveState?.(); return; }
    }
    formEl._refreshSaveState?.();
  } catch (e) {
    formEl._refreshSaveState?.();
    alert('Failed to save text: ' + e.message);
  }
});

registerFormAction('deleteText', async ({ formEl, content }) => {
  const editUuid = formEl.dataset.editUuid;
  const container = containerOf(formEl);
  if (!editUuid || !container.file) return;
  if (!confirm('Delete this text?')) return;
  const btn = content.querySelector('[data-action="deleteText"]');
  const snap = snapshotButton(btn);
  setButtonBusy(btn, 'Deleting…');
  try {
    await githubFetchAndPushFile(container.file, s => setButtonBusy(btn, s), md => writeTextBlock(md, container, editUuid, ''), {
      commit: ({ before }) => componentCommit('Deleted', 'Text', before, container.uuid),
    });
    await chrome.storage.local.remove(STORAGE_KEY);
    await navigateBack();
  } catch (e) {
    restoreButton(btn, snap);
    alert('Failed to delete text: ' + e.message);
  }
});
