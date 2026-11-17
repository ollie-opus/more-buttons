/**
 * kbSiteCapture.js — a capture for the published Knowledge Base, taken here
 * on the webapp.
 *
 * The in-page editor on support.opus-safety.co.uk cannot take a capture
 * itself: the thing to capture is on this site. Its add menu asks the service
 * worker (background.js kbCaptureStart) to arm capture mode in a webapp tab;
 * `origin` ({ tabId, token }) names the draft's tab and the request, and rides
 * the capture session's intent so it survives hard navigations.
 *
 * After the shot a small dialog (its own, not a More Buttons form) shows the
 * capture's path and its light and dark previews, and asks one thing: is it an
 * icon or a button (answered already with a guess from what was shot). Insert pushes the pair to the library (a capture already
 * stored at that path is used as it is, never replaced) and hands
 * { lightFilename, darkFilename, preset } back to the draft's tab
 * (kbCaptureReturn), where it joins the draft as an unsaved edit. Size, theme
 * and corners are set there, in the draft's own settings.
 *
 * A capture for the System Updates draft (`origin.frozen`) is a frozen
 * snapshot: it is stored in the system update captures folder under a
 * generated name that cannot clash, so there is no path to edit and nothing
 * in the library to find (captureDest.js).
 *
 * A recapture (`origin.recapture`, asked by a media file's admin page) is the
 * other way round: the shot replaces the capture stored at the given paths.
 * Its page shows old beside new with the path locked (a recapture never moves
 * or renames a capture), and Replace overwrites the stored files.
 *
 * Deliberately free of the Knowledge Base forms (form.js, captures.js and the
 * capture review forms): it leans only on capture mode and the repo client.
 */

import { enterCaptureMode, exitCaptureMode, isCaptureModeActive } from './captureMode.js';
import { registerFormAction } from './formActions.js';
import { githubPushImageIfNotExists, githubPathExists, githubReplaceImage } from './github.js';
import { writeCaptureMeta } from './captureMeta.js';
import { readRepoDataUrl } from './repoClient.js';
import { OCC_DIR, pairFilenames, shortId, toSystemUpdatePair } from './captureDest.js';
import { looksLikeButton } from './capturePresets.js';

// ── Pure pieces ──────────────────────────────────────────────────────────────

const PAIR_TAIL_RE = /-(light|dark)-mode\.([a-z0-9]+)$/i;

/** The editable part of a capture's library path: no folder prefix, no theme tail. */
export function capturePathBase(filename) {
  return String(filename ?? '')
    .replace(/^docs\/assets\//, '')
    .replace(new RegExp(`^media/${OCC_DIR}/`), '')
    .replace(PAIR_TAIL_RE, '');
}

/**
 * The pair of files a typed path stands for, keeping the capture's own
 * extension (.png screenshots, .svg extracts). An emptied field falls back to
 * the path the capture came with.
 */
export function capturePairFor(typed, capture) {
  const original = capturePathBase(capture?.lightFilename);
  const base = String(typed ?? '').trim().replace(/^\/+|\/+$/g, '') || original;
  const ext = capture?.lightFilename?.match(PAIR_TAIL_RE)?.[2] ?? 'png';
  return { base, ...pairFilenames(OCC_DIR, base, ext) };
}

/**
 * What Insert does, given what the library holds at the path. A capture
 * already in the library is always the one used: nothing is ever replaced
 * from here (that is the media library's job).
 *   'existing' the whole pair is there: push nothing, insert it
 *   'create'   push what is missing (both files, or the absent half of a pair)
 */
export function insertPlan({ lightExists, darkExists }) {
  return lightExists && darkExists ? 'existing' : 'create';
}

/**
 * The stored capture a recapture request names, or null when it must not be
 * touched. The request comes from another tab, so nothing in it is trusted:
 * only a .png light file inside the captures folder (never a system update
 * capture, which is frozen), and a dark file that is its own twin.
 * @returns {{lightPath: string, darkPath: string|null, base: string}|null}
 */
export function recaptureTarget(recapture) {
  const lightPath = recapture?.lightPath;
  const darkPath = recapture?.darkPath ?? null;
  const root = `docs/assets/media/${OCC_DIR}/`;
  if (typeof lightPath !== 'string' || !lightPath.startsWith(root) || !/-light-mode\.png$/.test(lightPath)) return null;
  if (lightPath.slice(root.length).split('/').some(seg => !seg || seg === '.' || seg === '..')) return null;
  if (/[\\\0]/.test(lightPath)) return null;
  if (darkPath !== null && darkPath !== lightPath.replace(/-light-mode\.png$/, '-dark-mode.png')) return null;
  return { lightPath, darkPath, base: capturePathBase(lightPath) };
}

/** Why this shot cannot replace a stored (.png) capture; '' when it can. */
export function recaptureProblem(capture) {
  return /\.png$/i.test(String(capture?.lightFilename ?? ''))
    ? ''
    : 'This capture is stored as a PNG screenshot. An extract (SVG) cannot replace it: recapture it in Capture mode.';
}

// ── The library ──────────────────────────────────────────────────────────────

const b64 = dataUrl => dataUrl.split(',')[1];

function probePair(pair) {
  return Promise.all([
    githubPathExists(`docs/assets/${pair.lightFilename}`),
    githubPathExists(`docs/assets/${pair.darkFilename}`),
  ]).then(([lightExists, darkExists]) => ({ lightExists, darkExists }));
}

// Push the files the library lacks (a stored file is never overwritten) and,
// when the light one is new, record the capture's facts in the manifest.
async function pushPair(pair, capture, onProgress) {
  const lightPath = `docs/assets/${pair.lightFilename}`;
  const darkPath = `docs/assets/${pair.darkFilename}`;
  const created = await githubPushImageIfNotExists(lightPath, b64(capture.lightDataUrl), onProgress);
  await githubPushImageIfNotExists(darkPath, b64(capture.darkDataUrl), onProgress);
  if (!created) return;
  await writeCaptureMeta([{
    lightPath,
    resized: !!capture.resized,
    padding: capture.padding || 0,
    annotated: !!capture.annotated,
    zapped: !!capture.zapped,
  }], onProgress);
}

// ── Capture mode, and the way back ───────────────────────────────────────────

// Back to the Knowledge Base tab: with the capture to insert, or with none
// (capture mode was dismissed). Resolves to the worker's { ok } | { error }.
function returnToKbSite(origin, capture = null) {
  if (silenced) return Promise.resolve({ ok: true }); // the draft itself called this capture off
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'kbCaptureReturn', origin, capture }, res => {
      void chrome.runtime.lastError;
      resolve(res ?? { error: 'no-response' });
    });
  });
}

// `resume`: a retake after the dialog was cancelled, which keeps the last
// shot's annotations, zaps and isolation.
function enterKbSiteCapture(origin, resume = false) {
  enterCaptureMode({
    resume,
    intent: { action: 'completeKbSiteCapture', cancelAction: 'cancelKbSiteCapture', kb: origin },
    maxCaptures: 1,
    returnTo: {
      onComplete: sessionBuffer => finishKbSiteCapture(origin, sessionBuffer),
      onCancel: () => { returnToKbSite(origin); },
    },
  });
}

function finishKbSiteCapture(origin, sessionBuffer) {
  if (!origin) return;
  if (!sessionBuffer?.length) { returnToKbSite(origin); return; }
  if (origin.recapture) {
    const target = recaptureTarget(origin.recapture);
    if (!target) { returnToKbSite(origin); return; } // nothing is written for a path that fails the check
    openRecaptureDialog(origin, target, sessionBuffer[0]);
    return;
  }
  openCaptureDialog(origin, sessionBuffer[0]);
}

// Cold exits (a hard navigation since capture mode was armed killed the
// returnTo closures above): Done, and ✕ / Esc.
registerFormAction('completeKbSiteCapture', ({ intent, sessionBuffer } = {}) =>
  finishKbSiteCapture(intent?.kb, sessionBuffer));
registerFormAction('cancelKbSiteCapture', ({ intent } = {}) => {
  if (intent?.kb) returnToKbSite(intent.kb);
});

/**
 * Arm capture mode on this webapp page for the Knowledge Base draft at
 * `origin`. Returns { ok } or { error } (shown on the draft's page) at once:
 * the worker only switches to this tab when capture mode did start.
 */
export function startKbSiteCapture(origin) {
  if (!origin || !Number.isInteger(origin.tabId)) return { error: 'Could not start capture mode in that tab.' };
  if (origin.recapture && !recaptureTarget(origin.recapture)) return { error: 'This capture cannot be recaptured.' };
  if (isCaptureModeActive()) return { error: 'That tab is already in capture mode. Finish or close it there first.' };
  if (document.querySelector('.more-buttons-overlay, .mb-kbcap')) {
    return { error: 'That tab has a More Buttons form open. Close it there first, or pick another tab.' };
  }
  enterKbSiteCapture(origin);
  return { ok: true };
}

// Set while a capture is being called off from the draft's side, so leaving
// capture mode does not report back to the tab that asked for it.
let silenced = false;
// Closes the page shown after a shot, while one is open.
let closeOpenPage = null;
// Whether that page is storing its capture right now (files are being pushed).
let openPageBusy = () => false;

/**
 * The draft cancelled the capture it asked for (the ✕ on its placeholder):
 * leave capture mode, or close the page shown after the shot, and say nothing
 * back. The service worker then puts this tab back where it was. { busy } when
 * that page is already storing the capture: the cancel is refused.
 */
export function abortKbSiteCapture(token) {
  if (document.querySelector('.mb-kbcap')?.dataset.token === token) {
    // Mid-push there is nothing to call off: stopping now could leave half a pair stored.
    if (openPageBusy()) return { busy: true };
    closeOpenPage?.();
    return {};
  }
  let session = null;
  try { session = window.sessionStorage.getItem('moreButtonsCaptureSession'); } catch {}
  if (!isCaptureModeActive() || !session?.includes(token)) return {};
  silenced = true;
  try { exitCaptureMode(); } finally { silenced = false; }
  return {};
}

// ── The dialog ───────────────────────────────────────────────────────────────

function ensureStyles() {
  for (const [id, file] of [['more-buttons-overlay-stylesheet', 'formsStyling.css'], ['mb-kbcap-stylesheet', 'kbCapture.css']]) {
    if (document.getElementById(id)) continue;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL(`config/forms/${file}`);
    (document.head || document.documentElement).appendChild(link);
  }
}

const DIALOG_HTML = `
<div class="mb-kbcap__card" role="dialog" aria-modal="true" aria-labelledby="mb-kbcap-title">
  <h2 class="mb-kbcap__title" id="mb-kbcap-title">New capture</h2>
  <label class="mb-kbcap__field">
    <span class="mb-kbcap__eyebrow">Capture path</span>
    <input type="text" class="mb-kbcap__input" data-path autocomplete="off" spellcheck="false">
    <span class="mb-kbcap__hint" data-hint>Only rename this for a good reason: most of the time the generated path is the one you want.</span>
  </label>
  <p class="mb-kbcap__notice" data-notice hidden>This capture is already in the library. The existing one, shown below, is the one that will be inserted.</p>
  <div class="mb-kbcap__previews">
    <figure class="mb-kbcap__preview"><figcaption>Light mode</figcaption><div class="mb-kbcap__shot --light"><img data-light alt="Light mode capture"></div></figure>
    <figure class="mb-kbcap__preview"><figcaption>Dark mode</figcaption><div class="mb-kbcap__shot --dark"><img data-dark alt="Dark mode capture"></div></figure>
  </div>
  <div class="mb-kbcap__question">
    <span>Is this capture an icon / button?</span>
    <div class="mb-kbcap__choice">
      <label><input type="radio" name="mb-kbcap-button" value="yes"><span>Yes</span></label>
      <label><input type="radio" name="mb-kbcap-button" value="no" checked><span>No</span></label>
    </div>
  </div>
  <p class="mb-kbcap__error" data-error hidden></p>
  <div class="mb-kbcap__actions">
    <button type="button" class="mb-kbcap__btn" data-cancel>Cancel</button>
    <button type="button" class="mb-kbcap__btn --primary" data-insert>Insert</button>
  </div>
  <div class="mb-kbcap__veil" data-veil hidden><span class="mb-kbcap__spinner" aria-hidden="true"></span><p data-veil-text></p></div>
</div>`;

/**
 * The capture's dialog. Cancel (or Esc) drops the capture and goes back to
 * capture mode to pick something else; Insert pushes it and returns to the
 * draft.
 */
function openCaptureDialog(origin, capture) {
  ensureStyles();
  document.querySelector('.mb-kbcap')?.remove();
  const root = document.createElement('div');
  root.className = 'mb-kbcap';
  root.dataset.token = origin.token ?? '';
  root.innerHTML = DIALOG_HTML;
  const $ = sel => root.querySelector(sel);
  const pathInput = $('[data-path]');
  const notice = $('[data-notice]');
  const hint = $('[data-hint]');
  const errorEl = $('[data-error]');
  const veil = $('[data-veil]');
  const lightImg = $('[data-light]');
  const darkImg = $('[data-dark]');

  // A system update's capture: its generated name, fixed for this dialog.
  const frozenPair = origin.frozen ? toSystemUpdatePair(capture.lightFilename, capture.darkFilename, shortId()) : null;
  const pairNow = () => frozenPair ?? capturePairFor(pathInput.value, capture);
  if (frozenPair) {
    $('.mb-kbcap__title').textContent = 'New system update capture';
    $('.mb-kbcap__eyebrow').textContent = 'System update capture';
    hint.textContent = 'Saved to the System update captures library under this generated name. System update captures are never recaptured or replaced.';
  }
  pathInput.value = frozenPair ? frozenPair.base : capturePathBase(capture.lightFilename);
  // The question arrives answered: a guess from what was captured, to correct if wrong.
  root.querySelector(`[name="mb-kbcap-button"][value="${looksLikeButton(capture.subject) ? 'yes' : 'no'}"]`).checked = true;
  lightImg.src = capture.lightDataUrl;
  darkImg.src = capture.darkDataUrl;

  let busy = false;
  // What the library holds at the path last looked up, and the stored pair's
  // images once fetched (shown in place of the new shot: they are what goes in).
  let found = null; // { base, lightExists, darkExists }
  let stored = null; // { base, light, dark } data URLs

  const prevOverflow = document.body.style.overflow;
  const onKey = e => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    cancel();
  };
  function close() {
    document.removeEventListener('keydown', onKey, true);
    document.body.style.overflow = prevOverflow;
    root.remove();
    closeOpenPage = null;
    openPageBusy = () => false;
  }
  closeOpenPage = close;
  openPageBusy = () => busy;

  const setBusy = text => {
    busy = !!text;
    veil.hidden = !text;
    if (text) $('[data-veil-text]').textContent = text;
  };
  const showError = text => {
    errorEl.textContent = text ?? '';
    errorEl.hidden = !text;
  };
  const wholePair = () => !!found && found.lightExists && found.darkExists;

  // The previews show what Insert will put on the page: the stored pair when
  // the library already has one at this path, this capture otherwise.
  function paint() {
    notice.hidden = !wholePair();
    // A capture the library already has under its own generated path is not
    // renamed from here. (A path typed onto another stored capture stays
    // editable, so there is a way back from it.)
    pathInput.disabled = !!frozenPair || (wholePair() && found.base === capturePathBase(capture.lightFilename));
    hint.hidden = pathInput.disabled && !frozenPair;
    const useStored = wholePair() && stored?.base === found.base;
    lightImg.src = useStored ? stored.light : capture.lightDataUrl;
    darkImg.src = useStored ? stored.dark : capture.darkDataUrl;
  }

  // Look the typed path up in the library. Resolves false when that failed.
  async function lookUp() {
    const pair = pairNow();
    if (found?.base === pair.base) return true;
    // A generated name is new by construction: nothing to look up.
    if (frozenPair) { found = { base: pair.base, lightExists: false, darkExists: false }; paint(); return true; }
    setBusy('Checking the library…');
    showError('');
    try {
      const result = await probePair(pair);
      found = { base: pair.base, ...result };
      if (wholePair()) {
        const [light, dark] = await Promise.all([
          readRepoDataUrl(`docs/assets/${pair.lightFilename}`),
          readRepoDataUrl(`docs/assets/${pair.darkFilename}`),
        ]).catch(() => [null, null]);
        stored = light && dark ? { base: pair.base, light, dark } : null;
      }
      return true;
    } catch (e) {
      found = null;
      showError(`Could not check the capture library: ${e.message}`);
      return false;
    } finally {
      setBusy('');
      paint();
    }
  }

  async function insert() {
    if (busy) return;
    const known = found?.base;
    if (!(await lookUp())) return;
    // A stored pair found at a path only now looked up: show it before inserting it.
    if (wholePair() && known !== found.base) return;
    const pair = pairNow();
    const plan = insertPlan(found);
    setBusy(plan === 'existing' ? 'Adding the capture…' : 'Saving the capture…');
    showError('');
    try {
      if (plan !== 'existing') await pushPair(pair, capture, text => setBusy(text || 'Saving the capture…'));
      const preset = root.querySelector('[name="mb-kbcap-button"]:checked').value === 'yes' ? 'button' : 'auto';
      const res = await returnToKbSite(origin, { lightFilename: pair.lightFilename, darkFilename: pair.darkFilename, preset });
      close();
      if (!res?.ok) {
        alert('The capture is saved in the library, but the Knowledge Base draft it was for is no longer open for editing. Add it there with Capture, then Add from library.');
      }
    } catch (e) {
      found = null; // part of the pair may be up: look again before the next try
      setBusy('');
      showError(`Could not save the capture: ${e.message}`);
    }
  }

  function cancel() {
    if (busy) return;
    close();
    enterKbSiteCapture(origin, true);
  }

  root.addEventListener('click', e => {
    if (e.target.closest('[data-insert]')) insert();
    else if (e.target.closest('[data-cancel]')) cancel();
  });
  root.addEventListener('change', e => {
    if (e.target === pathInput) lookUp();
  });
  pathInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); pathInput.blur(); }
  });
  document.addEventListener('keydown', onKey, true);

  document.body.style.overflow = 'hidden';
  document.body.appendChild(root);
  lookUp();
}

// ── The recapture page ───────────────────────────────────────────────────────

const shotHtml = (caption, scheme, key) =>
  `<figure class="mb-kbcap__preview"><figcaption>${caption}</figcaption><div class="mb-kbcap__shot --${scheme}"><img data-${key} alt="${caption}"></div></figure>`;

const RECAPTURE_HTML = `
<div class="mb-kbcap__card" role="dialog" aria-modal="true" aria-labelledby="mb-kbcap-title">
  <h2 class="mb-kbcap__title" id="mb-kbcap-title">Recapture</h2>
  <label class="mb-kbcap__field">
    <span class="mb-kbcap__eyebrow">Capture path</span>
    <input type="text" class="mb-kbcap__input" data-path autocomplete="off" spellcheck="false" disabled>
    <span class="mb-kbcap__hint">A recapture replaces the stored files. Its path cannot change.</span>
  </label>
  <div class="mb-kbcap__previews --compare">
    ${shotHtml('Light mode (old)', 'light', 'old-light')}
    ${shotHtml('Dark mode (old)', 'dark', 'old-dark')}
    ${shotHtml('Light mode (new)', 'light', 'new-light')}
    ${shotHtml('Dark mode (new)', 'dark', 'new-dark')}
  </div>
  <p class="mb-kbcap__error" data-error hidden></p>
  <div class="mb-kbcap__actions">
    <button type="button" class="mb-kbcap__btn" data-cancel>Cancel</button>
    <button type="button" class="mb-kbcap__btn --primary" data-replace>Replace</button>
  </div>
  <div class="mb-kbcap__veil" data-veil hidden><span class="mb-kbcap__spinner" aria-hidden="true"></span><p data-veil-text></p></div>
</div>`;

/**
 * The page after a recapture's shot: the stored capture beside the new one.
 * Cancel (or Esc) drops the shot and goes back to capture mode; Replace
 * overwrites the stored files at `target` and returns to the page that asked.
 */
function openRecaptureDialog(origin, target, capture) {
  ensureStyles();
  document.querySelector('.mb-kbcap')?.remove();
  const root = document.createElement('div');
  root.className = 'mb-kbcap';
  root.dataset.token = origin.token ?? '';
  root.innerHTML = RECAPTURE_HTML;
  const $ = sel => root.querySelector(sel);
  const errorEl = $('[data-error]');
  const veil = $('[data-veil]');
  const replaceBtn = $('[data-replace]');

  $('[data-path]').value = target.base;
  $('[data-new-light]').src = capture.lightDataUrl;
  $('[data-new-dark]').src = capture.darkDataUrl;
  // The stored pair, read from the repo (not the built site, which may be behind).
  const showOld = (key, path) => {
    if (!path) { $(`[data-${key}]`).closest('.mb-kbcap__preview').classList.add('--none'); return; }
    // Out of sight until it has loaded: a failed read leaves an empty frame, not a broken image.
    const img = $(`[data-${key}]`);
    img.hidden = true;
    img.addEventListener('load', () => { img.hidden = false; }, { once: true });
    readRepoDataUrl(path).then(url => { img.src = url; }, () => {});
  };
  showOld('old-light', target.lightPath);
  showOld('old-dark', target.darkPath);

  let busy = false;
  const showError = text => {
    errorEl.textContent = text ?? '';
    errorEl.hidden = !text;
  };
  const setBusy = text => {
    busy = !!text;
    veil.hidden = !text;
    if (text) $('[data-veil-text]').textContent = text;
  };
  // An extract (.svg) cannot stand in for a stored screenshot: say so, and offer only the way back.
  const problem = recaptureProblem(capture);
  if (problem) { showError(problem); replaceBtn.disabled = true; }

  const prevOverflow = document.body.style.overflow;
  const onKey = e => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    cancel();
  };
  function close() {
    document.removeEventListener('keydown', onKey, true);
    document.body.style.overflow = prevOverflow;
    root.remove();
    closeOpenPage = null;
    openPageBusy = () => false;
  }
  closeOpenPage = close;
  openPageBusy = () => busy;

  async function replace() {
    if (busy || problem) return;
    const working = 'Replacing the capture…';
    setBusy(working);
    showError('');
    try {
      const progress = text => setBusy(text || working);
      await githubReplaceImage(target.lightPath, b64(capture.lightDataUrl), progress);
      if (target.darkPath && capture.darkDataUrl) await githubReplaceImage(target.darkPath, b64(capture.darkDataUrl), progress);
      // The path stays; the facts are the new shot's (its own Annotated / Zapped / padding).
      await writeCaptureMeta([{
        lightPath: target.lightPath,
        resized: !!capture.resized,
        padding: capture.padding || 0,
        annotated: !!capture.annotated,
        zapped: !!capture.zapped,
      }], progress);
      const res = await returnToKbSite(origin, { recaptured: true, lightPath: target.lightPath });
      close();
      if (!res?.ok) alert('The capture was replaced in the library, but the media library page it was started from is no longer open.');
    } catch (e) {
      setBusy('');
      showError(`Could not replace the capture: ${e.message}`);
    }
  }

  function cancel() {
    if (busy) return;
    close();
    enterKbSiteCapture(origin, true);
  }

  root.addEventListener('click', e => {
    if (e.target.closest('[data-replace]')) replace();
    else if (e.target.closest('[data-cancel]')) cancel();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.style.overflow = 'hidden';
  document.body.appendChild(root);
}
