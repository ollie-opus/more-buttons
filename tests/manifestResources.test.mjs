import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}/manifest.json`, 'utf8'));
const resources = new Set(manifest.web_accessible_resources.flatMap(r => r.resources));

// Every module under scripts/ reached from the content script is loaded by
// dynamic import, so it must be web-accessible or Chrome fails with "Failed to
// fetch dynamically imported module". Exceptions: content.js itself, and the
// modules the service worker (background.js) imports statically.
const swOnly = new Set([...readFileSync(`${root}/background.js`, 'utf8').matchAll(/from '\.\/(scripts\/[^']+)'/g)].map(m => m[1]));
test('every content-side scripts/*.js module is listed in web_accessible_resources', () => {
  assert.ok(swOnly.size >= 1, 'background.js imports detected');
  const missing = readdirSync(`${root}/scripts`)
    .filter(f => f.endsWith('.js') && f !== 'content.js')
    .map(f => `scripts/${f}`)
    .filter(p => !resources.has(p) && !swOnly.has(p));
  assert.deepEqual(missing, []);
});

console.log(`\n${passed} passed`);
