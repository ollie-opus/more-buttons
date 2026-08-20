/**
 * tagChips.js — the shared "tag chips" widget:
 *
 *   [System ×] [RAMS ×] [+ Add tag]
 *
 * A *view* over an ordinary named text input holding the canonical `', '`-joined
 * tag list. That backing input is what every form mechanism sees — dirty guard,
 * storage persistence + hydration, `readFormValues`, mergeSave's scalar 3-way
 * merge and its rehydrate — so none of them need to know chips exist. Every
 * add/remove rewrites `input.value` and dispatches bubbling `input` + `change`
 * (the same contract suggestCombobox.select keeps).
 *
 * The other direction: whoever sets `input.value` programmatically (form.js
 * hydration, mergeSave rehydrate) calls `input._mbSyncView?.()` afterwards and
 * the chips repaint.
 *
 * "+ Add tag" swaps itself for an inline input upgraded with the shared
 * suggestion combobox (whole-value mode; already-chipped tags are hidden).
 * Commit rules: pick a suggestion / Enter / comma → add a chip and stay open for
 * the next; blur with text → commit and close; Escape → discard and close;
 * Backspace on an empty inline input → remove the last chip. Enter is always
 * default-prevented so it can never submit the surrounding form.
 *
 * Options beyond the suggestion source:
 *   restrict    — pick-only: a typed value commits only when it matches one of
 *                 `getItems` (case-insensitive; the list's spelling wins),
 *                 anything else is dropped. Chips already in the value always
 *                 render (legacy tags survive), only new commits are gated.
 *   removable   — false hides the × buttons (and Backspace-removes-last).
 *   onChipClick — click on a chip's text → callback(tag, chipEl).
 *   getColour   — tag → label-palette slug|null; coloured chips are painted
 *                 with the palette (`.mb-tag-chip.--coloured`).
 *
 * Pure helpers (addTag / removeTag / chipsOf / resolveRestricted) are
 * unit-tested; the DOM part is verified in-browser.
 */

import { splitTagList } from './frontmatter.js';
import { attachSuggestCombobox } from './suggestCombobox.js';
import { loadLabelPalette, paintLabelVars } from './labelPalette.js';

/** Default hint for a pick-only widget whose registry is empty. */
export const NO_TAGS_TEXT = 'No tags yet — create tags in Knowledge Base Settings';

/** Canonical CSV → chip list (trim, drop empties, case-insensitive dedupe). */
export function chipsOf(csv) {
  return splitTagList(csv);
}

/** One tag's text as it may appear in a chip: no commas (they are the list
 *  separator), whitespace collapsed, trimmed. */
function cleanTag(tag) {
  return String(tag ?? '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Append `tag` to the CSV. Empty tag → normalised CSV unchanged; a duplicate
 * (case-insensitive) keeps the first spelling and position.
 * @returns {string} the new `', '`-joined value
 */
export function addTag(csv, tag) {
  const t = cleanTag(tag);
  const list = chipsOf(csv);
  if (t) list.push(t);
  return splitTagList(list.join(',')).join(', ');
}

/** Remove `tag` (case-insensitive) from the CSV. @returns {string} */
export function removeTag(csv, tag) {
  const want = cleanTag(tag).toLowerCase();
  return chipsOf(csv).filter(t => t.toLowerCase() !== want).join(', ');
}

/**
 * Pick-only resolution: the canonical spelling of `typed` in `known`
 * (case-insensitive), or null when it isn't a known tag. `known` null/absent
 * (list not loaded yet) also resolves to null — nothing commits blind.
 */
export function resolveRestricted(known, typed) {
  const want = cleanTag(typed).toLowerCase();
  if (!want || !Array.isArray(known)) return null;
  return known.find(k => String(k).trim().toLowerCase() === want) ?? null;
}

/**
 * Upgrade a named text input into the chips widget. Idempotent (returns the
 * existing controller on a second call). Degrades gracefully: without
 * `getItems` the inline input is plain free-text.
 * @param {HTMLInputElement} input   the backing input (kept in the DOM, hidden)
 * @param {{getItems?: () => Promise<string[]>, placeholder?: string, addLabel?: string,
 *          restrict?: boolean, removable?: boolean, onChipClick?: (tag: string, chip: HTMLElement) => void,
 *          getColour?: (tag: string) => string|null, emptyText?: string|null}} [opts]
 * @returns {{host: HTMLElement, render: () => void, add: (t: string) => void, remove: (t: string) => void}|undefined}
 */
export function attachTagChips(input, {
  getItems = null, placeholder = 'Type a tag…', addLabel = '+ Add tag',
  restrict = false, removable = true, onChipClick = null, getColour = null,
  emptyText = null,
} = {}) {
  if (!input) return undefined;
  if (input._tagChips) return input._tagChips;
  if (restrict && emptyText === null) emptyText = NO_TAGS_TEXT;

  const doc = input.ownerDocument;
  // type=hidden (not the [hidden] attribute) so no form stylesheet's
  // `input { display:… }` can resurrect it. readFormValues / hydration /
  // validation all treat it as a plain value-carrying input.
  input.type = 'hidden';

  const host = doc.createElement('div');
  host.className = 'mb-tag-chips';
  input.insertAdjacentElement('afterend', host);

  const addBtn = doc.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'mb-tag-chips__add';
  addBtn.textContent = addLabel;

  const editor = doc.createElement('span');
  editor.className = 'mb-tag-chips__editor';
  const inline = doc.createElement('input');
  inline.type = 'text';
  inline.className = 'mb-tag-chips__input';
  inline.placeholder = placeholder;
  inline.autocomplete = 'off';
  inline.setAttribute('aria-label', addLabel.replace(/^\+\s*/, ''));
  editor.appendChild(inline);

  let editing = false;

  const setValue = (next) => {
    if (next === input.value) return;
    input.value = next;
    // Real bubbling events so the dirty guard, save-state button and error
    // clearing all react exactly as they would to typing.
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    render();
  };

  const add = (t) => setValue(addTag(input.value, t));
  const remove = (t) => setValue(removeTag(input.value, t));

  // The suggestion list is loaded once and shared by the combobox and the
  // pick-only gate (`known`); the palette paints coloured chips once loaded.
  let known = null;
  const itemsPromise = getItems ? Promise.resolve().then(getItems).then(list => {
    known = Array.isArray(list) ? list : [];
    render();
    return known;
  }).catch(() => { known = []; return known; }) : null;
  let palette = null;
  if (getColour) loadLabelPalette().then(({ flat }) => { palette = flat; render(); });

  // Repaint the chips, leaving the trailing control (add button OR open
  // editor) attached: detaching a focused inline input would blur → close it.
  const render = () => {
    host.querySelectorAll(':scope > .mb-tag-chip').forEach(n => n.remove());
    const tail = editing ? editor : addBtn;
    const other = editing ? addBtn : editor;
    if (other.parentNode === host) other.remove();
    if (tail.parentNode !== host) host.appendChild(tail);
    const frag = doc.createDocumentFragment();
    for (const tag of chipsOf(input.value)) {
      const chip = doc.createElement('span');
      chip.className = 'mb-tag-chip';
      if (!removable) chip.classList.add('--static');
      if (onChipClick) chip.classList.add('mb-tag-chip--clickable');
      chip.dataset.tag = tag;
      const text = doc.createElement('span');
      text.className = 'mb-tag-chip__text';
      text.textContent = tag;
      chip.appendChild(text);
      if (removable) {
        const x = doc.createElement('button');
        x.type = 'button';
        x.className = 'mb-tag-chip__remove';
        x.setAttribute('aria-label', `Remove ${tag}`);
        x.dataset.tag = tag;
        x.textContent = '×';
        chip.appendChild(x);
      }
      const slug = getColour ? getColour(tag) : null;
      const preset = slug && palette?.[String(slug).toLowerCase()];
      if (preset) {
        chip.classList.add('--coloured');
        chip.dataset.colour = String(slug).toLowerCase();
        paintLabelVars(chip, preset);
      }
      frag.appendChild(chip);
    }
    host.insertBefore(frag, tail);
  };

  const openEditor = () => {
    if (editing) { inline.focus(); return; }
    editing = true;
    inline.value = '';
    render();
    inline.focus();
  };

  const closeEditor = () => {
    if (!editing) return;
    editing = false;
    inline.value = '';
    render();
  };

  // Commit whatever is typed as a chip; the editor stays open for the next tag.
  // Pick-only widgets commit the list's spelling of a known tag, or nothing.
  const commit = () => {
    const t = inline.value;
    inline.value = '';
    if (!cleanTag(t)) return;
    if (restrict) {
      const canonical = resolveRestricted(known, t);
      if (canonical) add(canonical);
      return;
    }
    add(t);
  };

  // Suggestion dropdown on the inline input (whole-value mode). Suggestions
  // already present as chips are hidden.
  if (itemsPromise) {
    attachSuggestCombobox(inline, { getItems: () => itemsPromise, getTaken: () => chipsOf(input.value), emptyText });
  }

  host.addEventListener('click', (e) => {
    const x = e.target.closest('.mb-tag-chip__remove');
    if (x) { remove(x.dataset.tag); return; }
    const chipText = e.target.closest('.mb-tag-chip__text');
    if (chipText && onChipClick) { onChipClick(chipText.parentNode.dataset.tag, chipText.parentNode); return; }
    if (e.target.closest('.mb-tag-chips__add')) openEditor();
  });
  // A mousedown on × must not blur (and thereby close) an open inline editor —
  // closing would re-render and swallow the click.
  host.addEventListener('mousedown', (e) => {
    if (e.target.closest('.mb-tag-chip__remove')) e.preventDefault();
  });

  // Picking a suggestion sets inline.value and dispatches change → commit.
  inline.addEventListener('change', () => { if (cleanTag(inline.value)) commit(); });
  // A comma arriving through any route (typed on some keyboards/IMEs, pasted
  // "a, b, c") splits: every complete segment becomes a chip, the tail stays.
  inline.addEventListener('input', () => {
    if (!inline.value.includes(',')) return;
    const parts = inline.value.split(',');
    const tail = parts.pop();
    for (const p of parts) {
      if (!cleanTag(p)) continue;
      if (restrict) { const c = resolveRestricted(known, p); if (c) add(c); }
      else add(p);
    }
    inline.value = tail.replace(/^\s+/, '');
    // Re-announce so the combobox (listening before us) re-queries on the tail.
    inline.dispatchEvent(new Event('input', { bubbles: true }));
  });
  inline.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      // The combobox (listening first) selects the active row, which commits
      // via `change` and empties the input — so this commit is then a no-op;
      // with no active row it commits the free text. Never submits the form.
      e.preventDefault();
      commit();
    } else if (e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.stopPropagation();                // keep the overlay open
      e.preventDefault();
      closeEditor();
    } else if (e.key === 'Backspace' && !inline.value && removable) {
      const chips = chipsOf(input.value);
      if (chips.length) remove(chips[chips.length - 1]);
    }
  });
  inline.addEventListener('blur', () => {
    if (cleanTag(inline.value)) commit();
    closeEditor();
  });

  const api = { host, render, add, remove };
  input._tagChips = api;
  input._mbSyncView = render;
  render();
  return api;
}
