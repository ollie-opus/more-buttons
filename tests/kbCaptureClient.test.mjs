import assert from 'node:assert/strict';
import { nextStrikes } from '../scripts/kbCaptureClient.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

test('a sure "alive" clears the doubt; "gone" counts double; silence counts once', () => {
  assert.equal(nextStrikes(3, { alive: true }), 0);
  assert.equal(nextStrikes(1, { alive: true, unsure: true }), 2);
  assert.equal(nextStrikes(1, { alive: false }), 3);
  assert.equal(nextStrikes(0, null), 1);
});

console.log(`kbCaptureClient: ${passed} passed`);
