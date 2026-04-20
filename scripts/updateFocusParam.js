export function updateFocusParam(param) {
  // Define mapping of parameter values to focus IDs
  const focusMap = {
    opus: "1dc4ca0e-b403-4522-806b-0b0641db07f7",
    seeds: "e45b2b45-7fd9-4e4a-929a-72a99d97c843",
    opus_ltd: "f60ad434-002b-4bf1-8c34-3c1507d20704"
  };

  // Only proceed if the given parameter has a matching focus value
  if (!focusMap[param]) return;

  // Create a URL object from the current page URL
  const url = new URL(window.location.href);

  // Update (or add) the ?focus parameter
  url.searchParams.set("focus", focusMap[param]);

  window.history.replaceState({}, "", url);
  window.location.reload();
}
