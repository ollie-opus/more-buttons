import { createForm } from './form.js';
import { authHeader, kbRepoAccess } from './repoClient.js';
import { commentsWriteAccess } from './kbCommentsClient.js';
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
  const show = (el, text, cls) => {
    el.textContent = text;
    el.classList.toggle('--ok', cls === '--ok');
    el.classList.toggle('--warn', cls === '--warn');
  };
  formEl.querySelectorAll('[data-integration-status]').forEach(el => {
    const name = el.dataset.integrationStatus;
    if (!connected[name]) return show(el, 'Not connected', '--warn');
    if (name !== 'github') return show(el, 'Connected', '--ok');
    // GitHub: a saved token is only "Connected" when it can read and write
    // both repositories (the GitHub screen's two tiles). One that can't is
    // "Incomplete"; a check GitHub didn't answer is not held against it.
    show(el, 'Checking…', null);
    Promise.all(Object.values(ACCESS_CHECKS).map(check => check().catch(() => 'error'))).then(states => {
      if (!el.isConnected) return;
      const short = states.some(s => s === 'read-only' || s === 'no-access');
      show(el, short ? 'Incomplete' : 'Connected', short ? '--warn' : '--ok');
    });
  });
}

const ACCESS_CHECKS = { kb: kbRepoAccess, comments: () => commentsWriteAccess() };
const ACCESS_WORDS = {
  ok: ['This token can read and write ', '.'],
  'read-only': ['This token can only read ', '.'],
  'no-access': ["This token can't reach ", '.'],
  error: ["Couldn't check ", '.'],
};

// The two access tiles: one per repository the token needs, each saying
// whether the SAVED token reaches it. Hidden while no token is saved. Each
// tile is checked on its own, so one slow answer does not hold the other.
// Never blocks the form.
async function populateAccess(root) {
  const pair = root.querySelector('[data-access-pair]');
  if (!pair) return;
  let token = null;
  try {
    token = (await chrome.storage.local.get('moreButtonsIntegrations')).moreButtonsIntegrations?.githubPAT;
  } catch { /* no storage: nothing to say */ }
  pair.hidden = !token;
  if (!token) return;
  for (const tile of pair.querySelectorAll('[data-access]')) {
    const text = tile.querySelector('[data-access-text]');
    tile.dataset.state = 'checking';
    text.textContent = 'Checking…';
    ACCESS_CHECKS[tile.dataset.access]().then(state => {
      const [before, after] = ACCESS_WORDS[state];
      const repo = document.createElement('strong');
      repo.textContent = tile.dataset.repo;
      text.replaceChildren(before, repo, after);
      tile.dataset.state = state;
    });
  }
}

export async function openGithubIntegration() {
  const { formEl } = await createForm('githubIntegration', openGithubIntegration);
  if (!formEl) return;
  const contentEl = formEl.parentElement ?? formEl;
  const panel = contentEl.querySelector('[data-rate-limit]');
  if (!panel) return;

  // PAT may not be set yet — try anyway; the error renders as a normal message.
  populateRateLimit(panel);
  populateAccess(contentEl);

  contentEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-rate-limit-refresh]')) {
      populateRateLimit(panel);
      populateAccess(contentEl);
    }
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
