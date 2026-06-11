// scripts/iconPicker.js
// Type-to-search combobox for lucide icon names on a plain text input.
// Names come from the bundled config/lucideIcons.json (generated from the
// zensical install — see tools/regen-lucide-icons.sh). Previews are lucide
// SVGs fetched lazily from jsdelivr and INLINED (inline SVG is exempt from
// the page's img-src CSP; jsdelivr serves CORS *). Selecting a row writes
// `lucide/<name>` into the input. If the name list fails to load, the input
// simply stays a plain text input — saving still works.

const MAX_RESULTS = 30;
const CDN = 'https://cdn.jsdelivr.net/npm/lucide-static/icons/';

let namesPromise = null;
function loadNames() {
  namesPromise ??= fetch(chrome.runtime.getURL('config/lucideIcons.json'))
    .then(r => r.json())
    .catch(() => null);
  return namesPromise;
}

// name → Promise<string> ('' = fetch failed; that row just shows no preview)
const svgCache = new Map();
function fetchSvg(name) {
  if (!svgCache.has(name)) {
    svgCache.set(name, fetch(`${CDN}${encodeURIComponent(name)}.svg`)
      .then(r => (r.ok ? r.text() : ''))
      .catch(() => ''));
  }
  return svgCache.get(name);
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

  const close = () => { dropdown.style.display = 'none'; active = -1; };

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
      fetchSvg(name).then(svg => {
        // Defense-in-depth: the CDN is trusted-ish but unpinned — never inject
        // markup that could carry handlers or scripts into the host page.
        if (svg.trimStart().startsWith('<svg') && !/<script|\bon\w+\s*=/i.test(svg)) {
          glyph.innerHTML = svg;
        }
      });
    }
    dropdown.style.display = '';
  };

  let debounce = null;
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
