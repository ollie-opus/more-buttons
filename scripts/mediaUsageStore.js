/**
 * mediaUsageStore.js — I/O for the media usage index (see mediaUsage.js for
 * the pure logic and index shape).
 *
 * The index is kept fresh by the github.js write/delete hooks; this module
 * reads it for the library entry forms and builds it once (backfill) when the
 * file doesn't exist yet. The backfill and every write ride
 * githubFetchAndPushFile, so the queue / sha / 409-retry / byte-identical-skip
 * story is shared with all other repo writes.
 */

import { REPO, authHeader, readRepoText } from './repoClient.js';
import { githubFetchAndPushFile } from './github.js';
import { parseNavBlock } from './navToml.js';
import {
  USAGE_INDEX_PATH, isTrackedPagePath, scanMarkdownMediaPaths,
  parseUsageIndex, serializeUsageIndex,
} from './mediaUsage.js';

/**
 * Read and parse the index. {} if missing/unparseable (readRepoText returns
 * '' on 404). Never throws — a usage read failure must not break the forms.
 */
export async function readMediaUsage() {
  try {
    return parseUsageIndex(await readRepoText(USAGE_INDEX_PATH));
  } catch {
    return {};
  }
}

// One recursive tree listing → every tracked page path (docs/pages/*.md +
// docs/drafts/*.md). Same pattern as mediaLibrary's listMediaPaths.
async function listTrackedPagePaths() {
  const auth = await authHeader();
  const url = `https://api.github.com/repos/${REPO.owner}/${REPO.name}/git/trees/${REPO.branch}?recursive=1`;
  const res = await fetch(url, { headers: { 'Authorization': auth }, cache: 'no-store' });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const data = await res.json();
  return (data.tree ?? [])
    .filter(e => e.type === 'blob' && isTrackedPagePath(e.path))
    .map(e => e.path);
}

/**
 * Return the populated index, building + persisting it when the file is
 * missing/empty: enumerate every page/draft, scan each one's markdown, write
 * the full index in one commit. One-time cost (one GET per page); thereafter
 * the github.js hooks maintain it incrementally.
 */
export async function ensureMediaUsageIndex(onProgress) {
  const existing = await readMediaUsage();
  if (Object.keys(existing).length) return existing;

  onProgress?.('Building media usage index…');
  const pagePaths = await listTrackedPagePaths();
  const built = {};
  for (let i = 0; i < pagePaths.length; i++) {
    onProgress?.(`Scanning pages… ${i + 1}/${pagePaths.length}`);
    const md = await readRepoText(pagePaths[i]);
    const media = scanMarkdownMediaPaths(md);
    if (media.length) built[pagePaths[i]] = media;
  }
  await githubFetchAndPushFile(USAGE_INDEX_PATH, onProgress, () => serializeUsageIndex(built));
  return built;
}

/**
 * Everything an entry form needs to render its "Used on pages" tree:
 * the (backfilled-if-needed) index plus the parsed live + draft navs.
 */
export async function loadUsageContext(onProgress) {
  const [index, tomlText] = await Promise.all([
    ensureMediaUsageIndex(onProgress),
    readRepoText('zensical.toml'),
  ]);
  return {
    index,
    nav: parseNavBlock(tomlText, 'nav').items,
    draftNav: parseNavBlock(tomlText, 'draft_nav').items,
  };
}
