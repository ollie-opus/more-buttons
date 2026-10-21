import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { relative } from 'node:path';

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('  ok -', name); }

const src = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const LUCIDE_NAMES = new Set(JSON.parse(src('../config/lucideIcons.json')));

// (1) Importing must not touch chrome.* or document at module scope.
const {
  wrapLucideBody, wrapLucideFilledBody, lucideSvg, lucideFilledSvg, chromeIconSvg, getLucideSvgMarkup,
  loadLucideBodies, loadLucideFilledBodies, loadChromeIcons, primeLucideBodies, primeLucideFilledBodies,
  resetLucideIcons, paintIconSpans, watchIconSpans,
} = await import('../scripts/lucideIcons.js');
// The outline-only tests below run with "no filled map" settled, so painting
// never waits on it.
primeLucideFilledBodies(null);

// ── Minimal fake DOM ───────────────────────────────────────────────────────
function el(tagName, className = '', text = '') {
  const classes = new Set(className.split(/\s+/).filter(Boolean));
  const node = {
    nodeType: 1, tagName: tagName.toUpperCase(), children: [], parentNode: null, dataset: {},
    _text: text, _html: '',
    classList: { contains: c => classes.has(c), add: c => classes.add(c) },
    get textContent() { return node._html ? '' : node._text + node.children.map(c => c.textContent).join(''); },
    set textContent(v) { node.children = []; node._html = ''; node._text = String(v); },
    get innerHTML() { return node._html || node._text; },
    set innerHTML(v) { node.children = []; node._text = ''; node._html = String(v); },
    appendChild(c) { c.parentNode = node; node.children.push(c); return c; },
    querySelector(sel) { return sel === 'svg' ? (node._html.includes('<svg') ? { tagName: 'svg' } : null) : (all(node).find(n => n !== node && matches(n, sel)) ?? null); },
    querySelectorAll(sel) { return all(node).filter(n => n !== node && matches(n, sel)); },
  };
  return node;
}
const all = n => [n, ...n.children.flatMap(all)];
const matches = (n, sel) => sel.startsWith('.') ? sel.slice(1).split('.').every(c => n.classList.contains(c)) : n.tagName === sel.toUpperCase();
const icon = (name, extra = '') => el('span', `more-buttons-icon ${extra}`, name);

function fakeChrome() {
  globalThis.chrome = { runtime: { getURL: p => 'chrome-extension://x/' + p } };
}

// ── Markup ─────────────────────────────────────────────────────────────────
await test('wrapLucideBody emits the zensical envelope plus 1em sizing attrs', () => {
  const svg = wrapLucideBody('check', '<path d="M20 6 9 17l-5-5"/>');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /class="lucide lucide-check"/);
  assert.match(svg, /viewBox="0 0 24 24"/);
  assert.match(svg, /stroke="currentColor"/);
  assert.match(svg, /width="1em" height="1em"/, 'sized even where no stylesheet reaches');
  assert.ok(svg.endsWith('<path d="M20 6 9 17l-5-5"/></svg>'));
});

await test('lucideSvg is synchronous: empty until bodies are primed, then markup for known names only', () => {
  resetLucideIcons(); primeLucideFilledBodies(null);
  assert.equal(lucideSvg('check'), '');
  primeLucideBodies({ check: '<path d="M20 6 9 17l-5-5"/>', evil: '<path onload="x()"/>', evil2: '<script>1</script>' });
  assert.match(lucideSvg('check'), /lucide-check/);
  assert.equal(lucideSvg('nope'), '');
  assert.equal(lucideSvg(''), '');
  assert.equal(lucideSvg('evil'), '', 'handler attributes are refused');
  assert.equal(lucideSvg('evil2'), '', 'script elements are refused');
});

await test('getLucideSvgMarkup resolves the same markup', async () => {
  assert.equal(await getLucideSvgMarkup('check'), lucideSvg('check'));
  assert.equal(await getLucideSvgMarkup('nope'), '');
});

// ── Painter ────────────────────────────────────────────────────────────────
await test('paintIconSpans swaps the name text for the SVG and records the name', () => {
  const root = el('div');
  const btn = root.appendChild(el('button'));
  const ic = btn.appendChild(icon('check'));
  btn.appendChild(el('span', 'label', 'Done'));
  paintIconSpans(root);
  assert.match(ic.innerHTML, /^<svg .*lucide-check/);
  assert.equal(ic.dataset.mbIcon, 'check');
  assert.equal(ic.textContent, '', 'the ligature name must not leak as text');
  assert.equal(btn.children[1].textContent, 'Done', 'non-icon nodes untouched');
});

await test('paintIconSpans is idempotent and leaves unknown names alone (warning once)', () => {
  const warn = console.warn; const warned = [];
  console.warn = (...a) => warned.push(a.join(' '));
  try {
    const root = el('div');
    const ok = root.appendChild(icon('check'));
    const bad = root.appendChild(icon('not_a_lucide_name'));
    paintIconSpans(root);
    const first = ok.innerHTML;
    paintIconSpans(root);
    assert.equal(ok.innerHTML, first);
    assert.equal(bad.innerHTML, 'not_a_lucide_name');
    assert.equal(bad.dataset.mbIcon, undefined);
    paintIconSpans(root);
    assert.equal(warned.filter(w => /not_a_lucide_name/.test(w)).length, 1, 'one warning per unknown name');
  } finally { console.warn = warn; }
});

await test('a painted span whose text is reassigned repaints to the new icon', () => {
  const root = el('div');
  const ic = root.appendChild(icon('check'));
  paintIconSpans(root);
  primeLucideBodies({ check: '<path d="M1"/>', x: '<path d="M2"/>' });
  ic.textContent = 'x';
  paintIconSpans(root);
  assert.match(ic.innerHTML, /lucide-x/);
  assert.equal(ic.dataset.mbIcon, 'x');
});

await test('paintIconSpans accepts a single icon span as its root', () => {
  const ic = icon('check');
  paintIconSpans(ic);
  assert.match(ic.innerHTML, /lucide-check/);
});

// ── Observer ───────────────────────────────────────────────────────────────
function fakeDoc() {
  const documentElement = el('html');
  const observers = [];
  class MO {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe(target, opts) { this.target = target; this.opts = opts; }
    disconnect() { this.disconnected = true; }
  }
  const doc = { nodeType: 9, documentElement, defaultView: { MutationObserver: MO } };
  const fire = records => observers.forEach(o => o.cb(records, o));
  return { doc, observers, fire };
}

await test('watchIconSpans paints existing spans, observes the root once, and paints added subtrees', () => {
  primeLucideBodies({ check: '<path d="M1"/>', x: '<path d="M2"/>' });
  const { doc, observers, fire } = fakeDoc();
  const existing = doc.documentElement.appendChild(icon('check'));
  watchIconSpans(doc);
  watchIconSpans(doc);
  assert.equal(observers.length, 1, 'idempotent per document');
  assert.equal(observers[0].target, doc.documentElement);
  assert.deepEqual(observers[0].opts, { childList: true, subtree: true, characterData: true });
  assert.match(existing.innerHTML, /lucide-check/);

  const wrap = el('div');
  const nested = wrap.appendChild(el('button')).appendChild(icon('x'));
  const direct = icon('check');
  fire([{ type: 'childList', target: doc.documentElement, addedNodes: [wrap, direct, { nodeType: 3 }] }]);
  assert.match(nested.innerHTML, /lucide-x/);
  assert.match(direct.innerHTML, /lucide-check/);
});

await test('watchIconSpans repaints a span whose text node changed (textContent reassignment)', () => {
  primeLucideBodies({ check: '<path d="M1"/>', x: '<path d="M2"/>' });
  const { doc, fire } = fakeDoc();
  watchIconSpans(doc);
  const ic = doc.documentElement.appendChild(icon('check'));
  fire([{ type: 'childList', target: doc.documentElement, addedNodes: [ic] }]);
  ic.textContent = 'x';
  // Replacing children fires childList on the span itself …
  fire([{ type: 'childList', target: ic, addedNodes: [{ nodeType: 3 }] }]);
  assert.match(ic.innerHTML, /lucide-x/);
  // … and a bare text edit fires characterData on the text node.
  ic.textContent = 'check';
  fire([{ type: 'characterData', target: { nodeType: 3, parentNode: ic }, addedNodes: [] }]);
  assert.match(ic.innerHTML, /lucide-check/);
});

await test('watchIconSpans without a MutationObserver still paints what exists', () => {
  primeLucideBodies({ check: '<path d="M1"/>' });
  const documentElement = el('html');
  const ic = documentElement.appendChild(icon('check'));
  const saved = globalThis.MutationObserver; delete globalThis.MutationObserver;
  try { watchIconSpans({ nodeType: 9, documentElement, defaultView: {} }); }
  finally { if (saved) globalThis.MutationObserver = saved; }
  assert.match(ic.innerHTML, /lucide-check/);
});

// ── Lazy loading ───────────────────────────────────────────────────────────
await test('loadLucideBodies fetches the bundled map once; spans painted before it lands are filled after', async () => {
  resetLucideIcons(); primeLucideFilledBodies(null); // outline not loaded, filled settled-empty
  fakeChrome();
  const urls = [];
  let release;
  const gate = new Promise(r => { release = r; });
  globalThis.fetch = async url => { urls.push(url); await gate; return { json: async () => ({ check: '<path d="M1"/>' }) }; };
  const root = el('div');
  const ic = root.appendChild(icon('check'));
  paintIconSpans(root);                       // bodies not loaded: must kick off the load
  assert.equal(ic.innerHTML, 'check', 'nothing to paint yet');
  const p1 = loadLucideBodies(); const p2 = loadLucideBodies();
  assert.equal(p1, p2, 'single in-flight promise');
  assert.deepEqual(urls, ['chrome-extension://x/config/lucideIconBodies.json']);
  release();
  await p1;
  await new Promise(r => setTimeout(r, 0));
  assert.match(ic.innerHTML, /lucide-check/, 'deferred paint completed');
  assert.equal(lucideSvg('check') !== '', true);
});

await test('a failed bodies fetch resolves (never rejects) and leaves spans unpainted', async () => {
  resetLucideIcons(); primeLucideFilledBodies(null);
  fakeChrome();
  globalThis.fetch = async () => { throw new Error('offline'); };
  const result = await loadLucideBodies();
  assert.equal(result, null);
  assert.equal(lucideSvg('check'), '');
});

// ── Filled variants (lucide-extended) ──────────────────────────────────────
await test('wrapLucideFilledBody emits a fill envelope with no stroke', () => {
  const svg = wrapLucideFilledBody('pin', '<path d="M1" fill="currentColor"/>');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" class="lucide lucide-filled lucide-pin">/);
  assert.ok(!/stroke/.test(svg));
  assert.ok(svg.endsWith('<path d="M1" fill="currentColor"/></svg>'));
});

await test('chromeIconSvg prefers the filled body and falls back to the outline; KB markup stays outline', async () => {
  resetLucideIcons();
  primeLucideBodies({ save: '<path d="M1"/>', x: '<path d="M2"/>' });
  primeLucideFilledBodies({ save: '<path d="M9" fill="currentColor"/>', evil: '<path onclick="x()"/>' });
  assert.match(lucideFilledSvg('save'), /lucide-filled lucide-save/);
  assert.equal(lucideFilledSvg('x'), '', 'no filled twin');
  assert.equal(lucideFilledSvg('evil'), '', 'handler attributes refused');
  assert.equal(chromeIconSvg('save'), lucideFilledSvg('save'));
  assert.equal(chromeIconSvg('x'), lucideSvg('x'));
  assert.equal(chromeIconSvg('nope'), '');
  const kb = await getLucideSvgMarkup('save');
  assert.ok(!/lucide-filled/.test(kb) && /lucide-save/.test(kb), 'content previews must match what the site renders');
});

await test('painter paints filled where available, outline otherwise, and records which', () => {
  resetLucideIcons();
  primeLucideBodies({ save: '<path d="M1"/>', x: '<path d="M2"/>' });
  primeLucideFilledBodies({ save: '<path d="M9" fill="currentColor"/>' });
  const root = el('div');
  const s = root.appendChild(icon('save'));
  const x = root.appendChild(icon('x'));
  paintIconSpans(root);
  assert.match(s.innerHTML, /lucide-filled lucide-save/);
  assert.equal(s.dataset.mbIconStyle, 'filled');
  assert.match(x.innerHTML, /lucide-x/); assert.ok(!/lucide-filled/.test(x.innerHTML));
  assert.equal(x.dataset.mbIconStyle, 'outline');
});

await test('painter waits for the filled map to settle so an icon never paints outline then flips to filled', () => {
  resetLucideIcons();
  primeLucideBodies({ save: '<path d="M1"/>' });
  const root = el('div');
  const s = root.appendChild(icon('save'));
  paintIconSpans(root);
  assert.equal(s.innerHTML, 'save', 'outline loaded but filled map still unknown → hold');
  primeLucideFilledBodies({ save: '<path d="M9" fill="currentColor"/>' });
  assert.match(s.innerHTML, /lucide-filled/, 'priming flushes the held root');
});

await test('loadChromeIcons fetches both maps once; a failed filled fetch still paints outlines', async () => {
  resetLucideIcons();
  fakeChrome();
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(url);
    if (/Filled/.test(url)) throw new Error('404');
    return { json: async () => ({ save: '<path d="M1"/>' }) };
  };
  const root = el('div');
  const s = root.appendChild(icon('save'));
  paintIconSpans(root);
  const p = loadChromeIcons();
  assert.equal(loadChromeIcons(), p, 'single in-flight promise');
  const [outline, filled] = await p;
  assert.ok(outline && outline.save); assert.equal(filled, null);
  assert.deepEqual(urls.sort(), ['chrome-extension://x/config/lucideFilledBodies.json', 'chrome-extension://x/config/lucideIconBodies.json']);
  await new Promise(r => setTimeout(r, 0));
  assert.match(s.innerHTML, /lucide-save/); assert.equal(s.dataset.mbIconStyle, 'outline');
  assert.equal(await loadLucideFilledBodies(), null);
  assert.equal(await loadLucideBodies(), outline);
});

// ── Repo lint: every icon name the extension ships must be a bundled lucide name
//    and nothing may still reference the Material Symbols font. ────────────────
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const rel = f => relative(repoRoot, f);
const read = p => readFileSync(p, 'utf8');
const listDir = (dir, ext) => readdirSync(fileURLToPath(new URL(dir, import.meta.url)))
  .filter(f => f.endsWith(ext)).map(f => fileURLToPath(new URL(dir + f, import.meta.url)));
const scriptFiles = listDir('../scripts/', '.js');
const formFiles = listDir('../config/forms/', '.html');
const popupFiles = ['../popup.html', '../popup.js', '../popup.css', '../scripts/content.js'].map(r => fileURLToPath(new URL(r, import.meta.url)));

await test('every icon name in markup, icon: literals and buttons.json is a bundled lucide name', () => {
  const bad = [];
  const check = (name, where) => { if (!LUCIDE_NAMES.has(name)) bad.push(`${name} (${where})`); };
  for (const f of [...scriptFiles, ...formFiles, ...popupFiles]) {
    const text = read(f); const where = rel(f);
    for (const m of text.matchAll(/class="(?:[^"]*\s)?more-buttons-icon(?:\s[^"]*)?"[^>]*>([^<$]+)</g)) check(m[1].trim(), where);
    for (const m of text.matchAll(/\bicon(?:On|Off)?:\s*'([a-z0-9_-]+)'/g)) check(m[1], where);
  }
  const buttons = JSON.parse(src('../config/buttons.json'));
  for (const b of buttons) {
    check(b.icon, b.id);
    if (b.toggle) { check(b.toggle.iconOn, b.id + '.iconOn'); check(b.toggle.iconOff, b.id + '.iconOff'); }
  }
  assert.deepEqual(bad, []);
});

await test('no Material Symbols references remain', () => {
  const offenders = [];
  const files = [...scriptFiles, ...formFiles, ...popupFiles,
    fileURLToPath(new URL('../config/forms/formsStyling.css', import.meta.url)),
    fileURLToPath(new URL('../manifest.json', import.meta.url))];
  for (const f of files) {
    const text = read(f);
    if (/material-symbols|Material Symbols|MaterialSymbols|assets\/fonts|font-variation-settings/i.test(text)) offenders.push(rel(f));
  }
  assert.deepEqual(offenders, []);
});

await test('scripts/lucideIcons.js and the filled bodies are web-accessible', () => {
  const manifest = JSON.parse(src('../manifest.json'));
  const resources = new Set(manifest.web_accessible_resources.flatMap(r => r.resources));
  assert.ok(resources.has('scripts/lucideIcons.js'));
  assert.ok(resources.has('config/lucideFilledBodies.json'));
});

await test('bundled filled bodies: every key has an outline twin; bodies are normalised currentColor paths', () => {
  const filled = JSON.parse(src('../config/lucideFilledBodies.json'));
  const keys = Object.keys(filled);
  assert.ok(keys.length > 1000, `only ${keys.length} filled bodies`);
  const orphans = keys.filter(k => !LUCIDE_NAMES.has(k));
  assert.deepEqual(orphans, []);
  const bad = keys.filter(k => {
    const b = filled[k];
    return /black|stroke|style=|<script|\bon\w+=/i.test(b) || !/^(<path\b[^>]*fill="currentColor"[^>]*\/>)+$/.test(b);
  });
  assert.deepEqual(bad, []);
  for (const n of ['save', 'tag', 'briefcase', 'puzzle', 'badge-check', 'pin', 'pin-off', 'camera', 'settings']) assert.ok(filled[n], n);
  const licence = src('../config/lucideFilledBodies.LICENSE.txt');
  assert.match(licence, /ISC License/); assert.match(licence, /Applifted/); assert.match(licence, /commit [0-9a-f]{40}/);
});

await test('the stylesheet no longer tints icons itself (filled glyphs carry their own paint)', () => {
  const css = src('../config/forms/formsStyling.css');
  assert.ok(!/fill-opacity/.test(css), 'fill-opacity tint rule still present');
});

console.log(`lucideIcons: ${passed} passed`);
