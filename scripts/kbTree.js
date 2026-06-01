// Shared tree renderer + search filter for KB-style nav trees.
// Used by knowledgeBaseManagement and captureLibrary.
//
// Node format:
//   { kind: 'file',   label, attrs?: { 'data-x': 'y', ... } }
//   { kind: 'folder', label, children: Node[] }
//
// Leaves always carry data-kb-file (selector used by applySearch). Extra
// per-leaf metadata flows through `attrs`.

const escapeAttr = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function renderNode(node) {
  if (node.kind === 'file') {
    const attrPairs = Object.entries(node.attrs ?? {})
      .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
      .join(' ');
    return `<div class="mb-kb-node">
      <button class="mb-kb-node-row" type="button" data-kb-leaf ${attrPairs}>
        <span class="mb-kb-node-icon material-symbols-outlined">description</span>
        ${escapeHtml(node.label)}
      </button>
    </div>`;
  }

  const childrenHtml = (node.children ?? []).map(renderNode).join('');
  return `<div class="mb-kb-node">
    <button class="mb-kb-node-row" type="button" data-kb-section>
      <span class="mb-kb-node-icon mb-kb-arrow material-symbols-outlined">chevron_right</span>
      ${escapeHtml(node.label)}
    </button>
    <div class="mb-kb-node-children">${childrenHtml}</div>
  </div>`;
}

export function renderTree(nodes, { emptyMessage = 'Nothing found.' } = {}) {
  if (!nodes || nodes.length === 0) {
    return `<p class="more-buttons-description">${escapeHtml(emptyMessage)}</p>`;
  }
  return `
    <input type="search" class="mb-kb-search" placeholder="Search…" aria-label="Search">
    <div class="mb-kb-tree">${nodes.map(renderNode).join('')}</div>
  `;
}

export function applySearch(tree, query) {
  const q = query.trim().toLowerCase();
  tree.querySelectorAll('.mb-kb-node').forEach(n => n.classList.remove('--search-hidden', '--search-match'));
  if (!q) {
    tree.removeAttribute('data-search-active');
    return;
  }
  tree.setAttribute('data-search-active', '');
  tree.querySelectorAll('[data-kb-leaf]').forEach(btn => {
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
