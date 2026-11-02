// Pure helpers that turn a save into a descriptive commit { subject, bodyLines }
// from the markdown being saved. No DOM, no network; every helper is null-safe
// and never throws (a save must not fail because a label could not be derived).
import { parseSections } from './sections.js';
import { parseAdmonitions, splitTitleMeta, stripInlineAtoms, ADMONITION_TYPE_LABELS } from './admonitions.js';

export const UPDATE_BLOCK_TYPES_RE = /feature-release|new-addition|improvement/;

const quoted = (label, name) => (name ? `${label} '${name}'` : label);
const stripMediaName = f => String(f ?? '')
  .replace(/-light-mode(\.[a-z0-9]+)?$/i, '').replace(/\.[a-z0-9]+$/i, '');

/** Display name (+ own title when it has one) for a parseComponents entry. */
export function componentKindLabel(component) {
  const c = component;
  if (!c) return 'Component';
  switch (c.kind) {
    case 'admonition': {
      if (!c.adm) return 'Component';
      const label = `${ADMONITION_TYPE_LABELS[c.adm.type] ?? c.adm.type} admonition`;
      return quoted(label, stripInlineAtoms(splitTitleMeta(c.adm.title).title));
    }
    case 'codeblock': return quoted('Code block', c.cb?.title);
    case 'capture': return quoted('Capture', stripMediaName(c.cap?.lightFilename));
    case 'video': return quoted('Video', stripMediaName(c.vid?.lightFilename));
    case 'image': return quoted('Image', String(c.img?.filename ?? '').replace(/\.[a-z0-9]+$/i, ''));
    case 'button': return quoted('Button', c.btn?.label);
    case 'navlinks': return 'Nav links';
    case 'diagram': return 'Diagram';
    case 'table': return 'Data table';
    case 'grid': return 'Grid';
    case 'tabs': return 'Content tabs';
    default: return 'Component';
  }
}

export function uuidLineIndex(md, uuid) {
  if (typeof md !== 'string' || !uuid) return -1;
  const needle = `data-uuid="${uuid}"`;
  return md.split('\n').findIndex(l => l.includes(needle));
}

/** Title of the innermost section containing the uuid's line; '' when none. */
export function sectionTitleAt(md, uuid) {
  const idx = uuidLineIndex(md, uuid);
  if (idx < 0) return '';
  let title = '';
  for (const s of parseSections(md)) if (s.headerLine < idx) title = s.title;
  return title;
}

/** The System Update block enclosing the uuid's line (or the block itself). */
export function enclosingUpdate(md, uuid) {
  const idx = uuidLineIndex(md, uuid);
  if (idx < 0) return null;
  const block = parseAdmonitions(md, UPDATE_BLOCK_TYPES_RE)
    .find(b => b.headerLine <= idx && idx < b.endLine);
  if (!block) return null;
  const title = splitTitleMeta(block.title).title
    .replace(/^(Feature release|New addition|Improvement): /, '');
  return { uuid: block.uuid, title };
}

/** `in update 'T'` / `in 'Section'`; '' when neither can be found. */
export function containerPhrase(md, uuid) {
  const upd = enclosingUpdate(md, uuid);
  if (upd) return `in update '${upd.title}'`;
  const sec = sectionTitleAt(md, uuid);
  return sec ? `in '${sec}'` : '';
}

const join = (...parts) => parts.filter(Boolean).join(' ');
const trailer = (md, uuid) => {
  const upd = enclosingUpdate(md, uuid);
  return upd ? [`Item: ${upd.uuid}`] : [];
};

export function componentCommit(verb, kindLabel, md, uuid) {
  let phrase = containerPhrase(md, uuid);
  if (verb === 'Moved') phrase = phrase.replace(/^in /, 'to ');
  return { subject: join(verb, kindLabel, phrase), bodyLines: trailer(md, uuid) };
}

export function reorderCommit(md, containerUuid) {
  return { subject: join('Reordered components', containerPhrase(md, containerUuid)), bodyLines: trailer(md, containerUuid) };
}

export function itemCommit(subject, uuid) {
  return { subject, bodyLines: [`Item: ${uuid}`] };
}

/** Parent uuid -> section title; falsy -> the H1 title. */
export function sectionParentTitle(md, parentUuid) {
  if (typeof md !== 'string') return '';
  const secs = parseSections(md);
  if (!parentUuid) return secs.find(s => s.level === 1)?.title ?? '';
  return secs.find(s => s.uuid === parentUuid)?.title ?? '';
}

/** True when the only change recorded by a save was the component order. */
export function isReorderOnly(changedLabels) {
  return Array.isArray(changedLabels) && changedLabels.length === 1 && changedLabels[0] === 'Component order';
}
