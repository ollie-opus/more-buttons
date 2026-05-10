import { createForm } from './form.js';
import { readRepoText } from './repoClient.js';

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

function renderKbItem(item) {
  if (typeof item === 'string') {
    return `<div class="mb-kb-node">
      <button class="mb-kb-node-row" type="button" data-kb-file="${item}">
        <span class="mb-kb-node-icon material-symbols-outlined">description</span>
        ${item.split('/').pop().replace(/\.md$/, '')}
      </button>
    </div>`;
  }

  const [displayName, value] = Object.entries(item)[0];

  if (typeof value === 'string') {
    return `<div class="mb-kb-node">
      <button class="mb-kb-node-row" type="button" data-kb-file="${value}">
        <span class="mb-kb-node-icon material-symbols-outlined">description</span>
        ${displayName}
      </button>
    </div>`;
  }

  const childrenHtml = Array.isArray(value)
    ? value.map(child => renderKbItem(child)).join('')
    : '';

  return `<div class="mb-kb-node">
    <button class="mb-kb-node-row" type="button" data-kb-section>
      <span class="mb-kb-node-icon mb-kb-arrow material-symbols-outlined">chevron_right</span>
      ${displayName}
    </button>
    <div class="mb-kb-node-children">${childrenHtml}</div>
  </div>`;
}

function applySearch(tree, query) {
  const q = query.trim().toLowerCase();
  tree.querySelectorAll('.mb-kb-node').forEach(n => n.classList.remove('--search-hidden', '--search-match'));
  if (!q) {
    tree.removeAttribute('data-search-active');
    return;
  }
  tree.setAttribute('data-search-active', '');
  tree.querySelectorAll('[data-kb-file]').forEach(btn => {
    if (btn.textContent.trim().toLowerCase().includes(q)) {
      let node = btn.closest('.mb-kb-node');
      while (node && tree.contains(node)) {
        node.classList.add('--search-match');
        node = node.parentElement?.closest('.mb-kb-node');
      }
    }
  });
  tree.querySelectorAll('.mb-kb-node:not(.--search-match)').forEach(n => n.classList.add('--search-hidden'));
}

function renderKbHierarchy(items) {
  if (!items || items.length === 0) {
    return '<p class="more-buttons-description">No articles found.</p>';
  }
  return `
    <input type="search" class="mb-kb-search" placeholder="Search…" aria-label="Search articles">
    <div class="mb-kb-tree">${items.map(item => renderKbItem(item)).join('')}</div>
  `;
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

    formEl.addEventListener('click', async e => {
      const sectionRow = e.target.closest('[data-kb-section]');
      if (sectionRow) {
        sectionRow.closest('.mb-kb-node')?.classList.toggle('--collapsed');
        return;
      }

      const fileEl = e.target.closest('[data-kb-file]');
      if (!fileEl) return;
      const file = fileEl.dataset.kbFile;
      if (file === 'pages/system-updates.md') await createForm('systemUpdatesEntry');
      else if (file === 'pages/system-status.md') await createForm('systemStatusEntry');
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
    createForm('integrations');
  });
}
