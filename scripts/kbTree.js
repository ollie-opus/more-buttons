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

function controlsHtml(idxPath, isFirst, isLast) {
  const path = idxPath.join('.');
  return `<span class="mb-kb-row-controls">
      <button class="mb-kb-ctl" type="button" data-kb-move-up data-kb-path="${path}" title="Move up"${isFirst ? ' disabled' : ''}><span class="material-symbols-outlined">keyboard_arrow_up</span></button>
      <button class="mb-kb-ctl" type="button" data-kb-move-down data-kb-path="${path}" title="Move down"${isLast ? ' disabled' : ''}><span class="material-symbols-outlined">keyboard_arrow_down</span></button>
      <button class="mb-kb-ctl" type="button" data-kb-move-to data-kb-path="${path}" title="Move to…"><span class="material-symbols-outlined">drive_file_move</span></button>
    </span>`;
}

// Reorderable rows wrap the row button and its controls in one horizontal
// `.mb-kb-row-line` so the controls sit inside the row, right of the pills.
// Keeping the controls a SIBLING of the row button (never nested inside it)
// preserves the click-isolation the reorder feature depends on. When
// `reorderable` is off the wrapper is omitted, so the output is byte-identical
// to the pre-reorder render (the capture-library caller is unaffected).
function rowLine(button, ro, idxPath, opts) {
  return ro
    ? `<div class="mb-kb-row-line">${button}${controlsHtml(idxPath, opts.isFirst, opts.isLast)}</div>`
    : button;
}

function renderNode(node, idxPath, opts) {
  const ro = opts.reorderable;
  const pathAttr = ro ? ` data-kb-path="${idxPath.join('.')}"` : '';
  if (node.kind === 'file') {
    const attrPairs = Object.entries(node.attrs ?? {})
      .map(([k, v]) => `${k}="${escapeAttr(v)}"`).join(' ');
    const button = `<button class="mb-kb-node-row" type="button" data-kb-leaf ${attrPairs}${pathAttr}>
        <span class="mb-kb-node-icon material-symbols-outlined">description</span>
        <span class="mb-kb-node-label">${escapeHtml(node.label)}</span>
      </button>`;
    return `<div class="mb-kb-node">
      ${rowLine(button, ro, idxPath, opts)}
    </div>`;
  }
  const kids = node.children ?? [];
  const childrenHtml = kids
    .map((c, i) => renderNode(c, [...idxPath, i], { ...opts, isFirst: i === 0, isLast: i === kids.length - 1 }))
    .join('');
  const button = `<button class="mb-kb-node-row" type="button" data-kb-section${pathAttr}>
      <span class="mb-kb-node-icon mb-kb-arrow material-symbols-outlined">chevron_right</span>
      <span class="mb-kb-node-label">${escapeHtml(node.label)}</span>
    </button>`;
  return `<div class="mb-kb-node">
    ${rowLine(button, ro, idxPath, opts)}
    <div class="mb-kb-node-children">${childrenHtml}</div>
  </div>`;
}

export function renderTree(nodes, { emptyMessage = 'Nothing found.', reorderable = false } = {}) {
  if (!nodes || nodes.length === 0) {
    return `<p class="more-buttons-description">${escapeHtml(emptyMessage)}</p>`;
  }
  const inner = nodes
    .map((n, i) => renderNode(n, [i], { reorderable, isFirst: i === 0, isLast: i === nodes.length - 1 }))
    .join('');
  return `
    <input type="search" class="mb-kb-search" placeholder="Search…" aria-label="Search">
    <div class="mb-kb-tree">${inner}</div>
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
    // Match the label only — decorations (e.g. pills) live in the row too but
    // must not count toward search hits.
    const label = (btn.querySelector('.mb-kb-node-label') ?? btn).textContent;
    if (label.trim().toLowerCase().includes(q)) {
      let node = btn.closest('.mb-kb-node');
      while (node && tree.contains(node)) {
        node.classList.add('--search-match');
        node = node.parentElement?.closest('.mb-kb-node');
      }
    }
  });
  tree.querySelectorAll('.mb-kb-node:not(.--search-match)').forEach(n => n.classList.add('--search-hidden'));
}
