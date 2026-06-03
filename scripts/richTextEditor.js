import { parseInline, renderHtml } from './markdownInline.js';
import { applyMarker, applyLink } from './markdownToolbarActions.js';
import { serialize, serializeWithSelection, placeCaret } from './richEditorMapping.js';

// Toolbar marks: { marker } is the literal markdown delimiter the toolbar
// applies (via the pure markdownToolbarActions transforms); { tags } are the
// rendered HTML tags that mean "this mark is active" (used to light the button
// when the caret sits inside it). Order matters: it is the nesting order used
// when several marks are armed at once (outermost first). Matches the old toolbar.
const MARKS = [
  { marker: '**', tags: ['strong', 'b'], icon: 'format_bold', label: 'Bold (Ctrl/Cmd+B)' },
  { marker: '*', tags: ['em', 'i'], icon: 'format_italic', label: 'Italic (Ctrl/Cmd+I)' },
  { marker: '^^', tags: ['u'], icon: 'format_underlined', label: 'Underline (Ctrl/Cmd+U)' },
  { marker: '~~', tags: ['s', 'strike', 'del'], icon: 'strikethrough_s', label: 'Strikethrough' },
  { marker: '==', tags: ['mark'], icon: 'format_ink_highlighter', label: 'Highlight' },
];

const SHORTCUT = { b: '**', i: '*', u: '^^' };

export function upgradeTextarea(textarea) {
  if (textarea.dataset.rteReady === '1') return; // idempotent
  textarea.dataset.rteReady = '1';

  const wrapper = document.createElement('div');
  wrapper.className = 'mb-rte';

  const toolbar = document.createElement('div');
  toolbar.className = 'mb-rte__toolbar';

  // Segmented Rich | Markdown tabs (left). Rich is the default editing view.
  const tabs = document.createElement('div');
  tabs.className = 'mb-rte__tabs';
  const richTab = makeTab('Rich', true);
  const mdTab = makeTab('Markdown', false);
  tabs.append(richTab, mdTab);
  toolbar.appendChild(tabs);

  // Format buttons (right).
  const btnGroup = document.createElement('div');
  btnGroup.className = 'mb-rte__btns';
  toolbar.appendChild(btnGroup);

  // Editable rendered surface — the WYSIWYG view, visible by default.
  const surface = document.createElement('div');
  surface.className = 'mb-rte__surface';
  surface.contentEditable = 'true';
  surface.setAttribute('role', 'textbox');
  surface.setAttribute('aria-multiline', 'true');
  if (textarea.placeholder) surface.dataset.placeholder = textarea.placeholder;

  // The textarea stays the form value / source of truth (raw markdown); hidden
  // in Rich mode, shown in Markdown mode.
  textarea.classList.add('mb-rte__input');

  textarea.parentNode.insertBefore(wrapper, textarea);
  wrapper.appendChild(toolbar);
  wrapper.appendChild(surface);
  wrapper.appendChild(textarea);

  const rte = {
    textarea, surface, toolbar, btnGroup, richTab, mdTab, buttons: [], mode: 'rich',
    // Google-Docs-style "armed" formatting: marks the next typed text will get
    // when there is no selection. pendingAnchor is the caret offset at arm time,
    // so a later selectionchange can tell typing-here from navigating-away.
    pending: new Set(), pendingAnchor: 0,
  };

  buildButtons(rte);
  attachLinkPopover(rte);
  buildTabs(rte);
  attachSurfaceEvents(rte);
  attachShortcuts(rte);
  attachSelectionTracking(rte);
  setMode(rte, 'rich', { focus: false }); // initial render, no focus steal during hydration

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
  rte.surface.innerHTML = renderHtml(parseInline(rte.textarea.value || ''));
}

// Does the surface hold an emptied mark wrapper? (e.g. the user deleted all the
// text inside a <strong>, leaving <strong></strong> with the caret in it.)
function hasEmptyMark(surface) {
  return [...surface.querySelectorAll('strong,b,em,i,u,s,strike,del,mark')]
    .some(el => !el.textContent);
}

// Sync the hidden textarea from the surface and fire input so the dirty-guard
// and char counter update. Called on every native edit in the surface.
function syncFromSurface(rte) {
  const value = serialize(rte.surface);
  rte.textarea.value = value;
  // If the edit left an empty mark wrapper, the DOM is non-canonical: serialize
  // already drops the empty mark from the value, but the wrapper still holds the
  // caret, so fresh typing would inherit the (now meaningless) format. Re-render
  // from the clean source and restore the caret so typing continues unformatted.
  if (hasEmptyMark(rte.surface)) {
    const { selStart } = serializeWithSelection(rte.surface, window.getSelection());
    rte.surface.innerHTML = renderHtml(parseInline(value));
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
    rte.surface.innerHTML = renderHtml(parseInline(res.value));
    rte.surface.focus();
    placeCaret(rte.surface, res.selStart, res.selEnd);
  }
  rte.textarea.dispatchEvent(new Event('input', { bubbles: true }));
  refreshActiveStates(rte);
}

// Apply a pure string transform (value, selStart, selEnd) -> {value, selStart, selEnd}.
function runTransform(rte, transform) {
  rte.pending.clear(); // an explicit transform supersedes any armed format
  const { value, selStart, selEnd } = currentSelection(rte);
  applyResult(rte, transform(value, selStart, selEnd));
}

function runMarker(rte, marker) {
  // Rich mode with no selection: arm the marker for the next typed text
  // (Google-Docs style) rather than inserting empty '**' delimiters that would
  // render as literal asterisks. Markdown mode keeps the raw textarea behaviour
  // (insert the paired delimiters with the caret between them).
  if (rte.mode === 'rich') {
    const { selStart, selEnd } = currentSelection(rte);
    if (selStart === selEnd) { togglePending(rte, marker, selStart); return; }
  }
  runTransform(rte, (v, s, e) => applyMarker(v, s, e, marker));
}

// Toggle a marker in the armed set and remember where the caret was, so the
// next selectionchange can disarm it if the user navigates away without typing.
function togglePending(rte, marker, anchor) {
  if (rte.pending.has(marker)) rte.pending.delete(marker);
  else rte.pending.add(marker);
  rte.pendingAnchor = anchor;
  rte.surface.focus();
  refreshActiveStates(rte);
}

// The armed markers in nesting order (outermost first), per MARKS order.
function pendingMarkers(rte) {
  return MARKS.filter(m => rte.pending.has(m.marker)).map(m => m.marker);
}

// Splice `data` into the source at the selection, wrapped in `markers`
// (outermost first), leaving a collapsed caret inside the wrap.
function spliceFormatted(value, selStart, selEnd, data, markers) {
  const open = markers.join('');
  const close = markers.slice().reverse().join('');
  const caret = selStart + open.length + data.length;
  return {
    value: value.slice(0, selStart) + open + data + close + value.slice(selEnd),
    selStart: caret, selEnd: caret,
  };
}

// Light each format button when its mark is armed, or when the caret/selection
// sits inside that mark in the rendered surface (Rich mode only).
function refreshActiveStates(rte) {
  const activeTags = rte.mode === 'rich' ? selectionMarkTags(rte) : new Set();
  rte.buttons.forEach(btn => {
    const mark = btn._mark;
    if (!mark) return; // the link button carries no mark
    const active = rte.pending.has(mark.marker) || mark.tags.some(t => activeTags.has(t));
    btn.classList.toggle('--active', active);
    btn.setAttribute('aria-pressed', String(active));
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
  const linkBtn = makeBtn('link', 'Link (Ctrl/Cmd+K)', () => rte.openLinkPopover?.());
  rte.btnGroup.appendChild(linkBtn);
  rte.buttons.push(linkBtn);
}

function buildTabs(rte) {
  rte.richTab.addEventListener('click', () => setMode(rte, 'rich'));
  rte.mdTab.addEventListener('click', () => setMode(rte, 'markdown'));
}

function setMode(rte, mode, { focus = true } = {}) {
  // Sync the textarea from the surface before leaving Rich mode so Markdown
  // mode shows the current value.
  if (rte.mode === 'rich' && mode === 'markdown') rte.textarea.value = serialize(rte.surface);
  rte.pending.clear(); // arming is a Rich-mode, in-flight state; never carry it across a mode switch
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

  // Armed formatting consumes the next typed character(s): wrap them in the
  // armed markers at the source level and drop the caret inside the new mark,
  // so subsequent native typing continues inside it. Only plain text insertions
  // consume the armed state; navigation and deletion leave it for the
  // selectionchange handler to clear.
  surface.addEventListener('beforeinput', e => {
    if (!rte.pending.size || e.inputType !== 'insertText') return;
    const data = e.data;
    if (data == null || data === '') return;
    e.preventDefault();
    const { value, selStart, selEnd } = currentSelection(rte);
    applyResult(rte, spliceFormatted(value, selStart, selEnd, data, pendingMarkers(rte)));
    rte.pending.clear();
    refreshActiveStates(rte);
  });

  surface.addEventListener('input', () => syncFromSurface(rte));

  // Plain-text paste only — no foreign HTML enters the surface. If a format is
  // armed, the pasted text is wrapped in it.
  surface.addEventListener('paste', e => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    const { value, selStart, selEnd } = currentSelection(rte);
    if (rte.pending.size) {
      applyResult(rte, spliceFormatted(value, selStart, selEnd, text, pendingMarkers(rte)));
      rte.pending.clear();
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

function attachShortcuts(rte) {
  const handler = e => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const key = e.key.toLowerCase();
    if (SHORTCUT[key]) { e.preventDefault(); runMarker(rte, SHORTCUT[key]); }
    else if (key === 'k') { e.preventDefault(); rte.openLinkPopover?.(); }
  };
  rte.surface.addEventListener('keydown', handler);
  rte.textarea.addEventListener('keydown', handler);
}

// Keep the toolbar's active states in sync with the caret, and disarm a pending
// format when the user moves the caret away without typing.
function attachSelectionTracking(rte) {
  document.addEventListener('selectionchange', () => {
    if (rte.mode !== 'rich') return; // Markdown mode: buttons stay off
    if (rte.pending.size) {
      const sel = window.getSelection();
      const inSurface = sel && sel.anchorNode && rte.surface.contains(sel.anchorNode);
      if (!inSurface) {
        rte.pending.clear();
      } else {
        const { selStart, selEnd } = currentSelection(rte);
        if (selStart !== selEnd || selStart !== rte.pendingAnchor) rte.pending.clear();
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
    textInput.value = saved.value.slice(saved.selStart, saved.selEnd);
    urlInput.value = '';
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
    rte.pending.clear();
    applyResult(rte, applyLink(saved.value, saved.selStart, saved.selEnd, text, url));
  });

  // Esc dismiss (click-outside is wired in openLinkPopover/close).
  popover.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}
