/**
 * usagePanel.js — the shared "Used on pages" block for the media entry forms
 * (captureEntry / videoEntry / imageEntry, browse flavour only).
 *
 * Renders a kbTree of every page whose markdown references the entry's file,
 * from the media usage index (one GET; auto-backfilled on first use — see
 * mediaUsageStore.js). Leaves navigate to the page's editor with the same
 * routing as the KB management tree, pushing a breadcrumb.
 */

import { createForm } from './form.js';
import { getFormAction } from './formActions.js';
import { renderTree, applySearch } from './kbTree.js';
import { loadUsageContext } from './mediaUsageStore.js';
import { pageBasesUsingMedia, buildUsageTreeNodes } from './mediaUsage.js';

const panelShell = (inner) => `
  <div class="more-buttons-form-group more-buttons-form-group--full" data-usage-panel>
    <label class="more-buttons-label">Used on pages</label>
    ${inner}
  </div>`;

/**
 * Build the panel's HTML for one media file's candidate repo paths
 * ([light, dark] for pairs, [single] otherwise). Never throws — a usage
 * failure degrades to a one-line message so the previews always render.
 */
export async function buildUsagePanelHtml(mediaPaths) {
  try {
    const { index, nav, draftNav } = await loadUsageContext();
    const bases = pageBasesUsingMedia(index, (mediaPaths ?? []).filter(Boolean));
    const nodes = buildUsageTreeNodes(nav, draftNav, bases);
    return panelShell(renderTree(nodes, { emptyMessage: 'Not used on any pages.' }));
  } catch (err) {
    console.warn('usage panel failed', err);
    return panelShell('<p class="more-buttons-description">Couldn’t load page usage.</p>');
  }
}

/**
 * Wire the panel's tree once per form: folder rows collapse, leaf rows open
 * the page's editor (KB-management routing — system pages go to their own
 * forms), and the search input filters. Delegated on the content wrapper so
 * it survives bodyEl re-renders; selectors are scoped to [data-usage-panel]
 * so the entry form's own delegates are untouched.
 */
export function wireUsagePanel(formEl) {
  const root = formEl.parentElement ?? formEl;
  root.addEventListener('click', async (e) => {
    const sec = e.target.closest('[data-usage-panel] [data-kb-section]');
    if (sec) { sec.closest('.mb-kb-node')?.classList.toggle('--collapsed'); return; }
    const leaf = e.target.closest('[data-usage-panel] [data-kb-leaf]');
    if (!leaf) return;
    const file = leaf.dataset.usageFile;
    const label = leaf.dataset.usageLabel;
    if (file === 'pages/system-updates.md') await getFormAction('openSystemUpdatesEntry')?.();
    else if (file === 'pages/system-status.md') await createForm('systemStatusEntry');
    else await getFormAction('openGuideEntry')?.({ filePath: file, label });
  });
  formEl.addEventListener('input', (e) => {
    const search = e.target.closest('[data-usage-panel] .mb-kb-search');
    if (!search) return;
    const tree = search.closest('[data-usage-panel]')?.querySelector('.mb-kb-tree');
    if (tree) applySearch(tree, search.value);
  });
}
