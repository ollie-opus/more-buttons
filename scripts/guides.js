/**
 * guides.js — Orchestration for arbitrary-page guide editing.
 *
 *   Live file:  docs/pages/<name>.md
 *   Draft file: docs/drafts/<name>.md
 *
 * Workflow: user opens a guide → "No draft" → Create draft (clones live, with
 * UUIDs injected) → edit sections/admonitions on the draft → Publish (writes
 * draft to live, deletes draft) or Discard.
 *
 * Each save is one commit against the draft file (per-modal, via the existing
 * githubFetchAndPushFile pipeline). Publish is two operations through _opQueue.
 */

import { registerFormAction, getFormAction } from './formActions.js';
import { createForm, replaceCurrentOpener, setCrumbLabel, isFormReplay, navigateBack, confirmDiscardIfDirty } from './form.js';
import { readRepoText } from './repoClient.js';
import { githubFetchAndPushFile, githubDeleteFile } from './github.js';
import {
  ensureSectionUUIDs, parseSections, buildSectionTree,
  insertSectionUnderParent, moveSectionToParent, deleteSectionByUUID,
  replaceSectionByUUID, buildSection, readSectionDescription,
  locateSectionByUUID, hasH3Children, buildSectionUUIDSpan,
} from './sections.js';
import {
  ensureAdmonitionUUIDs, parseAdmonitions, buildAdmonition,
  generateUUID, replaceAdmonitionByUUID,
  deleteAdmonitionByUUID,
  splitTitleMeta, joinTitleMeta,
} from './admonitions.js';
import {
  captures, resetCaptureState, setExistingCaptures,
  parseExistingCaptures, updateCapturesList, resolveCaptures, pushCaptures,
  stripCaptureLines, buildCaptureLines,
} from './captures.js';
import { escapeHtml } from './cardRenderer.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const GUIDE_ADMONITION_TYPES_RE =
  /step|outline|note|abstract|info|tip|success|question|warning|failure|danger|bug|example|quote/;

const ADMONITION_TYPE_LABELS = {
  step: 'Step', outline: 'Outline', note: 'Note', abstract: 'Abstract',
  info: 'Info', tip: 'Tip', success: 'Success', question: 'Question',
  warning: 'Warning', failure: 'Failure', danger: 'Danger', bug: 'Bug',
  example: 'Example', quote: 'Quote',
};

const ADMONITION_TYPE_COLOURS = {
  step: 'step',
  outline: 'outline',
  note: 'blue',
  abstract: 'light-blue',
  info: 'cyan',
  tip: 'teal',
  success: 'green',
  question: 'light-green',
  warning: 'orange',
  failure: 'red',
  danger: 'bright-red',
  bug: 'pink',
  example: 'deep-purple',
  quote: 'grey',
};

// ── Module state ──────────────────────────────────────────────────────────────

/** @type {{livePath:string, draftPath:string}|null} */
let currentGuide = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function livePathFromNav(filePath) {
  return filePath.startsWith('docs/') ? filePath : 'docs/' + filePath;
}

function draftPathOf(livePath) {
  return livePath.replace(/^docs\/pages\//, 'docs/drafts/');
}

// Title from a path's filename, e.g., 'pages/adding-a-new-employee.md' → 'adding-a-new-employee'
function guideBaseName(livePath) {
  return livePath.split('/').pop().replace(/\.md$/, '');
}

// ── Entry form: open + re-render ──────────────────────────────────────────────

registerFormAction('openGuideEntry', async ({ filePath, label }) => {
  const livePath = livePathFromNav(filePath);
  const draftPath = draftPathOf(livePath);
  currentGuide = { livePath, draftPath };

  const { formEl } = await createForm('guideEntry');
  if (!formEl) return;
  formEl.dataset.livePath = livePath;
  formEl.dataset.draftPath = draftPath;
  if (label) formEl.dataset.guideLabel = label;

  // form.js moves `.more-buttons-form-actions` out of the <form> to keep it
  // below the scroll area; delegate from the parent (`content`) so clicks on
  // the moved action buttons still reach this handler.
  formEl.parentElement.addEventListener('click', e => onGuideEntryClick(e, formEl));
  await renderGuideEntryContent(formEl);
});

function onGuideEntryClick(e, formEl) {
  const guideAction = e.target.closest('[data-guide-action]');
  if (guideAction) {
    const action = guideAction.dataset.guideAction;
    if (action === 'create')   { createGuideDraft(formEl);   return; }
    if (action === 'publish')  { publishGuideDraft(formEl);  return; }
    if (action === 'discard')  { discardGuideDraft(formEl);  return; }
  }
  // Edit / create section clicks are dispatched via form actions below.
  const editSec = e.target.closest('[data-edit-guide-section]');
  if (editSec) {
    getFormAction('openEditGuideSection')?.({ uuid: editSec.dataset.editGuideSection });
    return;
  }
  const createSec = e.target.closest('[data-create-guide-section]');
  if (createSec) {
    getFormAction('openCreateGuideSection')?.({ parentUuid: createSec.dataset.createGuideSection });
    return;
  }
}

async function renderGuideEntryContent(formEl) {
  const titleEl = formEl.querySelector('[data-guide-title]');
  const contentEl = formEl.querySelector('[data-guide-content]');
  const actionsEl = formEl.parentElement?.querySelector('[data-guide-actions]');
  if (!contentEl || !actionsEl) return;

  if (titleEl) titleEl.textContent = formEl.dataset.guideLabel || guideBaseName(formEl.dataset.livePath);

  contentEl.innerHTML = `<p class="more-buttons-description">Loading draft…</p>`;
  actionsEl.innerHTML = '';

  let draftMarkdown = '';
  try {
    draftMarkdown = await readRepoText(formEl.dataset.draftPath);
  } catch {
    contentEl.innerHTML = `<p class="more-buttons-description">Failed to load draft.</p>`;
    return;
  }

  if (!draftMarkdown) {
    contentEl.innerHTML = `
      <p class="more-buttons-description">
        No draft yet. Creating a draft duplicates the live page to
        <code>${escapeHtml(formEl.dataset.draftPath)}</code>; the live page is
        left untouched until you publish.
      </p>`;
    actionsEl.innerHTML = `
      <button type="button" class="more-buttons-button" data-guide-action="create">Create draft</button>`;
    return;
  }

  // Draft exists — render the section tree.
  const { title } = buildSectionTree(draftMarkdown);
  const treeHtml = renderGuideSectionTree(draftMarkdown);
  contentEl.innerHTML = treeHtml;
  actionsEl.innerHTML = `
    <button type="button" class="more-buttons-button secondary" data-create-guide-section="${escapeHtml(title?.uuid ?? '')}">+ Add new section</button>
    <button type="button" class="more-buttons-button" data-guide-action="publish">Publish draft to live</button>
    <button type="button" class="more-buttons-button secondary" data-guide-action="discard">Discard draft</button>`;
}

function renderGuideSectionTree(markdown) {
  const { title } = buildSectionTree(markdown);
  if (!title) {
    return `<p class="more-buttons-description">Empty file — no sections found.</p>`;
  }
  const nodeLabel = (node) =>
    `<strong>${escapeHtml(node.label)}:</strong> ${escapeHtml(node.title)}`;
  const h3Html = (h3) => `
    <div class="mb-kb-node">
      <button class="mb-kb-node-row" type="button" data-edit-guide-section="${escapeHtml(h3.uuid ?? '')}">
        <span class="mb-kb-node-icon material-symbols-outlined">subject</span>
        ${nodeLabel(h3)}
      </button>
    </div>`;
  const h2Html = (h2) => {
    const children = h2.children ?? [];
    const childHtml = children.length
      ? `<div class="mb-kb-node-children">${children.map(h3Html).join('')}</div>`
      : '';
    return `
      <div class="mb-kb-node">
        <button class="mb-kb-node-row" type="button" data-edit-guide-section="${escapeHtml(h2.uuid ?? '')}">
          <span class="mb-kb-node-icon material-symbols-outlined">subject</span>
          ${nodeLabel(h2)}
        </button>
        ${childHtml}
      </div>`;
  };
  return `
    <div class="mb-kb-tree">
      <div class="mb-kb-node">
        <button class="mb-kb-node-row" type="button" data-edit-guide-section="${escapeHtml(title.uuid ?? '')}">
          <span class="mb-kb-node-icon material-symbols-outlined">subject</span>
          ${nodeLabel(title)}
        </button>
        <div class="mb-kb-node-children">${(title.children ?? []).map(h2Html).join('')}</div>
      </div>
    </div>`;
}

// ── Draft create / publish / discard ──────────────────────────────────────────

async function createGuideDraft(formEl) {
  if (!currentGuide) return;
  const btn = formEl.parentElement?.querySelector('[data-guide-action="create"]');
  const originalText = btn?.textContent;
  if (btn) btn.disabled = true;

  try {
    if (btn) btn.textContent = 'Fetching live page…';
    const liveMarkdown = await readRepoText(currentGuide.livePath);
    if (!liveMarkdown) {
      alert('Live page not found at ' + currentGuide.livePath);
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
      return;
    }

    const migrated = ensureAdmonitionUUIDs(
      ensureSectionUUIDs(liveMarkdown),
      GUIDE_ADMONITION_TYPES_RE,
    );

    await githubFetchAndPushFile(currentGuide.draftPath, s => { if (btn) btn.textContent = s; }, () => migrated);
    await renderGuideEntryContent(formEl);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    alert('Failed to create draft: ' + e.message);
  }
}

async function publishGuideDraft(formEl) {
  if (!currentGuide) return;
  if (!confirm('Publish this draft to live? This overwrites the live page.')) return;
  const btn = formEl.parentElement?.querySelector('[data-guide-action="publish"]');
  const originalText = btn?.textContent;
  if (btn) btn.disabled = true;

  try {
    if (btn) btn.textContent = 'Reading draft…';
    const draftMarkdown = await readRepoText(currentGuide.draftPath);
    if (!draftMarkdown) {
      alert('Draft not found at ' + currentGuide.draftPath);
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
      return;
    }
    await githubFetchAndPushFile(currentGuide.livePath, s => { if (btn) btn.textContent = s; }, () => draftMarkdown);
    if (btn) btn.textContent = 'Deleting draft…';
    await githubDeleteFile(currentGuide.draftPath, s => { if (btn) btn.textContent = s; });
    await renderGuideEntryContent(formEl);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    alert('Failed to publish draft: ' + e.message);
  }
}

async function discardGuideDraft(formEl) {
  if (!currentGuide) return;
  if (!confirm('Discard this draft? All in-progress edits will be lost.')) return;
  const btn = formEl.parentElement?.querySelector('[data-guide-action="discard"]');
  const originalText = btn?.textContent;
  if (btn) btn.disabled = true;

  try {
    await githubDeleteFile(currentGuide.draftPath, s => { if (btn) btn.textContent = s; });
    await renderGuideEntryContent(formEl);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    alert('Failed to discard draft: ' + e.message);
  }
}

// ── Section editor ────────────────────────────────────────────────────────────

function parentOptionsForSection(markdown, editingUuid /* null when creating */, editingLevel) {
  // Returns [{ value: uuid|'', label }] for the parent select. Empty value = Title.
  const all = parseSections(markdown);
  const title = all.find(s => s.level === 1);
  const h2s = all.filter(s => s.level === 2);
  const tree = buildSectionTree(markdown);

  // h3 candidates are excluded entirely (3-level cap).
  const candidates = [];
  if (title) candidates.push({ value: title.uuid, label: 'Title' });

  // Determine whether the *editing* section currently has h3 children.
  let editingHasH3Children = false;
  if (editingUuid) {
    editingHasH3Children = hasH3Children(markdown, editingUuid);
  }

  for (const h2 of h2s) {
    if (h2.uuid === editingUuid) continue; // can't be own parent
    // If we're an h2 with h3 children, demoting under another h2 would require
    // us to become h3 and our h3 children to become h4 — disallowed.
    if (editingLevel === 2 && editingHasH3Children) continue;
    const node = tree.sections.find(s => s.uuid === h2.uuid);
    candidates.push({ value: h2.uuid, label: node?.label ?? h2.title });
  }

  return candidates;
}

registerFormAction('openCreateGuideSection', async ({ parentUuid }) => {
  if (!currentGuide) return;
  const draftMarkdown = await readRepoText(currentGuide.draftPath);
  const parent = parentUuid ? locateSectionByUUID(draftMarkdown, parentUuid) : null;

  resetCaptureState();
  if (!isFormReplay()) {
    await chrome.storage.local.set({
      moreButtonsEditGuideSection: {
        sectionTitle: '',
        sectionDescription: '',
        sectionParent: parentUuid ?? '',
      },
    });
  }

  const { formEl } = await createForm('editGuideSection');
  if (!formEl) return;
  formEl.dataset.mode = 'create';
  formEl.dataset.parentUuid = parentUuid ?? '';
  formEl.dataset.editUuid = '';

  // Heading text.
  const heading = formEl.querySelector('[data-guide-section-heading]');
  if (heading) heading.textContent = 'Add section';

  // Hide Delete (lives in the moved form-actions) + admonitions list in create mode.
  formEl.parentElement?.querySelector('[data-delete-section-btn]')?.style.setProperty('display', 'none');
  formEl.querySelector('[data-admonitions-row]')?.style.setProperty('display', 'none');

  // Populate parent dropdown.
  populateParentDropdown(formEl, draftMarkdown, null /* editing uuid */, parent ? parent.level + 1 : 2);

  // Wire up admonition click delegation (still attach for future use — admonition list is hidden in create mode).
  formEl.addEventListener('click', onSectionEditorClick);
});

registerFormAction('openEditGuideSection', async ({ uuid }) => {
  if (!currentGuide) return;
  const draftMarkdown = await readRepoText(currentGuide.draftPath);
  const section = locateSectionByUUID(draftMarkdown, uuid);
  if (!section) { alert('Section not found.'); return; }

  const { descriptionMarkdown } = readSectionDescription(draftMarkdown, uuid);
  const { description, admonitions } = splitSectionBody(descriptionMarkdown);

  resetCaptureState();
  const { title } = buildSectionTree(draftMarkdown);
  const parentDefault = section.level === 1
    ? ''
    : (section.level === 2 ? (title?.uuid ?? '') : findH2ParentUuid(draftMarkdown, uuid));

  if (!isFormReplay()) {
    await chrome.storage.local.set({
      moreButtonsEditGuideSection: {
        sectionTitle: section.title,
        sectionDescription: description,
        sectionParent: parentDefault,
      },
    });
  }

  const { formEl } = await createForm('editGuideSection');
  if (!formEl) return;
  formEl.dataset.mode = 'edit';
  formEl.dataset.editUuid = uuid;
  formEl.dataset.editLevel = String(section.level);

  // Heading + visible controls based on level.
  const treeMatch = buildSectionTree(draftMarkdown).sections.find(s => s.uuid === uuid);
  const heading = formEl.querySelector('[data-guide-section-heading]');
  if (heading) heading.textContent = treeMatch ? `Edit ${treeMatch.label.toLowerCase()}` : 'Edit section';
  // Breadcrumb shows the section's identity, e.g. "Section 1: Manager Steps".
  if (treeMatch?.visualLabel) setCrumbLabel(treeMatch.visualLabel);

  // Title sections: hide parent dropdown + Delete.
  if (section.level === 1) {
    formEl.querySelector('[data-section-parent-row]')?.style.setProperty('display', 'none');
    formEl.parentElement?.querySelector('[data-delete-section-btn]')?.style.setProperty('display', 'none');
  }

  populateParentDropdown(formEl, draftMarkdown, uuid, section.level);

  // Render admonition cards.
  renderSectionAdmonitionCards(formEl, admonitions, uuid);

  formEl.addEventListener('click', onSectionEditorClick);
});

function onSectionEditorClick(e) {
  const formEl = e.currentTarget;
  const editAdm = e.target.closest('[data-edit-guide-admonition]');
  if (editAdm) {
    if (!confirmDiscardIfDirty(formEl)) return;
    getFormAction('openEditGuideAdmonition')?.({ uuid: editAdm.dataset.editGuideAdmonition });
    return;
  }
  const insertZone = e.target.closest('[data-insert-at]');
  if (insertZone) {
    if (!confirmDiscardIfDirty(formEl)) return;
    const insertAtIndex = parseInt(insertZone.dataset.insertAt, 10);
    getFormAction('openCreateGuideAdmonition')?.({
      parentSectionUuid: formEl.dataset.editUuid,
      insertAtIndex,
    });
    return;
  }
}

function populateParentDropdown(formEl, draftMarkdown, editingUuid, editingLevel) {
  const select = formEl.querySelector('[data-section-parent-select]');
  if (!select) return;
  const options = parentOptionsForSection(draftMarkdown, editingUuid, editingLevel);
  const currentValue = select.value;
  select.innerHTML = options.map(o =>
    `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`
  ).join('');
  // Restore from storage (set in opener) — form.js's storage hydration runs
  // after createForm returns, so we read it back manually here once the
  // options are populated.
  const stored = currentValue || formEl.dataset.parentUuid || '';
  if (stored && options.some(o => o.value === stored)) {
    select.value = stored;
  }
}

function findH2ParentUuid(markdown, h3Uuid) {
  const all = parseSections(markdown);
  const target = all.find(s => s.uuid === h3Uuid);
  if (!target) return '';
  // Walk back to find the nearest h2 with headerLine < target.headerLine.
  for (let i = all.length - 1; i >= 0; i--) {
    const s = all[i];
    if (s.level === 2 && s.headerLine < target.headerLine) return s.uuid;
  }
  return '';
}

// ── Section body: split description from admonitions (and rebuild) ───────────

function splitSectionBody(descriptionMarkdown) {
  // Within a section's description text, sub-admonitions live at indent 0
  // (since section descriptions have no parent indent).
  // We extract immediate-child admonitions, with tab-aware parsing so that
  // admonitions inside `=== "Tab"` content blocks stay in the description.
  const admonitions = parseAdmonitions(descriptionMarkdown, GUIDE_ADMONITION_TYPES_RE, { skipTabBlocks: true })
    .filter(a => a.indent === '');

  if (admonitions.length === 0) {
    return { description: descriptionMarkdown.trim(), admonitions: [] };
  }

  // Build a "description-only" view by removing admonition blocks from the original.
  const lines = descriptionMarkdown.split('\n');
  const removedRanges = admonitions.map(a => ({ start: a.headerLine, end: a.endLine }));
  removedRanges.sort((x, y) => y.start - x.start); // descending
  let descLines = lines.slice();
  for (const { start, end } of removedRanges) {
    // Eat one trailing blank if present.
    let extEnd = end;
    if (descLines[extEnd] === '') extEnd++;
    descLines.splice(start, extEnd - start);
  }
  // Trim trailing blanks from description.
  while (descLines.length > 0 && descLines[descLines.length - 1] === '') descLines.pop();
  // Also trim leading blanks after a span line, etc.
  while (descLines.length > 0 && descLines[0] === '') descLines.shift();

  // Also strip capture image references from description — captures are
  // re-emitted into the immediate admonition body during rebuild, but a
  // section's "Description" textarea doesn't show captures (captures live
  // inside admonitions, not sections). For now, we leave any stray top-level
  // captures in place (they'd be markdown the user can edit directly).
  return { description: descLines.join('\n'), admonitions };
}

function rebuildSectionBody(descriptionText, admonitionsBlocks) {
  // descriptionText is raw markdown from the textarea; admonitionsBlocks is
  // an array of full admonition block strings (no outer indent).
  const parts = [];
  const desc = descriptionText.trim();
  if (desc.length) parts.push(desc);
  for (const block of admonitionsBlocks) {
    parts.push(block.trim());
  }
  return parts.join('\n\n');
}

// Step admonitions are auto-numbered per section (the count resets each section)
// on the published site. Returns the 1-indexed step number of `uuid` among the
// step admonitions immediately within its owning section, or null when `uuid`
// isn't a top-level section step (nested sub-admonition steps aren't numbered).
function sectionStepNumber(markdown, uuid) {
  for (const sec of parseSections(markdown)) {
    const { descriptionMarkdown } = readSectionDescription(markdown, sec.uuid);
    const { admonitions } = splitSectionBody(descriptionMarkdown);
    let n = 0;
    for (const a of admonitions) {
      if (a.type === 'step') n++;
      if (a.uuid === uuid) return a.type === 'step' ? n : null;
    }
  }
  return null;
}

function insertionZone(idx, label = 'Insert New Admonition') {
  return `<button type="button" class="mb-adm-insert" data-insert-at="${idx}" aria-label="${escapeHtml(label)}"><span class="mb-adm-insert__pill">+ ${escapeHtml(label)}</span></button>`;
}

function emptyAdmonitionCta(label) {
  return `<button type="button" class="mb-adm-empty" data-insert-at="0"><span class="mb-adm-empty__icon">+</span> ${escapeHtml(label)}</button>`;
}

function renderSectionAdmonitionCards(formEl, admonitions, _sectionUuid) {
  const container = formEl.querySelector('[data-section-admonitions]');
  if (!container) return;
  if (admonitions.length === 0) {
    container.innerHTML = emptyAdmonitionCta('Add admonition');
    return;
  }
  // Number step admonitions in document order (per-section sequence).
  let stepN = 0;
  const parts = [];
  admonitions.forEach((a, i) => {
    parts.push(insertionZone(i));
    const n = a.type === 'step' ? ++stepN : null;
    parts.push(admonitionCard(a, n));
  });
  parts.push(insertionZone(admonitions.length));
  container.innerHTML = parts.join('');
}

function admonitionCard(adm, stepNumber = null) {
  const colour = ADMONITION_TYPE_COLOURS[adm.type] ?? 'amber';
  const badge = ADMONITION_TYPE_LABELS[adm.type] ?? adm.type;
  const preview = (adm.body ?? '')
    .replace(/<span[^>]*data-uuid[^>]*><\/span>\n?/g, '')
    .replace(/!\[[^\]]*\]\([^)]+\)(\{[^}]+\})?/g, '')
    .replace(/\n+/g, ' ')
    .trim();
  const description = preview.length > 120 ? preview.slice(0, 120) + '…' : preview || null;
  // No explicit title → fall back to the type label (matches MkDocs's auto-title behavior).
  const { title: parsedTitle, meta } = splitTitleMeta(adm.title || '');
  const title = adm.type === 'step'
    ? (stepNumber != null ? `Step ${stepNumber}` : 'Step')
    : (parsedTitle || ADMONITION_TYPE_LABELS[adm.type] || adm.type);
  const btnAttr = adm.uuid
    ? `data-edit-guide-admonition="${escapeHtml(adm.uuid)}"`
    : `disabled title="No UUID"`;
  const btnLabel = adm.uuid ? 'Edit' : 'Error';
  return `
    <div class="mb-incident-card --${colour}">
      <div class="mb-incident-card__head">
        <strong class="mb-incident-card__title">${escapeHtml(title)}${meta ? `<span class="mb-incident-card__title-meta">${escapeHtml(meta)}</span>` : ''}</strong>
        <span class="mb-incident-card__badge">${escapeHtml(badge)}</span>
      </div>
      ${description ? `<p class="mb-incident-card__body">${escapeHtml(description)}</p>` : ''}
      <div class="mb-incident-card__foot --end">
        <button type="button" class="mb-incident-card__edit" ${btnAttr}>${btnLabel}</button>
      </div>
    </div>`;
}

// ── Submit / delete section ──────────────────────────────────────────────────

registerFormAction('submitEditGuideSection', async ({ formEl, content, cleanup }) => {
  if (!currentGuide) return;
  const btn = content.querySelector('[data-action="submitEditGuideSection"]');
  const originalText = btn?.textContent;
  if (btn) btn.disabled = true;
  try {
    const title = formEl.querySelector('[name="sectionTitle"]')?.value.trim() ?? '';
    const description = formEl.querySelector('[name="sectionDescription"]')?.value ?? '';
    const parentUuid = formEl.querySelector('[name="sectionParent"]')?.value ?? '';
    if (!title) { alert('Title is required.'); if (btn) btn.disabled = false; return; }

    const mode = formEl.dataset.mode;
    const editUuid = formEl.dataset.editUuid;

    if (mode === 'create') {
      // Determine level: parent.level + 1. Parent '' means Title (h1) → level 2.
      let level = 2;
      if (parentUuid) {
        const draftNow = await readRepoText(currentGuide.draftPath);
        const par = locateSectionByUUID(draftNow, parentUuid);
        if (par) level = Math.min(3, par.level + 1);
      }
      let newUuid;
      await githubFetchAndPushFile(currentGuide.draftPath, s => { if (btn) btn.textContent = s; }, md => {
        const result = insertSectionUnderParent(md, parentUuid || null, level, title, description.trim());
        newUuid = result.uuid;
        return result.markdown;
      });

      // Transition this modal into edit mode in-place (no overlay flash, no
      // second history entry). The form stays open; user can immediately add
      // admonitions or close out.
      formEl.dataset.mode = 'edit';
      formEl.dataset.editUuid = newUuid;
      formEl.dataset.editLevel = String(level);
      // The modal just became an edit-of-new-section in place; point its back
      // entry at the saved section so returning from a child lands here, not the
      // blank create form.
      replaceCurrentOpener(() => getFormAction('openEditGuideSection')({ uuid: newUuid }));
      formEl.parentElement?.querySelector('[data-delete-section-btn]')?.style.removeProperty('display');
      formEl.querySelector('[data-admonitions-row]')?.style.removeProperty('display');
      renderSectionAdmonitionCards(formEl, [], newUuid);
      // Refresh dropdown options against the latest draft.
      const refreshed = await readRepoText(currentGuide.draftPath);
      const newTreeMatch = buildSectionTree(refreshed).sections.find(s => s.uuid === newUuid);
      const heading = formEl.querySelector('[data-guide-section-heading]');
      if (heading) heading.textContent = newTreeMatch ? `Edit ${newTreeMatch.label.toLowerCase()}` : 'Edit section';
      if (newTreeMatch?.visualLabel) setCrumbLabel(newTreeMatch.visualLabel);
      populateParentDropdown(formEl, refreshed, newUuid, level);
      await chrome.storage.local.set({
        moreButtonsEditGuideSection: { sectionTitle: title, sectionDescription: description, sectionParent: parentUuid },
      });
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
      return;
    }

    // Edit mode: preserve existing admonitions; potentially move parent.
    const draftMarkdown = await readRepoText(currentGuide.draftPath);
    const section = locateSectionByUUID(draftMarkdown, editUuid);
    if (!section) { alert('Section no longer exists.'); cleanup(); return; }
    const { descriptionMarkdown } = readSectionDescription(draftMarkdown, editUuid);
    const { admonitions } = splitSectionBody(descriptionMarkdown);
    const admonitionBlocks = admonitions.map(a => buildAdmonition(a.prefix, a.type, a.title, a.body));
    const newBody = rebuildSectionBody(description, admonitionBlocks);

    // Determine whether parent changed (only for non-Title sections — Title
    // is the root and cannot be moved).
    const currentParentUuid = section.level === 2
      ? (buildSectionTree(draftMarkdown).title?.uuid ?? null)
      : (section.level === 3
          ? findH2ParentUuid(draftMarkdown, editUuid) || null
          : null);
    const requestedParent = parentUuid || null;
    const parentChanged = section.level !== 1 && (currentParentUuid ?? null) !== (requestedParent ?? null);

    await githubFetchAndPushFile(currentGuide.draftPath, s => { if (btn) btn.textContent = s; }, md => {
      // Replace section's owned content (header + UUID span + body).
      let updated = replaceSectionByUUID(md, editUuid, buildSection(section.level, title, editUuid, newBody));
      // If parent changed, re-locate and move (also re-levels heading prefix).
      if (parentChanged) {
        updated = moveSectionToParent(updated, editUuid, requestedParent);
      }
      return updated;
    });

    await chrome.storage.local.remove('moreButtonsEditGuideSection');
    cleanup();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    alert('Failed to save section: ' + e.message);
  }
});

registerFormAction('deleteGuideSection', async ({ formEl, content, cleanup }) => {
  if (!currentGuide) return;
  const editUuid = formEl.dataset.editUuid;
  if (!editUuid) return;
  const draftMarkdown = await readRepoText(currentGuide.draftPath);
  const section = locateSectionByUUID(draftMarkdown, editUuid);
  if (!section) { alert('Section not found.'); cleanup(); return; }

  const cascade = section.level === 2 && hasH3Children(draftMarkdown, editUuid);
  const msg = cascade
    ? 'Delete this section AND its subsections? This cannot be undone.'
    : 'Delete this section? This cannot be undone.';
  if (!confirm(msg)) return;

  const btn = content.querySelector('[data-action="deleteGuideSection"]');
  const originalText = btn?.textContent;
  if (btn) btn.disabled = true;
  try {
    await githubFetchAndPushFile(currentGuide.draftPath, s => { if (btn) btn.textContent = s; }, md => deleteSectionByUUID(md, editUuid, { cascade: true }));
    await chrome.storage.local.remove('moreButtonsEditGuideSection');
    cleanup();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    alert('Failed to delete section: ' + e.message);
  }
});

// ── Admonition editor ────────────────────────────────────────────────────────

/**
 * Locate an admonition by UUID throughout the entire draft markdown,
 * along with the section it belongs to (for refresh purposes).
 */
function locateGuideAdmonition(markdown, uuid) {
  // parseAdmonitions is non-recursive: nested admonitions are consumed as the
  // parent's body lines, so they never appear in its results. Recurse into each
  // block's body to find admonitions at any depth (e.g. sub-admonitions).
  const all = parseAdmonitions(markdown, GUIDE_ADMONITION_TYPES_RE);
  for (const a of all) {
    if (a.uuid === uuid) return a;
    const nested = locateGuideAdmonition(a.body, uuid);
    if (nested) return nested;
  }
  return null;
}

/**
 * Returns immediate child admonitions of a parent admonition body.
 */
function parseSubAdmonitions(parentBody) {
  return parseAdmonitions(parentBody, GUIDE_ADMONITION_TYPES_RE, { skipTabBlocks: true })
    .filter(a => a.indent === '');
}

function splitAdmonitionBody(adm) {
  // Returns { description, captures, subAdmonitions }
  const body = adm.body ?? '';
  const subs = parseSubAdmonitions(body);

  // Remove sub-admonition ranges from the body first, leaving only THIS
  // admonition's own content. Captures and description are then derived from
  // that — otherwise captures nested inside sub-admonitions would surface in
  // (and on save, be hoisted up into) the parent.
  const lines = body.split('\n');
  const removed = subs.map(a => ({ start: a.headerLine, end: a.endLine }));
  removed.sort((a, b) => b.start - a.start);
  let descLines = lines.slice();
  for (const { start, end } of removed) {
    let extEnd = end;
    if (descLines[extEnd] === '') extEnd++;
    descLines.splice(start, extEnd - start);
  }
  const ownBody = descLines.join('\n');

  const captures = parseExistingCaptures(ownBody);

  let desc = ownBody;
  // Remove UUID span line.
  desc = desc.replace(/<span[^>]*data-uuid[^>]*><\/span>\n?/g, '');
  // Remove capture image lines.
  desc = stripCaptureLines(desc);
  desc = desc.trim();

  return { description: desc, captures, subAdmonitions: subs };
}

function rebuildAdmonitionBody(uuid, description, captures, subAdmonitionBlocks) {
  // Canonical admonition body shape (matching the existing system-updates
  // pattern via injectAdmonitionUUID + buildAdmonition):
  //   <span data-uuid="…"></span>
  //   description line 1
  //   description line 2
  //
  //   ![](capture#light)...
  //   ![](capture#dark)...
  //
  //   !!! note "Sub-admonition"
  //       …
  //
  // No blank between the span and the first description line; one blank
  // before each capture and each sub-admonition.
  const lines = [buildSectionUUIDSpan(uuid)];
  const desc = (description ?? '').trim();
  if (desc.length) {
    lines.push(desc);
  }
  const captureLines = buildCaptureLines(captures);
  if (captureLines.length) {
    lines.push(...captureLines);
  }
  for (const block of subAdmonitionBlocks) {
    lines.push('');
    lines.push(block.trim());
  }
  return lines.join('\n');
}

registerFormAction('openCreateGuideAdmonition', async ({ parentSectionUuid, parentAdmonitionUuid, insertAtIndex }) => {
  if (!currentGuide) return;
  resetCaptureState();
  if (!isFormReplay()) {
    await chrome.storage.local.set({
      moreButtonsEditGuideAdmonition: {
        admonitionTitle: '',
        admonitionMeta: '',
        admonitionType: 'step',
        admonitionDescription: '',
      },
    });
  }

  const { formEl } = await createForm('editGuideAdmonition');
  if (!formEl) return;
  formEl.dataset.mode = 'create';
  formEl.dataset.parentSectionUuid = parentSectionUuid ?? '';
  formEl.dataset.parentAdmonitionUuid = parentAdmonitionUuid ?? '';
  formEl.dataset.insertAtIndex = insertAtIndex == null ? '' : String(insertAtIndex);
  formEl.dataset.editUuid = '';

  const heading = formEl.querySelector('[data-guide-admonition-heading]');
  if (heading) heading.textContent = 'Add admonition';

  // Hide Delete (lives in the moved form-actions) + sub-admonitions list in create mode.
  formEl.parentElement?.querySelector('[data-delete-admonition-btn]')?.style.setProperty('display', 'none');
  formEl.querySelector('[data-sub-admonitions-row]')?.style.setProperty('display', 'none');

  formEl.addEventListener('click', onAdmonitionEditorClick);
  wireAdmonitionTypeToggle(formEl, 'step');

  updateCapturesList(formEl, 'guide-admonition-captures');
});

registerFormAction('openEditGuideAdmonition', async ({ uuid }) => {
  if (!currentGuide) return;
  const draftMarkdown = await readRepoText(currentGuide.draftPath);
  const adm = locateGuideAdmonition(draftMarkdown, uuid);
  if (!adm) { alert('Admonition not found.'); return; }

  const { description, captures, subAdmonitions } = splitAdmonitionBody(adm);
  const { title: admTitle, meta: admMeta } = splitTitleMeta(adm.title);

  resetCaptureState();
  setExistingCaptures(captures);

  if (!isFormReplay()) {
    await chrome.storage.local.set({
      moreButtonsEditGuideAdmonition: {
        admonitionTitle: admTitle,
        admonitionMeta: admMeta,
        admonitionType: adm.type,
        admonitionDescription: description,
      },
    });
  }

  const { formEl } = await createForm('editGuideAdmonition');
  if (!formEl) return;
  formEl.dataset.mode = 'edit';
  formEl.dataset.editUuid = uuid;

  const heading = formEl.querySelector('[data-guide-admonition-heading]');
  if (heading) heading.textContent = `Edit admonition`;

  // Breadcrumb: "Step N" for top-level steps (+ any meta note), else "Type: Title".
  let crumb;
  if (adm.type === 'step') {
    const n = sectionStepNumber(draftMarkdown, uuid);
    crumb = n != null ? `Step ${n}` : 'Step';
    if (admMeta) crumb += ` ${admMeta}`;
  } else {
    const typeLabel = ADMONITION_TYPE_LABELS[adm.type] ?? adm.type;
    crumb = admTitle ? `${typeLabel}: ${admTitle}` : typeLabel;
  }
  setCrumbLabel(crumb);

  formEl.addEventListener('click', onAdmonitionEditorClick);
  wireAdmonitionTypeToggle(formEl, adm.type);

  renderSubAdmonitionCards(formEl, subAdmonitions);
  updateCapturesList(formEl, 'guide-admonition-captures');
});

function onAdmonitionEditorClick(e) {
  const formEl = e.currentTarget;
  const editAdm = e.target.closest('[data-edit-guide-admonition]');
  if (editAdm) {
    if (!confirmDiscardIfDirty(formEl)) return;
    getFormAction('openEditGuideAdmonition')?.({ uuid: editAdm.dataset.editGuideAdmonition });
    return;
  }
  const insertZone = e.target.closest('[data-insert-at]');
  if (insertZone) {
    if (!confirmDiscardIfDirty(formEl)) return;
    const insertAtIndex = parseInt(insertZone.dataset.insertAt, 10);
    getFormAction('openCreateGuideAdmonition')?.({
      parentAdmonitionUuid: formEl.dataset.editUuid,
      insertAtIndex,
    });
    return;
  }
}

// Step admonitions are auto-titled by the docs theme (any title is ignored), so
// disable + clear the Title input while Step is selected. Meta stays editable —
// steps may still carry a trailing meta note, e.g. "(optional)".
function applyAdmonitionTypeState(formEl, type) {
  const titleInput = formEl.querySelector('[name="admonitionTitle"]');
  if (!titleInput) return;
  const isStep = type === 'step';
  titleInput.disabled = isStep;
  if (isStep) titleInput.value = '';
}

function wireAdmonitionTypeToggle(formEl, initialType) {
  formEl.addEventListener('change', e => {
    if (e.target.name === 'admonitionType') applyAdmonitionTypeState(formEl, e.target.value);
  });
  applyAdmonitionTypeState(formEl, initialType);
}

function renderSubAdmonitionCards(formEl, subAdmonitions) {
  const container = formEl.querySelector('[data-sub-admonitions]');
  if (!container) return;
  if (subAdmonitions.length === 0) {
    container.innerHTML = emptyAdmonitionCta('Add sub-admonition');
    return;
  }
  const parts = [];
  subAdmonitions.forEach((a, i) => {
    parts.push(insertionZone(i, 'Insert New Sub-admonition'));
    parts.push(admonitionCard(a));
  });
  parts.push(insertionZone(subAdmonitions.length, 'Insert New Sub-admonition'));
  container.innerHTML = parts.join('');
}

registerFormAction('submitEditGuideAdmonition', async ({ formEl, content, cleanup }) => {
  if (!currentGuide) return;
  const btn = content.querySelector('[data-action="submitEditGuideAdmonition"]');
  const originalText = btn?.textContent;
  if (btn) btn.disabled = true;
  try {
    const type = formEl.querySelector('[name="admonitionType"]:checked')?.value;
    // Step admonitions are auto-titled — ignore any title for them.
    const titleField = type === 'step' ? '' : (formEl.querySelector('[name="admonitionTitle"]')?.value.trim() ?? '');
    const metaField = formEl.querySelector('[name="admonitionMeta"]')?.value.trim() ?? '';
    const title = joinTitleMeta(titleField, metaField);
    const description = formEl.querySelector('[name="admonitionDescription"]')?.value ?? '';
    if (!type) { alert('Type is required.'); if (btn) btn.disabled = false; return; }

    const mode = formEl.dataset.mode;
    const editUuid = formEl.dataset.editUuid;
    const resolved = resolveCaptures([...captures]);
    await pushCaptures(resolved, s => { if (btn) btn.textContent = s; });

    if (mode === 'create') {
      const newUuid = generateUUID();
      const prefix = '!!!';
      const body = rebuildAdmonitionBody(newUuid, description, resolved, []);
      const newBlock = buildAdmonition(prefix, type, title, body);
      const parentSectionUuid = formEl.dataset.parentSectionUuid;
      const parentAdmonitionUuid = formEl.dataset.parentAdmonitionUuid;
      const insertAtRaw = formEl.dataset.insertAtIndex;
      const insertAt = insertAtRaw === '' || insertAtRaw == null ? null : parseInt(insertAtRaw, 10);
      const spliceInto = (arr) => {
        if (insertAt != null && insertAt >= 0 && insertAt <= arr.length) arr.splice(insertAt, 0, newBlock);
        else arr.push(newBlock);
      };

      await githubFetchAndPushFile(currentGuide.draftPath, s => { if (btn) btn.textContent = s; }, md => {
        if (parentAdmonitionUuid) {
          const parent = locateGuideAdmonition(md, parentAdmonitionUuid);
          if (!parent) return md;
          const { description: pDesc, captures: pCaps, subAdmonitions: pSubs } = splitAdmonitionBody(parent);
          const subBlocks = pSubs.map(a => buildAdmonition(a.prefix, a.type, a.title, a.body));
          spliceInto(subBlocks);
          const pBody = rebuildAdmonitionBody(parentAdmonitionUuid, pDesc, pCaps, subBlocks);
          const rebuiltParent = buildAdmonition(parent.prefix, parent.type, parent.title, pBody);
          return replaceAdmonitionByUUID(md, parentAdmonitionUuid, rebuiltParent);
        }
        // Insert into a section: rebuild the section with the new block spliced.
        const sec = locateSectionByUUID(md, parentSectionUuid);
        if (!sec) return md;
        const { descriptionMarkdown } = readSectionDescription(md, parentSectionUuid);
        const { description: desc, admonitions } = splitSectionBody(descriptionMarkdown);
        const existingBlocks = admonitions.map(a => buildAdmonition(a.prefix, a.type, a.title, a.body));
        spliceInto(existingBlocks);
        const newBody = rebuildSectionBody(desc, existingBlocks);
        return replaceSectionByUUID(md, parentSectionUuid, buildSection(sec.level, sec.title, parentSectionUuid, newBody));
      });
      await chrome.storage.local.remove('moreButtonsEditGuideAdmonition');
      await navigateBack();
      return;
    }

    // Edit mode: preserve existing sub-admonitions.
    const draftMarkdown = await readRepoText(currentGuide.draftPath);
    const adm = locateGuideAdmonition(draftMarkdown, editUuid);
    if (!adm) { alert('Admonition no longer exists.'); cleanup(); return; }
    const { subAdmonitions } = splitAdmonitionBody(adm);
    const subBlocks = subAdmonitions.map(a => buildAdmonition(a.prefix, a.type, a.title, a.body));

    await githubFetchAndPushFile(currentGuide.draftPath, s => { if (btn) btn.textContent = s; }, md => {
      const cur = locateGuideAdmonition(md, editUuid);
      if (!cur) return md;
      const body = rebuildAdmonitionBody(editUuid, description, resolved, subBlocks);
      const newBlock = buildAdmonition(cur.prefix, type, title, body);
      return replaceAdmonitionByUUID(md, editUuid, newBlock);
    });

    await chrome.storage.local.remove('moreButtonsEditGuideAdmonition');
    await navigateBack();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    alert('Failed to save admonition: ' + e.message);
  }
});

registerFormAction('deleteGuideAdmonition', async ({ formEl, content, cleanup }) => {
  if (!currentGuide) return;
  const editUuid = formEl.dataset.editUuid;
  if (!editUuid) return;
  if (!confirm('Delete this admonition? This also removes any sub-admonitions inside it.')) return;
  const btn = content.querySelector('[data-action="deleteGuideAdmonition"]');
  const originalText = btn?.textContent;
  if (btn) btn.disabled = true;
  try {
    await githubFetchAndPushFile(currentGuide.draftPath, s => { if (btn) btn.textContent = s; }, md => deleteAdmonitionByUUID(md, editUuid));
    await chrome.storage.local.remove('moreButtonsEditGuideAdmonition');
    await navigateBack();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    alert('Failed to delete admonition: ' + e.message);
  }
});
