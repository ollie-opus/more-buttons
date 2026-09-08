/**
 * captureDest.js — Where a capture pair is stored, and how it is named there.
 *
 * Two library folders hold light/dark capture pairs:
 *
 *   media/occ-captures/<page path>/<slug>-light-mode.<ext>
 *     The shared guide library. Paths mirror the OCC page the capture was
 *     taken on; recapturing a path overwrites it in place so every guide
 *     referencing it refreshes together.
 *
 *   media/system-update-captures/<slug>-<id8>-light-mode.<ext>
 *     Frozen snapshots for the system-updates page. Flat folder, a short
 *     random id before the theme tail so names never clash, never
 *     recaptured or replaced — a system update shows what the product looked
 *     like at release time. Captures inserted into a system update always land
 *     here: new screenshots directly, library picks by copying the pair.
 *
 * The id sits BEFORE the theme tail (same mechanic as appendCaptureSuffix in
 * captureMeta.js) because mediaTree.js, components.js and captureCards.js all
 * pair light/dark files by that terminal `-light-mode.<ext>` tail.
 *
 * Leaf module with no imports: captures.js cannot import systemUpdates.js
 * (which imports captures.js), and the library forms need the same predicates.
 * Every export is pure and node-testable.
 */

export const OCC_DIR = 'occ-captures';
export const SU_DIR = 'system-update-captures';
/** Library tabs whose files are light/dark pairs (and carry manifest pills). */
export const PAIR_DIRS = [OCC_DIR, SU_DIR];

const SU_FILE_RE = /(^|\/)system-updates\.md$/;
const THEME_TAIL_RE = /-(light|dark)-mode\.([a-z0-9]+)$/i;

/** True for the published system-updates page and its drafts file. */
export function isSystemUpdateFile(file) {
  return SU_FILE_RE.test(file || '');
}

/**
 * True when a component container (`{ kind, uuid, file }`) writes into the
 * system-updates page or drafts. Keyed on the FILE, not the kind, so nested
 * containers inside an update (data-table cells, grid cells, content tabs,
 * admonitions) count too.
 */
export function isSystemUpdateContainer(container) {
  return isSystemUpdateFile(container?.file);
}

/** Library folder a container's captures are stored in. */
export function captureDirForContainer(container) {
  return isSystemUpdateContainer(container) ? SU_DIR : OCC_DIR;
}

/**
 * True for any path inside the frozen folder — repo-relative
 * (`docs/assets/media/system-update-captures/…`) or library-relative
 * (`media/system-update-captures/…`).
 */
export function isSystemUpdateCapturePath(path) {
  return new RegExp(`^(docs/assets/)?media/${SU_DIR}/`).test(path || '');
}

/** Eight lowercase hex chars — the first UUID group. Unique enough for one flat folder. */
export function shortId() {
  return crypto.randomUUID().split('-')[0];
}

/**
 * Library-relative light/dark filenames for a pair base inside a folder — the
 * shape pushCaptures expects (`media/<dir>/<base>-light-mode.<ext>`).
 */
export function pairFilenames(dir, base, ext) {
  return {
    lightFilename: `media/${dir}/${base}-light-mode.${ext}`,
    darkFilename: `media/${dir}/${base}-dark-mode.${ext}`,
  };
}

/**
 * Rename a derived capture filename into the frozen folder: drop the folder
 * tree (the flat folder carries no page path), keep the slug and any -a/-z
 * flag markers, and splice the id in before the theme tail.
 *
 *   'media/occ-captures/sites/uuid/foo-a-z-light-mode.png' + 'ab12cd34'
 *   → 'media/system-update-captures/foo-a-z-ab12cd34-light-mode.png'
 */
export function toSystemUpdateFilename(filename, id8) {
  const name = (filename || '').split('/').pop();
  const m = THEME_TAIL_RE.exec(name);
  if (!m) return `media/${SU_DIR}/${name}`;
  const slug = name.slice(0, m.index);
  return `media/${SU_DIR}/${slug}-${id8}-${m[1]}-mode.${m[2]}`;
}
