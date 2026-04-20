import { createForm } from './form.js';

export function applyReportTypePreset() {

    const proceed = window.confirm(
        "This will modify the installed report types based on your preset configuration. Please make sure your preset is setup correctly. Do you wish to continue?"
    );

    if (!proceed) {
        console.log("Operation cancelled by user.");
        return;
    }

    chrome.storage.local.get('moreButtonsReportTypesPreset', async (result) => {

        const preset = result.moreButtonsReportTypesPreset || {};
        if (!Object.keys(preset).length) return;

        const installValues = Array.isArray(preset['report-types-install-list'])
            ? preset['report-types-install-list']
            : [];

        const uninstallValues = Array.isArray(preset['report-types-uninstall-list'])
            ? preset['report-types-uninstall-list']
            : [];

        let missingElements = [];

        // ---------------------------
        // VALIDATION PASS
        // ---------------------------

        const pageRows = Array.from(document.querySelectorAll('table tbody tr'));
        const pageKeyMap = new Map();
        pageRows.forEach(row => {
            const keyEl = row.querySelector('td code');
            const checkbox = row.querySelector('input[type="checkbox"][name="report_type_packages[]"]');
            if (keyEl && checkbox) pageKeyMap.set(keyEl.textContent.trim(), checkbox);
        });

        [...installValues.map(k => ({ key: k, type: 'install' })),
         ...uninstallValues.map(k => ({ key: k, type: 'uninstall' }))
        ].forEach(({ key, type }) => {
            if (!pageKeyMap.has(key)) {
                missingElements.push(`Report Type ${type} (key="${key}")`);
            }
        });

        if (missingElements.length) {
            console.warn('[Preset Warning] Missing report type keys:', missingElements.join('; '));

            const { content } = await createForm("errorPresetFieldsMissing");
            const list = content.querySelector('#missing-elements-list');
            if (list) list.textContent = missingElements.join('; ');

            return;
        }

        // ---------------------------
        // APPLY VALUES
        // ---------------------------

        installValues.forEach(key => {
            const checkbox = pageKeyMap.get(key);
            if (checkbox) {
                checkbox.checked = true;
                checkbox.dispatchEvent(new Event("change", { bubbles: true }));
            }
        });

        uninstallValues.forEach(key => {
            const checkbox = pageKeyMap.get(key);
            if (checkbox) {
                checkbox.checked = false;
                checkbox.dispatchEvent(new Event("change", { bubbles: true }));
            }
        });

        // ---------------------------
        // SUBMIT (from uninstall function)
        // ---------------------------

        const submitButton = document.querySelector(
            'button[type="submit"].button.--primary'
        );

        if (submitButton) {
            submitButton.click();
            console.log("Preset applied and form submitted.");
        } else {
            console.warn("Checkboxes updated, but submit button was not found.");
        }
    });
}
