// scripts/knowledgeBaseSettings.js
// "Knowledge Base Settings" — reached from the Knowledge Base form's dock. Owns
// the tag registry (tagRegistry.js → zensical.toml mb_created_tags): the only
// place tags are CREATED (elsewhere the tag chips are pick-only) and where each
// tag gets an optional colour (click a chip → swatch popover). Tags can't be
// removed or renamed — the registry has no delete path by design.
//
// Form state rides in two hidden inputs so the ordinary form machinery (storage
// hydration, dirty guard, save-state button) sees plain scalars:
//   tags        ", "-joined names (the tag chips are a view over it)
//   tagColours  JSON { lowercased name: palette slug }
// The opener seeds chrome.storage BEFORE createForm (the page-settings pattern)
// so hydration sets both inputs, repaints the chips via _mbSyncView, snapshots
// the dirty baseline and binds the save button in the right order.

import { createForm, isFormReplay, resetDirtyBaseline } from './form.js';
import { registerFormAction } from './formActions.js';
import { formLoading, setButtonBusy } from './loading.js';
import { attachTagChips, chipsOf } from './tagChips.js';
import { loadTagRegistry, saveTagRegistry } from './tagRegistry.js';
import { attachColourSwatchPopover } from './colourSwatchPopover.js';

const STORAGE_KEY = 'moreButtonsKnowledgeBaseSettings';

/** Registry entries → the two stored scalars. */
function fieldsFrom(entries) {
  const colours = {};
  for (const e of entries) if (e.colour) colours[e.name.toLowerCase()] = e.colour;
  return { tags: entries.map(e => e.name).join(', '), tagColours: JSON.stringify(colours) };
}

function readColours(input) {
  try { return JSON.parse(input?.value || '{}') || {}; } catch { return {}; }
}

/** The two form fields → registry entries ([{ name, colour? }]). */
function entriesFrom(formEl) {
  const colours = readColours(formEl.querySelector('[name="tagColours"]'));
  return chipsOf(formEl.querySelector('[name="tags"]')?.value ?? '').map(name => {
    const colour = colours[name.toLowerCase()];
    return colour ? { name, colour } : { name };
  });
}

export async function openKnowledgeBaseSettings() {
  formLoading.show();
  let entries;
  try {
    entries = await loadTagRegistry();
    if (!isFormReplay()) await chrome.storage.local.set({ [STORAGE_KEY]: fieldsFrom(entries) });
  } catch (e) {
    formLoading.dismiss();
    throw e;
  }
  const { formEl } = await createForm('knowledgeBaseSettings');
  if (!formEl) return;

  const tagsInput = formEl.querySelector('[name="tags"]');
  const coloursInput = formEl.querySelector('[name="tagColours"]');
  const colourOf = tag => readColours(coloursInput)[String(tag).toLowerCase()] ?? null;

  const chips = attachTagChips(tagsInput, {
    restrict: false,          // this IS where tags are created
    removable: false,         // …and never removed
    placeholder: 'New tag…',
    addLabel: '+ Create tag',
    getColour: colourOf,
    onChipClick: (tag, chipEl) => {
      popover.open(chipEl, colourOf(tag), slug => {
        const colours = readColours(coloursInput);
        const key = String(tag).toLowerCase();
        if (slug) colours[key] = slug; else delete colours[key];
        coloursInput.value = JSON.stringify(colours);
        // Real events so the dirty guard + save-state button react like typing.
        coloursInput.dispatchEvent(new Event('input', { bubbles: true }));
        coloursInput.dispatchEvent(new Event('change', { bubbles: true }));
        chips.render();
      });
    },
  });
  const popover = attachColourSwatchPopover(chips.host);
  // A colours-only hydration/rehydrate must repaint the chips too.
  coloursInput._mbSyncView = () => tagsInput._mbSyncView?.();
}

registerFormAction('openKnowledgeBaseSettings', openKnowledgeBaseSettings);

registerFormAction('saveKnowledgeBaseSettings', async ({ formEl, content }) => {
  const btn = content.querySelector('[data-save-state]');
  setButtonBusy(btn, 'Saving…');
  try {
    const saved = await saveTagRegistry(entriesFrom(formEl), s => setButtonBusy(btn, s));
    // Reflect the merged truth (another session may have added tags) and make
    // it the new clean baseline; the storage copy keeps a replay honest.
    const fields = fieldsFrom(saved);
    formEl.querySelector('[name="tagColours"]').value = fields.tagColours;
    formEl.querySelector('[name="tags"]').value = fields.tags;
    formEl.querySelector('[name="tags"]')._mbSyncView?.();
    await chrome.storage.local.set({ [STORAGE_KEY]: fields });
    resetDirtyBaseline(formEl);
    formEl._refreshSaveState?.();
  } catch (e) {
    formEl._refreshSaveState?.();
    alert('Failed to save Knowledge Base settings: ' + e.message);
  }
});
