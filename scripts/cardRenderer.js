import { renderDocHtml } from './markdownInline.js';
import { assetCdnUrl } from './repoClient.js';
import { ADMONITION_TYPE_LABELS, ADMONITION_TYPE_COLOURS } from './admonitions.js';

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

// Whole-line uuid spans first (eats the leading indent of nested-in-nested
// spans — mirrors components.js's UUID_SPAN_FULL_LINE_RE), then inline ones.
const UUID_SPAN_LINE_RE = /^[ \t]*<span[^>]*data-uuid[^>]*><\/span>[ \t]*\r?\n?/gm;
const UUID_SPAN_RE = /<span[^>]*data-uuid[^>]*><\/span>\n?/g;
const IMAGE_RE = /!\[[^\]]*\]\([^)]+\)(\{[^}]+\})?/g;

// Component body markdown → safe rich preview HTML via the RTE's renderer.
// Strips the uuid marker span and images (renderDocHtml has no image support),
// then collapses the blank runs stripping leaves behind. '' when nothing remains.
export function componentBodyHtml(md) {
  const src = (md ?? '')
    .replace(UUID_SPAN_LINE_RE, '')
    .replace(UUID_SPAN_RE, '')
    .replace(IMAGE_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return src ? renderDocHtml(src) : '';
}

// Inert compact sub-component card: parent-card chrome minus the foot and any
// data-edit/data-copy attrs, so it is a no-op under every click delegator.
// Carries both classes — the --{colour} accent variants apply for free.
function subCard(colour, titleHtml, badge, bodyHtml = '') {
  return `<div class="mb-incident-card mb-card-sub --${colour}">
    <div class="mb-incident-card__head">
      <strong class="mb-incident-card__title">${titleHtml}</strong>
      <span class="mb-incident-card__badge">${escapeHtml(badge)}</span>
    </div>
    ${bodyHtml ? `<div class="mb-card-sub__body mb-card-rich">${bodyHtml}</div>` : ''}
  </div>`;
}

// One nested sub-component (view model from components.js cardPreviewModel) →
// preview HTML. Media kinds render bare (no card chrome); the rest are inert
// mini-cards. Nested admonition bodies use the fixed CSS clamp of
// .mb-card-sub__body — never data-card-clamp, so no Show more of their own.
function subPreviewHtml(sub) {
  switch (sub.kind) {
    case 'capture':
    case 'image':
      return sub.filename ? `<img class="mb-component-card__thumb mb-card-sub-media" src="${escapeHtml(assetCdnUrl('docs/assets/' + sub.filename))}" alt="" loading="lazy">` : '';
    case 'video':
      return sub.filename ? `<video class="mb-component-card__thumb mb-card-sub-media" src="${escapeHtml(assetCdnUrl('docs/assets/' + sub.filename))}" muted playsinline preload="metadata"></video>` : '';
    case 'admonition': {
      const colour = ADMONITION_TYPE_COLOURS[sub.type] ?? 'amber';
      const badge = ADMONITION_TYPE_LABELS[sub.type] ?? sub.type;
      // Nested steps are unnumbered, matching the published site.
      const title = sub.type === 'step' ? 'Step' : (sub.title || badge);
      const titleHtml = titleWithLabelsHtml(title)
        + (sub.meta ? `<span class="mb-incident-card__title-meta">${escapeHtml(sub.meta)}</span>` : '');
      return subCard(colour, titleHtml, badge, componentBodyHtml(sub.description));
    }
    case 'tabs':
      return subCard('cyan', escapeHtml('Content tabs'), 'Tabs', escapeHtml(sub.titles.join(' · ')));
    case 'table':
      return subCard('purple', escapeHtml('Data table'), 'Table', escapeHtml(`${sub.cols} column${sub.cols === 1 ? '' : 's'} × ${sub.rows} row${sub.rows === 1 ? '' : 's'}`));
    case 'grid':
      return subCard('teal', escapeHtml('Grid'), 'Grid', escapeHtml(`${sub.cells} cell${sub.cells === 1 ? '' : 's'} — ${sub.flavor === 'card' ? 'Cards' : 'Plain'}`));
    case 'button':
      return subCard('grey', escapeHtml((sub.label ?? '').trim() || (sub.destination ?? '').trim() || '(no label)'), 'Button');
    case 'navlinks':
      return subCard('grey', escapeHtml((sub.text ?? '').trim() || '(no path)'), 'Nav links');
    case 'diagram':
      return subCard('grey', escapeHtml('Diagram'), 'Diagram');
    default:
      return '';
  }
}

// Card preview: clamped rich description + nested sub-components + one shared
// Show more toggle. Collapsed = up to `clampLines` of description and the
// FIRST sub only; expanding unclamps the description and reveals the rest.
// With 2+ subs the toggle ships visible (no measurement needed — also correct
// inside hidden tab panels); otherwise it ships hidden and applyCardClamps
// reveals it when the description actually overflows. '' when there is
// nothing to show.
export function cardPreviewBlock({ description, subs = [] }, { clampLines = 3 } = {}) {
  const descHtml = componentBodyHtml(description);
  const subHtml = subs.map(subPreviewHtml).filter(Boolean);
  if (!descHtml && subHtml.length === 0) return '';
  const hasRest = subHtml.length > 1;
  const desc = descHtml
    ? `<div class="mb-incident-card__body mb-card-rich" data-card-clamp style="--mb-card-clamp:${clampLines}">${descHtml}</div>` : '';
  const subsBlock = subHtml.length
    ? `<div class="mb-card-subs">${subHtml[0]}${hasRest ? `<div class="mb-card-subs-rest">${subHtml.slice(1).join('')}</div>` : ''}</div>` : '';
  return `<div class="mb-card-preview" data-card-preview>
    ${desc}${subsBlock}
    <button type="button" class="mb-card-expand" data-card-expand data-card-has-rest="${hasRest ? 1 : 0}" aria-expanded="false"${hasRest ? '' : ' hidden'}>Show more</button>
  </div>`;
}

// Back-compat wrapper for plain-markdown callers (no nested components).
export function cardBodyBlock(md, clampLines = 3) {
  return cardPreviewBlock({ description: md, subs: [] }, { clampLines });
}

// Post-render measurement pass (call after innerHTML, like paintLabels):
// reveals each card preview's Show more toggle when it has hidden subs
// (decided at render time) or its clamped description overflows. Skips
// hidden containers (clientHeight 0 — e.g. an inactive tab panel; re-run on
// reveal) and already-expanded previews. Idempotent.
export function applyCardClamps(root) {
  if (!root) return;
  root.querySelectorAll('[data-card-preview]').forEach(wrap => {
    if (wrap.classList.contains('--expanded')) return;
    const btn = wrap.querySelector(':scope > [data-card-expand]');
    if (!btn) return;
    if (btn.dataset.cardHasRest === '1') { btn.hidden = false; return; }
    const body = wrap.querySelector(':scope > [data-card-clamp]');
    if (!body || body.clientHeight === 0) return;
    btn.hidden = body.scrollHeight <= body.clientHeight + 1;
  });
}

export function toggleCardExpand(btn) {
  const wrap = btn.closest('[data-card-preview]');
  if (!wrap) return;
  const expanded = wrap.classList.toggle('--expanded');
  btn.textContent = expanded ? 'Show less' : 'Show more';
  btn.setAttribute('aria-expanded', String(expanded));
}

// colour: accent variant slug (red|amber|green|blue|purple|light-blue|cyan|teal|
//         light-green|orange|bright-red|pink|deep-purple|grey|outline|step)
// title: card title
// badge: short label rendered in accent colour (uppercased via CSS)
// description: optional plain-text body preview (omitted when falsy)
// bodyMd: optional body markdown — rendered rich with a Show more toggle
// bodyParsed: optional {description, subs} view model (components.js
//             cardPreviewModel) — rich preview incl. nested sub-components.
//             Precedence: bodyParsed > bodyMd > description.
// meta: optional bottom-left info line (omitted when falsy)
// btnAttr: attribute string for the action button, e.g. 'data-edit-system-update="0"'
// btnLabel: button text
export function renderCard({ colour, title, badge, description, bodyMd, bodyParsed, meta, btnAttr, btnLabel }) {
  const hasMeta = meta != null && meta !== '';
  return `
  <div class="mb-incident-card --${colour}">
    <div class="mb-incident-card__head">
      <strong class="mb-incident-card__title">${escapeHtml(title)}</strong>
      <span class="mb-incident-card__badge">${escapeHtml(badge)}</span>
    </div>
    ${bodyParsed != null ? cardPreviewBlock(bodyParsed) : bodyMd != null ? cardBodyBlock(bodyMd) : description ? `<p class="mb-incident-card__body">${escapeHtml(description)}</p>` : ''}
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
// An "Image" component card: same chrome as captureComponentCard but for a
// single library image (no theme pair). `thumbSrc` is the file's CDN url;
// `ext` renders the grey file-format pill after the badge.
export function imageComponentCard({ thumbSrc, btnAttr, btnLabel = 'Edit', copyAttr = '', ext = '' }) {
  return `
  <div class="mb-incident-card --grey mb-component-card--capture">
    <div class="mb-incident-card__head">
      <strong class="mb-incident-card__title">Image</strong>
      <span class="mb-incident-card__head-tags"><span class="mb-incident-card__badge">Image</span>${cardFormatPill(ext)}</span>
    </div>
    ${thumbSrc ? `<div class="mb-incident-card__body mb-component-card__thumb-row"><img class="mb-component-card__thumb" src="${escapeHtml(thumbSrc)}" alt="" loading="lazy" /></div>` : ''}
    <div class="mb-incident-card__foot --end">
      ${copyAttr ? `<button type="button" class="mb-incident-card__edit" ${copyAttr}>Copy</button>` : ''}
      <button type="button" class="mb-incident-card__edit" ${btnAttr}>${btnLabel}</button>
    </div>
  </div>`;
}

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
