/**
 * conflictResolver.js — inline per-field conflict resolution.
 *
 * Renders one block per conflicting field between the navbar and the form.
 * Each field shows its two candidate values as selectable tiles ("Current ·
 * theirs" / "Mine · yours"); resolves once every field has a chosen tile.
 * Styled by the .mb-conflict rules in config/forms/formsStyling.css, which
 * form.js injects alongside every overlay.
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
 * Render one candidate value, led by the field's bolded form label ("Title:
 * abc"). Arrays (e.g. component-order conflicts) render as a numbered list
 * with optional capture thumbnails; scalars are escaped text; blank/missing
 * values render an explicit "(empty)" placeholder.
 */
function renderValue(label, value, options) {
  const lead = `<strong>${esc(label)}:</strong>`;
  if (Array.isArray(value)) {
    if (!value.length) return `<div class="mb-conflict__value">${lead} <em class="--empty">(empty)</em></div>`;
    const describe = options.describe || (u => ({ title: u }));
    const items = value.map(u => {
      const d = describe(u) || {};
      const itemLabel = d.kind === 'capture'
        ? `${d.thumbSrc ? `<img src="${esc(d.thumbSrc)}" alt="" />` : ''}Capture`
        : esc(d.title || u);
      return `<li>${itemLabel}</li>`;
    }).join('');
    return `<div class="mb-conflict__value">${lead}</div><ol class="mb-conflict__value-list">${items}</ol>`;
  }
  const text = String(value ?? '');
  return `<div class="mb-conflict__value">${lead} ${text.trim() ? esc(text) : '<em class="--empty">(empty)</em>'}</div>`;
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
    panel.className = 'mb-conflict';
    panel.setAttribute('data-conflict-panel', '');

    const fields = conflicts.map(c => `
      <div class="mb-conflict__field" data-conflict-field="${esc(c.field)}">
        <div class="mb-conflict__options">
          <button type="button" class="mb-conflict__option" data-choose="theirs">
            <span class="mb-conflict__side">Theirs (existing)</span>
            ${renderValue(c.label, c.theirs, options)}
          </button>
          <button type="button" class="mb-conflict__option" data-choose="mine">
            <span class="mb-conflict__side">Yours (overwrite)</span>
            ${renderValue(c.label, c.mine, options)}
          </button>
        </div>
      </div>`).join('');

    panel.innerHTML =
      `<div class="mb-conflict__head"><span class="more-buttons-icon">sync_problem</span>Resolve conflicts to save</div>` +
      `<p class="mb-conflict__desc">These fields changed elsewhere (another tab, device, or person) while you had this open. Pick which value to keep.</p>` +
      fields +
      `<div class="mb-conflict__foot"><button type="button" class="more-buttons-button" data-conflict-cancel>Cancel</button></div>`;

    // Sit between the navbar and the form, below the window chrome. When the
    // form has no wrapper (host === formEl), fall back to prepending into it.
    if (host === formEl) host.prepend(panel);
    else host.insertBefore(panel, formEl);

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
      row.querySelectorAll('[data-choose]').forEach(b => b.classList.toggle('--chosen', b === btn));
      if (conflicts.every(c => chosen[c.field])) {
        panel.remove();
        resolve(chosen);
      }
    });
  });
}
