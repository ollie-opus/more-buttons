export function resolveColor(color, isDark) {
  if (!color || typeof color === 'string') return color;
  return isDark ? (color.dark ?? color.light) : (color.light ?? color.dark);
}

export function isDarkMode() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function pageMatchesUrl(rule, url) {
  if (!rule || !rule.keywords) return true;
  const lowerUrl = url.toLowerCase();

  const matchesKeyword = (keyword) => {
    const isNegative = keyword.startsWith('!');
    const effectiveKeyword = isNegative ? keyword.slice(1) : keyword;
    let matched;
    if (effectiveKeyword.startsWith("REGEX:")) {
      try {
        const regex = new RegExp(effectiveKeyword.slice(6));
        matched = regex.test(lowerUrl);
      } catch (e) {
        matched = false;
      }
    } else {
      matched = lowerUrl.includes(effectiveKeyword.toLowerCase());
    }
    return isNegative ? !matched : matched;
  };

  if (Array.isArray(rule.keywords[0])) {
    return rule.keywords.some(group => group.every(matchesKeyword));
  }
  if (rule.mode === "or") return rule.keywords.some(matchesKeyword);
  if (rule.mode === "and") return rule.keywords.every(matchesKeyword);
  return false;
}
