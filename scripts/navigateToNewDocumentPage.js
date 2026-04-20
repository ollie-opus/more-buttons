export function navigateToNewDocumentPage(type) {
    const sitePath = window.location.pathname;
    const match = sitePath.match(/\/sites\/([a-f0-9\-]{36})/); // Regex to match the UUID format

    if (match) {
        const siteuuid = match[1]; // UUID is captured in the first group
        let documentPageUrl;

        if (type === 'employee') {
            documentPageUrl = `${window.location.origin}/admin/sites/${siteuuid}/templates/documents/new?data_type=pdf&filter_type=employee_role&more_buttons_automation_7dca63d3`;
        } else if (type === 'asset') {
            documentPageUrl = `${window.location.origin}/admin/sites/${siteuuid}/templates/documents/new?data_type=pdf&filter_type=asset_role&more_buttons_automation_c6e56e7f`;
        } else {
            alert("Invalid document page type specified.");
            return;
        }

        window.location.href = documentPageUrl;
    } else {
        alert("Could not find site UUID in the URL.");
    }
}
