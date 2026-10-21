// Page-match rules (buttons.json / automations.json `pageMatch`).
//
//   { mode: 'and' | 'or', keywords: [k, ...] }       every / some keyword matches
//   { mode: _, keywords: [[k, ...], [k, ...]] }      some group has every keyword
//
// A keyword is a case-insensitive substring of the url, or `REGEX:<source>`
// tested against the LOWER-CASED url (so write regexes in lower case). A
// leading `!` negates it. A missing rule or missing keywords matches everything.

function compileKeyword(keyword) {
  const isNegative = keyword.startsWith('!');
  const effective = isNegative ? keyword.slice(1) : keyword;
  let test;
  if (effective.startsWith('REGEX:')) {
    try {
      const regex = new RegExp(effective.slice(6));
      test = (lowerUrl) => regex.test(lowerUrl);
    } catch {
      test = () => false;
    }
  } else {
    const needle = effective.toLowerCase();
    test = (lowerUrl) => lowerUrl.includes(needle);
  }
  return isNegative ? (lowerUrl) => !test(lowerUrl) : test;
}

/**
 * Compile a rule once into a `(url) => boolean` predicate. Regexes are built
 * at compile time, so matching on every navigation is just substring tests.
 */
export function compilePageMatch(rule) {
  if (!rule || !rule.keywords) return () => true;
  const { keywords, mode } = rule;
  let match;
  if (Array.isArray(keywords[0])) {
    const groups = keywords.map((group) => group.map(compileKeyword));
    match = (u) => groups.some((group) => group.every((k) => k(u)));
  } else {
    const tests = keywords.map(compileKeyword);
    if (mode === 'or') match = (u) => tests.some((k) => k(u));
    else if (mode === 'and') match = (u) => tests.every((k) => k(u));
    else match = () => false;
  }
  return (url) => match(url.toLowerCase());
}

// Compiled predicates keyed by rule object, so repeated calls with the same
// config entry (every navigation, every popup open) never recompile.
const compiled = new WeakMap();

export function pageMatchesUrl(rule, url) {
  if (!rule || typeof rule !== 'object') return compilePageMatch(rule)(url);
  let predicate = compiled.get(rule);
  if (!predicate) {
    predicate = compilePageMatch(rule);
    compiled.set(rule, predicate);
  }
  return predicate(url);
}
