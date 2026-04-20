export function setAccess(value) {
    const allowedValues = ["administrator", "manager", "user", ""];

    if (!allowedValues.includes(value)) {
        console.warn(`Invalid value "${value}". Allowed values are: ${allowedValues.join(", ")}`);
        return;
    }

    const selectElement = document.querySelector('.site-index_site.--focus.--summary .form-input.form-select');

    if (!selectElement) {
        console.warn('No <select> element found with class ".form-input.form-select".');
        return;
    }

    // Set value and trigger change event
    selectElement.value = value;
    selectElement.dispatchEvent(new Event('change', { bubbles: true }));

    // Some access levels have an associated checkbox that must also be checked
    const checkboxIds = {
        administrator: 'employee-record-access-administrator',
        manager: 'employee-record-access-manager',
    };

    const checkboxId = checkboxIds[value];
    if (checkboxId) {
        const checkbox = document.getElementById(checkboxId);
        if (checkbox) checkbox.checked = true;
    }

    const submit = document.querySelector('form[data-controller="employees--site-access"]');
    submit.requestSubmit(); // Submit the form programmatically
}
