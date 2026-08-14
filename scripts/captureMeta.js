/**
 * captureMeta.js — Capture metadata manifest.
 *
 * A single JSON file maps each capture's light-PNG repo path to its metadata
 * ({ resized?: true, padding?: number, annotated?: true, zapped?: true }). The
 * library reads it once on open to render RESIZED / PADDED / ANNOTATED /
 * ZAPPED pills; push/recapture flows write it with an authoritative upsert
 * (set when any flag applies, delete when plain) so a recaptured or
 * deleted-then-recaptured path never keeps stale metadata.
 *
 * Pure helpers (applyMetaUpserts, captureMetaPills) are unit-tested. The I/O
 * helpers below them use the GitHub Contents API and are verified manually.
 */

import { readRepoText } from './repoClient.js';
import { githubFetchAndPushFile } from './github.js';

export const MANIFEST_PATH = 'docs/assets/media/occ-captures/.captures-meta.json';

/**
 * Apply upserts to a manifest, returning a NEW object (input untouched).
 * Each upsert is { lightPath, resized, padding, annotated, zapped }. The rule
 * is authoritative: if the capture carries any metadata, its entry is set to
 * exactly that metadata; otherwise the key is deleted (clearing any stale
 * entry).
 */
export function applyMetaUpserts(manifest, upserts) {
  const next = { ...manifest };
  for (const u of upserts) {
    const entry = {};
    if (u.resized) entry.resized = true;
    if (u.padding > 0) entry.padding = u.padding;
    if (u.annotated) entry.annotated = true;
    if (u.zapped) entry.zapped = true;
    if (Object.keys(entry).length) next[u.lightPath] = entry;
    else delete next[u.lightPath];
  }
  return next;
}

/**
 * Filename marker for captures taken with annotate/zapper state in play:
 * '-a' (annotated), '-z' (zapped), '-a-z' (both), '' (neither). Annotated
 * captures may also carry the annotated elements' label slugs right after the
 * '-a' flag ('-a-time-clock-z'): first three non-empty names in annotation
 * order, deduped against the capture's own base slug and each other (dupes and
 * empties don't consume slots). Applied to NEW captures only — recaptures keep
 * their creation-time name.
 */
export function captureFlagSuffix(annotated, zapped, names = [], baseSlug = '') {
  let nameStr = '';
  if (annotated) {
    const seen = new Set(baseSlug ? [baseSlug] : []);
    const kept = [];
    for (const n of names) {
      if (!n || seen.has(n)) continue;
      seen.add(n);
      kept.push(n);
      if (kept.length === 3) break;
    }
    nameStr = kept.map(n => `-${n}`).join('');
  }
  return (annotated ? `-a${nameStr}` : '') + (zapped ? '-z' : '');
}

/**
 * Insert a flag suffix into a capture filename's theme-agnostic base, BEFORE
 * the -light-mode/-dark-mode tail — mediaTree.js pairs files by that tail, so
 * it must stay terminal:
 *   'media/occ-captures/foo/bar-light-mode.png' + '-a-z'
 *   → 'media/occ-captures/foo/bar-a-z-light-mode.png'
 * No-op for an empty suffix or a filename without the theme tail.
 */
export function appendCaptureSuffix(filename, suffix) {
  if (!suffix) return filename;
  return filename.replace(/-(?:light|dark)-mode\.[a-z0-9]+$/, tail => `${suffix}${tail}`);
}

/**
 * The theme-agnostic basename of a capture path — what deriveFilename produced
 * as the label slug (fallback and 50-char slice included), used to dedupe
 * annotation names against the capture's own name. '' for non-capture names.
 *   'media/occ-captures/foo/system-light-mode.png' → 'system'
 */
export function captureBaseSlug(filename) {
  const m = ((filename || '').split('/').pop() || '').match(/^(.*)-(?:light|dark)-mode\.[a-z0-9]+$/);
  return m ? m[1] : '';
}

/**
 * Grey file-format pill (".png" / ".svg" / ".mp4"…). Shared by the library
 * leaves and the component cards. Returns '' for a missing ext.
 */
export function formatPill(ext) {
  return ext ? `<span class="mb-kb-pill --format">.${ext}</span>` : '';
}

/**
 * Build the pills HTML for one capture's metadata, plus an optional trailing
 * grey file-format pill. Returns '' when there is nothing to show. Matches
 * the KB pill structure (.mb-kb-pills > .mb-kb-pill).
 */
export function captureMetaPills(meta, ext) {
  const pills = [];
  if (meta?.resized) pills.push('<span class="mb-kb-pill --resized">Resized</span>');
  if (meta?.padding > 0) pills.push(`<span class="mb-kb-pill --padded">Padded: ${meta.padding}px</span>`);
  if (meta?.annotated) pills.push('<span class="mb-kb-pill --annotated">Annotated</span>');
  if (meta?.zapped) pills.push('<span class="mb-kb-pill --zapped">Zapped</span>');
  const format = formatPill(ext);
  if (format) pills.push(format);
  if (!pills.length) return '';
  return `<span class="mb-kb-pills">${pills.join('')}</span>`;
}

/**
 * Read and parse the manifest. Returns {} if the file is missing or unparseable
 * (readRepoText returns '' on 404). Never throws — a metadata read failure must
 * not break the library.
 */
export async function readCaptureMeta() {
  try {
    const text = await readRepoText(MANIFEST_PATH);
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

/**
 * Apply a batch of upserts to the manifest on GitHub. No-op for an empty batch.
 * Reuses githubFetchAndPushFile (read-modify-write with sha, 409 retry, queued)
 * so the modify happens against server-fresh content.
 */
export async function writeCaptureMeta(upserts, onProgress) {
  if (!upserts || !upserts.length) return;
  await githubFetchAndPushFile(MANIFEST_PATH, onProgress, (currentText) => {
    let manifest = {};
    try { manifest = currentText ? JSON.parse(currentText) : {}; } catch { manifest = {}; }
    return JSON.stringify(applyMetaUpserts(manifest, upserts), null, 2) + '\n';
  });
}
