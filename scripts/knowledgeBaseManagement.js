import { createForm } from './form.js';
import { readRepoText } from './repoClient.js';
import { getFormAction, registerFormAction } from './formActions.js';
import { renderTree, applySearch } from './kbTree.js';
import { parseNavBlock, slugify, replaceNavBlock } from './navToml.js';
import { formLoading } from './loading.js';
import { createReorderState } from './kbReorder.js';
import { githubFetchAndPushFile } from './github.js';

const EXCLUDED_SECTIONS = new Set(['Home', 'System']);

// Pages whose draft file is an internal workflow detail, not a "page being
// drafted" — they never show the Drafting pill (Live only).
const DRAFT_PILL_EXEMPT = new Set(['system-updates.md', 'system-status.md']);

// The filename shared by a page's live and draft entries: "pages/foo.md" and
// "drafts/foo.md" both → "foo.md". Filenames are globally unique (drafts/ is flat
// and submitCreateGuide rejects slug collisions), so this is a safe identity key
// for uniting a nav (live) leaf with its draft_nav (draft) counterpart.
const baseOf = (value) => String(value).split('/').pop();

// Merge two lists of normalized nav nodes. Sections are merged by slug of their
// display name (so nav "Guides" and draft_nav "Guides" combine); leaves are
// unioned by filename — NOT exact value — so a live "pages/foo.md" and its draft
// "drafts/foo.md" collapse to one node (first display name wins; nav passed first).
function mergeNavNodes(listA, listB) {
  const out = [];
  for (const node of [...listA, ...listB]) {
    if (node.children) {
      const existing = out.find(n => n.children && slugify(n.name) === slugify(node.name));
      if (existing) existing.children = mergeNavNodes(existing.children, node.children);
      else out.push({ name: node.name, children: mergeNavNodes(node.children, []) });
    } else if (!out.some(n => n.value !== undefined && baseOf(n.value) === baseOf(node.value))) {
      out.push({ name: node.name, value: node.value });
    }
  }
  return out;
}

// Drop every leaf whose filename is in `bases`; prune folders left empty.
// Used to make draft_nav the authority for a page's tree location: a page that
// has a draft renders ONLY at its draft_nav placement, never also at its (possibly
// stale, post-Path-edit) live nav placement — which otherwise shows the page twice.
function pruneLeavesByBase(nodes, bases) {
  const out = [];
  for (const n of nodes) {
    if (n.children) {
      const kids = pruneLeavesByBase(n.children, bases);
      if (kids.length) out.push({ name: n.name, children: kids });
    } else if (!bases.has(baseOf(n.value))) {
      out.push(n);
    }
  }
  return out;
}

// Collect every leaf's filename (baseOf its value) into `set`.
function collectValues(nodes, set) {
  for (const n of nodes) {
    if (n.children) collectValues(n.children, set);
    else set.add(baseOf(n.value));
  }
  return set;
}

// Tag each tree leaf with Live / Drafting pills. navFiles/draftFiles are sets of
// leaf *filenames* (e.g. "foo.md") — keyed on basename so a node merged from a
// pages/ nav entry and a drafts/ draft_nav entry matches both sets.
function decorateKbPills(panel, draftFiles, navFiles) {
  panel.querySelectorAll('[data-kb-leaf]').forEach(leaf => {
    const file = leaf.dataset.kbFile || '';
    const base = baseOf(file);
    if (!file) return;
    const pills = [];
    if (!DRAFT_PILL_EXEMPT.has(base) && draftFiles.has(base)) {
      pills.push('<span class="mb-kb-pill --drafting">Drafting</span>');
    }
    if (navFiles.has(base)) {
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

function footerBarHtml() {
  return `<div class="mb-kb-reorder-bar" hidden>
    <span class="mb-kb-reorder-status"><span class="mb-kb-reorder-dot"></span>Unsaved changes</span>
    <span class="mb-kb-reorder-actions">
      <button type="button" class="more-buttons-button secondary" data-kb-reorder-discard>Discard</button>
      <button type="button" class="more-buttons-button" data-kb-reorder-save>Save order</button>
    </span>
  </div>`;
}

// Build a small popover anchored to the Move… button: existing sections + a
// "new path" input. Calls reorder.moveToPath / moveToSegments then re-renders.
function openMoveToPicker(anchorBtn, reorder, rerender) {
  document.querySelector('.mb-kb-move-pop')?.remove();
  const srcPath = anchorBtn.dataset.kbPath;
  const targets = reorder.sectionTargets()
    .filter(t => t.pathStr !== srcPath);   // can't move into itself
  const pop = document.createElement('div');
  pop.className = 'mb-kb-move-pop';
  pop.innerHTML = `
    <div class="mb-kb-move-title">Move to…</div>
    <button type="button" class="mb-kb-move-opt" data-target="">— Top level —</button>
    ${targets.map(t => `<button type="button" class="mb-kb-move-opt" data-target="${t.pathStr}">${t.label}</button>`).join('')}
    <div class="mb-kb-move-new">
      <input type="text" class="mb-kb-move-input" placeholder="Type a new path… e.g. guides/contractors" />
    </div>`;
  anchorBtn.closest('.mb-kb-node').appendChild(pop);

  pop.addEventListener('click', e => {
    const opt = e.target.closest('.mb-kb-move-opt');
    if (!opt) return;
    reorder.moveToPath(srcPath, opt.dataset.target || null);
    pop.remove();
    rerender();
  });
  pop.querySelector('.mb-kb-move-input').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const segments = e.target.value.split('/').map(s => s.trim()).filter(Boolean);
    if (segments.length) reorder.moveToSegments(srcPath, segments);
    pop.remove();
    rerender();
  });
  // Dismiss on outside click.
  setTimeout(() => document.addEventListener('click', function dismiss(ev) {
    if (!pop.contains(ev.target) && ev.target !== anchorBtn) {
      pop.remove(); document.removeEventListener('click', dismiss);
    }
  }), 0);
}

// Commit both nav and draft_nav in a single zensical.toml push, behind the veil.
async function saveReorder(reorder, formEl) {
  const { nav, draftNav } = reorder.buildPayload();
  formLoading.show();
  try {
    await githubFetchAndPushFile('zensical.toml', () => {}, md => {
      const out1 = replaceNavBlock(md, 'nav', nav);
      return replaceNavBlock(out1, 'draft_nav', draftNav);
    });
    await getFormAction('openKnowledgeBaseManagement')();  // reload fresh tree
  } catch (e) {
    alert('Failed to save order: ' + e.message);
  } finally {
    formLoading.dismiss();
  }
}

async function renderKnowledgeBaseManagement() {
  const { moreButtonsIntegrations } = await chrome.storage.local.get('moreButtonsIntegrations');
  if (moreButtonsIntegrations?.githubPAT) {
    const { formEl } = await createForm('knowledgeBaseManagement', openKnowledgeBaseManagement, { rootEntry: true });
    if (!formEl) return;

    const livePanel = formEl.querySelector('[data-kb-panel="guides"]');
    const systemPanel = formEl.querySelector('[data-kb-panel="system"]');

    let reorder = null;
    let rerenderGuides = () => {};

    formLoading.show();
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
        // Strip live leaves that have a draft so draft_nav owns their placement;
        // the live nav entry may sit in a stale folder after a Path edit, which
        // would otherwise render the page twice (once live, once drafting).
        const guideNav = pruneLeavesByBase(nav.filter(n => !EXCLUDED_SECTIONS.has(n.name)), draftFiles);
        const merged = mergeNavNodes(guideNav, draftNav).filter(n => !EXCLUDED_SECTIONS.has(n.name));
        reorder = createReorderState({ tree: merged, navItems: nav, draftItems: draftNav });
        livePanel.innerHTML =
          renderTree(merged.map(navNodeToKbNode), { emptyMessage: 'No articles found.', reorderable: true })
          + footerBarHtml();
        decorateKbPills(livePanel, draftFiles, navFiles);
        rerenderGuides = () => {
          livePanel.innerHTML =
            renderTree(reorder.getTree().map(navNodeToKbNode), { emptyMessage: 'No articles found.', reorderable: true })
            + footerBarHtml();
          decorateKbPills(livePanel, draftFiles, navFiles);
          const bar = livePanel.querySelector('.mb-kb-reorder-bar');
          if (bar) bar.hidden = !reorder.isDirty();
        };
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
    } finally {
      formLoading.dismiss();
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
      if (reorder) {
        const up = e.target.closest('[data-kb-move-up]');
        const down = e.target.closest('[data-kb-move-down]');
        const moveTo = e.target.closest('[data-kb-move-to]');
        if (up || down) {
          const el = up || down;
          reorder.move(el.dataset.kbPath, up ? 'up' : 'down');
          rerenderGuides();
          return;
        }
        if (moveTo) {
          openMoveToPicker(moveTo, reorder, rerenderGuides);
          return;
        }
        if (e.target.closest('[data-kb-reorder-discard]')) {
          await getFormAction('openKnowledgeBaseManagement')();   // reload from toml
          return;
        }
        if (e.target.closest('[data-kb-reorder-save]')) {
          await saveReorder(reorder, formEl);
          return;
        }
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
      <button type="button" class="more-buttons-button" id="mb-open-integrations"><span class="more-buttons-icon">extension</span>Open integrations</button>
      <button type="button" class="more-buttons-button secondary" id="mb-close-not-connected"><span class="more-buttons-icon">close</span>Close</button>
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

registerFormAction('openKnowledgeBaseManagement', renderKnowledgeBaseManagement);

// Public entry point (the buttons.json action + the back-nav opener). Routes
// through the form-action registry so the KB view is opened with a serialisable
// descriptor. Without it, snapshotFormStack/replayFormStack — which only replay
// the contiguous descriptor-carrying suffix of the stack — drop the root
// "Knowledge Base" crumb whenever a capture / library round-trip rebuilds the
// form stack (e.g. inserting a capture from the library while editing a section).
export function openKnowledgeBaseManagement() {
  return getFormAction('openKnowledgeBaseManagement')();
}
