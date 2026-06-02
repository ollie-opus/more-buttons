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
  return wrapper._rte;
}

// Placeholder — implemented in Task 6.
function buildToolbar() {}
