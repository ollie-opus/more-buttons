import { registerFormAction } from './formActions.js';
import { githubFetchAndPush, githubFetchAndPushFile } from './github.js';
import { writeStatusBanner, writeMaintenanceKeys } from './navToml.js';
import { readRepoText } from './repoClient.js';
import { createForm, navigateBack, setButtonBusy, snapshotButton, restoreButton } from './form.js';
import { renderCard, escapeHtml } from './cardRenderer.js';
import {
  sectionBodies, parseEventBlocks, parseIncidentBlocks, parsePastIncidentBlocks,
  parseMaintenanceBlocks, parseServiceNames,
  updateMarkdownIncidents, updateMarkdownPastIncident, updateMarkdownMaintenance,
  insertMaintenanceBlock, deleteMarkdownEvent,
  recalculateServiceStatuses, updateMarkdownServices,
  deriveBannerStatus, deriveMaintenanceWindow, maintenancePhase, toIsoWithOffset,
} from './statusEvents.js';

// All the markdown grammar/mutation logic lives in statusEvents.js (a pure
// leaf module, shared with github.js's migrate-on-fetch hook); this file owns
// the forms, renderers and publish flows. Re-exported for existing importers.
export { deriveBannerStatus } from './statusEvents.js';

const STATUS_FILE = 'docs/pages/system-status.md';

const MAINTENANCE_STATUS_LABEL = { 'upcoming': 'Upcoming', 'in progress': 'In progress', 'completed': 'Completed' };
const MAINTENANCE_STATUS_RANK  = { 'upcoming': 0, 'in progress': 1, 'completed': 2 };

// ── Private helpers ───────────────────────────────────────────────────────────

/** Local time as a datetime-local value (YYYY-MM-DDTHH:MM). */
function nowLocalStamp(now = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

const startMs = evt => {
  const t = Date.parse(evt.startIso || (evt.start || '').replace(' ', 'T'));
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
};

/**
 * Pushes zensical.toml's banner + maintenance-window keys into line with the
 * given status markdown (one combined commit). The toml writers return their
 * input unchanged when the values already match, so the push layer skips the
 * commit on no-op syncs.
 */
function syncStatusBanner(statusMarkdown, onProgress) {
  const value = deriveBannerStatus(statusMarkdown);
  const win = deriveMaintenanceWindow(statusMarkdown, new Date());
  return githubFetchAndPushFile('zensical.toml', onProgress,
    toml => writeMaintenanceKeys(writeStatusBanner(toml, value), win));
}

// ── Event list rendering ──────────────────────────────────────────────────────

/**
 * Buckets every event for display. The committed markdown only reconciles on
 * pushes, so a display-only phase overlay promotes maintenance whose window
 * has since started/ended into the right tab without waiting for a commit
 * (forward-only, mirroring the reconciliation sweep).
 */
function collectEventBuckets(markdown, now = new Date()) {
  const { upcoming, active, past } = sectionBodies(markdown);
  const buckets = { upcoming: [], active: [], past: [] };
  const placeMaintenance = evt => {
    const phase = maintenancePhase(evt, now);
    const shown = (MAINTENANCE_STATUS_RANK[phase] ?? 0) > (MAINTENANCE_STATUS_RANK[evt.currentStatus] ?? 0)
      ? phase
      : evt.currentStatus;
    const bucket = shown === 'completed' ? 'past' : shown === 'in progress' ? 'active' : 'upcoming';
    buckets[bucket].push({ ...evt, displayStatus: shown });
  };
  parseEventBlocks(upcoming).forEach(e => e.kind === 'maintenance' ? placeMaintenance(e) : buckets.upcoming.push(e));
  parseEventBlocks(active).forEach(e => e.kind === 'maintenance' ? placeMaintenance(e) : buckets.active.push(e));
  parseEventBlocks(past).forEach(e => buckets.past.push(e.kind === 'maintenance' ? { ...e, displayStatus: e.currentStatus } : e));
  buckets.upcoming.sort((a, b) => startMs(a) - startMs(b));
  return buckets;
}

function incidentCard(inc, btnAttr, btnLabel) {
  const colour = inc.impact === 'outage' ? 'red' : 'amber';
  const meta = `${escapeHtml(inc.reported)} · ${escapeHtml(inc.currentStatus === 'resolved' ? 'Resolved' : 'Ongoing')}`;
  return renderCard({ colour, title: inc.services, badge: inc.impact, description: inc.description, meta, btnAttr, btnLabel });
}

function maintenanceCard(evt, btnLabel) {
  const btnAttr = evt.uuid ? `data-update-maintenance="${evt.uuid}"` : `disabled title="No UUID"`;
  const status = MAINTENANCE_STATUS_LABEL[evt.displayStatus ?? evt.currentStatus] ?? 'Upcoming';
  const meta = `${escapeHtml(evt.start)} → ${escapeHtml(evt.end)} · ${escapeHtml(status)}`;
  return renderCard({
    colour: 'amber', title: evt.services, badge: 'maintenance', description: evt.description,
    meta, btnAttr, btnLabel: evt.uuid ? btnLabel : 'Error',
  });
}

function eventCard(evt, incidentBtnAttrName, incidentBtnLabel, maintenanceBtnLabel) {
  if (evt.kind === 'maintenance') return maintenanceCard(evt, maintenanceBtnLabel);
  const btnAttr = evt.uuid ? `${incidentBtnAttrName}="${evt.uuid}"` : `disabled title="No UUID"`;
  return incidentCard(evt, btnAttr, evt.uuid ? incidentBtnLabel : 'Error');
}

export function renderUpcomingEvents(markdown, panel) {
  const events = collectEventBuckets(markdown).upcoming;
  panel.innerHTML = events.length === 0
    ? `<p class="more-buttons-description">No upcoming events.</p>`
    : events.map(evt => eventCard(evt, 'data-update-incident', 'Update', 'Update')).join('');
}

export function renderActiveEvents(markdown, panel) {
  const events = collectEventBuckets(markdown).active;
  panel.innerHTML = events.length === 0
    ? `<p class="more-buttons-description">No active events.</p>`
    : events.map(evt => eventCard(evt, 'data-update-incident', 'Update', 'Update')).join('');
}

export function renderPastEvents(markdown, panel) {
  const events = collectEventBuckets(markdown).past;
  panel.innerHTML = events.length === 0
    ? `<p class="more-buttons-description">No past events.</p>`
    : events.map(evt => eventCard(evt, 'data-edit-past-incident', 'Edit', 'Edit')).join('');
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
  let finalMarkdown = '';
  await githubFetchAndPush(onProgress, currentMarkdown => {
    finalMarkdown = updateMarkdownIncidents(currentMarkdown, {}, incident);
    return finalMarkdown;
  });
  return syncStatusBanner(finalMarkdown, onProgress);
}

export async function publishUpdatedIncident(uuid, update, onProgress) {
  let finalMarkdown = '';
  await githubFetchAndPush(onProgress, currentMarkdown => {
    finalMarkdown = updateMarkdownIncidents(currentMarkdown, { [uuid]: update }, null);
    return finalMarkdown;
  });
  return syncStatusBanner(finalMarkdown, onProgress);
}

export async function publishUpdatedPastIncident(uuid, update, onProgress) {
  let finalMarkdown = '';
  await githubFetchAndPush(onProgress, currentMarkdown => {
    finalMarkdown = updateMarkdownPastIncident(currentMarkdown, uuid, update);
    return finalMarkdown;
  });
  return syncStatusBanner(finalMarkdown, onProgress);
}

export async function publishDeleteIncident(uuid, onProgress) {
  let finalMarkdown = '';
  await githubFetchAndPush(onProgress, currentMarkdown => {
    finalMarkdown = deleteMarkdownEvent(currentMarkdown, uuid);
    return finalMarkdown;
  });
  return syncStatusBanner(finalMarkdown, onProgress);
}

export async function publishNewMaintenance(evt, onProgress) {
  let finalMarkdown = '';
  await githubFetchAndPush(onProgress, currentMarkdown => {
    finalMarkdown = recalculateServiceStatuses(insertMaintenanceBlock(currentMarkdown, evt));
    return finalMarkdown;
  });
  return syncStatusBanner(finalMarkdown, onProgress);
}

export async function publishUpdatedMaintenance(uuid, update, onProgress) {
  let finalMarkdown = '';
  await githubFetchAndPush(onProgress, currentMarkdown => {
    finalMarkdown = updateMarkdownMaintenance(currentMarkdown, uuid, update);
    return finalMarkdown;
  });
  return syncStatusBanner(finalMarkdown, onProgress);
}

export async function publishDeleteMaintenance(uuid, onProgress) {
  let finalMarkdown = '';
  await githubFetchAndPush(onProgress, currentMarkdown => {
    finalMarkdown = deleteMarkdownEvent(currentMarkdown, uuid);
    return finalMarkdown;
  });
  return syncStatusBanner(finalMarkdown, onProgress);
}

// ── Form action registrations ─────────────────────────────────────────────────

function injectServiceCheckboxes(formEl, containerSelector, names) {
  const container = formEl.querySelector(containerSelector);
  if (!container) return;
  names.forEach(name => {
    const label = document.createElement('label');
    label.className = 'more-buttons-radio-btn';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.name = 'services';
    cb.value = name;
    label.appendChild(cb);
    label.append(' ' + name);
    container.appendChild(label);
  });
}

registerFormAction('openReportIncident', async () => {
  const markdown = await readRepoText(STATUS_FILE);
  const serviceNames = markdown ? parseServiceNames(markdown) : [];

  const { formEl: reportFormEl } = await createForm('reportIncident');
  if (!reportFormEl) return;

  injectServiceCheckboxes(reportFormEl, '#report-incident-services', serviceNames);

  // Set reported to current time
  const reportedInput = reportFormEl.querySelector('[name="reported"]');
  if (reportedInput) reportedInput.value = nowLocalStamp();
});

registerFormAction('submitReportIncident', async ({ formEl, content, cleanup }) => {
  const btn = content.querySelector('[data-action="submitReportIncident"]');
  // Validate before going busy so a missing field doesn't flash the amber state.
  const checkedServices = [...formEl.querySelectorAll('[name="services"]:checked')].map(cb => cb.value);
  const services = checkedServices.join(', ');
  if (!services) { alert('Please select at least one service.'); return; }
  const impact = formEl.querySelector('[name="impact"]:checked')?.value;
  if (!impact) { alert('Please select a service impact.'); return; }
  const snap = snapshotButton(btn);
  setButtonBusy(btn, 'Publishing…');
  try {
    const currentStatus = formEl.querySelector('[name="currentStatus"]:checked')?.value ?? 'ongoing';
    const reportedRaw = formEl.querySelector('[name="reported"]')?.value ?? '';
    const resolvedRaw = formEl.querySelector('[name="resolved"]')?.value ?? '';
    const resolvedValue = currentStatus === 'resolved' && !resolvedRaw ? nowLocalStamp() : resolvedRaw;
    const incident = {
      services,
      impact,
      description:   formEl.querySelector('[name="description"]')?.value.trim() ?? '',
      reported:      reportedRaw.replace('T', ' '),
      reportedIso:   toIsoWithOffset(reportedRaw),
      currentStatus,
      resolved:      resolvedValue.replace('T', ' '),
      resolvedIso:   toIsoWithOffset(resolvedValue),
      causation:     formEl.querySelector('[name="causation"]')?.value.trim() ?? '',
    };
    await publishNewIncident(incident, status => setButtonBusy(btn, status));
    await navigateBack();
  } catch (e) {
    restoreButton(btn, snap);
    alert('Failed to report incident: ' + e.message);
  }
});

registerFormAction('openUpdateIncident', async ({ uuid }) => {
  const markdown = await readRepoText(STATUS_FILE);
  const incidents = parseIncidentBlocks(sectionBodies(markdown).active);
  const inc = incidents.find(i => i.uuid === uuid);
  if (!inc) { alert('Incident not found.'); return; }

  await chrome.storage.local.set({
    moreButtonsUpdateIncident: {
      incidentTitle: inc.services,
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
      incidentTitle:   inc.services,
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
  const snap = snapshotButton(btn);
  setButtonBusy(btn, 'Saving…');
  try {
    const _uuid = formEl.dataset.editUuid;
    if (!_uuid) throw new Error('No incident UUID found');
    const currentStatus = formEl.querySelector('[name="currentStatus"]:checked')?.value ?? 'ongoing';
    const reportedRaw = formEl.querySelector('[name="reported"]')?.value ?? '';
    const resolvedRaw = formEl.querySelector('[name="resolved"]')?.value ?? '';
    const resolvedValue = currentStatus === 'resolved' && !resolvedRaw ? nowLocalStamp() : resolvedRaw;
    const update = {
      description:   formEl.querySelector('[name="description"]')?.value.trim() ?? '',
      currentStatus,
      reported:      reportedRaw.replace('T', ' '),
      reportedIso:   toIsoWithOffset(reportedRaw),
      resolved:      resolvedValue.replace('T', ' '),
      resolvedIso:   toIsoWithOffset(resolvedValue),
      causation:     formEl.querySelector('[name="causation"]')?.value.trim() ?? '',
    };
    // UUID-based: try active incidents first, then past incidents
    let finalMarkdown = '';
    await githubFetchAndPush(
      status => setButtonBusy(btn, status),
      currentMarkdown => {
        const isOpen = parseIncidentBlocks(sectionBodies(currentMarkdown).active).some(i => i.uuid === _uuid);
        finalMarkdown = isOpen
          ? updateMarkdownIncidents(currentMarkdown, { [_uuid]: update }, null)
          : updateMarkdownPastIncident(currentMarkdown, _uuid, update);
        return finalMarkdown;
      }
    );
    await syncStatusBanner(finalMarkdown, status => setButtonBusy(btn, status));
    await chrome.storage.local.remove('moreButtonsUpdateIncident');
    await navigateBack();
  } catch (e) {
    restoreButton(btn, snap);
    alert('Failed to update incident: ' + e.message);
  }
});

registerFormAction('deleteIncident', async ({ formEl, content, cleanup }) => {
  if (!confirm('Delete this incident? This cannot be undone.')) return;
  const btn = content.querySelector('[data-action="deleteIncident"]');
  const snap = snapshotButton(btn);
  setButtonBusy(btn, 'Deleting…');
  try {
    const _uuid = formEl.dataset.editUuid;
    if (!_uuid) throw new Error('No incident UUID found');
    await publishDeleteIncident(_uuid, status => setButtonBusy(btn, status));
    await chrome.storage.local.remove('moreButtonsUpdateIncident');
    await navigateBack();
  } catch (e) {
    restoreButton(btn, snap);
    alert('Failed to delete incident: ' + e.message);
  }
});

// ── Maintenance form actions ──────────────────────────────────────────────────

registerFormAction('openReportMaintenance', async () => {
  const markdown = await readRepoText(STATUS_FILE);
  const serviceNames = markdown ? parseServiceNames(markdown) : [];

  const { formEl: reportFormEl } = await createForm('reportMaintenance');
  if (!reportFormEl) return;

  injectServiceCheckboxes(reportFormEl, '#report-maintenance-services', serviceNames);

  const startInput = reportFormEl.querySelector('[name="scheduledStart"]');
  if (startInput && !startInput.value) startInput.value = nowLocalStamp();
});

registerFormAction('submitReportMaintenance', async ({ formEl, content, cleanup }) => {
  const btn = content.querySelector('[data-action="submitReportMaintenance"]');
  // Validate before going busy so a missing field doesn't flash the amber state.
  const checkedServices = [...formEl.querySelectorAll('[name="services"]:checked')].map(cb => cb.value);
  const services = checkedServices.join(', ');
  if (!services) { alert('Please select at least one service.'); return; }
  const startRaw = formEl.querySelector('[name="scheduledStart"]')?.value ?? '';
  const endRaw = formEl.querySelector('[name="scheduledEnd"]')?.value ?? '';
  if (!startRaw || !endRaw) { alert('Please set both a scheduled start and end.'); return; }
  if (endRaw <= startRaw) { alert('Scheduled end must be after the scheduled start.'); return; }
  const snap = snapshotButton(btn);
  setButtonBusy(btn, 'Publishing…');
  try {
    const evt = {
      services,
      description: formEl.querySelector('[name="description"]')?.value.trim() ?? '',
      start:       startRaw.replace('T', ' '),
      end:         endRaw.replace('T', ' '),
      startIso:    toIsoWithOffset(startRaw),
      endIso:      toIsoWithOffset(endRaw),
    };
    evt.currentStatus = maintenancePhase(evt, new Date());
    if (evt.currentStatus === 'completed') { restoreButton(btn, snap); alert('The scheduled window is already over — choose a future end time.'); return; }
    await publishNewMaintenance(evt, status => setButtonBusy(btn, status));
    await navigateBack();
  } catch (e) {
    restoreButton(btn, snap);
    alert('Failed to report maintenance: ' + e.message);
  }
});

registerFormAction('openUpdateMaintenance', async ({ uuid }) => {
  const markdown = await readRepoText(STATUS_FILE);
  const evt = parseMaintenanceBlocks(markdown || '').find(e => e.uuid === uuid);
  if (!evt) { alert('Maintenance period not found.'); return; }

  await chrome.storage.local.set({
    moreButtonsUpdateMaintenance: {
      maintenanceTitle: evt.services,
      description:      evt.description,
      scheduledStart:   (evt.start || '').replace(' ', 'T'),
      scheduledEnd:     (evt.end || '').replace(' ', 'T'),
    }
  });

  const { formEl: updateFormEl } = await createForm('updateMaintenance');
  if (!updateFormEl) return;
  updateFormEl.dataset.editUuid = uuid;
  // Completing early only makes sense mid-window: an early end for an upcoming
  // event would land before its start, and past events are already done.
  if (maintenancePhase(evt, new Date()) !== 'in progress') {
    updateFormEl.parentElement.querySelector('[data-action="completeMaintenanceNow"]')?.remove();
  }
});

/**
 * Shared save path for the update-maintenance form. Status is derived from the
 * (possibly edited) window — same as at creation — so the block lands in the
 * section the reconciliation sweep would pick anyway: an end in the past means
 * completed, and moving a past event's end into the future cleanly reopens it.
 */
async function saveMaintenanceUpdate(formEl, btn) {
  // Validate before going busy so a bad window doesn't flash the amber state.
  const startRaw = formEl.querySelector('[name="scheduledStart"]')?.value ?? '';
  const endRaw = formEl.querySelector('[name="scheduledEnd"]')?.value ?? '';
  if (!startRaw || !endRaw) { alert('Please set both a scheduled start and end.'); return; }
  if (endRaw <= startRaw) { alert('Scheduled end must be after the scheduled start.'); return; }
  const snap = snapshotButton(btn);
  setButtonBusy(btn, 'Saving…');
  try {
    const _uuid = formEl.dataset.editUuid;
    if (!_uuid) throw new Error('No maintenance UUID found');
    const update = {
      description:   formEl.querySelector('[name="description"]')?.value.trim() ?? '',
      start:         startRaw.replace('T', ' '),
      end:           endRaw.replace('T', ' '),
      startIso:      toIsoWithOffset(startRaw),
      endIso:        toIsoWithOffset(endRaw),
    };
    update.currentStatus = maintenancePhase(update, new Date());
    await publishUpdatedMaintenance(_uuid, update, status => setButtonBusy(btn, status));
    await chrome.storage.local.remove('moreButtonsUpdateMaintenance');
    await navigateBack();
  } catch (e) {
    restoreButton(btn, snap);
    alert('Failed to update maintenance: ' + e.message);
  }
}

registerFormAction('submitUpdateMaintenance', async ({ formEl, content }) => {
  await saveMaintenanceUpdate(formEl, content.querySelector('[data-action="submitUpdateMaintenance"]'));
});

registerFormAction('completeMaintenanceNow', async ({ formEl, content }) => {
  const endInput = formEl.querySelector('[name="scheduledEnd"]');
  if (endInput) {
    // Clamp to one minute past the start so a same-minute completion still
    // passes the end-after-start validation.
    const startRaw = formEl.querySelector('[name="scheduledStart"]')?.value ?? '';
    const stamp = nowLocalStamp();
    endInput.value = startRaw && stamp <= startRaw
      ? nowLocalStamp(new Date(Date.parse(startRaw) + 60000))
      : stamp;
  }
  await saveMaintenanceUpdate(formEl, content.querySelector('[data-action="completeMaintenanceNow"]'));
});

registerFormAction('deleteMaintenance', async ({ formEl, content, cleanup }) => {
  if (!confirm('Cancel and delete this maintenance period? This cannot be undone.')) return;
  const btn = content.querySelector('[data-action="deleteMaintenance"]');
  const snap = snapshotButton(btn);
  setButtonBusy(btn, 'Deleting…');
  try {
    const _uuid = formEl.dataset.editUuid;
    if (!_uuid) throw new Error('No maintenance UUID found');
    await publishDeleteMaintenance(_uuid, status => setButtonBusy(btn, status));
    await chrome.storage.local.remove('moreButtonsUpdateMaintenance');
    await navigateBack();
  } catch (e) {
    restoreButton(btn, snap);
    alert('Failed to delete maintenance: ' + e.message);
  }
});
