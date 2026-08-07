/**
 * navLinksEditor.js — the "Nav links" component overlay.
 *
 * A form-authored component listing pages by one of two modes (a radio pill):
 * a nav path (e.g. `guides/employees`, nested list of everything under that nav
 * section) or a frontmatter tag (e.g. `System`, every page carrying the tag,
 * with a flat/grouped Layout option). The page stores only the path/tag; the
 * published site renders the live list (see navLinks.js for the markdown
 * round-trip and the KB repo's nav-links.js for the runtime injection).
 *
 * As a path is typed it is validated against the live nav tree from
 * zensical.toml (the same slugify-and-walk convention guide creation uses — see
 * navToml.js insertPath): a tick if it resolves to a section, a warning if not.
 * Saving is allowed regardless (a path may be pre-authored ahead of a toml
 * edit). Tags are deliberately free-text: there is no cheap source of
 * tags-in-use in the source repo (they live in per-page frontmatter).
 *
 * Mirrors buttonEditor.js: create splices one line into the parent container then
 * flips to edit in place; edit rewrites that one line through the merge engine;
 * delete removes the line + its identity span. No container registration / save
 * gate (it holds no sub-components).
 */

import { registerFormAction } from './formActions.js';
import {
  createForm, replaceCurrentOpener, setCrumbLabel, isFormReplay, navigateBack,
  resetDirtyBaseline, setButtonBusy, snapshotButton, restoreButton,
} from './form.js';
import { githubFetchAndPushFile, fetchFileMigratingIdentity } from './github.js';
import { generateUUID } from './admonitions.js';
import { mergeSave } from './mergeSave.js';
import { spliceIntoContainer } from './guides.js';
import { readRepoText } from './repoClient.js';
import { parseNavBlock, slugify } from './navToml.js';
import { loadCreatedTags, registerCreatedTag } from './tagRegistry.js';
import { attachSuggestCombobox } from './suggestCombobox.js';
import {
  locateNavLinksByUUID, replaceNavLinksByUUID, deleteNavLinksByUUID,
  navLinksLineFrom, navLinksDimFields,
} from './navLinks.js';

const STORAGE_KEY = 'moreButtonsEditNavLinks';

// ── Form ↔ data ────────────────────────────────────────────────────────────

function emptyFields() {
  return { navMode: 'path', navPath: '', navTag: '', navLayout: 'flat' };
}

function readNavLinksFields(formEl) {
  return {
    mode: formEl.querySelector('[name="navMode"]:checked')?.value === 'tag' ? 'tag' : 'path',
    path: formEl.querySelector('[name="navPath"]')?.value.trim() ?? '',
    tag: formEl.querySelector('[name="navTag"]')?.value.trim() ?? '',
    layout: formEl.querySelector('[name="navLayout"]:checked')?.value === 'grouped' ? 'grouped' : 'flat',
  };
}

/** The saved-form label for the breadcrumb / crumb: the active mode's value. */
function fieldsLabel(f) {
  return (f.mode === 'tag' ? f.tag : f.path) || 'Nav links';
}

function fieldsToStorage(f) {
  return { navMode: f.mode, navPath: f.path, navTag: f.tag, navLayout: f.layout };
}

function seedStorage(fields) {
  return chrome.storage.local.set({ [STORAGE_KEY]: fields });
}

// ── Live path validation against the nav tree ─────────────────────────────────

let _tomlPromise = null;
function loadToml() {
  _tomlPromise ??= readRepoText('zensical.toml').catch(() => '');
  return _tomlPromise;
}

let _navCache = null;
async function loadNavSections() {
  if (_navCache) return _navCache;
  try {
    _navCache = parseNavBlock(await loadToml(), 'nav').items;
  } catch {
    _navCache = [];
  }
  return _navCache;
}

// Tag suggestions come from the shared mb_created_tags register (tagRegistry.js)
// through the shared combobox (suggestCombobox.js) — whole-value mode, one tag.
function attachTagSuggest(formEl) {
  attachSuggestCombobox(formEl.querySelector('[name="navTag"]'), { getItems: loadCreatedTags });
}

/** Walks the nav tree to the SECTION node named by a `/`-delimited slug path, or
 *  null. Mirrors navToml.js insertPath's section-walk (slugify(name) === seg). */
function resolveSection(nav, path) {
  const segs = String(path ?? '').split('/').map(s => slugify(s)).filter(Boolean);
  if (!segs.length) return null;
  let level = nav ?? [];
  let node = null;
  for (const seg of segs) {
    node = level.find(n => n.children && slugify(n.name) === seg);
    if (!node) return null;
    level = node.children;
  }
  return node;
}

/** Count the pages (leaf values) anywhere under a section. */
function countPages(node) {
  let n = 0;
  (function walk(level) {
    for (const item of level ?? []) {
      if (item.children) walk(item.children);
      else if (item.value !== undefined) n++;
    }
  })(node?.children);
  return n;
}

function attachNavPathValidation(formEl) {
  const input = formEl.querySelector('[name="navPath"]');
  const status = formEl.querySelector('[data-navpath-status]');
  if (!input || !status) return;

  let nav = null;
  const render = () => {
    const path = input.value.trim();
    if (!path) { status.textContent = ''; status.removeAttribute('data-state'); return; }
    if (!nav) { status.textContent = 'Checking…'; status.removeAttribute('data-state'); return; }
    const node = resolveSection(nav, path);
    if (node) {
      const c = countPages(node);
      status.textContent = `✓ Lists ${c} page${c === 1 ? '' : 's'} under “${node.name}”.`;
      status.setAttribute('data-state', 'ok');
    } else {
      status.textContent = '⚠ No matching nav section — the list will be empty until this path exists.';
      status.setAttribute('data-state', 'warn');
    }
  };

  input.addEventListener('input', render);
  render();
  loadNavSections().then(items => { nav = items; render(); });
}

// ── Openers ──────────────────────────────────────────────────────────────────

registerFormAction('openCreateNavLinks', async ({ container, insertAtIndex } = {}) => {
  if (!container?.file) return;
  if (!isFormReplay()) await seedStorage(emptyFields());

  const { formEl } = await createForm('editNavLinks');
  if (!formEl) return;
  formEl.dataset.mode = 'create';
  formEl.dataset.parentKind = container.kind;
  formEl.dataset.parentUuid = container.uuid;
  formEl.dataset.parentFile = container.file;
  formEl.dataset.insertAtIndex = insertAtIndex == null ? '' : String(insertAtIndex);
  formEl.dataset.editUuid = '';

  const heading = formEl.querySelector('[data-nav-links-heading]');
  if (heading) heading.textContent = 'Add nav links';
  // Delete (lives in the moved form-actions) only applies once the block exists.
  formEl.parentElement?.querySelector('[data-delete-nav-links-btn]')?.style.setProperty('display', 'none');

  attachNavPathValidation(formEl);
  attachTagSuggest(formEl);
  resetDirtyBaseline(formEl);
});

registerFormAction('openEditNavLinks', async ({ uuid, file } = {}) => {
  if (!uuid || !file) return;
  let md;
  try {
    md = await fetchFileMigratingIdentity(file);
  } catch (e) {
    alert('Failed to load file: ' + e.message);
    return;
  }
  const block = locateNavLinksByUUID(md, uuid);
  if (!block) { alert('Nav links block not found.'); return; }

  if (!isFormReplay()) await seedStorage(navLinksDimFields(block));

  const { formEl } = await createForm('editNavLinks');
  if (!formEl) return;
  formEl.dataset.mode = 'edit';
  formEl.dataset.editUuid = uuid;
  formEl.dataset.containerFile = file;

  const heading = formEl.querySelector('[data-nav-links-heading]');
  if (heading) heading.textContent = 'Edit nav links';
  setCrumbLabel(block.path || block.tag || 'Nav links');

  attachNavPathValidation(formEl);
  attachTagSuggest(formEl);
  resetDirtyBaseline(formEl);
});

// ── Persistence ──────────────────────────────────────────────────────────────

async function persistNewNavLinks(formEl, onProgress = () => {}) {
  const f = readNavLinksFields(formEl);
  if (f.mode === 'tag' ? !f.tag : !f.path) {
    alert(f.mode === 'tag' ? 'Tag is required.' : 'Path is required.');
    return null;
  }
  const newUuid = generateUUID();
  const parent = {
    kind: formEl.dataset.parentKind,
    uuid: formEl.dataset.parentUuid,
    file: formEl.dataset.parentFile,
  };
  const insertAtRaw = formEl.dataset.insertAtIndex;
  const insertAt = insertAtRaw === '' || insertAtRaw == null ? null : parseInt(insertAtRaw, 10);
  const nav = f.mode === 'tag'
    ? { uuid: newUuid, tag: f.tag, layout: f.layout }
    : { uuid: newUuid, path: f.path };
  await spliceIntoContainer(parent, insertAt, [{ kind: 'navlinks', nav }], onProgress);
  if (f.mode === 'tag') await registerCreatedTag(f.tag, onProgress);
  return { newUuid, file: parent.file };
}

// Flip the create form into an edit-of-new-block form in place, so an inserted
// nav-links block lands in its editor (matching the Button).
async function transitionNavLinksCreateToEdit(formEl, newUuid, file) {
  formEl.dataset.mode = 'edit';
  formEl.dataset.editUuid = newUuid;
  formEl.dataset.containerFile = file;
  replaceCurrentOpener('openEditNavLinks', { uuid: newUuid, file });
  const heading = formEl.querySelector('[data-nav-links-heading]');
  if (heading) heading.textContent = 'Edit nav links';
  formEl.parentElement?.querySelector('[data-delete-nav-links-btn]')?.style.removeProperty('display');
  const f = readNavLinksFields(formEl);
  setCrumbLabel(fieldsLabel(f));
  await seedStorage(fieldsToStorage(f));
  resetDirtyBaseline(formEl);
}

async function persistNavLinksEdit(formEl, onProgress = () => {}) {
  const f = readNavLinksFields(formEl);
  if (f.mode === 'tag' ? !f.tag : !f.path) {
    alert(f.mode === 'tag' ? 'Tag is required.' : 'Path is required.');
    return null;
  }
  const editUuid = formEl.dataset.editUuid;
  const file = formEl.dataset.containerFile;

  // Conflict resolution may land on the other side's tag — register what was
  // actually saved, not what the form held.
  let savedTag = null;
  await mergeSave({
    formEl,
    file,
    onProgress,
    fieldSpecs: [
      { name: 'navMode', type: 'scalar', label: 'List by' },
      { name: 'navPath', type: 'scalar', label: 'Path' },
      { name: 'navTag', type: 'scalar', label: 'Tag' },
      { name: 'navLayout', type: 'scalar', label: 'Layout' },
    ],
    readFresh: md => navLinksDimFields(locateNavLinksByUUID(md, editUuid) ?? {}),
    build: (md, resolved) => {
      if (!locateNavLinksByUUID(md, editUuid)) throw new Error('Nav links block no longer exists.');
      savedTag = resolved.navMode === 'tag' ? resolved.navTag : null;
      const line = navLinksLineFrom({
        mode: resolved.navMode, path: resolved.navPath,
        tag: resolved.navTag, layout: resolved.navLayout,
      });
      return replaceNavLinksByUUID(md, editUuid, line);
    },
  });
  await registerCreatedTag(savedTag, onProgress);
  return { editUuid, file };
}

// ── Form actions ──────────────────────────────────────────────────────────────

registerFormAction('submitEditNavLinks', async ({ formEl, content }) => {
  const saveBtn = content.querySelector('[data-save-state]');
  setButtonBusy(saveBtn, 'Saving…');
  try {
    if (formEl.dataset.mode === 'create') {
      const res = await persistNewNavLinks(formEl, s => setButtonBusy(saveBtn, s));
      if (!res) { formEl._refreshSaveState?.(); return; }
      await transitionNavLinksCreateToEdit(formEl, res.newUuid, res.file);
    } else {
      const res = await persistNavLinksEdit(formEl, s => setButtonBusy(saveBtn, s));
      if (!res) { formEl._refreshSaveState?.(); return; }
    }
    formEl._refreshSaveState?.();
  } catch (e) {
    formEl._refreshSaveState?.();
    alert('Failed to save nav links: ' + e.message);
  }
});

registerFormAction('deleteNavLinks', async ({ formEl, content }) => {
  const editUuid = formEl.dataset.editUuid;
  const file = formEl.dataset.containerFile;
  if (!editUuid || !file) return;
  if (!confirm('Delete these nav links?')) return;
  const btn = content.querySelector('[data-action="deleteNavLinks"]');
  const snap = snapshotButton(btn);
  setButtonBusy(btn, 'Deleting…');
  try {
    await githubFetchAndPushFile(file, s => setButtonBusy(btn, s), md => deleteNavLinksByUUID(md, editUuid));
    await chrome.storage.local.remove(STORAGE_KEY);
    await navigateBack();
  } catch (e) {
    restoreButton(btn, snap);
    alert('Failed to delete nav links: ' + e.message);
  }
});
