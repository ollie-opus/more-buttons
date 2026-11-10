// Read-only view of a live guide page. Leaf module: imports from guides.js,
// never the reverse (guides.js dispatches here by registry name). The page
// level is the guide entry's live side (renderGuideLiveContent); the section
// and component screens below it are opened from there. The only write
// reachable from here is the deep docks' Create draft via writeGuideDraft.
import { registerFormAction, getFormAction } from './formActions.js';
import { createForm, setCrumbLabel, navigateBackTo, snapshotButton, restoreButton } from './form.js';
import { markRequiredFields } from './formValidation.js';
import { formLoading } from './loading.js';
import { readRepoText } from './repoClient.js';
import { migrateGuideIdentity } from './github.js';
import { buildSectionTree, readSectionDescription } from './sections.js';
import { parseComponents, ensureVideoUUIDs, gridCellsMarkdown, uuidOfComponent } from './components.js';
import { ensureButtonUUIDs } from './mdButtons.js';
import { ensureDiagramUUIDs } from './mdDiagrams.js';
import { ensureCodeBlockUUIDs } from './mdCodeBlocks.js';
import { ensureNavLinksUUIDs } from './navLinks.js';
import { GUIDE_ADMONITION_TYPES_RE, ADMONITION_TYPE_LABELS, splitTitleMeta, stripInlineAtoms } from './admonitions.js';
import { setRteDisabled, paintInlineAtoms, upgradeTextarea, loadLabelPalette } from './richTextEditor.js';
import { escapeHtml, titleWithLabelsHtml, cardBodyBlock, applyCardClamps, railRowHtml, insertSpacerHtml, listTileHeadHtml } from './cardRenderer.js';
import { listSelectionOf, paintListSelection, listCountBadge } from './listSelection.js';
import { paintMediaFields, mediaDimFields, mediaFormatPillHtml } from './captureComponent.js';
import { renderGuideSectionTree, liveLinkHtml, guideStatusPillHtml, writeGuideDraft, draftPathOf, renderComponents, onComponentEditorClick, setOpenComponentEditor, flashButtonLabel, renderPageSettingsNode, parentOptionsForSection, pageSettingsDimFields, attachPageSettingsWidgets } from './guides.js';
// Leaf editors: their shared paint functions build the same fields over the
// same templates; none of these is a write.
import { paintDataTable } from './dataTablesEditor.js';
import { wireCodeBlockForm, crumbFor as codeBlockCrumb } from './codeBlockEditor.js';
import { paintButtonFields } from './buttonEditor.js';
import { paintNavLinksFields } from './navLinksEditor.js';
import { crumbFor as diagramCrumb } from './diagramEditor.js';
import { codeBlockDimFields } from './mdCodeBlocks.js';
import { buttonDimFields } from './mdButtons.js';
import { navLinksDimFields } from './navLinks.js';
import { diagramDimFields } from './mdDiagrams.js';

// Live pages carry no uuid spans for most component kinds; mint them in memory
// (same chain order as mintPastedMarkdown) so every card gets its Copy button.
// migrateGuideIdentity alone is left untouched since pushes use it.
export function liveIdentity(md) {
  return ensureCodeBlockUUIDs(ensureDiagramUUIDs(ensureNavLinksUUIDs(ensureButtonUUIDs(ensureVideoUUIDs(migrateGuideIdentity(md))))));
}

// Live screens mirror their draft editors field for field, every control
// frozen; the heading pill says which side this is. The one piece of copy is
// the empty component tile: why nothing can be inserted here. `drafted`
// points at the header's Live/Draft switch; otherwise at the dock's Create draft.
export function liveInsertHint(drafted) {
  return drafted ? 'Switch to draft to insert components' : 'Create a draft to insert components';
}

// Mark a draft-editor form as this guide's read-only live screen.
function markViewOnly(formEl, { uuid, kind, file }) {
  formEl.removeAttribute('data-dirty-guard');
  formEl.dataset.viewOnly = '';
  formEl.dataset.mode = 'view';
  formEl.dataset.editUuid = uuid ?? '';
  formEl.dataset.componentContainerKind = kind;
  formEl.dataset.containerFile = file;
  // Nothing is submitted from here, so no field is required (createForm
  // already painted the stars; this removes them).
  formEl.querySelectorAll('[required]').forEach(el => { el.required = false; });
  markRequiredFields(formEl);
}

// Freeze a form's fields: text inputs read-only (still selectable, styled
// disabled), selects / pills disabled, rich text editors read-only with their
// toolbar kept (format buttons off, Rich | Markdown still switchable), plain
// textareas (diagram / code source) read-only. The view's own controls (Copy,
// View, tab strip, Show more, the lists' selection checkboxes) stay live.
function freezeFields(root) {
  root.querySelectorAll('input[type="text"], input[type="number"], textarea:not([data-richtext])').forEach(i => { i.readOnly = true; });
  root.querySelectorAll('select, input[type="radio"], input[type="checkbox"]:not([data-select-row]):not([data-select-all])').forEach(i => { i.disabled = true; });
  root.querySelectorAll('textarea[data-richtext]').forEach(ta => setRteDisabled(ta, true, { readOnly: true }));
}

// Dock for the section/component view-only screens: View live, plus Create
// draft while the guide has none.
export function liveDockHtml(livePath, { drafted = false } = {}) {
  return liveLinkHtml(livePath)
    + (drafted ? '' : '<span class="mb-dock-sep" aria-hidden="true"></span>'
      + '<button type="button" class="more-buttons-button" data-guide-live-create><span class="more-buttons-icon">plus</span>Create draft</button>');
}

// Deep-screen Create draft. On success it stays where it was: the same
// section / component on the new draft, its editor opened with the draft
// trail (guideSideSwitch's openFreshDraftAt). Only when that place can't be
// resolved does it return to the guide entry (which re-probes and opens on
// the new draft), walking back through history when the entry is on it, else
// opening it fresh (cold restore straight to depth).
async function createDraftFromView(btn, livePath, title, formEl) {
  const snap = snapshotButton(btn);
  btn.disabled = true;
  btn.innerHTML = '<span class="more-buttons-icon more-buttons-icon--spin">refresh-cw</span>Creating draft…';
  try {
    const r = await writeGuideDraft(livePath, () => {}, { title });
    if (r === 'missing-live') {
      restoreButton(btn, snap);
      alert('Live page not found at ' + livePath);
      return;
    }
    if (await openFreshDraftInPlace(livePath, title, formEl)) return;
    const wentBack = await navigateBackTo('guideEntry');
    if (!wentBack) {
      restoreButton(btn, snap);
      await getFormAction('openGuideEntry')({ filePath: livePath, label: title });
    }
  } catch (e) {
    restoreButton(btn, snap);
    alert('Failed to create draft: ' + e.message);
  }
}

// The same place on the just-written draft; false when the hand-off can't
// resolve it (or isn't registered), so the caller falls back to the entry.
async function openFreshDraftInPlace(livePath, title, formEl) {
  const open = getFormAction('openFreshDraftAt');
  if (!open) return false;
  formLoading.show();
  try { return !!(await open({ livePath, title, formEl })); }
  catch (err) { console.warn('[MB] opening the new draft in place failed:', err); return false; }
  finally { formLoading.dismiss(); }
}

// Deep screens show the live page whether or not a draft exists (the entry's
// switch lets a drafted guide be browsed live); the probe only decides whether
// Create draft is offered. A failed probe reads as "no draft": writeGuideDraft
// re-checks and never overwrites an existing draft.
async function hasDraft(file) {
  try { return !!(await readRepoText(draftPathOf(file))); } catch { return false; }
}

const pageTitleOf = (file, label) => label || file.split('/').pop().replace(/\.md$/, '');

// Kept for stacks recorded before the page view folded into the guide entry.
registerFormAction('openGuideLiveView', ({ file, label }) =>
  // No forced side: a page without a draft opens live anyway, and a replay of an
  // old slot after Create draft must land on the new draft, not the live side.
  getFormAction('openGuideEntry')({ filePath: file, label }));

// The guide entry's live side (dispatched by guides.js renderGuideMode, which
// owns the dock and the clicks). Reads the markdown guides.js stashed.
registerFormAction('renderGuideLiveContent', ({ formEl }) => {
  const contentEl = formEl.querySelector('[data-guide-content]');
  if (!contentEl) return;
  const md = formEl._liveMd;
  if (!md) {
    contentEl.innerHTML = `<p class="more-buttons-description">Live page not found at <code>${escapeHtml(formEl.dataset.livePath)}</code>.</p>`;
    return;
  }
  contentEl.innerHTML = renderPageSettingsNode({ view: true })
    + renderGuideSectionTree(liveIdentity(md), { viewOnly: true });
});

export function liveSectionModel(markdown, index) {
  const md = liveIdentity(markdown);
  const node = buildSectionTree(md).sections[index];
  if (!node) return null;
  const { descriptionMarkdown: body, hideTitle } = readSectionDescription(md, node.uuid);
  const { description, components } = parseComponents(body, GUIDE_ADMONITION_TYPES_RE);
  return { uuid: node.uuid, title: node.title, visualLabel: node.visualLabel, level: node.level, parentUuid: node.parentUuid ?? '', hideTitle: !!hideTitle, description, components, md };
}

registerFormAction('openGuideSectionLiveView', async ({ file, index, label }) => {
  let model, drafted;
  try { [model, drafted] = await Promise.all([readRepoText(file).then(md => liveSectionModel(md, index)), hasDraft(file)]); }
  catch { alert('Failed to load live page.'); return; }
  if (!model) { alert('Section not found.'); return; }

  // Same seeding as openEditGuideSection so the form hydrates the same fields.
  // Seeded every time: view mode has no edits to preserve.
  await chrome.storage.local.set({ moreButtonsEditGuideSection: {
    sectionTitle: model.title, sectionDescription: model.description, sectionParent: model.parentUuid, hideSectionTitle: model.hideTitle } });
  const { formEl } = await createForm('editGuideSection');
  if (!formEl) return;
  markViewOnly(formEl, { uuid: model.uuid, kind: 'guide-section', file });

  const heading = formEl.querySelector('[data-guide-section-heading]');
  if (heading) {
    heading.textContent = model.visualLabel;
    heading.insertAdjacentHTML('beforeend', guideStatusPillHtml('live'));
  }
  setCrumbLabel(model.visualLabel);

  // Section parent: the draft's dropdown, frozen on this section's parent.
  // The Title has no parent row on either side.
  const select = formEl.querySelector('[data-section-parent-select]');
  if (model.level === 1) formEl.querySelector('[data-section-parent-row]')?.style.setProperty('display', 'none');
  else if (select) {
    select.innerHTML = parentOptionsForSection(model.md, model.uuid, model.level)
      .map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('');
    select.value = model.parentUuid;
  }
  freezeFields(formEl);

  formEl.parentElement.querySelector('.more-buttons-form-actions').innerHTML = liveDockHtml(file, { drafted });
  wireLiveCreate(formEl, file, label);

  const listEl = formEl.querySelector('[data-section-components]');
  renderComponents(listEl, model.components, true, { viewOnly: true, insertHint: liveInsertHint(drafted) });
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
    if (btn) createDraftFromView(btn, file, pageTitle, formEl);
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
const MEDIA_KINDS = new Set(['capture', 'video', 'image']);
const MEDIA_LABELS = { capture: 'Capture', video: 'Video', image: 'Image' };
// The parsed media object inside a media component ({kind:'capture', cap} etc.).
const mediaOf = c => c.cap ?? c.vid ?? c.img;
// The leaf editors with a live screen, and the draft template each is built on.
const LEAF_FORMS = { table: 'editDataTable', codeblock: 'editCodeBlock', button: 'editButton', navlinks: 'editNavLinks', diagram: 'editDiagram' };
const at = (arr, n) => (Number.isInteger(n) && n >= 0 ? arr?.[n] : undefined);
const parseBody = body => parseComponents(body ?? '', GUIDE_ADMONITION_TYPES_RE);

/**
 * Resolves an ordinal path `[sectionIndex, componentIndex, …]` against the
 * live markdown. After a component index: an admonition's children take the
 * next component index; a tabs group / grid takes a sub-slot (tab / cell)
 * index first. A capture / video / image at the end of the path resolves to
 * a media model (its parsed component); a table / code block / button / nav
 * links / diagram to a leaf model { kind: 'leaf', compKind, component, uuid }.
 * A path continuing past a leaf, a missing component or a bad index is null. Pure.
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
      if (end) return { kind: 'admonition', title: c.adm.title ?? '', type: c.adm.type, prefix: c.adm.prefix ?? '!!!', description, components, uuid: c.adm.uuid };
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
      if (i === path.length) return { kind: 'grid-cell', index, spill: !!cell.spill, valign: cell.valign ?? 'default', description, components, uuid: cell.uuid };
      comps = components;
    } else if (MEDIA_KINDS.has(c.kind)) {
      return end ? { kind: 'media', mediaKind: c.kind, component: c, uuid: uuidOfComponent(c) } : null;
    } else if (LEAF_FORMS[c.kind]) {
      return end ? { kind: 'leaf', compKind: c.kind, component: c, uuid: uuidOfComponent(c) } : null;
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
  if (model.kind === 'media') { const t = MEDIA_LABELS[model.mediaKind] ?? 'Media'; return { html: t, crumb: t }; }
  if (model.kind === 'leaf') return leafHeading(model.compKind, model.component);
  return { html: `Cell ${model.index + 1}`, crumb: `Cell ${model.index + 1}` };
}

// The Copy payload for grid cells (same as gridEditor's copyGridCell, from
// memory): `<div … markdown>` blocks, identity spans stripped.
export function liveGridCellsText(flavor, cells) {
  return gridCellsMarkdown(flavor, cells);
}

// ── Component screens ─────────────────────────────────────────────────────────
// Each mirrors its draft editor group for group so the two sides share one
// layout, every control built frozen. The admonition screen reuses the
// editGuideAdmonition template itself (as the section screen reuses
// editGuideSection); tabs / grid / cell rebuild their editors' groups inside
// viewComponent, since those editors assemble their fields from state.

const groupHtml = (label, inner, attrs = '') => `<div class="more-buttons-form-group"${attrs}><label class="more-buttons-label">${label}</label>${inner}</div>`;
const textInputHtml = value => `<input type="text" readonly value="${escapeHtml(value ?? '')}" />`;
const componentsGroupHtml = () => groupHtml('Components', '<div><div data-view-components></div></div>', ' data-components-row data-list-row');

// A read-only rich text editor over `markdown`; upgradeRtes builds it once the
// markup is in the document (the readonly flag carries into the editor).
function rteHtml(markdown) {
  return `<textarea rows="6" readonly data-richtext>${escapeHtml(markdown ?? '')}</textarea>`;
}
function upgradeRtes(root) {
  root.querySelectorAll('textarea[data-richtext]').forEach(ta => upgradeTextarea(ta, { inline: ta.dataset.richtext === 'inline' }));
}

// Frozen radio pills; `value` marks the checked one.
function pillsHtml(options, value) {
  return '<div class="more-buttons-radio-btn-group-row">' + options.map(([v, label]) =>
    `<label class="more-buttons-radio-btn"><input type="radio" disabled${v === value ? ' checked' : ''} /> ${label}</label>`).join('') + '</div>';
}

// editContentTabs: Title, Description, Components (per tab).
export function tabBodyHtml(tab) {
  return groupHtml('Title', textInputHtml(tab.title)) + groupHtml('Description', rteHtml(tab.description)) + componentsGroupHtml();
}
// editGridCell: Cell content, Allow Spill, Vertical alignment, Components.
export function gridCellBodyHtml(cell) {
  return groupHtml('Cell content', rteHtml(cell.description))
    + groupHtml('Allow Spill', pillsHtml([[false, 'False'], [true, 'True']], !!cell.spill))
    + groupHtml('Vertical alignment', pillsHtml([['default', 'Default'], ['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']], cell.valign ?? 'default'))
    + componentsGroupHtml();
}
// editGrid: Style, Cells.
export function gridBodyHtml(flavor) {
  return groupHtml('Style', pillsHtml([['generic', 'Plain'], ['card', 'Cards']], flavor)) + groupHtml('Cells', '<div><div data-view-grid-cells></div></div>', ' data-list-row');
}

function mountContainer(formEl, host, html, { components, uuid }, kind, file, drafted) {
  host.innerHTML = html;
  upgradeRtes(host);
  const listEl = host.querySelector('[data-view-components]');
  renderComponents(listEl, components, false, { viewOnly: true, insertHint: liveInsertHint(drafted) });
  setOpenComponentEditor({ formEl, listEl, container: { kind, uuid, file }, components });
}

// editContentTabs' strip + manage row (Move left / right, Delete tab), frozen.
function tabStripHtml(tabs, active) {
  return '<div class="more-buttons-tabs mb-ct-tabs mb-view-tabs"><div class="more-buttons-tab-list" role="tablist">'
    + tabs.map((t, i) => `<button type="button" class="more-buttons-tab${i === active ? ' --active' : ''}" role="tab" aria-selected="${i === active}" data-view-tab="${i}">${escapeHtml(t.title || `Tab ${i + 1}`)}</button>`).join('')
    + '</div></div>'
    + '<div class="mb-ct-manage">'
    + '<button type="button" class="more-buttons-button" disabled><span class="more-buttons-icon">arrow-left</span>Move left</button>'
    + '<button type="button" class="more-buttons-button" disabled><span class="more-buttons-icon">arrow-right</span>Move right</button>'
    + '<button type="button" class="more-buttons-button red" disabled><span class="more-buttons-icon">panel-top-close</span>Delete tab</button>'
    + '</div><div data-view-tab-panel></div>';
}

function gridCellCardHtml(c, i) {
  const n = c.nComponents ?? 0;
  return `<div class="mb-incident-card --teal">
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
    </div>`;
}

// The draft grid's vertical cell list (gridEditor renderCellList): an insert
// rule before every card and after the last, each card on the shared checkbox
// + rail (rail inert). The selection bar (Copy only) is mounted by the caller
// into the Cells group's section head.
export function gridCellListHtml(cells) {
  const last = cells.length - 1;
  const parts = [];
  cells.forEach((c, i) => {
    parts.push(insertSpacerHtml());
    parts.push(railRowHtml({ rowAttrs: `data-grid-cell="${i}"`, isFirst: i === 0, isLast: i === last, moveAttr: 'data-grid-move-cell', cardHtml: gridCellCardHtml(c, i), disabled: true, selectable: true }));
  });
  parts.push(insertSpacerHtml());
  return parts.join('');
}

// Mirrors gridEditor's copyGridCells (a card's Copy = that cell; the bar's Copy
// selected = the checked cells in order) but from the in-memory model, never a read.
async function copyLiveGridCells(model, uuids, btn, doneLabel = 'Copied ✓') {
  try {
    const cells = uuids.map(u => model.cells.find(c => c.uuid === u));
    if (!cells.length || cells.some(c => !c)) throw new Error('cell not found');
    await navigator.clipboard.writeText(liveGridCellsText(model.flavor, cells));
    flashButtonLabel(btn, doneLabel);
  } catch (err) {
    console.warn('[MB] copy grid cell failed:', err);
    flashButtonLabel(btn, 'Copy failed');
  }
}

const CONTAINER_KIND = { admonition: 'guide-admonition', tab: 'content-tab', 'grid-cell': 'grid-cell', tabs: 'content-tab', grid: 'grid', media: 'media', leaf: 'leaf' };
const PREFIX_TO_COLLAPSIBLE = { '!!!': 'static', '???': 'collapsed', '???+': 'expanded' };

// The draft editor template a live component screen is built on, by model
// kind, or by component kind for leaves (media kinds included).
export function liveComponentFormName(kind) {
  if (kind === 'admonition') return 'editGuideAdmonition';
  if (LEAF_FORMS[kind]) return LEAF_FORMS[kind];
  return kind === 'media' || MEDIA_KINDS.has(kind) ? 'editCaptureComponent' : 'viewComponent';
}

// Leaf heading + crumb, worded like the draft editor's crumb (the editor's
// own crumb helpers where it has one).
function leafHeading(compKind, c) {
  let t;
  if (compKind === 'table') t = 'Data table';
  else if (compKind === 'codeblock') {
    const crumb = codeBlockCrumb(c.cb);
    return { html: escapeHtml((c.cb.title ?? '').trim() || 'Code block'), crumb };
  } else if (compKind === 'button') t = c.btn.label || 'Button';
  else if (compKind === 'navlinks') t = c.nav.path || c.nav.tag || 'Nav links';
  else if (compKind === 'diagram') return { html: 'Diagram', crumb: diagramCrumb(c.dia.code) };
  else t = 'Component';
  return { html: escapeHtml(t), crumb: t };
}

/**
 * The storage seed a leaf's live screen writes before createForm, the same
 * dict its draft editor opener seeds (same storage key, same field values).
 * Pure.
 */
export function liveLeafSeed(compKind, c) {
  if (compKind === 'table') {
    const { align, header, rows, wrap } = c.tbl;
    return { moreButtonsEditDataTable: { tableState: JSON.stringify({ align, header, rows, wrap }) } };
  }
  if (compKind === 'codeblock') return { moreButtonsEditCodeBlock: codeBlockDimFields(c.cb) };
  if (compKind === 'button') return { moreButtonsEditButton: buttonDimFields(c.btn) };
  if (compKind === 'navlinks') return { moreButtonsEditNavLinks: navLinksDimFields(c.nav) };
  if (compKind === 'diagram') return { moreButtonsEditDiagram: diagramDimFields(c.dia) };
  return null;
}

// Each leaf template's heading element.
const LEAF_HEADINGS = { table: '[data-dt-heading]', codeblock: '[data-codeblock-heading]', button: '[data-button-heading]', navlinks: '[data-nav-links-heading]', diagram: '[data-diagram-heading]' };

// A leaf's live screen: the draft editor's own template, seeded the way its
// opener seeds it, painted by the editor's shared paint function in view
// mode, then frozen. Copy sits under the fields (the component Copy, same
// handler and payload as its card). Everything read is in memory or a GET.
async function openLeafLiveView(model, chrome_) {
  const { compKind: k, component: c, uuid } = model;
  const seed = liveLeafSeed(k, c);
  // The palette loads before createForm: the swatches must exist before the
  // storage hydration macrotask lands (buttonEditor's own ordering rule).
  const palette = k === 'button' ? await loadLabelPalette() : null;
  await chrome.storage.local.set(seed);
  const { formEl } = await createForm(LEAF_FORMS[k]);
  if (!formEl) return;
  if (k === 'button') paintButtonFields(formEl, seed.moreButtonsEditButton, palette, { viewOnly: true });
  else if (k === 'codeblock') wireCodeBlockForm(formEl, { viewOnly: true });
  else if (k === 'navlinks') paintNavLinksFields(formEl, { viewOnly: true });
  mountComponentChrome(formEl, formEl.querySelector(LEAF_HEADINGS[k]), model, chrome_);
  formEl.insertAdjacentHTML('beforeend', liveMediaCopyHtml(uuid));
  freezeFields(formEl);
  if (k === 'table') {
    formEl.dataset.tableUuid = uuid ?? '';
    const { align, header, rows, wrap } = c.tbl;
    await paintDataTable(formEl, { align, header, rows, wrap }, { file: chrome_.file, uuid, viewOnly: true });
  }
  setOpenComponentEditor({ formEl, listEl: formEl.querySelector('[data-view-media-copy]'), container: { kind: 'leaf', uuid, file: chrome_.file }, components: [c] });
  formEl.addEventListener('click', onComponentEditorClick);
}

// The media screen's Copy (the card's Copy, same handler and payload), placed
// under the preview: this screen has no card list to carry it.
export function liveMediaCopyHtml(uuid) {
  return `<div class="mb-view-media-copy" data-view-media-copy><button type="button" class="more-buttons-button" data-copy-component-md="${escapeHtml(uuid ?? '')}">Copy</button></div>`;
}

// "Manage this capture" ahead of the live dock: the route to the library
// entry (openMediaEntryFromComponent reads only the form's media datasets;
// the entry form reads on open and writes only on its own explicit actions).
const MANAGE_MEDIA_BTN = '<button type="button" class="more-buttons-button" data-action="openMediaEntryFromComponent"><span class="more-buttons-icon">images</span>Manage this capture</button><span class="mb-dock-sep" aria-hidden="true"></span>';

// Heading, crumb, dock and the view-only marks shared by every component screen.
function mountComponentChrome(formEl, headingEl, model, { file, path, label, drafted }) {
  markViewOnly(formEl, { uuid: model.uuid, kind: CONTAINER_KIND[model.kind], file });
  formEl.dataset.viewPath = JSON.stringify(path);
  formEl.dataset.livePath = file;
  const { html, crumb } = liveComponentHeading(model);
  headingEl.innerHTML = `<span class="mb-view-heading__text">${html}</span>`;
  headingEl.insertAdjacentHTML('beforeend', guideStatusPillHtml('live'));
  paintInlineAtoms(headingEl);
  setCrumbLabel(crumb);
  formEl.parentElement.querySelector('.more-buttons-form-actions').innerHTML = liveDockHtml(file, { drafted });
  wireLiveCreate(formEl, file, label);
}

// `tab` (optional) opens a tabs group on that tab (the Live/Draft switch).
registerFormAction('openComponentLiveView', async ({ file, path, label, tab }) => {
  let model, drafted;
  try { [model, drafted] = await Promise.all([readRepoText(file).then(md => liveComponentModel(md, path)), hasDraft(file)]); }
  catch { alert('Failed to load live page.'); return; }
  if (!model) { alert('Component not found.'); return; }
  const chrome_ = { file, path, label, drafted };

  if (model.kind === 'leaf') { await openLeafLiveView(model, chrome_); return; }

  if (model.kind === 'media') {
    // The draft editor's own form (editCaptureComponent), hydrated the way
    // openEditMediaComponent seeds it, painted by the editor's shared
    // paintMediaFields (preview via readRepoBlob, a GET), then frozen.
    const media = mediaOf(model.component);
    await chrome.storage.local.set({ moreButtonsEditCaptureComponent: mediaDimFields(model.mediaKind, media) });
    const { formEl } = await createForm('editCaptureComponent');
    if (!formEl) return;
    const headingEl = formEl.querySelector('[data-edit-media-title]');
    mountComponentChrome(formEl, headingEl, model, chrome_);
    headingEl.querySelector('.mb-kb-pills[data-guide-side]')?.insertAdjacentHTML('beforebegin', mediaFormatPillHtml(media));
    const dock = formEl.parentElement.querySelector('.more-buttons-form-actions');
    dock.insertAdjacentHTML('afterbegin', MANAGE_MEDIA_BTN);
    formEl.querySelector('[data-capture-component-preview]')?.insertAdjacentHTML('afterend', liveMediaCopyHtml(model.uuid));
    await paintMediaFields(formEl, model.mediaKind, media);
    freezeFields(formEl);
    const copyHost = formEl.querySelector('[data-view-media-copy]');
    setOpenComponentEditor({ formEl, listEl: copyHost, container: { kind: 'media', uuid: model.uuid, file }, components: [model.component] });
    formEl.addEventListener('click', onComponentEditorClick);
    return;
  }

  if (model.kind === 'admonition') {
    // The draft editor's own form, hydrated the way openEditGuideAdmonition
    // seeds it, then frozen.
    const { title, meta } = splitTitleMeta(model.title);
    await chrome.storage.local.set({ moreButtonsEditGuideAdmonition: {
      admonitionTitle: title, admonitionMeta: meta, admonitionType: model.type,
      admonitionDescription: model.description, admonitionCollapsible: PREFIX_TO_COLLAPSIBLE[model.prefix] ?? 'static' } });
    const { formEl } = await createForm('editGuideAdmonition');
    if (!formEl) return;
    mountComponentChrome(formEl, formEl.querySelector('[data-guide-admonition-heading]'), model, chrome_);
    freezeFields(formEl);
    const listEl = formEl.querySelector('[data-admonition-components]');
    renderComponents(listEl, model.components, false, { viewOnly: true, insertHint: liveInsertHint(drafted) });
    setOpenComponentEditor({ formEl, listEl, container: { kind: 'guide-admonition', uuid: model.uuid, file }, components: model.components });
    formEl.addEventListener('click', e => {
      if (openChildView(e, file, path, label)) return;
      onComponentEditorClick(e);
    });
    return;
  }

  const { formEl } = await createForm('viewComponent');
  if (!formEl) return;
  mountComponentChrome(formEl, formEl.querySelector('[data-view-component-heading]'), model, chrome_);

  const host = formEl.querySelector('[data-view-component-body]');
  let activeTab = Number.isInteger(tab) && model.kind === 'tabs' && model.tabs[tab] ? tab : 0;
  if (model.kind === 'tabs') {
    host.innerHTML = tabStripHtml(model.tabs, activeTab);
    const panel = host.querySelector('[data-view-tab-panel]');
    const showTab = i => {
      activeTab = i;
      formEl.dataset.activeTab = String(i); // read by the Live/Draft switch (not data-view-tab: closest() would match the form)
      host.querySelectorAll('[data-view-tab]').forEach(b => {
        const on = Number(b.dataset.viewTab) === i;
        b.classList.toggle('--active', on);
        b.setAttribute('aria-selected', String(on));
      });
      if (model.tabs[i]) {
        formEl.dataset.editUuid = model.tabs[i].uuid ?? ''; // keep the form's container id on the active tab
        mountContainer(formEl, panel, tabBodyHtml(model.tabs[i]), model.tabs[i], 'content-tab', file, drafted);
      }
      else panel.innerHTML = '<p class="more-buttons-description">No tabs.</p>';
    };
    showTab(activeTab);
    formEl.addEventListener('click', e => {
      const tab = e.target.closest('[data-view-tab]');
      if (tab) { showTab(Number(tab.dataset.viewTab)); return; }
      if (openChildView(e, file, [...path, activeTab], label)) return;
      onComponentEditorClick(e);
    });
    return;
  }
  if (model.kind === 'grid') {
    host.innerHTML = gridBodyHtml(model.flavor);
    const cellsEl = host.querySelector('[data-view-grid-cells]');
    cellsEl.innerHTML = model.cells.length ? gridCellListHtml(model.cells) : '<p class="more-buttons-description">No cells.</p>';
    if (model.cells.length > 1) cellsEl.insertAdjacentHTML('afterbegin', listTileHeadHtml({ canDelete: false }));
    listCountBadge(cellsEl.closest('[data-list-row]'), model.cells.length);
    paintInlineAtoms(cellsEl);
    applyCardClamps(cellsEl);
    const cellOrder = () => model.cells.map(c => c.uuid);
    const paintCells = () => paintListSelection(cellsEl, cellOrder());
    const selectAllCells = on => { const sel = listSelectionOf(cellsEl); if (on) cellOrder().forEach(u => sel.add(u)); else sel.clear(); paintCells(); };
    paintCells();
    // This screen has no open component editor, so it paints its own list
    // (Copy from the header; no Delete on a live grid). On the form itself:
    // onComponentEditorClick reads the form off e.currentTarget.
    formEl.addEventListener('click', e => {
      const copy = e.target.closest('[data-copy-grid-cell]');
      if (copy) { copyLiveGridCells(model, [model.cells[Number(copy.dataset.copyGridCell)]?.uuid], copy); return; }
      const selectRow = e.target.closest('[data-select-row]');
      if (selectRow) {
        const i = Number(selectRow.closest('[data-grid-cell]')?.dataset.gridCell ?? -1);
        listSelectionOf(cellsEl).set(model.cells[i]?.uuid, selectRow.checked);
        paintCells();
        return;
      }
      const selectAll = e.target.closest('[data-select-all]');
      if (selectAll) { selectAllCells(selectAll.checked); return; }
      const copySelected = e.target.closest('[data-copy-selected]');
      if (copySelected) {
        const uuids = listSelectionOf(cellsEl).ordered(cellOrder());
        if (uuids.length) copyLiveGridCells(model, uuids, copySelected, `Copied ${uuids.length} ✓`);
        return;
      }
      if (openChildView(e, file, path, label)) return;
      onComponentEditorClick(e); // Show more on cell descriptions
    });
    return;
  }
  mountContainer(formEl, host, model.kind === 'grid-cell' ? gridCellBodyHtml(model) : tabBodyHtml(model), model, CONTAINER_KIND[model.kind], file, drafted);
  formEl.addEventListener('click', e => {
    if (openChildView(e, file, path, label)) return;
    onComponentEditorClick(e);
  });
});


// ── Page settings (live side) ────────────────────────────────────────────────

// The entry's live Page settings row: the draft's editPageSettings form,
// seeded from the LIVE file's frontmatter and zensical.toml (both GETs), the
// widgets in view mode, every field frozen. No draft is read for the values;
// the probe only decides whether the dock offers Create draft.
registerFormAction('openPageSettingsLiveView', async ({ file, label }) => {
  let md, toml, drafted;
  try { [md, toml, drafted] = await Promise.all([readRepoText(file), readRepoText('zensical.toml'), hasDraft(file)]); }
  catch { alert('Failed to load live page.'); return; }
  if (!md) { alert('Live page not found at ' + file); return; }
  await chrome.storage.local.set({ moreButtonsEditPageSettings: pageSettingsDimFields(md, toml ?? '', file) });
  const { formEl } = await createForm('editPageSettings');
  if (!formEl) return;
  attachPageSettingsWidgets(formEl, { viewOnly: true });
  markViewOnly(formEl, { uuid: '', kind: 'page-settings', file });
  formEl.dataset.livePath = file;
  const heading = formEl.querySelector('h2');
  heading?.insertAdjacentHTML('beforeend', guideStatusPillHtml('live'));
  setCrumbLabel('Page settings');
  freezeFields(formEl);
  formEl.parentElement.querySelector('.more-buttons-form-actions').innerHTML = liveDockHtml(file, { drafted });
  wireLiveCreate(formEl, file, label);
});
