// scripts/colourSwatchPopover.js
// A small "pick a label colour" popover: the 26-swatch grid (chromatic +
// neutrals, from labelPalette.js) plus a "No colour" swatch, with Cancel /
// Apply. Anchored under any element inside `host` (host becomes the
// positioning context). One popover per host (idempotent); the visuals reuse
// the rich-text Label popover classes (.mb-rte__popover, .mb-rte__swatch-*).
//
//   const pop = attachColourSwatchPopover(host);
//   pop.open(chipEl, 'emerald', slug => { … })   // slug is null for "No colour"

import { loadLabelPalette, paintLabelVars } from './labelPalette.js';

const NONE = '';

export function attachColourSwatchPopover(host) {
  if (!host) return undefined;
  if (host._mbSwatchPopover) return host._mbSwatchPopover;
  const doc = host.ownerDocument;

  const popover = doc.createElement('div');
  popover.className = 'mb-rte__popover mb-rte__popover--label mb-swatch-popover';
  popover.hidden = true;
  popover.innerHTML = `
    <div class="mb-rte__swatch-grid" data-swatches></div>
    <div class="mb-rte__popover-actions">
      <button type="button" class="mb-rte__popover-btn" data-swatch-cancel>Cancel</button>
      <button type="button" class="mb-rte__popover-btn --primary" data-swatch-apply>Apply</button>
    </div>`;
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.appendChild(popover);

  const grid = popover.querySelector('[data-swatches]');
  const swatchBtns = [];
  let selected = NONE;
  let onPick = null;

  const select = slug => {
    selected = slug || NONE;
    swatchBtns.forEach(b => b.classList.toggle('--selected', b.dataset.slug === selected));
  };

  const makeSwatch = (slug, text) => {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'mb-label mb-rte__swatch' + (slug ? ` mb-label-${slug}` : ' --none');
    btn.dataset.slug = slug;
    btn.textContent = text;
    btn.addEventListener('click', () => select(slug));
    swatchBtns.push(btn);
    return btn;
  };

  const build = groups => {
    grid.replaceChildren();
    swatchBtns.length = 0;
    const noneRow = doc.createElement('div');
    noneRow.className = 'mb-rte__swatch-row';
    noneRow.appendChild(makeSwatch(NONE, 'No colour'));
    grid.appendChild(noneRow);
    for (const [groupName, presets] of Object.entries(groups)) {
      const title = doc.createElement('span');
      title.className = 'mb-rte__swatch-title';
      title.textContent = groupName;
      grid.appendChild(title);
      const row = doc.createElement('div');
      row.className = 'mb-rte__swatch-row';
      for (const [name, preset] of Object.entries(presets)) {
        const btn = makeSwatch(name.toLowerCase(), name);
        paintLabelVars(btn, preset);
        row.appendChild(btn);
      }
      grid.appendChild(row);
    }
    select(selected);
  };
  loadLabelPalette().then(({ groups }) => build(groups));

  const onDocMouseDown = e => { if (!popover.hidden && !popover.contains(e.target)) close(); };
  const onKeyDown = e => {
    if (e.key !== 'Escape' || popover.hidden) return;
    e.stopPropagation(); // keep the overlay open
    e.preventDefault();
    close();
  };
  const close = () => {
    popover.hidden = true;
    onPick = null;
    doc.removeEventListener('mousedown', onDocMouseDown, true);
    doc.removeEventListener('keydown', onKeyDown, true);
  };

  const open = (anchor, currentSlug, pick) => {
    onPick = pick;
    select(currentSlug || NONE);
    popover.hidden = false;
    // Below the anchor, left-aligned with it; the host is the offset parent.
    const top = anchor.offsetTop + anchor.offsetHeight + 4;
    let left = anchor.offsetLeft;
    const overflow = left + popover.offsetWidth - host.clientWidth;
    if (overflow > 0) left = Math.max(0, left - overflow);
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
    doc.addEventListener('mousedown', onDocMouseDown, true);
    doc.addEventListener('keydown', onKeyDown, true);
  };

  popover.querySelector('[data-swatch-cancel]').addEventListener('click', close);
  popover.querySelector('[data-swatch-apply]').addEventListener('click', () => {
    const cb = onPick;
    const slug = selected || null;
    close();
    cb?.(slug);
  });

  const api = { open, close, element: popover };
  host._mbSwatchPopover = api;
  return api;
}
