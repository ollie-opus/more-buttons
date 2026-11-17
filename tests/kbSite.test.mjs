import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classifyKbPath, classifyAdminPath, injectAdminCog, ADMIN_ROUTES, injectEditButton, injectLogButton, injectPageButton, injectCreateDraftButton, isNotFoundPage, kbSchemeIsDark, KB_HOST } from '../scripts/kbSite.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const buttons = JSON.parse(read('../config/buttons.json'));
const manifest = JSON.parse(read('../manifest.json'));

test('a live guide url maps to its page and draft files and urls', () => {
  assert.deepEqual(classifyKbPath('/pages/adding-a-new-employee/'), {
    side: 'live',
    slug: 'adding-a-new-employee',
    livePath: 'docs/pages/adding-a-new-employee.md',
    draftPath: 'docs/drafts/adding-a-new-employee.md',
    liveUrl: '/pages/adding-a-new-employee/',
    draftUrl: '/drafts/adding-a-new-employee/',
  });
});

test('a draft url is the draft side of the same page', () => {
  const p = classifyKbPath('/drafts/permits-to-work/');
  assert.equal(p.side, 'draft');
  assert.equal(p.draftPath, 'docs/drafts/permits-to-work.md');
  assert.equal(p.liveUrl, '/pages/permits-to-work/');
});

test('trailing slash and index.html are optional', () => {
  assert.equal(classifyKbPath('/pages/faqs')?.slug, 'faqs');
  // Nothing but a plain file name is a page: the slug goes into GitHub requests.
  for (const bad of ['/drafts/a%3Fref%3Dother/', '/drafts/a%23b/', '/drafts/..%2Fsecret/', '/drafts/../', '/drafts/a%20b/', '/pages/a.b/']) {
    assert.equal(classifyKbPath(bad), null, bad);
  }
  assert.equal(classifyKbPath('/pages/faqs/index.html')?.slug, 'faqs');
});

test('the home page, System Status and anything else get nothing', () => {
  for (const path of ['/', '/index.html', '/pages/', '/pages/system-status/',
    '/drafts/system-status/', '/assets/media/x.png', '/pages/a/b/', '/search/', '', undefined]) {
    assert.equal(classifyKbPath(path), null, String(path));
  }
});

test('System Updates is a page: its live side and its drafts list', () => {
  assert.equal(classifyKbPath('/pages/system-updates/')?.draftUrl, '/drafts/system-updates/');
  assert.equal(classifyKbPath('/drafts/system-updates/')?.draftPath, 'docs/drafts/system-updates.md');
});

// A just-enough document: one article holding an h1.
function fakeDoc() {
  const el = tag => ({
    tag, className: '', children: [], attrs: {}, listeners: {}, style: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(t, fn) { this.listeners[t] = fn; },
    append(...xs) { this.children.push(...xs); },
    prepend(x) { this.children.unshift(x); },
    after(x) { article.children.splice(article.children.indexOf(this) + 1, 0, x); },
    querySelector(sel) {
      if (sel === 'h1') return this.children.find(c => c.tag === 'h1') ?? null;
      return this.children.find(c => c.className.split(' ').includes(sel.slice(1))) ?? null;
    },
  });
  const article = el('article');
  article.children.push(el('h1'));
  return { article, createElement: el, querySelector: sel => (sel === 'article.md-content__inner' ? article : null) };
}

test('Edit is the theme\'s own "Edit this page" control, first in the article, pointing at the draft', () => {
  const doc = fakeDoc();
  const a = injectEditButton(doc, classifyKbPath('/pages/faqs/'));
  assert.equal(doc.article.children[0], a);
  assert.equal(a.tag, 'a');
  assert.equal(a.href, '/drafts/faqs/');
  assert.equal(a.attrs['aria-label'], 'Switch to edit mode');
  assert.equal(a.title, undefined, 'no title: the theme tooltip is drawn by kbSite.js, never the browser\'s');
  assert.ok(a.listeners.mouseenter, 'shows the theme tooltip on hover');
  assert.ok(a.className.startsWith('md-content__button md-icon'));
  assert.equal(injectEditButton(doc, classifyKbPath('/pages/faqs/')), null, 'never twice');
});

test('Edit log is the same theme control, ahead of Edit on a live page (so to its right) and first on a draft', () => {
  const live = fakeDoc();
  const page = classifyKbPath('/pages/faqs/');
  const edit = injectEditButton(live, page);
  const opened = [];
  const log = injectLogButton(live, page, (p, btn) => opened.push([p, btn]));
  assert.deepEqual(live.article.children.slice(0, 2), [log, edit]);
  assert.equal(log.className, 'md-content__button md-icon mb-kb-log');
  assert.equal(log.attrs['aria-label'], 'Edit log');
  let prevented = 0;
  log.listeners.click({ preventDefault: () => { prevented++; } });
  assert.equal(prevented, 1, 'never follows its href');
  assert.deepEqual(opened, [[page, log]]);
  assert.equal(injectLogButton(live, page), null, 'never twice');

  const draft = fakeDoc();
  const alone = injectLogButton(draft, classifyKbPath('/drafts/faqs/'), () => {});
  assert.equal(draft.article.children[0], alone);
});

test('a draft\'s own icons are the same theme control, either side of Edit log, and a disabled one does nothing', () => {
  const doc = fakeDoc();
  const clicks = [];
  const md = injectPageButton(doc, { cls: 'mb-kb-mdview', icon: 'file-code', title: 'Markdown view', onClick: () => clicks.push('markdown') });
  const log = injectLogButton(doc, classifyKbPath('/drafts/faqs/'), () => {});
  const del = injectPageButton(doc, { cls: 'mb-kb-delete', icon: 'trash-2', title: 'Delete draft', onClick: () => clicks.push('delete') });
  // They float right: first in the article is furthest right.
  assert.deepEqual(doc.article.children.slice(0, 3), [del, log, md]);
  for (const b of [del, md]) assert.ok(b.className.startsWith('md-content__button md-icon '));
  assert.equal(md.attrs['aria-label'], 'Markdown view');
  assert.equal(md.attrs['aria-haspopup'], undefined);
  assert.equal(log.attrs['aria-haspopup'], 'dialog');
  md.listeners.click({ preventDefault() {} });
  del.getAttribute = k => del.attrs[k];
  del.setAttribute('aria-disabled', 'true');
  del.listeners.click({ preventDefault() {} });
  assert.deepEqual(clicks, ['markdown']);
  assert.equal(injectPageButton(doc, { cls: 'mb-kb-delete', icon: 'trash-2', title: 'Delete draft', onClick() {} }), null, 'never twice');
});

test('the edit log popup script can be loaded by the page', () => {
  assert.ok(manifest.web_accessible_resources.some(w => w.resources.includes('scripts/kbEditLog.js')));
});

test('Create new draft sits under the reworded 404 heading, and cannot be double-clicked', async () => {
  const doc = fakeDoc();
  let calls = 0, release;
  const p = injectCreateDraftButton(doc, () => { calls++; return new Promise(r => { release = r; }); });
  assert.equal(doc.article.children[1], p, 'right after the h1');
  assert.equal(doc.article.children[0].textContent, 'This page has no draft yet', 'replaces the 404 heading');
  const btn = p.children.find(c => c.tag === 'a');
  assert.equal(btn.className, 'md-content__button md-icon', 'the theme\'s own edit control');
  assert.deepEqual(btn.children.map(c => c.textContent), ['Create new draft']);
  const first = btn.listeners.click();
  btn.listeners.click();
  assert.equal(calls, 1);
  release(); await first;
  assert.equal(btn.attrs['aria-disabled'], 'true'); // the fake has no removeAttribute
  btn.listeners.click();
  assert.equal(calls, 2, 'usable again once the first run ends');
});

test('no Knowledge Base buttons are left in the dock config', () => {
  assert.deepEqual(buttons.filter(b => b.host === 'kb' || b.kbState), []);
});

test('the extension\'s light / dark follows the site\'s scheme, not the system', () => {
  assert.equal(kbSchemeIsDark('dark', 'slate'), true);
  assert.equal(kbSchemeIsDark('light', 'default'), false);
  assert.equal(kbSchemeIsDark('normal', 'slate'), true, 'falls back to the scheme name');
  assert.equal(kbSchemeIsDark('normal', 'default'), false);
  assert.equal(kbSchemeIsDark('normal', null), null, 'unknown: left to the system');
  const css = read('../config/forms/formsStyling.css');
  assert.equal(css.match(/^@media \(prefers-color-scheme/gm).length, 1, 'only the one switch asks the system');
  assert.ok(css.includes('html.mb-kb-host[data-mb-theme="dark"]  { --mb-dark: 1; }'));
});

test('the site\'s 404 page is recognised by its heading', () => {
  const doc = text => ({ querySelector: sel => (sel === 'article h1' && text != null ? { textContent: text } : null) });
  assert.equal(isNotFoundPage(doc('404 - Not found')), true);
  assert.equal(isNotFoundPage(doc('Adding a new employee')), false);
  assert.equal(isNotFoundPage(doc(null)), false);
});

test('admin urls map to their screen, with or without the trailing slash', () => {
  assert.deepEqual(classifyAdminPath('/admin'), { route: 'home' });
  assert.deepEqual(classifyAdminPath('/admin/'), { route: 'home' });
  assert.deepEqual(classifyAdminPath('/admin/pages'), { route: 'pages' });
  assert.deepEqual(classifyAdminPath('/admin/pages/new/'), { route: 'pages/new' });
  // A media file's own page: the rest of the url is its path in the library.
  assert.deepEqual(classifyAdminPath('/admin/media-library/occ-captures/sites/overview/'), { route: 'media-library/file', file: 'occ-captures/sites/overview' });
  assert.deepEqual(classifyAdminPath('/admin/media-library/upload/'), { route: 'media-library/upload' });
  assert.deepEqual(classifyAdminPath('/admin/media-library/'), { route: 'media-library' });
  assert.equal(classifyAdminPath('/admin/pages/whatever/deep/'), null);
  assert.equal(classifyAdminPath('/admin/media-library/a/../b/'), null);
  assert.deepEqual(classifyAdminPath('/admin/media-library/'), { route: 'media-library' });
  assert.deepEqual(classifyAdminPath('/admin/media-library/upload'), { route: 'media-library/upload' });
  assert.deepEqual(classifyAdminPath('/admin/settings/'), { route: 'settings' });
});

test('every admin screen has a url that classifies back to it', () => {
  for (const [route, url] of Object.entries(ADMIN_ROUTES)) assert.deepEqual(classifyAdminPath(url), { route }, route);
});

test('nothing else is an admin url', () => {
  for (const path of ['/', '/administrator/', '/admin/unknown/', '/admin/pages/new/extra/', '/pages/admin/', '/admin/__proto__/', '/admin/toString', '', undefined]) {
    assert.equal(classifyAdminPath(path), null, String(path));
  }
  // An admin url is never a guide page, and the other way round.
  assert.equal(classifyKbPath('/admin/pages/'), null);
  assert.equal(classifyAdminPath('/pages/faqs/'), null);
});

test('the admin cog is the theme\'s header button, placed just left of the search, once', () => {
  const made = [];
  const search = { before(x) { header.order.splice(header.order.indexOf(search), 0, x); } };
  const header = {
    order: ['palette', search, 'ask'],
    querySelector(sel) {
      if (sel === '.mb-kb-admin-cog') return made.find(m => header.order.includes(m)) ?? null;
      return sel === 'label[for="__search"]' ? search : null;
    },
  };
  const doc = {
    querySelector: sel => (sel === '.md-header__inner' ? header : null),
    createElement: () => { const a = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {} }; made.push(a); return a; },
  };
  const cog = injectAdminCog(doc);
  assert.equal(cog.className, 'md-header__button md-icon mb-kb-admin-cog');
  assert.equal(cog.href, '/admin/');
  assert.equal(cog.attrs['aria-label'], 'Knowledge base admin');
  assert.equal(header.order.indexOf(cog), header.order.indexOf(search) - 1);
  assert.equal(injectAdminCog(doc), null, 'a second call adds nothing');
  assert.equal(injectAdminCog({ querySelector: () => null }), null, 'no header, no cog');
});

test('the admin scripts and stylesheet can be loaded by the page', () => {
  const scripts = manifest.web_accessible_resources.flatMap(w => w.resources);
  for (const name of ['kbAdmin', 'kbAdminPages', 'kbAdminMedia', 'kbAdminSettings']) {
    assert.ok(scripts.includes(`scripts/${name}.js`), name);
  }
  assert.ok(scripts.includes('config/forms/*'));
  assert.ok(read('../config/forms/kbAdmin.css').includes('html.mb-kb-admin'));
  // Every module a screen is loaded from, and every mount it names, exists.
  const admin = read('../scripts/kbAdmin.js');
  for (const [, file, mount] of admin.matchAll(/module: '(\w+\.js)', mount: '(\w+)'/g)) {
    assert.match(read(`../scripts/${file}`), new RegExp(`export async function ${mount}\\(`), `${file} ${mount}`);
  }
});

test('the manifest runs the extension on the Knowledge Base host', () => {
  const match = `https://${KB_HOST}/*`;
  assert.ok(manifest.host_permissions.includes(match));
  assert.ok(manifest.content_scripts.some(c => c.js.includes('scripts/content.js') && c.matches.includes(match)));
  for (const war of manifest.web_accessible_resources) assert.ok(war.matches.includes(match));
});

test('content.js keeps webapp dock buttons off the Knowledge Base', () => {
  const content = read('../scripts/content.js');
  assert.ok(content.includes(`location.hostname === '${KB_HOST}'`));
  assert.match(content, /const pageButtons = \(ON_KB_SITE \? \[\] : page\)/);
});

console.log(`\n${passed} passed`);
