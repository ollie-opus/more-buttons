// Read-only view of a live guide page. Leaf module: imports from guides.js,
// never the reverse (guides.js dispatches here by registry name). The only
// write reachable from here is the banner's Create draft via writeGuideDraft.
import { registerFormAction, getFormAction } from './formActions.js';
import { createForm, setCrumbLabel, navigateBack, snapshotButton, restoreButton } from './form.js';
import { formLoading } from './loading.js';
import { readRepoText } from './repoClient.js';
import { migrateGuideIdentity } from './github.js';
import { escapeHtml } from './cardRenderer.js';
import { renderGuideSectionTree, liveLinkHtml, guideStatusPillHtml, writeGuideDraft } from './guides.js';

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
    await navigateBack();
  } catch (e) {
    restoreButton(btn, snap);
    alert('Failed to create draft: ' + e.message);
  }
}

registerFormAction('openGuideLiveView', async ({ file, label }) => {
  const draftPath = file.replace(/^docs\/pages\//, 'docs/drafts/');
  if (await readRepoText(draftPath)) {
    return getFormAction('openGuideEntry')({ filePath: file.replace(/^docs\//, ''), label });
  }

  const { formEl } = await createForm('guideEntry');
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
  try { md = await readRepoText(file); } finally { formLoading.dismiss(); }
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
