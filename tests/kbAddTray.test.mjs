import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addTrayItems, updateTypeOf, landsInUpdate, DRAG_ONLY_HINT } from '../scripts/kbAddTray.js';
import { UPDATE_TYPES } from '../scripts/kbUpdates.js';
import { newComponent } from '../scripts/kbPageOps.js';
import { TEXT_KIND } from '../scripts/kbPageRender.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const ids = items => items.map(i => i.id);
const COMPONENTS = ['text', 'admonition', 'capture', 'tabs', 'table', 'image', 'video', 'button', 'navlinks', 'diagram', 'codeblock', 'paste'];

test('a guide: a section and every component, each clicked or dragged', () => {
  const items = addTrayItems();
  assert.deepEqual(ids(items), ['section', ...COMPONENTS]);
  assert.ok(items.every(i => i.click && i.drag && !i.named));
  assert.ok(items.every(i => i.label && /^[a-z0-9-]+$/.test(i.icon)));
  assert.equal(new Set(items.map(i => i.icon)).size, items.length, 'no two share an icon');
});

test('a guide: a page title only while the page may be given one, after Text', () => {
  const items = addTrayItems({ pageTitle: true });
  assert.deepEqual(ids(items).slice(0, 3), ['section', 'text', 'pagetitle']);
  assert.equal(ids(addTrayItems({ pageTitle: false })).includes('pagetitle'), false);
});

test('a guide with no section to add to offers only a section, to click', () => {
  assert.deepEqual(addTrayItems({ sections: false }), [{ id: 'section', label: 'Section', icon: 'heading-2', click: true, drag: false }]);
});

test('no Grid: rows come of dropping one thing beside another', () => {
  assert.equal(ids(addTrayItems()).includes('grid'), false);
  assert.equal(ids(addTrayItems({ updates: true })).includes('grid'), false);
});

test('System Updates: the three types are clicked, the components only dragged', () => {
  const items = addTrayItems({ updates: true, pageTitle: true });
  const types = items.filter(i => updateTypeOf(i.id));
  assert.deepEqual(types.map(i => [updateTypeOf(i.id), i.label]), UPDATE_TYPES);
  assert.ok(types.every(i => i.click && !i.drag && i.named));
  const rest = items.filter(i => !updateTypeOf(i.id));
  assert.deepEqual(ids(rest), COMPONENTS, 'no section and no page title there');
  assert.ok(rest.every(i => !i.click && i.drag && !i.named));
  assert.deepEqual(ids(items).slice(0, 3), types.map(i => i.id), 'the types come first');
  assert.ok(DRAG_ONLY_HINT.includes('update'));
});

test('an update type reads back from its id; a component is not one', () => {
  assert.equal(updateTypeOf('update:feature-release'), 'feature-release');
  assert.equal(updateTypeOf('text'), null);
  assert.equal(updateTypeOf(undefined), null);
});

test('every component offered is one the editor can make or ask for', () => {
  const asked = new Set(['text', 'pagetitle', 'capture', 'image', 'video', 'paste']); // typed, picked from the library, pasted
  for (const id of COMPONENTS) assert.ok(asked.has(id) || newComponent(id), id);
});

test('every icon is a bundled lucide name', () => {
  const names = new Set(JSON.parse(readFileSync(new URL('../config/lucideIcons.json', import.meta.url), 'utf8')));
  for (const item of [...addTrayItems({ pageTitle: true }), ...addTrayItems({ updates: true })]) assert.ok(names.has(item.icon), item.icon);
});

test('System Updates: a drop lands only inside an update', () => {
  const inside = new Set(['u1', 'adm-in-u1', 'tab-in-u1', 'block-in-u1', 'cell-in-u1']);
  const inUpdate = uuid => inside.has(uuid);
  const lands = t => landsInUpdate(t, TEXT_KIND.section, inUpdate);
  assert.equal(lands(null), false);
  // Between the blocks of the update itself, or of an admonition or a tab in it.
  assert.equal(lands({ container: { kind: TEXT_KIND.admonition, uuid: 'u1' }, at: 0 }), true);
  assert.equal(lands({ container: { kind: TEXT_KIND.admonition, uuid: 'adm-in-u1' }, at: 2 }), true);
  assert.equal(lands({ container: { kind: TEXT_KIND.tab, uuid: 'tab-in-u1' }, at: 0 }), true);
  // Beside a block or a column that is in one.
  assert.equal(lands({ beside: { block: 'block-in-u1' }, side: 'left' }), true);
  assert.equal(lands({ beside: { cell: 'cell-in-u1' }, side: 'right' }), true);
  // Never on the page's own ground, beside something that is in no update, or in one being published.
  assert.equal(lands({ container: { kind: TEXT_KIND.section, uuid: 'u1' }, at: 0 }), false);
  assert.equal(lands({ container: { kind: TEXT_KIND.admonition, uuid: 'elsewhere' }, at: 0 }), false);
  assert.equal(lands({ beside: { block: 'elsewhere' }, side: 'left' }), false);
  assert.equal(lands({ container: {}, at: 0 }), false);
});

console.log(`\nkbAddTray: ${passed} passed`);
