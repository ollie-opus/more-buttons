/**
 * kbAddTray.js — what the in-page editor's "Add" card offers once it is opened
 * (kbPageEditor.js, the foot of the page): one icon for each thing that can be
 * added, and what a click on one or a drag from one may do.
 *
 *   - On a guide every icon can be clicked (the thing goes at the end of the
 *     page) or dragged to where it should go.
 *   - On the System Updates drafts page the three update types are clicked (a
 *     new update goes at the end of the list: it lives inside nothing), and
 *     the components are dragged only, into an update.
 *
 * Pure: no DOM, no chrome.*.
 */

import { UPDATE_TYPES } from './kbUpdates.js';

// In the order they stand on the card. `icon` is a bundled lucide name.
const COMPONENTS = [
  { id: 'text', label: 'Text', icon: 'type' },
  { id: 'pagetitle', label: 'Page title', icon: 'heading-1' },
  { id: 'admonition', label: 'Admonition', icon: 'message-square-warning' },
  { id: 'capture', label: 'Capture', icon: 'camera' },
  { id: 'tabs', label: 'Content tabs', icon: 'panel-top' },
  { id: 'table', label: 'Data table', icon: 'table' },
  { id: 'image', label: 'Image', icon: 'image' },
  { id: 'video', label: 'Video', icon: 'video' },
  { id: 'button', label: 'Button', icon: 'square-mouse-pointer' },
  { id: 'navlinks', label: 'Nav links', icon: 'list-tree' },
  { id: 'diagram', label: 'Diagram', icon: 'workflow' },
  { id: 'codeblock', label: 'Code block', icon: 'square-code' },
  { id: 'paste', label: 'Paste copied markdown', icon: 'clipboard-paste' },
];
const SECTION = { id: 'section', label: 'Section', icon: 'heading-2' };
const UPDATE_ICONS = { improvement: 'circle-arrow-up', 'feature-release': 'sparkles', 'new-addition': 'circle-plus' };

const UPDATE_PREFIX = 'update:';

/** The update type an item id stands for, or null when it is not one. */
export function updateTypeOf(id) {
  return typeof id === 'string' && id.startsWith(UPDATE_PREFIX) ? id.slice(UPDATE_PREFIX.length) : null;
}

/**
 * The card's items, in order.
 *
 * @param {{ updates?: boolean, sections?: boolean, pageTitle?: boolean }} [page]
 *   `updates`: the System Updates drafts page. `sections`: the page has a
 *   section for components to go into (a guide with no heading at all takes
 *   only a section). `pageTitle`: the page may be given a placed title.
 * @returns {{ id: string, label: string, icon: string, click: boolean, drag: boolean, named?: boolean }[]}
 *   `click`: a click adds it at the end of the page. `drag`: it can be dragged
 *   to a place. `named`: it shows its name beside its icon.
 */
export function addTrayItems({ updates = false, sections = true, pageTitle = false } = {}) {
  if (updates) {
    return [
      ...UPDATE_TYPES.map(([type, label]) => ({ id: `${UPDATE_PREFIX}${type}`, label, icon: UPDATE_ICONS[type] ?? 'plus', click: true, drag: false, named: true })),
      // A component lives inside an update: it is dragged into one. A title
      // for the page is a guide's affair.
      ...COMPONENTS.filter(c => c.id !== 'pagetitle').map(c => ({ ...c, click: false, drag: true })),
    ];
  }
  return [
    { ...SECTION, click: true, drag: sections },
    ...(sections ? COMPONENTS.filter(c => c.id !== 'pagetitle' || pageTitle).map(c => ({ ...c, click: true, drag: true })) : []),
  ];
}

/** What a click on a component says on the System Updates page, where it does nothing else. */
export const DRAG_ONLY_HINT = 'Drag this into an update to add it';

/**
 * Whether something dragged from the card may land at `target` (a place read
 * off the page: kbPageDrag blockTarget) on the System Updates drafts page,
 * where a component only ever goes inside an update. `inUpdate(uuid)` says
 * whether the thing of that identity (a block, a cell, a tab, an admonition)
 * is an update or inside one; `sectionKind` is the container kind of a
 * section (the page's own ground, never an update).
 */
export function landsInUpdate(target, sectionKind, inUpdate) {
  if (!target) return false;
  if (target.beside) return !!inUpdate(target.beside.cell ?? target.beside.block);
  return !!target.container?.uuid && target.container.kind !== sectionKind && !!inUpdate(target.container.uuid);
}
