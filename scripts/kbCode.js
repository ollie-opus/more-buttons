/**
 * kbCode.js — code blocks in the KB in-page editor, drawn and worked as the
 * live Zensical page shows them.
 *
 *   - The code is typed where it stands. Its annotation markers (`# (1)!`)
 *     are drawn as Zensical's own (+) bubbles, which typing cannot delete:
 *     each is one atomic piece of the line it sits on.
 *   - Highlighted lines (`hl_lines`) are painted as Zensical paints them, in a
 *     layer behind the code, and follow their lines as lines come and go.
 *   - Pointing at a line puts two buttons at the tile's right edge, level with
 *     it: Add / Remove annotation and Highlight line (attachCodeHover).
 *   - A bubble opens Zensical's tooltip under it (openAnnTip); the editor
 *     makes its text a piece to type into.
 *
 * The model: the code as text with one ANN character standing for each
 * marker, in order (marker n is annotations[n - 1]). Caret positions are
 * offsets into the model, so a bubble counts as one character.
 *
 * Everything above the DOM section is pure (tests/kbCode.test.mjs).
 */

import { tokenizeAnnotatedCode, serializeTokens } from './codeAnnotations.js';

/** The model's stand-in for one annotation marker. */
export const ANN = '';

const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/** The code (markers in any style) as the model. */
export function toModel(code) {
  return tokenizeAnnotatedCode(code).map(t => (t.type === 'text' ? t.text : ANN)).join('');
}

/** The model as code, its markers renumbered in order and styled for `lang`. */
export function fromModel(model, lang) {
  const tokens = [];
  String(model ?? '').split(ANN).forEach((text, i) => {
    if (i) tokens.push({ type: 'marker', num: i });
    if (text) tokens.push({ type: 'text', text });
  });
  return serializeTokens(tokens, lang);
}

function bubbleHtml(i) {
  return `<span class="md-annotation mb-kb-ann" contenteditable="false" data-mb-ann="${i}">`
    + `<span class="md-annotation__index"><span data-md-annotation-id="${i + 1}"></span></span></span>`;
}

/** The model as the code element's inner HTML. */
export function modelHtml(model) {
  const m = String(model ?? '');
  const html = m.split(ANN).map((text, i) => (i ? bubbleHtml(i - 1) : '') + esc(text)).join('');
  // A last line that is empty has nothing to stand on without it (readModel
  // skips it).
  return m.endsWith('\n') ? `${html}<br>` : html;
}

/** The code element's inner HTML for the code itself. */
export const codeInnerHtml = code => modelHtml(toModel(code));

/** The line (0-based) each marker stands on, in order. */
export function markerLines(code) {
  const out = [];
  let line = 0;
  for (const ch of toModel(code)) {
    if (ch === '\n') line++;
    else if (ch === ANN) out.push(line);
  }
  return out;
}

/** How many lines the code has. */
export const lineCount = code => String(code ?? '').split('\n').length;

/** Whether each line has anything on it (a bubble counts). */
export const filledLines = code => toModel(code).split('\n').map(l => l.trim() !== '');

/** The line-number gutter's text: one number a line, from `start`. */
export function lineNumbers(count, start = 1) {
  const first = Math.max(1, parseInt(start, 10) || 1);
  return Array.from({ length: Math.max(1, count) }, (_, i) => first + i).join('\n');
}

// ── Highlighted lines ────────────────────────────────────────────────────────
// `hl_lines` counts from 1 whatever line the numbering starts at; the sets
// here count from 0, as lines do everywhere else in this file.

/** `hl_lines` ("2 3-5") as a set of 0-based lines. */
export function hlLineSet(hl) {
  const set = new Set();
  for (const part of String(hl ?? '').trim().split(/\s+/)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let n = Math.min(a, b); n <= Math.max(a, b) && n - a < 10000; n++) if (n >= 1) set.add(n - 1);
  }
  return set;
}

/** A set of 0-based lines as `hl_lines`, runs written as ranges. */
export function hlLineString(set) {
  const lines = [...set].filter(n => n >= 0).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < lines.length;) {
    let j = i;
    while (j + 1 < lines.length && lines[j + 1] === lines[j] + 1) j++;
    out.push(j > i ? `${lines[i] + 1}-${lines[j] + 1}` : `${lines[i] + 1}`);
    i = j + 1;
  }
  return out.join(' ');
}

/** `hl_lines` with 0-based `line` switched on or off. */
export function toggleHlLine(hl, line) {
  const set = hlLineSet(hl);
  if (set.has(line)) set.delete(line); else set.add(line);
  return hlLineString(set);
}

/**
 * `hl_lines` carried from `before` to `after`: lines outside the part that
 * changed keep their highlight (moving with the lines added or taken away
 * above them), and a highlighted line inside it keeps its place while there
 * is still a line there.
 */
export function shiftHlLines(hl, before, after) {
  const set = hlLineSet(hl);
  if (!set.size || before === after) return hlLineString(set);
  const a = String(before ?? '').split('\n');
  const b = String(after ?? '').split('\n');
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const oldEnd = a.length - s;
  const newLen = b.length - s - p;
  const out = new Set();
  for (const h of set) {
    if (h < p) out.add(h);
    else if (h >= oldEnd) out.add(h + b.length - a.length);
    else if (h - p < newLen) out.add(h);
  }
  return hlLineString(out);
}

// ── DOM: reading and placing in the code element ─────────────────────────────

const isBubble = n => n.nodeType === 1 && n.classList.contains('mb-kb-ann');
const isBlock = n => n.nodeType === 1 && (n.tagName === 'DIV' || n.tagName === 'P');

/**
 * Walks the code element in the model's terms. `visit(kind, node, len)` is
 * told of each text node, bubble and line break; returning true stops the
 * walk. A last <br> is the browser's (or modelHtml's) stand for an empty
 * line, not one of its own.
 */
function walkModel(el, visit) {
  const go = parent => {
    const kids = [...parent.childNodes];
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (k.nodeType === 3) { if (visit('text', k, k.nodeValue.length)) return true; continue; }
      if (k.nodeType !== 1) continue;
      if (isBubble(k)) { if (visit('ann', k, 1)) return true; continue; }
      if (k.tagName === 'BR') {
        if (parent === el && i === kids.length - 1) continue;
        if (visit('br', k, 1)) return true;
        continue;
      }
      if (isBlock(k) && visit('block', k, 0)) return true;
      if (go(k)) return true;
    }
    return false;
  };
  go(el);
}

/** The code element's content as the model. */
export function readModel(el) {
  let out = '';
  walkModel(el, (kind, node) => {
    if (kind === 'text') out += node.nodeValue;
    else if (kind === 'ann') out += ANN;
    else if (kind === 'br') out += '\n';
    else if (kind === 'block' && out && !out.endsWith('\n')) out += '\n';
    return false;
  });
  return out;
}

/** A DOM position (`node`, `offset`) in the code element, as a model offset. */
export function modelOffset(el, node, offset) {
  // Everything from the element's start up to the position: a piece counts
  // when it ends inside that.
  const range = document.createRange();
  range.selectNodeContents(el);
  try { range.setEnd(node, offset); } catch { return readModel(el).length; }
  let count = 0;
  walkModel(el, (kind, n, len) => {
    if (kind === 'block') return false;
    if (kind === 'text' && n === node) { count += offset; return true; }
    const endNode = kind === 'text' ? n : n.parentNode;
    const endOff = kind === 'text' ? len : [...n.parentNode.childNodes].indexOf(n) + 1;
    if (range.comparePoint(endNode, endOff) !== 0) return true;
    count += len;
    return false;
  });
  return count;
}

/** Puts the caret at model offset `at` in the code element. */
export function placeCaret(el, at) {
  const sel = window.getSelection();
  const range = document.createRange();
  let count = 0;
  let placed = false;
  walkModel(el, (kind, n, len) => {
    if (kind === 'block') return false;
    if (kind === 'text' && at <= count + len) { range.setStart(n, at - count); placed = true; return true; }
    if (kind !== 'text' && at <= count) { range.setStartBefore(n); placed = true; return true; }
    count += len;
    return false;
  });
  if (!placed) range.setStart(el, el.childNodes.length);
  range.collapse(true);
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** The caret's model offset in the code element, or null when it is not there. */
export function caretOffset(el) {
  const sel = window.getSelection();
  if (!sel?.rangeCount || !el.contains(sel.anchorNode)) return null;
  const r = sel.getRangeAt(0);
  return modelOffset(el, r.startContainer, r.startOffset);
}

// What an input is about to replace. The browser does not say for a
// plaintext-only element (getTargetRanges is empty), so it is worked out from
// the selection: the selection itself, or, collapsed, the character / word /
// line the key deletes (found by moving the selection there and back).
const DELETE_UNITS = [
  [/^deleteContent/, 'character'], [/^deleteWord/, 'word'], [/^delete(Soft|Hard)Line/, 'lineboundary'],
];
function targetRange(e) {
  const given = e.getTargetRanges?.()[0];
  if (given && !given.collapsed) return given;
  const sel = window.getSelection();
  if (!sel?.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return range.cloneRange();
  const unit = DELETE_UNITS.find(([re]) => re.test(e.inputType))?.[1];
  if (!unit || !sel.modify) return null;
  const back = /Backward$/.test(e.inputType);
  const saved = range.cloneRange();
  sel.modify('extend', back ? 'backward' : 'forward', unit);
  const out = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  sel.removeAllRanges();
  sel.addRange(saved);
  return out && !out.collapsed ? out : null;
}

/**
 * Typing over a bubble (a selection holding one, Backspace or Delete beside
 * one) replaces the text around it and keeps the bubble. `changed` is told
 * once the element has been redrawn, as an `input` would have.
 */
export function guardBubbles(el, changed) {
  el.addEventListener('beforeinput', e => {
    if (e.inputType === 'insertFromDrop' || e.inputType === 'deleteByDrag') { e.preventDefault(); return; }
    const range = targetRange(e);
    if (!range) return;
    const model = readModel(el);
    const start = modelOffset(el, range.startContainer, range.startOffset);
    const end = modelOffset(el, range.endContainer, range.endOffset);
    const covered = model.slice(start, end);
    if (!covered.includes(ANN)) return;
    e.preventDefault();
    const typed = e.inputType.startsWith('insert')
      ? (e.data ?? e.dataTransfer?.getData('text/plain') ?? (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak' ? '\n' : ''))
      : '';
    const kept = covered.replace(new RegExp(`[^${ANN}]`, 'g'), '');
    // Backspace / Delete beside a bubble only steps over it.
    const step = !typed && covered === ANN;
    const next = step ? model : model.slice(0, start) + typed + kept + model.slice(end);
    el.innerHTML = modelHtml(next);
    placeCaret(el, step ? (e.inputType.endsWith('Backward') ? start : end) : start + typed.length);
    if (!step) changed();
  });
}

// ── DOM: highlighted lines ───────────────────────────────────────────────────

function lineMetrics(code) {
  const cs = getComputedStyle(code);
  const fontSize = parseFloat(cs.fontSize) || 16;
  const lh = parseFloat(cs.lineHeight) || fontSize * 1.5;
  return { lh, top: parseFloat(cs.paddingTop) || 0 };
}

/** Paints a code block's highlighted lines (a set of 0-based lines) behind its code. */
export function paintHl(pre, set) {
  const code = pre.querySelector(':scope > code');
  let layer = pre.querySelector(':scope > .mb-kb-code-hls');
  if (!code) return;
  if (!layer) {
    layer = document.createElement('span');
    layer.className = 'mb-kb-code-hls';
    layer.setAttribute('aria-hidden', 'true');
    pre.prepend(layer);
  }
  const { lh, top } = lineMetrics(code);
  layer.replaceChildren(...[...set].sort((a, b) => a - b).map(line => {
    const band = document.createElement('span');
    band.className = 'mb-kb-code-hl';
    band.style.top = `${top + line * lh}px`;
    band.style.height = `${lh}px`;
    return band;
  }));
}

/** Numbers the gutter (when the block has one) for `count` lines. */
export function paintNums(pre, count) {
  const gutter = pre.querySelector(':scope > .mb-kb-code-nums');
  if (gutter) gutter.textContent = lineNumbers(count, pre.dataset.mbLinenums);
}

/** Paints every code block's highlights under `root` (from each pre's `data-mb-hl`). */
export function paintCodeBlocks(root) {
  root.querySelectorAll('.mb-kb-code > pre[data-mb-hl]').forEach(pre => paintHl(pre, hlLineSet(pre.dataset.mbHl)));
}

// ── DOM: the buttons beside the line pointed at ──────────────────────────────

/**
 * Two buttons at the right edge of a code block, level with the line the
 * pointer is over. `opts`:
 *   root          what holds the code blocks (the article)
 *   enabled()     false while nothing can be edited (the live content)
 *   info(uuid)    { lines, annLines, hl:Set, canAnnotate, noAnnotateTip } for a block
 *   annotate(uuid, line, annIndex|null)   the annotation button
 *   highlight(uuid, line)                  the highlight button
 *   icon(el, name)  paints a lucide icon into a button
 *   tip(el, text)   names a button (the theme's tooltip)
 */
export function attachCodeHover(opts) {
  const nav = document.createElement('span');
  nav.className = 'mb-kb-codebtns';
  nav.contentEditable = 'false';
  const make = act => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mb-kb-codebtn';
    b.dataset.act = act;
    nav.append(b);
    return b;
  };
  const annBtn = make('annotate');
  const hlBtn = make('highlight');
  let at = null; // { uuid, line, ann }
  let painted = { ann: '', hl: '' };

  const hide = () => { at = null; nav.remove(); };
  const paintIcon = (btn, key, name) => {
    if (painted[key] === name) return;
    painted[key] = name;
    opts.icon(btn, name);
  };

  const show = (pre, uuid, line) => {
    const code = pre.querySelector(':scope > code');
    const info = opts.info(uuid);
    if (!code || !info) { hide(); return; }
    const l = Math.max(0, Math.min(line, info.lines - 1));
    // Only a line with something on it has buttons.
    if (!info.filled[l]) { hide(); return; }
    const ann = info.annLines.indexOf(l);
    at = { uuid, line: l, ann: ann >= 0 ? ann : null };
    const { lh, top } = lineMetrics(code);
    nav.style.top = `${code.offsetTop + top + l * lh}px`;
    nav.style.height = `${lh}px`;
    const has = at.ann != null;
    paintIcon(annBtn, 'ann', has ? 'message-square-x' : 'message-square-plus');
    annBtn.disabled = !has && !info.canAnnotate;
    annBtn.classList.toggle('--danger', has);
    opts.tip(annBtn, has ? 'Remove annotation' : info.canAnnotate ? 'Add annotation' : info.noAnnotateTip);
    const on = info.hl.has(l);
    paintIcon(hlBtn, 'hl', 'highlighter');
    hlBtn.classList.toggle('--on', on);
    hlBtn.setAttribute('aria-pressed', String(on));
    opts.tip(hlBtn, on ? 'Remove highlight' : 'Highlight line');
    if (nav.parentElement !== pre) pre.append(nav);
  };

  const lineAt = (pre, y) => {
    const code = pre.querySelector(':scope > code');
    if (!code) return 0;
    const { lh, top } = lineMetrics(code);
    return Math.floor((y - code.getBoundingClientRect().top - top) / lh);
  };

  let frame = 0;
  let last = null;
  const track = () => {
    frame = 0;
    if (!last || !opts.enabled()) { hide(); return; }
    const t = last.target;
    const pre = t instanceof Element && opts.root.contains(t) ? t.closest('.mb-kb-code > pre') : null;
    const uuid = pre?.closest('.mb-kb-code')?.dataset.mbCode;
    // An open tooltip has the block to itself.
    if (!pre || !uuid || pre.querySelector(':scope > .mb-kb-anntip')) { hide(); return; }
    if (nav.contains(t) && at) return; // on the buttons themselves: they stay on their line
    show(pre, uuid, lineAt(pre, last.clientY));
  };
  document.addEventListener('mousemove', e => {
    last = e;
    if (!frame) frame = requestAnimationFrame(track);
  }, { passive: true });

  // The press must leave the caret where it is (the click does the work).
  nav.addEventListener('mousedown', e => { e.preventDefault(); });
  nav.addEventListener('click', e => {
    const btn = e.target instanceof Element ? e.target.closest('.mb-kb-codebtn') : null;
    if (!btn || btn.disabled || !at) return;
    e.preventDefault();
    e.stopPropagation();
    const { uuid, line, ann } = at;
    if (btn.dataset.act === 'annotate') opts.annotate(uuid, line, ann);
    else opts.highlight(uuid, line);
  });

  return {
    nav,
    hide,
    /** Shows the buttons again on `line` of a block (after a redraw under them). */
    reshow(uuid, line) {
      const pre = opts.root.querySelector(`.mb-kb-code[data-mb-code="${CSS.escape(uuid)}"] > pre`);
      if (pre && opts.enabled()) show(pre, uuid, line); else hide();
    },
  };
}

// ── DOM: an annotation's tooltip ─────────────────────────────────────────────

/**
 * Opens Zensical's tooltip for a bubble, inside the block's <pre>, its corner
 * at the bubble as on the live page. Gives back the tooltip's inner element
 * (the annotation's text goes there).
 */
export function openAnnTip(bubble, html) {
  const pre = bubble.closest('pre');
  closeAnnTips(pre.ownerDocument);
  const tip = document.createElement('div');
  tip.className = 'md-tooltip md-tooltip--active mb-kb-anntip';
  const inner = document.createElement('div');
  inner.className = 'md-tooltip__inner md-typeset';
  inner.innerHTML = html;
  tip.append(inner);
  pre.append(tip);
  bubble.classList.add('--open');
  placeAnnTip(tip, bubble);
  return inner;
}

function placeAnnTip(tip, bubble) {
  const pre = tip.parentElement;
  const p = pre.getBoundingClientRect();
  const b = bubble.getBoundingClientRect();
  const x = b.left + b.width / 2 - p.left;
  const y = b.top + b.height / 2 - p.top;
  const left = Math.max(0, Math.min(x - 2, p.width - tip.offsetWidth));
  tip.style.left = `${left}px`;
  tip.style.top = `${y - 2}px`;
}

/** Closes any open annotation tooltip. */
export function closeAnnTips(doc = document) {
  doc.querySelectorAll('.mb-kb-anntip').forEach(t => t.remove());
  doc.querySelectorAll('.mb-kb-ann.--open').forEach(b => b.classList.remove('--open'));
}
