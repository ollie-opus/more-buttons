/**
 * usagePanel.js — the shared "Used on pages" block for the media entry forms
 * (captureEntry / videoEntry / imageEntry, browse flavour only).
 *
 * Renders a kbTree of every page whose markdown references the entry's file,
 * from the media usage index (one GET; auto-backfilled on first use — see
 * mediaUsageStore.js). Leaves navigate to the page's editor with the same
 * routing as the KB management tree, pushing a breadcrumb.
 */

import { createForm, navigateBack, setButtonBusy, snapshotButton, restoreButton } from './form.js';
import { getFormAction } from './formActions.js';
import { githubDeleteFile } from './github.js';
import { renderTree, applySearch } from './kbTree.js';
import { loadUsageContext } from './mediaUsageStore.js';
import { pageBasesUsingMedia, buildUsageTreeNodes } from './mediaUsage.js';
import { showDangerConfirm, showNotice } from './confirmPanel.js';

const panelShell = (inner) => `
  <div class="more-buttons-form-group more-buttons-form-group--full" data-usage-panel>
    <label class="more-buttons-label">Used on pages</label>
    ${inner}
  </div>`;


/**
 * Resolve the set of page/draft bases referencing any of `mediaPaths`. Shared
 * by the panel build and the click-time delete recheck. THROWS on a
 * usage-context load failure so callers can fail closed — an empty index and a
 * failed load must not look alike (readMediaUsage's {} would read as unused).
 */
async function usageBasesFor(mediaPaths) {
  const { index, nav, draftNav } = await loadUsageContext();
  return { bases: pageBasesUsingMedia(index, (mediaPaths ?? []).filter(Boolean)), nav, draftNav };
}

/**
 * Build the panel for one media file's candidate repo paths ([light, dark]
 * for pairs, [single] otherwise). Returns { html, unused } — `unused` is true
 * only when the index loaded AND no page or draft references the file(s), so
 * a usage failure fails closed (no delete offer) while still degrading the
 * panel to a one-line message so the previews always render. Never throws.
 */
export async function buildUsagePanelHtml(mediaPaths) {
  try {
    const { bases, nav, draftNav } = await usageBasesFor(mediaPaths);
    const nodes = buildUsageTreeNodes(nav, draftNav, bases);
    return {
      html: panelShell(renderTree(nodes, { emptyMessage: 'Not used on any pages.' })),
      unused: bases.size === 0,
    };
  } catch (err) {
    console.warn('usage panel failed', err);
    return {
      html: panelShell('<p class="more-buttons-description">Couldn’t load page usage.</p>'),
      unused: false,
    };
  }
}

/**
 * Shared delete flow for the entry forms' "Delete" dock button — only ever
 * offered when buildUsagePanelHtml reported unused. Re-checks usage at click
 * time (the button was rendered from the index as of form open), confirms via
 * the inline danger panel, then deletes every non-null path (a half pair
 * passes [light, null]; githubDeleteFile also no-ops on 404), runs the
 * optional cleanup (captures drop their .captures-meta.json entry), and
 * navigates back — replaying openMediaLibrary re-fetches the tree, so the
 * entry disappears without extra wiring.
 */
export async function deleteMediaEntry({ button, noun, label, paths, cleanup }) {
  const files = (paths ?? []).filter(Boolean);
  if (!files.length) return;
  // The dock lives on the overlay-content wrapper (form.js relocates
  // .more-buttons-form-actions there), which is also the panel host.
  const host = button.closest('.more-buttons-overlay-content') ?? document.body;
  const snap = snapshotButton(button);

  // Click-time freshness recheck: a page may reference the file by now, or the
  // index may fail to load — both abort (fail closed, like buildUsagePanelHtml).
  setButtonBusy(button, 'Checking usage…');
  let bases;
  try {
    ({ bases } = await usageBasesFor(files));
  } catch (err) {
    console.warn('usage recheck failed', err);
    restoreButton(button, snap);
    await showNotice(host, {
      title: 'Couldn’t verify usage',
      message: `The page-usage index couldn’t be loaded, so the ${noun} was not deleted. Try again in a moment.`,
    });
    return;
  }
  restoreButton(button, snap);
  if (bases.size > 0) {
    await showNotice(host, {
      title: 'Now in use',
      message: `This ${noun} is now referenced on a page. Reopen the form to see where it’s used.`,
    });
    return;
  }

  const plural = files.length > 1 ? 's' : '';
  const ok = await showDangerConfirm(host, {
    title: `Delete the ${noun} “${label}”?`,
    message: `This permanently removes the file${plural} from GitHub. This cannot be undone.`,
  });
  if (!ok) return;

  setButtonBusy(button, 'Deleting…');
  try {
    for (const p of files) await githubDeleteFile(p, s => setButtonBusy(button, s));
    await cleanup?.(s => setButtonBusy(button, s));
    await navigateBack();
  } catch (e) {
    restoreButton(button, snap);
    await showNotice(host, { title: 'Delete failed', message: `Failed to delete ${noun}: ${e.message}` });
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
