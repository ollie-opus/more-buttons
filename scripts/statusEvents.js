// Pure markdown logic for the System Status page: incidents + maintenance
// windows ("events"). Lives outside systemStatus.js so github.js can run the
// section migration + time-based reconciliation sweep from its migrate-on-fetch
// hook without an import cycle (systemStatus.js imports github.js).
//
// Page grammar (docs/pages/system-status.md), sections split on `\n---\n`:
//   ## Services          — status-* tiles, body = uuid span + `**Status:** X`
//   ## Upcoming Events   — maintenance only, sorted ascending by start
//   ## Active Events     — ongoing incidents + in-progress maintenance
//   ## Past Events       — `??? outline "View past events"` collapsible,
//                          blocks indented 4 spaces
//
// Event cards title themselves with their kind as a label pill (OUTAGE /
// DISRUPTION / MAINTENANCE) and list services in a `- **Services Affected:**`
// field; status and timestamp values render as label pills. Blocks carry
// machine-readable instants on the hidden span (data-mb-start/end for
// maintenance, data-mb-reported/resolved for incidents — local ISO with
// explicit UTC offset captured per endpoint at authoring time) so the KB's
// client-side script can compute absolute times for every visitor; the visible
// field lines stay local-naive.

import {
  parseAdmonitions,
  buildAdmonition,
  generateUUID,
  injectAdmonitionUUID,
  replaceAdmonitionByUUID,
  deleteAdmonitionByUUID,
  stripLabelSpans,
} from './admonitions.js';
import { labelMarkup } from './markdownInline.js';

// Incident ops only (never matches maintenance blocks).
export const INCIDENT_TYPE_RE = /status-available|status-disruption|status-outage/;
// Every status block kind — service tiles, UUID backfill, event-section scans.
export const STATUS_BLOCK_TYPE_RE = /status-available|status-disruption|status-outage|status-maintenance/;
export const MAINTENANCE_TYPE_RE = /status-maintenance/;

const UPCOMING_SECTION_RE = /^## Upcoming Events\s*\n([\s\S]*?)(?=\n---|\n##)/m;
const ACTIVE_SECTION_RE   = /^## Active Events\s*\n([\s\S]*?)(?=\n---|\n##)/m;
const PAST_SECTION_RE     = /^## Past Events[^\n]*\n([\s\S]*)$/m;
const SERVICES_SECTION_RE = /^## Services\s*\n([\s\S]*?)(?=\n---|\n##)/m;

const MAINTENANCE_STATUS_LABEL = { 'upcoming': 'Upcoming', 'in progress': 'In progress', 'completed': 'Completed' };
const MAINTENANCE_STATUS_RANK  = { 'upcoming': 0, 'in progress': 1, 'completed': 2 };

// Event-card values render as label pills on the published site. The in-memory
// model stays plain strings: builders wrap, extractIncidentField strips.
const IMPACT_PILL_SLUG        = { outage: 'red', disruption: 'amber' };
const INCIDENT_STATUS_PILL    = { ongoing: ['Ongoing', 'amber'], resolved: ['Resolved', 'green'] };
const MAINTENANCE_STATUS_SLUG = { 'upcoming': 'sky', 'in progress': 'amber', 'completed': 'green' };
const slatePill = v => (v ? labelMarkup('slate', v) : '');

// ── Section-name migration ────────────────────────────────────────────────────

/**
 * One-time terminology migration (idempotent): Open/Past Incidents → Active/
 * Past Events, plus a new empty Upcoming Events section between Services and
 * Active. Every mutation entry point runs this first, so old-format documents
 * are tolerated at any boundary while the persistent regexes only ever need to
 * know the new headings.
 */
export function migrateStatusSections(markdown) {
  let result = markdown
    .replace(/^## Open Incidents[^\n]*$/m, '## Active Events')
    .replace(/^## Past Incidents[^\n]*$/m, '## Past Events')
    .replace(/^(\s*)\?\?\? outline "View past incidents"/m, '$1??? outline "View past events"');
  if (!/^## Upcoming Events/m.test(result) && /^## Active Events/m.test(result)) {
    // The inserted `\n---\n` is a valid part boundary for every split() caller.
    result = result.replace(/^## Active Events/m, '## Upcoming Events\n\n---\n\n## Active Events');
  }
  return result;
}

// ── Shared field helpers ──────────────────────────────────────────────────────

export function indentBlock(text, indent) {
  return text.split('\n').map(line => line.length ? indent + line : line).join('\n');
}

/**
 * Extracts a named field from an admonition body.
 * Body lines are stored WITHOUT the 4-space prefix (already stripped by parseAdmonitions).
 */
export function extractIncidentField(body, fieldName) {
  // Same-line whitespace only — `\s*` would cross the newline of an empty
  // field and capture the NEXT field line as the value.
  const re = new RegExp(`^- \\*\\*${fieldName}:\\*\\*[ \\t]*(.*)$`, 'm');
  const m = body.match(re);
  if (!m) return '';
  // Values may be wrapped in a label pill (current format) or backticks
  // (legacy) — the domain model only ever sees the plain text.
  return stripLabelSpans(m[1]).replace(/^`|`$/g, '').trim();
}

/**
 * Legacy blocks carried the service list in the admonition title; current
 * blocks in a dedicated field. Fall back to the title ONLY when the field line
 * is absent — a present-but-empty field must round-trip as empty, never as the
 * pill title's text.
 */
function servicesFromBlock(block) {
  return /^- \*\*Services Affected:\*\*/m.test(block.body)
    ? extractIncidentField(block.body, 'Services Affected')
    : stripLabelSpans(block.title);
}

// ── Time helpers ──────────────────────────────────────────────────────────────

/**
 * Absolute epoch-ms for an event endpoint. Prefers the span's offset-carrying
 * ISO; falls back to the visible local-naive `YYYY-MM-DD HH:MM` line (parsed
 * in this machine's zone). NaN when neither parses.
 */
function parseInstant(iso, naive) {
  if (iso) {
    const t = Date.parse(iso);
    if (!Number.isNaN(t)) return t;
  }
  if (naive) {
    const t = Date.parse(naive.replace(' ', 'T'));
    if (!Number.isNaN(t)) return t;
  }
  return NaN;
}

const startKey = evt => {
  const t = parseInstant(evt.startIso, evt.start);
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
};

/**
 * Appends this machine's UTC offset AT THAT INSTANT to a datetime-local value
 * ("2026-08-21T09:00" → "2026-08-21T09:00+01:00"), so a window spanning a DST
 * change carries a different (correct) offset on each endpoint.
 */
export function toIsoWithOffset(datetimeLocal) {
  if (!datetimeLocal) return '';
  const d = new Date(datetimeLocal);
  if (Number.isNaN(d.getTime())) return '';
  const mins = -d.getTimezoneOffset();
  const sign = mins < 0 ? '-' : '+';
  const abs = Math.abs(mins);
  const pad = n => String(n).padStart(2, '0');
  return `${datetimeLocal}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/**
 * Where an event sits in time: 'upcoming' | 'in progress' | 'completed'.
 * Unparseable endpoints degrade safely (no start/end → 'upcoming').
 */
export function maintenancePhase(evt, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : now;
  const endMs = parseInstant(evt.endIso, evt.end);
  if (!Number.isNaN(endMs) && nowMs >= endMs) return 'completed';
  const startMs = parseInstant(evt.startIso, evt.start);
  if (!Number.isNaN(startMs) && nowMs >= startMs) return 'in progress';
  return 'upcoming';
}

// ── Incident blocks ───────────────────────────────────────────────────────────

/**
 * Builds a complete incident admonition block. Title is the impact kind as a
 * label pill (severity itself still lives in the admonition type); the hidden
 * span carries the UUID first, then the machine-readable Reported/Resolved
 * instants (ISO with UTC offset) when known, mirroring maintenance blocks.
 * Body lines have NO leading indent — buildAdmonition adds the 4-space prefix.
 */
export function buildIncidentBlock(inc) {
  const uuid = inc.uuid ?? generateUUID();
  const attrs = [`data-uuid="${uuid}"`];
  if (inc.reportedIso) attrs.push(`data-mb-reported="${inc.reportedIso}"`);
  if (inc.resolvedIso) attrs.push(`data-mb-resolved="${inc.resolvedIso}"`);
  const [statusText, statusSlug] = INCIDENT_STATUS_PILL[inc.currentStatus === 'resolved' ? 'resolved' : 'ongoing'];
  const body = [
    `<span ${attrs.join(' ')} style="display:none"></span>`,
    '',
    `- **Services Affected:** ${inc.services || ''}`,
    `- **Current Status:** ${labelMarkup(statusSlug, statusText)}`,
    `- **Description:** ${inc.description || ''}`,
    `- **Reported:** ${slatePill(inc.reported)}`,
    `- **Resolved:** ${slatePill(inc.resolved)}`,
    `- **Causation:** ${inc.causation || ''}`,
  ].join('\n');
  const title = labelMarkup(IMPACT_PILL_SLUG[inc.impact] ?? 'amber', inc.impact.toUpperCase());
  return buildAdmonition('!!!', `status-${inc.impact}`, title, body);
}

function incidentFromBlock(block) {
  return {
    services:      servicesFromBlock(block),
    impact:        block.type.replace('status-', ''),
    description:   extractIncidentField(block.body, 'Description'),
    reported:      extractIncidentField(block.body, 'Reported'),
    resolved:      extractIncidentField(block.body, 'Resolved'),
    currentStatus: extractIncidentField(block.body, 'Current Status').toLowerCase() || 'ongoing',
    causation:     extractIncidentField(block.body, 'Causation'),
    reportedIso:   (block.body.match(/data-mb-reported="([^"]*)"/) || [])[1] || '',
    resolvedIso:   (block.body.match(/data-mb-resolved="([^"]*)"/) || [])[1] || '',
    uuid:          block.uuid,
  };
}

/**
 * Parses all incident admonition blocks from a section of markdown.
 * Delegates to parseAdmonitions, then maps to the domain shape.
 */
export function parseIncidentBlocks(sectionBody) {
  return parseAdmonitions(sectionBody, INCIDENT_TYPE_RE).map(incidentFromBlock);
}

/**
 * Parses past incident blocks from the full markdown document.
 * parseAdmonitions handles any indent level transparently.
 */
export function parsePastIncidentBlocks(markdown) {
  const pastMatch = migrateStatusSections(markdown).match(PAST_SECTION_RE);
  if (!pastMatch) return [];
  return parseAdmonitions(pastMatch[1], INCIDENT_TYPE_RE).map(incidentFromBlock);
}

// ── Maintenance blocks ────────────────────────────────────────────────────────

/**
 * Builds a maintenance admonition block. Unlike incidents the hidden span also
 * carries the machine-readable window endpoints; data-uuid stays first so the
 * loose data-uuid parse paths (getAdmonitionUUID / locateBlockByUUID) are
 * unaffected by the extra attributes.
 */
export function buildMaintenanceBlock(evt) {
  const uuid = evt.uuid ?? generateUUID();
  const attrs = [`data-uuid="${uuid}"`];
  if (evt.startIso) attrs.push(`data-mb-start="${evt.startIso}"`);
  if (evt.endIso) attrs.push(`data-mb-end="${evt.endIso}"`);
  const status = MAINTENANCE_STATUS_LABEL[evt.currentStatus] ? evt.currentStatus : 'upcoming';
  const body = [
    `<span ${attrs.join(' ')} style="display:none"></span>`,
    '',
    `- **Services Affected:** ${evt.services || ''}`,
    `- **Scheduled Start:** ${slatePill(evt.start)}`,
    `- **Scheduled End:** ${slatePill(evt.end)}`,
    `- **Current Status:** ${labelMarkup(MAINTENANCE_STATUS_SLUG[status], MAINTENANCE_STATUS_LABEL[status])}`,
    `- **Description:** ${evt.description || ''}`,
  ].join('\n');
  return buildAdmonition('!!!', 'status-maintenance', labelMarkup('amber', 'MAINTENANCE'), body);
}

function maintenanceFromBlock(block) {
  return {
    services:      servicesFromBlock(block),
    description:   extractIncidentField(block.body, 'Description'),
    start:         extractIncidentField(block.body, 'Scheduled Start'),
    end:           extractIncidentField(block.body, 'Scheduled End'),
    currentStatus: extractIncidentField(block.body, 'Current Status').toLowerCase() || 'upcoming',
    startIso:      (block.body.match(/data-mb-start="([^"]*)"/) || [])[1] || '',
    endIso:        (block.body.match(/data-mb-end="([^"]*)"/) || [])[1] || '',
    uuid:          block.uuid,
  };
}

/** Parses all maintenance blocks in `text` (any indent level). */
export function parseMaintenanceBlocks(text) {
  return parseAdmonitions(text, MAINTENANCE_TYPE_RE).map(maintenanceFromBlock);
}

// ── Card-format migration ─────────────────────────────────────────────────────

/**
 * One-time card-format migration (idempotent): legacy event cards carried the
 * service list in the admonition title, a decorative `Service Impact` line and
 * backticked statuses; current cards use a pill title (event kind), a
 * `Services Affected` field and label-pill values. Tolerant parse →
 * deterministic rebuild: an already-migrated block re-emits byte-identically,
 * so the document converges in one pass. Incident Reported/Resolved get their
 * ISO span attrs backfilled in this machine's zone (the same assumption the
 * reconciliation sweep makes for maintenance).
 */
export function migrateStatusCardFormat(markdown) {
  let result = markdown;
  for (const block of parseAdmonitions(result, INCIDENT_TYPE_RE)) {
    // Service tiles share the incident types (a tile can be status-outage) but
    // have no `- **Field:**` lines — never rewrite those.
    if (!block.uuid || !/^- \*\*/m.test(block.body)) continue;
    const inc = incidentFromBlock(block);
    inc.reportedIso ||= toIsoWithOffset((inc.reported || '').replace(' ', 'T'));
    inc.resolvedIso ||= toIsoWithOffset((inc.resolved || '').replace(' ', 'T'));
    result = replaceAdmonitionByUUID(result, block.uuid, buildIncidentBlock(inc));
  }
  for (const block of parseAdmonitions(result, MAINTENANCE_TYPE_RE)) {
    if (!block.uuid || !/^- \*\*/m.test(block.body)) continue;
    result = replaceAdmonitionByUUID(result, block.uuid, buildMaintenanceBlock(maintenanceFromBlock(block)));
  }
  return result;
}

// ── Event-section access ──────────────────────────────────────────────────────

/** Service names, i.e. the tile titles under `## Services` (any status kind). */
export function parseServiceNames(markdown) {
  const servicesMatch = migrateStatusSections(markdown).match(SERVICES_SECTION_RE);
  if (!servicesMatch) return [];
  return parseAdmonitions(servicesMatch[1], STATUS_BLOCK_TYPE_RE).map(b => b.title).filter(Boolean);
}

/** The raw body text of each event section (old headings normalized first). */
export function sectionBodies(markdown) {
  const md = migrateStatusSections(markdown);
  return {
    upcoming: md.match(UPCOMING_SECTION_RE)?.[1] ?? '',
    active:   md.match(ACTIVE_SECTION_RE)?.[1] ?? '',
    past:     md.match(PAST_SECTION_RE)?.[1] ?? '',
  };
}

/**
 * Parses a mixed event section into tagged domain objects, in document order:
 * incidents get `kind: 'incident'`, maintenance blocks `kind: 'maintenance'`.
 */
export function parseEventBlocks(sectionText) {
  return parseAdmonitions(sectionText, STATUS_BLOCK_TYPE_RE).map(block =>
    block.type === 'status-maintenance'
      ? { kind: 'maintenance', ...maintenanceFromBlock(block) }
      : { kind: 'incident', ...incidentFromBlock(block) });
}

// ── Maintenance placement ─────────────────────────────────────────────────────

/**
 * Rebuilds the Upcoming Events section from `events`, sorted ascending by
 * start instant. Safe as a full rebuild: Upcoming only ever holds maintenance
 * blocks, and buildMaintenanceBlock round-trips its own output byte-identically
 * (so an untouched section rebuilds to the same string).
 */
function rebuildUpcomingSection(markdown, events) {
  const parts = markdown.split('\n---\n');
  const idx = parts.findIndex(p => /^## Upcoming Events/m.test(p));
  if (idx === -1) return markdown;
  const headerMatch = parts[idx].match(/^## Upcoming Events[^\n]*/m);
  const pre = parts[idx].slice(0, parts[idx].indexOf(headerMatch[0]));
  const sorted = [...events].sort((a, b) => startKey(a) - startKey(b));
  const blocks = sorted.length ? '\n' + sorted.map(e => buildMaintenanceBlock(e)).join('\n\n') + '\n' : '';
  parts[idx] = pre + headerMatch[0] + '\n' + blocks;
  return parts.join('\n---\n');
}

/** Prepends `block` directly under a section heading, leaving siblings untouched. */
function spliceUnderHeading(markdown, headingRe, block) {
  const parts = markdown.split('\n---\n');
  const idx = parts.findIndex(p => headingRe.test(p));
  if (idx === -1) return markdown;
  parts[idx] = parts[idx].replace(headingRe, `$&\n${block}\n`);
  return parts.join('\n---\n');
}

/** Prepends `block` (indented) into the Past Events collapsible. */
function spliceIntoPast(markdown, block) {
  const parts = markdown.split('\n---\n');
  const idx = parts.findIndex(p => /^## Past Events/m.test(p));
  if (idx === -1) return markdown;
  const indented = indentBlock(block, '    ');
  // Consume any newlines after the wrapper line so an empty collapsible (no
  // blank line yet, possibly at EOF) accepts the insert too.
  const wrapperRe = /^(\?\?\? outline "[^"]+" *)\n*/m;
  parts[idx] = wrapperRe.test(parts[idx])
    ? parts[idx].replace(wrapperRe, `$1\n\n${indented}\n\n`)
    : parts[idx].replace(/^(## Past Events[^\n]*\n)/m, `$1\n??? outline "View past events"\n\n${indented}\n\n`);
  return parts.join('\n---\n');
}

/**
 * Inserts a maintenance event into the section matching its currentStatus:
 * Upcoming (kept sorted ascending by start) / Active (prepend) / Past
 * (prepend, indented, inside the collapsible). Does NOT recalc tiles — callers
 * finish with recalculateServiceStatuses.
 */
export function insertMaintenanceBlock(markdown, evt) {
  const md = migrateStatusSections(markdown);
  if (evt.currentStatus === 'completed') {
    return spliceIntoPast(md, buildMaintenanceBlock(evt));
  }
  if (evt.currentStatus === 'in progress') {
    return spliceUnderHeading(md, /^(## Active Events[^\n]*\n)/m, buildMaintenanceBlock(evt));
  }
  const m = md.match(UPCOMING_SECTION_RE);
  const existing = m ? parseMaintenanceBlocks(m[1]) : [];
  return rebuildUpcomingSection(md, [...existing.filter(e => !e.uuid || e.uuid !== evt.uuid), evt]);
}

/**
 * Updates a maintenance event by UUID: merge fields, then delete + re-insert
 * so a status change (manual completion, reopen, reschedule past a boundary)
 * lands the block in the right section.
 */
export function updateMarkdownMaintenance(markdown, uuid, update) {
  const md = migrateStatusSections(markdown);
  const evt = parseMaintenanceBlocks(md).find(e => e.uuid === uuid);
  if (!evt) return md;
  const merged = { ...evt, ...update, uuid };
  const result = insertMaintenanceBlock(deleteAdmonitionByUUID(md, uuid), merged);
  return recalculateServiceStatuses(result);
}

// ── Reconciliation sweep ──────────────────────────────────────────────────────

/**
 * Time-based sweep run from github.js's migrate-on-fetch hook (so every status
 * mutation commits reconciled markdown). Forward-only: a stored status is only
 * ever advanced to match the clock (upcoming → in progress at start, anything
 * → completed at end); manual early completion / early start are never undone.
 * Also stamps missing data-mb-* attrs (hand-authored blocks) and keeps the
 * Upcoming section sorted. Idempotent for a fixed `now`.
 */
export function reconcileStatusEvents(markdown, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : now;
  let result = migrateStatusSections(markdown);

  const collect = (re, section) => {
    const m = result.match(re);
    return m ? parseMaintenanceBlocks(m[1]).map(e => ({ ...e, _section: section })) : [];
  };
  const events = [...collect(UPCOMING_SECTION_RE, 'upcoming'), ...collect(ACTIVE_SECTION_RE, 'active')];

  for (const evt of events) {
    if (!evt.uuid) continue; // no identity to move by; backfilled on the next hook run
    const phase = maintenancePhase(evt, nowMs);
    const desired = (MAINTENANCE_STATUS_RANK[phase] ?? 0) > (MAINTENANCE_STATUS_RANK[evt.currentStatus] ?? 0)
      ? phase
      : evt.currentStatus;
    const targetSection = desired === 'completed' ? 'past' : desired === 'in progress' ? 'active' : 'upcoming';
    const needsAttrs = (!evt.startIso && evt.start) || (!evt.endIso && evt.end);
    if (desired === evt.currentStatus && targetSection === evt._section && !needsAttrs) continue;

    const updated = {
      ...evt,
      currentStatus: desired,
      startIso: evt.startIso || toIsoWithOffset((evt.start || '').replace(' ', 'T')),
      endIso:   evt.endIso   || toIsoWithOffset((evt.end || '').replace(' ', 'T')),
    };
    result = insertMaintenanceBlock(deleteAdmonitionByUUID(result, evt.uuid), updated);
  }

  // Keep Upcoming sorted even when nothing transitioned (hand edits); rebuild
  // only on an actual order violation so untouched files pass through intact.
  const upMatch = result.match(UPCOMING_SECTION_RE);
  if (upMatch) {
    const upcoming = parseMaintenanceBlocks(upMatch[1]);
    const keys = upcoming.map(startKey);
    if (keys.some((k, i) => i > 0 && k < keys[i - 1])) {
      result = rebuildUpcomingSection(result, upcoming);
    }
  }

  return recalculateServiceStatuses(result);
}

// ── Incident mutations ────────────────────────────────────────────────────────

/**
 * Updates open incidents using UUID-based operations.
 *
 * For each active incident:
 *   - If it has an update and is now resolved: deleteAdmonitionByUUID from
 *     Active, then prepend (indented) into the Past Events collapsible.
 *   - If it has an update and is still open: replaceAdmonitionByUUID in place.
 *   - If no update: leave it alone.
 *
 * For a new incident: prepend to the Active section (or Past if created
 * already-resolved) via a heading splice — the section is never rebuilt
 * wholesale, so maintenance blocks sharing it are left untouched.
 */
export function updateMarkdownIncidents(markdown, incidentUpdates, newIncident) {
  let result = migrateStatusSections(markdown);
  const activeMatch = result.match(ACTIVE_SECTION_RE);
  if (!activeMatch) return result;

  const openIncidents = parseIncidentBlocks(activeMatch[1]);

  openIncidents.forEach((inc) => {
    const update = (inc.uuid && incidentUpdates[inc.uuid]) ? incidentUpdates[inc.uuid] : null;
    if (!update) return; // no change for this incident

    const merged = { ...inc, ...update, uuid: inc.uuid };

    if (merged.currentStatus === 'resolved') {
      if (merged.uuid) {
        result = deleteAdmonitionByUUID(result, merged.uuid);
      }
      result = spliceIntoPast(result, buildIncidentBlock(merged));
    } else if (merged.uuid) {
      result = replaceAdmonitionByUUID(result, merged.uuid, buildIncidentBlock(merged));
    }
  });

  if (newIncident?.services) {
    const newInc = { ...newIncident, uuid: newIncident.uuid ?? generateUUID() };
    const builtBlock = buildIncidentBlock(newInc);
    result = newInc.currentStatus === 'resolved'
      ? spliceIntoPast(result, builtBlock)
      : spliceUnderHeading(result, /^(## Active Events[^\n]*\n)/m, builtBlock);
  }

  return recalculateServiceStatuses(result);
}

/**
 * Updates a past incident identified by UUID.
 * If switching to 'ongoing', deletes from past and prepends to Active.
 * If remaining resolved, replaces in place via UUID.
 */
export function updateMarkdownPastIncident(markdown, uuid, update) {
  const md = migrateStatusSections(markdown);
  const inc = parsePastIncidentBlocks(md).find(i => i.uuid === uuid);
  if (!inc) return md;

  const merged = { ...inc, ...update, uuid: inc.uuid };

  if (merged.currentStatus === 'ongoing') {
    const result = spliceUnderHeading(
      deleteAdmonitionByUUID(md, uuid),
      /^(## Active Events[^\n]*\n)/m,
      buildIncidentBlock(merged)
    );
    return recalculateServiceStatuses(result);
  }
  return recalculateServiceStatuses(replaceAdmonitionByUUID(md, uuid, buildIncidentBlock(merged)));
}

/** Deletes an event (incident or maintenance, any section) identified by UUID. */
export function deleteMarkdownEvent(markdown, uuid) {
  const result = deleteAdmonitionByUUID(migrateStatusSections(markdown), uuid);
  return recalculateServiceStatuses(result);
}

// ── Service tiles ─────────────────────────────────────────────────────────────

export function updateMarkdownServices(markdown, updates) {
  const servicesMatch = markdown.match(SERVICES_SECTION_RE);
  if (!servicesMatch) return markdown;

  const serviceBlocks = parseAdmonitions(servicesMatch[1], STATUS_BLOCK_TYPE_RE);
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
        new RegExp(`^!!! status-(?:available|disruption|outage|maintenance) "${escapedTitle}"\\n\\n    \\*\\*Status:\\*\\* (?:AVAILABLE|DISRUPTION|OUTAGE|MAINTENANCE) *$`, 'gm'),
        `!!! status-${newStatus} "${block.title}"\n\n    **Status:** ${newStatus.toUpperCase()}`
      );
    }
  }
  return result;
}

/**
 * Re-derives every service tile from the Active Events section. Severity
 * ladder: outage > disruption > maintenance > available; incidents contribute
 * their impact, maintenance contributes 'maintenance' only while In progress.
 */
export function recalculateServiceStatuses(markdown) {
  const md = migrateStatusSections(markdown);
  const serviceNames = [];
  const servicesMatch = md.match(SERVICES_SECTION_RE);
  if (servicesMatch) {
    const re = /^!!! status-(?:available|disruption|outage|maintenance) "([^"]+)"/gm;
    let m;
    while ((m = re.exec(servicesMatch[1])) !== null) serviceNames.push(m[1]);
  }

  const activeMatch = md.match(ACTIVE_SECTION_RE);
  const openIncidents = activeMatch ? parseIncidentBlocks(activeMatch[1]) : [];
  const activeMaintenance = activeMatch
    ? parseMaintenanceBlocks(activeMatch[1]).filter(e => e.currentStatus === 'in progress')
    : [];

  const SEVERITY = { outage: 3, disruption: 2, maintenance: 1, available: 0 };
  const derived = {};
  serviceNames.forEach(name => { derived[name] = 'available'; });
  const raise = (services, level) => {
    services.split(',').map(s => s.trim()).forEach(name => {
      if (!(name in derived)) return;
      if ((SEVERITY[level] ?? 0) > (SEVERITY[derived[name]] ?? 0)) derived[name] = level;
    });
  };
  openIncidents.forEach(inc => raise(inc.services, inc.impact));
  activeMaintenance.forEach(evt => raise(evt.services, 'maintenance'));

  return updateMarkdownServices(md, derived);
}

// ── Banner / toml derivations ─────────────────────────────────────────────────

/**
 * The announcement-banner value the site should show for this status file:
 * 'outage' if any active incident is an outage, else 'disruption' if any is a
 * disruption, else '' (no incident banner). Maintenance never contributes here
 * — its banner is time-gated client-side from the mb_maintenance_* toml keys.
 */
export function deriveBannerStatus(markdown) {
  const md = migrateStatusSections(markdown);
  const activeMatch = md.match(ACTIVE_SECTION_RE);
  const openIncidents = activeMatch ? parseIncidentBlocks(activeMatch[1]) : [];
  if (openIncidents.some(inc => inc.impact === 'outage')) return 'outage';
  if (openIncidents.some(inc => inc.impact === 'disruption')) return 'disruption';
  return '';
}

/**
 * The single next maintenance window the site should announce: the earliest-
 * starting Upcoming/In-progress event whose end hasn't passed. Null when there
 * is none (the extension then blanks the mb_maintenance_* keys).
 */
export function deriveMaintenanceWindow(markdown, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : now;
  const md = migrateStatusSections(markdown);
  const candidates = [];
  for (const re of [UPCOMING_SECTION_RE, ACTIVE_SECTION_RE]) {
    const m = md.match(re);
    if (!m) continue;
    for (const evt of parseMaintenanceBlocks(m[1])) {
      if (evt.currentStatus === 'completed') continue;
      const endMs = parseInstant(evt.endIso, evt.end);
      if (!Number.isNaN(endMs) && nowMs >= endMs) continue; // already over
      candidates.push(evt);
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => startKey(a) - startKey(b));
  const next = candidates[0];
  return {
    startIso: next.startIso || toIsoWithOffset((next.start || '').replace(' ', 'T')),
    endIso:   next.endIso   || toIsoWithOffset((next.end || '').replace(' ', 'T')),
    services: next.services,
  };
}
