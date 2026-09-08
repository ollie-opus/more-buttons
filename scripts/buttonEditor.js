/**
 * buttonEditor.js — the "Button" component overlay (a Zensical .md-button link).
 *
 * The simplest form-authored component: a single markdown line, no children. The
 * form fields are Label, Colour (the 26 custom-button swatches, built at open
 * time from labelColours.json), Theme (Default/Inversed/Force light/Force dark —
 * which colour trio paints the button, mirroring the capture Theme field),
 * Border (Default/Always/Light only/Dark only/None — per-trio border override),
 * Style (Default/Slim — the full-width flex row), Destination (a link-type
 * picker: Internal page via the kbTree nav picker, URL via the text input, or
 * Groove support — an onclick that opens the Groove widget), and an optional
 * Icon (the lucide picker reused from page settings). Theme and Border live in
 * a collapsed Advanced <details> that auto-opens when non-default. Live light/dark preview
 * tiles above the fields repaint on every edit (buttonPreview.js). Legacy Primary/Secondary buttons still parse, but editing one
 * requires picking a colour (nothing pre-selected). Because a button holds no
 * sub-components, it needs neither a component container registration nor a
 * save-gate `_componentSaver` (it is never a parent in a child navigation).
 *
 * Create splices one line into the parent container then flips to edit in place,
 * so an inserted button lands in its editor like every other component kind
 * (captures are the only deliberate exception). Edit rewrites that one line
 * through the merge engine; delete removes the line + its identity span.
 *
 * Markdown round-trip lives in mdButtons.js (pure). This module is the DOM/network
 * lifecycle only.
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
import { attachIconPicker, getLucideSvgMarkup } from './iconPicker.js';
import { renderButtonPreview } from './buttonPreview.js';
import { loadLabelPalette } from './richTextEditor.js';
import { markRequiredFields } from './formValidation.js';
import {
  buildButtonLines, locateButtonByUUID, replaceButtonByUUID, deleteButtonByUUID, buttonDimFields,
  GROOVE_ONCLICK, isGrooveOnclick,
} from './mdButtons.js';
import { loadInternalNav, buildInternalTreeNodes, resolveInternalHref, isInternalHrefShape } from './internalPages.js';
import { renderTree, applySearch } from './kbTree.js';

const STORAGE_KEY = 'moreButtonsEditButton';

// ── Form ↔ data ────────────────────────────────────────────────────────────

function emptyFields() {
  // Colour deliberately unseeded: create starts with no swatch selected and the
  // required marker blocks save until one is picked.
  return { buttonLabel: '', buttonColour: '', buttonTheme: 'default', buttonBorder: 'default', buttonStyle: 'default', buttonDestination: '', icon: '', buttonNewTab: 'no', buttonOnclick: '', buttonDestKind: 'url' };
}

function readButtonFields(formEl) {
  return {
    label: formEl.querySelector('[name="buttonLabel"]')?.value.trim() ?? '',
    colour: formEl.querySelector('[name="buttonColour"]:checked')?.value ?? '',
    theme: formEl.querySelector('[name="buttonTheme"]:checked')?.value ?? 'default',
    border: formEl.querySelector('[name="buttonBorder"]:checked')?.value ?? 'default',
    style: formEl.querySelector('[name="buttonStyle"]:checked')?.value ?? 'default',
    destination: formEl.querySelector('[name="buttonDestination"]')?.value.trim() ?? '',
    icon: formEl.querySelector('[name="icon"]')?.value.trim() ?? '',
    newTab: formEl.querySelector('[name="buttonNewTab"]:checked')?.value === 'yes',
    destKind: formEl.querySelector('[name="buttonDestKind"]:checked')?.value ?? 'url',
    onclick: formEl.querySelector('[name="buttonOnclick"]')?.value ?? '', // verbatim — never trimmed
  };
}

// The single link line (no identity span — replaceButtonByUUID keeps the span).
// `primary` only matters when colour is '' (a legacy button the merge engine
// resolved without a colour) — buildButtonLines gives colour precedence.
function buttonLineFrom({ label, destination, icon, colour, theme, border, style, primary, newTab, onclick }) {
  return buildButtonLines([{ label, destination, icon, colour, theme, border, style, primary, newTab, onclick }])[1];
}

// Build the 26 colour swatches as real radio inputs so form.js hydration,
// dirty-tracking and validation treat them like static fields. MUST run
// synchronously after createForm resolves (the same slot as attachIconPicker):
// createForm's chrome.storage.local.get hydration callback is a later
// macrotask, so the radios exist by the time saved values are restored.
function buildColourSwatches(formEl, groups) {
  const host = formEl.querySelector('[data-button-colour-swatches]');
  if (!host || host.childElementCount) return;
  let first = true;
  for (const [groupName, presets] of Object.entries(groups)) {
    const title = document.createElement('span');
    title.className = 'mb-rte__swatch-title';
    title.textContent = groupName;
    host.appendChild(title);
    const row = document.createElement('div');
    row.className = 'mb-rte__swatch-row';
    for (const [name, preset] of Object.entries(presets)) {
      const label = document.createElement('label');
      label.className = 'mb-label mb-rte__swatch mb-swatch-option';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'buttonColour';
      input.value = name.toLowerCase();
      if (first) { input.required = true; first = false; } // one radio marks the group required
      label.append(input, document.createTextNode(name));
      label.style.setProperty('--bg', preset.light.bg);
      label.style.setProperty('--text', preset.light.text);
      label.style.setProperty('--border', preset.light.border);
      label.style.setProperty('--bg-dark', preset.dark.bg);
      label.style.setProperty('--text-dark', preset.dark.text);
      label.style.setProperty('--border-dark', preset.dark.border);
      row.appendChild(label);
    }
    host.appendChild(row);
  }
  markRequiredFields(formEl); // createForm's pass predates these inputs; idempotent
}

// Live light/dark preview tiles above the fields. Repaints on every input/
// change (radio groups, Label/Icon typing — Destination/newTab repaints are
// harmless no-ops). The lucide icon resolves through the picker's bundled
// bodies map: debounced so Label keystrokes stay instant, sequence-guarded so
// a slow first load never paints over a newer pick.
function attachButtonPreview(formEl, flat) {
  const host = formEl.querySelector('[data-button-preview]');
  if (!host) return;

  let seq = 0;
  let iconTimer = null;
  let iconSvg = '';
  let iconName = null;

  const paint = () => renderButtonPreview(host, { ...readButtonFields(formEl), iconSvg }, flat);

  const resolveIcon = () => {
    const value = formEl.querySelector('[name="icon"]')?.value.trim() ?? '';
    const m = value.match(/^lucide\/([a-z0-9-]+)$/);
    const name = m?.[1] ?? null;
    if (name === iconName) return;
    iconName = name;
    if (!name) { iconSvg = ''; paint(); return; }
    const mySeq = ++seq;
    clearTimeout(iconTimer);
    iconTimer = setTimeout(() => {
      getLucideSvgMarkup(name).then(svg => {
        if (mySeq !== seq || iconName !== name) return; // stale fetch
        iconSvg = svg;
        paint();
      });
    }, 200);
  };

  const repaint = () => { paint(); resolveIcon(); };
  formEl.addEventListener('input', repaint);
  formEl.addEventListener('change', repaint);

  // createForm's storage hydration is a later macrotask and dispatches no
  // events — paint the ghost now, then once more after hydration has applied
  // saved values (storage callbacks service in issue order).
  repaint();
  chrome.storage.local.get(STORAGE_KEY, () => repaint());
}

// The Destination link-type picker: buttonDestKind pills (Internal page / URL /
// Groove support) over one always-required backing input. `data-show-when` in
// the markup swaps the tree panel / groove hint / newTab group declaratively;
// this handler owns everything value-shaped: hiding the text input, the tree's
// selection ↔ input sync, the groove '#'+onclick stash, and pointing required-
// error painting at the tree while the input is hidden.
function attachDestinationPicker(formEl, seeded) {
  const destInput = formEl.querySelector('[name="buttonDestination"]');
  const onclickInput = formEl.querySelector('[name="buttonOnclick"]');
  const treeHost = formEl.querySelector('[data-dest-tree]');
  if (!destInput || !onclickInput || !treeHost) return;

  let treePromise = null;
  let navData = null;
  let grooveStash = null; // {d, o} captured when entering groove, restored on leave

  // Real input/change events so the dirty guard, save-state button and the live
  // preview react (the tagChips contract). No-op guarded: the async tree render
  // and repeated syncs must never false-dirty the form.
  const setField = (input, v) => {
    if (input.value === v) return;
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  // Mark the leaf for the current input value selected, expand its ancestors and
  // scroll it into view. Read-only over the input: legacy `pages/foo.md`
  // spellings resolve (and stay untouched — no diff churn on an unedited save).
  const selectCurrent = () => {
    if (!navData) return;
    for (const n of treeHost.querySelectorAll('.mb-kb-node.--selected')) n.classList.remove('--selected');
    const hit = resolveInternalHref(destInput.value, navData.listed, navData.unlisted);
    if (!hit) return;
    const leaf = treeHost.querySelector(`[data-kb-file="${CSS.escape(hit.href)}"]`);
    if (!leaf) return;
    const node = leaf.closest('.mb-kb-node');
    node.classList.add('--selected');
    let anc = node.parentElement?.closest('.mb-kb-node');
    while (anc) { anc.classList.remove('--collapsed'); anc = anc.parentElement?.closest('.mb-kb-node'); }
    leaf.scrollIntoView({ block: 'nearest' });
  };

  const ensureTree = () => {
    treePromise ??= loadInternalNav().then(({ listed, unlisted }) => {
      navData = { listed, unlisted };
      treeHost.innerHTML = renderTree(buildInternalTreeNodes(listed, unlisted), { emptyMessage: 'No pages found.' });
      selectCurrent();
    });
    return treePromise;
  };

  // Scoped to treeHost — the KB-management/media-library pages delegate
  // .mb-kb-search/.mb-kb-node handlers on their own form roots, so nothing
  // here may listen wider than this picker's tree.
  treeHost.addEventListener('input', e => {
    if (e.target.classList.contains('mb-kb-search')) {
      applySearch(treeHost.querySelector('.mb-kb-tree'), e.target.value);
    }
  });
  treeHost.addEventListener('click', e => {
    const section = e.target.closest('[data-kb-section]');
    if (section) { section.closest('.mb-kb-node').classList.toggle('--collapsed'); return; }
    const leaf = e.target.closest('[data-kb-leaf]');
    if (leaf) {
      for (const n of treeHost.querySelectorAll('.mb-kb-node.--selected')) n.classList.remove('--selected');
      leaf.closest('.mb-kb-node').classList.add('--selected');
      setField(destInput, leaf.dataset.kbFile); // also clears a painted required error
    }
  });

  const currentKind = () => {
    const checked = formEl.querySelector('[name="buttonDestKind"]:checked')?.value;
    if (checked) return checked;
    // Legacy stored dict without the key (or pre-hydration): seeded value, then
    // derive from the values themselves; check the radio silently (no events —
    // this is repair, not an edit).
    const kind = seeded?.buttonDestKind
      ?? (isGrooveOnclick(onclickInput.value) ? 'groove'
        : isInternalHrefShape(destInput.value) ? 'internal' : 'url');
    const radio = formEl.querySelector(`[name="buttonDestKind"][value="${kind}"]`);
    if (radio) radio.checked = true;
    return kind;
  };

  // View-only repaint: hide/show the URL input, point required-error painting
  // at the tree, render/select the tree. Never writes a field value — it runs
  // mid-hydration (form.js calls _mbSyncView while later inputs in DOM order,
  // including the hidden onclick, are still unhydrated) and again after the
  // whole restore has landed via the _mbSyncPost sweep.
  const paintKindUI = () => {
    const kind = currentKind();
    destInput.hidden = kind !== 'url';
    if (kind === 'internal') destInput._validationHost = treeHost;
    else delete destInput._validationHost;
    if (kind === 'internal') { ensureTree(); selectCurrent(); }
  };

  // User intent only — the kind-radio change handler. Entering groove leaves
  // an onclick that is already a groove variant (canonical or the legacy
  // hand-written ones, see mdButtons isGrooveOnclick) byte-identical; leaving
  // it restores what the user had before, or empty fields on a hydrated
  // groove button (never a bare '#').
  const applyKindChange = () => {
    const kind = currentKind();
    if (kind === 'groove') {
      if (!isGrooveOnclick(onclickInput.value)) {
        grooveStash = { d: destInput.value, o: onclickInput.value };
        setField(destInput, '#');
        setField(onclickInput, GROOVE_ONCLICK);
      }
    } else if (isGrooveOnclick(onclickInput.value)) {
      const stash = grooveStash ?? { d: '', o: '' };
      grooveStash = null;
      setField(destInput, stash.d);
      setField(onclickInput, stash.o);
    }
    paintKindUI();
  };

  formEl.addEventListener('change', e => {
    if (e.target.name === 'buttonDestKind') applyKindChange();
  });
  // Repaint at the async moments that rewrite values underneath us: mid-loop
  // during storage hydration / post-merge rehydration (_mbSyncView), and once
  // more after the whole restore has landed (_mbSyncPost) — the hidden onclick
  // hydrates after this input, so only the post sweep sees the final kind.
  // Both are paints, never writes: the old combined sync stashed {d:'#', o:''}
  // mid-hydration and leaked '#' into the URL box on a later kind switch.
  destInput._mbSyncView = paintKindUI;
  destInput._mbSyncPost = paintKindUI;
  paintKindUI();
}

// Theme + Border live in the collapsed Advanced <details>; open it (never
// close it) when the seeded values are non-default so active settings are
// visible immediately. Decided from the seeded dict, not the DOM — hydration
// is a later macrotask. The deferred storage read covers create-replay dicts
// that may hold newer values than the seed.
function autoOpenAdvanced(formEl, seeded) {
  const adv = formEl.querySelector('[data-button-advanced]');
  if (!adv) return;
  const maybe = d => {
    if (d && ((d.buttonTheme ?? 'default') !== 'default' || (d.buttonBorder ?? 'default') !== 'default')) adv.open = true;
  };
  maybe(seeded);
  chrome.storage.local.get(STORAGE_KEY, r => maybe(r[STORAGE_KEY]));
}

function seedStorage(fields) {
  return chrome.storage.local.set({ [STORAGE_KEY]: fields });
}

// ── Openers ──────────────────────────────────────────────────────────────────

registerFormAction('openCreateButton', async ({ container, insertAtIndex } = {}) => {
  if (!container?.file) return;
  const seeded = emptyFields();
  if (!isFormReplay()) await seedStorage(seeded);

  const { groups, flat } = await loadLabelPalette(); // before createForm — injection below must not await
  const { formEl } = await createForm('editButton');
  if (!formEl) return;
  formEl.dataset.mode = 'create';
  formEl.dataset.parentKind = container.kind;
  formEl.dataset.parentUuid = container.uuid;
  formEl.dataset.parentFile = container.file;
  formEl.dataset.insertAtIndex = insertAtIndex == null ? '' : String(insertAtIndex);
  formEl.dataset.editUuid = '';

  const heading = formEl.querySelector('[data-button-heading]');
  if (heading) heading.textContent = 'Add button';
  // Delete (lives in the moved form-actions) only applies once the button exists.
  formEl.parentElement?.querySelector('[data-delete-button-btn]')?.style.setProperty('display', 'none');

  buildColourSwatches(formEl, groups);
  attachIconPicker(formEl.querySelector('[name="icon"]'));
  attachDestinationPicker(formEl, seeded);
  autoOpenAdvanced(formEl, seeded);
  attachButtonPreview(formEl, flat);
  resetDirtyBaseline(formEl);
});

registerFormAction('openEditButton', async ({ uuid, file } = {}) => {
  if (!uuid || !file) return;
  let md;
  try {
    md = await fetchFileMigratingIdentity(file);
  } catch (e) {
    alert('Failed to load file: ' + e.message);
    return;
  }
  const btn = locateButtonByUUID(md, uuid);
  if (!btn) { alert('Button not found.'); return; }

  const seeded = buttonDimFields(btn);
  if (!isFormReplay()) await seedStorage(seeded);

  const { groups, flat } = await loadLabelPalette(); // before createForm — injection below must not await
  const { formEl } = await createForm('editButton');
  if (!formEl) return;
  formEl.dataset.mode = 'edit';
  formEl.dataset.editUuid = uuid;
  formEl.dataset.containerFile = file;

  const heading = formEl.querySelector('[data-button-heading]');
  if (heading) heading.textContent = 'Edit button';
  setCrumbLabel(btn.label || 'Button');

  buildColourSwatches(formEl, groups);
  attachIconPicker(formEl.querySelector('[name="icon"]'));
  attachDestinationPicker(formEl, seeded);
  autoOpenAdvanced(formEl, seeded);
  attachButtonPreview(formEl, flat);
  resetDirtyBaseline(formEl);
});

// ── Persistence ──────────────────────────────────────────────────────────────

async function persistNewButton(formEl, onProgress = () => {}) {
  const { label, colour, theme, border, style, destination, icon, newTab, onclick } = readButtonFields(formEl);
  if (!colour) { alert('Colour is required.'); return null; }
  if (!destination) { alert('Destination is required.'); return null; }
  const newUuid = generateUUID();
  const parent = {
    kind: formEl.dataset.parentKind,
    uuid: formEl.dataset.parentUuid,
    file: formEl.dataset.parentFile,
  };
  const insertAtRaw = formEl.dataset.insertAtIndex;
  const insertAt = insertAtRaw === '' || insertAtRaw == null ? null : parseInt(insertAtRaw, 10);
  const btn = { uuid: newUuid, label, destination, icon, colour, theme, border, style, primary: false, newTab, onclick };
  await spliceIntoContainer(parent, insertAt, [{ kind: 'button', btn }], onProgress);
  return { newUuid, file: parent.file };
}

// Flip the create form into an edit-of-new-button form in place, so an inserted
// button lands in its editor (matching admonitions / grids).
async function transitionButtonCreateToEdit(formEl, newUuid, file) {
  formEl.dataset.mode = 'edit';
  formEl.dataset.editUuid = newUuid;
  formEl.dataset.containerFile = file;
  replaceCurrentOpener('openEditButton', { uuid: newUuid, file });
  const heading = formEl.querySelector('[data-button-heading]');
  if (heading) heading.textContent = 'Edit button';
  formEl.parentElement?.querySelector('[data-delete-button-btn]')?.style.removeProperty('display');
  const f = readButtonFields(formEl);
  setCrumbLabel(f.label || 'Button');
  await seedStorage({
    buttonLabel: f.label, buttonColour: f.colour, buttonTheme: f.theme || 'default',
    buttonBorder: f.border || 'default', buttonStyle: f.style || 'default',
    buttonDestination: f.destination, icon: f.icon,
    buttonNewTab: f.newTab ? 'yes' : 'no',
    buttonOnclick: f.onclick, buttonDestKind: f.destKind,
  });
  resetDirtyBaseline(formEl);
}

async function persistButtonEdit(formEl, onProgress = () => {}) {
  const { colour, destination } = readButtonFields(formEl);
  if (!colour) { alert('Colour is required.'); return null; }
  if (!destination) { alert('Destination is required.'); return null; }
  const editUuid = formEl.dataset.editUuid;
  const file = formEl.dataset.containerFile;

  await mergeSave({
    formEl,
    file,
    onProgress,
    fieldSpecs: [
      { name: 'buttonLabel', type: 'scalar', label: 'Label' },
      { name: 'buttonColour', type: 'scalar', label: 'Colour' },
      { name: 'buttonTheme', type: 'scalar', label: 'Theme' },
      { name: 'buttonBorder', type: 'scalar', label: 'Border' },
      { name: 'buttonStyle', type: 'scalar', label: 'Style' },
      { name: 'buttonDestination', type: 'scalar', label: 'Destination' },
      { name: 'icon', type: 'scalar', label: 'Icon' },
      { name: 'buttonNewTab', type: 'scalar', label: 'Open in new tab' },
      { name: 'buttonDestKind', type: 'scalar', label: 'Link type' },
      { name: 'buttonOnclick', type: 'scalar', label: 'Groove link' },
    ],
    readFresh: md => buttonDimFields(locateButtonByUUID(md, editUuid) ?? {}),
    build: (md, resolved) => {
      const fresh = locateButtonByUUID(md, editUuid);
      if (!fresh) throw new Error('Button no longer exists.');
      const line = buttonLineFrom({
        label: resolved.buttonLabel,
        destination: resolved.buttonDestination,
        icon: resolved.icon,
        colour: resolved.buttonColour,
        theme: resolved.buttonTheme,
        border: resolved.buttonBorder,
        style: resolved.buttonStyle,
        primary: fresh.primary, // legacy fallback if merge resolves colour to ''
        newTab: resolved.buttonNewTab === 'yes',
        onclick: resolved.buttonOnclick,
      });
      return replaceButtonByUUID(md, editUuid, line);
    },
  });
  return { editUuid, file };
}

// ── Form actions ──────────────────────────────────────────────────────────────

registerFormAction('submitEditButton', async ({ formEl, content }) => {
  const saveBtn = content.querySelector('[data-save-state]');
  setButtonBusy(saveBtn, 'Saving…');
  try {
    if (formEl.dataset.mode === 'create') {
      const res = await persistNewButton(formEl, s => setButtonBusy(saveBtn, s));
      if (!res) { formEl._refreshSaveState?.(); return; }
      await transitionButtonCreateToEdit(formEl, res.newUuid, res.file);
    } else {
      const res = await persistButtonEdit(formEl, s => setButtonBusy(saveBtn, s));
      if (!res) { formEl._refreshSaveState?.(); return; }
    }
    formEl._refreshSaveState?.();
  } catch (e) {
    formEl._refreshSaveState?.();
    alert('Failed to save button: ' + e.message);
  }
});

registerFormAction('deleteButton', async ({ formEl, content }) => {
  const editUuid = formEl.dataset.editUuid;
  const file = formEl.dataset.containerFile;
  if (!editUuid || !file) return;
  if (!confirm('Delete this button?')) return;
  const btn = content.querySelector('[data-action="deleteButton"]');
  const snap = snapshotButton(btn);
  setButtonBusy(btn, 'Deleting…');
  try {
    await githubFetchAndPushFile(file, s => setButtonBusy(btn, s), md => deleteButtonByUUID(md, editUuid));
    await chrome.storage.local.remove(STORAGE_KEY);
    await navigateBack();
  } catch (e) {
    restoreButton(btn, snap);
    alert('Failed to delete button: ' + e.message);
  }
});
