import { createForm } from './form.js';
import { readRepoText } from './repoClient.js';
import { getFormAction } from './formActions.js';
import { renderTree, applySearch } from './kbTree.js';

const EXCLUDED_SECTIONS = new Set(['Home', 'System']);

function parseNav(tomlText) {
  const navIdx = tomlText.indexOf('nav');
  if (navIdx === -1) return [];
  const arrStart = tomlText.indexOf('[', navIdx);
  if (arrStart === -1) return [];

  let depth = 0, arrEnd = -1;
  for (let i = arrStart; i < tomlText.length; i++) {
    if (tomlText[i] === '[') depth++;
    else if (tomlText[i] === ']') { depth--; if (depth === 0) { arrEnd = i; break; } }
  }
  if (arrEnd === -1) return [];

  const arrStr = tomlText.slice(arrStart, arrEnd + 1);
  // Convert TOML inline-table syntax to JSON: "key" = value → "key": value
  const jsonStr = arrStr
    .replace(/"(\s*=\s*)/g, '": ')
    .replace(/,(\s*[}\]])/g, '$1');

  try {
    return JSON.parse(jsonStr);
  } catch {
    return [];
  }
}

// Convert a TOML nav item (string | { name: value }) to a generic kbTree node.
function navItemToNode(item) {
  if (typeof item === 'string') {
    return {
      kind: 'file',
      label: item.split('/').pop().replace(/\.md$/, ''),
      attrs: { 'data-kb-file': item },
    };
  }
  const [displayName, value] = Object.entries(item)[0];
  if (typeof value === 'string') {
    return {
      kind: 'file',
      label: displayName,
      attrs: { 'data-kb-file': value, 'data-kb-label': displayName },
    };
  }
  return {
    kind: 'folder',
    label: displayName,
    children: Array.isArray(value) ? value.map(navItemToNode) : [],
  };
}

function renderKbHierarchy(items) {
  return renderTree(items.map(navItemToNode), { emptyMessage: 'No articles found.' });
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
      const tomlText = await readRepoText('zensical.toml');
      const nav = parseNav(tomlText);

      if (livePanel) {
        const liveItems = nav.filter(item =>
          typeof item === 'object' && !EXCLUDED_SECTIONS.has(Object.keys(item)[0])
        );
        livePanel.innerHTML = renderKbHierarchy(liveItems);
      }

      if (systemPanel) {
        const systemEntry = nav.find(item =>
          typeof item === 'object' && Object.keys(item)[0] === 'System'
        );
        systemPanel.innerHTML = systemEntry
          ? renderKbHierarchy([systemEntry])
          : '<p class="more-buttons-description">No system pages found.</p>';
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
      const sectionRow = e.target.closest('[data-kb-section]');
      if (sectionRow) {
        sectionRow.closest('.mb-kb-node')?.classList.toggle('--collapsed');
        return;
      }

      const fileEl = e.target.closest('[data-kb-leaf]');
      if (!fileEl) return;
      const file = fileEl.dataset.kbFile;
      const label = fileEl.dataset.kbLabel;
      if (file === 'pages/system-updates.md') await createForm('systemUpdatesEntry');
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
