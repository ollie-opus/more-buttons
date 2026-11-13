/**
 * kbPageEditor.js — edit a guide draft in place, on the published Knowledge
 * Base site (support.opus-safety.co.uk/drafts/<slug>/).
 *
 * The article is redrawn from the draft's markdown in GitHub (kbPageRender.js),
 * never from the built HTML: the site build lags a commit by minutes, GitHub
 * does not. That also means a brand-new draft is editable on the site's 404
 * page, before the site has built it.
 *
 * Everything is edited on the page itself. No editor form opens over it.
 *
 *   - Text is typed where it stands: text blocks (rich), headings,
 *     admonition titles, tab labels, table cells, button labels, code, code
 *     annotations and diagram source. The block itself becomes the editing
 *     surface, with no box around it.
 *   - Pointing at anything shows a grey cog at the top left of the component
 *     (or section) it belongs to, out in the margin. The cog opens a popup
 *     holding all of that thing's settings (named as the form editors name
 *     them) and its actions: copy, delete.
 *   - Beside the cog is a grip: press it and drag to move the thing anywhere
 *     on the page (kbPageDrag.js). Text is a block like any other, so it moves
 *     the same way.
 *   - Create mode shows an "Insert new" line at every place a component can go
 *     and an "Add new" card under the page. A pick lands on the page at once,
 *     ready to type into; media is picked from a library panel drawn in the
 *     page at the insert point.
 *
 * The bottom bar (the form editors' action dock):
 *
 *   [Create mode, Markdown view] | [View live page, Delete draft] |
 *   [Undo, Save, Publish]
 *
 * Text formatting is not in the bar: its buttons float over highlighted text,
 * and typing `/` in text opens an insert menu (richTextEditor's
 * attachRichSurface owns both).
 *
 * Nothing is written until Save. Every edit is an op (kbPageOps.js) held over
 * the draft as last read: the page is drawn from the draft with the ops
 * applied, Undo drops the last one, and Save replays them over the draft as it
 * is on GitHub at that moment, as one commit.
 */

import { readRepoText, assetCdnUrl } from './repoClient.js';
import { githubFetchAndPushFile, fetchFileMigratingIdentity } from './github.js';
import { writeGuideDraft, publishGuideFiles, discardGuideDraftFiles, renameGuideInNav } from './guides.js';
import { syncDockTag, setButtonBusy, snapshotButton, restoreButton } from './loading.js';
import { watchIconSpans, getLucideSvgMarkup } from './lucideIcons.js';
import { attachRichSurface, paintInlineAtoms } from './richTextEditor.js';
import { openPopupMenu } from './insertMenu.js';
import { parsePastedComponents, componentMarkdown, uuidOfComponent } from './components.js';
import { ADMONITION_TYPE_LABELS, ADMONITION_TYPE_COLOURS, splitTitleMeta, joinTitleMeta, generateUUID } from './admonitions.js';
import { buildSectionTree, readSectionDescription, hasH3Children } from './sections.js';
import { SUPPORT_ONCLICK, isSupportOnclick } from './mdButtons.js';
import { isInternalHrefShape } from './internalPages.js';
import { langWarningFor } from './codeAnnotations.js';
import { loadLabelPalette } from './labelPalette.js';
import { listMediaPaths, MEDIA_ROOT, MEDIA_ACCEPT } from './mediaLibrary.js';
import { groupMediaPaths, buildMediaNodes } from './mediaTree.js';
import { SU_DIR } from './captureDest.js';
import { renderTree, applySearch } from './kbTree.js';
import { renderGuidePage, renderTextHtml, renderInlineHtml, annotationHtml, assetPathOf, TEXT_KIND } from './kbPageRender.js';
import {
  OPS, TABLE, CODE, applyOps, commitForOps, findComponent, findOwner, readContainer,
  newComponent, newTab, newCell, mediaComponent, mediaFiles, splitParagraphs,
} from './kbPageOps.js';
import { followDrag, blockTarget, sectionTarget } from './kbPageDrag.js';
import { currentKbPage, refreshKbSite, injectLogButton } from './kbSite.js';

// Create mode's menu. A new capture is taken on the webapp, so captures here
// come from the library.
const INSERT_ITEMS = [
  { id: 'text', label: 'Text' },
  { id: 'admonition', label: 'Admonition' },
  { id: 'capture', label: 'Capture from library' },
  { id: 'tabs', label: 'Content tabs' },
  { id: 'table', label: 'Data table' },
  { id: 'grid', label: 'Grid' },
  { id: 'image', label: 'Image' },
  { id: 'video', label: 'Video' },
  { id: 'button', label: 'Button' },
  { id: 'navlinks', label: 'Nav links' },
  { id: 'diagram', label: 'Diagram' },
  { id: 'codeblock', label: 'Code block' },
  { divider: true },
  { id: 'paste', label: 'Paste copied markdown' },
];

const MEDIA_NOUN = { capture: 'capture', image: 'image', video: 'video' };
const MEDIA_FIELD = { capture: 'cap', image: 'img', video: 'vid' };
const COLLAPSIBLE = [['!!!', 'Static'], ['???', 'Collapsible (closed)'], ['???+', 'Collapsible (open)']];
const VALIGN = [['default', 'Default'], ['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']];
// The Type pills' colours, as on the admonition form (Outline and Blank are grey there).
const ADMONITION_PILL = { ...ADMONITION_TYPE_COLOURS, outline: 'grey', blank: 'grey' };

// The button colour swatches (config/labelColours.json), once loaded.
let palette = null;

// Everything typed into where it stands.
const EDITABLE = '.mb-kb-text, h1[data-mb-node], h2[data-mb-node], h3[data-mb-node], [data-mb-edit]';

/**
 * @type {null | {
 *   page: object, hasLive: boolean, md: string, loaded: string, title: string,
 *   article: HTMLElement, orig: HTMLElement, built: Map<string, Element|null>,
 *   bar: HTMLElement, status: HTMLElement, rail: object,
 *   ops: object[], snaps: (string|null)[], frozen: number,
 *   sel: string|null, cellAt: null|{uuid: string, row: number, col: number},
 *   active: null | object, panel: null | {el: HTMLElement},
 *   mediaPaths: Promise<string[]>|null, destKinds: Map<string, string>,
 *   createMode: boolean, markdownView: boolean, saving: boolean, leaving: boolean,
 * }}
 */
let state = null;

// ── Create draft (the button kbSite.js puts on a draft URL with no draft) ────

export async function kbCreateDraft() {
  const page = currentKbPage();
  if (!page) return;
  const status = ensureStatus();
  setStatus(status, 'Creating draft…', { busy: true });
  try {
    const liveMd = await readRepoText(page.livePath);
    const title = renderGuidePage(liveMd).title || page.slug;
    const result = await writeGuideDraft(page.livePath, s => setStatus(status, s, { busy: true }), { title });
    if (result === 'missing-live') {
      setStatus(status, '');
      alert('There is no live page to create a draft from.');
      return;
    }
    setStatus(status, '');
    await refreshKbSite(); // the draft exists now → the editor takes over the page
  } catch (err) {
    setStatus(status, '');
    alert('Failed to create the draft: ' + err.message);
  }
}

// ── Entering edit mode ───────────────────────────────────────────────────────

/** @param {object} page @param {{hasLive?: boolean}} [opts] */
export async function kbEnterEditMode(page, { hasLive = true } = {}) {
  if (state) return;
  const article = document.querySelector('article.md-content__inner');
  if (!article) return;
  ensureStylesheet();
  const status = ensureStatus();
  setStatus(status, 'Loading draft…', { busy: true });

  let md;
  try {
    // Same read the form editor opens with: backfills any missing identity
    // spans (and commits them) so every block on the page is addressable.
    md = await fetchFileMigratingIdentity(page.draftPath, () => {});
  } catch (err) {
    setStatus(status, 'Could not load the draft: ' + err.message, { tone: 'error' });
    return;
  }
  setStatus(status, '');
  if (!md) return;

  // Keep what the site built: the diagrams and nav links it rendered are
  // reused (they can't be drawn here), and the "Written for" row is its.
  const orig = document.createElement('div');
  orig.append(...article.childNodes);

  state = {
    page, hasLive, md, loaded: md, title: '', article, orig, built: new Map(),
    bar: null, status, rail: null,
    ops: [], snaps: [md], frozen: 0,
    sel: null, cellAt: null, active: null, panel: null, mediaPaths: null, destKinds: new Map(),
    createMode: false, markdownView: false, saving: false, leaving: false,
  };
  document.documentElement.classList.add('mb-kb-editing');
  buildBar();
  buildRail();
  render();
  wire();
  loadLabelPalette().then(loaded => {
    palette = loaded;
    if (state) syncRail();
  });
}

// ── Pending edits ────────────────────────────────────────────────────────────
// `ops` are the edits made since the draft was last read or saved; `snaps[i]`
// is the draft with the first i of them applied (so snaps[0] is the draft and
// the last one is what the page shows). The last snap is null while its op is
// still being typed: it is worked out when something needs it.

function workingMd() {
  const n = state.ops.length;
  if (state.snaps[n] == null) {
    try {
      state.snaps[n] = state.ops[n - 1].apply(state.snaps[n - 1]);
    } catch (err) {
      console.warn('MB Warn: dropped an edit that no longer applies', err);
      state.ops.pop();
      state.snaps.pop();
      return workingMd();
    }
  }
  return state.snaps[n];
}

// Typing in one place has ended: an edit that left things as they were is not
// an edit.
function settle() {
  const n = state.ops.length;
  if (n > state.frozen) {
    const md = workingMd();
    if (state.ops.length === n && md === state.snaps[n - 1]) {
      state.ops.pop();
      state.snaps.pop();
    }
  }
  refreshSaveState();
}

/** An edit made by typing: replaces the op the same run of typing already made. */
function typeOp(op) {
  const n = state.ops.length;
  if (n > state.frozen && op.key && state.ops[n - 1].key === op.key) {
    state.ops[n - 1] = op;
    state.snaps[n] = null;
  } else {
    settle();
    state.ops.push(op);
    state.snaps.push(null);
  }
  refreshSaveState();
}

/**
 * An edit made in one step (a control, an insert, a delete): applied, kept, and
 * the page redrawn. `after` runs once the page shows it. False when it could
 * not be applied or changed nothing.
 */
function pushOp(op, after) {
  deactivate();
  settle();
  const before = workingMd();
  let next;
  try {
    next = op.apply(before);
  } catch (err) {
    alert(err.message);
    return false;
  }
  if (next === before) return false;
  state.ops.push(op);
  state.snaps.push(next);
  refreshSaveState();
  render();
  after?.();
  return true;
}

const edit = (uuid, change, after) => pushOp(OPS.editComponent(uuid, change), after);

function undo() {
  if (state.saving) return;
  deactivate();
  settle();
  if (state.ops.length <= state.frozen) return;
  state.ops.pop();
  state.snaps.pop();
  refreshSaveState();
  render();
}

const isDirty = () => state.ops.length > 0;

// ── The bottom bar ───────────────────────────────────────────────────────────

const barButton = (act, icon, label, colour = '') =>
  `<button type="button" class="more-buttons-button${colour ? ' ' + colour : ''}" data-kb-act="${act}"><span class="more-buttons-icon">${icon}</span>${label}</button>`;
const BAR_SEP = '<span class="mb-dock-sep" aria-hidden="true"></span>';

function buildBar() {
  const bar = document.createElement('div');
  bar.className = 'more-buttons-form-actions mb-kb-bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Draft editor');
  bar.innerHTML = `
    <div class="mb-kb-actions">
      ${barButton('create', 'plus', 'Create mode')}
      ${barButton('markdown', 'file-code', 'Markdown view')}
    </div>
    ${BAR_SEP}
    <div class="mb-kb-actions">
      ${state.hasLive ? barButton('live', 'eye', 'View live page') : ''}
      ${barButton('delete', 'trash-2', 'Delete draft', 'red')}
    </div>
    ${BAR_SEP}
    <div class="mb-kb-actions">
      ${barButton('undo', 'undo-2', 'Undo')}
      ${barButton('save', 'save', 'Save', 'green')}
      ${barButton('publish', 'badge-check', 'Publish draft to live', 'blue')}
    </div>`;
  bar.querySelectorAll('[data-kb-act]').forEach(btn => {
    syncDockTag(btn);
    if (btn.dataset.kbAct === 'create' || btn.dataset.kbAct === 'markdown') btn.setAttribute('aria-pressed', 'false');
  });
  document.body.appendChild(bar);
  watchIconSpans(document); // paints the icon names (idempotent per document)

  // A click in the bar must not take the caret out of the text being edited.
  bar.addEventListener('mousedown', e => e.preventDefault());
  bar.addEventListener('click', e => {
    const btn = e.target instanceof Element && e.target.closest('.more-buttons-button');
    if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') return;
    BAR_ACTIONS[btn.dataset.kbAct]?.();
  });

  state.bar = bar;
  refreshSaveState();
}

const barBtn = act => state.bar.querySelector(`[data-kb-act="${act}"]`);

const BAR_ACTIONS = {
  create: () => setCreateMode(!state.createMode),
  markdown: () => setMarkdownView(!state.markdownView),
  live: () => viewLive(),
  delete: () => deleteDraft(),
  undo: () => undo(),
  save: () => save(),
  publish: () => publish(),
};

function setToggle(act, on) {
  const btn = barBtn(act);
  btn.classList.toggle('--active', on);
  btn.setAttribute('aria-pressed', String(on));
}

function setCreateMode(on) {
  state.createMode = on;
  if (!on) closePanel();
  document.documentElement.classList.toggle('mb-kb-create', on);
  setToggle('create', on);
}

function setMarkdownView(on) {
  deactivate();
  state.markdownView = on;
  document.documentElement.classList.toggle('mb-kb-markdown', on);
  setToggle('markdown', on);
  render();
}

function setDisabled(btn, disabled, tag) {
  if (disabled) btn.setAttribute('aria-disabled', 'true'); else btn.removeAttribute('aria-disabled');
  btn.dataset.mbTag = tag;
  btn.setAttribute('aria-label', tag);
}

function refreshSaveState() {
  if (!state?.bar || state.saving) return;
  const dirty = isDirty();
  setDisabled(barBtn('save'), !dirty, dirty ? 'Save changes to the draft' : 'No changes to save');
  setDisabled(barBtn('undo'), !dirty, dirty ? 'Undo the last change' : 'Nothing to undo');
}

// ── Saving ───────────────────────────────────────────────────────────────────

/** Commit every pending edit to the draft, in one commit. Resolves true when nothing is left unsaved by it. */
async function save() {
  if (state.saving) return false;
  settle();
  if (!isDirty()) return true;
  const batch = state.ops.slice();
  const shown = workingMd();
  const btn = barBtn('save');
  const snap = snapshotButton(btn);
  state.saving = true;
  state.frozen = batch.length; // typing during the save starts a new op
  let saved = null;
  try {
    setButtonBusy(btn, 'Saving…');
    saved = await githubFetchAndPushFile(state.page.draftPath, s => setButtonBusy(btn, s),
      md => applyOps(md, batch), { commit: ({ before }) => commitForOps(before, batch) });
  } catch (err) {
    alert('Failed to save: ' + err.message);
  }
  restoreButton(btn, snap);
  state.saving = false;
  state.frozen = 0;
  if (saved == null) { refreshSaveState(); return false; }

  // Anything done while the save was in flight stays pending, over the new draft.
  const rest = state.ops.slice(batch.length);
  state.md = saved;
  state.ops = [];
  state.snaps = [saved];
  for (const op of rest) {
    try {
      const next = op.apply(workingMd());
      state.ops.push(op);
      state.snaps.push(next);
    } catch (err) {
      console.warn('MB Warn: dropped an edit that no longer applies', err);
    }
  }
  refreshSaveState();
  // The save was built on the draft as it is on GitHub: show whatever someone
  // else changed in the meantime (not under a caret).
  if (saved !== shown && !state.active) render();
  setStatus(state.status, 'Saved to the draft', { tone: 'ok', hideAfter: 2200 });

  // The H1 is also the page's name in the navigation.
  const renamed = batch.filter(op => op.navTitle).pop();
  if (renamed) {
    try {
      await renameGuideInNav(state.page.livePath, renamed.navTitle);
    } catch (err) {
      alert(`Saved, but updating the navigation name failed: ${err.message}. Saving the title again will retry it.`);
    }
  }
  return true;
}

async function publish() {
  if (state.saving) return;
  if (!confirm('Publish this draft to live? This overwrites the live page.')) return;
  if (!(await save())) return;
  const { page } = state;
  const btn = barBtn('publish');
  const snap = snapshotButton(btn);
  state.saving = true;
  try {
    const done = await publishGuideFiles(
      { livePath: page.livePath, draftPath: page.draftPath, title: state.title || page.slug },
      s => setButtonBusy(btn, s));
    if (!done) {
      restoreButton(btn, snap);
      alert('Draft not found at ' + page.draftPath);
      return;
    }
    // The draft is gone: this url has nothing left to edit.
    state.leaving = true;
    location.href = page.liveUrl;
  } catch (err) {
    restoreButton(btn, snap);
    alert('Failed to publish draft: ' + err.message);
  } finally {
    state.saving = false;
    refreshSaveState();
  }
}

async function deleteDraft() {
  if (state.saving) return;
  settle();
  const { page, hasLive } = state;
  const warning = hasLive
    ? 'Delete this draft? All in-progress edits will be lost. The live page is not affected.'
    : 'Delete this draft? This page has no live version, so it will be gone for good.';
  if (!confirm(warning)) return;
  const btn = barBtn('delete');
  const snap = snapshotButton(btn);
  setButtonBusy(btn, 'Deleting draft…');
  state.saving = true;
  try {
    await discardGuideDraftFiles(
      { livePath: page.livePath, draftPath: page.draftPath, title: state.title || page.slug },
      s => setButtonBusy(btn, s));
    // The draft is gone: this url has nothing left to edit.
    state.leaving = true;
    location.href = hasLive ? page.liveUrl : '/';
  } catch (err) {
    restoreButton(btn, snap);
    alert('Failed to delete the draft: ' + err.message);
  } finally {
    state.saving = false;
    refreshSaveState();
  }
}

function viewLive() {
  settle();
  if (isDirty() && !confirm('Leave without saving your changes?')) return;
  state.leaving = true;
  location.href = state.page.liveUrl;
}

// ── Rendering ────────────────────────────────────────────────────────────────

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const assetUrl = src => {
  const a = assetPathOf(src);
  return a ? `/${a.path}${a.suffix}` : src;
};

const nodeEl = uuid => (uuid ? state.article.querySelector(`[data-mb-node="${CSS.escape(uuid)}"]`) : null);

function render() {
  if (deactivate()) return; // ending the edit in progress already redrew the page
  closePanel();
  const { article, orig } = state;
  const scrollY = window.scrollY;
  const md = workingMd();

  // Which tab each group shows must survive the redraw.
  const shownTabs = new Set();
  article.querySelectorAll('.tabbed-set[data-mb-node]').forEach(set => {
    const i = [...set.querySelectorAll(':scope > input')].findIndex(inp => inp.checked);
    const block = set.querySelector(':scope > .tabbed-content')?.children[i];
    if (i > 0 && block?.dataset.mbNode) shownTabs.add(block.dataset.mbNode);
  });

  const { html, title } = renderGuidePage(md, { assetUrl, insertSlots: true, markdown: state.markdownView });
  state.title = title;
  article.innerHTML = html;

  shownTabs.forEach(showTab);
  // The site's own drawing of a diagram / nav links block stands in for it as
  // long as that block is still what the site drew it from.
  article.querySelectorAll('[data-mb-built-slot]').forEach(slot => {
    const uuid = slot.dataset.mbBuiltSlot;
    if (!state.built.has(uuid)) state.built.set(uuid, builtNodeFor(orig, uuid));
    const node = state.built.get(uuid);
    if (!node || !sameAsLoaded(md, uuid)) return;
    slot.replaceChildren(node);
    slot.classList.add('--filled');
  });
  // What the site adds around the content itself: the audience labels under
  // the H1 and the tags row that closes the article.
  const writtenFor = orig.querySelector('.mb-written-for');
  if (writtenFor) article.querySelector('h1')?.after(writtenFor.cloneNode(true));
  const tags = orig.querySelector('.md-tags');
  if (tags) article.append(tags.cloneNode(true));
  // Create mode's card under the page (hidden outside create mode).
  const addNew = document.createElement('button');
  addNew.type = 'button';
  addNew.className = 'mb-kb-addnew';
  addNew.innerHTML = '<span class="mb-kb-addnew__plus" aria-hidden="true">+</span> Add new';
  article.append(addNew);
  // The Edit log icon, where a live page has it (the redraw took the last one).
  injectLogButton(document, state.page);

  paintInlineAtoms(article);
  window.scrollTo(0, scrollY);
  select(state.sel);
}

function sameAsLoaded(md, uuid) {
  const then = findComponent(state.loaded, uuid)?.component;
  const now = findComponent(md, uuid)?.component;
  return !!then && !!now && JSON.stringify(then) === JSON.stringify(now);
}

// The element the site built for a component: its identity span's paragraph
// when that paragraph holds the content itself, else the block right after it.
function builtNodeFor(orig, uuid) {
  const span = orig.querySelector(`span[data-uuid="${CSS.escape(uuid)}"]`);
  const p = span?.closest('p');
  if (!p) return null;
  const node = p.children.length > 1 ? p : p.nextElementSibling;
  if (!node || node.querySelector?.('span[data-uuid]') || /^H[1-6]$/.test(node.tagName)) return null;
  return node;
}

/** Bring a tab to the front of its group. */
function showTab(tabUuid) {
  const block = nodeEl(tabUuid);
  const set = block?.closest('.tabbed-set');
  if (!set || block.dataset.mbKind !== 'tab') return;
  const input = set.querySelectorAll(':scope > input')[[...block.parentElement.children].indexOf(block)];
  if (input) input.checked = true;
}

const shownTabOf = set => {
  const i = [...set.querySelectorAll(':scope > input')].findIndex(inp => inp.checked);
  return set.querySelector(':scope > .tabbed-content')?.children[Math.max(0, i)] ?? null;
};

// ── Selection ────────────────────────────────────────────────────────────────
// One thing on the page is selected at a time: a component, a tab, a grid cell
// or a section (by its heading). Nothing on the page marks it; an open
// settings popup is for it.

/** What a click or a caret at `target` belongs to (an element with an identity), or null. */
function nodeFor(target) {
  const label = target.closest('.tabbed-labels > label');
  if (label) {
    const set = label.closest('.tabbed-set');
    return set.querySelector(':scope > .tabbed-content')?.children[[...label.parentElement.children].indexOf(label)] ?? set;
  }
  // A section has no box of its own: its text belongs to its heading.
  const text = target.closest('.mb-kb-text');
  if (text?.dataset.mbText === TEXT_KIND.section) return nodeEl(text.dataset.mbUuid);
  let node = target.closest('[data-mb-node]');
  while (node && !node.dataset.mbNode) node = node.parentElement?.closest('[data-mb-node]') ?? null;
  return node;
}

function select(uuid) {
  if (uuid !== state.sel && !state.rail.busy) closeSettings(); // the popup belongs to what was selected
  state.article.querySelectorAll('.mb-kb-sel').forEach(el => el.classList.remove('mb-kb-sel'));
  const el = nodeEl(uuid);
  state.sel = el ? uuid : null;
  el?.classList.add('mb-kb-sel');
  syncRail();
}

function reveal(uuid) {
  nodeEl(uuid)?.scrollIntoView({ block: 'nearest' });
}

// ── Settings ─────────────────────────────────────────────────────────────────
// Whatever the pointer is over (a component, a tab set, a grid cell, a section)
// shows a grey cog at its top left, out in the margin. The cog opens a popup
// holding everything that can be set on that thing, named as the form editors
// name it, and what can be done with it (move, copy, delete). None of it is in
// the bottom bar, and nothing is drawn until the pointer is there.
//
// The cog is for `rail.hover` (what the pointer is on) until its popup opens;
// opening selects that thing, and the open popup then follows the selection.
//
// A spec is { label, span, fields }. `span` is the first and last element of
// the thing (a section runs over several). A field is one of:
//   pills     { label, hint?, options: [[value, text, colour?]], value, set(value) }
//   toggle    { label, icon, text, title?, on, set(on) }
//   text      { label, hint?, value, placeholder?, set(value) }   (number likewise)
//   select    { label, options: [[value, text]], value, set(value) }
//   size      { label, mode, value, set(mode, value) }
//   swatches  { label, groups, value, set(value) }
//   buttons   { label, items: [{ icon, label, run(), off?, danger? }] }
//   heading   { text }      note  { text }
// Every `set` and `run` is an edit of its own: it joins the pending edits and
// the page redraws behind the popup, which stays open.

const RAIL_GAP = 4;    // between the cog and what it is for
const RAIL_EDGE = 8;   // the cog and its popup keep this far inside the window
const RAIL_LINGER = 250; // ms the cog outlives the pointer leaving for nothing in particular

const YES_NO = [['yes', 'Yes', 'blue'], ['no', 'No', 'grey']];
const pills = (label, options, value, set, hint) => ({ kind: 'pills', label, options, value, set, hint });
const titleCase = s => s.replace(/(^|[\s-])([a-z])/g, (_, gap, ch) => gap + ch.toUpperCase());

function buildRail() {
  const el = document.createElement('div');
  el.className = 'mb-kb-rail';
  el.hidden = true;
  el.innerHTML = `
    <button type="button" class="mb-kb-rail__btn" aria-label="Settings" title="Settings" aria-haspopup="dialog" aria-expanded="false"><span class="mb-kb-rail__icon" aria-hidden="true"></span></button>
    <button type="button" class="mb-kb-rail__grip" aria-label="Drag to move" title="Drag to move"><span class="mb-kb-rail__icon" aria-hidden="true"></span></button>
    <div class="mb-kb-rail__pop" role="dialog" hidden>
      <div class="mb-kb-settings">
        <div class="mb-kb-settings__head"><strong></strong><button type="button" class="mb-kb-settings__close" aria-label="Close"><span class="more-buttons-icon">x</span></button></div>
        <div class="mb-kb-settings__body"></div>
      </div>
    </div>`;
  document.body.appendChild(el);
  const rail = {
    el,
    btn: el.querySelector('.mb-kb-rail__btn'),
    grip: el.querySelector('.mb-kb-rail__grip'),
    dragging: false,
    pop: el.querySelector('.mb-kb-rail__pop'),
    title: el.querySelector('.mb-kb-settings__head strong'),
    body: el.querySelector('.mb-kb-settings__body'),
    spec: null, hover: null, zone: null, open: false, busy: false, sig: null, frame: 0,
  };
  state.rail = rail;
  // The cog is lucide's stock outline. The chrome painter would give it the
  // filled twin, so its span is not a `.more-buttons-icon` and is drawn here.
  getLucideSvgMarkup('settings').then(svg => { rail.btn.querySelector('.mb-kb-rail__icon').innerHTML = svg; });
  getLucideSvgMarkup('grip-vertical').then(svg => { rail.grip.querySelector('.mb-kb-rail__icon').innerHTML = svg; });
  rail.grip.addEventListener('pointerdown', onGripDown);

  // The pointer: the cog goes to what it is over. It stays while the pointer is
  // on the cog or in the strip of margin beside that thing (the way to the
  // cog), and lingers a moment when the pointer leaves for nothing at all.
  let linger = 0;
  let pointer = null;
  let pointerFrame = 0;
  const keep = () => { clearTimeout(linger); linger = 0; };
  const onPointer = e => {
    if (rail.open || rail.dragging) return; // an open popup, or a drag, holds the cog where it is
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (el.contains(t)) { keep(); return; }
    const z = rail.zone;
    if (rail.hover && z && e.pageX >= z.left && e.pageX < z.right && e.pageY >= z.top && e.pageY <= z.bottom) { keep(); return; }
    const node = state.article.contains(t) && !inChrome(t) ? nodeFor(t) : null;
    if (node) {
      keep();
      if (node.dataset.mbNode === rail.hover) return;
      rail.hover = node.dataset.mbNode;
      syncRail();
    } else if (rail.hover && !linger) {
      linger = setTimeout(() => {
        linger = 0;
        rail.hover = null;
        if (state && !rail.open) syncRail();
      }, RAIL_LINGER);
    }
  };
  document.addEventListener('mousemove', e => {
    pointer = e;
    if (pointerFrame) return;
    pointerFrame = requestAnimationFrame(() => { pointerFrame = 0; if (state) onPointer(pointer); });
  }, { passive: true });

  // A press on the rail must not take the caret out of the text being edited
  // (the popup's own fields still take focus).
  el.addEventListener('mousedown', e => {
    if (!(e.target instanceof Element) || !e.target.closest('input:not([type="radio"], [type="checkbox"]), select')) e.preventDefault();
  });
  rail.btn.addEventListener('click', () => {
    if (rail.open) { closeSettings(); return; }
    const uuid = rail.hover;
    // Text being typed somewhere else is finished first (that may redraw the page).
    if (state.active && nodeFor(state.active.el)?.dataset.mbNode !== uuid) deactivate();
    select(uuid);
    if (uuid && state.sel === uuid) openSettings();
  });
  el.querySelector('.mb-kb-settings__close').addEventListener('click', closeSettings);

  const fieldAt = node => rail.spec?.fields[Number(node.closest('[data-f]')?.dataset.f)] ?? null;
  // One control was used: its edit is made, and the popup shows what is true
  // now. It stays open even when the edit moves the selection on (a new tab,
  // the cell beside a deleted one).
  const apply = fn => {
    rail.busy = true;
    try { fn(); } finally { rail.busy = false; }
    syncRail();
  };
  const commitText = input => {
    if (!input.dataset.dirty) return;
    delete input.dataset.dirty;
    const f = fieldAt(input);
    if (!f) return;
    if (f.kind === 'size') apply(() => f.set(input.closest('[data-f]').querySelector('select').value, input.value));
    else apply(() => f.set(input.value));
  };
  rail.flush = () => { const input = rail.body.querySelector('[data-dirty]'); if (input) commitText(input); };

  rail.body.addEventListener('input', e => {
    if (e.target.matches('input[type="text"], input[type="number"]')) e.target.dataset.dirty = '1';
  });
  rail.body.addEventListener('change', e => {
    const input = e.target;
    if (input.matches('input[type="text"], input[type="number"]')) { commitText(input); return; }
    const { value, checked } = input;
    rail.flush(); // a field typed into and not yet applied goes first
    const f = fieldAt(input);
    if (!f) return;
    if (input.type === 'checkbox') apply(() => f.set(checked));
    else if (f.kind === 'size') {
      const px = input.closest('[data-f]').querySelector('input');
      delete px.dataset.dirty;
      apply(() => f.set(value, px.value));
    } else apply(() => f.set(value)); // a radio or a select
  });
  rail.body.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.isComposing && e.target.matches('input[type="text"], input[type="number"]')) {
      e.preventDefault();
      commitText(e.target);
    }
  });
  rail.body.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const item = fieldAt(btn)?.items?.[Number(btn.dataset.act)];
    if (!item || item.off) return;
    rail.flush();
    // The flush may have redrawn the page: run what the button means now.
    const now = fieldAt(btn)?.items?.[Number(btn.dataset.act)];
    if (now && !now.off) apply(() => now.run());
  });
  // Escape closes the popup, dropping what was typed into a field and not yet applied.
  rail.pop.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    rail.body.querySelectorAll('[data-dirty]').forEach(input => delete input.dataset.dirty);
    closeSettings();
  });

  const queue = () => {
    if (rail.frame) return;
    rail.frame = requestAnimationFrame(() => { rail.frame = 0; if (state) placeRail(); });
  };
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  // Typing, a loading image, a folded admonition: anything that changes the
  // page's height moves what the cog is beside.
  new ResizeObserver(queue).observe(state.article);
  state.article.addEventListener('input', queue);
  state.article.addEventListener('toggle', queue, true);
  state.article.addEventListener('change', queue); // another tab shown
}

/** Open the popup on what is selected. */
function openSettings() {
  const rail = state.rail;
  if (!nodeEl(state.sel)) return;
  closePanel();
  rail.open = true;
  rail.sig = null;
  syncRail();
}

function closeSettings() {
  const rail = state?.rail;
  if (!rail?.open) return;
  rail.flush(); // a field typed into and not yet applied is applied
  rail.open = false;
  rail.hover = state.sel; // the cog stays where it was until the pointer moves on
  syncRail();
}

/** Bring the cog and its popup in line with the pointer, the selection and the draft as they are now. */
function syncRail() {
  const rail = state.rail;
  const el = nodeEl(rail.open ? state.sel : rail.hover);
  rail.spec = el ? settingsFor(el) : null;
  if (!rail.spec) rail.open = false;
  rail.pop.hidden = !rail.open;
  rail.btn.setAttribute('aria-expanded', String(rail.open));
  rail.btn.classList.toggle('--open', rail.open);
  if (!rail.spec) {
    rail.zone = null;
    rail.el.hidden = true;
    return;
  }
  if (rail.open) drawSettings();
  placeRail();
}

// The box a thing takes up on the page: from the first element of its span to the last.
function spanBox([first, last]) {
  let top = Infinity;
  let bottom = -Infinity;
  let left = Infinity;
  for (let n = first; n; n = n.nextElementSibling) {
    const r = n.getBoundingClientRect();
    if (r.width || r.height) {
      top = Math.min(top, r.top);
      bottom = Math.max(bottom, r.bottom);
      left = Math.min(left, r.left);
    }
    if (n === last) break;
  }
  return Number.isFinite(top) ? { top, bottom, left } : null;
}

function placeRail() {
  const rail = state.rail;
  if (!rail.spec) return;
  const box = rail.spec.span.every(n => n?.isConnected) ? spanBox(rail.spec.span) : null;
  rail.el.hidden = !box;
  rail.zone = null;
  if (!box) return;

  const height = box.bottom - box.top;
  const movable = !!rail.spec.drag;
  rail.grip.hidden = !movable;
  const cog = rail.btn.offsetWidth;
  const bw = cog + (movable ? rail.grip.offsetWidth : 0); // the cog, then the grip
  const bh = rail.btn.offsetHeight;
  const width = bw + RAIL_GAP;
  // In the margin to the thing's left, but never off the window's left edge.
  // (Where the margin is too narrow for that, it closes up to the thing
  // before it would stand over it.)
  const x = Math.max(Math.min(RAIL_EDGE, Math.max(0, box.left - bw)), box.left - width);
  rail.el.style.left = `${x + window.scrollX}px`;
  rail.el.style.top = `${box.top + window.scrollY}px`;
  rail.el.style.width = `${width}px`;
  rail.el.style.height = `${height}px`;
  // The strip of margin down the thing's left: the pointer's way to the cog.
  rail.zone = { left: x + window.scrollX, right: box.left + window.scrollX, top: box.top + window.scrollY, bottom: box.bottom + window.scrollY };

  // The cog sits at the top, level with the thing's first line; when the top
  // has scrolled out of view it comes down with the window as far as the
  // thing goes.
  const header = document.querySelector('.md-header')?.getBoundingClientRect();
  const viewTop = Math.max(0, header && header.top <= 0 ? header.bottom : 0) + RAIL_EDGE;
  const viewBottom = state.bar.getBoundingClientRect().top - RAIL_EDGE;
  const first = getComputedStyle(rail.spec.span[0]);
  const line = parseFloat(first.lineHeight) || parseFloat(first.fontSize) * 1.2 || bh; // `normal` has no px value
  const y = Math.max(0, (Math.min(line, height) - bh) / 2, Math.min(viewTop - box.top, height - bh));
  rail.btn.style.top = `${y}px`;
  rail.grip.style.top = `${y}px`;
  rail.grip.style.left = `${cog}px`;

  if (rail.open) {
    // The popup opens under the button, out into the margin, and stays in the window.
    rail.pop.style.maxHeight = `${Math.max(160, viewBottom - viewTop)}px`;
    const pw = rail.pop.offsetWidth;
    const ph = rail.pop.offsetHeight;
    const by = box.top + y;
    const px = Math.max(RAIL_EDGE, Math.min(x + cog - pw, window.innerWidth - pw - RAIL_EDGE));
    let py = by + bh + 6;
    if (py + ph > viewBottom) py = by - 6 - ph >= viewTop ? by - 6 - ph : Math.max(viewTop, viewBottom - ph);
    rail.pop.style.left = `${px - x}px`;
    rail.pop.style.top = `${py - box.top}px`;
  }
}

// ── The popup ────────────────────────────────────────────────────────────────

const fieldShape = f => [f.kind, f.label, f.hint, f.text, f.icon, f.placeholder,
  f.options?.map(o => o.slice(0, 3)), f.items?.map(i => [i.icon, i.label, !!i.danger]),
  f.groups && Object.keys(f.groups).length];

// The popup is rebuilt only when what it holds changes; otherwise its controls
// stay as they are and take the new values (a click in flight still lands).
function drawSettings() {
  const rail = state.rail;
  const { label, fields } = rail.spec;
  rail.title.textContent = label;
  rail.pop.setAttribute('aria-label', `${label} settings`);
  const sig = JSON.stringify(fields.map(fieldShape));
  if (sig !== rail.sig) {
    rail.sig = sig;
    rail.body.replaceChildren(...fields.map(buildField));
  }
  fields.forEach((f, i) => paintField(rail.body.children[i], f));
}

function iconSpan(name) {
  const span = document.createElement('span');
  span.className = 'more-buttons-icon';
  span.textContent = name;
  return span;
}

function buildField(f, i) {
  const el = document.createElement('div');
  el.dataset.f = String(i);
  if (f.kind === 'heading') {
    el.className = 'mb-kb-settings__heading';
    el.textContent = f.text;
    return el;
  }
  if (f.kind === 'note') {
    el.className = 'mb-kb-settings__note';
    el.textContent = f.text;
    return el;
  }
  el.className = 'more-buttons-form-group';
  if (f.label) {
    const head = document.createElement('div');
    const label = document.createElement('span');
    label.className = 'more-buttons-label';
    label.textContent = f.label;
    head.append(label);
    if (f.hint) {
      const hint = document.createElement('div');
      hint.className = 'more-buttons-label-hint';
      hint.textContent = f.hint;
      head.append(hint);
    }
    el.append(head);
  }
  const name = `mb-kb-set-${i}`;
  const pill = (type, value, text, colour) => {
    const label = document.createElement('label');
    label.className = `more-buttons-radio-btn${colour ? ` --${colour}` : ''}`;
    const input = document.createElement('input');
    input.type = type;
    input.name = name;
    input.value = value;
    label.append(input, ` ${text}`);
    return label;
  };
  const row = () => {
    const div = document.createElement('div');
    div.className = 'more-buttons-radio-btn-group-row';
    el.append(div);
    return div;
  };

  if (f.kind === 'pills') {
    row().append(...f.options.map(([value, text, colour]) => pill('radio', value, text, colour)));
  } else if (f.kind === 'toggle') {
    const label = pill('checkbox', 'on', f.text);
    if (f.icon) label.querySelector('input').after(iconSpan(f.icon));
    if (f.title) label.title = f.title;
    row().append(label);
  } else if (f.kind === 'text' || f.kind === 'number') {
    const input = document.createElement('input');
    input.type = f.kind;
    if (f.kind === 'number') { input.min = '1'; input.step = '1'; }
    if (f.placeholder) input.placeholder = f.placeholder;
    input.autocomplete = 'off';
    input.spellcheck = false;
    el.append(input);
  } else if (f.kind === 'select') {
    const select = document.createElement('select');
    for (const [value, text] of f.options) select.append(new Option(text, value));
    el.append(select);
  } else if (f.kind === 'size') {
    const wrap = document.createElement('div');
    wrap.className = 'mb-kb-settings__size';
    const select = document.createElement('select');
    for (const [value, text] of [['height', 'Height'], ['width', 'Width'], ['none', 'Auto']]) select.append(new Option(text, value));
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    const unit = document.createElement('span');
    unit.textContent = 'px';
    wrap.append(select, input, unit);
    el.append(wrap);
  } else if (f.kind === 'swatches') {
    const host = document.createElement('div');
    host.className = 'mb-swatch-radio-group';
    for (const [groupName, presets] of Object.entries(f.groups)) {
      const title = document.createElement('span');
      title.className = 'mb-rte__swatch-title';
      title.textContent = groupName;
      const swatches = document.createElement('div');
      swatches.className = 'mb-rte__swatch-row';
      for (const [presetName, preset] of Object.entries(presets)) {
        const label = document.createElement('label');
        label.className = 'mb-rte__swatch mb-swatch-option';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = name;
        input.value = presetName.toLowerCase();
        label.append(input, presetName);
        for (const [prop, value] of [['--bg', preset.light.bg], ['--text', preset.light.text], ['--border', preset.light.border],
          ['--bg-dark', preset.dark.bg], ['--text-dark', preset.dark.text], ['--border-dark', preset.dark.border]]) label.style.setProperty(prop, value);
        swatches.append(label);
      }
      host.append(title, swatches);
    }
    el.append(host);
  } else if (f.kind === 'buttons') {
    const div = document.createElement('div');
    div.className = 'mb-kb-settings__acts';
    f.items.forEach((item, j) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `mb-kb-settings__act${item.danger ? ' --danger' : ''}`;
      btn.dataset.act = String(j);
      btn.append(iconSpan(item.icon), item.label);
      div.append(btn);
    });
    el.append(div);
  }
  return el;
}

function paintField(el, f) {
  if (f.kind === 'pills' || f.kind === 'swatches') {
    el.querySelectorAll('input').forEach(input => { input.checked = input.value === f.value; });
  } else if (f.kind === 'toggle') {
    el.querySelector('input').checked = !!f.on;
  } else if (f.kind === 'text' || f.kind === 'number') {
    const input = el.querySelector('input');
    if (!input.dataset.dirty) input.value = f.value ?? '';
  } else if (f.kind === 'select') {
    el.querySelector('select').value = f.value ?? '';
  } else if (f.kind === 'size') {
    const input = el.querySelector('input');
    el.querySelector('select').value = f.mode;
    input.disabled = f.mode === 'none';
    if (!input.dataset.dirty) input.value = f.mode === 'none' ? '' : f.value ?? '';
  } else if (f.kind === 'buttons') {
    el.querySelectorAll('[data-act]').forEach((btn, j) => { btn.disabled = !!f.items[j].off; });
  }
}

// ── What can be set on each kind of thing ────────────────────────────────────
// Labels and options are the form editors' own (config/forms/edit*.html).

// What the grip beside the cog moves: a block ({ block: its element }) or a
// section ({ section: its heading }). A tab or a grid cell is moved among its
// own kind by its arrows, so its grip takes the whole group / grid; the page
// title stays where it is.
function dragFor(el) {
  const kind = el.dataset.mbKind;
  if (kind === 'section') return el.tagName === 'H1' ? null : { section: el };
  const block = kind === 'tab' ? el.closest('[data-mb-kind="tabs"]') : kind === 'cell' ? el.closest('[data-mb-kind="grid"]') : el;
  return block?.dataset.mbNode ? { block } : null;
}

function settingsFor(el) {
  const spec = settingsOf(el);
  return spec && { ...spec, drag: dragFor(el) };
}

function settingsOf(el) {
  const md = workingMd();
  const uuid = el.dataset.mbNode;
  const kind = el.dataset.mbKind;
  if (kind === 'section') return sectionSettings(md, uuid, el);
  if (kind === 'tab') return tabsSettings(md, uuid);
  if (kind === 'tabs') return tabsSettings(md, shownTabOf(el)?.dataset.mbNode);
  if (kind === 'cell') return cellSettings(md, uuid, el);
  const hit = findComponent(md, uuid);
  if (!hit) return null;
  const c = hit.component;
  const spec = c.kind === 'text' ? textSettings(md, hit)
    : c.kind === 'admonition' ? admonitionSettings(md, hit)
    : c.kind === 'grid' ? { label: 'Grid', fields: gridFields(md, hit) }
    : c.kind === 'table' ? tableSettings(md, hit)
    : c.kind === 'codeblock' ? codeSettings(md, hit)
    : c.kind === 'button' ? buttonSettings(md, hit)
    : c.kind === 'navlinks' ? navLinksSettings(md, hit)
    : c.kind === 'diagram' ? { label: 'Diagram', fields: [actions(md, hit)] }
    : mediaSettings(md, hit);
  return spec && { span: [el, el], ...spec };
}

// Copy and delete: every block has them. (Moving is the grip beside the cog.)
function actions(md, hit) {
  const uuid = uuidOfComponent(hit.component);
  return { kind: 'buttons', label: 'Actions', items: [
    { icon: 'copy', label: 'Copy', run: () => copyMarkdown(hit.component) },
    { icon: 'trash-2', label: 'Delete', danger: true, run: () => removeComponent(uuid) },
  ] };
}

// A text block moves as one piece. To move part of it, it is first cut into a
// block per paragraph; two text blocks standing together can be joined again.
function textSettings(md, hit) {
  const uuid = hit.component.txt.uuid;
  const parts = splitParagraphs(hit.component.txt.body).length;
  const above = readContainer(md, hit.container)?.components[hit.index - 1];
  return { label: 'Text', fields: [
    { kind: 'buttons', label: 'Actions', items: [
      { icon: 'split', label: 'Split into paragraphs', off: parts < 2,
        run: () => pushOp(OPS.splitText(uuid, Array.from({ length: parts - 1 }, generateUUID))) },
      { icon: 'merge', label: 'Join with text above', off: above?.kind !== 'text',
        run: () => pushOp(OPS.joinText(uuid), () => select(above.txt.uuid)) },
      { icon: 'copy', label: 'Copy', run: () => copyMarkdown(hit.component) },
      { icon: 'trash-2', label: 'Delete', danger: true, run: () => removeComponent(uuid) },
    ] },
  ] };
}

// ── Dragging ─────────────────────────────────────────────────────────────────
// The grip beside the cog (kbPageDrag.js follows the pointer and draws the
// line; here is what is moved and what a drop does).

function onGripDown(e) {
  if (e.button !== 0) return;
  const rail = state.rail;
  const drag = rail.spec?.drag;
  if (!drag) return;
  e.preventDefault();
  const section = drag.section ?? null;
  const uuid = (section ?? drag.block).dataset.mbNode;
  // The page may be redrawn as the drag starts (text being typed is finished
  // first): what is moved is found again by its identity.
  const source = () => nodeEl(uuid);
  followDrag(e, {
    start: () => {
      rail.dragging = true;
      deactivate();
      closeSettings();
      closePanel();
      rail.el.hidden = true;
    },
    els: () => {
      const el = source();
      if (!el) return [];
      if (!section) return [el];
      const [first, last] = sectionSpan(el);
      const els = [];
      for (let n = first; n; n = n.nextElementSibling) { els.push(n); if (n === last) break; }
      return els;
    },
    view: () => {
      const header = document.querySelector('.md-header')?.getBoundingClientRect();
      return { top: Math.max(0, header && header.top <= 0 ? header.bottom : 0), bottom: state.bar.getBoundingClientRect().top };
    },
    targetAt: (x, y) => {
      const el = source();
      if (!el) return null;
      return section ? sectionTarget(state.article, y, el) : blockTarget(state.article, x, y, el, TEXT_KIND);
    },
    drop: target => {
      const op = section ? OPS.moveSectionTo(uuid, target.parentUuid, target.at) : OPS.moveTo(uuid, target.container, target.at);
      pushOp(op, () => { showOwnTab(uuid); reveal(uuid); });
    },
    end: () => {
      rail.dragging = false;
      rail.hover = nodeEl(uuid) ? uuid : null;
      syncRail();
    },
  });
}

// A block dropped into a tab that was showing is still in the showing tab
// after the redraw (render keeps the shown tabs); nothing to bring forward
// unless its tab is not the first and was never shown.
function showOwnTab(uuid) {
  const tab = nodeEl(uuid)?.closest('[data-mb-kind="tab"]');
  if (tab) showTab(tab.dataset.mbNode);
}

async function copyMarkdown(component) {
  try {
    await navigator.clipboard.writeText(componentMarkdown(component));
    setStatus(state.status, 'Copied. Paste it with "Paste copied markdown" in create mode.', { tone: 'ok', hideAfter: 3200 });
  } catch (err) {
    alert('Could not copy: ' + err.message);
  }
}

function removeComponent(uuid) {
  if (pushOp(OPS.deleteComponent(uuid))) noteUndo('Deleted.');
}

const noteUndo = text => setStatus(state.status, `${text} Undo brings it back.`, { tone: 'ok', hideAfter: 3200 });

// A section runs from its heading to the next heading that is not inside it.
// The page title's own run stops at the first section.
function sectionSpan(heading) {
  const level = Number(heading.tagName[1]);
  let last = heading;
  for (let n = heading.nextElementSibling; n; n = n.nextElementSibling) {
    if (n.matches('.md-tags, .mb-kb-addnew')) break;
    if (n.dataset.mbKind === 'section' && (level === 1 || Number(n.tagName[1]) <= level)) break;
    last = n;
  }
  return [heading, last];
}

function sectionSettings(md, uuid, el) {
  const sections = buildSectionTree(md).sections ?? [];
  const sec = sections.find(s => s.uuid === uuid);
  if (!sec) return null;
  const { hideTitle } = readSectionDescription(md, uuid);
  const hide = {
    kind: 'toggle', label: 'Title', icon: 'eye-off', text: 'Hide title', on: !!hideTitle,
    title: 'Hide this title in the published guide (the section still appears)',
    set: on => pushOp(OPS.setHideTitle(uuid, on)),
  };
  const span = sectionSpan(el);
  if (sec.level === 1) return { label: 'Page title', span, fields: [hide] };

  // A section with subsections cannot go under another: they would be a level too deep.
  const others = hasH3Children(md, uuid) ? [] : sections.filter(s => s.level === 2 && s.uuid !== uuid);
  const parent = sec.level === 2 ? '' : sec.parentUuid;
  return {
    label: sec.level === 2 ? 'Section' : 'Subsection',
    span,
    fields: [
      { kind: 'select', label: 'Section parent', options: [['', 'Title'], ...others.map(s => [s.uuid, s.title])], value: parent,
        set: id => { if (id !== parent) pushOp(OPS.reparentSection(uuid, id || null), () => reveal(uuid)); } },
      hide,
      { kind: 'buttons', label: 'Actions', items: [
        sec.level === 2 && { icon: 'list-plus', label: 'Add subsection', run: () => addSection(uuid, 3) },
        { icon: 'trash-2', label: 'Delete', danger: true, run: () => { if (pushOp(OPS.deleteSection(uuid))) noteUndo('Section deleted.'); } },
      ].filter(Boolean) },
    ],
  };
}

function admonitionSettings(md, hit) {
  const adm = hit.component.adm;
  const uuid = adm.uuid;
  return {
    label: 'Admonition',
    fields: [
      { kind: 'text', label: 'Meta', value: splitTitleMeta(adm.title ?? '').meta, placeholder: 'Muted note after the title, e.g. (optional)',
        set: v => edit(uuid, c => { c.adm.title = joinTitleMeta(splitTitleMeta(c.adm.title ?? '').title, v.trim().replace(/"/g, "'")); }) },
      pills('Type', Object.entries(ADMONITION_TYPE_LABELS).map(([id, text]) => [id, text, ADMONITION_PILL[id]]), adm.type, type => edit(uuid, c => {
        c.adm.type = type;
        // A step numbers itself: it keeps its meta but takes no title.
        if (type === 'step') c.adm.title = joinTitleMeta('', splitTitleMeta(c.adm.title ?? '').meta);
      })),
      pills('Collapsible', COLLAPSIBLE, adm.prefix, prefix => edit(uuid, c => { c.adm.prefix = prefix; })),
      actions(md, hit),
    ],
  };
}

function tabsSettings(md, tabUuid) {
  const owner = findOwner(md, 'tab', tabUuid);
  const set = owner && nodeEl(owner.component.grp.uuid);
  if (!set) return null;
  const tabs = owner.component.grp.tabs;
  const i = owner.childIndex;
  const change = (fn, after) => pushOp(OPS.editChildren('tab', tabUuid, fn), after);
  const stay = () => { showTab(tabUuid); select(tabUuid); };
  const shift = by => change((list, at) => { list.splice(at + by, 0, ...list.splice(at, 1)); }, stay);
  return {
    label: 'Tab',
    span: [set, set],
    fields: [
      { kind: 'buttons', label: 'Tab', items: [
        { icon: 'plus', label: 'Add tab', run: () => {
          const tab = newTab(`Tab ${tabs.length + 1}`);
          change((list, at) => { list.splice(at + 1, 0, tab); }, () => { showTab(tab.uuid); select(tab.uuid); editPiece(`[data-mb-edit="tab-title"][data-mb-uuid="${tab.uuid}"]`, true); });
        } },
        { icon: 'arrow-left', label: 'Move left', off: i === 0, run: () => shift(-1) },
        { icon: 'arrow-right', label: 'Move right', off: i >= tabs.length - 1, run: () => shift(1) },
        { icon: 'panel-top-close', label: 'Delete tab', danger: true, run: () => {
          const next = tabs[i + 1]?.uuid ?? tabs[i - 1]?.uuid ?? null;
          if (change((list, at) => { list.splice(at, 1); }, () => { if (next) { showTab(next); select(next); } })) noteUndo('Tab deleted.');
        } },
      ] },
      { kind: 'heading', text: 'Content tabs' },
      actions(md, owner),
    ],
  };
}

// The grid's own style and actions: all there is when the grid is selected,
// and the second half of the popup when one of its cells is.
function gridFields(md, hit) {
  const uuid = hit.component.grid.uuid;
  return [
    pills('Style', [['generic', 'Plain'], ['card', 'Cards']], hit.component.grid.flavor === 'card' ? 'card' : 'generic',
      flavor => edit(uuid, c => { c.grid.flavor = flavor; })),
    actions(md, hit),
  ];
}

function cellSettings(md, cellUuid, el) {
  const owner = findOwner(md, 'cell', cellUuid);
  if (!owner) return null;
  const cells = owner.component.grid.cells;
  const i = owner.childIndex;
  const cell = cells[i];
  const change = (fn, after) => pushOp(OPS.editChildren('cell', cellUuid, fn), after);
  const shift = by => change((list, at) => { list.splice(at + by, 0, ...list.splice(at, 1)); });
  return {
    label: 'Grid cell',
    span: [el, el],
    fields: [
      pills('Allow Spill', [['false', 'False'], ['true', 'True']], String(!!cell.spill), v => change((list, at) => { list[at].spill = v === 'true'; })),
      pills('Vertical alignment', VALIGN, cell.valign ?? 'default', v => change((list, at) => { list[at].valign = v; })),
      { kind: 'buttons', label: 'Cell', items: [
        { icon: 'plus', label: 'Add cell', run: () => {
          const added = newCell();
          change((list, at) => { list.splice(at + 1, 0, added); }, () => { select(added.uuid); focusInto(added.uuid); });
        } },
        { icon: 'arrow-left', label: 'Move left', off: i === 0, run: () => shift(-1) },
        { icon: 'arrow-right', label: 'Move right', off: i >= cells.length - 1, run: () => shift(1) },
        { icon: 'trash-2', label: 'Delete cell', danger: true, run: () => {
          const next = cells[i + 1]?.uuid ?? cells[i - 1]?.uuid ?? null;
          if (change((list, at) => { list.splice(at, 1); }, () => select(next))) noteUndo('Cell deleted.');
        } },
      ] },
      { kind: 'heading', text: 'Grid' },
      ...gridFields(md, owner),
    ],
  };
}

function tableSettings(md, hit) {
  const tbl = hit.component.tbl;
  const uuid = tbl.uuid;
  const at = state.cellAt?.uuid === uuid ? state.cellAt : null;
  const rows = tbl.rows.length;
  const cols = tbl.align.length;
  // The cell the caret was in stays the one being typed into.
  const change = (fn, row, col) => edit(uuid, c => { fn(c.tbl); }, () => editCell(uuid, row, col));
  const inBody = !!at && at.row >= 0;
  return {
    label: 'Data table',
    fields: [
      pills('Text wrapping', [['enabled', 'Enabled'], ['disabled', 'Disabled']], tbl.wrap === false ? 'disabled' : 'enabled',
        v => edit(uuid, c => { c.tbl.wrap = v === 'enabled'; })),
      at && pills('Alignment', [['left', 'Left'], ['center', 'Center'], ['right', 'Right']], tbl.align[at.col] ?? 'left',
        v => change(t => TABLE.setAlign(t, at.col, v), at.row, at.col), 'Of the column the caret is in'),
      { kind: 'buttons', label: 'Row', items: [
        { icon: 'plus', label: 'Insert 1 row above', off: !inBody, run: () => change(t => TABLE.insertRow(t, at.row), at.row, at.col) },
        { icon: 'plus', label: 'Insert 1 row below', run: () => { const r = at ? at.row + 1 : rows; change(t => TABLE.insertRow(t, r), r, at ? at.col : 0); } },
        { icon: 'trash-2', label: 'Delete row', danger: true, off: !inBody || rows < 2, run: () => change(t => TABLE.deleteRow(t, at.row), Math.min(at.row, rows - 2), at.col) },
      ] },
      { kind: 'buttons', label: 'Column', items: [
        { icon: 'plus', label: 'Insert 1 column left', off: !at, run: () => change(t => TABLE.insertCol(t, at.col), at.row, at.col) },
        { icon: 'plus', label: 'Insert 1 column right', run: () => { const col = at ? at.col + 1 : cols; change(t => TABLE.insertCol(t, col), at ? at.row : -1, col); } },
        { icon: 'trash-2', label: 'Delete column', danger: true, off: !at || cols < 2, run: () => change(t => TABLE.deleteCol(t, at.col), at.row, Math.min(at.col, cols - 2)) },
      ] },
      actions(md, hit),
    ].filter(Boolean),
  };
}

function codeSettings(md, hit) {
  const cb = hit.component.cb;
  const uuid = cb.uuid;
  return {
    label: 'Code block',
    fields: [
      { kind: 'text', label: 'Language', value: cb.language, placeholder: 'e.g. python — leave empty for plain text',
        set: v => edit(uuid, c => { c.cb.language = v.trim().split(/\s+/)[0].replace(/[^\w#+.-]/g, ''); }) },
      { kind: 'text', label: 'Title', value: cb.title, placeholder: 'Optional — e.g. bubble_sort.py',
        set: v => edit(uuid, c => { c.cb.title = v.trim().replace(/"/g, "'"); }) },
      pills('Line numbers', [['off', 'Off'], ['on', 'On']], cb.linenums ? 'on' : 'off',
        v => edit(uuid, c => { c.cb.linenums = v === 'on' ? c.cb.linenums || '1' : ''; })),
      cb.linenums && { kind: 'number', label: 'First line number', value: cb.linenums, placeholder: '1',
        set: v => edit(uuid, c => { c.cb.linenums = String(Math.max(1, parseInt(v, 10) || 1)); }) },
      { kind: 'text', label: 'Highlighted lines', value: cb.hlLines, placeholder: 'Optional — e.g. 2 3 or 3-5',
        set: v => edit(uuid, c => { c.cb.hlLines = v.trim().replace(/[^\d\s-]/g, ''); }) },
      { kind: 'buttons', label: 'Annotations', items: [
        { icon: 'message-square-plus', label: 'Add annotation', run: () => {
          const line = caretLine(uuid); // the line the caret is on, else the end
          const warning = langWarningFor(cb.language);
          if (edit(uuid, c => { CODE.addAnnotation(c.cb, 'Annotation', line); }) && warning) setStatus(state.status, warning, { hideAfter: 6000 });
        } },
      ] },
      actions(md, hit),
    ].filter(Boolean),
  };
}

// The code line the caret is on, while that code block is being typed into.
function caretLine(uuid) {
  const a = state.active;
  const sel = window.getSelection();
  if (!a || a.el.dataset.mbEdit !== 'code' || a.el.dataset.mbUuid !== uuid || !sel?.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!a.el.contains(range.startContainer)) return null;
  const before = document.createRange();
  before.selectNodeContents(a.el);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString().split('\n').length - 1;
}

function buttonSettings(md, hit) {
  const btn = hit.component.btn;
  const uuid = btn.uuid;
  const support = isSupportOnclick(btn.onclick);
  // Internal page or URL is a matter of what the destination looks like, until
  // one is picked here: an empty destination has no look of its own.
  const dest = support || btn.destination === '#' ? '' : btn.destination ?? '';
  const destKind = support ? 'support' : state.destKinds.get(uuid) ?? (isInternalHrefShape(dest) ? 'internal' : 'url');
  const option = (key, label, options) => pills(label, options, btn[key] ?? 'default', v => edit(uuid, c => { c.btn[key] = v; }));
  return {
    label: 'Button',
    fields: [
      { kind: 'swatches', label: 'Colour', groups: palette?.groups ?? {}, value: btn.colour ?? '',
        set: slug => edit(uuid, c => { c.btn.colour = slug; c.btn.primary = false; }) },
      option('style', 'Style', [['default', 'Default'], ['slim', 'Slim (full width)']]),
      pills('Destination', [['internal', 'Internal page'], ['url', 'URL'], ['support', 'Support widget']], destKind, v => {
        state.destKinds.set(uuid, v);
        edit(uuid, c => {
          if (v === 'support') {
            if (!isSupportOnclick(c.btn.onclick)) c.btn.onclick = SUPPORT_ONCLICK;
            c.btn.destination = '#';
            c.btn.newTab = false;
          } else if (isSupportOnclick(c.btn.onclick)) {
            c.btn.onclick = '';
          }
        });
      }),
      support
        ? { kind: 'note', text: 'Opens the support widget popup instead of navigating.' }
        : { kind: 'text', value: dest,
          placeholder: destKind === 'internal' ? 'The page\'s file, e.g. overview.md' : 'Where the button links to, e.g. /signup or https://…',
          set: v => edit(uuid, c => { c.btn.destination = v.trim().replace(/[\s)]/g, '') || '#'; }) },
      { kind: 'text', label: 'Icon', hint: '(optional)', value: (btn.icon ?? '').replace(/^lucide\//, ''), placeholder: 'A lucide icon name, e.g. arrow-right',
        set: v => edit(uuid, c => {
          const name = v.trim().toLowerCase().replace(/^:?lucide[/-]/, '').replace(/[^a-z0-9-]/g, '');
          c.btn.icon = name ? `lucide/${name}` : '';
        }) },
      !support && pills('Open in new tab?', YES_NO, btn.newTab ? 'yes' : 'no', v => edit(uuid, c => { c.btn.newTab = v === 'yes'; })),
      { kind: 'heading', text: 'Advanced' },
      option('theme', 'Theme', [['default', 'Default'], ['inversed', 'Inversed'], ['force-light', 'Force light'], ['force-dark', 'Force dark']]),
      option('border', 'Border', [['default', 'Default'], ['bordered', 'Always'], ['border-light', 'Light only'], ['border-dark', 'Dark only'], ['borderless', 'None']]),
      actions(md, hit),
    ].filter(Boolean),
  };
}

function navLinksSettings(md, hit) {
  const nav = hit.component.nav;
  const uuid = nav.uuid;
  const byTag = nav.tag != null;
  return {
    label: 'Nav links',
    fields: [
      pills('List by', [['path', 'Nav path'], ['tag', 'Tag']], byTag ? 'tag' : 'path', mode => edit(uuid, c => {
        const newTab = !!c.nav.newTab;
        c.nav = mode === 'tag' ? { uuid, tag: c.nav.tag ?? '', layout: 'flat', newTab } : { uuid, path: c.nav.path ?? '', newTab };
      }), 'Pages under a nav path, or pages carrying a tag'),
      !byTag && { kind: 'text', label: 'Path', hint: 'e.g. guides, or guides/employees', value: nav.path ?? '', placeholder: 'Part of the nav tree to list, e.g. guides/employees',
        set: v => edit(uuid, c => { c.nav.path = v.trim(); }) },
      byTag && { kind: 'text', label: 'Tags', hint: 'Pages carrying any of these tags are listed', value: nav.tag ?? '', placeholder: 'e.g. System, RAMS',
        set: v => edit(uuid, c => { c.nav.tag = v.trim(); }) },
      byTag && pills('Layout', [['flat', 'Flat'], ['grouped', 'Grouped']], nav.layout === 'grouped' ? 'grouped' : 'flat',
        v => edit(uuid, c => { c.nav.layout = v; }), 'One flat list of links, or grouped under their nav sections'),
      pills('Open in new tab?', YES_NO, nav.newTab ? 'yes' : 'no', v => edit(uuid, c => { c.nav.newTab = v === 'yes'; })),
      actions(md, hit),
    ].filter(Boolean),
  };
}

function mediaSettings(md, hit) {
  const kind = hit.component.kind;
  const key = MEDIA_FIELD[kind];
  const noun = MEDIA_NOUN[kind];
  if (!key) return null;
  const m = hit.component[key];
  const uuid = m.uuid;
  // Theme means nothing without a light and dark pair (images, single videos).
  const paired = kind === 'capture' || !!m.darkFilename;
  return {
    label: titleCase(noun),
    fields: [
      { kind: 'size', label: 'Dimension', mode: m.dimMode ?? 'none', value: m.dimValue,
        set: (mode, value) => edit(uuid, c => {
          c[key].dimMode = mode;
          c[key].dimValue = mode === 'none' ? null : Math.max(1, parseInt(value, 10) || 300);
        }) },
      kind === 'video' && pills('Playback', [['animation', 'Animation'], ['clip', 'Clip']], m.playback === 'clip' ? 'clip' : 'animation',
        v => edit(uuid, c => { c.vid.playback = v; })),
      paired && pills('Theme', [['default', 'Default'], ['inversed', 'Inversed']], m.inversed ? 'inversed' : 'default',
        v => edit(uuid, c => { c[key].inversed = v === 'inversed'; })),
      pills('Corner rounding', [['disabled', 'Disabled'], ['enabled', 'Enabled']], m.rounded ? 'enabled' : 'disabled',
        v => edit(uuid, c => { c[key].rounded = v === 'enabled'; })),
      { kind: 'buttons', label: titleCase(noun), items: [
        { icon: 'replace', label: `Choose a different ${noun}`, run: () => {
          closeSettings();
          openPicker(kind, nodeEl(uuid), pick => edit(uuid, c => { Object.assign(c[key], mediaFiles(kind, pick)); }));
        } },
      ] },
      actions(md, hit),
    ].filter(Boolean),
  };
}

// ── Editing in place ─────────────────────────────────────────────────────────
// One piece at a time is "active": the element itself is the editable surface
// and every change lands in the pending edits as it is typed.
//
// A piece is described by { mode, value, commit(value), html(value) }:
//   rich    the rich text editor, multi-line (format buttons float over a selection)
//   inline  the rich text editor, one line
//   plain   plain text, one line
//   source  plain text, multi-line (code, markdown source)
// `html` is how the page shows the value once editing ends; `redraw` redraws
// the whole page instead, for an edit that changes more than its own element.

const oneLine = text => String(text ?? '').replace(/\s+/g, ' ').trim();

function pieceFor(el) {
  const md = workingMd();

  if (el.matches('.mb-kb-text')) {
    // A text block, or a place to start one: an empty line in a container
    // (`data-mb-at` is where the block goes). The block is made by typing, and
    // its identity is minted once, when the place is first typed into.
    const place = el.dataset.mbText !== 'block';
    const container = place ? { kind: el.dataset.mbText, uuid: el.dataset.mbUuid } : null;
    if (place && !readContainer(md, container)) return null;
    const uuid = place ? (el.dataset.mbNew ??= generateUUID()) : el.dataset.mbUuid;
    const block = findComponent(md, uuid)?.component;
    if (!place && block?.kind !== 'text') return null;
    const at = Number(el.dataset.mbAt ?? 0);
    const source = state.markdownView;
    return {
      mode: source ? 'source' : 'rich',
      value: (block?.txt?.body ?? '').trim(),
      placeholder: source ? 'Write something…' : 'Click / to insert',
      commit: v => typeOp(OPS.putText(uuid, v.trim(), container, at)),
      html: v => (source ? esc(v.trim()) : renderTextHtml(v.trim(), { assetUrl })),
      done: (fresh, v) => fresh.classList.toggle('--empty', !v.trim()),
      // A place that now holds a block, or a block emptied away: the page is
      // drawn again so what stands there is what the draft holds.
      redrawIf: v => place || !v.trim(),
    };
  }

  if (el.matches('h1, h2, h3')) {
    const uuid = el.dataset.mbNode;
    const sec = (buildSectionTree(md).sections ?? []).find(s => s.uuid === uuid);
    if (!sec) return null;
    // A heading cannot be blank: an emptied one goes back to what it was.
    const titleOf = v => oneLine(v) || sec.title;
    return {
      mode: 'plain',
      value: sec.title,
      commit: v => {
        const op = OPS.setSectionTitle(uuid, titleOf(v));
        if (sec.level === 1) op.navTitle = titleOf(v); // the H1 is the page's name in the navigation too
        typeOp(op);
      },
      html: v => (state.markdownView ? esc(titleOf(v)) : renderInlineHtml(titleOf(v), { assetUrl })),
    };
  }

  const uuid = el.dataset.mbUuid;
  switch (el.dataset.mbEdit) {
    case 'adm-title': {
      const adm = findComponent(md, uuid)?.component.adm;
      if (!adm) return null;
      const fallback = ADMONITION_TYPE_LABELS[adm.type] ?? adm.type;
      return {
        mode: 'inline',
        buttons: ['label', 'icon', 'clear'],
        value: splitTitleMeta(adm.title ?? '').title,
        placeholder: fallback,
        commit: v => typeOp(OPS.editComponent(uuid, c => {
          c.adm.title = joinTitleMeta(oneLine(v).replace(/"/g, "'"), splitTitleMeta(c.adm.title ?? '').meta);
        }, `adm-title|${uuid}`)),
        html: v => renderInlineHtml(oneLine(v) || fallback, { assetUrl }),
      };
    }
    case 'tab-title': {
      const owner = findOwner(md, 'tab', uuid);
      if (!owner) return null;
      const was = owner.component.grp.tabs[owner.childIndex].title;
      const titleOf = v => oneLine(v).replace(/"/g, "'") || was;
      return {
        mode: 'plain',
        value: was,
        commit: v => typeOp(OPS.editChildren('tab', uuid, (tabs, i) => { tabs[i].title = titleOf(v); }, `tab-title|${uuid}`)),
        html: v => renderInlineHtml(titleOf(v), { assetUrl }),
      };
    }
    case 'cell': {
      const tbl = findComponent(md, uuid)?.component.tbl;
      if (!tbl) return null;
      const row = Number(el.dataset.mbRow);
      const col = Number(el.dataset.mbCol);
      return {
        mode: 'inline',
        value: (row < 0 ? tbl.header[col] : tbl.rows[row]?.[col]) ?? '',
        commit: v => typeOp(OPS.editComponent(uuid, c => { TABLE.setCell(c.tbl, row, col, oneLine(v)); }, `cell|${uuid}|${row}|${col}`)),
        html: v => renderInlineHtml(oneLine(v), { assetUrl }),
      };
    }
    case 'btn-label': {
      const btn = findComponent(md, uuid)?.component.btn;
      if (!btn) return null;
      const labelOfValue = v => oneLine(v).replace(/[[\]]/g, '');
      return {
        mode: 'plain',
        value: btn.label ?? '',
        placeholder: 'Button',
        commit: v => typeOp(OPS.editComponent(uuid, c => { c.btn.label = labelOfValue(v); }, `btn-label|${uuid}`)),
        html: v => renderInlineHtml(labelOfValue(v), { assetUrl }),
      };
    }
    case 'code': {
      const cb = findComponent(md, uuid)?.component.cb;
      if (!cb) return null;
      return {
        mode: 'source',
        value: cb.code ?? '',
        // A line of ``` would end the block early.
        commit: v => typeOp(OPS.editComponent(uuid, c => { c.cb.code = v.replace(/^(\s*)```/gm, "$1'''"); }, `code|${uuid}`)),
        html: v => esc(v),
      };
    }
    case 'annotation': {
      const cb = findComponent(md, uuid)?.component.cb;
      const index = Number(el.dataset.mbIndex);
      if (!cb || cb.annotations?.[index] == null) return null;
      return {
        mode: 'source',
        value: cb.annotations[index],
        commit: v => typeOp(OPS.editComponent(uuid, c => { CODE.setAnnotation(c.cb, index, v.trim()); }, `annotation|${uuid}|${index}`)),
        html: v => annotationHtml(v),
        redraw: true, // an emptied annotation takes its marker out of the code
      };
    }
    case 'diagram': {
      const dia = findComponent(md, uuid)?.component.dia;
      if (!dia) return null;
      return {
        mode: 'source',
        value: dia.code ?? '',
        commit: v => typeOp(OPS.editComponent(uuid, c => { c.dia.code = v.replace(/^(\s*)```/gm, "$1'''"); }, `diagram|${uuid}`)),
        html: v => esc(v),
        redraw: true, // the site's drawing no longer matches: the source takes its place
      };
    }
    default:
      return null;
  }
}

function caretToEnd(el) {
  const sel = window.getSelection();
  sel?.selectAllChildren(el);
  sel?.collapseToEnd();
}

/** Start editing a piece. False when it cannot be edited. */
function activate(el) {
  if (state.active?.el === el) return true;
  deactivate();
  if (!el.isConnected) return false;
  const piece = pieceFor(el);
  if (!piece) return false;
  closePanel();

  const active = { ...piece, el, rte: null, changed: false };
  el.classList.remove('--empty');
  el.classList.add('mb-kb-editing-block');
  el.dataset.mbMode = piece.mode;
  if (piece.placeholder) el.dataset.placeholder = piece.placeholder;

  if (piece.mode === 'rich' || piece.mode === 'inline') {
    const rte = attachRichSurface(el, { value: piece.value, inline: piece.mode === 'inline', buttons: piece.buttons ?? null });
    active.rte = rte;
    rte.textarea.addEventListener('input', () => {
      active.value = rte.textarea.value;
      active.changed = true;
      piece.commit(active.value);
    });
  } else {
    el.textContent = piece.value;
    el.contentEditable = 'plaintext-only';
    el.spellcheck = piece.mode === 'plain';
    el.addEventListener('input', () => {
      // The browser keeps one extra newline at the end of multi-line text.
      active.value = piece.mode === 'plain' ? el.textContent : el.innerText.replace(/\n$/, '');
      active.changed = true;
      piece.commit(active.value);
    });
  }

  el.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); deactivate(); return; }
    if (e.key === 'Enter' && !e.isComposing && (piece.mode === 'plain' || piece.mode === 'inline')) {
      e.preventDefault();
      // Enter in a table cell goes down the column, as in a spreadsheet.
      if (el.dataset.mbEdit === 'cell') nextCell(el, e.shiftKey ? -1 : 1, 0); else deactivate();
      return;
    }
    if (e.key === 'Tab' && el.dataset.mbEdit === 'cell') { e.preventDefault(); nextCell(el, 0, e.shiftKey ? -1 : 1); return; }
    if (e.key === 'Tab' && piece.mode === 'source' && !e.shiftKey) { e.preventDefault(); document.execCommand('insertText', false, '  '); }
  });

  state.active = active;
  if (el.dataset.mbEdit === 'cell') state.cellAt = { uuid: el.dataset.mbUuid, row: Number(el.dataset.mbRow), col: Number(el.dataset.mbCol) };
  const owner = nodeFor(el)?.dataset.mbNode ?? null;
  if (owner !== state.sel || el.dataset.mbEdit === 'cell') select(owner);
  return true;
}

/**
 * Stop editing: the piece is redrawn as the page shows it, its edit kept
 * pending. True when that redrew the whole page (elements held from before it
 * are then gone).
 */
function deactivate() {
  const a = state?.active;
  if (!a) return false;
  state.active = null;
  a.rte?.destroy();
  settle();
  if ((a.redraw || a.redrawIf?.(a.value)) && a.changed) {
    render();
    return true;
  }
  // A clean copy, free of the editing listeners.
  const fresh = a.el.cloneNode(false);
  for (const attr of ['contenteditable', 'role', 'aria-multiline', 'spellcheck', 'data-placeholder', 'data-mb-mode']) fresh.removeAttribute(attr);
  fresh.classList.remove('mb-kb-editing-block');
  fresh.innerHTML = a.html(a.value);
  a.done?.(fresh, a.value);
  if (a.el.isConnected) a.el.replaceWith(fresh);
  paintInlineAtoms(fresh);
  return false;
}

/** Start typing in a piece found by selector, the caret at its end (or its text selected). */
function editPiece(selector, selectAll = false) {
  const el = typeof selector === 'string' ? state.article.querySelector(selector) : selector;
  if (!el || !activate(el)) return false;
  el.focus();
  if (selectAll) window.getSelection()?.selectAllChildren(el); else caretToEnd(el);
  el.scrollIntoView({ block: 'nearest' });
  return true;
}

const cellSelector = (uuid, row, col) =>
  `[data-mb-edit="cell"][data-mb-uuid="${CSS.escape(uuid)}"][data-mb-row="${row}"][data-mb-col="${col}"]`;

function editCell(uuid, row, col) {
  if (!editPiece(cellSelector(uuid, row, col))) select(uuid);
}

// Enter / Tab in a table cell: on to the next one, wrapping at the row's end.
// Past the last cell, the edit simply ends.
function nextCell(el, dRow, dCol) {
  const uuid = el.dataset.mbUuid;
  const tbl = findComponent(workingMd(), uuid)?.component.tbl;
  if (!tbl) { deactivate(); return; }
  const cols = tbl.align.length;
  let row = Number(el.dataset.mbRow) + dRow;
  let col = Number(el.dataset.mbCol) + dCol;
  if (col >= cols) { col = 0; row++; }
  if (col < 0) { col = cols - 1; row--; }
  // Tab out of the last cell carries on into a new row.
  if (dCol > 0 && row >= tbl.rows.length) {
    edit(uuid, c => { TABLE.insertRow(c.tbl, row); }, () => editCell(uuid, row, 0));
    return;
  }
  if (row < -1 || row >= tbl.rows.length || !editPiece(cellSelector(uuid, row, col), true)) deactivate();
}

/** Put the caret in the first thing to type into inside a node (a new component, say). */
function focusInto(uuid) {
  const node = nodeEl(uuid);
  if (!node) return;
  node.scrollIntoView({ block: 'nearest' });
  const text = node.matches('.tabbed-set') ? shownTabOf(node)?.querySelector('.mb-kb-text') : node.querySelector('.mb-kb-text');
  const el = text ?? node.querySelector('[data-mb-edit]:not([data-mb-edit="adm-title"])');
  if (el) editPiece(el, !!el.dataset.mbEdit && el.dataset.mbEdit !== 'code');
}

// ── Create mode ──────────────────────────────────────────────────────────────

/**
 * The insert menu for one place on the page. `target` is { kind, uuid, at }
 * (a container and a component index), or null on a page with no section to
 * insert into; `section` adds "Section".
 */
function openInsertMenu(anchor, target, section = false) {
  const items = [];
  if (section) items.push({ id: 'section', label: 'Section' });
  if (section && target) items.push({ divider: true });
  if (target) items.push(...INSERT_ITEMS);
  openPopupMenu(anchor, items, id => pickInsert(id, target, anchor));
}

function pickInsert(id, target, anchor) {
  if (id === 'section') { addSection(null, 2); return; }
  if (id === 'text') { startText(target, anchor); return; }
  const container = { kind: target.kind, uuid: target.uuid };
  const insert = (components, focus = true) => {
    const first = uuidOfComponent(components[0]);
    pushOp(OPS.insertComponents(container, target.at, components), () => {
      select(first);
      if (focus) focusInto(first); else reveal(first);
    });
  };
  if (MEDIA_FIELD[id]) {
    openPicker(id, anchor.closest('.mb-kb-insert') ?? anchor, pick => insert([mediaComponent(id, pick)], false));
    return;
  }
  if (id === 'paste') {
    openPastePanel(anchor.closest('.mb-kb-insert') ?? anchor, components => insert(components, false));
    return;
  }
  const component = newComponent(id);
  if (!component) return;
  insert([component], id !== 'navlinks');
  // Nav links are nothing until told what to list: ask straight away.
  if (id === 'navlinks' && state.sel === component.nav.uuid) openSettings();
}

// New text at an insert point: an empty line to type on, standing where the
// block will go. Nothing joins the draft until something is typed.
function startText(target, anchor) {
  deactivate();
  const slot = anchor.closest('.mb-kb-insert');
  const el = document.createElement('div');
  el.className = `mb-kb-text mb-kb-text--new${state.markdownView ? ' --md' : ''}`;
  el.dataset.mbText = target.kind;
  el.dataset.mbUuid = target.uuid;
  el.dataset.mbAt = String(target.at);
  if (slot) slot.before(el); else state.article.querySelector('.mb-kb-addnew')?.before(el);
  editPiece(el);
}

// A new section: a top-level one at the end of the page, or a subsection at
// the end of `parentUuid`. Its title is selected, ready to be typed over.
function addSection(parentUuid, level) {
  const h1 = (buildSectionTree(workingMd()).sections ?? []).find(s => s.level === 1);
  const uuid = generateUUID();
  pushOp(OPS.addSection({ uuid, title: level === 3 ? 'New subsection' : 'New section', parentUuid: parentUuid ?? h1?.uuid ?? null, level }), () => {
    select(uuid);
    editPiece(nodeEl(uuid), true);
  });
}

// Where the "Add new" card inserts: after the last component of the last section.
function lastSectionTarget() {
  const md = workingMd();
  const sections = buildSectionTree(md).sections ?? [];
  const last = sections[sections.length - 1];
  if (!last?.uuid) return null;
  const container = { kind: TEXT_KIND.section, uuid: last.uuid };
  return { ...container, at: readContainer(md, container)?.components.length ?? 0 };
}

// ── Panels drawn in the page ─────────────────────────────────────────────────
// The media library and the paste box open in the page's own flow, right
// where the thing they produce will go.

function closePanel() {
  const panel = state?.panel;
  if (!panel) return;
  state.panel = null;
  panel.el.remove();
}

// Resolves to the panel's body, or null when its place on the page is gone.
function openPanel(anchor, title) {
  closePanel();
  if (deactivate() || !anchor?.isConnected) return null;
  const el = document.createElement('div');
  el.className = 'mb-kb-panel';
  el.innerHTML = `<div class="mb-kb-panel__head"><strong></strong><button type="button" class="mb-kb-panel__close" aria-label="Close"><span class="more-buttons-icon">x</span></button></div><div class="mb-kb-panel__body"></div>`;
  el.querySelector('strong').textContent = title;
  el.querySelector('.mb-kb-panel__close').addEventListener('click', closePanel);
  el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePanel(); } });
  anchor.after(el);
  state.panel = { el };
  el.scrollIntoView({ block: 'nearest' });
  return el.querySelector('.mb-kb-panel__body');
}

const IMAGE_FILE_RE = /\.(png|svg|jpe?g|gif|webp)$/i;

/**
 * The media library, narrowed to one kind of file, drawn after `anchor`.
 * `onPick` gets { light, dark, single } repo paths.
 */
async function openPicker(kind, anchor, onPick) {
  const body = openPanel(anchor, `Choose ${kind === 'image' ? 'an' : 'a'} ${MEDIA_NOUN[kind]} from the library`);
  if (!body) return;
  const panel = state.panel;
  body.innerHTML = '<p class="mb-kb-panel__note">Loading the media library…</p>';
  let tabs;
  try {
    state.mediaPaths ??= listMediaPaths();
    const paths = await state.mediaPaths;
    const { exts, shape } = MEDIA_ACCEPT[kind];
    tabs = groupMediaPaths(paths, MEDIA_ROOT)
      .filter(group => group.key !== SU_DIR) // system updates keep their own frozen copies
      .map(group => ({ ...group, nodes: buildMediaNodes(group.paths, { root: group.root, exts, shape }) }))
      .filter(tab => tab.nodes.length);
  } catch (err) {
    state.mediaPaths = null;
    if (state.panel === panel) body.innerHTML = `<p class="mb-kb-panel__note">Could not load the media library: ${esc(err.message)}</p>`;
    return;
  }
  if (state.panel !== panel) return; // closed while loading
  if (!tabs.length) {
    body.innerHTML = `<p class="mb-kb-panel__note">The library has no ${MEDIA_NOUN[kind]}s yet. Add them from the Media Library on the webapp.</p>`;
    return;
  }

  let current = tabs[0].key;
  const draw = () => {
    const tab = tabs.find(t => t.key === current);
    body.innerHTML = (tabs.length > 1
      ? `<div class="mb-kb-panel__tabs">${tabs.map(t => `<button type="button" class="mb-kb-panel__tab${t.key === current ? ' --active' : ''}" data-tab="${esc(t.key)}">${esc(t.label)}</button>`).join('')}</div>`
      : '') + renderTree(tab.nodes, { emptyMessage: 'Nothing here.' });
    // A small preview on each image, loaded as it scrolls into view.
    body.querySelectorAll('[data-kb-leaf]').forEach(leaf => {
      const path = leaf.dataset.mediaLight || leaf.dataset.mediaSingle;
      if (!path || !IMAGE_FILE_RE.test(path)) return;
      const img = document.createElement('img');
      img.className = 'mb-kb-panel__thumb';
      img.loading = 'lazy';
      img.alt = '';
      img.src = assetCdnUrl(path);
      leaf.querySelector('.mb-kb-node-icon')?.replaceWith(img);
    });
    body.querySelector('.mb-kb-search')?.focus({ preventScroll: true });
  };
  body.addEventListener('input', e => {
    const tree = body.querySelector('.mb-kb-tree');
    if (tree && e.target.closest?.('.mb-kb-search')) applySearch(tree, e.target.value);
  });
  body.addEventListener('click', e => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { current = tab.dataset.tab; draw(); return; }
    const folder = e.target.closest('[data-kb-section]');
    if (folder) { folder.closest('.mb-kb-node')?.classList.toggle('--collapsed'); return; }
    const leaf = e.target.closest('[data-kb-leaf]');
    if (!leaf) return;
    const { mediaLight: light, mediaDark: dark, mediaSingle: single } = leaf.dataset;
    closePanel();
    onPick({ light, dark, single });
  });
  draw();
}

// "Paste copied markdown": what a component's Copy button put on the clipboard.
function openPastePanel(anchor, onComponents) {
  const body = openPanel(anchor, 'Paste copied markdown');
  if (!body) return;
  body.innerHTML = '<textarea class="mb-kb-panel__paste" rows="4" spellcheck="false" placeholder="Paste here (Ctrl/Cmd+V). Markdown copied from a component is inserted at this point."></textarea><p class="mb-kb-panel__note" data-paste-error hidden></p>';
  const box = body.querySelector('textarea');
  const error = body.querySelector('[data-paste-error]');
  const read = () => {
    if (!box.value.trim()) return;
    const { components, error: problem } = parsePastedComponents(box.value);
    if (components) { closePanel(); onComponents(components); return; }
    error.textContent = problem;
    error.hidden = false;
  };
  box.addEventListener('paste', () => setTimeout(read, 0));
  box.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); read(); } });
  box.focus({ preventScroll: true });
}

// ── Events ───────────────────────────────────────────────────────────────────

function wire() {
  const { article } = state;

  article.addEventListener('mousedown', onArticleMouseDown, true);
  article.addEventListener('click', onArticleClick, true);

  // An asset committed after the last site build is not on the site yet:
  // fall back to the repo's copy, once.
  article.addEventListener('error', e => {
    const el = e.target;
    if (!(el instanceof HTMLImageElement || el instanceof HTMLVideoElement) || el.dataset.mbRetried) return;
    let url;
    try { url = new URL(el.src, location.href); } catch { return; }
    if (url.origin !== location.origin || !url.pathname.startsWith('/assets/')) return;
    el.dataset.mbRetried = '1';
    el.src = assetCdnUrl('docs' + url.pathname) + url.hash;
  }, true);

  // A space typed into a collapsible admonition's title would fold it.
  article.addEventListener('keyup', e => {
    if (e.key === ' ' && state.active && e.target instanceof Element && e.target.closest('summary')) e.preventDefault();
  });

  // Leaving the piece being edited (a click or a focus move anywhere but the
  // piece itself, the bar, the settings rail, the floating format bar / insert
  // menu / popovers and the menus) ends the edit.
  const leftActive = target => {
    const a = state.active;
    return !!a && target instanceof Element && !a.el.contains(target) && !state.bar.contains(target)
      && !state.rail.el.contains(target) && !target.closest('.mb-popup-menu, .mb-rte-float');
  };
  document.addEventListener('mousedown', e => {
    // A press on the page closes the settings popup (the bar and the menus do not).
    if (e.target instanceof Element && !state.rail.el.contains(e.target) && !state.bar.contains(e.target)
      && !e.target.closest('.mb-popup-menu')) closeSettings();
    // A press inside the article is handled there (it may start the next edit).
    if (leftActive(e.target) && !article.contains(e.target)) deactivate();
  }, true);
  document.addEventListener('focusin', e => { if (leftActive(e.target)) deactivate(); });

  document.addEventListener('keydown', onKeyDown);

  window.addEventListener('beforeunload', e => {
    if (state.leaving) return;
    settle();
    if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
  });
}

const inField = el => el instanceof Element && !!el.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');

function onKeyDown(e) {
  if (document.querySelector('.mb-editlog-popup')) return; // the edit log popup has the keyboard
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();
  if (mod && !e.shiftKey && !e.altKey && key === 's') {
    e.preventDefault();
    save();
    return;
  }
  if (inField(e.target)) return; // typing: the keys below are the text's own
  if (mod && !e.shiftKey && !e.altKey && key === 'z') {
    e.preventDefault();
    undo();
  } else if (e.key === 'Escape') {
    if (state.rail.open) closeSettings(); else if (state.panel) closePanel(); else if (state.sel) select(null);
  }
  // No Delete key for the selection: nothing on the page shows what is
  // selected, so a stray key press could take out something unseen. Delete is
  // in the cog's popup.
}

const editableAt = target => {
  const el = target instanceof Element ? target.closest(EDITABLE) : null;
  // The label of a tab that is not showing switches to it; only the shown one is typed into.
  if (el?.dataset.mbEdit === 'tab-title' && nodeFor(el) !== shownTabOf(el.closest('.tabbed-set'))) return null;
  return el;
};

const inChrome = t => !!t.closest('.mb-kb-panel, .mb-kb-insert, .mb-kb-addnew');

// Editing starts on the press, not the click: the piece is made editable (and
// redrawn as its editing surface) before the browser places the caret, so the
// caret lands under the pointer and a drag selects.
function onArticleMouseDown(e) {
  if (e.button !== 0) return;
  // Closing the settings popup can apply a typed value and redraw the page
  // under the press: what was pressed is then found again, and selected here
  // (no click follows a press whose target is gone).
  const redrawn = e.target instanceof Element && !e.target.isConnected;
  const t = redrawn ? document.elementFromPoint(e.clientX, e.clientY) : e.target;
  if (!(t instanceof Element) || !state.article.contains(t) || t.closest('.mb-kb-panel')) return;
  if (redrawn && !inChrome(t)) select(nodeFor(t)?.dataset.mbNode ?? null);
  // An insert point: whatever was being typed is finished first.
  if (inChrome(t)) { deactivate(); return; }
  if (t.closest('a') && (e.metaKey || e.ctrlKey)) return; // Cmd/Ctrl+click follows the link
  let el = editableAt(t);
  if (state.active && state.active.el !== el) {
    // Ending the edit in progress may redraw the page: find the target again.
    if (deactivate()) el = editableAt(document.elementFromPoint(e.clientX, e.clientY));
  }
  if (!el || state.active?.el === el) return;
  if (!activate(el)) return;
  // The press began on markup the redraw just replaced, which can leave the
  // browser with nowhere to put the caret: place it from the pointer if so.
  const { clientX, clientY } = e;
  setTimeout(() => {
    if (state?.active?.el !== el) return;
    const sel = window.getSelection();
    if (sel?.anchorNode && el.contains(sel.anchorNode) && document.activeElement === el) return;
    el.focus();
    const range = document.caretRangeFromPoint?.(clientX, clientY);
    if (range && el.contains(range.startContainer)) { sel.removeAllRanges(); sel.addRange(range); }
    else caretToEnd(el);
  }, 0);
}

function onArticleClick(e) {
  const t = e.target;
  if (!(t instanceof Element) || t.closest('.mb-kb-panel')) return;
  // A tab's label clicks its radio for it: that second click is not the user's.
  if (t.matches('.tabbed-set > input')) return;
  const link = t.closest('a');
  if (link && (e.metaKey || e.ctrlKey)) return;              // Cmd/Ctrl+click follows the link
  if (link) e.preventDefault();

  const insert = t.closest('.mb-kb-insert');
  if (insert) {
    e.preventDefault();
    const { mbInsertKind: kind, mbInsertUuid: uuid, mbInsertAt: at } = insert.dataset;
    openInsertMenu(insert.querySelector('.mb-kb-insert__btn') ?? insert, { kind, uuid, at: Number(at) });
    return;
  }
  const addNew = t.closest('.mb-kb-addnew');
  if (addNew) {
    e.preventDefault();
    openInsertMenu(addNew, lastSectionTarget(), true);
    return;
  }

  // Typing in a collapsible admonition's title or a tab's label: the click
  // places the caret, it does not fold the admonition or re-pick the tab.
  if (state.active && state.active.el.contains(t) && t.closest('summary, label')) e.preventDefault();

  const cell = t.closest('[data-mb-edit="cell"]');
  if (cell) state.cellAt = { uuid: cell.dataset.mbUuid, row: Number(cell.dataset.mbRow), col: Number(cell.dataset.mbCol) };
  // A click on nothing in particular lets go of the selection.
  select(nodeFor(t)?.dataset.mbNode ?? null);
}

// ── Chrome ───────────────────────────────────────────────────────────────────

function ensureStylesheet() {
  if (document.getElementById('more-buttons-overlay-stylesheet')) return;
  const link = document.createElement('link');
  link.id = 'more-buttons-overlay-stylesheet';
  link.rel = 'stylesheet';
  link.href = chrome.runtime.getURL('config/forms/formsStyling.css');
  (document.head || document.documentElement).appendChild(link);
}

function ensureStatus() {
  ensureStylesheet();
  let el = document.querySelector('.mb-kb-status');
  if (!el) {
    el = document.createElement('div');
    el.className = 'mb-kb-status';
    el.setAttribute('role', 'status');
    el.hidden = true;
    document.body.appendChild(el);
  }
  return el;
}

let statusTimer = null;
function setStatus(el, text, { busy = false, tone = '', hideAfter = 0 } = {}) {
  clearTimeout(statusTimer);
  el.hidden = !text;
  el.textContent = text;
  el.classList.toggle('--busy', busy);
  el.classList.toggle('--ok', tone === 'ok');
  el.classList.toggle('--error', tone === 'error');
  if (hideAfter) statusTimer = setTimeout(() => setStatus(el, ''), hideAfter);
}
