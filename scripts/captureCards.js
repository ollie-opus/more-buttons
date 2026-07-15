/**
 * captureCards.js — Shared light/dark capture preview cards.
 * Used by captureEntry.js (override existing) and captureNew.js (new capture).
 */

/**
 * One theme card. Returns '' when src is falsy so callers can spread an array
 * and let missing variants drop out.
 * @param {{theme:'light'|'dark', title:string, src:string, alt?:string}} opts
 */
export function captureCard({ theme, title, src, alt = '' }) {
  if (!src) return '';
  return `
    <figure class="mb-capture-card mb-capture-card--${theme}">
      <figcaption class="mb-capture-card__title">${title}</figcaption>
      <div class="mb-capture-card__image-wrap">
        <img class="mb-capture-card__img" src="${src}" alt="${alt}">
      </div>
    </figure>
  `;
}

/** Wrap rendered cards in the preview grid. */
export function captureGrid(cards) {
  return `<div class="mb-capture-entry-grid">${cards.join('')}</div>`;
}

// Storage root for all captures (mirrors the capture write root; the media library (mediaLibrary.js) derives its tabs from the repo).
const CAPTURE_ROOT = 'docs/assets/media/occ-captures';

/**
 * Reduce a stored capture path to its theme-agnostic, root-relative base.
 * Accepts either a full repo path (captureEntry's `lightPath`) or a
 * library-relative `media/occ-captures/…` filename (captureNew's
 * `lightFilename`), and strips the trailing -light-mode.<ext> /
 * -dark-mode.<ext> so the same string represents the light+dark pair.
 *
 *   "docs/assets/media/occ-captures/sites/uuid/foo-light-mode.png" -> "sites/uuid/foo"
 *   "media/occ-captures/sites/uuid/foo-dark-mode.svg"              -> "sites/uuid/foo"
 *
 * @param {string} path
 * @returns {string}
 */
export function captureBasePath(path) {
  if (!path) return '';
  let p = path;
  if (p.startsWith(CAPTURE_ROOT + '/')) p = p.slice(CAPTURE_ROOT.length + 1);
  else if (p.startsWith('media/occ-captures/')) p = p.slice('media/occ-captures/'.length);
  return p.replace(/-(light|dark)-mode\.(png|svg)$/, '');
}

/** Escape a value for safe interpolation into an HTML attribute. */
function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * "Capture path" form row, rendered above the preview grid. Uses the standard
 * horizontal form-group layout (label left, input right) so it matches every
 * other overlay form. Read-only by default (captureEntry's view of stored
 * captures); pass editable for captureNew, where the proposed path may be
 * renamed before save. Editable inputs carry data-capture-path-input so the
 * caller can read the value back. An optional hint renders below the input.
 * @param {{label:string, value:string, editable?:boolean, hint?:string}} opts
 */
export function capturePathField({ label, value, editable = false, hint = '' }) {
  const lock = editable ? ' data-capture-path-input' : ' disabled readonly';
  const hintHtml = hint ? `<p class="mb-capture-path-hint">${escapeAttr(hint)}</p>` : '';
  return `
    <div class="more-buttons-form-group">
      <label class="more-buttons-label">${escapeAttr(label)}</label>
      <div class="mb-capture-path-field">
        <input class="more-buttons-input-text" type="text" value="${escapeAttr(value)}"${lock}>
        ${hintHtml}
      </div>
    </div>
  `;
}

// Image types the upload flows can store. Uploaded bytes are pushed to the
// repo as-is (never converted), so the stored extension must match the type.
export const CAPTURE_UPLOAD_TYPES = { png: 'image/png', svg: 'image/svg+xml' };

/** Build an accept="" attribute value for a set of capture extensions. */
export function captureUploadAccept(exts = Object.keys(CAPTURE_UPLOAD_TYPES)) {
  return exts.map(ext => CAPTURE_UPLOAD_TYPES[ext]).filter(Boolean).join(',');
}

/**
 * "Light/Dark mode image" form row — a native file input styled by
 * .mb-capture-upload-input (its ::file-selector-button carries the ghost-button
 * language). data-capture-upload names the slot ('light' | 'dark') so callers
 * can delegate `change` and read the pick back; controllers toggle the
 * '--has-file' class so the filename reads as filled-in value text.
 * Pass exts to restrict the picker (e.g. ['png'] when replacing a stored PNG
 * pair in place); the default offers every storable capture type. Pass
 * exts: null to accept ANY file (media-library uploads outside occ-captures).
 * @param {{label:string, name:string, exts?:string[]|null}} opts
 */
export function captureUploadField({ label, name, exts }) {
  const acceptAttr = exts === null ? '' : ` accept="${escapeAttr(captureUploadAccept(exts))}"`;
  return `
    <div class="more-buttons-form-group">
      <label class="more-buttons-label">${escapeAttr(label)}</label>
      <div class="mb-capture-upload-field">
        <input class="mb-capture-upload-input" type="file"${acceptAttr} data-capture-upload="${escapeAttr(name)}">
      </div>
    </div>
  `;
}

/**
 * Storable capture extension of a picked file: 'png' | 'svg' | null. MIME
 * type first, filename extension as the fallback for files the browser
 * reports without a type. Pure — unit tested.
 * @param {{type?:string, name?:string}} [file]
 */
export function captureFileExt({ type, name } = {}) {
  if (type) {
    const ext = Object.keys(CAPTURE_UPLOAD_TYPES).find(k => CAPTURE_UPLOAD_TYPES[k] === type);
    return ext ?? null;
  }
  const m = /\.(png|svg)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : null;
}

/**
 * Read a picked capture File into { ext, dataUrl } (the data-URL shape capture
 * buffers carry). Rejects types outside `exts` — bytes are pushed as-is, so
 * the stored path's extension must match the actual format.
 * @param {File} file
 * @param {string[]} [exts] allowed extensions, default all storable types
 * @returns {Promise<{ext:string, dataUrl:string}>}
 */
/**
 * Extension of an arbitrary picked file: lowercase filename extension, or null
 * when the name has none. Unlike captureFileExt this accepts any format — the
 * media library stores whatever the user uploads. Pure — unit tested.
 * @param {{name?:string}} [file]
 */
export function mediaFileExt({ name } = {}) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : null;
}

/**
 * Read any picked File into { ext, dataUrl }. Rejects files without a filename
 * extension — the stored repo path needs one for the library's leaf routing.
 * @param {File} file
 * @returns {Promise<{ext:string, dataUrl:string}>}
 */
export function readMediaFile(file) {
  const ext = mediaFileExt(file);
  if (!ext) return Promise.reject(new Error('The file needs an extension (e.g. .pdf, .mp4).'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ ext, dataUrl: reader.result });
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export function readCaptureImage(file, exts = Object.keys(CAPTURE_UPLOAD_TYPES)) {
  const ext = captureFileExt(file);
  if (!ext || !exts.includes(ext)) {
    const wanted = exts.map(e => e.toUpperCase()).join(' or ');
    return Promise.reject(new Error(`Only ${wanted} images are supported here.`));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ ext, dataUrl: reader.result });
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * "Dimension" form row — the capture size control: height/width/auto select +
 * px value input. One source of truth for the markup captureComponent.js's
 * edit form and both insert review forms render. Render with current values,
 * call wireCaptureSizeField() once after injecting, and readCaptureSizeField()
 * to read the choice back. The CSS for .more-buttons-capture-dim (and its
 * .--auto state) already exists in config/forms/formsStyling.css.
 * dimValue may be a number or string; '' renders an empty input.
 * @param {{dimMode?:'height'|'width'|'none', dimValue?:number|string, label?:string}} opts
 */
export function captureSizeField({ dimMode = 'height', dimValue = 50, label = 'Dimension' } = {}) {
  const isAuto = dimMode === 'none';
  const value = isAuto ? '' : String(dimValue ?? 50);
  const opt = (v, text) => `<option value="${v}"${dimMode === v ? ' selected' : ''}>${text}</option>`;
  return `
    <div class="more-buttons-form-group">
      <label class="more-buttons-label">${label}</label>
      <div class="more-buttons-capture-dim${isAuto ? ' --auto' : ''}" data-capture-size>
        <select class="more-buttons-capture-dim-mode" name="dimMode">
          ${opt('height', 'Height')}
          ${opt('width', 'Width')}
          ${opt('none', 'Auto')}
        </select>
        <input class="more-buttons-capture-dim-value" type="number" name="dimValue" value="${escapeAttr(value)}" min="1"${isAuto ? ' disabled' : ''} />
        <span class="more-buttons-capture-dim-unit">px</span>
      </div>
    </div>
  `;
}

/**
 * Bind the Auto-mode behaviour to an injected captureSizeField: value input
 * disabled + '--auto' class while the mode is 'none'; switching back to a
 * dimension seeds the 50px default into an emptied input. The markup renders
 * its initial state itself, so this only needs the change listener.
 */
export function wireCaptureSizeField(rootEl) {
  const dim = rootEl.querySelector('[data-capture-size]');
  const sel = dim?.querySelector('[name="dimMode"]');
  const val = dim?.querySelector('[name="dimValue"]');
  if (!dim || !sel || !val) return;
  sel.addEventListener('change', () => {
    const isAuto = sel.value === 'none';
    dim.classList.toggle('--auto', isAuto);
    val.disabled = isAuto;
    if (!isAuto && val.value === '') val.value = '50';
  });
}

/**
 * Normalize a raw (dimMode, dimValue-string) choice into the capture
 * component's canonical shape: Auto carries no value; a dimension falls back
 * to 50 when the input is empty or invalid. Pure — unit tested.
 */
export function normalizeDimChoice(dimMode, rawValue) {
  if (dimMode === 'none') return { dimMode: 'none', dimValue: null };
  const v = parseInt(rawValue, 10);
  return { dimMode, dimValue: Number.isFinite(v) && v > 0 ? v : 50 };
}

/** Read { dimMode, dimValue } back from an injected captureSizeField. */
export function readCaptureSizeField(rootEl) {
  const sel = rootEl.querySelector('[data-capture-size] [name="dimMode"]');
  const val = rootEl.querySelector('[data-capture-size] [name="dimValue"]');
  return normalizeDimChoice(sel?.value ?? 'none', val?.value ?? '');
}

/**
 * A labelled pill-style radio group: one <input type="radio"> per
 * [value, label, checked] tuple. Shared by the capture/video review forms so
 * their Theme / Corner / Playback options render identically. The field NAMEs
 * (captureTheme / captureCorner) match the edit form, so the same
 * `[name="…"]:checked` read works everywhere.
 */
export function captureRadioField(name, legend, options) {
  const items = options.map(([value, text, checked]) =>
    `<label class="more-buttons-radio-btn"><input type="radio" name="${escapeAttr(name)}" value="${escapeAttr(value)}"${checked ? ' checked' : ''} /> ${text}</label>`
  ).join('');
  return `<div class="more-buttons-form-group"><label class="more-buttons-label">${legend}</label><div class="more-buttons-radio-btn-group-row">${items}</div></div>`;
}

/** Theme-inversing radio group (only meaningful for a light/dark pair). */
export function captureThemeField({ inversed = false } = {}) {
  return captureRadioField('captureTheme', 'Theme',
    [['default', 'Default', !inversed], ['inversed', 'Inversed', inversed]]);
}

/** Corner-rounding radio group. */
export function captureCornerField({ rounded = false } = {}) {
  return captureRadioField('captureCorner', 'Corner rounding',
    [['disabled', 'Disabled', !rounded], ['enabled', 'Enabled', rounded]]);
}
