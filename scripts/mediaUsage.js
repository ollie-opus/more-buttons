/**
 * mediaUsage.js — pure logic for the media usage index.
 *
 * A single JSON file in the KB repo maps each page's repo path to the sorted
 * list of docs/assets/... media paths its markdown references:
 *   { "docs/pages/alpha.md": ["docs/assets/media/occ-captures/foo-dark-mode.png", ...] }
 *
 * Per-page entries are authoritative — replaced wholesale on every page write
 * (mirroring captureMeta's applyMetaUpserts), so the github.js write/delete
 * hooks stay trivially correct across publish/discard/delete flows. The
 * library entry forms invert it client-side to render a "Used on pages" tree.
 *
 * PURE module (no imports): unit-tested under node, and importable from
 * github.js without a cycle.
 */

export const USAGE_INDEX_PATH = 'docs/assets/media/.media-usage.json';

// True for files whose writes/deletes must maintain the index: page/draft
// markdown, INCLUDING system-updates/status (updates embed captures). Unlike
// github.js's isGuideMarkdown, which excludes the system files because their
// block grammar differs — media scanning is grammar-agnostic.
export function isTrackedPagePath(filePath) {
  const p = filePath || '';
  return p.endsWith('.md') && (p.startsWith('docs/pages/') || p.startsWith('docs/drafts/'));
}

// Every `../assets/<path>` reference in page markdown, however it's written:
// capture pair lines (both halves appear literally), <video src>, empty-alt
// image components, alt-text prose images, plain links. Usage means ANY
// reference — deliberately broader than the component parsers, which only
// match the extension's own editable grammar (an alt-text image the extension
// can't edit still breaks a page if its file is deleted). The path ends at a
// #fragment, closing delimiter, or whitespace.
const ASSET_REF_RE = /\.\.\/assets\/([^)\s"'#{}`<>]+)/g;

/**
 * Scan full page markdown for every asset reference and return the sorted
 * unique repo paths (`docs/assets/...`).
 */
export function scanMarkdownMediaPaths(markdown) {
  const paths = new Set();
  for (const m of (markdown ?? '').matchAll(ASSET_REF_RE)) {
    paths.add('docs/assets/' + m[1]);
  }
  return [...paths].sort();
}

/**
 * Authoritative per-page replace, returning a NEW object (input untouched):
 * a non-empty media list sets the entry to exactly that list; an empty list
 * deletes the key (page gone or media-free).
 */
export function applyUsageUpsert(index, pagePath, mediaPaths) {
  const next = { ...index };
  if (mediaPaths && mediaPaths.length) next[pagePath] = [...mediaPaths].sort();
  else delete next[pagePath];
  return next;
}

/** ''/garbage/non-object → {}; never throws. */
export function parseUsageIndex(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Deterministic serialization: sorted keys, sorted media lists, trailing
 * newline. Determinism is load-bearing — github.js skips the PUT when the
 * rebuilt index is byte-identical, so an unchanged media set must serialize
 * to the exact same text.
 */
export function serializeUsageIndex(index) {
  const out = {};
  for (const key of Object.keys(index).sort()) {
    out[key] = [...index[key]].sort();
  }
  return JSON.stringify(out, null, 2) + '\n';
}

/**
 * Which pages use this media file. `mediaPaths` are the candidate repo paths
 * for one library entry ([light, dark] or [single]); a page referencing ANY
 * candidate counts. Returns a Set of page basenames ('foo.md'), collapsing a
 * page's docs/pages/ and docs/drafts/ entries onto one identity — the same
 * basename key the KB guide tree merges on.
 */
export function pageBasesUsingMedia(index, mediaPaths) {
  const wanted = new Set(mediaPaths);
  const bases = new Set();
  for (const [pagePath, media] of Object.entries(index)) {
    if (media.some(p => wanted.has(p))) bases.add(pagePath.split('/').pop());
  }
  return bases;
}

// navToml leaf value → basename ('pages/alpha.md' → 'alpha.md').
const baseOfValue = (value) => (value || '').split('/').pop();

// Filter a navToml tree to leaves whose basename is in `bases`, pruning
// folders the filter empties, converting to kbTree nodes as we go.
// `seenBases` collects the bases kept, so a second (draft_nav) pass can skip
// pages already placed by the first.
function filterNavToKbNodes(nodes, bases, seenBases) {
  const out = [];
  for (const node of nodes) {
    if (node.children) {
      const children = filterNavToKbNodes(node.children, bases, seenBases);
      if (children.length) out.push({ kind: 'folder', label: node.name, children });
    } else {
      const base = baseOfValue(node.value);
      if (!bases.has(base) || seenBases.has(base)) continue;
      seenBases.add(base);
      out.push({
        kind: 'file',
        label: node.name,
        attrs: { 'data-usage-file': node.value, 'data-usage-label': node.name },
      });
    }
  }
  return out;
}

/**
 * kbTree nodes for the pages in `bases`: the live nav filtered down (keeping
 * its folder structure, System section included), then draft-only pages
 * appended from their draft_nav placement. A page present in both navs
 * renders once, at its live position.
 */
export function buildUsageTreeNodes(nav, draftNav, bases) {
  const seenBases = new Set();
  const fromNav = filterNavToKbNodes(nav ?? [], bases, seenBases);
  const fromDrafts = filterNavToKbNodes(draftNav ?? [], bases, seenBases);
  return [...fromNav, ...fromDrafts];
}
