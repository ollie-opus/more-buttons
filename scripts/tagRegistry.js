// scripts/tagRegistry.js
// The tag registry: every tag pages may carry, with an optional colour each.
// Tags-in-use live only in per-page frontmatter; the registry is the
// [project.extra] mb_created_tags array in zensical.toml (see navToml.js for
// the shape). Read here for the tag chips (pick-only suggestions + chip
// colours); written only by the Knowledge Base Settings form. Names are never
// removed — there is deliberately no delete path.
//
// The three audience tags (audienceTags.js) always appear in the model, in
// canonical order, so they can carry a colour even before the file lists them.

import { readRepoText } from './repoClient.js';
import { githubFetchAndPushFile } from './github.js';
import { parseTagRegistry, writeTagRegistry, mergeTagRegistry } from './navToml.js';
import { AUDIENCE_TAG_NAMES } from './audienceTags.js';

let _tomlPromise = null;
function loadToml() {
  _tomlPromise ??= readRepoText('zensical.toml').catch(() => '');
  return _tomlPromise;
}

/** Audience tags first (canonical order, file colour if any), then the rest in file order. */
function withAudienceFirst(entries) {
  const byKey = new Map(entries.map(e => [e.name.toLowerCase(), e]));
  const audience = AUDIENCE_TAG_NAMES.map(name => byKey.get(name.toLowerCase()) ?? { name });
  const rest = entries.filter(e => !AUDIENCE_TAG_NAMES.some(a => a.toLowerCase() === e.name.toLowerCase()));
  return [...audience, ...rest];
}

let _tagsCache = null; // [{ name, colour? }]
/** The registry model (cached for the page's lifetime; refreshed by save). */
export async function loadTagRegistry() {
  if (_tagsCache) return _tagsCache;
  try {
    _tagsCache = withAudienceFirst(parseTagRegistry(await loadToml()));
  } catch {
    _tagsCache = withAudienceFirst([]);
  }
  return _tagsCache;
}

/** Registered tag names (audience tags first) — the suggestion source. */
export async function loadCreatedTags() {
  return (await loadTagRegistry()).map(e => e.name);
}

/** Sync colour lookup against the loaded cache: palette slug or null (also
 *  null before the first loadTagRegistry resolves). */
export function getTagColour(name) {
  const key = String(name ?? '').trim().toLowerCase();
  const hit = _tagsCache?.find(e => e.name.toLowerCase() === key);
  return hit?.colour || null;
}

/**
 * Persist `entries` ([{ name, colour? }]) to zensical.toml in one commit. The
 * push transform re-reads the file and UNIONS its entries with ours (names are
 * never dropped; our colours win), so a concurrent add elsewhere survives.
 * Throws on failure — the caller owns the error UI. Refreshes the caches from
 * the pushed text (read-your-writes).
 */
export async function saveTagRegistry(entries, onProgress = () => {}) {
  const pushed = await githubFetchAndPushFile('zensical.toml', onProgress,
    toml => writeTagRegistry(toml, mergeTagRegistry(parseTagRegistry(toml), entries)));
  _tomlPromise = Promise.resolve(pushed);
  _tagsCache = null;
  return loadTagRegistry();
}
