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
import { createForm, replaceCurrentOpener, setCrumbLabel, isFormReplay, navigateBack, isFormDirty, resetDirtyBaseline, setButtonBusy, snapshotButton, restoreButton } from './form.js';
import { mergeSave } from './mergeSave.js';
import { readRepoText, assetCdnUrl } from './repoClient.js';
import { githubFetchAndPushFile, githubDeleteFile } from './github.js';
import { parseNavBlock, replaceNavBlock, insertPath, removeByValue, findPathOfValue, slugify } from './navToml.js';
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
import { runComponentCaptureFlow, runComponentLibraryInsert } from './captures.js';
import { escapeHtml, captureComponentCard } from './cardRenderer.js';
import { parseComponents, buildComponentBody, ensureCaptureUUIDs, uuidOfComponent, reorderComponents } from './components.js';
import { registerComponentContainer, getComponentContainer } from './componentContainers.js';
import { openInsertMenu } from './insertMenu.js';

// ── Constants ─────────────────────────────────────────────────────────────────

export const GUIDE_ADMONITION_TYPES_RE =
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

// Nav leaf value for the current guide, e.g. 'pages/foo.md' (drops leading docs/).
function navValueOf(livePath) {
  return livePath.replace(/^docs\//, '');
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
    if (action === 'delete')   { deleteGuide(formEl);        return; }
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
      <button type="button" class="more-buttons-button" data-guide-action="create"><span class="more-buttons-icon">add</span>Create draft</button>
      <button type="button" class="more-buttons-button danger" data-guide-action="delete"><span class="more-buttons-icon">delete</span>Delete guide</button>`;
    return;
  }

  // Draft exists — render the section tree.
  const { title } = buildSectionTree(draftMarkdown);
  const treeHtml = renderGuideSectionTree(draftMarkdown);
  contentEl.innerHTML = treeHtml;
  actionsEl.innerHTML = `
    <button type="button" class="more-buttons-button secondary" data-create-guide-section="${escapeHtml(title?.uuid ?? '')}"><span class="more-buttons-icon">add</span>Add new section</button>
    <button type="button" class="more-buttons-button publish" data-guide-action="publish"><span class="more-buttons-icon">verified</span>Publish draft to live</button>
    <button type="button" class="more-buttons-button danger" data-guide-action="discard"><span class="more-buttons-icon">delete</span>Discard draft</button>`;
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

    const migrated = ensureCaptureUUIDs(
      ensureAdmonitionUUIDs(
        ensureSectionUUIDs(liveMarkdown),
        GUIDE_ADMONITION_TYPES_RE,
      ),
    );

    await githubFetchAndPushFile(currentGuide.draftPath, s => { if (btn) btn.textContent = s; }, () => migrated);
    // Mirror the page's nav location into draft_nav so it shows a Drafting pill.
    if (btn) btn.textContent = 'Updating navigation…';
    const value = navValueOf(currentGuide.livePath);
    await githubFetchAndPushFile('zensical.toml', s => { if (btn) btn.textContent = s; }, md => {
      const navItems = parseNavBlock(md, 'nav').items;
      const draftItems = parseNavBlock(md, 'draft_nav').items;
      removeByValue(draftItems, value);
      const loc = findPathOfValue(navItems, value);
      insertPath(draftItems, loc?.segments ?? [], loc?.leafName ?? guideBaseName(currentGuide.livePath), value);
      return replaceNavBlock(md, 'draft_nav', draftItems);
    });
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
  const snap = snapshotButton(btn);
  if (btn) btn.disabled = true;

  try {
    setButtonBusy(btn, 'Reading draft…');
    const draftMarkdown = await readRepoText(currentGuide.draftPath);
    if (!draftMarkdown) {
      alert('Draft not found at ' + currentGuide.draftPath);
      restoreButton(btn, snap);
      return;
    }
    await githubFetchAndPushFile(currentGuide.livePath, s => setButtonBusy(btn, s), () => draftMarkdown);
    setButtonBusy(btn, 'Deleting draft…');
    await githubDeleteFile(currentGuide.draftPath, s => setButtonBusy(btn, s));
    // Promote into nav (mirroring its draft_nav location) and drop from draft_nav.
    setButtonBusy(btn, 'Updating navigation…');
    const value = navValueOf(currentGuide.livePath);
    await githubFetchAndPushFile('zensical.toml', s => setButtonBusy(btn, s), md => {
      const navItems = parseNavBlock(md, 'nav').items;
      const draftItems = parseNavBlock(md, 'draft_nav').items;
      const loc = findPathOfValue(draftItems, value);
      if (!findPathOfValue(navItems, value)) {
        insertPath(navItems, loc?.segments ?? [], loc?.leafName ?? guideBaseName(currentGuide.livePath), value);
      }
      removeByValue(draftItems, value);
      let out = replaceNavBlock(md, 'nav', navItems);
      out = replaceNavBlock(out, 'draft_nav', draftItems);
      return out;
    });
    await renderGuideEntryContent(formEl);
  } catch (e) {
    restoreButton(btn, snap);
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
    if (btn) btn.textContent = 'Updating navigation…';
    const value = navValueOf(currentGuide.livePath);
    await githubFetchAndPushFile('zensical.toml', s => { if (btn) btn.textContent = s; }, md => {
      const draftItems = parseNavBlock(md, 'draft_nav').items;
      removeByValue(draftItems, value);
      return replaceNavBlock(md, 'draft_nav', draftItems);
    });
    await renderGuideEntryContent(formEl);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    alert('Failed to discard draft: ' + e.message);
  }
}

// Permanently delete a guide: removes the live .md from GitHub and drops it from
// both nav and draft_nav. Only offered from the no-draft entry view, so there is
// normally no draft file — we still delete it defensively (a no-op on 404) so a
// stale draft can't linger. Returns to the (refreshed) KB list on success.
async function deleteGuide(formEl) {
  if (!currentGuide) return;
  const label = formEl.dataset.guideLabel || guideBaseName(formEl.dataset.livePath);
  if (!confirm(`Delete the guide "${label}"?\n\nThis permanently removes the live page from GitHub and from the navigation. This cannot be undone.`)) return;
  const btn = formEl.parentElement?.querySelector('[data-guide-action="delete"]');
  const originalText = btn?.textContent;
  if (btn) btn.disabled = true;

  try {
    if (btn) btn.textContent = 'Deleting page…';
    await githubDeleteFile(currentGuide.livePath, s => { if (btn) btn.textContent = s; });
    await githubDeleteFile(currentGuide.draftPath, s => { if (btn) btn.textContent = s; });
    if (btn) btn.textContent = 'Updating navigation…';
    const value = navValueOf(currentGuide.livePath);
    await githubFetchAndPushFile('zensical.toml', s => { if (btn) btn.textContent = s; }, md => {
      const navItems = parseNavBlock(md, 'nav').items;
      const draftItems = parseNavBlock(md, 'draft_nav').items;
      removeByValue(navItems, value);
      removeByValue(draftItems, value);
      let out = replaceNavBlock(md, 'nav', navItems);
      out = replaceNavBlock(out, 'draft_nav', draftItems);
      return out;
    });
    currentGuide = null;
    await navigateBack();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    alert('Failed to delete guide: ' + e.message);
  }
}

// ── Create a brand-new guide ────────────────────────────────────────────────

registerFormAction('openCreateGuide', async () => {
  if (!isFormReplay()) {
    await chrome.storage.local.set({
      moreButtonsCreateGuide: { guideTitle: '', guidePath: '' },
    });
  }
  const { formEl } = await createForm('createGuide');
  if (!formEl) return;

  const suffix = formEl.querySelector('[data-path-suffix]');
  const titleInput = formEl.querySelector('[name="guideTitle"]');
  const renderSuffix = () => {
    const slug = slugify(titleInput?.value ?? '');
    if (suffix) suffix.textContent = slug ? `/${slug}.md` : '/…md';
  };
  formEl.addEventListener('input', e => {
    if (e.target.name === 'guideTitle') renderSuffix();
  });
  renderSuffix();
});

registerFormAction('submitCreateGuide', async ({ formEl, content }) => {
  const btn = content.querySelector('[data-action="submitCreateGuide"]');
  const originalText = btn?.textContent;
  const title = formEl.querySelector('[name="guideTitle"]')?.value.trim() ?? '';
  const pathRaw = formEl.querySelector('[name="guidePath"]')?.value ?? '';
  const slug = slugify(title);
  if (!slug) { alert('Please enter a title.'); return; }

  const segments = pathRaw.split('/').map(s => s.trim()).filter(Boolean);
  const value = `pages/${slug}.md`;
  const draftPath = `docs/drafts/${slug}.md`;

  let draftWritten = false;
  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
  try {
    // Conflict check: a flat-by-slug file may already be live (in nav) or a draft.
    const tomlText = await readRepoText('zensical.toml');
    const nav = parseNavBlock(tomlText, 'nav').items;
    const liveValues = new Set();
    (function collect(nodes) {
      for (const n of nodes) { if (n.children) collect(n.children); else liveValues.add(n.value); }
    })(nav);
    if (liveValues.has(value)) {
      alert(`A live page with the name "${slug}.md" already exists.`);
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
      return;
    }
    const existingDraft = await readRepoText(draftPath);
    if (existingDraft) {
      alert(`A draft named "${slug}.md" already exists. Choose a different title.`);
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
      return;
    }

    // Write the draft file (H1 = title, UUID span injected so the tree renders).
    if (btn) btn.textContent = 'Creating draft…';
    await githubFetchAndPushFile(draftPath, s => { if (btn) btn.textContent = s; },
      () => ensureSectionUUIDs(`# ${title}\n`));
    draftWritten = true;

    // Add to draft_nav.
    if (btn) btn.textContent = 'Updating navigation…';
    await githubFetchAndPushFile('zensical.toml', s => { if (btn) btn.textContent = s; }, md => {
      const items = parseNavBlock(md, 'draft_nav').items;
      insertPath(items, segments, title, value);
      return replaceNavBlock(md, 'draft_nav', items);
    });

    await chrome.storage.local.remove('moreButtonsCreateGuide');
    // Behave like an open draft from here on.
    await getFormAction('openGuideEntry')({ filePath: value, label: title });
  } catch (e) {
    if (draftWritten) {
      // Roll back the orphaned draft file so the user isn't blocked from
      // retrying (a draft file with no draft_nav entry is invisible + unrecoverable).
      try { await githubDeleteFile(draftPath, () => {}); } catch { /* best-effort */ }
    }
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    alert('Failed to create guide: ' + e.message);
  }
});

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
  formEl.dataset.componentContainerKind = 'guide-section';
  formEl.dataset.containerFile = currentGuide.draftPath;

  // Heading text.
  const heading = formEl.querySelector('[data-guide-section-heading]');
  if (heading) heading.textContent = 'Add section';

  // Hide Delete (lives in the moved form-actions) in create mode.
  formEl.parentElement?.querySelector('[data-delete-section-btn]')?.style.setProperty('display', 'none');
  // Components are visible in create mode now; adding one routes through the
  // save-gate, which persists the section first.
  renderComponents(formEl.querySelector('[data-section-components]'), []);
  formEl._componentSaver = () => saveSectionForComponent(formEl);

  // Populate parent dropdown.
  populateParentDropdown(formEl, draftMarkdown, null /* editing uuid */, parent ? parent.level + 1 : 2);

  formEl.addEventListener('click', onComponentEditorClick);
});

registerFormAction('openEditGuideSection', async ({ uuid }) => {
  if (!currentGuide) return;
  const draftMarkdown = await readRepoText(currentGuide.draftPath);
  const section = locateSectionByUUID(draftMarkdown, uuid);
  if (!section) { alert('Section not found.'); return; }

  const { descriptionMarkdown } = readSectionDescription(draftMarkdown, uuid);
  const { description, components } = parseComponents(descriptionMarkdown, GUIDE_ADMONITION_TYPES_RE);

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
  formEl.dataset.componentContainerKind = 'guide-section';
  formEl.dataset.containerFile = currentGuide.draftPath;
  formEl._componentSaver = () => saveSectionForComponent(formEl);

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

  // Render the unified component list (admonitions + captures, in order).
  const listEl = formEl.querySelector('[data-section-components]');
  renderComponents(listEl, components);
  openComponentEditor = { formEl, listEl, container: { kind: 'guide-section', uuid, file: currentGuide.draftPath }, components };
  attachReorderState(formEl);

  formEl.addEventListener('click', onComponentEditorClick);
});

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

// ── Component containers (sections & admonitions) ────────────────────────────
//
// A "container" is { kind: 'guide-section' | 'guide-admonition', uuid }. Its
// body holds an ordered list of components (admonitions + captures). In the
// immediate-save model, captures are committed to the markdown like admonitions,
// so the body itself is the source of truth for component order.

function readSectionComponents(md, uuid) {
  const { descriptionMarkdown } = readSectionDescription(md, uuid);
  return parseComponents(descriptionMarkdown, GUIDE_ADMONITION_TYPES_RE);
}
function writeSectionBody(md, uuid, description, components) {
  const sec = locateSectionByUUID(md, uuid);
  if (!sec) return md;
  const body = buildComponentBody(null, description, components);
  return replaceSectionByUUID(md, uuid, buildSection(sec.level, sec.title, uuid, body));
}
function readAdmonitionComponents(md, uuid) {
  const adm = locateGuideAdmonition(md, uuid);
  return parseComponents(adm ? adm.body : '', GUIDE_ADMONITION_TYPES_RE);
}
function writeAdmonitionBody(md, uuid, description, components) {
  const adm = locateGuideAdmonition(md, uuid);
  if (!adm) return md;
  const body = buildComponentBody(uuid, description, components);
  return replaceAdmonitionByUUID(md, uuid, buildAdmonition(adm.prefix, adm.type, adm.title, body));
}

// Generic accessors dispatch through the componentContainers registry by kind,
// so non-guide containers (e.g. system updates) plug in their own read/write
// without guides.js importing them (which would cycle).
function readContainerComponents(md, container) {
  return getComponentContainer(container.kind).readComponents(md, container.uuid);
}
function writeContainerBody(md, container, description, components) {
  return getComponentContainer(container.kind).writeBody(md, container.uuid, description, components);
}

// The currently-open component editor (section / admonition / system-update
// form), tracked so an immediate-commit capture or admonition insert can
// re-render its list in place. `container` carries { kind, uuid, file }.
let openComponentEditor = null;
export function setOpenComponentEditor(ed) { openComponentEditor = ed; }

// Post-merge / post-arrow re-render of the open editor in a given UUID order.
// Exported so non-guide hosts (system updates) reuse the exact same re-render.
export function reorderOpenComponentEditor(order) {
  const ed = openComponentEditor;
  if (!ed) return;
  ed.components = reorderComponents(ed.components, order);
  renderComponents(ed.listEl, ed.components, ed.container.kind === 'guide-section');
}

// Wires the form's mergeSave reorder-rehydrate hook to the shared re-render.
function attachReorderState(formEl) {
  formEl._reorderRehydrate = (order) => reorderOpenComponentEditor(order);
}

// In-memory reorder: swap a component with its neighbour in the open editor's
// working list, re-render, and mark the form dirty. Order is BATCH — it is not
// committed here; it rides the parent form's next save through the merge engine.
function moveComponentInEditor(formEl, uuid, dir) {
  const ed = openComponentEditor;
  if (!ed || ed.formEl !== formEl || !Array.isArray(ed.components)) return;
  const i = ed.components.findIndex(c => uuidOfComponent(c) === uuid);
  if (i < 0) return;
  const j = dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= ed.components.length) return;
  const next = ed.components.slice();
  [next[i], next[j]] = [next[j], next[i]];
  ed.components = next;
  renderComponents(ed.listEl, next, ed.container.kind === 'guide-section');
  formEl._refreshSaveState?.(); // programmatic field change doesn't fire input/change
}

async function rerenderOpenComponentEditor() {
  const ed = openComponentEditor;
  if (!ed?.formEl?.isConnected) return;
  const md = await readRepoText(ed.container.file);
  const { components } = readContainerComponents(md, ed.container);
  ed.components = components;
  renderComponents(ed.listEl, components, ed.container.kind === 'guide-section');
}

// Builds a file-aware container handler for the registry. `mutate(container, …)`
// reads the container's file, transforms its ordered component list, writes it
// back as one commit, then re-renders the open editor. Exported so
// systemUpdates.js can register its own kinds with the same machinery.
export function makeContainerHandler(readComponents, writeBody) {
  return {
    readComponents,
    writeBody,
    mutate: async (container, transform, onProgress) => {
      await githubFetchAndPushFile(container.file, onProgress || (() => {}), md => {
        const { description, components } = readComponents(md, container.uuid);
        const next = transform(components, description) || components;
        return writeBody(md, container.uuid, description, next);
      });
      await rerenderOpenComponentEditor();
    },
  };
}
registerComponentContainer('guide-section', makeContainerHandler(readSectionComponents, writeSectionBody));
registerComponentContainer('guide-admonition', makeContainerHandler(readAdmonitionComponents, writeAdmonitionBody));

// Step admonitions are auto-numbered per section (the count resets each section)
// on the published site. Returns the 1-indexed step number of `uuid` among the
// step admonitions immediately within its owning section, or null when `uuid`
// isn't a top-level section step (nested sub-admonition steps aren't numbered).
// Capture components do not affect the count.
function sectionStepNumber(markdown, uuid) {
  for (const sec of parseSections(markdown)) {
    const { descriptionMarkdown } = readSectionDescription(markdown, sec.uuid);
    const { components } = parseComponents(descriptionMarkdown, GUIDE_ADMONITION_TYPES_RE);
    let n = 0;
    for (const c of components) {
      if (c.kind !== 'admonition') continue;
      if (c.adm.type === 'step') n++;
      if (c.adm.uuid === uuid) return c.adm.type === 'step' ? n : null;
    }
  }
  return null;
}

// ── Component list rendering ─────────────────────────────────────────────────

function insertComponentTrigger(idx) {
  return `<div class="mb-insert-component" data-insert-component-at="${idx}"><button type="button" class="mb-insert-component__btn">+ Insert Component</button></div>`;
}

function captureComponentCardFor(cap) {
  return captureComponentCard({
    thumbSrc: assetCdnUrl('docs/assets/' + cap.lightFilename),
    btnAttr: `data-edit-component="${escapeHtml(cap.uuid ?? '')}"`,
  });
}

// Renders an ordered component list (admonitions + captures) interleaved with
// "+ Insert Component" triggers. Step admonitions are numbered in document order
// when `numberSteps` is set (section level only — sub-admonition steps aren't
// numbered, matching the published site). Captures never affect numbering.
export function renderComponents(listEl, components, numberSteps = true) {
  if (!listEl) return;
  // Keep the form's hidden order field in lockstep with what's rendered.
  const orderField = listEl.closest('form')?.querySelector('[name="componentOrder"]');
  if (orderField) orderField.value = components.map(uuidOfComponent).join(',');

  if (components.length === 0) {
    listEl.innerHTML = `<button type="button" class="mb-insert-component__empty" data-insert-component-at="0"><span class="mb-adm-empty__icon">+</span> Insert Component</button>`;
    return;
  }
  const parts = [];
  let stepN = 0;
  const last = components.length - 1;
  components.forEach((c, i) => {
    parts.push(insertComponentTrigger(i));
    let card;
    if (c.kind === 'admonition') {
      const n = (numberSteps && c.adm.type === 'step') ? ++stepN : null;
      card = admonitionCard(c.adm, n);
    } else {
      card = captureComponentCardFor(c.cap);
    }
    parts.push(componentRow(uuidOfComponent(c), i === 0, i === last, card));
  });
  parts.push(insertComponentTrigger(components.length));
  listEl.innerHTML = parts.join('');
}

// Wraps a component card with a vertical up/down reorder rail on its left edge.
function componentRow(uuid, isFirst, isLast, cardHtml) {
  return `
    <div class="mb-component-row" data-component-uuid="${escapeHtml(uuid)}">
      <div class="mb-component-rail">
        <button type="button" class="mb-component-rail__btn" data-move-component="up" ${isFirst ? 'disabled' : ''} aria-label="Move up">↑</button>
        <button type="button" class="mb-component-rail__btn" data-move-component="down" ${isLast ? 'disabled' : ''} aria-label="Move down">↓</button>
      </div>
      ${cardHtml}
    </div>`;
}

// ── The component save-gate ──────────────────────────────────────────────────
//
// Every child-component navigation (insert a new component, or open an existing
// one for edit) goes through beginChildNavigation. If the parent form is unsaved
// (create mode) or has unsaved field edits (dirty), it confirms and persists via
// the form's attached `_componentSaver()` before running the child flow. Savers
// return { container, formEl } — formEl may differ if saving navigated to a new
// form (e.g. log-update → draft editor).

const CONTAINER_NOUN = {
  'guide-section': 'section',
  'guide-admonition': 'admonition',
  'system-update': 'update',
  'system-draft': 'draft',
};

function componentNoun(formEl) {
  return formEl.dataset.componentNoun || CONTAINER_NOUN[formEl.dataset.componentContainerKind] || 'item';
}

// The saved container identity carried on a form (valid only once saved).
function containerFromForm(formEl) {
  return {
    kind: formEl.dataset.componentContainerKind,
    uuid: formEl.dataset.editUuid,
    file: formEl.dataset.containerFile || currentGuide?.draftPath,
  };
}

// Ensure the form's container is persisted before navigating to a child.
// Returns { container, formEl } or null (user cancelled / validation failed).
async function ensureContainerReady(formEl) {
  const needsSave = formEl.dataset.mode === 'create' || isFormDirty(formEl);
  if (!needsSave) return { container: containerFromForm(formEl), formEl };
  const noun = componentNoun(formEl);
  const msg = formEl.dataset.mode === 'create'
    ? `This ${noun} hasn’t been saved yet. Save it to continue?`
    : `You have unsaved changes. Save them to continue?`;
  if (!confirm(msg)) return null;
  const saver = formEl._componentSaver;
  if (typeof saver !== 'function') { console.warn('[MB] form has no _componentSaver'); return null; }
  return await saver();
}

async function beginChildNavigation(formEl, action) {
  const ready = await ensureContainerReady(formEl);
  if (!ready) return;
  await runChildAction(ready.container, ready.formEl, action);
}

async function runChildAction(container, formEl, action) {
  const overlay = formEl.closest('.more-buttons-overlay');
  if (action.type === 'insert') {
    if (action.kind === 'admonition') getFormAction('openCreateGuideAdmonition')?.({ container, insertAtIndex: action.insertAt });
    else if (action.kind === 'capture-new') runComponentCaptureFlow({ container, insertAt: action.insertAt, formEl, overlay });
    else if (action.kind === 'capture-library') runComponentLibraryInsert({ container, insertAt: action.insertAt });
  } else if (action.type === 'edit-admonition') {
    getFormAction('openEditGuideAdmonition')?.({ uuid: action.uuid, file: container.file });
  } else if (action.type === 'edit-capture') {
    openCaptureComponentEditor(container, action.uuid);
  }
}

// Shared click delegation for every component editor (section / admonition /
// system-update). Routes all child navigation through the save-gate.
export function onComponentEditorClick(e) {
  const formEl = e.currentTarget;

  const moveBtn = e.target.closest('[data-move-component]');
  if (moveBtn) {
    if (moveBtn.disabled) return;
    const row = moveBtn.closest('[data-component-uuid]');
    moveComponentInEditor(formEl, row?.dataset.componentUuid, moveBtn.dataset.moveComponent);
    return;
  }

  const editAdm = e.target.closest('[data-edit-guide-admonition]');
  if (editAdm) {
    beginChildNavigation(formEl, { type: 'edit-admonition', uuid: editAdm.dataset.editGuideAdmonition });
    return;
  }

  const editCap = e.target.closest('[data-edit-component]');
  if (editCap) {
    beginChildNavigation(formEl, { type: 'edit-capture', uuid: editCap.dataset.editComponent });
    return;
  }

  const insert = e.target.closest('[data-insert-component-at]');
  if (insert) {
    const idx = parseInt(insert.dataset.insertComponentAt, 10);
    const anchor = insert.querySelector('.mb-insert-component__btn') || insert;
    openInsertMenu(anchor, idx, {
      admonition: (i) => beginChildNavigation(formEl, { type: 'insert', kind: 'admonition', insertAt: i }),
      captureNew: (i) => beginChildNavigation(formEl, { type: 'insert', kind: 'capture-new', insertAt: i }),
      captureLibrary: (i) => beginChildNavigation(formEl, { type: 'insert', kind: 'capture-library', insertAt: i }),
    });
    return;
  }
}

async function openCaptureComponentEditor(container, uuid) {
  const md = await readRepoText(container.file);
  const { components } = readContainerComponents(md, container);
  const c = components.find(x => x.kind === 'capture' && x.cap.uuid === uuid);
  if (!c) return;
  getFormAction('openEditCaptureComponent')?.({ container, uuid, cap: c.cap });
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

// Flip an in-place section create form into an edit-of-new-section form: point
// its history slot at the saved section, reveal Delete + Components, render the
// (empty) component list, refresh heading/crumb/parent dropdown, and re-baseline
// the dirty guard. Shared by the Save button and the component save-gate.
async function transitionSectionCreateToEdit(formEl, newUuid, level, title, description, parentUuid) {
  formEl.dataset.mode = 'edit';
  formEl.dataset.editUuid = newUuid;
  formEl.dataset.editLevel = String(level);
  replaceCurrentOpener('openEditGuideSection', { uuid: newUuid });
  formEl.parentElement?.querySelector('[data-delete-section-btn]')?.style.removeProperty('display');
  formEl.querySelector('[data-components-row]')?.style.removeProperty('display');
  const listEl = formEl.querySelector('[data-section-components]');
  renderComponents(listEl, []);
  setOpenComponentEditor({ formEl, listEl, container: { kind: 'guide-section', uuid: newUuid, file: currentGuide.draftPath }, components: [] });
  attachReorderState(formEl);
  const refreshed = await readRepoText(currentGuide.draftPath);
  const newTreeMatch = buildSectionTree(refreshed).sections.find(s => s.uuid === newUuid);
  const heading = formEl.querySelector('[data-guide-section-heading]');
  if (heading) heading.textContent = newTreeMatch ? `Edit ${newTreeMatch.label.toLowerCase()}` : 'Edit section';
  if (newTreeMatch?.visualLabel) setCrumbLabel(newTreeMatch.visualLabel);
  populateParentDropdown(formEl, refreshed, newUuid, level);
  await chrome.storage.local.set({
    moreButtonsEditGuideSection: { sectionTitle: title, sectionDescription: description, sectionParent: parentUuid },
  });
  resetDirtyBaseline(formEl);
}

// Persist the section form. create → insert + transition-in-place; dirty edit →
// rewrite body (+ optional parent move) + rebaseline. Returns { container,
// formEl } or null (validation failed). Used by the Save button and the gate.
async function saveSectionForComponent(formEl, onProgress = () => {}) {
  const title = formEl.querySelector('[name="sectionTitle"]')?.value.trim() ?? '';
  const description = formEl.querySelector('[name="sectionDescription"]')?.value ?? '';
  const parentUuid = formEl.querySelector('[name="sectionParent"]')?.value ?? '';
  if (!title) { alert('Title is required.'); return null; }

  if (formEl.dataset.mode === 'create') {
    let level = 2;
    if (parentUuid) {
      const draftNow = await readRepoText(currentGuide.draftPath);
      const par = locateSectionByUUID(draftNow, parentUuid);
      if (par) level = Math.min(3, par.level + 1);
    }
    let newUuid;
    await githubFetchAndPushFile(currentGuide.draftPath, onProgress, md => {
      const result = insertSectionUnderParent(md, parentUuid || null, level, title, description.trim());
      newUuid = result.uuid;
      return result.markdown;
    });
    await transitionSectionCreateToEdit(formEl, newUuid, level, title, description, parentUuid);
    return { container: { kind: 'guide-section', uuid: newUuid, file: currentGuide.draftPath }, formEl };
  }

  const editUuid = formEl.dataset.editUuid;
  const draftMarkdown = await readRepoText(currentGuide.draftPath);
  const section = locateSectionByUUID(draftMarkdown, editUuid);
  if (!section) { alert('This section was deleted in another session — your changes can’t be saved.'); return null; }
  const currentParentUuid = section.level === 2
    ? (buildSectionTree(draftMarkdown).title?.uuid ?? null)
    : (section.level === 3 ? findH2ParentUuid(draftMarkdown, editUuid) || null : null);
  const requestedParent = parentUuid || null;
  const parentChanged = section.level !== 1 && (currentParentUuid ?? null) !== (requestedParent ?? null);

  await mergeSave({
    formEl,
    file: currentGuide.draftPath,
    onProgress,
    fieldSpecs: [
      { name: 'sectionTitle', type: 'scalar', label: 'Title' },
      { name: 'sectionDescription', type: 'scalar', label: 'Description' },
    ],
    readFresh: md => {
      const sec = locateSectionByUUID(md, editUuid);
      return {
        sectionTitle: sec?.title ?? '',
        sectionDescription: parseComponents(readSectionDescription(md, editUuid).descriptionMarkdown ?? '', GUIDE_ADMONITION_TYPES_RE).description ?? '',
      };
    },
    build: (md, resolved) => {
      const sec = locateSectionByUUID(md, editUuid);
      if (!sec) throw new Error('Section no longer exists.');
      const { components } = readContainerComponents(md, { kind: 'guide-section', uuid: editUuid });
      const newBody = buildComponentBody(null, (resolved.sectionDescription ?? '').trim(), components);
      let updated = replaceSectionByUUID(md, editUuid, buildSection(sec.level, (resolved.sectionTitle ?? '').trim(), editUuid, newBody));
      if (parentChanged) updated = moveSectionToParent(updated, editUuid, requestedParent);
      return updated;
    },
  });
  return { container: { kind: 'guide-section', uuid: editUuid, file: currentGuide.draftPath }, formEl };
}

registerFormAction('submitEditGuideSection', async ({ formEl, content }) => {
  if (!currentGuide) return;
  const btn = content.querySelector('[data-save-state]');
  setButtonBusy(btn, 'Saving…');
  try {
    const result = await saveSectionForComponent(formEl, s => setButtonBusy(btn, s));
    // Validation failed → re-render the button to its live state and bail.
    if (!result) { formEl._refreshSaveState?.(); return; }
    // Saved in place (create→edit transition or in-place edit): stay open so the
    // save-state button can report "Draft saved" (green).
    formEl._refreshSaveState?.();
  } catch (e) {
    formEl._refreshSaveState?.();
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
    await navigateBack();
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

// Collapsible control value ⇄ admonition prefix.
//   static    → !!!   (always open)
//   collapsed → ???   (collapsible, closed by default)
//   expanded  → ???+  (collapsible, open by default)
const COLLAPSIBLE_TO_PREFIX = { static: '!!!', collapsed: '???', expanded: '???+' };
function collapsibleToPrefix(value) { return COLLAPSIBLE_TO_PREFIX[value] ?? '!!!'; }
function prefixToCollapsible(prefix) {
  if (prefix === '???+') return 'expanded';
  if (prefix === '???') return 'collapsed';
  return 'static';
}

registerFormAction('openCreateGuideAdmonition', async ({ container, insertAtIndex }) => {
  if (!container?.file) return;
  if (!isFormReplay()) {
    await chrome.storage.local.set({
      moreButtonsEditGuideAdmonition: {
        admonitionTitle: '',
        admonitionMeta: '',
        admonitionType: 'step',
        admonitionDescription: '',
        admonitionCollapsible: 'static',
      },
    });
  }

  const { formEl } = await createForm('editGuideAdmonition');
  if (!formEl) return;
  formEl.dataset.mode = 'create';
  // Parent container this admonition will be spliced into (kind/uuid/file).
  formEl.dataset.parentKind = container.kind;
  formEl.dataset.parentUuid = container.uuid;
  formEl.dataset.parentFile = container.file;
  formEl.dataset.insertAtIndex = insertAtIndex == null ? '' : String(insertAtIndex);
  formEl.dataset.editUuid = '';

  const heading = formEl.querySelector('[data-guide-admonition-heading]');
  if (heading) heading.textContent = 'Add admonition';

  // Hide Delete (lives in the moved form-actions); it only applies once the
  // admonition itself exists.
  formEl.parentElement?.querySelector('[data-delete-admonition-btn]')?.style.setProperty('display', 'none');
  // Components visible in create mode; adding one routes through the save-gate,
  // which splices this admonition into its parent and flips to edit in place.
  formEl.dataset.componentContainerKind = 'guide-admonition';
  renderComponents(formEl.querySelector('[data-admonition-components]'), [], false);
  formEl._componentSaver = () => saveAdmonitionForComponent(formEl);

  formEl.addEventListener('click', onComponentEditorClick);
  wireAdmonitionTypeToggle(formEl, 'step');
});

registerFormAction('openEditGuideAdmonition', async ({ uuid, file }) => {
  const containerFile = file || currentGuide?.draftPath;
  if (!containerFile) return;
  const draftMarkdown = await readRepoText(containerFile);
  const adm = locateGuideAdmonition(draftMarkdown, uuid);
  if (!adm) { alert('Admonition not found.'); return; }

  const { description, components } = parseComponents(adm.body, GUIDE_ADMONITION_TYPES_RE);
  const { title: admTitle, meta: admMeta } = splitTitleMeta(adm.title);

  if (!isFormReplay()) {
    await chrome.storage.local.set({
      moreButtonsEditGuideAdmonition: {
        admonitionTitle: admTitle,
        admonitionMeta: admMeta,
        admonitionType: adm.type,
        admonitionDescription: description,
        admonitionCollapsible: prefixToCollapsible(adm.prefix),
      },
    });
  }

  const { formEl } = await createForm('editGuideAdmonition');
  if (!formEl) return;
  formEl.dataset.mode = 'edit';
  formEl.dataset.editUuid = uuid;
  formEl.dataset.componentContainerKind = 'guide-admonition';
  formEl.dataset.containerFile = containerFile;
  formEl._componentSaver = () => saveAdmonitionForComponent(formEl);

  const heading = formEl.querySelector('[data-guide-admonition-heading]');
  if (heading) heading.textContent = `Edit admonition`;

  // Breadcrumb: "Step N" for top-level steps (+ any meta note), else "Type: Title".
  // Step numbering is a guide-section concept; outside a guide draft (e.g. an
  // admonition inside a system update) there are no numbered steps.
  const inGuideDraft = !!currentGuide && containerFile === currentGuide.draftPath;
  let crumb;
  if (adm.type === 'step') {
    const n = inGuideDraft ? sectionStepNumber(draftMarkdown, uuid) : null;
    crumb = n != null ? `Step ${n}` : 'Step';
    if (admMeta) crumb += ` ${admMeta}`;
  } else {
    const typeLabel = ADMONITION_TYPE_LABELS[adm.type] ?? adm.type;
    crumb = admTitle ? `${typeLabel}: ${admTitle}` : typeLabel;
  }
  setCrumbLabel(crumb);

  formEl.addEventListener('click', onComponentEditorClick);
  wireAdmonitionTypeToggle(formEl, adm.type);

  // Render the unified component list (sub-admonitions + captures, in order).
  // Sub-admonition steps aren't numbered (matches the published site + breadcrumb).
  const listEl = formEl.querySelector('[data-admonition-components]');
  renderComponents(listEl, components, false);
  openComponentEditor = { formEl, listEl, container: { kind: 'guide-admonition', uuid, file: containerFile }, components };
  attachReorderState(formEl);
});

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

// Read the admonition form's header fields into a normalized shape.
function readAdmonitionFields(formEl) {
  const type = formEl.querySelector('[name="admonitionType"]:checked')?.value;
  const titleField = type === 'step' ? '' : (formEl.querySelector('[name="admonitionTitle"]')?.value.trim() ?? '');
  const metaField = formEl.querySelector('[name="admonitionMeta"]')?.value.trim() ?? '';
  const title = joinTitleMeta(titleField, metaField);
  const description = formEl.querySelector('[name="admonitionDescription"]')?.value ?? '';
  const collapsible = formEl.querySelector('[name="admonitionCollapsible"]:checked')?.value ?? 'static';
  return { type, title, description, prefix: collapsibleToPrefix(collapsible) };
}

// Build the new admonition and splice it into its parent container at the chosen
// index. Returns { newUuid, file } or null (validation failed).
async function persistNewAdmonition(formEl, onProgress = () => {}) {
  const { type, title, description, prefix } = readAdmonitionFields(formEl);
  if (!type) { alert('Type is required.'); return null; }
  const newUuid = generateUUID();
  const newAdm = { prefix, type, title, body: buildComponentBody(newUuid, description, []) };
  const container = {
    kind: formEl.dataset.parentKind,
    uuid: formEl.dataset.parentUuid,
    file: formEl.dataset.parentFile,
  };
  const insertAtRaw = formEl.dataset.insertAtIndex;
  const insertAt = insertAtRaw === '' || insertAtRaw == null ? null : parseInt(insertAtRaw, 10);
  await githubFetchAndPushFile(container.file, onProgress, md => {
    const { description: pDesc, components } = readContainerComponents(md, container);
    const idx = (insertAt != null && insertAt >= 0 && insertAt <= components.length) ? insertAt : components.length;
    const next = components.slice();
    next.splice(idx, 0, { kind: 'admonition', adm: newAdm });
    return writeContainerBody(md, container, pDesc, next);
  });
  return { newUuid, file: container.file };
}

// Rewrite an existing admonition's header + description, preserving its
// committed sub-components.
async function persistAdmonitionEdit(formEl, onProgress = () => {}) {
  const { type, title, description, prefix } = readAdmonitionFields(formEl);
  if (!type) { alert('Type is required.'); return null; }
  const editUuid = formEl.dataset.editUuid;
  const file = formEl.dataset.containerFile || currentGuide?.draftPath;
  const draftMarkdown = await readRepoText(file);
  if (!locateGuideAdmonition(draftMarkdown, editUuid)) { alert('Admonition no longer exists.'); return null; }
  await githubFetchAndPushFile(file, onProgress, md => {
    if (!locateGuideAdmonition(md, editUuid)) return md;
    const { components } = readContainerComponents(md, { kind: 'guide-admonition', uuid: editUuid });
    const body = buildComponentBody(editUuid, description, components);
    return replaceAdmonitionByUUID(md, editUuid, buildAdmonition(prefix, type, title, body));
  });
  return { editUuid, file };
}

// Flip an admonition create form into an edit-of-new-admonition form in place
// (gate path only — the plain Save button still navigates back).
async function transitionAdmonitionCreateToEdit(formEl, newUuid, file) {
  formEl.dataset.mode = 'edit';
  formEl.dataset.editUuid = newUuid;
  formEl.dataset.componentContainerKind = 'guide-admonition';
  formEl.dataset.containerFile = file;
  replaceCurrentOpener('openEditGuideAdmonition', { uuid: newUuid, file });
  const heading = formEl.querySelector('[data-guide-admonition-heading]');
  if (heading) heading.textContent = 'Edit admonition';
  formEl.parentElement?.querySelector('[data-delete-admonition-btn]')?.style.removeProperty('display');
  formEl.querySelector('[data-components-row]')?.style.removeProperty('display');
  const listEl = formEl.querySelector('[data-admonition-components]');
  renderComponents(listEl, [], false);
  setOpenComponentEditor({ formEl, listEl, container: { kind: 'guide-admonition', uuid: newUuid, file }, components: [] });
  attachReorderState(formEl);
  await chrome.storage.local.set({
    moreButtonsEditGuideAdmonition: {
      admonitionTitle: formEl.querySelector('[name="admonitionTitle"]')?.value ?? '',
      admonitionMeta: formEl.querySelector('[name="admonitionMeta"]')?.value ?? '',
      admonitionType: formEl.querySelector('[name="admonitionType"]:checked')?.value ?? 'step',
      admonitionDescription: formEl.querySelector('[name="admonitionDescription"]')?.value ?? '',
      admonitionCollapsible: formEl.querySelector('[name="admonitionCollapsible"]:checked')?.value ?? 'static',
    },
  });
  resetDirtyBaseline(formEl);
}

// Persist the admonition form for the save-gate. create → splice into parent +
// transition in place; dirty edit → rewrite + rebaseline. Returns { container,
// formEl } or null.
async function saveAdmonitionForComponent(formEl, onProgress = () => {}) {
  if (formEl.dataset.mode === 'create') {
    const res = await persistNewAdmonition(formEl, onProgress);
    if (!res) return null;
    await transitionAdmonitionCreateToEdit(formEl, res.newUuid, res.file);
    return { container: { kind: 'guide-admonition', uuid: res.newUuid, file: res.file }, formEl };
  }
  const res = await persistAdmonitionEdit(formEl, onProgress);
  if (!res) return null;
  resetDirtyBaseline(formEl);
  return { container: { kind: 'guide-admonition', uuid: res.editUuid, file: res.file }, formEl };
}

registerFormAction('submitEditGuideAdmonition', async ({ formEl, content }) => {
  const btn = content.querySelector('[data-save-state]');
  setButtonBusy(btn, 'Saving…');
  try {
    const res = await saveAdmonitionForComponent(formEl, s => setButtonBusy(btn, s));
    if (!res) { formEl._refreshSaveState?.(); return; }
    // create→edit transition or in-place edit both leave the form mounted; show green.
    formEl._refreshSaveState?.();
  } catch (e) {
    formEl._refreshSaveState?.();
    alert('Failed to save admonition: ' + e.message);
  }
});

registerFormAction('deleteGuideAdmonition', async ({ formEl, content, cleanup }) => {
  const editUuid = formEl.dataset.editUuid;
  if (!editUuid) return;
  const file = formEl.dataset.containerFile || currentGuide?.draftPath;
  if (!file) return;
  if (!confirm('Delete this admonition? This also removes any sub-admonitions inside it.')) return;
  const btn = content.querySelector('[data-action="deleteGuideAdmonition"]');
  const originalText = btn?.textContent;
  if (btn) btn.disabled = true;
  try {
    await githubFetchAndPushFile(file, s => { if (btn) btn.textContent = s; }, md => deleteAdmonitionByUUID(md, editUuid));
    await chrome.storage.local.remove('moreButtonsEditGuideAdmonition');
    await navigateBack();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    alert('Failed to delete admonition: ' + e.message);
  }
});
