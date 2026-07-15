export function smartDocumentSubmit() {
  // 1. Work out the filename.
  //
  // Two flows are possible:
  //   (a) A file was just picked but not yet uploaded — there is a live
  //       <input type="file"> carrying a File in `.files`.
  //   (b) Active Storage direct upload already completed — the visible file
  //       input has been swapped for a hidden signed_id input, and the name
  //       now lives only in the preview label/anchor.
  const filename = getSelectedFilename();

  if (!filename) {
    console.error('smartDocumentSubmit: Could not determine the uploaded file name (no picked file and no preview anchor).');
    alert('Error: Could not find the uploaded file on this page.\n\nPick a file (or wait for the upload to finish) and try again.');
    return;
  }

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
  const form = dateInput.closest('form');

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

// Resolve the name of the file the user is submitting, handling both a
// freshly-picked (not-yet-uploaded) file and an already-direct-uploaded one.
function getSelectedFilename() {
  // (a) Freshly-picked file still sitting in a live <input type="file">.
  const fileInput = document.querySelector('input[type="file"][name="measurement[measurement_value][file]"]')
    || document.querySelector('input[type="file"]#measurement_measurement_value_file')
    || document.querySelector('input[type="file"][data-file-direct-upload-target="input"]');

  if (fileInput && fileInput.files && fileInput.files.length > 0) {
    return fileInput.files[0].name;
  }

  // (b) Direct upload already completed — read the name from the preview anchor.
  const anchor = document.querySelector(
    '[data-file-preview-target="label"] a, label[for="measurement_measurement_value_file"] a'
  );
  if (anchor) {
    const text = anchor.textContent && anchor.textContent.trim();
    if (text) return text;
    if (anchor.href) {
      try {
        const fromHref = new URL(anchor.href).searchParams.get('filename');
        if (fromHref) return decodeURIComponent(fromHref);
      } catch (_) { /* malformed href — fall through */ }
    }
  }

  return null;
}
