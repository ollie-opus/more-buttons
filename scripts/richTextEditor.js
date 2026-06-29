import { markSpans, renderDocHtml } from './markdownInline.js';
import { applyMarker, applyLink, linkAt, applyGroove, grooveAt, applyLabel, labelAt, stripFormatting, toggleList, indentSelection, isListLineAt, insertHorizontalRule } from './markdownToolbarActions.js';
import { serialize, serializeWithSelection, placeCaret } from './richEditorMapping.js';

// Toolbar marks: { marker } is the literal markdown delimiter the toolbar
// applies (via the pure markdownToolbarActions transforms); { tags } are the
// rendered HTML tags that mean "this mark is active" (used to light the button
// when the caret sits inside it). Order matters: it is the nesting order used
// when several marks are armed at once (outermost first). Matches the old toolbar.
const MARKS = [
  { marker: '**', tags: ['strong', 'b'], icon: 'format_bold', label: 'Bold' },
  { marker: '*', tags: ['em', 'i'], icon: 'format_italic', label: 'Italic' },
  { marker: '^^', tags: ['u'], icon: 'format_underlined', label: 'Underline' },
  { marker: '~~', tags: ['s', 'strike', 'del'], icon: 'strikethrough_s', label: 'Strikethrough' },
  { marker: '==', tags: ['mark'], icon: 'format_ink_highlighter', label: 'Highlight' },
  { marker: '`', tags: ['code'], icon: 'code', label: 'Code' },
];

// Block-level list buttons. Unlike MARKS these are never "armed": a collapsed
// caret always sits on a line, so the toggle acts on that line directly instead
// of queuing a format for the next typed text. `tag` is the rendered list
// element that means "the caret is inside this kind" (lights the button).
const LISTS = [
  { kind: 'ul', tag: 'ul', icon: 'format_list_bulleted', label: 'Bulleted list' },
  { kind: 'ol', tag: 'ol', icon: 'format_list_numbered', label: 'Numbered list' },
];

// Indent / outdent the current list item(s) by one nesting level. Like LISTS
// these act on the caret's line; they're disabled (greyed) unless the caret sits
// inside a list, since there's nothing to nest otherwise. `dir`: +1 / -1.
const INDENTS = [
  { dir: -1, icon: 'format_indent_decrease', label: 'Decrease indent' },
  { dir: 1, icon: 'format_indent_increase', label: 'Increase indent' },
];

// Pure: collapse line breaks (and surrounding whitespace) to single spaces —
// what inline mode does to pasted text, since a table cell can't hold a newline.
export function collapseNewlines(text) {
  return (text ?? '').replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

// opts.inline: single-line cell mode — no list/indent buttons, Enter blocked,
// pasted newlines collapsed. Default (multiline) behaviour is unchanged.
export function upgradeTextarea(textarea, opts = {}) {
  if (textarea.dataset.rteReady === '1') return; // idempotent
  textarea.dataset.rteReady = '1';
  const inline = opts.inline === true;

  const wrapper = document.createElement('div');
  wrapper.className = 'mb-rte';

  const toolbar = document.createElement('div');
  toolbar.className = 'mb-rte__toolbar';

  // Format buttons (left).
  const btnGroup = document.createElement('div');
  btnGroup.className = 'mb-rte__btns';
  toolbar.appendChild(btnGroup);

  // Segmented Rich | Markdown tabs (right). Rich is the default editing view.
  const tabs = document.createElement('div');
  tabs.className = 'mb-rte__tabs';
  const richTab = makeTab('Rich', true);
  const mdTab = makeTab('Markdown', false);
  tabs.append(richTab, mdTab);
  toolbar.appendChild(tabs);

  // Editable rendered surface — the WYSIWYG view, visible by default.
  const surface = document.createElement('div');
  surface.className = 'mb-rte__surface';
  surface.contentEditable = 'true';
  surface.setAttribute('role', 'textbox');
  surface.setAttribute('aria-multiline', String(!inline));
  if (textarea.placeholder) surface.dataset.placeholder = textarea.placeholder;

  // The textarea stays the form value / source of truth (raw markdown); hidden
  // in Rich mode, shown in Markdown mode.
  textarea.classList.add('mb-rte__input');

  textarea.parentNode.insertBefore(wrapper, textarea);
  wrapper.appendChild(toolbar);
  wrapper.appendChild(surface);
  wrapper.appendChild(textarea);

  const rte = {
    textarea, surface, toolbar, btnGroup, richTab, mdTab, buttons: [], mode: 'rich', inline,
    // Google-Docs-style "armed" formatting for the next typed text when there is
    // no selection. `pending` = marks to turn ON (wrap the text); `pendingOff` =
    // marks to turn OFF (escape past the enclosing mark's close), set when you
    // click a mark the caret is already inside. pendingAnchor is the caret offset
    // at arm time, so a later selectionchange tells typing-here from navigating-away.
    pending: new Set(), pendingOff: new Set(), pendingAnchor: 0,
  };

  buildButtons(rte);
  attachLinkPopover(rte);
  attachLabelPopover(rte);
  buildTabs(rte);
  attachSurfaceEvents(rte);
  attachSelectionTracking(rte);
  setMode(rte, 'rich', { focus: false }); // initial render, no focus steal during hydration

  if (inline) {
    // Markdown view: the raw textarea must obey the same single-line rule.
    textarea.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) e.preventDefault(); });
    textarea.addEventListener('paste', e => {
      e.preventDefault();
      const text = collapseNewlines((e.clipboardData || window.clipboardData).getData('text/plain'));
      textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd, 'end');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  wrapper._rte = rte; // expose for tests / later wiring
  return rte;
}

function makeTab(text, active) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mb-rte__tab' + (active ? ' --active' : '');
  b.setAttribute('aria-pressed', String(active));
  b.textContent = text;
  return b;
}

function makeBtn(icon, label, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mb-rte__btn';
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.innerHTML = `<span class="more-buttons-icon">${icon}</span>`;
  btn.addEventListener('mousedown', e => e.preventDefault()); // keep surface/textarea selection
  btn.addEventListener('click', onClick);
  return btn;
}

// ── Label colour palette (shared) ────────────────────────────────────────────
// Loaded once from config/labelColours.json (the extension's existing source)
// and cached for the session. Drives the Label popover swatches AND paints
// `.mb-label` pills wherever they're previewed — the rich surface here, plus the
// datatable whole-table grid (dataTablesEditor renders cells outside any surface
// and imports paintLabels from this module). Kept out of the pure markdownInline
// module because it needs fetch/chrome; the load is lazy so importing this module
// stays test-safe (no fetch at import time).
let _palettePromise = null;
function loadLabelPalette() {
  if (_palettePromise) return _palettePromise;
  _palettePromise = fetch(chrome.runtime.getURL('config/labelColours.json'))
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(groups => {
      const flat = {};
      for (const presets of Object.values(groups)) {
        for (const [name, preset] of Object.entries(presets)) flat[name.toLowerCase()] = preset;
      }
      return { groups, flat };
    })
    .catch(err => { console.error('MB Error: Failed to load labelColours.json:', err); return { groups: {}, flat: {} }; });
  return _palettePromise;
}

// Paint every `.mb-label` pill under `root` from the palette by setting the CSS
// custom props the formsStyling `.mb-label` rule consumes (light + dark, so the
// preview tracks prefers-color-scheme). Async-safe: paints once the palette is
// available, so a render that happened before the fetch resolved still gets
// coloured. Re-render → call again. Purely cosmetic — serialize ignores the
// inline style and re-emits the class-only span.
export function paintLabels(root) {
  if (!root) return;
  loadLabelPalette().then(({ flat }) => {
    root.querySelectorAll('.mb-label').forEach(span => {
      const slug = (span.className.match(/mb-label-([a-z0-9-]+)/) || [])[1];
      const p = slug && flat[slug];
      if (!p) return;
      span.style.setProperty('--bg', p.light.bg);
      span.style.setProperty('--text', p.light.text);
      span.style.setProperty('--border', p.light.border);
      span.style.setProperty('--bg-dark', p.dark.bg);
      span.style.setProperty('--text-dark', p.dark.text);
      span.style.setProperty('--border-dark', p.dark.border);
    });
  });
}

// Single funnel for writing rendered markdown into the surface. Every site that
// replaces surface.innerHTML goes through here so label pills get repainted from
// the colour palette after each render (renderDocHtml emits class-only spans).
function setSurfaceHtml(rte, value) {
  rte.surface.innerHTML = renderDocHtml(value);
  paintLabels(rte.surface);
}

function renderSurface(rte) {
  setSurfaceHtml(rte, rte.textarea.value || '');
}

// Re-render the visible rich surface from the textarea's current value. Call
// after programmatically replacing textarea.value (e.g. a merge rehydrate) so the
// surface doesn't keep showing — and then re-serialize over — a stale value. No-op
// for a plain (non-upgraded) textarea.
export function syncSurfaceFromTextarea(textarea) {
  const rte = textarea?.closest?.('.mb-rte')?._rte;
  if (rte) renderSurface(rte);
}

// Does the surface hold an emptied mark wrapper? (e.g. the user deleted all the
// text inside a <strong>, leaving <strong></strong> with the caret in it.)
function hasEmptyMark(surface) {
  return [...surface.querySelectorAll('strong,b,em,i,u,s,strike,del,mark,code')]
    .some(el => !el.textContent);
}

// Sync the hidden textarea from the surface and fire input so the dirty-guard
// and char counter update. Called on every native edit in the surface.
function syncFromSurface(rte) {
  let value = serialize(rte.surface);
  // Inline mode: native edits the Enter/paste guards can't intercept (e.g. a
  // text drop) can still serialize multi-line content. Collapse it here — the
  // sync chokepoint — so a newline never reaches the cell value.
  if (rte.inline && value.includes('\n')) {
    const { selStart } = serializeWithSelection(rte.surface, window.getSelection());
    value = collapseNewlines(value);
    rte.textarea.value = value;
    setSurfaceHtml(rte, value);
    const caret = Math.min(selStart, value.length);
    placeCaret(rte.surface, caret, caret);
    rte.textarea.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  rte.textarea.value = value;
  // If the edit left an empty mark wrapper, the DOM is non-canonical: serialize
  // already drops the empty mark from the value, but the wrapper still holds the
  // caret, so fresh typing would inherit the (now meaningless) format. Re-render
  // from the clean source and restore the caret so typing continues unformatted.
  if (hasEmptyMark(rte.surface)) {
    const { selStart } = serializeWithSelection(rte.surface, window.getSelection());
    setSurfaceHtml(rte, value);
    placeCaret(rte.surface, selStart, selStart);
  }
  rte.textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

// Read the current selection as { value, selStart, selEnd } for the active mode.
function currentSelection(rte) {
  if (rte.mode === 'markdown') {
    const ta = rte.textarea;
    return { value: ta.value, selStart: ta.selectionStart, selEnd: ta.selectionEnd };
  }
  return serializeWithSelection(rte.surface, window.getSelection());
}

// Write a transformed value back, restoring selection appropriately per mode.
function applyResult(rte, res) {
  rte.textarea.value = res.value;
  if (rte.mode === 'markdown') {
    rte.textarea.focus();
    rte.textarea.setSelectionRange(res.selStart, res.selEnd);
  } else {
    setSurfaceHtml(rte, res.value);
    rte.surface.focus();
    placeCaret(rte.surface, res.selStart, res.selEnd);
  }
  rte.textarea.dispatchEvent(new Event('input', { bubbles: true }));
  refreshActiveStates(rte);
}

// Apply a pure string transform (value, selStart, selEnd) -> {value, selStart, selEnd}.
function runTransform(rte, transform) {
  clearArmed(rte); // an explicit transform supersedes any armed format
  const { value, selStart, selEnd } = currentSelection(rte);
  applyResult(rte, transform(value, selStart, selEnd));
}

function runMarker(rte, marker) {
  // Rich mode with no selection: arm/disarm the marker for the next typed text
  // (Google-Docs style) rather than inserting empty '**' delimiters that would
  // render as literal asterisks. Markdown mode keeps the raw textarea behaviour
  // (insert the paired delimiters with the caret between them).
  if (rte.mode === 'rich') {
    const { selStart, selEnd } = currentSelection(rte);
    if (selStart === selEnd) { toggleArmed(rte, marker, selStart); return; }
  }
  runTransform(rte, (v, s, e) => applyMarker(v, s, e, marker));
}

// Clicking a marker with a collapsed caret toggles what the NEXT typed text will
// be: arm it ON if the caret isn't already inside that mark, or OFF (escape the
// enclosing mark) if it is. A second click cancels a queued arm. The caret offset
// is remembered so a later selectionchange can disarm on navigate-away.
function toggleArmed(rte, marker, anchor) {
  const mark = MARKS.find(m => m.marker === marker);
  const tags = selectionMarkTags(rte);
  const inside = !!mark && mark.tags.some(t => tags.has(t));
  if (rte.pending.has(marker)) rte.pending.delete(marker);
  else if (rte.pendingOff.has(marker)) rte.pendingOff.delete(marker);
  else if (inside) rte.pendingOff.add(marker);
  else rte.pending.add(marker);
  rte.pendingAnchor = anchor;
  rte.surface.focus();
  refreshActiveStates(rte);
}

function isArmed(rte) { return rte.pending.size > 0 || rte.pendingOff.size > 0; }
function clearArmed(rte) { rte.pending.clear(); rte.pendingOff.clear(); }

// The armed-on markers in nesting order (outermost first), per MARKS order.
function pendingMarkers(rte) {
  return MARKS.filter(m => rte.pending.has(m.marker)).map(m => m.marker);
}

// Pure: insert `data` at a collapsed caret with the armed format applied.
// `addMarkers` (outermost first) wrap the text; for each marker in `offMarkers`
// that encloses the caret, the insertion point is moved past that mark's closing
// delimiter so the new text lands OUTSIDE it. Returns { value, selStart, selEnd }.
export function computeArmedInsertion(value, caret, data, addMarkers, offMarkers) {
  let insertAt = caret;
  if (offMarkers && offMarkers.size) {
    for (const sp of markSpans(value)) {
      if (offMarkers.has(sp.marker) && sp.open[1] <= insertAt && insertAt <= sp.close[0]) {
        insertAt = Math.max(insertAt, sp.close[1]);
      }
    }
  }
  const open = addMarkers.join('');
  const close = addMarkers.slice().reverse().join('');
  const pos = insertAt + open.length + data.length;
  return {
    value: value.slice(0, insertAt) + open + data + close + value.slice(insertAt),
    selStart: pos, selEnd: pos,
  };
}

// Bind the pure computeArmedInsertion to the current armed state.
function armedInsertion(rte, value, caret, data) {
  return computeArmedInsertion(value, caret, data, pendingMarkers(rte), rte.pendingOff);
}

// Inline code and labels are EXCLUSIVE containers: their text can carry no other
// inline formatting (bold/italic/underline/strike/highlight/link), they can't
// nest in each other, and no inline mark may wrap them. Positional/block formats
// (lists, indent) are unaffected. We enforce this in Rich mode by disabling the
// conflicting toolbar buttons for the caret's context, so a format can never be
// stacked onto — or wrapped around — a code span or label pill.
const NON_CODE_MARK_TAGS = ['strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'mark'];

// Light each format button to reflect what the next typed text would be: lit when
// the caret sits inside that mark (Rich mode) or it's armed on, UNLESS it's armed
// off (the user just clicked to exit it). Also disables buttons that would break
// the code/label exclusivity rule above.
function refreshActiveStates(rte) {
  const rich = rte.mode === 'rich';
  const activeTags = rich ? selectionMarkTags(rte) : new Set();
  const inLabel = rich && selectionInLabel(rte);
  const inCode = activeTags.has('code');
  const inOtherMark = NON_CODE_MARK_TAGS.some(t => activeTags.has(t));
  const inLink = activeTags.has('a'); // normal link or groove anchor
  rte.buttons.forEach(btn => {
    const mark = btn._mark;
    if (mark) {
      const inside = mark.tags.some(t => activeTags.has(t));
      const active = (inside || rte.pending.has(mark.marker)) && !rte.pendingOff.has(mark.marker);
      btn.classList.toggle('--active', active);
      btn.setAttribute('aria-pressed', String(active));
      if (mark.marker === '`') {
        // Code: addable only from a clean context, but always toggle-OFF-able
        // when the caret is already inside code.
        btn.disabled = rich && !inCode && (inLabel || inOtherMark || inLink);
      } else {
        // Other marks can't go inside a code span or a label pill.
        btn.disabled = rich && (inCode || inLabel);
      }
      return;
    }
    if (btn._list) {
      // List buttons have no armed state: lit purely when the caret's line is
      // rendered inside that list kind.
      const active = activeTags.has(btn._list.tag);
      btn.classList.toggle('--active', active);
      btn.setAttribute('aria-pressed', String(active));
      return;
    }
    if (btn._indent) {
      // Indent/outdent only make sense inside a list. In Rich mode grey them out
      // unless the caret sits within an <li> (live-updated on selectionchange). In
      // Markdown mode leave them enabled — selectionchange skips that mode, so a
      // disabled flag would go stale; the transform is a harmless no-op off-list.
      btn.disabled = rich && !activeTags.has('li');
      return;
    }
    if (btn._hr) {
      // A horizontal rule can't be inserted inside a code span or label pill —
      // it would split the exclusive container's content.
      btn.disabled = rich && (inCode || inLabel);
      return;
    }
    if (btn._link) {
      // Links can't go inside a code span or label pill.
      btn.disabled = rich && (inCode || inLabel);
      return;
    }
    if (btn._label) {
      // Labels are addable only from a clean context, but always editable/removable
      // when the caret is already inside one.
      const active = inLabel;
      btn.classList.toggle('--active', active);
      btn.disabled = rich && !inLabel && (inCode || inOtherMark || inLink);
      return;
    }
    // The clear button carries no state.
  });
}

// Tag names of every element between the selection anchor and the surface.
function selectionMarkTags(rte) {
  const tags = new Set();
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return tags;
  let node = sel.anchorNode;
  if (!node || !rte.surface.contains(node)) return tags;
  while (node && node !== rte.surface) {
    if (node.nodeType === 1) tags.add(node.tagName.toLowerCase());
    node = node.parentNode;
  }
  return tags;
}

// Whether the caret/anchor sits inside a label pill (a `.mb-label` span). Labels
// are spans, so they can't be told apart by tag name in selectionMarkTags — this
// walks the ancestor chain checking the class.
function selectionInLabel(rte) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  let node = sel.anchorNode;
  if (!node || !rte.surface.contains(node)) return false;
  while (node && node !== rte.surface) {
    if (node.nodeType === 1 && node.classList && node.classList.contains('mb-label')) return true;
    node = node.parentNode;
  }
  return false;
}

function buildButtons(rte) {
  MARKS.forEach(m => {
    const btn = makeBtn(m.icon, m.label, () => runMarker(rte, m.marker));
    btn._mark = m;
    rte.btnGroup.appendChild(btn);
    rte.buttons.push(btn);
  });
  if (!rte.inline) {
    LISTS.forEach(l => {
      const btn = makeBtn(l.icon, l.label, () => runTransform(rte, (v, s, e) => toggleList(v, s, e, l.kind)));
      btn._list = l;
      rte.btnGroup.appendChild(btn);
      rte.buttons.push(btn);
    });
    INDENTS.forEach(ind => {
      const btn = makeBtn(ind.icon, ind.label, () => runTransform(rte, (v, s, e) => indentSelection(v, s, e, ind.dir)));
      btn._indent = ind;
      rte.btnGroup.appendChild(btn);
      rte.buttons.push(btn);
    });

    // Horizontal rule (thematic break). A one-shot block insert with no active
    // state — multiline only, since a single-line cell can't hold a block.
    const hrBtn = makeBtn('horizontal_rule', 'Horizontal rule', () => runTransform(rte, insertHorizontalRule));
    hrBtn._hr = true;
    rte.btnGroup.appendChild(hrBtn);
    rte.buttons.push(hrBtn);
  }

  const linkBtn = makeBtn('link', 'Link', () => rte.openLinkPopover?.());
  linkBtn._link = true;
  rte.btnGroup.appendChild(linkBtn);
  rte.buttons.push(linkBtn);

  // Label pill — always added (like Link), so it works in inline cell editors too.
  const labelBtn = makeBtn('label', 'Label', () => rte.openLabelPopover?.());
  labelBtn._label = true;
  rte.btnGroup.appendChild(labelBtn);
  rte.buttons.push(labelBtn);

  const clearBtn = makeBtn('format_clear', 'Clear formatting', () => runStrip(rte));
  rte.btnGroup.appendChild(clearBtn);
  rte.buttons.push(clearBtn);
}

// Strip all inline formatting from the current selection (both modes). No-op on
// a collapsed selection (stripFormatting returns the value unchanged).
function runStrip(rte) {
  runTransform(rte, stripFormatting);
}

function buildTabs(rte) {
  rte.richTab.addEventListener('click', () => setMode(rte, 'rich'));
  rte.mdTab.addEventListener('click', () => setMode(rte, 'markdown'));
}

function setMode(rte, mode, { focus = true } = {}) {
  // Sync the textarea from the surface before leaving Rich mode so Markdown
  // mode shows the current value.
  if (rte.mode === 'rich' && mode === 'markdown') rte.textarea.value = serialize(rte.surface);
  clearArmed(rte); // arming is a Rich-mode, in-flight state; never carry it across a mode switch
  rte.mode = mode;
  const rich = mode === 'rich';
  rte.richTab.classList.toggle('--active', rich);
  rte.mdTab.classList.toggle('--active', !rich);
  rte.richTab.setAttribute('aria-pressed', String(rich));
  rte.mdTab.setAttribute('aria-pressed', String(!rich));
  rte.surface.hidden = !rich;
  rte.textarea.hidden = rich;
  if (rich) {
    renderSurface(rte);
    if (focus) rte.surface.focus();
  } else if (focus) {
    rte.textarea.focus();
  }
  refreshActiveStates(rte);
}

function attachSurfaceEvents(rte) {
  const { surface } = rte;

  // Armed formatting consumes the next typed character(s): apply the armed marks
  // at the source level (wrapping for arm-on, escaping the enclosing mark for
  // arm-off) and place the caret so subsequent native typing continues in the
  // right context. Only plain text insertions consume the armed state;
  // navigation and deletion leave it for the selectionchange handler to clear.
  surface.addEventListener('beforeinput', e => {
    if (rte.inline && (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak')) { e.preventDefault(); return; }
    if (!isArmed(rte) || e.inputType !== 'insertText') return;
    const data = e.data;
    if (data == null || data === '') return;
    e.preventDefault();
    const { value, selStart } = currentSelection(rte);
    applyResult(rte, armedInsertion(rte, value, selStart, data));
    clearArmed(rte);
    refreshActiveStates(rte);
  });

  // Tab / Shift+Tab nest the current list item one level deeper / shallower, but
  // only when the caret is on a list line — elsewhere Tab keeps its native
  // behaviour (moving focus out of the editor, which keyboard users rely on).
  surface.addEventListener('keydown', e => {
    if (rte.inline && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); return; }
    if (e.key !== 'Tab') return;
    const { value, selStart } = currentSelection(rte);
    if (!isListLineAt(value, selStart)) return;
    e.preventDefault();
    const dir = e.shiftKey ? -1 : 1;
    runTransform(rte, (v, s, end) => indentSelection(v, s, end, dir));
  });

  surface.addEventListener('input', () => syncFromSurface(rte));

  // Plain-text paste only — no foreign HTML enters the surface. If a format is
  // armed, the pasted text is wrapped in it.
  surface.addEventListener('paste', e => {
    e.preventDefault();
    let text = (e.clipboardData || window.clipboardData).getData('text/plain');
    if (rte.inline) text = collapseNewlines(text);
    const { value, selStart, selEnd } = currentSelection(rte);
    if (isArmed(rte)) {
      applyResult(rte, armedInsertion(rte, value, selStart, text));
      clearArmed(rte);
      refreshActiveStates(rte);
    } else {
      const caret = selStart + text.length;
      applyResult(rte, { value: value.slice(0, selStart) + text + value.slice(selEnd), selStart: caret, selEnd: caret });
    }
  });

  // Don't navigate when clicking a link while editing.
  surface.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a');
    if (a) e.preventDefault();
  });
}

// Keep the toolbar's active states in sync with the caret, and disarm a pending
// format when the user moves the caret away without typing.
function attachSelectionTracking(rte) {
  document.addEventListener('selectionchange', () => {
    if (rte.mode !== 'rich') return; // Markdown mode: buttons stay off
    if (isArmed(rte)) {
      const sel = window.getSelection();
      const inSurface = sel && sel.anchorNode && rte.surface.contains(sel.anchorNode);
      if (!inSurface) {
        clearArmed(rte);
      } else {
        const { selStart, selEnd } = currentSelection(rte);
        if (selStart !== selEnd || selStart !== rte.pendingAnchor) clearArmed(rte);
      }
    }
    refreshActiveStates(rte);
  });
}

function attachLinkPopover(rte) {
  const { toolbar } = rte;
  let saved = null; // { value, selStart, selEnd } captured when the popover opens

  const popover = document.createElement('div');
  popover.className = 'mb-rte__popover';
  popover.hidden = true;
  popover.innerHTML = `
    <div class="mb-rte__tabs" role="tablist">
      <button type="button" class="mb-rte__tab" data-tab="url">URL</button>
      <button type="button" class="mb-rte__tab" data-tab="groove">Groove Support</button>
    </div>
    <div class="mb-rte__panel" data-panel="url">
      <label class="mb-rte__field"><span>Text</span><input type="text" data-link-text></label>
      <label class="mb-rte__field"><span>URL</span><input type="text" data-link-url placeholder="https://"></label>
    </div>
    <div class="mb-rte__panel" data-panel="groove" hidden>
      <p class="mb-rte__hint">Creates an embedded link that opens the Groove support popup widget.</p>
      <label class="mb-rte__field"><span>Text</span><input type="text" data-groove-text></label>
    </div>
    <div class="mb-rte__popover-actions">
      <button type="button" class="mb-rte__popover-btn" data-link-cancel>Cancel</button>
      <button type="button" class="mb-rte__popover-btn --primary" data-link-insert>Insert</button>
    </div>`;
  toolbar.parentNode.insertBefore(popover, toolbar.nextSibling);

  const textInput = popover.querySelector('[data-link-text]');
  const urlInput = popover.querySelector('[data-link-url]');
  const grooveInput = popover.querySelector('[data-groove-text]');
  const tabs = [...popover.querySelectorAll('[data-tab]')];
  const panels = [...popover.querySelectorAll('[data-panel]')];
  let activeTab = 'url';

  // Show one tab's panel and focus its first input. Used by the tab buttons and
  // by openLinkPopover when detection picks a tab from the caret context.
  const setTab = (name, focus = true) => {
    activeTab = name;
    for (const t of tabs) t.classList.toggle('--active', t.dataset.tab === name);
    for (const p of panels) p.hidden = p.dataset.panel !== name;
    if (focus) (name === 'groove' ? grooveInput : urlInput).focus();
  };
  // Carry the Text across when the user switches tabs so it's preserved (the two
  // tabs each have their own Text input; the URL/Groove specifics don't carry).
  for (const t of tabs) t.addEventListener('click', () => {
    const to = t.dataset.tab;
    if (to !== activeTab) {
      const fromInput = activeTab === 'groove' ? grooveInput : textInput;
      const toInput = to === 'groove' ? grooveInput : textInput;
      toInput.value = fromInput.value;
    }
    setTab(to);
  });

  const onDocMouseDown = e => {
    if (!popover.hidden && !popover.contains(e.target) && !toolbar.contains(e.target)) close();
  };
  const close = () => { popover.hidden = true; document.removeEventListener('mousedown', onDocMouseDown); };

  rte.openLinkPopover = () => {
    saved = currentSelection(rte); // capture before focus moves to the popover inputs
    const selText = saved.value.slice(saved.selStart, saved.selEnd);
    // Close any sibling popover (e.g. the label one) so only this is visible.
    for (const p of toolbar.parentNode.querySelectorAll('.mb-rte__popover')) if (p !== popover) p.hidden = true;
    // Show first: setTab focuses an input, which is a no-op while still hidden.
    popover.hidden = false;
    document.addEventListener('mousedown', onDocMouseDown);
    // Detection picks the tab and prefills. When the caret sits inside an existing
    // link/anchor we widen the saved range to its whole syntax so Insert REPLACES
    // it rather than nesting a new one inside it.
    const groove = grooveAt(saved.value, saved.selStart, saved.selEnd);
    const link = groove ? null : linkAt(saved.value, saved.selStart, saved.selEnd);
    if (groove) {
      saved.selStart = groove.start;
      saved.selEnd = groove.end;
      grooveInput.value = groove.text;
      textInput.value = ''; urlInput.value = '';
      setTab('groove');
    } else if (link) {
      saved.selStart = link.start;
      saved.selEnd = link.end;
      textInput.value = link.text;
      urlInput.value = link.href;
      grooveInput.value = '';
      setTab('url');
    } else {
      // Plain text / selection: seed both tabs' Text from the selection so either
      // kind wraps it; default to the URL tab.
      textInput.value = selText;
      urlInput.value = '';
      grooveInput.value = selText;
      setTab('url');
    }
  };

  popover.querySelector('[data-link-cancel]').addEventListener('click', close);

  popover.querySelector('[data-link-insert]').addEventListener('click', () => {
    if (activeTab === 'groove') {
      const text = grooveInput.value.trim();
      if (!text) { close(); return; } // empty text → no-op
      close();
      clearArmed(rte);
      applyResult(rte, applyGroove(saved.value, saved.selStart, saved.selEnd, text));
      return;
    }
    const url = urlInput.value.trim();
    const text = textInput.value.trim() || url;
    if (!url) { close(); return; } // empty URL → no-op
    close();
    clearArmed(rte);
    applyResult(rte, applyLink(saved.value, saved.selStart, saved.selEnd, text, url));
  });

  // Esc dismiss (click-outside is wired in openLinkPopover/close).
  popover.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}

// Coloured "label" pill popover. Mirrors attachLinkPopover: a Text field plus a
// grid of colour swatches (loaded from config/labelColours.json — the same source
// the rest of the extension uses). Inserts a class-only `<span class="mb-label
// mb-label-<slug>">` via applyLabel; recolours/removes an existing pill when the
// caret sits inside one (detected with labelAt). Available in inline cells too.
function attachLabelPopover(rte) {
  const { toolbar } = rte;
  let saved = null;        // { value, selStart, selEnd } captured when the popover opens
  let selectedSlug = null; // the swatch the user picked (or the edited pill's colour)
  let firstSlug = null;    // default selection for a fresh insert

  const popover = document.createElement('div');
  popover.className = 'mb-rte__popover mb-rte__popover--label';
  popover.hidden = true;
  popover.innerHTML = `
    <div class="mb-rte__panel" data-panel="label">
      <label class="mb-rte__field"><span>Text</span><input type="text" data-label-text></label>
      <div class="mb-rte__swatch-grid" data-label-swatches></div>
    </div>
    <div class="mb-rte__popover-actions">
      <button type="button" class="mb-rte__popover-btn" data-label-remove hidden>Remove</button>
      <button type="button" class="mb-rte__popover-btn" data-label-cancel>Cancel</button>
      <button type="button" class="mb-rte__popover-btn --primary" data-label-insert>Insert</button>
    </div>`;
  toolbar.parentNode.insertBefore(popover, toolbar.nextSibling);

  const textInput = popover.querySelector('[data-label-text]');
  const swatches = popover.querySelector('[data-label-swatches]');
  const removeBtn = popover.querySelector('[data-label-remove]');
  const swatchBtns = [];

  const selectSwatch = slug => {
    selectedSlug = slug;
    swatchBtns.forEach(b => b.classList.toggle('--selected', b.dataset.slug === slug));
  };

  // Build the grouped swatch grid from the loaded palette. Each swatch carries
  // its colours as the same CSS custom props the .mb-label rule consumes, so it
  // renders as a live pill of that colour.
  const buildSwatches = groups => {
    swatches.replaceChildren();
    swatchBtns.length = 0;
    for (const [groupName, presets] of Object.entries(groups)) {
      const title = document.createElement('span');
      title.className = 'mb-rte__swatch-title';
      title.textContent = groupName;
      swatches.appendChild(title);
      const row = document.createElement('div');
      row.className = 'mb-rte__swatch-row';
      for (const [name, preset] of Object.entries(presets)) {
        const slug = name.toLowerCase();
        if (firstSlug === null) firstSlug = slug;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mb-label mb-rte__swatch mb-label-' + slug;
        btn.dataset.slug = slug;
        btn.textContent = name;
        btn.style.setProperty('--bg', preset.light.bg);
        btn.style.setProperty('--text', preset.light.text);
        btn.style.setProperty('--border', preset.light.border);
        btn.style.setProperty('--bg-dark', preset.dark.bg);
        btn.style.setProperty('--text-dark', preset.dark.text);
        btn.style.setProperty('--border-dark', preset.dark.border);
        btn.addEventListener('mousedown', e => e.preventDefault()); // keep selection
        btn.addEventListener('click', () => selectSwatch(slug));
        swatchBtns.push(btn);
        row.appendChild(btn);
      }
      swatches.appendChild(row);
    }
  };

  // Build the swatch grid once the shared palette is loaded. The surface itself
  // is painted via setSurfaceHtml → paintLabels (which awaits the same cache).
  loadLabelPalette().then(({ groups }) => buildSwatches(groups));

  const onDocMouseDown = e => {
    if (!popover.hidden && !popover.contains(e.target) && !toolbar.contains(e.target)) close();
  };
  const close = () => { popover.hidden = true; document.removeEventListener('mousedown', onDocMouseDown); };

  rte.openLabelPopover = () => {
    saved = currentSelection(rte);
    const selText = saved.value.slice(saved.selStart, saved.selEnd);
    // Close any sibling popover (e.g. the link one) so only this is visible.
    for (const p of toolbar.parentNode.querySelectorAll('.mb-rte__popover')) if (p !== popover) p.hidden = true;
    popover.hidden = false;
    document.addEventListener('mousedown', onDocMouseDown);
    const existing = labelAt(saved.value, saved.selStart, saved.selEnd);
    if (existing) {
      // Caret inside a pill: widen to its whole span so Insert REPLACES it, prefill
      // its text + colour, and offer Remove.
      saved.selStart = existing.start;
      saved.selEnd = existing.end;
      textInput.value = existing.text;
      selectSwatch(existing.slug);
      removeBtn.hidden = false;
    } else {
      textInput.value = selText;
      selectSwatch(selectedSlug || firstSlug);
      removeBtn.hidden = true;
    }
    textInput.focus();
  };

  popover.querySelector('[data-label-cancel]').addEventListener('click', close);

  popover.querySelector('[data-label-insert]').addEventListener('click', () => {
    const text = textInput.value.trim();
    const slug = selectedSlug || firstSlug;
    if (!text || !slug) { close(); return; } // nothing to insert → no-op
    close();
    clearArmed(rte);
    applyResult(rte, applyLabel(saved.value, saved.selStart, saved.selEnd, text, slug));
  });

  removeBtn.addEventListener('click', () => {
    // Unwrap the pill back to its plain text.
    const text = textInput.value;
    const caret = saved.selStart + text.length;
    close();
    clearArmed(rte);
    applyResult(rte, { value: saved.value.slice(0, saved.selStart) + text + saved.value.slice(saved.selEnd), selStart: caret, selEnd: caret });
  });

  popover.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}
