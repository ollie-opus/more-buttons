// scripts/tagRegistry.js
// The suggestion source for frontmatter tags, shared by the nav-links editor
// and page settings. Tags-in-use live only in per-page frontmatter, so the
// source is the mb_created_tags register in zensical.toml (append-only,
// written on tag-mode nav-links saves and page-settings tag saves). Free
// typing always wins — suggestions are a convenience.

import { readRepoText } from './repoClient.js';
import { githubFetchAndPushFile } from './github.js';
import { parseCreatedTags, addCreatedTag } from './navToml.js';

let _tomlPromise = null;
function loadToml() {
  _tomlPromise ??= readRepoText('zensical.toml').catch(() => '');
  return _tomlPromise;
}

let _tagsCache = null;
export async function loadCreatedTags() {
  if (_tagsCache) return _tagsCache;
  try {
    _tagsCache = parseCreatedTags(await loadToml());
  } catch {
    _tagsCache = [];
  }
  return _tagsCache;
}

/** Registers every tag not yet in zensical.toml's mb_created_tags, in one push
 * (addCreatedTag is idempotent; the push layer's no-op guard skips the commit
 * when nothing is new). Suggestion-list upkeep only — a failure must never
 * fail the component save that triggered it. */
export async function registerCreatedTags(tags, onProgress = () => {}) {
  const wanted = (Array.isArray(tags) ? tags : []).map(t => String(t).trim()).filter(Boolean);
  if (!wanted.length) return;
  try {
    const known = await loadCreatedTags();
    const fresh = wanted.filter(t => !known.some(k => k.toLowerCase() === t.toLowerCase()));
    if (!fresh.length) return;
    await githubFetchAndPushFile('zensical.toml', onProgress,
      toml => fresh.reduce((acc, t) => addCreatedTag(acc, t), toml));
    if (_tagsCache) _tagsCache.push(...fresh);
  } catch (e) {
    console.warn('tag-registry: failed to register tags in zensical.toml:', e);
  }
}

/** Single-tag convenience for callers that save one tag at a time. */
export function registerCreatedTag(tag, onProgress = () => {}) {
  return registerCreatedTags(tag ? [tag] : [], onProgress);
}
