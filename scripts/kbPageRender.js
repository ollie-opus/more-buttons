/**
 * kbPageRender.js — draws a guide page's markdown as the HTML the published
 * Knowledge Base site would show, for the in-page editor (kbPageEditor.js).
 *
 * The site build lags a commit by minutes, so the editor never trusts the built
 * article: it reads the draft from GitHub and renders it here, using the SAME
 * model the form editor uses (sections → an ordered list of blocks), so
 * every rendered node carries the identity the editors address it by:
 *
 *   data-mb-node="<uuid>"  data-mb-kind="section|admonition|tabs|tab|grid|cell|leaf"
 *   data-mb-comp="<component kind>"                      (leaves only)
 *   .mb-kb-text  data-mb-text="block"  data-mb-uuid="<text uuid>"
 *                              (a text block: a leaf like any other, its node
 *                              carrying data-mb-comp="text")
 *                              carrying data-mb-comp="text"; `.--empty` when
 *                              it holds no words yet)
 *   .mb-kb-newtab  data-mb-newtab="<tab group uuid>"   (opts.insertSlots: ends a label row)
 *   .mb-kb-insert  data-mb-insert-kind="<container kind>"  data-mb-insert-uuid
 *                  data-mb-insert-at="<component index>"
 *                              (opts.insertSlots: every place a component can go)
 *   data-mb-edit="<what>"  data-mb-uuid="<uuid>"
 *                              (a piece edited where it stands, beyond the text
 *                              blocks and headings: adm-title, tab-title, cell
 *                              (+ data-mb-row / data-mb-col, row -1 = header),
 *                              btn-label, code, annotation (+ data-mb-index),
 *                              diagram)
 *
 * The markup mirrors the theme's (admonition / tabbed-set / grid / md-button …)
 * so the site's own stylesheets do the styling. Two kinds can't be drawn
 * without the site's scripts (mermaid diagrams, nav links): they render a
 * placeholder carrying data-mb-built-slot="<uuid>", which the editor fills with
 * the node the built page already rendered, when there is one.
 *
 * Pure: no DOM, no chrome.*.
 */

import { buildSectionTree, readSectionDescription } from './sections.js';
import { parseBlocks, componentMarkdown, uuidOfComponent } from './components.js';
import { parseCellMedia } from './dataTables.js';
import { iconToShortcode } from './mdButtons.js';
import { GUIDE_ADMONITION_TYPES_RE, ADMONITION_TYPE_LABELS, splitTitleMeta } from './admonitions.js';
import { parseInline, renderHtml, renderDocHtml, matchListLine } from './markdownInline.js';
import { codeInnerHtml, markerLines, lineNumbers, lineCount } from './kbCode.js';
import { readFrontmatterTags, readFrontmatterHide } from './frontmatter.js';
import { writtenForPills } from './audienceTags.js';
import { UPDATE_TYPE_LABELS, splitUpdateTitle, updateComponents, updatesPageTitle, liveUpdateGroups } from './kbUpdates.js';

// Registry kinds (componentContainers.js) of the four things that own text.
export const TEXT_KIND = {
  section: 'guide-section',
  admonition: 'guide-admonition',
  tab: 'content-tab',
  cell: 'grid-cell',
};

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = s => esc(s).replace(/"/g, '&quot;');
// A container's body as one ordered list of blocks, its text among them.
// What an empty text block holds in the working draft. The page format has no
// empty text block (a span with nothing under it is no block), so one that is
// still to be typed into carries this, and reads everywhere as ''. It never
// reaches the saved file: kbPageOps.dropEmptyText takes such blocks out.
export const EMPTY_TEXT = '<!-- -->';
/** Blocks as the editors hold them: an empty text block's body is ''. */
export const readBlocks = blocks => blocks.map(c =>
  (c.kind === 'text' && c.txt.body.trim() === EMPTY_TEXT ? { kind: 'text', txt: { ...c.txt, body: '' } } : c));

const parseBody = (body, opts) => ({ components: readBlocks(parseBlocks(body ?? '', GUIDE_ADMONITION_TYPES_RE, opts).blocks) });

// A page title placed in the content. A page whose own title (its `#` line)
// is hidden can show a title anywhere else: a text block holding one line,
//
//   <h1 class="mb-page-title">Its words</h1>
//
// An h1 tag and not a `#` line: at the top of a section a `#` line would be
// read as a section. Plain words only. A page holds at most one
// (kbPageOps.js keeps it so: it is never copied, and a paste leaves it out).
const PAGE_TITLE_RE = /^<h1 class="mb-page-title">(.*)<\/h1>$/;
/** Every placed-title line in a run of markdown, however deep it is indented. */
export const PAGE_TITLE_LINES_RE = /^[ \t]*<h1 class="mb-page-title">.*<\/h1>[ \t]*\n?/gm;
const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
/** The words of a placed page title, when a text block's body is one; else null. */
export function readPageTitle(body) {
  const m = PAGE_TITLE_RE.exec(String(body ?? '').trim());
  return m ? unesc(m[1]) : null;
}
/** A text block's body for a placed page title. */
export const pageTitleBody = text => `<h1 class="mb-page-title">${esc(String(text ?? '').replace(/\s+/g, ' ').trim())}</h1>`;

const UUID_SPAN_RE = /<span[^>]*data-uuid="[^"]*"[^>]*><\/span>/g;
const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)(?:\{([^}]*)\})?/g;
const FENCE_RE = /^\s*```/;
const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

/** `../assets/x.png#only-light` (any depth of `../`) → the site-root asset path. */
export function assetPathOf(src) {
  const m = /^(?:\.\.\/)+(assets\/[^#?]+)([#?].*)?$/.exec(src ?? '');
  return m ? { path: m[1], suffix: m[2] ?? '' } : null;
}

// Nothing authored may run or navigate somewhere surprising inside the editor,
// so every tag here is rebuilt from an allowlist, never passed through.

/** A url safe to put in href/src: http(s), mailto, tel or relative; else '#'. */
export function safeUrl(url) {
  const u = String(url ?? '').trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(u.replace(/[\u0000-\u0020]/g, ''))?.[1]?.toLowerCase();
  return !scheme || ['http', 'https', 'mailto', 'tel'].includes(scheme) ? u : '#';
}

// Inline style limited to the sizing declarations the editors write.
const STYLE_DECL_RE = /^(height|width|max-width|max-height|border-radius|align-self)\s*:\s*[a-z0-9.% -]+$/i;
function safeStyle(style) {
  return String(style ?? '').split(';').map(d => d.trim()).filter(d => STYLE_DECL_RE.test(d)).join('; ');
}

// attr_list block (`style="…" width="300" loading=lazy .class`) → html attrs,
// keeping only presentational attributes (no handlers, no href/src overrides).
const ATTR_ALLOW = new Set(['width', 'height', 'loading', 'target', 'rel', 'title']);
function attrListHtml(block) {
  const classes = [];
  const attrs = [];
  const re = /\.([\w-]+)|#([\w-]+)|([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))/g;
  let m;
  while ((m = re.exec(block ?? ''))) {
    if (m[1]) { classes.push(m[1]); continue; }
    if (m[2]) continue;
    const name = m[3].toLowerCase();
    const value = m[4] ?? m[5] ?? m[6] ?? '';
    if (name === 'style') { const st = safeStyle(value); if (st) attrs.push(`style="${escAttr(st)}"`); }
    else if (ATTR_ALLOW.has(name)) attrs.push(`${name}="${escAttr(value)}"`);
  }
  if (classes.length) attrs.unshift(`class="${escAttr(classes.join(' '))}"`);
  return attrs.length ? ' ' + attrs.join(' ') : '';
}

// The inline renderer (shared with the rich text editor) emits links verbatim.
const neutraliseHrefs = html => html.replace(/\shref="([^"]*)"/g,
  (_, href) => ` href="${escAttr(safeUrl(href.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')))}"`);

function makeCtx(opts) {
  return {
    assetUrl: opts.assetUrl ?? (src => src),
    insertSlots: !!opts.insertSlots,
    tabSeq: 0,
  };
}

function imgHtml(ctx, alt, src, attrBlock) {
  return `<img alt="${escAttr(alt)}" src="${escAttr(safeUrl(ctx.assetUrl(src)))}"${attrListHtml(attrBlock)}>`;
}

// One run of inline markdown: the editor's own inline grammar (marks, links,
// label pills, icons) plus images, which only table cells and media lines carry.
function inlineHtml(ctx, text) {
  const src = String(text ?? '').replace(UUID_SPAN_RE, '');
  let out = '';
  let last = 0;
  IMAGE_RE.lastIndex = 0;
  let m;
  const run = text => neutraliseHrefs(renderHtml(parseInline(text)));
  while ((m = IMAGE_RE.exec(src))) {
    out += run(src.slice(last, m.index));
    out += imgHtml(ctx, m[1], m[2], m[3]);
    last = m.index + m[0].length;
  }
  return out + run(src.slice(last));
}

/**
 * A container's own text as page HTML: blank-line separated paragraphs (single
 * newlines are soft wraps, as on the site), lists, rules, and fences verbatim.
 */
export function textHtml(ctx, description) {
  const lines = String(description ?? '').split('\n');
  const out = [];
  let para = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inlineHtml(ctx, para.join(' '))}</p>`);
    para = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { flush(); i++; continue; }
    if (FENCE_RE.test(line)) {
      let j = i + 1;
      while (j < lines.length && !FENCE_RE.test(lines[j])) j++;
      flush();
      out.push(`<div class="highlight"><pre><code>${esc(lines.slice(i + 1, j).join('\n'))}</code></pre></div>`);
      i = j + 1;
      continue;
    }
    if (HR_RE.test(line)) { flush(); out.push('<hr>'); i++; continue; }
    if (matchListLine(line)) {
      let j = i + 1;
      while (j < lines.length && (matchListLine(lines[j]) || (lines[j].trim() && /^\s{2,}/.test(lines[j])))) j++;
      flush();
      out.push(neutraliseHrefs(renderDocHtml(lines.slice(i, j).join('\n')))); // list items carry links too
      i = j;
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flush();
  return out.join('\n');
}

// A text block, as the leaf it is.
function textBlock(ctx, txt) {
  const html = textHtml(ctx, txt.body);
  return `<div class="mb-kb-text${html ? '' : ' --empty'}" data-mb-text="block" data-mb-uuid="${escAttr(txt.uuid)}">${html}</div>`;
}

// A container's whole content: its blocks. Nothing stands in for text that is
// not there; a new container is given an empty text block of its own.
function bodyHtml(ctx, body, container, opts) {
  return componentsHtml(ctx, parseBody(body, opts).components, container);
}

/** A text block's inner HTML on its own (the editor redraws one block with it). */
export function renderTextHtml(description, opts = {}) {
  return textHtml(makeCtx(opts), description);
}

/** A heading's inner HTML on its own. */
export function renderInlineHtml(text, opts = {}) {
  return inlineHtml(makeCtx(opts), text);
}

// One place a component can be inserted: before component `at` of a container
// (`at` === its component count means after the last one). Only containers
// with an identity get slots: the insert flows address them by uuid.
function insertSlot(ctx, container, at) {
  if (!ctx.insertSlots || !container?.uuid) return '';
  return `<div class="mb-kb-insert" data-mb-insert-kind="${container.kind}" data-mb-insert-uuid="${escAttr(container.uuid)}" data-mb-insert-at="${at}"></div>`;
}

// ── Leaves ───────────────────────────────────────────────────────────────────

// `data-mb-edit` attributes for one in-place editable piece of a component
// (none when the component has no identity to address the edit by).
function editAttrs(uuid, what, extra = '') {
  return uuid ? ` data-mb-edit="${what}" data-mb-uuid="${escAttr(uuid)}"${extra}` : '';
}

// Every cell is edited where it stands, except one that holds a capture or an
// image (a media cell is not inline text). Rows are drawn to the column count.
function tableHtml(ctx, tbl) {
  const cols = tbl.align?.length || (tbl.header ?? []).length;
  const fit = cells => Array.from({ length: cols }, (_, i) => cells?.[i] ?? '');
  const align = i => (tbl.align?.[i] && tbl.align[i] !== 'none' ? ` style="text-align: ${escAttr(tbl.align[i])}"` : '');
  const cell = (tag, text, row, col) => {
    const media = parseCellMedia(text);
    const edit = media.capture || media.image ? '' : editAttrs(tbl.uuid, 'cell', ` data-mb-row="${row}" data-mb-col="${col}"`);
    return `<${tag}${align(col)}${edit}>${inlineHtml(ctx, text)}</${tag}>`;
  };
  const head = fit(tbl.header).map((h, i) => cell('th', h, -1, i)).join('');
  const rows = (tbl.rows ?? []).map((r, ri) => `<tr>${fit(r).map((c, i) => cell('td', c, ri, i)).join('')}</tr>`).join('');
  const table = `<div class="md-typeset__scrollwrap"><div class="md-typeset__table"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div></div>`;
  return tbl.wrap === false ? `<div class="nowrap-first">${table}</div>` : table;
}

/** One code annotation's inner HTML (the editor redraws a list item with it). */
export function annotationHtml(text) {
  return neutraliseHrefs(renderHtml(parseInline(String(text ?? ''))));
}

// Drawn as the live page draws it (kbCode.js): markers are Zensical's (+)
// bubbles, highlighted lines are painted behind the code from `data-mb-hl`.
// Only annotations no marker points at are listed under the block.
function codeBlockHtml(cb) {
  const title = cb.title ? `<span class="filename">${esc(cb.title)}</span>` : '';
  const markers = markerLines(cb.code).length;
  const orphans = (cb.annotations ?? []).slice(markers);
  const notes = orphans.length
    ? `<ol class="mb-kb-annotations" start="${markers + 1}">${orphans.map((a, i) => `<li${editAttrs(cb.uuid, 'annotation', ` data-mb-index="${markers + i}"`)}>${annotationHtml(a)}</li>`).join('')}</ol>` : '';
  const block = cb.uuid ? ` data-mb-code="${escAttr(cb.uuid)}"` : '';
  // Line numbers in a gutter left of the code, as the site's table style draws them.
  const nums = cb.linenums ? ` data-mb-linenums="${escAttr(cb.linenums)}"` : '';
  const gutter = cb.linenums ? `<span class="mb-kb-code-nums" aria-hidden="true">${lineNumbers(lineCount(cb.code), cb.linenums)}</span>` : '';
  return `<div class="highlight mb-kb-code${cb.language ? ` language-${escAttr(cb.language)}` : ''}"${block}>${title}`
    + `<pre data-mb-hl="${escAttr(cb.hlLines ?? '')}"${nums}>${gutter}<code${editAttrs(cb.uuid, 'code')}>${codeInnerHtml(cb.code)}</code></pre></div>${notes}`;
}

const BUTTON_LINE_RE = /^\[(.*)\]\(([^)]*)\)\{\s*(.*?)\s*\}\s*$/;
// The label is its own node so it can be edited without the icon beside it.
function buttonHtml(ctx, btn, md) {
  const m = BUTTON_LINE_RE.exec(md.trim());
  if (!m) return `<p>${inlineHtml(ctx, md)}</p>`;
  const label = `<span${editAttrs(btn.uuid, 'btn-label')}>${inlineHtml(ctx, btn.label ?? '')}</span>`;
  const icon = btn.icon ? ` ${inlineHtml(ctx, iconToShortcode(btn.icon))}` : '';
  return `<p><a href="${escAttr(safeUrl(m[2]))}"${attrListHtml(m[3])}>${label}${icon}</a></p>`;
}

// A <video> line is read for its src and the handful of attributes the video
// editor writes, then rebuilt: the source tag itself never reaches the page.
const VIDEO_FLAGS = ['autoplay', 'loop', 'muted', 'playsinline', 'controls'];
function videoHtml(ctx, line) {
  const tag = /^<video\b([^>]*)>/i.exec(line.trim())?.[1] ?? '';
  const src = /\ssrc="([^"]*)"/i.exec(tag)?.[1];
  if (!src) return '';
  const attrs = [`src="${escAttr(safeUrl(ctx.assetUrl(src)))}"`];
  for (const flag of VIDEO_FLAGS) if (new RegExp(`\\s${flag}(?=[\\s=]|$)`, 'i').test(tag)) attrs.push(flag);
  const preload = /\spreload="(none|metadata|auto)"/i.exec(tag)?.[1];
  if (preload) attrs.push(`preload="${preload.toLowerCase()}"`);
  const style = safeStyle(/\sstyle="([^"]*)"/i.exec(tag)?.[1]);
  if (style) attrs.push(`style="${escAttr(style)}"`);
  const width = /\swidth="(\d+)"/i.exec(tag)?.[1];
  if (width) attrs.push(`width="${width}"`);
  return `<video ${attrs.join(' ')}></video>`;
}

// Media lines are either markdown images or <video> tags.
function mediaHtml(ctx, md) {
  const parts = md.split('\n').filter(l => l.trim())
    .map(line => (/^\s*<video\b/i.test(line) ? videoHtml(ctx, line) : inlineHtml(ctx, line)))
    .filter(Boolean);
  return `<p>${parts.join('\n')}</p>`;
}

function builtSlot(uuid, label, detail) {
  return `<div class="mb-kb-placeholder" data-mb-built-slot="${escAttr(uuid)}"><strong>${esc(label)}</strong><span>${esc(detail)}</span></div>`;
}

function leafHtml(ctx, c) {
  if (c.kind === 'table') return tableHtml(ctx, c.tbl);
  if (c.kind === 'codeblock') return codeBlockHtml(c.cb);
  if (c.kind === 'diagram') {
    // The drawing is the site's; its source sits under it, edited as text.
    return builtSlot(c.dia.uuid, 'Diagram', 'Drawn by the site, so it shows here after the next site build.')
      + `<pre class="mb-kb-source"><code${editAttrs(c.dia.uuid, 'diagram')}>${esc(c.dia.code)}</code></pre>`;
  }
  if (c.kind === 'navlinks') {
    const what = c.nav.tag ? `tagged "${c.nav.tag}"` : c.nav.path ? `under "${c.nav.path}"` : '';
    return builtSlot(c.nav.uuid, 'Nav links', `Links to pages ${what}. Filled in by the site, so it shows here after the next site build.`.replace('  ', ' '));
  }
  const md = componentMarkdown(c);
  if (c.kind === 'button') return buttonHtml(ctx, c.btn, md);
  return mediaHtml(ctx, md); // capture | image | video
}

// ── Containers ───────────────────────────────────────────────────────────────

function nodeAttrs(uuid, kind, extra = '') {
  return ` data-mb-node="${escAttr(uuid ?? '')}" data-mb-kind="${kind}"${extra}`;
}

function admonitionHtml(ctx, adm) {
  const { title, meta } = splitTitleMeta(adm.title ?? '');
  // A step numbers itself and takes no title of its own. One with a meta
  // holds the meta alone: the site writes its "Step N" above that itself
  // (admonitions.css), and the type's name here would be a second title.
  const step = adm.type === 'step';
  const shown = step && meta && !title ? '' : inlineHtml(ctx, title || ADMONITION_TYPE_LABELS[adm.type] || adm.type);
  const own = step ? shown : `<span${editAttrs(adm.uuid, 'adm-title')}>${shown}</span>`;
  const titleHtml = own + (meta ? `<span class="meta">${esc(meta)}</span>` : '');
  const inner = bodyHtml(ctx, adm.body, { kind: TEXT_KIND.admonition, uuid: adm.uuid });
  const type = escAttr(adm.type);
  const prefix = adm.prefix ?? '';
  if (prefix.startsWith('???')) {
    // Drawn as configured: `???+` open, `???` closed. The editor keeps the
    // ones its user has folded or opened that way through a redraw.
    const open = prefix.startsWith('???+') ? ' open' : '';
    return `<details class="${type}"${open}${nodeAttrs(adm.uuid, 'admonition', ` data-mb-fold="${escAttr(prefix)}"`)}><summary data-mb-title>${titleHtml}</summary>${inner}</details>`;
  }
  return `<div class="admonition ${type}"${nodeAttrs(adm.uuid, 'admonition')}><p class="admonition-title" data-mb-title>${titleHtml}</p>${inner}</div>`;
}

// An update on the System Updates drafts page (kbUpdates.js). Its title line
// is three pieces: the type's name (the type is changed from the icon), the
// update's own title (typed in place) and its release date (picked from a
// calendar). Both show what they are for while empty; the title is needed to
// save, the date only to publish.
export const UPDATE_TITLE_PLACEHOLDER = 'Update title';
export const UPDATE_DATE_PLACEHOLDER = 'Date of release';
function updateHtml(ctx, adm) {
  const { title, date } = splitUpdateTitle(adm.type, adm.title);
  const label = `<span class="mb-kb-upd-label">${esc(UPDATE_TYPE_LABELS[adm.type] ?? adm.type)}: </span>`;
  const own = `<span class="mb-kb-upd-title"${editAttrs(adm.uuid, 'adm-title')}>${inlineHtml(ctx, title)}</span>`;
  const when = `<span class="meta mb-kb-upd-date${date ? '' : ' --empty'}" data-mb-date="${escAttr(adm.uuid)}" role="button" tabindex="0" aria-label="${UPDATE_DATE_PLACEHOLDER}">${esc(date || UPDATE_DATE_PLACEHOLDER)}</span>`;
  const inner = bodyHtml(ctx, adm.body, { kind: TEXT_KIND.admonition, uuid: adm.uuid });
  // Closed, as on the live page: the editor opens the ones its user has opened.
  return `<details class="${escAttr(adm.type)}"${nodeAttrs(adm.uuid, 'admonition', ' data-mb-update')}><summary data-mb-title>${label}${own}${when}</summary>${inner}</details>`;
}

// An update that has been published and is waiting for the site to build it
// (kbPageEditor.js keeps the list). It is no longer in the drafts file: it is
// drawn from the copy kept at publish, greyed, with nothing in it to edit or
// point at (no identities, no editing hooks). It can still be opened and
// closed, to be read: the editor makes what is under its title line inert.
export const PUBLISHING_NOTE = 'Publishing: building and deploying to the live page. This usually takes a few minutes.';
function publishingHtml(ctx, { adm, open }) {
  const slots = ctx.insertSlots;
  ctx.insertSlots = false; // nothing is added to it
  const html = updateHtml(ctx, adm);
  ctx.insertSlots = slots;
  const drawn = html
    .replace(/ data-mb-[a-z-]+(?:="[^"]*")?/g, '')
    .replace(/ (?:role="button"|tabindex="0")/g, '')
    .replace(/^<details /, open ? '<details open ' : '<details ');
  return `<div class="mb-kb-upd-ghost" data-mb-ghost="${escAttr(adm.uuid)}">`
    + `<p class="mb-kb-upd-ghost__note" role="status"><span class="mb-kb-upd-ghost__spin" aria-hidden="true"></span><span class="mb-kb-upd-ghost__text">${esc(PUBLISHING_NOTE)}</span></p>`
    + `<div class="mb-kb-upd-ghost__body">${drawn}</div></div>`;
}

// In the editor (insert slots on) a group's label row ends with a ghost
// "New tab". (A tab has no Add card of its own: the plus beside its text adds
// below it, and anything can be dragged in.)
// Neither is a label or a block: both are the editor's own chrome.
const editButton = (cls, attr, uuid, text) =>
  `<button type="button" class="${cls}" ${attr}="${escAttr(uuid)}"><span class="${cls}__plus" aria-hidden="true"></span><span>${text}</span></button>`;

function tabsHtml(ctx, grp) {
  const n = ++ctx.tabSeq;
  const tabs = grp.tabs ?? [];
  const inputs = tabs.map((_, i) => `<input${i === 0 ? ' checked="checked"' : ''} id="__mbtab_${n}_${i + 1}" name="__mbtab_${n}" type="radio">`).join('');
  const labels = tabs.map((t, i) => `<label for="__mbtab_${n}_${i + 1}"${editAttrs(t.uuid, 'tab-title')}>${inlineHtml(ctx, t.title ?? '')}</label>`).join('');
  const newTab = ctx.insertSlots && grp.uuid ? editButton('mb-kb-newtab', 'data-mb-newtab', grp.uuid, 'New tab') : '';
  const blocks = tabs.map(t => `<div class="tabbed-block"${nodeAttrs(t.uuid, 'tab')}>${bodyHtml(ctx, t.body, { kind: TEXT_KIND.tab, uuid: t.uuid })}</div>`).join('');
  return `<div class="tabbed-set tabbed-alternate" data-tabs="${n}:${tabs.length}"${nodeAttrs(grp.uuid, 'tabs')}>${inputs}<div class="tabbed-labels">${labels}${newTab}</div><div class="tabbed-content">${blocks}</div></div>`;
}
const ALIGN_SELF = { top: 'start', middle: 'center', bottom: 'end' };
function gridHtml(ctx, grid) {
  const cells = (grid.cells ?? []).map(cell => {
    const classes = [grid.flavor === 'card' ? 'card' : '', cell.spill ? 'spill' : ''].filter(Boolean).join(' ');
    const style = ALIGN_SELF[cell.valign] ? ` style="align-self: ${ALIGN_SELF[cell.valign]}"` : '';
    return `<div${classes ? ` class="${classes}"` : ''}${style}${nodeAttrs(cell.uuid, 'cell')}>${bodyHtml(ctx, cell.body, { kind: TEXT_KIND.cell, uuid: cell.uuid })}</div>`;
  }).join('');
  return `<div class="grid"${nodeAttrs(grid.uuid, 'grid')}>${cells}</div>`;
}

// A container's components, in order. With insert slots on, one slot sits
// before each component and one after the last (`container` is { kind, uuid }).
function componentsHtml(ctx, components, container = null) {
  const list = components ?? [];
  const parts = [];
  list.forEach((c, i) => {
    const slot = insertSlot(ctx, container, i);
    if (slot) parts.push(slot);
    if (c.kind === 'admonition') parts.push(admonitionHtml(ctx, c.adm));
    else if (c.kind === 'tabs') parts.push(tabsHtml(ctx, c.grp));
    else if (c.kind === 'grid') parts.push(gridHtml(ctx, c.grid));
    else if (c.kind === 'text' && readPageTitle(c.txt.body) != null) {
      parts.push(`<div class="mb-kb-leaf"${nodeAttrs(c.txt.uuid, 'leaf', ' data-mb-comp="title"')}><h1 class="mb-page-title"${editAttrs(c.txt.uuid, 'page-title')}>${esc(readPageTitle(c.txt.body))}</h1></div>`);
    }
    else if (c.kind === 'text') parts.push(`<div class="mb-kb-leaf"${nodeAttrs(c.txt.uuid, 'leaf', ' data-mb-comp="text"')}>${textBlock(ctx, c.txt)}</div>`);
    else parts.push(`<div class="mb-kb-leaf"${nodeAttrs(uuidOfComponent(c), 'leaf', ` data-mb-comp="${c.kind}"`)}>${leafHtml(ctx, c)}</div>`);
  });
  const end = insertSlot(ctx, container, list.length);
  if (end) parts.push(end);
  return parts.join('\n');
}

const headingId = title => String(title ?? '').toLowerCase().replace(/<[^>]*>/g, '').replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');

/**
 * @param {string} markdown - the page file (frontmatter and all)
 * @param {{assetUrl?: (src: string) => string, insertSlots?: boolean, updates?: boolean}} [opts]
 *   `updates`: the page is the System Updates drafts page, a list of updates
 *   under a title that is not edited (kbUpdates.js). `publishing`: updates
 *   published and not yet on the live site, `{ adm, index, open }` each, drawn
 *   greyed and read only at the place (`index`) they had in the list.
 *   `updatesLive`: the page is the live System Updates page, drawn as its
 *   headings and updates only (kbUpdates.js liveUpdateGroups).
 * @returns {{ html: string, title: string }} `title` is the H1's text ('' when
 *   the page has no sections).
 */
export function renderGuidePage(markdown, opts = {}) {
  const ctx = makeCtx(opts);
  const md = markdown ?? '';
  if (opts.updatesLive) {
    // The live System Updates page: its headings and its updates, nothing else.
    const title = updatesPageTitle(md);
    const groups = liveUpdateGroups(md).map(g =>
      [`<h${g.level} id="${escAttr(headingId(g.heading))}">${inlineHtml(ctx, g.heading)}</h${g.level}>`, ...g.updates.map(adm => updateHtml(ctx, adm))].join('\n'));
    return { html: `<h1>${inlineHtml(ctx, title)}</h1>\n${groups.join('\n')}`, title };
  }
  if (opts.updates) {
    const title = updatesPageTitle(md);
    const updates = updateComponents(md).map(c => updateHtml(ctx, c.adm));
    for (const ghost of [...(opts.publishing ?? [])].sort((a, b) => a.index - b.index)) {
      updates.splice(Math.max(0, Math.min(ghost.index ?? updates.length, updates.length)), 0, publishingHtml(ctx, ghost));
    }
    const none = updates.length ? '' : '\n<p class="mb-kb-upd-none">No updates are waiting to be published.</p>';
    return { html: `<h1>${inlineHtml(ctx, title)}</h1>\n${updates.join('\n')}${none}`, title };
  }
  const tree = buildSectionTree(md);
  // Two headings of one name get distinct ids, as the site gives them
  // (`name`, `name_1`, …): "On this page" links to each (kbToc.js).
  const used = new Map();
  const uniqueId = title => {
    const id = headingId(title);
    const n = used.get(id) ?? 0;
    used.set(id, n + 1);
    return n ? `${id}_${n}` : id;
  };
  const html = (tree.sections ?? []).map(s => {
    const { descriptionMarkdown, hideTitle } = readSectionDescription(md, s.uuid);
    const container = { kind: TEXT_KIND.section, uuid: s.uuid };
    const hidden = hideTitle ? ' data-mb-title-hidden' : '';
    const heading = inlineHtml(ctx, s.title);
    return `<h${s.level} id="${escAttr(uniqueId(s.title))}"${nodeAttrs(s.uuid, 'section')}${hidden}>${heading}</h${s.level}>\n`
      + bodyHtml(ctx, descriptionMarkdown, container, { ownSpan: false, owner: s.uuid });
  }).join('\n');
  const h1 = (tree.sections ?? []).find(s => s.level === 1);
  return { html, title: h1?.title ?? tree.title ?? '' };
}

/**
 * What the site adds around a page's content from its frontmatter, as its
 * build writes them: the "Written for" line that follows the H1
 * (overrides/partials/content.html: the audience tag's pills, unless
 * `hide: [written-for]`) and the tags row that closes the article (the theme's
 * partials/tags.html: every tag, the audience's among them, in their order).
 * An icon is an empty `.twemoji[data-mb-lucide]` for the caller to fill.
 * @param {string} markdown
 * @param {{ audiences?: {tag: string, name: string, colour?: string, icon?: string}[] }} [opts]
 *   the site's audience registry (audienceTags.js AUDIENCE_PILLS when not given)
 * @returns {{ writtenFor: string, tags: string }} '' for one the page does not have
 */
export function pageChromeHtml(markdown, opts = {}) {
  const md = markdown ?? '';
  const tags = readFrontmatterTags(md);
  const hide = readFrontmatterHide(md);
  const slug = v => String(v ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const pills = hide.includes('written-for') ? [] : writtenForPills(tags, opts.audiences?.length ? opts.audiences : undefined);
  const pill = a => {
    const icon = slug(String(a.icon ?? '').replace(/^lucide\//, ''));
    return `<span class="mb-label mb-label-${slug(a.colour) || 'grey'}">${icon ? `<span class="twemoji" data-mb-lucide="${icon}"></span>` : ''}${esc(a.name)}</span>`;
  };
  return {
    writtenFor: pills.length ? `<p class="mb-written-for"><span class="mb-written-for__label">Written for</span>${pills.map(pill).join('')}</p>` : '',
    tags: tags.length ? `<nav class="md-tags"${hide.includes('tags') ? ' hidden' : ''}>${tags.map(t => `<span class="md-tag">${esc(t)}</span>`).join('')}</nav>` : '',
  };
}
