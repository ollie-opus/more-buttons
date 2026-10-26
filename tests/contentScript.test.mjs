import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const src = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const content = src('../scripts/content.js');
const captureMode = src('../scripts/captureMode.js');
const manifest = JSON.parse(src('../manifest.json'));

test('content.js capture-session gate uses the same sessionStorage key as captureMode.js', () => {
  const inContent = content.match(/CAPTURE_SESSION_KEY = '([^']+)'/)?.[1];
  const inCaptureMode = captureMode.match(/SESSION_KEY = '([^']+)'/)?.[1];
  assert.ok(inContent && inCaptureMode);
  assert.equal(inContent, inCaptureMode);
});

test('content.js Actions session gate uses the recorder module\'s sessionStorage key', () => {
  const keys = content.match(/ACTION_SESSION_KEYS = \[([^\]]+)\]/)?.[1].match(/'([^']+)'/g).map(k => k.slice(1, -1));
  const recorder = src('../scripts/actionRecorder.js').match(/RECORDING_KEY = '([^']+)'/)?.[1];
  assert.ok(keys?.length >= 1 && recorder);
  assert.ok(keys.includes(recorder), 'recorder key gated');
  const player = src('../scripts/actionPlayer.js').match(/PLAYBACK_KEY = '([^']+)'/)?.[1];
  assert.ok(player && keys.includes(player), 'player key gated');
});

test('content.js dispatch forwards dock modifiers only when one is held (existing actions never see an extra arg)', () => {
  assert.match(content, /function dispatch\(action, mods\)/);
  assert.match(content, /mods\.ctrlKey \|\| mods\.metaKey \|\| mods\.shiftKey \|\| mods\.altKey/);
  assert.match(content, /fn\(\.\.\.params, \.\.\.extra\)/);
});

test('content.js no longer polls for url changes', () => {
  assert.ok(!/setInterval\(/.test(content), 'setInterval found in content.js');
  assert.ok(!/waitForDomToSettle/.test(content));
});

test('every module content.js imports dynamically is web-accessible', () => {
  const resources = new Set(manifest.web_accessible_resources.flatMap(r => r.resources));
  const imported = [...content.matchAll(/getURL\('(scripts\/[^']+)'\)/g)].map(m => m[1]);
  assert.ok(imported.includes('scripts/pageNavigation.js'));
  for (const path of imported) assert.ok(resources.has(path), `${path} missing from manifest`);
});

console.log(`\n${passed} passed`);
