import { parseInline, renderMarkdown, renderHtml, domToNodes } from './markdownInline.js';

const MARKS = [
  { name: 'bold', tag: 'strong', icon: 'format_bold', label: 'Bold (Ctrl/Cmd+B)', key: 'b' },
  { name: 'italic', tag: 'em', icon: 'format_italic', label: 'Italic (Ctrl/Cmd+I)', key: 'i' },
  { name: 'underline', tag: 'u', icon: 'format_underlined', label: 'Underline (Ctrl/Cmd+U)', key: 'u' },
  { name: 'strike', tag: 's', icon: 'strikethrough_s', label: 'Strikethrough' },
  { name: 'highlight', tag: 'mark', icon: 'format_ink_highlighter', label: 'Highlight' },
];

export function upgradeTextarea(textarea) {
  if (textarea.dataset.rteReady === '1') return; // idempotent
  textarea.dataset.rteReady = '1';

  const wrapper = document.createElement('div');
  wrapper.className = 'mb-rte';

  const toolbar = document.createElement('div');
  toolbar.className = 'mb-rte__toolbar';

  const surface = document.createElement('div');
  surface.className = 'mb-rte__surface';
  surface.contentEditable = 'true';
  surface.setAttribute('role', 'textbox');
  surface.setAttribute('aria-multiline', 'true');
  if (textarea.placeholder) surface.dataset.placeholder = textarea.placeholder;

  // Initial content from the (already-hydrated) textarea value.
  surface.innerHTML = renderHtml(parseInline(textarea.value || ''));

  // Hide the textarea but keep it as the form value mirror.
  textarea.style.display = 'none';
  textarea.parentNode.insertBefore(wrapper, textarea);
  wrapper.appendChild(toolbar);
  wrapper.appendChild(surface);
  wrapper.appendChild(textarea);

  const sync = () => {
    textarea.value = renderMarkdown(domToNodes(surface));
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  };

  surface.addEventListener('input', sync);

  // Paste as plain text to keep the DOM clean.
  surface.addEventListener('paste', e => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  });

  // Expose for later tasks (toolbar wiring) and tests.
  wrapper._rte = { textarea, surface, toolbar, sync };
  buildToolbar(wrapper._rte);
  attachLinkPopover(wrapper._rte);
  return wrapper._rte;
}

function buildToolbar(rte) {
  const { toolbar, surface } = rte;

  const makeBtn = (icon, label, onClick) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mb-rte__btn';
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.innerHTML = `<span class="more-buttons-icon">${icon}</span>`;
    btn.addEventListener('mousedown', e => e.preventDefault()); // keep selection
    btn.addEventListener('click', onClick);
    return btn;
  };

  rte.markButtons = {};
  MARKS.forEach(m => {
    const btn = makeBtn(m.icon, m.label, () => { toggleMark(surface, m.tag); });
    btn.dataset.mark = m.tag;
    rte.markButtons[m.tag] = btn;
    toolbar.appendChild(btn);
  });

  // Link button is wired in Task 7; create it now so toolbar order is final.
  const linkBtn = makeBtn('link', 'Link (Ctrl/Cmd+K)', () => { rte.openLinkPopover?.(); });
  linkBtn.dataset.mark = 'a';
  rte.markButtons.a = linkBtn;
  toolbar.appendChild(linkBtn);

  // Keyboard shortcuts.
  surface.addEventListener('keydown', e => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const key = e.key.toLowerCase();
    const map = { b: 'strong', i: 'em', u: 'u' };
    if (map[key]) { e.preventDefault(); toggleMark(surface, map[key]); }
    else if (key === 'k') { e.preventDefault(); rte.openLinkPopover?.(); }
  });

  // Active-state reflection.
  const refresh = () => refreshActive(rte);
  document.addEventListener('selectionchange', () => {
    if (surface.contains(document.getSelection()?.anchorNode)) refresh();
  });
  surface.addEventListener('keyup', refresh);
  surface.addEventListener('mouseup', refresh);
}

// Walk up from node to surface; return the nearest ancestor element matching tagName.
function closestTag(node, tagName, surface) {
  let el = node;
  while (el && el !== surface) {
    if (el.nodeType === Node.ELEMENT_NODE && el.tagName.toLowerCase() === tagName) return el;
    el = el.parentNode;
  }
  return null;
}

function unwrap(el) {
  const parent = el.parentNode;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
  parent.normalize();
}

function toggleMark(surface, tagName) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (!surface.contains(range.commonAncestorContainer)) return;

  const existing = closestTag(range.commonAncestorContainer, tagName, surface);
  if (existing) {
    unwrap(existing);
  } else {
    if (range.collapsed) return; // nothing selected → no-op
    const el = document.createElement(tagName);
    try {
      el.appendChild(range.extractContents());
      range.insertNode(el);
      sel.removeAllRanges();
      const r = document.createRange();
      r.selectNodeContents(el);
      sel.addRange(r);
    } catch (err) {
      // Selection spans incompatible boundaries — best-effort for v1.
      return;
    }
  }
  surface.dispatchEvent(new Event('input', { bubbles: true }));
}

function refreshActive(rte) {
  const sel = window.getSelection();
  const node = sel?.anchorNode;
  Object.entries(rte.markButtons).forEach(([tag, btn]) => {
    const active = node ? !!closestTag(node, tag, rte.surface) : false;
    btn.classList.toggle('--active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

function attachLinkPopover(rte) {
  const { surface, toolbar } = rte;
  let savedRange = null;

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
    const sel = window.getSelection();
    if (!sel.rangeCount || !surface.contains(sel.anchorNode)) return;
    savedRange = sel.getRangeAt(0).cloneRange();
    const existing = closestTag(sel.anchorNode, 'a', surface);
    if (existing) {
      textInput.value = existing.textContent;
      urlInput.value = existing.getAttribute('href') || '';
      savedRange.selectNode(existing);
    } else {
      textInput.value = savedRange.toString();
      urlInput.value = '';
    }
    popover.hidden = false;
    urlInput.focus();
  };

  popover.querySelector('[data-link-cancel]').addEventListener('click', close);

  popover.querySelector('[data-link-insert]').addEventListener('click', () => {
    const url = urlInput.value.trim();
    const text = textInput.value.trim() || url;
    if (!url || !savedRange) { close(); return; }
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const a = document.createElement('a');
    a.setAttribute('href', url);
    a.textContent = text;
    range.insertNode(a);
    sel.removeAllRanges();
    close();
    surface.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // Esc / click-outside dismiss.
  popover.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  document.addEventListener('mousedown', e => {
    if (!popover.hidden && !popover.contains(e.target) && !toolbar.contains(e.target)) close();
  });
}
