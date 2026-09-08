// scripts/iconPicker.js
// Type-to-search combobox for lucide icon names on a plain text input.
// Names AND art come from the bundled config/lucideIcons.json +
// config/lucideIconBodies.json, both generated in one pass from the zensical
// install the knowledge base builds with (tools/regen-lucide-icons.sh), so the
// picker offers exactly the icons the site renders and previews them with the
// site's own artwork. Previews are INLINED SVG (exempt from the page's img-src
// CSP; no network, no version drift). Selecting a row writes `lucide/<name>`
// into the input. If the name list fails to load, the input simply stays a
// plain text input — saving still works.

const MAX_RESULTS = 30;

let namesPromise = null;
function loadNames() {
  namesPromise ??= fetch(chrome.runtime.getURL('config/lucideIcons.json'))
    .then(r => r.json())
    .catch(() => null);
  return namesPromise;
}

/** The bundled lucide name list (string[]), or null if it failed to load. */
export function loadLucideNames() { return loadNames(); }

// Lazily-loaded {name: innerSVG} map (~340 KB) — kept separate from the eager
// names list (29 KB) so a form open never pays for art it doesn't preview.
let bodiesPromise = null;
function loadBodies() {
  bodiesPromise ??= fetch(chrome.runtime.getURL('config/lucideIconBodies.json'))
    .then(r => r.json())
    .catch(() => null);
  return bodiesPromise;
}

// The one envelope every zensical lucide SVG shares (asserted by the regen
// script); bodies are stored without it and re-wrapped here.
function wrapBody(name, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="lucide lucide-${name}" viewBox="0 0 24 24">${body}</svg>`;
}

/**
 * Resolves a lucide icon to markup safe to assign to innerHTML, or '' when
 * the name isn't in the bundled set (or the map failed to load). Bodies come
 * from the repo's own generated file, but the markup lands in the host page
 * via innerHTML, so the no-script/no-handler check stays as belt-and-braces.
 * Shared by the picker dropdown, the RTE icon popover and the button preview
 * tiles. Promise-returning so callers needn't care that the map is lazy.
 */
export function getLucideSvgMarkup(name) {
  return loadBodies().then(bodies => {
    const body = bodies && typeof bodies[name] === 'string' ? bodies[name] : '';
    if (!body || /<script|\bon\w+\s*=/i.test(body)) return '';
    return wrapBody(name, body);
  });
}

// Fill every empty `.mb-icon[data-mb-icon]` under `root` with its lucide SVG.
// renderHtml (markdownInline) emits the span empty because it's synchronous and
// pure; this is the async paint pass — the icon twin of richTextEditor's
// paintLabels, and fanned out to the same preview sites via paintInlineAtoms.
// Idempotent (already-painted spans are skipped), so re-running after a
// re-render is cheap. Serialization ignores the injected SVG (buildSource emits
// the shortcode from data-mb-icon and never walks inside).
export function paintIcons(root) {
  if (!root) return;
  root.querySelectorAll('.mb-icon[data-mb-icon]').forEach(span => {
    if (span.querySelector('svg')) return;
    const name = span.getAttribute('data-mb-icon');
    getLucideSvgMarkup(name).then(body => {
      if (body && !span.querySelector('svg')) span.innerHTML = body;
    });
  });
}

// Prefix matches outrank substring matches; `lucide/` is ignored while typing
// so a saved value like "lucide/user-plus" still filters sensibly on refocus.
function rankMatches(names, query) {
  const q = query.toLowerCase().trim().replace(/^lucide\//, '');
  if (!q) return names.slice(0, MAX_RESULTS);
  const prefix = [], substr = [];
  for (const n of names) {
    if (n.startsWith(q)) { if (prefix.length < MAX_RESULTS) prefix.push(n); }
    else if (n.includes(q) && substr.length < MAX_RESULTS) substr.push(n);
  }
  return [...prefix, ...substr].slice(0, MAX_RESULTS);
}

/** Upgrade a text input into a lucide-icon search combobox. Idempotent. */
export async function attachIconPicker(input) {
  if (!input || input._iconPicker) return;
  const names = await loadNames();
  if (!Array.isArray(names) || !names.length) return; // degrade: plain input
  input._iconPicker = true;

  const wrap = document.createElement('div');
  wrap.className = 'more-buttons-icon-picker';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const dropdown = document.createElement('div');
  dropdown.className = 'more-buttons-icon-picker-dropdown';
  dropdown.style.display = 'none';
  wrap.appendChild(dropdown);

  // A mousedown anywhere in the dropdown (rows, scrollbar) must not blur the
  // input — blur would close the list before the interaction lands.
  dropdown.addEventListener('mousedown', e => e.preventDefault());

  let rows = [];
  let active = -1;
  let debounce = null;

  const close = () => { clearTimeout(debounce); debounce = null; dropdown.style.display = 'none'; active = -1; };

  const select = (name) => {
    input.value = `lucide/${name}`;
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
    const matches = rankMatches(names, input.value);
    rows = [];
    active = -1;
    dropdown.replaceChildren();
    if (!matches.length) { close(); return; }
    for (const name of matches) {
      const row = document.createElement('div');
      row.className = 'more-buttons-icon-picker-row';
      row.dataset.name = name;
      const glyph = document.createElement('span');
      glyph.className = 'more-buttons-icon-picker-glyph';
      row.appendChild(glyph);
      row.appendChild(document.createTextNode(name));
      row.addEventListener('mousedown', e => { e.preventDefault(); select(name); });
      dropdown.appendChild(row);
      rows.push(row);
      getLucideSvgMarkup(name).then(body => {
        if (body) glyph.innerHTML = body;
      });
    }
    dropdown.style.display = '';
  };

  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(render, 120);
  });
  input.addEventListener('focus', render);
  input.addEventListener('blur', close);
  input.addEventListener('keydown', e => {
    if (dropdown.style.display === 'none') return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(active + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(active - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0) select(rows[active].dataset.name); }
    else if (e.key === 'Escape') { e.stopPropagation(); close(); }
  });
}
