// Shared tree renderer + search filter for KB-style nav trees.
// Used by knowledgeBaseManagement and mediaLibrary.
//
// Node format:
//   { kind: 'file',   label, attrs?: { 'data-x': 'y', ... } }
//   { kind: 'folder', label, children: Node[] }
//
// Leaves are marked data-kb-leaf (selector used by applySearch). Extra
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
// to the pre-reorder render (the media-library caller is unaffected).
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
  const attrPairs = Object.entries(node.attrs ?? {})
    .map(([k, v]) => `${k}="${escapeAttr(v)}"`).join(' ');
  const button = `<button class="mb-kb-node-row" type="button" data-kb-section ${attrPairs}${pathAttr}>
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

// Segment normalization for path-mode search: folds whitespace to hyphens so
// a typed slug ("occ-captures") matches its humanized label ("Occ captures").
const normalizeSegment = (s) => s.trim().toLowerCase().replace(/\s+/g, '-');

// labelPath: display labels root→leaf, e.g. ['Sites', 'uuid', 'todos', 'Edit page'].
// A query without '/' is a plain substring match on the leaf label. A query
// with '/' matches the whole path as a root-anchored prefix: 'sites/uuid/todos'
// shows everything under that folder, but not 'admin/sites/uuid/todos'.
export function searchMatches(labelPath, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (!q.includes('/')) {
    const leaf = labelPath[labelPath.length - 1] ?? '';
    return leaf.trim().toLowerCase().includes(q);
  }
  const path = labelPath.map(normalizeSegment).join('/');
  const wanted = q.split('/').filter(Boolean).map(normalizeSegment).join('/');
  return path.startsWith(wanted);
}

// Narrow the tree to leaves that match `query` (see searchMatches) AND, when
// one is given, `predicate(leafButton)`. Matching leaves and their ancestors
// stay; everything else is hidden, so folders with no surviving leaves vanish
// and collapsed folders auto-expand (data-search-active) for either kind of
// narrowing. Returns leaf counts so a caller can report "shown of total";
// search-only callers pass no predicate and ignore the return.
export function applySearch(tree, query, { predicate = null } = {}) {
  const q = query.trim().toLowerCase();
  tree.querySelectorAll('.mb-kb-node').forEach(n => n.classList.remove('--search-hidden', '--search-match'));
  const leaves = tree.querySelectorAll('[data-kb-leaf]');
  const total = leaves.length;
  if (!q && !predicate) {
    tree.removeAttribute('data-search-active');
    return { shown: total, total };
  }
  tree.setAttribute('data-search-active', '');
  let shown = 0;
  // Own-row lookup: a folder's .mb-kb-node contains its descendants' rows too,
  // and reorder mode wraps the row button in .mb-kb-row-line.
  const ownRow = (node) => node.querySelector(
    ':scope > .mb-kb-node-row, :scope > .mb-kb-row-line > .mb-kb-node-row'
  );
  leaves.forEach(btn => {
    // Match labels only — decorations (e.g. pills) live in the row too but
    // must not count toward search hits. Synthetic grouping folders
    // (data-kb-group, e.g. "Live pages" in the internal-page picker) are UI
    // chrome, not directories, so they don't contribute a path segment.
    const labelPath = [];
    let node = btn.closest('.mb-kb-node');
    while (node && tree.contains(node)) {
      const row = ownRow(node);
      if (row && !row.hasAttribute('data-kb-group')) {
        labelPath.unshift(row.querySelector('.mb-kb-node-label')?.textContent ?? '');
      }
      node = node.parentElement?.closest('.mb-kb-node');
    }
    if (searchMatches(labelPath, query) && (!predicate || predicate(btn))) {
      shown++;
      let hit = btn.closest('.mb-kb-node');
      while (hit && tree.contains(hit)) {
        hit.classList.add('--search-match');
        hit = hit.parentElement?.closest('.mb-kb-node');
      }
    }
  });
  tree.querySelectorAll('.mb-kb-node:not(.--search-match)').forEach(n => n.classList.add('--search-hidden'));
  return { shown, total };
}
