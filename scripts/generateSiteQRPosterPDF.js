export async function generateSiteQRPosterPDF() {
    const trigger = sessionStorage.getItem("triggerQRExport");
    const allowed = ["customQRPoster"];
    if (!allowed.includes(trigger)) return;

    const { jsPDF } = window.jspdf;

    function scrapeSiteName() {
        const element = document.querySelector(".site-select__current-label");
        return element ? element.textContent.trim() : "Unknown Site";
    }

    async function loadFont(url) {
        const response = await fetch(url);
        const fontBlob = await response.blob();
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result.split(",")[1]);
            reader.readAsDataURL(fontBlob);
        });
    }

    async function generatePDF(qrPngDataUrl, options = {}) {
        const doc = new jsPDF();

        // ── PDF layout (all values in mm, A4 = 210 x 297) ──
        const layout = {
            textColor:       "#002e72",

            // Background template image
            template:        { x: 0, y: 0, w: 210, h: 297 },

            // QR code image
            qr:              { x: 57.5, y: 101, w: 95, h: 95 },

            // Site name (shown on all poster types)
            siteName:        { x: 105, y: 88, fontSize: 20 },

            // Custom poster only
            title:           { x: 105, y: 75, fontSize: 50 },
            description:     { x: 105, y: 210, fontSize: 16, maxWidth: 110 },
        };

        const fontUrl = "https://raw.githubusercontent.com/ollie-opus/more-buttons/main/resources/Outfit-Bold.ttf";

        const templateImg = "https://raw.githubusercontent.com/ollie-opus/more-buttons/main/resources/customqrtemplate.png";

        const siteName = scrapeSiteName();

        try {
            const fontBase64 = await loadFont(fontUrl);
            doc.addFileToVFS("Outfit-Bold.ttf", fontBase64);
            doc.addFont("Outfit-Bold.ttf", "Outfit", "bold");
            doc.setFont("Outfit", "bold");

            doc.addImage(templateImg, "PNG", layout.template.x, layout.template.y, layout.template.w, layout.template.h);
            doc.addImage(qrPngDataUrl, "PNG", layout.qr.x, layout.qr.y, layout.qr.w, layout.qr.h);

            doc.setTextColor(layout.textColor);

            doc.setFontSize(layout.title.fontSize);
            doc.text(options.title || "QR Poster", layout.title.x, layout.title.y, { align: "center" });

            doc.setFontSize(layout.siteName.fontSize);
            doc.text(siteName, layout.siteName.x, layout.siteName.y, { align: "center" });

            if (options.description) {
                doc.setFontSize(layout.description.fontSize);
                const descLines = doc.splitTextToSize(options.description, layout.description.maxWidth);
                doc.text(descLines, layout.description.x, layout.description.y, { align: "center" });
            }

            doc.save(`${siteName} ${options.title || "QR"} QR Poster.pdf`);
        } catch (error) {
            console.error("Failed to load font or generate PDF:", error);
        }
    }

    if (sessionStorage.getItem("triggerQRExport") === "customQRPoster") {
        sessionStorage.removeItem("triggerQRExport");
        try {
            // 1. Get config from storage
            const result = await chrome.storage.local.get("moreButtonsCustomQRPoster");
            const config = result.moreButtonsCustomQRPoster || {};
            const posterTitle = config["poster-title"] || "QR Poster";
            const page = config["page"] || "default";
            const reportKeyFilter = config["report-key-filter"] || "";

            // 2. Build QR URL from current page
            // Current URL format: /admin/sites/{siteUuid}/qrs/{qrUuid}
            const currentUrl = new URL(window.location.href);
            const siteUuidMatch = currentUrl.pathname.match(/\/sites\/([a-f0-9-]{36})/);
            const qrUuidMatch = currentUrl.pathname.match(/\/qrs\/([a-f0-9-]{36})/);
            const siteUuid = siteUuidMatch ? siteUuidMatch[1] : '';
            const qrUuid = qrUuidMatch ? qrUuidMatch[1] : '';

            let qrUrl;

            if (page === "new") {
                // "new" uses the /qrs/ path: /qrs/{qrUuid}/new?site_qr={qrUuid}&filter={filter}
                qrUrl = `${currentUrl.origin}/qrs/${qrUuid}/new?site_qr=${qrUuid}`;
                if (reportKeyFilter) {
                    qrUrl += `&filter=${reportKeyFilter}`;
                }
            } else if (page !== "default") {
                // Other pages use the /sites/ path: /sites/{siteUuid}/{page}?site_qr={qrUuid}
                qrUrl = `${currentUrl.origin}/sites/${siteUuid}/${page}?site_qr=${qrUuid}`;
            } else {
                // Default: just the base QR URL
                qrUrl = `${currentUrl.origin}/qrs/${qrUuid}`;
            }

            console.log("customQRPoster: QR URL =", qrUrl);

            // 3. Generate QR code via canvas using qrcode-generator
            const qr = qrcode(0, 'Q');
            qr.addData(qrUrl);
            qr.make();

            const moduleCount = qr.getModuleCount();
            const cellSize = Math.floor(1000 / moduleCount);
            const size = moduleCount * cellSize;

            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = false;

            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, size, size);

            for (let row = 0; row < moduleCount; row++) {
                for (let col = 0; col < moduleCount; col++) {
                    if (qr.isDark(row, col)) {
                        ctx.fillStyle = '#000000';
                        ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
                    }
                }
            }

            // 4. Output based on preset
            if (config["preset"] === "raw-qr") {
                const format = config["format"] || "png";
                const padding = 25;

                if (format === "svg") {
                    // Build SVG string with white background + padding
                    const padUnits = 1;
                    const total = moduleCount + padUnits * 2;
                    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size + padding * 2}" height="${size + padding * 2}" shape-rendering="crispEdges">`;
                    svg += `<rect width="100%" height="100%" fill="white"/>`;
                    for (let row = 0; row < moduleCount; row++) {
                        for (let col = 0; col < moduleCount; col++) {
                            if (qr.isDark(row, col)) {
                                svg += `<rect x="${col + padUnits}" y="${row + padUnits}" width="1" height="1" fill="black"/>`;
                            }
                        }
                    }
                    svg += `</svg>`;

                    const blob = new Blob([svg], { type: 'image/svg+xml' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `${scrapeSiteName()} ${posterTitle} QR Code.svg`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                } else {
                    // PNG with white background + padding
                    const paddedCanvas = document.createElement('canvas');
                    paddedCanvas.width = size + padding * 2;
                    paddedCanvas.height = size + padding * 2;
                    const paddedCtx = paddedCanvas.getContext('2d');
                    paddedCtx.imageSmoothingEnabled = false;
                    paddedCtx.fillStyle = '#ffffff';
                    paddedCtx.fillRect(0, 0, paddedCanvas.width, paddedCanvas.height);
                    paddedCtx.drawImage(canvas, padding, padding);

                    const finalDataUrl = paddedCanvas.toDataURL('image/png');
                    const link = document.createElement('a');
                    link.href = finalDataUrl;
                    link.download = `${scrapeSiteName()} ${posterTitle} QR Code.png`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                }
            } else {
                const qrPngDataUrl = canvas.toDataURL('image/png');
                const posterDescription = config["poster-description"] || "";
                await generatePDF(qrPngDataUrl, {
                    title: posterTitle,
                    description: posterDescription
                });
            }
        } catch (error) {
            console.error("Error generating custom QR Poster PDF:", error);
        }
    }
}
