import { parseInline, renderHtml } from './markdownInline.js';
import { applyMarker, applyLink } from './markdownToolbarActions.js';
import { serialize, serializeWithSelection, placeCaret } from './richEditorMapping.js';

// Toolbar marks: { marker } is the literal markdown delimiter the toolbar
// applies (via the pure markdownToolbarActions transforms). Order matches the
// old toolbar.
const MARKS = [
  { marker: '**', icon: 'format_bold', label: 'Bold (Ctrl/Cmd+B)' },
  { marker: '*', icon: 'format_italic', label: 'Italic (Ctrl/Cmd+I)' },
  { marker: '^^', icon: 'format_underlined', label: 'Underline (Ctrl/Cmd+U)' },
  { marker: '~~', icon: 'strikethrough_s', label: 'Strikethrough' },
  { marker: '==', icon: 'format_ink_highlighter', label: 'Highlight' },
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

  const rte = { textarea, surface, toolbar, btnGroup, richTab, mdTab, buttons: [], mode: 'rich' };

  buildButtons(rte);
  attachLinkPopover(rte);
  buildTabs(rte);
  attachSurfaceEvents(rte);
  attachShortcuts(rte);
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

// Sync the hidden textarea from the surface and fire input so the dirty-guard
// and char counter update. Called on every native edit in the surface.
function syncFromSurface(rte) {
  rte.textarea.value = serialize(rte.surface);
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
}

// Apply a pure string transform (value, selStart, selEnd) -> {value, selStart, selEnd}.
function runTransform(rte, transform) {
  const { value, selStart, selEnd } = currentSelection(rte);
  applyResult(rte, transform(value, selStart, selEnd));
}

function runMarker(rte, marker) {
  runTransform(rte, (v, s, e) => applyMarker(v, s, e, marker));
}

function buildButtons(rte) {
  MARKS.forEach(m => {
    const btn = makeBtn(m.icon, m.label, () => runMarker(rte, m.marker));
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
}

function attachSurfaceEvents(rte) {
  const { surface } = rte;
  surface.addEventListener('input', () => syncFromSurface(rte));

  // Plain-text paste only — no foreign HTML enters the surface.
  surface.addEventListener('paste', e => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    const { value, selStart, selEnd } = serializeWithSelection(surface, window.getSelection());
    const caret = selStart + text.length;
    applyResult(rte, { value: value.slice(0, selStart) + text + value.slice(selEnd), selStart: caret, selEnd: caret });
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
    applyResult(rte, applyLink(saved.value, saved.selStart, saved.selEnd, text, url));
  });

  // Esc dismiss (click-outside is wired in openLinkPopover/close).
  popover.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}
