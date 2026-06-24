/**
 * mdButtons.js — Zensical "button" component markdown round-trip.
 *
 * A button is a link decorated with attr_list classes:
 *   [Label](destination){ .md-button }                     ← secondary
 *   [Label](destination){ .md-button .md-button--primary } ← primary
 *   [Label :lucide-send:](destination){ .md-button }       ← with icon
 *
 * It is the simplest component: single-line, holds no sub-components. Identity is
 * a hidden `<span data-uuid>` on the line BEFORE the link — the same convention
 * captures and videos use (see components.js locateVideoLines/ensureVideoUUIDs).
 *
 * (Unrelated to scripts/buttons.js, which renders the extension's own toolbar
 * buttons — hence the `mdButtons` name.)
 *
 * All functions here are pure (no DOM, no network) except generateUUID.
 */

import { generateUUID } from './admonitions.js';

// A button line. Group 1 indent, 2 label (may carry a trailing ` :icon:`),
// 3 destination, 4 the attr block inside `{ … }`. The link text and destination
// are kept lazy/greedy-balanced so a destination containing `)` is still rare
// enough to ignore (Zensical destinations are URLs/paths).
const BUTTON_LINE_RE =
  /^(\s*)\[([^\]]*)\]\(([^)]*)\)\{\s*([^}]*?)\s*\}\s*$/;

// A trailing inline icon shortcode at the end of a label, e.g. "Send :lucide-send:".
const TRAILING_ICON_RE = /\s*(:[a-z0-9]+(?:-[a-z0-9]+)*:)\s*$/i;

const UUID_SPAN_LINE_RE = /^\s*<span[^>]*data-uuid="([^"]+)"[^>]*><\/span>\s*$/;

/** `lucide/arrow-left` → `:lucide-arrow-left:` (path separators become dashes). */
export function iconToShortcode(icon) {
  const v = (icon ?? '').trim();
  if (!v) return '';
  return ':' + v.replace(/\//g, '-') + ':';
}

/** `:lucide-arrow-left:` → `lucide/arrow-left` (first dash after the set name → `/`). */
export function shortcodeToIcon(shortcode) {
  const v = (shortcode ?? '').trim().replace(/^:|:$/g, '');
  if (!v) return '';
  // The icon set name is the first dash-delimited segment; the remainder is the
  // icon path. lucide/material/etc. icons live one level deep, so the first dash
  // is the only separator we restore.
  return v.replace('-', '/');
}

/** True when `.md-button--primary` is present in an attr block. */
function attrsArePrimary(attrs) {
  return /\bmd-button--primary\b/.test(attrs ?? '');
}

/** True when the link opens in a new tab (`target="_blank"`). */
function attrsOpenNewTab(attrs) {
  return /\btarget\s*=\s*["']?_blank["']?/.test(attrs ?? '');
}

/**
 * Emits the markdown lines for each button. Mirrors buildVideoLines: a leading
 * '' separator, then an optional uuid span, then the link line. buildComponentBody
 * slices off the leading ''.
 *
 * @param {Array<{uuid?,label,destination,icon,primary}>} list
 * @returns {string[]}
 */
export function buildButtonLines(list = []) {
  return list.flatMap(b => {
    const label = (b.label ?? '').trim();
    const shortcode = iconToShortcode(b.icon);
    const text = shortcode ? (label ? `${label} ${shortcode}` : shortcode) : label;
    const classes = b.primary ? '.md-button .md-button--primary' : '.md-button';
    const attrs = b.newTab ? `${classes} target="_blank" rel="noopener"` : classes;
    const line = `[${text}](${b.destination ?? ''}){ ${attrs} }`;
    const spanLines = b.uuid ? [`<span data-uuid="${b.uuid}" style="display:none"></span>`] : [];
    return ['', ...spanLines, line];
  });
}

/**
 * Locates every top-level button in `body`, returning line-addressable entries.
 * A preceding own-line uuid span is swallowed into startLine (its identity).
 *
 * @param {string} body
 * @returns {Array<{uuid,label,destination,icon,primary,indent,startLine,endLine}>}
 */
export function locateButtonLines(body) {
  const lines = (body ?? '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(BUTTON_LINE_RE);
    if (!m) continue;
    const attrs = m[4];
    if (!/\bmd-button\b/.test(attrs)) continue; // a plain link, not a button

    const indent = m[1];
    let label = m[2];
    let icon = '';
    const im = label.match(TRAILING_ICON_RE);
    if (im) { icon = shortcodeToIcon(im[1]); label = label.slice(0, im.index); }

    let startLine = i;
    let uuid = null;
    if (i > 0) {
      const sm = lines[i - 1].match(UUID_SPAN_LINE_RE);
      if (sm) { uuid = sm[1]; startLine = i - 1; }
    }

    out.push({
      uuid, label: label.trim(), destination: m[3], icon,
      primary: attrsArePrimary(attrs), newTab: attrsOpenNewTab(attrs),
      indent, startLine, endLine: i + 1,
    });
  }
  return out;
}

/**
 * Backfills a hidden data-uuid span before every button that lacks one.
 * Idempotent; reverse-order splice keeps earlier indices valid. Mirrors
 * ensureVideoUUIDs / ensureCaptureUUIDs.
 */
export function ensureButtonUUIDs(markdown) {
  const btns = locateButtonLines(markdown);
  if (btns.length === 0) return markdown;
  const lines = (markdown ?? '').split('\n');
  let modified = false;
  for (let k = btns.length - 1; k >= 0; k--) {
    const b = btns[k];
    if (b.uuid) continue;
    const span = `${b.indent}<span data-uuid="${generateUUID()}" style="display:none"></span>`;
    lines.splice(b.startLine, 0, span);
    modified = true;
  }
  return modified ? lines.join('\n') : markdown;
}

/** Finds the button identified by `uuid` anywhere in `md`, or null. */
export function locateButtonByUUID(md, uuid) {
  return locateButtonLines(md).find(b => b.uuid === uuid) ?? null;
}

/**
 * Replaces the single link line of the button identified by `uuid` with
 * `newLine` (no uuid span, no indent — they are reapplied here). Leaves the
 * identity span in place. Returns original markdown if the uuid is absent.
 */
export function replaceButtonByUUID(md, uuid, newLine) {
  const lines = (md ?? '').split('\n');
  const loc = locateButtonByUUID(md, uuid);
  if (!loc) return md;
  // endLine is the link line + 1; the link line is endLine - 1 regardless of
  // whether a span was swallowed into startLine.
  const linkLine = loc.endLine - 1;
  lines[linkLine] = loc.indent + newLine;
  return lines.join('\n');
}

/**
 * Deletes the button identified by `uuid` (its identity span + link line), plus
 * one trailing blank line if present. Mirrors deleteAdmonitionByUUID. Returns the
 * original markdown if the uuid is absent.
 */
export function deleteButtonByUUID(md, uuid) {
  const lines = (md ?? '').split('\n');
  const loc = locateButtonByUUID(md, uuid);
  if (!loc) return md;
  let end = loc.endLine;
  if (end < lines.length && lines[end] === '') end++; // eat one trailing blank
  lines.splice(loc.startLine, end - loc.startLine);
  return lines.join('\n');
}

/** Builds a fresh button component from a button object. */
export function buttonComponent(btn) {
  return { kind: 'button', btn };
}

/**
 * Canonical form/merge representation of a button's editable fields. Mirrors
 * videoDimFields/captureDimFields — the edit form seeds its baseline from this
 * AND parses fresh markdown through it, so an untouched button compares equal.
 */
export function buttonDimFields(btn) {
  return {
    buttonLabel: btn?.label ?? '',
    buttonType: btn?.primary ? 'primary' : 'secondary',
    buttonDestination: btn?.destination ?? '',
    icon: btn?.icon ?? '',
    buttonNewTab: btn?.newTab ? 'yes' : 'no',
  };
}
