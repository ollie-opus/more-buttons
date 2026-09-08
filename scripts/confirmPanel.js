/**
 * confirmPanel.js — promise-based confirm / notice panels for destructive dock
 * actions (the extension's replacement for window.confirm / window.alert in
 * overlay forms).
 *
 * Follows the conflict resolver's shape (conflictResolver.js): an inline panel
 * inserted between the window chrome and the form inside the overlay content,
 * styled like the warning forms (githubNotConnected.html). Deliberately NOT a
 * createForm — createForm tears down the active overlay and pushes a
 * breadcrumb, so cancelling a confirm would replay-refetch the entry form.
 *
 * Escape and a click outside the panel cancel (resolving the cancel value);
 * both are swallowed so they don't also drive the overlay underneath.
 */

const esc = s => String(s ?? '').replace(/[&<>"']/g,
  ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function showPanel(host, { variant, title, message, cancelResult, buttons }) {
  return new Promise(resolve => {
    host.querySelector('[data-confirm-panel]')?.remove();
    const panel = document.createElement('div');
    panel.className = 'mb-confirm' + (variant === 'notice' ? ' --notice' : '');
    panel.setAttribute('data-confirm-panel', '');
    panel.innerHTML =
      `<div class="mb-confirm__head"><span class="more-buttons-icon">warning</span>${esc(title)}</div>` +
      `<p class="mb-confirm__desc">${esc(message)}</p>` +
      `<div class="mb-confirm__foot">${buttons.map((b, i) =>
        `<button type="button" class="more-buttons-button ${b.cls}" data-confirm-value="${i}"><span class="more-buttons-icon">${b.icon}</span>${esc(b.label)}</button>`
      ).join('')}</div>`;

    // Sit between the window chrome and the form, like the conflict resolver.
    const formEl = host.querySelector('form');
    if (formEl) host.insertBefore(panel, formEl);
    else host.prepend(panel);

    const done = value => {
      document.removeEventListener('keydown', onKey, true);
      host.removeEventListener('click', onOutside, true);
      panel.remove();
      resolve(value);
    };
    const onKey = e => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      done(cancelResult);
    };
    const onOutside = e => {
      if (panel.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      done(cancelResult);
    };
    document.addEventListener('keydown', onKey, true);
    host.addEventListener('click', onOutside, true);

    panel.addEventListener('click', e => {
      const btn = e.target.closest('[data-confirm-value]');
      if (btn) done(buttons[+btn.dataset.confirmValue].result);
    });

    panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    // Focus the safe choice so a stray Enter never confirms a destructive act.
    const focusIdx = buttons.findIndex(b => b.focus);
    if (focusIdx !== -1) panel.querySelector(`[data-confirm-value="${focusIdx}"]`)?.focus();
  });
}

/** Danger confirm: resolves true on confirm, false on cancel/Escape/outside. */
export function showDangerConfirm(host, { title, message, confirmLabel = 'Delete', cancelLabel = 'Cancel' }) {
  return showPanel(host, {
    variant: 'danger', title, message, cancelResult: false,
    buttons: [
      { label: confirmLabel, cls: 'danger', icon: 'delete', result: true },
      { label: cancelLabel, cls: 'secondary', icon: 'close', result: false, focus: true },
    ],
  });
}

/** Notice with a single OK: resolves once dismissed (button/Escape/outside). */
export function showNotice(host, { title, message, okLabel = 'OK' }) {
  return showPanel(host, {
    variant: 'notice', title, message, cancelResult: undefined,
    buttons: [{ label: okLabel, cls: 'secondary', icon: 'check', result: undefined, focus: true }],
  }).then(() => {});
}
