/**
 * kbAdminMedia.js — /admin/media-library/ and /admin/media-library/upload/ on
 * the Knowledge Base site (see kbAdmin.js): the Media Library, as a page.
 *
 * The library mirrors docs/assets/media in the repo: every top-level folder is
 * a tab (mediaTree.js), a light/dark pair is one row. A row opens in place to
 * show the file, its details and the pages that use it (the .media-usage.json
 * index). Upload follows the Upload form's rules (mediaUpload.js): the pair
 * folders take a light + dark image, every other folder one file of any kind.
 */

import { readRepoText, readRepoDataUrl } from './repoClient.js';
import { parseNavBlock } from './navToml.js';
import { listMediaPaths, MEDIA_ROOT } from './mediaLibrary.js';
import { buildMediaNodes, groupMediaPaths } from './mediaTree.js';
import { readCaptureMeta } from './captureMeta.js';
import { readMediaUsage } from './mediaUsageStore.js';
import { pageBasesUsingMedia } from './mediaUsage.js';
import { OCC_DIR, SU_DIR, PAIR_DIRS, isSystemUpdateCapturePath, pairFilenames, shortId } from './captureDest.js';
import { readCaptureImage, readMediaFile, CAPTURE_UPLOAD_TYPES } from './captureCards.js';
import { snapshotButton, restoreButton } from './loading.js';
import { escapeHtml, icon, renderAdminTree, noticeHtml, busyAction } from './kbAdmin.js';

const IMAGE_EXTS = ['png', 'svg', 'jpg', 'jpeg', 'gif', 'webp'];
const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'm4v'];

// Kept while moving between admin screens.
const view = { tab: null, query: '' };
const collapsed = new Set();
let lastFolders = [];   // [{ key, label }] for the upload screen's Destination
let flash = '';         // a one-off notice for the library after an upload

/** A repo path under docs/ → where the built site serves it. */
const siteUrl = path => '/' + String(path).replace(/^docs\//, '').split('/').map(encodeURIComponent).join('/');

async function loadTabs() {
  const [paths, meta] = await Promise.all([listMediaPaths(), readCaptureMeta()]);
  const tabs = groupMediaPaths(paths, MEDIA_ROOT)
    .map(group => ({ ...group, nodes: buildMediaNodes(group.paths, { root: group.root }) }))
    .filter(tab => tab.nodes.length);
  return { tabs, meta };
}

// Which pages use a file: the usage index plus page titles from the nav.
let usagePromise = null;
function loadUsage() {
  usagePromise ??= Promise.all([readMediaUsage(), readRepoText('zensical.toml')]).then(([index, toml]) => {
    const titles = new Map();
    const live = new Set();
    const walk = (nodes, isLive) => {
      for (const n of nodes) {
        if (n.children) { walk(n.children, isLive); continue; }
        const base = String(n.value).split('/').pop();
        if (!titles.has(base)) titles.set(base, n.name);
        if (isLive) live.add(base);
      }
    };
    walk(parseNavBlock(toml, 'nav').items, true);
    walk(parseNavBlock(toml, 'unlisted_nav').items, true);
    walk(parseNavBlock(toml, 'draft_nav').items, false);
    return { index, titles, live };
  });
  usagePromise.catch(() => { usagePromise = null; });
  return usagePromise;
}

function pillsFor(entry, meta) {
  const pills = [];
  if (isSystemUpdateCapturePath(entry.light || entry.single)) pills.push('<span class="mb-adm-pill --system">System update</span>');
  if (meta?.resized) pills.push('<span class="mb-adm-pill --drafting">Resized</span>');
  if (meta?.padding > 0) pills.push(`<span class="mb-adm-pill --public">Padded: ${Number(meta.padding)}px</span>`);
  if (meta?.annotated) pills.push('<span class="mb-adm-pill --live">Annotated</span>');
  if (meta?.zapped) pills.push('<span class="mb-adm-pill --danger">Zapped</span>');
  pills.push(`<span class="mb-adm-pill --format">.${escapeHtml(entry.ext)}</span>`);
  return pills.join('');
}

function detailHtml(entry) {
  const files = [entry.light, entry.dark, entry.single].filter(Boolean);
  const figure = (path, caption, scheme) => `
    <figure class="mb-adm-figure${scheme ? ' --' + scheme : ''}">
      <div class="mb-adm-figure__frame"><img src="${escapeHtml(siteUrl(path))}" alt="${escapeHtml(caption)}" loading="lazy" data-adm-media="${escapeHtml(path)}"></div>
      <figcaption>${escapeHtml(caption)}</figcaption>
    </figure>`;
  let preview;
  if (VIDEO_EXTS.includes(entry.ext)) {
    preview = `<video class="mb-adm-video" controls preload="metadata" src="${escapeHtml(siteUrl(files[0]))}"></video>`;
  } else if (IMAGE_EXTS.includes(entry.ext)) {
    preview = entry.light
      ? `<div class="mb-adm-figures">${figure(entry.light, 'Light mode', 'light')}${entry.dark ? figure(entry.dark, 'Dark mode', 'dark') : ''}</div>`
      : `<div class="mb-adm-figures">${figure(entry.single, entry.label, '')}</div>`;
  } else {
    preview = '<p class="mb-adm-hint">This kind of file has no preview.</p>';
  }
  return `
    ${preview}
    <dl class="mb-adm-facts">
      ${files.map(path => `
        <div>
          <dt>${files.length > 1 ? (path === entry.light ? 'Light file' : 'Dark file') : 'File'}</dt>
          <dd>
            <code>${escapeHtml(path.replace(/^docs\//, ''))}</code>
            <button type="button" class="mb-adm-link" data-adm-copy="${escapeHtml(path.replace(/^docs\//, ''))}">Copy path</button>
            <a class="mb-adm-link" href="${escapeHtml(siteUrl(path))}" target="_blank" rel="noopener">Open</a>
          </dd>
        </div>`).join('')}
      <div>
        <dt>Used on</dt>
        <dd data-adm-usage="${escapeHtml(entry.id)}"><span class="mb-adm-hint">Checking the pages…</span></dd>
      </div>
    </dl>`;
}

export async function mountMedia(ctx) {
  let tabs;
  let meta;
  try {
    ({ tabs, meta } = await loadTabs());
  } catch (err) {
    ctx.body.innerHTML = noticeHtml('failure', 'The media library could not be loaded', err?.message ?? String(err));
    return null;
  }
  if (!ctx.alive()) return null;

  lastFolders = tabs.map(({ key, label }) => ({ key, label }));
  if (!tabs.some(t => t.key === view.tab)) view.tab = tabs[0]?.key ?? null;
  let openId = null;

  ctx.body.innerHTML = `
    <div data-adm-notice>${flash ? noticeHtml('success', flash, 'It shows on the site once the site has rebuilt, in a few minutes.') : ''}</div>
    <div class="mb-adm-tabs" role="tablist" aria-label="Media folders">
      ${tabs.map(t => `<button type="button" role="tab" data-adm-tab="${escapeHtml(t.key)}">${escapeHtml(t.label)}</button>`).join('')}
    </div>
    <div class="mb-adm-toolbar">
      <input type="search" class="mb-adm-input mb-adm-search" placeholder="Search files, or a path like sites/overview" aria-label="Search media">
      <span class="mb-adm-summary" data-adm-summary aria-live="polite"></span>
    </div>
    <div data-adm-tree></div>`;
  flash = '';

  const treeEl = ctx.body.querySelector('[data-adm-tree]');
  const searchEl = ctx.body.querySelector('.mb-adm-search');
  searchEl.value = view.query;
  const entries = new Map();   // leaf id → entry, for the open row and its usage

  // mediaTree nodes → renderAdminTree nodes.
  const convert = (nodes, tab, trail = []) => nodes.map(node => {
    if (node.kind === 'folder') {
      const labels = [...trail, node.label];
      return { id: `f:${tab.key}/${labels.join('/')}`, label: node.label, children: convert(node.children, tab, labels) };
    }
    const a = node.attrs;
    const entry = {
      id: a['data-media-light'] || a['data-media-single'] || a['data-media-dark'],
      label: node.label,
      light: a['data-media-light'], dark: a['data-media-dark'], single: a['data-media-single'],
      ext: a['data-media-ext'],
    };
    entries.set(entry.id, entry);
    const open = entry.id === openId;
    return {
      id: entry.id, label: node.label, open,
      icon: VIDEO_EXTS.includes(entry.ext) ? 'film' : IMAGE_EXTS.includes(entry.ext) ? 'image' : 'file',
      pills: pillsFor(entry, PAIR_DIRS.includes(tab.key) ? meta[entry.light] : null),
      detail: open ? detailHtml(entry) : '',
    };
  });

  async function fillUsage(id) {
    const entry = entries.get(id);
    const slot = () => treeEl.querySelector(`[data-adm-usage="${CSS.escape(id)}"]`);
    if (!entry || !slot()) return;
    try {
      const { index, titles, live } = await loadUsage();
      const el = slot();
      if (!el) return;
      const bases = [...pageBasesUsingMedia(index, [entry.light, entry.dark, entry.single].filter(Boolean))];
      if (!bases.length) { el.innerHTML = '<span class="mb-adm-hint">No page uses this file.</span>'; return; }
      el.innerHTML = `<ul class="mb-adm-usage">${bases
        .map(base => ({ base, title: titles.get(base) ?? base.replace(/\.md$/, '') }))
        .sort((a, b) => a.title.localeCompare(b.title))
        .map(({ base, title }) => {
          const slug = encodeURIComponent(base.replace(/\.md$/, ''));
          return `<li><a href="/${live.has(base) ? 'pages' : 'drafts'}/${slug}/">${escapeHtml(title)}</a></li>`;
        }).join('')}</ul>`;
    } catch {
      const el = slot();
      if (el) el.innerHTML = '<span class="mb-adm-hint">The pages using this file could not be checked.</span>';
    }
  }

  function draw() {
    ctx.body.querySelectorAll('[data-adm-tab]').forEach(b => {
      const on = b.dataset.admTab === view.tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    const tab = tabs.find(t => t.key === view.tab);
    entries.clear();
    const out = renderAdminTree(tab ? convert(tab.nodes, tab) : [], {
      query: view.query, collapsed,
      empty: 'No media yet. Upload the first file with the button above.',
    });
    treeEl.innerHTML = out.html;
    ctx.body.querySelector('[data-adm-summary]').textContent = view.query.trim()
      ? `${out.shown} of ${out.total}`
      : `${out.total} ${out.total === 1 ? 'file' : 'files'}`;
    if (openId) fillUsage(openId);
  }

  ctx.body.addEventListener('input', e => {
    if (e.target === searchEl) { view.query = searchEl.value; draw(); }
  });
  ctx.body.addEventListener('click', async e => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    const tab = t.closest('[data-adm-tab]');
    if (tab) { view.tab = tab.dataset.admTab; openId = null; draw(); return; }
    const copy = t.closest('[data-adm-copy]');
    if (copy) {
      try {
        await navigator.clipboard.writeText(copy.dataset.admCopy);
        copy.textContent = 'Copied';
      } catch { copy.textContent = 'Could not copy'; }
      setTimeout(() => { copy.textContent = 'Copy path'; }, 1600);
      return;
    }
    const fold = t.closest('[data-adm-fold]');
    if (fold) {
      const id = fold.dataset.admFold;
      if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
      draw();
      treeEl.querySelector(`[data-adm-fold="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
      return;
    }
    const leaf = t.closest('[data-adm-leaf]');
    if (leaf) {
      const id = leaf.dataset.admLeaf;
      openId = openId === id ? null : id;
      draw();
      treeEl.querySelector(`[data-adm-leaf="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
    }
  });
  // A file pushed moments ago is not on the built site yet: read it from the
  // repo instead (once per image).
  treeEl.addEventListener('error', async e => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.admMedia || img.dataset.admRetried) return;
    img.dataset.admRetried = '1';
    try { img.src = await readRepoDataUrl(img.dataset.admMedia); } catch { /* the broken image stands */ }
  }, true);

  ctx.setActions([[{ act: 'upload', icon: 'upload', label: 'Upload a new file' }]], () => ctx.go('media-library/upload'));
  draw();
  return null;
}

// ── /admin/media-library/upload/ ─────────────────────────────────────────────

export async function mountUpload(ctx) {
  let folders = lastFolders;
  if (!folders.length) {
    // Opened directly: the folders have to be read first.
    try { folders = (await loadTabs()).tabs.map(({ key, label }) => ({ key, label })); } catch { folders = []; }
    if (!ctx.alive()) return null;
  }
  if (!folders.length) folders = [{ key: OCC_DIR, label: 'Occ Captures' }];
  let dest = folders.some(f => f.key === view.tab) ? view.tab : folders[0].key;
  const picked = { light: null, dark: null, single: null };   // { ext, dataUrl }
  let busy = false;
  let touched = false;

  const isPair = () => PAIR_DIRS.includes(dest);
  const isFrozen = () => dest === SU_DIR;
  const accept = Object.keys(CAPTURE_UPLOAD_TYPES).map(e => '.' + e).join(',');

  const fileField = (name, label, imagesOnly) => `
    <div class="mb-adm-field">
      <label for="mb-adm-file-${name}">${label}</label>
      <input id="mb-adm-file-${name}" class="mb-adm-file" type="file" data-adm-file="${name}"${imagesOnly ? ` accept="${accept}"` : ''}>
      <p class="mb-adm-error" data-adm-error="${name}" hidden></p>
    </div>`;

  function drawForm() {
    ctx.body.innerHTML = `
      <div data-adm-notice></div>
      <form class="mb-adm-form" novalidate>
        <div class="mb-adm-field">
          <label for="mb-adm-dest">Destination</label>
          <select id="mb-adm-dest" class="mb-adm-input" name="dest">
            ${folders.map(f => `<option value="${escapeHtml(f.key)}"${f.key === dest ? ' selected' : ''}>${escapeHtml(f.label)}</option>`).join('')}
          </select>
        </div>
        <div class="mb-adm-field">
          <label for="mb-adm-upload-path">${isPair() ? 'Capture path' : 'File path'}</label>
          <input id="mb-adm-upload-path" class="mb-adm-input" type="text" name="path" autocomplete="off" spellcheck="false" placeholder="${isFrozen() ? 'overview' : isPair() ? 'sites/overview' : 'training/intro'}">
          <p class="mb-adm-hint">${isFrozen()
            ? 'A file name only: no folders, no extension. A short id, the theme suffixes and the extension are added for you. System update captures are frozen: never recaptured or replaced.'
            : isPair()
              ? 'Folder path and file name, without an extension. <code>sites/overview</code> is saved as <code>sites/overview-light-mode.svg</code> and <code>sites/overview-dark-mode.svg</code>.'
              : `Folder path and file name inside ${escapeHtml(dest)}, without an extension: it is taken from the file you choose.`}</p>
          <p class="mb-adm-error" data-adm-error="path" hidden></p>
        </div>
        ${isPair()
          ? fileField('light', 'Light mode image', true) + fileField('dark', 'Dark mode image', true)
          : fileField('single', 'File', false)}
        <div class="mb-adm-figures" data-adm-previews></div>
      </form>`;
  }

  const setError = (name, text) => {
    const el = ctx.body.querySelector(`[data-adm-error="${name}"]`);
    if (!el) return;
    el.textContent = text;
    el.hidden = !text;
  };

  function drawPreviews() {
    const box = ctx.body.querySelector('[data-adm-previews]');
    const fig = (file, caption, scheme) => (file && CAPTURE_UPLOAD_TYPES[file.ext]
      ? `<figure class="mb-adm-figure${scheme ? ' --' + scheme : ''}"><div class="mb-adm-figure__frame"><img src="${file.dataUrl}" alt="${caption}"></div><figcaption>${caption}</figcaption></figure>`
      : '');
    box.innerHTML = isPair()
      ? fig(picked.light, 'Light mode', 'light') + fig(picked.dark, 'Dark mode', 'dark')
      : fig(picked.single, 'Preview', '');
  }

  const basePath = () => (ctx.body.querySelector('[name="path"]')?.value ?? '').trim().replace(/^\/+|\/+$/g, '');

  function validate() {
    const base = basePath();
    const errors = { path: '', light: '', dark: '', single: '' };
    if (!base) errors.path = isPair() ? 'Enter a capture path.' : 'Enter a file path.';
    else if (isFrozen() && base.includes('/')) errors.path = 'System update captures live in one flat folder: enter a file name without folders.';
    if (isPair()) {
      if (!picked.light) errors.light = 'Choose the light mode image.';
      if (!picked.dark) errors.dark = 'Choose the dark mode image.';
      else if (picked.light && picked.light.ext !== picked.dark.ext) errors.dark = 'Both images must be the same type: two PNGs or two SVGs.';
    } else if (!picked.single) {
      errors.single = 'Choose a file to upload.';
    }
    for (const [name, text] of Object.entries(errors)) setError(name, text);
    return !Object.values(errors).some(Boolean);
  }

  async function savePair(base, progress) {
    const { githubPathExists } = await import('./github.js');
    const { pushCaptures, overwriteCapturePair } = await import('./captures.js');
    const finalBase = isFrozen() ? `${base}-${shortId()}` : base;
    const { lightFilename, darkFilename } = pairFilenames(dest, finalBase, picked.light.ext);
    const lightPath = `docs/assets/${lightFilename}`;
    const darkPath = `docs/assets/${darkFilename}`;
    // pushCaptures only creates: an existing path has to be an explicit overwrite.
    const [lightExists, darkExists] = await Promise.all([githubPathExists(lightPath), githubPathExists(darkPath)]);
    const capture = { lightDataUrl: picked.light.dataUrl, darkDataUrl: picked.dark.dataUrl, lightFilename, darkFilename };
    if (lightExists || darkExists) {
      if (!window.confirm(`A capture is already stored at ${base}. Replace it with these images? Every page that uses it will show the new ones.`)) return false;
      await overwriteCapturePair({ lightPath, darkPath, lightExists, darkExists, capture, onProgress: progress });
    } else {
      await pushCaptures([capture], progress);
    }
    return true;
  }

  async function saveSingle(base, progress) {
    const { githubPathExists, githubReplaceImage, githubPushImageIfNotExists } = await import('./github.js');
    const { ext, dataUrl } = picked.single;
    const path = `${MEDIA_ROOT}/${dest}/${base}.${ext}`;
    const base64 = dataUrl.split(',')[1];
    if (await githubPathExists(path)) {
      if (!window.confirm(`${base}.${ext} already exists in ${dest}. Replace it? Every page that uses it will show the new file.`)) return false;
      await githubReplaceImage(path, base64, progress);
    } else {
      await githubPushImageIfNotExists(path, base64, progress);
    }
    return true;
  }

  async function save(btn) {
    if (busy || !validate()) return;
    busy = true;
    const noticeEl = ctx.body.querySelector('[data-adm-notice]');
    noticeEl.innerHTML = '';
    const snap = snapshotButton(btn);
    busyAction(btn, 'Uploading…');
    const progress = s => busyAction(btn, s);
    try {
      const base = basePath();
      const done = isPair() ? await savePair(base, progress) : await saveSingle(base, progress);
      if (!done) { restoreButton(btn, snap); busy = false; return; }
      touched = false;
      view.tab = dest;
      flash = `${base} was uploaded`;
      ctx.go('media-library', { force: true });
    } catch (err) {
      busy = false;
      restoreButton(btn, snap);
      noticeEl.innerHTML = noticeHtml('failure', 'The file could not be uploaded', err?.message ?? String(err));
    }
  }

  ctx.body.addEventListener('input', e => {
    if (e.target.name === 'path') { touched = true; setError('path', ''); }
  });
  ctx.body.addEventListener('change', async e => {
    const t = e.target;
    if (t.name === 'dest') {
      dest = t.value;
      picked.light = picked.dark = picked.single = null;
      drawForm();
      return;
    }
    const slot = t.dataset?.admFile;
    if (!slot) return;
    touched = true;
    const file = t.files?.[0];
    try {
      picked[slot] = !file ? null : slot === 'single' ? await readMediaFile(file) : await readCaptureImage(file);
      setError(slot, '');
    } catch (err) {
      picked[slot] = null;
      t.value = '';
      setError(slot, err?.message ?? 'That file could not be read.');
    }
    drawPreviews();
  });
  ctx.body.addEventListener('submit', e => { e.preventDefault(); save(ctx.actionButton('upload')); });

  ctx.setActions([
    [{ act: 'upload', icon: 'upload', label: 'Upload', colour: 'accent' }],
    [{ act: 'cancel', icon: 'x', label: 'Cancel' }],
  ], (act, btn) => {
    if (act === 'upload') save(btn);
    else if (!busy) ctx.go('media-library');
  }, { at: 'end' });
  drawForm();

  const dirty = () => touched && !busy;
  return {
    isDirty: dirty,
    canLeave: () => !dirty() || window.confirm('Leave without uploading this file?'),
  };
}
