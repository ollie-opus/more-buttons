export function smartDocumentSubmit() {
  // 1. Grab the file input
  const fileInput = document.querySelector(
    'input[type="file"][name="measurement[measurement_value][file]"]'
  );

  if (!fileInput) {
    console.error('smartDocumentSubmit: Could not find the file input "measurement[measurement_value][file]".');
    alert('Error: Could not find the file upload input on this page.');
    return;
  }

  if (!fileInput.files || fileInput.files.length === 0) {
    console.error('smartDocumentSubmit: No file selected. Choose a file first, then call smartDocumentSubmit().');
    alert('Please select a file before running smartDocumentSubmit.');
    return;
  }

  const file = fileInput.files[0];
  const filename = file.name;
  console.log('smartDocumentSubmit: Using filename:', filename);

  // 2. Extract document_date from filename: _document_date_dd-mm-yyyy_
  const dateMatch = filename.match(/_document_date_([0-9]{2}-[0-9]{2}-[0-9]{4})_/);

  if (!dateMatch) {
    console.error('smartDocumentSubmit: Could not find _document_date_dd-mm-yyyy_ in the filename.');
    alert(
      'No document date metadata found in the filename.\n\n' +
      'Expected something like:\n' +
      '  opus_metadata={_document_date_13-05-2025_,...}'
    );
    return;
  }

  const documentDateStr = dateMatch[1]; // e.g. "13-05-2025"
  const [dd, mm, yyyy] = documentDateStr.split('-');

  if (!dd || !mm || !yyyy) {
    console.error('smartDocumentSubmit: Parsed document date is invalid:', documentDateStr);
    alert(
      'The document date metadata in the filename is invalid:\n' +
      `  "${documentDateStr}"\n\n` +
      'Expected format: dd-mm-yyyy (e.g. 13-05-2025).'
    );
    return;
  }

  // Convert to yyyy-mm-dd for <input type="date">
  const isoDate = `${yyyy}-${mm}-${dd}`;
  console.log('smartDocumentSubmit: Setting document date to:', isoDate);

  // 3. Fill the "Date of document (authoring date)" field
  const dateInput = document.querySelector(
    'input[type="date"][name="measurement[last_submission_at]"]'
  );

  if (!dateInput) {
    console.error('smartDocumentSubmit: Could not find the date input "measurement[last_submission_at]".');
    alert('Error: Could not find the "Date of document" input on this page.');
    return;
  }

  dateInput.value = isoDate;
  dateInput.dispatchEvent(new Event('input', { bubbles: true }));
  dateInput.dispatchEvent(new Event('change', { bubbles: true }));

  // 4. Submit the form using the real submit button if possible
  const form = dateInput.closest('form') || fileInput.closest('form');

  if (!form) {
    console.error('smartDocumentSubmit: Could not find a parent <form> to submit.');
    alert('Error: Could not locate the form to submit.');
    return;
  }

  const submitButton = form.querySelector('button[type="submit"], input[type="submit"]');

  if (submitButton) {
    console.log('smartDocumentSubmit: Clicking the form submit button...');
    submitButton.click();
  } else if (form.requestSubmit) {
    console.log('smartDocumentSubmit: Using form.requestSubmit()...');
    form.requestSubmit();
  } else {
    console.log('smartDocumentSubmit: Falling back to form.submit() (may show "You are being redirected.").');
    form.submit();
  }
}
