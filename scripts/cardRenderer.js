const ACCENT = {
  red:    'rgb(239,83,80)',
  amber:  'rgb(255,179,0)',
  green:  'rgb(102,187,106)',
  blue:   'rgb(66,165,245)',
  purple: 'rgb(199,84,176)',
};

export function escapeHtml(str) {
  return (str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// colour: 'red'|'amber'|'green'|'blue'|'purple'
// badge: short label in accent colour (uppercased via CSS)
// description: optional body preview (omitted when falsy)
// meta: bottom-left info line
// btnAttr: attribute string for the action button, e.g. 'data-edit-system-update="0"'
// btnLabel: button text
export function renderCard({ colour, title, badge, description, meta, btnAttr, btnLabel }) {
  const accent = ACCENT[colour] ?? ACCENT.amber;
  return `
  <div class="mb-incident-card --${colour}">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
      <strong style="font-size:0.875rem;">${escapeHtml(title)}</strong>
      <span style="color:${accent};font-size:0.75rem;font-weight:700;text-transform:uppercase;">${escapeHtml(badge)}</span>
    </div>
    ${description ? `<div style="font-size:0.8125rem;color:var(--mb-text-muted);margin-bottom:6px;">${escapeHtml(description)}</div>` : ''}
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:0.8rem;color:var(--mb-text-label);">${escapeHtml(meta)}</span>
      <button type="button" class="more-buttons-button secondary"
              style="font-size:0.8rem;padding:4px 10px;"
              ${btnAttr}>${btnLabel}</button>
    </div>
  </div>`;
}
