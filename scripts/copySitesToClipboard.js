export function copySitesToClipboard(mode = 'all') {
  const container = document.querySelector('ol[data-component="sites/select_tree"]');
  if (!container) {
    alert('Site tree not found');
    return '';
  }

  // Get all site anchors except the first one (Create new site)
  const allAnchors = container.querySelectorAll('a.site-index_site');
  const anchors = Array.from(allAnchors).slice(1);

  const clean = (s) => s.replace(/\s+/g, ' ').trim();

  // Calculate tier by counting ancestor ul.site-index_indent elements
  const getTier = (element) => {
    let tier = 0;
    let current = element.parentElement;

    while (current && current !== container) {
      if (current.matches('ul.site-index_indent')) {
        tier++;
      }
      current = current.parentElement;
    }
    return tier;
  };

  const rows = mode === 'all' ? [['site_name', 'site_url', 'site_admin_url', 'relative_tier_value']] : [];

  for (const anchor of anchors) {
    const nameEl = anchor.querySelector('[translate="no"]');
    const name = clean(nameEl?.textContent ?? anchor.textContent);
    const adminUrl = anchor.href || '';
    const siteUrl = adminUrl.replace('/admin/sites/', '/sites/');
    const tier = getTier(anchor);

    if (mode === 'all') {
      rows.push([name, siteUrl, adminUrl, tier]);
    } else if (mode === 'sites') {
      rows.push([siteUrl]);
    } else if (mode === 'adminSites') {
      rows.push([adminUrl]);
    }
  }

  // Build TSV
  const tsv = rows.map(cols => cols.join('\t')).join('\n');
  console.log(tsv);

  const successMessage = `Data copied to clipboard!\n(${rows.length - 1} rows)`;

  // Copy to clipboard with fallback
  const copyToClipboard = (text) => {
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text);
    }

    return new Promise((resolve, reject) => {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();

      try {
        document.execCommand('copy') ? resolve() : reject(new Error('execCommand failed'));
      } catch (e) {
        reject(e);
      } finally {
        document.body.removeChild(textarea);
      }
    });
  };

  copyToClipboard(tsv)
    .then(() => alert(successMessage))
    .catch((err) => {
      console.error('Copy failed:', err);
      alert('Could not copy automatically. Please copy the data from the console.');
    });

  return tsv;
}
