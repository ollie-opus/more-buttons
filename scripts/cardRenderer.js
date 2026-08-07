export function escapeHtml(str) {
  return (str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Canonical label pill span (matches labelMarkup in markdownInline.js: plain
// inner text only, so `[^<]*` can't swallow a following tag).
const LABEL_SPAN_RE = /<span class="mb-label mb-label-([a-z0-9-]+)">([^<]*)<\/span>/g;

// Escapes a title for card HTML while re-emitting its label pills as real
// spans (colours painted afterwards via paintLabels). Anything that isn't a
// canonical pill — including malformed/partial spans — is escaped to text.
export function titleWithLabelsHtml(title) {
  const src = title ?? '';
  let out = '';
  let last = 0;
  for (const m of src.matchAll(LABEL_SPAN_RE)) {
    out += escapeHtml(src.slice(last, m.index));
    out += `<span class="mb-label mb-label-${m[1]}">${escapeHtml(m[2])}</span>`;
    last = m.index + m[0].length;
  }
  return out + escapeHtml(src.slice(last));
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

// Grey file-format pill for a media component card's head, rendered to the
// right of the badge (matches the library tree's format pill). '' when the
// ext is unknown.
function cardFormatPill(ext) {
  return ext ? `<span class="mb-kb-pills"><span class="mb-kb-pill --format">.${escapeHtml(ext)}</span></span>` : '';
}

// A "Video" component card: same chrome as captureComponentCard but a muted
// inline <video> thumbnail (paused, first-frame poster) and a Video badge.
// `thumbSrc` is the light/single video's CDN url; `ext` renders the grey
// file-format pill after the badge.
export function videoComponentCard({ thumbSrc, btnAttr, btnLabel = 'Edit', copyAttr = '', ext = '' }) {
  return `
  <div class="mb-incident-card --grey mb-component-card--capture">
    <div class="mb-incident-card__head">
      <strong class="mb-incident-card__title">Video</strong>
      <span class="mb-incident-card__head-tags"><span class="mb-incident-card__badge">Video</span>${cardFormatPill(ext)}</span>
    </div>
    ${thumbSrc ? `<div class="mb-incident-card__body mb-component-card__thumb-row"><video class="mb-component-card__thumb" src="${escapeHtml(thumbSrc)}" muted playsinline preload="metadata"></video></div>` : ''}
    <div class="mb-incident-card__foot --end">
      ${copyAttr ? `<button type="button" class="mb-incident-card__edit" ${copyAttr}>Copy</button>` : ''}
      <button type="button" class="mb-incident-card__edit" ${btnAttr}>${btnLabel}</button>
    </div>
  </div>`;
}

// A "Button" component card: grey chrome, a "Button" badge, the button's label
// (or its destination when label-less) plus a colour tag ("Emerald", with
// " · Force dark" / " · Border light only"-style suffixes for non-default theme
// and border), and an Edit button. Legacy colourless buttons fall back to the
// old Primary/Secondary tag.
export function buttonComponentCard({ label, destination, primary, colour, theme, border, btnAttr, btnLabel = 'Edit', copyAttr = '' }) {
  const text = (label ?? '').trim() || (destination ?? '').trim() || '(no label)';
  const themeLabels = { inversed: 'Inversed', 'force-light': 'Force light', 'force-dark': 'Force dark' };
  const borderLabels = { bordered: 'Bordered', 'border-light': 'Border light only', 'border-dark': 'Border dark only', borderless: 'Borderless' };
  const tag = colour
    ? colour.charAt(0).toUpperCase() + colour.slice(1)
      + (themeLabels[theme] ? ` · ${themeLabels[theme]}` : '')
      + (borderLabels[border] ? ` · ${borderLabels[border]}` : '')
    : (primary ? 'Primary' : 'Secondary');
  return `
  <div class="mb-incident-card --grey mb-component-card--capture">
    <div class="mb-incident-card__head">
      <strong class="mb-incident-card__title">${escapeHtml(text)}</strong>
      <span class="mb-incident-card__badge">Button</span>
    </div>
    <div class="mb-incident-card__foot">
      <span class="mb-incident-card__meta">${tag}</span>
      <span class="mb-incident-card__foot-actions">
        ${copyAttr ? `<button type="button" class="mb-incident-card__edit" ${copyAttr}>Copy</button>` : ''}
        <button type="button" class="mb-incident-card__edit" ${btnAttr}>${btnLabel}</button>
      </span>
    </div>
  </div>`;
}

// A "Nav links" component card: grey chrome, a "Nav links" badge, the nav path it
// lists, and an Edit button. The list itself is rendered live on the published
// site, so the card just previews the path.
export function navLinksComponentCard({ path, btnAttr, btnLabel = 'Edit', copyAttr = '' }) {
  const text = (path ?? '').trim() || '(no path)';
  return `
  <div class="mb-incident-card --grey mb-component-card--capture">
    <div class="mb-incident-card__head">
      <strong class="mb-incident-card__title">${escapeHtml(text)}</strong>
      <span class="mb-incident-card__badge">Nav links</span>
    </div>
    <div class="mb-incident-card__foot --end">
      ${copyAttr ? `<button type="button" class="mb-incident-card__edit" ${copyAttr}>Copy</button>` : ''}
      <button type="button" class="mb-incident-card__edit" ${btnAttr}>${btnLabel}</button>
    </div>
  </div>`;
}

// A "Diagram" component card: grey chrome, a "Diagram" badge, a static "Diagram"
// title, and an Edit button. The Mermaid diagram itself renders live on the
// published site, so the card is just a labelled placeholder.
export function diagramComponentCard({ btnAttr, btnLabel = 'Edit', copyAttr = '' }) {
  return `
  <div class="mb-incident-card --grey mb-component-card--capture">
    <div class="mb-incident-card__head">
      <strong class="mb-incident-card__title">Diagram</strong>
      <span class="mb-incident-card__badge">Diagram</span>
    </div>
    <div class="mb-incident-card__foot --end">
      ${copyAttr ? `<button type="button" class="mb-incident-card__edit" ${copyAttr}>Copy</button>` : ''}
      <button type="button" class="mb-incident-card__edit" ${btnAttr}>${btnLabel}</button>
    </div>
  </div>`;
}

// A capture rendered as a card matching the admonition cards: neutral/grey,
// "CAPTURE" badge top-right, a thumbnail preview, and an Edit button. Used in the
// unified Components list. `thumbSrc` is the light-mode image (CDN url for an
// existing capture, or a data: url for a freshly-captured pending one).
// `btnAttr` wires the Edit button (e.g. 'data-edit-component="<uuid>"');
// `ext` renders the grey file-format pill after the badge.
export function captureComponentCard({ thumbSrc, btnAttr, btnLabel = 'Edit', copyAttr = '', ext = '' }) {
  return `
  <div class="mb-incident-card --grey mb-component-card--capture">
    <div class="mb-incident-card__head">
      <strong class="mb-incident-card__title">Capture</strong>
      <span class="mb-incident-card__head-tags"><span class="mb-incident-card__badge">Capture</span>${cardFormatPill(ext)}</span>
    </div>
    ${thumbSrc ? `<div class="mb-incident-card__body mb-component-card__thumb-row"><img class="mb-component-card__thumb" src="${escapeHtml(thumbSrc)}" alt="" loading="lazy" /></div>` : ''}
    <div class="mb-incident-card__foot --end">
      ${copyAttr ? `<button type="button" class="mb-incident-card__edit" ${copyAttr}>Copy</button>` : ''}
      <button type="button" class="mb-incident-card__edit" ${btnAttr}>${btnLabel}</button>
    </div>
  </div>`;
}

// Lowercased file extension of a media filename/path, or '' when there isn't
// one (e.g. a data: url). For the component cards' format pill.
export function fileExtOf(path) {
  return /\.([a-z0-9]+)$/i.exec(path || '')?.[1]?.toLowerCase() ?? '';
}
