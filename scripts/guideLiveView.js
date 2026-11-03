// Read-only view of a live guide page. Leaf module: imports from guides.js,
// never the reverse (guides.js dispatches here by registry name). The only
// write reachable from here is the banner's Create draft via writeGuideDraft.
import { registerFormAction, getFormAction } from './formActions.js';
import { createForm, setCrumbLabel, navigateBack, isFormReplay, snapshotButton, restoreButton } from './form.js';
import { formLoading } from './loading.js';
import { readRepoText } from './repoClient.js';
import { migrateGuideIdentity } from './github.js';
import { buildSectionTree, readSectionDescription } from './sections.js';
import { parseComponents } from './components.js';
import { GUIDE_ADMONITION_TYPES_RE } from './admonitions.js';
import { setRteDisabled } from './richTextEditor.js';
import { escapeHtml } from './cardRenderer.js';
import { renderGuideSectionTree, liveLinkHtml, guideStatusPillHtml, writeGuideDraft, renderComponents, onComponentEditorClick, setOpenComponentEditor } from './guides.js';

export function liveBannerHtml({ createDraft = false } = {}) {
  return '<div class="mb-live-banner" data-live-banner><span class="more-buttons-icon">eye</span>'
    + '<span class="mb-live-banner__text">Viewing the live page. Nothing here can be edited. Create a draft to make changes.</span>'
    + (createDraft ? '<button type="button" class="more-buttons-button mb-live-banner__btn" data-guide-live-create><span class="more-buttons-icon">plus</span>Create draft</button>' : '')
    + '</div>';
}

async function createDraftFromBanner(btn, livePath, title) {
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
    // navigateBack is a no-op at history cursor 0 (cold restore): land on the
    // draft screen directly so the button never sticks on "Creating draft…".
    const wentBack = await navigateBack();
    if (!wentBack) {
      restoreButton(btn, snap);
      await getFormAction('openGuideEntry')({ filePath: livePath.replace(/^docs\//, ''), label: title });
    }
  } catch (e) {
    restoreButton(btn, snap);
    alert('Failed to create draft: ' + e.message);
  }
}

registerFormAction('openGuideLiveView', async ({ file, label }) => {
  const draftPath = file.replace(/^docs\/pages\//, 'docs/drafts/');
  // A failed probe is treated as "no draft" and falls through to the live
  // view; the live read below reports its own failure in the content area.
  let hasDraft = false;
  try { hasDraft = !!(await readRepoText(draftPath)); } catch { /* treat as no draft */ }
  if (hasDraft) {
    return getFormAction('openGuideEntry')({ filePath: file.replace(/^docs\//, ''), label });
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
  formEl.parentElement.querySelector('[data-guide-actions]').innerHTML = liveLinkHtml(file);

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
    + renderGuideSectionTree(migrateGuideIdentity(md), { viewOnly: true });

  formEl.parentElement.addEventListener('click', e => {
    const sec = e.target.closest('[data-view-guide-section]');
    if (sec) {
      formLoading.show();
      Promise.resolve(getFormAction('openGuideSectionLiveView')?.({ file, index: Number(sec.dataset.viewGuideSection) }))
        .finally(() => formLoading.dismiss());
      return;
    }
    const btn = e.target.closest('[data-guide-live-create]');
    if (btn) createDraftFromBanner(btn, file, title);
  });
});

export function liveSectionModel(markdown, index) {
  const md = migrateGuideIdentity(markdown);
  const node = buildSectionTree(md).sections[index];
  if (!node) return null;
  const body = readSectionDescription(md, node.uuid).descriptionMarkdown;
  const { description, components } = parseComponents(body, GUIDE_ADMONITION_TYPES_RE);
  return { uuid: node.uuid, title: node.title, visualLabel: node.visualLabel, description, components };
}

registerFormAction('openGuideSectionLiveView', async ({ file, index }) => {
  let model;
  try { model = liveSectionModel(await readRepoText(file), index); }
  catch { alert('Failed to load live page.'); return; }
  if (!model) { alert('Section not found.'); return; }

  // Same seeding as openEditGuideSection so a replay paints the same content.
  if (!isFormReplay()) {
    await chrome.storage.local.set({ moreButtonsEditGuideSection: {
      sectionTitle: model.title, sectionDescription: model.description, sectionParent: '', hideSectionTitle: false } });
  }
  const { formEl } = await createForm('editGuideSection');
  if (!formEl) return;
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

  formEl.parentElement.querySelector('.more-buttons-form-actions').innerHTML = liveLinkHtml(file);

  const listEl = formEl.querySelector('[data-section-components]');
  renderComponents(listEl, model.components, true, { viewOnly: true });
  setOpenComponentEditor({ formEl, listEl, container: { kind: 'guide-section', uuid: model.uuid, file }, components: model.components });
  formEl.addEventListener('click', onComponentEditorClick);
});
