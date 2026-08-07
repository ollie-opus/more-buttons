// scripts/suggestCombobox.js
// Type-to-search suggestion dropdown on a text input — the iconPicker combobox
// pattern (same CSS classes) minus the glyph column. Prefix matches outrank
// substring matches; free text is always allowed (the dropdown is purely a
// shortcut). Shared by the nav-links Tag field (whole-value mode) and the
// page-settings Tags field (segmented mode: completes only the text after the
// last comma, so several comma-separated values can each be picked).

/**
 * Split a comma-separated value at its last comma. `head` includes the
 * trailing comma ('' when there is none); `tail` is the remainder with
 * surrounding whitespace trimmed (the active query).
 * @returns {{head: string, tail: string}}
 */
export function splitLastSegment(value) {
  const s = String(value ?? '');
  const i = s.lastIndexOf(',');
  if (i === -1) return { head: '', tail: s.trim() };
  return { head: s.slice(0, i + 1), tail: s.slice(i + 1).trim() };
}

/**
 * Replace the segment after the last comma with `item`, normalizing only that
 * one separator to ', '. Earlier segments are preserved byte-for-byte.
 * ('System,Con', 'Contractors') → 'System, Contractors'
 * ('Con', 'X') → 'X'
 * @returns {string}
 */
export function completeLastSegment(value, item) {
  const { head } = splitLastSegment(value);
  if (!head) return item;
  return head.replace(/[ \t]*,$/, ',') + ' ' + item;
}

/**
 * Upgrade a text input into a suggestion combobox. Idempotent; degrades to a
 * plain input while (or if) `getItems` hasn't delivered.
 * @param {HTMLInputElement} input
 * @param {{getItems: () => Promise<string[]>, segmented?: boolean}} opts
 *   `segmented: true` queries/completes only the text after the last comma and
 *   hides items already present as earlier segments.
 */
export function attachSuggestCombobox(input, { getItems, segmented = false }) {
  if (!input || input._suggestCombobox) return;
  input._suggestCombobox = true;

  const wrap = document.createElement('div');
  wrap.className = 'more-buttons-icon-picker';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const dropdown = document.createElement('div');
  dropdown.className = 'more-buttons-icon-picker-dropdown';
  dropdown.style.display = 'none';
  wrap.appendChild(dropdown);
  // A mousedown in the dropdown must not blur the input (blur closes the list).
  dropdown.addEventListener('mousedown', e => e.preventDefault());

  let items = null;
  Promise.resolve(getItems())
    .then(list => { items = list; if (document.activeElement === input) render(); })
    .catch(() => { items = []; });

  let rows = [];
  let active = -1;

  const close = () => { dropdown.style.display = 'none'; active = -1; };

  const select = (item) => {
    input.value = segmented ? completeLastSegment(input.value, item) : item;
    // Real input/change events so the dirty guard + save-state button react.
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    close();
  };

  const setActive = (i) => {
    rows[active]?.classList.remove('active');
    active = i;
    if (rows[active]) {
      rows[active].classList.add('active');
      rows[active].scrollIntoView({ block: 'nearest' });
    }
  };

  const render = () => {
    if (!items?.length) { close(); return; }
    let q, taken;
    if (segmented) {
      const { head, tail } = splitLastSegment(input.value);
      q = tail.toLowerCase();
      // Segments already entered before the cursor's segment — don't re-suggest.
      taken = new Set(head.split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
    } else {
      q = input.value.trim().toLowerCase();
      taken = new Set();
    }
    const prefix = [], substr = [];
    for (const item of items) {
      const l = item.toLowerCase();
      if (taken.has(l)) continue;
      if (!q || l.startsWith(q)) prefix.push(item);
      else if (l.includes(q)) substr.push(item);
    }
    const matches = [...prefix, ...substr];
    rows = [];
    active = -1;
    dropdown.replaceChildren();
    if (!matches.length) { close(); return; }
    for (const item of matches) {
      const row = document.createElement('div');
      row.className = 'more-buttons-icon-picker-row';
      row.dataset.item = item;
      row.textContent = item;
      row.addEventListener('mousedown', e => { e.preventDefault(); select(item); });
      dropdown.appendChild(row);
      rows.push(row);
    }
    dropdown.style.display = '';
  };

  input.addEventListener('input', render);
  input.addEventListener('focus', render);
  input.addEventListener('blur', close);
  input.addEventListener('keydown', e => {
    if (dropdown.style.display === 'none') return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(active + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(active - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0) select(rows[active].dataset.item); }
    else if (e.key === 'Escape') { e.stopPropagation(); close(); }
  });
}
