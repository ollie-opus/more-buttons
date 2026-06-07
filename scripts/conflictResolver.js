/**
 * conflictResolver.js — inline per-field conflict resolution.
 *
 * Renders one row per conflicting field into the form's overlay content with
 * "Use theirs" / "Keep mine" buttons. Resolves once every field has a choice.
 * Styled inline so there is no CSS-file dependency.
 */

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Thrown when the user cancels conflict resolution instead of choosing. */
export class ResolveCancelled extends Error {
  constructor() { super('Conflict resolution cancelled'); this.name = 'ResolveCancelled'; }
}

/**
 * Render one side of a conflict. Arrays (e.g. component-order conflicts) render
 * as a numbered list with optional capture thumbnails; scalars are escaped text.
 */
function renderSide(conflict, value, options) {
  if (Array.isArray(value)) {
    const describe = options.describe || (u => ({ title: u }));
    const items = value.map(u => {
      const d = describe(u) || {};
      const label = d.kind === 'capture'
        ? `${d.thumbSrc ? `<img src="${esc(d.thumbSrc)}" alt="" style="height:20px;vertical-align:middle;border-radius:3px;margin-right:4px;" />` : ''}Capture`
        : esc(d.title || u);
      return `<li>${label}</li>`;
    }).join('');
    return `<ol style="margin:4px 0 0;padding-left:20px;">${items}</ol>`;
  }
  return esc(value);
}

/**
 * @param {HTMLElement} formEl
 * @param {Array<{field,label,mine,theirs}>} conflicts
 * @param {{ describe?: (uuid:string)=>{kind?:string,title?:string,thumbSrc?:string} }} [options]
 * @returns {Promise<{ [field]: 'mine'|'theirs' }>}  rejects with ResolveCancelled on cancel
 */
export function showConflictResolver(formEl, conflicts, options = {}) {
  return new Promise((resolve, reject) => {
    const host = formEl.parentElement || formEl;
    host.querySelector('[data-conflict-panel]')?.remove();

    const panel = document.createElement('div');
    panel.setAttribute('data-conflict-panel', '');
    panel.style.cssText =
      'border:1px solid #d97706;background:#fffbeb;border-radius:8px;padding:12px;margin:12px 0;';

    const rows = conflicts.map(c => `
      <div data-conflict-field="${esc(c.field)}" style="padding:8px 0;border-top:1px solid #fde68a;">
        <p style="margin:0 0 4px;font-weight:600;">⚠ "${esc(c.label)}" was changed elsewhere since you opened this (another tab, device, or person):</p>
        <div style="margin:0 0 2px;"><strong>current (theirs):</strong> ${renderSide(c, c.theirs, options)}</div>
        <div style="margin:0 0 6px;"><strong>yours (mine):</strong> ${renderSide(c, c.mine, options)}</div>
        <div style="display:flex;gap:8px;">
          <button type="button" class="more-buttons-button" data-choose="theirs">Keep theirs (current)</button>
          <button type="button" class="more-buttons-button success" data-choose="mine">Keep mine (overwrite)</button>
        </div>
      </div>`).join('');

    panel.innerHTML =
      `<div style="font-weight:700;margin-bottom:4px;">Resolve conflicts to save</div>${rows}` +
      `<div style="margin-top:10px;text-align:right;"><button type="button" class="more-buttons-button secondary" data-conflict-cancel>Cancel</button></div>`;
    host.prepend(panel);

    const chosen = {};
    panel.addEventListener('click', e => {
      if (e.target.closest('[data-conflict-cancel]')) {
        panel.remove();
        reject(new ResolveCancelled());
        return;
      }
      const btn = e.target.closest('[data-choose]');
      if (!btn) return;
      const row = btn.closest('[data-conflict-field]');
      chosen[row.dataset.conflictField] = btn.dataset.choose;
      row.querySelectorAll('[data-choose]').forEach(b => { b.disabled = true; });
      btn.style.outline = '2px solid #2563eb';
      if (conflicts.every(c => chosen[c.field])) {
        panel.remove();
        resolve(chosen);
      }
    });
  });
}
