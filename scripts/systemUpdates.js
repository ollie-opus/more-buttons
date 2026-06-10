import { registerFormAction, getFormAction } from './formActions.js';
import { githubFetchAndPushFile, fetchFileMigratingIdentity } from './github.js';
import { readRepoText, assetCdnUrl } from './repoClient.js';
import { suppress, reconcile, filterSuppressed } from './staleSuppression.js';
import { createForm, navigateBack, isFormReplay, replaceCurrentOpener, setButtonBusy, snapshotButton, restoreButton } from './form.js';
import { renderCard } from './cardRenderer.js';
import { parseAdmonitions, buildAdmonition, generateUUID, injectAdmonitionUUID, replaceAdmonitionByUUID, deleteAdmonitionByUUID, splitTitleMeta, joinTitleMeta } from './admonitions.js';
import { pushCaptures } from './captures.js';
import { registerComponentContainer } from './componentContainers.js';
import { parseComponents, buildComponentBody, uuidOfComponent, reorderComponents } from './components.js';
import { mergeSave } from './mergeSave.js';
import { loadingMarkup } from './loading.js';
import {
  makeContainerHandler, GUIDE_ADMONITION_TYPES_RE,
  renderComponents, onComponentEditorClick, setOpenComponentEditor,
  reorderOpenComponentEditor,
} from './guides.js';

const DRAFT_ENTITY = 'systemUpdateDrafts';

// ── Constants ─────────────────────────────────────────────────────────────────

const UPDATES_FILE = 'docs/pages/system-updates.md';
const DRAFTS_FILE = 'docs/drafts/system-updates.md';

const TYPE_LABELS = {
  'feature-release': 'Feature release',
  'new-addition':    'New addition',
  'improvement':     'Improvement',
};

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];

// ── Private helpers ───────────────────────────────────────────────────────────

function todayIsoDate() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function formatUpdateDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const v = day % 100;
  const ordinal = (v >= 11 && v <= 13) ? 'th' : (['th','st','nd','rd'][v % 10] ?? 'th');
  return `${day}${ordinal} ${MONTH_NAMES[month - 1]} ${year}`;
}

function parseDateStr(formattedDate) {
  const m = formattedDate.match(/^(\d+)\w*\s+(\w+)\s+(\d{4})$/);
  if (!m) return null;
  const monthIdx = MONTH_NAMES.indexOf(m[2]);
  if (monthIdx === -1) return null;
  return { year: parseInt(m[3]), month: monthIdx + 1, day: parseInt(m[1]) };
}

function getYearMonthFromDateStr(dateStr) {
  const [year, month] = dateStr.split('-').map(Number);
  return { year, month, monthLabel: `${MONTH_NAMES[month - 1]} ${year}` };
}

// ── Parse / build ─────────────────────────────────────────────────────────────

export function parseUpdateBlocks(markdown) {
  const raw = parseAdmonitions(markdown, /feature-release|new-addition|improvement/);
  return raw.map(({ type, title, body, uuid }) => {
    const { title: rawTitle, meta: date } = splitTitleMeta(title);
    const labelPrefix = (TYPE_LABELS[type] ?? '') + ': ';
    const cleanTitle = rawTitle.startsWith(labelPrefix) ? rawTitle.slice(labelPrefix.length) : rawTitle;
    return { type, title: cleanTitle, date, body, uuid };
  });
}

export function buildUpdateBlock(update, captures = []) {
  const typeLabel = TYPE_LABELS[update.type] ?? update.type;
  const formattedDate = formatUpdateDate(update.date);
  const fullTitleString = joinTitleMeta(`${typeLabel}: ${update.title}`, formattedDate);

  const descLines = (update.description ?? update.body ?? '').split('\n');
  const captureLines = captures.flatMap(c => {
    const dimAttr = c.dimMode === 'width' ? `width="${c.dimValue}"` : `style="height: ${c.dimValue ?? 50}px"`;
    return [
      '',
      `![](../assets/${c.lightFilename}#only-light){ ${dimAttr} loading=lazy }`,
      `![](../assets/${c.darkFilename}#only-dark){ ${dimAttr} loading=lazy }`,
    ];
  });

  const bodyContent = [...descLines, ...captureLines].join('\n');
  const uuid = update.uuid ?? generateUUID();
  const bodyWithUUID = bodyContent.includes('data-uuid=')
    ? bodyContent
    : injectAdmonitionUUID(bodyContent, uuid);

  return buildAdmonition('???', update.type, fullTitleString, bodyWithUUID);
}

// ── Components container (an update block's body holds an ordered list) ────────
//
// In the unified model an update's body is a Components list (captures +
// guide-style admonitions), exactly like a guide section. These read/write fns
// operate on the markdown of the update's file (UPDATES_FILE or DRAFTS_FILE) —
// the file itself is carried on the container and applied by makeContainerHandler.
// Locating/parsing is identical for published and draft updates (parseUpdateBlocks
// === parseDraftBlocks), so both kinds share one handler, differing only in file.

function readUpdateComponents(md, uuid) {
  const block = parseUpdateBlocks(md).find(u => u.uuid === uuid);
  return parseComponents(block ? block.body : '', GUIDE_ADMONITION_TYPES_RE);
}

function writeUpdateBody(md, uuid, description, components) {
  const block = parseUpdateBlocks(md).find(u => u.uuid === uuid);
  if (!block) return md;
  // parseUpdateBlocks yields the *display* date ("5th June 2026"); buildUpdateBlock
  // re-formats from ISO, so convert back before round-tripping.
  const di = parseDateStr(block.date);
  const isoDate = di
    ? `${di.year}-${String(di.month).padStart(2, '0')}-${String(di.day).padStart(2, '0')}`
    : block.date;
  // buildComponentBody embeds the uuid span; buildUpdateBlock then sees it and
  // skips re-injection. captures=[] because captures now live inside the body.
  const body = buildComponentBody(uuid, description, components);
  return replaceUpdateInMarkdown(
    md, uuid,
    { type: block.type, title: block.title, date: isoDate, uuid, description: body },
    [],
  );
}

registerComponentContainer('system-update', makeContainerHandler(readUpdateComponents, writeUpdateBody));
registerComponentContainer('system-draft',  makeContainerHandler(readUpdateComponents, writeUpdateBody));

// Mounts the unified Components list onto an opened update edit form and wires
// the shared click delegation (insert / edit-admonition / edit-capture).
function mountUpdateComponentsEditor(formEl, { uuid, file, kind, components }) {
  formEl.dataset.editUuid = uuid;
  formEl.dataset.componentContainerKind = kind;
  formEl.dataset.containerFile = file;
  formEl.dataset.mode = 'edit';
  formEl._componentSaver = () => saveUpdateForComponent(formEl);
  const listEl = formEl.querySelector('[data-update-components]');
  renderComponents(listEl, components, false); // updates don't number steps
  setOpenComponentEditor({ formEl, listEl, container: { kind, uuid, file }, components });
  formEl._reorderRehydrate = (order) => reorderOpenComponentEditor(order);
  formEl.addEventListener('click', onComponentEditorClick);
}

// Save-gate saver for the Log form: persist as a DRAFT, navigate into the draft
// editor, and continue the child flow there. Returns { container, formEl } or null.
async function saveLogUpdateForComponent(formEl) {
  const { title, date, type, description } = readUpdateFormFields(formEl);
  if (!title || !date || !type) { alert('Please fill in all required fields.'); return null; }
  const uuid = generateUUID();
  await saveNewDraft({ title, date, type, description, uuid }, [], () => {});
  await chrome.storage.local.remove('moreButtonsLogSystemUpdate');
  // Returning from a child should land on the updates list, not the blank log form.
  replaceCurrentOpener('openSystemUpdatesEntry');
  await getFormAction('openEditDraftSystemUpdate')({ uuid });
  const newFormEl = document.querySelector('.more-buttons-overlay form[data-storage-key]');
  return { container: { kind: 'system-draft', uuid, file: DRAFTS_FILE }, formEl: newFormEl };
}

// Save-gate saver for the (already-saved) update + draft editors: rewrite the
// block's header + leading description through the merge engine, preserving
// committed components and honouring an in-flight reorder. The update's own LIST
// position is date-driven and untouched here — only the components INSIDE reorder.
async function saveUpdateForComponent(formEl, onProgress = () => {}) {
  const { title, date, type } = readUpdateFormFields(formEl); // date is ISO from the form
  if (!title || !date || !type) { alert('Please fill in all required fields.'); return null; }
  const uuid = formEl.dataset.editUuid;
  const kind = formEl.dataset.componentContainerKind; // 'system-update' | 'system-draft'
  const file = formEl.dataset.containerFile;

  // UUID → display descriptor for the order-conflict resolver, built from the
  // union of the open editor's working components and whatever readFresh parses.
  const labelMap = {};
  const noteLabels = comps => {
    for (const c of comps) {
      if (c.kind === 'admonition') {
        const { title: t } = splitTitleMeta(c.adm.title || '');
        labelMap[c.adm.uuid] = { kind: 'admonition', title: t || c.adm.type };
      } else if (c.kind === 'tabs') {
        labelMap[c.grp.uuid] = { kind: 'admonition', title: 'Content tabs' };
      } else {
        labelMap[c.cap.uuid] = { kind: 'capture', thumbSrc: assetCdnUrl('docs/assets/' + c.cap.lightFilename) };
      }
    }
  };

  await mergeSave({
    formEl,
    file,
    onProgress,
    resolverOptions: { describe: (u) => labelMap[u] },
    fieldSpecs: [
      { name: 'updateTitle', type: 'scalar', label: 'Title' },
      { name: 'updateDate', type: 'scalar', label: 'Date' },
      { name: 'updateType', type: 'scalar', label: 'Type' },
      { name: 'description', type: 'scalar', label: 'Description' },
      { name: 'componentOrder', type: 'orderedUuidList', label: 'Component order' },
    ],
    readFresh: md => {
      const block = parseUpdateBlocks(md).find(u => u.uuid === uuid);
      // parseUpdateBlocks yields the *display* date; the form value is ISO, so
      // normalize the fresh side to ISO too — otherwise an unchanged date reads
      // as a phantom conflict.
      const di = block ? parseDateStr(block.date) : null;
      const isoDate = di ? `${di.year}-${String(di.month).padStart(2, '0')}-${String(di.day).padStart(2, '0')}` : '';
      const { description, components } = readUpdateComponents(md, uuid);
      noteLabels(components);
      return {
        updateTitle: block?.title ?? '',
        updateDate: isoDate,
        updateType: block?.type ?? '',
        description: description ?? '',
        componentOrder: components.map(uuidOfComponent).join(','),
      };
    },
    build: (md, resolved) => {
      const { components } = readUpdateComponents(md, uuid);
      const ordered = reorderComponents(components, (resolved.componentOrder ?? '').split(',').filter(Boolean));
      const body = buildComponentBody(uuid, resolved.description, ordered);
      const upd = { title: resolved.updateTitle, date: resolved.updateDate, type: resolved.updateType, uuid, description: body };
      return kind === 'system-update'
        ? replaceUpdateInMarkdown(md, uuid, upd, [])
        : replaceDraftInMarkdown(md, uuid, upd, []);
    },
  });
  return { container: { kind, uuid, file }, formEl };
}

// description (the form's leading text) + the container's current components →
// the update block's rebuilt body. Components are re-read fresh so any committed
// during this edit session are preserved.
function rebuildUpdateBody(md, uuid, description) {
  const { components } = readUpdateComponents(md, uuid);
  return buildComponentBody(uuid, description, components);
}

// ── Month/Year heading management ─────────────────────────────────────────────

function cleanEmptyYearSection(md, year) {
  const lines = md.split('\n');
  const yearIdx = lines.findIndex(l => l === `## ${year}`);
  if (yearIdx === -1) return md;

  let hasMonths = false;
  let nextYearIdx = lines.length;
  for (let i = yearIdx + 1; i < lines.length; i++) {
    if (/^## \d{4}/.test(lines[i])) { nextYearIdx = i; break; }
    if (/^### /.test(lines[i])) { hasMonths = true; break; }
  }
  if (hasMonths) return md;

  let removeStart = yearIdx;
  if (removeStart > 0 && lines[removeStart - 1] === '') removeStart--;
  return [...lines.slice(0, removeStart), ...lines.slice(nextYearIdx)].join('\n');
}

function cleanEmptyMonthSection(md, monthLabel, year) {
  const lines = md.split('\n');
  const monthIdx = lines.findIndex(l => l === `### ${monthLabel}`);
  if (monthIdx === -1) return md;

  let hasUpdates = false;
  let nextSectionIdx = lines.length;
  for (let i = monthIdx + 1; i < lines.length; i++) {
    if (/^#{2,3} /.test(lines[i])) { nextSectionIdx = i; break; }
    if (/^\?\?\? /.test(lines[i])) { hasUpdates = true; break; }
  }
  if (hasUpdates) return md;

  let removeStart = monthIdx;
  if (removeStart > 0 && lines[removeStart - 1] === '') removeStart--;
  md = [...lines.slice(0, removeStart), ...lines.slice(nextSectionIdx)].join('\n');
  return cleanEmptyYearSection(md, year);
}

export function insertUpdateIntoMarkdown(markdown, update, captures = []) {
  if (update.uuid && parseUpdateBlocks(markdown).some(u => u.uuid === update.uuid)) {
    return replaceAdmonitionByUUID(markdown, update.uuid, buildUpdateBlock(update, captures));
  }
  const block = buildUpdateBlock(update, captures);
  const { year, month, monthLabel } = getYearMonthFromDateStr(update.date);
  let md = markdown;

  // Ensure year section exists
  if (!new RegExp(`^## ${year}\\s*$`, 'm').test(md)) {
    const yearBlock = `## ${year}\n\n---\n\n`;
    const yearRe = /^## (\d{4})\s*$/gm;
    let insertPos = -1;
    let ym;
    while ((ym = yearRe.exec(md)) !== null) {
      if (parseInt(ym[1]) < year) { insertPos = ym.index; break; }
    }
    if (insertPos >= 0) {
      const needsBlank = insertPos >= 2 && md[insertPos - 2] !== '\n';
      md = md.slice(0, insertPos) + (needsBlank ? '\n' : '') + yearBlock + md.slice(insertPos);
    } else {
      md = md.trimEnd() + '\n\n' + yearBlock;
    }
  }

  // Ensure month heading exists
  if (!new RegExp(`^### ${monthLabel}\\s*$`, 'm').test(md)) {
    const yearStart = md.search(new RegExp(`^## ${year}\\s*$`, 'm'));
    const afterYearLine = md.indexOf('\n', yearStart) + 1;
    const nextYearMatch = /^## \d{4}/m.exec(md.slice(afterYearLine));
    const yearEnd = nextYearMatch ? afterYearLine + nextYearMatch.index : md.length;
    const yearSection = md.slice(afterYearLine, yearEnd);

    const monthRe = /^### (\w+) (\d{4})\s*$/gm;
    let insertRelIdx = -1;
    let mm;
    while ((mm = monthRe.exec(yearSection)) !== null) {
      if ((MONTH_NAMES.indexOf(mm[1]) + 1) < month) { insertRelIdx = mm.index; break; }
    }

    const monthBlock = `### ${monthLabel}\n\n`;
    if (insertRelIdx >= 0) {
      const absIdx = afterYearLine + insertRelIdx;
      md = md.slice(0, absIdx) + monthBlock + md.slice(absIdx);
    } else {
      const absEnd = nextYearMatch ? md.indexOf(nextYearMatch[0], afterYearLine) : md.length;
      md = md.slice(0, absEnd) + monthBlock + md.slice(absEnd);
    }
  }

  // Insert block at top of month section (after heading + blank lines)
  const monthPos = md.search(new RegExp(`^### ${monthLabel}\\s*$`, 'm'));
  let insertAt = md.indexOf('\n', monthPos) + 1;
  while (insertAt < md.length && md[insertAt] === '\n') insertAt++;
  return md.slice(0, insertAt) + block + '\n\n' + md.slice(insertAt);
}

export function replaceUpdateInMarkdown(markdown, uuid, update, newCaptures = []) {
  return replaceAdmonitionByUUID(markdown, uuid, buildUpdateBlock(update, newCaptures));
}

export function deleteUpdateFromMarkdown(markdown, uuid) {
  const target = parseUpdateBlocks(markdown).find(u => u.uuid === uuid);
  let md = deleteAdmonitionByUUID(markdown, uuid);

  if (target) {
    const dateInfo = parseDateStr(target.date);
    if (dateInfo) {
      const monthLabel = `${MONTH_NAMES[dateInfo.month - 1]} ${dateInfo.year}`;
      md = cleanEmptyMonthSection(md, monthLabel, dateInfo.year);
    }
  }

  return md;
}

// ── Drafts: parse / build / mutate ────────────────────────────────────────────

const DRAFTS_HEADER = '# System update drafts\n\n';

export const parseDraftBlocks = parseUpdateBlocks;

export function insertDraftIntoMarkdown(markdown, update, captures = []) {
  const block = buildUpdateBlock(update, captures);
  const base = markdown && markdown.trim() ? markdown : DRAFTS_HEADER;
  const headerMatch = base.match(/^(#\s.*\n+)/);
  if (headerMatch) {
    return base.slice(0, headerMatch[0].length) + block + '\n\n' + base.slice(headerMatch[0].length);
  }
  return DRAFTS_HEADER + block + '\n\n' + base;
}

export function replaceDraftInMarkdown(markdown, uuid, update, captures = []) {
  return replaceAdmonitionByUUID(markdown, uuid, buildUpdateBlock({ ...update, uuid }, captures));
}

export function removeDraftFromMarkdown(markdown, uuid) {
  return deleteAdmonitionByUUID(markdown, uuid);
}

// ── Rendering ─────────────────────────────────────────────────────────────────

const TYPE_COLOURS = {
  'feature-release': 'purple',
  'new-addition':    'green',
  'improvement':     'blue',
};

function updateCard(update) {
  const colour = TYPE_COLOURS[update.type] ?? 'amber';
  const badge = TYPE_LABELS[update.type] ?? update.type;
  const preview = (update.body ?? '')
    .replace(/<span[^>]*data-uuid[^>]*><\/span>\n?/g, '')
    .replace(/!\[[^\]]*\]\([^)]+\)(\{[^}]+\})?/g, '')
    .replace(/\n+/g, ' ')
    .trim();
  const description = preview.length > 120 ? preview.slice(0, 120) + '…' : preview || null;
  const btnAttr = update.uuid ? `data-edit-system-update="${update.uuid}"` : `disabled title="This entry doesn't have a UUID configured"`;
  const btnLabel = update.uuid ? 'Edit' : 'Error';
  return renderCard({ colour, title: update.title, badge, description, meta: update.date, btnAttr, btnLabel });
}

function draftCard(update) {
  const colour = TYPE_COLOURS[update.type] ?? 'amber';
  const typeLabel = TYPE_LABELS[update.type] ?? update.type;
  const badge = `Draft · ${typeLabel}`;
  const preview = (update.body ?? '')
    .replace(/<span[^>]*data-uuid[^>]*><\/span>\n?/g, '')
    .replace(/!\[[^\]]*\]\([^)]+\)(\{[^}]+\})?/g, '')
    .replace(/\n+/g, ' ')
    .trim();
  const description = preview.length > 120 ? preview.slice(0, 120) + '…' : preview || null;
  const btnAttr = update.uuid ? `data-edit-draft-system-update="${update.uuid}"` : `disabled title="This draft doesn't have a UUID"`;
  const btnLabel = update.uuid ? 'Edit' : 'Error';
  return renderCard({ colour, title: update.title, badge, description, meta: update.date, btnAttr, btnLabel });
}

export async function renderDraftUpdates(_markdown, panel) {
  panel.innerHTML = loadingMarkup('Loading drafts…');
  let draftsMarkdown = '';
  try {
    draftsMarkdown = await readRepoText(DRAFTS_FILE);
  } catch {
    draftsMarkdown = '';
  }
  const allDrafts = draftsMarkdown ? parseDraftBlocks(draftsMarkdown) : [];
  const fetchedUuids = new Set(allDrafts.map(d => d.uuid).filter(Boolean));
  reconcile(DRAFT_ENTITY, fetchedUuids);
  const drafts = filterSuppressed(DRAFT_ENTITY, allDrafts);
  panel.innerHTML = drafts.length === 0
    ? `<p class="more-buttons-description">No draft updates.</p>`
    : drafts.map(d => draftCard(d)).join('');
}

export function renderPublishedUpdates(markdown, panel) {
  const updates = parseUpdateBlocks(markdown);
  panel.innerHTML = updates.length === 0
    ? `<p class="more-buttons-description">No published updates.</p>`
    : updates.map(u => updateCard(u)).join('');
}

// ── Publish functions ─────────────────────────────────────────────────────────

export async function publishNewUpdate(update, captures, onProgress) {
  await pushCaptures(captures, onProgress);
  return githubFetchAndPushFile(UPDATES_FILE, onProgress, md => insertUpdateIntoMarkdown(md, update, captures));
}

export async function publishUpdatedUpdate(uuid, update, captures, onProgress) {
  await pushCaptures(captures, onProgress);
  return githubFetchAndPushFile(UPDATES_FILE, onProgress, md => replaceUpdateInMarkdown(md, uuid, update, captures));
}

export async function publishDeleteUpdate(uuid, onProgress) {
  return githubFetchAndPushFile(UPDATES_FILE, onProgress, md => deleteUpdateFromMarkdown(md, uuid));
}

// ── Draft persistence ─────────────────────────────────────────────────────────

export async function saveNewDraft(update, captures, onProgress) {
  await pushCaptures(captures, onProgress);
  return githubFetchAndPushFile(DRAFTS_FILE, onProgress, md => insertDraftIntoMarkdown(md, update, captures));
}

export async function saveExistingDraft(uuid, update, captures, onProgress) {
  await pushCaptures(captures, onProgress);
  return githubFetchAndPushFile(DRAFTS_FILE, onProgress, md => replaceDraftInMarkdown(md, uuid, update, captures));
}

export async function publishDraft(uuid, update, captures, onProgress) {
  await pushCaptures(captures, onProgress);
  const updatedPublished = await githubFetchAndPushFile(UPDATES_FILE, onProgress, md => insertUpdateIntoMarkdown(md, { ...update, uuid }, captures));
  await githubFetchAndPushFile(DRAFTS_FILE, onProgress, md => removeDraftFromMarkdown(md, uuid));
  return updatedPublished;
}

export async function deleteDraft(uuid, onProgress) {
  return githubFetchAndPushFile(DRAFTS_FILE, onProgress, md => removeDraftFromMarkdown(md, uuid));
}

// ── Form action registrations ─────────────────────────────────────────────────

// Opened from the Knowledge Base tree. Registered (rather than reached via a
// bare createForm) so it carries a replayable descriptor — that lets the
// form-stack snapshot rebuild it as the parent after a capture-library
// round-trip, so Back from a child form (e.g. Log Update) returns here instead
// of dead-ending on a lone root.
registerFormAction('openSystemUpdatesEntry', () => createForm('systemUpdatesEntry'));

registerFormAction('openLogSystemUpdate', async () => {
  // On a genuine fresh open, discard any half-finished entry saved to storage
  // during an earlier capture-mode handoff. Skip during a capture-mode replay.
  if (!isFormReplay()) {
    await chrome.storage.local.remove('moreButtonsLogSystemUpdate');
  }
  const { formEl: logFormEl } = await createForm('logSystemUpdate');
  if (!logFormEl) return;
  const dateInput = logFormEl.querySelector('[name="updateDate"]');
  if (dateInput && !dateInput.value) dateInput.value = todayIsoDate();

  // Unified Components: the log form is create-mode; adding a component routes
  // through the save-gate, which saves a draft then continues in the draft editor.
  logFormEl.dataset.mode = 'create';
  logFormEl.dataset.componentContainerKind = 'system-draft';
  logFormEl.dataset.componentNoun = 'update';
  renderComponents(logFormEl.querySelector('[data-update-components]'), [], false);
  logFormEl._componentSaver = () => saveLogUpdateForComponent(logFormEl);
  logFormEl.addEventListener('click', onComponentEditorClick);
});

registerFormAction('submitLogSystemUpdate', async ({ formEl, content }) => {
  const btn = content.querySelector('[data-action="submitLogSystemUpdate"]');
  const snap = snapshotButton(btn);
  if (btn) btn.disabled = true;
  try {
    const title = formEl.querySelector('[name="updateTitle"]')?.value.trim() ?? '';
    const date = formEl.querySelector('[name="updateDate"]')?.value ?? '';
    const type = formEl.querySelector('[name="updateType"]:checked')?.value;
    const description = formEl.querySelector('[name="description"]')?.value.trim() ?? '';
    if (!title || !date || !type) { alert('Please fill in all required fields.'); restoreButton(btn, snap); return; }

    const update = { title, date, type, description, uuid: generateUUID() };
    await publishNewUpdate(update, [], s => setButtonBusy(btn, s));

    await chrome.storage.local.remove('moreButtonsLogSystemUpdate');
    // Continue into the edit form so components can be added to the just-published
    // update. Repoint this slot at the list so Back returns there.
    replaceCurrentOpener('openSystemUpdatesEntry');
    await getFormAction('openEditSystemUpdate')({ uuid: update.uuid });
  } catch (e) {
    restoreButton(btn, snap);
    alert('Failed to publish update: ' + e.message);
  }
});

registerFormAction('openEditSystemUpdate', async ({ uuid }) => {
  // Backfill + persist missing component UUIDs so captures in this update are
  // reorderable/editable on open (system-update captures were never migrated).
  const markdown = await fetchFileMigratingIdentity(UPDATES_FILE);
  const update = parseUpdateBlocks(markdown).find(u => u.uuid === uuid);
  if (!update) { alert('Entry not found.'); return; }

  const { description, components } = parseComponents(update.body ?? '', GUIDE_ADMONITION_TYPES_RE);
  const dateInfo = parseDateStr(update.date);
  const isoDate = dateInfo
    ? `${dateInfo.year}-${String(dateInfo.month).padStart(2,'0')}-${String(dateInfo.day).padStart(2,'0')}`
    : '';

  await chrome.storage.local.set({
    moreButtonsEditSystemUpdate: {
      updateTitle: update.title,
      updateDate:  isoDate,
      updateType:  update.type,
      description,
    }
  });

  const { formEl: editFormEl } = await createForm('editSystemUpdate');
  if (editFormEl) {
    mountUpdateComponentsEditor(editFormEl, { uuid, file: UPDATES_FILE, kind: 'system-update', components });
  }
});

registerFormAction('submitEditSystemUpdate', async ({ formEl, content }) => {
  const btn = content.querySelector('[data-save-state]');
  setButtonBusy(btn, 'Saving…');
  try {
    if (!formEl.dataset.editUuid) throw new Error('No update identity found');
    // Route through the single merge-based save path (resets the dirty baseline
    // internally). Validation failure returns null; either way refresh the button.
    await saveUpdateForComponent(formEl, s => setButtonBusy(btn, s));
    formEl._refreshSaveState?.();
  } catch (e) {
    formEl._refreshSaveState?.();
    alert('Failed to save update: ' + e.message);
  }
});

registerFormAction('deleteSystemUpdate', async ({ formEl, content, cleanup }) => {
  if (!confirm('Delete this system update? This cannot be undone.')) return;
  const btn = content.querySelector('[data-action="deleteSystemUpdate"]');
  const originalText = btn?.textContent;
  if (btn) btn.disabled = true;
  try {
    const _uuid = formEl.dataset.editUuid;
    if (!_uuid) throw new Error('No update identity found');

    await githubFetchAndPushFile(UPDATES_FILE, s => { if (btn) btn.textContent = s; }, md => {
      return deleteUpdateFromMarkdown(md, _uuid);
    });
    await chrome.storage.local.remove('moreButtonsEditSystemUpdate');
    await navigateBack();
  } catch (e) {
    await chrome.storage.local.remove('moreButtonsEditSystemUpdate');
    if (btn) { btn.textContent = originalText; btn.disabled = false; }
    alert('Failed to delete update: ' + e.message);
  }
});

// ── Draft form actions ────────────────────────────────────────────────────────

function readUpdateFormFields(formEl) {
  const title = formEl.querySelector('[name="updateTitle"]')?.value.trim() ?? '';
  const date = formEl.querySelector('[name="updateDate"]')?.value ?? '';
  const type = formEl.querySelector('[name="updateType"]:checked')?.value;
  const description = formEl.querySelector('[name="description"]')?.value.trim() ?? '';
  return { title, date, type, description };
}

registerFormAction('saveDraftSystemUpdate', async ({ formEl, content }) => {
  const btn = content.querySelector('[data-action="saveDraftSystemUpdate"]');
  const snap = snapshotButton(btn);
  if (btn) btn.disabled = true;
  try {
    const { title, date, type, description } = readUpdateFormFields(formEl);
    if (!title || !date || !type) { alert('Please fill in all required fields.'); restoreButton(btn, snap); return; }

    const update = { title, date, type, description, uuid: generateUUID() };
    await saveNewDraft(update, [], s => setButtonBusy(btn, s));

    await chrome.storage.local.remove('moreButtonsLogSystemUpdate');
    // Continue into the draft edit form to add components. Repoint this slot at
    // the list so Back returns there, not the blank log form.
    replaceCurrentOpener('openSystemUpdatesEntry');
    await getFormAction('openEditDraftSystemUpdate')({ uuid: update.uuid });
  } catch (e) {
    restoreButton(btn, snap);
    alert('Failed to save draft: ' + e.message);
  }
});

registerFormAction('openEditDraftSystemUpdate', async ({ uuid }) => {
  let draftsMarkdown = '';
  try {
    // Backfill + persist missing component UUIDs first (see openEditSystemUpdate).
    draftsMarkdown = await fetchFileMigratingIdentity(DRAFTS_FILE);
  } catch {
    alert('Failed to load drafts.');
    return;
  }
  const update = parseDraftBlocks(draftsMarkdown).find(u => u.uuid === uuid);
  if (!update) { alert('Draft not found.'); return; }

  const { description, components } = parseComponents(update.body ?? '', GUIDE_ADMONITION_TYPES_RE);
  const dateInfo = parseDateStr(update.date);
  const isoDate = dateInfo
    ? `${dateInfo.year}-${String(dateInfo.month).padStart(2,'0')}-${String(dateInfo.day).padStart(2,'0')}`
    : '';

  await chrome.storage.local.set({
    moreButtonsEditDraftSystemUpdate: {
      updateTitle: update.title,
      updateDate:  isoDate,
      updateType:  update.type,
      description,
    }
  });

  const { formEl: editFormEl } = await createForm('editDraftSystemUpdate');
  if (editFormEl) {
    mountUpdateComponentsEditor(editFormEl, { uuid, file: DRAFTS_FILE, kind: 'system-draft', components });
  }
});

registerFormAction('saveDraftEditSystemUpdate', async ({ formEl, content }) => {
  const btn = content.querySelector('[data-save-state]');
  setButtonBusy(btn, 'Saving…');
  try {
    if (!formEl.dataset.editUuid) throw new Error('No draft identity found');
    // Route through the single merge-based save path (resets the dirty baseline
    // internally). kind is read from the form dataset, so the draft file is used.
    await saveUpdateForComponent(formEl, s => setButtonBusy(btn, s));
    formEl._refreshSaveState?.();
  } catch (e) {
    formEl._refreshSaveState?.();
    alert('Failed to save draft: ' + e.message);
  }
});

registerFormAction('publishDraftSystemUpdate', async ({ formEl, content }) => {
  const btn = content.querySelector('[data-action="publishDraftSystemUpdate"]');
  const snap = snapshotButton(btn);
  if (btn) btn.disabled = true;
  try {
    const _uuid = formEl.dataset.editUuid;
    if (!_uuid) throw new Error('No draft identity found');

    const { title, date, type, description } = readUpdateFormFields(formEl);
    if (!title || !date || !type) { alert('Please fill in all required fields.'); restoreButton(btn, snap); return; }

    // Preserve the draft body's committed components; only the header + leading
    // description come from the form.
    const draftMd = await readRepoText(DRAFTS_FILE);
    const body = rebuildUpdateBody(draftMd, _uuid, description);
    await publishDraft(_uuid, { title, date, type, description: body }, [], s => setButtonBusy(btn, s));

    suppress(DRAFT_ENTITY, _uuid);
    await chrome.storage.local.remove('moreButtonsEditDraftSystemUpdate');
    await navigateBack();
  } catch (e) {
    await chrome.storage.local.remove('moreButtonsEditDraftSystemUpdate');
    restoreButton(btn, snap);
    alert('Failed to publish draft: ' + e.message);
  }
});

registerFormAction('deleteDraftSystemUpdate', async ({ formEl, content, cleanup }) => {
  if (!confirm('Delete this draft? This cannot be undone.')) return;
  const btn = content.querySelector('[data-action="deleteDraftSystemUpdate"]');
  const originalText = btn?.textContent;
  if (btn) btn.disabled = true;
  try {
    const _uuid = formEl.dataset.editUuid;
    if (!_uuid) throw new Error('No draft identity found');

    await deleteDraft(_uuid, s => { if (btn) btn.textContent = s; });
    suppress(DRAFT_ENTITY, _uuid);
    await chrome.storage.local.remove('moreButtonsEditDraftSystemUpdate');
    await navigateBack();
  } catch (e) {
    await chrome.storage.local.remove('moreButtonsEditDraftSystemUpdate');
    if (btn) { btn.textContent = originalText; btn.disabled = false; }
    alert('Failed to delete draft: ' + e.message);
  }
});
