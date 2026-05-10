import { registerFormAction } from './formActions.js';
import { githubFetchAndPush } from './github.js';
import { readRepoText } from './repoClient.js';
import { createForm } from './form.js';
import { renderCard, escapeHtml } from './cardRenderer.js';
import { parseAdmonitions, buildAdmonition, generateUUID, injectAdmonitionUUID, replaceAdmonitionByUUID, deleteAdmonitionByUUID } from './admonitions.js';

const STATUS_FILE = 'docs/pages/system-status.md';

async function refreshSystemStatusPanels(updatedMarkdown) {
  const fetchEl = document.querySelector('[data-fetch-path*="system-status"]');
  if (!fetchEl || !fetchEl._templateHTML) return;
  const md = updatedMarkdown ?? await readRepoText(STATUS_FILE);
  fetchEl.innerHTML = fetchEl._templateHTML;
  fetchEl.querySelectorAll('[data-render]').forEach(panel => {
    if (panel.dataset.render === 'renderOpenIncidents') renderOpenIncidents(md, panel);
    else if (panel.dataset.render === 'renderResolvedIncidents') renderResolvedIncidents(md, panel);
  });
}

// ── Private helpers ───────────────────────────────────────────────────────────

function indentBlock(text, indent) {
  return text.split('\n').map(line => line.length ? indent + line : line).join('\n');
}

/**
 * Extracts a named field from an admonition body.
 * Body lines are stored WITHOUT the 4-space prefix (already stripped by parseAdmonitions).
 */
function extractIncidentField(body, fieldName) {
  const re = new RegExp(`^- \\*\\*${fieldName}:\\*\\*\\s*(.*)$`, 'm');
  const m = body.match(re);
  if (!m) return '';
  return m[1].replace(/^`|`$/g, '').trim();
}

/**
 * Builds a complete incident admonition block.
 * UUID is embedded in the body as a hidden span (first line).
 * Body lines have NO leading indent — buildAdmonition adds the 4-space prefix.
 */
function buildIncidentBlock(inc) {
  const uuid = inc.uuid ?? generateUUID();
  const bodyLines = [
    '',
    `- **Service Impact:** ${inc.impact.toUpperCase()}`,
    `- **Current Status:** \`${inc.currentStatus === 'resolved' ? 'Resolved' : 'Ongoing'}\``,
    `- **Description:** ${inc.description || ''}`,
    `- **Reported:** ${inc.reported || ''}`,
    `- **Resolved:** ${inc.resolved || ''}`,
    `- **Causation:** ${inc.causation || ''}`,
  ].join('\n');

  const bodyWithUUID = injectAdmonitionUUID(bodyLines, uuid);

  return buildAdmonition('!!!', `status-${inc.impact}`, inc.title, bodyWithUUID);
}

const INCIDENT_TYPE_RE = /status-available|status-disruption|status-outage/;

/**
 * Parses all incident admonition blocks from a section of markdown.
 * Delegates to parseAdmonitions, then maps to the domain shape.
 */
function parseIncidentBlocks(sectionBody) {
  return parseAdmonitions(sectionBody, INCIDENT_TYPE_RE).map(block => ({
    title:         block.title,
    impact:        block.type.replace('status-', ''),
    description:   extractIncidentField(block.body, 'Description'),
    reported:      extractIncidentField(block.body, 'Reported'),
    resolved:      extractIncidentField(block.body, 'Resolved'),
    currentStatus: extractIncidentField(block.body, 'Current Status').toLowerCase() || 'ongoing',
    causation:     extractIncidentField(block.body, 'Causation'),
    uuid:          block.uuid,
  }));
}

/**
 * Parses past incident blocks from the full markdown document.
 * parseAdmonitions handles any indent level transparently.
 */
function parsePastIncidentBlocks(markdown) {
  const pastMatch = markdown.match(/^## Past Incidents[^\n]*\n([\s\S]*)$/m);
  if (!pastMatch) return [];
  return parseAdmonitions(pastMatch[1], INCIDENT_TYPE_RE).map(block => ({
    title:         block.title,
    impact:        block.type.replace('status-', ''),
    description:   extractIncidentField(block.body, 'Description'),
    reported:      extractIncidentField(block.body, 'Reported'),
    resolved:      extractIncidentField(block.body, 'Resolved'),
    currentStatus: extractIncidentField(block.body, 'Current Status').toLowerCase() || 'ongoing',
    causation:     extractIncidentField(block.body, 'Causation'),
    uuid:          block.uuid,
  }));
}

function updateMarkdownServices(markdown, updates) {
  const SERVICE_TYPE_RE = /status-available|status-disruption|status-outage/;
  const servicesMatch = markdown.match(/^## Services\s*\n([\s\S]*?)(?=\n---|\n##)/m);
  if (!servicesMatch) return markdown;

  const serviceBlocks = parseAdmonitions(servicesMatch[1], SERVICE_TYPE_RE);
  let result = markdown;

  for (const block of serviceBlocks) {
    const newStatus = updates[block.title];
    if (!newStatus) continue;

    if (block.uuid) {
      const newBody = injectAdmonitionUUID('\n**Status:** ' + newStatus.toUpperCase(), block.uuid);
      const newBlock = buildAdmonition('!!!', `status-${newStatus}`, block.title, newBody);
      result = replaceAdmonitionByUUID(result, block.uuid, newBlock);
    } else {
      // Fallback: regex for legacy blocks without a UUID
      const escapedTitle = block.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(
        new RegExp(`^!!! status-(?:available|disruption|outage) "${escapedTitle}"\\n\\n    \\*\\*Status:\\*\\* (?:AVAILABLE|DISRUPTION|OUTAGE) *$`, 'gm'),
        `!!! status-${newStatus} "${block.title}"\n\n    **Status:** ${newStatus.toUpperCase()}`
      );
    }
  }
  return result;
}

/**
 * Updates open incidents using UUID-based operations.
 *
 * For each open incident:
 *   - If it has an update and is now resolved: deleteAdmonitionByUUID from open,
 *     then prepend (indented) into past incidents collapsible.
 *   - If it has an update and is still open: replaceAdmonitionByUUID in place.
 *   - If no update: leave it alone.
 *
 * For a new incident: build and prepend to the open section (or resolved section).
 */
function updateMarkdownIncidents(markdown, incidentUpdates, newIncident) {
  const parts = markdown.split('\n---\n');
  const openIdx = parts.findIndex(p => /^## Open Incidents/m.test(p));

  if (openIdx === -1) return markdown;

  // Parse current open incidents to get their UUIDs and apply incidentUpdates by UUID
  const openSection = parts[openIdx];
  const openIncidents = parseIncidentBlocks(openSection);

  // Rebuild the full markdown from parts so UUID operations work on correct positions
  let result = parts.join('\n---\n');

  // Process updates: keyed by UUID (incidentUpdates is now a map of uuid → update)
  // For backwards compatibility we also support array-indexed updates (legacy callers)
  openIncidents.forEach((inc) => {
    const update = (inc.uuid && incidentUpdates[inc.uuid]) ? incidentUpdates[inc.uuid] : null;

    if (!update) return; // no change for this incident

    const merged = {
      ...inc,
      ...update,
      uuid: inc.uuid, // always preserve UUID
    };

    if (merged.currentStatus === 'resolved') {
      // Remove from open section
      if (merged.uuid) {
        result = deleteAdmonitionByUUID(result, merged.uuid);
      }
      // Prepend to past incidents collapsible (indented 4 spaces)
      const resolvedBlocks = [buildIncidentBlock(merged)];
      if (resolvedBlocks.length > 0) {
        const updatedParts = result.split('\n---\n');
        const updatedPastIdx = updatedParts.findIndex(p => /^## Past Incidents/m.test(p));
        if (updatedPastIdx !== -1) {
          const indented = resolvedBlocks.map(b => indentBlock(b, '    ')).join('\n\n');
          updatedParts[updatedPastIdx] = updatedParts[updatedPastIdx].replace(
            /(^\?\?\? outline "[^"]+"\n\n)/m,
            `$1${indented}\n\n`
          );
          result = updatedParts.join('\n---\n');
        }
      }
    } else {
      // Update in place via UUID
      if (merged.uuid) {
        result = replaceAdmonitionByUUID(result, merged.uuid, buildIncidentBlock(merged));
      }
    }
  });

  // Handle new incident
  if (newIncident?.title) {
    const newInc = { ...newIncident, uuid: newIncident.uuid ?? generateUUID() };
    const builtBlock = buildIncidentBlock(newInc);

    if (newInc.currentStatus === 'resolved') {
      // Prepend to past incidents collapsible
      const updatedParts = result.split('\n---\n');
      const updatedPastIdx = updatedParts.findIndex(p => /^## Past Incidents/m.test(p));
      if (updatedPastIdx !== -1) {
        const indented = indentBlock(builtBlock, '    ');
        updatedParts[updatedPastIdx] = updatedParts[updatedPastIdx].replace(
          /(^\?\?\? outline "[^"]+"\n\n)/m,
          `$1${indented}\n\n`
        );
        result = updatedParts.join('\n---\n');
      }
    } else {
      // Prepend to open incidents section
      const updatedParts = result.split('\n---\n');
      const updatedOpenIdx = updatedParts.findIndex(p => /^## Open Incidents/m.test(p));
      if (updatedOpenIdx !== -1) {
        const openHeaderMatch = updatedParts[updatedOpenIdx].match(/^(## Open Incidents[^\n]*\n)/m);
        const openHeader = openHeaderMatch ? openHeaderMatch[1] : '## Open Incidents\n';
        // Get all current open blocks in the section to rebuild
        const currentOpen = parseIncidentBlocks(updatedParts[updatedOpenIdx]);
        const allOpenBlocks = [builtBlock, ...currentOpen.map(i => buildIncidentBlock(i))];
        updatedParts[updatedOpenIdx] = openHeader + '\n' + allOpenBlocks.join('\n\n') + '\n';
        result = updatedParts.join('\n---\n');
      }
    }
  }

  return recalculateServiceStatuses(result);
}

/**
 * Updates a past incident identified by UUID.
 * If switching to 'ongoing', deletes from past and prepends to open.
 * If remaining resolved, replaces in place via UUID.
 */
function updateMarkdownPastIncident(markdown, uuid, update) {
  const pastIncidents = parsePastIncidentBlocks(markdown);
  const inc = pastIncidents.find(i => i.uuid === uuid);
  if (!inc) return markdown;

  const merged = { ...inc, ...update, uuid: inc.uuid };

  if (merged.currentStatus === 'ongoing') {
    // Remove from past
    let result = deleteAdmonitionByUUID(markdown, uuid);

    // Prepend to open incidents section
    const parts = result.split('\n---\n');
    const openIdx = parts.findIndex(p => /^## Open Incidents/m.test(p));
    if (openIdx !== -1) {
      const openHeaderMatch = parts[openIdx].match(/^(## Open Incidents[^\n]*\n)/m);
      const openHeader = openHeaderMatch ? openHeaderMatch[1] : '## Open Incidents\n';
      const existingOpen = parseIncidentBlocks(parts[openIdx]);
      const allOpen = [merged, ...existingOpen];
      parts[openIdx] = openHeader + '\n' + allOpen.map(i => buildIncidentBlock(i)).join('\n\n') + '\n';
      result = parts.join('\n---\n');
    }

    return recalculateServiceStatuses(result);
  } else {
    // Update in place
    const result = replaceAdmonitionByUUID(markdown, uuid, buildIncidentBlock(merged));
    return recalculateServiceStatuses(result);
  }
}

/**
 * Deletes an incident (open or past) identified by UUID.
 */
function deleteMarkdownIncident(markdown, uuid) {
  const result = deleteAdmonitionByUUID(markdown, uuid);
  return recalculateServiceStatuses(result);
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

export function renderOpenIncidents(markdown, panel) {
  const openMatch = markdown.match(/^## Open Incidents\s*\n([\s\S]*?)(?=\n---|\n##)/m);
  const incidents = openMatch ? parseIncidentBlocks(openMatch[1]) : [];
  panel.innerHTML = incidents.length === 0
    ? `<p class="more-buttons-description">No open incidents.</p>`
    : incidents.map(inc => {
        const btnAttr = inc.uuid ? `data-update-incident="${inc.uuid}"` : `disabled title="No UUID"`;
        return incidentCard(inc, btnAttr, inc.uuid ? 'Update' : 'Error');
      }).join('');
}

export function renderResolvedIncidents(markdown, panel) {
  const incidents = parsePastIncidentBlocks(markdown);
  panel.innerHTML = incidents.length === 0
    ? `<p class="more-buttons-description">No resolved incidents.</p>`
    : incidents.map(inc => {
        const btnAttr = inc.uuid ? `data-edit-past-incident="${inc.uuid}"` : `disabled title="No UUID"`;
        return incidentCard(inc, btnAttr, inc.uuid ? 'Edit' : 'Error');
      }).join('');
}

function incidentCard(inc, btnAttr, btnLabel) {
  const colour = inc.impact === 'outage' ? 'red' : 'amber';
  const meta = `${escapeHtml(inc.reported)} · ${escapeHtml(inc.currentStatus === 'resolved' ? 'Resolved' : 'Ongoing')}`;
  return renderCard({ colour, title: inc.title, badge: inc.impact, description: inc.description, meta, btnAttr, btnLabel });
}

// ── Public exports ────────────────────────────────────────────────────────────

export async function publishSystemStatus(formEl, onProgress) {
  const serviceUpdates = {};
  formEl.querySelectorAll('[data-fetch-path] [data-service-group]').forEach(group => {
    const name = group.querySelector('.more-buttons-label')?.textContent.trim();
    const checked = group.querySelector('input[type="radio"]:checked');
    if (name && checked) serviceUpdates[name] = checked.value;
  });
  return githubFetchAndPush(onProgress, currentMarkdown => updateMarkdownServices(currentMarkdown, serviceUpdates));
}

export async function publishNewIncident(incident, onProgress) {
  return githubFetchAndPush(onProgress, currentMarkdown => {
    return updateMarkdownIncidents(currentMarkdown, {}, incident);
  });
}

export async function publishUpdatedIncident(uuid, update, onProgress) {
  return githubFetchAndPush(onProgress, currentMarkdown => {
    const updates = { [uuid]: update };
    return updateMarkdownIncidents(currentMarkdown, updates, null);
  });
}

export async function publishUpdatedPastIncident(uuid, update, onProgress) {
  return githubFetchAndPush(onProgress, currentMarkdown =>
    updateMarkdownPastIncident(currentMarkdown, uuid, update)
  );
}

export async function publishDeleteIncident(uuid, onProgress) {
  return githubFetchAndPush(onProgress, currentMarkdown =>
    deleteMarkdownIncident(currentMarkdown, uuid)
  );
}

// ── Form action registrations ─────────────────────────────────────────────────

registerFormAction('openReportIncident', async () => {
  const markdown = await readRepoText(STATUS_FILE);
  const serviceNames = [];
  if (markdown) {
    const servicesMatch = markdown.match(/^## Services\s*\n([\s\S]*?)(?=\n---|\n##)/m);
    if (servicesMatch) {
      parseAdmonitions(servicesMatch[1], INCIDENT_TYPE_RE).forEach(block => {
        if (block.title) serviceNames.push(block.title);
      });
    }
  }

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

registerFormAction('submitReportIncident', async ({ formEl, content, cleanup }) => {
  const btn = content.querySelector('[data-action="submitReportIncident"]');
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
      ? (() => {
          const now = new Date();
          const pad = n => String(n).padStart(2, '0');
          return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
        })()
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
    await refreshSystemStatusPanels(updatedMarkdown);
    cleanup();
  } catch (e) {
    btn.textContent = originalText;
    btn.disabled = false;
    alert('Failed to report incident: ' + e.message);
  }
});

registerFormAction('openUpdateIncident', async ({ uuid }) => {
  const markdown = await readRepoText(STATUS_FILE);
  const openMatch = markdown.match(/^## Open Incidents\s*\n([\s\S]*?)(?=\n---|\n##)/m);
  const incidents = openMatch ? parseIncidentBlocks(openMatch[1]) : [];
  const inc = incidents.find(i => i.uuid === uuid);
  if (!inc) { alert('Incident not found.'); return; }

  await chrome.storage.local.set({
    moreButtonsUpdateIncident: {
      incidentTitle: inc.title,
      description:   inc.description,
      currentStatus: inc.currentStatus,
      reported:      (inc.reported || '').replace(' ', 'T'),
      resolved:      (inc.resolved || '').replace(' ', 'T'),
      causation:     inc.causation,
    }
  });

  const { formEl: updateFormEl } = await createForm('updateIncident');
  if (updateFormEl) updateFormEl.dataset.editUuid = uuid;
});

registerFormAction('openEditPastIncident', async ({ uuid }) => {
  const markdown = await readRepoText(STATUS_FILE);
  const incidents = parsePastIncidentBlocks(markdown);
  const inc = incidents.find(i => i.uuid === uuid);
  if (!inc) { alert('Incident not found.'); return; }

  await chrome.storage.local.set({
    moreButtonsUpdateIncident: {
      incidentTitle:   inc.title,
      description:     inc.description,
      currentStatus:   inc.currentStatus || 'resolved',
      reported:        (inc.reported || '').replace(' ', 'T'),
      resolved:        (inc.resolved || '').replace(' ', 'T'),
      causation:       inc.causation,
    }
  });

  const { formEl: updateFormEl } = await createForm('updateIncident');
  if (updateFormEl) updateFormEl.dataset.editUuid = uuid;
});

registerFormAction('submitUpdateIncident', async ({ formEl, content, cleanup }) => {
  const btn = content.querySelector('[data-action="submitUpdateIncident"]');
  const originalText = btn.textContent;
  btn.disabled = true;
  try {
    const _uuid = formEl.dataset.editUuid;
    if (!_uuid) throw new Error('No incident UUID found');
    const currentStatus = formEl.querySelector('[name="currentStatus"]:checked')?.value ?? 'ongoing';
    const resolvedRaw = formEl.querySelector('[name="resolved"]')?.value ?? '';
    const resolvedValue = currentStatus === 'resolved' && !resolvedRaw
      ? (() => {
          const now = new Date();
          const pad = n => String(n).padStart(2, '0');
          return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
        })()
      : resolvedRaw;
    const update = {
      description:   formEl.querySelector('[name="description"]')?.value.trim() ?? '',
      currentStatus,
      reported:      (formEl.querySelector('[name="reported"]')?.value ?? '').replace('T', ' '),
      resolved:      resolvedValue.replace('T', ' '),
      causation:     formEl.querySelector('[name="causation"]')?.value.trim() ?? '',
    };
    // UUID-based: try open incidents first, then past incidents
    const updatedMarkdown = await githubFetchAndPush(
      status => { btn.textContent = status; },
      currentMarkdown => {
        // Try open incidents
        const openMatch = currentMarkdown.match(/^## Open Incidents\s*\n([\s\S]*?)(?=\n---|\n##)/m);
        const openIncidents = openMatch ? parseIncidentBlocks(openMatch[1]) : [];
        const isOpen = openIncidents.some(i => i.uuid === _uuid);

        if (isOpen) {
          return updateMarkdownIncidents(currentMarkdown, { [_uuid]: update }, null);
        } else {
          return updateMarkdownPastIncident(currentMarkdown, _uuid, update);
        }
      }
    );
    await chrome.storage.local.remove('moreButtonsUpdateIncident');
    await refreshSystemStatusPanels(updatedMarkdown);
    cleanup();
  } catch (e) {
    btn.textContent = originalText;
    btn.disabled = false;
    alert('Failed to update incident: ' + e.message);
  }
});

registerFormAction('deleteIncident', async ({ formEl, content, cleanup }) => {
  if (!confirm('Delete this incident? This cannot be undone.')) return;
  const btn = content.querySelector('[data-action="deleteIncident"]');
  const originalText = btn.textContent;
  btn.disabled = true;
  try {
    const _uuid = formEl.dataset.editUuid;
    if (!_uuid) throw new Error('No incident UUID found');
    const updatedMarkdown = await publishDeleteIncident(_uuid, status => { btn.textContent = status; });
    await chrome.storage.local.remove('moreButtonsUpdateIncident');
    await refreshSystemStatusPanels(updatedMarkdown);
    cleanup();
  } catch (e) {
    btn.textContent = originalText;
    btn.disabled = false;
    alert('Failed to delete incident: ' + e.message);
  }
});
