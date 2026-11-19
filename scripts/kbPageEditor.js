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
 *   - Nothing stands beside a block. Two keys, held while pointing at a
 *     component (or section), put a faint dashed line round it and say what a
 *     click there will do:
 *       Shift       a click selects it; a press that moves drags it anywhere
 *                   on the page (kbPageDrag.js). Text is a block like any
 *                   other, so it moves the same way. In the text being typed
 *                   into, Shift+click stays the text's own (it stretches what
 *                   is highlighted).
 *       Cmd / Ctrl  a click opens that thing's settings (named as the form
 *                   editors name them) and its actions as the editor's
 *                   floating menu (floatMenu.js): loose pills in groups under
 *                   small headings, the rest of the page washed back.
 *   - An "Add" card under the page opens the menu of things to add at the end
 *     of the page (and adds sections); what is added is then dragged to where
 *     it belongs. A pick lands on the page at once, ready to type into; media
 *     is picked from a library panel drawn in the page at the insert point.
 *
 * The bottom bar (the form editors' action dock):
 *
 *   [N components selected, Copy, Unselect all] | [Undo, Redo] | [Save]
 *
 * Save is lit (green) only while there are changes to save. The first group is
 * there only while something is selected: Shift and a click on a block (a
 * press that does not become a drag) selects it, a second lets it go; on a
 * section's heading it selects the whole section. What is selected stands on a faint
 * dashed outline, and Copy puts the markdown of them all
 * on the clipboard, in page order.
 *
 * Being on a draft page is "edit mode". Above the title, two tabs:
 *
 *   [Draft] [Live]
 *
 * in the colours of the pill that ends the title (yellow, green). Live slides
 * the page across to the live page's content, drawn here the same way but read
 * only (`state.liveView`): nothing is typed into, no menus, no Add card, and
 * Shift only selects (for Copy), it does not drag. Draft slides back.
 * Pending edits are kept meanwhile. A page that has never been published has
 * its Live tab there but switched off.
 *
 * A page with no draft yet (`state.noDraft`) is edit mode with nothing to edit:
 * "This page has no draft yet" and Create draft under the same tabs, so its
 * live content can be looked at from there too.
 * On System Updates the live content is the page's headings and updates only
 * (kbUpdates.js liveUpdateGroups): its introduction and tiles are left out.
 *
 * Beside the title, as the theme's own icon buttons (kbSite.js):
 *
 *   [Page settings] [Undo] [Redo] [Markdown view] [Edit log] [Delete draft] [Publish]
 *
 * and on the Live tab: [Delete guide] [Edit log]. Delete guide removes the live
 * page, its draft and its navigation entries, after its title is typed out.
 *
 * Page settings (a cog) opens the page's own settings (icon, written for,
 * tags, visibility, hidden elements) in the block menu, beside it.
 *
 * Exit edit mode goes back to the live page: an icon in the site's header,
 * right of the "Edit mode" pill, there in every view.
 *
 * Markdown view swaps the page for the draft's whole markdown file, as it
 * would be saved right now. It is there to be read (and copied from): nothing
 * in it can be edited.
 *
 * Text formatting is not in the bar: its buttons float over highlighted text,
 * and typing `/` in text opens an insert menu (richTextEditor's
 * attachRichSurface owns both).
 *
 * The System Updates drafts page (/drafts/system-updates/) is edited here too,
 * with a few differences (`state.updates`; kbUpdates.js). It is a list of
 * updates waiting to be published, not a copy of a live page:
 *
 *   - No Delete draft or Publish icon beside the title, and the title itself
 *     is not edited. An update has no menu of its own and is not selected or
 *     moved; the blocks inside it are.
 *   - The card under the page reads "New system update" and offers the three
 *     update types. A new update opens with an empty title ("Update title")
 *     and an empty date ("Date of release", picked from a calendar). Save
 *     needs the title; Push to live needs the date as well.
 *   - Pointing at an update, or at anything inside it, slides a red "Delete from draft"
 *     out to its left and a purple "Push to live" out to its right
 *     (kbUpdateSide.js). Each acts on that one update, at once: Publish saves
 *     what is pending first, then moves the update to the live page.
 *
 *   - A published update does not vanish: the site takes minutes to build it
 *     into the live page, so it stays in the list, greyed and read only, under
 *     "Publishing: building and deploying…", until the live page shows it.
 *     Then it slides away. That is found out by reading the live page from the
 *     site itself, never by asking GitHub. While it waits it can be opened and
 *     closed, and pointing at it slides "Cancel publish" out to its left: that
 *     takes it off the live page and puts it back in the drafts.
 *
 * Nothing is written until Save. Every edit is an op (kbPageOps.js) held over
 * the draft as last read: the page is drawn from the draft with the ops
 * applied, Undo drops the last one, and Save replays them over the draft as it
 * is on GitHub at that moment, as one commit.
 */

import { readRepoText, assetCdnUrl } from './repoClient.js';
import { githubFetchAndPushFile, fetchFileMigratingIdentity } from './github.js';
import { writeGuideDraft, publishGuideFiles, discardGuideDraftFiles, deleteGuideFiles, renameGuideInNav, isGuideUnlisted, setGuideVisibility } from './guides.js';
import { watchIconSpans, getLucideSvgMarkup, lucideSvg } from './lucideIcons.js';
import { attachRichSurface, paintInlineAtoms } from './richTextEditor.js';
import { openPopupMenu, resolveMenuPlacement } from './insertMenu.js';
import { componentsMarkdown, uuidOfComponent, stripUUIDSpans } from './components.js';
import { ADMONITION_TYPE_LABELS, splitTitleMeta, joinTitleMeta, generateUUID } from './admonitions.js';
import { buildSectionTree, readSectionDescription, hasH3Children, locateSectionByUUID } from './sections.js';
import { SUPPORT_ONCLICK, isSupportOnclick } from './mdButtons.js';
import { isInternalHrefShape } from './internalPages.js';
import { langWarningFor, NO_COMMENT_LANGS, languageOptions, hasAnnotationMarker } from './codeAnnotations.js';
import { toModel, fromModel, readModel, modelHtml, codeInnerHtml, markerLines, lineCount, filledLines, paintNums, hlLineSet, toggleHlLine, shiftHlLines, guardBubbles, placeCaret, caretOffset, paintHl, paintCodeBlocks, attachCodeHover, openAnnTip, closeAnnTips, ANN } from './kbCode.js';
import { loadLabelPalette, paintLabelVars } from './labelPalette.js';
import { listMediaPaths, MEDIA_ROOT, MEDIA_ACCEPT } from './mediaLibrary.js';
import { groupMediaPaths, buildMediaNodes } from './mediaTree.js';
import { SU_DIR } from './captureDest.js';
import { needsFreezing, freezeCapturePick } from './captureFreeze.js';
import { renderTree, applySearch } from './kbTree.js';
import { renderGuidePage, pageChromeHtml, renderTextHtml, renderInlineHtml, annotationHtml, assetPathOf, TEXT_KIND, EMPTY_TEXT, UPDATE_TITLE_PLACEHOLDER, readPageTitle, pageTitleBody } from './kbPageRender.js';
import {
  OPS, TABLE, CODE, applyOps, dropEmptyText, commitForOps, findComponent, findOwner, readContainer,
  newComponent, newUpdate, newTab, mediaComponent, mediaFiles, splitParagraphs, parsePastedPage,
  findPageTitle, canPlacePageTitle, newPageTitle, withoutPageTitles,
  readPageSettings, PAGE_HIDES,
} from './kbPageOps.js';
import { AUDIENCES, AUDIENCE_NONE } from './audienceTags.js';
import { loadTagRegistry, loadAudiences } from './tagRegistry.js';
import {
  isUpdatesPage, isUpdateType, UPDATE_TYPES, UPDATES_ROOT, updateComponents, splitUpdateTitle, joinUpdateTitle,
  formatUpdateDate, isoOfUpdateDate, missingUpdateFields, missingMessage, commitForUpdates,
  PUBLISH_WATCH, liveShowsUpdate, pendingPublishes,
} from './kbUpdates.js';
import { attachUpdateSide, slideOut } from './kbUpdateSide.js';
import { openDatePicker, closeDatePicker } from './kbDatePicker.js';
import { publishDraftAsSaved, deleteDraft as deleteDraftUpdate, draftLiveUpdate, publishDeleteUpdate, cancelPublishedUpdate } from './systemUpdates.js';
import { followDrag, blockTarget, sideTarget, sectionTarget, tabTarget, labelAt, carryBlocks, carryTab, isOver } from './kbPageDrag.js';
import { typePills } from './kbTypePicker.js';
import { MENU_GAP, MENU_MAX_WIDTH, createVeil, menuBreak, menuGroup, menuInput, menuOption, menuPill, menuRow, playIn, stepPills } from './floatMenu.js';
import { iconMatchPills, typedIconName } from './iconPills.js';
import { loadLucideNames, rankMatches } from './iconPicker.js';
import { attachToc } from './kbToc.js';
import { startKbComments } from './kbCommentsUi.js';
import { readFrontmatterHide } from './frontmatter.js';
import { currentKbPage, refreshKbSite, injectLogButton, injectPageButton, injectCreateDraftButton, setThemeTip } from './kbSite.js';
import { captureMenuItem, captureTabPick, deliveredCaptureComponent } from './kbCaptureTabs.js';
import { mediaEntryKey, mediaEntryUrl } from './kbMediaEntry.js';
import { CAPTURE_PRESETS, capturePresetOf, applyCapturePreset } from './capturePresets.js';

// The add menu. "Capture" is built per open (captureMenuItem): a new capture
// is taken on the webapp, so it lists the webapp tabs open at that moment.
const INSERT_ITEMS = [
  { id: 'text', label: 'Text' },
  { id: 'admonition', label: 'Admonition' },
  { id: 'capture' },
  { id: 'tabs', label: 'Content tabs' },
  { id: 'table', label: 'Data table' },
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

// The button colour swatches (config/labelColours.json), once loaded.
let palette = null;

// Everything typed into where it stands.
const EDITABLE = '.mb-kb-text, h1[data-mb-node], h2[data-mb-node], h3[data-mb-node], [data-mb-edit]';

/**
 * @type {null | {
 *   page: object, hasLive: boolean, md: string, loaded: string, title: string,
 *   article: HTMLElement, orig: HTMLElement, built: Map<string, Element|null>,
 *   bar: HTMLElement, status: HTMLElement, menu: object,
 *   ops: object[], snaps: (string|null)[], redo: object[], frozen: number,
 *   sel: string|null, picked: Set<string>, cellAt: null|{uuid: string, row: number, col: number},
 *   active: null | object, panel: null | {el: HTMLElement},
 *   mediaPaths: Promise<string[]>|null, destKinds: Map<string, string>,
 *   captureWait: null | {token: string, strikes: number, split: boolean, inserting?: boolean, target: {kind: string, uuid: string, at: number}},
 *   customCaptures: Set<string>,
 *   markdownView: boolean, saving: boolean, busyIcon: string|null, leaving: boolean,
 *   liveView: boolean, liveMd: string, nav: HTMLElement, sliding: boolean,
 *   comments?: {reanchor(): void, destroy(): void}|null,
 * }}
 */
let state = null;

// ── Create draft (the button kbSite.js puts on a draft URL with no draft) ────

/**
 * @param {(text: string) => void} [say] the Create draft button's own label:
 *   each step is told there (yellow, spinning: kbSite injectCreateDraftButton).
 */
export async function kbCreateDraft(say) {
  const page = currentKbPage();
  if (!page) return;
  const status = null;
  const tell = typeof say === 'function' ? say : s => setStatus(status, s, s ? { busy: true } : {});
  // What the editor says while it takes the new draft up ("Loading draft…")
  // goes to the button too: the page has no foot to say it on yet.
  if (typeof say === 'function') creatingSay = say;
  tell('Creating draft…');
  try {
    tell('Reading the live page…');
    const liveMd = await readRepoText(page.livePath);
    const title = renderGuidePage(liveMd).title || page.slug;
    const result = await writeGuideDraft(page.livePath, tell, { title });
    if (result === 'missing-live') {
      tell('');
      alert('There is no live page to create a draft from.');
      return;
    }
    tell('Opening the draft…');
    await refreshKbSite(); // the draft exists now → the editor takes over the page
    tell('');
  } catch (err) {
    tell('');
    alert('Failed to create the draft: ' + err.message);
  } finally {
    creatingSay = null;
  }
}

// ── Entering edit mode ───────────────────────────────────────────────────────

// The draft as the editor opens it, or null (said in an alert: there is no
// foot yet to say it on) when it cannot be read. Same read the form editor opens with: backfills any missing
// identity spans (and commits them) so every block on the page is addressable.
async function loadDraft(page, status) {
  setStatus(status, 'Loading draft…', { busy: true });
  try {
    const md = await fetchFileMigratingIdentity(page.draftPath, () => {});
    setStatus(status, '');
    return md || null;
  } catch (err) {
    setStatus(status, '');
    alert('Could not load the draft: ' + err.message);
    return null;
  }
}

/**
 * @param {object} page
 * @param {{hasLive?: boolean, noDraft?: boolean}} [opts] `noDraft`: the page
 *   has no draft yet. Edit mode then holds only Create draft and the way to
 *   the live content; entered again once the draft exists, it takes it up.
 */
export async function kbEnterEditMode(page, { hasLive = true, noDraft = false } = {}) {
  if (state) {
    if (state.noDraft && !noDraft) await takeUpDraft();
    return;
  }
  const article = document.querySelector('article.md-content__inner');
  if (!article) return;
  ensureStylesheet();
  const status = null;
  const md = noDraft ? '' : await loadDraft(page, status);
  if (md == null) return;
  // The editor draws the whole article: the site's stale copy of a deleted
  // draft needs no hiding once it has.
  document.documentElement.classList.remove('mb-kb-no-draft');

  // Keep what the site built: the diagrams and nav links it rendered are
  // reused (they can't be drawn here).
  const orig = document.createElement('div');
  orig.append(...article.childNodes);

  state = {
    page, hasLive, md, loaded: md, title: '', article, orig, built: new Map(),
    updates: isUpdatesPage(page), side: null, liveSide: null, pendingSide: null, ghostHover: null, openUpdates: new Set(), folds: new Map(), publishing: [], publishTimer: 0,
    bar: null, status, menu: null,
    ops: [], snaps: [md], redo: [], frozen: 0,
    sel: null, picked: new Set(), cellAt: null, active: null, panel: null, mediaPaths: null, destKinds: new Map(), captureWait: null, customCaptures: new Set(),
    markdownView: false, saving: false, savedFlash: false, saveShownAt: 0, busyIcon: null, leaving: false,
    liveView: false, liveMd: '', nav: null, sliding: false, noDraft,
    // Page visibility (zensical.toml, not the draft): read when Page settings first opens, written by Save.
    visibility: null,
  };
  document.documentElement.classList.add('mb-kb-editing');
  buildFoot();
  buildBlockMenu();
  buildModeNav();
  injectModePill();
  syncViewChrome();
  if (state.updates) { buildSide(); await loadPublishing(); }
  render();
  loadPageChrome();
  wire();
  liftPageTitle();
  // "On this page", drawn from the headings showing (hidden when the page's
  // settings hide it, as they stand in the draft being edited). The System
  // Updates page never shows it in Edit mode, draft or live: its headings are
  // the updates themselves. Its sidebar keeps its room all the same (blank,
  // not hidden), or the article would spread into it and no longer stand
  // where the live page's does.
  state.toc = attachToc(article, {
    hidden: () => !!state && !state.updates && readFrontmatterHide(shownMd()).includes('toc'),
    blank: () => !!state && state.updates,
  });
  // Comments on the guide (kbCommentsUi.js), in the left-hand margin; they load
  // in the background. None on the System Updates page, none in the Markdown
  // view, and none on the page with no draft until its live content is shown
  // (it holds no words of the guide). A selection made while a block is
  // dragged or a menu is open is not offered for commenting.
  if (!state.updates) {
    state.comments = startKbComments({
      article, mode: 'edit', page, canResolve: () => true,
      shown: () => !!state && (state.liveView || (!state.markdownView && !state.noDraft)),
      quiet: () => !state || state.sliding || !!state.menu?.open || !!state.menu?.dragging,
    });
  }
  loadLabelPalette().then(loaded => {
    palette = loaded;
    if (state) syncBlockMenu();
  });
}

/** The draft has just been published: its editor becomes the page with none, in place. */
function dropDraft() {
  deactivate();
  clearPicked();
  Object.assign(state, { md: '', loaded: '', ops: [], snaps: [''], redo: [], frozen: 0, noDraft: true, hasLive: true, liveView: false, markdownView: false, savedFlash: false });
  // Not `mb-kb-no-draft`: that class hides the site's stale article until the
  // editor has drawn its own (kbEnterEditMode takes it off), and would hide
  // the Draft / Live tabs here.
  document.documentElement.classList.remove('mb-kb-live-view');
  syncViewChrome();
  render();
  refreshSaveState();
  window.scrollTo(0, 0);
}

/** The draft has just been created: the page with none becomes its editor, in place. */
async function takeUpDraft() {
  const md = await loadDraft(state.page, state.status);
  if (md == null) return;
  Object.assign(state, { md, loaded: md, ops: [], snaps: [md], redo: [], frozen: 0, noDraft: false, liveView: false });
  document.documentElement.classList.remove('mb-kb-no-draft', 'mb-kb-live-view');
  syncViewChrome();
  render();
  refreshSaveState();
  liftPageTitle();
}

// A `# Title` line typed into the content of a page whose own title is hidden
// becomes the placed page title as the draft opens: an edit like any other
// (there to save, and to undo).
function liftPageTitle() {
  if (state.noDraft || state.updates) return;
  pushOp(OPS.liftPageTitle());
}

// What stands around the page for the view it is in: the row above the title,
// the foot (only the selection's piece on the live content; not there at all
// on a page with no draft yet).
function syncViewChrome() {
  const { bar, liveView, noDraft } = state;
  bar.classList.toggle('--live', liveView);
  bar.classList.toggle('--idle', noDraft && !liveView);
  paintModeNav();
  paintStatus();
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
  state.redo = []; // a new edit: what was undone before it is gone
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
  state.redo = [];
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
  state.redo.push(state.ops.pop());
  state.snaps.pop();
  refreshSaveState();
  render();
}

/** Put back the edit Undo last took away. Anything edited since then has emptied the list. */
function redo() {
  if (state.saving) return;
  deactivate(); // typing that changed something has just emptied the list
  settle();
  const op = state.redo.pop();
  if (!op) return;
  try {
    const before = workingMd();
    const next = op.apply(before);
    if (next !== before) {
      state.ops.push(op);
      state.snaps.push(next);
    }
  } catch (err) {
    console.warn('MB Warn: dropped an edit that no longer applies', err);
  }
  refreshSaveState();
  render();
}

// Is there anything to save? Not "has anything been done": edits that bring
// the page back to the draft as it was read or last saved (a block moved and
// moved back, a word typed and deleted) leave nothing to save, though each is
// still there to undo. An empty text block is no change either: it never
// reaches the saved file (dropEmptyText).
function isDirty() {
  return isDraftDirty() || visibilityDirty();
}

/** A Page visibility picked in Page settings and not yet saved. */
const visibilityDirty = () => !!state.visibility?.want && state.visibility.want !== state.visibility.saved;

function isDraftDirty() {
  if (!state.ops.length) return false;
  const md = workingMd();
  const base = state.snaps[0];
  if (md === base) return false;
  if (!md.includes(EMPTY_TEXT) && !base.includes(EMPTY_TEXT)) return true;
  return dropEmptyText(md) !== dropEmptyText(base);
}

/** The markdown the page is showing: the live page's in the live view, else the draft with its pending edits. */
const shownMd = () => (state.liveView ? state.liveMd : workingMd());

// ── The foot of the page ─────────────────────────────────────────────────────
// One row that closes the article and stays in view: it sticks to the bottom
// of the window for as long as the end of the page is below it. Three pieces,
// joined: the selection's (how many, Copy, Unselect all) slides in on the left
// while anything is selected; the Add card in the middle; Save slides in on
// the right while there is something to save, in the draft's yellow, spins
// while it saves, and turns green ("Changes saved to draft") before it slides
// away again. While something is dragged the whole row is the Delete card
// (onPickDown). The live content has only the selection's piece; Markdown view
// has no Add card. It is one element for the editor's whole life, put back at
// the end of the article after each redraw (placeFoot).

const SAVE_LOOKS = {
  dirty: ['save', 'Save changes to draft'],
  saving: ['loader-circle', 'Saving changes…'],
  saved: ['check', 'Changes saved to draft'],
};
// What the Add card says while a key is held (it does nothing then: the
// click is the page's). The card's hints wear its own grey.
const HINT_PICK = 'Click a component to select it, or drag it to move it';
const HINT_MENU = 'Click a component to configure it';
// The card's face for a message (setStatus): its icon, by tone.
const NOTE_ICONS = { busy: 'loader-circle', ok: 'check', error: 'circle-alert', info: 'info', pick: 'mouse-pointer-click', menu: 'sliders-horizontal' };
const SAVED_FOR = 1800; // ms the green "saved" stays before Save slides away
const FOOT_GAP = 16;    // px the stuck foot stands off the bottom of the window (formsStyling.css uses the same)

function buildFoot() {
  const foot = document.createElement('div');
  foot.className = 'mb-kb-foot';
  const pick = (act, icon, label, title) =>
    `<button type="button" class="mb-kb-foot__pick" data-kb-act="${act}" title="${title}"><span class="mb-kb-foot__icon" data-icon="${icon}" aria-hidden="true"></span><span>${label}</span></button>`;
  // The plus is an icon, not a typed "+": a glyph sits
  // on the text's baseline, off the middle of the word beside it.
  foot.innerHTML = `
    <div class="mb-kb-foot__picks" role="toolbar" aria-label="Selection"><div class="mb-kb-foot__in">
      <span class="mb-kb-picks__count" role="status"></span>
      ${pick('copy', 'copy', 'Copy', 'Copy the selected markdown')}
      ${pick('unpick', 'x', 'Unselect all', 'Unselect all')}
    </div></div>
    <button type="button" class="mb-kb-addnew" data-face="add"${state.updates ? ' aria-haspopup="menu"' : ''}>
      <span class="mb-kb-addnew__face" data-face="add"><span class="mb-kb-addnew__plus" data-icon="plus" aria-hidden="true"></span><span>${state.updates ? 'New system update' : 'Add'}</span></span>
      <span class="mb-kb-addnew__face" data-face="delete" aria-hidden="true"><span class="mb-kb-addnew__plus" data-icon="trash-2" aria-hidden="true"></span><span>Delete</span></span>
      <span class="mb-kb-addnew__face" data-face="note" aria-hidden="true"><span class="mb-kb-addnew__plus mb-kb-addnew__noteicon" aria-hidden="true"></span><span class="mb-kb-addnew__note" role="status"></span></span>
    </button>
    <button type="button" class="mb-kb-save" data-kb-act="save" tabindex="-1" aria-hidden="true"><span class="mb-kb-foot__in"><span class="mb-kb-foot__icon" aria-hidden="true"></span><span class="mb-kb-save__text"></span></span></button>`;
  foot.querySelectorAll('[data-icon]').forEach(slot => {
    getLucideSvgMarkup(slot.dataset.icon).then(svg => { if (svg) slot.innerHTML = svg; }).catch(() => {});
  });
  watchIconSpans(document); // paints the icon names the editor writes elsewhere (idempotent per document)

  // A press on Save or on the selection's buttons must not take the caret out
  // of the text being edited. (The Add card's click is the article's.)
  foot.addEventListener('mousedown', e => { if (e.target instanceof Element && e.target.closest('[data-kb-act]')) e.preventDefault(); });
  foot.addEventListener('click', e => {
    const btn = e.target instanceof Element && e.target.closest('[data-kb-act]');
    if (btn) BAR_ACTIONS[btn.dataset.kbAct]?.();
  });
  let queued = 0;
  const onScroll = () => { if (!queued) queued = requestAnimationFrame(() => { queued = 0; syncFootStuck(); syncHeaderTitle(); }); };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  // The page grows under it too (a picture loads, a tab is shown).
  if (typeof ResizeObserver === 'function') new ResizeObserver(onScroll).observe(state.article);

  state.bar = foot;
  refreshSaveState();
}

const BAR_ACTIONS = {
  copy: () => copyPicked(),
  unpick: () => clearPicked(),
  save: () => save(),
};

const DASH = 2; // px of a dashed line (--mb-dash in formsStyling.css)

/**
 * A side piece of the foot opens to exactly the width of what it holds (and
 * shuts from it), so sliding in takes as long as sliding away: the width is
 * measured and handed to the stylesheet.
 */
function sizeFootPiece(piece) {
  const w = piece.querySelector('.mb-kb-foot__in')?.offsetWidth;
  if (w) piece.style.setProperty('--w', `${w + DASH * 2}px`); // its own line either side
}

/** The foot goes back at the end of the article (a redraw took it out with the rest). */
function placeFoot() {
  const { article, bar } = state;
  bar.classList.toggle('--bare', state.markdownView && !state.liveView);
  article.append(bar);
  paintStatus();
  bar.querySelectorAll('.mb-kb-save, .mb-kb-foot__picks').forEach(sizeFootPiece); // measurable now it is on the page
  // Save turned up with the change that caused this redraw: let it be seen sliding in.
  if (bar.classList.contains('--save') && performance.now() - (state.saveShownAt ?? -1e9) < 150) {
    bar.classList.remove('--save');
    void bar.offsetWidth;
    bar.classList.add('--save');
  }
  syncFootStuck();
  setTimeout(syncFootStuck, 300); // once what was just drawn has its height
}

/** Whether the foot is held at the bottom of the window (it then stands over the page, with a shadow). */
function syncFootStuck() {
  const foot = state?.bar;
  if (!foot?.isConnected) return;
  const r = foot.getBoundingClientRect();
  const more = document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
  foot.classList.toggle('--stuck', r.height > 0 && Math.abs(window.innerHeight - FOOT_GAP - r.bottom) < 1.5 && more > 4);
}

/**
 * The Add card as it stands. Its faces, first that applies: Delete while
 * something is dragged; the message there is (setStatus: yellow and spinning
 * while something runs, green once it is done, red when it failed); what a
 * click does while Shift or Cmd / Ctrl is held; else Add. With Shift held and
 * something selected the card makes way altogether (`--wide`): the
 * selection's piece takes its room. Faces cross-fade, colours fade, widths slide.
 */
function paintFoot() {
  const foot = state?.bar;
  const card = foot?.querySelector('.mb-kb-addnew');
  if (!card) return;
  const plain = !foot.classList.contains('--live') && !foot.classList.contains('--bare'); // the card is there to be seen
  const deleting = card.classList.contains('--delete');
  const mode = state.menu?.mode ?? null;
  const msg = !deleting ? note : null;
  const wide = plain && !msg && !deleting && mode === 'pick' && state.picked.size > 0;
  const hint = plain && !msg && !deleting && !wide && (mode === 'pick' || mode === 'menu') ? mode : null;
  const face = deleting ? 'delete' : msg || hint ? 'note' : 'add';
  foot.classList.toggle('--wide', wide);
  // On the live content and in Markdown view the card is there only to say something.
  foot.classList.toggle('--noting', !!msg);
  card.classList.toggle('--note', face === 'note');
  if (face === 'note') {
    const tone = msg ? msg.tone : hint;
    const text = msg ? msg.text : hint === 'pick' ? HINT_PICK : HINT_MENU;
    const slot = card.querySelector('.mb-kb-addnew__note');
    const changed = slot.textContent !== text;
    if (changed || card.dataset.tone !== tone) {
      const faceEl = slot.parentElement;
      // A new message while one shows: the words come up afresh.
      if (changed && card.dataset.face === 'note') { faceEl.classList.remove('--swap'); void faceEl.offsetWidth; faceEl.classList.add('--swap'); }
      slot.textContent = text;
      const icon = NOTE_ICONS[tone] ?? 'info';
      const iconEl = card.querySelector('.mb-kb-addnew__noteicon');
      if (iconEl.dataset.icon !== icon) {
        iconEl.dataset.icon = icon;
        getLucideSvgMarkup(icon).then(svg => { if (svg && iconEl.dataset.icon === icon) iconEl.innerHTML = svg; }).catch(() => {});
      }
    }
    card.dataset.tone = tone; // kept as the note fades away, so its colours fade with it
  }
  card.dataset.face = face;
  card.querySelectorAll(':scope > .mb-kb-addnew__face').forEach(f => f.setAttribute('aria-hidden', String(f.dataset.face !== face)));
  card.tabIndex = wide ? -1 : 0;
  if (face === 'note') card.setAttribute('aria-disabled', 'true'); else card.removeAttribute('aria-disabled');
}

/** Where the part of the window the page shows in ends: at the foot while it is held there. */
function viewBottom() {
  const r = state.bar.getBoundingClientRect();
  return r.height > 0 && r.top > 0 && r.top < window.innerHeight ? r.top : window.innerHeight;
}

/** Save as it stands: away, there to be pressed, saving, or just saved. */
function paintSave() {
  const foot = state?.bar;
  if (!foot) return;
  const look = state.liveView || state.noDraft ? 'off' : state.saving ? 'saving' : state.savedFlash ? 'saved' : isDirty() ? 'dirty' : 'off';
  const btn = foot.querySelector('.mb-kb-save');
  const on = look !== 'off';
  // Sliding away it keeps what it last said.
  if (on && btn.dataset.look !== look) {
    btn.dataset.look = look;
    const [icon, text] = SAVE_LOOKS[look];
    btn.querySelector('.mb-kb-save__text').textContent = text;
    const slot = btn.querySelector('.mb-kb-foot__icon');
    getLucideSvgMarkup(icon).then(svg => { if (svg && btn.dataset.look === look) slot.innerHTML = svg; }).catch(() => {});
  }
  sizeFootPiece(btn);
  if (on && !foot.classList.contains('--save')) state.saveShownAt = performance.now();
  foot.classList.toggle('--save', on);
  btn.tabIndex = on ? 0 : -1;
  btn.setAttribute('aria-hidden', String(!on));
}

// ── The buttons beside the title ─────────────────────────────────────────────
// The theme's icon buttons, where a live page has "Switch to draft" and
// "Edit log". The redraw takes them with the rest of the article, so they are
// put back after each one. Left to right: Page settings, Undo, Redo, Markdown
// view, Edit log, Delete draft, Publish. The live view has Delete guide and
// Edit log: the others are the draft's. (Exit edit mode is in the header: injectModePill.)

function injectPageButtons() {
  // They float right, so the first one in the article is furthest right: added
  // in the order they read, each new one lands to the right of the last.
  if (state.liveView) {
    // Delete guide, left of Edit log: only here, where the live page is looked
    // at. (System Updates is not a guide: its updates are deleted one by one.)
    if (!state.updates) injectPageButton(document, { cls: 'mb-kb-delete', icon: 'trash-2', title: 'Delete guide', onClick: () => deleteGuide() });
    injectLogButton(document, state.page);
    paintBusyIcon();
    return;
  }
  // Where Exit edit mode was (it is in the header now): the page's own settings.
  if (!state.updates) {
    const cog = injectPageButton(document, { cls: 'mb-kb-pagesettings', icon: 'settings', title: 'Page settings', popup: true, onClick: () => togglePageSettings() });
    cog?.setAttribute('aria-pressed', String(!!state.menu?.page));
  }
  injectPageButton(document, { cls: 'mb-kb-undo', icon: 'undo-2', title: 'Undo', onClick: () => undo() });
  injectPageButton(document, { cls: 'mb-kb-redo', icon: 'redo-2', title: 'Redo', onClick: () => redo() });
  paintHistory();
  const on = state.markdownView;
  const source = injectPageButton(document, {
    cls: 'mb-kb-mdview', icon: 'file-code',
    title: on ? 'Close markdown view' : 'Markdown view',
    onClick: () => setMarkdownView(!state.markdownView),
  });
  source?.setAttribute('aria-pressed', String(on));
  injectLogButton(document, state.page);
  // The updates page is published and deleted one update at a time, from the
  // buttons beside each update.
  if (!state.updates) {
    injectPageButton(document, { cls: 'mb-kb-delete', icon: 'trash-2', title: 'Delete draft', onClick: () => deleteDraft() });
    injectPageButton(document, { cls: 'mb-kb-publish', icon: 'badge-check', title: 'Publish draft to live', onClick: () => publish() });
  }
  paintBusyIcon();
}


// Publish and Delete draft run for a while: the icon waits its run out (the
// progress itself shows on the foot's Add card), also across a redraw.
function paintBusyIcon() {
  for (const cls of ['mb-kb-publish', 'mb-kb-delete']) {
    const btn = state.article.querySelector('.' + cls);
    if (cls === state.busyIcon) btn?.setAttribute('aria-disabled', 'true'); else btn?.removeAttribute('aria-disabled');
  }
}

function setBusyIcon(cls, text = '') {
  state.busyIcon = cls;
  paintBusyIcon();
  setStatus(state.status, text, { busy: !!cls });
}

function setMarkdownView(on) {
  deactivate();
  clearPicked(); // nothing of the page stands in the source view to show as selected
  state.markdownView = on;
  select(null);
  render();
  window.scrollTo(0, 0); // the two views share no layout to keep a place in
}

// Markdown view: the whole file as Save would write it, in the theme's own
// code block. Read only: nothing in it carries an editing hook.
function renderSource(md) {
  const { article } = state;
  state.title = renderGuidePage(md, { assetUrl, updates: state.updates }).title;
  article.innerHTML = `<h1>${esc(state.title || state.page.slug)}</h1>
<p class="mb-kb-rawmd__note">The draft's markdown, as it would be saved now. Read only.</p>
<div class="highlight mb-kb-rawmd"><pre><code>${esc(dropEmptyText(md))}</code></pre></div>`;
  placeFoot();
  injectPageButtons();
  placeModeNav();
  paintTitlePill();
  drawCaptureWait();
  select(null);
}

/** Undo and Redo beside the title: dim with nothing to take back or put back. */
function paintHistory() {
  const set = (cls, can) => {
    const btn = state.article.querySelector('.' + cls);
    if (can) btn?.removeAttribute('aria-disabled'); else btn?.setAttribute('aria-disabled', 'true');
  };
  set('mb-kb-undo', state.ops.length > state.frozen);
  set('mb-kb-redo', state.redo.length > 0);
}

function refreshSaveState() {
  if (!state?.bar) return;
  paintHistory();
  paintSave();
}

// ── Saving ───────────────────────────────────────────────────────────────────

/** Commit every pending edit to the draft, in one commit. Resolves true when nothing is left unsaved by it. */
async function save() {
  if (state.saving) return false;
  settle();
  if (!isDirty()) return true;
  if (!checkUpdates()) return false; // an update with no title is not saved (its date can wait for the publish)
  if (isDraftDirty() && !(await saveDraft())) return false;
  return saveVisibility();
}

// Save says so in green for a moment, then slides away (or is Save again,
// with something typed since).
function flashSaved() {
  state.savedFlash = true;
  setTimeout(() => { if (state) { state.savedFlash = false; refreshSaveState(); } }, SAVED_FOR);
}

// Page visibility, as picked in Page settings: it moves the page between
// zensical.toml's nav and unlisted_nav (and keeps the live page's search
// exclusion with it), so it is written after the draft, in commits of its own.
async function saveVisibility() {
  if (!visibilityDirty()) return true;
  const want = state.visibility.want;
  state.saving = true;
  refreshSaveState();
  let ok = false;
  try {
    await setGuideVisibility(state.page.livePath, want, () => {});
    state.visibility.saved = want;
    ok = true;
  } catch (err) {
    alert('Failed to save the page visibility: ' + err.message);
  }
  state.saving = false;
  if (ok) flashSaved();
  refreshSaveState();
  if (state.menu?.page) syncBlockMenu();
  return ok;
}

/** Commit every pending edit of the draft, in one commit. */
async function saveDraft() {
  const batch = state.ops.slice();
  const shown = workingMd();
  state.saving = true;
  state.frozen = batch.length; // typing during the save starts a new op
  refreshSaveState(); // Save spins until it is done
  let saved = null;
  try {
    saved = await githubFetchAndPushFile(state.page.draftPath, () => {},
      md => dropEmptyText(applyOps(md, batch)),
      { commit: ({ before }) => (state.updates ? commitForUpdates(before, dropEmptyText(applyOps(before, batch))) : commitForOps(before, batch)) });
  } catch (err) {
    alert('Failed to save: ' + err.message);
  }
  state.saving = false;
  state.frozen = 0;
  if (saved == null) { refreshSaveState(); return false; }
  flashSaved();

  // Anything done while the save was in flight stays pending, over the new draft.
  const rest = state.ops.slice(batch.length);
  state.md = saved;
  state.ops = [];
  state.snaps = [saved];
  state.redo = []; // what was undone belonged to the draft before this save
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
  const progress = text => setStatus(state.status, text, { busy: true });
  setBusyIcon('mb-kb-publish', 'Publishing…');
  state.saving = true;
  try {
    const done = await publishGuideFiles(
      { livePath: page.livePath, draftPath: page.draftPath, title: state.title || page.slug }, progress);
    if (!done) {
      setBusyIcon(null);
      alert('Draft not found at ' + page.draftPath);
      return;
    }
    // The draft is gone, and the page stays where it is: Edit mode with no
    // draft (Create draft, and the Live tab for what has just gone live).
    setBusyIcon(null);
    dropDraft(); // (nothing is said there: the page itself shows the draft is gone)
  } catch (err) {
    setBusyIcon(null);
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
  if (!(await confirmDelete(warning, 'Delete draft'))) return;
  if (!state || state.saving) return; // the page moved on behind the question
  setBusyIcon('mb-kb-delete', 'Deleting draft…');
  state.saving = true;
  try {
    await discardGuideDraftFiles(
      { livePath: page.livePath, draftPath: page.draftPath, title: state.title || page.slug },
      s => setStatus(state.status, s, { busy: true }));
    // The draft is gone: this url has nothing left to edit.
    state.leaving = true;
    state.comments?.destroy();
    location.href = hasLive ? page.liveUrl : '/';
  } catch (err) {
    setBusyIcon(null);
    alert('Failed to delete the draft: ' + err.message);
  } finally {
    state.saving = false;
    refreshSaveState();
  }
}

// "Delete guide" on the Live tab: the live page, its draft and its place in the
// navigation all go. Its title has to be typed out first.
async function deleteGuide() {
  if (state.saving || state.sliding) return;
  const { page, noDraft } = state;
  const title = state.title || page.slug;
  if (!(await confirmByTyping({
    title: 'Delete this guide?',
    text: `The live page is removed for everyone${noDraft ? '' : ', its draft is deleted with it,'} and it is taken out of the navigation. This cannot be undone. To delete it, type its title:`,
    expect: title,
    action: 'Delete guide',
  }))) return;
  if (!state || state.saving) return; // the page moved on behind the question
  setBusyIcon('mb-kb-delete', 'Deleting guide…');
  state.saving = true;
  try {
    await deleteGuideFiles(
      { livePath: page.livePath, draftPath: page.draftPath, title },
      s => setStatus(state.status, s, { busy: true }));
    // The guide is gone: this url has nothing left to show.
    state.leaving = true;
    state.comments?.destroy();
    location.href = '/';
  } catch (err) {
    setBusyIcon(null);
    alert('Failed to delete the guide: ' + err.message);
  } finally {
    state.saving = false;
    refreshSaveState();
  }
}

// ── The System Updates drafts page ───────────────────────────────────────────
// A list of updates, each published or deleted on its own (see the header).

const isUpdateEl = el => !!el && 'mbUpdate' in el.dataset;

/**
 * Every update has its title (a save), or the update `only` has its title and
 * its date (a publish): true. Otherwise what is empty is shown in red, the
 * first is brought into view, and the foot's Add card says what is missing.
 */
function checkUpdates(only = null) {
  if (!state.updates) return true;
  const missing = missingUpdateFields(workingMd(), { forPublish: !!only }).filter(m => !only || m.uuid === only);
  state.article.classList.toggle('mb-kb-upd-check', missing.length > 0);
  // Only the update being published owes a date: the other drafts' empty dates stay grey.
  for (const el of state.article.querySelectorAll('.mb-kb-upd-date-due')) el.classList.remove('mb-kb-upd-date-due');
  for (const m of missing) if (m.date) nodeEl(m.uuid)?.classList.add('mb-kb-upd-date-due');
  if (!missing.length) return true;
  setStatus(state.status, missingMessage(missing), { tone: 'error', hideAfter: 6000 });
  nodeEl(missing[0].uuid)?.scrollIntoView({ block: 'nearest' });
  return false;
}

function buildSide() {
  const common = {
    nodeOf: uuid => { const el = state ? nodeEl(uuid) : null; return isUpdateEl(el) ? el : null; },
    view: () => {
      const header = document.querySelector('.md-header')?.getBoundingClientRect();
      return { top: Math.max(0, header && header.top <= 0 ? header.bottom : 0), bottom: viewBottom() };
    },
  };
  state.side = attachUpdateSide({ ...common, onDelete: uuid => deleteUpdate(uuid), onPublish: uuid => publishUpdate(uuid) });
  // The live content's own pair: Create draft and Delete (kbUpdateSide.js).
  state.liveSide = attachUpdateSide({ ...common, live: true, hasDraft: uuid => inDrafts(uuid), onDraft: uuid => draftOfLiveUpdate(uuid), onDelete: uuid => deleteLiveUpdate(uuid) });
  // And the one beside an update being published: Cancel publish.
  state.pendingSide = attachUpdateSide({
    ...common, pending: true,
    nodeOf: uuid => (state ? ghostEl(uuid)?.querySelector('.mb-kb-upd-ghost__body > details') ?? null : null),
    onCancel: uuid => cancelPublish(uuid),
  });
}

// The buttons are out for the update the pointer is on, or in: they stay
// while it is on a block inside the update, and while that block's menu is open.
function syncSide() {
  const side = state.side;
  if (!side) return;
  const menu = state.menu;
  const el = !menu.dragging && !state.markdownView && !state.sliding ? nodeEl(menu.open ? state.sel : menu.hover) : null;
  const uuid = el?.closest('[data-mb-update]')?.dataset.mbNode ?? null;
  side.show(state.liveView ? null : uuid);
  state.liveSide.show(state.liveView ? uuid : null);
  state.pendingSide.show(!state.liveView && !state.markdownView && !state.sliding && !menu.dragging ? state.ghostHover : null);
}

const inDrafts = uuid => updateComponents(workingMd()).some(c => c.adm.uuid === uuid);

// One short movement of one element, over as soon as it has run (never later
// than its length, even where no frames are drawn). Nothing of it is left on
// the element.
function play(el, frames, duration, easing = 'ease-out') {
  return new Promise(resolve => {
    let anim = null;
    let timer = 0;
    const done = () => { clearTimeout(timer); try { anim?.cancel(); } catch { /* already over */ } resolve(); };
    timer = setTimeout(done, duration + 80);
    try { anim = el.animate(frames, { duration, easing, fill: 'both' }); anim.finished.then(done, done); } catch { done(); }
  });
}

const calmMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// A flash around something the page has just brought the reader to: two rings
// going out from it, over a second, in its own colour (an update's is its
// type's, read off its border). The same strength on the light and dark
// schemes (a stronger dark one was tried and was too much).
function pulse(el, rgb = null) {
  if (!el?.isConnected) return Promise.resolve();
  const [r, g, b] = rgb ?? (getComputedStyle(el).borderTopColor.match(/[\d.]+/g) ?? [37, 99, 235]).map(Number);
  const peak = 0.5;
  const reach = 10;
  const ring = (px, a) => `0 0 0 ${px}px rgba(${r}, ${g}, ${b}, ${a})`;
  const frames = calmMotion()
    ? [{ boxShadow: ring(4, peak) }, { boxShadow: ring(4, 0) }]
    : [{ boxShadow: ring(0, peak) }, { boxShadow: ring(reach, 0), offset: 0.5 }, { boxShadow: ring(0, peak), offset: 0.5 }, { boxShadow: ring(reach, 0) }];
  return play(el, frames, 1000);
}

/** Bring a place on the page (window px from the top) a third of the way down the window, and wait for it to get there. */
function scrollToPlace(top) {
  const view = window.innerHeight;
  const max = Math.max(0, document.documentElement.scrollHeight - view);
  const to = Math.max(0, Math.min(max, window.scrollY + top - view / 3));
  if (Math.abs(to - window.scrollY) < 4) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(done, 900);
    function done() { clearTimeout(timer); window.removeEventListener('scrollend', done); resolve(); }
    window.addEventListener('scrollend', done, { once: true });
    window.scrollTo({ top: to, behavior: calmMotion() ? 'auto' : 'smooth' });
  });
}

// An update arriving in the drafts list, already in the markdown and so in the
// redraw: it is kept off the page (`hold`, before the list slides in), then the
// page scrolls to where it goes, the updates there part to make its room, and
// it pops in.
const holdArrival = el => { if (el) el.style.display = 'none'; };

async function showArrival(el) {
  if (!el?.isConnected) return;
  const before = el.previousElementSibling;
  await scrollToPlace(before ? before.getBoundingClientRect().bottom : el.parentElement.getBoundingClientRect().top);
  if (!el.isConnected) return;
  el.style.display = '';
  if (calmMotion()) return;
  const cs = getComputedStyle(el);
  const room = { height: `${el.getBoundingClientRect().height}px`, marginTop: cs.marginTop, marginBottom: cs.marginBottom };
  el.style.visibility = 'hidden';
  el.style.overflow = 'hidden';
  await play(el, [{ height: '0px', marginTop: '0px', marginBottom: '0px' }, room], 260, 'cubic-bezier(0.22, 1, 0.36, 1)');
  el.style.visibility = '';
  el.style.overflow = '';
  if (!el.isConnected) return;
  await play(el, [{ opacity: 0, transform: 'scale(0.94)' }, { opacity: 1, transform: 'scale(1)' }], 240, 'cubic-bezier(0.16, 1, 0.3, 1)');
}

// "Create draft" beside a live update: it is copied into the drafts under its
// own identity, at the place that keeps the drafts in the live page's order.
// The page goes across to the drafts, scrolls to that place, and the copy pops
// in between its neighbours and is flashed (not opened). Published from there,
// it replaces the live one. One that is in the drafts already reads "View
// draft": the page goes across, scrolls to it and flashes it.
async function draftOfLiveUpdate(uuid) {
  if (state.saving || state.sliding) return;
  const side = state.liveSide;
  const across = async arriving => {
    side.release();
    await slideToView(false, arriving ? () => holdArrival(nodeEl(uuid)) : null);
    if (!state) return;
    state.sliding = true; // nothing is started on the page until it has settled
    try {
      const el = nodeEl(uuid);
      if (arriving) await showArrival(el);
      else if (el) await scrollToPlace(el.getBoundingClientRect().top);
      if (state) await pulse(nodeEl(uuid));
    } finally {
      if (state) state.sliding = false;
    }
  };
  if (inDrafts(uuid)) { await across(false); return; }
  side.busy('draft', uuid);
  state.saving = true;
  let drafts = null;
  try {
    drafts = await draftLiveUpdate(uuid, s => setStatus(state.status, s, { busy: true }));
  } catch (err) {
    alert('Failed to clone the update to the drafts: ' + err.message);
  }
  state.saving = false;
  setStatus(state.status, '');
  if (drafts == null) { side.busy(null); refreshSaveState(); syncSide(); return; }
  adopt(drafts);
  await across(true);
}

/**
 * The last step before something leaves the live page: a dialog in which its
 * name has to be typed out (case and spacing aside) before the red button
 * works. Resolves true only when that button is pressed.
 * @param {{title: string, text: string, expect: string, action: string}} o `text` is followed by the name, in bold
 */
function confirmByTyping({ title, text, expect, action }) {
  const norm = v => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = 'mb-kb-typed';
    dlg.innerHTML = `
      <form method="dialog">
        <h2 class="mb-kb-typed__title">${esc(title)}</h2>
        <p class="mb-kb-typed__text">${esc(text)} <strong>${esc(expect)}</strong></p>
        <label class="mb-kb-typed__label" for="mb-kb-typed-input">Type the title to confirm</label>
        <input class="mb-kb-typed__input" id="mb-kb-typed-input" type="text" autocomplete="off" spellcheck="false">
        <div class="mb-kb-typed__foot">
          <button type="button" class="mb-kb-typed__btn" value="cancel">Cancel</button>
          <button type="submit" class="mb-kb-typed__btn --danger" value="ok" disabled>${esc(action)}</button>
        </div>
      </form>`;
    const input = dlg.querySelector('input');
    const ok = dlg.querySelector('.--danger');
    input.addEventListener('input', () => { ok.disabled = norm(input.value) !== norm(expect); });
    let over = false;
    const finish = yes => {
      if (over) return;
      over = true;
      try { dlg.close(); } catch { /* closed already */ }
      dlg.remove();
      resolve(yes);
    };
    dlg.querySelector('[value="cancel"]').addEventListener('click', () => finish(false));
    // Enter in the field submits: only with the name typed.
    dlg.querySelector('form').addEventListener('submit', e => { e.preventDefault(); if (!ok.disabled) finish(true); });
    dlg.addEventListener('close', () => finish(false)); // Escape
    document.body.append(dlg);
    dlg.showModal();
    input.focus();
  });
}

// "Delete" beside a live update: it is taken off the live page itself. The
// button has asked once more; then its title has to be typed out.
async function deleteLiveUpdate(uuid) {
  if (state.saving || state.sliding) return;
  const side = state.liveSide;
  const name = nodeEl(uuid)?.querySelector('.mb-kb-upd-title')?.textContent.trim() ?? '';
  if (name && !(await confirmByTyping({
    title: 'Delete this update from the live page?',
    text: 'It is removed from the live System Updates page for everyone, and cannot be brought back from here. To delete it, type its title:',
    expect: name,
    action: 'Delete from live',
  }))) return;
  if (!state || state.saving || state.sliding) return;
  side.busy('delete', uuid);
  state.saving = true;
  let live = null;
  try {
    live = await publishDeleteUpdate(uuid, s => setStatus(state.status, s, { busy: true }));
  } catch (err) {
    alert('Failed to delete the update: ' + err.message);
  }
  state.saving = false;
  setStatus(state.status, '');
  if (live == null) { side.busy(null); refreshSaveState(); syncSide(); return; }
  side.release();
  await slideOut(nodeEl(uuid), 'right');
  if (!state) return;
  state.liveMd = live;
  if (state.liveView) render();
  setStatus(state.status, 'Deleted from the live page. The site takes a few minutes to show it.', { tone: 'ok', hideAfter: 4000 });
}

/**
 * The draft changed on GitHub by something other than Save (an update was
 * published or deleted): edits still pending are kept over it, those whose
 * target is gone are dropped, and the page is drawn again.
 */
function adopt(md) {
  deactivate();
  settle();
  const pending = state.ops.slice();
  state.md = md;
  state.ops = [];
  state.snaps = [md];
  state.redo = [];
  for (const op of pending) {
    try {
      const before = workingMd();
      const next = op.apply(before);
      if (next === before) continue;
      state.ops.push(op);
      state.snaps.push(next);
    } catch (err) {
      console.warn('MB Warn: dropped an edit that no longer applies', err);
    }
  }
  refreshSaveState();
  render();
}

function addUpdate(type) {
  const update = newUpdate(type);
  const uuid = update.adm.uuid;
  state.openUpdates.add(uuid); // a new one opens, ready to be written
  pushOp(OPS.insertComponents(UPDATES_ROOT, null, [update]), () => {
    select(uuid);
    editPiece(`[data-mb-edit="adm-title"][data-mb-uuid="${CSS.escape(uuid)}"]`);
  });
}

// One update's own run on GitHub (Publish, or Delete of a saved one). Resolves
// with the drafts file as it is afterwards, or null when it failed (and said so).
async function runOnUpdate(uuid, act, failed, run) {
  const side = state.side;
  side.busy(act, uuid);
  state.saving = true;
  let drafts = null;
  try {
    drafts = await run(s => setStatus(state.status, s, { busy: true }));
  } catch (err) {
    alert(`${failed}: ${err.message}`);
  }
  state.saving = false;
  setStatus(state.status, '');
  if (drafts == null) { side.busy(null); refreshSaveState(); syncSide(); return null; }
  side.release();
  return drafts;
}

async function publishUpdate(uuid) {
  if (state.saving) return;
  deactivate();
  settle();
  if (!checkUpdates(uuid)) return;
  // What is on the page is what goes live: anything not yet saved is saved first.
  if (isDirty()) {
    state.side.busy('publish', uuid);
    const saved = await save();
    if (!saved) { state.side.busy(null); syncSide(); return; }
  }
  // The update as it goes live, and where it stood: kept to draw it while the site builds.
  const list = updateComponents(state.md);
  const index = list.findIndex(c => c.adm.uuid === uuid);
  let replaced = null;
  const drafts = await runOnUpdate(uuid, 'publish', 'Failed to publish the update', async (progress) => {
    const done = await publishDraftAsSaved(uuid, progress);
    replaced = done.replaced;
    return done.drafts;
  });
  if (drafts == null) return;
  if (index >= 0) {
    // Its place counts the waiting ones above it too. `replaced`: the live
    // update it took the place of, which Cancel publish puts back.
    const above = state.publishing.filter(p => p.index <= index).length;
    state.publishing.push({ uuid, adm: list[index].adm, index: index + above, at: Date.now(), replaced });
    storePublishing();
  }
  adopt(drafts);
  watchPublishing();
  setStatus(state.status, 'Published. The live page shows it once the site has rebuilt.', { tone: 'ok', hideAfter: 5000 });
}

// ── Published, waiting for the site ──────────────────────────────────────────
// `state.publishing` holds a copy of each update published from here and not
// yet seen on the live page ({ uuid, adm, index, at }). It is kept in the
// extension's storage, so a reload of the page mid-wait still shows them. The
// live page is read from the site itself (one request covers them all).

const PUBLISHING_KEY = 'moreButtonsKbPublishing';

async function loadPublishing() {
  try {
    const stored = (await chrome.storage.local.get(PUBLISHING_KEY))[PUBLISHING_KEY];
    state.publishing = pendingPublishes(stored, state.md);
    if (state.publishing.length !== (stored?.length ?? 0)) storePublishing();
  } catch (err) {
    console.warn('MB Warn: could not read the updates being published', err);
  }
  if (state.publishing.length) watchPublishing(true);
}

function storePublishing() {
  Promise.resolve(chrome.storage.local.set({ [PUBLISHING_KEY]: state.publishing }))
    .catch(err => console.warn('MB Warn: could not keep the updates being published', err));
}

const ghostEl = uuid => state.article.querySelector(`[data-mb-ghost="${CSS.escape(uuid)}"]`);

// Each is read only under its title line (which still opens and closes it).
// One that has waited too long says so, and can be let go by hand.
function paintPublishing() {
  if (state.markdownView) return;
  for (const p of state.publishing) {
    const el = ghostEl(p.uuid);
    el?.querySelectorAll('.mb-kb-upd-ghost__body > details > :not(summary)').forEach(part => { part.inert = true; });
    if (!el || Date.now() - p.at < PUBLISH_WATCH.late || el.classList.contains('--late')) continue;
    el.classList.add('--late');
    el.querySelector('.mb-kb-upd-ghost__text').textContent = 'Published, but still not on the live page. The site build may have failed.';
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'mb-kb-upd-ghost__dismiss';
    dismiss.dataset.mbGhostDismiss = p.uuid;
    dismiss.textContent = 'Dismiss';
    el.querySelector('.mb-kb-upd-ghost__note').append(dismiss);
  }
}

function dropPublishing(uuid) {
  state.publishing = state.publishing.filter(p => p.uuid !== uuid);
  if (state.ghostHover === uuid) state.ghostHover = null;
  state.openUpdates.delete(uuid);
  storePublishing();
}

/** Look at the live page now: the updates it shows leave the list, sliding off as a published one does. */
async function checkPublishing() {
  if (!state?.publishing.length) return;
  let html = '';
  try {
    // The query keeps a cache from answering with the page as it was.
    const res = await fetch(`${state.page.liveUrl}?mb=${Date.now()}`, { cache: 'no-store', credentials: 'omit' });
    html = res.ok ? await res.text() : '';
  } catch { /* offline, or the site mid-deploy: the next look will tell */ }
  if (!state) return;
  // One being cancelled is leaving the live page: it is not waited for.
  const live = state.saving ? [] : state.publishing.filter(p => liveShowsUpdate(html, p.uuid));
  if (live.length) {
    state.pendingSide.release();
    await Promise.all(live.map(p => slideOut(ghostEl(p.uuid), 'right')));
    if (!state) return;
    live.forEach(p => dropPublishing(p.uuid));
    render();
    setStatus(state.status, live.length > 1 ? `${live.length} updates are now on the live page` : 'Now on the live page', { tone: 'ok', hideAfter: 4000 });
  }
  paintPublishing();
}

// Looks are spaced out, and only made while the tab is in view (it looks
// again as soon as it comes back into view).
function watchPublishing(soon = false) {
  clearTimeout(state.publishTimer);
  if (!state.publishing.length) return;
  const newest = Math.max(...state.publishing.map(p => p.at));
  const wait = soon ? 0 : Math.max(PUBLISH_WATCH.every, newest + PUBLISH_WATCH.first - Date.now());
  state.publishTimer = setTimeout(async () => {
    if (!state) return;
    if (document.visibilityState !== 'hidden') await checkPublishing();
    if (state) watchPublishing();
  }, wait);
}

// "Cancel publish" beside an update being published: it comes off the live
// page (or the one it replaced there stands again) and goes back into the
// drafts, where it stood, to be edited as before.
async function cancelPublish(uuid) {
  const p = state.publishing.find(o => o.uuid === uuid);
  if (!p || state.saving) return;
  deactivate();
  settle();
  const side = state.pendingSide;
  side.busy('cancel', uuid);
  state.saving = true;
  // Its place among the drafts: its place on the page, less the waiting ones above it.
  const place = p.index - state.publishing.filter(o => o !== p && o.index < p.index).length;
  let drafts = null;
  try {
    drafts = await cancelPublishedUpdate(uuid, { place, replaced: p.replaced ?? null }, s => setStatus(state.status, s, { busy: true }));
  } catch (err) {
    alert('Failed to cancel the publish: ' + err.message);
  }
  state.saving = false;
  setStatus(state.status, '');
  if (drafts == null) { side.busy(null); refreshSaveState(); syncSide(); return; }
  side.release();
  const open = state.openUpdates.has(uuid);
  dropPublishing(uuid);
  if (open) state.openUpdates.add(uuid); // open while it waited, open as a draft again
  adopt(drafts);
  watchPublishing();
  setStatus(state.status, 'Publish cancelled. The update is back in the drafts.', { tone: 'ok', hideAfter: 5000 });
}

async function deleteUpdate(uuid) {
  if (state.saving) return;
  deactivate();
  settle();
  // One that was never saved is only on this page: taken away as any other
  // edit is (Undo brings it back).
  if (!updateComponents(state.md).some(c => c.adm.uuid === uuid)) {
    state.side.release();
    await slideOut(nodeEl(uuid), 'left');
    if (state) pushOp(OPS.deleteComponent(uuid));
    return;
  }
  const drafts = await runOnUpdate(uuid, 'delete', 'Failed to delete the update', progress => deleteDraftUpdate(uuid, progress));
  if (drafts == null) return;
  await slideOut(nodeEl(uuid), 'left');
  if (!state) return;
  adopt(drafts);
  setStatus(state.status, 'Update deleted', { tone: 'ok', hideAfter: 2200 });
}

// The date of release: picked from a calendar that opens under the date
// (kbDatePicker.js). Clear, there, empties it again.
function pickUpdateDate(uuid) {
  deactivate(); // text being typed is finished first (that may redraw the page)
  const span = state.article.querySelector(`[data-mb-date="${CSS.escape(uuid)}"]`);
  const adm = findComponent(workingMd(), uuid)?.component.adm;
  if (!span || !adm) return;
  openDatePicker(span, {
    label: 'Date of release',
    value: isoOfUpdateDate(splitUpdateTitle(adm.type, adm.title).date),
    onPick: date => edit(uuid, c => {
      c.adm.title = joinUpdateTitle(c.adm.type, splitUpdateTitle(c.adm.type, c.adm.title).title, formatUpdateDate(date));
    }),
  });
}

// ── Edit mode: the way out, and across to the live content ───────────────────
// The tabs above the title (see the header). One element kept through every
// redraw, so a tab keeps its hover and focus while the page under it
// changes.

// The sign that this is edit mode: a purple "Edit mode" pill in the site's
// header, right of its title. The header shows one of two titles (the site's
// name, then the page's once that has scrolled away), so each carries the pill.
function injectModePill() {
  document.querySelectorAll('.md-header__title .md-header__topic').forEach(topic => {
    if (topic.querySelector('.mb-kb-modepill')) return;
    const pill = document.createElement('span');
    pill.className = 'mb-kb-modepill';
    pill.textContent = 'Edit mode';
    topic.append(pill, exitButton());
  });
}

// Exit edit mode: the theme's own header icon button (as the light / dark
// toggle and the admin button are), right of the "Edit mode" pill.
function exitButton() {
  const btn = document.createElement('a');
  btn.href = '#';
  btn.setAttribute('role', 'button');
  btn.className = 'md-header__button md-icon mb-kb-exit';
  setThemeTip(document, btn, 'Exit edit mode');
  btn.addEventListener('click', e => { e.preventDefault(); exitEditMode(); });
  getLucideSvgMarkup('log-out').then(svg => { if (svg) btn.innerHTML = svg; }).catch(() => {});
  return btn;
}

// Which of the two the page shows, at the end of its title: a yellow "Draft"
// pill on the draft, a green "Live" one on the live content (the manage pages
// tree's state pills, a size up). Typing in the title takes it away; it is put
// back when the typing ends.
function paintTitlePill() {
  paintHeaderTopic();
  const h1 = state.article.querySelector(':scope > h1');
  if (!h1 || h1.querySelector('.mb-kb-statepill')) return;
  const pill = document.createElement('span');
  pill.className = `mb-kb-statepill ${state.liveView ? '--live' : '--draft'}`;
  pill.textContent = state.liveView ? 'Live' : 'Draft';
  h1.append(pill);
}

// The site's header swaps its name for the page's title once the title has
// scrolled up under it. Zensical decides that from the `.md-content h1` it
// found when the page loaded, and every redraw here replaces that heading, so
// it would go on watching a detached one: the editor drives the swap itself
// (Zensical's own rule: on once the whole H1 is under the header).
function syncHeaderTitle() {
  const title = document.querySelector('[data-md-component="header-title"]');
  if (!title || !state) return;
  const r = state.article.querySelector(':scope > h1')?.getBoundingClientRect();
  const headerBottom = document.querySelector('.md-header')?.getBoundingClientRect().bottom ?? 0;
  title.classList.toggle('md-header__title--active', !!r && r.height > 0 && r.bottom <= headerBottom);
}

// The header's second title is the page's: it follows the title as edited,
// and carries the Draft / Live pill the H1 ends with, left of "Edit mode".
function paintHeaderTopic() {
  const topic = document.querySelector('.md-header__topic[data-md-component="header-topic"]');
  const text = topic?.querySelector('.md-ellipsis');
  const h1 = state.article.querySelector(':scope > h1');
  if (text && h1) {
    const copy = h1.cloneNode(true);
    copy.querySelectorAll('.mb-kb-statepill').forEach(el => el.remove());
    const words = copy.textContent.trim() || state.page.slug;
    if (text.textContent.trim() !== words) text.textContent = words;
  }
  if (!topic) return;
  let pill = topic.querySelector('.mb-kb-statepill');
  if (!pill) {
    pill = document.createElement('span');
    topic.insertBefore(pill, topic.querySelector('.mb-kb-modepill'));
  }
  pill.className = `mb-kb-statepill --header ${state.liveView ? '--live' : '--draft'}`;
  pill.textContent = state.liveView ? 'Live' : 'Draft';
  syncHeaderTitle();
}

function exitEditMode() {
  settle();
  if (isDirty() && !confirm('Leave without saving your changes?')) return;
  state.leaving = true;
  state.comments?.destroy();
  location.href = state.hasLive ? state.page.liveUrl : '/';
}

// The two views of the page, as tabs. Draft stands left of Live, the way the
// page slides between them.
const MODE_TABS = [
  { view: 'draft', label: 'Draft', run: () => showDraft() },
  { view: 'live', label: 'Live', run: () => showLive() },
];

function buildModeNav() {
  const nav = document.createElement('nav');
  nav.className = 'mb-kb-modenav';
  nav.setAttribute('role', 'tablist');
  nav.setAttribute('aria-label', 'Draft or live content');
  nav.addEventListener('click', e => {
    const tab = e.target instanceof Element && e.target.closest('[data-mode-view]');
    if (!tab || tab.disabled || state.sliding) return;
    MODE_TABS.find(t => t.view === tab.dataset.modeView)?.run();
  });
  state.nav = nav;
}

/** The tabs for the view the page is in. Built once, then only repainted, so a
 *  tab keeps its hover and focus through the switch. */
function paintModeNav() {
  const { nav } = state;
  if (!nav.children.length) {
    nav.append(...MODE_TABS.map(({ view, label }) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = `mb-kb-modenav__tab --${view}`;
      tab.dataset.modeView = view;
      tab.setAttribute('role', 'tab');
      tab.textContent = label;
      return tab;
    }));
  }
  const shown = state.liveView ? 'live' : 'draft';
  for (const tab of nav.children) {
    const on = tab.dataset.modeView === shown;
    tab.classList.toggle('--on', on);
    tab.setAttribute('aria-selected', String(on));
    if (tab.dataset.modeView === 'live') {
      tab.disabled = !state.hasLive;
      if (state.hasLive) tab.removeAttribute('title'); else tab.title = 'This page has not been published yet';
    }
  }
}

/** Put the row back at the head of the article (a redraw empties it). */
function placeModeNav() {
  state.article.prepend(state.nav);
}

async function showLive() {
  if (state.sliding || state.liveView) return;
  deactivate(); // text being typed is finished first; its edit stays pending
  settle();
  state.sliding = true; // a second press while the live page is read does nothing
  let md = '';
  // On a page with no draft yet there is no foot, and nothing is said.
  const say = state.noDraft ? () => {} : (text, opts) => setStatus(state.status, text, opts);
  say('Loading live content…', { busy: true });
  try {
    md = await readRepoText(state.page.livePath);
  } catch (err) {
    state.sliding = false;
    say('Could not load the live content: ' + err.message, { tone: 'error', hideAfter: 4000 });
    return;
  }
  if (!md) {
    state.sliding = false;
    say('This page has no live content yet.', { tone: 'error', hideAfter: 4000 });
    return;
  }
  say('');
  state.liveMd = md;
  await slideToView(true);
}

function showDraft() {
  if (state.sliding || !state.liveView) return undefined;
  return slideToView(false);
}

// The live content stands to the right of the draft: going to it, the page
// leaves to the left and the live content comes in from the right; coming
// back is the same the other way. The row above the title stays where it is.
const SLIDE = { px: 64, out: 170, in: 420 };

function slideContent(from, to, duration, easing) {
  const els = [...state.article.children].filter(el => el !== state.nav);
  if (!els.length) return Promise.resolve();
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const frame = (x, opacity) => (calm ? { opacity } : { transform: `translateX(${x}px)`, opacity });
  return new Promise(resolve => {
    let anims = [];
    let timer = 0;
    const done = () => {
      clearTimeout(timer);
      // What has come in stands on its own again: a transform left on a block
      // would make it a layer of its own for good. (What has gone out stays
      // gone until the redraw replaces it.)
      if (to.o === 1) anims.forEach(a => { try { a.cancel(); } catch { /* already over */ } });
      resolve();
    };
    // Never later than its length, even where no frames are drawn.
    timer = setTimeout(done, duration + 80);
    try {
      anims = els.map(el => el.animate([frame(from.x, from.o), frame(to.x, to.o)], { duration, easing, fill: 'both' }));
      Promise.all(anims.map(a => a.finished)).then(done, done);
    } catch { done(); }
  });
}

/** `afterRender` runs once the new view is drawn, before it slides in. */
async function slideToView(live, afterRender = null) {
  const root = document.documentElement;
  const way = live ? -1 : 1;
  state.sliding = true;
  closeSettings();
  closePanel();
  state.menu.hover = null;
  clearPicked(); // what is selected belongs to the view it was selected in
  select(null); // (and puts away the buttons beside an update)
  root.classList.add('mb-kb-sliding');
  try {
    await slideContent({ x: 0, o: 1 }, { x: way * SLIDE.px, o: 0 }, SLIDE.out, 'cubic-bezier(0.5, 0, 0.75, 0)');
    state.liveView = live;
    if (live) state.markdownView = false;
    root.classList.toggle('mb-kb-live-view', live);
    syncViewChrome();
    render();
    afterRender?.();
    window.scrollTo(0, 0); // the two may not be the same length: both are read from the top
    await slideContent({ x: -way * SLIDE.px, o: 0 }, { x: 0, o: 1 }, SLIDE.in, 'cubic-bezier(0.16, 1, 0.3, 1)');
  } finally {
    root.classList.remove('mb-kb-sliding');
    state.sliding = false;
    state.comments?.reanchor();
  }
}

// ── Rendering ────────────────────────────────────────────────────────────────

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const assetUrl = src => {
  const a = assetPathOf(src);
  return a ? `/${a.path}${a.suffix}` : src;
};

const nodeEl = uuid => (uuid ? state.article.querySelector(`[data-mb-node="${CSS.escape(uuid)}"]`) : null);

// The images and videos of the page as drawn, each under the markup it was
// drawn from. A redraw writes the whole article again, and a new <video> or
// lazy <img> has no size until its file is read once more: everything after
// it jumps up and then back down, taking the place being worked on out of the
// window. So a redraw takes back the very elements it had, wherever their
// markup comes out the same: they keep their size (and a video its place in
// its loop), and the page keeps its length.
const drawnFrom = new WeakMap();

function drawnMedia(article) {
  const had = new Map();
  for (const el of article.querySelectorAll('img, video')) {
    const markup = drawnFrom.get(el);
    if (!markup) continue;
    if (!had.has(markup)) had.set(markup, []);
    had.get(markup).push(el);
  }
  return had;
}

function keepMedia(article, had) {
  for (const el of article.querySelectorAll('img, video')) {
    const markup = el.outerHTML;
    const old = had.get(markup)?.shift();
    if (old) { el.replaceWith(old); continue; }
    drawnFrom.set(el, markup);
    // A lazy image that is not shown is never read: the dark half of a
    // light/dark pair has no height the first time the site's theme is
    // switched, and the page folds up under the window until it has loaded.
    // Here every image is read up front, so both halves have their size.
    if (el.tagName === 'IMG') el.loading = 'eager';
  }
}

function render() {
  if (deactivate()) return; // ending the edit in progress already redrew the page
  closePanel();
  closeDatePicker(); // so is the date it stood under
  const { article, orig } = state;
  const scrollY = window.scrollY;
  const live = state.liveView;
  const md = shownMd();
  if (state.noDraft && !live) { renderNoDraft(); state.comments?.reanchor(); return; }
  if (state.markdownView && !live) { renderSource(md); state.comments?.reanchor(); return; }

  // Which tab each group shows must survive the redraw.
  const shownTabs = new Set();
  article.querySelectorAll('.tabbed-set[data-mb-node]').forEach(set => {
    const i = [...set.querySelectorAll(':scope > input')].findIndex(inp => inp.checked);
    const block = set.querySelector(':scope > .tabbed-content')?.children[i];
    if (i > 0 && block?.dataset.mbNode) shownTabs.add(block.dataset.mbNode);
  });

  const { html, title } = renderGuidePage(md, {
    assetUrl, insertSlots: !live, updates: state.updates && !live, updatesLive: state.updates && live,
    publishing: live ? [] : state.publishing.map(p => ({ adm: p.adm, index: p.index, open: state.openUpdates.has(p.uuid) })),
  });
  state.title = title;
  const media = drawnMedia(article);
  article.innerHTML = html;
  keepMedia(article, media);

  shownTabs.forEach(showTab);
  // Updates are drawn closed, as the live page shows them: the ones opened
  // here stay open through the redraw.
  for (const uuid of state.openUpdates) {
    const el = nodeEl(uuid);
    if (isUpdateEl(el)) el.open = true; else if (!state.publishing.some(p => p.uuid === uuid)) state.openUpdates.delete(uuid);
  }
  // A collapsible admonition folded or opened here stays that way through the
  // redraw, as long as its Collapsible setting is still the one it was drawn
  // with (a new setting shows as set).
  for (const [uuid, f] of state.folds) {
    const el = nodeEl(uuid);
    if (el instanceof HTMLDetailsElement && el.dataset.mbFold === f.prefix) el.open = f.open;
    else state.folds.delete(uuid);
  }
  paintPublishing();
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
  placePageChrome();
  // The foot of the page: the Add card (not on the live content), Save, the
  // selection's buttons.
  placeFoot();
  // The tab groups' own plus ("New tab" ending a label row).
  const pluses = [...article.querySelectorAll('.mb-kb-newtab__plus')];
  if (pluses.length) getLucideSvgMarkup('plus').then(svg => { if (svg) pluses.forEach(el => { el.innerHTML = svg; }); }).catch(() => {});
  // The icons beside the title (the redraw took the last ones), and the row
  // above it.
  injectPageButtons();
  placeModeNav();
  paintTitlePill();

  if (!live) drawCaptureWait();
  paintInlineAtoms(article);
  paintCodeBlocks(article);
  state.codeHover?.hide();
  window.scrollTo(0, scrollY);
  select(state.sel);
  paintPicked();
  state.comments?.reanchor();
}

// A page with no draft yet: what kbSite.js puts there (it is on the page before
// the editor has loaded), under the row above the title.
function renderNoDraft() {
  const { article } = state;
  state.title = state.page.slug;
  article.innerHTML = '<h1></h1>';
  injectCreateDraftButton(document, say => kbCreateDraft(say));
  placeModeNav();
  select(null);
  paintPicked();
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

/**
 * The innermost thing at height `y` inside `node` (a box holding things of its
 * own, to any depth), or `node` itself where it holds nothing at that height
 * (its title, the gaps between its things). With `x`, only things lying to the
 * right of that point count: the pointer is on the box's left edge.
 */
function innermostAt(node, y, x = -Infinity) {
  for (let inner = node; inner;) {
    node = inner;
    inner = [...node.querySelectorAll('[data-mb-node]')]
      .filter(n => n.dataset.mbNode && !inChrome(n) && nodeFor(n.parentElement) === node)
      .map(n => ({ n, r: n.getBoundingClientRect() }))
      .filter(({ r }) => r.height > 0 && r.top <= y && y <= r.bottom && r.left > x)
      .sort((a, b) => a.r.left - b.r.left)[0]?.n ?? null;
  }
  return node;
}

function select(uuid) {
  if (uuid !== state.sel && !state.menu.busy) closeSettings(); // the popup belongs to what was selected
  state.article.querySelectorAll('.mb-kb-sel').forEach(el => el.classList.remove('mb-kb-sel'));
  const el = nodeEl(uuid);
  state.sel = el ? uuid : null;
  el?.classList.add('mb-kb-sel');
  syncBlockMenu();
}

// ── Selecting blocks and sections ────────────────────────────────────────────
// Shift and a click selects what the pointer is on (the same press, moved,
// drags it): a block, or a section with everything in it. `picked` holds their
// identities; the page shows them inside a dashed line, and the foot grows a piece
// for them: how many, Copy, Unselect all. Nothing else acts on the selection.
//
// The line is not the thing's own (an outline would follow, and a rule for it
// would change, the thing's own corners; and a section has no box at all):
// each is a box drawn round where the thing is, in a layer over the article's
// content that takes no clicks.

const PICK_PAD = 6; // px the dashed line stands off what is selected (formsStyling.css uses the same)

const pickedEls = () => [...state.article.querySelectorAll('.mb-kb-picked')];
const isSectionEl = el => el.dataset.mbKind === 'section';
/** The run of the article a selected thing takes up: a block is itself, a section runs to its end. */
const pickSpan = el => (isSectionEl(el) ? sectionSpan(el) : [el, el]);
function spanHolds([first, last], el) {
  for (let n = first; n; n = n.nextElementSibling) {
    if (n.contains(el)) return true;
    if (n === last) break;
  }
  return false;
}

/** Show the selection as it is: on the page (after a redraw too) and in the bar. */
function paintPicked() {
  const { picked, bar } = state;
  pickedEls().forEach(el => el.classList.remove('mb-kb-picked', 'mb-kb-picked--section'));
  for (const uuid of [...picked]) {
    const el = nodeEl(uuid);
    if (!el) { picked.delete(uuid); continue; } // deleted, or undone away
    el.classList.add('mb-kb-picked');
    if (isSectionEl(el)) el.classList.add('mb-kb-picked--section');
  }
  const n = picked.size;
  bar.classList.toggle('--picks', n > 0);
  if (n) bar.querySelector('.mb-kb-picks__count').textContent = `${n} selected`; // sliding away it keeps its count
  bar.querySelectorAll('.mb-kb-foot__pick').forEach(btn => { btn.tabIndex = n ? 0 : -1; });
  // The placed page title is not copied (a page has one): with nothing else selected, Copy is off.
  const copy = bar.querySelector('[data-kb-act="copy"]');
  const onlyTitle = n > 0 && pickedEls().every(el => el.dataset.mbComp === 'title');
  copy.disabled = onlyTitle;
  copy.title = onlyTitle ? 'The page title cannot be copied: a page has one title' : 'Copy the selected markdown';
  sizeFootPiece(bar.querySelector('.mb-kb-foot__picks'));
  paintFoot();
  syncFootStuck();
  placePicked();
  if (state.menu?.spec) placeBlockMenu(); // what is now selected loses the faint line a held key gave it
}

/** The dashed lines of what is selected, laid where those things are now. */
function placePicked() {
  const { article } = state;
  const sections = pickedEls(); // blocks and sections alike (a block in a tab that is not showing takes up no room: no box)
  let layer = article.querySelector(':scope > .mb-kb-picklayer');
  if (!sections.length) { layer?.remove(); return; }
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'mb-kb-picklayer';
    layer.setAttribute('aria-hidden', 'true');
    article.append(layer); // after the Add card: nothing that walks the page's blocks reaches it
  }
  const art = article.getBoundingClientRect();
  const boxes = sections.map(el => {
    const [first, last] = pickSpan(el);
    let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity;
    for (let n = first; n; n = n.nextElementSibling) {
      const r = n.getBoundingClientRect();
      if (r.width || r.height) {
        top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom);
        left = Math.min(left, r.left); right = Math.max(right, r.right);
      }
      if (n === last) break;
    }
    return Number.isFinite(top) ? { top, bottom, left, right } : null;
  }).filter(Boolean);
  while (layer.children.length > boxes.length) layer.lastElementChild.remove();
  boxes.forEach((b, i) => {
    const box = layer.children[i] ?? layer.appendChild(document.createElement('div'));
    box.className = 'mb-kb-pickbox';
    box.style.left = `${b.left - art.left - PICK_PAD}px`;
    box.style.top = `${b.top - art.top - PICK_PAD}px`;
    box.style.width = `${b.right - b.left + PICK_PAD * 2}px`;
    box.style.height = `${b.bottom - b.top + PICK_PAD * 2}px`;
  });
}

function togglePicked(uuid) {
  const { picked } = state;
  const el = nodeEl(uuid);
  if (!el) return;
  if (picked.has(uuid)) picked.delete(uuid);
  else {
    // Nothing is selected twice over: a thing goes in without what is inside
    // it, and without what it is inside.
    const span = pickSpan(el);
    for (const other of [...picked]) {
      const o = nodeEl(other);
      if (o && (spanHolds(span, o) || spanHolds(pickSpan(o), el))) picked.delete(other);
    }
    picked.add(uuid);
  }
  paintPicked();
}

function clearPicked() {
  if (!state.picked.size) return;
  state.picked.clear();
  paintPicked();
}

/** A section's own markdown: its heading and everything under it, identity spans stripped. */
function sectionMarkdown(md, uuid) {
  const sec = locateSectionByUUID(md, uuid);
  if (!sec) return '';
  return stripUUIDSpans(md.split('\n').slice(sec.headerLine, sec.fullEndLine).join('\n')).trim();
}

async function copyPicked() {
  settle();
  const md = shownMd();
  // In the order they stand on the page, whatever order they were clicked in.
  const parts = pickedEls().map(el => {
    if (isSectionEl(el)) return sectionMarkdown(md, el.dataset.mbNode);
    // A cell is copied as what it holds (a cell is nothing on its own).
    if (el.dataset.mbKind === 'cell') return componentsMarkdown(readContainer(md, { kind: TEXT_KIND.cell, uuid: el.dataset.mbNode })?.components ?? []);
    const component = findComponent(md, el.dataset.mbNode)?.component;
    return component ? componentsMarkdown([component]) : '';
  })
    // The placed page title is never copied, alone or inside what is: a page has one.
    .map(part => withoutPageTitles(part).trim()).filter(part => stripUUIDSpans(part).trim());
  if (!parts.length) return;
  try {
    await navigator.clipboard.writeText(parts.join('\n\n'));
    flashCopied();
  } catch (err) {
    alert('Could not copy: ' + err.message);
  }
}

const COPIED_FOR = 1600; // ms Copy says "Copied" with a tick before it is Copy again
let copiedTimer = 0;

/** Copy, done: its icon turns to a tick and it says "Copied" for a moment. */
function flashCopied() {
  const btn = state?.bar?.querySelector('[data-kb-act="copy"]');
  if (!btn) return;
  const slot = btn.querySelector('.mb-kb-foot__icon');
  const text = slot.nextElementSibling;
  const look = (icon, label, done) => {
    btn.classList.toggle('--copied', done);
    text.textContent = label;
    getLucideSvgMarkup(icon).then(svg => { if (svg && btn.classList.contains('--copied') === done) slot.innerHTML = svg; }).catch(() => {});
    sizeFootPiece(state.bar.querySelector('.mb-kb-foot__picks'));
  };
  look('check', 'Copied', true);
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => { if (state?.bar === btn.closest('.mb-kb-foot')) look('copy', 'Copy', false); }, COPIED_FOR);
}

// ── Pasting with the keyboard ────────────────────────────────────────────────
// Ctrl/Cmd+V on the page (not in text being typed) pastes what is on the
// clipboard as blocks: below the lowest of what is selected, or with nothing
// selected at the end of the page. "Paste copied markdown" in the Add menu
// does the same at the place it was opened for.

/** What pasting `text` into `target` would add, or { error }: headings only go into a section. */
function readPaste(text, target) {
  const pasted = parsePastedPage(text);
  if (pasted.sections.length && target.kind !== TEXT_KIND.section) {
    return { error: 'Headings can only be pasted into a section, not inside an admonition, a tab or a grid cell.' };
  }
  return pasted;
}

/** What was read put in at `target`; `then` is handed the identities added, once the page is redrawn. */
function pasteInto(target, { components, sections }, then) {
  const container = { kind: target.kind, uuid: target.uuid };
  const added = [...components.map(uuidOfComponent), ...sections.map(s => s.uuid)].filter(Boolean);
  const op = sections.length
    ? OPS.pasteSections(container, target.at, components, sections)
    : OPS.insertComponents(container, target.at, components);
  pushOp(op, () => then(added));
}

/** Just below the lowest selected thing: after a block (or a cell's grid, a tab's group), at the end of a section's own content. */
function belowPicked() {
  const els = pickedEls();
  if (!els.length) return null;
  const endOf = el => pickSpan(el)[1];
  const low = els.reduce((a, b) => (endOf(a).compareDocumentPosition(endOf(b)) & Node.DOCUMENT_POSITION_FOLLOWING ? b : a));
  const md = workingMd();
  const { mbKind: kind, mbNode: uuid } = low.dataset;
  if (kind === 'section') {
    const container = { kind: TEXT_KIND.section, uuid };
    const body = readContainer(md, container);
    return body ? { ...container, at: body.components.length } : null;
  }
  const hit = kind === 'cell' || kind === 'tab' ? findOwner(md, kind, uuid) : findComponent(md, uuid);
  return hit ? { ...hit.container, at: hit.index + 1 } : null;
}

function onPaste(e) {
  if (!state || state.liveView || state.markdownView || state.sliding || state.updates) return;
  if (inField(e.target) || state.panel || document.querySelector('.mb-editlog-popup, .mb-kb-pastepop')) return;
  const text = e.clipboardData?.getData('text/plain') ?? '';
  if (!text.trim()) return;
  e.preventDefault();
  settle();
  const below = state.picked.size > 0;
  const target = below ? belowPicked() : lastSectionTarget();
  if (!target) return;
  const pasted = readPaste(text, target);
  if (pasted.error) { setStatus(state.status, pasted.error, { tone: 'error', hideAfter: 5000 }); return; }
  if (!pasted.components.length && !pasted.sections.length) return;
  pasteInto(target, pasted, added => {
    if (!added.length) return;
    select(added[0]);
    if (below) {
      // The selection goes on to what was pasted: the next paste lands below it.
      state.picked.clear();
      added.forEach(uuid => state.picked.add(uuid));
      paintPicked();
    }
    revealPasted(added, !below);
  });
}

const PASTE_FLASH = [147, 51, 234]; // the Edit mode purple (#9333ea)

/**
 * What was just pasted, out of sight: the page scrolls to it (to the end of
 * the page, for a paste there) and it flashes, as a system update copied to the
 * drafts does. In sight already, it is left as it is.
 */
async function revealPasted(uuids, toEnd) {
  const first = nodeEl(uuids[0]);
  if (!first) return;
  const r = first.getBoundingClientRect();
  if (r.top >= 0 && r.bottom <= viewBottom()) return;
  if (toEnd) await toPageEnd(); else await scrollToPlace(r.top);
  if (!state) return;
  uuids.forEach(uuid => pulse(nodeEl(uuid), PASTE_FLASH));
}

function reveal(uuid) {
  nodeEl(uuid)?.scrollIntoView({ block: 'nearest' });
}

// ── Settings ─────────────────────────────────────────────────────────────────
// Cmd / Ctrl and a click on anything (a component, a tab set, a grid cell, a
// section) opens a menu out in the margin to its left, holding everything that
// can be set on that thing, named as the form editors name it, and what can be
// done with it. None of it is in the foot, and nothing is drawn until the key
// is held.
//
// The key points at `menu.hover` (what the pointer is on) until the menu opens;
// opening selects that thing, and the open menu then follows the selection.
//
// A spec is { label, span, fields }. `span` is the first and last element of
// the thing (a section runs over several). A field is one of:
//   pills     { label, hint?, options: [[value, text, colour?]], value, set(value), off?: { value: why } }
//             (an option in `off` cannot be picked, and says why in a tooltip)
//   toggle    { label, icon, text, title?, on, set(on) }
//   text      { label, hint?, value, placeholder?, set(value) }   (number likewise)
//   select    { label, options: [[value, text]], value, set(value) }
//   size      { label, mode, value, set(mode, value) }
//   swatches  { label, groups, value, set(value) }
//   buttons   { label, items: [{ icon, label, run(), off?, danger? }] }
//   heading   { text }      note  { text }
// Every `set` and `run` is an edit of its own: it joins the pending edits and
// the page redraws behind the popup, which stays open.

// A title sits inside "double quotes" in the markdown: a double quote typed
// into it becomes a single one. A label pill's own tag keeps its quotes (the
// header reads to the line's last quote, and the pill is only a pill with them).
const plainQuotes = v => v.replace(/<[^>]*>|"/g, m => (m === '"' ? "'" : m));

const BLOCK_MENU_GAP = 12;   // between the menu and what it is for: clear of the thing's dashed line (PICK_PAD)
const BLOCK_MENU_EDGE = 8;   // the menu keeps this far inside the window
const BLOCK_MENU_STRIP = 40; // px the strip under a menu with no margin starts left of it (its soft edge)
const BLOCK_MENU_MIN = 260; // px the menu is given even where the margin is narrower
const HOVER_LINGER = 250; // ms `hover` outlives the pointer leaving for nothing in particular

const YES_NO = [['yes', 'Yes', 'edit'], ['no', 'No', 'grey']];
const pills = (label, options, value, set, hint) => ({ kind: 'pills', label, options, value, set, hint });
const titleCase = s => s.replace(/(^|[\s-])([a-z])/g, (_, gap, ch) => gap + ch.toUpperCase());

let lucideNames = null; // the icons there are, once read (an icon's field takes no other name)

// Mac's Ctrl+click is the right button's: the menu's key is Cmd there, Ctrl elsewhere.
const menuKeyHeld = e => (/Mac|iPhone|iPad/.test(navigator.platform) ? e.metaKey : e.ctrlKey);

/**
 * What a key held down makes of the pointer: 'pick' (Shift: a click selects
 * the thing, a press that moves drags it) or 'menu' (Cmd / Ctrl: a click opens
 * the thing's menu). Neither while both are held (a shortcut on its way), and
 * no menu on the live content. In the text being typed into, Shift+click
 * stays the text's own: it stretches what is highlighted.
 */
function heldMode(e, target) {
  const key = menuKeyHeld(e);
  if (e.altKey || key === e.shiftKey) return null;
  if (key) return state.liveView ? null : 'menu';
  return target instanceof Node && state.active?.el.contains(target) ? null : 'pick';
}

function buildBlockMenu() {
  loadLucideNames().then(names => { lucideNames = Array.isArray(names) && names.length ? names : null; }).catch(() => {});
  // Only a frame for placing the menu: nothing of it shows until the menu opens.
  const el = document.createElement('div');
  el.className = 'mb-kb-blockmenu';
  el.hidden = true;
  el.innerHTML = '<div class="mb-kb-blockmenu__pop mb-fm" role="dialog" hidden></div>';
  document.body.appendChild(el);
  // The faint line round what a held key points at (placeFrame) is not the
  // menu's: it lies in the article, under its foot, as the selection's lines do.
  const hints = document.createElement('div');
  hints.className = 'mb-kb-hintlayer';
  hints.setAttribute('aria-hidden', 'true');
  hints.innerHTML = '<div class="mb-kb-frame" hidden></div>';
  // The ground the menu stands on where the page leaves it no margin (placeBlockMenu).
  const strip = document.createElement('div');
  strip.className = 'mb-kb-menustrip';
  strip.hidden = true;
  const menu = {
    el,
    hints,
    strip,
    hoverFrame: hints.firstElementChild,
    dragging: false,
    // The settings: the editor's floating menu (floatMenu.js), loose pills in
    // groups by the thing they set, the rest of the page washed back.
    pop: el.querySelector('.mb-kb-blockmenu__pop'),
    body: el.querySelector('.mb-kb-blockmenu__pop'),
    veil: createVeil(),
    // (After the veil on the page: the strip lies over its wash and blur, under the menu.)
    // `page`: the menu is open on the page's own settings (the cog by the title), not on a block.
    spec: null, hover: null, mode: null, open: false, page: false, busy: false, sig: null, frame: 0,
  };
  state.menu = menu;
  document.body.appendChild(strip);

  // The pointer: `hover` is what it is on (the buttons beside an update follow
  // it too: syncSide), and `mode` what the key held down makes of that. `hover`
  // lingers a moment when the pointer leaves for nothing at all.
  let linger = 0;
  let last = null; // the pointer, as last heard from
  let pointerFrame = 0;
  const keep = () => { clearTimeout(linger); linger = 0; };
  const setMode = mode => {
    if (mode === menu.mode) return;
    menu.mode = mode;
    if (!menu.open) syncBlockMenu(); // an open menu keeps its line whatever is held
    paintFoot();
  };
  // Take the pointer to be at (x, y), over `t`. Gives back the thing it is on there, if any.
  const track = (t, x, y) => {
    if (menu.open || menu.dragging) return null; // an open menu, or a drag, holds things as they are
    if (!(t instanceof Element)) return null;
    if (el.contains(t) || t.closest('.mb-popup-menu, .mb-fm, .mb-kb-upd-side')) { keep(); return null; } // a menu holds it too, and an update's side buttons
    let node = state.article.contains(t) && !inChrome(t) ? nodeFor(t) : null;
    // On a box's own left edge (its border, its padding) the pointer is
    // beside what the box holds at that height, as in the margin below.
    // (Not a grid's: the gap between its cells is the only place the grid itself is.)
    if (node && t === node && node.dataset.mbKind !== 'grid') node = innermostAt(node, y, x);
    // An update being published is no node, but has a button of its own beside it.
    let ghost = state.article.contains(t) ? t.closest('[data-mb-ghost]') : null;
    // Only the pointer's height matters: out in the margins or over the
    // sidebars, it is on whatever the article holds at that height (found at
    // the nearest point across, inside the article's own text column).
    if (!node && !inChrome(t) && !state.bar.contains(t) && !t.closest('.md-header')) {
      const box = state.article.getBoundingClientRect();
      const cs = getComputedStyle(state.article);
      const left = box.left + (parseFloat(cs.paddingLeft) || 0) + 1;
      const right = box.right - (parseFloat(cs.paddingRight) || 0) - 1;
      if (y >= box.top && y <= box.bottom && right > left) {
        const at = document.elementFromPoint(Math.min(Math.max(x, left), right), y);
        // The nearest point is the edge of the outermost box there: what the
        // pointer is level with may be any depth inside it.
        if (at && state.article.contains(at) && !inChrome(at)) node = innermostAt(nodeFor(at), y);
        else if (at && state.article.contains(at)) ghost = at.closest('[data-mb-ghost]');
      }
    }
    const waiting = ghost?.dataset.mbGhost ?? null;
    if (waiting !== state.ghostHover) { state.ghostHover = waiting; syncSide(); }
    if (node) {
      keep();
      if (node.dataset.mbNode !== menu.hover) {
        menu.hover = node.dataset.mbNode;
        syncBlockMenu();
      }
    } else if (menu.hover && !linger) {
      linger = setTimeout(() => {
        linger = 0;
        menu.hover = null;
        if (state && !menu.open) syncBlockMenu();
      }, HOVER_LINGER);
    }
    return node ?? null;
  };
  // A press with a key held looks at once, not a frame later (onHeldDown).
  menu.point = (t, x, y, mode) => {
    menu.mode = mode;
    const node = track(t, x, y);
    syncBlockMenu();
    paintFoot();
    return node;
  };
  document.addEventListener('mousemove', e => {
    last = e;
    if (pointerFrame) return;
    pointerFrame = requestAnimationFrame(() => {
      pointerFrame = 0;
      if (!state) return;
      track(last.target, last.clientX, last.clientY);
      setMode(heldMode(last, last.target));
    });
  }, { passive: true });
  // The key itself, pressed or let go with the pointer at rest. While text is
  // being typed a key going down is the text's (a capital, a shortcut): there,
  // only the pointer moving with it held says otherwise.
  const onHeldKey = e => {
    if (!state || !last || !['Shift', 'Meta', 'Control', 'Alt'].includes(e.key)) return;
    if (e.type === 'keydown' && state.active) return;
    const t = document.elementFromPoint(last.clientX, last.clientY);
    if (t) track(t, last.clientX, last.clientY); // the page may have scrolled under it
    setMode(heldMode(e, t));
  };
  document.addEventListener('keydown', onHeldKey, true);
  document.addEventListener('keyup', onHeldKey, true);
  window.addEventListener('blur', () => { if (state) setMode(null); }); // the key may be let go unheard

  // A press on the menu must not take the caret out of the text being edited
  // (the popup's own fields still take focus).
  el.addEventListener('mousedown', e => {
    if (!(e.target instanceof Element) || !e.target.closest('input:not([type="radio"], [type="checkbox"]), select')) e.preventDefault();
  });
  const fieldAt = node => menu.spec?.fields[Number(node.closest('[data-f]')?.dataset.f)] ?? null;
  // One control was used: its edit is made, and the popup shows what is true
  // now. It stays open even when the edit moves the selection on (a new tab,
  // the cell beside a deleted one).
  const apply = fn => {
    menu.busy = true;
    try { fn(); } finally { menu.busy = false; }
    syncBlockMenu();
  };
  const commitText = input => {
    if (!input.dataset.dirty) return;
    delete input.dataset.dirty;
    const f = fieldAt(input);
    if (!f) return;
    // Only an icon there is: anything else typed there is dropped.
    if (f.kind === 'icon' && input.value.trim() && lucideNames && !lucideNames.includes(typedIconName(input.value))) { syncBlockMenu(); return; }
    if (f.kind === 'size') apply(() => f.set(input.closest('[data-f]').querySelector('input[type="radio"]:checked')?.value ?? 'none', input.value));
    else apply(() => f.set(input.value));
  };
  menu.flush = () => { const input = menu.body.querySelector('[data-dirty]'); if (input) commitText(input); };

  menu.body.addEventListener('input', e => {
    if (e.target.matches('input[type="text"], input[type="number"]')) e.target.dataset.dirty = '1';
  });
  menu.body.addEventListener('change', e => {
    const input = e.target;
    if (input.matches('input[type="text"], input[type="number"]')) { commitText(input); return; }
    const { value, checked } = input;
    menu.flush(); // a field typed into and not yet applied goes first
    const f = fieldAt(input);
    if (!f) return;
    if (input.type === 'checkbox') apply(() => f.set(checked, value)); // (a 'checks' field has several)
    else if (f.kind === 'size') {
      const px = input.closest('[data-f]').querySelector('input[type="number"]');
      delete px.dataset.dirty;
      apply(() => f.set(value, px.value));
    } else apply(() => f.set(value)); // a radio or a select
  });
  menu.body.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.isComposing && e.target.matches('input[type="text"], input[type="number"]')) {
      e.preventDefault();
      // In an icon's field Enter takes the first match of what was typed.
      if (fieldAt(e.target)?.kind === 'icon' && e.target.dataset.dirty && lucideNames && !lucideNames.includes(typedIconName(e.target.value))) {
        const first = e.target.value.trim() && rankMatches(lucideNames, e.target.value)[0];
        if (first) e.target.value = first;
      }
      commitText(e.target);
    }
  });
  menu.body.addEventListener('click', e => {
    // A type pill (an admonition's), or an icon offered under a field searched in.
    const pick = e.target.closest('[data-type], [data-icon-name]');
    if (pick) {
      const value = pick.dataset.type ?? pick.dataset.iconName;
      // What was typed to find the icon is not itself applied.
      if (pick.dataset.iconName) pick.closest('[data-f]').querySelectorAll('[data-dirty]').forEach(input => delete input.dataset.dirty);
      menu.flush();
      const f = fieldAt(pick);
      if (f && value !== f.value) apply(() => f.set(value));
      else if (f) syncBlockMenu();
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const item = fieldAt(btn)?.items?.[Number(btn.dataset.act)];
    if (!item || item.off) return;
    menu.flush();
    // The flush may have redrawn the page: run what the button means now.
    const now = fieldAt(btn)?.items?.[Number(btn.dataset.act)];
    if (now && !now.off) apply(() => now.run());
  });
  // Escape closes the popup, dropping what was typed into a field and not yet applied.
  menu.pop.addEventListener('keydown', e => {
    // The arrows move among the pills that are buttons, by where they stand
    // (the radios keep the browser's own keys).
    if (e.key !== 'Escape') { if (e.target instanceof Element && e.target.matches('button.mb-fm__pill')) stepPills(menu.pop, e); return; }
    e.preventDefault();
    e.stopPropagation();
    menu.body.querySelectorAll('[data-dirty]').forEach(input => delete input.dataset.dirty);
    closeSettings();
  });

  const queue = () => {
    if (menu.frame) return;
    menu.frame = requestAnimationFrame(() => { menu.frame = 0; if (state) { placeBlockMenu(); placePicked(); placeCaptureVeil(); state.side?.place(); state.liveSide?.place(); state.pendingSide?.place(); } });
  };
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  // Typing, a loading image, a folded admonition: anything that changes the
  // page's height moves what the menu and the lines are beside.
  new ResizeObserver(queue).observe(state.article);
  state.article.addEventListener('input', queue);
  state.article.addEventListener('toggle', queue, true);
  state.article.addEventListener('change', queue); // another tab shown
}

/** Open the popup on what is selected. */
function openSettings() {
  const menu = state.menu;
  if (!nodeEl(state.sel)) return;
  closePanel();
  menu.page = false;
  menu.open = true;
  menu.sig = null;
  syncBlockMenu();
}

function closeSettings() {
  const menu = state?.menu;
  if (!menu?.open) return;
  menu.flush(); // a field typed into and not yet applied is applied
  menu.open = false;
  menu.page = false;
  menu.hover = state.sel; // until the pointer moves on
  syncBlockMenu();
  paintPageSettingsButton();
}

/** Bring the menu and the held key's line in line with the pointer, the selection and the draft as they are now. */
function syncBlockMenu() {
  const menu = state.menu;
  if (menu.page && !menu.open) menu.page = false;
  const el = menu.page ? pageSettingsButton() : nodeEl(menu.open ? state.sel : menu.hover);
  menu.spec = !el ? null : menu.page ? pageSettingsSpec(el) : settingsFor(el);
  if (!menu.spec) { menu.open = false; menu.page = false; }
  const opening = menu.open && menu.pop.hidden;
  menu.pop.hidden = !menu.open;
  if (!menu.open) menu.veil.hide();
  if (!menu.spec) {
    menu.el.hidden = true;
    menu.strip.hidden = true;
    menu.hoverFrame.hidden = true;
    document.documentElement.classList.remove('mb-kb-held', 'mb-kb-menu-open');
    syncSide();
    return;
  }
  if (menu.open) drawSettings();
  if (opening) playIn(menu.pop);
  placeBlockMenu();
  syncSide();
}

// The box a thing takes up on the page: from the first element of its span to the last.
function spanBox([first, last]) {
  let top = Infinity;
  let bottom = -Infinity;
  let left = Infinity;
  let right = -Infinity;
  for (let n = first; n; n = n.nextElementSibling) {
    const r = n.getBoundingClientRect();
    if (r.width || r.height) {
      top = Math.min(top, r.top);
      bottom = Math.max(bottom, r.bottom);
      left = Math.min(left, r.left);
      right = Math.max(right, r.right);
    }
    if (n === last) break;
  }
  return Number.isFinite(top) ? { top, bottom, left, right } : null;
}

// The faint dashed line round the thing a held key points at: where the
// selection's line would stand, PICK_PAD off it. With Shift it is round what a
// click would select and a drag would move (a cell's is its grid); with the
// menu's key, and for as long as the menu is open, round what the menu sets.
// `at` is the article's corner, which the frame is placed from (it lies in a
// layer of the article, over its content and under its foot). A thing already
// selected has its line, and gets no second one.
function placeFrame(frame, span, owner, at) {
  const b = span && !owner?.classList.contains('mb-kb-picked') && span.every(n => n?.isConnected) ? spanBox(span) : null;
  frame.hidden = !b;
  if (!b) return;
  frame.style.left = `${b.left - at.x - PICK_PAD}px`;
  frame.style.top = `${b.top - at.y - PICK_PAD}px`;
  frame.style.width = `${b.right - b.left + PICK_PAD * 2}px`;
  frame.style.height = `${b.bottom - b.top + PICK_PAD * 2}px`;
}

function placeBlockMenu() {
  const menu = state.menu;
  if (!menu.spec) return;
  const box = menu.spec.span.every(n => n?.isConnected) ? spanBox(menu.spec.span) : null;
  const art = state.article.getBoundingClientRect();
  const at = { x: art.left, y: art.top };
  if (menu.hints.parentElement !== state.article) state.article.append(menu.hints); // a redraw took it out with the rest
  const owner = nodeEl(menu.open ? state.sel : menu.hover);
  const moved = menu.spec.drag && (menu.spec.drag.cell ?? menu.spec.drag.section ?? menu.spec.drag.block);
  if (menu.page) menu.hoverFrame.hidden = true; // the page's settings are for no one block
  else if (menu.open || menu.mode === 'menu') placeFrame(menu.hoverFrame, menu.spec.span, owner && isSectionEl(owner) ? owner : menu.spec.span[0], at);
  else if (menu.mode === 'pick' && moved) placeFrame(menu.hoverFrame, pickSpan(moved), moved, at);
  else menu.hoverFrame.hidden = true;
  // A click would do something here: the pointer says so.
  document.documentElement.classList.toggle('mb-kb-held', !menu.open && (menu.mode === 'menu' || (menu.mode === 'pick' && !!moved)));

  menu.el.hidden = !menu.open || !box;
  document.documentElement.classList.toggle('mb-kb-menu-open', !menu.el.hidden); // the page's contents list fades out (formsStyling.css)
  if (menu.el.hidden) { menu.strip.hidden = true; menu.veil.hide(); return; }
  // The menu stands in the margin to the thing's right, level with its top:
  // its left edge BLOCK_MENU_GAP off the thing, everything in it set to that
  // edge. Always off the article's own text column, however deep the thing is
  // nested (the contents list that is there fades out while it is open). It is
  // placed on the page and scrolls with it, so one longer than the view is
  // scrolled to. In a margin too narrow to hold it, it keeps a least width and
  // reaches back over the thing's own right.
  const height = box.bottom - box.top;
  const edge = Math.max(box.right, art.right - (parseFloat(getComputedStyle(state.article).paddingRight) || 0));
  const vw = document.documentElement.clientWidth;
  const least = Math.min(BLOCK_MENU_MIN, vw - BLOCK_MENU_EDGE * 2);
  // Page settings opens straight under its cog, its left edge on the cog's.
  const left = Math.max(BLOCK_MENU_EDGE, Math.min(menu.page ? box.left : edge + BLOCK_MENU_GAP, vw - BLOCK_MENU_EDGE - least));
  menu.el.style.left = `${left + window.scrollX}px`;
  menu.el.style.top = `${(menu.page ? box.bottom + MENU_GAP : box.top) + window.scrollY}px`;
  menu.pop.style.maxWidth = `${Math.min(MENU_MAX_WIDTH, vw - BLOCK_MENU_EDGE - left)}px`;
  menu.veil.show({ left: box.left - PICK_PAD, top: box.top - PICK_PAD, width: box.right - box.left + PICK_PAD * 2, height: height + PICK_PAD * 2 }, '8px');
  // A page with no contents list beside it (hidden in its settings, or the
  // window too narrow for one) runs out to where the menu stands: the menu
  // would lie on the page's own content, washed back but still there to read
  // through. There it gets ground of its own, a strip of the page's colour
  // down the window's right side from just left of the menu. A page that
  // leaves the margin free keeps it as it is.
  const toc = document.querySelector('.md-sidebar--secondary');
  const margin = !!toc && !toc.hidden && toc.getClientRects().length > 0;
  menu.strip.hidden = margin;
  if (!margin) menu.strip.style.left = `${Math.max(0, left - BLOCK_MENU_STRIP)}px`;
}

// ── The popup ────────────────────────────────────────────────────────────────

const fieldShape = f => [f.kind, f.label, f.hint, f.text, f.top, f.icon, f.placeholder, f.noAuto,
  f.options?.map(o => o.slice(0, 2)), f.items?.map(i => [i.icon, i.label, !!i.danger]),
  f.groups && Object.keys(f.groups).length, f.kind === 'checks' && f.options.map(o => o[2] ?? '')];

// The menu is rebuilt only when what it holds changes; otherwise its controls
// stay as they are and take the new values (a click in flight still lands).
function drawSettings() {
  const menu = state.menu;
  const { label, fields } = menu.spec;
  menu.pop.setAttribute('aria-label', `${label} settings`);
  const sig = JSON.stringify(fields.map(fieldShape));
  if (sig !== menu.sig) {
    menu.sig = sig;
    menu.body.replaceChildren(...fields.map(buildField));
  }
  fields.forEach((f, i) => paintField(menu.body.children[i], f));
}

function iconSpan(name) {
  const span = document.createElement('span');
  span.className = 'more-buttons-icon';
  span.textContent = name;
  return span;
}

// One field of the menu: a group of pills under its heading (floatMenu.js).
function buildField(f, i) {
  if (f.kind === 'heading' || f.kind === 'note') {
    const el = document.createElement('div');
    el.dataset.f = String(i);
    el.className = f.kind === 'heading' ? `mb-fm__title${f.top ? ' --top' : ''}` : 'mb-fm__note';
    el.textContent = f.text;
    return el;
  }
  const { el, row } = menuGroup(f.label, f.hint);
  el.dataset.f = String(i);
  const name = `mb-kb-set-${i}`;

  if (f.kind === 'pills' || f.kind === 'select') {
    row.append(...f.options.map(([value, text]) => menuOption('radio', name, value, text)));
  } else if (f.kind === 'types') {
    row.append(...typePills(f.options, f.value));
  } else if (f.kind === 'checks') {
    // Several checkboxes, any number ticked; a pill with a colour (a tag's) wears it.
    row.append(...f.options.map(([value, text, colour]) => {
      const preset = colour && palette?.flat?.[colour];
      const pill = menuOption('checkbox', name, value, text, { extraClass: preset ? '--swatch' : '' });
      if (preset) paintLabelVars(pill, preset);
      return pill;
    }));
  } else if (f.kind === 'toggle') {
    const pill = menuOption('checkbox', name, 'on', f.text, { icon: f.icon ? iconSpan(f.icon) : null });
    if (f.title) pill.title = f.title;
    row.append(pill);
  } else if (f.kind === 'text' || f.kind === 'number') {
    const input = menuInput(f.kind, f.placeholder);
    if (f.kind === 'number') { input.min = '1'; input.step = '1'; input.classList.add('--short'); }
    row.append(input);
  } else if (f.kind === 'icon') {
    // A lucide icon by name: typed, or picked from the matches offered under the field.
    const input = menuInput('text', f.placeholder);
    const matches = menuRow();
    matches.classList.add('--matches');
    matches.hidden = true;
    let timer = 0;
    const offer = async () => {
      const names = await loadLucideNames();
      if (!input.isConnected || !input.dataset.dirty) return;
      const pills = input.value.trim() ? iconMatchPills(names, input.value, f.value, 12) : [];
      matches.replaceChildren(...pills);
      matches.hidden = !pills.length;
      placeBlockMenu();
    };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(offer, 90); });
    row.append(input);
    el.append(matches);
  } else if (f.kind === 'size') {
    // A capture's own Auto is the Size preset of that name: Custom offers only the two set by hand.
    row.append(...[['height', 'Height'], ['width', 'Width'], ...(f.noAuto ? [] : [['none', 'Auto']])].map(([value, text]) => menuOption('radio', name, value, text)));
    const input = menuInput('number');
    input.min = '1';
    input.classList.add('--short');
    input.setAttribute('aria-label', 'Pixels');
    const unit = document.createElement('span');
    unit.className = 'mb-fm__unit';
    unit.textContent = 'px';
    row.append(input, unit);
  } else if (f.kind === 'swatches') {
    Object.values(f.groups).forEach((presets, g) => {
      if (g) row.append(menuBreak());
      for (const [presetName, preset] of Object.entries(presets)) {
        const pill = menuOption('radio', name, presetName.toLowerCase(), presetName, { extraClass: '--swatch' });
        paintLabelVars(pill, preset);
        row.append(pill);
      }
    });
  } else if (f.kind === 'buttons') {
    f.items.forEach((item, j) => {
      const btn = menuPill(item.label, { icon: iconSpan(item.icon), extraClass: item.danger ? '--danger' : '' });
      btn.dataset.act = String(j);
      row.append(btn);
    });
  }
  return el;
}

function paintField(el, f) {
  if (f.kind === 'pills' || f.kind === 'swatches' || f.kind === 'select') {
    el.querySelectorAll('input').forEach(input => {
      input.checked = input.value === (f.value ?? '');
      const why = f.off?.[input.value] ?? '';
      input.disabled = !!why;
      const pill = input.closest('.mb-fm__pill');
      if (why) setThemeTip(document, pill, why, { name: false });
      else if (pill.mbTip) pill.mbTip = '';
    });
  } else if (f.kind === 'types') {
    el.querySelectorAll('[data-type]').forEach(pill => pill.setAttribute('aria-checked', String(pill.dataset.type === f.value)));
  } else if (f.kind === 'checks') {
    el.querySelectorAll('input').forEach(input => { input.checked = f.values.includes(input.value); });
  } else if (f.kind === 'toggle') {
    el.querySelector('input').checked = !!f.on;
  } else if (f.kind === 'text' || f.kind === 'number' || f.kind === 'icon') {
    const input = el.querySelector('input');
    if (!input.dataset.dirty) {
      input.value = f.value ?? '';
      // An icon was taken (or the field left as it was): its matches go.
      if (f.kind === 'icon') { const matches = el.querySelector('.mb-fm__row.--matches'); matches.replaceChildren(); matches.hidden = true; }
    }
  } else if (f.kind === 'size') {
    const input = el.querySelector('input[type="number"]');
    el.querySelectorAll('input[type="radio"]').forEach(radio => { radio.checked = radio.value === f.mode; });
    input.disabled = f.mode === 'none';
    if (!input.dataset.dirty) input.value = f.mode === 'none' ? '' : f.value ?? '';
  } else if (f.kind === 'buttons') {
    el.querySelectorAll('[data-act]').forEach((btn, j) => { btn.disabled = !!f.items[j].off; });
  }
}

// ── What the site draws from the page's settings ─────────────────────────────
// The "Written for" line under the H1 and the tags row that closes the
// article are the site's own, built from the frontmatter. Here they are drawn
// from the markdown being shown, so a setting changed in Page settings shows
// as it is made (and the Live tab shows the live page's).

// The site's audience registry (zensical.toml's mb_audiences), once read: the
// names, colours and icons of the "Written for" pills. Until then, and if it
// can't be read, the ones this extension knows (audienceTags.js).
let audiences = null;

function loadPageChrome() {
  if (audiences) return;
  loadAudiences().then(list => {
    if (!list.length || audiences) return;
    audiences = list;
    if (state && !state.noDraft && !(state.markdownView && !state.liveView)) placePageChrome();
  }).catch(() => {});
}

function placePageChrome() {
  const { article } = state;
  // The left navigation's room: the theme gives it up when the sidebar is
  // `hidden` (as the site builds it under `hide: [navigation]`), and the
  // article takes the space. The served page says what the last build knew;
  // this says what the page being shown says now. ("On this page" is kbToc's.)
  const nav = document.querySelector('.md-sidebar--primary');
  const noNav = readFrontmatterHide(shownMd()).includes('navigation');
  if (nav && nav.hidden !== noNav) nav.hidden = noNav;
  article.querySelectorAll(':scope > .mb-written-for, :scope > .md-tags').forEach(el => el.remove());
  const chrome = pageChromeHtml(shownMd(), { audiences });
  if (chrome.writtenFor) {
    const h1 = article.querySelector('h1');
    if (h1) h1.insertAdjacentHTML('afterend', chrome.writtenFor); else article.insertAdjacentHTML('afterbegin', chrome.writtenFor);
    article.querySelectorAll('.mb-written-for [data-mb-lucide]').forEach(slot => {
      const name = slot.dataset.mbLucide;
      const now = lucideSvg(name);
      if (now) slot.innerHTML = now;
      else getLucideSvgMarkup(name).then(svg => { if (svg) slot.innerHTML = svg; }).catch(() => {});
    });
  }
  if (chrome.tags) {
    const foot = article.querySelector(':scope > .mb-kb-foot');
    if (foot) foot.insertAdjacentHTML('beforebegin', chrome.tags); else article.insertAdjacentHTML('beforeend', chrome.tags);
  }
  state.comments?.reanchor(); // the navigation's room may have come or gone
}

// ── Page settings ────────────────────────────────────────────────────────────
// The cog by the title opens the page's own settings in the block menu, as a
// block's open on it: the form editors' Page settings (Icon, Written for,
// Tags, Page visibility, Hide elements), under their names. All but Page
// visibility live in the draft's frontmatter and are ops like any other edit
// (undone, saved with the rest). Page visibility lives in zensical.toml: it is
// held until Save, which writes it after the draft (saveVisibility).

// The tag registry (zensical.toml's mb_created_tags), once loaded: the tags a
// page may carry, with their colours. New tags are made in Knowledge Base Settings.
let tagRegistry = null;

const pageSettingsButton = () => state.article.querySelector('.mb-kb-pagesettings');

function paintPageSettingsButton() {
  pageSettingsButton()?.setAttribute('aria-pressed', String(!!state?.menu?.page));
}

function togglePageSettings() {
  const menu = state.menu;
  if (menu.page) { closeSettings(); return; }
  deactivate();
  select(null);
  closePanel();
  menu.page = true;
  menu.open = true;
  menu.sig = null;
  syncBlockMenu();
  paintPageSettingsButton();
  if (!tagRegistry) {
    loadTagRegistry().then(list => { tagRegistry = list; if (state?.menu.page) syncBlockMenu(); }).catch(() => {});
  }
  if (!state.visibility) {
    const v = state.visibility = { saved: null, want: null };
    isGuideUnlisted(state.page.livePath)
      .then(unlisted => { v.saved = unlisted ? 'unlisted' : 'public'; if (state?.menu.page) syncBlockMenu(); })
      .catch(err => { if (state?.visibility === v) state.visibility = null; console.warn('MB Warn: could not read the page visibility', err); });
  }
}

function pageSettingsSpec(btn) {
  const now = readPageSettings(workingMd());
  const change = c => pushOp(OPS.pageSettings(c));
  const fresh = () => readPageSettings(workingMd());
  // The registry's tags (the three audience tags are Written for's), then any
  // the page carries that the registry does not know.
  const known = (tagRegistry ?? []).filter(e => !AUDIENCES.some(a => a.tag.toLowerCase() === e.name.toLowerCase()));
  const lower = new Set(known.map(e => e.name.toLowerCase()));
  const tags = [...known.map(e => [e.name, e.name, e.colour || '']), ...now.tags.filter(t => !lower.has(t.toLowerCase())).map(t => [t, t, ''])];
  const vis = state.visibility;
  return {
    label: 'Page settings',
    span: [btn, btn],
    fields: [
      { kind: 'heading', text: 'Page settings', top: true },
      { kind: 'icon', label: 'Icon', hint: 'Beside the page in the navigation', value: now.icon.replace(/^lucide\//, ''), placeholder: 'Search icons, e.g. book-open',
        set: v => {
          const name = v.trim().toLowerCase().replace(/^:?lucide[/-]/, '').replace(/[^a-z0-9-]/g, '');
          change({ icon: name ? `lucide/${name}` : '' });
        } },
      { kind: 'pills', label: 'Written for', hint: 'Which OCC users this page is written for',
        options: [...AUDIENCES.map(a => [a.value, a.label]), [AUDIENCE_NONE, 'N/A']], value: now.writtenFor,
        set: v => change({ writtenFor: v }) },
      tags.length
        ? { kind: 'checks', label: 'Tags', hint: 'Group related pages, e.g. System, Contractors', options: tags, values: now.tags,
          set: (on, tag) => {
            const list = fresh().tags.filter(t => t.toLowerCase() !== tag.toLowerCase());
            change({ tags: on ? [...list, tag] : list });
          } }
        : { kind: 'note', text: tagRegistry ? 'No tags yet: tags are made in Knowledge Base Settings.' : 'Loading tags…' },
      { kind: 'pills', label: 'Page visibility', hint: vis?.saved ? 'Unlisted pages stay reachable by link but leave the site navigation and search' : 'Loading…',
        options: [['public', 'Public'], ['unlisted', 'Unlisted']], value: vis?.want ?? vis?.saved ?? '',
        set: v => {
          if (!state.visibility?.saved) return; // not read yet
          state.visibility.want = v;
          refreshSaveState();
        } },
      { kind: 'checks', label: 'Hide elements', options: PAGE_HIDES.map(([key, text]) => [key, text]),
        values: PAGE_HIDES.map(([key]) => key).filter(key => now.hide[key]),
        set: (on, key) => change({ hide: { [key]: on } }) },
    ],
  };
}

// ── What can be set on each kind of thing ────────────────────────────────────
// Labels and options are the form editors' own (config/forms/edit*.html).

// What Shift selects and moves: a block ({ block: its element }) or a
// section ({ section: its heading }). A tab is moved among its own kind by its
// label (onLabelDown), so on one it is the whole group; the page title stays
// where it is. A grid (by the gap between its cells) is a block like any
// other, and goes whole. A cell (by its empty space) goes whole too
// ({ cell: its element }), but only to where a cell can stand: beside another
// cell, or beside a block, which makes a grid of the two (onPickDown).
function dragFor(el) {
  const kind = el.dataset.mbKind;
  if (kind === 'section') return el.tagName === 'H1' ? null : { section: el };
  if (kind === 'cell') return el.dataset.mbNode ? { cell: el } : null;
  const block = kind === 'tab' ? el.closest('[data-mb-kind="tabs"]') : el;
  return block?.dataset.mbNode ? { block } : null;
}

function settingsFor(el) {
  // An update has no menu and is not selected or moved, in the drafts or on
  // the live content: its own controls are the icon (its type), its title line and the buttons
  // either side of it.
  if (isUpdateEl(el)) return null;
  // The live content is read only: a thing can only be selected there (Shift
  // and a click). (No settings are worked out: they would be the draft's.)
  if (state.liveView) {
    const drag = dragFor(el);
    const at = drag && (drag.cell ?? drag.section ?? drag.block);
    return at ? { label: '', fields: [], span: [at, at], drag } : null;
  }
  const spec = settingsOf(el);
  if (!spec) return null;
  // The menu opens by saying what the thing is (a Grid, a Cell, a Section, an
  // Admonition...): its fields follow, a heading of the same name dropped.
  const own = spec.fields.filter(Boolean);
  const rest = own[0]?.kind === 'heading' && own[0].text === spec.label ? own.slice(1) : own;
  return { ...spec, fields: [{ kind: 'heading', text: spec.label, top: true }, ...rest], drag: dragFor(el) };
}

function settingsOf(el) {
  const md = workingMd();
  const uuid = el.dataset.mbNode;
  const kind = el.dataset.mbKind;
  if (kind === 'section') return sectionSettings(md, uuid, el);
  if (kind === 'tab') return tabsSettings(md, uuid);
  if (kind === 'tabs') return tabsSettings(md, shownTabOf(el)?.dataset.mbNode);
  if (kind === 'cell') return columnSettings(md, uuid, el);
  const hit = findComponent(md, uuid);
  if (!hit) return null;
  const c = hit.component;
  // The gap between two cells: the grid's own settings.
  if (c.kind === 'grid') return { label: 'Grid', span: [el, el], fields: [...rowFields(md, hit), actions(md, hit)] };
  const spec = c.kind === 'text' && readPageTitle(c.txt.body) != null ? { label: 'Page title', fields: [actions(md, hit)] }
    : c.kind === 'text' ? textSettings(md, hit)
    : c.kind === 'admonition' ? admonitionSettings(md, hit)
    : c.kind === 'table' ? tableSettings(md, hit)
    : c.kind === 'codeblock' ? codeSettings(md, hit)
    : c.kind === 'button' ? buttonSettings(md, hit)
    : c.kind === 'navlinks' ? navLinksSettings(md, hit)
    : c.kind === 'diagram' ? { label: 'Diagram', fields: [actions(md, hit)] }
    : mediaSettings(md, hit);
  // A block standing in a column of a row: its own settings, then its
  // column's and its row's (neither has anything on the page to open a menu from).
  const beside = hit.container.kind === TEXT_KIND.cell ? columnFields(md, hit.container.uuid) : [];
  return spec && { span: [el, el], ...spec, fields: [...spec.fields, ...beside] };
}

// Delete: every block has it. (Moving is Shift and a drag, and so is copying:
// Shift and a click selects the block, and the foot copies what is selected.)
function actions(md, hit) {
  const uuid = uuidOfComponent(hit.component);
  return { kind: 'buttons', label: 'Actions', items: [
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
      { icon: 'merge', label: 'Join with text above', off: above?.kind !== 'text' || readPageTitle(above.txt.body) != null,
        run: () => pushOp(OPS.joinText(uuid), () => select(above.txt.uuid)) },
      { icon: 'trash-2', label: 'Delete', danger: true, run: () => removeComponent(uuid) },
    ] },
  ] };
}

// ── Dragging ─────────────────────────────────────────────────────────────────
// A press with Shift held that moves (kbPageDrag.js follows the pointer and
// draws the line; here is what is moved and what a drop does).

const TAB_HOLD = 500; // ms a dragged block rests on a tab's label before that tab shows

// The part of the window the page shows in: under the site's header, over the bar.
function dragView() {
  const header = document.querySelector('.md-header')?.getBoundingClientRect();
  return { top: Math.max(0, header && header.top <= 0 ? header.bottom : 0), bottom: viewBottom() };
}

/** Every element of the run a draggable thing takes up: a block is itself, a section runs to its end. */
function runOf(el) {
  const [first, last] = pickSpan(el);
  const els = [];
  for (let n = first; n; n = n.nextElementSibling) { els.push(n); if (n === last) break; }
  return els;
}

/**
 * What goes when `uuid` is dragged, in the order it stands on the page: itself,
 * and, when it is one of several selected, the rest of the selection of its
 * sort (blocks with a block; sections of its level with a section). What else
 * is selected stays where it is.
 */
function dragGroup(uuid) {
  const el = nodeEl(uuid);
  // (A cell goes alone: where it can land is its own affair.)
  const isCell = o => o.dataset.mbKind === 'cell';
  if (!el || isCell(el) || !state.picked.has(uuid) || state.picked.size < 2) return [uuid];
  const alike = o => (isSectionEl(el) ? isSectionEl(o) && o.tagName === el.tagName : !isSectionEl(o) && !isCell(o));
  return [...state.article.querySelectorAll('[data-mb-node]')]
    .filter(o => state.picked.has(o.dataset.mbNode) && alike(o))
    .map(o => o.dataset.mbNode);
}

/** What was dropped on the Delete card, deleted as one change once that is agreed to. */
async function deleteDragged(uuids) {
  const md = workingMd();
  const els = uuids.map(nodeEl).filter(Boolean);
  if (!els.length) return;
  const n = els.length;
  const section = isSectionEl(els[0]);
  const title = section ? buildSectionTree(md).sections?.find(s => s.uuid === uuids[0])?.title : '';
  const isCell = el => el.dataset.mbKind === 'cell';
  const ask = n > 1 ? `Delete the ${n} selected ${section ? 'sections and everything in them' : 'components'}?`
    : section ? `Delete the section '${title || 'Untitled'}' and everything in it?`
      : isCell(els[0]) ? 'Delete this cell and everything in it?'
        : 'Delete this component?';
  if (!(await confirmDelete(ask))) return;
  if (!state || workingMd() !== md) return; // the page moved on behind the question
  const ops = els.map(el => (isSectionEl(el) ? OPS.deleteSection(el.dataset.mbNode) : isCell(el) ? OPS.deleteCell(el.dataset.mbNode) : OPS.deleteComponent(el.dataset.mbNode)));
  pushOp(n > 1 ? OPS.together(ops) : ops[0]);
}

/** A press with Shift held on `drag` (dragFor): let go where it began it selects, moved it drags. */
function onPickDown(e, drag) {
  const menu = state.menu;
  const section = drag.section ?? null;
  const cell = !!drag.cell;
  const uuid = (section ?? drag.cell ?? drag.block).dataset.mbNode;
  // The live content stays where it is: there the press only selects.
  if (state.liveView) { togglePicked(uuid); return; }
  // The page may be redrawn as the drag starts (text being typed is finished
  // first): what is moved is found again by its identity.
  const source = () => nodeEl(uuid);
  // A selected thing takes the rest of the selection with it (dragGroup).
  let uuids = [uuid];
  const others = () => uuids.filter(u => u !== uuid).map(nodeEl).filter(Boolean);
  // A block held over the label of a tab that is not showing brings that tab
  // forward, so it can be dropped inside.
  let hold = null;
  const letGo = () => { if (hold) clearTimeout(hold.timer); hold = null; };
  const holdOver = (x, y, el) => {
    const label = labelAt(state.article, x, y);
    const tab = label && nodeFor(label);
    if (!tab || tab.dataset.mbKind !== 'tab' || el.contains(label) || tab === shownTabOf(label.closest('.tabbed-set'))) { letGo(); return; }
    if (hold?.label === label) return;
    letGo();
    hold = { label, timer: setTimeout(() => {
      hold = null;
      if (!state || !menu.dragging || !tab.isConnected) return;
      showTab(tab.dataset.mbNode);
      window.dispatchEvent(new Event('scroll')); // the page under the pointer changed: look again
    }, TAB_HOLD) };
  };
  // While something is dragged, the page's Add card is where it is deleted
  // (asked about first: deleteDragged): red, and saying so, until the drag is over.
  let bin = null;
  let carried = null;
  const binOpen = () => {
    const card = state.bar.querySelector('.mb-kb-addnew');
    if (!card) return;
    bin = { card };
    card.classList.add('--delete');
    paintFoot();
  };
  const binShut = () => {
    if (!bin) return;
    bin.card.classList.remove('--delete', '--over');
    bin = null;
    paintFoot();
  };
  // While a section with no subsections is dragged, every other section ends
  // with a tile it can be dropped on to go under that section, as its last
  // subsection (the only place one can go without taking the blocks after it).
  // A subsection has them too (not its own section's), and the faint line
  // round its own section for as long as it is dragged: inside that line it
  // is moved among the section's subsections, outside it becomes a section.
  let nest = [];
  let frames = [];
  // The tiles take room of their own: the page is held still under the pointer.
  const holdStill = change => {
    const top = () => source()?.getBoundingClientRect().top;
    const was = top();
    change();
    const now = top();
    if (was !== undefined && now !== undefined && now !== was) window.scrollBy(0, now - was);
  };
  const nestOpen = () => {
    if (!section) return;
    const md = workingMd();
    const sections = buildSectionTree(md).sections ?? [];
    const moving = uuids.map(u => sections.find(s => s.uuid === u));
    // Subsections go no deeper: a section that has some is not put under another.
    if (moving.some(s => !s || s.level === 1 || hasH3Children(md, s.uuid))) return;
    // Subsections of one section are there already.
    const home = moving.every(s => s.level === 3 && s.parentUuid === moving[0].parentUuid) ? moving[0].parentUuid : null;
    holdStill(() => {
      for (const s of sections) {
        const heading = s.level === 2 && s.uuid !== home && !uuids.includes(s.uuid) ? nodeEl(s.uuid) : null;
        if (!heading) continue;
        const el = document.createElement('div');
        el.className = 'mb-kb-nest';
        el.innerHTML = '<span class="mb-kb-addnew__plus" aria-hidden="true"></span><span>Insert as a sub-section under "<em></em>"</span>';
        el.querySelector('em').textContent = s.title || 'Untitled';
        getLucideSvgMarkup('list-plus').then(svg => { if (svg && el.isConnected) el.firstElementChild.innerHTML = svg; }).catch(() => {});
        sectionSpan(heading)[1].after(el);
        nest.push({ el, uuid: s.uuid });
      }
    });
    // The faint line round every section it could go into (tile and all), and
    // round a subsection's own, for as long as the drag lasts: once the tiles
    // are all in, so each is measured where it will stand.
    if (menu.hints.parentElement !== state.article) state.article.append(menu.hints);
    const art = state.article.getBoundingClientRect();
    const frameRound = span => {
      const frame = document.createElement('div');
      frame.className = 'mb-kb-frame --bound';
      menu.hints.append(frame);
      placeFrame(frame, span, null, { x: art.left, y: art.top });
      frames.push(frame);
    };
    for (const t of nest) frameRound([nodeEl(t.uuid), t.el]);
    const own = sections.find(s => s.uuid === uuid);
    const parent = own?.level === 3 ? nodeEl(own.parentUuid) : null;
    if (parent) frameRound(sectionSpan(parent));
  };
  const nestShut = () => {
    frames.forEach(f => f.remove());
    frames = [];
    if (!nest.length) return;
    holdStill(() => nest.forEach(t => t.el.remove()));
    nest = [];
  };
  followDrag(e, {
    handle: document.documentElement, // the press may be out in the margin, level with the thing
    start: () => {
      menu.dragging = true;
      deactivate();
      closeSettings();
      closePanel();
      uuids = dragGroup(uuid);
      binOpen();
      nestOpen();
    },
    els: () => uuids.map(nodeEl).filter(Boolean).flatMap(runOf),
    carry: (els, press) => (carried = carryBlocks(els, press, { anchor: source(), count: uuids.length })),
    view: dragView,
    targetAt: (x, y) => {
      const el = source();
      if (!el) return null;
      if (bin && isOver(bin.card, x, y)) { letGo(); return { delete: true }; }
      const tile = nest.find(t => isOver(t.el, x, y));
      if (tile) return { nest: tile.uuid };
      if (section) return sectionTarget(state.article, y, el, uuids.length > 1);
      holdOver(x, y, el);
      const beside = o => !isUpdateEl(o);
      // A cell stays a cell: it lands beside another, or beside a block (a
      // grid of the two), and nowhere else.
      if (cell) return sideTarget(state.article, x, y, [el], beside);
      // A grid goes beside nothing: it would be a grid inside a cell.
      const grids = [el, ...others()].some(o => o.dataset.mbKind === 'grid');
      return blockTarget(state.article, x, y, el, TEXT_KIND, others(), grids ? null : beside);
    },
    over: target => {
      bin?.card.classList.toggle('--over', !!target?.delete);
      nest.forEach(t => t.el.classList.toggle('--over', t.uuid === target?.nest));
      carried?.over(!!target?.delete, !!target?.nest);
    },
    drop: target => {
      binShut(); // before the page is redrawn
      nestShut();
      if (target.delete) { deleteDragged(uuids); return; }
      const many = uuids.length > 1;
      if (target.nest) {
        // Past the end: last under its new section.
        const end = Number.MAX_SAFE_INTEGER;
        pushOp(many ? OPS.moveSectionsTo(uuids, target.nest, end) : OPS.moveSectionTo(uuid, target.nest, end), () => reveal(uuid));
        return;
      }
      const op = section
        ? (many ? OPS.moveSectionsTo(uuids, target.parentUuid, target.at) : OPS.moveSectionTo(uuid, target.parentUuid, target.at))
        : cell ? OPS.moveCellBeside(uuid, target.beside, target.side)
          : target.beside ? OPS.moveBeside(uuids, target.beside, target.side)
            : (many ? OPS.moveManyTo(uuids, target.container, target.at) : OPS.moveTo(uuid, target.container, target.at));
      pushOp(op, () => { showOwnTab(uuid); reveal(uuid); });
    },
    end: dragged => {
      letGo();
      binShut();
      nestShut();
      carried = null;
      menu.dragging = false;
      menu.hover = nodeEl(uuid) ? uuid : null;
      syncBlockMenu();
      // A press let go where it began is a click: it selects the block or the
      // section, or lets it go.
      if (!dragged) togglePicked(uuid);
    },
  });
}

// ── A press with a key held ──────────────────────────────────────────────────
// Shift: the press selects what the pointer is on, or, moved, drags it.
// Cmd / Ctrl: the click opens its menu. Either way the press is not the
// page's own: no caret is placed, no link followed, nothing folded.

let held = null; // such a press, until its click: { mode, uuid }

function onHeldDown(e) {
  held = null;
  if (!state || e.button !== 0 || state.sliding || state.markdownView) return;
  const menu = state.menu;
  let t = e.target;
  if (!(t instanceof Element) || menu.dragging || menu.el.contains(t) || !heldMode(e, t)) return;
  // The buttons beside the title, and anything pressable off the page, are still themselves.
  if (state.article.contains(t) ? t.closest('.md-content__button') : t.closest('a, button, input, select, textarea, label, summary')) return;
  // An open menu is put away first: that can apply a typed value and redraw
  // the page under the press.
  if (menu.open) {
    closeSettings();
    t = document.elementFromPoint(e.clientX, e.clientY);
    if (!t) return;
  }
  const mode = heldMode(e, t);
  const node = mode && menu.point(t, e.clientX, e.clientY, mode);
  const drag = node && menu.spec?.drag;
  if (!node || !menu.spec || (mode === 'pick' && !drag)) return;
  e.preventDefault();
  e.stopPropagation();
  const mine = held = { mode, uuid: node.dataset.mbNode };
  // Its mouse events are swallowed until the click that ends it, or a moment
  // after it is let go where no click follows (a drag).
  const done = () => {
    window.removeEventListener('pointerup', done, true);
    window.removeEventListener('pointercancel', done, true);
    setTimeout(() => { if (held === mine) held = null; }, 80);
  };
  window.addEventListener('pointerup', done, true);
  window.addEventListener('pointercancel', done, true);
  if (mode === 'pick') onPickDown(e, drag);
}

function onHeldMouse(e) {
  if (!held) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.type !== 'click') return;
  const { mode, uuid } = held;
  held = null;
  if (mode !== 'menu' || !state || state.liveView) return;
  // Text being typed somewhere else is finished first (that may redraw the page).
  if (state.active && nodeFor(state.active.el)?.dataset.mbNode !== uuid) deactivate();
  select(uuid);
  if (state.sel === uuid) openSettings();
}

// A block dropped into a tab that was showing is still in the showing tab
// after the redraw (render keeps the shown tabs); nothing to bring forward
// unless its tab is not the first and was never shown.
function showOwnTab(uuid) {
  const tab = nodeEl(uuid)?.closest('[data-mb-kind="tab"]');
  if (tab) showTab(tab.dataset.mbNode);
}

// ── Dragging a tab ───────────────────────────────────────────────────────────
// A tab's label, pressed and moved, drags the tab: along its row to a new
// place (an upright line shows where), or onto the red Delete area that shows
// at the row's right end for as long as a tab is dragged. A press let go where
// it began is still the label's own click (it shows the tab, or types into
// its title).

function onLabelDown(e) {
  if (e.button !== 0 || !state || state.liveView) return;
  const pressed = e.target instanceof Element ? e.target.closest('.tabbed-labels > label') : null;
  if (!pressed || !state.article.contains(pressed) || !pressed.dataset.mbUuid) return;
  // Typing in this title already: the press places the caret or selects text.
  if (state.active?.el === pressed) return;
  const uuid = pressed.dataset.mbUuid;
  // The page may be redrawn as the drag starts: the label is found again by its identity.
  const label = () => state.article.querySelector(`.tabbed-labels > label[data-mb-uuid="${CSS.escape(uuid)}"]`);
  const setOf = () => label()?.closest('.tabbed-set') ?? null;
  const menu = state.menu;
  let zone = null;
  let carried = null;
  // What the tab is showing, when it is the one showing: drawn into the label as it is taken.
  const pieces = () => {
    const tab = nodeEl(uuid);
    const set = tab?.closest('.tabbed-set');
    if (!set || tab.dataset.mbKind !== 'tab' || shownTabOf(set) !== tab) return [];
    return [...tab.children].filter(el => el instanceof HTMLElement && el.offsetHeight > 0);
  };
  followDrag(e, {
    handle: state.article,
    start: () => {
      menu.dragging = true;
      deactivate();
      closeSettings();
      closePanel();
      window.getSelection()?.removeAllRanges();
      zone = tabZone(setOf());
      // The click that ends this press is not the label's: the tab was dragged.
      const swallow = ev => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener('click', swallow, true);
      // It is swallowed until the pointer is let go (which may be after an
      // Escape ended the drag), and a moment more for the click that follows.
      const done = () => {
        window.removeEventListener('pointerup', done, true);
        window.removeEventListener('pointercancel', done, true);
        setTimeout(() => window.removeEventListener('click', swallow, true), 80);
      };
      window.addEventListener('pointerup', done, true);
      window.addEventListener('pointercancel', done, true);
    },
    els: () => [label()].filter(Boolean),
    carry: ([el], press) => (carried = el ? carryTab(el, press, pieces()) : null),
    view: dragView,
    targetAt: (x, y) => {
      const set = setOf();
      return set ? tabTarget(set, x, y, label(), zone) : null;
    },
    over: target => {
      zone?.classList.toggle('--over', !!target?.delete);
      carried?.over(!!target?.delete);
    },
    drop: target => { if (target.delete) deleteDraggedTab(uuid); else moveTab(uuid, target.at); },
    end: () => {
      zone?.remove();
      zone = null;
      carried = null;
      menu.dragging = false;
      syncBlockMenu();
    },
  });
}

// The Delete area: at the right end of the label row, for as long as a tab is dragged.
function tabZone(set) {
  const row = set?.querySelector(':scope > .tabbed-labels');
  if (!row) return null;
  const zone = document.createElement('div');
  zone.className = 'mb-kb-tabzone';
  zone.innerHTML = '<span class="mb-kb-tabzone__icon" aria-hidden="true"></span><span>Delete tab</span>';
  zone.style.height = `${row.offsetHeight}px`;
  getLucideSvgMarkup('trash-2').then(svg => { if (svg) zone.querySelector('.mb-kb-tabzone__icon').innerHTML = svg; }).catch(() => {});
  set.append(zone);
  return zone;
}

/** A tab taken to place `at` among its group's labels as they stand before the move. */
function moveTab(uuid, at) {
  pushOp(OPS.editChildren('tab', uuid, (list, i) => {
    const to = at > i ? at - 1 : at;
    if (to !== i) list.splice(to, 0, ...list.splice(i, 1));
  }), () => { showTab(uuid); select(uuid); });
}

// A tab dropped on the Delete area. It is asked about first, holding
// something or not (Undo brings it back all the same); the last tab of a
// group takes the group with it.
async function deleteDraggedTab(uuid) {
  const md = workingMd();
  const owner = findOwner(md, 'tab', uuid);
  if (!owner) return;
  const tabs = owner.component.grp.tabs;
  const i = owner.childIndex;
  const holds = tab => (readContainer(md, { kind: TEXT_KIND.tab, uuid: tab.uuid })?.components ?? [])
    .some(c => c.kind !== 'text' || c.txt.body.trim());
  const whole = tabs.length === 1;
  const title = state.article.querySelector(`.tabbed-labels > label[data-mb-uuid="${CSS.escape(uuid)}"]`)?.textContent.trim();
  const full = holds(tabs[i]);
  const ask = whole ? `Delete these content tabs${full ? ' and everything in them' : ''}?`
    : `Delete ${title ? `'${title}'` : 'this tab'}${full ? ' and everything in it' : ''}?`;
  if (!(await confirmDelete(ask))) return;
  if (!state || workingMd() !== md) return; // the page moved on behind the question
  if (whole) {
    pushOp(OPS.deleteComponent(owner.component.grp.uuid));
    return;
  }
  const next = tabs[i + 1]?.uuid ?? tabs[i - 1]?.uuid ?? null;
  pushOp(OPS.editChildren('tab', uuid, (list, at) => { list.splice(at, 1); }), () => { if (next) { showTab(next); select(next); } });
}

/** A yes or no before something is deleted. Cancel is the easy answer. `yes` names the button that deletes. */
function confirmDelete(text, yes = 'Delete') {
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = 'mb-kb-typed mb-kb-confirm';
    dlg.innerHTML = `
      <form method="dialog">
        <p class="mb-kb-confirm__text">${esc(text)}</p>
        <div class="mb-kb-typed__foot">
          <button type="button" class="mb-kb-typed__btn" value="cancel">Cancel</button>
          <button type="submit" class="mb-kb-typed__btn --danger" value="ok">${esc(yes)}</button>
        </div>
      </form>`;
    let over = false;
    const finish = yes => {
      if (over) return;
      over = true;
      try { dlg.close(); } catch { /* closed already */ }
      dlg.remove();
      resolve(yes);
    };
    dlg.querySelector('[value="cancel"]').addEventListener('click', () => finish(false));
    dlg.querySelector('form').addEventListener('submit', e => { e.preventDefault(); finish(true); });
    dlg.addEventListener('close', () => finish(false)); // Escape
    document.body.append(dlg);
    dlg.showModal();
    dlg.querySelector('[value="cancel"]').focus();
  });
}

function removeComponent(uuid) {
  pushOp(OPS.deleteComponent(uuid));
}


// A section runs from its heading to the next heading that is not inside it.
// The page title's own run stops at the first section.
function sectionSpan(heading) {
  const level = Number(heading.tagName[1]);
  let last = heading;
  for (let n = heading.nextElementSibling; n; n = n.nextElementSibling) {
    if (n.matches('.md-tags, .mb-kb-foot')) break;
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
  // Hidden, with a title placed in the content: it stays hidden until that one is deleted.
  if (sec.level === 1 && hideTitle && findPageTitle(md)) {
    return { label: 'Page title', span, fields: [{ kind: 'note', text: 'Hidden on the site: this page shows the title placed in its content. Delete that one to show this title again.' }] };
  }
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
        { icon: 'trash-2', label: 'Delete', danger: true, run: () => { pushOp(OPS.deleteSection(uuid)); } },
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
      // Its types as pills, each a small copy of its admonition (kbTypePicker.js).
      { kind: 'types', label: 'Type', options: isUpdateType(adm.type) ? UPDATE_TYPES : Object.entries(ADMONITION_TYPE_LABELS), value: adm.type,
        set: type => setAdmonitionType(uuid, type) },
      { kind: 'text', label: 'Meta', value: splitTitleMeta(adm.title ?? '').meta, placeholder: 'Muted note after the title, e.g. (optional)',
        set: v => edit(uuid, c => { c.adm.title = joinTitleMeta(splitTitleMeta(c.adm.title ?? '').title, v.trim().replace(/"/g, "'")); }) },
      pills('Collapsible', COLLAPSIBLE, adm.prefix, prefix => edit(uuid, c => { c.adm.prefix = prefix; })),
      actions(md, hit),
    ],
  };
}

const setAdmonitionType = (uuid, type) => edit(uuid, c => {
  // An update's title carries its type's name.
  if (isUpdateType(c.adm.type) && isUpdateType(type)) {
    const { title, date } = splitUpdateTitle(c.adm.type, c.adm.title);
    c.adm.type = type;
    c.adm.title = joinUpdateTitle(type, title, date);
    return;
  }
  c.adm.type = type;
  // A step numbers itself: it keeps its meta but takes no title.
  if (type === 'step') c.adm.title = joinTitleMeta('', splitTitleMeta(c.adm.title ?? '').meta);
});


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
        { icon: 'arrow-left', label: 'Move left', off: i === 0, run: () => shift(-1) },
        { icon: 'arrow-right', label: 'Move right', off: i >= tabs.length - 1, run: () => shift(1) },
        { icon: 'panel-top-close', label: 'Delete tab', danger: true, run: () => {
          const next = tabs[i + 1]?.uuid ?? tabs[i - 1]?.uuid ?? null;
          change((list, at) => { list.splice(at, 1); }, () => { if (next) { showTab(next); select(next); } });
        } },
      ] },
      { kind: 'heading', text: 'Content tabs' },
      actions(md, owner),
    ],
  };
}

/** A new tab at the end of a group (the ghost "New tab" ending its label row): shown, its title ready to type. */
function addTabTo(groupUuid) {
  const tabs = findComponent(workingMd(), groupUuid)?.component.grp?.tabs ?? [];
  const last = tabs[tabs.length - 1];
  if (!last?.uuid) return;
  const tab = newTab(`Tab ${tabs.length + 1}`);
  pushOp(OPS.editChildren('tab', last.uuid, list => { list.push(tab); }), () => {
    showTab(tab.uuid);
    select(tab.uuid);
    editPiece(`[data-mb-edit="tab-title"][data-mb-uuid="${tab.uuid}"]`, true);
  });
}

// Blocks standing side by side are in the columns of a row (on the page, a
// Zensical grid and its cells). Neither is drawn, selected or moved: a row is
// made by dropping a block beside another (kbPageDrag sideTarget) and goes
// when its blocks no longer stand side by side. What can be set on them is
// reached from any block standing in the row, and from the row's empty space.

function rowFields(md, hit) {
  const uuid = hit.component.grid.uuid;
  return [
    { kind: 'heading', text: 'Grid' },
    pills('Style', [['generic', 'Plain'], ['card', 'Cards']], hit.component.grid.flavor === 'card' ? 'card' : 'generic',
      flavor => edit(uuid, c => { c.grid.flavor = flavor; })),
  ];
}

function columnFields(md, cellUuid) {
  const owner = findOwner(md, 'cell', cellUuid);
  if (!owner) return [];
  const cell = owner.component.grid.cells[owner.childIndex];
  const change = fn => pushOp(OPS.editChildren('cell', cellUuid, fn));
  return [
    { kind: 'heading', text: 'Cell' },
    pills('Vertical alignment', VALIGN, cell.valign ?? 'default', v => change((list, at) => { list[at].valign = v; })),
    pills('Allow spill', YES_NO, cell.spill ? 'yes' : 'no', v => change((list, at) => { list[at].spill = v === 'yes'; })),
    ...rowFields(md, owner),
  ];
}

// A cell's own empty space (the gaps between its blocks, the room under them):
// the cell's and the grid's settings, and the cell deleted with what it holds.
function columnSettings(md, cellUuid, el) {
  const fields = columnFields(md, cellUuid);
  if (!fields.length) return null;
  fields.splice(3, 0, { kind: 'buttons', label: 'Actions', items: [
    { icon: 'trash-2', label: 'Delete', danger: true, run: () => { pushOp(OPS.deleteCell(cellUuid)); } },
  ] });
  return { label: 'Cell', span: [el, el], fields };
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
  const lang = languageOptions(cb.language ?? '');
  // Annotations sit in the language's comments: with any on the block, the
  // languages that have no comments cannot be picked.
  const off = hasAnnotationMarker(cb.code)
    ? Object.fromEntries(lang.options.filter(([v]) => NO_COMMENT_LANGS.has(v))
      .map(([v, text]) => [v, `${text} has no comments to hold annotations: remove the annotations first`]))
    : {};
  return {
    label: 'Code block',
    fields: [
      { ...pills('Language', lang.options, lang.value, v => edit(uuid, c => { CODE.setLanguage(c.cb, v); })), off },
      { kind: 'text', label: 'Title', value: cb.title, placeholder: 'Optional — e.g. bubble_sort.py',
        set: v => edit(uuid, c => { c.cb.title = v.trim().replace(/"/g, "'"); }) },
      pills('Line numbers', [['off', 'Off'], ['on', 'On']], cb.linenums ? 'on' : 'off',
        v => edit(uuid, c => { c.cb.linenums = v === 'on' ? c.cb.linenums || '1' : ''; })),
      cb.linenums && { kind: 'number', label: 'First line number', value: cb.linenums, placeholder: '1',
        set: v => edit(uuid, c => { c.cb.linenums = String(Math.max(1, parseInt(v, 10) || 1)); }) },
      { kind: 'text', label: 'Highlighted lines', value: cb.hlLines, placeholder: 'Optional — e.g. 2 3 or 3-5',
        set: v => edit(uuid, c => { c.cb.hlLines = v.trim().replace(/[^\d\s-]/g, ''); }) },
      actions(md, hit),
    ].filter(Boolean),
  };
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
      { kind: 'icon', label: 'Icon', hint: '(optional)', value: (btn.icon ?? '').replace(/^lucide\//, ''), placeholder: 'Search icons, e.g. arrow-right',
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

const shownImg = el => (el?.matches('img') ? el : el?.querySelector('img')) ?? null;

function mediaSettings(md, hit) {
  const kind = hit.component.kind;
  const key = MEDIA_FIELD[kind];
  const noun = MEDIA_NOUN[kind];
  if (!key) return null;
  const m = hit.component[key];
  const uuid = m.uuid;
  // Theme means nothing without a light and dark pair (images, single videos).
  const paired = kind === 'capture' || !!m.darkFilename;
  // A capture is one of four kinds (capturePresets.js), read from the size
  // and corners it already has. Only Custom shows those two to be set by
  // hand; one picked as Custom stays Custom for this edit even while its
  // values happen to be a preset's.
  const preset = kind !== 'capture' ? null
    : state.customCaptures.has(uuid) ? 'custom' : capturePresetOf(m);
  const byHand = !preset || preset === 'custom';
  return {
    label: titleCase(noun),
    fields: [
      preset && pills('Size', CAPTURE_PRESETS, preset, v => {
        if (v === 'custom') state.customCaptures.add(uuid); else state.customCaptures.delete(uuid);
        // Custom has no Auto of its own: one that was Auto starts at the width it is shown.
        const shown = v === 'custom' && (m.dimMode ?? 'none') === 'none'
          ? Math.round(shownImg(nodeEl(uuid))?.getBoundingClientRect().width || 0) || 400 : 0;
        edit(uuid, c => {
          applyCapturePreset(c.cap, v);
          if (shown) Object.assign(c.cap, { dimMode: 'width', dimValue: shown });
        });
      }),
      byHand && { kind: 'size', label: 'Dimension', mode: m.dimMode ?? 'none', value: m.dimValue, noAuto: !!preset,
        set: (mode, value) => edit(uuid, c => {
          c[key].dimMode = mode;
          c[key].dimValue = mode === 'none' ? null : Math.max(1, parseInt(value, 10) || 300);
        }) },
      kind === 'video' && pills('Playback', [['animation', 'Animation'], ['clip', 'Clip']], m.playback === 'clip' ? 'clip' : 'animation',
        v => edit(uuid, c => { c.vid.playback = v; })),
      byHand && pills('Corner rounding', [['disabled', 'Disabled'], ['enabled', 'Enabled']], m.rounded ? 'enabled' : 'disabled',
        v => edit(uuid, c => { c[key].rounded = v === 'enabled'; })),
      paired && pills('Theme', [['default', 'Default'], ['inversed', 'Inversed']], m.inversed ? 'inversed' : 'default',
        v => edit(uuid, c => { c[key].inversed = v === 'inversed'; })),
      { kind: 'buttons', label: titleCase(noun), items: [
        { icon: 'replace', label: `Choose a different ${noun}`, run: () => {
          closeSettings();
          openPicker(kind, nodeEl(uuid), pick => edit(uuid, c => { Object.assign(c[key], mediaFiles(kind, pick)); }));
        } },
        // The file's own page in the admin area: where it is used, recapture,
        // replace. A new tab, so the draft and its unsaved edits stay put.
        { icon: 'images', label: 'Open in media library', run: () => {
          closeSettings();
          window.open(mediaEntryUrl(mediaEntryKey(m.lightFilename || m.filename || m.darkFilename || '')), '_blank', 'noopener');
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
    return {
      mode: 'rich',
      value: (block?.txt?.body ?? '').trim(),
      placeholder: 'Click / to insert',
      commit: v => typeOp(OPS.putText(uuid, v.trim(), container, at)),
      html: v => renderTextHtml(v.trim(), { assetUrl }),
      done: (fresh, v) => fresh.classList.toggle('--empty', !v.trim()),
      // A place that now holds a block, or a block emptied away: the page is
      // drawn again so what stands there is what the draft holds.
      redrawIf: v => place || !v.trim(),
    };
  }

  if (el.matches('h1, h2, h3') && !el.dataset.mbEdit) {
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
      html: v => renderInlineHtml(titleOf(v), { assetUrl }),
    };
  }

  const uuid = el.dataset.mbUuid;
  switch (el.dataset.mbEdit) {
    case 'adm-title': {
      const adm = findComponent(md, uuid)?.component.adm;
      if (!adm) return null;
      if (isUpdateType(adm.type)) {
        // An update's own title: plain words after the type's name, required
        // (it may stand empty while the page is open, not once it is saved).
        return {
          mode: 'plain',
          value: splitUpdateTitle(adm.type, adm.title).title,
          placeholder: UPDATE_TITLE_PLACEHOLDER,
          commit: v => typeOp(OPS.editComponent(uuid, c => {
            c.adm.title = joinUpdateTitle(c.adm.type, v, splitUpdateTitle(c.adm.type, c.adm.title).date);
          }, `adm-title|${uuid}`)),
          html: v => renderInlineHtml(oneLine(v).replace(/"/g, "'"), { assetUrl }),
        };
      }
      const fallback = ADMONITION_TYPE_LABELS[adm.type] ?? adm.type;
      return {
        mode: 'inline',
        buttons: ['label', 'icon', 'clear'],
        value: splitTitleMeta(adm.title ?? '').title,
        placeholder: fallback,
        commit: v => typeOp(OPS.editComponent(uuid, c => {
          c.adm.title = joinTitleMeta(plainQuotes(oneLine(v)), splitTitleMeta(c.adm.title ?? '').meta);
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
    case 'page-title': {
      // The placed page title: plain words, never blank (emptied, it goes back to what it was).
      const was = readPageTitle(findComponent(md, uuid)?.component.txt?.body);
      if (was == null) return null;
      const titleOf = v => oneLine(v) || was;
      return {
        mode: 'plain',
        value: was,
        commit: v => typeOp(OPS.putText(uuid, pageTitleBody(titleOf(v)))),
        html: v => esc(titleOf(v)),
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
      // The value is the code itself, markers and all (kbCode.js reads them
      // out of the bubbles). Highlighted lines follow their lines as it is typed.
      const lang = cb.language ?? '';
      const pre = el.closest('pre');
      return {
        mode: 'code',
        value: cb.code ?? '',
        read: () => fromModel(readModel(el), lang),
        commit: v => {
          // A line of ``` would end the block early.
          const code = v.replace(/^(\s*)```/gm, "$1'''");
          typeOp(OPS.editComponent(uuid, c => { c.cb.hlLines = shiftHlLines(c.cb.hlLines, c.cb.code, code); c.cb.code = code; }, `code|${uuid}`));
          if (pre) { paintHl(pre, hlLineSet(shiftHlLines(cb.hlLines, cb.code, code))); paintNums(pre, lineCount(code)); }
        },
        html: v => codeInnerHtml(v),
      };
    }
    case 'annotation': {
      const cb = findComponent(md, uuid)?.component.cb;
      if (!cb) return null;
      // One in its bubble's tooltip is rich text, as on the live page; one no
      // marker points at is listed under the block, as before.
      const inTip = !!el.closest('.mb-kb-anntip');
      const ended = () => { if (inTip) closeAnnTips(); };
      // A bubble just added: nothing is in the draft until something is typed.
      if (el.dataset.mbNewLine != null) {
        const line = Number(el.dataset.mbNewLine);
        return {
          mode: 'rich',
          value: '',
          placeholder: 'Annotation text',
          commit: v => typeOp(OPS.editComponent(uuid, c => { CODE.addAnnotation(c.cb, v.trim(), line); }, `annadd|${uuid}|${line}`)),
          html: v => renderTextHtml(v.trim(), { assetUrl }),
          redrawIf: () => true,
          ended: () => { ended(); if (state.article.querySelector('.mb-kb-ann[data-mb-new]')) render(); },
        };
      }
      const index = Number(el.dataset.mbIndex);
      if (cb.annotations?.[index] == null) return null;
      return {
        mode: inTip ? 'rich' : 'source',
        value: cb.annotations[index],
        placeholder: 'Annotation text',
        commit: v => typeOp(OPS.editComponent(uuid, c => { CODE.setAnnotation(c.cb, index, v.trim()); }, `annotation|${uuid}|${index}`)),
        html: v => (inTip ? renderTextHtml(v.trim(), { assetUrl }) : annotationHtml(v)),
        redraw: true, // an emptied annotation takes its marker out of the code
        ended,
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

// ── Code blocks: bubbles and the line buttons (kbCode.js) ────────────────────

const codeEl = uuid => state.article.querySelector(`[data-mb-edit="code"][data-mb-uuid="${CSS.escape(uuid)}"]`);

/** What the line buttons need to know about a code block, as it stands now. */
function codeInfo(uuid) {
  const cb = findComponent(workingMd(), uuid)?.component.cb;
  if (!cb) return null;
  const lang = (cb.language ?? '').trim().toLowerCase();
  return {
    lines: lineCount(cb.code),
    filled: filledLines(cb.code),
    annLines: markerLines(cb.code),
    hl: hlLineSet(cb.hlLines),
    canAnnotate: !NO_COMMENT_LANGS.has(lang),
    noAnnotateTip: lang ? `${cb.language} has no comments to hold an annotation: pick a language like bash or python` : 'Set a language first (like bash or python): annotations sit in its comments',
  };
}

/**
 * A control on a code block that is being typed into: the edit is made (and
 * the page redrawn), then the caret is put back where it was. The line
 * buttons are shown on `line` again, under the pointer.
 */
function keepCodeCaret(uuid, change, line) {
  const a = state.active;
  const at = a?.mode === 'code' && a.el.dataset.mbUuid === uuid ? caretOffset(a.el) : null;
  change();
  if (at != null) {
    const el = codeEl(uuid);
    if (el && activate(el)) { el.focus({ preventScroll: true }); placeCaret(el, at); }
  }
  state.codeHover.reshow(uuid, line);
}

/** Opens a bubble's tooltip: its text is typed there (only read on the live content). */
function openAnnotation(bubble) {
  const uuid = bubble.closest('[data-mb-code]')?.dataset.mbCode;
  if (!uuid) return;
  if (bubble.classList.contains('--open')) {
    // Pressed again: it closes.
    if (state.active?.el.closest('.mb-kb-anntip')) deactivate(); else closeAnnTips();
    return;
  }
  const index = Number(bubble.dataset.mbAnn);
  const newLine = bubble.dataset.mbNew;
  // Ending the edit in progress redraws what it was in: the bubble is found again.
  if (state.active) {
    deactivate();
    if (!bubble.isConnected) bubble = state.article.querySelector(`[data-mb-code="${CSS.escape(uuid)}"] .mb-kb-ann[data-mb-ann="${index}"]`);
    if (!bubble) return;
  }
  const cb = findComponent(shownMd(), uuid)?.component.cb;
  if (!cb) return;
  state.codeHover.hide();
  const inner = openAnnTip(bubble, newLine != null ? '' : renderTextHtml(String(cb.annotations?.[index] ?? '').trim(), { assetUrl }));
  paintInlineAtoms(inner);
  if (state.liveView) return;
  inner.dataset.mbEdit = 'annotation';
  inner.dataset.mbUuid = uuid;
  if (newLine != null) inner.dataset.mbNewLine = newLine; else inner.dataset.mbIndex = String(index);
  if (!editPiece(inner)) closeAnnTips();
}

/**
 * The line button's Add annotation: a bubble at the end of the line, its
 * tooltip open to type into. It is only in the draft once something is typed.
 */
function addAnnotationAt(uuid, line) {
  deactivate();
  const el = codeEl(uuid);
  const cb = findComponent(workingMd(), uuid)?.component.cb;
  if (!el || !cb) return;
  const lines = toModel(cb.code).split('\n');
  if (line < 0 || line >= lines.length) return;
  const index = lines.slice(0, line).join('\n').split(ANN).length - 1 + (lines[line].split(ANN).length - 1);
  lines[line] += ANN;
  el.innerHTML = modelHtml(lines.join('\n'));
  const bubbles = [...el.querySelectorAll('.mb-kb-ann')];
  // The ones after it keep the numbers their annotations have.
  bubbles.slice(index + 1).forEach(b => { b.dataset.mbAnn = String(Number(b.dataset.mbAnn) - 1); });
  const bubble = bubbles[index];
  if (!bubble) return;
  bubble.dataset.mbNew = String(line);
  bubble.dataset.mbAnn = '-1';
  state.codeHover.reshow(uuid, line);
  openAnnotation(bubble);
  const warning = langWarningFor(cb.language);
  if (warning) setStatus(state.status, warning, { hideAfter: 6000 });
}

/** The line button's Remove annotation, once it is confirmed. */
async function removeAnnotationAt(uuid, line, ann) {
  if (!(await confirmDelete('Delete this annotation? Its text is deleted with it.'))) return;
  if (!state) return;
  keepCodeCaret(uuid, () => edit(uuid, c => { CODE.removeAnnotation(c.cb, ann); }), line);
}

function caretToEnd(el) {
  const sel = window.getSelection();
  sel?.selectAllChildren(el);
  sel?.collapseToEnd();
}

/** Start editing a piece. False when it cannot be edited. */
function activate(el) {
  if (state.liveView || state.sliding) return false; // the live content is only read
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
  } else if (piece.mode === 'code') {
    el.innerHTML = codeInnerHtml(piece.value);
    el.contentEditable = 'plaintext-only';
    el.spellcheck = false;
    const changed = () => {
      active.value = piece.read();
      active.changed = true;
      piece.commit(active.value);
    };
    guardBubbles(el, changed);
    el.addEventListener('input', changed);
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
    if (e.key === 'Tab' && (piece.mode === 'source' || piece.mode === 'code') && !e.shiftKey) { e.preventDefault(); document.execCommand('insertText', false, '  '); }
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
    a.ended?.();
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
  if (fresh.matches('h1')) paintTitlePill();
  a.ended?.();
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
  // Starting to type grows it (its empty line is drawn): brought into view
  // again once that is laid out, the text being typed into last, so a block
  // taller than the window keeps the caret in sight.
  requestAnimationFrame(() => {
    if (!node.isConnected) return;
    node.scrollIntoView({ block: 'nearest' });
    if (state?.active?.el?.isConnected && node.contains(state.active.el)) state.active.el.scrollIntoView({ block: 'nearest' });
  });
}

// ── Adding ───────────────────────────────────────────────────────────────────
// Every place a component can go has an unseen marker in the page
// (`.mb-kb-insert`, from kbPageRender): it names the place, and what is being
// added (a new line of text, the media library, the paste box) is drawn at it.

/**
 * The add menu for one place on the page. `target` is { kind, uuid, at }
 * (a container and a component index), or null on a page with no section to
 * insert into; `section` adds "Section". `place` is the element the addition
 * is drawn at (the place's marker; the menu's anchor without one).
 */
async function openInsertMenu(anchor, target, section = false, place = anchor) {
  const { tabs, hasLast } = target ? await webappTabs() : { tabs: [], hasLast: false };
  if (!state || !anchor.isConnected) return; // the page moved on while the tabs were read
  const items = [];
  if (section) items.push({ id: 'section', label: 'Section' });
  if (section && target) items.push({ divider: true });
  if (target) items.push(...INSERT_ITEMS.map(item => (item.id === 'capture' ? captureMenuItem(tabs, hasLast) : item)));
  // A title for the page, placed here: only while the page's own is hidden
  // and none is placed yet (a page has one title).
  if (target && canPlacePageTitle(workingMd())) items.splice(items.findIndex(i => i.id === 'text') + 1, 0, { id: 'pagetitle', label: 'Page title' });
  openPopupMenu(anchor, items, id => pickInsert(id, target, place, anchor));
}

function pickInsert(id, target, place, anchor = place) {
  if (id === 'section') { addSection(null, 2); return; }
  const tabPick = captureTabPick(id);
  if (tabPick) { startCapture(tabPick.tabId, target, !!tabPick.reopen); return; }
  if (!place.isConnected) return; // the page was redrawn under the open menu
  if (id === 'text') { startText(target, place); return; }
  const container = { kind: target.kind, uuid: target.uuid };
  const insert = (components, focus = true) => {
    const first = uuidOfComponent(components[0]);
    pushOp(OPS.insertComponents(container, target.at, components), () => {
      select(first);
      if (focus) focusInto(first); else reveal(first);
    });
  };
  if (MEDIA_FIELD[id]) {
    openPicker(id, place, pick => insert([mediaComponent(id, pick)], false));
    return;
  }
  if (id === 'paste') {
    // Headings in what is pasted become sections of their own, which only a
    // section can be followed by.
    openPastePanel(anchor.isConnected ? anchor : place, text => readPaste(text, target), pasted => {
      pasteInto(target, pasted, added => { if (added.length) { select(added[0]); reveal(added[0]); } });
    });
    return;
  }
  if (id === 'pagetitle') { insert([newPageTitle()]); return; }
  const component = newComponent(id);
  if (!component) return;
  insert([component], id !== 'navlinks');
  // Nav links are nothing until told what to list: ask straight away.
  if (id === 'navlinks' && state.sel === component.nav.uuid) openSettings();
}

// ── A new capture, taken on the webapp ───────────────────────────────────────
// The thing to capture is in another tab. The service worker arms capture
// mode there and switches to it (background.js kbCaptureStart); its dialog's
// Insert pushes the files, comes back here and hands the capture over
// (kbCaptureDeliver), where it joins the draft like any other addition.

// The webapp tabs open right now, and whether there is a last-captured page
// to reopen ({ tabs, hasLast }). Never holds the menu up: no answer, no tabs.
function webappTabs() {
  return new Promise(done => {
    const resolve = res => done({ tabs: res?.tabs ?? [], hasLast: !!res?.hasLast });
    const giveUp = setTimeout(() => resolve(null), 500);
    try {
      chrome.runtime.sendMessage({ type: 'kbCaptureTabs' }, res => {
        void chrome.runtime.lastError;
        clearTimeout(giveUp);
        resolve(res);
      });
    } catch {
      clearTimeout(giveUp);
      resolve(null); // the extension was reloaded under this page
    }
  });
}

// Ask the service worker something about the capture this draft waits on.
function captureAsk(type, extra = {}) {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage({ type, ...extra }, res => {
        void chrome.runtime.lastError;
        resolve(res ?? null);
      });
    } catch {
      resolve(null); // the extension was reloaded under this page
    }
  });
}

/**
 * `tabId` null opens a new webapp tab (`reopen`: on the page the last capture
 * was taken from). `target` is where the capture will go.
 */
async function startCapture(tabId, target, reopen = false) {
  if (state.captureWait) {
    setStatus(state.status, 'A capture is already in progress. Finish or cancel it first.', { tone: 'error', hideAfter: 5000 });
    return;
  }
  deactivate();
  const token = generateUUID();
  state.captureWait = { token, target, strikes: 0, split: true };
  drawCaptureWait();
  showCaptureWait();
  const res = await captureAsk('kbCaptureStart', { tabId, token, reopen, frozen: !!state.updates });
  if (state?.captureWait?.token !== token) return;
  if (res?.ok) { setCaptureSplit(!!res.split); watchCapture(); return; }
  endCaptureWait();
  setStatus(state.status, res?.error || 'Could not start capture mode. Reload this page and try again.', { tone: 'error', hideAfter: 7000 });
}

// The capture is over (inserted, dismissed, cancelled, or its tab is gone).
function endCaptureWait() {
  clearTimeout(captureWatch);
  if (!state) return;
  state.captureWait = null;
  state.article.querySelector('.mb-kb-capwait')?.remove();
  placeCaptureVeil();
}

// While a capture is awaited, keep asking whether it is still going: capture
// mode can end with no word back (a reload, the tab closed or sent elsewhere).
// One doubtful answer is forgiven (the tab may be between two pages).
let captureWatch = null;
function watchCapture(delay = 2000) {
  clearTimeout(captureWatch);
  if (state?.captureWait?.inserting) return; // the capture is in hand: nothing left to watch
  captureWatch = setTimeout(async () => {
    const wait = state?.captureWait;
    if (!wait) return;
    const res = await captureAsk('kbCaptureCheck', { token: wait.token });
    if (state?.captureWait !== wait) return;
    wait.strikes = res?.alive && !res.unsure ? 0 : wait.strikes + (res?.alive === false ? 2 : 1);
    if (wait.strikes >= 4) { endCaptureWait(); return; }
    if (res?.alive) setCaptureSplit(!!res.split);
    watchCapture();
  }, delay);
}

// Whether the capturing tab stands beside this one in a split view. While it
// does there is nothing to click for: the hint shows only when it does not.
function setCaptureSplit(split) {
  const wait = state?.captureWait;
  if (!wait) return;
  wait.split = split;
  const hint = state.article.querySelector('.mb-kb-capwait__hint');
  if (hint) hint.hidden = split;
}

// Coming back to this tab is when the two have most likely been parted: ask now.
globalThis.addEventListener?.('focus', () => { if (state?.captureWait) watchCapture(0); });
globalThis.document?.addEventListener('visibilitychange', () => {
  if (!document.hidden && state?.captureWait) watchCapture(0);
});

// The placeholder: a box standing where the capture will go, for as long as
// another tab is taking it. Clicking it brings that tab back beside this one;
// its red end calls the capture off. Drawn again after every redraw.
function drawCaptureWait() {
  const wait = state?.captureWait;
  state?.article.querySelector('.mb-kb-capwait')?.remove();
  if (!wait) { placeCaptureVeil(); return; }
  const el = document.createElement('div');
  el.className = 'mb-kb-capwait';
  el.contentEditable = 'false';
  el.innerHTML = `<button type="button" class="mb-kb-capwait__main" title="Show the tab that is capturing"><span class="more-buttons-icon more-buttons-icon--spin">loader-circle</span><span class="mb-kb-capwait__text"><strong>Capture in progress</strong><span class="mb-kb-capwait__hint">Click to continue capture</span></span></button><button type="button" class="mb-kb-capwait__cancel" aria-label="Cancel this capture"><span class="more-buttons-icon">x</span><span class="mb-kb-capwait__cancel-label">Cancel</span></button>`;
  const hintEl = el.querySelector('.mb-kb-capwait__hint');
  if (hintEl) hintEl.hidden = wait.split;
  if (wait.inserting) {
    // The capture has come back: a moment's notice of where it is about to
    // land. Nothing to click, nothing to cancel.
    el.classList.add('--inserting');
    el.querySelector('strong').textContent = 'Inserting capture';
    el.querySelector('.mb-kb-capwait__hint').remove();
    el.querySelector('.mb-kb-capwait__cancel').remove();
    el.querySelector('.mb-kb-capwait__main').disabled = true;
  }
  el.querySelector('.mb-kb-capwait__main').addEventListener('click', () => { captureAsk('kbCaptureFocus', { token: wait.token }); });
  el.querySelector('.mb-kb-capwait__cancel')?.addEventListener('click', () => {
    endCaptureWait();
    captureAsk('kbCaptureCancel', { token: wait.token });
  });
  const target = captureTarget(wait.target);
  const slot = target && [...state.article.querySelectorAll(`.mb-kb-insert[data-mb-insert-kind="${target.kind}"]`)]
    .find(s => s.dataset.mbInsertUuid === target.uuid && Number(s.dataset.mbInsertAt) === target.at);
  if (slot) slot.before(el);
  else (state.article.querySelector('.mb-kb-foot') ?? state.article.lastElementChild)?.before(el);
  placeCaptureVeil();
}

// Bring the placeholder into view (to the middle of the window) when it is
// not wholly there: under the header, or off either end.
function showCaptureWait() {
  const el = state?.article.querySelector('.mb-kb-capwait');
  if (!el) return;
  const box = el.getBoundingClientRect();
  const header = document.querySelector('.md-header')?.getBoundingClientRect();
  const top = Math.max(0, header && header.top <= 0 ? header.bottom : 0);
  if (box.top >= top && box.bottom <= viewBottom()) return;
  const calm = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
}

// While a capture is awaited the page steps back round its placeholder, as it
// does round the thing a block's menu is for (the same wash and blur). It gives
// way to a menu's own veil, and goes when the placeholder does (the capture is
// over, or the live content is showing).
let captureVeil = null;
function placeCaptureVeil() {
  const el = state?.captureWait ? state.article.querySelector('.mb-kb-capwait') : null;
  if (!el) { captureVeil?.hide(); return; }
  captureVeil ??= createVeil({ yields: true });
  // The block the capture is going into (an admonition, a tab group, a grid)
  // stays clear with it, as a block's menu's own thing does; one going straight into
  // a section leaves only the placeholder clear.
  let host = el.parentElement?.closest('[data-mb-node]') ?? null;
  if (host?.dataset.mbKind === 'tab') host = host.closest('[data-mb-kind="tabs"]') ?? host;
  if (host?.dataset.mbKind === 'cell') host = host.closest('[data-mb-kind="grid"]') ?? host;
  if (host && (isSectionEl(host) || !state.article.contains(host))) host = null;
  const box = (host ?? el).getBoundingClientRect();
  const pad = host ? PICK_PAD : 0;
  captureVeil.show({ left: box.left - pad, top: box.top - pad, width: box.width + pad * 2, height: box.height + pad * 2 }, host ? '8px' : '10px');
}

// Where an awaited capture goes: the place it was asked for from, if that
// container is still on the page (the draft may have been edited meanwhile),
// else the end of the page.
function captureTarget(target) {
  const container = { kind: target.kind, uuid: target.uuid };
  const count = readContainer(workingMd(), container)?.components.length;
  if (count == null) return lastSectionTarget();
  return { ...container, at: Math.max(0, Math.min(target.at, count)) };
}

/** True when this draft was waiting for that capture (and took it, if there is one). */
function receiveCapture({ token, capture }) {
  const wait = state?.captureWait;
  if (!wait || wait.token !== token || wait.inserting) return false;
  if (!capture) { endCaptureWait(); return true; } // capture mode was dismissed, or its tab closed
  const component = deliveredCaptureComponent(capture, generateUUID());
  if (!component || !captureTarget(wait.target)) { endCaptureWait(); return false; }
  // Taken: the placeholder says so for a moment, then gives way to the capture.
  wait.inserting = true;
  clearTimeout(captureWatch);
  drawCaptureWait();
  setTimeout(() => { if (state?.captureWait === wait) insertDeliveredCapture(wait, component); }, INSERTING_MS);
  return true;
}

const INSERTING_MS = 2000;

function insertDeliveredCapture(wait, component) {
  endCaptureWait();
  state.mediaPaths = null; // the library has a new pair in it
  deactivate();
  const target = captureTarget(wait.target);
  if (!target) return false;
  const added = pushOp(OPS.insertComponents({ kind: target.kind, uuid: target.uuid }, target.at, [component]), () => {
    select(component.cap.uuid);
    reveal(component.cap.uuid);
  });
  if (added) setStatus(state.status, 'Capture added', { tone: 'ok', hideAfter: 2200 });
  return added;
}

// One listener for the life of the page: `state` says whether a draft is open.
globalThis.chrome?.runtime?.onMessage?.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'kbCaptureDeliver') return;
  sendResponse({ ok: receiveCapture(msg) });
});

// New text at an insert point: an empty line to type on, standing where the
// block will go. Nothing joins the draft until something is typed.
function startText(target, place) {
  deactivate();
  if (!place.isConnected) return; // ending that edit redrew the page
  const el = document.createElement('div');
  el.className = 'mb-kb-text mb-kb-text--new';
  el.dataset.mbText = target.kind;
  el.dataset.mbUuid = target.uuid;
  el.dataset.mbAt = String(target.at);
  place.before(el);
  editPiece(el);
}

// A new section: a top-level one at the end of the page, or a subsection at
// the end of `parentUuid`. Its title is selected, ready to be typed over.
function addSection(parentUuid, level) {
  const h1 = (buildSectionTree(workingMd()).sections ?? []).find(s => s.level === 1);
  const uuid = generateUUID();
  pushOp(OPS.addSection({ uuid, title: level === 3 ? 'New subsection' : 'New section', parentUuid: parentUuid ?? h1?.uuid ?? null, level, textUuid: generateUUID() }), () => {
    select(uuid);
    editPiece(nodeEl(uuid), true);
  });
}

// Where the "Add" card inserts: after the last component of the last section.
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
  closePaste?.();
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
  // At the foot of the page it goes above the foot: the end of the page itself.
  if (anchor.matches('.mb-kb-foot')) anchor.before(el); else anchor.after(el);
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
      // The frozen system-update folder is for system updates alone. There a
      // pick from any other folder is copied into it first (onFrozenPick).
      .filter(group => group.key !== SU_DIR || (state.updates && kind === 'capture'))
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
    const pick = { light, dark, single };
    if (kind === 'capture' && state.updates && needsFreezing(pick)) onFrozenPick(pick, onPick);
    else onPick(pick);
  });
  draw();
}

// A capture picked into a system update from the shared library: copied into
// the system update captures folder first, and the copy is the one used
// (captureFreeze.js). The files go up now, like a new capture's do.
let freezing = false;
async function onFrozenPick(pick, onPick) {
  if (freezing) return;
  const draft = state;
  freezing = true;
  setStatus(draft.status, 'Copying the capture to System update captures…', { busy: true });
  try {
    const frozen = await freezeCapturePick(pick);
    if (state !== draft) return; // the draft was closed meanwhile
    draft.mediaPaths = null; // the library has a new pair in it
    setStatus(draft.status, '');
    onPick(frozen);
  } catch (err) {
    if (state === draft) setStatus(draft.status, `Could not copy the capture: ${err.message}`, { tone: 'error', hideAfter: 7000 });
  } finally {
    freezing = false;
  }
}

// "Paste copied markdown": what a component's Copy button put on the clipboard.
// The box to paste into floats where the menu it was picked from stood, in
// that menu's own look; what is pasted lands where the menu was adding to.
// `parse` reads the text ({ error } when it cannot go there).
let closePaste = null;

function openPastePanel(anchor, parse, onPasted) {
  closePanel();
  const at = anchor.getBoundingClientRect(); // ending an edit may redraw the page under it
  deactivate();
  const pop = document.createElement('div');
  pop.className = 'mb-popup-menu mb-kb-pastepop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Paste copied markdown');
  pop.innerHTML = '<div class="mb-kb-pastepop__title">Paste copied markdown</div><textarea class="mb-kb-panel__paste" rows="4" spellcheck="false" placeholder="Paste here (Ctrl/Cmd+V)"></textarea><p class="mb-kb-panel__note" data-paste-error hidden></p><div class="mb-kb-typed__foot"><button type="button" class="mb-kb-typed__btn" data-paste-cancel>Cancel</button><button type="button" class="mb-kb-typed__btn mb-kb-pastepop__go" data-paste-go disabled>Paste markdown</button></div>';
  document.body.append(pop);
  const place = resolveMenuPlacement(at, { width: pop.offsetWidth, height: pop.offsetHeight }, { width: window.innerWidth, height: window.innerHeight });
  pop.style.left = `${place.x}px`;
  pop.style.top = `${place.y}px`;

  const onDown = e => { if (!pop.contains(e.target)) close(); };
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  const close = () => {
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    pop.remove();
    if (closePaste === close) closePaste = null;
  };
  closePaste = close;
  // After the click that picked it from the menu.
  setTimeout(() => {
    if (closePaste !== close) return;
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
  }, 0);

  const box = pop.querySelector('textarea');
  const error = pop.querySelector('[data-paste-error]');
  const go = pop.querySelector('[data-paste-go]');
  // What is pasted stays in the box to be looked over: the button puts it on the page.
  const read = () => {
    if (!box.value.trim()) return;
    const pasted = parse(box.value);
    if (!pasted.error) { close(); onPasted(pasted); return; }
    error.textContent = pasted.error;
    error.hidden = false;
  };
  box.addEventListener('input', () => { go.disabled = !box.value.trim(); error.hidden = true; });
  box.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); read(); } });
  go.addEventListener('click', read);
  pop.querySelector('[data-paste-cancel]').addEventListener('click', close);
  box.focus({ preventScroll: true });
}

/**
 * The end of the article brought into view (where the foot's Add card adds):
 * resolves once the window has got there.
 */
function toPageEnd() {
  const top = () => {
    const end = state.article.getBoundingClientRect().bottom + window.scrollY - window.innerHeight + 24;
    return Math.max(0, Math.min(end, document.documentElement.scrollHeight - window.innerHeight));
  };
  if (top() - window.scrollY < 2) return Promise.resolve();
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: top(), behavior: still ? 'auto' : 'smooth' });
  if (still) return Promise.resolve();
  return new Promise(resolve => {
    let timer = 0;
    const done = () => { window.removeEventListener('scrollend', done); clearTimeout(timer); resolve(); };
    window.addEventListener('scrollend', done);
    timer = setTimeout(done, 900); // a window that never says it has stopped
  });
}

// ── Events ───────────────────────────────────────────────────────────────────

function wire() {
  const { article } = state;
  state.codeHover = attachCodeHover({
    root: article,
    enabled: () => !!state && !state.liveView && !state.markdownView && !state.sliding && !state.noDraft && !state.menu?.open,
    info: codeInfo,
    annotate: (uuid, line, ann) => (ann == null ? addAnnotationAt(uuid, line) : removeAnnotationAt(uuid, line, ann)),
    highlight: (uuid, line) => keepCodeCaret(uuid, () => edit(uuid, c => { c.cb.hlLines = toggleHlLine(c.cb.hlLines, line); }), line),
    icon: (el, name) => { getLucideSvgMarkup(name).then(svg => { if (svg) el.innerHTML = svg; }).catch(() => {}); },
    tip: (el, text) => setThemeTip(document, el, text),
  });

  // A press with Shift or Cmd / Ctrl held, before anything else hears of it.
  document.addEventListener('pointerdown', onHeldDown, true);
  document.addEventListener('mousedown', onHeldMouse, true);
  document.addEventListener('click', onHeldMouse, true);
  article.addEventListener('mousedown', onArticleMouseDown, true);
  article.addEventListener('dblclick', onArticleDblClick);
  article.addEventListener('pointerdown', onLabelDown); // a tab's label, pressed and moved, drags the tab
  // Which updates are open is remembered (see render).
  article.addEventListener('toggle', e => {
    const el = e.target;
    if (!(el instanceof HTMLDetailsElement)) return;
    if (el.dataset.mbFold != null) {
      state.folds.set(el.dataset.mbNode, { prefix: el.dataset.mbFold, open: el.open });
      return;
    }
    // One being published is remembered too, under the identity it had.
    const uuid = isUpdateEl(el) ? el.dataset.mbNode : el.matches('.mb-kb-upd-ghost__body > details') ? el.closest('[data-mb-ghost]').dataset.mbGhost : null;
    if (!uuid) return;
    if (el.open) state.openUpdates.add(uuid); else state.openUpdates.delete(uuid);
  }, true);
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
  // piece itself, the bar, a block's menu, the floating format bar / insert
  // menu / popovers and the menus) ends the edit.
  const leftActive = target => {
    const a = state.active;
    return !!a && target instanceof Element && !a.el.contains(target) && !state.bar.contains(target)
      && !state.menu.el.contains(target) && !target.closest('.mb-popup-menu, .mb-rte-float, .mb-fm');
  };
  document.addEventListener('mousedown', e => {
    // A press on the page closes a block's menu (the bar and the menus do not).
    if (e.target instanceof Element && !state.menu.el.contains(e.target) && !state.bar.contains(e.target)
      && !e.target.closest('.mb-popup-menu, .mb-kb-pagesettings')) closeSettings();
    // A press inside the article is handled there (it may start the next edit).
    if (leftActive(e.target) && !article.contains(e.target)) deactivate();
    // On the live content an annotation's tooltip is only read: a press anywhere else closes it.
    if (state.liveView && e.target instanceof Element && !e.target.closest('.mb-kb-anntip, .mb-kb-ann')) closeAnnTips();
  }, true);
  document.addEventListener('focusin', e => { if (leftActive(e.target)) deactivate(); });

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('paste', onPaste);
  document.addEventListener('click', onClickAway, true);
  document.addEventListener('visibilitychange', () => {
    if (state?.publishing.length && document.visibilityState === 'visible') watchPublishing(true);
  });

  window.addEventListener('beforeunload', e => {
    if (state.leaving) return;
    settle();
    if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
  });
}

const inField = el => el instanceof Element && !!el.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');

// A plain click anywhere (no Shift, which selects, and no Cmd/Ctrl, which opens a
// block's menu) lets the selection go. The foot (Copy, Unselect all), the
// buttons by the title, and the menus and panels are not "away".
function onClickAway(e) {
  if (!state?.picked.size || held || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (!(t instanceof Element) || !t.isConnected) return;
  if (state.bar?.contains(t) || state.menu?.el.contains(t)) return;
  if (t.closest('.md-content__button, .mb-popup-menu, .mb-fm, .mb-kb-panel, .mb-kb-pastepop, .mb-editlog-popup, dialog')) return;
  clearPicked();
}

function onKeyDown(e) {
  if (document.querySelector('.mb-editlog-popup')) return; // the edit log popup has the keyboard
  if (state.sliding) return;
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();
  // Ctrl/Cmd+C with blocks selected copies them, as Copy does, unless text
  // is being typed: that is the text's own copy. (Text highlighted by a drag
  // let the selection go with the drag's click: onClickAway.)
  if (mod && !e.shiftKey && !e.altKey && key === 'c' && state.picked.size && !inField(e.target)) {
    e.preventDefault();
    copyPicked();
    return;
  }
  // The live content takes no edits: no save, undo or redo to reach for.
  if (state.liveView) {
    if (e.key === 'Escape' && !inField(e.target)) clearPicked();
    return;
  }
  if (mod && !e.shiftKey && !e.altKey && key === 's') {
    e.preventDefault();
    save();
    return;
  }
  if ((e.key === 'Enter' || e.key === ' ') && e.target instanceof Element && e.target.matches('[data-mb-date]')) {
    e.preventDefault(); // the date is a button: it must not fold its update either
    pickUpdateDate(e.target.dataset.mbDate);
    return;
  }
  if (inField(e.target)) return; // typing: the keys below are the text's own
  if (mod && !e.altKey && (key === 'y' || (key === 'z' && e.shiftKey))) {
    e.preventDefault();
    redo();
  } else if (mod && !e.shiftKey && !e.altKey && key === 'z') {
    e.preventDefault();
    undo();
  } else if (e.key === 'Escape') {
    if (state.menu.open) closeSettings(); else if (state.panel) closePanel(); else if (state.sel) select(null); else clearPicked();
  }
  // No Delete key for the selection: nothing on the page shows what is
  // selected, so a stray key press could take out something unseen. Delete is
  // in the thing's menu.
}

const editableAt = target => {
  const el = target instanceof Element ? target.closest(EDITABLE) : null;
  // The label of a tab that is not showing switches to it; only the shown one is typed into.
  if (el?.dataset.mbEdit === 'tab-title' && nodeFor(el) !== shownTabOf(el.closest('.tabbed-set'))) return null;
  return el;
};

const inChrome = t => !!t.closest('.mb-kb-panel, .mb-kb-insert, .mb-kb-foot, .mb-kb-newtab, .mb-kb-upd-ghost, .mb-kb-modenav');

// A press on a label pill means that pill: its text is typed where it stands
// (labelPills.js). Starting the edit redraws the text, and the pill is seldom
// still under the pointer afterwards, so which pill it was, and how far into
// its text, is read before the redraw and the caret put there after it.
function pillPressed(el, target, x, y) {
  const pill = target.closest('.mb-label');
  if (!pill || !el.contains(pill)) return null;
  const index = [...el.querySelectorAll('.mb-label')].indexOf(pill);
  const at = document.caretRangeFromPoint?.(x, y);
  let offset = pill.textContent.length;
  if (at && pill.contains(at.startContainer)) {
    const before = document.createRange();
    before.selectNodeContents(pill);
    before.setEnd(at.startContainer, at.startOffset);
    offset = before.toString().length;
  }
  return { index, offset };
}

// A double click whose first press started the edit: its second press falls
// where the pill no longer is. The pill first pressed is still the one meant,
// and a double click on a pill shows its colours.
let pillPress = null;
function onArticleDblClick() {
  const press = pillPress;
  pillPress = null;
  if (!press || state?.active?.el !== press.el || !caretIntoPill(press.el, press)) return;
  state.active.rte?.labelEdit?.open();
}

function caretIntoPill(el, { index, offset }) {
  const pill = el.querySelectorAll('.mb-label')[index];
  if (!pill) return false;
  el.focus({ preventScroll: true });
  const sel = window.getSelection();
  const walker = document.createTreeWalker(pill, NodeFilter.SHOW_TEXT);
  let left = offset;
  let last = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    last = n;
    if (left <= n.nodeValue.length) { sel.collapse(n, left); return true; }
    left -= n.nodeValue.length;
  }
  if (last) sel.collapse(last, last.nodeValue.length); else sel.collapse(pill, pill.childNodes.length);
  return true;
}

// Editing starts on the press, not the click: the piece is made editable (and
// redrawn as its editing surface) before the browser places the caret, so the
// caret lands under the pointer and a drag selects.
function onArticleMouseDown(e) {
  if (e.detail < 2) pillPress = null; // a new press, not the second of a double click
  if (e.button !== 0) return;
  // A code block's line buttons do their work on the click, the caret left where it is.
  if (e.target instanceof Element && e.target.closest('.mb-kb-codebtns')) return;
  // An annotation's bubble opens its tooltip, on the live content too (to be read there).
  const bubble = e.target instanceof Element && !e.shiftKey && !e.metaKey && !e.ctrlKey ? e.target.closest('.mb-kb-ann') : null;
  if (bubble) { e.preventDefault(); openAnnotation(bubble); return; }
  if (state.liveView && !(e.target instanceof Element && e.target.closest('.mb-kb-anntip'))) closeAnnTips();
  // The live content is read: a press there selects text, as on any page.
  if (state.liveView && !(e.target instanceof Element && e.target.closest('.mb-kb-modenav'))) return;
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
  const pressed = pillPressed(el, t, e.clientX, e.clientY);
  pillPress = pressed && { el, ...pressed };
  if (!activate(el)) return;
  // The press began on markup the redraw just replaced, which can leave the
  // browser with nowhere to put the caret: place it from the pointer if so.
  const { clientX, clientY } = e;
  setTimeout(() => {
    if (state?.active?.el !== el) return;
    const sel = window.getSelection();
    if (pressed && caretIntoPill(el, pressed)) return;
    if (sel?.anchorNode && el.contains(sel.anchorNode) && document.activeElement === el) return;
    el.focus({ preventScroll: true });
    const range = document.caretRangeFromPoint?.(clientX, clientY);
    if (range && el.contains(range.startContainer)) { sel.removeAllRanges(); sel.addRange(range); }
    else caretToEnd(el);
  }, 0);
}

function onArticleClick(e) {
  const t = e.target;
  if (!(t instanceof Element) || t.closest('.mb-kb-panel, .mb-kb-capwait')) return;
  // Save and the selection's buttons have the foot's own listener; only its Add card is handled here.
  if (t.closest('.mb-kb-foot') && !t.closest('.mb-kb-addnew')) return;
  // A press on one of the icons beside the title can end an edit and redraw
  // the page under the pointer: the click then lands on the article, not on
  // the icon now standing there. Pass it on.
  if (t === state.article) {
    const icon = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.md-content__button, .mb-kb-modenav__tab');
    if (icon && state.article.contains(icon)) { icon.click(); return; }
  }
  if (t.closest('.mb-kb-modenav')) return; // the row above the title has its own listener
  // A tab's label clicks its radio for it: that second click is not the user's.
  if (t.matches('.tabbed-set > input')) return;
  const link = t.closest('a');
  if (link && (e.metaKey || e.ctrlKey)) return;              // Cmd/Ctrl+click follows the link
  if (link) e.preventDefault();

  const addNew = t.closest('.mb-kb-addnew');
  if (addNew) {
    e.preventDefault();
    // Pressed with the mouse it keeps no focus: a key pressed later (Escape
    // out of the menu) would otherwise give it the keyboard's focus ring, and
    // it would stay purple until something else was clicked.
    if (e.detail > 0) addNew.blur();
    if (addNew.classList.contains('--note') || state.bar.classList.contains('--wide')) return; // saying something, not offering to add
    // What it adds goes at the end of the page: the page is taken there first,
    // then the menu opens. Text, a library panel, the paste box are placed by
    // the foot as a whole (before it), never inside its row.
    toPageEnd().then(() => {
      if (!state || !addNew.isConnected || addNew.classList.contains('--delete') || addNew.classList.contains('--note')) return;
      if (state.updates) openPopupMenu(addNew, UPDATE_TYPES.map(([id, label]) => ({ id, label })), type => addUpdate(type));
      else openInsertMenu(addNew, lastSectionTarget(), true, state.bar);
    });
    return;
  }

  // A tab group's own pluses: a new tab at the end of the row, or the add
  // menu for the end of one tab.
  const newTabBtn = t.closest('.mb-kb-newtab');
  if (newTabBtn) {
    e.preventDefault();
    addTabTo(newTabBtn.dataset.mbNewtab);
    return;
  }

  const dismiss = t.closest('[data-mb-ghost-dismiss]');
  if (dismiss) {
    e.preventDefault();
    dropPublishing(dismiss.dataset.mbGhostDismiss);
    render();
    return;
  }

  // An update's date of release: the calendar (the click must not fold the update).
  const date = state.liveView ? null : t.closest('[data-mb-date]'); // a live update's date is only read
  if (date) {
    e.preventDefault();
    e.stopPropagation();
    select(date.dataset.mbDate);
    pickUpdateDate(date.dataset.mbDate);
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

// The message showing, or null: { text, tone } (busy, ok, error or info).
// It is said on the Add card of the editor's foot (paintFoot). Where there is
// no foot (the draft loading, a page with no draft yet) it is not shown.
let note = null;
let statusTimer = null;
let creatingSay = null; // the busy Create draft button's label, while it runs (kbCreateDraft)
function setStatus(_el, text, { busy = false, tone = '', hideAfter = 0 } = {}) {
  clearTimeout(statusTimer);
  note = text ? { text, tone: busy ? 'busy' : tone === 'ok' || tone === 'error' ? tone : 'info' } : null;
  paintStatus();
  if (hideAfter) statusTimer = setTimeout(() => setStatus(null, ''), hideAfter);
}

/** The message where it can be seen now: on the foot's Add card. */
function paintStatus() {
  const foot = state?.bar;
  const idle = !!foot?.classList.contains('--idle');
  // A page with no draft, and Create draft is running: its button says it
  // (an empty message leaves the button's last step standing until it is
  // done).
  if ((!foot || idle) && creatingSay && note?.tone !== 'error') {
    if (note) creatingSay(note.text);
    return;
  }
  if (foot) paintFoot();
}
