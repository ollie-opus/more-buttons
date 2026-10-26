import assert from 'node:assert/strict';
import { relativeTime, actionCardHtml, actionsListHtml } from '../scripts/actionCards.js';

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

console.log(`\n${passed} passed`);
