export async function copyEmailFromEmailIframe() {
    try {
        const iframe = document.querySelector('div[style*="z-index: 8000"] iframe');
        if (!iframe) {
            alert("No email preview found to copy.");
            return;
        }

        const html = iframe.contentDocument.documentElement.outerHTML;
        const plainText = iframe.contentDocument.body.innerText;

        await navigator.clipboard.write([
            new ClipboardItem({
                "text/html": new Blob([html], { type: "text/html" }),
                "text/plain": new Blob([plainText], { type: "text/plain" }),
            })
        ]);

        alert("Registration email copied to clipboard!");
    } catch (err) {
        alert("Failed to copy rich text: " + err);
    }
    window.location.href = window.location.href = window.location.origin + window.location.pathname;
}
