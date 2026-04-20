export function questionSectionToggle() {
  const buttons = document.querySelectorAll('button[data-collapse-target="trigger"]');
  if (!buttons.length) return;

  // Determine if we should expand or collapse all
  // If ANY button is collapsed, expand all; otherwise collapse all
  const shouldExpand = Array.from(buttons).some(
    btn => btn.getAttribute('aria-expanded') === 'false'
  );

  buttons.forEach(btn => {
    const isExpanded = btn.getAttribute('aria-expanded') === 'true';
    if (shouldExpand && !isExpanded) {
      // Expand this one
      btn.click();
    } else if (!shouldExpand && isExpanded) {
      // Collapse this one
      btn.click();
    }
  });
}
