import { createForm } from './form.js';

export async function initSiteQRPosterGeneration(mode) {
    // Check stored settings exist before proceeding
    const result = await chrome.storage.local.get("moreButtonsCustomQRPoster");
    const config = result.moreButtonsCustomQRPoster;
    if (!config || !config["preset"] || !config["poster-title"]) {
        await createForm("errorNoQRSettings");
        return;
    }

    let siteQRConfirmAction = confirm("Are you sure you want to create a new QR code/poster?\nPlease also test to see if the generated QR code/poster works before sharing.");
    if (!siteQRConfirmAction) return;

    if (mode === "customQRPoster") {
        sessionStorage.setItem("triggerQRExport", "customQRPoster");
    }
    let sitePath = window.location.pathname;
    let match = sitePath.match(/\/sites\/([a-f0-9\-]{36})/); // Regex to match the UUID format
    if (match) {
        let siteuuid = match[1]; // UUID is captured in the first group
        let qrPageUrl = window.location.origin + '/admin/sites/' + siteuuid + '/qrs/new?more_buttons_automation_3ee255f7';
        window.location.href = qrPageUrl;
    } else {
        alert("Could not find site UUID in the URL.");
    }
}
