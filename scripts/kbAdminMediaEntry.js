/**
 * kbAdminMediaEntry.js — /admin/media-library/<folder>/<path>/ on the
 * Knowledge Base site (see kbAdmin.js): one media file's own page.
 *
 * The url is the file's path in the library (kbMediaEntry.js): a file has no
 * other identity. The page shows where it is stored, what it looks like and
 * the pages that use it, and is where it is changed:
 *
 *   Recapture           a .png capture pair: taken again on the webapp, in
 *                       another tab (kbCaptureClient.js → kbSiteCapture.js,
 *                       whose page shows old beside new and does the replacing)
 *   Replace via upload  pick the new file(s), see them under the stored ones, save
 *   Delete              only while no page uses the file
 *
 * None of them can move or rename the file: they overwrite the stored paths.
 * System update captures are frozen: they can only be deleted.
 *
 * The page is one of four states (view, pick, tabs, capturing). What is stored
 * stays on the page through all of them ("Preview", then "Current preview"):
 * the group under it and the buttons are what change.
 */

import { readRepoDataUrl } from './repoClient.js';
import { readCaptureMeta, writeCaptureMeta } from './captureMeta.js';
import { pageBasesUsingMedia } from './mediaUsage.js';
import { PAIR_DIRS, isSystemUpdateCapturePath } from './captureDest.js';
import { readCaptureImage, readMediaFile, CAPTURE_UPLOAD_TYPES } from './captureCards.js';
import { snapshotButton, restoreButton } from './loading.js';
import { findMediaEntry, mediaEntryActions, dataUrlBytes, dataUrlSize, sameBytes } from './kbMediaEntry.js';
import { captureTabChoices, captureTabPick } from './kbCaptureTabs.js';
import { listCaptureTabs, startCaptureSession } from './kbCaptureClient.js';
import { escapeHtml, icon, noticeHtml, busyAction } from './kbAdmin.js';
import {
  loadTabs, loadUsage, resetUsage, entriesOf, pillsFor, siteUrl, setFlash, IMAGE_EXTS, VIDEO_EXTS,
} from './kbAdminMedia.js';

const RECHECK_MS = 20000;            // how often the site is asked again while it is behind
const RECHECK_FOR_MS = 30 * 60000;   // and for how long: a build that has not landed by then is not coming
const sitePath = path => String(path).replace(/^docs\//, '');

export async function mountMediaEntry(ctx) {
  const key = ctx.params.file ?? '';
  const backLink = '<p><a href="/admin/media-library/" data-adm-route="media-library">Back to the media library</a></p>';

  let entry;
  let meta;
  try {
    const loaded = await loadTabs();
    if (!ctx.alive()) return null;
    entry = findMediaEntry(entriesOf(loaded.tabs), key);
    meta = loaded.meta;
  } catch (err) {
    if (ctx.alive()) ctx.body.innerHTML = noticeHtml('failure', 'The media library could not be loaded', err?.message ?? String(err));
    return null;
  }
  if (!entry) {
    ctx.setTitle('File not found');
    ctx.body.innerHTML = noticeHtml('failure', 'This file is not in the media library', 'It may have been deleted or renamed.') + backLink;
    return null;
  }

  const files = [entry.light, entry.dark, entry.single].filter(Boolean);
  const isVideo = VIDEO_EXTS.includes(entry.ext);
  const isImage = IMAGE_EXTS.includes(entry.ext);
  const inPairDir = PAIR_DIRS.includes(entry.tab) && !!entry.light;   // has a capture manifest entry
  const frozen = isSystemUpdateCapturePath(files[0]);
  const name = key.split('/').slice(1).join('/') || key;
  ctx.setTitle(name);

  let mode = 'view';            // view | pick | tabs | capturing
  let unused = false;           // true only once the usage index says no page uses the file
  let busy = false;
  let session = null;           // the running recapture ({ focus, cancel })
  let split = true;             // the capturing tab stands beside this one
  let tabChoices = [];
  const picked = {};            // slot → { ext, dataUrl }, while replacing by upload
  // The images as the repo holds them now (read when the page opens, and kept
  // from a replace): the built site serves the old file until it has rebuilt.
  const fresh = new Map();      // repo path → data url

  ctx.body.innerHTML = `
    <div class="mb-adm-entry">
      <div class="mb-adm-pills mb-adm-entry__pills" data-adm-pills></div>
      <div class="mb-adm-pending" data-adm-pending role="status" hidden>
        <span class="mb-adm-pending__spin">${icon('loader-circle')}</span>
        <span class="mb-adm-pending__text"><strong>A change to this resource is being propagated</strong><span>It may take a few minutes for this update to apply to the live site</span></span>
      </div>
      <div data-adm-notice></div>
      <div class="mb-adm-field">
        <span class="mb-adm-field__label" data-adm-preview-label>Preview</span>
        <div data-adm-preview></div>
      </div>
      <div class="mb-adm-field" data-adm-stage hidden></div>
      <div class="mb-adm-field" data-adm-new hidden></div>
      <div class="mb-adm-field" data-adm-files>
        <span class="mb-adm-field__label">${files.length > 1 ? 'Files' : 'File'}</span>
        ${files.map(path => `
          <div class="mb-adm-entry__file">
            <code>${escapeHtml(sitePath(path))}</code>
            <button type="button" class="mb-adm-link" data-adm-copy="${escapeHtml(sitePath(path))}">Copy path</button>
            <a class="mb-adm-link" href="${escapeHtml(siteUrl(path))}" target="_blank" rel="noopener">Open</a>
          </div>`).join('')}
        ${frozen ? '<p class="mb-adm-hint">System update captures are frozen: never recaptured or replaced.</p>' : ''}
      </div>
      <div class="mb-adm-field" data-adm-used>
        <span class="mb-adm-field__label">Used on</span>
        <div data-adm-usage><span class="mb-adm-hint">Checking the pages…</span></div>
      </div>
    </div>`;

  const $ = sel => ctx.body.querySelector(sel);
  const stage = $('[data-adm-stage]');
  const noticeEl = $('[data-adm-notice]');
  const notice = html => { noticeEl.innerHTML = html; };

  const drawPills = () => { $('[data-adm-pills]').innerHTML = pillsFor(entry, inPairDir ? meta?.[entry.light] : null); };

  // ── Previews ───────────────────────────────────────────────────────────────

  const srcOf = path => fresh.get(path) ?? siteUrl(path);
  const figure = (src, caption, scheme, path = '') => `
    <figure class="mb-adm-figure${scheme ? ' --' + scheme : ''}">
      <div class="mb-adm-figure__frame"><img${src ? ` src="${escapeHtml(src)}"` : ' class="--waiting"'} alt="${escapeHtml(caption)}"${path ? ` data-adm-media="${escapeHtml(path)}"` : ''}></div>
      <figcaption>${escapeHtml(caption)}</figcaption>
    </figure>`;
  const player = (src, caption) => `
    <figure class="mb-adm-figure">
      <video class="mb-adm-video" controls preload="metadata" src="${escapeHtml(src)}"></video>
      ${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''}
    </figure>`;

  // The stored file(s).
  function storedHtml() {
    if (isVideo) return files.map(path => player(srcOf(path), files.length > 1 ? (path === entry.light ? 'Light mode' : 'Dark mode') : '')).join('');
    if (!isImage) return '';
    if (entry.light) {
      return figure(fresh.get(entry.light), 'Light mode', 'light', entry.light)
        + (entry.dark ? figure(fresh.get(entry.dark), 'Dark mode', 'dark', entry.dark) : '');
    }
    return figure(fresh.get(files[0]), entry.label, '', files[0]);
  }

  // Drawn when the page opens and when the stored files change, not per state:
  // a video keeps its place, an image is not fetched again.
  function drawPreview() {
    const shown = storedHtml();
    $('[data-adm-preview]').innerHTML = shown
      ? `<div class="mb-adm-figures">${shown}</div>`
      : '<p class="mb-adm-hint">This kind of file has no preview.</p>';
    const reads = isImage ? files.filter(path => !fresh.has(path)).map(showStored) : [];
    Promise.all(reads).then(() => watchSite());
  }

  // ── Is the site behind? ────────────────────────────────────────────────────
  // What the repo holds (`fresh`) against what the site serves. While they
  // differ a change is still on its way through the build: the page says so,
  // and asks again until they agree. An image is compared whole (the repo's
  // copy is read when the page opens); anything else only after it was
  // replaced here, and by its size (a video is too large to fetch on a timer).

  async function siteBehind(path) {
    const mine = fresh.get(path);
    if (!mine) return false;
    try {
      if (isImage) {
        const res = await fetch(siteUrl(path), { cache: 'no-store' });
        if (res.status === 404) return true;   // a new file the site has not got yet
        if (!res.ok) return false;
        return !sameBytes(dataUrlBytes(mine), new Uint8Array(await res.arrayBuffer()));
      }
      const res = await fetch(siteUrl(path), { method: 'HEAD', cache: 'no-store' });
      if (res.status === 404) return true;
      const size = Number(res.headers.get('content-length'));
      return res.ok && size > 0 && size !== dataUrlSize(mine);
    } catch { return false; }   // not known: say nothing
  }

  let watch = null;       // the timer for the next look
  let watchUntil = 0;
  const pendingEl = $('[data-adm-pending]');
  async function watchSite(restart = true) {
    clearTimeout(watch);
    if (restart) watchUntil = Date.now() + RECHECK_FOR_MS;
    const behind = (await Promise.all(files.map(siteBehind))).some(Boolean);
    if (!ctx.alive()) return;
    pendingEl.hidden = !behind;
    clearTimeout(watch);
    if (behind && Date.now() < watchUntil) watch = setTimeout(() => watchSite(false), RECHECK_MS);
  }

  // An image is shown as the repo holds it, not as the built site serves it:
  // after a recapture the site is minutes behind (and the browser may hold the
  // old file longer). Its frame waits empty for the read; only if the repo
  // cannot be read, or its copy does not draw, is the site's shown instead.
  async function showStored(path) {
    try { fresh.set(path, await readRepoDataUrl(path)); } catch { /* the site's copy, below */ }
    const el = ctx.alive() ? $(`[data-adm-preview] img[data-adm-media="${CSS.escape(path)}"]`) : null;
    if (!el) return;
    el.dataset.admRetried = '1';   // the retry below stays out of it
    el.onerror = () => { el.onerror = null; fresh.delete(path); el.src = siteUrl(path); };
    el.src = fresh.get(path) ?? siteUrl(path);
    el.classList.remove('--waiting');
  }

  // The upload slots: one per stored file.
  const slots = entry.light
    ? [['light', 'Light mode'], ...(entry.dark ? [['dark', 'Dark mode']] : [])]
    : [['single', 'New file']];
  const ready = () => slots.every(([slot]) => picked[slot]);   // every new file is chosen

  const label = text => `<span class="mb-adm-field__label">${text}</span>`;

  // What was picked to replace the stored files, under them.
  function drawNew() {
    const el = $('[data-adm-new]');
    const any = mode === 'pick' && slots.some(([slot]) => picked[slot]);
    el.hidden = !any;
    if (!any) { el.innerHTML = ''; return; }
    const shown = slots.map(([slot, text]) => {
      const file = picked[slot];
      if (!file) return '';
      if (isVideo) return player(file.dataUrl, text);
      return isImage ? figure(file.dataUrl, text, slot === 'single' ? '' : slot) : '';
    }).join('');
    el.innerHTML = label('New preview') + (shown
      ? `<div class="mb-adm-figures">${shown}</div>`
      : '<p class="mb-adm-hint">This kind of file has no preview. Save to replace the stored file with the one you chose.</p>');
  }

  // ── The group under the preview, per state ─────────────────────────────────

  function drawStage() {
    stage.hidden = mode === 'view';
    if (mode === 'view') {
      stage.innerHTML = '';
    } else if (mode === 'pick') {
      stage.innerHTML = label('Replace via upload')
        + `<p class="mb-adm-hint mb-adm-entry__lead">The new ${slots.length > 1 ? 'files take' : 'file takes'} the place of the stored ${slots.length > 1 ? 'ones' : 'one'}, at the same path. Only .${escapeHtml(entry.ext)} files: a replacement keeps the file's type.</p>`
        + slots.map(([slot, text]) => `
          <div class="mb-adm-entry__slot">
            <label for="mb-adm-replace-${slot}">${slot === 'single' ? 'New file' : `${text} image`}</label>
            <input id="mb-adm-replace-${slot}" class="mb-adm-file" type="file" data-adm-file="${slot}" accept=".${escapeHtml(entry.ext)}">
            <p class="mb-adm-error" data-adm-error="${slot}" hidden></p>
          </div>`).join('');
    } else if (mode === 'tabs') {
      stage.innerHTML = label('Recapture')
        + '<p class="mb-adm-hint mb-adm-entry__lead">Where is the thing to capture? The capture is taken there and replaces this one, at the same path.</p>'
        + `<div class="mb-adm-entry__choices">${tabChoices.map(c =>
          `<button type="button" class="mb-adm-button" data-adm-tabpick="${escapeHtml(c.id)}"${c.disabled ? ' disabled' : ''}>${escapeHtml(c.label)}</button>`).join('')}</div>`;
    } else {
      // The draft editor's own "Capture in progress" box (kbPageEditor
      // drawCaptureWait): its body brings the capturing tab back, its red end
      // calls the capture off.
      stage.innerHTML = `
        <div class="mb-adm-capwait" role="status">
          <button type="button" class="mb-adm-capwait__main" data-adm-capture="focus">
            <span class="mb-adm-capwait__spin">${icon('loader-circle')}</span>
            <span class="mb-adm-capwait__text"><strong>Capture in progress</strong><span class="mb-adm-capwait__hint"${split ? ' hidden' : ''}>Click to continue capture</span></span>
          </button>
          <button type="button" class="mb-adm-capwait__cancel" data-adm-capture="cancel" aria-label="Cancel this capture">${icon('x')}<span class="mb-adm-capwait__cancel-label">Cancel</span></button>
        </div>`;
    }
  }

  // The capture is past calling off: the other tab is already storing it.
  function lockCaptureWait() {
    const el = stage.querySelector('.mb-adm-capwait');
    if (!el) return;
    el.classList.add('--inserting');
    el.querySelector('strong').textContent = 'Replacing capture';
    el.querySelector('.mb-adm-capwait__hint')?.remove();
    el.querySelector('.mb-adm-capwait__cancel')?.remove();
    el.querySelector('.mb-adm-capwait__main').disabled = true;
  }

  function drawActions() {
    const can = mediaEntryActions({ entry, frozen, unused });
    if (mode === 'view') {
      ctx.setActions([
        [
          can.recapture && { act: 'recapture', icon: 'rotate-ccw', label: 'Recapture', iconOnly: true },
          can.replace && { act: 'replace', icon: 'upload', label: 'Replace via upload', iconOnly: true },
        ].filter(Boolean),
        can.remove ? [{ act: 'delete', icon: 'trash-2', label: 'Delete' }] : [],
      ], onAct);
    } else if (mode === 'pick' && ready()) {
      ctx.setActions([
        [{ act: 'save', icon: 'save', label: 'Save changes', colour: 'accent' }],
        [{ act: 'cancel', icon: 'x', label: 'Cancel' }],
      ], onAct, { at: 'end' });
    } else if (mode === 'capturing') {
      ctx.setActions(null);   // the box itself is the way back and the way out
    } else {
      ctx.setActions([[{ act: 'cancel', icon: 'x', label: 'Cancel' }]], onAct, { at: 'end' });
    }
  }

  function draw() {
    drawStage();
    drawNew();
    drawActions();
    $('[data-adm-preview-label]').textContent = mode === 'view' ? 'Preview' : 'Current preview';
    // While the file is being changed the page is the preview and the change: the paths and the pages list wait.
    $('[data-adm-files]').hidden = mode !== 'view';
    $('[data-adm-used]').hidden = mode !== 'view';
  }

  function setMode(next) {
    mode = next;
    if (next !== 'pick') for (const slot of Object.keys(picked)) delete picked[slot];
    draw();
  }

  // ── Used on ────────────────────────────────────────────────────────────────

  async function fillUsage() {
    const el = $('[data-adm-usage]');
    try {
      const { index, titles, live } = await loadUsage();
      if (!ctx.alive()) return;
      const bases = [...pageBasesUsingMedia(index, files)];
      unused = bases.length === 0;
      el.innerHTML = unused
        ? '<span class="mb-adm-hint">No page uses this file.</span>'
        : `<ul class="mb-adm-usage">${bases
          .map(base => ({ base, title: titles.get(base) ?? base.replace(/\.md$/, '') }))
          .sort((a, b) => a.title.localeCompare(b.title))
          .map(({ base, title }) => {
            const slug = encodeURIComponent(base.replace(/\.md$/, ''));
            return `<li><a href="/${live.has(base) ? 'pages' : 'drafts'}/${slug}/">${escapeHtml(title)}</a></li>`;
          }).join('')}</ul>`;
    } catch {
      if (!ctx.alive()) return;
      unused = false;   // not known: the file stays
      el.innerHTML = '<span class="mb-adm-hint">The pages using this file could not be checked.</span>';
    }
    if (mode === 'view') drawActions();
  }

  // ── Replace via upload ─────────────────────────────────────────────────────

  const setError = (slot, text) => {
    const el = stage.querySelector(`[data-adm-error="${slot}"]`);
    if (!el) return;
    el.textContent = text;
    el.hidden = !text;
  };

  async function readPicked(file) {
    // Pairs of captures are checked by what the file is; anything else by its name.
    if (CAPTURE_UPLOAD_TYPES[entry.ext]) return readCaptureImage(file, [entry.ext]);
    const read = await readMediaFile(file);
    if (read.ext !== entry.ext) throw new Error(`Choose a .${entry.ext} file: a replacement keeps the file's type.`);
    return read;
  }

  async function save(btn) {
    if (busy) return;
    busy = true;
    notice('');
    const snap = snapshotButton(btn);
    busyAction(btn, 'Saving…');
    const progress = text => busyAction(btn, text || 'Saving…');
    try {
      const { githubReplaceImage } = await import('./github.js');
      const pathOf = { light: entry.light, dark: entry.dark, single: entry.single };
      for (const [slot] of slots) {
        await githubReplaceImage(pathOf[slot], picked[slot].dataUrl.split(',')[1], progress);
        fresh.set(pathOf[slot], picked[slot].dataUrl);
      }
      if (inPairDir) {
        // An uploaded image carries none of a capture's facts: the entry is cleared.
        await writeCaptureMeta([{ lightPath: entry.light, resized: false, padding: 0, annotated: false, zapped: false }], progress);
        if (meta) delete meta[entry.light];
      }
      busy = false;
      if (!ctx.alive()) return;   // left while it saved: this screen is no longer the one showing
      drawPills();
      drawPreview();
      setMode('view');
      pendingEl.hidden = false;   // known without asking: it was stored a moment ago
    } catch (err) {
      busy = false;
      if (!ctx.alive()) return;
      restoreButton(btn, snap);
      notice(noticeHtml('failure', 'The file could not be replaced', err?.message ?? String(err)));
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  async function remove(btn) {
    if (busy) return;
    busy = true;
    notice('');
    const snap = snapshotButton(btn);
    const stop = html => { busy = false; if (!ctx.alive()) return; restoreButton(btn, snap); if (html) notice(html); };
    busyAction(btn, 'Checking the pages…');
    // The button was drawn from the index as it was when the page opened: look again.
    try {
      resetUsage();
      const { index } = await loadUsage();
      if (pageBasesUsingMedia(index, files).size) {
        stop(noticeHtml('failure', 'This file is now in use', 'A page uses it, so it was not deleted.'));
        fillUsage();
        return;
      }
    } catch {
      stop(noticeHtml('failure', 'The file was not deleted', 'The pages using it could not be checked. Try again in a moment.'));
      return;
    }
    const plural = files.length > 1 ? 's' : '';
    if (!window.confirm(`Delete ${name}? This permanently removes the file${plural} from GitHub and cannot be undone.`)) { stop(''); return; }
    try {
      const { githubDeleteFile } = await import('./github.js');
      const progress = text => busyAction(btn, text || 'Deleting…');
      progress('');
      for (const path of files) await githubDeleteFile(path, progress);
      if (inPairDir) await writeCaptureMeta([{ lightPath: entry.light, resized: false, padding: 0, annotated: false, zapped: false }], progress);
      busy = false;
      if (!ctx.alive()) return;
      setFlash(`${name} was deleted`, 'It leaves the site once the site has rebuilt, in a few minutes.');
      ctx.go('media-library', { force: true });
    } catch (err) {
      stop(noticeHtml('failure', 'The file could not be deleted', err?.message ?? String(err)));
    }
  }

  // ── Recapture ──────────────────────────────────────────────────────────────

  async function chooseTab() {
    notice('');
    const { tabs, hasLast } = await listCaptureTabs();
    if (!ctx.alive() || mode !== 'view') return;
    tabChoices = captureTabChoices(tabs, hasLast);
    setMode('tabs');
  }

  async function recapture(pick) {
    if (session || busy) return;
    busy = true;
    split = true;
    setMode('capturing');
    const res = await startCaptureSession({
      ...pick,
      recapture: { lightPath: entry.light, darkPath: entry.dark ?? null },
      onSplit: now => {
        split = now;
        const hint = stage.querySelector('.mb-adm-capwait__hint');
        if (hint) hint.hidden = now;
      },
      onEnd: () => { session = null; if (ctx.alive()) setMode('view'); },
      onDeliver: async () => {
        session = null;
        if (!ctx.alive()) return;
        // The new files are in the repo, not yet on the built site: show them from there.
        const [light, dark, nextMeta] = await Promise.all([
          readRepoDataUrl(entry.light).catch(() => null),
          entry.dark ? readRepoDataUrl(entry.dark).catch(() => null) : null,
          readCaptureMeta().catch(() => null),
        ]);
        if (!ctx.alive()) return;
        if (light) fresh.set(entry.light, light);
        if (dark) fresh.set(entry.dark, dark);
        if (nextMeta) meta = nextMeta;
        drawPills();
        drawPreview();
        setMode('view');
        pendingEl.hidden = false;
      },
    });
    busy = false;
    if (!ctx.alive()) { res.cancel?.(); return; }
    if (res.ok) { session = res; return; }
    setMode('view');
    notice(noticeHtml('failure', 'The capture could not be started', res.error));
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────

  function onAct(act, btn) {
    if (busy) return;
    if (act === 'recapture') chooseTab();
    else if (act === 'replace') { notice(''); setMode('pick'); }
    else if (act === 'delete') remove(btn);
    else if (act === 'save') save(btn);
    else if (act === 'cancel') setMode('view');
  }

  ctx.body.addEventListener('click', async e => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    const copy = t.closest('[data-adm-copy]');
    if (copy) {
      try {
        await navigator.clipboard.writeText(copy.dataset.admCopy);
        copy.textContent = 'Copied';
      } catch { copy.textContent = 'Could not copy'; }
      setTimeout(() => { copy.textContent = 'Copy path'; }, 1600);
      return;
    }
    const tab = t.closest('[data-adm-tabpick]');
    if (tab && !tab.disabled) {
      const pick = captureTabPick(tab.dataset.admTabpick);
      if (pick) recapture(pick);
      return;
    }
    const capture = t.closest('[data-adm-capture]');
    if (capture && session) {
      if (capture.dataset.admCapture === 'focus') { session.focus(); return; }
      // Refused while the other tab is already replacing the files: that finishes, and says so here.
      const running = session;
      const stopped = await running.cancel();
      if (session !== running || !ctx.alive()) return;
      if (stopped) { session = null; setMode('view'); } else lockCaptureWait();
    }
  });

  ctx.body.addEventListener('change', async e => {
    const input = e.target;
    const slot = input.dataset?.admFile;
    if (!slot || mode !== 'pick') return;
    const file = input.files?.[0];
    try {
      picked[slot] = file ? await readPicked(file) : null;
      setError(slot, '');
    } catch (err) {
      picked[slot] = null;
      input.value = '';
      setError(slot, err?.message ?? 'That file could not be read.');
    }
    // The file inputs stand as they are (a redraw would empty them): another file can still be chosen.
    if (mode === 'pick') { drawNew(); drawActions(); }
  });

  // A file stored moments ago is not on the built site yet: read it from the
  // repo instead (once per image).
  ctx.body.addEventListener('error', async e => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.admMedia || img.dataset.admRetried) return;
    img.dataset.admRetried = '1';
    try { img.src = await readRepoDataUrl(img.dataset.admMedia); } catch { /* the broken image stands */ }
  }, true);

  drawPills();
  drawPreview();
  setMode('view');
  fillUsage();

  const working = () => busy && (mode === 'pick' || mode === 'view');   // a save or a delete in flight
  const dirty = () => !busy && mode === 'pick' && slots.some(([s]) => picked[s]);
  return {
    isDirty: () => dirty() || !!session || working(),
    canLeave: () => {
      if (working()) return window.confirm('This file is still being changed. Leave anyway?');
      if (session) return window.confirm('Leave this page and cancel the capture in progress?');
      return !dirty() || window.confirm('Leave without saving this replacement?');
    },
    destroy: () => { session?.cancel(); session = null; clearTimeout(watch); },
  };
}
