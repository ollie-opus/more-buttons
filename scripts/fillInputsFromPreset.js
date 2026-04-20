import { createForm } from './form.js';

export function fillInputsFromPreset() {
    const config = [
        { key: 'name', selector: ['#site_employee_name', '#site_name', '#site_asset_name', '#asset_name', '#employee_name'] },
        { key: 'archived', selector: null }, // special handling below (archive radios as primary selector. end day as secondary selector)
        { key: 'role', selector: '#more-buttons-role' }, // special handling below (checkbox value as selector)
        { key: 'location', selector: '#more-buttons-location' } // special handling below (radio id as selector)
    ];

    chrome.storage.local.get('moreButtonsSitePreset', async (result) => {
        const preset = result.moreButtonsSitePreset || {};
        if (!Object.keys(preset).length) return; // nothing saved

        // First pass: validate all keys
        let missingElements = [];

        for (const { key, selector } of config) {
            if (!(key in preset)) continue;

            if (key === 'archived') {
                const archivedValue = preset.archived;
                if (!archivedValue) continue;

                const inputYes = document.getElementById('asset_archived_at_archived_now');
                const inputNo = document.getElementById('asset_archived_at_not');
                const endDateInput = document.getElementById('site_employee_end_date');

                if (archivedValue === 'yes') {
                    if (!inputYes && !(endDateInput && endDateInput.type === 'date')) {
                        missingElements.push('Archived (expected #asset_archived_at_archived_now or #site_employee_end_date)');
                    }
                }

                if (archivedValue === 'no') {
                    if (!inputNo && !(endDateInput && endDateInput.type === 'date')) {
                        missingElements.push('Archived (expected #asset_archived_at_not or #site_employee_end_date)');
                    }
                }
                continue;
            }

            if (key === 'role') {
                if (!preset.role) continue;
                const roleTags = preset.role.split('&').map(tag => tag.trim()).filter(Boolean);

                const foundAny = roleTags.some(tagValue => !!document.querySelector(`input[type="checkbox"][value="${tagValue}"]`));
                if (!foundAny) {
                    missingElements.push('Role (checkboxes for preset tags)');
                }
                continue;
            }

            if (key === 'location') {
                if (!preset.location) continue;
                const radio = document.getElementById(preset.location);
                if (!radio || radio.type !== 'radio') {
                    missingElements.push(`Location (radio with id "${preset.location}")`);
                }
                continue;
            }

            // Generic inputs with multiple selector OR
            const selectors = Array.isArray(selector) ? selector : [selector];
            const foundInput = selectors.some(sel => !!document.querySelector(sel));
            if (!foundInput) {
                missingElements.push(`${key} (selectors: ${selectors.join(', ')})`);
            }
        }

        if (missingElements.length) {
            console.warn('[Preset Warning] Missing elements for keys:', missingElements.join('; '));

            const { content } = await createForm("errorPresetFieldsMissing");
            const list = content.querySelector('#missing-elements-list');
            if (list) list.textContent = missingElements.join('; ');

            return; // Stop entire function
        }

        // Second pass: apply values since all elements validated
        for (const { key, selector, transform } of config) {
            if (!(key in preset)) continue;

            if (key === 'archived') {
                const archivedValue = preset.archived;
                const inputYes = document.getElementById('asset_archived_at_archived_now');
                const inputNo = document.getElementById('asset_archived_at_not');
                const endDateInput = document.getElementById('site_employee_end_date');

                if (archivedValue === 'yes') {
                    if (inputYes) {
                        inputYes.checked = true;
                    } else if (endDateInput && endDateInput.type === 'date') {
                        const yesterday = new Date();
                        yesterday.setDate(yesterday.getDate() - 1);
                        const yyyy = yesterday.getFullYear();
                        const mm = String(yesterday.getMonth() + 1).padStart(2, '0');
                        const dd = String(yesterday.getDate()).padStart(2, '0');
                        endDateInput.value = `${yyyy}-${mm}-${dd}`;
                    }
                } else if (archivedValue === 'no') {
                    if (inputNo) {
                        inputNo.checked = true;
                    } else if (endDateInput && endDateInput.type === 'date') {
                        endDateInput.value = '';
                    }
                }
                continue;
            }

            if (key === 'role') {
                const roleTags = preset.role.split('&').map(tag => tag.trim()).filter(Boolean);
                roleTags.forEach(tagValue => {
                    const checkbox = document.querySelector(`input[type="checkbox"][value="${tagValue}"]`);
                    if (checkbox) {
                        checkbox.checked = true;
                    }
                });
                continue;
            }

            if (key === 'location') {
                const radio = document.getElementById(preset.location);
                if (radio && radio.type === 'radio') {
                    radio.checked = true;
                }
                continue;
            }

            // Generic input handling
            const selectors = Array.isArray(selector) ? selector : [selector];
            let input = null;
            for (const sel of selectors) {
                input = document.querySelector(sel);
                if (input) break;
            }
            if (!input) continue;

            let value = preset[key];
            if (transform) {
                value = transform(value, input);
            }

            if ('value' in input && value) {
                input.value = value;
            }
        }

        // Submit form after all values are applied
        const submitEditPage = document.querySelector('form[data-controller="site-form form"]');
        const submitNewPage = document.querySelector('form[data-controller="form"]');

        const submitForm = submitEditPage || submitNewPage;
        if (submitForm) {
            submitForm.requestSubmit();
        }
    });
}
