export function runAutomations(filteredAutomations, dispatchFn) {
  filteredAutomations.forEach(auto => dispatchFn(auto.action));
}
