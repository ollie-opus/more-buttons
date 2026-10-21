import assert from 'node:assert/strict';

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('  ok -', name); }

// Importing must not touch document/window/chrome at module scope.
const { createNavigationWatcher } = await import('../scripts/pageNavigation.js');

// ── Minimal fake page: a document + window that can fire events, swap the body
// and change the url the way Turbo Drive / the browser do. ────────────────────
function fakePage(href = 'https://host/a') {
  const listeners = { doc: {}, win: {} };
  const timers = [];
  const page = {
    doc: {
      body: { id: 'body0' },
      addEventListener: (t, fn) => (listeners.doc[t] ||= []).push(fn),
      removeEventListener: (t, fn) => { listeners.doc[t] = (listeners.doc[t] || []).filter(f => f !== fn); },
    },
    win: {
      location: { href },
      addEventListener: (t, fn) => (listeners.win[t] ||= []).push(fn),
      removeEventListener: (t, fn) => { listeners.win[t] = (listeners.win[t] || []).filter(f => f !== fn); },
    },
    setTimeout: (fn, ms) => { const id = timers.length; timers.push({ fn, ms, id, cleared: false }); return id; },
    clearTimeout: (id) => { if (timers[id]) timers[id].cleared = true; },
    fireDoc: (t) => (listeners.doc[t] || []).forEach(fn => fn({ type: t })),
    fireWin: (t) => (listeners.win[t] || []).forEach(fn => fn({ type: t })),
    pendingTimers: () => timers.filter(t => !t.cleared && !t.fired),
    runTimers: () => timers.filter(t => !t.cleared && !t.fired).forEach(t => { t.fired = true; t.fn(); }),
    setUrl: (u) => { page.win.location.href = u; },
    newBody: (id) => { page.doc.body = { id }; },
    listeners,
  };
  return page;
}

function watch(page, opts = {}) {
  const calls = { navigate: [], settle: [] };
  const watcher = createNavigationWatcher({
    doc: page.doc, win: page.win,
    setTimeout: page.setTimeout, clearTimeout: page.clearTimeout,
    onNavigate: (url) => calls.navigate.push(url),
    onSettle: (url) => calls.settle.push(url),
    ...opts,
  });
  return { calls, watcher };
}

// Turbo advance visit: url already changed when turbo:visit fires; body is
// swapped before turbo:render; turbo:load fires once at the end.
function turboVisit(page, url, bodyId) {
  page.setUrl(url);
  page.fireDoc('turbo:visit');
  page.fireDoc('turbo:before-render');
  page.newBody(bodyId);
  page.fireDoc('turbo:render');
  page.fireDoc('turbo:load');
}

await test('start() announces the initial url once, without settling', () => {
  const page = fakePage('https://host/a');
  const { calls, watcher } = watch(page);
  watcher.start();
  assert.deepEqual(calls.navigate, ['https://host/a']);
  assert.deepEqual(calls.settle, []);
});

await test('hard load on a Turbo page: DOMContentLoaded settles, the following turbo:load does not re-settle', () => {
  const page = fakePage('https://host/a');
  const { calls, watcher } = watch(page);
  watcher.start();
  page.fireDoc('DOMContentLoaded');
  page.fireDoc('turbo:load');
  assert.deepEqual(calls.settle, ['https://host/a']);
  assert.deepEqual(calls.navigate, ['https://host/a']);
});

await test('hard load on a non-Turbo page: DOMContentLoaded settles and no timer is left pending', () => {
  const page = fakePage('https://host/a');
  const { calls, watcher } = watch(page);
  watcher.start();
  page.fireDoc('DOMContentLoaded');
  assert.deepEqual(calls.settle, ['https://host/a']);
  assert.equal(page.pendingTimers().length, 0);
});

await test('start() after DOMContentLoaded already fired settles immediately', () => {
  const page = fakePage('https://host/a');
  page.doc.readyState = 'interactive';
  const { calls, watcher } = watch(page);
  watcher.start();
  assert.deepEqual(calls.settle, ['https://host/a']);
});

await test('Turbo visit: navigate fires on turbo:visit with the new url, settle on turbo:load', () => {
  const page = fakePage('https://host/a');
  const { calls, watcher } = watch(page);
  watcher.start();
  page.fireDoc('DOMContentLoaded');
  page.fireDoc('turbo:load');

  page.setUrl('https://host/b');
  page.fireDoc('turbo:visit');
  assert.deepEqual(calls.navigate, ['https://host/a', 'https://host/b']);
  assert.deepEqual(calls.settle, ['https://host/a']);

  page.fireDoc('turbo:before-render');
  page.newBody('body1');
  page.fireDoc('turbo:render');
  assert.deepEqual(calls.settle, ['https://host/a']);
  page.fireDoc('turbo:load');
  assert.deepEqual(calls.settle, ['https://host/a', 'https://host/b']);
  // Each stage reads the url; a navigate is announced once per url change.
  assert.deepEqual(calls.navigate, ['https://host/a', 'https://host/b']);
});

await test('Turbo back/forward (popstate then restoration visit) announces once and settles once', () => {
  const page = fakePage('https://host/a');
  const { calls, watcher } = watch(page);
  watcher.start();
  page.fireDoc('DOMContentLoaded');
  turboVisit(page, 'https://host/b', 'body1');

  page.setUrl('https://host/a');
  page.fireWin('popstate');
  assert.deepEqual(calls.navigate.at(-1), 'https://host/a');
  page.fireDoc('turbo:visit');
  page.fireDoc('turbo:before-render');
  page.newBody('body2');
  page.fireDoc('turbo:render');
  page.fireDoc('turbo:load');
  assert.deepEqual(calls.navigate, ['https://host/a', 'https://host/b', 'https://host/a']);
  assert.deepEqual(calls.settle, ['https://host/a', 'https://host/b', 'https://host/a']);
  assert.equal(page.pendingTimers().length, 0);
});

await test('same-url Turbo visit (fresh body) settles again; same body does not', () => {
  const page = fakePage('https://host/a');
  const { calls, watcher } = watch(page);
  watcher.start();
  page.fireDoc('DOMContentLoaded');
  page.fireDoc('turbo:load');
  assert.deepEqual(calls.settle, ['https://host/a']);

  // Redirect back to the same url after a form submit: new body.
  turboVisit(page, 'https://host/a', 'body1');
  assert.deepEqual(calls.settle, ['https://host/a', 'https://host/a']);
  assert.deepEqual(calls.navigate, ['https://host/a']);

  // A stray turbo:load with nothing changed is ignored.
  page.fireDoc('turbo:load');
  assert.deepEqual(calls.settle, ['https://host/a', 'https://host/a']);
});

await test('non-Turbo history navigation settles via the fallback timer, cancelled if turbo:load arrives', () => {
  const page = fakePage('https://host/a');
  const { calls, watcher } = watch(page, { fallbackMs: 1500 });
  watcher.start();
  page.fireDoc('DOMContentLoaded');

  page.setUrl('https://host/b');
  page.fireWin('popstate');
  assert.deepEqual(calls.navigate, ['https://host/a', 'https://host/b']);
  assert.equal(page.pendingTimers().length, 1);
  assert.equal(page.pendingTimers()[0].ms, 1500);
  page.runTimers();
  assert.deepEqual(calls.settle, ['https://host/a', 'https://host/b']);

  page.setUrl('https://host/c');
  page.fireWin('popstate');
  assert.equal(page.pendingTimers().length, 1);
  page.newBody('body2');
  page.fireDoc('turbo:load');
  assert.equal(page.pendingTimers().length, 0, 'turbo:load clears the fallback');
  assert.deepEqual(calls.settle, ['https://host/a', 'https://host/b', 'https://host/c']);
});

await test('a navigate announced while unsettled is not settled twice when the fallback has fired', () => {
  const page = fakePage('https://host/a');
  const { calls, watcher } = watch(page);
  watcher.start();
  page.fireDoc('DOMContentLoaded');
  page.setUrl('https://host/b');
  page.fireWin('popstate');
  page.runTimers();
  page.fireDoc('turbo:load'); // same body, same url as the fallback settle → ignored
  assert.deepEqual(calls.settle, ['https://host/a', 'https://host/b']);
});

await test('hashchange with only the fragment differing is announced like any other url change', () => {
  const page = fakePage('https://host/a');
  const { calls, watcher } = watch(page);
  watcher.start();
  page.setUrl('https://host/a#x');
  page.fireWin('hashchange');
  assert.deepEqual(calls.navigate, ['https://host/a', 'https://host/a#x']);
});

await test('stop() removes every listener and clears a pending fallback', () => {
  const page = fakePage('https://host/a');
  const { calls, watcher } = watch(page);
  watcher.start();
  page.fireDoc('DOMContentLoaded');
  page.setUrl('https://host/b');
  page.fireWin('popstate');
  assert.equal(page.pendingTimers().length, 1);
  watcher.stop();
  assert.equal(page.pendingTimers().length, 0);
  for (const bucket of [page.listeners.doc, page.listeners.win]) {
    for (const [type, fns] of Object.entries(bucket)) assert.equal(fns.length, 0, type);
  }
  page.setUrl('https://host/c');
  page.fireWin('popstate');
  page.fireDoc('turbo:load');
  assert.deepEqual(calls.navigate, ['https://host/a', 'https://host/b']);
});

await test('an onNavigate/onSettle that throws does not break the watcher', () => {
  const page = fakePage('https://host/a');
  let n = 0;
  const watcher = createNavigationWatcher({
    doc: page.doc, win: page.win, setTimeout: page.setTimeout, clearTimeout: page.clearTimeout,
    onNavigate: () => { n++; throw new Error('boom'); },
    onSettle: () => { n++; throw new Error('boom'); },
  });
  watcher.start();
  page.fireDoc('DOMContentLoaded');
  turboVisit(page, 'https://host/b', 'body1');
  assert.equal(n, 4);
});

console.log(`\n${passed} passed`);
