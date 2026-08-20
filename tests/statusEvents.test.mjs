import assert from 'node:assert/strict';
import {
  migrateStatusSections, migrateStatusCardFormat, extractIncidentField,
  buildIncidentBlock, parseIncidentBlocks,
  buildMaintenanceBlock, parseMaintenanceBlocks, maintenancePhase, toIsoWithOffset,
  insertMaintenanceBlock, updateMarkdownMaintenance, reconcileStatusEvents,
  updateMarkdownIncidents, updateMarkdownPastIncident, deleteMarkdownEvent,
  recalculateServiceStatuses, deriveMaintenanceWindow, deriveBannerStatus,
  parseEventBlocks, sectionBodies, parseServiceNames,
  ALL_SERVICES, normalizeServiceSelection,
} from '../scripts/statusEvents.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// ── Fixtures ─────────────────────────────────────────────────────────────────

const indent = b => b.split('\n').map(l => l.length ? '    ' + l : l).join('\n');

function serviceTile(name, status, uuid) {
  return [
    `!!! status-${status} "${name}"`,
    '',
    `    <span data-uuid="${uuid}" style="display:none"></span>`,
    '',
    '',
    `    **Status:** ${status.toUpperCase()}`,
  ].join('\n');
}

// Legacy card format (services in the title, decorative Service Impact line,
// backticked status, no ISO span attrs) — kept as migration input and for
// parse-tolerance tests.
function legacyIncident(impact, services, uuid, status = 'Ongoing') {
  return [
    `!!! status-${impact} "${services}"`,
    '',
    `    <span data-uuid="${uuid}" style="display:none"></span>`,
    '',
    `    - **Service Impact:** ${impact.toUpperCase()}`,
    `    - **Current Status:** \`${status}\``,
    '    - **Description:** Something happened',
    '    - **Reported:** 2026-08-13 09:00',
    '    - **Resolved:** ',
    '    - **Causation:** ',
  ].join('\n');
}

function incident(impact, services, uuid, status = 'ongoing') {
  return buildIncidentBlock({
    uuid, impact, services, currentStatus: status,
    description: 'Something happened', causation: '',
    reported: '2026-08-13 09:00', reportedIso: '2026-08-13T09:00+01:00',
    resolved: status === 'resolved' ? '2026-08-13 10:00' : '',
    resolvedIso: status === 'resolved' ? '2026-08-13T10:00+01:00' : '',
  });
}

function maintenance({ uuid, services = 'Server', start, end, startIso, endIso, status = 'upcoming', description = 'Planned work' }) {
  return buildMaintenanceBlock({ uuid, services, start, end, startIso, endIso, currentStatus: status, description });
}

function statusFile({ services, upcoming = [], active = [], past = [] } = {}) {
  services = services ?? [serviceTile('Server', 'available', 's1'), serviceTile('Files', 'available', 's2')];
  return [
    '# System Status',
    '',
    '## Services',
    '',
    '<div class="grid" markdown>',
    ...services.flatMap(b => [b, '']),
    '</div>',
    '',
    '---',
    '',
    '## Active Events',
    '',
    ...active.flatMap(b => [b, '']),
    '---',
    '',
    '## Upcoming Events',
    '',
    ...upcoming.flatMap(b => [b, '']),
    '---',
    '',
    '## Past Events',
    '',
    '??? outline "View past events"',
    '',
    ...past.flatMap(b => [indent(b), '']),
  ].join('\n');
}

// Timezone-independent instants (explicit offsets) used throughout.
const T = iso => Date.parse(iso);

// ── migrateStatusSections ────────────────────────────────────────────────────

function oldFormatFile() {
  return [
    '# System Status',
    '',
    '## Services',
    '',
    serviceTile('Server', 'available', 's1'),
    '',
    '---',
    '',
    '## Open Incidents',
    '',
    legacyIncident('outage', 'Server', 'i1'),
    '',
    '---',
    '',
    '## Past Incidents',
    '',
    '??? outline "View past incidents"',
    '',
    indent(legacyIncident('outage', 'Server', 'i2', 'Resolved')),
    '',
  ].join('\n');
}

test('migrate: renames headings, wrapper, and inserts Upcoming Events', () => {
  const out = migrateStatusSections(oldFormatFile());
  assert.ok(/^## Upcoming Events$/m.test(out));
  assert.ok(/^## Active Events$/m.test(out));
  assert.ok(/^## Past Events$/m.test(out));
  assert.ok(out.includes('??? outline "View past events"'));
  assert.ok(!out.includes('Open Incidents') && !out.includes('Past Incidents'));
  // Active comes first, Upcoming after it, each its own `---` part
  const parts = out.split('\n---\n');
  assert.ok(/^## Active Events/m.test(parts[1]));
  assert.ok(/^## Upcoming Events/m.test(parts[2]));
  // The migrated Active section keeps its card — the swap moves content, not headings
  assert.ok(parts[1].includes('data-uuid="i1"'));
});

test('migrate: moves an Upcoming-first document below Active, idempotently', () => {
  const upcomingFirst = [
    '# System Status', '', '## Services', '', serviceTile('Server', 'available', 's1'), '',
    '---', '', '## Upcoming Events', '', maintenance({ uuid: 'm1' }), '',
    '---', '', '## Active Events', '', incident('outage', 'Server', 'i1'), '',
    '---', '', '## Past Events', '', '??? outline "View past events"', '',
  ].join('\n');
  const out = migrateStatusSections(upcomingFirst);
  const parts = out.split('\n---\n');
  assert.ok(/^## Active Events/m.test(parts[1]));
  assert.ok(parts[1].includes('data-uuid="i1"'));
  assert.ok(/^## Upcoming Events/m.test(parts[2]));
  assert.ok(parts[2].includes('data-uuid="m1"'));
  // Re-running is byte-identical, so a settled document never manufactures a diff
  assert.equal(migrateStatusSections(out), out);
});

test('migrate: idempotent, and identity on new-format files', () => {
  const once = migrateStatusSections(oldFormatFile());
  assert.equal(migrateStatusSections(once), once);
  const fresh = statusFile();
  assert.equal(migrateStatusSections(fresh), fresh);
});

// ── Maintenance block build ↔ parse ──────────────────────────────────────────

test('maintenance block round-trips through parse and rebuild', () => {
  const evt = {
    uuid: 'm1', services: 'Server, Files', description: 'Database upgrade',
    start: '2026-08-21 09:00', end: '2026-08-21 11:00',
    startIso: '2026-08-21T09:00+01:00', endIso: '2026-08-21T11:00+01:00',
    currentStatus: 'upcoming',
  };
  const block = buildMaintenanceBlock(evt);
  const [parsed] = parseMaintenanceBlocks(block);
  assert.deepEqual(parsed, evt);
  assert.equal(buildMaintenanceBlock(parsed), block);
});

test('span keeps data-uuid first with window attrs alongside', () => {
  const block = maintenance({ uuid: 'm1', startIso: '2026-08-21T09:00+01:00', endIso: '2026-08-21T11:00+01:00', start: '2026-08-21 09:00', end: '2026-08-21 11:00' });
  assert.ok(block.includes('<span data-uuid="m1" data-mb-start="2026-08-21T09:00+01:00" data-mb-end="2026-08-21T11:00+01:00" style="display:none"></span>'));
});

// ── maintenancePhase ─────────────────────────────────────────────────────────

const WIN = { startIso: '2026-08-21T09:00+01:00', endIso: '2026-08-21T11:00+01:00' };

test('phase: before / during / after the window', () => {
  assert.equal(maintenancePhase(WIN, T('2026-08-20T09:00+01:00')), 'upcoming');
  assert.equal(maintenancePhase(WIN, T('2026-08-21T10:00+01:00')), 'in progress');
  assert.equal(maintenancePhase(WIN, T('2026-08-21T11:00+01:00')), 'completed');
});

test('phase: DST-spanning window compares per-endpoint offsets correctly', () => {
  // UK spring-forward night: starts in GMT (+00:00), ends in BST (+01:00).
  const evt = { startIso: '2026-03-29T00:30+00:00', endIso: '2026-03-29T02:30+01:00' };
  assert.equal(maintenancePhase(evt, T('2026-03-29T00:00Z')), 'upcoming');
  assert.equal(maintenancePhase(evt, T('2026-03-29T01:00Z')), 'in progress');
  assert.equal(maintenancePhase(evt, T('2026-03-29T01:30Z')), 'completed'); // 02:30+01:00 == 01:30Z
});

test('phase: missing window degrades to upcoming', () => {
  assert.equal(maintenancePhase({}, T('2026-08-21T10:00Z')), 'upcoming');
});

test('toIsoWithOffset appends a ±HH:MM offset to the local value', () => {
  const iso = toIsoWithOffset('2026-08-21T09:00');
  assert.match(iso, /^2026-08-21T09:00[+-]\d{2}:\d{2}$/);
  assert.equal(toIsoWithOffset(''), '');
});

// ── insert / update placement ────────────────────────────────────────────────

test('insert: upcoming events land sorted ascending by start', () => {
  const later = maintenance({ uuid: 'm2', start: '2026-09-01 09:00', end: '2026-09-01 10:00', startIso: '2026-09-01T09:00+01:00', endIso: '2026-09-01T10:00+01:00' });
  let md = statusFile({ upcoming: [later] });
  md = insertMaintenanceBlock(md, {
    uuid: 'm1', services: 'Server', description: '',
    start: '2026-08-21 09:00', end: '2026-08-21 11:00',
    startIso: '2026-08-21T09:00+01:00', endIso: '2026-08-21T11:00+01:00',
    currentStatus: 'upcoming',
  });
  const upcoming = parseMaintenanceBlocks(sectionBodies(md).upcoming);
  assert.deepEqual(upcoming.map(e => e.uuid), ['m1', 'm2']);
});

test('insert: in-progress prepends into Active, completed lands indented in Past', () => {
  const base = statusFile({ active: [incident('disruption', 'Files', 'i1')] });
  const inProg = insertMaintenanceBlock(base, {
    uuid: 'm1', services: 'Server', description: '', start: '2026-08-14 09:00', end: '2026-08-14 11:00',
    startIso: '2026-08-14T09:00+01:00', endIso: '2026-08-14T11:00+01:00', currentStatus: 'in progress',
  });
  const activeEvents = parseEventBlocks(sectionBodies(inProg).active);
  assert.deepEqual(activeEvents.map(e => [e.kind, e.uuid]), [['maintenance', 'm1'], ['incident', 'i1']]);

  const done = insertMaintenanceBlock(base, {
    uuid: 'm2', services: 'Server', description: '', start: '2026-08-01 09:00', end: '2026-08-01 11:00',
    startIso: '2026-08-01T09:00+01:00', endIso: '2026-08-01T11:00+01:00', currentStatus: 'completed',
  });
  assert.ok(done.includes('    !!! status-maintenance "<span class="mb-label mb-label-amber">MAINTENANCE</span>"'));
  const past = parseMaintenanceBlocks(sectionBodies(done).past);
  assert.deepEqual(past.map(e => e.uuid), ['m2']);
});

// ── Backfilling past maintenance ─────────────────────────────────────────────

// A window that has already ended, as the Report Maintenance form builds it.
function backfill(uuid, date, services = 'Server') {
  return {
    uuid, services, description: 'Planned work',
    start: `${date} 09:00`, end: `${date} 11:00`,
    startIso: `${date}T09:00+01:00`, endIso: `${date}T11:00+01:00`,
    currentStatus: 'completed',
  };
}

test('backfill: a completed window lands in Past, leaving tiles and the announced window alone', () => {
  const live = maintenance({ uuid: 'm9', services: 'Files', start: '2026-09-01 09:00', end: '2026-09-01 10:00', startIso: '2026-09-01T09:00+01:00', endIso: '2026-09-01T10:00+01:00' });
  const md = recalculateServiceStatuses(
    insertMaintenanceBlock(statusFile({ upcoming: [live] }), backfill('m1', '2026-06-10')));
  assert.deepEqual(parseMaintenanceBlocks(sectionBodies(md).past).map(e => [e.uuid, e.currentStatus]),
    [['m1', 'completed']]);
  assert.ok(md.includes('!!! status-available "Server"'));
  assert.ok(md.includes('!!! status-available "Files"'));
  assert.deepEqual(deriveMaintenanceWindow(md, T('2026-08-14T00:00Z')),
    { startIso: '2026-09-01T09:00+01:00', endIso: '2026-09-01T10:00+01:00', services: 'Files' });
});

test('backfill: Past stays newest-first whatever order events are entered in', () => {
  let md = statusFile();
  ['2026-07-20', '2026-05-05', '2026-06-10'].forEach((date, i) => {
    md = insertMaintenanceBlock(md, backfill(`m${i}`, date));
  });
  assert.deepEqual(parseMaintenanceBlocks(sectionBodies(md).past).map(e => e.start),
    ['2026-07-20 09:00', '2026-06-10 09:00', '2026-05-05 09:00']);
});

test('backfill: interleaves with resolved incidents by finish instant', () => {
  const resolved = buildIncidentBlock({
    uuid: 'i1', impact: 'outage', services: 'Files', currentStatus: 'resolved',
    description: 'Down', causation: '',
    reported: '2026-06-20 09:00', reportedIso: '2026-06-20T09:00+01:00',
    resolved: '2026-06-20 10:00', resolvedIso: '2026-06-20T10:00+01:00',
  });
  let md = statusFile({ past: [resolved] });
  md = insertMaintenanceBlock(md, backfill('m1', '2026-07-01')); // finished after the incident
  md = insertMaintenanceBlock(md, backfill('m2', '2026-05-01')); // finished before it
  assert.deepEqual(parseEventBlocks(sectionBodies(md).past).map(e => e.uuid), ['m1', 'i1', 'm2']);
});

test('backfill: the forward-only sweep leaves a backfilled Past event untouched', () => {
  const md = insertMaintenanceBlock(statusFile(), backfill('m1', '2026-06-10'));
  assert.equal(reconcileStatusEvents(md, T('2026-08-14T00:00Z')), md);
});

test('update: rescheduling a completed event with a future window reopens it', () => {
  const done = maintenance({ uuid: 'm1', start: '2026-08-01 09:00', end: '2026-08-01 11:00', startIso: '2026-08-01T09:00+01:00', endIso: '2026-08-01T11:00+01:00', status: 'completed' });
  const md = statusFile({ past: [done] });
  const out = updateMarkdownMaintenance(md, 'm1', {
    currentStatus: 'upcoming',
    start: '2026-09-01 09:00', end: '2026-09-01 11:00',
    startIso: '2026-09-01T09:00+01:00', endIso: '2026-09-01T11:00+01:00',
  });
  assert.deepEqual(parseMaintenanceBlocks(sectionBodies(out).upcoming).map(e => e.uuid), ['m1']);
  assert.deepEqual(parseMaintenanceBlocks(sectionBodies(out).past), []);
});

// ── reconcileStatusEvents (the sweep) ────────────────────────────────────────

const UP = () => maintenance({ uuid: 'm1', services: 'Server', start: '2026-08-21 09:00', end: '2026-08-21 11:00', startIso: '2026-08-21T09:00+01:00', endIso: '2026-08-21T11:00+01:00' });

test('sweep: upcoming → in progress at start (moves to Active, tile → MAINTENANCE)', () => {
  const out = reconcileStatusEvents(statusFile({ upcoming: [UP()] }), T('2026-08-21T10:00+01:00'));
  const active = parseMaintenanceBlocks(sectionBodies(out).active);
  assert.deepEqual(active.map(e => [e.uuid, e.currentStatus]), [['m1', 'in progress']]);
  assert.deepEqual(parseMaintenanceBlocks(sectionBodies(out).upcoming), []);
  assert.ok(out.includes('!!! status-maintenance "Server"\n\n    <span data-uuid="s1"'));
  assert.ok(out.includes('**Status:** MAINTENANCE'));
});

test('sweep: → completed at end (moves to Past, tile back to AVAILABLE)', () => {
  const out = reconcileStatusEvents(statusFile({ upcoming: [UP()] }), T('2026-08-21T12:00+01:00'));
  const past = parseMaintenanceBlocks(sectionBodies(out).past);
  assert.deepEqual(past.map(e => [e.uuid, e.currentStatus]), [['m1', 'completed']]);
  assert.ok(out.includes('!!! status-available "Server"'));
  assert.ok(!sectionBodies(out).active.includes('status-maintenance'));
});

test('sweep: forward-only — manual completion inside the window sticks', () => {
  const manual = maintenance({ uuid: 'm1', start: '2026-08-21 09:00', end: '2026-08-21 11:00', startIso: '2026-08-21T09:00+01:00', endIso: '2026-08-21T11:00+01:00', status: 'completed' });
  const out = reconcileStatusEvents(statusFile({ active: [manual] }), T('2026-08-21T10:00+01:00'));
  assert.deepEqual(parseMaintenanceBlocks(sectionBodies(out).past).map(e => e.currentStatus), ['completed']);
  assert.deepEqual(parseMaintenanceBlocks(sectionBodies(out).active), []);
});

test('sweep: forward-only — manual early start before the window stays Active', () => {
  const early = maintenance({ uuid: 'm1', start: '2026-08-21 09:00', end: '2026-08-21 11:00', startIso: '2026-08-21T09:00+01:00', endIso: '2026-08-21T11:00+01:00', status: 'in progress' });
  const md = statusFile({ active: [early] });
  const out = reconcileStatusEvents(md, T('2026-08-20T10:00+01:00'));
  assert.deepEqual(parseMaintenanceBlocks(sectionBodies(out).active).map(e => e.currentStatus), ['in progress']);
});

test('sweep: idempotent for a fixed now', () => {
  for (const now of [T('2026-08-20T10:00+01:00'), T('2026-08-21T10:00+01:00'), T('2026-08-21T12:00+01:00')]) {
    const once = reconcileStatusEvents(statusFile({ upcoming: [UP()] }), now);
    assert.equal(reconcileStatusEvents(once, now), once);
  }
});

test('sweep: stamps missing data-mb attrs from the visible schedule lines', () => {
  const bare = maintenance({ uuid: 'm1', start: '2026-08-21 09:00', end: '2026-08-21 11:00' });
  assert.ok(!bare.includes('data-mb-start'));
  const out = reconcileStatusEvents(statusFile({ upcoming: [bare] }), T('2020-01-01T00:00Z'));
  const [evt] = parseMaintenanceBlocks(sectionBodies(out).upcoming);
  assert.match(evt.startIso, /^2026-08-21T09:00[+-]\d{2}:\d{2}$/);
  assert.match(evt.endIso, /^2026-08-21T11:00[+-]\d{2}:\d{2}$/);
});

test('sweep: re-sorts a hand-shuffled Upcoming section', () => {
  const a = maintenance({ uuid: 'm1', start: '2026-09-01 09:00', end: '2026-09-01 10:00', startIso: '2026-09-01T09:00+01:00', endIso: '2026-09-01T10:00+01:00' });
  const b = maintenance({ uuid: 'm2', start: '2026-08-21 09:00', end: '2026-08-21 10:00', startIso: '2026-08-21T09:00+01:00', endIso: '2026-08-21T10:00+01:00' });
  const out = reconcileStatusEvents(statusFile({ upcoming: [a, b] }), T('2020-01-01T00:00Z'));
  assert.deepEqual(parseMaintenanceBlocks(sectionBodies(out).upcoming).map(e => e.uuid), ['m2', 'm1']);
});

test('sweep: migrates old-format headings on the way through', () => {
  const out = reconcileStatusEvents(oldFormatFile(), T('2020-01-01T00:00Z'));
  assert.ok(/^## Active Events$/m.test(out));
  assert.ok(/^## Upcoming Events$/m.test(out));
});

// ── Severity ladder ──────────────────────────────────────────────────────────

test('ladder: incident on the same service outranks in-progress maintenance', () => {
  const maint = maintenance({ uuid: 'm1', services: 'Server', start: '2026-08-14 09:00', end: '2026-08-14 11:00', startIso: '2026-08-14T09:00+01:00', endIso: '2026-08-14T11:00+01:00', status: 'in progress' });
  const out = recalculateServiceStatuses(statusFile({ active: [maint, incident('outage', 'Server', 'i1')] }));
  assert.ok(out.includes('!!! status-outage "Server"'));
  assert.ok(out.includes('!!! status-available "Files"'));
});

test('ladder: in-progress maintenance beats available; upcoming contributes nothing', () => {
  const inProg = maintenance({ uuid: 'm1', services: 'Server', start: '2026-08-14 09:00', end: '2026-08-14 11:00', startIso: '2026-08-14T09:00+01:00', endIso: '2026-08-14T11:00+01:00', status: 'in progress' });
  const up = maintenance({ uuid: 'm2', services: 'Files', start: '2026-09-01 09:00', end: '2026-09-01 10:00', startIso: '2026-09-01T09:00+01:00', endIso: '2026-09-01T10:00+01:00' });
  const out = recalculateServiceStatuses(statusFile({ upcoming: [up], active: [inProg] }));
  assert.ok(out.includes('!!! status-maintenance "Server"'));
  assert.ok(out.includes('**Status:** MAINTENANCE'));
  assert.ok(out.includes('!!! status-available "Files"'));
});

test('ladder: the All Services sentinel raises every tile, for incidents and maintenance', () => {
  const maint = maintenance({ uuid: 'm1', services: ALL_SERVICES, start: '2026-08-14 09:00', end: '2026-08-14 11:00', startIso: '2026-08-14T09:00+01:00', endIso: '2026-08-14T11:00+01:00', status: 'in progress' });
  const out = recalculateServiceStatuses(statusFile({ active: [maint] }));
  assert.ok(out.includes('!!! status-maintenance "Server"'));
  assert.ok(out.includes('!!! status-maintenance "Files"'));

  const inc = recalculateServiceStatuses(statusFile({ active: [incident('outage', ALL_SERVICES, 'i1')] }));
  assert.ok(inc.includes('!!! status-outage "Server"'));
  assert.ok(inc.includes('!!! status-outage "Files"'));

  // A tile added after the card was written is covered too — the point of
  // storing the sentinel rather than an expanded list.
  const extra = statusFile({
    services: [serviceTile('Server', 'available', 's1'), serviceTile('Files', 'available', 's2'), serviceTile('API', 'available', 's3')],
    active: [maint],
  });
  assert.ok(recalculateServiceStatuses(extra).includes('!!! status-maintenance "API"'));
});

test('ladder: the sentinel is matched case-insensitively and survives a round-trip', () => {
  const [parsed] = parseMaintenanceBlocks(maintenance({ uuid: 'm1', services: ALL_SERVICES }));
  assert.equal(parsed.services, ALL_SERVICES);
  const shouty = statusFile({ active: [incident('disruption', 'ALL SERVICES', 'i1')] });
  assert.ok(recalculateServiceStatuses(shouty).includes('!!! status-disruption "Files"'));
});

// ── normalizeServiceSelection ────────────────────────────────────────────────

test('normalize: sentinel wins, every-service collapses, partial is joined', () => {
  const all = ['Web App', 'API', 'Login'];
  assert.equal(normalizeServiceSelection([ALL_SERVICES], all), ALL_SERVICES);
  // The sentinel arrives alongside the forced-on chips it locked.
  assert.equal(normalizeServiceSelection([ALL_SERVICES, ...all], all), ALL_SERVICES);
  assert.equal(normalizeServiceSelection(all, all), ALL_SERVICES);
  assert.equal(normalizeServiceSelection(['Web App', 'Login'], all), 'Web App, Login');
  assert.equal(normalizeServiceSelection([], all), '');
  // Names no longer on the page can't fake a full house.
  assert.equal(normalizeServiceSelection(['Web App', 'Tasks'], all), 'Web App');
});

// ── deriveMaintenanceWindow / deriveBannerStatus ─────────────────────────────

test('derive window: earliest-starting live window wins; completed/passed excluded', () => {
  const soon = maintenance({ uuid: 'm1', services: 'Files', start: '2026-08-21 09:00', end: '2026-08-21 11:00', startIso: '2026-08-21T09:00+01:00', endIso: '2026-08-21T11:00+01:00' });
  const later = maintenance({ uuid: 'm2', services: 'Server', start: '2026-09-01 09:00', end: '2026-09-01 10:00', startIso: '2026-09-01T09:00+01:00', endIso: '2026-09-01T10:00+01:00' });
  const win = deriveMaintenanceWindow(statusFile({ upcoming: [soon, later] }), T('2026-08-14T00:00Z'));
  assert.deepEqual(win, { startIso: '2026-08-21T09:00+01:00', endIso: '2026-08-21T11:00+01:00', services: 'Files' });
});

test('derive window: null when nothing upcoming or in progress', () => {
  assert.equal(deriveMaintenanceWindow(statusFile(), T('2026-08-14T00:00Z')), null);
  const over = maintenance({ uuid: 'm1', start: '2026-08-01 09:00', end: '2026-08-01 11:00', startIso: '2026-08-01T09:00+01:00', endIso: '2026-08-01T11:00+01:00' });
  assert.equal(deriveMaintenanceWindow(statusFile({ upcoming: [over] }), T('2026-08-14T00:00Z')), null);
});

test('derive banner: incidents only — maintenance never raises it', () => {
  const maint = maintenance({ uuid: 'm1', start: '2026-08-14 09:00', end: '2026-08-14 11:00', startIso: '2026-08-14T09:00+01:00', endIso: '2026-08-14T11:00+01:00', status: 'in progress' });
  assert.equal(deriveBannerStatus(statusFile({ active: [maint] })), '');
  assert.equal(deriveBannerStatus(statusFile({ active: [maint, incident('disruption', 'Files', 'i1')] })), 'disruption');
  assert.equal(deriveBannerStatus(oldFormatFile()), 'outage'); // old headings tolerated
});

// ── Incident mutations must not disturb maintenance neighbours ───────────────

test('new incident splices under the heading without dropping maintenance blocks', () => {
  const maint = maintenance({ uuid: 'm1', services: 'Server', start: '2026-08-14 09:00', end: '2026-08-14 11:00', startIso: '2026-08-14T09:00+01:00', endIso: '2026-08-14T11:00+01:00', status: 'in progress' });
  const md = statusFile({ active: [maint] });
  const out = updateMarkdownIncidents(md, {}, {
    services: 'Files', impact: 'outage', description: 'Down', reported: '2026-08-14 09:30',
    currentStatus: 'ongoing', resolved: '', causation: '', uuid: 'i9',
  });
  const events = parseEventBlocks(sectionBodies(out).active);
  assert.deepEqual(events.map(e => [e.kind, e.uuid]), [['incident', 'i9'], ['maintenance', 'm1']]);
});

test('reopening a past incident keeps maintenance blocks in Active intact', () => {
  const maint = maintenance({ uuid: 'm1', services: 'Server', start: '2026-08-14 09:00', end: '2026-08-14 11:00', startIso: '2026-08-14T09:00+01:00', endIso: '2026-08-14T11:00+01:00', status: 'in progress' });
  const md = statusFile({ active: [maint], past: [incident('outage', 'Files', 'i1', 'resolved')] });
  const out = updateMarkdownPastIncident(md, 'i1', { currentStatus: 'ongoing' });
  const events = parseEventBlocks(sectionBodies(out).active);
  assert.deepEqual(events.map(e => [e.kind, e.uuid]), [['incident', 'i1'], ['maintenance', 'm1']]);
});

test('deleting the only live window leaves nothing for the toml keys', () => {
  const md = statusFile({ upcoming: [UP()] });
  const out = deleteMarkdownEvent(md, 'm1');
  assert.equal(deriveMaintenanceWindow(out, T('2026-08-14T00:00Z')), null);
  assert.deepEqual(parseMaintenanceBlocks(out), []);
});

// ── Misc ─────────────────────────────────────────────────────────────────────

test('parseServiceNames sees tiles of every status kind', () => {
  const services = [serviceTile('Server', 'maintenance', 's1'), serviceTile('Files', 'outage', 's2')];
  assert.deepEqual(parseServiceNames(statusFile({ services })), ['Server', 'Files']);
});

test('empty sections parse to [] and accept inserts', () => {
  const md = statusFile();
  assert.deepEqual(parseEventBlocks(sectionBodies(md).upcoming), []);
  assert.deepEqual(parseEventBlocks(sectionBodies(md).active), []);
  const out = insertMaintenanceBlock(md, {
    uuid: 'm1', services: 'Server', description: '', start: '2026-08-21 09:00', end: '2026-08-21 11:00',
    startIso: '2026-08-21T09:00+01:00', endIso: '2026-08-21T11:00+01:00', currentStatus: 'upcoming',
  });
  assert.deepEqual(parseMaintenanceBlocks(sectionBodies(out).upcoming).map(e => e.uuid), ['m1']);
});

// ── Card format: pills, Services Affected, incident round-trip ───────────────

test('incident block round-trips through parse and rebuild', () => {
  const inc = {
    uuid: 'i1', services: 'Server, Files', impact: 'outage',
    description: 'Full system outage', causation: 'Switch swap',
    reported: '2026-06-10 14:19', resolved: '2026-06-10 14:52',
    reportedIso: '2026-06-10T14:19+01:00', resolvedIso: '2026-06-10T14:52+01:00',
    currentStatus: 'resolved',
  };
  const block = buildIncidentBlock(inc);
  const [parsed] = parseIncidentBlocks(block);
  assert.deepEqual(parsed, inc);
  assert.equal(buildIncidentBlock(parsed), block);
});

test('card titles are kind pills; values are label pills', () => {
  const out = incident('outage', 'Server', 'i1');
  assert.ok(out.startsWith('!!! status-outage "<span class="mb-label mb-label-red">OUTAGE</span>"'));
  assert.ok(out.includes('- **Services Affected:** Server'));
  assert.ok(out.includes('- **Current Status:** <span class="mb-label mb-label-amber">:lucide-triangle-alert: Ongoing</span>'));
  assert.ok(out.includes('- **Reported:** <span class="mb-label mb-label-slate">2026-08-13 09:00</span>'));
  assert.ok(incident('disruption', 'Files', 'i2').startsWith('!!! status-disruption "<span class="mb-label mb-label-amber">DISRUPTION</span>"'));
  const maint = maintenance({ uuid: 'm1', start: '2026-08-21 09:00', end: '2026-08-21 11:00' });
  assert.ok(maint.startsWith('!!! status-maintenance "<span class="mb-label mb-label-amber">MAINTENANCE</span>"'));
  assert.ok(maint.includes('- **Scheduled Start:** <span class="mb-label mb-label-slate">2026-08-21 09:00</span>'));
  assert.ok(maint.includes('- **Current Status:** <span class="mb-label mb-label-orange">:lucide-fast-forward: Upcoming</span>'));
});

test('status pills carry a lucide icon per value, and the field order is fixed', () => {
  const icons = {
    'upcoming': ':lucide-fast-forward: Upcoming',
    'in progress': ':lucide-refresh-cw: In progress',
    'completed': ':lucide-check: Completed',
  };
  for (const [status, expected] of Object.entries(icons)) {
    assert.ok(maintenance({ uuid: 'm1', status }).includes(`- **Current Status:** <span class="mb-label mb-label-${
      { 'upcoming': 'orange', 'in progress': 'amber', 'completed': 'green' }[status]}">${expected}</span>`));
  }
  assert.ok(incident('outage', 'Server', 'i1', 'resolved').includes('<span class="mb-label mb-label-green">:lucide-check: Resolved</span>'));

  const fields = maintenance({ uuid: 'm1', start: '2026-08-21 09:00', end: '2026-08-21 11:00' })
    .split('\n').filter(l => l.includes('- **')).map(l => l.match(/- \*\*([^:]+):/)[1]);
  assert.deepEqual(fields, ['Services Affected', 'Current Status', 'Description', 'Scheduled Start', 'Scheduled End']);
});

test('an icon shortcode in the status value parses back to the bare domain value', () => {
  const [maint] = parseMaintenanceBlocks(maintenance({ uuid: 'm1', status: 'in progress' }));
  assert.equal(maint.currentStatus, 'in progress');
  const [inc] = parseIncidentBlocks(incident('outage', 'Server', 'i1', 'resolved'));
  assert.equal(inc.currentStatus, 'resolved');
});

test('extractIncidentField strips label pills and legacy backticks', () => {
  assert.equal(extractIncidentField('- **Current Status:** <span class="mb-label mb-label-green">Resolved</span>', 'Current Status'), 'Resolved');
  assert.equal(extractIncidentField('- **Current Status:** `Resolved`', 'Current Status'), 'Resolved');
  assert.equal(extractIncidentField('- **Reported:** ', 'Reported'), '');
  // Icon shortcodes are stripped at the status read, NOT here — a Description
  // may legitimately contain one.
  assert.equal(extractIncidentField('- **Description:** See :lucide-wrench: below', 'Description'), 'See :lucide-wrench: below');
});

test('incident span keeps data-uuid first with instant attrs alongside; empty values omit both pill and attr', () => {
  const full = buildIncidentBlock({ uuid: 'i1', services: 'Server', impact: 'outage', currentStatus: 'resolved', description: '', causation: '', reported: '2026-06-10 14:19', resolved: '2026-06-10 14:52', reportedIso: '2026-06-10T14:19+01:00', resolvedIso: '2026-06-10T14:52+01:00' });
  assert.ok(full.includes('<span data-uuid="i1" data-mb-reported="2026-06-10T14:19+01:00" data-mb-resolved="2026-06-10T14:52+01:00" style="display:none"></span>'));
  const open = buildIncidentBlock({ uuid: 'i2', services: 'Server', impact: 'outage', currentStatus: 'ongoing', description: '', causation: '', reported: '2026-06-10 14:19', resolved: '', reportedIso: '2026-06-10T14:19+01:00', resolvedIso: '' });
  assert.ok(open.includes('<span data-uuid="i2" data-mb-reported="2026-06-10T14:19+01:00" style="display:none"></span>'));
  assert.ok(open.includes('    - **Resolved:** \n'));
});

test('present-but-empty Services Affected round-trips as empty (never the pill title)', () => {
  const block = buildIncidentBlock({ uuid: 'i1', services: '', impact: 'outage', currentStatus: 'ongoing', description: '', causation: '', reported: '', resolved: '' });
  const [parsed] = parseIncidentBlocks(block);
  assert.equal(parsed.services, '');
  assert.equal(buildIncidentBlock(parsed), block);
});

test('legacy parse tolerance: services fall back to the title, backticked status reads', () => {
  const [inc] = parseIncidentBlocks(legacyIncident('outage', 'Server, Files', 'i1', 'Resolved'));
  assert.equal(inc.services, 'Server, Files');
  assert.equal(inc.currentStatus, 'resolved');
  assert.equal(inc.reportedIso, '');
});

// ── migrateStatusCardFormat ──────────────────────────────────────────────────

test('card migration: legacy cards rewritten, fields preserved, Service Impact dropped, ISO stamped', () => {
  const md = migrateStatusSections(oldFormatFile());
  const out = migrateStatusCardFormat(md);
  assert.ok(!out.includes('Service Impact'));
  assert.ok(out.includes('!!! status-outage "<span class="mb-label mb-label-red">OUTAGE</span>"'));
  assert.ok(out.includes('- **Services Affected:** Server'));
  const active = parseIncidentBlocks(sectionBodies(out).active);
  assert.deepEqual(active.map(i => [i.uuid, i.services, i.currentStatus, i.description]),
    [['i1', 'Server', 'ongoing', 'Something happened']]);
  assert.match(active[0].reportedIso, /^2026-08-13T09:00[+-]\d{2}:\d{2}$/);
  assert.equal(active[0].resolvedIso, ''); // empty Resolved gets no attr
  // Past block stays indented inside the collapsible
  assert.ok(out.includes('    !!! status-outage "<span class="mb-label mb-label-red">OUTAGE</span>"'));
});

test('card migration: idempotent, and identity on already-migrated files', () => {
  const once = migrateStatusCardFormat(migrateStatusSections(oldFormatFile()));
  assert.equal(migrateStatusCardFormat(once), once);
  const fresh = statusFile({ upcoming: [UP()], active: [incident('outage', 'Server', 'i1')] });
  assert.equal(migrateStatusCardFormat(fresh), fresh);
});

test('card migration: service tiles are never rewritten, even with incident-shaped types', () => {
  const tiles = [serviceTile('Server', 'outage', 's1'), serviceTile('Files', 'maintenance', 's2')];
  const md = statusFile({ services: tiles });
  assert.equal(migrateStatusCardFormat(md), md);
});

test('card migration: legacy maintenance card gains Services Affected + pill values', () => {
  const legacyMaint = [
    '!!! status-maintenance "Server, Files"',
    '',
    '    <span data-uuid="m1" data-mb-start="2026-08-21T09:00+01:00" data-mb-end="2026-08-21T11:00+01:00" style="display:none"></span>',
    '',
    '    - **Scheduled Start:** 2026-08-21 09:00',
    '    - **Scheduled End:** 2026-08-21 11:00',
    '    - **Current Status:** `Upcoming`',
    '    - **Description:** Planned work',
  ].join('\n');
  const out = migrateStatusCardFormat(statusFile({ upcoming: [legacyMaint] }));
  const [evt] = parseMaintenanceBlocks(sectionBodies(out).upcoming);
  assert.deepEqual(evt, {
    uuid: 'm1', services: 'Server, Files', description: 'Planned work',
    start: '2026-08-21 09:00', end: '2026-08-21 11:00',
    startIso: '2026-08-21T09:00+01:00', endIso: '2026-08-21T11:00+01:00',
    currentStatus: 'upcoming',
  });
  assert.ok(out.includes('!!! status-maintenance "<span class="mb-label mb-label-amber">MAINTENANCE</span>"'));
  assert.ok(out.includes('- **Services Affected:** Server, Files'));
});

test('recalc reads Services Affected from new-format cards (tiles flip)', () => {
  const out = recalculateServiceStatuses(statusFile({ active: [incident('disruption', 'Server, Files', 'i1')] }));
  assert.ok(out.includes('!!! status-disruption "Server"'));
  assert.ok(out.includes('!!! status-disruption "Files"'));
});

console.log(`\n${passed} passed`);
