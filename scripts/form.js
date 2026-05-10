import { getFormAction } from './formActions.js';
import { readRepoText } from './repoClient.js';
import { renderOpenIncidents, renderResolvedIncidents } from './systemStatus.js';
import { renderDraftUpdates, renderPublishedUpdates } from './systemUpdates.js';

// Render-function contract for renderFns:
// - Signature: (initialMarkdown, panel). `initialMarkdown` is the freshly-read
//   contents of the panel's data-fetch-path file at first paint.
// - May ignore initialMarkdown and self-fetch via readRepoText(path) (e.g. drafts
//   panel reading a different file). Always read fresh — no stashed cache.
// - Should be async and may show a loading state for slow fetches.
// - When a panel owns suppressible IDs, call staleSuppression.reconcile(...) and
//   filterSuppressed(...) using the freshly-fetched ID set.
const renderFns = {
  renderOpenIncidents,
  renderResolvedIncidents,
  renderDraftUpdates,
  renderPublishedUpdates
};

let activeFormCleanup = null;
const navStack = [];

export async function createForm(formName, opener) {
  navStack.push(opener ?? (() => createForm(formName)));
  if (activeFormCleanup) {
    activeFormCleanup();
    activeFormCleanup = null;
  }

  // Inject CSS once via <link> tag
  if (!document.getElementById('more-buttons-overlay-stylesheet')) {
    const link = document.createElement('link');
    link.id = 'more-buttons-overlay-stylesheet';
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('config/forms/formsStyling.css');
    (document.head || document.documentElement).appendChild(link);
  }

  // Create overlay container
  const overlay = document.createElement('div');
  overlay.className = 'more-buttons-overlay';

  const content = document.createElement('div');
  content.className = 'more-buttons-overlay-content';
  content.setAttribute('role', 'dialog');
  content.setAttribute('aria-modal', 'true');

  overlay.appendChild(content);
  document.body.appendChild(overlay);

  // Lock body scroll while overlay is open
  const previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  // Utility: close overlay + cleanup
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      navStack.length = 0;
      cleanup();
    }
  };

  function cleanup() {
    document.removeEventListener('keydown', handleKeyDown);
    document.body.style.overflow = previousBodyOverflow;
    if (overlay.isConnected) overlay.remove();
    if (activeFormCleanup === cleanup) activeFormCleanup = null;
  }

  activeFormCleanup = cleanup;

  document.addEventListener('keydown', handleKeyDown);

  // Load form HTML file
  let formHtml;
  try {
    const resp = await fetch(chrome.runtime.getURL(`config/forms/${formName}.html`));
    if (!resp.ok) throw new Error(`Failed to load form HTML: ${resp.status}`);
    formHtml = await resp.text();
  } catch (err) {
    console.error(err);
    content.textContent = 'Failed to load form.';
    return;
  }

  content.innerHTML = formHtml;

  // Move form-actions outside the form so it sits below the scroll area,
  // preventing the scrollbar from rendering over the buttons.
  const formActionsEl = content.querySelector('.more-buttons-form-actions');
  if (formActionsEl) content.appendChild(formActionsEl);

  content.addEventListener('click', e => {
  const tab = e.target.closest('[data-tab]');
  if (!tab) return;

  const tabName = tab.dataset.tab;
  const tabsContainer = tab.closest('.more-buttons-tabs');
  if (!tabsContainer) return;

  // Update active tab button
  tabsContainer.querySelectorAll('[data-tab]').forEach(t => {
    t.classList.toggle('--active', t === tab);
  });

  // Show correct panel
  tabsContainer.querySelectorAll('[data-tab-panel]').forEach(panel => {
    panel.hidden = panel.dataset.tabPanel !== tabName;
  });
});

  // Grab the form with storage key attribute
  const formEl = content.querySelector('form[data-storage-key]');
  if (formEl?.dataset.width) {
    content.style.width = formEl.dataset.width;
    content.style.maxWidth = formEl.dataset.width;
  }
  if (formEl?.dataset.height) {
    content.style.height = formEl.dataset.height;
    content.style.maxHeight = formEl.dataset.height;
  }
  if (!formEl) {
    // No form element — wire up action buttons with close + module function support
    const mod = window.__mbActionsModule;
    content.querySelectorAll('button[data-action]').forEach(btn => {
      const steps = btn.getAttribute('data-action').split(',').map(s => s.trim());
      btn.addEventListener('click', async () => {
        for (const step of steps) {
          if (step === 'close') { navStack.length = 0; cleanup(); continue; }
          if (step === 'back') {
            navStack.pop();
            const prev = navStack.pop();
            cleanup();
            if (prev) await prev();
            continue;
          }
          let [stepName, stepParam] = step.includes(':') ? step.split(':') : [step, null];
          const fn = mod && typeof mod[stepName] === 'function' ? mod[stepName] : null;
          if (fn) { cleanup(); await fn(stepParam); }
          else { console.warn(`createForm: Unknown action step "${stepName}"`); }
        }
      });
    });
    return { overlay, content, formEl: null };
  }

  const storageKey = formEl.getAttribute('data-storage-key') || 'defaultStorageKey';

  // Button actions driven by data-action attribute (comma-separated steps)
  // Domain-specific actions (incident management etc.) are registered via formActions.js
  const actionSteps = {
    save: () => new Promise(resolve => {
      const formData = {};
      const inputs = formEl.querySelectorAll('input, select, textarea');

      // Group checkboxes by name to detect multi-checkbox lists
      const checkboxGroups = {};
      inputs.forEach(input => {
        if (input.type === 'checkbox' && input.name) {
          if (!checkboxGroups[input.name]) checkboxGroups[input.name] = [];
          checkboxGroups[input.name].push(input);
        }
      });

      inputs.forEach(input => {
        if (!input.name) return;

        if (input.type === 'radio') {
          if (input.checked && !(input.value === 'none' && input.closest('[data-page-radios]'))) {
            formData[input.name] = input.value;
          }
        } else if (input.type === 'checkbox') {
          const group = checkboxGroups[input.name];
          if (group && group.length > 1) {
            // Save as array of checked values; only write once per group name
            if (!(input.name in formData)) {
              formData[input.name] = group.filter(b => b.checked).map(b => b.value);
            }
          } else {
            formData[input.name] = input.checked;
          }
        } else {
          formData[input.name] = input.value;
        }
      });

      chrome.storage.local.set({ [storageKey]: formData }, () => {
        console.log('Preset saved:', storageKey, formData);
        resolve();
      });
    }),
    delete: () => new Promise(resolve => {
      chrome.storage.local.remove(storageKey, () => {
        console.log('Preset deleted:', storageKey);
        resolve();
      });
    }),
    back: async () => {
      navStack.pop();
      const prev = navStack.pop();
      cleanup();
      if (prev) await prev();
    },
    close: () => { navStack.length = 0; cleanup(); return Promise.resolve(); },
  };

  // Validation: checks required fields and data-maxlength limits
  // Only fields in visible form groups are validated (respects data-show-when)
  function validateForm() {
    let valid = true;

    // Clear previous error states
    formEl.querySelectorAll('.--invalid').forEach(el => el.classList.remove('--invalid'));

    const inputs = formEl.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
      // Skip disabled inputs (locked by preset)
      if (input.disabled) return;

      // Skip inputs inside hidden groups (data-show-when)
      const group = input.closest('[data-show-when]');
      if (group && group.style.display === 'none') return;

      // Required check
      if (input.hasAttribute('required')) {
        let empty = false;
        if (input.type === 'radio') {
          const radios = formEl.querySelectorAll(`input[name="${input.name}"]`);
          empty = !Array.from(radios).some(r => r.checked);
          if (empty) {
            const radioGroup = input.closest('.more-buttons-radio-group-row, .more-buttons-radio-group-column, .more-buttons-radio-btn-group-row, .more-buttons-radio-btn-group-column');
            radioGroup?.classList.add('--invalid');
          }
        } else {
          empty = !input.value.trim();
          if (empty) input.classList.add('--invalid');
        }
        if (empty) valid = false;
      }

      // Maxlength check
      const maxLen = input.getAttribute('data-maxlength');
      if (maxLen && input.value.length > parseInt(maxLen, 10)) {
        input.classList.add('--invalid');
        valid = false;
      }
    });

    return valid;
  }

  // Character counters for inputs/textareas with data-maxlength
  formEl.querySelectorAll('[data-maxlength]').forEach(input => {
    const max = parseInt(input.getAttribute('data-maxlength'), 10);

    // Wrap the input in a container for positioning the counter
    const wrapper = document.createElement('div');
    wrapper.className = 'more-buttons-input-wrapper';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const counter = document.createElement('span');
    counter.className = 'more-buttons-char-counter';
    wrapper.appendChild(counter);

    const updateCounter = () => {
      const remaining = max - input.value.length;
      counter.textContent = `${input.value.length}/${max}`;
      counter.classList.toggle('--over', remaining < 0);
      input.classList.toggle('--invalid', remaining < 0);
    };

    input.addEventListener('input', updateCounter);
    // Deferred initial update after saved data loads
    input._updateCounter = updateCounter;
  });

  content.querySelectorAll('button[data-action]').forEach(btn => {
    const steps = btn.getAttribute('data-action').split(',').map(s => s.trim());
    const needsValidation = btn.hasAttribute('data-validate');

    btn.addEventListener('click', async () => {
      if (needsValidation && !validateForm()) return;

      for (const step of steps) {
        let stepName = step;
        let stepParam = null;

        if (step.includes(':')) {
          [stepName, stepParam] = step.split(':');
        }

        if (actionSteps[stepName]) {
          await actionSteps[stepName](stepParam);
        } else {
          const ctx = { formEl, overlay, content, cleanup, storageKey, validateForm, conditionalEls };
          const registryFn = getFormAction(stepName);
          if (registryFn) {
            await registryFn(ctx);
          } else {
            const mod = window.__mbActionsModule;
            const modFn = mod && typeof mod[stepName] === 'function' ? mod[stepName] : null;
            if (modFn) await modFn(stepParam);
            else console.warn(`createForm: Unknown action step "${stepName}"`);
          }
        }
      }
    });
  });

  // Conditional visibility: data-show-when="name=value" or data-show-when="name"
  const conditionalEls = formEl.querySelectorAll('[data-show-when]');
  if (conditionalEls.length) {
    const updateVisibility = () => {
      conditionalEls.forEach(el => {
        const conditions = el.getAttribute('data-show-when').split(' ');
        const visible = conditions.every(cond => {
          const negate = cond.includes('!=');
          const sep = negate ? '!=' : '=';
          const hasValue = cond.includes(sep);
          const [name, value] = cond.split(sep);
          const checked = formEl.querySelector(`input[name="${name}"]:checked`);
          if (!hasValue) return !!checked;
          const match = checked && checked.value === value;
          return negate ? !match : match;
        });
        el.style.display = visible ? '' : 'none';
      });
    };

    formEl.addEventListener('change', updateVisibility);
    // Run once after saved data is loaded (deferred below)
    conditionalEls._updateVisibility = updateVisibility;
  }


  // Preset fill: radios with data-fill auto-populate and lock/unlock other fields
  const fillRadios = formEl.querySelectorAll('input[type="radio"][data-fill]');
  if (fillRadios.length) {
    const presetName = fillRadios[0].name;

    const applyPreset = (isInitialLoad) => {
      const selected = formEl.querySelector(`input[name="${presetName}"]:checked`);
      if (!selected) return;

      // Clear all non-preset fields when switching presets (skip on initial load)
      if (!isInitialLoad) {
        formEl.querySelectorAll('input, select, textarea').forEach(f => {
          if (f.name === presetName) return;
          if (f.type === 'radio' || f.type === 'checkbox') f.checked = false;
          else { f.value = ''; f._updateCounter?.(); }
        });
      }

      const fillJson = selected.getAttribute('data-fill');
      const lock = !!fillJson;

      if (fillJson) {
        const values = JSON.parse(fillJson);
        for (const [name, val] of Object.entries(values)) {
          formEl.querySelectorAll(`[name="${name}"]`).forEach(f => {
            if (f.type === 'radio') f.checked = (f.value === val);
            else { f.value = val; f._updateCounter?.(); }
          });
        }
      }

      // Lock / unlock all non-preset inputs
      formEl.querySelectorAll('input, select, textarea').forEach(f => {
        if (f.name === presetName) return;
        f.disabled = lock;
      });

      // Re-run conditional visibility
      conditionalEls._updateVisibility?.();
    };

    formEl.addEventListener('change', (e) => {
      if (e.target.name === presetName) applyPreset();
    });
    fillRadios._applyPreset = applyPreset;
  }

  // Populate checkboxes from page elements (data-page-checkboxes="inputName")
  formEl.querySelectorAll('[data-page-checkboxes]').forEach(container => {
    const inputName = container.getAttribute('data-page-checkboxes');
    const pageCheckboxes = document.querySelectorAll(`input[name="${inputName}"]`);

    if (!pageCheckboxes.length) {
      container.textContent = 'No report types found on this page.';
      return;
    }

    pageCheckboxes.forEach(pageCheckbox => {
      // Find the label text from the row's primary link span
      const row = pageCheckbox.closest('tr');
      const linkSpan = row?.querySelector('td.--primary a span:not(.sr-only)');
      const labelText = linkSpan?.textContent.trim() || pageCheckbox.value;

      const label = document.createElement('label');
      label.className = 'more-buttons-sub-label';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.name = container.id || inputName;
      checkbox.value = pageCheckbox.value;

      label.appendChild(checkbox);
      label.append(labelText);
      container.appendChild(label);
    });
  });

  // Populate checkbox rows from page elements (data-page-radios="inputName")
  formEl.querySelectorAll('[data-page-radios]').forEach(container => {
    const inputName = container.getAttribute('data-page-radios');
    const advancedSelector = container.getAttribute('data-rt-advanced-container');
    const advancedContainer = advancedSelector ? formEl.querySelector(advancedSelector) : null;
    const pageCheckboxes = document.querySelectorAll(`input[name="${inputName}"]`);

    const ADVANCED_EXACT = new Set(['other', 'triggered_corrective_action']);
    const ADVANCED_PREFIXES = ['system.'];
    const isAdvancedKey = key =>
      ADVANCED_EXACT.has(key) || ADVANCED_PREFIXES.some(p => key.startsWith(p));

    container._rtSyncs = [];
    if (advancedContainer) advancedContainer._rtSyncs = [];

    function ensureTable(target) {
      if (target._rtTable) return;
      const table = document.createElement('table');
      table.className = 'more-buttons-rt-table';
      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      [['Report Type', ''], ['Key', 'rt-key'], ['Install', 'rt-install'], ['Uninstall', 'rt-uninstall']].forEach(([text, cls]) => {
        const th = document.createElement('th');
        th.textContent = text;
        if (cls) th.className = cls;
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);
      const tbody = document.createElement('tbody');
      table.appendChild(tbody);
      target.appendChild(table);
      target._rtTable = table;
      target._rtTbody = tbody;
    }

    if (!pageCheckboxes.length) {
      container.textContent = 'No report types found on this page.';
      return;
    }

    pageCheckboxes.forEach(pageCheckbox => {
      const row = pageCheckbox.closest('tr');
      // Skip hidden source rows (e.g. blank entries from hidden inputs)
      if (!row || row.offsetHeight === 0) return;

      const keyEl = row.querySelector('td code');
      const key = keyEl?.textContent.trim();
      if (!key) return;

      const linkSpan = row.querySelector('td.--primary a span:not(.sr-only)');
      const labelText = linkSpan?.textContent.trim() || key;
      const isInstalled = pageCheckbox.checked;

      const target = (advancedContainer && isAdvancedKey(key)) ? advancedContainer : container;
      ensureTable(target);

      const tr = document.createElement('tr');

      const nameTd = document.createElement('td');
      nameTd.className = 'more-buttons-rt-name';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'more-buttons-rt-name-text';
      nameSpan.textContent = labelText;
      nameTd.appendChild(nameSpan);

      if (isInstalled) {
        const indicator = document.createElement('em');
        indicator.className = 'more-buttons-installed-here';
        indicator.textContent = '\u00a0(installed here)';
        nameTd.appendChild(indicator);
      }
      tr.appendChild(nameTd);

      const keyTd = document.createElement('td');
      keyTd.className = 'more-buttons-rt-key';
      const keyCode = document.createElement('code');
      keyCode.textContent = key;
      keyTd.appendChild(keyCode);
      tr.appendChild(keyTd);

      const installCb = document.createElement('input');
      installCb.type = 'checkbox';
      installCb.name = 'report-types-install-list';
      installCb.value = key;

      const uninstallCb = document.createElement('input');
      uninstallCb.type = 'checkbox';
      uninstallCb.name = 'report-types-uninstall-list';
      uninstallCb.value = key;

      function syncDisabled() {
        uninstallCb.disabled = installCb.checked;
        installCb.disabled = uninstallCb.checked;
      }
      installCb.addEventListener('change', syncDisabled);
      uninstallCb.addEventListener('change', syncDisabled);
      target._rtSyncs.push(syncDisabled);

      [['rt-install', installCb], ['rt-uninstall', uninstallCb]].forEach(([cls, cb]) => {
        const td = document.createElement('td');
        td.className = `more-buttons-rt-radio-cell ${cls}`;
        td.appendChild(cb);
        tr.appendChild(td);
      });

      target._rtTbody.appendChild(tr);
    });

    if (!container._rtTable) container.textContent = 'No report types found on this page.';
  });

  // Dynamic markdown fetch: populate data-fetch-path containers when their trigger condition is met.
  // Only re-fetches when the trigger radio itself changes, not on changes within the fetched content.
  const fetchEls = formEl.querySelectorAll('[data-fetch-path]');
  const checkAndLoad = () => {
    fetchEls.forEach(async el => {
      const path = el.dataset.fetchPath;
      const trigger = el.dataset.fetchTrigger;
      if (trigger) {
        const [name, value] = trigger.split('=');
        const checked = formEl.querySelector(`input[name="${name}"]:checked`);
        if (!checked || checked.value !== value) return;
      }
      // Capture original structure (tabs + panels) BEFORE we overwrite anything
      const originalHTML = el._templateHTML || el.innerHTML;
      if (!el._templateHTML) el._templateHTML = originalHTML;

      // Show loading state
      el.innerHTML = '<p class="more-buttons-description">Loading...</p>';

      try {
        const markdown = await readRepoText(path);

        // Restore the original HTML (tabs + panels)
        el.innerHTML = originalHTML;

        // Fill each panel via its data-render hook
        el.querySelectorAll('[data-render]').forEach(panel => {
          const fn = renderFns[panel.dataset.render];
          if (fn) {
            fn(markdown, panel);
          } else {
            console.warn(`No renderer found for ${panel.dataset.render}`);
          }
        });
      } catch {
        el.innerHTML = '<p class="more-buttons-description">Failed to load services.</p>';
      }
    });
  };
  if (fetchEls.length) {
    const triggerNames = new Set(
      [...fetchEls].map(el => el.dataset.fetchTrigger?.split('=')[0]).filter(Boolean)
    );
    formEl.addEventListener('change', e => {
      if (e.target.name && triggerNames.has(e.target.name)) checkAndLoad();
    });
    formEl.addEventListener('click', e => {
      const updateBtn = e.target.closest('[data-update-incident]');
      if (updateBtn) {
        const ctx = { formEl, overlay, content, cleanup, storageKey, validateForm, conditionalEls };
        getFormAction('openUpdateIncident')?.({ ...ctx, uuid: updateBtn.dataset.updateIncident });
        return;
      }
      const editBtn = e.target.closest('[data-edit-past-incident]');
      if (editBtn) {
        const ctx = { formEl, overlay, content, cleanup, storageKey, validateForm, conditionalEls };
        getFormAction('openEditPastIncident')?.({ ...ctx, uuid: editBtn.dataset.editPastIncident });
        return;
      }
      const editUpdateBtn = e.target.closest('[data-edit-system-update]');
      if (editUpdateBtn) {
        const ctx = { formEl, overlay, content, cleanup, storageKey, validateForm, conditionalEls };
        getFormAction('openEditSystemUpdate')?.({ ...ctx, uuid: editUpdateBtn.dataset.editSystemUpdate });
        return;
      }
      const editDraftBtn = e.target.closest('[data-edit-draft-system-update]');
      if (editDraftBtn) {
        const ctx = { formEl, overlay, content, cleanup, storageKey, validateForm, conditionalEls };
        getFormAction('openEditDraftSystemUpdate')?.({ ...ctx, uuid: editDraftBtn.dataset.editDraftSystemUpdate });
        return;
      }
    });
  }

  // Load existing data
  chrome.storage.local.get(storageKey, result => {
    const savedData = result[storageKey] || {};
    const inputs = formEl.querySelectorAll('input, select, textarea');

    inputs.forEach(input => {
      if (!input.name) return;
      const val = savedData[input.name];
      if (val === undefined) return;

      if (input.type === 'radio') {
        input.checked = (input.value === val);
      } else if (input.type === 'checkbox') {
        if (Array.isArray(val)) {
          input.checked = val.includes(input.value);
        } else {
          input.checked = !!val;
        }
      } else {
        input.value = val;
      }
    });

    // Sync disabled states for RT list checkbox pairs after load
    formEl.querySelectorAll('[data-page-radios]').forEach(c => {
      c._rtSyncs?.forEach(fn => fn());
      const advSel = c.getAttribute('data-rt-advanced-container');
      if (advSel) formEl.querySelector(advSel)?._rtSyncs?.forEach(fn => fn());
    });

    // Update conditional visibility after saved data is applied
    conditionalEls._updateVisibility?.();
    checkAndLoad();

    // Apply preset lock/fill after saved data is applied
    fillRadios._applyPreset?.(true);

    // Update character counters after saved data is applied
    formEl.querySelectorAll('[data-maxlength]').forEach(input => {
      input._updateCounter?.();
    });
  });

  // Return handles in case caller wants them
  return { overlay, content, formEl };
}
