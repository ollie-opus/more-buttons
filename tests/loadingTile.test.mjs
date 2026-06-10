import assert from 'node:assert/strict';
import { createLoadingTile } from '../scripts/loadingTile.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// Minimal stand-ins for the two browser deps the module touches: a document
// that can create/append/remove elements, and cancellable timers we fire by
// hand. No jsdom — same plain-node style as the other test files.
function fakeDoc() {
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
  return { body: makeEl('body'), createElement: (tag) => makeEl(tag) };
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

function setup() {
  const doc = fakeDoc();
  const timers = fakeTimers();
  const tile = createLoadingTile({ doc, schedule: timers.schedule, cancel: timers.cancel });
  return { doc, timers, tile };
}

test('show: nothing appended before the grace timer fires', () => {
  const { doc, timers, tile } = setup();
  tile.show();
  assert.equal(doc.body.children.length, 0);
  assert.equal(timers.count(), 1);
});

test('show: tile appended after grace fires, with overlay + tile classes', () => {
  const { doc, timers, tile } = setup();
  tile.show();
  timers.fire();
  assert.equal(doc.body.children.length, 1);
  const overlay = doc.body.children[0];
  assert.equal(overlay.className, 'more-buttons-overlay');
  assert.equal(overlay.children.length, 1);
  const content = overlay.children[0];
  assert.equal(content.className, 'more-buttons-overlay-content more-buttons-loading-tile');
  assert.match(content.innerHTML, /more-buttons-icon--spin/);
  assert.match(content.innerHTML, /Loading…/);
});

test('dismiss before grace fires: timer cancelled, nothing ever appended', () => {
  const { doc, timers, tile } = setup();
  tile.show();
  tile.dismiss();
  assert.equal(timers.count(), 0);
  timers.fire(); // no-op; nothing pending
  assert.equal(doc.body.children.length, 0);
});

test('dismiss after tile visible: tile removed from body', () => {
  const { doc, timers, tile } = setup();
  tile.show();
  timers.fire();
  tile.dismiss();
  assert.equal(doc.body.children.length, 0);
});

test('show is a singleton: double show arms one timer and appends one tile', () => {
  const { doc, timers, tile } = setup();
  tile.show();
  tile.show();
  assert.equal(timers.count(), 1);
  timers.fire();
  tile.show(); // already visible — must not arm another timer
  assert.equal(timers.count(), 0);
  assert.equal(doc.body.children.length, 1);
});

test('dismiss with nothing pending is a safe no-op', () => {
  const { tile } = setup();
  tile.dismiss(); // must not throw
});

test('show works again after a full show/dismiss cycle', () => {
  const { doc, timers, tile } = setup();
  tile.show(); timers.fire(); tile.dismiss();
  tile.show(); timers.fire();
  assert.equal(doc.body.children.length, 1);
});

console.log(`\n${passed} passed`);
