/**
 * codeRichEditor.js — the Code block form's rich code surface.
 *
 * Upgrades the `codeSource` textarea into a Rich | Raw editor:
 *  - Rich: a fully editable plain-text contentEditable surface (monospace,
 *    pre whitespace) where annotation comment markers render as atomic (+)
 *    chips, the way Zensical shows published annotations. An "Add annotation"
 *    toolbar button inserts a chip at the caret; clicking a chip opens a
 *    popover holding the form's shared full-toolbar rich text editor for that
 *    annotation's markdown.
 *  - Raw: the original textarea, literal `# (1)!` markers and all.
 *
 * The two named inputs stay the only form-facing truth: `codeSource` (fence
 * content incl. markers) and the hidden `codeAnnotations` (ANNOTATION_SEP-
 * joined texts). The surface is a view — render (inputs → surface) never
 * writes back, so hydration/merge can never false-dirty the form; sync
 * (surface → inputs) rewrites both values and fires real input events on
 * every edit, so the dirty guard and save-state button work unchanged.
 *
 * Chip identity: each chip carries a session-unique data-chip-id whose
 * markdown text lives in an append-only Map (a deleted chip keeps its entry,
 * so native undo resurrecting the node resurrects its text; unattached
 * entries just aren't serialized). DOM order is annotation order — markers
 * renumber 1..n on every sync.
 *
 * The popover borrows the ONE hidden `[data-codeann-editor]` RTE declared in
 * editCodeBlock.html (upgraded by form.js's generic data-richtext sweep):
 * the whole .mb-rte wrapper is relocated into the popover on open and parked
 * back, cleared, on close — the dataTablesEditor cell-editor pattern, moved
 * wholesale so the toolbar and its child popovers come along.
 */

import { renderSurface, setMode, clearArmed, wireToolbarScroll } from './richTextEditor.js';
import { ANNOTATION_SEP } from './mdCodeBlocks.js';
import {
  tokenizeAnnotatedCode, serializeTokens, bindMarkersToAnnotations,
  normalizeForSave, langWarningFor, NO_COMMENT_LANGS,
} from './codeAnnotations.js';

function makeTab(text, active) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mb-rte__tab' + (active ? ' --active' : '');
  b.setAttribute('aria-pressed', String(active));
  b.textContent = text;
  return b;
}

/**
 * Upgrade the code textarea. Idempotent. `langInput` drives comment styling +
 * the hint; `annotationsInput` is the hidden ANNOTATION_SEP-joined scalar.
 * Also installs `formEl._mbCodeFinalize` — the save paths call it to drop
 * empty-text markers before values are read.
 */
export function upgradeCodeTextarea(textarea, { langInput, annotationsInput } = {}) {
  if (!textarea || textarea.dataset.creReady === '1') return;
  textarea.dataset.creReady = '1';
  const formEl = textarea.closest('form');

  const st = {
    mode: 'rich',
    chipTexts: new Map(), // chipId → markdown text; append-only for the session
    orphans: [],          // annotation texts no marker references (kept, tail-serialized)
    nextChipId: 1,
    openChipId: null,
    rte: null,            // the shared popover RTE, resolved lazily
    rteHost: null,
  };

  const currentLang = () => (langInput?.value ?? '').trim().toLowerCase();
  // The hidden scalar ↔ array, using the house conventions: segments joined on
  // the unit separator, a just-added empty text held as a single-space
  // sentinel so it survives the split.
  const readAnns = () => (annotationsInput.value ?? '')
    .split(ANNOTATION_SEP).filter(s => s.length).map(s => (s === ' ' ? '' : s));
  const joinAnns = texts => texts.map(t => (t.trim() ? t : ' ')).join(ANNOTATION_SEP);

  // ── DOM scaffold ───────────────────────────────────────────────────────────

  const wrapper = document.createElement('div');
  wrapper.className = 'mb-cre';

  const toolbar = document.createElement('div');
  toolbar.className = 'mb-rte__toolbar';
  const btnGroup = document.createElement('div');
  btnGroup.className = 'mb-rte__btns';

  // Icon-only, like every other RTE toolbar button; the title carries the label.
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'mb-rte__btn';
  addBtn.setAttribute('aria-label', 'Add annotation');
  addBtn.innerHTML = '<span class="more-buttons-icon">add_comment</span>';
  addBtn.addEventListener('mousedown', e => e.preventDefault()); // keep the surface caret
  btnGroup.appendChild(addBtn);

  const btnWrap = document.createElement('div');
  btnWrap.className = 'mb-rte__btnwrap';
  btnWrap.appendChild(btnGroup);

  const tabs = document.createElement('div');
  tabs.className = 'mb-rte__tabs';
  const richTab = makeTab('Rich', true);
  const rawTab = makeTab('Raw', false);
  tabs.append(richTab, rawTab);
  toolbar.append(btnWrap, tabs);
  wireToolbarScroll(btnWrap, btnGroup);

  const surface = document.createElement('div');
  surface.className = 'mb-cre__surface';
  surface.contentEditable = 'true';
  surface.setAttribute('role', 'textbox');
  surface.setAttribute('aria-multiline', 'true');
  surface.spellcheck = false;
  surface.setAttribute('autocapitalize', 'off');
  if (textarea.placeholder) surface.dataset.placeholder = textarea.placeholder;

  textarea.classList.add('mb-cre__raw');
  textarea.parentNode.insertBefore(wrapper, textarea);
  wrapper.append(toolbar, surface, textarea);

  const orphansEl = document.createElement('div');
  orphansEl.className = 'mb-cre__orphans';
  orphansEl.hidden = true;

  const hintEl = document.createElement('p');
  hintEl.className = 'mb-cre__hint';
  hintEl.hidden = true; // shown only for console / no-comment language warnings

  const pop = document.createElement('div');
  pop.className = 'mb-codeann-popover';
  pop.hidden = true;
  pop.innerHTML = `
    <div class="mb-codeann-popover__head">
      <span class="mb-codeann-popover__title" data-codeann-title></span>
      <button type="button" class="mb-codeann-popover__btn --danger" data-codeann-delete title="Delete annotation"><span class="more-buttons-icon">delete</span></button>
      <button type="button" class="mb-codeann-popover__btn" data-codeann-close title="Close"><span class="more-buttons-icon">close</span></button>
    </div>
    <div class="mb-codeann-popover__body" data-codeann-body></div>`;
  wrapper.append(orphansEl, hintEl, pop);

  // Validation paints the wrapper, not the (hidden-in-Rich) textarea.
  textarea._validationHost = wrapper;

  // ── Chips ──────────────────────────────────────────────────────────────────

  const makeChipEl = (id) => {
    const chip = document.createElement('span');
    chip.className = 'mb-codechip';
    chip.contentEditable = 'false';
    chip.dataset.chipId = id;
    chip.textContent = '+';
    chip.title = 'Annotation — click to edit';
    return chip;
  };
  const newChipId = () => 'c' + (st.nextChipId++);

  // ── Render: inputs → surface (never writes back) ───────────────────────────

  const render = () => {
    closePopover();
    const tokens = tokenizeAnnotatedCode(textarea.value);
    const { chips, orphans } = bindMarkersToAnnotations(tokens, readAnns());
    st.orphans = orphans;
    surface.replaceChildren();
    let ci = 0;
    for (const t of tokens) {
      if (t.type === 'text') {
        surface.appendChild(document.createTextNode(t.text));
      } else {
        const id = newChipId();
        st.chipTexts.set(id, chips[ci++].text);
        surface.appendChild(makeChipEl(id));
      }
    }
    renderOrphans();
    refreshLangUi();
  };

  // ── Sync: surface → inputs ─────────────────────────────────────────────────

  // Walk the surface in document order: text nodes append verbatim, chips
  // become markers, <br> and block-element boundaries become newlines (Enter
  // is intercepted into plain '\n' text, so blocks only appear via odd native
  // paths like drops — handled defensively).
  const walkNode = (node, tokens, texts) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        tokens.push({ type: 'text', text: child.nodeValue });
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      if (child.classList.contains('mb-codechip')) {
        texts.push(st.chipTexts.get(child.dataset.chipId) ?? '');
        tokens.push({ type: 'marker', num: texts.length });
        continue;
      }
      if (child.tagName === 'BR') { tokens.push({ type: 'text', text: '\n' }); continue; }
      const block = child.tagName === 'DIV' || child.tagName === 'P';
      if (block && tokens.length) tokens.push({ type: 'text', text: '\n' });
      if (block && child.childNodes.length === 1 && child.firstChild.nodeName === 'BR') continue;
      walkNode(child, tokens, texts);
    }
  };

  const syncInputs = () => {
    if (st.mode !== 'rich') return; // the surface is only truth while visible
    const tokens = [];
    const texts = [];
    // A lone <br> is the browser's "emptied contentEditable" state, not a line.
    if (!(surface.childNodes.length === 1 && surface.firstChild.nodeName === 'BR')) {
      walkNode(surface, tokens, texts);
    }
    textarea.value = serializeTokens(tokens, currentLang());
    annotationsInput.value = joinAnns([...texts, ...st.orphans]);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    annotationsInput.dispatchEvent(new Event('input', { bubbles: true }));
    annotationsInput.dispatchEvent(new Event('change', { bubbles: true }));
  };

  // ── Language hint + Add button state ───────────────────────────────────────

  const refreshLangUi = () => {
    const lang = currentLang();
    // No permanent hint — only the console / no-comment-language warnings show.
    const warning = langWarningFor(lang);
    hintEl.textContent = warning;
    hintEl.hidden = !warning;
    const noComment = NO_COMMENT_LANGS.has(lang);
    addBtn.disabled = st.mode !== 'rich' || noComment;
    addBtn.title = noComment
      ? 'Annotations need comment highlighting — pick a language like bash, python or yaml first.'
      : (st.mode !== 'rich' ? 'Switch to Rich to insert annotations' : 'Insert an annotation at the caret');
  };

  // Interactive language edits restyle the markers immediately. Rich mode
  // re-serializes from the surface; Raw mode restyles in place WITHOUT
  // renumbering (raw markers may be intentionally out of order — silently
  // re-binding them to different list items would corrupt the annotations).
  const onLangEdit = () => {
    refreshLangUi();
    if (st.mode === 'rich') {
      if (surface.querySelector('.mb-codechip')) syncInputs();
    } else {
      const restyled = serializeTokens(tokenizeAnnotatedCode(textarea.value), currentLang(), { renumber: false });
      if (restyled !== textarea.value) {
        textarea.value = restyled;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  };
  langInput?.addEventListener('input', onLangEdit);
  langInput?.addEventListener('change', onLangEdit); // combobox selection
  // Storage hydration repaint: display-only (no value rewrites → no false-dirty).
  if (langInput) langInput._mbSyncView = refreshLangUi;

  // ── Mode toggle ────────────────────────────────────────────────────────────

  const setCodeMode = (mode, { focus = true } = {}) => {
    if (mode === 'raw') closePopover();
    st.mode = mode;
    const rich = mode === 'rich';
    richTab.classList.toggle('--active', rich);
    rawTab.classList.toggle('--active', !rich);
    richTab.setAttribute('aria-pressed', String(rich));
    rawTab.setAttribute('aria-pressed', String(!rich));
    surface.hidden = !rich;
    textarea.hidden = rich;
    orphansEl.hidden = !rich || !st.orphans.length;
    if (rich) {
      render(); // Raw edits land here; Rich → inputs are already current
      if (focus) surface.focus();
    } else if (focus) {
      textarea.focus();
    }
    refreshLangUi();
  };
  richTab.addEventListener('click', () => setCodeMode('rich'));
  rawTab.addEventListener('click', () => setCodeMode('raw'));

  // ── Surface editing behaviour ──────────────────────────────────────────────

  surface.addEventListener('beforeinput', e => {
    // Keep newlines as plain '\n' text nodes (white-space: pre renders them),
    // not <div> soup — and via execCommand so native undo keeps working.
    if ((e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') && !e.isComposing) {
      e.preventDefault();
      document.execCommand('insertText', false, '\n');
      return;
    }
    // Code is plain text: block native formatting shortcuts (Cmd+B etc.).
    if (e.inputType.startsWith('format')) e.preventDefault();
  });

  surface.addEventListener('paste', e => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    if (text) document.execCommand('insertText', false, text);
  });

  surface.addEventListener('input', () => syncInputs());

  surface.addEventListener('click', e => {
    const chip = e.target.closest?.('.mb-codechip');
    if (!chip) return;
    if (st.openChipId === chip.dataset.chipId) closePopover();
    else openPopover(chip);
  });

  // ── Add annotation ─────────────────────────────────────────────────────────

  addBtn.addEventListener('click', () => {
    if (addBtn.disabled) return;
    const id = newChipId();
    st.chipTexts.set(id, '');
    let chip = null;
    const sel = window.getSelection();
    if (sel && sel.rangeCount && surface.contains(sel.anchorNode)) {
      // insertHTML keeps the insertion on the native undo stack.
      document.execCommand('insertHTML', false,
        `<span class="mb-codechip" contenteditable="false" data-chip-id="${id}">+</span>`);
      chip = surface.querySelector(`[data-chip-id="${id}"]`);
    }
    if (!chip) { chip = makeChipEl(id); surface.appendChild(chip); }
    syncInputs();
    openPopover(chip);
  });

  // ── The chip popover (relocated shared RTE) ────────────────────────────────

  const resolveRte = () => {
    if (st.rte) return st.rte;
    const host = formEl?.querySelector('[data-codeann-editor-host]');
    const rte = host?.querySelector('.mb-rte')?._rte;
    if (!rte) return null; // upgrade sweep hasn't run — chip clicks are post-hydration, so this shouldn't happen
    st.rte = rte;
    st.rteHost = host;
    // Live commit: every popover edit lands in the chip map and the hidden
    // scalar immediately — there is no close-time commit step to lose.
    rte.textarea.addEventListener('input', () => {
      if (!st.openChipId) return;
      st.chipTexts.set(st.openChipId, rte.textarea.value);
      syncInputs();
    });
    return rte;
  };

  const positionPopover = (chip) => {
    const wrapRect = wrapper.getBoundingClientRect();
    const chipRect = chip.getBoundingClientRect();
    let left = chipRect.left - wrapRect.left - 12;
    left = Math.max(4, Math.min(left, wrapper.clientWidth - pop.offsetWidth - 4));
    let top = chipRect.bottom - wrapRect.top + 8;
    // Flip above the chip when the popover would run off the bottom of the
    // viewport and there is room above.
    if (chipRect.bottom + 8 + pop.offsetHeight > window.innerHeight - 16
      && chipRect.top - pop.offsetHeight - 8 > 0) {
      top = chipRect.top - wrapRect.top - pop.offsetHeight - 8;
    }
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  };

  function openPopover(chip) {
    const rte = resolveRte();
    if (!rte) return;
    if (st.openChipId) closePopover();
    const id = chip.dataset.chipId;
    st.openChipId = id;
    chip.classList.add('--open');
    const idx = [...surface.querySelectorAll('.mb-codechip')].indexOf(chip);
    pop.querySelector('[data-codeann-title]').textContent = `Annotation ${idx + 1}`;
    // Relocate the WHOLE wrapper — toolbar and its child popovers included —
    // so closest('.mb-rte') keeps working throughout.
    pop.querySelector('[data-codeann-body]').appendChild(rte.textarea.closest('.mb-rte'));
    rte.textarea.value = st.chipTexts.get(id) ?? '';
    renderSurface(rte);
    pop.hidden = false;
    positionPopover(chip);
    setMode(rte, 'rich', { focus: true });
  }

  function closePopover() {
    if (!st.openChipId) return;
    surface.querySelector('.mb-codechip.--open')?.classList.remove('--open');
    st.openChipId = null;
    pop.hidden = true;
    const rte = st.rte;
    if (!rte) return;
    // Park: back under the hidden host, cleared, so nothing leaks between chips.
    st.rteHost?.appendChild(rte.textarea.closest('.mb-rte'));
    rte.textarea.value = '';
    rte.surface.innerHTML = '';
    clearArmed(rte);
  }

  pop.querySelector('[data-codeann-close]').addEventListener('click', () => closePopover());
  pop.querySelector('[data-codeann-delete]').addEventListener('click', () => {
    const id = st.openChipId;
    closePopover();
    if (!id) return;
    surface.querySelector(`[data-chip-id="${id}"]`)?.remove(); // map entry kept for undo
    syncInputs();
  });
  // Escape layering: an open RTE child popover (link/label/icon/AI) consumes
  // the first Escape — but it closes itself during the bubble before this
  // handler runs, so snapshot whether one was open in the capture phase.
  let escHadInnerPopover = false;
  pop.addEventListener('keydown', e => {
    if (e.key === 'Escape') escHadInnerPopover = !!pop.querySelector('.mb-rte__popover:not([hidden])');
  }, true);
  pop.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    e.stopPropagation(); // the overlay's own Escape handling must not fire either way
    if (escHadInnerPopover) { escHadInnerPopover = false; return; }
    closePopover();
    surface.focus();
  });

  // Click-outside closes (chip clicks are handled by the surface listener).
  // Self-removing once the form is torn down, so overlays don't leak listeners.
  const onDocDown = (e) => {
    if (!document.body.contains(wrapper)) { document.removeEventListener('mousedown', onDocDown); return; }
    if (!st.openChipId) return;
    if (pop.contains(e.target)) return;
    if (e.target.closest?.('.mb-codechip')) return;
    closePopover();
  };
  document.addEventListener('mousedown', onDocDown);

  // ── Unreferenced annotations (orphans) ─────────────────────────────────────

  function renderOrphans() {
    orphansEl.hidden = st.mode !== 'rich' || !st.orphans.length;
    orphansEl.replaceChildren();
    if (!st.orphans.length) return;
    const label = document.createElement('div');
    label.className = 'mb-cre__orphans-label';
    label.textContent = 'Unreferenced annotations — no marker in the code points at these:';
    orphansEl.appendChild(label);
    st.orphans.forEach((text, i) => {
      const row = document.createElement('div');
      row.className = 'mb-cre__orphan-row';
      const preview = document.createElement('span');
      preview.className = 'mb-cre__orphan-text';
      preview.textContent = (text.trim() || '(empty)').split('\n')[0].slice(0, 80);
      const insert = document.createElement('button');
      insert.type = 'button';
      insert.className = 'mb-cre__orphan-btn';
      insert.textContent = 'Insert';
      insert.title = 'Insert a marker for this annotation at the end of the code';
      insert.addEventListener('click', () => {
        const id = newChipId();
        st.chipTexts.set(id, text);
        st.orphans.splice(i, 1);
        surface.appendChild(makeChipEl(id));
        syncInputs();
        renderOrphans();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'mb-cre__orphan-btn --danger';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        st.orphans.splice(i, 1);
        syncInputs();
        renderOrphans();
      });
      row.append(preview, insert, remove);
      orphansEl.appendChild(row);
    });
  }

  // ── Save-time finalize ─────────────────────────────────────────────────────

  // Both persist paths call this before reading values: a marker whose
  // annotation text is empty must go with its text, or the marker would
  // publish as a literal `(1)` (the old row UI's lingering-marker bug).
  formEl._mbCodeFinalize = () => {
    if (st.mode === 'rich') {
      closePopover();
      surface.querySelectorAll('.mb-codechip').forEach(chip => {
        if (!(st.chipTexts.get(chip.dataset.chipId) ?? '').trim()) chip.remove();
      });
      st.orphans = st.orphans.filter(o => (o ?? '').trim());
      syncInputs();
      renderOrphans();
    } else {
      const res = normalizeForSave(textarea.value, readAnns(), currentLang());
      if (res.code !== textarea.value) {
        textarea.value = res.code;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const joined = joinAnns(res.annotations);
      if (joined !== annotationsInput.value) {
        annotationsInput.value = joined;
        annotationsInput.dispatchEvent(new Event('input', { bubbles: true }));
        annotationsInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  };

  // Storage hydration / merge rehydrate repaint through these hooks; whichever
  // of the two inputs lands last re-renders with both values in place.
  textarea._mbSyncView = render;
  annotationsInput._mbSyncView = render;

  setCodeMode('rich', { focus: false }); // initial render, no focus steal during hydration
  return { wrapper, surface, render, syncInputs };
}
