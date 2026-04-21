import { registerFormAction } from './formActions.js';
import { githubFetchAndPush } from './github.js';
import { createForm } from './form.js';
import { renderCard, escapeHtml } from './cardRenderer.js';

// ── Private helpers ───────────────────────────────────────────────────────────

function indentBlock(text, indent) {
  return text.split('\n').map(line => line.length ? indent + line : line).join('\n');
}

function extractIncidentField(body, fieldName) {
  const re = new RegExp(`^    - \\*\\*${fieldName}:\\*\\*\\s*(.*)$`, 'm');
  const m = body.match(re);
  if (!m) return '';
  return m[1].replace(/^`|`$/g, '').trim();
}

function buildIncidentBlock(inc) {
  return [
    `!!! status-${inc.impact} "${inc.title}"`,
    '',
    `    - **Service Impact:** ${inc.impact.toUpperCase()}`,
    `    - **Current Status:** \`${inc.currentStatus === 'resolved' ? 'Resolved' : 'Ongoing'}\``,
    `    - **Description:** ${inc.description || ''}`,
    `    - **Reported:** ${inc.reported || ''}`,
    `    - **Resolved:** ${inc.resolved || ''}`,
    `    - **Causation:** ${inc.causation || ''}`,
  ].join('\n');
}

function parseIncidentBlocks(sectionBody) {
  const re = /^!!! status-(available|disruption|outage) "([^"]+)"\n\n((?:    [^\n]*\n?)*)/gm;
  const incidents = [];
  let m;
  while ((m = re.exec(sectionBody)) !== null) {
    const body = m[3];
    incidents.push({
      title:         m[2],
      impact:        m[1],
      description:   extractIncidentField(body, 'Description'),
      reported:      extractIncidentField(body, 'Reported'),
      resolved:      extractIncidentField(body, 'Resolved'),
      currentStatus: extractIncidentField(body, 'Current Status').toLowerCase() || 'ongoing',
      causation:     extractIncidentField(body, 'Causation'),
    });
  }
  return incidents;
}

function parsePastIncidentBlocks(markdown) {
  const pastMatch = markdown.match(/^## Past Incidents[^\n]*\n([\s\S]*)$/m);
  if (!pastMatch) return [];
  const outlineContent = pastMatch[1].match(/^\?\?\? outline "[^"]+"\n\n([\s\S]*)$/m)?.[1] ?? '';
  const stripped = outlineContent.replace(/^ {4}/gm, '');
  return parseIncidentBlocks(stripped);
}

function updateMarkdownServices(markdown, updates) {
  return markdown.replace(
    /^!!! status-(?:available|disruption|outage) "([^"]+)"\n\n {4}\*\*Status:\*\* (?:AVAILABLE|DISRUPTION|OUTAGE) *$/gm,
    (match, name) => {
      const newStatus = updates[name];
      if (!newStatus) return match;
      return `!!! status-${newStatus} "${name}"\n\n    **Status:** ${newStatus.toUpperCase()}`;
    }
  );
}

function updateMarkdownIncidents(markdown, incidentUpdates, newIncident) {
  const parts = markdown.split('\n---\n');
  const openIdx = parts.findIndex(p => /^## Open Incidents/m.test(p));
  const pastIdx = parts.findIndex(p => /^## Past Incidents/m.test(p));

  if (openIdx === -1) return markdown;

  const openSection = parts[openIdx];
  const blockRe = /^!!! status-(available|disruption|outage) "([^"]+)"\n\n((?:    [^\n]*\n?)*)/gm;
  const openBlocks = [];
  let bm;
  while ((bm = blockRe.exec(openSection)) !== null) {
    openBlocks.push({ status: bm[1], title: bm[2], body: bm[3] });
  }

  const resolvedBlocks = [];
  const remainingBlocks = [];

  openBlocks.forEach((block, idx) => {
    const update = incidentUpdates[idx] ?? null;
    const inc = {
      title:         block.title,
      impact:        update?.impact ?? block.impact ?? block.status,
      description:   update?.description ?? extractIncidentField(block.body, 'Description'),
      reported:      update?.reported ?? extractIncidentField(block.body, 'Reported'),
      resolved:      update?.resolved ?? extractIncidentField(block.body, 'Resolved'),
      currentStatus: update?.currentStatus ?? (extractIncidentField(block.body, 'Current Status').toLowerCase() || 'ongoing'),
      causation:     update?.causation ?? extractIncidentField(block.body, 'Causation'),
    };

    const rebuilt = buildIncidentBlock(inc);
    if (inc.currentStatus === 'resolved') {
      resolvedBlocks.push(rebuilt);
    } else {
      remainingBlocks.push(rebuilt);
    }
  });

  if (newIncident?.title) {
    const block = buildIncidentBlock(newIncident);
    if (newIncident.currentStatus === 'resolved') {
      resolvedBlocks.unshift(block);
    } else {
      remainingBlocks.unshift(block);
    }
  }

  // Rebuild the open incidents section
  const openHeaderMatch = openSection.match(/^(## Open Incidents[^\n]*\n)/m);
  const openHeader = openHeaderMatch ? openHeaderMatch[1] : '## Open Incidents\n';
  parts[openIdx] = openHeader + '\n' + remainingBlocks.join('\n\n') + (remainingBlocks.length ? '\n' : '');

  // Prepend newly-resolved incidents into the past incidents collapsible
  if (resolvedBlocks.length > 0 && pastIdx !== -1) {
    const indented = resolvedBlocks.map(b => indentBlock(b, '    ')).join('\n\n');
    parts[pastIdx] = parts[pastIdx].replace(
      /(^\?\?\? outline "[^"]+"\n\n)/m,
      `$1${indented}\n\n`
    );
  }

  return recalculateServiceStatuses(parts.join('\n---\n'));
}

function updateMarkdownPastIncident(markdown, idx, update) {
  const parts = markdown.split('\n---\n');
  const openIdx = parts.findIndex(p => /^## Open Incidents/m.test(p));
  const pastIdx = parts.findIndex(p => /^## Past Incidents/m.test(p));
  if (pastIdx === -1) return markdown;

  const pastSection = parts[pastIdx];
  const outlineMatch = pastSection.match(/(^\?\?\? outline "[^"]+"\n\n)([\s\S]*)$/m);
  if (!outlineMatch) return markdown;

  const stripped = outlineMatch[2].replace(/^ {4}/gm, '');
  const incidents = parseIncidentBlocks(stripped);
  if (!incidents[idx]) return markdown;

  const inc = { ...incidents[idx], ...update };

  if (inc.currentStatus === 'ongoing') {
    // Remove from past
    const remainingPast = incidents.filter((_, i) => i !== idx);
    const indented = remainingPast.map(i => indentBlock(buildIncidentBlock(i), '    ')).join('\n\n');
    parts[pastIdx] = pastSection.replace(
      /(\?\?\? outline "[^"]+"\n\n)[\s\S]*/m,
      `$1${indented ? indented + '\n' : ''}`
    );
    // Prepend to Open Incidents
    if (openIdx !== -1) {
      const openHeaderMatch = parts[openIdx].match(/^(## Open Incidents[^\n]*\n)/m);
      const openHeader = openHeaderMatch ? openHeaderMatch[1] : '## Open Incidents\n';
      const existingOpen = parseIncidentBlocks(parts[openIdx]);
      const allOpen = [inc, ...existingOpen];
      parts[openIdx] = openHeader + '\n' + allOpen.map(i => buildIncidentBlock(i)).join('\n\n') + '\n';
    }
  } else {
    // Update in place
    const updatedPast = incidents.map((i, n) => buildIncidentBlock(n === idx ? inc : i));
    const indented = updatedPast.map(b => indentBlock(b, '    ')).join('\n\n');
    parts[pastIdx] = pastSection.replace(
      /(\?\?\? outline "[^"]+"\n\n)[\s\S]*/m,
      `$1${indented}\n`
    );
  }

  return recalculateServiceStatuses(parts.join('\n---\n'));
}

function deleteMarkdownIncident(markdown, idx, isPastIncident) {
  const parts = markdown.split('\n---\n');

  if (isPastIncident) {
    const pastIdx = parts.findIndex(p => /^## Past Incidents/m.test(p));
    if (pastIdx === -1) return markdown;
    const pastSection = parts[pastIdx];
    const outlineMatch = pastSection.match(/(^\?\?\? outline "[^"]+"\n\n)([\s\S]*)$/m);
    if (!outlineMatch) return markdown;
    const stripped = outlineMatch[2].replace(/^ {4}/gm, '');
    const incidents = parseIncidentBlocks(stripped);
    const remaining = incidents.filter((_, i) => i !== idx);
    const indented = remaining.map(i => indentBlock(buildIncidentBlock(i), '    ')).join('\n\n');
    parts[pastIdx] = pastSection.replace(
      /(\?\?\? outline "[^"]+"\n\n)[\s\S]*/m,
      `$1${indented ? indented + '\n' : ''}`
    );
  } else {
    const openIdx = parts.findIndex(p => /^## Open Incidents/m.test(p));
    if (openIdx === -1) return markdown;
    const openHeaderMatch = parts[openIdx].match(/^(## Open Incidents[^\n]*\n)/m);
    const openHeader = openHeaderMatch ? openHeaderMatch[1] : '## Open Incidents\n';
    const incidents = parseIncidentBlocks(parts[openIdx]);
    const remaining = incidents.filter((_, i) => i !== idx);
    parts[openIdx] = openHeader + (remaining.length ? '\n' + remaining.map(i => buildIncidentBlock(i)).join('\n\n') + '\n' : '');
  }

  return recalculateServiceStatuses(parts.join('\n---\n'));
}

function recalculateServiceStatuses(markdown) {
  const serviceNames = [];
  const servicesMatch = markdown.match(/^## Services\s*\n([\s\S]*?)(?=\n---|\n##)/m);
  if (servicesMatch) {
    const re = /^!!! status-(?:available|disruption|outage) "([^"]+)"/gm;
    let m;
    while ((m = re.exec(servicesMatch[1])) !== null) serviceNames.push(m[1]);
  }

  const openMatch = markdown.match(/^## Open Incidents\s*\n([\s\S]*?)(?=\n---|\n##)/m);
  const openIncidents = openMatch ? parseIncidentBlocks(openMatch[1]) : [];

  const SEVERITY = { outage: 2, disruption: 1, available: 0 };
  const derived = {};
  serviceNames.forEach(name => { derived[name] = 'available'; });
  openIncidents.forEach(inc => {
    inc.title.split(',').map(s => s.trim()).forEach(name => {
      if (!(name in derived)) return;
      if ((SEVERITY[inc.impact] ?? 0) > (SEVERITY[derived[name]] ?? 0)) {
        derived[name] = inc.impact;
      }
    });
  });

  return updateMarkdownServices(markdown, derived);
}

export function renderSystemStatus(markdown) {
  let html = '';

  // Services (read-only)
  const servicesMatch = markdown.match(/^## Services\s*\n([\s\S]*?)(?=\n---|\n##)/m);
  if (servicesMatch) {
    const body = servicesMatch[1];
    const re = /^!!! (status-available|status-disruption|status-outage) "([^"]+)"/gm;
    html += `<p class="more-buttons-section-heading">Services</p>`;
    let m;
    while ((m = re.exec(body)) !== null) {
      const status = m[1].replace('status-', '');
      const name = m[2];
      const colour = status === 'outage' ? '#dc2626' : status === 'disruption' ? '#d97706' : '#16a34a';
      html += `
      <div class="more-buttons-form-group" data-service-name="${escapeHtml(name)}">
        <label class="more-buttons-label">${escapeHtml(name)}</label>
        <span style="color:${colour};font-size:0.875rem;font-weight:600;">${status.toUpperCase()}</span>
      </div>`;
    }
  }

  // Open Incidents
  const openMatch = markdown.match(/^## Open Incidents\s*\n([\s\S]*?)(?=\n---|\n##)/m);
  html += `<p class="more-buttons-section-heading" style="margin-top:18px;">Open Incidents</p>`;
  const openIncidents = openMatch ? parseIncidentBlocks(openMatch[1]) : [];

  if (openIncidents.length === 0) {
    html += `<p class="more-buttons-description">No open incidents.</p>`;
  } else {
    openIncidents.forEach((inc, idx) => {
      html += incidentCard(inc, `data-update-incident="${idx}"`, 'Update');
    });
  }

  // Past Incidents (collapsed)
  html += `<details class="more-buttons-advanced-section" style="margin-top:18px;">
    <summary class="more-buttons-advanced-toggle" style="font-size:1rem;font-weight:600;color:var(--mb-heading);">Past Incidents</summary>
    <div style="margin-top:10px;">`;
  const pastIncidents = parsePastIncidentBlocks(markdown);

  if (pastIncidents.length === 0) {
    html += `<p class="more-buttons-description">No past incidents.</p>`;
  } else {
    pastIncidents.forEach((inc, idx) => {
      html += incidentCard(inc, `data-edit-past-incident="${idx}"`, 'Edit');
    });
  }
  html += `</div></details>`;

  return html;
}

function incidentCard(inc, btnAttr, btnLabel) {
  const colour = inc.impact === 'outage' ? 'red' : 'amber';
  const meta = `${escapeHtml(inc.reported)} · ${escapeHtml(inc.currentStatus === 'resolved' ? 'Resolved' : 'Ongoing')}`;
  return renderCard({ colour, title: inc.title, badge: inc.impact, description: inc.description, meta, btnAttr, btnLabel });
}

// ── Public exports ────────────────────────────────────────────────────────────

export async function publishSystemStatus(formEl, onProgress) {
  const serviceUpdates = {};
  formEl.querySelectorAll('[data-fetch-markdown] [data-service-group]').forEach(group => {
    const name = group.querySelector('.more-buttons-label')?.textContent.trim();
    const checked = group.querySelector('input[type="radio"]:checked');
    if (name && checked) serviceUpdates[name] = checked.value;
  });
  return githubFetchAndPush(onProgress, currentMarkdown => updateMarkdownServices(currentMarkdown, serviceUpdates));
}

export async function publishNewIncident(incident, onProgress) {
  return githubFetchAndPush(onProgress, currentMarkdown => {
    return updateMarkdownIncidents(currentMarkdown, [], incident);
  });
}

export async function publishUpdatedIncident(update, incidentIdx, onProgress) {
  return githubFetchAndPush(onProgress, currentMarkdown => {
    const updates = [];
    updates[incidentIdx] = update;
    return updateMarkdownIncidents(currentMarkdown, updates, null);
  });
}

export async function publishUpdatedPastIncident(update, incidentIdx, onProgress) {
  return githubFetchAndPush(onProgress, currentMarkdown =>
    updateMarkdownPastIncident(currentMarkdown, incidentIdx, update)
  );
}

export async function publishDeleteIncident(incidentIdx, isPastIncident, onProgress) {
  return githubFetchAndPush(onProgress, currentMarkdown =>
    deleteMarkdownIncident(currentMarkdown, incidentIdx, isPastIncident)
  );
}

export async function openKnowledgeBaseEntry() {
  const { moreButtonsIntegrations } = await chrome.storage.local.get('moreButtonsIntegrations');
  if (moreButtonsIntegrations?.githubPAT) {
    createForm('knowledgeBaseEntry');
    return;
  }

  // Not connected — inject CSS if needed and show a simple overlay
  if (!document.getElementById('more-buttons-overlay-stylesheet')) {
    const link = document.createElement('link');
    link.id = 'more-buttons-overlay-stylesheet';
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('config/forms/formsStyling.css');
    (document.head || document.documentElement).appendChild(link);
  }

  const overlay = document.createElement('div');
  overlay.className = 'more-buttons-overlay';
  const content = document.createElement('div');
  content.className = 'more-buttons-overlay-content';
  content.setAttribute('role', 'dialog');
  content.setAttribute('aria-modal', 'true');
  content.innerHTML = `
    <h2>GitHub not connected</h2>
    <p class="more-buttons-description">Please add a GitHub PAT in Integrations to use this feature.</p>
    <div class="more-buttons-form-actions">
      <button type="button" class="more-buttons-button" id="mb-open-integrations">Open Integrations</button>
      <button type="button" class="more-buttons-button secondary" id="mb-close-not-connected">Close</button>
    </div>`;
  overlay.appendChild(content);
  document.body.appendChild(overlay);

  const cleanup = () => { overlay.remove(); document.removeEventListener('keydown', handleKey); };
  const handleKey = e => { if (e.key === 'Escape') cleanup(); };
  document.addEventListener('keydown', handleKey);
  overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(); });
  content.querySelector('#mb-close-not-connected').addEventListener('click', cleanup);
  content.querySelector('#mb-open-integrations').addEventListener('click', () => {
    cleanup();
    createForm('integrations');
  });
}

// ── Form action registrations ─────────────────────────────────────────────────

registerFormAction('openReportIncident', async ({ formEl }) => {
  // Collect service names from read-only service display elements
  const serviceNames = [];
  formEl.querySelectorAll('[data-service-name]').forEach(el => {
    const name = el.dataset.serviceName;
    if (name) serviceNames.push(name);
  });

  const { formEl: reportFormEl } = await createForm('reportIncident');
  if (!reportFormEl) return;

  // Inject service checkboxes
  const servicesContainer = reportFormEl.querySelector('#report-incident-services');
  if (servicesContainer) {
    serviceNames.forEach(name => {
      const label = document.createElement('label');
      label.className = 'more-buttons-radio-btn';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.name = 'services';
      cb.value = name;
      label.appendChild(cb);
      label.append(' ' + name);
      servicesContainer.appendChild(label);
    });
  }

  // Set reported to current time
  const reportedInput = reportFormEl.querySelector('[name="reported"]');
  if (reportedInput) {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    reportedInput.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }
});

registerFormAction('submitReportIncident', async ({ formEl, cleanup }) => {
  const btn = formEl.querySelector('[data-action="submitReportIncident"]');
  const originalText = btn.textContent;
  btn.disabled = true;
  try {
    const checkedServices = [...formEl.querySelectorAll('[name="services"]:checked')].map(cb => cb.value);
    const title = checkedServices.join(', ');
    if (!title) { alert('Please select at least one service.'); btn.disabled = false; return; }
    const impact = formEl.querySelector('[name="impact"]:checked')?.value;
    if (!impact) { alert('Please select a service impact.'); btn.disabled = false; return; }
    const currentStatus = formEl.querySelector('[name="currentStatus"]:checked')?.value ?? 'ongoing';
    const resolvedRaw = formEl.querySelector('[name="resolved"]')?.value ?? '';
    const resolvedValue = currentStatus === 'resolved' && !resolvedRaw
      ? (() => { const now = new Date(); now.setSeconds(0, 0); return now.toISOString().slice(0, 16); })()
      : resolvedRaw;
    const incident = {
      title,
      impact,
      description:   formEl.querySelector('[name="description"]')?.value.trim() ?? '',
      reported:      (formEl.querySelector('[name="reported"]')?.value ?? '').replace('T', ' '),
      currentStatus,
      resolved:      resolvedValue.replace('T', ' '),
      causation:     formEl.querySelector('[name="causation"]')?.value.trim() ?? '',
    };
    const updatedMarkdown = await publishNewIncident(incident, status => { btn.textContent = status; });
    // Update parent form's fetch div
    const parentFetchEl = document.querySelector('[data-fetch-markdown]');
    if (parentFetchEl && updatedMarkdown) {
      parentFetchEl.innerHTML = renderSystemStatus(updatedMarkdown);
      parentFetchEl._lastMarkdown = updatedMarkdown;
    }
    cleanup();
  } catch (e) {
    btn.textContent = originalText;
    btn.disabled = false;
    alert('Failed to report incident: ' + e.message);
  }
});

registerFormAction('openUpdateIncident', async ({ formEl, idx }) => {
  const fetchEl = formEl.querySelector('[data-fetch-markdown]');
  const markdown = fetchEl?._lastMarkdown;
  if (!markdown) return;
  const openMatch = markdown.match(/^## Open Incidents\s*\n([\s\S]*?)(?=\n---|\n##)/m);
  const incidents = openMatch ? parseIncidentBlocks(openMatch[1]) : [];
  const inc = incidents[idx];
  if (!inc) return;

  await chrome.storage.local.set({
    moreButtonsUpdateIncident: {
      incidentTitle: inc.title,
      description:   inc.description,
      currentStatus: inc.currentStatus,
      reported:      (inc.reported || '').replace(' ', 'T'),
      resolved:      (inc.resolved || '').replace(' ', 'T'),
      causation:     inc.causation,
      _incidentIdx:  idx,
    }
  });

  await createForm('updateIncident');
});

registerFormAction('openEditPastIncident', async ({ formEl, idx }) => {
  const fetchEl = formEl.querySelector('[data-fetch-markdown]');
  const markdown = fetchEl?._lastMarkdown;
  if (!markdown) return;
  const incidents = parsePastIncidentBlocks(markdown);
  const inc = incidents[idx];
  if (!inc) return;

  await chrome.storage.local.set({
    moreButtonsUpdateIncident: {
      incidentTitle:   inc.title,
      description:     inc.description,
      currentStatus:   inc.currentStatus || 'resolved',
      reported:        (inc.reported || '').replace(' ', 'T'),
      resolved:        (inc.resolved || '').replace(' ', 'T'),
      causation:       inc.causation,
      _incidentIdx:    idx,
      _isPastIncident: true,
    }
  });

  await createForm('updateIncident');
});

registerFormAction('submitUpdateIncident', async ({ formEl, cleanup }) => {
  const btn = formEl.querySelector('[data-action="submitUpdateIncident"]');
  const originalText = btn.textContent;
  btn.disabled = true;
  try {
    const { moreButtonsUpdateIncident } = await chrome.storage.local.get('moreButtonsUpdateIncident');
    const incidentIdx = moreButtonsUpdateIncident?._incidentIdx;
    if (incidentIdx === undefined) throw new Error('No incident index found');
    const isPastIncident = moreButtonsUpdateIncident?._isPastIncident ?? false;
    const currentStatus = formEl.querySelector('[name="currentStatus"]:checked')?.value ?? 'ongoing';
    const resolvedRaw = formEl.querySelector('[name="resolved"]')?.value ?? '';
    const resolvedValue = currentStatus === 'resolved' && !resolvedRaw
      ? (() => { const now = new Date(); now.setSeconds(0, 0); return now.toISOString().slice(0, 16); })()
      : resolvedRaw;
    const update = {
      description:   formEl.querySelector('[name="description"]')?.value.trim() ?? '',
      currentStatus,
      reported:      (formEl.querySelector('[name="reported"]')?.value ?? '').replace('T', ' '),
      resolved:      resolvedValue.replace('T', ' '),
      causation:     formEl.querySelector('[name="causation"]')?.value.trim() ?? '',
    };
    const updatedMarkdown = isPastIncident
      ? await publishUpdatedPastIncident(update, incidentIdx, status => { btn.textContent = status; })
      : await publishUpdatedIncident(update, incidentIdx, status => { btn.textContent = status; });
    await chrome.storage.local.remove('moreButtonsUpdateIncident');
    const parentFetchEl = document.querySelector('[data-fetch-markdown]');
    if (parentFetchEl && updatedMarkdown) {
      parentFetchEl.innerHTML = renderSystemStatus(updatedMarkdown);
      parentFetchEl._lastMarkdown = updatedMarkdown;
    }
    cleanup();
  } catch (e) {
    btn.textContent = originalText;
    btn.disabled = false;
    alert('Failed to update incident: ' + e.message);
  }
});

registerFormAction('deleteIncident', async ({ formEl, cleanup }) => {
  if (!confirm('Delete this incident? This cannot be undone.')) return;
  const btn = formEl.querySelector('[data-action="deleteIncident"]');
  const originalText = btn.textContent;
  btn.disabled = true;
  try {
    const { moreButtonsUpdateIncident } = await chrome.storage.local.get('moreButtonsUpdateIncident');
    const incidentIdx = moreButtonsUpdateIncident?._incidentIdx;
    if (incidentIdx === undefined) throw new Error('No incident index found');
    const isPastIncident = moreButtonsUpdateIncident?._isPastIncident ?? false;
    const updatedMarkdown = await publishDeleteIncident(incidentIdx, isPastIncident, status => { btn.textContent = status; });
    await chrome.storage.local.remove('moreButtonsUpdateIncident');
    const parentFetchEl = document.querySelector('[data-fetch-markdown]');
    if (parentFetchEl && updatedMarkdown) {
      parentFetchEl.innerHTML = renderSystemStatus(updatedMarkdown);
      parentFetchEl._lastMarkdown = updatedMarkdown;
    }
    cleanup();
  } catch (e) {
    btn.textContent = originalText;
    btn.disabled = false;
    alert('Failed to delete incident: ' + e.message);
  }
});
