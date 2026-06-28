import { markSpans, renderDocHtml } from './markdownInline.js';
import { applyMarker, applyLink, linkAt, stripFormatting, toggleList, indentSelection, isListLineAt, insertHorizontalRule } from './markdownToolbarActions.js';
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

function renderSurface(rte) {
  rte.surface.innerHTML = renderDocHtml(rte.textarea.value || '');
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
    rte.surface.innerHTML = renderDocHtml(value);
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
    rte.surface.innerHTML = renderDocHtml(value);
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
    rte.surface.innerHTML = renderDocHtml(res.value);
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

// Light each format button to reflect what the next typed text would be: lit when
// the caret sits inside that mark (Rich mode) or it's armed on, UNLESS it's armed
// off (the user just clicked to exit it).
function refreshActiveStates(rte) {
  const activeTags = rte.mode === 'rich' ? selectionMarkTags(rte) : new Set();
  rte.buttons.forEach(btn => {
    const mark = btn._mark;
    if (mark) {
      const inside = mark.tags.some(t => activeTags.has(t));
      const active = (inside || rte.pending.has(mark.marker)) && !rte.pendingOff.has(mark.marker);
      btn.classList.toggle('--active', active);
      btn.setAttribute('aria-pressed', String(active));
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
      btn.disabled = rte.mode === 'rich' && !activeTags.has('li');
      return;
    }
    // The link / clear buttons carry no state.
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
    rte.btnGroup.appendChild(hrBtn);
    rte.buttons.push(hrBtn);
  }

  const linkBtn = makeBtn('link', 'Link', () => rte.openLinkPopover?.());
  rte.btnGroup.appendChild(linkBtn);
  rte.buttons.push(linkBtn);

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
    <label class="mb-rte__field"><span>Text</span><input type="text" data-link-text></label>
    <label class="mb-rte__field"><span>URL</span><input type="text" data-link-url placeholder="https://"></label>
    <div class="mb-rte__popover-actions">
      <button type="button" class="mb-rte__popover-btn" data-link-cancel>Cancel</button>
      <button type="button" class="mb-rte__popover-btn --primary" data-link-insert>Insert</button>
    </div>`;
  toolbar.parentNode.insertBefore(popover, toolbar.nextSibling);

  const textInput = popover.querySelector('[data-link-text]');
  const urlInput = popover.querySelector('[data-link-url]');
  const onDocMouseDown = e => {
    if (!popover.hidden && !popover.contains(e.target) && !toolbar.contains(e.target)) close();
  };
  const close = () => { popover.hidden = true; document.removeEventListener('mousedown', onDocMouseDown); };

  rte.openLinkPopover = () => {
    saved = currentSelection(rte); // capture before focus moves to the popover inputs
    // If the selection sits inside an existing link, edit it: prefill both
    // fields from that link and widen the saved range to its whole `[text](url)`
    // syntax so Insert REPLACES the link rather than nesting a new one in it.
    const existing = linkAt(saved.value, saved.selStart, saved.selEnd);
    if (existing) {
      saved.selStart = existing.start;
      saved.selEnd = existing.end;
      textInput.value = existing.text;
      urlInput.value = existing.href;
    } else {
      textInput.value = saved.value.slice(saved.selStart, saved.selEnd);
      urlInput.value = '';
    }
    popover.hidden = false;
    document.addEventListener('mousedown', onDocMouseDown);
    urlInput.focus();
  };

  popover.querySelector('[data-link-cancel]').addEventListener('click', close);

  popover.querySelector('[data-link-insert]').addEventListener('click', () => {
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
