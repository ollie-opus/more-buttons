import { createForm } from './form.js';
import { readRepoText } from './repoClient.js';
import { getFormAction } from './formActions.js';
import { renderTree, applySearch } from './kbTree.js';
import { parseNavBlock, slugify } from './navToml.js';

const EXCLUDED_SECTIONS = new Set(['Home', 'System']);

// Pages whose draft file is an internal workflow detail, not a "page being
// drafted" — they never show the Drafting pill (Live only).
const DRAFT_PILL_EXEMPT = new Set(['system-updates.md', 'system-status.md']);

// Merge two lists of normalized nav nodes. Sections are merged by slug of their
// display name (so nav "Guides" and draft_nav "Guides" combine); leaves are
// unioned by value (first display name wins).
function mergeNavNodes(listA, listB) {
  const out = [];
  for (const node of [...listA, ...listB]) {
    if (node.children) {
      const existing = out.find(n => n.children && slugify(n.name) === slugify(node.name));
      if (existing) existing.children = mergeNavNodes(existing.children, node.children);
      else out.push({ name: node.name, children: mergeNavNodes(node.children, []) });
    } else if (!out.some(n => n.value === node.value)) {
      out.push({ name: node.name, value: node.value });
    }
  }
  return out;
}

// Collect every leaf value in a node list into `set`.
function collectValues(nodes, set) {
  for (const n of nodes) {
    if (n.children) collectValues(n.children, set);
    else set.add(n.value);
  }
  return set;
}

// Tag each tree leaf with Live / Drafting pills. navFiles/draftFiles are sets of
// nav leaf *values* (e.g. "pages/foo.md"), so no folder listing is needed.
function decorateKbPills(panel, draftFiles, navFiles) {
  panel.querySelectorAll('[data-kb-leaf]').forEach(leaf => {
    const file = leaf.dataset.kbFile || '';
    const base = file.split('/').pop();
    if (!file) return;
    const pills = [];
    if (!DRAFT_PILL_EXEMPT.has(base) && draftFiles.has(file)) {
      pills.push('<span class="mb-kb-pill --drafting">Drafting</span>');
    }
    if (navFiles.has(file)) {
      pills.push('<span class="mb-kb-pill --live">Live</span>');
    }
    if (pills.length) {
      leaf.insertAdjacentHTML('beforeend', `<span class="mb-kb-pills">${pills.join('')}</span>`);
    }
  });
}

// Convert a normalized navToml node ({name,value} | {name,children}) to a
// generic kbTree node.
function navNodeToKbNode(node) {
  if (node.children) {
    return { kind: 'folder', label: node.name, children: node.children.map(navNodeToKbNode) };
  }
  return {
    kind: 'file',
    label: node.name,
    attrs: { 'data-kb-file': node.value, 'data-kb-label': node.name },
  };
}

function renderKbHierarchy(nodes) {
  return renderTree(nodes.map(navNodeToKbNode), { emptyMessage: 'No articles found.' });
}

export async function openKnowledgeBaseManagement() {
  const { moreButtonsIntegrations } = await chrome.storage.local.get('moreButtonsIntegrations');
  if (moreButtonsIntegrations?.githubPAT) {
    const { formEl } = await createForm('knowledgeBaseManagement', openKnowledgeBaseManagement);
    if (!formEl) return;

    const livePanel = formEl.querySelector('[data-kb-panel="guides"]');
    const systemPanel = formEl.querySelector('[data-kb-panel="system"]');

    if (livePanel) livePanel.innerHTML = '<p class="more-buttons-description">Loading…</p>';
    if (systemPanel) systemPanel.innerHTML = '<p class="more-buttons-description">Loading…</p>';

    try {
      // One fetch of zensical.toml drives everything: the tree is the union of
      // nav (live) and draft_nav (in-progress), and pills come from membership
      // in each set of leaf values — no per-folder listing needed.
      const tomlText = await readRepoText('zensical.toml');
      const nav = parseNavBlock(tomlText, 'nav').items;
      const draftNav = parseNavBlock(tomlText, 'draft_nav').items;
      const navFiles = collectValues(nav, new Set());
      const draftFiles = collectValues(draftNav, new Set());

      if (livePanel) {
        const guideNav = nav.filter(n => !EXCLUDED_SECTIONS.has(n.name));
        const merged = mergeNavNodes(guideNav, draftNav).filter(n => !EXCLUDED_SECTIONS.has(n.name));
        livePanel.innerHTML = renderKbHierarchy(merged);
        decorateKbPills(livePanel, draftFiles, navFiles);
      }

      if (systemPanel) {
        const systemEntry = nav.find(n => n.name === 'System' && n.children);
        if (systemEntry) {
          systemPanel.innerHTML = renderKbHierarchy([systemEntry]);
          decorateKbPills(systemPanel, draftFiles, navFiles);
        } else {
          systemPanel.innerHTML = '<p class="more-buttons-description">No system pages found.</p>';
        }
      }
    } catch {
      if (livePanel) livePanel.innerHTML = '<p class="more-buttons-description">Failed to load articles.</p>';
      if (systemPanel) systemPanel.innerHTML = '<p class="more-buttons-description">Failed to load system pages.</p>';
    }

    formEl.addEventListener('input', e => {
      const searchEl = e.target.closest('.mb-kb-search');
      if (!searchEl) return;
      const tree = searchEl.closest('[data-kb-panel]')?.querySelector('.mb-kb-tree');
      if (tree) applySearch(tree, searchEl.value);
    });

    // .more-buttons-form-actions gets moved out of <form> by form.js, so
    // listen on the parent overlay-content to catch both form-internal and
    // moved-out footer clicks.
    formEl.parentElement?.addEventListener('click', async e => {
      if (e.target.closest('[data-kb-open-capture-library]')) {
        await getFormAction('openCaptureLibrary')?.();
        return;
      }
      if (e.target.closest('[data-kb-create-guide]')) {
        await getFormAction('openCreateGuide')?.();
        return;
      }
      const sectionRow = e.target.closest('[data-kb-section]');
      if (sectionRow) {
        sectionRow.closest('.mb-kb-node')?.classList.toggle('--collapsed');
        return;
      }

      const fileEl = e.target.closest('[data-kb-leaf]');
      if (!fileEl) return;
      const file = fileEl.dataset.kbFile;
      const label = fileEl.dataset.kbLabel;
      if (file === 'pages/system-updates.md') await getFormAction('openSystemUpdatesEntry')?.();
      else if (file === 'pages/system-status.md') await createForm('systemStatusEntry');
      else await getFormAction('openGuideEntry')?.({ filePath: file, label });
    });

    return;
  }

  // Not connected — inject CSS if needed and show a simple overlay
  if (!document.getElementById('more-buttons-overlay-stylesheet')) {
    const link = document.createElement('link');
    link.id = 'more-buttons-overlay-stylesheet';
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('config/forms/formsStyling.css');
    (document.head || document.documentElement).appendChild(link);
  }

  const overlay = document.createElement('div');
  overlay.className = 'more-buttons-overlay';
  const content = document.createElement('div');
  content.className = 'more-buttons-overlay-content';
  content.setAttribute('role', 'dialog');
  content.setAttribute('aria-modal', 'true');
  content.innerHTML = `
    <h2>GitHub not connected</h2>
    <p class="more-buttons-description">Please add a GitHub PAT in Integrations to use this feature.</p>
    <div class="more-buttons-form-actions">
      <button type="button" class="more-buttons-button" id="mb-open-integrations">Open Integrations</button>
      <button type="button" class="more-buttons-button secondary" id="mb-close-not-connected">Close</button>
    </div>`;
  overlay.appendChild(content);
  document.body.appendChild(overlay);

  const cleanup = () => { overlay.remove(); document.removeEventListener('keydown', handleKey); };
  const handleKey = e => { if (e.key === 'Escape') cleanup(); };
  document.addEventListener('keydown', handleKey);
  overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(); });
  content.querySelector('#mb-close-not-connected').addEventListener('click', cleanup);
  content.querySelector('#mb-open-integrations').addEventListener('click', () => {
    cleanup();
    getFormAction('openIntegrations')?.();
  });
}
