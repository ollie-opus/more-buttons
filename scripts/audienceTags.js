/**
 * audienceTags.js — the "Written for" audience of a page, expressed as one of
 * three reserved frontmatter tags.
 *
 *   Users and above     → tags: [Using OCC, …]
 *   Managers and above  → tags: [Managing OCC, …]
 *   Administrators only → tags: [Administering OCC, …]
 *   N/A                 → none of the three
 *
 * The three tags live in the page's ordinary `tags:` frontmatter list (that is
 * what the KB build and the nav-links runtime consume), but in the forms they
 * are driven by a mutually-exclusive radio group and are hidden from the
 * free-text Tags chips + suggester. Pure; no DOM, no network.
 */

// The tag is all the KB needs: its build (overrides/partials/content.html in
// the KB repo) renders the "Written for" pill line under the H1 from it, using
// the ordered [project.extra] mb_audiences registry in zensical.toml for role
// names, colours and icons — the extension carries none of that. A page opts
// out with `hide: [written-for]` (the "Written for" hide checkbox). Order
// matters — "X and above" is AUDIENCES from X onward, and the tag names must
// match the registry's `tag`s.
export const AUDIENCES = Object.freeze([
  Object.freeze({ value: 'users',    tag: 'Using OCC',         label: 'Users and above' }),
  Object.freeze({ value: 'managers', tag: 'Managing OCC',      label: 'Managers and above' }),
  Object.freeze({ value: 'admins',   tag: 'Administering OCC', label: 'Administrators only' }),
]);

/** The radio value meaning "no audience tag". */
export const AUDIENCE_NONE = 'none';

export const AUDIENCE_TAG_NAMES = Object.freeze(AUDIENCES.map(a => a.tag));

const norm = t => String(t ?? '').trim().toLowerCase();

const TAG_TO_VALUE = new Map(AUDIENCES.map(a => [norm(a.tag), a.value]));

/** @returns {boolean} whether `tag` (case-insensitive, trimmed) is one of the three. */
export function isAudienceTag(tag) {
  return TAG_TO_VALUE.has(norm(tag));
}

/**
 * Split a page's tag list into its audience + the free tags.
 * When a legacy page carries several audience tags, the first in AUDIENCES
 * order wins; every audience tag is removed from `rest` regardless.
 * @param {string[]} tags
 * @returns {{audience: 'users'|'managers'|'admins'|'none', rest: string[]}}
 */
export function splitAudience(tags) {
  const list = Array.isArray(tags) ? tags : [];
  const present = new Set(list.map(norm));
  const hit = AUDIENCES.find(a => present.has(norm(a.tag)));
  return {
    audience: hit ? hit.value : AUDIENCE_NONE,
    rest: withoutAudienceTags(list),
  };
}

/**
 * Rebuild a page's tag list from the radio value + free tags: audience tag
 * first, then `rest` minus any stray audience tag (the radios are the only
 * source of those), deduped case-insensitively keeping the first spelling.
 * @param {string} audience  'users'|'managers'|'admins'|'none'|''|undefined
 * @param {string[]} rest
 * @returns {string[]}
 */
export function composeTags(audience, rest) {
  const a = AUDIENCES.find(x => x.value === audience);
  const out = [];
  const seen = new Set();
  const push = t => {
    const v = String(t ?? '').trim();
    if (!v || seen.has(v.toLowerCase())) return;
    seen.add(v.toLowerCase());
    out.push(v);
  };
  if (a) push(a.tag);
  for (const t of withoutAudienceTags(Array.isArray(rest) ? rest : [])) push(t);
  return out;
}

/** @returns {string[]} `list` minus the three audience tags (order + spelling kept). */
export function withoutAudienceTags(list) {
  return (Array.isArray(list) ? list : []).filter(t => !isAudienceTag(t));
}
