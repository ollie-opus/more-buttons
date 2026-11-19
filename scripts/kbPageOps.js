/**
 * kbPageOps.js — every edit the in-page editor (kbPageEditor.js) can make to a
 * guide draft, as a pure markdown → markdown step.
 *
 * Nothing on the page is saved as it is made. Each edit is an OP:
 *
 *   { key?, subject(before) → string, apply(md) → md }
 *
 * `apply` writes the edit into whatever markdown it is given, addressing its
 * target by uuid, never by line or index. So the same ops draw the page (over
 * the draft as it was read), are dropped again by Undo, and are replayed over
 * the draft as it is on GitHub at the moment of Save — an edit someone else
 * committed in the meantime is kept, and an op whose target they removed
 * throws a message fit to show. `subject` is the commit subject the form
 * editors write for the same edit (the edit log reads them). `key` marks an op
 * that typing keeps replacing (one op per run of typing in one place).
 *
 * Anything an op inserts is built ONCE, by the caller, with its identity
 * already minted (newComponent / newTab / newCell / mediaComponent): `apply`
 * runs many times and must put the same uuids in every time.
 *
 * The model is the form editors' own (see components.js), read and written
 * through the same pure parsers and builders, with one difference in how it is
 * held: here a container is ONE ordered list of blocks, its text included
 * (`{ kind: 'text', txt }`, parseBlocks). Nothing is a "description": text is a
 * block with its own uuid, and can stand, and be moved, anywhere a component
 * can. No DOM, no network.
 */

import {
  buildSectionTree, parseSections, locateSectionByUUID, readSectionDescription, buildSection, replaceSectionByUUID,
  writeHideSectionTitle, insertSectionUnderParent, deleteSectionByUUID, moveSectionAmongSiblings, moveSectionToParent,
} from './sections.js';
import {
  parseBlocks, buildComponentBody, uuidOfComponent, derivedUuid, parsePastedComponents, stripUUIDSpans,
  readTabComponents, tabContainerExists, writeTabBody,
  readGridCellComponents, gridCellExists, writeGridCellBody,
} from './components.js';
import { GUIDE_ADMONITION_TYPES_RE, buildAdmonition, replaceAdmonitionByUUID, deleteAdmonitionByUUID, generateUUID } from './admonitions.js';
import { componentCommit, componentKindLabel, reorderCommit, sectionParentTitle } from './editLogDescribe.js';
import { normalizeForSave, markerFor, tokenizeAnnotatedCode, serializeTokens, DEFAULT_CODE_LANGUAGE } from './codeAnnotations.js';
import { TEXT_KIND, EMPTY_TEXT, readBlocks, readPageTitle, pageTitleBody, PAGE_TITLE_LINES_RE } from './kbPageRender.js';
import { capturePresetShape } from './capturePresets.js';
import { readFrontmatterIcon, readFrontmatterTags, readFrontmatterHide, applyPageSettingsFrontmatter } from './frontmatter.js';
import { splitAudience, composeTags } from './audienceTags.js';
import { UPDATES_KIND, UPDATES_ROOT, updateComponents, joinUpdateTitle } from './kbUpdates.js';

// A body as its blocks. `description` is only a reading aid: the words of the
// text block the body opens with ('' when it opens with something else). That
// block is components[0] all the same, and it is `components` that is written.
const leadOf = components => (components[0]?.kind === 'text' ? components[0].txt.body : '');
const parseBody = (body, opts) => {
  const components = readBlocks(parseBlocks(body ?? '', GUIDE_ADMONITION_TYPES_RE, opts).blocks);
  return { description: leadOf(components), components };
};
const sectionBody = (md, uuid) =>
  parseBody(readSectionDescription(md, uuid).descriptionMarkdown, { ownSpan: false, owner: uuid });
// readTabComponents / readGridCellComponents hand the leading text back apart.
const whole = p => {
  const components = readBlocks(p.description ? [{ kind: 'text', txt: { uuid: p.descriptionUuid, body: p.description } }, ...p.components] : p.components);
  return { description: leadOf(components), components };
};
// An empty text block as the page holds it while the draft is open (see EMPTY_TEXT).
const writeBlocks = components => components.map(c =>
  (c.kind === 'text' && !(c.txt.body ?? '').trim() ? { kind: 'text', txt: { ...c.txt, body: EMPTY_TEXT } } : c));
const textBlock = (uuid, body) => ({ kind: 'text', txt: { uuid, body } });
const clone = value => JSON.parse(JSON.stringify(value));
const gone = (what = 'part of the page') =>
  new Error(`The ${what} you changed is no longer in the draft. Someone may have removed it.`);

// ── Reading the page ─────────────────────────────────────────────────────────

function* walkList(components, container) {
  for (let index = 0; index < components.length; index++) {
    const component = components[index];
    yield { component, container, index };
    if (component.kind === 'admonition') {
      yield* walkList(parseBody(component.adm.body).components, { kind: TEXT_KIND.admonition, uuid: component.adm.uuid });
    } else if (component.kind === 'tabs') {
      for (const tab of component.grp.tabs ?? []) {
        yield* walkList(parseBody(tab.body).components, { kind: TEXT_KIND.tab, uuid: tab.uuid });
      }
    } else if (component.kind === 'grid') {
      for (const cell of component.grid.cells ?? []) {
        yield* walkList(parseBody(cell.body).components, { kind: TEXT_KIND.cell, uuid: cell.uuid });
      }
    }
  }
}

/** Every component on the page, depth first: { component, container, index }. */
export function* walkPage(md) {
  for (const s of buildSectionTree(md ?? '').sections ?? []) {
    if (!s.uuid) continue;
    yield* walkList(sectionBody(md, s.uuid).components, { kind: TEXT_KIND.section, uuid: s.uuid });
  }
  // The System Updates drafts page: no sections, a list of update blocks
  // (kbUpdates.js). A guide has none, so this adds nothing there.
  yield* walkList(updateComponents(md), UPDATES_ROOT);
}

/** The component with this uuid, with the container that holds it; null when absent. */
export function findComponent(md, uuid) {
  if (!uuid) return null;
  for (const hit of walkPage(md)) if (uuidOfComponent(hit.component) === uuid) return hit;
  return null;
}

/** The tab group / grid that owns a tab / cell: the component hit plus `childIndex`. */
export function findOwner(md, childKind, childUuid) {
  if (!childUuid) return null;
  const tab = childKind === 'tab';
  for (const hit of walkPage(md)) {
    if (hit.component.kind !== (tab ? 'tabs' : 'grid')) continue;
    const list = (tab ? hit.component.grp.tabs : hit.component.grid.cells) ?? [];
    const childIndex = list.findIndex(x => x.uuid === childUuid);
    if (childIndex >= 0) return { ...hit, childIndex };
  }
  return null;
}

/** A container's blocks (`components`, its text among them); null when the container is not on the page. */
export function readContainer(md, { kind, uuid }) {
  if (!uuid) return null;
  if (kind === TEXT_KIND.section) {
    if (!locateSectionByUUID(md, uuid)) return null;
    return sectionBody(md, uuid);
  }
  if (kind === TEXT_KIND.admonition) {
    const hit = findComponent(md, uuid);
    return hit?.component.kind === 'admonition' ? parseBody(hit.component.adm.body) : null;
  }
  if (kind === TEXT_KIND.tab) return tabContainerExists(md, uuid) ? whole(readTabComponents(md, uuid)) : null;
  if (kind === TEXT_KIND.cell) return gridCellExists(md, uuid) ? whole(readGridCellComponents(md, uuid)) : null;
  if (kind === UPDATES_KIND) return { description: '', components: updateComponents(md) };
  return null;
}

/**
 * `md` with a container's body rebuilt from its blocks. The second-to-last
 * argument is unused (the leading text is a block in `components`); it stays
 * so a caller can hand back what readContainer gave it.
 */
export function writeContainer(md, { kind, uuid }, _description, blocks) {
  const text = '';
  const components = writeBlocks(blocks);
  if (kind === TEXT_KIND.section) {
    const sec = locateSectionByUUID(md, uuid);
    if (!sec) throw gone('section');
    // The "hide title" marker lives in the section body: carry it over.
    const { hideTitle } = readSectionDescription(md, uuid);
    const body = writeHideSectionTitle(buildComponentBody(null, text, components).replace(/^\n+/, ''), hideTitle);
    return replaceSectionByUUID(md, uuid, buildSection(sec.level, sec.title, uuid, body));
  }
  if (kind === TEXT_KIND.admonition) {
    const hit = findComponent(md, uuid);
    if (hit?.component.kind !== 'admonition') throw gone('admonition');
    const { prefix, type, title } = hit.component.adm;
    return replaceAdmonitionByUUID(md, uuid, buildAdmonition(prefix, type, title, buildComponentBody(uuid, text, components)));
  }
  if (kind === TEXT_KIND.tab) {
    if (!tabContainerExists(md, uuid)) throw gone('tab');
    return writeTabBody(md, uuid, text, components);
  }
  if (kind === TEXT_KIND.cell) {
    if (!gridCellExists(md, uuid)) throw gone('grid cell');
    return writeGridCellBody(md, uuid, text, components);
  }
  if (kind === UPDATES_KIND) return writeUpdates(md, blocks);
  throw gone();
}

// The updates page's list, rewritten. An update that stays is replaced where
// it stands and one that is gone is taken out; new ones go to the end of the
// file, in the order given. (The page holds a queue: nothing reorders it.)
function writeUpdates(md, blocks) {
  // A parsed body opens with the blank line under its header, which
  // buildAdmonition writes itself.
  const block = ({ adm }) => buildAdmonition(adm.prefix || '???', adm.type, adm.title, (adm.body ?? '').replace(/^\n+/, ''));
  const next = new Map(blocks.filter(c => c.kind === 'admonition').map(c => [c.adm.uuid, c]));
  let out = md;
  for (const { adm } of updateComponents(md)) {
    const kept = next.get(adm.uuid);
    next.delete(adm.uuid);
    if (!kept) out = deleteAdmonitionByUUID(out, adm.uuid);
    else if (JSON.stringify(kept.adm) !== JSON.stringify(adm)) out = replaceAdmonitionByUUID(out, adm.uuid, block(kept));
  }
  if (!next.size) return out;
  return `${out.trimEnd()}\n\n${[...next.values()].map(block).join('\n\n')}\n`;
}

// A component replaced where it stands (`next` null removes it).
function replaceAt(md, hit, next) {
  const body = readContainer(md, hit.container);
  if (!body) throw gone();
  const list = body.components.slice();
  if (next) list[hit.index] = next; else list.splice(hit.index, 1);
  return writeContainer(md, hit.container, body.description, list);
}

// ── Rows ─────────────────────────────────────────────────────────────────────
// Blocks stand side by side in the columns of a row: on the page a Zensical
// grid, one cell to a column. A row is not something that is added: it comes
// of a block being dropped beside another (OPS.moveBeside), and it goes when
// what is left of it is no longer side by side (tidyRow).

const columnBlocks = cell => parseBody(cell.body).components;
const columnWith = (uuid, components) =>
  ({ uuid, body: buildComponentBody(uuid, '', writeBlocks(components)), spill: false, valign: 'default' });

/** The row a container is a column of (its grid's uuid), or null. */
function rowOf(md, container) {
  return container?.kind === TEXT_KIND.cell ? findOwner(md, 'cell', container.uuid)?.component.grid.uuid ?? null : null;
}

/**
 * A row (`hit`: its grid, found on `md`) given these columns. With one left it
 * is no row, and what that column holds stands where the row stood; with none
 * it goes altogether.
 */
function setColumns(md, hit, cells) {
  if (cells.length > 1) return replaceAt(md, hit, { ...hit.component, grid: { ...hit.component.grid, cells } });
  const body = readContainer(md, hit.container);
  if (!body) throw gone();
  const list = body.components.slice();
  list.splice(hit.index, 1, ...(cells[0] ? clone(columnBlocks(cells[0])) : []));
  const out = writeContainer(md, hit.container, '', list);
  // The row may have been all there was in a column of a row of its own.
  const outer = cells.length ? null : rowOf(md, hit.container);
  return outer ? tidyRow(out, outer) : out;
}

/**
 * A row after a block left it: a column with nothing in it goes (setColumns).
 * A row that lost no column is left as it is (one written by hand with a
 * single column stays that way).
 */
function tidyRow(md, gridUuid) {
  const hit = findComponent(md, gridUuid);
  if (hit?.component.kind !== 'grid') return md;
  const cells = hit.component.grid.cells ?? [];
  const kept = cells.filter(c => columnBlocks(c).length);
  return kept.length === cells.length ? md : setColumns(md, hit, kept);
}
const tidyRows = (md, rows) => [...new Set(rows)].filter(Boolean).reduce(tidyRow, md);

// ── Commit subjects ──────────────────────────────────────────────────────────

const subjectOf = commit => (typeof commit === 'string' ? commit : commit?.subject ?? '');
const componentSubject = (verb, md, uuid) =>
  subjectOf(componentCommit(verb, componentKindLabel(findComponent(md, uuid)?.component ?? null), md, uuid));
const sectionTitleOf = (md, uuid) => locateSectionByUUID(md, uuid)?.title ?? '';

function textSubject(md, { kind, uuid } = {}) {
  if (kind === TEXT_KIND.section) return `Edited section '${sectionTitleOf(md, uuid)}'`;
  if (kind === TEXT_KIND.tab) return subjectOf(componentCommit('Edited', 'Content tabs', md, uuid));
  if (kind === TEXT_KIND.cell) return subjectOf(componentCommit('Edited', 'Grid', md, uuid));
  return componentSubject('Edited', md, uuid);
}

// Is `container` the moved component itself, or somewhere inside it?
function holds(component, container) {
  if (component.kind === 'tabs' && (component.grp.tabs ?? []).some(t => t.uuid === container.uuid)) return true;
  if (component.kind === 'grid' && (component.grid.cells ?? []).some(c => c.uuid === container.uuid)) return true;
  if (uuidOfComponent(component) === container.uuid) return true;
  for (const hit of walkList([component], null)) {
    const c = hit.component;
    if (uuidOfComponent(c) === container.uuid) return true;
    if (c.kind === 'tabs' && (c.grp.tabs ?? []).some(t => t.uuid === container.uuid)) return true;
    if (c.kind === 'grid' && (c.grid.cells ?? []).some(x => x.uuid === container.uuid)) return true;
  }
  return false;
}

/**
 * A text block cut at its paragraph breaks: one piece per paragraph, a list or
 * a fenced block staying whole (with whatever is indented under it).
 */
export function splitParagraphs(body) {
  const lines = String(body ?? '').split('\n');
  const chunks = [];
  let cur = [];
  let fence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (!fence && line.trim() === '') { if (cur.length) chunks.push(cur); cur = []; continue; }
    cur.push(line);
  }
  if (cur.length) chunks.push(cur);
  const isList = l => /^\s*(?:[-*+]|\d{1,9}[.)])\s/.test(l);
  const out = [];
  for (const chunk of chunks) {
    const prev = out[out.length - 1];
    const continues = prev && (/^\s+\S/.test(chunk[0]) || (isList(chunk[0]) && isList(prev[prev.length - 1])));
    if (continues) prev.push('', ...chunk); else out.push(chunk.slice());
  }
  return out.map(c => c.join('\n'));
}

// ── Building what an insert puts on the page ─────────────────────────────────

// A new container opens with an empty text block: the place to start typing, there to be deleted like any other block.
const emptyBody = uuid => buildComponentBody(uuid, '', writeBlocks([newText()]));

export function newTab(title) {
  const uuid = generateUUID();
  return { uuid, title, body: emptyBody(uuid) };
}

export function newCell() {
  const uuid = generateUUID();
  return { uuid, body: emptyBody(uuid), spill: false, valign: 'default' };
}

/** A fresh text block. */
export const newText = (body = '') => textBlock(generateUUID(), body);

// ── The placed page title ────────────────────────────────────────────────────
// A page whose own title is hidden may show ONE title somewhere in its content
// (kbPageRender.js readPageTitle: a text block of one line). One, always: it is
// only offered while there is none, an insert or a paste that would make a
// second leaves it out, and it is never copied.

const isPageTitle = c => c?.kind === 'text' && readPageTitle(c.txt.body) != null;

/** The page's placed title (a walkPage hit), or null. */
export function findPageTitle(md) {
  for (const hit of walkPage(md)) if (isPageTitle(hit.component)) return hit;
  return null;
}

/** Is the page's own title (its H1) hidden on the site? */
export function pageTitleHidden(md) {
  const h1 = (buildSectionTree(md ?? '').sections ?? []).find(s => s.level === 1 && s.uuid);
  return !!h1 && !!readSectionDescription(md, h1.uuid).hideTitle;
}

/** May a title be placed in the content: the page's own is hidden, and none is placed yet. */
export const canPlacePageTitle = md => pageTitleHidden(md) && !findPageTitle(md);

/** A fresh placed title. */
export const newPageTitle = (text = 'Page title') => textBlock(generateUUID(), pageTitleBody(text));

/** Markdown with every placed-title line taken out (what is copied, and what a paste reads). */
export const withoutPageTitles = text => String(text ?? '').replace(PAGE_TITLE_LINES_RE, '');

/**
 * Pasted markdown as what it adds to a page: the `components` it opens with
 * (before its first heading) and its headings as `sections`, each
 * { uuid, level, title, components } with a fresh identity. A heading left as
 * text would be a section with no identity on the page (nothing to hold it
 * by), so each one is read here and added as a section (OPS.pasteSections).
 * A page title (`#`) in the paste moves every pasted heading one level down:
 * a page has one title.
 *
 * @param {string} text
 * @returns {{ components: Array, sections: Array, error: string|null }}
 */
export function parsePastedPage(text) {
  // A placed page title never comes in with a paste: a page has one.
  const stripped = withoutPageTitles(stripUUIDSpans(text ?? '').replace(/\r\n?/g, '\n')).trim();
  const heads = parseSections(stripped);
  if (!heads.length) {
    const { components, error } = parsePastedComponents(stripped);
    return { components: components ?? [], sections: [], error };
  }
  const lines = stripped.split('\n');
  const part = (from, to) => parsePastedComponents(lines.slice(from, to).join('\n')).components ?? [];
  const down = heads.some(h => h.level === 1) ? 1 : 0;
  const sections = heads.map(h => {
    const components = part(h.headerLine + 1, h.ownedEndLine);
    return {
      uuid: generateUUID(),
      level: Math.min(3, h.level + down),
      title: h.title,
      components: components.length ? components : [newText()],
    };
  });
  return { components: part(0, heads[0].headerLine), sections, error: null };
}

/** A fresh update for the System Updates drafts page: no title or date yet, one empty text block. */
export function newUpdate(type) {
  const uuid = generateUUID();
  return { kind: 'admonition', adm: { uuid, prefix: '???', type, title: joinUpdateTitle(type, '', ''), body: emptyBody(uuid) } };
}

/** A fresh component of a kind the page can hold with no further input. */
export function newComponent(kind) {
  const uuid = generateUUID();
  switch (kind) {
    case 'admonition':
      return { kind, adm: { uuid, prefix: '!!!', type: 'step', title: '', body: emptyBody(uuid) } };
    case 'tabs':
      return { kind, grp: { uuid, tabs: [newTab('Tab 1'), newTab('Tab 2')] } };
    case 'grid':
      return { kind, grid: { uuid, flavor: 'generic', cells: [newCell(), newCell()] } };
    case 'table':
      return { kind, tbl: { uuid, wrap: true, align: ['left', 'left'], header: ['Column 1', 'Column 2'], rows: [['', ''], ['', '']] } };
    case 'button':
      return { kind, btn: { uuid, label: 'Button', destination: '', icon: '', primary: false, colour: 'blue', theme: 'default', border: 'default', style: 'default', newTab: false, onclick: '' } };
    case 'navlinks':
      return { kind, nav: { uuid, path: '', newTab: false } };
    case 'diagram':
      return { kind, dia: { uuid, code: 'graph LR\n  A[Start] --> B[End]' } };
    case 'codeblock':
      return { kind, cb: { uuid, language: DEFAULT_CODE_LANGUAGE, title: '', linenums: '', hlLines: '', extra: '', code: '', annotations: [] } };
    default:
      return null;
  }
}

const assetName = path => String(path ?? '').replace(/^docs\/assets\//, '');

/**
 * The files of a media library pick, in the shape its component stores them
 * (paths relative to docs/assets/). `pick` is { light, dark, single } repo paths.
 */
export function mediaFiles(kind, pick) {
  if (kind === 'image') return { filename: assetName(pick.single) };
  if (kind === 'capture') {
    const lightFilename = assetName(pick.light);
    return { lightFilename, darkFilename: pick.dark ? assetName(pick.dark) : lightFilename.replace('-light-mode', '-dark-mode') };
  }
  const paired = !!(pick.light && pick.dark);
  return { lightFilename: assetName(pick.light || pick.single), darkFilename: paired ? assetName(pick.dark) : null, single: !paired };
}

/** A capture / image / video component for a media library pick, at its natural size. */
export function mediaComponent(kind, pick) {
  const uuid = generateUUID();
  const files = mediaFiles(kind, pick);
  if (kind === 'image') return { kind, img: { uuid, ...files, dimMode: 'none', dimValue: null, rounded: false } };
  if (kind === 'capture') return { kind, cap: { uuid, ...files, ...capturePresetShape('auto'), inversed: false } };
  return { kind: 'video', vid: { uuid, ...files, dimMode: 'none', dimValue: null, inversed: false, rounded: false, playback: 'animation' } };
}

// ── Table and code block edits (they mutate the component they are given) ────

function fitTable(tbl) {
  const cols = tbl.align.length;
  const fit = cells => Array.from({ length: cols }, (_, i) => cells?.[i] ?? '');
  tbl.header = fit(tbl.header);
  tbl.rows = (tbl.rows ?? []).map(fit);
}

export const TABLE = {
  /** `row` -1 is the header row. */
  setCell(tbl, row, col, text) {
    fitTable(tbl);
    if (col < 0 || col >= tbl.align.length) return;
    if (row < 0) tbl.header[col] = text;
    else if (tbl.rows[row]) tbl.rows[row][col] = text;
  },
  insertRow(tbl, at) {
    fitTable(tbl);
    tbl.rows.splice(Math.max(0, Math.min(at, tbl.rows.length)), 0, tbl.align.map(() => ''));
  },
  deleteRow(tbl, row) {
    fitTable(tbl);
    if (row >= 0 && row < tbl.rows.length) tbl.rows.splice(row, 1);
  },
  insertCol(tbl, at) {
    fitTable(tbl);
    const i = Math.max(0, Math.min(at, tbl.align.length));
    tbl.align.splice(i, 0, 'left');
    tbl.header.splice(i, 0, 'Column');
    tbl.rows.forEach(r => r.splice(i, 0, ''));
  },
  /** A table keeps at least one column. */
  deleteCol(tbl, col) {
    fitTable(tbl);
    if (tbl.align.length < 2 || col < 0 || col >= tbl.align.length) return;
    tbl.align.splice(col, 1);
    tbl.header.splice(col, 1);
    tbl.rows.forEach(r => r.splice(col, 1));
  },
  setAlign(tbl, col, align) {
    if (col >= 0 && col < tbl.align.length) tbl.align[col] = align;
  },
};

// Markers and their list items stay bound: an emptied annotation takes its
// marker with it, and the rest renumber in the order they appear in the code.
function tidyAnnotations(cb) {
  const out = normalizeForSave(cb.code ?? '', cb.annotations ?? [], cb.language ?? '');
  cb.code = out.code;
  cb.annotations = out.annotations;
}

export const CODE = {
  /** A new marker at the end of code line `line` (default: the last), with its list item. */
  addAnnotation(cb, text, line = null) {
    const lines = String(cb.code ?? '').split('\n');
    const i = line == null ? lines.length - 1 : Math.max(0, Math.min(line, lines.length - 1));
    const marker = markerFor(cb.language ?? '', (cb.annotations ?? []).length + 1);
    lines[i] = lines[i].trim() ? `${lines[i]} ${marker}` : marker;
    cb.code = lines.join('\n');
    cb.annotations = [...(cb.annotations ?? []), text];
    tidyAnnotations(cb);
  },
  /** Annotation `index` taken out, its marker with it. */
  removeAnnotation(cb, index) {
    const tokens = tokenizeAnnotatedCode(cb.code ?? '');
    const markers = tokens.filter(t => t.type === 'marker');
    if (index < 0 || index >= markers.length) return;
    const gone = markers[index];
    cb.code = serializeTokens(tokens.filter(t => t !== gone), cb.language ?? '', { renumber: false });
    const list = (cb.annotations ?? []).slice();
    list[gone.num - 1] = '';
    cb.annotations = list;
    tidyAnnotations(cb);
  },
  /** A new language: the markers are written as its comments. */
  setLanguage(cb, language) {
    cb.language = language;
    tidyAnnotations(cb);
  },
  setAnnotation(cb, index, text) {
    const list = (cb.annotations ?? []).slice();
    if (index < 0 || index >= list.length) return;
    list[index] = text;
    cb.annotations = list;
    tidyAnnotations(cb);
  },
};

// ── Page settings ────────────────────────────────────────────────────────────
// The page's own settings, in its frontmatter: the form editors' Page settings
// (guides.js pageSettingsDimFields), less Page visibility, which lives in
// zensical.toml and not in the draft.

export const PAGE_HIDES = Object.freeze([
  ['navigation', 'Navigation'],
  ['toc', 'Table of Contents'],
  ['path', 'Path'],
  ['writtenFor', 'Written for'],
]);
const HIDE_VALUE = { navigation: 'navigation', toc: 'toc', path: 'path', writtenFor: 'written-for' };

/** @returns {{ icon: string, writtenFor: string, tags: string[], hide: Record<string, boolean> }} */
export function readPageSettings(md) {
  const hide = readFrontmatterHide(md);
  const { audience, rest } = splitAudience(readFrontmatterTags(md));
  return {
    icon: readFrontmatterIcon(md),
    writtenFor: audience,
    tags: rest,
    hide: Object.fromEntries(PAGE_HIDES.map(([k]) => [k, hide.includes(HIDE_VALUE[k])])),
  };
}

// ── The ops ──────────────────────────────────────────────────────────────────

export const OPS = {
  /**
   * The page's settings (readPageSettings), changed by `change`: any of
   * `icon`, `writtenFor`, `tags` (the free tags), `hide` (some of its keys).
   */
  pageSettings(change) {
    return {
      subject: () => 'Edited page settings',
      apply: md => {
        const now = readPageSettings(md);
        const next = { ...now, ...change, hide: { ...now.hide, ...change.hide } };
        return applyPageSettingsFrontmatter(md, {
          icon: next.icon,
          tags: composeTags(next.writtenFor, next.tags),
          hide: next.hide,
        });
      },
    };
  },

  /**
   * A container's leading text (a section's, an admonition's, a tab's, a grid
   * cell's): the text block it opens with. Emptied, that block goes; with none
   * there, one is put first (`uuid` is its identity, minted by the caller).
   */
  setText(container, text, uuid = null) {
    return {
      key: `text|${container.kind}|${container.uuid}`,
      subject: md => textSubject(md, container),
      apply: md => {
        const body = readContainer(md, container);
        if (!body) throw gone();
        const list = body.components.slice();
        const t = String(text ?? '').trim();
        if (list[0]?.kind === 'text') {
          if (t) list[0] = textBlock(list[0].txt.uuid, t); else list.shift();
        } else if (t) {
          list.unshift(textBlock(uuid ?? derivedUuid(`${container.uuid}|lead`), t));
        }
        return writeContainer(md, container, '', list);
      },
    };
  },

  /**
   * The text block `uuid` holds `text`. When it is not on the page yet it is
   * put at index `at` of `container` (typing into an empty place makes the
   * block). Emptied, it stays, as an empty block: only deleting takes it away.
   */
  putText(uuid, text, container = null, at = 0) {
    return {
      key: `text|${uuid}`,
      subject: md => textSubject(md, findComponent(md, uuid)?.container ?? container ?? {}),
      apply: md => {
        const t = String(text ?? '').trim();
        const hit = findComponent(md, uuid);
        if (hit) return replaceAt(md, hit, textBlock(uuid, t));
        if (!t) return md;
        const body = container && readContainer(md, container);
        if (!body) throw gone('text');
        const list = body.components.slice();
        list.splice(Math.max(0, Math.min(at ?? 0, list.length)), 0, textBlock(uuid, t));
        return writeContainer(md, container, '', list);
      },
    };
  },

  /** One text block cut into a block per paragraph (`uuids`: identities for the new ones, minted by the caller). */
  splitText(uuid, uuids) {
    return {
      subject: md => textSubject(md, findComponent(md, uuid)?.container ?? {}),
      apply: md => {
        const hit = findComponent(md, uuid);
        if (hit?.component.kind !== 'text') throw gone('text');
        const parts = splitParagraphs(hit.component.txt.body);
        if (parts.length < 2) return md;
        const body = readContainer(md, hit.container);
        const list = body.components.slice();
        list.splice(hit.index, 1, ...parts.map((p, i) =>
          textBlock(i === 0 ? uuid : uuids?.[i - 1] ?? derivedUuid(`${uuid}|part|${i}`), p)));
        return writeContainer(md, hit.container, '', list);
      },
    };
  },

  /** A text block joined onto the text block right above it. */
  joinText(uuid) {
    return {
      subject: md => textSubject(md, findComponent(md, uuid)?.container ?? {}),
      apply: md => {
        const hit = findComponent(md, uuid);
        if (hit?.component.kind !== 'text') throw gone('text');
        const body = readContainer(md, hit.container);
        const above = body.components[hit.index - 1];
        if (above?.kind !== 'text' || isPageTitle(above) || isPageTitle(hit.component)) return md;
        const list = body.components.slice();
        list.splice(hit.index - 1, 2, textBlock(above.txt.uuid, [above.txt.body, hit.component.txt.body].filter(b => b.trim()).join('\n\n')));
        return writeContainer(md, hit.container, '', list);
      },
    };
  },

  setSectionTitle(uuid, title) {
    return {
      key: `title|${uuid}`,
      subject: () => `Edited section '${title}'`,
      apply: md => {
        const sec = locateSectionByUUID(md, uuid);
        if (!sec) throw gone('section');
        const lines = md.split('\n');
        lines[sec.headerLine] = `${'#'.repeat(sec.level)} ${title}`;
        return lines.join('\n');
      },
    };
  },

  setHideTitle(uuid, hidden) {
    return {
      subject: md => `Edited section '${sectionTitleOf(md, uuid)}'`,
      apply: md => {
        const sec = locateSectionByUUID(md, uuid);
        if (!sec) throw gone('section');
        // The page's own title stays hidden while one is placed in the content.
        if (!hidden && sec.level === 1 && findPageTitle(md)) return md;
        const { descriptionMarkdown } = readSectionDescription(md, uuid);
        return replaceSectionByUUID(md, uuid,
          buildSection(sec.level, sec.title, uuid, writeHideSectionTitle(descriptionMarkdown, hidden)));
      },
    };
  },

  /**
   * A `# Title` line typed into a text block of a page whose own title is
   * hidden (how a title was placed before there was a block for it: it shows
   * as a title on the site and as raw markdown here) made the placed title:
   * the text above and below it become blocks of their own.
   */
  liftPageTitle() {
    const find = md => {
      if (!canPlacePageTitle(md)) return null;
      for (const hit of walkPage(md)) {
        if (hit.component.kind !== 'text') continue;
        const lines = hit.component.txt.body.split('\n');
        let fence = false;
        for (let i = 0; i < lines.length; i++) {
          if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence;
          else if (!fence && /^#\s+\S/.test(lines[i])) return { hit, lines, at: i };
        }
      }
      return null;
    };
    return {
      subject: md => textSubject(md, find(md)?.hit.container ?? {}),
      apply: md => {
        const found = find(md);
        if (!found) return md;
        const { hit, lines, at } = found;
        const uuid = hit.component.txt.uuid;
        const before = lines.slice(0, at).join('\n').trim();
        const after = lines.slice(at + 1).join('\n').trim();
        const parts = [
          before && textBlock(uuid, before),
          textBlock(before ? derivedUuid(`${uuid}|title`) : uuid, pageTitleBody(lines[at].replace(/^#\s+/, ''))),
          after && textBlock(derivedUuid(`${uuid}|after`), after),
        ].filter(Boolean);
        const list = readContainer(md, hit.container).components.slice();
        list.splice(hit.index, 1, ...parts);
        return writeContainer(md, hit.container, '', list);
      },
    };
  },

  /**
   * A new section as the last child of `parentUuid` (the H1 for a top-level
   * one). With `textUuid` it opens with an empty text block of that identity.
   */
  addSection({ uuid, title, parentUuid, level, textUuid = null }) {
    return {
      subject: md => `Added section '${title}' under '${sectionParentTitle(md, parentUuid)}'`,
      apply: md => {
        if (parentUuid && !locateSectionByUUID(md, parentUuid)) throw gone('section');
        const made = insertSectionUnderParent(md, parentUuid || null, level, title);
        const out = made.markdown.split(made.uuid).join(uuid);
        return textUuid ? writeContainer(out, { kind: TEXT_KIND.section, uuid }, '', [textBlock(textUuid, '')]) : out;
      },
    };
  },

  /**
   * A new top-level section (addSection's `spec`, level 2) at place `at` among
   * the sections of the page, as they stand before it is added: one change.
   */
  addSectionAt(spec, at) {
    const add = OPS.addSection({ ...spec, level: 2 });
    return {
      subject: md => add.subject(md),
      apply: md => OPS.moveSectionTo(spec.uuid, null, at).apply(add.apply(md)),
    };
  },

  /**
   * Pasted markdown with headings in it (parsePastedPage), at index `at` of a
   * section: `components` join the section there, and `sections` follow the
   * section's own content as the file would have them. What stood below `at`
   * goes on under the last pasted heading, where it would be read in the file.
   */
  pasteSections(container, at, components, sections) {
    return {
      subject: md => `Added ${sections.length === 1 ? `section '${sections[0].title}'` : `${sections.length} sections`} after '${sectionTitleOf(md, container.uuid)}'`,
      apply: md => {
        const body = container.kind === TEXT_KIND.section ? readContainer(md, container) : null;
        if (!body) throw gone('section');
        const i = Math.max(0, Math.min(at ?? body.components.length, body.components.length));
        const out = writeContainer(md, container, body.description, [...body.components.slice(0, i), ...clone(components)]);
        const below = body.components.slice(i);
        const added = sections.map((s, k) => buildSection(s.level, s.title, s.uuid,
          buildComponentBody(null, '', writeBlocks([...clone(s.components), ...(k === sections.length - 1 ? below : [])])).replace(/^\n+/, '').trimEnd()));
        const lines = out.split('\n');
        const end = locateSectionByUUID(out, container.uuid).ownedEndLine;
        const above = lines.slice(0, end);
        while (above.length && above[above.length - 1] === '') above.pop();
        const after = lines.slice(end);
        return [...above, '', added.join('\n\n'), '', ...after].join('\n');
      },
    };
  },

  /** A section and everything under it. */
  deleteSection(uuid) {
    return {
      subject: md => `Deleted section '${sectionTitleOf(md, uuid)}'`,
      apply: md => {
        if (!locateSectionByUUID(md, uuid)) throw gone('section');
        return deleteSectionByUUID(md, uuid);
      },
    };
  },

  moveSection(uuid, dir) {
    return {
      subject: () => 'Reordered sections',
      apply: md => {
        if (!locateSectionByUUID(md, uuid)) throw gone('section');
        return moveSectionAmongSiblings(md, uuid, dir);
      },
    };
  },

  /** Under another section, or (`parentUuid` null) back to the top level. */
  reparentSection(uuid, parentUuid) {
    return {
      subject: md => `Moved section '${sectionTitleOf(md, uuid)}' under '${sectionParentTitle(md, parentUuid)}'`,
      apply: md => {
        if (!locateSectionByUUID(md, uuid)) throw gone('section');
        if (parentUuid && !locateSectionByUUID(md, parentUuid)) throw gone('section');
        return moveSectionToParent(md, uuid, parentUuid || null);
      },
    };
  },

  /** Components (already built, identities minted) at index `at` of a container. */
  insertComponents(container, at, components) {
    return {
      subject: md => subjectOf(componentCommit('Added',
        components.length === 1 ? componentKindLabel(components[0]) : `${components.length} components`, md, container.uuid)),
      apply: md => {
        const body = readContainer(md, container);
        if (!body) throw gone();
        const list = body.components.slice();
        // A placed page title goes in only where the page may take one.
        const adding = components.some(isPageTitle) && !canPlacePageTitle(md) ? components.filter(c => !isPageTitle(c)) : components;
        if (!adding.length) return md;
        list.splice(Math.max(0, Math.min(at ?? list.length, list.length)), 0, ...clone(adding));
        return writeContainer(md, container, body.description, list);
      },
    };
  },

  /**
   * One component changed where it stands. `change` is handed a copy to mutate
   * (or returns a replacement); `key` makes it a typing op.
   */
  editComponent(uuid, change, key = undefined) {
    return {
      key,
      subject: md => componentSubject('Edited', md, uuid),
      apply: md => {
        const hit = findComponent(md, uuid);
        if (!hit) throw gone();
        const draft = clone(hit.component);
        return replaceAt(md, hit, change(draft) ?? draft);
      },
    };
  },

  deleteComponent(uuid) {
    return {
      subject: md => componentSubject('Deleted', md, uuid),
      apply: md => {
        const hit = findComponent(md, uuid);
        if (!hit) throw gone();
        return tidyRows(replaceAt(md, hit, null), [rowOf(md, hit.container)]);
      },
    };
  },

  /** One place up or down among the components of its container. */
  moveComponent(uuid, dir) {
    return {
      subject: md => subjectOf(reorderCommit(md, findComponent(md, uuid)?.container.uuid)),
      apply: md => {
        const hit = findComponent(md, uuid);
        if (!hit) throw gone();
        const body = readContainer(md, hit.container);
        const to = hit.index + (dir === 'up' ? -1 : 1);
        if (!body || to < 0 || to >= body.components.length) return md;
        const list = body.components.slice();
        [list[hit.index], list[to]] = [list[to], list[hit.index]];
        return writeContainer(md, hit.container, body.description, list);
      },
    };
  },

  /**
   * A block (a component or a text block) taken to index `at` of `container`:
   * anywhere on the page, its own container included. `at` counts the
   * container's blocks as they stand before the move.
   */
  moveTo(uuid, container, at) {
    return {
      subject: md => {
        const hit = findComponent(md, uuid);
        if (hit && hit.container.uuid === container.uuid) return subjectOf(reorderCommit(md, container.uuid));
        return subjectOf(componentCommit('Moved', componentKindLabel(hit?.component ?? null), md, container.uuid));
      },
      apply: md => {
        const hit = findComponent(md, uuid);
        if (!hit) throw gone();
        if (hit.container.kind === container.kind && hit.container.uuid === container.uuid) {
          const body = readContainer(md, container);
          const to = Math.max(0, Math.min(at > hit.index ? at - 1 : at, body.components.length - 1));
          if (to === hit.index) return md;
          const list = body.components.slice();
          list.splice(to, 0, ...list.splice(hit.index, 1));
          return writeContainer(md, container, '', list);
        }
        if (holds(hit.component, container)) return md; // into itself: nowhere to go
        const without = replaceAt(md, hit, null);
        const dest = readContainer(without, container);
        if (!dest) throw gone();
        const list = dest.components.slice();
        list.splice(Math.max(0, Math.min(at ?? list.length, list.length)), 0, clone(hit.component));
        return tidyRows(writeContainer(without, container, '', list), [rowOf(md, hit.container)]);
      },
    };
  },

  /**
   * Several blocks (in the order they stand on the page) taken together to
   * index `at` of `container`, where they then stand one after another. `at`
   * counts the container's blocks as they stand before the move. Nothing
   * moves when one of them holds the container.
   */
  moveManyTo(uuids, container, at) {
    return {
      subject: md => {
        const hits = uuids.map(u => findComponent(md, u)).filter(Boolean);
        if (hits.length && hits.every(h => h.container.uuid === container.uuid)) return subjectOf(reorderCommit(md, container.uuid));
        return subjectOf(componentCommit('Moved', componentKindLabel(hits[0]?.component ?? null), md, container.uuid));
      },
      apply: md => {
        const hits = uuids.map(u => findComponent(md, u));
        if (hits.some(h => !h)) throw gone();
        if (hits.some(h => holds(h.component, container))) return md; // into one of themselves
        const here = h => h.container.kind === container.kind && h.container.uuid === container.uuid;
        const before = hits.filter(h => here(h) && h.index < at).length;
        const moved = hits.map(h => clone(h.component));
        let without = md;
        for (const uuid of uuids) without = replaceAt(without, findComponent(without, uuid), null);
        const dest = readContainer(without, container);
        if (!dest) throw gone();
        const list = dest.components.slice();
        list.splice(Math.max(0, Math.min((at ?? list.length) - before, list.length)), 0, ...moved);
        const out = writeContainer(without, container, '', list);
        // Already together and in that place: nothing to undo.
        if (hits.every(here) && readContainer(md, container).components.map(uuidOfComponent).join() === list.map(uuidOfComponent).join()) return md;
        return tidyRows(out, hits.map(h => rowOf(md, h.container)));
      },
    };
  },

  /**
   * Blocks (in the order they stand on the page) taken to stand beside
   * something, in a column of their own: to the left or right of a column of
   * a row (`{ cell }`), or of a block that is in no row yet (`{ block }`),
   * which then becomes the other column of a new one. Nothing moves when one
   * of them holds what they would stand beside.
   *
   * @param {string[]} uuids
   * @param {{cell: string} | {block: string}} target
   * @param {'left'|'right'} side
   */
  moveBeside(uuids, target, side) {
    // Minted once: the op gives the same page each time it is applied.
    const column = generateUUID();
    const other = generateUUID();
    const row = generateUUID();
    return {
      subject: md => subjectOf(componentCommit('Moved', componentKindLabel(findComponent(md, uuids[0])?.component ?? null), md, target.cell ?? target.block)),
      apply: md => {
        const hits = uuids.map(u => findComponent(md, u));
        if (hits.some(h => !h)) throw gone();
        if (hits.some(h => holds(h.component, { uuid: target.cell ?? target.block }))) return md;
        // A block that is already in a column: beside it is beside its column
        // (a column holds no rows of its own).
        let cell = target.cell ?? null;
        if (!cell) {
          const at = findComponent(md, target.block);
          if (!at) throw gone();
          if (at.container.kind === TEXT_KIND.cell) cell = at.container.uuid;
        }
        const moved = hits.map(h => clone(h.component));
        // All that column holds is what is moved: it is beside itself.
        if (cell && hits.some(h => h.container.uuid === cell) && readContainer(md, { kind: TEXT_KIND.cell, uuid: cell })?.components.length === hits.filter(h => h.container.uuid === cell).length) return md;
        let out = md;
        for (const uuid of uuids) out = replaceAt(out, findComponent(out, uuid), null);
        if (cell) {
          const owner = findOwner(out, 'cell', cell);
          if (!owner) throw gone('column');
          const cells = owner.component.grid.cells;
          const next = cells.slice();
          next.splice(owner.childIndex + (side === 'right' ? 1 : 0), 0, columnWith(column, moved));
          out = replaceAt(out, owner, { ...owner.component, grid: { ...owner.component.grid, cells: next } });
        } else {
          const at = findComponent(out, target.block);
          if (!at) throw gone();
          const mine = columnWith(column, moved);
          const theirs = columnWith(other, [clone(at.component)]);
          out = replaceAt(out, at, { kind: 'grid', grid: { uuid: row, flavor: 'generic', cells: side === 'left' ? [mine, theirs] : [theirs, mine] } });
        }
        return tidyRows(out, hits.map(h => rowOf(md, h.container)));
      },
    };
  },

  /**
   * New components (already built, identities minted) put beside something,
   * in a column of their own: moveBeside, for things that are not on the page
   * yet. Beside a block that is in a column means beside its column.
   *
   * @param {object[]} components
   * @param {{cell: string} | {block: string}} target
   * @param {'left'|'right'} side
   */
  insertBeside(components, target, side) {
    const column = generateUUID();
    const other = generateUUID();
    const row = generateUUID();
    return {
      subject: md => subjectOf(componentCommit('Added',
        components.length === 1 ? componentKindLabel(components[0]) : `${components.length} components`, md, target.cell ?? target.block)),
      apply: md => {
        const adding = components.some(isPageTitle) && !canPlacePageTitle(md) ? components.filter(c => !isPageTitle(c)) : components;
        if (!adding.length) return md;
        const mine = columnWith(column, clone(adding));
        let cell = target.cell ?? null;
        const at = cell ? null : findComponent(md, target.block);
        if (!cell && !at) throw gone();
        if (at?.container.kind === TEXT_KIND.cell) cell = at.container.uuid;
        if (cell) {
          const owner = findOwner(md, 'cell', cell);
          if (!owner) throw gone('column');
          const next = owner.component.grid.cells.slice();
          next.splice(owner.childIndex + (side === 'right' ? 1 : 0), 0, mine);
          return replaceAt(md, owner, { ...owner.component, grid: { ...owner.component.grid, cells: next } });
        }
        // A row is not put inside a row: beside a grid is a new column of it.
        if (at.component.kind === 'grid') {
          const cells = at.component.grid.cells ?? [];
          return replaceAt(md, at, { ...at.component, grid: { ...at.component.grid, cells: side === 'left' ? [mine, ...cells] : [...cells, mine] } });
        }
        const theirs = columnWith(other, [clone(at.component)]);
        return replaceAt(md, at, { kind: 'grid', grid: { uuid: row, flavor: 'generic', cells: side === 'left' ? [mine, theirs] : [theirs, mine] } });
      },
    };
  },

  /**
   * A cell taken, whole (what it holds, its settings, its identity), to stand
   * beside something: a cell of its own grid or of another (`{ cell }`), or a
   * block that is in no grid (`{ block }`), which then becomes the other cell
   * of a new grid of the same style. The grid it leaves keeps its other cells
   * (setColumns). Nothing moves when it would stand beside itself, or beside
   * something it holds.
   *
   * @param {string} uuid - the cell
   * @param {{cell: string} | {block: string}} target
   * @param {'left'|'right'} side
   */
  moveCellBeside(uuid, target, side) {
    const other = generateUUID();
    const row = generateUUID();
    return {
      subject: md => subjectOf(componentCommit('Edited', 'Grid', md, uuid)),
      apply: md => {
        const from = findOwner(md, 'cell', uuid);
        if (!from) throw gone('grid cell');
        const cells = from.component.grid.cells;
        const moved = clone(cells[from.childIndex]);
        const rest = cells.filter(c => c.uuid !== uuid);
        if (holds({ kind: 'grid', grid: { uuid: '', cells: [moved] } }, { uuid: target.cell ?? target.block })) return md;
        // A block that is in a cell: beside it is beside its cell.
        let beside = target.cell ?? null;
        if (!beside) {
          const at = findComponent(md, target.block);
          if (!at) throw gone();
          if (at.container.kind === TEXT_KIND.cell) beside = at.container.uuid;
        }
        const placed = (list, at) => { const next = list.slice(); next.splice(at + (side === 'right' ? 1 : 0), 0, moved); return next; };
        if (beside) {
          const to = findOwner(md, 'cell', beside);
          if (!to) throw gone('grid cell');
          if (to.component.grid.uuid === from.component.grid.uuid) {
            const next = placed(rest, rest.findIndex(c => c.uuid === beside));
            return next.every((c, i) => c.uuid === cells[i].uuid) ? md : replaceAt(md, from, { ...from.component, grid: { ...from.component.grid, cells: next } });
          }
          const out = setColumns(md, from, rest);
          const dest = findOwner(out, 'cell', beside);
          if (!dest) throw gone('grid cell');
          return replaceAt(out, dest, { ...dest.component, grid: { ...dest.component.grid, cells: placed(dest.component.grid.cells, dest.childIndex) } });
        }
        const out = setColumns(md, from, rest);
        const at = findComponent(out, target.block);
        if (!at) throw gone();
        const theirs = columnWith(other, [clone(at.component)]);
        return replaceAt(out, at, { kind: 'grid', grid: { uuid: row, flavor: from.component.grid.flavor, cells: side === 'left' ? [moved, theirs] : [theirs, moved] } });
      },
    };
  },

  /** A cell deleted, with what it holds. The grid keeps its other cells (setColumns). */
  deleteCell(uuid) {
    return {
      subject: md => subjectOf(componentCommit('Edited', 'Grid', md, uuid)),
      apply: md => {
        const from = findOwner(md, 'cell', uuid);
        if (!from) throw gone('grid cell');
        return setColumns(md, from, from.component.grid.cells.filter(c => c.uuid !== uuid));
      },
    };
  },

  /**
   * A section (and everything under it) taken to place `at` among the
   * sections of `parentUuid` (null: the top level).
   */
  moveSectionTo(uuid, parentUuid, at) {
    return {
      subject: md => {
        const sec = buildSectionTree(md).sections.find(s => s.uuid === uuid);
        const top = buildSectionTree(md).title?.uuid ?? null;
        const same = sec && (sec.level === 2 ? !parentUuid || parentUuid === top : sec.parentUuid === parentUuid);
        return same ? 'Reordered sections'
          : `Moved section '${sectionTitleOf(md, uuid)}' under '${sectionParentTitle(md, parentUuid)}'`;
      },
      apply: md => {
        const tree = () => buildSectionTree(md).sections;
        let sec = tree().find(s => s.uuid === uuid);
        if (!sec || sec.level === 1) throw gone('section');
        const top = buildSectionTree(md).title?.uuid ?? null;
        const parent = parentUuid && parentUuid !== top ? parentUuid : null;
        if (parent && !locateSectionByUUID(md, parent)) throw gone('section');
        const siblingsOf = () => {
          sec = tree().find(s => s.uuid === uuid);
          return tree().filter(s => s.level === sec.level && s.parentUuid === sec.parentUuid);
        };
        let target = at;
        const here = sec.level === 2 ? null : sec.parentUuid;
        if (here === parent) {
          const from = siblingsOf().findIndex(s => s.uuid === uuid);
          if (target > from) target--;
        } else {
          md = moveSectionToParent(md, uuid, parent); // lands last under its new parent
        }
        const sibs = siblingsOf();
        let i = sibs.findIndex(s => s.uuid === uuid);
        target = Math.max(0, Math.min(target, sibs.length - 1));
        for (let guard = 0; i !== target && guard < 500; guard++) {
          const next = moveSectionAmongSiblings(md, uuid, i > target ? 'up' : 'down');
          if (next === md) break;
          md = next;
          i += i > target ? -1 : 1;
        }
        return md;
      },
    };
  },

  /**
   * Several sections of one level (in the order they stand on the page) taken
   * together to place `at` among the sections of `parentUuid`: the first goes
   * there, each of the rest right after the one before it.
   */
  moveSectionsTo(uuids, parentUuid, at) {
    return {
      subject: md => OPS.moveSectionTo(uuids[0], parentUuid, at).subject(md),
      apply: md => {
        let out = OPS.moveSectionTo(uuids[0], parentUuid, at).apply(md);
        for (let i = 1; i < uuids.length; i++) {
          const sections = buildSectionTree(out).sections;
          const prev = sections.find(s => s.uuid === uuids[i - 1]);
          if (!prev) throw gone('section');
          const sibs = sections.filter(s => s.level === prev.level && s.parentUuid === prev.parentUuid);
          out = OPS.moveSectionTo(uuids[i], parentUuid, sibs.findIndex(s => s.uuid === prev.uuid) + 1).apply(out);
        }
        return out;
      },
    };
  },

  /**
   * Several changes made as one (one Undo takes them all back). The commit
   * lists each of them (commitForOps reads `parts`).
   */
  together(ops) {
    return {
      parts: ops,
      subject: md => ops[0]?.subject(md) ?? '',
      apply: md => applyOps(md, ops),
    };
  },

  /**
   * A tab group / grid changed through one of its tabs / cells. `change` is
   * handed a copy of the child list and the child's index, and mutates the
   * list; emptying it removes the whole group / grid.
   */
  editChildren(childKind, childUuid, change, key = undefined) {
    const what = childKind === 'tab' ? 'tab' : 'grid cell';
    return {
      key,
      subject: md => subjectOf(componentCommit('Edited', childKind === 'tab' ? 'Content tabs' : 'Grid', md, childUuid)),
      apply: md => {
        const hit = findOwner(md, childKind, childUuid);
        if (!hit) throw gone(what);
        const draft = clone(hit.component);
        const list = childKind === 'tab' ? draft.grp.tabs : draft.grid.cells;
        change(list, hit.childIndex);
        return replaceAt(md, hit, list.length ? draft : null);
      },
    };
  },
};

// ── Applying and describing a run of ops ─────────────────────────────────────

export function applyOps(md, ops) {
  return ops.reduce((out, op) => op.apply(out), md);
}

/** `md` without its empty text blocks: what is saved (an empty block lives only while the draft is open). */
export function dropEmptyText(md) {
  let out = md;
  for (let guard = 0; guard < 1000; guard++) {
    let hit = null;
    for (const h of walkPage(out)) if (h.component.kind === 'text' && !h.component.txt.body.trim()) { hit = h; break; }
    if (!hit) break;
    // A column that held nothing else goes with it (tidyRow).
    out = tidyRows(replaceAt(out, hit, null), [rowOf(out, hit.container)]);
  }
  return out;
}

// The containers a block is typed into that hold nothing at all: updates,
// admonitions and tabs. Not a section (the Add card adds to it), and not a
// grid cell: an empty one is a spacer someone left on purpose, and dropping a
// cell's last block takes its column away (tidyRows).
function* emptyContainers(md) {
  const empty = body => !parseBody(body).components.length;
  for (const { component: c } of walkPage(md)) {
    if (c.kind === 'admonition' && c.adm.uuid && empty(c.adm.body)) yield { kind: TEXT_KIND.admonition, uuid: c.adm.uuid };
    else if (c.kind === 'tabs') { for (const t of c.grp.tabs ?? []) if (t.uuid && empty(t.body)) yield { kind: TEXT_KIND.tab, uuid: t.uuid }; }
  }
}

/**
 * `md` as the editor holds it while the draft is open: every container with
 * nothing in it gets an empty text block, the place to start typing (a saved
 * file has none: dropEmptyText). Without it an update or admonition saved
 * empty could never be written in again. `like` is the page as it was showing:
 * a block it already had in that place keeps its identity, so a save changes
 * nothing under the caret.
 */
export function seedEmptyText(md, like = null) {
  let out = md;
  for (let guard = 0; guard < 1000; guard++) {
    const { value: container, done } = emptyContainers(out).next();
    if (done) break;
    const was = like && readContainer(like, container)?.components.find(c => c.kind === 'text' && !c.txt.body.trim());
    const next = writeContainer(out, container, '', [was ? textBlock(was.txt.uuid, '') : newText()]);
    if (next === out) break; // a container that will not take one: leave the page as it is
    out = next;
  }
  return out;
}

/**
 * The commit for saving `ops` over `before`: one change keeps the subject the
 * form editors write for it; several are counted, each listed in the body.
 */
export function commitForOps(before, ops) {
  const subjects = [];
  let md = before;
  for (const op of ops.flatMap(o => o.parts ?? [o])) {
    let subject = '';
    try { subject = op.subject(md); } catch { /* a label is never worth failing a save for */ }
    if (subject && !subjects.includes(subject)) subjects.push(subject);
    try { md = op.apply(md); } catch { /* the save itself reports this */ }
  }
  if (subjects.length <= 1) return subjects[0] ?? 'Edited the page';
  return { subject: `Made ${subjects.length} changes to the page`, bodyLines: subjects.map(s => `- ${s}`) };
}
