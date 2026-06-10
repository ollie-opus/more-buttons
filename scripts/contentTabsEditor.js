/**
 * contentTabsEditor.js — the "Content tabs" overlay for a tab-group component.
 *
 * One form edits a whole GROUP: a dynamic tab strip on top, ONE active panel
 * below it (Title input + rich Description + the active tab's Components
 * list), and add / move / delete-tab management. Each tab is itself a
 * component container ('content-tab', uuid = the TAB's uuid), so admonitions,
 * captures and nested tab groups can be inserted into the active tab through
 * the standard save-gate machinery in guides.js.
 *
 * Editor state lives in a JS array (`formEl._ct`), mirrored into ONE hidden
 * named input (`tabsState`, JSON) for dirty tracking — the visible per-tab
 * inputs are deliberately UNNAMED so readFormValues never sees them (switching
 * tabs would otherwise false-dirty the form). Per-tab component order is held
 * in state (`tab.order`) instead of a named componentOrder field for the same
 * reason.
 *
 * Save model (agreed v1 trade-off): the group is saved whole, last-write-wins —
 * mergeSave's flat field model can't represent a dynamic tab list. Components
 * INSIDE each tab are preserved: every save re-reads each surviving tab's
 * current components from fresh markdown and rebuilds the group around them.
 *
 * The strip reuses the shared `.more-buttons-tab` styling but custom data
 * attributes (data-ct-tab / data-ct-add) — NOT data-tab, which would trip
 * form.js's generic static-tab switcher.
 */

import { registerFormAction } from './formActions.js';
import {
  createForm, replaceCurrentOpener, setCrumbLabel, isFormReplay, navigateBack,
  resetDirtyBaseline, setButtonBusy, snapshotButton, restoreButton,
} from './form.js';
import { readRepoText } from './repoClient.js';
import { githubFetchAndPushFile, fetchFileMigratingIdentity } from './github.js';
import { generateUUID, GUIDE_ADMONITION_TYPES_RE } from './admonitions.js';
import {
  parseComponents, buildComponentBody, uuidOfComponent, reorderComponents,
  readTabComponents, writeTabBody, tabContainerExists,
} from './components.js';
import { registerComponentContainer, getComponentContainer } from './componentContainers.js';
import { getTabGroupByUUID, buildTabGroup, replaceTabGroupByUUID, deleteTabGroupByUUID } from './contentTabs.js';
import { makeContainerHandler, spliceIntoContainer, renderComponents, onComponentEditorClick, setOpenComponentEditor } from './guides.js';
import { syncSurfaceFromTextarea } from './richTextEditor.js';
import { escapeHtml } from './cardRenderer.js';

const STORAGE_KEY = 'moreButtonsEditContentTabs';

// Each TAB is a component container: children (admonitions / captures / nested
// tab groups) read and write through the registry like any other container.
registerComponentContainer('content-tab', makeContainerHandler(readTabComponents, writeTabBody, tabContainerExists));

// ── Editor state ──────────────────────────────────────────────────────────────
//
// formEl._ct = { groupUuid, file, active, tabs: [{ uuid, title, description, order }] }
//   - uuid is generated up-front for new tabs so the markdown identity is
//     stable from the moment the tab first persists.
//   - order is null while the tab's component order matches the file; it is
//     only set by an in-editor rail reorder (batch — committed on save) and
//     cleared back to null once saved.

function newTab(n) {
  return { uuid: generateUUID(), title: `Tab ${n}`, description: '', order: null };
}

function tabsFromGroup(grp) {
  return grp.tabs.map(t => {
    const { description } = parseComponents(t.body, GUIDE_ADMONITION_TYPES_RE);
    return { uuid: t.uuid ?? generateUUID(), title: t.title, description, order: null };
  });
}

// Mirror the state array into the single named input that drives dirty
// tracking (and capture-mode storage round-trips, via the generic save step).
function syncTabsState(formEl) {
  const input = formEl.querySelector('[name="tabsState"]');
  if (input) input.value = JSON.stringify({ tabs: formEl._ct.tabs });
}

// Pull the active tab's visible (unnamed) fields back into state.
function stashActiveTab(formEl) {
  const st = formEl._ct;
  const t = st?.tabs[st.active];
  if (!t) return;
  const title = formEl.querySelector('[data-ct-title]');
  const desc = formEl.querySelector('[data-ct-description]');
  if (title) t.title = title.value;
  if (desc) t.description = desc.value;
}

// Push the active tab's state into the visible fields.
function loadActiveTabFields(formEl) {
  const st = formEl._ct;
  const t = st?.tabs[st.active];
  if (!t) return;
  // containerFromForm targets the ACTIVE tab; the group uuid stays in
  // formEl.dataset.groupUuid for save/delete.
  formEl.dataset.editUuid = t.uuid;
  const title = formEl.querySelector('[data-ct-title]');
  if (title) title.value = t.title;
  const desc = formEl.querySelector('[data-ct-description]');
  if (desc) { desc.value = t.description; syncSurfaceFromTextarea(desc); }
}

function renderStrip(formEl) {
  const strip = formEl.querySelector('[data-ct-strip]');
  const st = formEl._ct;
  if (!strip || !st) return;
  strip.innerHTML = st.tabs.map((t, i) =>
    `<button type="button" class="more-buttons-tab${i === st.active ? ' --active' : ''}" data-ct-tab="${i}">${escapeHtml(t.title || `Tab ${i + 1}`)}</button>`
  ).join('') + `<button type="button" class="more-buttons-tab mb-ct-add-tab" data-ct-add title="Add tab">+ Add tab</button>`;

  const left = formEl.querySelector('[data-ct-move="left"]');
  const right = formEl.querySelector('[data-ct-move="right"]');
  const del = formEl.querySelector('[data-ct-delete-tab]');
  if (left) left.disabled = st.active <= 0;
  if (right) right.disabled = st.active >= st.tabs.length - 1;
  if (del) del.disabled = st.tabs.length <= 1;
}

// Render the active tab's component list and point the shared open-editor
// tracking at it, so inserts/mutations re-render in place. In create mode the
// group doesn't exist in the file yet, so the list is simply empty.
async function mountActiveTabComponents(formEl, md = null) {
  const st = formEl._ct;
  const t = st?.tabs[st.active];
  if (!t) return;
  const listEl = formEl.querySelector('[data-tab-components]');
  const file = formEl.dataset.containerFile;
  let components = [];
  if (formEl.dataset.mode !== 'create' && file) {
    try {
      const source = md ?? await readRepoText(file);
      components = reorderComponents(readTabComponents(source, t.uuid).components, t.order ?? []);
    } catch { components = []; }
  }
  renderComponents(listEl, components, false); // tabs never number steps
  const ed = { formEl, listEl, container: { kind: 'content-tab', uuid: t.uuid, file }, components };
  ed._mountedOrder = components.map(uuidOfComponent);
  formEl._ctEditor = ed;
  setOpenComponentEditor(ed);
}

// Sync an in-editor rail reorder (guides.js swaps the open editor's components
// and calls formEl._refreshSaveState) into the owning tab's batch order +
// tabsState, so the reorder marks the form dirty and rides the next save.
function syncActiveOrderFromEditor(formEl) {
  const ed = formEl._ctEditor;
  const st = formEl._ct;
  if (!ed || !st || !Array.isArray(ed.components)) return;
  const tab = st.tabs.find(t => t.uuid === ed.container.uuid);
  if (!tab) return;
  const cur = ed.components.map(uuidOfComponent);
  const mounted = ed._mountedOrder ?? cur;
  if (tab.order == null && cur.join(',') === mounted.join(',')) return; // untouched
  tab.order = cur;
  syncTabsState(formEl);
}

// bindSaveStateButton (form.js) overwrites formEl._refreshSaveState in the
// async storage-hydration callback. Callers install this AFTER their own
// awaited chrome.storage.local.get — queued behind form.js's get, so by then
// the original is in place and safe to wrap.
function installRefreshHook(formEl) {
  const orig = formEl._refreshSaveState;
  formEl._refreshSaveState = () => { syncActiveOrderFromEditor(formEl); orig?.(); };
}

// ── Tab management ────────────────────────────────────────────────────────────

async function activateTab(formEl, index) {
  stashActiveTab(formEl);
  const st = formEl._ct;
  st.active = Math.max(0, Math.min(index, st.tabs.length - 1));
  loadActiveTabFields(formEl);
  renderStrip(formEl);
  syncTabsState(formEl);
  formEl._refreshSaveState?.();
  await mountActiveTabComponents(formEl);
}

async function addTab(formEl) {
  stashActiveTab(formEl);
  const st = formEl._ct;
  st.tabs.push(newTab(st.tabs.length + 1));
  await activateTab(formEl, st.tabs.length - 1);
}

function moveActiveTab(formEl, dir) {
  stashActiveTab(formEl);
  const st = formEl._ct;
  const i = st.active;
  const j = i + dir;
  if (j < 0 || j >= st.tabs.length) return;
  [st.tabs[i], st.tabs[j]] = [st.tabs[j], st.tabs[i]];
  st.active = j; // the active tab travels with the move
  renderStrip(formEl);
  syncTabsState(formEl);
  formEl._refreshSaveState?.();
}

async function deleteActiveTab(formEl) {
  const st = formEl._ct;
  if (st.tabs.length <= 1) {
    alert('A tab group needs at least one tab — use Delete below to remove the whole group.');
    return;
  }
  stashActiveTab(formEl);
  const t = st.tabs[st.active];
  if (!confirm(`Delete the tab "${t.title || 'Untitled'}"? Its contents are removed when you save.`)) return;
  st.tabs.splice(st.active, 1);
  st.active = Math.min(st.active, st.tabs.length - 1);
  loadActiveTabFields(formEl);
  renderStrip(formEl);
  syncTabsState(formEl);
  formEl._refreshSaveState?.();
  await mountActiveTabComponents(formEl);
}

// ── Wiring ────────────────────────────────────────────────────────────────────

function wireTabsEditor(formEl) {
  // The rich editor re-dispatches surface edits as bubbling `input` events on
  // its textarea, so this one listener covers both views.
  formEl.addEventListener('input', e => {
    if (e.target.matches?.('[data-ct-title]')) {
      stashActiveTab(formEl);
      syncTabsState(formEl);
      renderStrip(formEl); // live-update the active strip label
      formEl._refreshSaveState?.();
    } else if (e.target.matches?.('[data-ct-description]')) {
      stashActiveTab(formEl);
      syncTabsState(formEl);
      formEl._refreshSaveState?.();
    }
  });

  formEl.addEventListener('click', e => {
    const tabBtn = e.target.closest('[data-ct-tab]');
    if (tabBtn) { activateTab(formEl, parseInt(tabBtn.dataset.ctTab, 10)); return; }
    if (e.target.closest('[data-ct-add]')) { addTab(formEl); return; }
    const move = e.target.closest('[data-ct-move]');
    if (move) { if (!move.disabled) moveActiveTab(formEl, move.dataset.ctMove === 'left' ? -1 : 1); return; }
    const del = e.target.closest('[data-ct-delete-tab]');
    if (del) { if (!del.disabled) deleteActiveTab(formEl); return; }
  });

  // Shared component delegation: rails, edit buttons, "+ Insert Component".
  formEl.addEventListener('click', onComponentEditorClick);
}

// Initialise state. Storage (seeded by the opener, or carrying in-flight edits
// across a capture-mode / library replay) wins over the markdown-derived
// fallback. Awaiting the get here also sequences us behind form.js's storage
// hydration (FIFO), which installRefreshHook relies on.
async function initStateFromStorage(formEl, fallbackTabs, file, groupUuid) {
  let tabs = fallbackTabs;
  try {
    const res = await chrome.storage.local.get(STORAGE_KEY);
    const raw = res?.[STORAGE_KEY]?.tabsState;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.tabs) && parsed.tabs.length) tabs = parsed.tabs;
    }
  } catch { /* fall back to markdown-derived state */ }
  formEl._ct = { groupUuid, file, tabs, active: 0 };
}

function seedStorage(tabs) {
  return chrome.storage.local.set({ [STORAGE_KEY]: { tabsState: JSON.stringify({ tabs }) } });
}

// ── Openers ───────────────────────────────────────────────────────────────────

registerFormAction('openCreateContentTabs', async ({ container, insertAtIndex } = {}) => {
  if (!container?.file) return;
  const initialTabs = [newTab(1)];
  if (!isFormReplay()) await seedStorage(initialTabs);

  const { formEl } = await createForm('editContentTabs');
  if (!formEl) return;
  formEl.dataset.mode = 'create';
  // Parent container this group will be spliced into (kind/uuid/file).
  formEl.dataset.parentKind = container.kind;
  formEl.dataset.parentUuid = container.uuid;
  formEl.dataset.parentFile = container.file;
  formEl.dataset.insertAtIndex = insertAtIndex == null ? '' : String(insertAtIndex);
  formEl.dataset.groupUuid = '';
  formEl.dataset.componentContainerKind = 'content-tab';
  formEl.dataset.containerFile = container.file;
  formEl.dataset.componentNoun = 'tab group';

  const heading = formEl.querySelector('[data-content-tabs-heading]');
  if (heading) heading.textContent = 'Add content tabs';
  formEl.parentElement?.querySelector('[data-delete-tabs-btn]')?.style.setProperty('display', 'none');

  await initStateFromStorage(formEl, initialTabs, container.file, null);
  formEl._componentSaver = () => saveTabsForComponent(formEl);
  wireTabsEditor(formEl);
  loadActiveTabFields(formEl);
  renderStrip(formEl);
  syncTabsState(formEl);
  await mountActiveTabComponents(formEl);
  installRefreshHook(formEl);
  resetDirtyBaseline(formEl);
});

registerFormAction('openEditContentTabs', async ({ uuid, file } = {}) => {
  if (!uuid || !file) return;
  let md;
  try {
    // Backfill + persist any missing group/tab UUIDs before reading, so
    // pre-existing `=== ` blocks become editable on open.
    md = await fetchFileMigratingIdentity(file);
  } catch (e) {
    alert('Failed to load file: ' + e.message);
    return;
  }
  const grp = getTabGroupByUUID(md, uuid);
  if (!grp) { alert('Content tabs not found.'); return; }
  const mdTabs = tabsFromGroup(grp);
  if (!isFormReplay()) await seedStorage(mdTabs);

  const { formEl } = await createForm('editContentTabs');
  if (!formEl) return;
  formEl.dataset.mode = 'edit';
  formEl.dataset.groupUuid = uuid;
  formEl.dataset.componentContainerKind = 'content-tab';
  formEl.dataset.containerFile = file;
  formEl.dataset.componentNoun = 'tab group';

  const heading = formEl.querySelector('[data-content-tabs-heading]');
  if (heading) heading.textContent = 'Edit content tabs';
  setCrumbLabel('Content tabs');

  await initStateFromStorage(formEl, mdTabs, file, uuid);
  formEl._componentSaver = () => saveTabsForComponent(formEl);
  wireTabsEditor(formEl);
  loadActiveTabFields(formEl);
  renderStrip(formEl);
  syncTabsState(formEl);
  await mountActiveTabComponents(formEl, md);
  installRefreshHook(formEl);
  resetDirtyBaseline(formEl);
});

// ── Persistence ───────────────────────────────────────────────────────────────

function validateTabs(st) {
  if (!st?.tabs.length) { alert('Add at least one tab.'); return false; }
  if (st.tabs.some(t => !(t.title ?? '').trim())) { alert('Every tab needs a title.'); return false; }
  return true;
}

// Build the brand-new group and splice it into the parent container at the
// chosen index — exactly persistNewAdmonition's shape, with a 'tabs' component.
async function persistNewTabsGroup(formEl, onProgress = () => {}) {
  stashActiveTab(formEl);
  const st = formEl._ct;
  if (!validateTabs(st)) return null;
  const parent = {
    kind: formEl.dataset.parentKind,
    uuid: formEl.dataset.parentUuid,
    file: formEl.dataset.parentFile,
  };
  const handler = getComponentContainer(parent.kind);
  if (!handler) { alert('Unknown parent container.'); return null; }

  const groupUuid = generateUUID();
  const grpTabs = st.tabs.map(t => ({
    uuid: t.uuid,
    title: t.title.trim(),
    body: buildComponentBody(t.uuid, t.description, []),
  }));
  const insertAtRaw = formEl.dataset.insertAtIndex;
  const insertAt = insertAtRaw === '' || insertAtRaw == null ? null : parseInt(insertAtRaw, 10);

  await spliceIntoContainer(parent, insertAt, [{ kind: 'tabs', grp: { uuid: groupUuid, tabs: grpTabs } }], onProgress);
  return { groupUuid, file: parent.file };
}

// Flip the create form into an edit-of-new-group form in place (gate path and
// Save button both stay mounted) — mirrors transitionAdmonitionCreateToEdit.
async function transitionTabsCreateToEdit(formEl, groupUuid, file) {
  formEl.dataset.mode = 'edit';
  formEl.dataset.groupUuid = groupUuid;
  formEl.dataset.containerFile = file;
  formEl._ct.groupUuid = groupUuid;
  formEl._ct.tabs.forEach(t => { t.order = null; });
  replaceCurrentOpener('openEditContentTabs', { uuid: groupUuid, file });
  const heading = formEl.querySelector('[data-content-tabs-heading]');
  if (heading) heading.textContent = 'Edit content tabs';
  setCrumbLabel('Content tabs');
  formEl.parentElement?.querySelector('[data-delete-tabs-btn]')?.style.removeProperty('display');
  syncTabsState(formEl);
  await seedStorage(formEl._ct.tabs);
  await mountActiveTabComponents(formEl);
  resetDirtyBaseline(formEl);
}

// Whole-group save, last-write-wins on titles/descriptions/tab list (known v1
// limitation — see module header). Components are preserved per tab: each
// surviving tab's CURRENT components are re-read from fresh markdown, an
// in-flight batch reorder is applied, and the group is rebuilt in state order.
// Deleted tabs drop with their components; new tabs start empty.
async function persistTabsEdit(formEl, onProgress = () => {}) {
  stashActiveTab(formEl);
  const st = formEl._ct;
  if (!validateTabs(st)) return null;
  const file = formEl.dataset.containerFile;
  const groupUuid = formEl.dataset.groupUuid;

  let found = true;
  await githubFetchAndPushFile(file, onProgress, md => {
    if (!getTabGroupByUUID(md, groupUuid)) { found = false; return md; }
    const grpTabs = st.tabs.map(t => {
      const { components } = readTabComponents(md, t.uuid);
      const ordered = t.order ? reorderComponents(components, t.order) : components;
      return { uuid: t.uuid, title: t.title.trim(), body: buildComponentBody(t.uuid, t.description, ordered) };
    });
    return replaceTabGroupByUUID(md, groupUuid, buildTabGroup(groupUuid, grpTabs));
  });
  if (!found) {
    alert('This tab group was deleted in another session — your changes can’t be saved.');
    return null;
  }

  st.tabs.forEach(t => { t.order = null; }); // the file is canonical again
  syncTabsState(formEl);
  await seedStorage(st.tabs);
  await mountActiveTabComponents(formEl);
  resetDirtyBaseline(formEl);
  return { groupUuid, file };
}

// Persist the tabs form for the save-gate. create → splice into parent +
// transition in place; edit → whole-group rewrite + rebaseline. Returns
// { container, formEl } (container = the ACTIVE tab, so child flows insert
// into it) or null on validation failure.
async function saveTabsForComponent(formEl, onProgress = () => {}) {
  if (formEl.dataset.mode === 'create') {
    const res = await persistNewTabsGroup(formEl, onProgress);
    if (!res) return null;
    await transitionTabsCreateToEdit(formEl, res.groupUuid, res.file);
  } else {
    const res = await persistTabsEdit(formEl, onProgress);
    if (!res) return null;
  }
  return {
    container: { kind: 'content-tab', uuid: formEl.dataset.editUuid, file: formEl.dataset.containerFile },
    formEl,
  };
}

// ── Form actions ──────────────────────────────────────────────────────────────

registerFormAction('submitEditContentTabs', async ({ formEl, content }) => {
  const btn = content.querySelector('[data-save-state]');
  setButtonBusy(btn, 'Saving…');
  try {
    await saveTabsForComponent(formEl, s => setButtonBusy(btn, s));
    // Validation failure or success both leave the form mounted; re-sync the button.
    formEl._refreshSaveState?.();
  } catch (e) {
    formEl._refreshSaveState?.();
    alert('Failed to save content tabs: ' + e.message);
  }
});

registerFormAction('deleteContentTabs', async ({ formEl, content }) => {
  const groupUuid = formEl.dataset.groupUuid;
  const file = formEl.dataset.containerFile;
  if (!groupUuid || !file) return;
  if (!confirm('Delete this tab group? All of its tabs and their contents are removed.')) return;
  const btn = content?.querySelector('[data-action="deleteContentTabs"]');
  const snap = snapshotButton(btn);
  setButtonBusy(btn, 'Deleting…'); // disable immediately — no double-click window
  try {
    await githubFetchAndPushFile(file, s => setButtonBusy(btn, s), md => deleteTabGroupByUUID(md, groupUuid));
    await chrome.storage.local.remove(STORAGE_KEY);
    await navigateBack();
  } catch (e) {
    restoreButton(btn, snap);
    alert('Failed to delete content tabs: ' + e.message);
  }
});
