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
 *   .mb-kb-text.--empty  data-mb-text="<container kind>"  data-mb-uuid="<uuid>"
 *                  data-mb-at="0"
 *                              (the place to start typing in a container that
 *                              does not open with text: typing makes the block)
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
 * opts.markdown draws the page's text as its markdown source instead (the
 * editor's Markdown view): text blocks and headings hold the raw markdown,
 * components are drawn as usual.
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
const parseBody = (body, opts) => ({ components: parseBlocks(body ?? '', GUIDE_ADMONITION_TYPES_RE, opts).blocks });

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
    markdown: !!opts.markdown,
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
  const html = ctx.markdown ? esc(String(txt.body ?? '').trim()) : textHtml(ctx, txt.body);
  return `<div class="mb-kb-text${ctx.markdown ? ' --md' : ''}${html ? '' : ' --empty'}" data-mb-text="block" data-mb-uuid="${escAttr(txt.uuid)}">${html}</div>`;
}

// Where typing starts in a container that does not open with text.
function textSlot(ctx, container, components) {
  if (!container?.uuid || components?.[0]?.kind === 'text') return '';
  return `<div class="mb-kb-text${ctx.markdown ? ' --md' : ''} --empty" data-mb-text="${container.kind}" data-mb-uuid="${escAttr(container.uuid)}" data-mb-at="0"></div>`;
}

// A container's whole content: the typing place when it needs one, then its blocks.
function bodyHtml(ctx, body, container, opts) {
  const { components } = parseBody(body, opts);
  return textSlot(ctx, container, components) + componentsHtml(ctx, components, container);
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
  return `<div class="mb-kb-insert" data-mb-insert-kind="${container.kind}" data-mb-insert-uuid="${escAttr(container.uuid)}" data-mb-insert-at="${at}"><button type="button" class="mb-kb-insert__btn">+ Insert new</button></div>`;
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

function codeBlockHtml(cb) {
  const title = cb.title ? `<span class="filename">${esc(cb.title)}</span>` : '';
  const notes = (cb.annotations ?? []).length
    ? `<ol class="mb-kb-annotations">${cb.annotations.map((a, i) => `<li${editAttrs(cb.uuid, 'annotation', ` data-mb-index="${i}"`)}>${annotationHtml(a)}</li>`).join('')}</ol>` : '';
  return `<div class="highlight${cb.language ? ` language-${escAttr(cb.language)}` : ''}">${title}<pre><code${editAttrs(cb.uuid, 'code')}>${esc(cb.code)}</code></pre></div>${notes}`;
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
  const shown = inlineHtml(ctx, title || ADMONITION_TYPE_LABELS[adm.type] || adm.type);
  // A step numbers itself and takes no title of its own.
  const own = adm.type === 'step' ? shown : `<span${editAttrs(adm.uuid, 'adm-title')}>${shown}</span>`;
  const titleHtml = own + (meta ? `<span class="meta">${esc(meta)}</span>` : '');
  const inner = bodyHtml(ctx, adm.body, { kind: TEXT_KIND.admonition, uuid: adm.uuid });
  const type = escAttr(adm.type);
  if ((adm.prefix ?? '').startsWith('???')) {
    return `<details class="${type}" open${nodeAttrs(adm.uuid, 'admonition')}><summary data-mb-title>${titleHtml}</summary>${inner}</details>`;
  }
  return `<div class="admonition ${type}"${nodeAttrs(adm.uuid, 'admonition')}><p class="admonition-title" data-mb-title>${titleHtml}</p>${inner}</div>`;
}

function tabsHtml(ctx, grp) {
  const n = ++ctx.tabSeq;
  const tabs = grp.tabs ?? [];
  const inputs = tabs.map((_, i) => `<input${i === 0 ? ' checked="checked"' : ''} id="__mbtab_${n}_${i + 1}" name="__mbtab_${n}" type="radio">`).join('');
  const labels = tabs.map((t, i) => `<label for="__mbtab_${n}_${i + 1}"${editAttrs(t.uuid, 'tab-title')}>${inlineHtml(ctx, t.title ?? '')}</label>`).join('');
  const blocks = tabs.map(t =>
    `<div class="tabbed-block"${nodeAttrs(t.uuid, 'tab')}>${bodyHtml(ctx, t.body, { kind: TEXT_KIND.tab, uuid: t.uuid })}</div>`).join('');
  return `<div class="tabbed-set tabbed-alternate" data-tabs="${n}:${tabs.length}"${nodeAttrs(grp.uuid, 'tabs')}>${inputs}<div class="tabbed-labels">${labels}</div><div class="tabbed-content">${blocks}</div></div>`;
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
 * @param {{assetUrl?: (src: string) => string, insertSlots?: boolean, markdown?: boolean}} [opts]
 * @returns {{ html: string, title: string }} `title` is the H1's text ('' when
 *   the page has no sections).
 */
export function renderGuidePage(markdown, opts = {}) {
  const ctx = makeCtx(opts);
  const md = markdown ?? '';
  const tree = buildSectionTree(md);
  const html = (tree.sections ?? []).map(s => {
    const { descriptionMarkdown, hideTitle } = readSectionDescription(md, s.uuid);
    const container = { kind: TEXT_KIND.section, uuid: s.uuid };
    const hidden = hideTitle ? ' data-mb-title-hidden' : '';
    const heading = ctx.markdown ? esc(s.title) : inlineHtml(ctx, s.title);
    return `<h${s.level} id="${escAttr(headingId(s.title))}"${nodeAttrs(s.uuid, 'section')}${hidden}>${heading}</h${s.level}>\n`
      + bodyHtml(ctx, descriptionMarkdown, container, { ownSpan: false, owner: s.uuid });
  }).join('\n');
  const h1 = (tree.sections ?? []).find(s => s.level === 1);
  return { html, title: h1?.title ?? tree.title ?? '' };
}
