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
