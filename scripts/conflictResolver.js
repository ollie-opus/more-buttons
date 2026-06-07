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

/**
 * @param {HTMLElement} formEl
 * @param {Array<{field,label,mine,theirs}>} conflicts
 * @returns {Promise<{ [field]: 'mine'|'theirs' }>}
 */
export function showConflictResolver(formEl, conflicts) {
  return new Promise(resolve => {
    const host = formEl.parentElement || formEl;
    host.querySelector('[data-conflict-panel]')?.remove();

    const panel = document.createElement('div');
    panel.setAttribute('data-conflict-panel', '');
    panel.style.cssText =
      'border:1px solid #d97706;background:#fffbeb;border-radius:8px;padding:12px;margin:12px 0;';

    const rows = conflicts.map(c => `
      <div data-conflict-field="${esc(c.field)}" style="padding:8px 0;border-top:1px solid #fde68a;">
        <p style="margin:0 0 4px;font-weight:600;">⚠ "${esc(c.label)}" was changed elsewhere since you opened this (another tab, device, or person):</p>
        <p style="margin:0 0 2px;"><strong>current (theirs):</strong> ${esc(c.theirs)}</p>
        <p style="margin:0 0 6px;"><strong>yours (mine):</strong> ${esc(c.mine)}</p>
        <div style="display:flex;gap:8px;">
          <button type="button" class="more-buttons-button" data-choose="theirs">Keep theirs (current)</button>
          <button type="button" class="more-buttons-button success" data-choose="mine">Keep mine (overwrite)</button>
        </div>
      </div>`).join('');

    panel.innerHTML =
      `<div style="font-weight:700;margin-bottom:4px;">Resolve conflicts to save</div>${rows}`;
    host.prepend(panel);

    const chosen = {};
    panel.addEventListener('click', e => {
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
