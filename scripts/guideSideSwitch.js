// Live/Draft switch on every guide screen below the entry (the entry flips in
// place, see guides.js renderGuideMode). Leaf module: decorates screens from a
// formActions completion hook, so no opener has to know about it.
//
// Both pages are indexed into nodes addressed the way the live screens are —
// ordinal paths [sectionIdx, compIdx, (tabIdx|cellIdx), compIdx, …] — and keyed
// by uuid. A uuid is the identity across sides: a published page carries its
// draft's spans, so the same item has the same uuid on both. Switching finds
// the current item on the other side, or its nearest ancestor that exists
// there (a component added in the draft → its section on live), and swaps the
// whole breadcrumb trail for that side's (openWithTrail).
import { getFormAction, onFormActionComplete } from './formActions.js';
import { openWithTrail, snapshotFormStack, confirmDiscardIfDirty } from './form.js';
import { formLoading } from './loading.js';
import { readRepoText } from './repoClient.js';
import { buildSectionTree, readSectionDescription } from './sections.js';
import { parseComponents, uuidOfComponent } from './components.js';
import { GUIDE_ADMONITION_TYPES_RE, ADMONITION_TYPE_LABELS, splitTitleMeta, stripInlineAtoms } from './admonitions.js';
import { guideModeToggleHtml, draftPathOf, draftLinkHtml } from './guides.js';
import { liveIdentity, liveComponentFormName } from './guideLiveView.js';

// Every leaf kind has a live screen of its own (openComponentLiveView's media
// and leaf screens). On the draft side the leaf editors open by uuid; media
// (whose draft editor needs its container and parsed media) lands on its
// container.
const LIVE_LEAF_LABELS = { capture: 'Capture', video: 'Video', image: 'Image', table: 'Data table', codeblock: 'Code block', button: 'Button', navlinks: 'Nav links', diagram: 'Diagram' };
const DRAFT_LEAF_EDITORS = {
  table: { name: 'openEditDataTable', formName: 'editDataTable' },
  codeblock: { name: 'openEditCodeBlock', formName: 'editCodeBlock' },
  button: { name: 'openEditButton', formName: 'editButton' },
  navlinks: { name: 'openEditNavLinks', formName: 'editNavLinks' },
  diagram: { name: 'openEditDiagram', formName: 'editDiagram' },
};
const hasLiveScreen = n => n?.kind === 'leaf' && !!LIVE_LEAF_LABELS[n.compKind];
const hasDraftScreen = n => n?.kind === 'leaf' && !!DRAFT_LEAF_EDITORS[n.compKind];
const hasScreenOn = (n, side) => (side === 'live' ? hasLiveScreen(n) : hasDraftScreen(n));
// A switch from `here` to `side` that opens the leaf's container, not the leaf.
const landsOnContainer = (here, side) => here?.kind === 'leaf' && !hasScreenOn(here, side);

// Page settings: page-level, on both sides of every guide that has the
// switch, so it is its own counterpart (never in the node index).
export const PAGE_SETTINGS_NODE = Object.freeze({ uuid: null, kind: 'page-settings', path: [], parent: null, label: 'Page settings' });

const parseBody = body => parseComponents(body ?? '', GUIDE_ADMONITION_TYPES_RE).components;
const pathKey = path => path.join('.');

function admonitionLabel(adm) {
  const t = stripInlineAtoms(splitTitleMeta(adm.title ?? '').title).trim();
  return t || ADMONITION_TYPE_LABELS[adm.type] || 'Admonition';
}

/**
 * Every addressable node of a guide page: { uuid, kind, path, parent, label,
 * compKind? }. kind ∈ section | admonition | tabs | tab | grid | cell | leaf.
 * `parent` is the parent node's uuid (null for sections). Pure; run it on
 * liveIdentity(md) so every node has a uuid (real spans are kept as-is).
 */
export function guideNodeIndex(md) {
  const byUuid = new Map();
  const byPath = new Map();
  const add = n => { if (n.uuid && !byUuid.has(n.uuid)) byUuid.set(n.uuid, n); byPath.set(pathKey(n.path), n); };
  const walk = (comps, base, parent) => comps.forEach((c, i) => {
    const path = [...base, i];
    const uuid = uuidOfComponent(c);
    if (c.kind === 'admonition') {
      add({ uuid, kind: 'admonition', path, parent, label: admonitionLabel(c.adm) });
      walk(parseBody(c.adm.body), path, uuid);
    } else if (c.kind === 'tabs') {
      add({ uuid, kind: 'tabs', path, parent, label: 'Content tabs' });
      (c.grp.tabs ?? []).forEach((t, ti) => {
        const tp = [...path, ti];
        add({ uuid: t.uuid, kind: 'tab', path: tp, parent: uuid, label: (t.title ?? '').trim() || `Tab ${ti + 1}` });
        walk(parseBody(t.body), tp, t.uuid);
      });
    } else if (c.kind === 'grid') {
      add({ uuid, kind: 'grid', path, parent, label: 'Grid' });
      (c.grid.cells ?? []).forEach((cell, ci) => {
        const cp = [...path, ci];
        add({ uuid: cell.uuid, kind: 'cell', path: cp, parent: uuid, label: `Cell ${ci + 1}` });
        walk(parseBody(cell.body), cp, cell.uuid);
      });
    } else {
      add({ uuid, kind: 'leaf', compKind: c.kind, path, parent });
    }
  });
  const { sections } = buildSectionTree(md ?? '');
  sections.forEach((s, si) => {
    add({ uuid: s.uuid, kind: 'section', path: [si], parent: null, label: s.visualLabel });
    walk(parseBody(readSectionDescription(md, s.uuid).descriptionMarkdown), [si], s.uuid);
  });
  return { byUuid, byPath };
}

/** The node itself, then each ancestor up to its section. */
function lineage(node, idx) {
  const out = [];
  for (let n = node; n; n = n.parent ? idx.byUuid.get(n.parent) : null) out.push(n);
  return out;
}

/**
 * The nearest node on the other side for `node`: itself by uuid, else its
 * closest ancestor that exists there. { node, exact } — node null means
 * nothing below the page matches (land on the guide entry).
 */
export function counterpartNode(node, fromIdx, toIdx) {
  if (!node) return { node: null, exact: false };
  if (node.kind === 'page-settings') return { node, exact: true };
  const chain = lineage(node, fromIdx);
  for (let i = 0; i < chain.length; i++) {
    const hit = toIdx.byUuid.get(chain[i].uuid);
    if (hit) return { node: hit, exact: i === 0 };
  }
  return { node: null, exact: false };
}

/**
 * The breadcrumb trail (root → target) that reaches `node` on `side`, as
 * openWithTrail entries. A leaf trail ends at the leaf's own screen: its
 * read-only screen on the live side, its editor by uuid on the draft side
 * (media on the draft side ends at its container). Page settings is entry →
 * settings on either side. Tabs fold into their group's screen
 * as its `tab` arg on both sides (neither side has a single-tab screen).
 */
export function sideTrail(node, idx, side, { livePath, title }) {
  const draftPath = draftPathOf(livePath);
  const trail = [{
    name: 'openGuideEntry',
    args: { filePath: livePath, label: title, ...(side === 'live' ? { mode: 'live' } : {}) },
    label: title, formName: 'guideEntry',
  }];
  if (node?.kind === 'page-settings') {
    trail.push(side === 'live'
      ? { name: 'openPageSettingsLiveView', args: { file: livePath, label: title }, label: 'Page settings', formName: 'editPageSettings' }
      : { name: 'openEditPageSettings', args: { file: draftPath }, label: 'Page settings', formName: 'editPageSettings' });
    return trail;
  }
  const chain = node ? lineage(node, idx).reverse() : [];
  for (const n of chain) {
    if (n.kind === 'tab') { const g = trail[trail.length - 1]; g.args = { ...g.args, tab: n.path[n.path.length - 1] }; continue; }
    if (n.kind === 'leaf') {
      if (side === 'live' && hasLiveScreen(n)) {
        trail.push({ name: 'openComponentLiveView', args: { file: livePath, path: n.path, label: title }, label: LIVE_LEAF_LABELS[n.compKind], formName: liveComponentFormName(n.compKind) });
      } else if (side === 'draft' && hasDraftScreen(n)) {
        const ed = DRAFT_LEAF_EDITORS[n.compKind];
        trail.push({ name: ed.name, args: { uuid: n.uuid, file: draftPath }, label: LIVE_LEAF_LABELS[n.compKind], formName: ed.formName });
      }
      break;
    }
    if (side === 'live') {
      trail.push(n.kind === 'section'
        ? { name: 'openGuideSectionLiveView', args: { file: livePath, index: n.path[0], label: title }, label: n.label, formName: 'editGuideSection' }
        : { name: 'openComponentLiveView', args: { file: livePath, path: n.path, label: title }, label: n.label, formName: liveComponentFormName(n.kind) });
    } else if (n.kind === 'section') {
      trail.push({ name: 'openEditGuideSection', args: { uuid: n.uuid, file: draftPath }, label: n.label, formName: 'editGuideSection' });
    } else if (n.kind === 'admonition') {
      trail.push({ name: 'openEditGuideAdmonition', args: { uuid: n.uuid, file: draftPath }, label: n.label, formName: 'editGuideAdmonition' });
    } else if (n.kind === 'tabs') {
      trail.push({ name: 'openEditContentTabs', args: { uuid: n.uuid, file: draftPath }, label: n.label, formName: 'editContentTabs' });
    } else if (n.kind === 'grid') {
      trail.push({ name: 'openEditGrid', args: { uuid: n.uuid, file: draftPath }, label: n.label, formName: 'editGrid' });
    } else if (n.kind === 'cell') {
      trail.push({ name: 'openEditGridCell', args: { uuid: n.parent, file: draftPath, index: n.path[n.path.length - 1] }, label: n.label, formName: 'editGridCell' });
    }
  }
  return trail;
}

// ── Which screens carry the switch, and where they are ─────────────────────

// A tabs screen's node is its active tab (so the other side opens on it).
const activeTabOf = (node, idx, i) => (Number.isInteger(i) && idx.byPath.get(pathKey([...node.path, i]))) || node;
const byArgsUuid = (args, idx) => idx.byUuid.get(args.uuid) ?? null;
const draftLeaf = { side: 'draft', file: a => a.file, locate: byArgsUuid };
const mediaLeaf = { side: 'draft', file: a => a.container?.file, locate: byArgsUuid };

const SCREENS = {
  openEditGuideSection: { side: 'draft', file: a => a.file, locate: byArgsUuid },
  openEditGuideAdmonition: { side: 'draft', file: a => a.file, locate: byArgsUuid },
  openEditContentTabs: { side: 'draft', file: a => a.file,
    locate: (a, idx, formEl) => { const n = byArgsUuid(a, idx); return n && activeTabOf(n, idx, formEl._ct?.active); } },
  openEditGrid: { side: 'draft', file: a => a.file, locate: byArgsUuid },
  openEditGridCell: { side: 'draft', file: a => a.file,
    locate: (a, idx, formEl) => { const g = byArgsUuid(a, idx); return g && (idx.byPath.get(pathKey([...g.path, formEl._grid?.active ?? a.index])) ?? g); } },
  openEditCodeBlock: draftLeaf,
  openEditButton: draftLeaf,
  openEditNavLinks: draftLeaf,
  openEditDiagram: draftLeaf,
  openEditDataTable: draftLeaf,
  openEditCaptureComponent: mediaLeaf,
  openEditVideoComponent: mediaLeaf,
  openEditImageComponent: mediaLeaf,
  openEditPageSettings: { side: 'draft', file: a => a.file, locate: () => PAGE_SETTINGS_NODE },
  openPageSettingsLiveView: { side: 'live', file: a => a.file, locate: () => PAGE_SETTINGS_NODE },
  openGuideSectionLiveView: { side: 'live', file: a => a.file, locate: (a, idx) => idx.byPath.get(pathKey([a.index])) ?? null },
  openComponentLiveView: { side: 'live', file: a => a.file,
    locate: (a, idx, formEl) => { const n = idx.byPath.get(pathKey(a.path ?? [])); return n && (n.kind === 'tabs' ? activeTabOf(n, idx, Number(formEl.dataset.activeTab)) : n); } },
};

const sideWord = side => (side === 'live' ? 'live page' : 'draft');
const nodeNoun = n => (n.kind === 'page-settings' ? 'page settings' : n.kind === 'leaf' ? 'component' : n.kind === 'cell' ? 'cell' : n.kind === 'tab' ? 'tab' : n.kind === 'tabs' ? 'content tabs' : n.kind);

// Live guide path for a screen's file, or null when the screen isn't a guide's.
function livePathFor(side, file) {
  if (!file) return null;
  if (side === 'live') return file.startsWith('docs/pages/') ? file : null;
  return file.startsWith('docs/drafts/') ? file.replace(/^docs\/drafts\//, 'docs/pages/') : null;
}

// The guide title from the current trail's entry crumb, else the file name.
function guideTitle(livePath) {
  const entry = snapshotFormStack()?.find(e => e.formName === 'guideEntry');
  return entry?.args?.label || livePath.split('/').pop().replace(/\.md$/, '');
}

// Where the switch would take this screen right now (tab/cell can change
// after mount, so it's resolved per hover and per click).
function resolve(state) {
  const { spec, args, formEl, side, idx } = state;
  const otherSide = side === 'live' ? 'draft' : 'live';
  const here = spec.locate(args, idx[side], formEl);
  const { node, exact } = counterpartNode(here, idx[side], idx[otherSide]);
  return { here, node, exact, otherSide };
}

// Exported for tests.
export function switchTitle(state, idx = state.idx) {
  const { here, node, exact, otherSide } = resolve(state);
  const base = `Switch to ${otherSide}`;
  if (exact && !landsOnContainer(here, otherSide)) return base;
  if (exact) {
    // Every leaf has a parent (top-level leaves get their section's uuid), so ask what it is.
    const holder = idx[state.side].byUuid.get(here.parent)?.kind === 'section' ? 'section' : 'container';
    return `${base} (opens the ${holder} holding this component)`;
  }
  const where = node ? (node.label || nodeNoun(node)) : 'the guide';
  return `${base}: this ${here ? nodeNoun(here) : 'item'} isn't on the ${sideWord(otherSide)}, so this opens ${where}`;
}

async function switchSide(state) {
  if (!confirmDiscardIfDirty(state.formEl)) return;
  const { here, node, exact, otherSide } = resolve(state);
  formLoading.show();
  try {
    const trail = sideTrail(node, state.idx[otherSide], otherSide, { livePath: state.livePath, title: guideTitle(state.livePath) });
    const ok = await openWithTrail(trail);
    // A leaf with no screen on the other side lands on its container; point at its card.
    if (ok && exact && landsOnContainer(here, otherSide)) flashRow(node.uuid);
  } finally {
    formLoading.dismiss();
  }
}

function flashRow(uuid) {
  const row = document.querySelector(`.more-buttons-overlay [data-component-uuid="${CSS.escape(uuid)}"]`);
  if (!row) return;
  row.scrollIntoView({ block: 'center' });
  row.classList.add('mb-side-flash');
  setTimeout(() => row.classList.remove('mb-side-flash'), 1600);
}

// Both pages are read on every decorated screen open. A short-lived cache keeps
// a burst of screen opens (Back, Back, open) at two API calls instead of two per
// screen; a save followed by a navigation inside the window indexes the
// pre-save text, which at worst lands the switch on the nearest ancestor.
const PAGE_READ_TTL_MS = 5000;
const pageReads = new Map(); // path → { at, promise }
function readPageCached(path) {
  const hit = pageReads.get(path);
  if (hit && Date.now() - hit.at < PAGE_READ_TTL_MS) return hit.promise;
  const promise = readRepoText(path);
  pageReads.set(path, { at: Date.now(), promise });
  promise.catch(() => pageReads.delete(path));
  return promise;
}

// Upgrade the screen's heading pill to the switch once both pages are known
// to exist. Both files are read here; the indexes are kept for the click.
async function mount(name, args, formEl) {
  const spec = SCREENS[name];
  const side = spec.side;
  const livePath = livePathFor(side, spec.file(args ?? {}));
  if (!livePath) return;
  let draftMd, liveMd;
  try { [draftMd, liveMd] = await Promise.all([readPageCached(draftPathOf(livePath)), readPageCached(livePath)]); }
  catch { return; }
  if (!draftMd || !liveMd || !formEl.isConnected) return;
  const heading = formEl.querySelector('h2');
  if (!heading) return;
  const state = {
    spec, args, formEl, side, livePath,
    idx: { draft: guideNodeIndex(liveIdentity(draftMd)), live: guideNodeIndex(liveIdentity(liveMd)) },
  };
  if (!spec.locate(args, state.idx[side], formEl)) return; // screen not found in its own file
  heading.querySelector('.mb-kb-pills[data-guide-side]')?.remove();
  heading.classList.add('mb-side-heading');
  heading.insertAdjacentHTML('beforeend', guideModeToggleHtml(side, { attr: 'data-guide-side-switch' }));
  const btn = heading.querySelector('[data-guide-side-switch]');
  const retitle = () => { btn.title = switchTitle(state, state.idx); };
  retitle();
  btn.addEventListener('pointerenter', retitle);
  btn.addEventListener('focus', retitle);
  btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); switchSide(state); });
}

const overlayForm = () => document.querySelector?.('.more-buttons-overlay form') ?? null;

// Every draft-side screen below the entry carries a View draft link at the head
// of its dock, so the published draft is one click away at any depth (the live
// screens build View live into their own dock). Edit screens come from SCREENS;
// create screens are recognised by their `file` / `container.file` arg.
const DOCK_SEP = '<span class="mb-dock-sep" aria-hidden="true"></span>';
export function draftDockPrefixHtml(livePath) { return draftLinkHtml(livePath) + DOCK_SEP; }
export function draftFileOf(name, args) {
  const a = args ?? {};
  if (SCREENS[name]) return SCREENS[name].side === 'draft' ? (SCREENS[name].file(a) ?? null) : null;
  if (name.startsWith('openCreate')) return a.file ?? a.container?.file ?? null;
  return null;
}
function addDraftLink(name, args, formEl) {
  const livePath = livePathFor('draft', draftFileOf(name, args));
  if (!livePath) return;
  const dock = formEl.parentElement?.querySelector?.('.more-buttons-form-actions');
  if (!dock || dock.querySelector('[data-view-draft-link]')) return;
  dock.insertAdjacentHTML('afterbegin', draftDockPrefixHtml(livePath));
}

onFormActionComplete({
  before: () => (typeof document === 'undefined' ? null : overlayForm()),
  after(name, args, before) {
    if (typeof document === 'undefined') return;
    const formEl = overlayForm();
    if (!formEl || formEl === before) return; // the opener bailed: nothing new to decorate
    addDraftLink(name, args, formEl);
    if (SCREENS[name]) mount(name, args, formEl).catch(err => console.warn('[MB] Live/Draft switch failed:', err));
  },
});
