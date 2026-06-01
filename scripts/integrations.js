import { createForm } from './form.js';
import { authHeader } from './repoClient.js';
import { registerFormAction } from './formActions.js';

// /rate_limit is itself free — it does not count against the core quota.
async function fetchRateLimit() {
  const auth = await authHeader();
  const res = await fetch('https://api.github.com/rate_limit', {
    headers: { 'Authorization': auth },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const data = await res.json();
  return data.resources?.core ?? data.rate;
}

function formatReset(epochSeconds) {
  const ms = epochSeconds * 1000 - Date.now();
  if (ms <= 0) return 'now';
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `${hrs} hr` : `${hrs} hr ${rem} min`;
}

async function populateRateLimit(panel) {
  const meta = panel.querySelector('[data-rate-limit-meta]');
  const fill = panel.querySelector('[data-rate-limit-fill]');
  panel.removeAttribute('hidden');
  meta.textContent = 'Loading…';
  fill.style.width = '0%';
  panel.classList.remove('--warn', '--danger');

  try {
    const core = await fetchRateLimit();
    const used = core.limit - core.remaining;
    const pct = Math.max(0, Math.min(100, (used / core.limit) * 100));
    fill.style.width = `${pct}%`;
    if (pct >= 90) panel.classList.add('--danger');
    else if (pct >= 60) panel.classList.add('--warn');
    meta.textContent = `${core.remaining.toLocaleString()} of ${core.limit.toLocaleString()} requests remaining · resets in ${formatReset(core.reset)}`;
  } catch (e) {
    meta.textContent = `Could not fetch: ${e.message}`;
  }
}

export async function openIntegrations() {
  const { formEl } = await createForm('integrations', openIntegrations);
  if (!formEl) return;
  const contentEl = formEl.parentElement ?? formEl;
  const panel = contentEl.querySelector('[data-rate-limit]');
  if (!panel) return;

  // PAT may not be set yet — try anyway; the error renders as a normal message.
  populateRateLimit(panel);

  contentEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-rate-limit-refresh]')) populateRateLimit(panel);
  });
}

registerFormAction('openIntegrations', openIntegrations);
