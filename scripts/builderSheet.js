/**
 * builderSheet.js — the logic behind the Selenium command builder's sheet.
 *
 * Ollie pastes rows from Google Sheets into a grid with one column per picked
 * input. This module is everything about that grid that is not drawing it:
 *
 *   reading     parseClipboardTsv (a Sheets cell holding line breaks arrives
 *               quoted and must stay one cell), parseMulti / formatMulti (a
 *               checkbox-group cell holds several answers the way a Sheets
 *               multi-select does: `"Grounds, Landscaping", +Gas Works`)
 *   columns     columnsFromPicks, and what a column's cells may hold
 *               (choiceTexts) in the form its pill says (matchModes,
 *               switchMatchOn)
 *   validating  checkCell / problems: a cell that is not one of the input's
 *               real choices, or that a typed input (date, number...) would
 *               silently blank, is reported before any command exists
 *   the grid    clipPaste / keepInBody over a dataTableGridModel state whose
 *               header row is locked; settleButtons keeps button cells in
 *               step with whether their row has data; sheetMemory / carryRows
 *               line a sheet's rows up again after a trip back to pick mode
 *   writing     actionsForRow / commandsFor: one /seleniumPageAutomation
 *               command per row, each a single line, in the JSON action
 *               syntax emerald parses (keys in the agreed order: targetType,
 *               target, action, value, optionType, option)
 *
 * Matching is exact and case-sensitive. Only the outer whitespace of a cell,
 * and the whitespace around the commas of a multi-answer cell, is ignored.
 *
 * Pure: no DOM, no document. Tested in tests/builderSheet.test.mjs.
 */
import { applyPaste, normalizeRange } from './dataTableGridModel.js';

// ── Reading the clipboard ───────────────────────────────────────────────────

// A quoted cell starting at `start`: { cell, end } with `end` just past the
// closing quote, or null when the text there is not a quoted cell. It is one
// only if it starts with `"` and its closing quote (`""` inside is a literal
// quote) is followed by a tab, a newline or the end of the text.
function readQuotedCell(t, start) {
  if (t[start] !== '"') return null;
  let cell = '';
  for (let i = start + 1; i < t.length; i++) {
    if (t[i] !== '"') { cell += t[i]; continue; }
    if (t[i + 1] === '"') { cell += '"'; i++; continue; }
    const next = t[i + 1];
    return next === undefined || next === '\t' || next === '\n' ? { cell, end: i + 1 } : null;
  }
  return null;
}

/**
 * Clipboard text → rows of cells. Like parseTsv in dataTableGridModel.js
 * (tab-separated, one trailing newline dropped, \r ignored) but quote-aware,
 * so a cell with line breaks stays one cell. Anything else that merely starts
 * with a quote is plain text.
 */
export function parseClipboardTsv(text) {
  let t = String(text ?? '').replace(/\r/g, '');
  if (t.endsWith('\n')) t = t.slice(0, -1);
  const rows = [[]];
  let i = 0;
  for (;;) {
    let cell;
    let end;
    const quoted = readQuotedCell(t, i);
    if (quoted) {
      ({ cell, end } = quoted);
    } else {
      end = i;
      while (end < t.length && t[end] !== '\t' && t[end] !== '\n') end++;
      cell = t.slice(i, end);
    }
    rows[rows.length - 1].push(cell);
    if (end >= t.length) break;
    if (t[end] === '\n') rows.push([]);
    i = end + 1;
  }
  return rows;
}

/**
 * Rows of cells → clipboard text, the inverse of parseClipboardTsv: a cell
 * holding a line break or a tab, or starting with a quote, is wrapped in
 * quotes (`""` for a quote inside) the way Sheets writes it, so it comes back
 * as one cell here and pastes as one cell there.
 */
export function formatClipboardTsv(block) {
  const quote = cell => (/[\t\n\r]/.test(cell) || cell.startsWith('"') ? `"${cell.replace(/"/g, '""')}"` : cell);
  return block.map(cells => cells.map(cell => quote(String(cell ?? ''))).join('\t')).join('\n');
}

// ── Multi-answer cells ──────────────────────────────────────────────────────

const isSpace = ch => ch !== undefined && /\s/.test(ch);

// Split a multi-answer cell on the commas outside double quotes. A piece is
// quoted only when it starts with `"` (after leading whitespace) and nothing but
// whitespace sits between its closing quote and the next comma; `""` inside is
// one quote. Pieces are trimmed and empty ones dropped.
function splitAnswers(text) {
  const pieces = [];
  let i = 0;
  while (i <= text.length) {
    let start = i;
    while (isSpace(text[start])) start++;
    let piece = null;
    let end = start;
    if (text[start] === '"') {
      let inner = '';
      for (let j = start + 1; j < text.length; j++) {
        if (text[j] !== '"') { inner += text[j]; continue; }
        if (text[j + 1] === '"') { inner += '"'; j++; continue; }
        let after = j + 1;
        while (isSpace(text[after])) after++;
        if (after >= text.length || text[after] === ',') { piece = { text: inner, quoted: true }; end = after; }
        break;
      }
    }
    if (!piece) {
      end = text.indexOf(',', start);
      if (end === -1) end = text.length;
      piece = { text: text.slice(start, end).trim(), quoted: false };
    }
    if (piece.text !== '') pieces.push(piece);
    i = end + 1;
  }
  return pieces;
}

/**
 * The answers in a multi-answer cell, checked against `texts` (the column's
 * allowed texts): { items, bad }. A cell that is exactly one choice is that
 * choice. A quoted piece must itself be a choice. Unquoted pieces are joined
 * back up when a run of them makes one choice, so `Grounds, Landscaping`
 * validates whether or not Sheets quoted it. Repeats are dropped.
 */
export function parseMulti(text, texts) {
  const cell = String(text ?? '').trim();
  const allowed = new Set(texts);
  if (allowed.has(cell)) return { items: [cell], bad: [] };
  const pieces = splitAnswers(cell);
  const items = [];
  const bad = [];
  const add = item => { if (!items.includes(item)) items.push(item); };
  let i = 0;
  while (i < pieces.length) {
    if (pieces[i].quoted) {
      if (allowed.has(pieces[i].text)) add(pieces[i].text); else bad.push(pieces[i].text);
      i++;
      continue;
    }
    let runEnd = i;
    while (runEnd + 1 < pieces.length && !pieces[runEnd + 1].quoted) runEnd++;
    let matched = false;
    for (let last = runEnd; last >= i; last--) {
      const joined = pieces.slice(i, last + 1).map(p => p.text).join(', ');
      if (allowed.has(joined)) { add(joined); i = last + 1; matched = true; break; }
    }
    if (!matched) { bad.push(pieces[i].text); i++; }
  }
  return { items, bad };
}

/** Answers → cell text: joined with `, `, an answer holding a comma or a quote wrapped in quotes. */
export function formatMulti(items) {
  return items.map(item => (/[",]/.test(item) ? `"${item.replace(/"/g, '""')}"` : item)).join(', ');
}

// ── Columns ─────────────────────────────────────────────────────────────────

const CHOICE_KINDS = new Set(['select', 'radioGroup', 'checkboxGroup']);

/** Picks → columns, in pick order: the pick minus its elements, choice columns matching on label. */
export function columnsFromPicks(picks) {
  return picks.map(({ elements, ...column }) => ({ ...column, matchOn: CHOICE_KINDS.has(column.kind) ? 'label' : null }));
}

/** What a choice column's cells can be matched on; `id` only when every choice has one. */
export function matchModes(column) {
  if (!CHOICE_KINDS.has(column.kind)) return [];
  return column.choices.every(c => c.id) ? ['label', 'value', 'id'] : ['label', 'value'];
}

/** The texts a cell of this column may hold; [] for free text. */
export function choiceTexts(column) {
  if (CHOICE_KINDS.has(column.kind)) return column.choices.map(c => c[column.matchOn]);
  if (column.kind === 'checkbox') return ['TRUE', 'FALSE'];
  if (column.kind === 'button') return column.submit ? ['submit', 'click'] : ['click'];
  return [];
}

// ── Validation ──────────────────────────────────────────────────────────────

// Input types Chrome blanks without a word when the value has the wrong shape.
export const SANITISED_TYPES = ['date', 'time', 'datetime-local', 'month', 'week', 'number', 'range', 'color'];

const MAX_LISTED = 10;

function choicesHint(column, texts) {
  const distinct = [...new Set(texts)];
  const more = distinct.length - MAX_LISTED;
  return `not a choice for ${column.title}. choices: ${distinct.slice(0, MAX_LISTED).join(', ')}${more > 0 ? `, and ${more} more` : ''}`;
}

const SHARED_TEXT = 'two choices share this text, switch the column to value or id';
const sharedBy = (texts, text) => texts.filter(t => t === text).length > 1;

/**
 * Is `text` a valid cell for `column`? → { ok: true, items } with the answers
 * the cell holds ([] for a blank cell, which means "leave this input alone"),
 * or { ok: false, message }. `accepts(type, text)` is an optional probe saying
 * whether a real input of that type keeps the value; it is injected so this
 * module stays DOM-free, and only typed inputs (SANITISED_TYPES) are probed.
 */
export function checkCell(column, text, { accepts } = {}) {
  const cell = String(text ?? '').trim();
  if (cell === '') return { ok: true, items: [] };

  if (column.kind === 'text' || column.kind === 'textarea') {
    if (column.kind === 'text' && accepts && SANITISED_TYPES.includes(column.typeLabel) && !accepts(column.typeLabel, cell)) {
      const format = column.typeLabel === 'date' ? '. dates must be yyyy-mm-dd' : '';
      return { ok: false, message: `this ${column.typeLabel} field will not accept "${cell}"${format}` };
    }
    return { ok: true, items: [cell] };
  }

  const texts = choiceTexts(column);
  if (column.kind === 'checkboxGroup') {
    const { items, bad } = parseMulti(cell, texts);
    if (bad.length) return { ok: false, message: `"${bad[0]}" is ${choicesHint(column, texts)}` };
    if (items.some(item => sharedBy(texts, item))) return { ok: false, message: SHARED_TEXT };
    return { ok: true, items };
  }
  if (!texts.includes(cell)) return { ok: false, message: choicesHint(column, texts) };
  if (sharedBy(texts, cell)) return { ok: false, message: SHARED_TEXT };
  return { ok: true, items: [cell] };
}

/** Sheet reference of a data cell. The locked header is sheet row 1, so data row 0 is row 2. */
export function a1(row, col) {
  let letters = '';
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return `${letters}${row + 2}`;
}

/** Every cell that fails checkCell: [{ row, col, ref, text, message }], in reading order. */
export function problems(columns, rows, options = {}) {
  const found = [];
  rows.forEach((cells, row) => columns.forEach((column, col) => {
    const result = checkCell(column, cells[col], options);
    if (!result.ok) found.push({ row, col, ref: a1(row, col), text: String(cells[col] ?? '').trim(), message: result.message });
  }));
  return found;
}

// ── The pill ────────────────────────────────────────────────────────────────

/**
 * Switch what a choice column matches on. Cells that were valid are rewritten
 * to the same choice in the new form; every other cell is left as it is.
 */
export function switchMatchOn(columns, rows, col, mode) {
  const column = columns[col];
  if (!matchModes(column).includes(mode)) throw new Error(`${mode} is not available for ${column.title}`);
  const from = column.matchOn;
  for (const cells of rows) {
    const result = checkCell(column, cells[col]);
    if (!result.ok || !result.items.length) continue;
    const moved = result.items.map(item => column.choices.find(c => c[from] === item)[mode]);
    cells[col] = column.kind === 'checkboxGroup' ? formatMulti(moved) : moved[0];
  }
  column.matchOn = mode;
}

// ── Rows and button defaults ────────────────────────────────────────────────

const isBlank = cell => String(cell ?? '').trim() === '';

/** Does the row hold anything besides its button cells? */
export function rowHasData(columns, row) {
  return columns.some((column, col) => column.kind !== 'button' && !isBlank(row[col]));
}

/**
 * Fill the blank button cells of the named rows with the button's default:
 * `submit` for a form's submit button, `click` for any other. Called when a
 * row first gets data, so an untouched row never becomes a submit-only command.
 */
export function fillButtonDefaults(columns, rows, rowIndexes) {
  for (const r of rowIndexes) {
    columns.forEach((column, col) => {
      if (column.kind === 'button' && rows[r] && isBlank(rows[r][col])) rows[r][col] = column.submit ? 'submit' : 'click';
    });
  }
}

/**
 * Keep button cells in step with whether their row has data. `hadData[r]` is
 * rowHasData before the change just made. A row that has just got its first
 * data takes its button defaults; a row whose data has just gone loses its
 * button cells, so deleting a row's data never leaves a submit-only command
 * behind. Rows that did not cross that line are left exactly as typed.
 */
export function settleButtons(columns, rows, hadData) {
  const gained = [];
  rows.forEach((row, r) => {
    const has = rowHasData(columns, row);
    if (has && !hadData[r]) gained.push(r);
    if (!has && hadData[r]) columns.forEach((column, col) => { if (column.kind === 'button') row[col] = ''; });
  });
  fillButtonDefaults(columns, rows, gained);
}

// ── Going back to pick mode and returning ───────────────────────────────────

/**
 * What a sheet must remember about its rows before they leave for pick mode:
 * the pick key each cell's column had, and each column's pill.
 */
export function sheetMemory(columns) {
  return {
    keys: columns.map(column => column.key),
    matchOn: Object.fromEntries(columns.map(column => [column.key, column.matchOn])),
  };
}

/**
 * Rows from an earlier sheet, lined up with the columns now picked. Cells
 * follow their column by pick key, never by position; a column picked since
 * starts blank, except that a new button column takes its default on rows
 * that have data. Each surviving column gets its pill back when that mode
 * still applies. Returns the new rows; sets `matchOn` on `columns`.
 */
export function carryRows(columns, rows, memory) {
  const from = columns.map(column => memory.keys.indexOf(column.key));
  const carried = rows.map(row => from.map(i => (i >= 0 ? String(row[i] ?? '') : '')));
  columns.forEach(column => {
    const mode = memory.matchOn[column.key];
    if (mode && matchModes(column).includes(mode)) column.matchOn = mode;
  });
  carried.forEach(row => {
    if (!rowHasData(columns, row)) return;
    columns.forEach((column, col) => {
      if (column.kind === 'button' && from[col] < 0) row[col] = column.submit ? 'submit' : 'click';
    });
  });
  return carried;
}

// ── The grid state ──────────────────────────────────────────────────────────

/** Keep the selection out of the header row (-1): the builder's headers are locked. */
export function keepInBody(st) {
  if (st.selected && st.selected.row < 0) st.selected.row = 0;
  if (st.anchor && st.anchor.row < 0) st.anchor.row = 0;
}

/** Paste a block at the selection. Pasting never adds columns; it adds rows as needed. */
export function clipPaste(st, block) {
  const room = st.align.length - normalizeRange(st).c0;
  applyPaste(st, block.map(cells => cells.slice(0, room)));
  keepInBody(st);
}

// ── Writing the commands ────────────────────────────────────────────────────

// One valid cell → its action objects. Each is built literally so its keys
// come out in the agreed order.
function actionsForCell(column, items) {
  const { targetType, target } = column;
  switch (column.kind) {
    case 'text':
    case 'textarea':
      return [{ targetType, target, action: 'fill', value: items[0] }];
    case 'select':
      return [{ targetType, target, action: 'select', optionType: column.matchOn, option: items[0] }];
    case 'radioGroup':
    case 'checkboxGroup':
      return items.map(option => ({ targetType, target, action: 'check', optionType: column.matchOn, option }));
    case 'checkbox':
      return [{ targetType, target, action: items[0] === 'TRUE' ? 'check' : 'uncheck' }];
    case 'button':
      // Opus panel buttons are disabled while their content loads and ignore
      // a click silently, so a click always waits for its target first.
      return items[0] === 'submit'
        ? [{ targetType, target, action: 'submit' }]
        : [{ targetType, target, action: 'wait' }, { targetType, target, action: 'click' }];
    default:
      return [];
  }
}

/** The action objects of one row, in column order. A blank cell adds nothing. */
export function actionsForRow(columns, row) {
  return columns.flatMap((column, col) => {
    const result = checkCell(column, row[col]);
    return result.ok && result.items.length ? actionsForCell(column, result.items) : [];
  });
}

/**
 * One command line per row that holds anything, in row order. Refuses a sheet
 * with problems: a command must never be written from a cell that is not a
 * real choice.
 */
export function commandsFor(url, columns, rows, options = {}) {
  const bad = problems(columns, rows, options);
  if (bad.length) throw new Error(`${bad.length} cell(s) do not match a choice`);
  const page = /[\s"'(){}]/.test(url) ? `"${url}"` : url;
  return rows
    .map(row => actionsForRow(columns, row))
    .filter(actions => actions.length)
    .map(actions => `/seleniumPageAutomation ${page} ${actions.map(a => JSON.stringify(a)).join(' ')}`);
}
