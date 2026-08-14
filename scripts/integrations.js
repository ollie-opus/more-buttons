import { createForm } from './form.js';
import { authHeader } from './repoClient.js';
import { registerFormAction } from './formActions.js';
import { GEMINI_STORAGE_KEY, loadAiPrompts, buildGeminiRequest, parseGeminiResponse } from './aiReword.js';

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

// The hub: one tile per service, each showing whether its credential is saved.
export async function openIntegrations() {
  const { formEl } = await createForm('integrations', openIntegrations);
  if (!formEl) return;
  const store = await chrome.storage.local.get(['moreButtonsIntegrations', GEMINI_STORAGE_KEY]);
  const connected = {
    github: !!store.moreButtonsIntegrations?.githubPAT,
    gemini: !!store[GEMINI_STORAGE_KEY]?.geminiApiKey,
  };
  formEl.querySelectorAll('[data-integration-status]').forEach(el => {
    const ok = connected[el.dataset.integrationStatus];
    el.textContent = ok ? 'Connected' : 'Not connected';
    el.classList.toggle('--ok', ok);
    el.classList.toggle('--warn', !ok);
  });
}

export async function openGithubIntegration() {
  const { formEl } = await createForm('githubIntegration', openGithubIntegration);
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

// Checks the key TYPED IN THE FORM (not the saved one) so it can be verified
// before saving. A real one-word generateContent against the configured model
// rather than a models.list ping — that also catches the model itself being
// retired or the request shape being rejected, which a key-only check misses
// (learned the hard way when Google closed gemini-2.5-flash to new keys).
async function testGeminiKey(formEl, meta) {
  const key = formEl.querySelector('input[name="geminiApiKey"]')?.value.trim();
  if (!key) { meta.textContent = 'Enter a key first.'; return; }
  meta.textContent = 'Testing…';
  try {
    const { model } = await loadAiPrompts();
    const { url, headers, body } = buildGeminiRequest({
      model, apiKey: key, system: 'Reply with exactly: OK', text: 'ping',
    });
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    parseGeminiResponse(res.status, json);
    meta.textContent = `Key works — ${model} responded.`;
  } catch (e) {
    meta.textContent = e.message;
  }
}

export async function openGeminiIntegration() {
  const { formEl } = await createForm('geminiIntegration', openGeminiIntegration);
  if (!formEl) return;
  const contentEl = formEl.parentElement ?? formEl;
  const meta = contentEl.querySelector('[data-test-key-meta]');
  if (!meta) return;

  contentEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-test-key]')) testGeminiKey(formEl, meta);
  });
}

registerFormAction('openIntegrations', openIntegrations);
registerFormAction('openGithubIntegration', openGithubIntegration);
registerFormAction('openGeminiIntegration', openGeminiIntegration);
