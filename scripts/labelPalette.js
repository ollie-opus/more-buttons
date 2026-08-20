// scripts/labelPalette.js
// The shared label colour palette (config/labelColours.json): 26 named colours
// in two groups (chromatic + neutrals), each with light/dark bg/text/border.
// Consumed by the rich-text Label popover, the button editor's colour swatches,
// the tag chips (tag colours) and the colour-swatch popover. Kept in its own
// tiny module so light widgets (tagChips) don't drag the whole rich-text editor
// graph into their unit tests; the fetch is lazy so importing is test-safe.

let _palettePromise = null;

/** { groups: { Chromatic: {Red: preset…}, Neutrals: {…} }, flat: { red: preset… } } */
export function loadLabelPalette() {
  if (_palettePromise) return _palettePromise;
  _palettePromise = fetch(chrome.runtime.getURL('config/labelColours.json'))
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(groups => {
      const flat = {};
      for (const presets of Object.values(groups)) {
        for (const [name, preset] of Object.entries(presets)) flat[name.toLowerCase()] = preset;
      }
      return { groups, flat };
    })
    .catch(err => { console.error('MB Error: Failed to load labelColours.json:', err); return { groups: {}, flat: {} }; });
  return _palettePromise;
}

/** Paint one preset onto an element as the six CSS custom props the
 *  `.mb-label` (and `.mb-tag-chip.--coloured`) rules consume — light + dark so
 *  the element tracks prefers-color-scheme. */
export function paintLabelVars(el, preset) {
  if (!el || !preset) return;
  el.style.setProperty('--bg', preset.light.bg);
  el.style.setProperty('--text', preset.light.text);
  el.style.setProperty('--border', preset.light.border);
  el.style.setProperty('--bg-dark', preset.dark.bg);
  el.style.setProperty('--text-dark', preset.dark.text);
  el.style.setProperty('--border-dark', preset.dark.border);
}
