import assert from 'node:assert/strict';
import { createFormLoading, loadingMarkup } from '../scripts/loading.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// Minimal stand-ins for the browser deps: a document that can create/append/
// remove elements and answer the one querySelectorAll the module issues, and
// hand-fired cancellable timers. No jsdom — house plain-node test style.
function makeEl(tag) {
  return {
    tag, className: '', innerHTML: '', children: [], parent: null,
    appendChild(child) { this.children.push(child); child.parent = this; },
    remove() {
      if (!this.parent) return;
      const i = this.parent.children.indexOf(this);
      if (i >= 0) this.parent.children.splice(i, 1);
      this.parent = null;
    },
  };
}

const TILE_SELECTOR = '.more-buttons-overlay-content:not(.more-buttons-loading-tile)';

function fakeDoc({ openTiles = [] } = {}) {
  return {
    body: makeEl('body'),
    openTiles, // elements returned for the open-form-tile query
    createElement: (tag) => makeEl(tag),
    querySelectorAll(selector) {
      assert.equal(selector, TILE_SELECTOR); // module must use exactly this query
      return this.openTiles;
    },
  };
}

function fakeTimers() {
  let nextId = 1;
  const pending = new Map();
  return {
    schedule: (fn, ms) => { const id = nextId++; pending.set(id, fn); return id; },
    cancel: (id) => { pending.delete(id); },
    fire() { const fns = [...pending.values()]; pending.clear(); fns.forEach(fn => fn()); },
    count: () => pending.size,
  };
}

function setup(docOpts) {
  const doc = fakeDoc(docOpts);
  const timers = fakeTimers();
  const loading = createFormLoading({ doc, schedule: timers.schedule, cancel: timers.cancel });
  return { doc, timers, loading };
}

test('show: nothing rendered before the grace timer fires', () => {
  const { doc, timers, loading } = setup();
  loading.show();
  assert.equal(doc.body.children.length, 0);
  assert.equal(timers.count(), 1);
});

test('veil: with a form tile open, grace fire appends a veil INSIDE the last tile', () => {
  const tileA = makeEl('div');
  const tileB = makeEl('div');
  const { doc, timers, loading } = setup({ openTiles: [tileA, tileB] });
  loading.show();
  timers.fire();
  assert.equal(doc.body.children.length, 0);       // nothing appended to body
  assert.equal(tileA.children.length, 0);
  assert.equal(tileB.children.length, 1);          // last tile hosts the veil
  const veil = tileB.children[0];
  assert.equal(veil.className, 'more-buttons-loading-veil');
  assert.match(veil.innerHTML, /more-buttons-icon--spin/);
  assert.match(veil.innerHTML, /Loading…/);
});

test('fallback: with no form tile open, grace fire appends a standalone tile to body', () => {
  const { doc, timers, loading } = setup({ openTiles: [] });
  loading.show();
  timers.fire();
  assert.equal(doc.body.children.length, 1);
  const overlay = doc.body.children[0];
  assert.equal(overlay.className, 'more-buttons-overlay');
  const content = overlay.children[0];
  assert.equal(content.className, 'more-buttons-overlay-content more-buttons-loading-tile');
  assert.match(content.innerHTML, /more-buttons-icon--spin/);
  assert.match(content.innerHTML, /Loading…/);
});

test('dismiss before grace fires: timer cancelled, nothing ever rendered', () => {
  const tile = makeEl('div');
  const { doc, timers, loading } = setup({ openTiles: [tile] });
  loading.show();
  loading.dismiss();
  assert.equal(timers.count(), 0);
  timers.fire();
  assert.equal(tile.children.length, 0);
  assert.equal(doc.body.children.length, 0);
});

test('dismiss removes a visible veil', () => {
  const tile = makeEl('div');
  const { timers, loading } = setup({ openTiles: [tile] });
  loading.show();
  timers.fire();
  loading.dismiss();
  assert.equal(tile.children.length, 0);
});

test('dismiss removes a visible fallback tile', () => {
  const { doc, timers, loading } = setup({ openTiles: [] });
  loading.show();
  timers.fire();
  loading.dismiss();
  assert.equal(doc.body.children.length, 0);
});

test('dismiss is safe when the veil host was already torn down', () => {
  const tile = makeEl('div');
  const { timers, loading } = setup({ openTiles: [tile] });
  loading.show();
  timers.fire();
  tile.children.length = 0;          // host tile destroyed externally (createForm
                                     // teardown); the veil's parent ref goes stale
  loading.dismiss();                 // must not throw
  loading.show();                    // and must be re-armable
  assert.equal(timers.count(), 1);
});

test('show is a singleton: double show arms one timer, no re-arm while visible', () => {
  const tile = makeEl('div');
  const { timers, loading } = setup({ openTiles: [tile] });
  loading.show();
  loading.show();
  assert.equal(timers.count(), 1);
  timers.fire();
  loading.show();
  assert.equal(timers.count(), 0);
  assert.equal(tile.children.length, 1);
});

test('dismiss with nothing pending is a safe no-op', () => {
  const { loading } = setup();
  loading.dismiss();
});

test('show works again after a full cycle, re-querying the CURRENT tile', () => {
  const tileA = makeEl('div');
  const { doc, timers, loading } = setup({ openTiles: [tileA] });
  loading.show(); timers.fire(); loading.dismiss();
  const tileB = makeEl('div');
  doc.openTiles = [tileB];           // navigation replaced the open form
  loading.show(); timers.fire();
  assert.equal(tileA.children.length, 0);
  assert.equal(tileB.children.length, 1);
});

test('loadingMarkup: default label, spinner, description classes', () => {
  const html = loadingMarkup();
  assert.match(html, /more-buttons-loading-inline/);
  assert.match(html, /more-buttons-icon--spin/);
  assert.match(html, /progress_activity/);
  assert.match(html, /Loading…/);
});

test('loadingMarkup: custom label', () => {
  assert.match(loadingMarkup('Loading drafts…'), /Loading drafts…/);
});

console.log(`\n${passed} passed`);
