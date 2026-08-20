import assert from 'node:assert/strict';
import { parseStatusBanner, writeStatusBanner, parseExtraScalar, writeMaintenanceKeys } from '../scripts/navToml.js';
import { deriveBannerStatus } from '../scripts/statusEvents.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// ── deriveBannerStatus: status markdown → banner value ───────────────────────

function incident(impact, title, status = 'Ongoing') {
  return [
    `!!! status-${impact} "${title}"`,
    '',
    '    <span data-uuid="00000000-0000-0000-0000-000000000000" style="display:none"></span>',
    '',
    `    - **Service Impact:** ${impact.toUpperCase()}`,
    `    - **Current Status:** \`${status}\``,
    '    - **Description:** Something happened',
    '    - **Reported:** 2026-08-13 09:00',
    '    - **Resolved:** ',
    '    - **Causation:** ',
  ].join('\n');
}

function statusFile(openBlocks, pastBlocks = []) {
  const indent = b => b.split('\n').map(l => l.length ? '    ' + l : l).join('\n');
  return [
    '# System Status',
    '',
    '## Services',
    '',
    incident('available', 'Server', 'Available'),
    '',
    '---',
    '',
    '## Active Events',
    '',
    ...openBlocks.flatMap(b => [b, '']),
    '---',
    '',
    '## Upcoming Events',
    '',
    '---',
    '',
    '## Past Events',
    '',
    '??? outline "View past events"',
    '',
    ...pastBlocks.flatMap(b => [indent(b), '']),
  ].join('\n');
}

test('derive: no open incidents → empty', () => {
  assert.equal(deriveBannerStatus(statusFile([])), '');
});

test('derive: open disruption → disruption', () => {
  assert.equal(deriveBannerStatus(statusFile([incident('disruption', 'Files')])), 'disruption');
});

test('derive: open outage → outage', () => {
  assert.equal(deriveBannerStatus(statusFile([incident('outage', 'Server')])), 'outage');
});

test('derive: outage overrides disruption', () => {
  const md = statusFile([incident('disruption', 'Files'), incident('outage', 'Server')]);
  assert.equal(deriveBannerStatus(md), 'outage');
});

test('derive: resolved past incidents never count', () => {
  const md = statusFile([], [incident('outage', 'Server', 'Resolved')]);
  assert.equal(deriveBannerStatus(md), '');
});

// ── parseStatusBanner / writeStatusBanner: zensical.toml scalar ──────────────

const TOML_WITH_KEY = [
  '[project]',
  'site_name = "Opus Knowledge Base"',
  '',
  '[project.extra.nav_labels]',
  '"RAMS" = { text = "Add-on", color = "violet" }',
  '',
  '[project.extra]',
  'mb_status_banner = ""',
  'mb_created_tags = [',
  '  "System",',
  ']',
  '',
].join('\n');

const TOML_WITHOUT_KEY = TOML_WITH_KEY.replace('mb_status_banner = ""\n', '');

test('parse: reads the current value', () => {
  assert.equal(parseStatusBanner(TOML_WITH_KEY), '');
  assert.equal(parseStatusBanner(TOML_WITH_KEY.replace('= ""', '= "outage"')), 'outage');
});

test('parse: absent key → empty string', () => {
  assert.equal(parseStatusBanner(TOML_WITHOUT_KEY), '');
});

test('write: replaces the existing line in place', () => {
  const out = writeStatusBanner(TOML_WITH_KEY, 'disruption');
  assert.ok(out.includes('mb_status_banner = "disruption"'));
  assert.equal(out.match(/mb_status_banner/g).length, 1);
  assert.equal(parseStatusBanner(out), 'disruption');
});

test('write: unchanged value returns the identical string (push layer no-op)', () => {
  const withOutage = writeStatusBanner(TOML_WITH_KEY, 'outage');
  assert.equal(writeStatusBanner(withOutage, 'outage'), withOutage);
  assert.equal(writeStatusBanner(TOML_WITHOUT_KEY, ''), TOML_WITHOUT_KEY);
});

test('write: missing key inserts after [project.extra], no duplicate header', () => {
  const out = writeStatusBanner(TOML_WITHOUT_KEY, 'outage');
  assert.equal(out.match(/^\[project\.extra\]$/gm).length, 1);
  const lines = out.split('\n');
  const headerIdx = lines.indexOf('[project.extra]');
  assert.equal(lines[headerIdx + 1], 'mb_status_banner = "outage"');
  assert.equal(parseStatusBanner(out), 'outage');
});

test('write: [project.extra.*] sub-table header is not mistaken for the table', () => {
  const noExtraTable = TOML_WITHOUT_KEY.replace('[project.extra]\n', '');
  const out = writeStatusBanner(noExtraTable, 'disruption');
  const lines = out.split('\n');
  assert.notEqual(lines[lines.indexOf('[project.extra.nav_labels]') + 1], 'mb_status_banner = "disruption"');
  assert.equal(lines[lines.indexOf('[project.extra]') + 1], 'mb_status_banner = "disruption"');
});

test('write: no [project.extra] anywhere → appends a fresh block at EOF', () => {
  const bare = '[project]\nsite_name = "X"\n';
  const out = writeStatusBanner(bare, 'outage');
  assert.ok(out.endsWith('[project.extra]\nmb_status_banner = "outage"\n'));
  assert.equal(parseStatusBanner(out), 'outage');
});

test('write: round-trips through parse for every value', () => {
  for (const v of ['', 'disruption', 'outage']) {
    assert.equal(parseStatusBanner(writeStatusBanner(TOML_WITH_KEY, v)), v);
  }
});

// ── writeMaintenanceKeys: the next-window scalars ────────────────────────────

const WIN = { startIso: '2026-08-21T09:00+01:00', endIso: '2026-08-21T11:00+01:00', services: 'Server, Files' };

test('maintenance: writes all three keys under [project.extra], no duplicate header', () => {
  const out = writeMaintenanceKeys(TOML_WITH_KEY, WIN);
  assert.equal(out.match(/^\[project\.extra\]$/gm).length, 1);
  assert.equal(parseExtraScalar(out, 'mb_maintenance_start'), WIN.startIso);
  assert.equal(parseExtraScalar(out, 'mb_maintenance_end'), WIN.endIso);
  assert.equal(parseExtraScalar(out, 'mb_maintenance_services'), WIN.services);
});

test('maintenance: null window clears all three keys', () => {
  const withWin = writeMaintenanceKeys(TOML_WITH_KEY, WIN);
  const cleared = writeMaintenanceKeys(withWin, null);
  assert.equal(parseExtraScalar(cleared, 'mb_maintenance_start'), '');
  assert.equal(parseExtraScalar(cleared, 'mb_maintenance_end'), '');
  assert.equal(parseExtraScalar(cleared, 'mb_maintenance_services'), '');
});

test('maintenance: unchanged window returns the identical string (push layer no-op)', () => {
  const withWin = writeMaintenanceKeys(TOML_WITH_KEY, WIN);
  assert.equal(writeMaintenanceKeys(withWin, WIN), withWin);
  assert.equal(writeMaintenanceKeys(TOML_WITHOUT_KEY, null), TOML_WITHOUT_KEY);
});

test('maintenance: replaces existing key lines in place on later windows', () => {
  const withWin = writeMaintenanceKeys(TOML_WITH_KEY, WIN);
  const later = { startIso: '2026-09-01T09:00+01:00', endIso: '2026-09-01T10:00+01:00', services: 'Tasks' };
  const out = writeMaintenanceKeys(withWin, later);
  assert.equal(out.match(/mb_maintenance_start/g).length, 1);
  assert.equal(parseExtraScalar(out, 'mb_maintenance_start'), later.startIso);
  assert.equal(parseExtraScalar(out, 'mb_maintenance_services'), 'Tasks');
});

test('combined banner + maintenance write keeps a single [project.extra] table', () => {
  const out = writeMaintenanceKeys(writeStatusBanner(TOML_WITHOUT_KEY, 'outage'), WIN);
  assert.equal(out.match(/^\[project\.extra\]$/gm).length, 1);
  assert.equal(parseStatusBanner(out), 'outage');
  assert.equal(parseExtraScalar(out, 'mb_maintenance_services'), WIN.services);
});

console.log(`\n${passed} passed`);
