import { createForm, syncDockTag, setButtonBusy, snapshotButton, restoreButton } from './form.js';
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

// Map each leaf's filename → the slug-path of its parent sections
// (e.g. "guides/contractors"). Used to tell whether a draft sits in the same
// section as its live counterpart.
function leafSectionPaths(nodes, prefix = [], out = new Map()) {
  for (const n of nodes) {
    if (n.children) leafSectionPaths(n.children, [...prefix, slugify(n.name)], out);
    else out.set(baseOf(n.value), prefix.join('/'));
  }
  return out;
}

// Bases that draft_nav places in a DIFFERENT section than live nav. Only these
// need pruning from the live tree: their draft sits elsewhere, so keeping the
// live leaf too would render the page twice. A draft at the SAME location is left
// alone — pruning it would drop the live leaf to the END of its merged folder
// (mergeNavNodes appends draft-only leaves), silently reordering the tree.
function movedDraftBases(nav, draftNav) {
  const livePaths = leafSectionPaths(nav);
  const draftPaths = leafSectionPaths(draftNav);
  const moved = new Set();
  for (const [base, dpath] of draftPaths) {
    if (livePaths.has(base) && livePaths.get(base) !== dpath) moved.add(base);
  }
  return moved;
}

// Build the merged Guides tree shown in the KB form: live pages (nav unioned
// with unlisted_nav — the two are disjoint, an unlisted page is simply parked in
// the other array at the same section path) unioned with draft_nav. A page
// drafted in place keeps its live position; a page moved in the draft is pruned
// from its (stale) live spot so draft_nav owns its placement. Unlisted pages are
// filtered, not tabbed: they live in this one tree and carry the Unlisted pill.
export function buildGuideTree(nav, draftNav, unlistedNav = []) {
  const guides = nav.filter(n => !EXCLUDED_SECTIONS.has(n.name));
  const unlisted = unlistedNav.filter(n => !EXCLUDED_SECTIONS.has(n.name));
  const live = mergeNavNodes(guides, unlisted);
  const liveNav = pruneLeavesByBase(live, movedDraftBases(live, draftNav));
  return mergeNavNodes(liveNav, draftNav).filter(n => !EXCLUDED_SECTIONS.has(n.name));
}

// Filter-row state (draft: all|drafting|none, vis: all|public|unlisted).
// Module-level rather than per-render so it survives the full form rebuild
// openKnowledgeBaseManagement does after a reorder save.
const kbFilter = { draft: 'all', vis: 'all' };

// Leaf predicate for the current filter state, reading the data-kb-drafting /
// data-kb-unlisted attributes decorateKbPills stamps — so the filters can never
// disagree with the pills. null when nothing narrows (All / All), which lets
// applySearch treat the tree as plain search.
function kbFilterPredicate() {
  const { draft, vis } = kbFilter;
  if (draft === 'all' && vis === 'all') return null;
  return (leaf) => {
    if (draft !== 'all' && leaf.hasAttribute('data-kb-drafting') !== (draft === 'drafting')) return false;
    if (vis !== 'all' && leaf.hasAttribute('data-kb-unlisted') !== (vis === 'unlisted')) return false;
    return true;
  };
}

// Collect every leaf's filename (baseOf its value) into `set`.
function collectValues(nodes, set) {
  for (const n of nodes) {
    if (n.children) collectValues(n.children, set);
    else set.add(baseOf(n.value));
  }
  return set;
}

// Tag each tree leaf with Live / Drafting / Unlisted pills. navFiles/draftFiles/
// unlistedFiles are sets of leaf *filenames* (e.g. "foo.md") — keyed on basename
// so a node merged from a pages/ nav entry and a drafts/ draft_nav entry matches
// all the sets. The same verdicts are stamped as data-kb-drafting /
// data-kb-unlisted boolean attributes, which the filter row's predicate reads —
// one source of truth for what the pills say and what the filters match.
function decorateKbPills(panel, draftFiles, navFiles, unlistedFiles = new Set()) {
  panel.querySelectorAll('[data-kb-leaf]').forEach(leaf => {
    const file = leaf.dataset.kbFile || '';
    const base = baseOf(file);
    if (!file) return;
    const drafting = !DRAFT_PILL_EXEMPT.has(base) && draftFiles.has(base);
    const unlisted = unlistedFiles.has(base);
    leaf.toggleAttribute('data-kb-drafting', drafting);
    leaf.toggleAttribute('data-kb-unlisted', unlisted);
    const pills = [];
    if (drafting) {
      pills.push('<span class="mb-kb-pill --drafting">Drafting</span>');
    }
    if (navFiles.has(base)) {
      pills.push('<span class="mb-kb-pill --live">Live</span>');
    }
    if (unlisted) {
      pills.push('<span class="mb-kb-pill --unlisted">Unlisted</span>');
    }
    if (pills.length) {
      leaf.insertAdjacentHTML('beforeend', `<span class="mb-kb-pills">${pills.join('')}</span>`);
    }
  });
}

// A stable per-node selection id. Keyed on node OBJECT identity, which the
// reorder controller preserves across moves (it reorders / detaches / reattaches
// the same node objects), so a selected row keeps its id — and thus its
// selection — even as its index-path changes. A WeakMap (not a stamped property)
// keeps the node clean so buildPayload's TOML projection is untouched.
const nodeUids = new WeakMap();
let uidSeq = 0;
function uidFor(node) {
  let id = nodeUids.get(node);
  if (id === undefined) { id = 'u' + (uidSeq++); nodeUids.set(node, id); }
  return id;
}

// Convert a normalized navToml node ({name,value} | {name,children}) to a
// generic kbTree node. Carries data-kb-uid so reorder-mode selection can track
// the row across re-renders.
function navNodeToKbNode(node) {
  if (node.children) {
    return {
      kind: 'folder',
      label: node.name,
      attrs: { 'data-kb-uid': uidFor(node) },
      children: node.children.map(navNodeToKbNode),
    };
  }
  return {
    kind: 'file',
    label: node.name,
    attrs: { 'data-kb-file': node.value, 'data-kb-label': node.name, 'data-kb-uid': uidFor(node) },
  };
}

function renderKbHierarchy(nodes) {
  return renderTree(nodes.map(navNodeToKbNode), { emptyMessage: 'No articles found.' });
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

// Commit nav, draft_nav and unlisted_nav in a single zensical.toml push.
async function saveReorder(reorder, formEl) {
  const { nav, draftNav, unlistedNav } = reorder.buildPayload();
  // Progress rides the amber dock tag, matching every other GitHub-commit button.
  // The push queue serialises writes, so leaving the rest of the form live during
  // the commit is safe; we just disable the sibling Discard so it can't fire mid-
  // save. On success openKnowledgeBaseManagement rebuilds the whole dock.
  const saveBtn = formEl.parentElement?.querySelector('[data-kb-reorder-save]');
  const discardBtn = formEl.parentElement?.querySelector('[data-kb-reorder-discard]');
  const snap = snapshotButton(saveBtn);
  setButtonBusy(saveBtn, 'Saving order…');
  if (discardBtn) discardBtn.disabled = true;
  try {
    await githubFetchAndPushFile('zensical.toml', s => setButtonBusy(saveBtn, s), md => {
      let out = replaceNavBlock(md, 'nav', nav);
      out = replaceNavBlock(out, 'draft_nav', draftNav);
      // Only touch unlisted_nav when the toml already has the block or there is
      // something to write: replaceNavBlock auto-creates a missing block at EOF,
      // which would land it inside [project.extra] (see applyPageVisibility).
      if (parseNavBlock(out, 'unlisted_nav').start !== -1 || unlistedNav.length) {
        out = replaceNavBlock(out, 'unlisted_nav', unlistedNav);
      }
      return out;
    });
    await getFormAction('openKnowledgeBaseManagement')();  // reload fresh tree
  } catch (e) {
    restoreButton(saveBtn, snap);
    if (discardBtn) discardBtn.disabled = false;
    alert('Failed to save order: ' + e.message);
  }
}

async function renderKnowledgeBaseManagement() {
  const { moreButtonsIntegrations } = await chrome.storage.local.get('moreButtonsIntegrations');
  if (moreButtonsIntegrations?.githubPAT) {
    const { formEl } = await createForm('knowledgeBaseManagement', openKnowledgeBaseManagement, { rootEntry: true });
    if (!formEl) return;

    const livePanel = formEl.querySelector('[data-kb-panel="guides"]');
    const systemPanel = formEl.querySelector('[data-kb-panel="system"]');
    const filtersEl = formEl.querySelector('.more-buttons-tab-list.--with-filters');

    // Filter dropdowns ↔ module state. The selects are the view; kbFilter is
    // the truth (it outlives this render, see its declaration). A select that
    // narrows carries --active so an applied filter is visible at a glance.
    const syncFilterControls = () => {
      const draft = filtersEl?.querySelector('select[name="kbFilterDraft"]');
      const vis = filtersEl?.querySelector('select[name="kbFilterVis"]');
      if (draft) { draft.value = kbFilter.draft; draft.classList.toggle('--active', kbFilter.draft !== 'all'); }
      if (vis) { vis.value = kbFilter.vis; vis.classList.toggle('--active', kbFilter.vis !== 'all'); }
    };
    const activeTab = () => formEl.querySelector('.more-buttons-tab.--active')?.dataset.tab ?? 'guides';
    // Narrow one panel's tree by its search box AND the filter row. `summary`
    // decides whether this panel drives the "n of N" / Clear / empty state —
    // only the showing (or about-to-show) tab should.
    const applyKbFilters = (panel, { summary = panel?.dataset.kbPanel === activeTab() } = {}) => {
      if (!panel) return;
      const tree = panel.querySelector('.mb-kb-tree');
      const query = panel.querySelector('.mb-kb-search')?.value ?? '';
      const predicate = kbFilterPredicate();
      const narrowed = predicate !== null || query.trim() !== '';
      let empty = panel.querySelector('[data-kb-filter-empty]');
      const counts = tree ? applySearch(tree, query, { predicate }) : { shown: 0, total: 0 };
      if (tree && narrowed && counts.shown === 0) {
        if (!empty) {
          empty = document.createElement('p');
          empty.className = 'more-buttons-description';
          empty.setAttribute('data-kb-filter-empty', '');
          empty.textContent = 'No pages match.';
          tree.after(empty);
        }
      } else {
        empty?.remove();
      }
      if (!summary || !filtersEl) return;
      const sum = filtersEl.querySelector('[data-kb-filter-summary]');
      if (sum) sum.textContent = tree && narrowed ? `${counts.shown} of ${counts.total}` : '';
      const clear = filtersEl.querySelector('[data-kb-filter-clear]');
      if (clear) clear.hidden = predicate === null;
    };
    const applyAllKbFilters = () => formEl.querySelectorAll('[data-kb-panel]').forEach(p => applyKbFilters(p));
    syncFilterControls();

    let reorder = null;
    let reorderMode = false;
    let rerenderGuides = () => {};
    let resetReorder = () => {};
    let selectedUid = null;   // reorder-mode: the currently selected row's stable id

    // Reflect `selectedUid` onto the DOM: tint the selected row and reveal its
    // move controls (all controls are hidden by default in reorder mode). Pure
    // class toggling — no tree rebuild — so collapse/scroll/search state survive.
    const applySelection = () => {
      livePanel.querySelectorAll('.mb-kb-node.--selected').forEach(n => n.classList.remove('--selected'));
      if (selectedUid == null) return;
      const row = livePanel.querySelector(`.mb-kb-node-row[data-kb-uid="${selectedUid}"]`);
      row?.closest('.mb-kb-node')?.classList.add('--selected');
    };

    // Swap the normal / reorder action groups (relocated out of <form> by
    // form.js) and gate the resolve buttons on whether the working copy is dirty.
    const updateReorderUi = () => {
      const actions = formEl.parentElement;
      if (!actions) return;
      // Normal-mode buttons sit in two groups flanking the persistent toggle.
      actions.querySelectorAll('[data-kb-actions="normal"]').forEach(el => { el.hidden = reorderMode; });
      const reo = actions.querySelector('[data-kb-actions="reorder"]');
      if (reo) reo.hidden = !reorderMode;
      // The persistent toggle mirrors the popup's master switch: state shown by
      // colour (magenta on / neutral off), icon, and label — kept as a form button.
      const toggle = actions.querySelector('[data-kb-reorder-toggle]');
      if (toggle) {
        toggle.classList.toggle('magenta', reorderMode);
        toggle.classList.toggle('secondary', !reorderMode);
        toggle.innerHTML =
          `<span class="more-buttons-icon">swap_vert</span>Reorder mode ${reorderMode ? 'enabled' : 'disabled'}`;
        // Lift the new label into the dock tag (and strip the inline text).
        syncDockTag(toggle);
      }
      const dirty = !!reorder?.isDirty();
      // aria-disabled (not the native attr) so the dimmed buttons still
      // hover-expand to reveal their label in the dock; clicks are gated below.
      const save = actions.querySelector('[data-kb-reorder-save]');
      const discard = actions.querySelector('[data-kb-reorder-discard]');
      // This bar edits LIVE data, so the commit is a blue "Publish changes to
      // live" (`.publish`), not a green draft save. The accent class rides ONLY
      // while dirty: the disabled-dimming rule overrides a button's border + text
      // but NOT an accent's faint background fill, so a static `.publish` would
      // stay blue when disabled. Stripping the class when clean lets it fall back
      // to the plain neutral dimmed button — same trick as the guide bar's
      // `.success` Save.
      if (save) {
        save.setAttribute('aria-disabled', String(!dirty));
        save.classList.toggle('publish', dirty);
      }
      if (discard) discard.setAttribute('aria-disabled', String(!dirty));
    };

    formLoading.show();
    try {
      // One fetch of zensical.toml drives everything: the tree is the union of
      // nav (live) and draft_nav (in-progress), and pills come from membership
      // in each set of leaf values — no per-folder listing needed.
      const tomlText = await readRepoText('zensical.toml');
      const nav = parseNavBlock(tomlText, 'nav').items;
      const draftNav = parseNavBlock(tomlText, 'draft_nav').items;
      const unlistedNav = parseNavBlock(tomlText, 'unlisted_nav').items;
      const navFiles = collectValues(nav, new Set());
      const draftFiles = collectValues(draftNav, new Set());
      const unlistedFiles = collectValues(unlistedNav, new Set());

      if (livePanel) {
        // Strip only live leaves whose draft MOVED them to another section, so
        // draft_nav owns the placement of a moved page without double-rendering;
        // a page drafted in place keeps its live position (see buildGuideTree).
        // Unlisted pages sit in this same tree at their unlisted_nav placement
        // (they carry the Unlisted pill and are filterable, not tabbed).
        const merged = buildGuideTree(nav, draftNav, unlistedNav);
        // `merged` is the pristine saved order; seed each reorder controller from a
        // fresh clone so Discard can revert in place by re-seeding (move ops mutate
        // the tree they're given, never `merged`).
        const seedReorder = () => createReorderState({
          tree: structuredClone(merged), navItems: nav, draftItems: draftNav, unlistedItems: unlistedNav,
        });
        reorder = seedReorder();
        resetReorder = () => { reorder = seedReorder(); };
        livePanel.innerHTML =
          renderTree(merged.map(navNodeToKbNode), { emptyMessage: 'No articles found.', reorderable: reorderMode });
        decorateKbPills(livePanel, draftFiles, navFiles, unlistedFiles);
        applyKbFilters(livePanel);
        rerenderGuides = () => {
          livePanel.innerHTML =
            renderTree(reorder.getTree().map(navNodeToKbNode), { emptyMessage: 'No articles found.', reorderable: reorderMode });
          decorateKbPills(livePanel, draftFiles, navFiles, unlistedFiles);
          applyKbFilters(livePanel);   // the rebuild drops the search/filter classes
          updateReorderUi();
          applySelection();   // re-pin selection by stable id after the rebuild
        };
      }

      if (systemPanel) {
        const systemEntry = nav.find(n => n.name === 'System' && n.children);
        if (systemEntry) {
          systemPanel.innerHTML = renderKbHierarchy([systemEntry]);
          decorateKbPills(systemPanel, draftFiles, navFiles, unlistedFiles);
          applyKbFilters(systemPanel);
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

    // Search composes with the filter row: both narrow the same tree.
    formEl.addEventListener('input', e => {
      const searchEl = e.target.closest('.mb-kb-search');
      if (!searchEl) return;
      applyKbFilters(searchEl.closest('[data-kb-panel]'));
    });
    formEl.addEventListener('change', e => {
      const sel = e.target.closest('select[name="kbFilterDraft"], select[name="kbFilterVis"]');
      if (!sel) return;
      kbFilter[sel.name === 'kbFilterDraft' ? 'draft' : 'vis'] = sel.value;
      syncFilterControls();   // keeps the --active tint in step
      applyAllKbFilters();
    });

    // .more-buttons-form-actions gets moved out of <form> by form.js, so
    // listen on the parent overlay-content to catch both form-internal clicks
    // and the moved-out mode-toggle / reorder action-group clicks.
    formEl.parentElement?.addEventListener('click', async e => {
      if (e.target.closest('[data-kb-filter-clear]')) {
        kbFilter.draft = 'all';
        kbFilter.vis = 'all';
        syncFilterControls();
        applyAllKbFilters();
        return;
      }
      // Tab switch: the generic form.js handler flips the panels; the filter
      // row is shared, so re-point its summary at the tab being opened. Resolve
      // the panel by name — listener order makes `hidden` unreliable here.
      const tab = e.target.closest('[data-tab]');
      if (tab && filtersEl && tab.closest('.more-buttons-tabs') === filtersEl.parentElement) {
        applyKbFilters(formEl.querySelector(`[data-kb-panel="${tab.dataset.tab}"]`), { summary: true });
        return;
      }
      if (e.target.closest('[data-kb-open-media-library]')) {
        await getFormAction('openMediaLibrary')?.();
        return;
      }
      if (e.target.closest('[data-kb-open-settings]')) {
        await getFormAction('openKnowledgeBaseSettings')?.();
        return;
      }
      if (e.target.closest('[data-kb-create-guide]')) {
        await getFormAction('openCreateGuide')?.();
        return;
      }
      if (reorder) {
        // Save/Discard are aria-disabled (not click-disabled) until dirty, so
        // they stay hover-expandable; ignore clicks while in that state.
        if (e.target.closest('[aria-disabled="true"]')) return;
        // Single toggle: flip reorder mode. Leaving discards the working copy
        // (same as Discard changes); entering starts with nothing selected.
        if (e.target.closest('[data-kb-reorder-toggle]')) {
          reorderMode = !reorderMode;
          selectedUid = null;
          if (!reorderMode) resetReorder();
          rerenderGuides();
          return;
        }
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
          selectedUid = null;    // re-seed makes fresh node objects; old id is gone
          resetReorder();        // revert working copy in place, stay in reorder mode
          rerenderGuides();
          return;
        }
        if (e.target.closest('[data-kb-reorder-save]')) {
          await saveReorder(reorder, formEl);
          return;
        }
      }

      // Reorder mode: a row click selects it (revealing that row's move controls
      // + tint); only the chevron still toggles collapse. Rows never open the
      // guide or fall through to normal-mode handling while reordering.
      if (reorderMode) {
        const sectionRow = e.target.closest('[data-kb-section]');
        if (sectionRow && e.target.closest('.mb-kb-arrow')) {
          sectionRow.closest('.mb-kb-node')?.classList.toggle('--collapsed');
          return;
        }
        const row = e.target.closest('.mb-kb-node-row');
        if (row) {
          selectedUid = row.dataset.kbUid ?? null;
          applySelection();
        }
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

  // Not connected — route through createForm so the action dock renders with
  // the standard machinery (square tiles + floating tag via syncDockTag, scroll
  // lock, Escape / click-outside, stylesheet injection). The old hand-built
  // overlay bypassed createForm, so syncDockTag never ran and the dock buttons
  // kept their inline labels inside the now overflow:visible tiles — spilling
  // "all over the place". `close,openIntegrations` mirrors the prior behaviour:
  // dismiss this dead-end warning, then open Integrations as a fresh root form.
  await createForm('githubNotConnected');
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
