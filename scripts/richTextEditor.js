import { parseInline, renderHtml } from './markdownInline.js';
import { applyMarker, applyLink } from './markdownToolbarActions.js';

// Toolbar marks: { marker } is the literal markdown delimiter inserted into the
// textarea (the single source of truth). Order matches the old toolbar.
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

  // Segmented Edit | Preview tabs (left).
  const tabs = document.createElement('div');
  tabs.className = 'mb-rte__tabs';
  const editTab = makeTab('Edit', true);
  const previewTab = makeTab('Preview', false);
  tabs.append(editTab, previewTab);
  toolbar.appendChild(tabs);

  // Format buttons (right).
  const btnGroup = document.createElement('div');
  btnGroup.className = 'mb-rte__btns';
  toolbar.appendChild(btnGroup);

  // Render-only preview pane (hidden until Preview is selected).
  const preview = document.createElement('div');
  preview.className = 'mb-rte__preview';
  preview.hidden = true;

  // Keep the textarea visible — it stays the form value / source of truth.
  textarea.classList.add('mb-rte__input');
  textarea.parentNode.insertBefore(wrapper, textarea);
  wrapper.appendChild(toolbar);
  wrapper.appendChild(textarea);
  wrapper.appendChild(preview);

  const rte = { textarea, toolbar, preview, btnGroup, editTab, previewTab, buttons: [] };

  buildButtons(rte);
  attachLinkPopover(rte);
  buildTabs(rte);
  attachShortcuts(rte);

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
  btn.addEventListener('mousedown', e => e.preventDefault()); // keep textarea selection
  btn.addEventListener('click', onClick);
  return btn;
}

// Apply a marker transform to the textarea and restore selection + fire input.
function runMarker(rte, marker) {
  const { textarea } = rte;
  const res = applyMarker(textarea.value, textarea.selectionStart, textarea.selectionEnd, marker);
  textarea.value = res.value;
  textarea.focus();
  textarea.setSelectionRange(res.selStart, res.selEnd);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
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
  rte.editTab.addEventListener('click', () => setMode(rte, 'edit'));
  rte.previewTab.addEventListener('click', () => setMode(rte, 'preview'));
}

function setMode(rte, mode) {
  const previewing = mode === 'preview';
  rte.editTab.classList.toggle('--active', !previewing);
  rte.previewTab.classList.toggle('--active', previewing);
  rte.editTab.setAttribute('aria-pressed', String(!previewing));
  rte.previewTab.setAttribute('aria-pressed', String(previewing));
  rte.textarea.hidden = previewing;
  rte.preview.hidden = !previewing;
  rte.buttons.forEach(b => { b.disabled = previewing; });
  if (previewing) {
    const html = renderHtml(parseInline(rte.textarea.value || ''));
    rte.preview.innerHTML = html || '<span class="mb-rte__preview-empty">Nothing to preview</span>';
  }
}

function attachShortcuts(rte) {
  rte.textarea.addEventListener('keydown', e => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const key = e.key.toLowerCase();
    if (SHORTCUT[key]) { e.preventDefault(); runMarker(rte, SHORTCUT[key]); }
    else if (key === 'k') { e.preventDefault(); rte.openLinkPopover?.(); }
  });
}

function attachLinkPopover(rte) {
  const { textarea, toolbar } = rte;
  let savedStart = 0, savedEnd = 0;

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
  const close = () => { popover.hidden = true; };

  rte.openLinkPopover = () => {
    savedStart = textarea.selectionStart;
    savedEnd = textarea.selectionEnd;
    textInput.value = textarea.value.slice(savedStart, savedEnd);
    urlInput.value = '';
    popover.hidden = false;
    urlInput.focus();
  };

  popover.querySelector('[data-link-cancel]').addEventListener('click', close);

  popover.querySelector('[data-link-insert]').addEventListener('click', () => {
    const url = urlInput.value.trim();
    const text = textInput.value.trim() || url;
    if (!url) { close(); return; } // empty URL → no-op
    const res = applyLink(textarea.value, savedStart, savedEnd, text, url);
    textarea.value = res.value;
    close();
    textarea.focus();
    textarea.setSelectionRange(res.selStart, res.selEnd);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // Esc / click-outside dismiss.
  popover.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  document.addEventListener('mousedown', e => {
    if (!popover.hidden && !popover.contains(e.target) && !toolbar.contains(e.target)) close();
  });
}
