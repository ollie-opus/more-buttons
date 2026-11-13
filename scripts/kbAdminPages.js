/**
 * kbAdminPages.js — /admin/pages/ and /admin/pages/new/ on the Knowledge Base
 * site (see kbAdmin.js).
 *
 * Manage pages is the Knowledge Base form's tree, as a page: the same merged
 * Guides tree (nav ∪ unlisted_nav ∪ draft_nav, buildGuideTree), the same state
 * pills and filters, and the same reorder working copy (kbReorder.js), saved
 * as one zensical.toml commit. A row opens the page itself, where it is edited
 * in place; nothing here opens a popup form.
 */

import { readRepoText, readRepoDir } from './repoClient.js';
import { parseNavBlock, slugify, nodeAtPath } from './navToml.js';
import { createReorderState } from './kbReorder.js';
import { buildGuideTree, pushNavOrder } from './knowledgeBaseManagement.js';
import { snapshotButton, restoreButton } from './loading.js';
import { AUDIENCES, AUDIENCE_NONE, withoutAudienceTags } from './audienceTags.js';
import { loadCreatedTags, getTagColour } from './tagRegistry.js';
import { escapeHtml, icon, renderAdminTree, skeletonHtml, noticeHtml, busyAction } from './kbAdmin.js';

// Pages whose draft file is a workflow detail of their own editors, never a
// "page being drafted" (mirrors knowledgeBaseManagement.js).
const DRAFT_PILL_EXEMPT = new Set(['system-updates.md', 'system-status.md']);

const baseOf = value => String(value).split('/').pop();
const slugOf = value => baseOf(value).replace(/\.md$/, '');

// What the reader last chose, kept while moving between admin screens.
// The site's own User / Manager / Administrator label pills (labels.css).
const AUDIENCE_LABEL = { users: 'blue', managers: 'purple', admins: 'pink' };

const view = { tab: 'guides', draft: 'all', vis: 'all', query: '' };
const collapsed = new Set();

async function loadPages() {
  // zensical.toml gives the tree and who is unlisted; the two folders say what
  // is live and what is being drafted (the nav arrays do not: an unlisted page
  // leaves `nav`). A failed listing falls back to the nav arrays.
  const [tomlText, pagesDir, draftsDir] = await Promise.all([
    readRepoText('zensical.toml'),
    readRepoDir('docs/pages').catch(() => null),
    readRepoDir('docs/drafts').catch(() => null),
  ]);
  const collect = (nodes, set = new Set()) => {
    for (const n of nodes) { if (n.children) collect(n.children, set); else set.add(baseOf(n.value)); }
    return set;
  };
  const nav = parseNavBlock(tomlText, 'nav').items;
  const draftNav = parseNavBlock(tomlText, 'draft_nav').items;
  const unlistedNav = parseNavBlock(tomlText, 'unlisted_nav').items;
  return {
    nav, draftNav, unlistedNav,
    merged: buildGuideTree(nav, draftNav, unlistedNav),
    system: nav.filter(n => n.name === 'System' && n.children),
    live: pagesDir ? new Set(pagesDir) : collect(nav),
    drafts: draftsDir ? new Set(draftsDir) : collect(draftNav),
    unlisted: collect(unlistedNav),
  };
}

/** A navToml node → a tree node for renderAdminTree, with its state and pills. */
function toTreeNode(node, data, trail = []) {
  if (node.children) {
    const labels = [...trail, node.name];
    return { id: 'f:' + labels.join('/'), label: node.name, children: node.children.map(c => toTreeNode(c, data, labels)) };
  }
  const base = baseOf(node.value);
  const slug = slugOf(node.value);
  const live = data.live.has(base);
  const drafting = !DRAFT_PILL_EXEMPT.has(base) && data.drafts.has(base);
  const unlisted = data.unlisted.has(base);
  const pills = [
    drafting ? `<a class="mb-adm-pill --drafting" href="/drafts/${encodeURIComponent(slug)}/" title="Open the draft">Drafting</a>` : '',
    live ? '<span class="mb-adm-pill --live">Live</span>' : '',
    unlisted ? '<span class="mb-adm-pill --unlisted">Unlisted</span>' : '<span class="mb-adm-pill --public">Public</span>',
  ].join('');
  return {
    id: 'p:' + base,
    label: node.name,
    // The page as readers see it; a page that is only a draft opens its draft.
    href: `/${live ? 'pages' : 'drafts'}/${encodeURIComponent(slug)}/`,
    pills, drafting, unlisted,
  };
}

export async function mountPages(ctx) {
  let data;
  try {
    data = await loadPages();
  } catch (err) {
    ctx.body.innerHTML = noticeHtml('failure', 'The pages could not be loaded', err?.message ?? String(err));
    return null;
  }
  if (!ctx.alive()) return null;

  const seed = () => createReorderState({
    tree: structuredClone(data.merged), navItems: data.nav, draftItems: data.draftNav, unlistedItems: data.unlistedNav,
  });
  let reorder = seed();
  let reorderMode = false;
  let saving = false;
  let movePop = null;   // { path } while the "Move to" list is open

  ctx.body.innerHTML = `
    <div data-adm-notice></div>
    <div class="mb-adm-tabs" role="tablist" aria-label="Page groups">
      <button type="button" role="tab" data-adm-tab="guides">Guides</button>
      <button type="button" role="tab" data-adm-tab="system">System</button>
    </div>
    <div class="mb-adm-toolbar">
      <input type="search" class="mb-adm-input mb-adm-search" placeholder="Search pages" aria-label="Search pages">
      <div class="mb-adm-filters">
        <button type="button" class="mb-adm-link" data-adm-clear inert>Clear filters</button>
        <select class="mb-adm-input" name="draft" aria-label="Filter by draft state">
          <option value="all">Any draft state</option>
          <option value="drafting">Drafting</option>
          <option value="none">No draft</option>
        </select>
        <select class="mb-adm-input" name="vis" aria-label="Filter by visibility">
          <option value="all">Any visibility</option>
          <option value="public">Public</option>
          <option value="unlisted">Unlisted</option>
        </select>
      </div>
    </div>
    <p class="mb-adm-hint" data-adm-reorder-hint hidden>Reordering the Guides navigation. Use the arrows on a row to move it, or the folder to move it to another section. Nothing changes on the site until you publish.</p>
    <div data-adm-tree></div>`;

  const $ = sel => ctx.body.querySelector(sel);
  const treeEl = $('[data-adm-tree]');
  const searchEl = $('.mb-adm-search');
  const noticeEl = $('[data-adm-notice]');
  searchEl.value = view.query;

  const predicate = () => {
    if (view.draft === 'all' && view.vis === 'all') return null;
    return leaf => (view.draft === 'all' || leaf.drafting === (view.draft === 'drafting'))
      && (view.vis === 'all' || leaf.unlisted === (view.vis === 'unlisted'));
  };

  function drawActions() {
    const dirty = reorder.isDirty();
    ctx.setActions(reorderMode
      // "Reorder mode" is always the last button, so it stays put (the row is
      // right-aligned) when the mode's own buttons arrive beside it.
      ? [
        [
          { act: 'save', icon: 'badge-check', label: 'Publish changes to live', colour: dirty ? 'accent' : '', disabled: !dirty },
          { act: 'discard', icon: 'x', label: 'Discard changes', disabled: !dirty },
        ],
        [{ act: 'reorder', icon: 'arrow-up-down', label: 'Reorder mode', colour: 'pink', pressed: true }],
      ]
      : [[
        { act: 'create', icon: 'plus', label: 'Create new page' },
        { act: 'reorder', icon: 'arrow-up-down', label: 'Reorder mode', pressed: false },
      ]], onAct);
  }

  function draw() {
    const tab = reorderMode ? 'guides' : view.tab;
    ctx.body.querySelectorAll('[data-adm-tab]').forEach(b => {
      const on = b.dataset.admTab === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      b.disabled = reorderMode && !on;
    });
    for (const name of ['draft', 'vis']) {
      const sel = $(`select[name="${name}"]`);
      sel.value = view[name];
      // The chosen state's pill colour (kbAdmin.css); none while it filters nothing.
      if (view[name] === 'all') delete sel.dataset.admState; else sel.dataset.admState = view[name];
    }
    // Slides in beside the filters (kbAdmin.css); out of reach while it is away.
    const filtering = view.draft !== 'all' || view.vis !== 'all';
    const clearEl = $('[data-adm-clear]');
    clearEl.classList.toggle('--shown', filtering);
    clearEl.inert = !filtering;
    $('[data-adm-reorder-hint]').hidden = !reorderMode;

    const source = tab === 'system' ? data.system : reorder.getTree();
    const nodes = source.map(n => toTreeNode(n, data));
    const out = renderAdminTree(nodes, {
      query: view.query, predicate: predicate(), collapsed,
      reorder: reorderMode && tab === 'guides',
      empty: tab === 'system' ? 'No system pages found.' : 'No pages yet. Create the first one with the button above.',
    });
    treeEl.innerHTML = out.html;
    if (movePop) drawMovePop();
  }

  // The "Move to" list, under the row it belongs to.
  function drawMovePop() {
    const row = treeEl.querySelector(`[data-adm-move="to"][data-adm-path="${movePop.path}"]`)?.closest('.mb-adm-node');
    if (!row) { movePop = null; return; }
    const targets = reorder.sectionTargets().filter(t => t.pathStr !== movePop.path);
    const pop = document.createElement('div');
    pop.className = 'mb-adm-move';
    pop.innerHTML = `
      <p class="mb-adm-move__title">Move to</p>
      <div class="mb-adm-move__list">
        <button type="button" data-adm-target="">Top level</button>
        ${targets.map(t => `<button type="button" data-adm-target="${t.pathStr}">${escapeHtml(t.label.split('/').join(' / '))}</button>`).join('')}
      </div>
      <label class="mb-adm-move__new">
        <span>Or a new section</span>
        <input type="text" class="mb-adm-input" placeholder="guides/contractors" data-adm-new-path>
      </label>`;
    row.querySelector(':scope > .mb-adm-row').after(pop);
    pop.querySelector('button')?.focus({ preventScroll: true });
  }

  // After a move the tree is redrawn: put the focus back on the moved row's
  // control so its controls stay visible and the next press carries on.
  function redrawFollowing(node, act) {
    draw();
    drawActions();
    if (!node) return;
    const find = (list, trail) => {
      for (let i = 0; i < list.length; i++) {
        if (list[i] === node) return [...trail, i];
        const hit = list[i].children && find(list[i].children, [...trail, i]);
        if (hit) return hit;
      }
      return null;
    };
    const path = find(reorder.getTree(), [])?.join('.');
    if (path == null) return;
    const ctl = treeEl.querySelector(`[data-adm-move="${act}"][data-adm-path="${path}"]`);
    const target = ctl && !ctl.disabled ? ctl : treeEl.querySelector(`[data-adm-move][data-adm-path="${path}"]:not(:disabled)`);
    target?.focus({ preventScroll: true });
  }

  const parsePath = s => String(s).split('.').filter(Boolean).map(Number);

  async function save(btn) {
    if (saving) return;
    saving = true;
    const snap = snapshotButton(btn);
    busyAction(btn, 'Saving order…');
    try {
      await pushNavOrder(reorder.buildPayload(), s => busyAction(btn, s));
      data = await loadPages();
      if (!ctx.alive()) return;
      reorder = seed();
      reorderMode = false;
      noticeEl.innerHTML = noticeHtml('success', 'Navigation order published', 'The site rebuilds in a few minutes; the new order shows once it has.');
      draw();
      drawActions();
    } catch (err) {
      restoreButton(btn, snap);
      noticeEl.innerHTML = noticeHtml('failure', 'The order could not be saved', err?.message ?? String(err));
    } finally {
      saving = false;
    }
  }

  function onAct(act, btn) {
    if (saving) return;
    noticeEl.innerHTML = '';
    if (act === 'create') { ctx.go('pages/new'); return; }
    if (act === 'reorder') {
      if (reorderMode && reorder.isDirty() && !window.confirm('Leave reorder mode and discard the changes you have not published?')) return;
      reorderMode = !reorderMode;
      movePop = null;
      reorder = seed();
      draw();
      drawActions();
      return;
    }
    if (act === 'discard') { movePop = null; reorder = seed(); draw(); drawActions(); return; }
    if (act === 'save') save(btn);
  }

  const onInput = e => {
    if (e.target === searchEl) { view.query = searchEl.value; draw(); }
  };
  const onChange = e => {
    const sel = e.target.closest?.('select[name="draft"], select[name="vis"]');
    if (!sel) return;
    view[sel.name] = sel.value;
    draw();
  };
  const onKey = e => {
    if (e.key !== 'Enter' || !e.target.matches?.('[data-adm-new-path]')) return;
    e.preventDefault();
    const segments = e.target.value.split('/').map(s => s.trim()).filter(Boolean);
    const node = nodeAtPath(reorder.getTree(), parsePath(movePop.path));
    if (segments.length) reorder.moveToSegments(movePop.path, segments);
    movePop = null;
    redrawFollowing(node, 'to');
  };
  const onClick = e => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    const tab = t.closest('[data-adm-tab]');
    if (tab) { view.tab = tab.dataset.admTab; draw(); return; }
    if (t.closest('[data-adm-clear]')) { view.draft = 'all'; view.vis = 'all'; draw(); return; }
    const fold = t.closest('[data-adm-fold]');
    if (fold) {
      const id = fold.dataset.admFold;
      if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
      draw();
      treeEl.querySelector(`[data-adm-fold="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
      return;
    }
    const target = t.closest('[data-adm-target]');
    if (target && movePop) {
      const node = nodeAtPath(reorder.getTree(), parsePath(movePop.path));
      reorder.moveToPath(movePop.path, target.dataset.admTarget || null);
      movePop = null;
      redrawFollowing(node, 'to');
      return;
    }
    const move = t.closest('[data-adm-move]');
    if (move) {
      const path = move.dataset.admPath;
      const act = move.dataset.admMove;
      if (act === 'to') {
        const reopen = movePop?.path !== path;
        ctx.body.querySelector('.mb-adm-move')?.remove();
        movePop = reopen ? { path } : null;
        if (movePop) drawMovePop();
        return;
      }
      movePop = null;
      const node = nodeAtPath(reorder.getTree(), parsePath(path));
      reorder.move(path, act);
      redrawFollowing(node, act);
      return;
    }
    // A press anywhere else puts the "Move to" list away.
    if (movePop && !t.closest('.mb-adm-move')) { movePop = null; ctx.body.querySelector('.mb-adm-move')?.remove(); }
  };
  const onEscape = e => {
    if (e.key === 'Escape' && movePop) { movePop = null; ctx.body.querySelector('.mb-adm-move')?.remove(); }
  };

  ctx.body.addEventListener('input', onInput);
  ctx.body.addEventListener('change', onChange);
  ctx.body.addEventListener('keydown', onKey);
  ctx.body.addEventListener('click', onClick);
  document.addEventListener('keydown', onEscape);

  draw();
  drawActions();

  const dirty = () => reorderMode && reorder.isDirty();
  return {
    isDirty: dirty,
    canLeave: () => !dirty() || window.confirm('Leave this page and discard the order you have not published?'),
    destroy: () => document.removeEventListener('keydown', onEscape),
  };
}

// ── /admin/pages/new/ ────────────────────────────────────────────────────────

const HIDE_OPTIONS = [
  ['navigation', 'Navigation'],
  ['toc', 'Table of contents'],
  ['path', 'Path'],
  ['writtenFor', 'Written for'],
];

/** Every section path in the three nav arrays, as slug paths ("guides/employees"). */
function sectionPaths(tomlText) {
  const out = new Set();
  const walk = (nodes, trail) => {
    for (const n of nodes) {
      if (!n.children) continue;
      const path = [...trail, slugify(n.name)];
      out.add(path.join('/'));
      walk(n.children, path);
    }
  };
  for (const key of ['nav', 'draft_nav', 'unlisted_nav']) walk(parseNavBlock(tomlText, key).items, []);
  return [...out].filter(p => p !== 'home' && !p.startsWith('system')).sort();
}

export async function mountNewPage(ctx) {
  const [tomlText, tags] = await Promise.all([
    readRepoText('zensical.toml').catch(() => ''),
    loadCreatedTags().then(withoutAudienceTags).catch(() => []),
  ]);
  if (!ctx.alive()) return null;

  // A choice is grey until picked, then wears its own colour: one of the site's
  // label colours (`label`, a labels.css slug) or a state pill's (`tone`).
  const choice = (type, name, value, label, { label: colour = '', tone = '' } = {}) => {
    const slug = String(colour ?? '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    return `<label class="mb-adm-choice${tone ? ` --${tone}` : ''}"><input type="${type}" name="${name}" value="${escapeHtml(value)}"><span${slug ? ` class="mb-label-${slug}"` : ''}>${escapeHtml(label)}</span></label>`;
  };

  ctx.body.innerHTML = `
    <p class="mb-adm-lead">A new page starts as a draft. Once it is created you land on the draft, ready to write; it reaches readers when you publish it.</p>
    <div data-adm-notice></div>
    <form class="mb-adm-form" novalidate>
      <div class="mb-adm-field">
        <label for="mb-adm-title">Title</label>
        <input id="mb-adm-title" class="mb-adm-input" type="text" name="title" placeholder="Registering an employee" autocomplete="off" required>
        <p class="mb-adm-hint" data-adm-slug></p>
        <p class="mb-adm-error" data-adm-error="title" hidden></p>
      </div>
      <div class="mb-adm-field">
        <label for="mb-adm-path">Section</label>
        <input id="mb-adm-path" class="mb-adm-input" type="text" name="path" placeholder="guides/employees" autocomplete="off" list="mb-adm-paths">
        <datalist id="mb-adm-paths">${sectionPaths(tomlText).map(p => `<option value="${escapeHtml(p)}"></option>`).join('')}</datalist>
        <p class="mb-adm-hint">Where the page sits in the navigation. Pick a section or type a new path; leave it empty for the top level.</p>
      </div>
      <fieldset class="mb-adm-field">
        <legend>Written for</legend>
        <div class="mb-adm-choices">
          ${AUDIENCES.map(a => choice('radio', 'writtenFor', a.value, a.label, { label: AUDIENCE_LABEL[a.value] })).join('')}
          ${choice('radio', 'writtenFor', AUDIENCE_NONE, 'N/A')}
        </div>
        <p class="mb-adm-hint">Which Opus Compliance Cloud users the page is written for.</p>
        <p class="mb-adm-error" data-adm-error="writtenFor" hidden></p>
      </fieldset>
      <fieldset class="mb-adm-field">
        <legend>Page visibility</legend>
        <div class="mb-adm-choices">
          ${choice('radio', 'visibility', 'public', 'Public', { tone: 'public' })}
          ${choice('radio', 'visibility', 'unlisted', 'Unlisted', { tone: 'unlisted' })}
        </div>
        <p class="mb-adm-hint">Unlisted pages stay reachable by link but leave the site navigation and search.</p>
        <p class="mb-adm-error" data-adm-error="visibility" hidden></p>
      </fieldset>
      <div class="mb-adm-field">
        <label for="mb-adm-icon">Icon <span class="mb-adm-optional">optional</span></label>
        <div class="mb-adm-icon-field">
          <span class="mb-adm-icon-preview" data-adm-icon-preview aria-hidden="true"></span>
          <input id="mb-adm-icon" class="mb-adm-input" type="text" name="icon" placeholder="user-plus" autocomplete="off" spellcheck="false">
        </div>
        <p class="mb-adm-hint" data-adm-icon-hint>A lucide icon name, shown beside the page in the navigation.</p>
      </div>
      ${tags.length ? `<fieldset class="mb-adm-field">
        <legend>Tags <span class="mb-adm-optional">optional</span></legend>
        <div class="mb-adm-choices">${tags.map(t => choice('checkbox', 'tags', t, t, { label: getTagColour(t) })).join('')}</div>
        <p class="mb-adm-hint">Group related pages. New tags are created in <a href="/admin/settings/" data-adm-route="settings">Settings</a>.</p>
      </fieldset>` : ''}
      <fieldset class="mb-adm-field">
        <legend>Hide elements <span class="mb-adm-optional">optional</span></legend>
        <div class="mb-adm-choices">${HIDE_OPTIONS.map(([v, l]) => choice('checkbox', 'hide', v, l)).join('')}</div>
      </fieldset>
    </form>`;

  const form = ctx.body.querySelector('form');
  const noticeEl = ctx.body.querySelector('[data-adm-notice]');
  const val = name => form.elements[name]?.value?.trim?.() ?? '';
  const checked = name => [...form.querySelectorAll(`[name="${name}"]:checked`)].map(i => i.value);
  const iconName = () => val('icon').replace(/^lucide\//, '').replace(/^:?lucide-|:$/g, '');
  let busy = false;
  let touched = false;

  function sync() {
    const slug = slugify(val('title'));
    ctx.body.querySelector('[data-adm-slug]').textContent = slug ? `Its address will be /pages/${slug}/` : '';
    const name = iconName();
    const svg = name ? icon(name) : '';
    ctx.body.querySelector('[data-adm-icon-preview]').innerHTML = svg;
    ctx.body.querySelector('[data-adm-icon-hint]').textContent = name && !svg
      ? `There is no lucide icon called "${name}".`
      : 'A lucide icon name, shown beside the page in the navigation.';
  }

  function setError(name, text) {
    const el = ctx.body.querySelector(`[data-adm-error="${name}"]`);
    if (!el) return;
    el.textContent = text;
    el.hidden = !text;
    el.closest('.mb-adm-field')?.classList.toggle('--invalid', !!text);
  }

  function validate() {
    const errors = {
      title: slugify(val('title')) ? '' : 'Give the page a title.',
      writtenFor: checked('writtenFor').length ? '' : 'Choose who the page is written for.',
      visibility: checked('visibility').length ? '' : 'Choose whether the page is public or unlisted.',
    };
    for (const [name, text] of Object.entries(errors)) setError(name, text);
    const first = Object.keys(errors).find(name => errors[name]);
    if (first) form.querySelector(`[name="${first}"]`)?.focus();
    return !first;
  }

  async function create(btn) {
    if (busy || !validate()) return;
    const name = iconName();
    if (name && !icon(name)) { form.elements.icon.focus(); return; }
    busy = true;
    noticeEl.innerHTML = '';
    const snap = snapshotButton(btn);
    busyAction(btn, 'Creating…');
    const hide = checked('hide');
    try {
      // The editor stack is only needed now, not to show the form.
      const { createGuideDraftFiles } = await import('./guides.js');
      const { slug } = await createGuideDraftFiles({
        title: val('title'),
        segments: val('path').split('/').map(s => s.trim()).filter(Boolean),
        settings: {
          icon: name ? `lucide/${name}` : '',
          writtenFor: checked('writtenFor')[0],
          tags: checked('tags'),
          hide: Object.fromEntries(HIDE_OPTIONS.map(([v]) => [v, hide.includes(v)])),
          visibility: checked('visibility')[0],
        },
      }, s => busyAction(btn, s));
      touched = false;
      // The draft's own page: the in-page editor takes it from there.
      location.assign(`/drafts/${encodeURIComponent(slug)}/`);
    } catch (err) {
      busy = false;
      restoreButton(btn, snap);
      if (err?.conflict) { setError('title', err.message); form.elements.title.focus(); }
      else noticeEl.innerHTML = noticeHtml('failure', 'The page could not be created', err?.message ?? String(err));
    }
  }

  form.addEventListener('input', e => {
    touched = true;
    sync();
    if (e.target.name) setError(e.target.name, '');
  });
  form.addEventListener('change', e => { if (e.target.name) setError(e.target.name, ''); });
  form.addEventListener('submit', e => { e.preventDefault(); create(ctx.actionButton('create')); });

  ctx.setActions([
    [{ act: 'create', icon: 'plus', label: 'Create draft', colour: 'accent' }],
    [{ act: 'cancel', icon: 'x', label: 'Cancel' }],
  ], (act, btn) => {
    if (act === 'create') create(btn);
    else if (!busy) ctx.go('pages');
  }, { at: 'end' });
  sync();
  form.elements.title.focus({ preventScroll: true });

  const dirty = () => touched && !busy;
  return {
    isDirty: dirty,
    canLeave: () => !dirty() || window.confirm('Leave without creating this page?'),
  };
}
