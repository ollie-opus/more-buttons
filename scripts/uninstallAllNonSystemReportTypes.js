export function uninstallAllNonSystemReportTypes() {
  const proceed = window.confirm(
    "This will uninstall all non-system required report types from this site. This is not reversible. Do you wish to continue?"
  );

  if (!proceed) {
    console.log("Operation cancelled by user.");
    return;
  }

  const allowedExact = new Set([
    "other",
    "triggered_corrective_action",
  ]);

  const allowedPrefixes = [
    "system.",
  ];

  const rows = document.querySelectorAll("table tbody tr");

  rows.forEach(row => {
    const keyEl = row.querySelector("td code");
    const checkbox = row.querySelector(
      'input[type="checkbox"][name="report_type_packages[]"]'
    );

    if (!keyEl || !checkbox) return;

    const key = keyEl.textContent.trim();

    const isAllowed =
      allowedExact.has(key) ||
      allowedPrefixes.some(prefix => key.startsWith(prefix));

    if (!isAllowed) {
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });

  const submitButton = document.querySelector(
    'button[type="submit"].button.--primary'
  );

  if (submitButton) {
    submitButton.click();
    console.log("Uninstalled non-system report types and submitted the form.");
  } else {
    console.warn("Checkboxes updated, but submit button was not found.");
  }
}
