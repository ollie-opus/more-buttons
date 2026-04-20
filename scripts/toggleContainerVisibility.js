export function toggleContainerVisibility(id) {
  const el = document.getElementById(id);
  el?.__mbToggleVisibility?.();
}
