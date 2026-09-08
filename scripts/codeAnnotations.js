/**
 * codeAnnotations.js — pure annotation-marker logic for the Code block
 * component (no DOM). The rich code surface (codeRichEditor.js) and the
 * save paths both speak in the token stream this module defines:
 *
 *   [{ type: 'text', text } | { type: 'marker', num }]
 *
 * A marker token owns its comment chrome: the comment prefix (or wrap), the
 * `(n)!` body and ONE space before it are all consumed on tokenize and
 * re-emitted on serialize in the canonical style for the current language —
 * which is how markers restyle for free when the language changes.
 *
 * Tokenize is deliberately tolerant of hand-typed input (`#(1)!`, a bang-less
 * wrapped CSS/HTML comment marker, a bare `(1)!` with no comment char) but it
 * NEVER treats a bare end-of-line `(1)` as a marker — rewriting `sys.exit(1)`
 * into a comment would corrupt real code. mdCodeBlocks' trailing-list swallow
 * gate delegates here (hasAnnotationMarker) so the gate and the editor can
 * never diverge on what counts as a marker.
 */

// ── Comment styles ───────────────────────────────────────────────────────────

const HASH = { kind: 'line', open: '#' };
const SLASH = { kind: 'line', open: '//' };
const DASH = { kind: 'line', open: '--' };
const SEMI = { kind: 'line', open: ';' };
const TICK = { kind: 'line', open: "'" };
const COLONS = { kind: 'line', open: '::' };
const C_WRAP = { kind: 'wrap', open: '/*', close: '*/' };
const HTML_WRAP = { kind: 'wrap', open: '<!--', close: '-->' };

const LANG_STYLES = new Map();
const reg = (style, langs) => langs.forEach(l => LANG_STYLES.set(l, style));
reg(HASH, ['python', 'py', 'python3', 'bash', 'sh', 'shell', 'zsh', 'fish',
  'console', 'shell-session', 'powershell', 'ps1', 'yaml', 'yml', 'toml',
  'ruby', 'rb', 'perl', 'r', 'docker', 'dockerfile', 'nginx', 'make',
  'makefile', 'cmake', 'elixir']);
reg(SLASH, ['javascript', 'js', 'jsx', 'typescript', 'ts', 'tsx', 'java',
  'c', 'cpp', 'c++', 'csharp', 'cs', 'c#', 'go', 'rust', 'kotlin', 'swift',
  'php', 'scss', 'sass', 'dart', 'jsonc', 'groovy', 'scala']);
reg(DASH, ['sql', 'lua', 'haskell']);
reg(SEMI, ['ini']);
reg(TICK, ['vbnet', 'vb']);
reg(COLONS, ['batch', 'bat', 'cmd']);
reg(C_WRAP, ['css']);
reg(HTML_WRAP, ['html', 'htm', 'xml', 'svg', 'markdown', 'md']);

// Languages whose Pygments lexer has no comment tokens at all — an annotation
// marker renders as literal text there, so the editor warns / disables Add.
export const NO_COMMENT_LANGS = new Set(['', 'text', 'txt', 'plain',
  'plaintext', 'json', 'diff', 'http', 'regex', 'csv']);
// `console` / `shell-session`: only `$ `-prompted lines are parsed as
// commands; a marker on a plain (output) line never becomes an annotation.
export const CONSOLE_LANGS = new Set(['console', 'shell-session']);

const norm = lang => (lang ?? '').trim().toLowerCase();

/** The comment style for a language. Unknown and no-comment languages fall
 *  back to `#` (lossless — the authoring hint carries the warning). */
export function commentStyleFor(lang) {
  return LANG_STYLES.get(norm(lang)) ?? HASH;
}

/** The canonical marker string for annotation `n` in `lang`. */
export function markerFor(lang, n) {
  const s = commentStyleFor(lang);
  return s.kind === 'wrap' ? `${s.open} (${n})! ${s.close}` : `${s.open} (${n})!`;
}

// ── Tokenize / serialize ─────────────────────────────────────────────────────

// One tolerant pass over every style. Wrapped forms first (`<!--` contains
// `--`), then a line prefix glued to the marker, then a bare `(n)!`. The bang
// is required except inside a wrapped comment that IS the marker. Group 1 is
// the single optional preceding space consumed into the token; groups 2-5 are
// the marker number, one per alternative.
const MARKER_RE = new RegExp(
  '([ \\t])?' +
  '(?:' +
    '/\\*[ \\t]*\\((\\d+)\\)!?[ \\t]*\\*/' +
    '|<!--[ \\t]*\\((\\d+)\\)!?[ \\t]*-->' +
    "|(?:#|//|--|;|'|::)[ \\t]*\\((\\d+)\\)!" +
    '|\\((\\d+)\\)!' +
  ')',
  'g'
);

/**
 * Splits `code` into text and marker tokens. Anything that isn't a recognised
 * marker stays byte-identical text, so tokenize→serialize of marker-free code
 * is the identity.
 */
export function tokenizeAnnotatedCode(code) {
  const src = code ?? '';
  const tokens = [];
  let last = 0;
  MARKER_RE.lastIndex = 0;
  let m;
  while ((m = MARKER_RE.exec(src)) !== null) {
    if (m.index > last) tokens.push({ type: 'text', text: src.slice(last, m.index) });
    tokens.push({ type: 'marker', num: parseInt(m[2] ?? m[3] ?? m[4] ?? m[5], 10) });
    last = m.index + m[0].length;
  }
  if (last < src.length) tokens.push({ type: 'text', text: src.slice(last) });
  return tokens;
}

/**
 * True when the code contains at least one annotation marker as the tokenizer
 * defines it. mdCodeBlocks' trailing-list swallow gate delegates here so the
 * gate and the rich editor share one definition of "marker" (`sys.exit(1)`
 * and other bare end-of-line `(n)` text are NOT markers).
 */
export function hasAnnotationMarker(code) {
  return tokenizeAnnotatedCode(code).some(t => t.type === 'marker');
}

/**
 * Rebuilds the code string, emitting every marker in `lang`'s canonical style.
 * Markers are renumbered 1..n in token order by default — pass
 * `{ renumber: false }` to keep the original numbers (a raw-mode language
 * restyle must not silently re-bind markers to different list items).
 * A mid-line marker gets one separating space unless the text already ends
 * with whitespace; a line-start marker gets none.
 */
export function serializeTokens(tokens, lang, { renumber = true } = {}) {
  let out = '';
  let n = 0;
  for (const t of tokens ?? []) {
    if (t.type === 'text') { out += t.text; continue; }
    n++;
    const sep = (out === '' || /[\n \t]$/.test(out)) ? '' : ' ';
    out += sep + markerFor(lang, renumber ? n : t.num);
  }
  return out;
}

// ── Marker ↔ annotation binding ──────────────────────────────────────────────

/**
 * Pairs each marker with its numbered list item (`(n)` → annotations[n-1]).
 * Duplicate numbers copy the same text; an out-of-range number binds to ''.
 * Items no marker references come back as `orphans`, original order kept —
 * the caller preserves them rather than silently dropping user content.
 */
export function bindMarkersToAnnotations(tokens, annotations = []) {
  const referenced = new Set();
  const chips = [];
  for (const t of tokens ?? []) {
    if (t.type !== 'marker') continue;
    const idx = t.num - 1;
    chips.push({ num: t.num, text: annotations[idx] ?? '' });
    if (idx >= 0 && idx < annotations.length) referenced.add(idx);
  }
  const orphans = annotations.filter((_, i) => !referenced.has(i));
  return { chips, orphans };
}

/**
 * Save-time cleanup for the raw code + annotations pair: markers whose bound
 * text is empty are removed outright (a lingering marker would publish as a
 * literal `(1)` comment), empty orphans are dropped, survivors renumber 1..n
 * in document order with real orphans riding at the tail, and every marker is
 * re-emitted in `lang`'s canonical style.
 */
export function normalizeForSave(code, annotations = [], lang = '') {
  const tokens = tokenizeAnnotatedCode(code);
  const { chips, orphans } = bindMarkersToAnnotations(tokens, annotations);
  const outTokens = [];
  const kept = [];
  let chipIdx = 0;
  for (const t of tokens) {
    if (t.type !== 'marker') { outTokens.push(t); continue; }
    const chip = chips[chipIdx++];
    if (!(chip.text ?? '').trim()) continue; // drop the marker with its empty item
    kept.push(chip.text);
    outTokens.push(t);
  }
  return {
    code: serializeTokens(outTokens, lang),
    annotations: [...kept, ...orphans.filter(o => (o ?? '').trim())],
  };
}

// ── Authoring warning ────────────────────────────────────────────────────────

/** Language-specific annotation warning for the editor, '' for languages
 *  where annotations just work (no permanent hint — the chip UI carries the
 *  marker mechanics itself). */
export function langWarningFor(lang) {
  const l = norm(lang);
  if (CONSOLE_LANGS.has(l)) {
    return '⚠ In a console block only lines starting with a "$ " prompt are parsed — an annotation on a plain line will NOT activate. Use bash instead, or prefix the line with "$ ".';
  }
  if (NO_COMMENT_LANGS.has(l)) {
    return '⚠ Annotations only activate inside a highlighted comment, and this language has no comment highlighting — pick one like bash, python or yaml.';
  }
  return '';
}
