const AUTOMATION_BY_MODE = {
  user: 'more_buttons_automation_35c0f382',
  manager: 'more_buttons_automation_3cf47076',
  admin: 'more_buttons_automation_7e95d97e',
  seed: 'more_buttons_automation_70d24924'
};

export function navigateToEmployeePageForRegEmail(mode = 'user') {
  const automation = AUTOMATION_BY_MODE[mode];
  if (!automation) return;

  const currentUrl = window.location.href.split('?')[0];
  const baseUrl = currentUrl.split('/link')[0];

  // Grab the button and its link URL from the data attribute
  const button = document.querySelector('button[data-copy-clipboard-value]');
  const linkURL = button ? button.dataset.copyClipboardValue : '';

  const sourceUrl = currentUrl;
  const encodedSourceUrl = encodeURIComponent(sourceUrl);
  const encodedLinkURL = encodeURIComponent(linkURL);

  window.location.href = `${baseUrl}?source_url=${encodedSourceUrl}&link_url=${encodedLinkURL}&${automation}`;
}
