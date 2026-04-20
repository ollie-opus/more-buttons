export function navigateToEmployeePageForRegEmail(mode = 'default') {
  const currentUrl = window.location.href.split('?')[0];
  const baseUrl = currentUrl.split('/link')[0];

  // Grab the button and its link URL from the data attribute
  const button = document.querySelector('button[data-copy-clipboard-value]');
  const linkURL = button ? button.dataset.copyClipboardValue : '';

  const sourceUrl = currentUrl;
  const encodedSourceUrl = encodeURIComponent(sourceUrl);
  const encodedLinkURL = encodeURIComponent(linkURL);

  if (mode === 'seed') {
    const finalUrl = `${baseUrl}?source_url=${encodedSourceUrl}&link_url=${encodedLinkURL}&more_buttons_automation_70d24924`;
    window.location.href = finalUrl;
  }
  else if (mode === 'default') {
    const finalUrl = `${baseUrl}?source_url=${encodedSourceUrl}&link_url=${encodedLinkURL}&more_buttons_automation_35c0f382`;
    window.location.href = finalUrl;
  }
}
