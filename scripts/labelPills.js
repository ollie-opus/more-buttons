/**
 * labelPills.js — a label pill edited where it stands in a rich surface
 * (richTextEditor.js): its text is typed straight into it, and a double click
 * on it (or making a new one) floats its colours just above as loose pills,
 * the way an admonition's types do (kbTypePicker.js), until the caret leaves
 * it. There is no popup and no text box. The pills are the editor's one
 * floating menu (floatMenu.js): a "Colour" heading over them and, in the
 * in-page editor, the rest of the page washed back round the text being typed.
 *
 * A pill is an ordinary inline span in the editable text, and the browser
 * cannot tell "the end of the pill's text" from "just after the pill": both
 * are one caret place, and what is typed there lands inside the span. So this
 * module keeps which side of that edge the caret is on:
 *
 *   - in the pill (the pill is ringed): typing carries it on;
 *   - stepped out (`out`): Right at its end, Left at its start, Enter, Escape,
 *     or a click beside it. What is typed then goes into the text beside the
 *     pill, written into the source there (the browser would put it inside).
 *
 * Choosing a colour repaints the pill and keeps the caret; "Remove label"
 * leaves its text as plain text. A pill with no text left is no pill at all
 * (richEditorMapping.js emits nothing for it).
 *
 * edgeOf is pure and Node-tested; the rest needs a DOM.
 */

import { buildSource } from './richEditorMapping.js';
import { labelTextOffset } from './markdownInline.js';
import { applyLabel, labelAt, stripFormatting } from './markdownToolbarActions.js';
import { loadLabelPalette, paintLabelVars } from './labelPalette.js';
import { getLucideSvgMarkup } from './lucideIcons.js';
import { createVeil, menuBreak, menuGroup, menuHost, menuMaxWidth, menuTick, menuView, placeAround, playIn, stepPills } from './floatMenu.js';

const NEW_TEXT = 'Label';

const TEXT_NODE = 3, ELEMENT_NODE = 1;

const isLabel = n => !!n && n.nodeType === ELEMENT_NODE && /(?:^|\s)mb-label(?:\s|$)/.test(n.getAttribute?.('class') || '');
const slugOf = el => ((el.getAttribute('class') || '').match(/mb-label-([a-z0-9-]+)/) || [])[1] || '';

// Whether anything a reader would see lies in `node` on one side of `offset`
// (text, or an icon), up to the edge of `label`.
function nothingBeyond(label, node, offset, forward) {
  let n = node;
  let o = offset;
  for (;;) {
    if (n.nodeType === TEXT_NODE) {
      const rest = forward ? n.nodeValue.slice(o) : n.nodeValue.slice(0, o);
      if (rest) return false;
    } else {
      const kids = n.childNodes;
      for (let i = forward ? o : o - 1; forward ? i < kids.length : i >= 0; i += forward ? 1 : -1) {
        const k = kids[i];
        if (k.nodeType === TEXT_NODE ? k.nodeValue : (k.nodeType === ELEMENT_NODE && (k.getAttribute?.('data-mb-icon') || k.textContent))) return false;
      }
    }
    if (n === label) return true;
    const parent = n.parentNode;
    if (!parent) return true;
    const idx = Array.prototype.indexOf.call(parent.childNodes, n);
    o = forward ? idx + 1 : idx;
    n = parent;
  }
}

const labelAround = (root, node) => {
  for (let n = node; n && n !== root; n = n.parentNode) if (isLabel(n)) return n;
  return null;
};

// The sibling a reader meets next on that side, past any empty text nodes.
function neighbour(node, forward) {
  let n = forward ? node.nextSibling : node.previousSibling;
  while (n && n.nodeType === TEXT_NODE && !n.nodeValue) n = forward ? n.nextSibling : n.previousSibling;
  return n;
}

/**
 * Where a caret at (node, offset) stands against a label's edge, or null when
 * it is at none: { label, side: 'before' | 'after', inside }. `inside` is true
 * when the caret's own node is in the label (its first / last place), false
 * when it is in the text right beside it. An empty label reads as 'after'.
 */
export function edgeOf(root, node, offset) {
  if (!node) return null;
  const inLabel = labelAround(root, node);
  if (inLabel) {
    if (nothingBeyond(inLabel, node, offset, true)) return { label: inLabel, side: 'after', inside: true };
    if (nothingBeyond(inLabel, node, offset, false)) return { label: inLabel, side: 'before', inside: true };
    return null;
  }
  if (node.nodeType === TEXT_NODE) {
    if (offset === 0) { const p = neighbour(node, false); if (isLabel(p)) return { label: p, side: 'after', inside: false }; }
    if (offset === node.nodeValue.length) { const n = neighbour(node, true); if (isLabel(n)) return { label: n, side: 'before', inside: false }; }
    return null;
  }
  const kids = node.childNodes;
  let p = kids[offset - 1];
  while (p && p.nodeType === TEXT_NODE && !p.nodeValue) p = p.previousSibling;
  if (isLabel(p)) return { label: p, side: 'after', inside: false };
  let n = kids[offset];
  while (n && n.nodeType === TEXT_NODE && !n.nodeValue) n = n.nextSibling;
  if (isLabel(n)) return { label: n, side: 'before', inside: false };
  return null;
}

let lastSlug = null; // the colour last chosen: a new label starts as it

/**
 * @param {object} rte   the editor (richTextEditor.js)
 * @param {object} api
 * @param {(rte, res) => void} api.applyResult      write a new source value and selection
 * @param {(rte) => void} api.syncFromSurface       the surface was changed in place: read it back
 * @param {(rte) => {value, selStart, selEnd}} api.currentSelection
 * @param {(rte) => void} api.refresh               the toolbar's states
 * @param {(rte) => boolean} api.armed              a format is waiting for the next typed text
 */
export function attachLabelEditing(rte, api) {
  const { surface } = rte;
  let out = null;      // { label, side }: the caret stands at that edge, outside the label
  let shown = null;    // the label the pills are for
  let asked = null;    // the label whose colours were asked for (a double click, a new label)
  let ringed = null;   // the label the caret is in
  let host = null;
  let veil = null;
  let palette = null;  // { groups, flat }
  let cross = '';
  loadLabelPalette().then(p => { palette = p; update(); }).catch(() => {});
  getLucideSvgMarkup('x').then(svg => { cross = svg || ''; }).catch(() => {});
  // The page is washed back only in the in-page editor (a form is a tile of
  // its own over the page already).
  const washes = () => !!rte.float && document.documentElement.classList.contains('mb-kb-host');

  const selection = () => {
    const sel = window.getSelection();
    return sel && sel.rangeCount && surface.contains(sel.anchorNode) && surface.contains(sel.focusNode) ? sel : null;
  };
  const caretEdge = () => {
    const sel = selection();
    return sel && sel.isCollapsed ? edgeOf(surface, sel.anchorNode, sel.anchorOffset) : null;
  };
  // `out` holds only while the caret is still at that edge.
  const steppedOut = () => {
    if (!out) return null;
    const e = caretEdge();
    if (e && e.label === out.label && e.side === out.side && out.label.isConnected) return out;
    out = null;
    return null;
  };

  // The label the caret (or the whole selection) is in, null when stepped out.
  const current = () => {
    if (rte.mode !== 'rich' || rte.disabled) return null;
    const sel = selection();
    if (!sel) return null;
    const a = labelAround(surface, sel.anchorNode);
    if (!a || a !== labelAround(surface, sel.focusNode)) return null;
    return steppedOut() ? null : a;
  };

  // The source offset just outside `label` on that side.
  function outsideOffset(label, side) {
    const parent = label.parentNode;
    const want = Array.prototype.indexOf.call(parent.childNodes, label) + (side === 'after' ? 1 : 0);
    let found = null;
    buildSource(surface, null, (p, idx, srcLen) => { if (p === parent && idx === want) found = srcLen; });
    return found;
  }

  // ── The colour pills ──
  function build() {
    host = menuHost('mb-label-pills');
    host.setAttribute('role', 'toolbar');
    host.setAttribute('aria-label', 'Label colour');
    // A press on a pill must not take the caret out of the label.
    host.addEventListener('mousedown', e => e.preventDefault());
    host.addEventListener('click', e => {
      const pill = e.target instanceof Element ? e.target.closest('.mb-fm__pill') : null;
      if (!pill || !shown) return;
      if (pill.dataset.remove != null) remove(); else recolour(pill.dataset.slug);
    });
    host.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); surface.focus({ preventScroll: true }); return; }
      stepPills(host, e);
    });
    document.body.append(host);
    if (washes()) veil = createVeil();
  }

  function fill(slug) {
    const group = menuGroup('Colour');
    Object.values(palette.groups).forEach((presets, g) => {
      if (g) group.row.append(menuBreak());
      for (const [name, preset] of Object.entries(presets)) {
        const id = name.toLowerCase();
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'mb-fm__pill --swatch';
        pill.dataset.slug = id;
        pill.tabIndex = -1;
        pill.setAttribute('aria-pressed', String(id === slug));
        paintLabelVars(pill, preset);
        const text = document.createElement('span');
        text.className = 'mb-fm__text';
        text.textContent = name;
        pill.append(text, menuTick());
        group.row.append(pill);
      }
    });
    const off = document.createElement('button');
    off.type = 'button';
    off.className = 'mb-fm__pill --remove';
    off.dataset.remove = '';
    off.tabIndex = -1;
    off.innerHTML = `<span class="mb-fm__glyph" aria-hidden="true">${cross}</span><span class="mb-fm__text">Remove label</span>`;
    group.row.append(off);
    const fresh = host.hidden || !host.firstChild;
    host.replaceChildren(group.el);
    host.dataset.slug = slug;
    if (fresh) playIn(host);
  }

  function place() {
    if (!shown || !host || host.hidden) return;
    const box = shown.getBoundingClientRect();
    host.style.maxWidth = `${menuMaxWidth(Infinity)}px`;
    host.style.left = '0px';
    host.style.top = '0px';
    const { x, y, up } = placeAround(box, { w: host.offsetWidth, h: host.offsetHeight }, { ...menuView(), bottom: Infinity }, { fallbackTop: box.bottom });
    host.classList.toggle('--up', up);
    host.style.left = `${Math.round(x)}px`;
    host.style.top = `${Math.round(y)}px`;
    // The text being typed stays clear of the wash.
    if (veil) veil.show(surface.getBoundingClientRect(), getComputedStyle(surface).borderRadius);
  }

  function update() {
    if (rte.destroyed) return;
    const label = surface.isConnected ? current() : null;
    if (ringed && ringed !== label) ringed.removeAttribute('data-mb-label-editing');
    ringed = label;
    label?.setAttribute('data-mb-label-editing', '');
    // The colours stay only while the caret is in the label they were asked for.
    if (asked && asked !== label) asked = null;
    if (!asked || !palette) {
      shown = null;
      if (host) host.hidden = true;
      veil?.hide();
      return;
    }
    if (!host) build();
    const slug = slugOf(label);
    const fresh = shown !== label || host.hidden;
    if (fresh || host.dataset.slug !== slug) fill(slug);
    shown = label;
    host.hidden = false;
    place();
  }

  // Show the colours of the label the caret is in.
  function open() {
    asked = current();
    update();
  }

  function recolour(slug) {
    const preset = palette?.flat[slug];
    if (!shown || !preset) return;
    lastSlug = slug;
    shown.setAttribute('class', `mb-label mb-label-${slug}`);
    paintLabelVars(shown, preset);
    api.syncFromSurface(rte);
    fill(slug);
    place();
  }

  // The label's text stays, as plain text, with the caret where it was in it.
  function remove() {
    const cur = api.currentSelection(rte);
    const at = labelAt(cur.value, cur.selStart, cur.selEnd);
    if (!at) return;
    const open = at.start + labelTextOffset(at.slug);
    const shift = n => at.start + Math.max(0, Math.min(n - open, at.text.length));
    out = null;
    api.applyResult(rte, {
      value: cur.value.slice(0, at.start) + at.text + cur.value.slice(at.end),
      selStart: shift(cur.selStart),
      selEnd: shift(cur.selEnd),
    });
  }

  const stepOut = (label, side) => {
    out = { label, side };
    update();
    api.refresh(rte);
  };

  // ── Keys ──
  const onKeyDown = e => {
    if (e.isComposing || rte.mode !== 'rich') return;
    const sel = selection();
    if (!sel) return;
    const stepped = steppedOut();
    const plain = !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey;
    if (stepped) {
      // The arrow pointing back at the label goes back into it.
      if (plain && e.key === (stepped.side === 'after' ? 'ArrowLeft' : 'ArrowRight')) {
        e.preventDefault();
        out = null;
        update();
        api.refresh(rte);
      }
      return;
    }
    const label = current();
    if (!label) return;
    if (e.key === 'Enter' || e.key === 'Escape') {
      // Done with the label: on with the text after it. (The key is spent
      // here: it neither breaks the line nor ends the edit.)
      e.preventDefault();
      e.stopImmediatePropagation(); // the editor's own Enter / Escape on this text too
      sel.collapse(label, label.childNodes.length);
      stepOut(label, 'after');
      return;
    }
    if (!plain || !sel.isCollapsed) return;
    const edge = edgeOf(surface, sel.anchorNode, sel.anchorOffset);
    if (!edge || edge.label !== label) return;
    if ((e.key === 'ArrowRight' && edge.side === 'after') || (e.key === 'ArrowLeft' && edge.side === 'before')) {
      e.preventDefault();
      stepOut(label, edge.side);
    }
  };

  const wholeLabel = (sel, label) => {
    if (sel.isCollapsed) return false;
    const r = sel.getRangeAt(0);
    return nothingBeyond(label, r.startContainer, r.startOffset, false) && nothingBeyond(label, r.endContainer, r.endOffset, true);
  };

  const onBeforeInput = e => {
    if (rte.mode !== 'rich' || rte.disabled) return;
    const sel = selection();
    if (!sel) return;
    const typed = (e.inputType === 'insertText' || e.inputType === 'insertReplacementText') && typeof e.data === 'string' && e.data !== '';
    if (steppedOut()) {
      // Beside the label, not in it: the browser would put this inside the
      // span, so it is written into the source at the caret's real place.
      // (An armed format does the same through the selection it reads.)
      if (!typed || api.armed(rte)) return;
      e.preventDefault();
      const { value, selStart } = api.currentSelection(rte);
      const caret = selStart + e.data.length;
      api.applyResult(rte, { value: value.slice(0, selStart) + e.data + value.slice(selStart), selStart: caret, selEnd: caret });
      return;
    }
    const label = current();
    if (!label) return;
    // No formatting inside a label, no tag, and no second line.
    if (e.inputType.startsWith('format')) { e.preventDefault(); return; }
    if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
      e.preventDefault();
      sel.collapse(label, label.childNodes.length);
      stepOut(label, 'after');
      return;
    }
    if (!typed) return;
    if (/[<>]/.test(e.data)) { e.preventDefault(); return; }
    // Typing over all of its text: the browser would drop the emptied span
    // and leave the new text bare. The text is swapped inside it instead.
    if (wholeLabel(sel, label)) {
      e.preventDefault();
      const text = document.createTextNode(e.data);
      label.replaceChildren(text);
      sel.collapse(text, text.nodeValue.length);
      api.syncFromSurface(rte);
    }
  };

  // A click beside a label lands the caret at its edge, which the browser
  // counts as inside it: where the press itself was says which was meant.
  const onClick = e => {
    const sel = selection();
    if (!sel || !sel.isCollapsed) return;
    const edge = edgeOf(surface, sel.anchorNode, sel.anchorOffset);
    const on = e.target instanceof Node ? labelAround(surface, e.target) : null;
    if (edge?.inside && on !== edge.label) out = { label: edge.label, side: edge.side };
    else if (on) out = null;
    update();
    api.refresh(rte);
  };

  surface.addEventListener('keydown', onKeyDown, true);
  surface.addEventListener('beforeinput', onBeforeInput, true);
  surface.addEventListener('click', onClick);
  surface.addEventListener('dblclick', open);
  surface.addEventListener('input', () => { if (shown) place(); });
  const onMove = () => place();
  document.addEventListener('selectionchange', update);
  window.addEventListener('scroll', onMove, true);
  window.addEventListener('resize', onMove);
  rte.cleanups?.push(() => {
    document.removeEventListener('selectionchange', update);
    window.removeEventListener('scroll', onMove, true);
    window.removeEventListener('resize', onMove);
    ringed?.removeAttribute('data-mb-label-editing');
    host?.remove();
    veil?.remove();
  });

  return {
    /** The label being typed in (null when the caret is beside one, or in none). */
    current,
    /** Show the colours of the label the caret is in (a double click on it does). */
    open,
    /** Whether the colours are showing. */
    isOpen: () => !!host && !host.hidden,
    /** The caret's source offset when it stands just outside a label's edge, else null. */
    outsideOffset() {
      const o = steppedOut();
      return o ? outsideOffset(o.label, o.side) : null;
    },
    /**
     * A selection was just placed from source offsets: an offset just outside a
     * label lands, in the page, on the edge the browser counts as inside it.
     */
    placed(selStart, selEnd) {
      out = null;
      if (selStart !== selEnd) return;
      const e = caretEdge();
      if (e?.inside && outsideOffset(e.label, e.side) === selStart) out = { label: e.label, side: e.side };
    },
    /**
     * The Label button / menu item: the selected text becomes a label (a new
     * one reading "Label", selected to be typed over, with none), and in a
     * label it takes the label off again.
     */
    async toggle() {
      const cur = api.currentSelection(rte);
      if (labelAt(cur.value, cur.selStart, cur.selEnd)) { remove(); return; }
      if (!palette) { try { palette = await loadLabelPalette(); } catch { return; } }
      const slug = (lastSlug && palette.flat[lastSlug]) ? lastSlug : Object.keys(palette.flat)[0];
      if (!slug) return;
      const inner = n => n + labelTextOffset(slug);
      if (cur.selStart === cur.selEnd) {
        const res = applyLabel(cur.value, cur.selStart, cur.selEnd, NEW_TEXT, slug);
        api.applyResult(rte, { value: res.value, selStart: inner(cur.selStart), selEnd: inner(cur.selStart) + NEW_TEXT.length });
        open();
        return;
      }
      const plain = stripFormatting(cur.value, cur.selStart, cur.selEnd);
      const text = plain.value.slice(plain.selStart, plain.selEnd).replace(/[<>\n\r]/g, '');
      if (!text.trim()) return;
      const res = applyLabel(plain.value, plain.selStart, plain.selEnd, text, slug);
      const caret = inner(plain.selStart) + text.length;
      api.applyResult(rte, { value: res.value, selStart: caret, selEnd: caret });
      open();
    },
  };
}
