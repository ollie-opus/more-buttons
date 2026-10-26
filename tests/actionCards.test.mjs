import assert from 'node:assert/strict';
import { relativeTime, actionCardHtml, actionsListHtml, stepCardHtml, timelineHtml, STEP_INSERT_ATTR } from '../scripts/actionCards.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const MIN = 60_000, HR = 60 * MIN, DAY = 24 * HR;
const now = 10 * DAY;
const action = (over = {}) => ({ id: 'a1', name: 'Archive <b>employee</b>', createdAt: now - DAY, updatedAt: now - 3 * MIN, steps: [{}, {}, {}], ...over });

test('relativeTime buckets: just now, minutes, hours, yesterday, days', () => {
  assert.equal(relativeTime(now - 20_000, now), 'just now');
  assert.equal(relativeTime(now - 3 * MIN, now), '3 min ago');
  assert.equal(relativeTime(now - 2 * HR, now), '2 hr ago');
  assert.equal(relativeTime(now - 30 * HR, now), 'yesterday');
  assert.equal(relativeTime(now - 5 * DAY, now), '5 days ago');
  assert.equal(relativeTime(0, now), '10 days ago');
  assert.equal(relativeTime(undefined, now), '');
});

test('actionCardHtml: active card is green with a pressed Active toggle; name is escaped', () => {
  const html = actionCardHtml(action(), { active: true, now });
  assert.ok(html.includes('class="mb-incident-card --green mb-action-card"'), html);
  assert.ok(html.includes('data-action-id="a1"'));
  assert.ok(html.includes('Archive &lt;b&gt;employee&lt;/b&gt;'));
  assert.ok(!html.includes('<b>'));
  assert.ok(html.includes('<span class="mb-incident-card__badge">Active</span>'));
  assert.ok(html.includes('3 steps · updated 3 min ago'));
  assert.ok(html.includes('data-action-active="a1" aria-pressed="true"'));
  assert.ok(html.includes('>Active</button>'));
  assert.ok(html.includes('data-action-edit="a1"'));
  assert.ok(html.includes('data-action-delete="a1"'));
});

test('actionCardHtml: inactive card is grey with a "Set active" toggle and singular step count', () => {
  const html = actionCardHtml(action({ steps: [{}] }), { active: false, now });
  assert.ok(html.includes('class="mb-incident-card --grey mb-action-card"'));
  assert.ok(html.includes('<span class="mb-incident-card__badge">Inactive</span>'));
  assert.ok(html.includes('1 step · updated'));
  assert.ok(html.includes('data-action-active="a1" aria-pressed="false"'));
  assert.ok(html.includes('>Set active</button>'));
});

test('actionsListHtml renders every action with the active one marked, or the empty state', () => {
  const lib = { activeId: 'b', actions: [action({ id: 'a' }), action({ id: 'b', name: 'Two' })] };
  const html = actionsListHtml(lib, { now });
  assert.equal((html.match(/mb-action-card/g) || []).length, 2);
  assert.ok(html.includes('data-action-active="b" aria-pressed="true"'));
  assert.ok(html.includes('data-action-active="a" aria-pressed="false"'));
  const empty = actionsListHtml({ activeId: null, actions: [] }, { now });
  assert.ok(empty.includes('class="mb-adm-empty mb-action-empty"'));
  assert.ok(empty.includes('data-action="startActionRecording"'));
  assert.ok(empty.includes('<span class="mb-adm-empty__icon more-buttons-icon">disc</span>'));
});


const mk = (kind, id, over = {}) => ({ id, kind, locator: { key: '#' + id, candidates: [] }, describe: { label: 'Site <name>', tag: 'input', type: 'text' }, value: null, askAtPlay: false, ...over });

test('stepCardHtml: kind icon + escaped title, kind badge, value chip, meta, ask-at-play only on set steps', () => {
  const html = stepCardHtml(mk('set', 's1', { value: 'Acme <Ltd>' }), 2);
  assert.ok(html.includes('class="mb-incident-card --teal mb-action-step"'));
  assert.ok(html.includes('<span class="more-buttons-icon">text-cursor-input</span>'));
  assert.ok(html.includes('Set “Site &lt;name&gt;”'));
  assert.ok(html.includes('<span class="mb-incident-card__badge">Set value</span>'));
  assert.ok(html.includes('<code class="mb-action-step__value">Acme &lt;Ltd&gt;</code>'));
  assert.ok(html.includes('Step 3 · input[text]'));
  assert.ok(html.includes('data-step-ask="2" aria-pressed="false"'));
  assert.ok(html.includes('data-step-delete="2"'));
  const masked = stepCardHtml(mk('set', 's2', { askAtPlay: true }), 0);
  assert.ok(masked.includes('class="mb-action-step__value --masked">••••</code>'));
  assert.ok(masked.includes('aria-pressed="true"'));
  const click = stepCardHtml(mk('click', 's3', { describe: { label: 'Save', tag: 'button', type: null } }), 0);
  assert.ok(!click.includes('data-step-ask'), 'no ask toggle on clicks');
  assert.ok(!click.includes('mb-action-step__value'), 'no value chip on clicks');
  assert.ok(click.includes('Step 1 · button'));
  const nav = stepCardHtml({ id: 'n', kind: 'navigate', locator: null, describe: {}, value: '/admin/sites', askAtPlay: false }, 1);
  assert.ok(nav.includes('--grey') && nav.includes('>Page change<') && nav.includes('/admin/sites') && !nav.includes('data-step-ask'));
});

test('timelineHtml: insert bar before every step and after the last, rows carry index + kind accent', () => {
  const steps = [mk('click', 'a', { describe: { label: 'Go', tag: 'button', type: null } }), mk('set', 'b', { value: 'x' })];
  const html = timelineHtml(steps);
  assert.equal((html.match(new RegExp(`${STEP_INSERT_ATTR}="\\d+"`, 'g')) || []).length, 3);
  assert.ok(html.includes(`${STEP_INSERT_ATTR}="0"`) && html.includes(`${STEP_INSERT_ATTR}="2"`));
  assert.ok(html.includes('>+ Record steps here<'));
  assert.ok(html.includes('data-step-index="0" style="--mb-step-accent: var(--mb-col-blue)"'));
  assert.ok(html.includes('data-step-index="1" style="--mb-step-accent: var(--mb-col-teal)"'));
  assert.ok(html.includes('data-move-step="up" disabled') && html.includes('data-move-step="down" disabled'));
  const empty = timelineHtml([]);
  assert.equal((empty.match(new RegExp(STEP_INSERT_ATTR, 'g')) || []).length, 1);
  assert.ok(empty.includes('mb-action-timeline__empty'));
});

console.log(`\n${passed} passed`);
