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
 *
 * Matching is exact and case-sensitive. Only the outer whitespace of a cell,
 * and the whitespace around the commas of a multi-answer cell, is ignored.
 *
 * Pure: no DOM, no document. Tested in tests/builderSheet.test.mjs.
 */

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
