// Form validation: decision logic + DOM wiring for the overlay forms.
//
// The *decision* half (what counts as invalid, and the message a user reads)
// is kept DOM-free in `fieldError` so it can be unit-tested in the repo's
// no-jsdom style (tests/formValidation.test.mjs). The DOM half — querying the
// live fields, painting the `--invalid` state, wiring aria, choosing the field
// to scroll to — lives here too but mirrors the untested createForm glue and is
// verified by hand. form.js calls `markRequiredFields` once at setup and
// `validateFields` on every guarded commit.

/**
 * Pure: given a normalised field descriptor, decide whether it's invalid and
 * what to tell the user. Empty-ness is precomputed by the caller (radio groups
 * and text inputs report emptiness differently).
 *
 * @param {{required?: boolean, empty?: boolean, value?: string|null,
 *          maxlength?: number|null}} field
 * @returns {null | { reason: 'required'|'maxlength', message: string }}
 */
export function fieldError(field) {
  if (field.required && field.empty) {
    return { reason: 'required', message: 'This field is required.' };
  }
  if (
    field.maxlength != null &&
    field.value != null &&
    field.value.length > field.maxlength
  ) {
    return {
      reason: 'maxlength',
      message: `Keep this to ${field.maxlength} characters or fewer.`,
    };
  }
  return null;
}

const GROUP = '.more-buttons-form-group';
const RADIO_GROUP =
  '.more-buttons-radio-group-row, .more-buttons-radio-group-column, ' +
  '.more-buttons-radio-btn-group-row, .more-buttons-radio-btn-group-column';

/**
 * Walk the form once and flag every group that owns a `[required]` control with
 * a visible `*` marker on its label. Idempotent: safe to call after re-renders.
 * The `required` attribute itself carries the semantics to assistive tech, so
 * the marker is `aria-hidden`.
 */
export function markRequiredFields(formEl) {
  if (!formEl) return;
  formEl.querySelectorAll(GROUP).forEach((group) => {
    const hasRequired = !!group.querySelector('[required]');
    const label = group.querySelector('.more-buttons-label');
    if (!label) return;
    const marked = label.querySelector('.more-buttons-required-mark');
    if (hasRequired && !marked) {
      const star = formEl.ownerDocument.createElement('span');
      star.className = 'more-buttons-required-mark';
      star.setAttribute('aria-hidden', 'true');
      star.textContent = '*';
      label.appendChild(star);
    } else if (!hasRequired && marked) {
      marked.remove();
    }
  });
}

// The error nodes / aria we add on a failed submit, cleared before each run.
function clearErrors(formEl) {
  formEl.querySelectorAll('.--invalid').forEach((el) => {
    // Leave the live maxlength counter's own `--invalid` alone — it re-asserts
    // on input; we only strip the submit-time error wiring.
    el.classList.remove('--invalid');
    el.removeAttribute('aria-invalid');
  });
  formEl
    .querySelectorAll('.more-buttons-field-error')
    .forEach((el) => el.remove());
}

function ensureMessage(formEl, anchorEl, message) {
  // Place the message as a grid item under the control (col 2 of the form-group
  // grid; full-width groups span naturally). Inserted right after the control.
  const msg = formEl.ownerDocument.createElement('div');
  msg.className = 'more-buttons-field-error';
  msg.setAttribute('role', 'alert');
  msg.textContent = message;
  anchorEl.insertAdjacentElement('afterend', msg);
  return msg;
}

/**
 * Validate every visible, enabled field. Paints `--invalid`, sets aria-invalid,
 * inserts an inline reason under the first failure of each field, and returns
 * the first element a caller should scroll to / focus.
 *
 * Skips disabled inputs (preset-locked) and inputs inside collapsed
 * `data-show-when` groups, matching the previous inline behaviour.
 *
 * @returns {{ valid: boolean, firstInvalid: Element|null }}
 */
export function validateFields(formEl) {
  clearErrors(formEl);

  let valid = true;
  let firstInvalid = null;
  const seenRadioNames = new Set();

  const inputs = formEl.querySelectorAll('input, select, textarea');
  inputs.forEach((input) => {
    if (input.disabled) return;
    const hidden = input.closest('[data-show-when]');
    if (hidden && hidden.style.display === 'none') return;

    const required = input.hasAttribute('required');
    const isRadio = input.type === 'radio' || input.type === 'checkbox';

    // Compute emptiness the way each control reports it.
    let empty = false;
    let group = null;
    if (required && isRadio) {
      if (seenRadioNames.has(input.name)) return; // group handled once
      seenRadioNames.add(input.name);
      const peers = formEl.querySelectorAll(`input[name="${input.name}"]`);
      empty = !Array.from(peers).some((r) => r.checked);
      group = input.closest(RADIO_GROUP);
    } else if (required) {
      empty = !String(input.value || '').trim();
    }

    const maxAttr = input.getAttribute('data-maxlength');
    const maxlength = maxAttr ? parseInt(maxAttr, 10) : null;

    const err = fieldError({
      required,
      empty,
      value: isRadio ? null : input.value,
      maxlength: isRadio ? null : maxlength,
    });
    if (!err) return;

    valid = false;
    const target = group || input;
    target.classList.add('--invalid');
    target.setAttribute('aria-invalid', 'true');

    // The maxlength counter already shows "N/M" in red beneath the field, so
    // only the required-empty case needs a worded reason to avoid doubling up.
    if (err.reason === 'required') {
      const anchor = group || input;
      ensureMessage(formEl, anchor, err.message);
    }

    if (!firstInvalid) firstInvalid = target;
  });

  return { valid, firstInvalid };
}

/**
 * Wire a delegated `input`/`change` listener that clears a field's error state
 * the moment the user has actually fixed it (errors should not outlive the
 * typo). It re-checks the edited field and only clears once it passes, so it
 * never fights the live maxlength counter, which keeps an over-limit field red.
 * Call once per form.
 */
export function wireErrorClearing(formEl) {
  const clear = (e) => {
    const field = e.target;
    if (!field || !field.classList) return;
    const isRadio = field.type === 'radio' || field.type === 'checkbox';
    const target = isRadio ? field.closest(RADIO_GROUP) || field : field;
    if (!target.classList.contains('--invalid')) return;

    // Still failing? Leave it (counter / submit state stands).
    let empty = false;
    if (field.hasAttribute('required')) {
      if (isRadio) {
        const peers = formEl.querySelectorAll(`input[name="${field.name}"]`);
        empty = !Array.from(peers).some((r) => r.checked);
      } else {
        empty = !String(field.value || '').trim();
      }
    }
    const maxAttr = field.getAttribute('data-maxlength');
    const maxlength = maxAttr ? parseInt(maxAttr, 10) : null;
    if (
      fieldError({
        required: field.hasAttribute('required'),
        empty,
        value: isRadio ? null : field.value,
        maxlength: isRadio ? null : maxlength,
      })
    ) {
      return;
    }

    target.classList.remove('--invalid');
    target.removeAttribute('aria-invalid');
    const group = target.closest(GROUP) || formEl;
    group
      .querySelectorAll('.more-buttons-field-error')
      .forEach((el) => el.remove());
  };
  formEl.addEventListener('input', clear);
  formEl.addEventListener('change', clear);
}
