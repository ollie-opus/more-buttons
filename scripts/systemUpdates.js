import { registerFormAction } from './formActions.js';
import { githubFetchAndPushFile } from './github.js';
import { readRepoText } from './repoClient.js';
import { suppress, reconcile, filterSuppressed } from './staleSuppression.js';
import { createForm, navigateBack, isFormReplay } from './form.js';
import { renderCard } from './cardRenderer.js';
import { parseAdmonitions, buildAdmonition, generateUUID, injectAdmonitionUUID, replaceAdmonitionByUUID, deleteAdmonitionByUUID, splitTitleMeta, joinTitleMeta } from './admonitions.js';
import {
  captures, resetCaptureState, setExistingCaptures,
  parseExistingCaptures, updateCapturesList, resolveCaptures, pushCaptures,
} from './captures.js';

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
  panel.innerHTML = `<p class="more-buttons-description">Loading drafts...</p>`;
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
  resetCaptureState();
  // On a genuine fresh open, discard any half-finished entry that was saved to
  // storage during an earlier capture-mode handoff, so the form starts blank.
  // Skip during a capture-mode replay, when we WANT those in-flight values back.
  if (!isFormReplay()) {
    await chrome.storage.local.remove('moreButtonsLogSystemUpdate');
  }
  const { formEl: logFormEl } = await createForm('logSystemUpdate');
  if (!logFormEl) return;
  // Default the (now-empty) date field to today.
  const dateInput = logFormEl.querySelector('[name="updateDate"]');
  if (dateInput && !dateInput.value) dateInput.value = todayIsoDate();
  updateCapturesList(logFormEl);
});

registerFormAction('submitLogSystemUpdate', async ({ formEl, content, cleanup }) => {
  const btn = content.querySelector('[data-action="submitLogSystemUpdate"]');
  const originalText = btn.textContent;
  btn.disabled = true;
  try {
    const title = formEl.querySelector('[name="updateTitle"]')?.value.trim() ?? '';
    const date = formEl.querySelector('[name="updateDate"]')?.value ?? '';
    const type = formEl.querySelector('[name="updateType"]:checked')?.value;
    const description = formEl.querySelector('[name="description"]')?.value.trim() ?? '';
    if (!title || !date || !type) { alert('Please fill in all required fields.'); btn.disabled = false; return; }

    const update = { title, date, type, description };
    const resolved = resolveCaptures([...captures]);
    await publishNewUpdate(update, resolved, s => { btn.textContent = s; });

    resetCaptureState();
    await navigateBack();
  } catch (e) {
    btn.textContent = originalText;
    btn.disabled = false;
    alert('Failed to publish update: ' + e.message);
  }
});

registerFormAction('openEditSystemUpdate', async ({ uuid }) => {
  const markdown = await readRepoText(UPDATES_FILE);
  const updates = parseUpdateBlocks(markdown);
  const update = updates.find(u => u.uuid === uuid);
  if (!update) { alert('Entry not found.'); return; }

  resetCaptureState();
  setExistingCaptures(parseExistingCaptures(update.body ?? ''));

  const dateInfo = parseDateStr(update.date);
  const isoDate = dateInfo
    ? `${dateInfo.year}-${String(dateInfo.month).padStart(2,'0')}-${String(dateInfo.day).padStart(2,'0')}`
    : '';

  await chrome.storage.local.set({
    moreButtonsEditSystemUpdate: {
      updateTitle: update.title,
      updateDate:  isoDate,
      updateType:  update.type,
      description: (update.body ?? '')
        .replace(/<span[^>]*data-uuid[^>]*><\/span>\n?/g, '')
        .replace(/\n?\s*!\[\]\(\.\.\/assets\/[^)]+#only-(light|dark)\)\{[^}]*\}/g, '')
        .trim(),
    }
  });

  const { formEl: editFormEl } = await createForm('editSystemUpdate');
  if (editFormEl) {
    editFormEl.dataset.editUuid = update.uuid;
    updateCapturesList(editFormEl);
  }
});

registerFormAction('submitEditSystemUpdate', async ({ formEl, content, cleanup }) => {
  const btn = content.querySelector('[data-action="submitEditSystemUpdate"]');
  const originalText = btn.textContent;
  btn.disabled = true;
  try {
    const _uuid = formEl.dataset.editUuid;
    if (!_uuid) throw new Error('No update identity found');

    const title = formEl.querySelector('[name="updateTitle"]')?.value.trim() ?? '';
    const date = formEl.querySelector('[name="updateDate"]')?.value ?? '';
    const type = formEl.querySelector('[name="updateType"]:checked')?.value;
    const description = formEl.querySelector('[name="description"]')?.value.trim() ?? '';
    if (!title || !date || !type) { alert('Please fill in all required fields.'); btn.disabled = false; return; }

    const update = { title, date, type, description, uuid: _uuid };
    const resolved = resolveCaptures([...captures]);
    await pushCaptures(resolved, s => { btn.textContent = s; });
    await githubFetchAndPushFile(UPDATES_FILE, s => { btn.textContent = s; }, md => {
      return replaceUpdateInMarkdown(md, _uuid, update, resolved);
    });

    await chrome.storage.local.remove('moreButtonsEditSystemUpdate');
    resetCaptureState();
    await navigateBack();
  } catch (e) {
    await chrome.storage.local.remove('moreButtonsEditSystemUpdate');
    btn.textContent = originalText;
    btn.disabled = false;
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

registerFormAction('saveDraftSystemUpdate', async ({ formEl, content, cleanup }) => {
  const btn = content.querySelector('[data-action="saveDraftSystemUpdate"]');
  const originalText = btn.textContent;
  btn.disabled = true;
  try {
    const { title, date, type, description } = readUpdateFormFields(formEl);
    if (!title || !date || !type) { alert('Please fill in all required fields.'); btn.disabled = false; return; }

    const update = { title, date, type, description };
    const resolved = resolveCaptures([...captures]);
    await saveNewDraft(update, resolved, s => { btn.textContent = s; });

    resetCaptureState();
    await navigateBack();
  } catch (e) {
    btn.textContent = originalText;
    btn.disabled = false;
    alert('Failed to save draft: ' + e.message);
  }
});

registerFormAction('openEditDraftSystemUpdate', async ({ uuid }) => {
  let draftsMarkdown = '';
  try {
    draftsMarkdown = await readRepoText(DRAFTS_FILE);
  } catch {
    alert('Failed to load drafts.');
    return;
  }
  const drafts = parseDraftBlocks(draftsMarkdown);
  const update = drafts.find(u => u.uuid === uuid);
  if (!update) { alert('Draft not found.'); return; }

  resetCaptureState();
  setExistingCaptures(parseExistingCaptures(update.body ?? ''));

  const dateInfo = parseDateStr(update.date);
  const isoDate = dateInfo
    ? `${dateInfo.year}-${String(dateInfo.month).padStart(2,'0')}-${String(dateInfo.day).padStart(2,'0')}`
    : '';

  await chrome.storage.local.set({
    moreButtonsEditDraftSystemUpdate: {
      updateTitle: update.title,
      updateDate:  isoDate,
      updateType:  update.type,
      description: (update.body ?? '')
        .replace(/<span[^>]*data-uuid[^>]*><\/span>\n?/g, '')
        .replace(/\n?\s*!\[\]\(\.\.\/assets\/[^)]+#only-(light|dark)\)\{[^}]*\}/g, '')
        .trim(),
    }
  });

  const { formEl: editFormEl } = await createForm('editDraftSystemUpdate');
  if (editFormEl) {
    editFormEl.dataset.editUuid = update.uuid;
    updateCapturesList(editFormEl);
  }
});

registerFormAction('saveDraftEditSystemUpdate', async ({ formEl, content, cleanup }) => {
  const btn = content.querySelector('[data-action="saveDraftEditSystemUpdate"]');
  const originalText = btn.textContent;
  btn.disabled = true;
  try {
    const _uuid = formEl.dataset.editUuid;
    if (!_uuid) throw new Error('No draft identity found');

    const { title, date, type, description } = readUpdateFormFields(formEl);
    if (!title || !date || !type) { alert('Please fill in all required fields.'); btn.disabled = false; return; }

    const update = { title, date, type, description, uuid: _uuid };
    const resolved = resolveCaptures([...captures]);
    await saveExistingDraft(_uuid, update, resolved, s => { btn.textContent = s; });

    await chrome.storage.local.remove('moreButtonsEditDraftSystemUpdate');
    resetCaptureState();
    await navigateBack();
  } catch (e) {
    await chrome.storage.local.remove('moreButtonsEditDraftSystemUpdate');
    btn.textContent = originalText;
    btn.disabled = false;
    alert('Failed to save draft: ' + e.message);
  }
});

registerFormAction('publishDraftSystemUpdate', async ({ formEl, content, cleanup }) => {
  const btn = content.querySelector('[data-action="publishDraftSystemUpdate"]');
  const originalText = btn.textContent;
  btn.disabled = true;
  try {
    const _uuid = formEl.dataset.editUuid;
    if (!_uuid) throw new Error('No draft identity found');

    const { title, date, type, description } = readUpdateFormFields(formEl);
    if (!title || !date || !type) { alert('Please fill in all required fields.'); btn.disabled = false; return; }

    const update = { title, date, type, description };
    const resolved = resolveCaptures([...captures]);
    await publishDraft(_uuid, update, resolved, s => { btn.textContent = s; });

    suppress(DRAFT_ENTITY, _uuid);
    await chrome.storage.local.remove('moreButtonsEditDraftSystemUpdate');
    resetCaptureState();
    await navigateBack();
  } catch (e) {
    await chrome.storage.local.remove('moreButtonsEditDraftSystemUpdate');
    btn.textContent = originalText;
    btn.disabled = false;
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
