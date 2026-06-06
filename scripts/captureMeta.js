/**
 * captureMeta.js — Capture metadata manifest.
 *
 * A single JSON file maps each capture's light-PNG repo path to its metadata
 * ({ resized?: true, padding?: number }). The library reads it once on open to
 * render RESIZED / PADDED pills; push/recapture flows write it with an
 * authoritative upsert (set when resized/padded, delete when plain) so a
 * recaptured or deleted-then-recaptured path never keeps stale metadata.
 *
 * Pure helpers (applyMetaUpserts, captureMetaPills) are unit-tested. The I/O
 * helpers below them use the GitHub Contents API and are verified manually.
 */

import { readRepoText } from './repoClient.js';
import { githubFetchAndPushFile } from './github.js';

export const MANIFEST_PATH = 'docs/assets/occ-captures/.captures-meta.json';

/**
 * Apply upserts to a manifest, returning a NEW object (input untouched).
 * Each upsert is { lightPath, resized, padding }. The rule is authoritative:
 * if the capture is resized or padded, its entry is set to exactly that
 * metadata; otherwise the key is deleted (clearing any stale entry).
 */
export function applyMetaUpserts(manifest, upserts) {
  const next = { ...manifest };
  for (const u of upserts) {
    const entry = {};
    if (u.resized) entry.resized = true;
    if (u.padding > 0) entry.padding = u.padding;
    if (Object.keys(entry).length) next[u.lightPath] = entry;
    else delete next[u.lightPath];
  }
  return next;
}

/**
 * Build the pills HTML for one capture's metadata. Returns '' when there is
 * nothing to show. Matches the KB pill structure (.mb-kb-pills > .mb-kb-pill).
 */
export function captureMetaPills(meta) {
  if (!meta) return '';
  const pills = [];
  if (meta.resized) pills.push('<span class="mb-kb-pill --resized">Resized</span>');
  if (meta.padding > 0) pills.push(`<span class="mb-kb-pill --padded">Padded: ${meta.padding}px</span>`);
  if (!pills.length) return '';
  return `<span class="mb-kb-pills">${pills.join('')}</span>`;
}
