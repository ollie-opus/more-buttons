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
  buildSectionTree, locateSectionByUUID, readSectionDescription, buildSection, replaceSectionByUUID,
  writeHideSectionTitle, insertSectionUnderParent, deleteSectionByUUID, moveSectionAmongSiblings, moveSectionToParent,
} from './sections.js';
import {
  parseBlocks, buildComponentBody, uuidOfComponent, derivedUuid,
  readTabComponents, tabContainerExists, writeTabBody,
  readGridCellComponents, gridCellExists, writeGridCellBody,
} from './components.js';
import { GUIDE_ADMONITION_TYPES_RE, buildAdmonition, replaceAdmonitionByUUID, generateUUID } from './admonitions.js';
import { componentCommit, componentKindLabel, reorderCommit, sectionParentTitle } from './editLogDescribe.js';
import { normalizeForSave, markerFor } from './codeAnnotations.js';
import { TEXT_KIND } from './kbPageRender.js';

// A body as its blocks. `description` is only a reading aid: the words of the
// text block the body opens with ('' when it opens with something else). That
// block is components[0] all the same, and it is `components` that is written.
const leadOf = components => (components[0]?.kind === 'text' ? components[0].txt.body : '');
const parseBody = (body, opts) => {
  const components = parseBlocks(body ?? '', GUIDE_ADMONITION_TYPES_RE, opts).blocks;
  return { description: leadOf(components), components };
};
const sectionBody = (md, uuid) =>
  parseBody(readSectionDescription(md, uuid).descriptionMarkdown, { ownSpan: false, owner: uuid });
// readTabComponents / readGridCellComponents hand the leading text back apart.
const whole = p => ({
  description: p.description,
  components: p.description ? [{ kind: 'text', txt: { uuid: p.descriptionUuid, body: p.description } }, ...p.components] : p.components,
});
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
  return null;
}

/**
 * `md` with a container's body rebuilt from its blocks. The second-to-last
 * argument is unused (the leading text is a block in `components`); it stays
 * so a caller can hand back what readContainer gave it.
 */
export function writeContainer(md, { kind, uuid }, _description, components) {
  const text = '';
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
  throw gone();
}

// A component replaced where it stands (`next` null removes it).
function replaceAt(md, hit, next) {
  const body = readContainer(md, hit.container);
  if (!body) throw gone();
  const list = body.components.slice();
  if (next) list[hit.index] = next; else list.splice(hit.index, 1);
  return writeContainer(md, hit.container, body.description, list);
}

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

const emptyBody = uuid => buildComponentBody(uuid, '', []);

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
      return { kind, cb: { uuid, language: '', title: '', linenums: '', hlLines: '', extra: '', code: '', annotations: [] } };
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
  if (kind === 'capture') return { kind, cap: { uuid, ...files, dimMode: 'none', dimValue: null, inversed: false, rounded: false } };
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
  setAnnotation(cb, index, text) {
    const list = (cb.annotations ?? []).slice();
    if (index < 0 || index >= list.length) return;
    list[index] = text;
    cb.annotations = list;
    tidyAnnotations(cb);
  },
};

// ── The ops ──────────────────────────────────────────────────────────────────

export const OPS = {
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
   * block); emptied, it is taken away.
   */
  putText(uuid, text, container = null, at = 0) {
    return {
      key: `text|${uuid}`,
      subject: md => textSubject(md, findComponent(md, uuid)?.container ?? container ?? {}),
      apply: md => {
        const t = String(text ?? '').trim();
        const hit = findComponent(md, uuid);
        if (hit) return replaceAt(md, hit, t ? textBlock(uuid, t) : null);
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
        if (above?.kind !== 'text') return md;
        const list = body.components.slice();
        list.splice(hit.index - 1, 2, textBlock(above.txt.uuid, `${above.txt.body}\n\n${hit.component.txt.body}`));
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
        const { descriptionMarkdown } = readSectionDescription(md, uuid);
        return replaceSectionByUUID(md, uuid,
          buildSection(sec.level, sec.title, uuid, writeHideSectionTitle(descriptionMarkdown, hidden)));
      },
    };
  },

  /** A new, empty section as the last child of `parentUuid` (the H1 for a top-level one). */
  addSection({ uuid, title, parentUuid, level }) {
    return {
      subject: md => `Added section '${title}' under '${sectionParentTitle(md, parentUuid)}'`,
      apply: md => {
        if (parentUuid && !locateSectionByUUID(md, parentUuid)) throw gone('section');
        const made = insertSectionUnderParent(md, parentUuid || null, level, title);
        return made.markdown.split(made.uuid).join(uuid);
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
        list.splice(Math.max(0, Math.min(at ?? list.length, list.length)), 0, ...clone(components));
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
        return replaceAt(md, hit, null);
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
        return writeContainer(without, container, '', list);
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

/**
 * The commit for saving `ops` over `before`: one change keeps the subject the
 * form editors write for it; several are counted, each listed in the body.
 */
export function commitForOps(before, ops) {
  const subjects = [];
  let md = before;
  for (const op of ops) {
    let subject = '';
    try { subject = op.subject(md); } catch { /* a label is never worth failing a save for */ }
    if (subject && !subjects.includes(subject)) subjects.push(subject);
    try { md = op.apply(md); } catch { /* the save itself reports this */ }
  }
  if (subjects.length <= 1) return subjects[0] ?? 'Edited the page';
  return { subject: `Made ${subjects.length} changes to the page`, bodyLines: subjects.map(s => `- ${s}`) };
}
