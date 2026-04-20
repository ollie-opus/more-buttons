export async function createSiteQRCode() {
    let qrName = '';

    if (sessionStorage.getItem("triggerQRExport") === "customQRPoster") {
        const result = await chrome.storage.local.get("moreButtonsCustomQRPoster");
        const config = result.moreButtonsCustomQRPoster || {};
        const posterTitle = config["poster-title"] || "Custom";
        if (config["preset"] === "raw-qr") {
            const format = config["format"] || "png";
            qrName = `${posterTitle} QR Code.${format} (made via automation)`;
        } else {
            qrName = `${posterTitle} QR Poster.pdf (made via automation)`;
        }
    }

    if (qrName === '') {
        sessionStorage.removeItem("triggerQRExport");
        console.error("MB Error: createSiteQRCode - No valid QR trigger found in sessionStorage.");
        return;
    }

    setTimeout(() => {
        const inputSiteQRNameField = document.getElementById('site_qr_name');
        if (inputSiteQRNameField) {
            inputSiteQRNameField.value = qrName;
        }
        const submit = document.querySelector('form[data-controller="form"]');
        if (submit) {
            submit.requestSubmit();
        }
    }, 500);
}
