/**
 * codeBlockEditor.js — the "Code block" component overlay (a Zensical fenced
 * code block with pymdownx.highlight options).
 *
 * A leaf component like the diagram (see diagramEditor.js, which this mirrors):
 * no children, so no container registration and no save-gate `_componentSaver`.
 *
 * Beyond the diagram clone the form carries: a language input backed by the
 * shared suggest-combobox (free text allowed — any Pygments id works), a title,
 * an Off/On line-numbers radio with a start-number input, an hl_lines field,
 * and the rich code surface (codeRichEditor.js): annotation markers render as
 * inline chips whose texts are a VIEW over the hidden `codeAnnotations` input
 * (ANNOTATION_SEP-joined, so mergeSave sees a single scalar).
 *
 * Markdown round-trip lives in mdCodeBlocks.js (pure), marker/comment-syntax
 * logic in codeAnnotations.js (pure). This module is the DOM/network
 * lifecycle only.
 */

import { registerFormAction } from './formActions.js';
import {
  createForm, replaceCurrentOpener, setCrumbLabel, isFormReplay, navigateBack,
  resetDirtyBaseline, setButtonBusy, snapshotButton, restoreButton, readFormValues,
} from './form.js';
import { githubFetchAndPushFile, fetchFileMigratingIdentity } from './github.js';
import { generateUUID } from './admonitions.js';
import { mergeSave } from './mergeSave.js';
import { spliceIntoContainer } from './guides.js';
import { attachSuggestCombobox } from './suggestCombobox.js';
import {
  locateCodeBlockByUUID, replaceCodeBlockByUUID, deleteCodeBlockByUUID,
  codeBlockDimFields, codeBlockFromDimFields, ANNOTATION_SEP,
} from './mdCodeBlocks.js';
import { upgradeCodeTextarea } from './codeRichEditor.js';

const STORAGE_KEY = 'moreButtonsEditCodeBlock';

// Common Pygments language ids for the combobox. Free text is still allowed —
// this is a suggestion list, not a closed enum.
const LANGUAGES = [
  'python', 'bash', 'shell', 'console', 'powershell', 'batch',
  'javascript', 'typescript', 'json', 'yaml', 'toml', 'ini', 'text',
  'html', 'css', 'scss', 'xml', 'markdown', 'sql', 'diff', 'docker',
  'csharp', 'java', 'kotlin', 'swift', 'go', 'rust', 'c', 'cpp',
  'php', 'ruby', 'perl', 'r', 'vbnet', 'nginx', 'http', 'regex',
];

// ── Form ↔ data ────────────────────────────────────────────────────────────

function emptyFields() {
  return codeBlockDimFields(null);
}

// A short, single-line crumb label: title → language → first code line.
function crumbFor({ title, language, code }) {
  const t = (title ?? '').trim();
  if (t) return t.slice(0, 40);
  const l = (language ?? '').trim();
  if (l) return l.slice(0, 40);
  const first = (code ?? '').split('\n').map(s => s.trim()).find(Boolean);
  return first ? first.slice(0, 40) : 'Code block';
}

function seedStorage(fields) {
  return chrome.storage.local.set({ [STORAGE_KEY]: fields });
}

// ── Widget wiring ────────────────────────────────────────────────────────────

/**
 * One-time per-form wiring: language combobox, line-numbers start seeding, and
 * the rich code surface over the codeSource + hidden codeAnnotations pair.
 * Runs before storage hydration lands — both inputs' `_mbSyncView` hooks
 * re-render the surface when hydration writes the values.
 */
function wireCodeBlockForm(formEl) {
  const langInput = formEl.querySelector('[name="codeLanguage"]');
  if (langInput) attachSuggestCombobox(langInput, { getItems: () => Promise.resolve(LANGUAGES) });

  // Turning line numbers on seeds an empty start with 1; turning them off
  // clears it (a hidden-but-filled start would false-dirty the form against
  // codeBlockDimFields' '' for an off block).
  const startInput = formEl.querySelector('[name="codeLinenumsStart"]');
  formEl.querySelectorAll('input[name="codeLinenumsMode"]').forEach(r => {
    r.addEventListener('change', () => {
      if (!startInput) return;
      const on = formEl.querySelector('input[name="codeLinenumsMode"]:checked')?.value === 'on';
      startInput.value = on ? (startInput.value || '1') : '';
      startInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });

  // The rich code surface: markers-as-chips over codeSource, annotation texts
  // over the hidden ANNOTATION_SEP-joined codeAnnotations scalar. All marker /
  // hint / comment-syntax behaviour lives in codeRichEditor.js.
  const hidden = formEl.querySelector('[name="codeAnnotations"]');
  const codeTa = formEl.querySelector('[name="codeSource"]');
  if (!hidden || !codeTa) return;
  upgradeCodeTextarea(codeTa, { langInput, annotationsInput: hidden });
}

// ── Openers ──────────────────────────────────────────────────────────────────

registerFormAction('openCreateCodeBlock', async ({ container, insertAtIndex } = {}) => {
  if (!container?.file) return;
  if (!isFormReplay()) await seedStorage(emptyFields());

  const { formEl } = await createForm('editCodeBlock');
  if (!formEl) return;
  formEl.dataset.mode = 'create';
  formEl.dataset.parentKind = container.kind;
  formEl.dataset.parentUuid = container.uuid;
  formEl.dataset.parentFile = container.file;
  formEl.dataset.insertAtIndex = insertAtIndex == null ? '' : String(insertAtIndex);
  formEl.dataset.editUuid = '';

  const heading = formEl.querySelector('[data-codeblock-heading]');
  if (heading) heading.textContent = 'Add code block';
  // Delete (lives in the moved form-actions) only applies once the block exists.
  formEl.parentElement?.querySelector('[data-delete-codeblock-btn]')?.style.setProperty('display', 'none');

  wireCodeBlockForm(formEl);
  resetDirtyBaseline(formEl);
});

registerFormAction('openEditCodeBlock', async ({ uuid, file } = {}) => {
  if (!uuid || !file) return;
  let md;
  try {
    md = await fetchFileMigratingIdentity(file);
  } catch (e) {
    alert('Failed to load file: ' + e.message);
    return;
  }
  const cb = locateCodeBlockByUUID(md, uuid);
  if (!cb) { alert('Code block not found.'); return; }

  if (!isFormReplay()) await seedStorage(codeBlockDimFields(cb));

  const { formEl } = await createForm('editCodeBlock');
  if (!formEl) return;
  formEl.dataset.mode = 'edit';
  formEl.dataset.editUuid = uuid;
  formEl.dataset.containerFile = file;

  const heading = formEl.querySelector('[data-codeblock-heading]');
  if (heading) heading.textContent = 'Edit code block';
  setCrumbLabel(crumbFor(cb));

  wireCodeBlockForm(formEl);
  resetDirtyBaseline(formEl);
});

// ── Persistence ──────────────────────────────────────────────────────────────

const FIELD_SPECS = [
  { name: 'codeLanguage', type: 'scalar', label: 'Language' },
  { name: 'codeTitle', type: 'scalar', label: 'Title' },
  { name: 'codeLinenumsMode', type: 'scalar', label: 'Line numbers' },
  { name: 'codeLinenumsStart', type: 'scalar', label: 'Line numbers start' },
  { name: 'codeHlLines', type: 'scalar', label: 'Highlighted lines' },
  { name: 'codeSource', type: 'scalar', label: 'Code' },
  { name: 'codeAnnotations', type: 'sepList', sep: ANNOTATION_SEP, label: 'Annotations' },
];

async function persistNewCodeBlock(formEl, onProgress = () => {}) {
  formEl._mbCodeFinalize?.(); // drop empty-text markers before reading values
  const fields = codeBlockFromDimFields(readFormValues(formEl));
  if (!fields.code.trim()) { alert('Code is required.'); return null; }
  const newUuid = generateUUID();
  const parent = {
    kind: formEl.dataset.parentKind,
    uuid: formEl.dataset.parentUuid,
    file: formEl.dataset.parentFile,
  };
  const insertAtRaw = formEl.dataset.insertAtIndex;
  const insertAt = insertAtRaw === '' || insertAtRaw == null ? null : parseInt(insertAtRaw, 10);
  const cb = { uuid: newUuid, ...fields };
  await spliceIntoContainer(parent, insertAt, [{ kind: 'codeblock', cb }], onProgress);
  return { newUuid, file: parent.file };
}

// Flip the create form into an edit-of-new-block form in place, so an inserted
// code block lands in its editor (matching buttons / admonitions / diagrams).
async function transitionCodeBlockCreateToEdit(formEl, newUuid, file) {
  formEl.dataset.mode = 'edit';
  formEl.dataset.editUuid = newUuid;
  formEl.dataset.containerFile = file;
  replaceCurrentOpener('openEditCodeBlock', { uuid: newUuid, file });
  const heading = formEl.querySelector('[data-codeblock-heading]');
  if (heading) heading.textContent = 'Edit code block';
  formEl.parentElement?.querySelector('[data-delete-codeblock-btn]')?.style.removeProperty('display');
  const dim = readFormValues(formEl);
  setCrumbLabel(crumbFor(codeBlockFromDimFields(dim)));
  await seedStorage({
    codeLanguage: dim.codeLanguage ?? '',
    codeTitle: dim.codeTitle ?? '',
    codeLinenumsMode: dim.codeLinenumsMode ?? 'off',
    codeLinenumsStart: dim.codeLinenumsStart ?? '',
    codeHlLines: dim.codeHlLines ?? '',
    codeSource: dim.codeSource ?? '',
    codeAnnotations: dim.codeAnnotations ?? '',
  });
  resetDirtyBaseline(formEl);
}

async function persistCodeBlockEdit(formEl, onProgress = () => {}) {
  formEl._mbCodeFinalize?.(); // drop empty-text markers before reading values
  const fields = codeBlockFromDimFields(readFormValues(formEl));
  if (!fields.code.trim()) { alert('Code is required.'); return null; }
  const editUuid = formEl.dataset.editUuid;
  const file = formEl.dataset.containerFile;

  const resolved = await mergeSave({
    formEl,
    file,
    onProgress,
    fieldSpecs: FIELD_SPECS,
    // Annotation conflicts carry split arrays — the resolver renders each item
    // as a numbered list entry titled by its first line.
    resolverOptions: {
      describe: item => {
        const line = String(item).split('\n')[0];
        return { title: line.length > 80 ? line.slice(0, 77) + '…' : line };
      },
    },
    readFresh: md => codeBlockDimFields(locateCodeBlockByUUID(md, editUuid) ?? {}),
    build: (md, res) => {
      if (!locateCodeBlockByUUID(md, editUuid)) throw new Error('Code block no longer exists.');
      return replaceCodeBlockByUUID(md, editUuid, codeBlockFromDimFields(res));
    },
  });
  if (!resolved) return null; // resolver cancelled
  return { editUuid, file };
}

// ── Form actions ──────────────────────────────────────────────────────────────

registerFormAction('submitEditCodeBlock', async ({ formEl, content }) => {
  const saveBtn = content.querySelector('[data-save-state]');
  setButtonBusy(saveBtn, 'Saving…');
  try {
    if (formEl.dataset.mode === 'create') {
      const res = await persistNewCodeBlock(formEl, s => setButtonBusy(saveBtn, s));
      if (!res) { formEl._refreshSaveState?.(); return; }
      await transitionCodeBlockCreateToEdit(formEl, res.newUuid, res.file);
    } else {
      const res = await persistCodeBlockEdit(formEl, s => setButtonBusy(saveBtn, s));
      if (!res) { formEl._refreshSaveState?.(); return; }
    }
    formEl._refreshSaveState?.();
  } catch (e) {
    formEl._refreshSaveState?.();
    alert('Failed to save code block: ' + e.message);
  }
});

registerFormAction('deleteCodeBlock', async ({ formEl, content }) => {
  const editUuid = formEl.dataset.editUuid;
  const file = formEl.dataset.containerFile;
  if (!editUuid || !file) return;
  if (!confirm('Delete this code block?')) return;
  const btn = content.querySelector('[data-action="deleteCodeBlock"]');
  const snap = snapshotButton(btn);
  setButtonBusy(btn, 'Deleting…');
  try {
    await githubFetchAndPushFile(file, s => setButtonBusy(btn, s), md => deleteCodeBlockByUUID(md, editUuid));
    await chrome.storage.local.remove(STORAGE_KEY);
    await navigateBack();
  } catch (e) {
    restoreButton(btn, snap);
    alert('Failed to delete code block: ' + e.message);
  }
});
