function navigateToRolePage(type) {
    const sitePath = window.location.pathname;
    const match = sitePath.match(/\/sites\/([a-f0-9\-]{36})/); // Regex to match the UUID format

    if (match) {
        const siteuuid = match[1]; // UUID is captured in the first group
        let rolePageUrl;

        if (type === 'employee') {
            rolePageUrl = `${window.location.origin}/admin/sites/${siteuuid}/employees/roles`;
        } else if (type === 'asset') {
            rolePageUrl = `${window.location.origin}/admin/sites/${siteuuid}/equipments/asset-types`;
        } else {
            alert("Invalid role page type specified.");
            return;
        }

        window.location.href = rolePageUrl;
    } else {
        alert("Could not find site UUID in the URL.");
    }
}

export function copyRoleCheckboxValue(type) {
    const checkboxes = document.querySelectorAll('input[name*="[roles]"]');
    let tsv = 'role_name\trole_tag\n'; // TSV header

    checkboxes.forEach(checkbox => {
        const id = checkbox.id;
        const label = document.querySelector(`label[for="${id}"]`);

        if (label) {
            let labelText = label.textContent.trim().replace(/"/g, '""');

            // Add apostrophe if label starts with a "+"
            if (labelText.startsWith('+')) {
                labelText = `'${labelText}`;
            }

            const valueText = checkbox.value.replace(/"/g, '""');
            tsv += `"${labelText}"\t"${valueText}"\n`;
        }
    });

    // Copy to clipboard
    navigator.clipboard.writeText(tsv)
        .then(() => alert('Data copied to clipboard!'))
        .catch(err => console.error('Failed to copy data:', err));

    navigateToRolePage(type);
}
