export function toggleMoreButtonsActive() {
  chrome.storage.local.get("moreButtonsActive", (data) => {
    const currentlyActive = data.moreButtonsActive !== false;
    if (currentlyActive) {
      chrome.storage.local.set({ moreButtonsActive: false });
    } else {
      chrome.storage.local.remove("moreButtonsActive");
    }
  });
}
