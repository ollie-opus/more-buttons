// Read-only view of a live guide page. Leaf module: imports from guides.js,
// never the reverse (guides.js dispatches here by registry name). The only
// write reachable from here is the banner's Create draft via writeGuideDraft.
import { registerFormAction, getFormAction } from './formActions.js';
import { createForm, setCrumbLabel, navigateBack, snapshotButton, restoreButton } from './form.js';
import { markRequiredFields } from './formValidation.js';
import { formLoading } from './loading.js';
import { readRepoText } from './repoClient.js';
import { migrateGuideIdentity } from './github.js';
import { buildSectionTree, readSectionDescription } from './sections.js';
import { parseComponents, ensureVideoUUIDs, gridCellsMarkdown } from './components.js';
import { ensureButtonUUIDs } from './mdButtons.js';
import { ensureDiagramUUIDs } from './mdDiagrams.js';
import { ensureCodeBlockUUIDs } from './mdCodeBlocks.js';
import { ensureNavLinksUUIDs } from './navLinks.js';
import { GUIDE_ADMONITION_TYPES_RE, ADMONITION_TYPE_LABELS, splitTitleMeta, stripInlineAtoms } from './admonitions.js';
import { setRteDisabled, paintInlineAtoms } from './richTextEditor.js';
import { escapeHtml, titleWithLabelsHtml, cardBodyBlock, applyCardClamps } from './cardRenderer.js';
import { copySelectionOf, paintCopySelection, setShiftHeld } from './copySelection.js';
import { renderGuideSectionTree, liveLinkHtml, guideStatusPillHtml, writeGuideDraft, draftPathOf, renderComponents, onComponentEditorClick, setOpenComponentEditor, flashButtonLabel } from './guides.js';

// Live pages carry no uuid spans for most component kinds; mint them in memory
// (same chain order as mintPastedMarkdown) so every card gets its Copy button.
// migrateGuideIdentity alone is left untouched since pushes use it.
export function liveIdentity(md) {
  return ensureCodeBlockUUIDs(ensureDiagramUUIDs(ensureNavLinksUUIDs(ensureButtonUUIDs(ensureVideoUUIDs(migrateGuideIdentity(md))))));
}

export function liveBannerHtml({ createDraft = false } = {}) {
  return '<div class="mb-live-banner" data-live-banner>'
    + '<span class="mb-live-banner__text">Viewing the live page. Nothing here can be edited. Create a draft to make changes.</span>'
    + (createDraft ? '<button type="button" class="more-buttons-button mb-live-banner__btn" data-guide-live-create><span class="more-buttons-icon">plus</span>Create draft</button>' : '')
    + '</div>';
}

// Dock for both view-only screens: View live plus Create draft (the page
// banner carries a second Create draft; both share the click delegate below).
export function liveDockHtml(livePath) {
  return liveLinkHtml(livePath)
    + '<span class="mb-dock-sep" aria-hidden="true"></span>'
    + '<button type="button" class="more-buttons-button" data-guide-live-create><span class="more-buttons-icon">plus</span>Create draft</button>';
}

// Shared by the banner and dock Create draft buttons. Every sibling
// [data-guide-live-create] under `root` is disabled while the write runs so a
// second click on the other button cannot start a second draft write.
async function createDraftFromView(btn, root, livePath, title) {
  const snap = snapshotButton(btn);
  const siblings = [...root.querySelectorAll('[data-guide-live-create]')].filter(b => b !== btn);
  const restore = () => { restoreButton(btn, snap); siblings.forEach(b => { b.disabled = false; }); };
  siblings.forEach(b => { b.disabled = true; });
  btn.disabled = true;
  btn.innerHTML = '<span class="more-buttons-icon more-buttons-icon--spin">refresh-cw</span>Creating draft…';
  try {
    const r = await writeGuideDraft(livePath, () => {}, { title });
    if (r === 'missing-live') {
      restore();
      alert('Live page not found at ' + livePath);
      return;
    }
    // navigateBack is a no-op at history cursor 0 (cold restore): land on the
    // draft screen directly so the button never sticks on "Creating draft…".
    const wentBack = await navigateBack();
    if (!wentBack) {
      restore();
      await getFormAction('openGuideEntry')({ filePath: livePath, label: title });
    }
  } catch (e) {
    restore();
    alert('Failed to create draft: ' + e.message);
  }
}

// Every view opener probes the draft first: a drafted page (history replay
// after a Create draft elsewhere, or the navigateBack after one from any
// depth) opens the normal draft entry instead of a view-only screen. A failed
// probe is treated as "no draft" and falls through to the live read, which
// reports its own failure. True when it redirected.
async function redirectIfDrafted(file, label) {
  let hasDraft = false;
  try { hasDraft = !!(await readRepoText(draftPathOf(file))); } catch { /* treat as no draft */ }
  if (!hasDraft) return false;
  await getFormAction('openGuideEntry')({ filePath: file, label });
  return true;
}

const pageTitleOf = (file, label) => label || file.split('/').pop().replace(/\.md$/, '');

registerFormAction('openGuideLiveView', async ({ file, label }) => {
  if (await redirectIfDrafted(file, label)) return;

  const { formEl } = await createForm('guideEntry');
  if (!formEl) return;
  formEl.dataset.viewOnly = '';
  formEl.dataset.livePath = file;
  const title = pageTitleOf(file, label);
  const titleEl = formEl.querySelector('[data-guide-title]');
  titleEl.textContent = title;
  titleEl.insertAdjacentHTML('beforeend', guideStatusPillHtml('live'));
  setCrumbLabel(`${title} (live)`);

  const contentEl = formEl.querySelector('[data-guide-content]');
  formEl.parentElement.querySelector('[data-guide-actions]').innerHTML = liveDockHtml(file);

  formLoading.show();
  let md;
  try { md = await readRepoText(file); }
  catch {
    contentEl.innerHTML = '<p class="more-buttons-description">Failed to load live page.</p>';
    return;
  } finally { formLoading.dismiss(); }
  if (!md) {
    contentEl.innerHTML = `<p class="more-buttons-description">Live page not found at <code>${escapeHtml(file)}</code>.</p>`;
    return;
  }
  contentEl.innerHTML = liveBannerHtml({ createDraft: true })
    + renderGuideSectionTree(liveIdentity(md), { viewOnly: true });

  formEl.parentElement.addEventListener('click', e => {
    const sec = e.target.closest('[data-view-guide-section]');
    if (sec) {
      formLoading.show();
      Promise.resolve(getFormAction('openGuideSectionLiveView')?.({ file, index: Number(sec.dataset.viewGuideSection), label: title }))
        .finally(() => formLoading.dismiss());
      return;
    }
    const btn = e.target.closest('[data-guide-live-create]');
    if (btn) createDraftFromView(btn, formEl.parentElement, file, title);
  });
});

export function liveSectionModel(markdown, index) {
  const md = liveIdentity(markdown);
  const node = buildSectionTree(md).sections[index];
  if (!node) return null;
  const body = readSectionDescription(md, node.uuid).descriptionMarkdown;
  const { description, components } = parseComponents(body, GUIDE_ADMONITION_TYPES_RE);
  return { uuid: node.uuid, title: node.title, visualLabel: node.visualLabel, description, components };
}

registerFormAction('openGuideSectionLiveView', async ({ file, index, label }) => {
  if (await redirectIfDrafted(file, label)) return;
  let model;
  try { model = liveSectionModel(await readRepoText(file), index); }
  catch { alert('Failed to load live page.'); return; }
  if (!model) { alert('Section not found.'); return; }

  // Same seeding as openEditGuideSection so a replay paints the same content.
  // Seeded every time: view mode has no edits to preserve.
  await chrome.storage.local.set({ moreButtonsEditGuideSection: {
    sectionTitle: model.title, sectionDescription: model.description, sectionParent: '', hideSectionTitle: false } });
  const { formEl } = await createForm('editGuideSection');
  if (!formEl) return;
  formEl.removeAttribute('data-dirty-guard');
  formEl.querySelector('[name="sectionTitle"]').required = false;
  markRequiredFields(formEl); // createForm already painted the star; this removes it
  formEl.dataset.viewOnly = '';
  formEl.dataset.mode = 'view';
  formEl.dataset.editUuid = model.uuid;
  formEl.dataset.componentContainerKind = 'guide-section';
  formEl.dataset.containerFile = file;

  const heading = formEl.querySelector('[data-guide-section-heading]');
  heading.textContent = model.visualLabel;
  heading.insertAdjacentHTML('beforeend', guideStatusPillHtml('live'));
  setCrumbLabel(model.visualLabel);
  heading.insertAdjacentHTML('afterend', liveBannerHtml());

  const parentRow = formEl.querySelector('[data-section-parent-row]');
  if (parentRow) parentRow.style.display = 'none';
  formEl.querySelector('[name="sectionTitle"]').readOnly = true;
  formEl.querySelectorAll('.mb-title-row .more-buttons-radio-btn').forEach(el => { el.style.display = 'none'; });
  setRteDisabled(formEl.querySelector('[name="sectionDescription"]'), true);

  formEl.parentElement.querySelector('.more-buttons-form-actions').innerHTML = liveDockHtml(file);
  wireLiveCreate(formEl, file, label);

  const listEl = formEl.querySelector('[data-section-components]');
  renderComponents(listEl, model.components, true, { viewOnly: true });
  setOpenComponentEditor({ formEl, listEl, container: { kind: 'guide-section', uuid: model.uuid, file }, components: model.components });
  formEl.addEventListener('click', e => {
    if (openChildView(e, file, [index], label)) return;
    onComponentEditorClick(e);
  });
});

// Dock Create draft delegate (dock buttons live outside the <form>).
function wireLiveCreate(formEl, file, label) {
  const pageTitle = pageTitleOf(file, label);
  formEl.parentElement.addEventListener('click', e => {
    const btn = e.target.closest('[data-guide-live-create]');
    if (btn) createDraftFromView(btn, formEl.parentElement, file, pageTitle);
  });
}

// Shared drill-down: a card's View ([data-view-component], list index) or a
// grid cell's View ([data-view-grid-cell], cell index) opens the child screen
// at `base` + index. True when the click was a View.
function openChildView(e, file, base, label) {
  const btn = e.target.closest('[data-view-component], [data-view-grid-cell]');
  if (!btn) return false;
  const i = Number(btn.dataset.viewComponent ?? btn.dataset.viewGridCell);
  formLoading.show();
  Promise.resolve(getFormAction('openComponentLiveView')?.({ file, path: [...base, i], label }))
    .finally(() => formLoading.dismiss());
  return true;
}

// ── Nested drill-down (spec section 6) ───────────────────────────────────────

// Integer, in-range index into `arr`, else undefined.
const at = (arr, n) => (Number.isInteger(n) && n >= 0 ? arr?.[n] : undefined);
const parseBody = body => parseComponents(body ?? '', GUIDE_ADMONITION_TYPES_RE);

/**
 * Resolves an ordinal path `[sectionIndex, componentIndex, …]` against the
 * live markdown. After a component index: an admonition's children take the
 * next component index; a tabs group / grid takes a sub-slot (tab / cell)
 * index first. Pure; null for a leaf, a missing component or a bad index.
 * The page-level liveIdentity chain reaches nested containers and leaves at
 * every depth, so nested bodies already carry in-memory uuids when parsed.
 */
export function liveComponentModel(markdown, path) {
  if (!Array.isArray(path) || path.length < 2) return null;
  const sec = liveSectionModel(markdown, path[0]);
  if (!sec) return null;
  let comps = sec.components;
  let i = 1;
  while (i < path.length) {
    const c = at(comps, path[i++]);
    if (!c) return null;
    const end = i === path.length;
    if (c.kind === 'admonition') {
      const { description, components } = parseBody(c.adm.body);
      if (end) return { kind: 'admonition', title: c.adm.title ?? '', type: c.adm.type, description, components, uuid: c.adm.uuid };
      comps = components;
    } else if (c.kind === 'tabs') {
      const tabs = (c.grp.tabs ?? []).map(t => ({ title: t.title ?? '', uuid: t.uuid, ...parseBody(t.body) }));
      if (end) return { kind: 'tabs', tabs, uuid: c.grp.uuid };
      const t = at(tabs, path[i++]);
      if (!t) return null;
      if (i === path.length) return { kind: 'tab', ...t };
      comps = t.components;
    } else if (c.kind === 'grid') {
      const cells = c.grid.cells ?? [];
      if (end) {
        return { kind: 'grid', flavor: c.grid.flavor, uuid: c.grid.uuid, cells: cells.map(cell => {
          const { description, components } = parseBody(cell.body);
          return { uuid: cell.uuid, body: cell.body, spill: cell.spill, valign: cell.valign, description, nComponents: components.length };
        }) };
      }
      const index = path[i++];
      const cell = at(cells, index);
      if (!cell) return null;
      const { description, components } = parseBody(cell.body);
      if (i === path.length) return { kind: 'grid-cell', index, description, components, uuid: cell.uuid };
      comps = components;
    } else {
      return null;
    }
  }
  return null;
}

// Heading HTML + plain crumb text for a component screen.
export function liveComponentHeading(model) {
  if (model.kind === 'admonition') {
    const { title } = splitTitleMeta(model.title);
    const t = title.trim() ? title : (ADMONITION_TYPE_LABELS[model.type] || 'Admonition');
    return { html: titleWithLabelsHtml(t), crumb: stripInlineAtoms(t).trim() || 'Admonition' };
  }
  if (model.kind === 'tabs') return { html: 'Content tabs', crumb: 'Content tabs' };
  if (model.kind === 'tab') { const t = model.title.trim() || 'Tab'; return { html: escapeHtml(t), crumb: t }; }
  if (model.kind === 'grid') return { html: 'Grid', crumb: 'Grid' };
  return { html: `Cell ${model.index + 1}`, crumb: `Cell ${model.index + 1}` };
}

// The Copy payload for grid cells (same as gridEditor's copyGridCell, from
// memory): `<div … markdown>` blocks, identity spans stripped.
export function liveGridCellsText(flavor, cells) {
  return gridCellsMarkdown(flavor, cells);
}

// Description + component list markup for admonition / tab / cell screens.
// The description is the screen's content, so it renders unclamped.
function containerBodyHtml(description) {
  const desc = description?.trim() ? cardBodyBlock(description, 9999) : '';
  return (desc ? `<div class="more-buttons-form-group"><label class="more-buttons-label">Description</label><div class="mb-view-description">${desc}</div></div>` : '')
    + '<div class="more-buttons-form-group"><label class="more-buttons-label">Components</label><div><div data-view-components></div></div></div>';
}

function mountContainer(formEl, host, { description, components, uuid }, kind, file) {
  host.innerHTML = containerBodyHtml(description);
  paintInlineAtoms(host);
  applyCardClamps(host);
  const listEl = host.querySelector('[data-view-components]');
  renderComponents(listEl, components, false, { viewOnly: true, emptyText: 'No components.' });
  setOpenComponentEditor({ formEl, listEl, container: { kind, uuid, file }, components });
}

function tabStripHtml(tabs, active) {
  return '<div class="more-buttons-tabs mb-ct-tabs mb-view-tabs"><div class="more-buttons-tab-list" role="tablist">'
    + tabs.map((t, i) => `<button type="button" class="more-buttons-tab${i === active ? ' --active' : ''}" role="tab" aria-selected="${i === active}" data-view-tab="${i}">${escapeHtml(t.title || `Tab ${i + 1}`)}</button>`).join('')
    + '</div></div><div data-view-tab-panel></div>';
}

function gridCellCardHtml(c, i) {
  const n = c.nComponents ?? 0;
  return `<div class="mb-component-row" data-grid-cell="${i}">
    <div class="mb-incident-card --teal">
      <div class="mb-incident-card__head">
        <strong class="mb-incident-card__title">Cell ${i + 1}</strong>
      </div>
      ${c.description?.trim() ? cardBodyBlock(c.description) : '<p class="mb-incident-card__body mb-grid-cell-empty">No text</p>'}
      <div class="mb-incident-card__foot${n ? '' : ' --end'}">
        ${n ? `<span class="mb-incident-card__meta">${n} component${n === 1 ? '' : 's'}</span>` : ''}
        <span class="mb-incident-card__foot-actions">
          <button type="button" class="mb-incident-card__edit" data-copy-grid-cell="${i}">Copy</button>
          <button type="button" class="mb-incident-card__edit" data-view-grid-cell="${i}">View</button>
        </span>
      </div>
    </div>
  </div>`;
}

// Mirrors gridEditor's copyGridCell (plain click = this cell, Shift = toggle
// and copy the selection in order) but from the in-memory model, never a read.
async function copyLiveGridCell(host, model, i, btn, multi) {
  try {
    const order = model.cells.map(c => c.uuid);
    const uuid = order[i];
    if (!uuid) throw new Error('cell not found');
    setShiftHeld(multi);
    const sel = copySelectionOf(host);
    if (multi) sel.toggle(uuid); else sel.clear();
    let uuids = multi ? sel.ordered(order) : [uuid];
    if (!uuids.length) uuids = [uuid];
    sel.paint(host, order);
    await navigator.clipboard.writeText(liveGridCellsText(model.flavor, uuids.map(u => model.cells.find(c => c.uuid === u))));
    if (!multi) flashButtonLabel(btn, 'Copied ✓');
  } catch (err) {
    console.warn('[MB] copy grid cell failed:', err);
    flashButtonLabel(btn, 'Copy failed');
  }
}

const CONTAINER_KIND = { admonition: 'guide-admonition', tab: 'content-tab', 'grid-cell': 'grid-cell', tabs: 'content-tab', grid: 'grid' };

registerFormAction('openComponentLiveView', async ({ file, path, label }) => {
  if (await redirectIfDrafted(file, label)) return;
  let model;
  try { model = liveComponentModel(await readRepoText(file), path); }
  catch { alert('Failed to load live page.'); return; }
  if (!model) { alert('Component not found.'); return; }

  const { formEl } = await createForm('viewComponent');
  if (!formEl) return;
  formEl.dataset.viewOnly = '';
  formEl.dataset.mode = 'view';
  formEl.dataset.viewPath = JSON.stringify(path);
  formEl.dataset.livePath = file;
  formEl.dataset.componentContainerKind = CONTAINER_KIND[model.kind];
  formEl.dataset.editUuid = model.uuid ?? '';
  formEl.dataset.containerFile = file;

  const { html, crumb } = liveComponentHeading(model);
  const heading = formEl.querySelector('[data-view-component-heading]');
  heading.innerHTML = `<span class="mb-view-heading__text">${html}</span>`;
  heading.insertAdjacentHTML('beforeend', guideStatusPillHtml('live'));
  paintInlineAtoms(heading);
  setCrumbLabel(crumb);
  heading.insertAdjacentHTML('afterend', liveBannerHtml());

  formEl.parentElement.querySelector('.more-buttons-form-actions').innerHTML = liveDockHtml(file);
  wireLiveCreate(formEl, file, label);

  const host = formEl.querySelector('[data-view-component-body]');
  let activeTab = 0;
  if (model.kind === 'tabs') {
    host.innerHTML = tabStripHtml(model.tabs, activeTab);
    const panel = host.querySelector('[data-view-tab-panel]');
    const showTab = i => {
      activeTab = i;
      host.querySelectorAll('[data-view-tab]').forEach(b => {
        const on = Number(b.dataset.viewTab) === i;
        b.classList.toggle('--active', on);
        b.setAttribute('aria-selected', String(on));
      });
      if (model.tabs[i]) mountContainer(formEl, panel, model.tabs[i], 'content-tab', file);
      else panel.innerHTML = '<p class="more-buttons-description">No tabs.</p>';
    };
    showTab(0);
    formEl.addEventListener('click', e => {
      const tab = e.target.closest('[data-view-tab]');
      if (tab) { showTab(Number(tab.dataset.viewTab)); return; }
      if (openChildView(e, file, [...path, activeTab], label)) return;
      onComponentEditorClick(e);
    });
    return;
  }
  if (model.kind === 'grid') {
    host.innerHTML = '<div data-view-grid-cells></div>';
    const cellsEl = host.querySelector('[data-view-grid-cells]');
    cellsEl.innerHTML = model.cells.length
      ? model.cells.map(gridCellCardHtml).join('')
      : '<p class="more-buttons-description">No cells.</p>';
    paintInlineAtoms(cellsEl);
    applyCardClamps(cellsEl);
    paintCopySelection(cellsEl, model.cells.map(c => c.uuid));
    formEl.addEventListener('click', e => {
      const copy = e.target.closest('[data-copy-grid-cell]');
      if (copy) { copyLiveGridCell(cellsEl, model, Number(copy.dataset.copyGridCell), copy, e.shiftKey); return; }
      if (openChildView(e, file, path, label)) return;
      onComponentEditorClick(e); // Show more on cell descriptions
    });
    return;
  }
  mountContainer(formEl, host, model, CONTAINER_KIND[model.kind], file);
  formEl.addEventListener('click', e => {
    if (openChildView(e, file, path, label)) return;
    onComponentEditorClick(e);
  });
});
