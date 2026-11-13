/**
 * kbAdminSettings.js — /admin/settings/ on the Knowledge Base site (see
 * kbAdmin.js): the Knowledge Base Settings form, as a page.
 *
 * Owns the tag registry (tagRegistry.js → zensical.toml mb_created_tags): the
 * one place tags are created, and where each gets an optional colour. Tags
 * cannot be removed or renamed; the registry has no delete path by design.
 * A coloured tag is drawn with the site's own label pill (`.mb-label-<slug>`,
 * labels.css), so what shows here is what the site shows.
 */

import { loadTagRegistry, saveTagRegistry } from './tagRegistry.js';
import { loadLabelPalette } from './labelPalette.js';
import { snapshotButton, restoreButton } from './loading.js';
import { escapeHtml, noticeHtml, busyAction } from './kbAdmin.js';

const slugOfColour = name => String(name).trim().toLowerCase();
const signature = entries => JSON.stringify(entries.map(e => [e.name, e.colour || '']));

export async function mountSettings(ctx) {
  let saved;
  let palette;
  try {
    [saved, palette] = await Promise.all([loadTagRegistry(), loadLabelPalette()]);
  } catch (err) {
    ctx.body.innerHTML = noticeHtml('failure', 'The settings could not be loaded', err?.message ?? String(err));
    return null;
  }
  if (!ctx.alive()) return null;

  let entries = saved.map(e => ({ ...e }));
  let selected = null;   // lowercased name of the tag whose colours are showing
  let busy = false;
  const colourNames = Object.values(palette.groups ?? {}).flatMap(group => Object.keys(group));

  ctx.body.innerHTML = `
    <div data-adm-notice></div>
    <section class="mb-adm-section">
      <h2>Tags</h2>
      <p>Every tag a page can carry. Select a tag to give it a colour: coloured tags show as pills on nav-links buttons. A tag cannot be renamed or removed once it is saved.</p>
      <div class="mb-adm-tags" data-adm-tags></div>
      <div data-adm-colours></div>
      <form class="mb-adm-inline-form" data-adm-new novalidate>
        <label for="mb-adm-new-tag">New tag</label>
        <div class="mb-adm-inline-form__row">
          <input id="mb-adm-new-tag" class="mb-adm-input" type="text" name="tag" placeholder="e.g. System" autocomplete="off" maxlength="60">
          <button type="submit" class="mb-adm-button">Add tag</button>
        </div>
        <p class="mb-adm-error" data-adm-error hidden></p>
      </form>
    </section>`;

  const tagsEl = ctx.body.querySelector('[data-adm-tags]');
  const coloursEl = ctx.body.querySelector('[data-adm-colours]');
  const noticeEl = ctx.body.querySelector('[data-adm-notice]');
  const errorEl = ctx.body.querySelector('[data-adm-error]');
  const newForm = ctx.body.querySelector('[data-adm-new]');

  const dirty = () => signature(entries) !== signature(saved);
  const isNew = e => !saved.some(s => s.name.toLowerCase() === e.name.toLowerCase());
  const pillClass = colour => (colour ? ` mb-label mb-label-${escapeHtml(slugOfColour(colour))}` : '');

  function drawActions() {
    const d = dirty();
    ctx.setActions([[{
      act: 'save', icon: 'save', label: d ? 'Save settings' : 'Settings saved',
      colour: d ? 'accent' : '', disabled: !d,
    }]], (act, btn) => save(btn), { at: 'end' });
  }

  function draw() {
    tagsEl.innerHTML = entries.length
      ? entries.map(e => {
        const key = e.name.toLowerCase();
        return `<button type="button" class="mb-adm-tag${pillClass(e.colour)}" data-adm-tag="${escapeHtml(key)}" aria-pressed="${selected === key}"${isNew(e) ? ' data-adm-unsaved title="Not saved yet"' : ''}>${escapeHtml(e.name)}</button>`;
      }).join('')
      : '<p class="mb-adm-empty">No tags yet. Add the first one below.</p>';

    const entry = entries.find(e => e.name.toLowerCase() === selected);
    coloursEl.innerHTML = entry ? `
      <div class="mb-adm-colours" role="group" aria-label="Colour for ${escapeHtml(entry.name)}">
        <p class="mb-adm-colours__title">Colour for <strong>${escapeHtml(entry.name)}</strong></p>
        <div class="mb-adm-colours__list">
          <button type="button" class="mb-adm-tag" data-adm-colour="" aria-pressed="${!entry.colour}">No colour</button>
          ${colourNames.map(name => `<button type="button" class="mb-adm-tag mb-label mb-label-${escapeHtml(slugOfColour(name))}" data-adm-colour="${escapeHtml(slugOfColour(name))}" aria-pressed="${slugOfColour(entry.colour || '') === slugOfColour(name)}">${escapeHtml(name)}</button>`).join('')}
        </div>
      </div>` : '';
  }

  async function save(btn) {
    if (busy || !dirty()) return;
    busy = true;
    noticeEl.innerHTML = '';
    const snap = snapshotButton(btn);
    busyAction(btn, 'Saving…');
    try {
      // The merged truth comes back: another session may have added tags.
      saved = await saveTagRegistry(entries.map(e => (e.colour ? { name: e.name, colour: e.colour } : { name: e.name })), s => busyAction(btn, s));
      if (!ctx.alive()) return;
      entries = saved.map(e => ({ ...e }));
      draw();
      drawActions();
    } catch (err) {
      restoreButton(btn, snap);
      noticeEl.innerHTML = noticeHtml('failure', 'The settings could not be saved', err?.message ?? String(err));
    } finally {
      busy = false;
    }
  }

  ctx.body.addEventListener('click', e => {
    const t = e.target instanceof Element ? e.target : null;
    const tag = t?.closest('[data-adm-tag]');
    if (tag) {
      selected = selected === tag.dataset.admTag ? null : tag.dataset.admTag;
      draw();
      tagsEl.querySelector(`[data-adm-tag="${CSS.escape(tag.dataset.admTag)}"]`)?.focus({ preventScroll: true });
      return;
    }
    const colour = t?.closest('[data-adm-colour]');
    if (colour) {
      const entry = entries.find(x => x.name.toLowerCase() === selected);
      if (!entry) return;
      if (colour.dataset.admColour) entry.colour = colour.dataset.admColour; else delete entry.colour;
      draw();
      drawActions();
      coloursEl.querySelector(`[data-adm-colour="${colour.dataset.admColour}"]`)?.focus({ preventScroll: true });
    }
  });

  newForm.addEventListener('input', () => { errorEl.hidden = true; });
  newForm.addEventListener('submit', e => {
    e.preventDefault();
    const input = newForm.elements.tag;
    const name = input.value.trim().replace(/\s+/g, ' ');
    let problem = '';
    if (!name) problem = 'Type a name for the tag.';
    else if (/[,"\[\]]/.test(name)) problem = 'A tag cannot contain commas, quotes or square brackets.';
    else if (entries.some(x => x.name.toLowerCase() === name.toLowerCase())) problem = `"${name}" is already a tag.`;
    errorEl.textContent = problem;
    errorEl.hidden = !problem;
    if (problem) { input.focus(); return; }
    entries.push({ name });
    selected = name.toLowerCase();   // straight to choosing its colour
    input.value = '';
    draw();
    drawActions();
  });

  draw();
  drawActions();

  return {
    isDirty: () => dirty() && !busy,
    canLeave: () => !dirty() || window.confirm('Leave without saving the changes to the tags?'),
  };
}
