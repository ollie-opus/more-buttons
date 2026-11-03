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
import { parseComponents, ensureVideoUUIDs } from './components.js';
import { ensureButtonUUIDs } from './mdButtons.js';
import { ensureDiagramUUIDs } from './mdDiagrams.js';
import { ensureCodeBlockUUIDs } from './mdCodeBlocks.js';
import { ensureNavLinksUUIDs } from './navLinks.js';
import { GUIDE_ADMONITION_TYPES_RE } from './admonitions.js';
import { setRteDisabled } from './richTextEditor.js';
import { escapeHtml } from './cardRenderer.js';
import { renderGuideSectionTree, liveLinkHtml, guideStatusPillHtml, writeGuideDraft, draftPathOf, renderComponents, onComponentEditorClick, setOpenComponentEditor } from './guides.js';

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

registerFormAction('openGuideLiveView', async ({ file, label }) => {
  const draftPath = draftPathOf(file);
  // A failed probe is treated as "no draft" and falls through to the live
  // view; the live read below reports its own failure in the content area.
  let hasDraft = false;
  try { hasDraft = !!(await readRepoText(draftPath)); } catch { /* treat as no draft */ }
  if (hasDraft) {
    return getFormAction('openGuideEntry')({ filePath: file, label });
  }

  const { formEl } = await createForm('guideEntry');
  if (!formEl) return;
  formEl.dataset.viewOnly = '';
  formEl.dataset.livePath = file;
  const title = label || file.split('/').pop().replace(/\.md$/, '');
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
  const pageTitle = label || file.split('/').pop().replace(/\.md$/, '');
  formEl.parentElement.addEventListener('click', e => {
    const btn = e.target.closest('[data-guide-live-create]');
    if (btn) createDraftFromView(btn, formEl.parentElement, file, pageTitle);
  });

  const listEl = formEl.querySelector('[data-section-components]');
  renderComponents(listEl, model.components, true, { viewOnly: true });
  setOpenComponentEditor({ formEl, listEl, container: { kind: 'guide-section', uuid: model.uuid, file }, components: model.components });
  formEl.addEventListener('click', onComponentEditorClick);
});
