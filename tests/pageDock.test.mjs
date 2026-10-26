import assert from 'node:assert/strict';
import { orderDockButtons } from '../scripts/dockLayout.js';

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('  ok -', name); }

// (1) Importing must not touch chrome.* or document at module scope.
const { renderPageDock, removePageDock } = await import('../scripts/pageDock.js');

// ── Minimal fake DOM ───────────────────────────────────────────────────────
function el(tagName) {
  const classes = new Set();
  const listeners = {};
  const node = {
    tagName: tagName.toUpperCase(), id: '', children: [], parentNode: null, attrs: {}, dataset: {},
    _text: '', style: {}, inert: false,
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      contains: (c) => classes.has(c),
      toggle: (c, force) => { const on = force ?? !classes.has(c); on ? classes.add(c) : classes.delete(c); return on; },
    },
    get className() { return [...classes].join(' '); },
    set className(v) { classes.clear(); v.split(/\s+/).filter(Boolean).forEach((x) => classes.add(x)); },
    get textContent() { return node._text + node.children.map((c) => c.textContent).join(''); },
    set textContent(v) { node.children = []; node._text = String(v); },
    setAttribute: (k, v) => { node.attrs[k] = String(v); },
    getAttribute: (k) => node.attrs[k] ?? null,
    appendChild: (c) => { c.parentNode = node; node.children.push(c); return c; },
    append: (...cs) => cs.forEach((c) => node.appendChild(c)),
    replaceChildren: (...cs) => { node.children = []; cs.forEach((c) => node.appendChild(c)); },
    remove: () => { const p = node.parentNode; if (p) p.children = p.children.filter((c) => c !== node); node.parentNode = null; },
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    fire: (t) => (listeners[t] || []).forEach((fn) => fn({})),
    click: (ev = {}) => (listeners.click || []).forEach((fn) => fn({ preventDefault() {}, stopPropagation() {}, ...ev })),
    querySelector: (sel) => all(node).find((n) => n !== node && matches(n, sel)) ?? null,
    querySelectorAll: (sel) => all(node).filter((n) => n !== node && matches(n, sel)),
  };
  return node;
}
const all = (n) => [n, ...n.children.flatMap(all)];
const matches = (n, sel) => (sel.startsWith('#') ? n.id === sel.slice(1)
  : sel.startsWith('.') ? sel.slice(1).split('.').every((c) => n.classList.contains(c))
  : n.tagName === sel.toUpperCase());

function fakeDoc() {
  const documentElement = el('html');
  const head = el('head');
  documentElement.appendChild(head);
  return {
    documentElement, head,
    createElement: el,
    getElementById: (id) => all(documentElement).find((n) => n.id === id) ?? null,
  };
}

function fakeChrome(initial) {
  const store = { ...initial };
  const writes = [];
  const changeListeners = new Set();
  globalThis.chrome = {
    runtime: { getURL: (p) => 'chrome-extension://x/' + p },
    storage: {
      local: {
        get: async (k) => (k in store ? { [k]: store[k] } : {}),
        set: async (obj) => { Object.assign(store, obj); writes.push(obj); },
      },
      onChanged: {
        addListener: (fn) => changeListeners.add(fn),
        removeListener: (fn) => changeListeners.delete(fn),
      },
    },
  };
  // Simulate another tab writing: `changes` is the chrome.storage.onChanged shape.
  const fireChange = (changes, area = 'local') => changeListeners.forEach((fn) => fn(changes, area));
  return { store, writes, fireChange, changeListeners };
}

const B = (id, dockOrder, dockGroup, extra = {}) => ({
  id, displayText: 'Do ' + id, descriptionText: 'Desc ' + id, icon: 'star', colour: 'blue',
  action: 'act-' + id, dockOrder, dockGroup, ...extra,
});
const buttons = [B('a1', 1, 'A'), B('b2', 2, 'B'), B('n9', 0), B('a3', 3, 'A', { descriptionText: undefined, colour: 'red' }), B('s1', 0, 'System')];
const island = (root) => root.querySelector('.mb-page-dock__island');
const tiles = (root) => root.querySelector('.mb-page-dock__tiles');
const controls = (root) => root.querySelector('.mb-page-dock__controls');
const pinBtn = (root) => root.querySelector('.mb-page-dock__micro.--pin');
const expandBtn = (root) => root.querySelector('.mb-page-dock__micro.--expand');
const iconOf = (btn) => btn.querySelector('.more-buttons-icon').textContent;

// ── Tests ──────────────────────────────────────────────────────────────────
await test('renders root into documentElement with stylesheet link', async () => {
  fakeChrome({});
  const doc = fakeDoc();
  await renderPageDock(buttons, () => {}, { doc });
  const root = doc.getElementById('mb-page-dock');
  assert.ok(root);
  assert.equal(root.parentNode, doc.documentElement);
  assert.ok(root.classList.contains('mb-page-dock'));
  assert.equal(root.getAttribute('role'), 'toolbar');
  assert.ok(!root.classList.contains('--closed'));
  assert.ok(doc.getElementById('more-buttons-overlay-stylesheet'));
  // Handle first so the collapsed transform leaves the handle on screen.
  assert.deepEqual(root.children.map((c) => c.className), ['mb-page-dock__handle', 'mb-page-dock__island']);
  // Controls strip first (survives renders), then the replaceable tiles container.
  assert.deepEqual(island(root).children.map((c) => c.className), ['mb-page-dock__controls', 'mb-page-dock__tiles']);
  assert.deepEqual(controls(root).children.map((c) => c.className), ['mb-page-dock__micro --pin', 'mb-page-dock__micro --expand']);
  for (const b of controls(root).children) assert.equal(b.getAttribute('type'), 'button');
});

await test('groups follow orderDockButtons; every group is preceded by a separator carrying its name', async () => {
  fakeChrome({});
  const doc = fakeDoc();
  await renderPageDock(buttons, () => {}, { doc });
  const kids = tiles(doc.getElementById('mb-page-dock')).children;
  const shape = kids.map((k) => (k.classList.contains('mb-dock-sep') ? '|' : 'G'));
  const groups = orderDockButtons(buttons);
  // A separator before EACH group (the leading one is CSS-hidden in compressed mode
  // and becomes the first group's heading in expanded mode).
  assert.deepEqual(shape, groups.flatMap(() => ['|', 'G']));
  const groupEls = kids.filter((k) => !k.classList.contains('mb-dock-sep'));
  assert.deepEqual(groupEls.map((g) => g.children.map((t) => t.id)), groups.map((g) => g.map((b) => b.id)));
  assert.equal(groupEls[0].dataset.group, 'A');
  assert.equal(groupEls[0].getAttribute('aria-label'), 'A');
  const seps = kids.filter((k) => k.classList.contains('mb-dock-sep'));
  for (const sep of seps) assert.equal(sep.getAttribute('aria-hidden'), 'true');
  // Every separator carries its group's name; the blank bucket reads "Uncategorised".
  const labelOf = (sep) => sep.querySelector('.mb-page-dock__sep-label')?.textContent ?? null;
  assert.deepEqual(seps.map(labelOf), groups.map((g) => (g[0].dockGroup ?? 'Uncategorised')));
  assert.equal(labelOf(seps[0]), 'A');
  // Order is [named…][Uncategorised][System], so the blank bucket is second-to-last.
  assert.equal(labelOf(seps.at(-2)), 'Uncategorised', 'blank bucket is headed Uncategorised');
  assert.equal(groupEls.at(-2).dataset.group, 'Uncategorised');
  assert.equal(groupEls.at(-2).getAttribute('aria-label'), 'Uncategorised');
  assert.equal(labelOf(seps.at(-1)), 'System');
});

await test('tile structure, classes, aria and tag text', async () => {
  fakeChrome({});
  const doc = fakeDoc();
  await renderPageDock(buttons, () => {}, { doc });
  const t = doc.getElementById('a1');
  assert.equal(t.tagName, 'BUTTON');
  assert.equal(t.getAttribute('type'), 'button');
  for (const c of ['more-buttons-button', 'mb-page-dock__tile', 'blue']) assert.ok(t.classList.contains(c), c);
  assert.equal(t.getAttribute('aria-label'), 'Do a1');
  assert.equal(t.querySelector('.more-buttons-icon').textContent, 'star');
  // Inline label (CSS-hidden in compressed mode) follows the icon.
  assert.equal(t.querySelector('.mb-page-dock__label').textContent, 'Do a1');
  const tag = t.querySelector('.mb-page-dock__tag');
  assert.equal(tag.getAttribute('aria-hidden'), 'true');
  assert.equal(tag.querySelector('b').textContent, 'A: Do a1', 'compact tag reads "Group: displayText"');
  assert.equal(tag.querySelector('small').textContent, 'Desc a1', 'descriptionText rides in the tag for expanded mode');
  assert.equal(t.querySelector('.mb-page-dock__label').textContent, 'Do a1', 'inline label stays bare (its group heading is the separator)');
  assert.equal(t.getAttribute('aria-label'), 'Do a1', 'aria-label stays bare (group is on the wrapper)');
  const t3 = doc.getElementById('a3');
  assert.ok(t3.classList.contains('red'));
  assert.equal(t3.querySelector('.mb-page-dock__tag').querySelector('small'), null, 'no <small> without a descriptionText');
  assert.equal(doc.getElementById('n9').querySelector('.mb-page-dock__tag').querySelector('b').textContent, 'Do n9', 'Uncategorised tag has no "Group: " prefix');
  assert.equal(doc.getElementById('s1').querySelector('.mb-page-dock__tag').querySelector('b').textContent, 'Do s1', 'System tag has no "Group: " prefix');
});

await test('tile click dispatches its action', async () => {
  fakeChrome({});
  const doc = fakeDoc();
  const calls = [];
  await renderPageDock(buttons, (a) => calls.push(a), { doc });
  doc.getElementById('b2').click();
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(calls, ['act-b2']);
});

await test('tile click passes held modifier keys to dispatch as a second argument', async () => {
  fakeChrome({});
  const doc = fakeDoc();
  const calls = [];
  await renderPageDock(buttons, (...a) => calls.push(a), { doc });
  doc.getElementById('b2').click({ ctrlKey: true, metaKey: false, shiftKey: false, altKey: false });
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(calls, [['act-b2', { ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }]]);
});

await test('rejecting dispatch is caught and warned', async () => {
  fakeChrome({});
  const doc = fakeDoc();
  const warn = console.warn; const warned = [];
  console.warn = (...a) => warned.push(a);
  try {
    await renderPageDock(buttons, async () => { throw new Error('boom'); }, { doc });
    doc.getElementById('b2').click();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(warned.length, 1);
    assert.match(String(warned[0][0]), /dock action failed/);
  } finally { console.warn = warn; }
});

await test('storage get rejecting renders the dock open', async () => {
  fakeChrome({});
  globalThis.chrome.storage.local.get = async () => { throw new Error('nope'); };
  const doc = fakeDoc();
  await renderPageDock(buttons, () => {}, { doc });
  const root = doc.getElementById('mb-page-dock');
  assert.ok(root && !root.classList.contains('--closed'));
  assert.ok(!root.classList.contains('--expanded'));
});

await test('second render reuses root and replaces island children', async () => {
  fakeChrome({});
  const doc = fakeDoc();
  await renderPageDock(buttons, () => {}, { doc });
  const root = doc.getElementById('mb-page-dock');
  await renderPageDock([B('z1', 1, 'Z')], () => {}, { doc });
  assert.equal(doc.getElementById('mb-page-dock'), root);
  assert.equal(doc.documentElement.querySelectorAll('.mb-page-dock').length, 1);
  assert.equal(doc.getElementById('a1'), null);
  assert.ok(doc.getElementById('z1'));
});

await test('controls strip survives a re-render; only the tiles container is replaced', async () => {
  fakeChrome({});
  const doc = fakeDoc();
  await renderPageDock(buttons, () => {}, { doc });
  const root = doc.getElementById('mb-page-dock');
  const ctl = controls(root); const pin = pinBtn(root);
  await renderPageDock([B('z1', 1, 'Z')], () => {}, { doc });
  assert.equal(controls(root), ctl);
  assert.equal(pinBtn(root), pin);
  assert.deepEqual(island(root).children.map((c) => c.className), ['mb-page-dock__controls', 'mb-page-dock__tiles']);
});

await test('overlapping first renders create a single root with the newest buttons', async () => {
  fakeChrome({});
  const doc = fakeDoc();
  await Promise.all([
    renderPageDock(buttons, () => {}, { doc }),
    renderPageDock([B('z1', 1, 'Z')], () => {}, { doc }),
  ]);
  assert.equal(doc.documentElement.querySelectorAll('.mb-page-dock').length, 1);
  assert.ok(doc.getElementById('z1'));
  assert.equal(doc.getElementById('a1'), null);
});

await test('unpinned renders collapsed; handle toggles per-tab and writes nothing', async () => {
  const { writes } = fakeChrome({ moreButtonsPageDock: { pinned: false } });
  const doc = fakeDoc();
  await renderPageDock(buttons, () => {}, { doc });
  const root = doc.getElementById('mb-page-dock');
  const handle = root.querySelector('.mb-page-dock__handle');
  assert.ok(root.classList.contains('--closed'));
  assert.equal(handle.getAttribute('aria-expanded'), 'false');
  assert.equal(handle.getAttribute('aria-label'), 'Expand More Buttons dock');
  assert.equal(iconOf(handle), 'chevron-left');
  handle.click();
  assert.ok(!root.classList.contains('--closed'));
  assert.equal(handle.getAttribute('aria-expanded'), 'true');
  assert.equal(handle.getAttribute('aria-label'), 'Collapse More Buttons dock');
  assert.equal(iconOf(handle), 'chevron-right');
  handle.click();
  assert.ok(root.classList.contains('--closed'));
  assert.deepEqual(writes, [], 'the handle is per-tab only; it never persists');
});

await test('pinned (default) renders open; legacy { open:false } reads as unpinned', async () => {
  for (const [stored, expectClosed] of [
    [{}, false],
    [{ moreButtonsPageDock: { pinned: true } }, false],
    [{ moreButtonsPageDock: { open: true } }, false],
    [{ moreButtonsPageDock: { open: false } }, true],
    [{ moreButtonsPageDock: { open: false, pinned: true } }, false], // explicit pinned wins over legacy open
  ]) {
    fakeChrome(stored);
    const doc = fakeDoc();
    await renderPageDock(buttons, () => {}, { doc });
    const root = doc.getElementById('mb-page-dock');
    assert.equal(root.classList.contains('--closed'), expectClosed, JSON.stringify(stored));
    assert.equal(pinBtn(root).getAttribute('aria-pressed'), String(!expectClosed), JSON.stringify(stored));
  }
});

await test('pin toggle flips aria-pressed + icon, persists the whole prefs object, leaves open state alone', async () => {
  const { writes } = fakeChrome({});
  const doc = fakeDoc();
  await renderPageDock(buttons, () => {}, { doc });
  const root = doc.getElementById('mb-page-dock');
  const pin = pinBtn(root);
  // Icon shows the ACTION (like the expand toggle): pinned → pin-off (unpin), unpinned → pin (pin).
  assert.equal(pin.getAttribute('aria-pressed'), 'true');
  assert.equal(iconOf(pin), 'pin-off');
  pin.click();
  assert.equal(pin.getAttribute('aria-pressed'), 'false');
  assert.equal(iconOf(pin), 'pin');
  assert.ok(!root.classList.contains('--closed'), 'unpinning does not collapse the current tab');
  assert.deepEqual(writes.at(-1), { moreButtonsPageDock: { pinned: false, expanded: false } });
  pin.click();
  assert.equal(pin.getAttribute('aria-pressed'), 'true');
  assert.equal(iconOf(pin), 'pin-off');
  assert.deepEqual(writes.at(-1), { moreButtonsPageDock: { pinned: true, expanded: false } });
  assert.ok(pin.getAttribute('aria-label'));
  assert.ok(pin.getAttribute('title'));
});

await test('unpinning arms a one-shot collapse that fires when the pointer leaves the dock', async () => {
  fakeChrome({});
  const doc = fakeDoc();
  await renderPageDock(buttons, () => {}, { doc });
  const root = doc.getElementById('mb-page-dock');
  const handle = root.querySelector('.mb-page-dock__handle');
  pinBtn(root).click();                       // pinned → unpinned, pointer still over the dock
  assert.ok(!root.classList.contains('--closed'), 'stays open until the pointer leaves');
  root.fire('pointerleave');
  assert.ok(root.classList.contains('--closed'), 'collapses once the pointer leaves');
  assert.equal(handle.getAttribute('aria-expanded'), 'false');
  assert.equal(island(root).inert, true);
  // One-shot: pulling it open again and leaving does not collapse it (unpinned = stays open once pulled).
  handle.click();
  root.fire('pointerleave');
  assert.ok(!root.classList.contains('--closed'));
});

await test('re-pinning before the pointer leaves disarms the collapse; opening an unpinned dock never arms it', async () => {
  fakeChrome({});
  const doc = fakeDoc();
  await renderPageDock(buttons, () => {}, { doc });
  const root = doc.getElementById('mb-page-dock');
  pinBtn(root).click();                       // unpin
  pinBtn(root).click();                       // pin again
  root.fire('pointerleave');
  assert.ok(!root.classList.contains('--closed'), 'disarmed by re-pinning');

  fakeChrome({ moreButtonsPageDock: { pinned: false } });
  const doc2 = fakeDoc();
  await renderPageDock(buttons, () => {}, { doc: doc2 });
  const root2 = doc2.getElementById('mb-page-dock');
  root2.querySelector('.mb-page-dock__handle').click();
  root2.fire('pointerleave');
  assert.ok(!root2.classList.contains('--closed'), 'handle-opened unpinned dock stays open');
});

await test('expand toggle sets --expanded on the root, swaps icon and persists alongside pinned', async () => {
  const { writes } = fakeChrome({ moreButtonsPageDock: { pinned: false } });
  const doc = fakeDoc();
  await renderPageDock(buttons, () => {}, { doc });
  const root = doc.getElementById('mb-page-dock');
  const ex = expandBtn(root);
  assert.ok(!root.classList.contains('--expanded'));
  assert.equal(ex.getAttribute('aria-pressed'), 'false');
  assert.equal(iconOf(ex), 'expand');
  ex.click();
  assert.ok(root.classList.contains('--expanded'));
  assert.equal(ex.getAttribute('aria-pressed'), 'true');
  assert.equal(iconOf(ex), 'shrink');
  assert.deepEqual(writes.at(-1), { moreButtonsPageDock: { pinned: false, expanded: true } });
  ex.click();
  assert.ok(!root.classList.contains('--expanded'));
  assert.equal(iconOf(ex), 'expand');
  assert.deepEqual(writes.at(-1), { moreButtonsPageDock: { pinned: false, expanded: false } });
});

await test('stored expanded renders --expanded on first paint', async () => {
  fakeChrome({ moreButtonsPageDock: { pinned: true, expanded: true } });
  const doc = fakeDoc();
  await renderPageDock(buttons, () => {}, { doc });
  const root = doc.getElementById('mb-page-dock');
  assert.ok(root.classList.contains('--expanded'));
  assert.equal(expandBtn(root).getAttribute('aria-pressed'), 'true');
  assert.equal(iconOf(expandBtn(root)), 'shrink');
});

await test('storage change from another tab applies expanded without touching open/closed', async () => {
  const { fireChange, writes } = fakeChrome({});
  const doc = fakeDoc();
  await renderPageDock(buttons, () => {}, { doc });
  const root = doc.getElementById('mb-page-dock');
  root.querySelector('.mb-page-dock__handle').click();   // locally collapsed
  fireChange({ moreButtonsPageDock: { newValue: { pinned: true, expanded: true } } });
  assert.ok(root.classList.contains('--expanded'));
  assert.ok(root.classList.contains('--closed'), 'an expand-only change leaves this tab collapsed');
  assert.deepEqual(writes, [], 'applying a remote change must not echo a write');
  // Other areas / other keys are ignored.
  fireChange({ moreButtonsPageDock: { newValue: { pinned: true, expanded: false } } }, 'sync');
  fireChange({ somethingElse: { newValue: 1 } });
  assert.ok(root.classList.contains('--expanded'));
  // Subsequent local toggle builds on the synced prefs.
  expandBtn(root).click();
  assert.deepEqual(writes.at(-1), { moreButtonsPageDock: { pinned: true, expanded: false } });
});

await test('pin change from another tab collapses/opens this tab immediately', async () => {
  const { fireChange, writes } = fakeChrome({});
  const doc = fakeDoc();
  await renderPageDock(buttons, () => {}, { doc });
  const root = doc.getElementById('mb-page-dock');
  const handle = root.querySelector('.mb-page-dock__handle');
  // Another tab unpins → this tab collapses.
  fireChange({ moreButtonsPageDock: { newValue: { pinned: false, expanded: false } } });
  assert.equal(pinBtn(root).getAttribute('aria-pressed'), 'false');
  assert.ok(root.classList.contains('--closed'));
  assert.equal(island(root).inert, true);
  assert.equal(handle.getAttribute('aria-expanded'), 'false');
  // Another tab pins → this tab opens.
  fireChange({ moreButtonsPageDock: { newValue: { pinned: true, expanded: false } } });
  assert.equal(pinBtn(root).getAttribute('aria-pressed'), 'true');
  assert.ok(!root.classList.contains('--closed'));
  assert.equal(island(root).inert, false);
  // Unchanged pinned in a later change (e.g. expand toggled remotely) does not re-open a locally collapsed tab.
  handle.click();
  fireChange({ moreButtonsPageDock: { newValue: { pinned: true, expanded: true } } });
  assert.ok(root.classList.contains('--closed'));
  assert.deepEqual(writes, []);
});

await test('removePageDock detaches the storage change listener', async () => {
  const { changeListeners } = fakeChrome({});
  const doc = fakeDoc();
  await renderPageDock(buttons, () => {}, { doc });
  assert.equal(changeListeners.size, 1);
  removePageDock({ doc });
  assert.equal(changeListeners.size, 0);
});

await test('missing chrome.storage.onChanged is tolerated', async () => {
  fakeChrome({});
  delete globalThis.chrome.storage.onChanged;
  const doc = fakeDoc();
  await renderPageDock(buttons, () => {}, { doc });
  assert.ok(doc.getElementById('mb-page-dock'));
  removePageDock({ doc });
});

await test('removePageDock removes the root and is idempotent', async () => {
  fakeChrome({});
  const doc = fakeDoc();
  await renderPageDock(buttons, () => {}, { doc });
  removePageDock({ doc });
  assert.equal(doc.getElementById('mb-page-dock'), null);
  removePageDock({ doc });
  assert.equal(doc.getElementById('mb-page-dock'), null);
});

await test('removePageDock during a pending first render prevents the root appearing', async () => {
  fakeChrome({});
  const doc = fakeDoc();
  const p = renderPageDock(buttons, () => {}, { doc });
  removePageDock({ doc });
  await p;
  assert.equal(doc.getElementById('mb-page-dock'), null);
});

await test('collapsed island (controls included) is inert; handle click restores it', async () => {
  fakeChrome({ moreButtonsPageDock: { pinned: false } });
  const doc = fakeDoc();
  await renderPageDock(buttons, () => {}, { doc });
  const root = doc.getElementById('mb-page-dock');
  assert.equal(island(root).inert, true);
  root.querySelector('.mb-page-dock__handle').click();
  assert.equal(island(root).inert, false);
});

await test('new stylesheet link hides root until load/error; existing link never hides', async () => {
  for (const evt of ['load', 'error']) {
    fakeChrome({});
    const doc = fakeDoc();
    await renderPageDock(buttons, () => {}, { doc });
    const root = doc.getElementById('mb-page-dock');
    assert.equal(root.style.visibility, 'hidden');
    doc.getElementById('more-buttons-overlay-stylesheet').fire(evt);
    await new Promise((r) => setTimeout(r, 0)); // reveal settles via a promise (still before the next paint)
    assert.equal(root.style.visibility, '');
  }
  fakeChrome({});
  const doc = fakeDoc();
  const link = doc.createElement('link'); link.id = 'more-buttons-overlay-stylesheet';
  doc.head.appendChild(link);
  await renderPageDock(buttons, () => {}, { doc });
  assert.equal(doc.getElementById('mb-page-dock').style.visibility, undefined);
});

await test('reveal also waits for the lucide bodies (iconsReady) when the stylesheet already exists', async () => {
  fakeChrome({});
  const doc = fakeDoc();
  const link = doc.createElement('link'); link.id = 'more-buttons-overlay-stylesheet';
  doc.head.appendChild(link);
  let iconsLoaded; const iconsReady = new Promise((r) => { iconsLoaded = r; });
  await renderPageDock(buttons, () => {}, { doc, iconsReady });
  const root = doc.getElementById('mb-page-dock');
  assert.equal(root.style.visibility, 'hidden', 'hidden while the icon bodies are still loading');
  iconsLoaded();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(root.style.visibility, '');
});

await test('reveal waits for BOTH stylesheet load and iconsReady', async () => {
  fakeChrome({});
  const doc = fakeDoc();
  let iconsLoaded; const iconsReady = new Promise((r) => { iconsLoaded = r; });
  await renderPageDock(buttons, () => {}, { doc, iconsReady });
  const root = doc.getElementById('mb-page-dock');
  doc.getElementById('more-buttons-overlay-stylesheet').fire('load');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(root.style.visibility, 'hidden', 'CSS alone is not enough');
  iconsLoaded();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(root.style.visibility, '');
});

await test('icon bodies that never settle (or reject) still reveal after the cap', async () => {
  fakeChrome({});
  let doc = fakeDoc();
  let link = doc.createElement('link'); link.id = 'more-buttons-overlay-stylesheet'; doc.head.appendChild(link);
  await renderPageDock(buttons, () => {}, { doc, iconsReady: new Promise(() => {}), revealTimeoutMs: 10 });
  assert.equal(doc.getElementById('mb-page-dock').style.visibility, 'hidden');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(doc.getElementById('mb-page-dock').style.visibility, '', 'capped wait');

  fakeChrome({});
  doc = fakeDoc();
  link = doc.createElement('link'); link.id = 'more-buttons-overlay-stylesheet'; doc.head.appendChild(link);
  await renderPageDock(buttons, () => {}, { doc, iconsReady: Promise.reject(new Error('no icons')) });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(doc.getElementById('mb-page-dock').style.visibility, '', 'rejection reveals');
});

console.log(`pageDock: ${passed} passed`);
