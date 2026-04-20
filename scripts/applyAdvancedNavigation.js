export function applyAdvancedNavigation() {
    const tree = document.querySelector('ol[data-component="sites/select_tree"]');
    if (!tree) return; // If the ol isn't found, do nothing

    tree.addEventListener('click', (event) => {
        const link = event.target.closest('a[href]');
        if (!link || !tree.contains(link)) return; // Not an <a> or outside the <ol>

        // Always prevent default to handle navigation manually
        event.preventDefault();

        chrome.storage.local.get('moreButtonsAdvancedNavigation', (result) => {
            const config = result.moreButtonsAdvancedNavigation;
            if (!config) {
                console.log('MB Log: AdvancedNavigation config missing. Proceed');
                // Fallback: open original URL, open in new tab if modifier pressed
                if (event.ctrlKey || event.metaKey || event.shiftKey) {
                    window.open(link.href, '_blank');
                } else {
                    window.location.href = link.href;
                }
                return;
            }

            const { manageModeEnabled, mode, parameter } = config;
            const urlObj = new URL(link.href); // Parse URL

            // Apply manage mode prefix first if enabled
            if (manageModeEnabled === true) {
                console.log("manage mode is true");
                urlObj.pathname = '/admin' + urlObj.pathname;
            }

            // Then handle mode-based modifications
            if (mode === 'prefix') {
                urlObj.pathname = parameter + urlObj.pathname;
            } else if (mode === 'suffix') {
                urlObj.pathname = urlObj.pathname + parameter;
            } else if (mode === 'regex') {
                const parts = parameter.split('|');
                if (parts.length >= 1) {
                    try {
                        const regex = new RegExp(parts[0]);
                        const replacement = parts[1] || '';
                        urlObj.pathname = urlObj.pathname.replace(regex, replacement);
                    } catch (e) {
                        console.warn('Invalid regex:', e);
                        // On error fallback
                        if (event.ctrlKey || event.metaKey || event.shiftKey) {
                            window.open(link.href, '_blank');
                        } else {
                            window.location.href = link.href;
                        }
                        return;
                    }
                } else {
                    console.warn('Invalid regex parameter format.');
                    if (event.ctrlKey || event.metaKey || event.shiftKey) {
                        window.open(link.href, '_blank');
                    } else {
                        window.location.href = link.href;
                    }
                    return;
                }
            } else if (mode !== undefined) {
                // Unknown mode: fallback
                if (event.ctrlKey || event.metaKey || event.shiftKey) {
                    window.open(link.href, '_blank');
                } else {
                    window.location.href = link.href;
                }
                return;
            }

            const modifiedUrl = urlObj.toString();

            // Open in new tab if modifier keys pressed, else same tab
            if (event.ctrlKey || event.metaKey || event.shiftKey) {
                window.open(modifiedUrl, '_blank');
            } else {
                window.location.href = modifiedUrl;
            }
        });
    });
}
