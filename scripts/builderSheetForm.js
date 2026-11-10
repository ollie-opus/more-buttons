/**
 * builderSheetForm.js — steps 2 and 3 of the Selenium automation helper: the
 * sheet and the commands.
 *
 * A full overlay with a spreadsheet grid in the look of the data table editor
 * (lettered column handles, numbered row gutter), one column per picked
 * input. The column headers are row 1 and locked; data starts at row 2. Ollie
 * pastes his rows from Google Sheets, fixes whatever turns red, and gets one
 * /seleniumPageAutomation command per row to copy.
 *
 * Everything that decides something lives in builderSheet.js (what a cell may
 * hold, whether it is valid, what command it becomes) and is tested there.
 * This file draws the grid with the data table editor's `.mb-dt-*` classes
 * over a dataTableGridModel state and wires the keyboard, the clipboard, the
 * choice dropdowns, the per-column pill and the two views. The data table
 * editor's own DOM code is tied to rich text, captures and GitHub saving, so
 * none of it is reused.
 */
import { createForm, closeActiveForm } from './form.js';
import { openPopupMenu, isPopupMenuOpen } from './insertMenu.js';
import { escapeHtml } from './cardRenderer.js';
import { flashButtonLabel } from './guides.js';
import { enterPickMode } from './builderPickMode.js';
import {
  moveSelection, extendSelection, extendSelectionTo, collapseRange, normalizeRange, isMultiCellRange,
  clearRange, moveColumn, cellAt, setCellAt,
} from './dataTableGridModel.js';
import {
  parseClipboardTsv, formatClipboardTsv, parseMulti, formatMulti,
  columnsFromPicks, matchModes, choiceTexts, checkCell, problems, switchMatchOn,
  rowHasData, settleButtons, sheetMemory, carryRows, clipPaste, keepInBody, commandsFor,
} from './builderSheet.js';

const BLANK_ROWS = 20;
const MAX_PROBLEMS_LISTED = 10;
const CHOICE_KINDS = new Set(['select', 'radioGroup', 'checkboxGroup', 'checkbox', 'button']);
const ARROWS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

// Would a real input of this type keep the value? Chrome silently blanks a
// date, number... input given the wrong shape, and so would the command.
const accepts = (type, text) => {
  const probe = document.createElement('input');
  probe.type = type;
  probe.value = text;
  return probe.value !== '';
};

// Spreadsheet column letters: 0 → A, 25 → Z, 26 → AA…
function colLetter(i) {
  let s = '';
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
}

const blankRows = width => Array.from({ length: BLANK_ROWS }, () => Array.from({ length: width }, () => ''));

// The grid state for these picks. Rows coming back from pick mode arrive with
// the memory of which column each cell belonged to (sheetMemory) and are lined
// up by pick key (carryRows); rows without that memory are never guessed at
// by position, the sheet just starts blank.
function buildState(url, picks, rows, memory) {
  const columns = columnsFromPicks(picks);
  const cells = rows && rows.length && memory ? carryRows(columns, rows, memory) : blankRows(columns.length);
  return {
    url,
    columns,
    picksByKey: new Map(picks.map(pick => [pick.key, pick])),
    st: {
      align: columns.map(() => 'left'),
      header: columns.map(column => column.title),
      rows: cells,
      selected: { row: 0, col: 0 },
      anchor: null,
    },
  };
}

/**
 * Open the sheet for these picks. On a first visit `rows` and `memory` are
 * null; after "Back to picking" they are the rows that left with it and the
 * sheetMemory describing them.
 */
export async function openBuilderSheet({ url, picks, rows = null, memory = null }) {
  const state = buildState(url, picks, rows, memory);
  const { columns, st } = state;
  const picksInColumnOrder = () => columns.map(column => state.picksByKey.get(column.key));

  const form = await createForm('seleniumCommandBuilder',
    () => openBuilderSheet({ url, picks: picksInColumnOrder(), rows: st.rows, memory: sheetMemory(columns) }), { rootEntry: true });
  const content = form?.content;
  const wrap = content?.querySelector('[data-builder-grid-wrap]');
  const grid = content?.querySelector('[data-builder-grid]');
  if (!wrap || !grid) return;

  const $ = selector => content.querySelector(selector);
  let editing = null;     // { row, col, original, textarea } while a cell is edited in place
  let dragging = false;
  let pendingMenu = null; // the menu a press asked for; opened on release (see the pointer section)

  $('[data-builder-runs-on]').innerHTML = `every row runs on <b>${escapeHtml(url)}</b>`;

  // ── Drawing ───────────────────────────────────────────────────────────────

  const isChoice = column => CHOICE_KINDS.has(column.kind);
  const tdAt = (row, col) => grid.querySelector(`[data-cell="${row}:${col}"]`);

  function headCell(column, col) {
    const pill = matchModes(column).length
      ? `<button type="button" class="mb-builder-pill" data-builder-pill="${col}" tabindex="-1" aria-haspopup="menu" title="What this column's cells are matched on">${escapeHtml(column.matchOn)}</button>`
      : '';
    return `<th class="mb-dt-cell mb-builder-head" role="columnheader" title="${escapeHtml(`${column.targetType}: ${column.target}`)}">`
      + `<span class="mb-builder-head__name">${escapeHtml(column.title)}</span>`
      + `<span class="mb-builder-head__meta"><span class="mb-builder-head__type --${escapeHtml(column.kind)}">${escapeHtml(column.typeLabel)}</span>${pill}</span></th>`;
  }

  function render() {
    if (editing) return; // never rebuild mid-edit — callers commit first
    const bad = problems(columns, st.rows, { accepts });
    const badAt = new Map(bad.map(p => [`${p.row}:${p.col}`, p.message]));

    const chromeRow = '<tr><th class="mb-dt-corner"></th>' + columns.map((column, col) =>
      `<th class="mb-dt-handle" data-builder-col="${col}"><span>${colLetter(col)}</span>`
      + `<button type="button" class="mb-dt-handle__menu" data-builder-col-menu="${col}" tabindex="-1" aria-haspopup="menu" aria-label="Column ${colLetter(col)} options"><span class="more-buttons-icon">chevron-down</span></button></th>`).join('') + '</tr>';
    const headRow = '<tr><th class="mb-dt-gutter mb-builder-gutter--locked" title="header row, locked"><span>1</span></th>'
      + columns.map(headCell).join('') + '</tr>';

    const cell = (row, col, text) => {
      const column = columns[col];
      const message = badAt.get(`${row}:${col}`);
      const cls = 'mb-dt-cell' + (isChoice(column) ? ' mb-builder-cell--choice' : '') + (message ? ' mb-builder-cell--bad' : '');
      const open = isChoice(column) ? `<button type="button" class="mb-builder-cell__open" data-builder-open tabindex="-1" aria-label="Choose"></button>` : '';
      return `<td class="${cls}" role="gridcell" data-cell="${row}:${col}"${message ? ` title="${escapeHtml(message)}"` : ''}>`
        + `<span class="mb-builder-cell__text">${escapeHtml(text ?? '')}</span>${open}</td>`;
    };
    const bodyRows = st.rows.map((cells, row) =>
      `<tr><th class="mb-dt-gutter" data-builder-row="${row}"><span>${row + 2}</span></th>${columns.map((column, col) => cell(row, col, cells[col])).join('')}</tr>`).join('');

    grid.innerHTML = `<thead>${chromeRow}${headRow}</thead><tbody>${bodyRows}</tbody>`;
    paintSelection();
    paintProblems(bad);
  }

  // Selection moved but nothing else did: repaint classes without a rebuild.
  // A rebuild would detach the clicked cell and its dblclick would never fire.
  function paintSelection() {
    const rect = normalizeRange(st);
    const ranged = isMultiCellRange(st);
    grid.querySelectorAll('[data-cell]').forEach(td => {
      const [row, col] = td.dataset.cell.split(':').map(Number);
      const selected = row === st.selected.row && col === st.selected.col;
      td.classList.toggle('mb-dt-cell--selected', selected && !td.classList.contains('mb-dt-cell--editing'));
      td.classList.toggle('mb-dt-cell--in-range', ranged && row >= rect.r0 && row <= rect.r1 && col >= rect.c0 && col <= rect.c1);
      if (selected) td.setAttribute('aria-selected', 'true'); else td.removeAttribute('aria-selected');
    });
    grid.querySelectorAll('[data-builder-col]').forEach(th => {
      const col = Number(th.dataset.builderCol);
      th.classList.toggle('mb-dt-handle--active', col >= rect.c0 && col <= rect.c1);
    });
    grid.querySelectorAll('[data-builder-row]').forEach(th => {
      const row = Number(th.dataset.builderRow);
      th.classList.toggle('mb-dt-gutter--active', row >= rect.r0 && row <= rect.r1);
    });
  }

  function paintProblems(bad) {
    const line = $('[data-builder-problems]');
    if (bad.length) {
      const listed = bad.slice(0, MAX_PROBLEMS_LISTED).map(p => `${p.ref} "${p.text}"`).join(' · ');
      const more = bad.length > MAX_PROBLEMS_LISTED ? ` · and ${bad.length - MAX_PROBLEMS_LISTED} more` : '';
      line.innerHTML = `<b>${bad.length} ${bad.length === 1 ? "cell doesn't" : "cells don't"} match a choice</b> <span>· ${escapeHtml(listed + more)}</span>`;
    } else {
      line.textContent = '';
    }
    $('[data-builder-produce]').disabled = bad.length > 0 || !hasAnything();
  }

  const focusGrid = () => wrap.focus({ preventScroll: true });
  const showSelected = () => tdAt(st.selected.row, st.selected.col)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });

  // Every change to cells goes through here: button cells are kept in step
  // with whether their row has data (defaults in when it first gets some, out
  // again when it loses it all), then the grid and the problems line are redrawn.
  function change(mutate) {
    const had = st.rows.map(row => rowHasData(columns, row));
    mutate();
    keepInBody(st);
    // Always one spare row at the bottom to type into; blank rows write no command.
    if (st.rows.at(-1).some(cell => String(cell ?? '').trim() !== '')) st.rows.push(columns.map(() => ''));
    settleButtons(columns, st.rows, had);
    render();
  }

  // ── Editing a cell in place ───────────────────────────────────────────────

  function startEditing({ replaceWith = null } = {}) {
    if (editing) return;
    const { row, col } = st.selected;
    const td = tdAt(row, col);
    if (!td) return;
    collapseRange(st);
    paintSelection();
    const original = cellAt(st, row, col);
    const textarea = document.createElement('textarea');
    textarea.className = 'mb-builder-editor';
    textarea.rows = 1;
    textarea.value = replaceWith ?? original;
    const fit = () => { textarea.style.height = 'auto'; textarea.style.height = `${textarea.scrollHeight}px`; };
    textarea.addEventListener('input', fit);
    textarea.addEventListener('blur', () => { if (editing?.textarea === textarea) commitEditing(); });
    td.classList.remove('mb-dt-cell--selected');
    td.classList.add('mb-dt-cell--editing');
    td.replaceChildren(textarea);
    editing = { row, col, original, textarea };
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    fit();
  }

  function stopEditing(value) {
    const { row, col } = editing;
    editing = null;
    change(() => setCellAt(st, row, col, value));
    focusGrid();
  }
  function commitEditing() { if (editing) stopEditing(editing.textarea.value); }
  function cancelEditing() { if (editing) stopEditing(editing.original); }

  function onEditorKey(e) {
    if (e.key === 'Escape') {
      // Escape backs out of the edit, not out of the whole overlay.
      e.preventDefault();
      e.stopPropagation();
      cancelEditing();
    } else if (e.key === 'Enter' && e.altKey) {
      e.preventDefault();
      const t = editing.textarea;
      t.setRangeText('\n', t.selectionStart, t.selectionEnd, 'end');
      t.dispatchEvent(new Event('input'));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commitEditing();
      move('commitDown');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      commitEditing();
      move(e.shiftKey ? 'prev' : 'next');
    }
  }

  // ── Moving the selection ──────────────────────────────────────────────────

  function move(how) {
    const was = { ...st.selected };
    moveSelection(st, how);
    if (st.selected.row < 0) st.selected = was; // the header row is locked
    paintSelection();
    showSelected();
  }

  function extend(dir) {
    extendSelection(st, dir);
    keepInBody(st);
    paintSelection();
    showSelected();
  }

  // ── Menus ─────────────────────────────────────────────────────────────────

  // A choice cell's dropdown: the column's choices in the form its pill says.
  // One answer: picking writes it and closes. A checkbox group: picking
  // toggles that answer and the menu reopens, so several can be ticked.
  function openChoiceMenu() {
    const { row, col } = st.selected;
    const column = columns[col];
    const td = tdAt(row, col);
    if (!td || !isChoice(column)) return;
    const texts = choiceTexts(column);
    const multi = column.kind === 'checkboxGroup';
    const current = multi ? parseMulti(cellAt(st, row, col), texts).items : [String(cellAt(st, row, col) ?? '').trim()];
    const items = texts.map((text, i) => ({ id: `choice:${i}`, label: text || '(blank)', checked: current.includes(text) }));
    items.push({ divider: true }, { id: 'clear', label: 'Clear', icon: 'x' });
    openPopupMenu(td, items, id => {
      if (id === 'clear') {
        change(() => setCellAt(st, row, col, ''));
      } else {
        const text = texts[Number(id.slice('choice:'.length))];
        const next = multi ? formatMulti(current.includes(text) ? current.filter(t => t !== text) : [...current, text]) : text;
        change(() => setCellAt(st, row, col, next));
        if (multi) { openChoiceMenu(); return; }
      }
      focusGrid();
    }, { focusFirst: true });
  }

  // The pill: what this column's cells are matched on.
  function openPillMenu(pill) {
    const col = Number(pill.dataset.builderPill);
    const column = columns[col];
    const items = matchModes(column).map(mode => ({ id: mode, label: mode, checked: column.matchOn === mode }));
    openPopupMenu(pill, items, mode => {
      if (mode !== column.matchOn) change(() => switchMatchOn(columns, st.rows, col, mode));
      focusGrid();
    });
  }

  function openColumnMenu(button) {
    const col = Number(button.dataset.builderColMenu);
    const items = [
      { id: 'left', label: 'Move left', icon: 'arrow-left', disabled: col <= 0 },
      { id: 'right', label: 'Move right', icon: 'arrow-right', disabled: col >= columns.length - 1 },
    ];
    openPopupMenu(button, items, id => {
      const to = id === 'left' ? col - 1 : col + 1;
      change(() => {
        moveColumn(st, col, to);
        columns.splice(to, 0, ...columns.splice(col, 1));
      });
      focusGrid();
    });
  }

  // ── Pointer ───────────────────────────────────────────────────────────────

  const cellOf = target => {
    const td = target.closest?.('[data-cell]');
    if (!td || !grid.contains(td)) return null;
    const [row, col] = td.dataset.cell.split(':').map(Number);
    return { td, row, col };
  };

  // Menus open on RELEASE, not on press. The popup menu arms its
  // click-outside-to-close listener a tick after it opens, so a menu opened on
  // press would be closed again by the click that ends the same press. Opening
  // on release also survives the grid rebuild a press causes when it commits
  // an open cell editor (the pressed element is gone, so no click would fire).
  wrap.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    if (e.target.closest('.mb-builder-editor')) return; // presses inside the open editor are its own
    const pill = e.target.closest('[data-builder-pill]');
    const colMenu = e.target.closest('[data-builder-col-menu]');
    if (pill || colMenu) {
      pendingMenu = pill ? { kind: 'pill', col: pill.dataset.builderPill } : { kind: 'column', col: colMenu.dataset.builderColMenu };
      commitEditing();
      return;
    }
    const hit = cellOf(e.target);
    if (!hit) return;
    const wantsMenu = !!e.target.closest('[data-builder-open]');
    commitEditing();
    if (e.shiftKey) {
      extendSelectionTo(st, hit.row, hit.col);
      keepInBody(st);
    } else {
      collapseRange(st);
      st.selected = { row: hit.row, col: hit.col };
      dragging = !wantsMenu;
    }
    if (wantsMenu) pendingMenu = { kind: 'cell', row: hit.row, col: hit.col };
    paintSelection();
    focusGrid();
  });
  wrap.addEventListener('pointerover', e => {
    if (!dragging) return;
    if (!(e.buttons & 1)) { dragging = false; return; } // released outside the overlay
    const hit = cellOf(e.target);
    if (!hit || (hit.row === st.selected.row && hit.col === st.selected.col)) return;
    extendSelectionTo(st, hit.row, hit.col);
    keepInBody(st);
    paintSelection();
  });
  content.addEventListener('pointerup', e => {
    dragging = false;
    const want = pendingMenu;
    pendingMenu = null;
    if (!want) return;
    if (want.kind === 'pill') {
      const pill = e.target.closest('[data-builder-pill]');
      if (pill?.dataset.builderPill === want.col) openPillMenu(pill);
    } else if (want.kind === 'column') {
      const button = e.target.closest('[data-builder-col-menu]');
      if (button?.dataset.builderColMenu === want.col) openColumnMenu(button);
    } else {
      const hit = cellOf(e.target);
      if (hit && hit.row === want.row && hit.col === want.col) openChoiceMenu();
    }
  });

  wrap.addEventListener('dblclick', e => {
    const hit = cellOf(e.target);
    if (!hit || editing) return;
    if (isChoice(columns[hit.col])) openChoiceMenu(); else startEditing();
  });

  // ── Keyboard ──────────────────────────────────────────────────────────────

  // Capture phase, so an Escape that belongs to the cell editor is stopped
  // before the overlay's own Escape-to-close handler can see it.
  wrap.addEventListener('keydown', e => {
    if (editing) { onEditorKey(e); return; }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === 'c' || e.key === 'x')) {
      // Cells are user-select: none, so there is never a document selection
      // and Chrome fires no native copy event on the grid: write the
      // clipboard directly (permission-free under a user gesture).
      e.preventDefault();
      navigator.clipboard?.writeText(formatClipboardTsv(selectedBlock()));
      if (e.key === 'x') change(() => clearRange(st));
    } else if (ARROWS[e.key]) {
      e.preventDefault();
      if (e.shiftKey) extend(ARROWS[e.key]); else move(ARROWS[e.key]);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      move(e.shiftKey ? 'prev' : 'next');
    } else if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault();
      if (isChoice(columns[st.selected.col])) openChoiceMenu(); else startEditing();
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      change(() => clearRange(st));
    } else if (e.key.length === 1 && !mod && !e.altKey) {
      // Typing a character starts a plain text edit, in a choice cell too.
      e.preventDefault();
      startEditing({ replaceWith: e.key });
    }
  }, true);

  // ── Clipboard ─────────────────────────────────────────────────────────────

  function selectedBlock() {
    const { r0, c0, r1, c1 } = normalizeRange(st);
    return st.rows.slice(r0, r1 + 1).map(row => row.slice(c0, c1 + 1));
  }
  wrap.addEventListener('paste', e => {
    if (editing) return;
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (text === '') return;
    change(() => clipPaste(st, parseClipboardTsv(text)));
  });

  // ── The two views ─────────────────────────────────────────────────────────

  let commands = [];

  function showView(name) {
    $('[data-builder-sheet]').hidden = name !== 'sheet';
    $('[data-builder-commands]').hidden = name !== 'commands';
    const sheetStep = $('[data-builder-step="sheet"]');
    const commandsStep = $('[data-builder-step="commands"]');
    sheetStep.classList.toggle('--now', name === 'sheet');
    sheetStep.classList.toggle('--done', name === 'commands');
    commandsStep.classList.toggle('--now', name === 'commands');
    if (name === 'sheet') focusGrid();
  }

  function produce() {
    commitEditing();
    try {
      commands = commandsFor(url, columns, st.rows, { accepts });
    } catch (err) {
      render(); // a cell went bad since the last paint: show it instead
      return;
    }
    $('[data-builder-command-list]').innerHTML = commands
      .map(command => `<div class="mb-builder-command">${escapeHtml(command)}</div>`).join('');
    $('[data-builder-command-count]').textContent = `${commands.length} command${commands.length === 1 ? '' : 's'}, one per row that has data`;
    const copy = $('[data-builder-copy]');
    copy.textContent = `Copy all ${commands.length}`;
    copy.dataset.restLabel = copy.textContent;
    showView('commands');
  }

  async function copyAll(button) {
    try {
      await navigator.clipboard.writeText(commands.join('\n'));
      flashButtonLabel(button, 'Copied ✓');
    } catch (err) {
      console.warn('[MB builder] copy failed:', err);
      flashButtonLabel(button, 'Copy failed');
    }
  }

  function backToPicking() {
    commitEditing();
    const picks = picksInColumnOrder();
    closeActiveForm();
    enterPickMode({ picks, rows: st.rows, memory: sheetMemory(columns) });
  }

  // ── Not losing the sheet ──────────────────────────────────────────────────

  const hasAnything = () => st.rows.some(row => row.some(cell => String(cell ?? '').trim() !== ''));

  // A menu dismissed without a pick (Escape, a click elsewhere) leaves focus
  // on nothing; hand it back to the grid so the keyboard keeps working.
  new MutationObserver(records => {
    const menuClosed = records.some(record => [...record.removedNodes].some(node => node.classList?.contains('mb-popup-menu')));
    if (menuClosed && !editing && !isPopupMenuOpen() && !content.contains(document.activeElement)) focusGrid();
  }).observe(content, { childList: true });

  // The overlay closes on Escape (form.js). With rows in the sheet that would
  // throw them away on one stray key, so ask first. Registered on document in
  // the capture phase to run before that handler; it removes itself once the
  // overlay is gone. An open menu or cell editor takes its own Escape.
  function guardEscape(e) {
    if (!content.isConnected) { document.removeEventListener('keydown', guardEscape, true); return; }
    if (e.key !== 'Escape' || editing || isPopupMenuOpen() || !hasAnything()) return;
    if (!window.confirm('Close the Selenium automation helper? The rows in the sheet will be lost.')) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
  document.addEventListener('keydown', guardEscape, true);

  content.addEventListener('click', e => {
    if (e.target.closest('[data-builder-produce]')) produce();
    else if (e.target.closest('[data-builder-back-to-picking]')) backToPicking();
    else if (e.target.closest('[data-builder-back-to-sheet]')) showView('sheet');
    else if (e.target.closest('[data-builder-copy]')) copyAll(e.target.closest('[data-builder-copy]'));
  });

  render();
  focusGrid();
}
