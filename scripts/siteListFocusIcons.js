export function siteListFocusIcons() {
  function extractUUID(href) {
    if (!href) return null;
    const match = href.match(/\/sites\/([0-9a-f-]+)/i);
    return match ? match[1] : null;
  }

  document.querySelectorAll('.site-index_site').forEach(link => {
    // Prevent duplicates if function runs multiple times
    if (link.querySelector('.focus-eye-btn')) return;

    const rawHref = link.getAttribute('href');
    const uuid = extractUUID(rawHref);
    if (!uuid) return;

    const containers = link.querySelectorAll('.flex.items-center.space-x-2');
    const rightContainer = containers[containers.length - 1];
    if (!rightContainer) return;

    const btn = document.createElement('button');
    btn.className = 'focus-eye-btn';
    btn.type = 'button';
    btn.title = 'Focus this site';

    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined';
    icon.textContent = 'visibility';
    icon.style.fontSize = '18px';
    icon.style.fontVariationSettings = "'FILL' 1";
    icon.style.color = '#b66797';
    icon.style.transition = 'color 0.2s ease';
    icon.style.lineHeight = '1';
    icon.style.display = 'block';
    icon.style.width = '18px';
    icon.style.overflow = 'hidden';
    icon.style.visibility = 'hidden';
    document.fonts.ready.then(() => { icon.style.visibility = 'visible'; });
    btn.appendChild(icon);

    btn.style.marginLeft = '6px';
    btn.style.cursor = 'pointer';
    btn.style.background = 'transparent';
    btn.style.border = 'none';
    btn.style.padding = '0';
    btn.style.position = 'relative';

    // Invisible expanded click area
    const hitArea = document.createElement('span');
    hitArea.style.position = 'absolute';
    hitArea.style.inset = '-6px';
    btn.appendChild(hitArea);
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';

    btn.addEventListener('mouseenter', () => { icon.style.color = 'hotpink'; });
    btn.addEventListener('mouseleave', () => { icon.style.color = '#b66797'; });

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const url = new URL(window.location.href);
      url.searchParams.set('focus', uuid);

      // Reload page with focus param
      window.location.href = url.toString();
    });

    rightContainer.appendChild(btn);
  });
}
