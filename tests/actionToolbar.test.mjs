import assert from 'node:assert/strict';
import { mountActionBar, BAR_VARIANTS } from '../scripts/actionToolbar.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// ── Fake DOM: tag / .class / [attr] / [attr="v"] compounds, no combinators ──
function el(tag) {
  const classes = new Set(); const listeners = {};
  const node = {
    tagName: tag.toUpperCase(), attrs: {}, children: [], parentNode: null, _text: '', style: {}, hidden: false,
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)), remove: (...c) => c.forEach(x => classes.delete(x)),
      contains: c => classes.has(c), toggle: (c, f) => { const on = f ?? !classes.has(c); on ? classes.add(c) : classes.delete(c); return on; },
    },
    get className() { return [...classes].join(' '); },
    set className(v) { classes.clear(); v.split(/\s+/).filter(Boolean).forEach(x => classes.add(x)); },
    get textContent() { return node._text + node.children.map(c => c.textContent).join(''); },
    set textContent(v) { node.children = []; node._text = String(v); },
    setAttribute: (k, v) => { node.attrs[k] = String(v); if (k === 'hidden') node.hidden = true; },
    removeAttribute: k => { delete node.attrs[k]; if (k === 'hidden') node.hidden = false; },
    getAttribute: k => node.attrs[k] ?? null,
    hasAttribute: k => k in node.attrs,
    appendChild: c => { c.parentNode = node; node.children.push(c); return c; },
    append: (...cs) => cs.forEach(c => node.appendChild(c)),
    remove: () => { const p = node.parentNode; if (p) p.children = p.children.filter(c => c !== node); node.parentNode = null; },
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter(f => f !== fn); },
    fire: (t, ev = {}) => (listeners[t] || []).forEach(fn => fn({ target: node, stopPropagation() {}, preventDefault() {}, ...ev })),
    listenerCount: t => (listeners[t] || []).length,
    querySelector: sel => all(node).find(n => n !== node && matches(n, sel)) ?? null,
    querySelectorAll: sel => all(node).filter(n => n !== node && matches(n, sel)),
    contains: n => all(node).includes(n),
  };
  return node;
}
const all = n => [n, ...n.children.flatMap(all)];
function matches(n, sel) {
  const m = /^([a-z]*)((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/.exec(sel);
  if (!m) throw new Error('fake: ' + sel);
  if (m[1] && n.tagName !== m[1].toUpperCase()) return false;
  for (const c of m[2].split('.').filter(Boolean)) if (!n.classList.contains(c)) return false;
  for (const a of m[3].matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) { if (!(a[1] in n.attrs)) return false; if (a[2] != null && n.attrs[a[1]] !== a[2]) return false; }
  return true;
}
function fakeEnv() {
  const documentElement = el('html');
  const docListeners = {};
  const doc = {
    documentElement, head: documentElement.appendChild(el('head')), createElement: el,
    addEventListener: (t, fn) => { (docListeners[t] ||= []).push(fn); },
    removeEventListener: (t, fn) => { docListeners[t] = (docListeners[t] || []).filter(f => f !== fn); },
    fire: (t, ev) => (docListeners[t] || []).forEach(fn => fn({ stopPropagation() {}, preventDefault() {}, ...ev })),
    listenerCount: t => (docListeners[t] || []).length,
  };
  const timers = [];
  const setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  const clearTimeout = id => { if (timers[id - 1]) timers[id - 1].fn = null; };
  const flush = () => { const t = timers.splice(0); t.forEach(x => x.fn?.()); };
  return { doc, win: {}, setTimeout, clearTimeout, flush, raf: cb => cb() };
}
const controls = [
  { id: 'pause', icon: 'pause', label: 'Pause' },
  { id: 'stop', icon: 'square', label: 'Stop' },
  { id: 'cancel', icon: 'x', label: 'Cancel recording', kind: 'close' },
];
function mount(env, extra = {}) {
  const fired = [];
  const bar = mountActionBar({ variant: 'recording', title: 'Recording · 0 steps', controls, onControl: id => fired.push(id), escapeControl: 'cancel',
    doc: env.doc, win: env.win, paintIcons: () => {}, ensureStyles: false, setTimeout: env.setTimeout, clearTimeout: env.clearTimeout, raf: env.raf, ...extra });
  return { bar, fired };
}

test('BAR_VARIANTS are recording, paused, playing', () => {
  assert.deepEqual(BAR_VARIANTS, ['recording', 'paused', 'playing']);
});

test('mounts a capture-style bar + tab on documentElement with variant classes and the title in both', () => {
  const env = fakeEnv();
  const { bar } = mount(env);
  const barEl = env.doc.documentElement.querySelector('.mb-capture-bar.mb-action-bar.--recording');
  const tabEl = env.doc.documentElement.querySelector('.mb-capture-tab.mb-action-tab.--recording');
  assert.ok(barEl && tabEl);
  assert.equal(barEl.getAttribute('role'), 'toolbar');
  assert.equal(barEl.querySelector('[data-bar-title]').textContent, 'Recording · 0 steps');
  assert.equal(tabEl.querySelector('[data-tab-label]').textContent, 'Recording · 0 steps');
  assert.ok(barEl.querySelector('.mb-capture-bar__dot') && tabEl.querySelector('.mb-capture-tab__dot'));
  assert.equal(bar.bar, barEl);
});

test('renders toggle controls and the close control with lucide icon spans; clicks report the control id', () => {
  const env = fakeEnv();
  const { bar, fired } = mount(env);
  const pause = bar.bar.querySelector('button.mb-capture-bar__toggle[data-bar-control="pause"]');
  assert.ok(pause);
  assert.equal(pause.querySelector('.more-buttons-icon').textContent, 'pause');
  assert.equal(pause.querySelector('.mb-capture-bar__toggle-label').textContent, 'Pause');
  const close = bar.bar.querySelector('button.mb-capture-bar__close[data-bar-control="cancel"]');
  assert.ok(close);
  assert.equal(close.getAttribute('aria-label'), 'Cancel recording');
  pause.fire('click'); close.fire('click');
  assert.deepEqual(fired, ['pause', 'cancel']);
});

test('Escape fires the escapeControl', () => {
  const env = fakeEnv();
  const { fired } = mount(env);
  env.doc.fire('keydown', { key: 'Enter' });
  env.doc.fire('keydown', { key: 'Escape' });
  assert.deepEqual(fired, ['cancel']);
});

test('setTitle / setArmed / setVariant / setControl update both surfaces', () => {
  const env = fakeEnv();
  const { bar } = mount(env);
  bar.setTitle('Recording · 3 steps');
  assert.equal(bar.bar.querySelector('[data-bar-title]').textContent, 'Recording · 3 steps');
  assert.equal(bar.tab.querySelector('[data-tab-label]').textContent, 'Recording · 3 steps');
  bar.setArmed(true);
  assert.ok(bar.bar.classList.contains('--armed') && bar.tab.classList.contains('--armed'));
  bar.setArmed(false);
  assert.ok(!bar.bar.classList.contains('--armed') && !bar.tab.classList.contains('--armed'));
  bar.setVariant('paused');
  assert.ok(bar.bar.classList.contains('--paused') && !bar.bar.classList.contains('--recording'));
  assert.ok(bar.tab.classList.contains('--paused') && !bar.tab.classList.contains('--recording'));
  assert.throws(() => bar.setVariant('bogus'));
  bar.setControl('pause', { icon: 'play', label: 'Resume' });
  const pause = bar.bar.querySelector('[data-bar-control="pause"]');
  assert.equal(pause.querySelector('.more-buttons-icon').textContent, 'play');
  assert.equal(pause.querySelector('.mb-capture-bar__toggle-label').textContent, 'Resume');
  bar.setControl('stop', { hidden: true });
  assert.equal(bar.bar.querySelector('[data-bar-control="stop"]').hidden, true);
});

test('flash shows the message in the bar and swaps the tab label until the timer restores the title', () => {
  const env = fakeEnv();
  const { bar } = mount(env);
  bar.flash('Password field → ask at play');
  const flashEl = bar.bar.querySelector('[data-bar-flash]');
  assert.equal(flashEl.hidden, false);
  assert.equal(flashEl.textContent, 'Password field → ask at play');
  assert.equal(bar.tab.querySelector('[data-tab-label]').textContent, 'Password field → ask at play');
  env.flush();
  assert.equal(flashEl.hidden, true);
  assert.equal(bar.tab.querySelector('[data-tab-label]').textContent, 'Recording · 0 steps');
});

test('hover reveal: top-edge mousemove or tab mouseenter adds --enter / --in-bar; moving below the hold zone hides', () => {
  const env = fakeEnv();
  const { bar } = mount(env);
  env.doc.fire('mousemove', { clientY: 1 });
  assert.ok(bar.bar.classList.contains('--enter') && bar.tab.classList.contains('--in-bar'));
  env.doc.fire('mousemove', { clientY: 300 });
  env.flush();
  assert.ok(!bar.bar.classList.contains('--enter') && !bar.tab.classList.contains('--in-bar'));
  bar.tab.fire('mouseenter');
  assert.ok(bar.bar.classList.contains('--enter'));
});

test('remove adds --exit, detaches document listeners, and drops both nodes after the timer', () => {
  const env = fakeEnv();
  const { bar } = mount(env);
  assert.equal(env.doc.listenerCount('keydown'), 1);
  bar.remove();
  assert.ok(bar.bar.classList.contains('--exit') && bar.tab.classList.contains('--exit'));
  assert.equal(env.doc.listenerCount('keydown'), 0);
  assert.equal(env.doc.listenerCount('mousemove'), 0);
  env.flush();
  assert.ok(!env.doc.documentElement.contains(bar.bar) && !env.doc.documentElement.contains(bar.tab));
});

console.log(`\n${passed} passed`);
