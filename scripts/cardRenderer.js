export function escapeHtml(str) {
  return (str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// colour: accent variant slug (red|amber|green|blue|purple|light-blue|cyan|teal|
//         light-green|orange|bright-red|pink|deep-purple|grey|outline|step)
// title: card title
// badge: short label rendered in accent colour (uppercased via CSS)
// description: optional body preview (omitted when falsy)
// meta: optional bottom-left info line (omitted when falsy)
// btnAttr: attribute string for the action button, e.g. 'data-edit-system-update="0"'
// btnLabel: button text
export function renderCard({ colour, title, badge, description, meta, btnAttr, btnLabel }) {
  const hasMeta = meta != null && meta !== '';
  return `
  <div class="mb-incident-card --${colour}">
    <div class="mb-incident-card__head">
      <strong class="mb-incident-card__title">${escapeHtml(title)}</strong>
      <span class="mb-incident-card__badge">${escapeHtml(badge)}</span>
    </div>
    ${description ? `<p class="mb-incident-card__body">${escapeHtml(description)}</p>` : ''}
    <div class="mb-incident-card__foot${hasMeta ? '' : ' --end'}">
      ${hasMeta ? `<span class="mb-incident-card__meta">${escapeHtml(meta)}</span>` : ''}
      <button type="button" class="mb-incident-card__edit" ${btnAttr}>${btnLabel}</button>
    </div>
  </div>`;
}

// A capture rendered as a card matching the admonition cards: neutral/grey,
// "CAPTURE" badge top-right, a thumbnail preview, and an Edit button. Used in the
// unified Components list. `thumbSrc` is the light-mode image (CDN url for an
// existing capture, or a data: url for a freshly-captured pending one).
// `btnAttr` wires the Edit button (e.g. 'data-edit-component="<uuid>"').
export function captureComponentCard({ thumbSrc, btnAttr, btnLabel = 'Edit' }) {
  return `
  <div class="mb-incident-card --grey mb-component-card--capture">
    <div class="mb-incident-card__head">
      <strong class="mb-incident-card__title">Capture</strong>
      <span class="mb-incident-card__badge">Capture</span>
    </div>
    ${thumbSrc ? `<div class="mb-incident-card__body mb-component-card__thumb-row"><img class="mb-component-card__thumb" src="${escapeHtml(thumbSrc)}" alt="" loading="lazy" /></div>` : ''}
    <div class="mb-incident-card__foot --end">
      <button type="button" class="mb-incident-card__edit" ${btnAttr}>${btnLabel}</button>
    </div>
  </div>`;
}
