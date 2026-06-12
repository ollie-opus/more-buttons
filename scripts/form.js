import { getFormAction, currentOpener, currentInvocationDescriptor } from './formActions.js';
import { readRepoText } from './repoClient.js';
import { renderOpenIncidents, renderResolvedIncidents } from './systemStatus.js';
import { renderDraftUpdates, renderPublishedUpdates } from './systemUpdates.js';
import { upgradeTextarea } from './richTextEditor.js';
import { formLoading } from './loading.js';

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
let activeNavObserver = null;
let activeNavbarRefresh = null;


// Browser-style history: a linear list of views plus a cursor into it. Each
// entry is { opener, label, formName }. `opener` is a stateless replay closure
// (see formActions.js) that rebuilds the view by re-running createForm.
// navMode signals how the next createForm should mutate history:
//   'root'   – fresh entry point (no overlay open): reset history
//   'push'   – navigating deeper (overlay open): append, dropping forward history
//   'replay' – back/forward/crumb jump: don't mutate, cursor already positioned
const history = [];
let cursor = -1;
let navMode = 'root';

// Fallback breadcrumb labels when a form's <h2> is empty or still loading.
const FORM_LABELS = {
  knowledgeBaseManagement: 'Knowledge Base',
  captureLibrary: 'Capture Library',
  captureEntry: 'Capture',
  captureInsertNew: 'New Capture',
  systemUpdatesEntry: 'System Updates',
  systemStatusEntry: 'System Status',
  guideEntry: 'Guide',
  editGuideSection: 'Edit Section',
  editGuideAdmonition: 'Edit Admonition',
  editCaptureComponent: 'Edit Capture',
  editContentTabs: 'Edit Content Tabs',
  editDataTable: 'Edit Data Table',
  reportIncident: 'Report Incident',
  updateIncident: 'Update Incident',
  logSystemUpdate: 'Log System Update',
  editSystemUpdate: 'Edit System Update',
  editDraftSystemUpdate: 'Edit Draft Update',
};

function resetHistory() {
  history.length = 0;
  cursor = -1;
}

// Replace the current view's identity in place. Used when a form mutates itself
// (e.g. a "create" form that becomes an "edit" form after saving) so navigating
// back into it — OR replaying it after a capture-mode / library round-trip —
// rebuilds the new view, not the old one.
//
// Takes the form-action name + args rather than a raw closure so the live opener
// closure and the serialisable descriptor are derived from one source and stay
// in lockstep. Updating only one of them silently breaks the other: a stale
// descriptor makes snapshotFormStack/replayFormStack reopen the pre-transition
// view (e.g. a "create" form that then re-creates a duplicate on save), while a
// stale opener breaks plain back-navigation.
export function replaceCurrentOpener(name, args) {
  if (cursor < 0 || !history[cursor]) return;
  history[cursor].opener = () => getFormAction(name)(args);
  history[cursor].descriptor = { name, args };
}

// Override the breadcrumb label for the current view with a richer name than
// the form's <h2> (e.g. "Section 1: Manager Steps" or "Step 4"). Locks the
// label so the heading observer won't revert it to the <h2> text.
export function setCrumbLabel(label) {
  if (cursor < 0 || !history[cursor] || !label) return;
  history[cursor].label = label;
  history[cursor].labelLocked = true;
  activeNavbarRefresh?.();
}

// Serialisable snapshot of the current form stack — used by capture mode to
// auto-reopen the form (and its breadcrumb trail) after capture-mode Done.
// Entries without a descriptor (forms opened by direct createForm calls rather
// than via getFormAction) can't be replayed, so we return only the contiguous
// suffix of descriptor-carrying entries ending at the current cursor. Each
// entry also carries its crumb label + formName so a restore can paint the
// breadcrumb without rendering the ancestor forms.
export function snapshotFormStack() {
  if (cursor < 0) return null;
  const out = [];
  for (let i = 0; i <= cursor; i++) {
    const e = history[i];
    if (!e?.descriptor) {
      // Reset on every gap so the result is the longest suffix that is fully
      // replayable in order.
      out.length = 0;
      continue;
    }
    out.push({ name: e.descriptor.name, args: e.descriptor.args, label: e.label || '', formName: e.formName });
  }
  return out.length ? out : null;
}

// Restore a snapshot produced by snapshotFormStack(). Starts fresh: any
// currently open overlay is torn down and history is reset. The snapshot is
// seeded straight into history[] (opener + descriptor + crumb label) and ONLY
// the target entry's form action runs — ancestors are never rendered just to
// register their history slots. They re-render on demand when the user
// navigates back / clicks a crumb, exactly like any other history entry.
// Prerequisite: every snapshot-able form action must be self-contained (derive
// all context from its args), since it can no longer rely on ancestor actions
// having run first.
let replaying = false;

/** True while a form-stack replay is in progress. Lets form actions skip
 *  destructive setup (e.g. resetting storage to blank initial values) so the
 *  user's in-flight typing — snapshotted to storage before the replay — can
 *  hydrate back into the reopened form. */
export function isFormReplay() {
  return replaying;
}

export async function replayFormStack(snapshot) {
  if (!snapshot?.length) return false;
  // Refuse wholesale if any entry is unknown — seeding a crumb that can never
  // open is worse than not restoring (matches the old walk-the-chain contract).
  if (snapshot.some(e => !getFormAction(e.name))) return false;
  if (activeFormCleanup) { activeFormCleanup(); activeFormCleanup = null; }
  resetHistory();
  for (const e of snapshot) {
    history.push({
      opener: () => getFormAction(e.name)(e.args),
      label: e.label || '',
      formName: e.formName,
      descriptor: { name: e.name, args: e.args },
    });
  }
  const targetIndex = history.length - 1;
  replaying = true;
  try {
    // Open the target view directly. If its opener bails before mounting an
    // overlay (e.g. its section was deleted in another session), trim the dead
    // entry and fall back to the nearest ancestor that does mount.
    for (let i = targetIndex; i >= 0; i--) {
      history.length = i + 1;
      cursor = i;
      navMode = 'replay';
      try {
        await history[i].opener();
      } catch (err) {
        console.error('replayFormStack: entry failed', snapshot[i]?.name, err);
      }
      if (activeFormCleanup) return i === targetIndex;
    }
  } finally {
    replaying = false;
    navMode = 'root';
  }
  resetHistory();
  return false;
}

export { navigateBack };

// Read all named input values from a form into a flat dict — mirrors what the
// generic `save` action writes to storage so a snapshot taken here can be
// compared against later edits to detect a "dirty" form.
export function readFormValues(formEl) {
  const data = {};
  const inputs = formEl.querySelectorAll('input, select, textarea');
  const checkboxGroups = {};
  inputs.forEach(i => {
    if (i.type === 'checkbox' && i.name) {
      (checkboxGroups[i.name] ??= []).push(i);
    }
  });
  inputs.forEach(input => {
    if (!input.name) return;
    if (input.type === 'radio') {
      if (input.checked) data[input.name] = input.value;
    } else if (input.type === 'checkbox') {
      const g = checkboxGroups[input.name];
      if (g && g.length > 1) {
        if (!(input.name in data)) data[input.name] = g.filter(b => b.checked).map(b => b.value);
      } else {
        data[input.name] = input.checked;
      }
    } else {
      data[input.name] = input.value;
    }
  });
  return data;
}

function valuesEqual(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

export function isFormDirty(formEl) {
  const snap = formEl?._initialSnapshot;
  if (!snap) return false;
  const cur = readFormValues(formEl);
  const keys = new Set([...Object.keys(snap), ...Object.keys(cur)]);
  for (const k of keys) {
    if (!valuesEqual(snap[k], cur[k])) return true;
  }
  return false;
}

// Returns true if it's safe to navigate away (clean form, no guard, or user
// confirmed the discard). Call before any in-form action that would tear down
// or replace the current view.
export function confirmDiscardIfDirty(formEl) {
  if (!formEl || !formEl.hasAttribute?.('data-dirty-guard')) return true;
  if (!isFormDirty(formEl)) return true;
  return confirm('You have unsaved changes that will be lost if you leave this page. Continue?');
}

// Re-establish the dirty-guard baseline to the form's current values. Call
// after an in-place save that keeps the form mounted (e.g. a create→edit
// transition) so the just-saved values aren't reported as unsaved changes.
export function resetDirtyBaseline(formEl) {
  if (formEl?.hasAttribute?.('data-dirty-guard')) {
    formEl._initialSnapshot = readFormValues(formEl);
  }
}

// Wire a `[data-save-state]` button to the form's dirty state. Clean/saved →
// neutral grey disabled button; dirty or create-mode → clickable green "unsaved"
// button. The form-actions bar is relocated under the overlay content, so the
// button is a sibling of the form (formEl.parentElement), not a descendant.
// Exposes formEl._refreshSaveState() so save handlers can re-sync after a commit.
export function bindSaveStateButton(formEl) {
  if (!formEl) return;
  const btn = formEl.parentElement?.querySelector('[data-save-state]')
    || formEl.querySelector('[data-save-state]');
  if (!btn) return;
  const savedLabel = btn.dataset.savedLabel || 'Draft saved';
  const unsavedLabel = btn.dataset.unsavedLabel || 'Save to draft';

  const render = () => {
    // Create-mode forms have no saved baseline yet → always "unsaved".
    const unsaved = formEl.dataset.mode === 'create' || isFormDirty(formEl);
    // Unsaved → clickable green outline (`.success`). Saved → plain disabled
    // button (no accent class) so it settles into the neutral grey "default"
    // disabled style rather than a green "confirm" pill.
    btn.classList.remove('busy', 'info');
    btn.classList.toggle('success', unsaved);
    btn.disabled = !unsaved;
    const icon = unsaved ? 'outbound' : 'check_circle';
    const label = unsaved ? unsavedLabel : savedLabel;
    btn.innerHTML = `<span class="more-buttons-icon">${icon}</span>${label}`;
  };

  // While a commit is in flight the button is `.busy` (amber, disabled). Ignore
  // field edits during that window so render() doesn't strip the busy state and
  // re-enable the button — otherwise the user could click Save again mid-commit
  // and spawn a second concurrent write. The handler's explicit
  // _refreshSaveState() call (which is `render` itself) still settles the button
  // to green/blue once the commit finishes.
  const onEdit = () => { if (!btn.classList.contains('busy')) render(); };

  formEl._refreshSaveState = render;
  formEl.addEventListener('input', onEdit);
  formEl.addEventListener('change', onEdit);
  render();
}

// Busy-button helpers live in loading.js now; re-exported here because most
// form modules already import them from form.js.
export { setButtonBusy, snapshotButton, restoreButton } from './loading.js';

function activeGuardedForm() {
  // The currently-mounted overlay form, if it opted into the dirty guard.
  const el = document.querySelector('.more-buttons-overlay form[data-dirty-guard]');
  return el && el._initialSnapshot ? el : null;
}

// Jump to a history index by replaying that entry's opener. We deliberately do
// NOT clean up the current overlay here: re-running the opener calls createForm,
// which tears down the current overlay itself. That keeps `activeFormCleanup`
// set during the replay so createForm treats it as in-session navigation.
async function navigateTo(index) {
  if (index < 0 || index >= history.length) return;
  navMode = 'replay';
  cursor = index;
  // Back/forward/crumb replays bypass the action dispatcher, so arm the
  // loading veil here; slow openers (GitHub re-fetches before createForm)
  // get feedback, fast ones never outlive the grace period. createForm
  // drops it at render; the finally mops up failures.
  formLoading.show();
  try {
    await history[index].opener();
  } finally {
    formLoading.dismiss();
  }
}

function navigateBack() {
  if (cursor > 0) return navigateTo(cursor - 1);
  return Promise.resolve();
}

function navigateForward() {
  if (cursor < history.length - 1) return navigateTo(cursor + 1);
  return Promise.resolve();
}

// `rootEntry: true` marks this open as a fresh top-level launch (e.g. the
// "Manage Knowledge Base" popup button). Such a launch must reset the history
// even when an overlay is already open from an in-flight stack — otherwise the
// open overlay makes `deeper` true and the root form is appended as a new crumb
// (KB › guide › section › KB) instead of restarting the trail.
export async function createForm(formName, opener, { rootEntry = false } = {}) {
  const resolvedOpener = opener ?? currentOpener() ?? (() => createForm(formName));
  const descriptor = currentInvocationDescriptor();
  const replaying = navMode === 'replay';
  const deeper = !!activeFormCleanup;
  if (activeFormCleanup) {
    // An overlay is already open: tear it down before rendering the new view.
    activeFormCleanup();
    activeFormCleanup = null;
  }

  if (replaying) {
    // Back/forward/crumb jump: cursor is already positioned. Only adopt a NEW
    // opener when this createForm was handed an explicit one. Otherwise the
    // opener already in this slot IS the closure we are currently replaying —
    // the source of truth — so overwriting it with the ambient form action's
    // identity (currentOpener) would corrupt the slot. That corruption happens
    // when a form action calls navigateBack() and the destination's opener is a
    // bare createForm (not wrapped in getFormAction): activeInvocation still
    // points at the running action, so the slot would later replay that action
    // (e.g. re-saving a draft) instead of rebuilding its own view.
    if (history[cursor] && opener) {
      history[cursor].opener = opener;
      if (descriptor) history[cursor].descriptor = descriptor;
    }
  } else if (deeper && !rootEntry) {
    // Navigating deeper: drop any forward history, then append.
    history.length = cursor + 1;
    history.push({ opener: resolvedOpener, label: '', formName, descriptor });
    cursor = history.length - 1;
  } else {
    // Fresh entry point (no overlay open, or a forced root launch): start a
    // new history.
    resetHistory();
    history.push({ opener: resolvedOpener, label: '', formName, descriptor });
    cursor = 0;
  }
  navMode = 'root';

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
  // Only animate the intro on a genuine fresh open; in-place navigation
  // (push/back/forward/crumb) re-mounts this node and would replay the fade.
  if ((!deeper || rootEntry) && !replaying) content.classList.add('--animate-in');
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
      const guarded = activeGuardedForm();
      if (guarded && !confirmDiscardIfDirty(guarded)) return;
      resetHistory();
      cleanup();
    }
  };

  function cleanup() {
    // Drop any pending/visible loading tile — Escape mid-action should give
    // instant feedback; the action's finally re-dismisses harmlessly.
    formLoading.dismiss();
    document.removeEventListener('keydown', handleKeyDown);
    document.body.style.overflow = previousBodyOverflow;
    if (activeNavObserver) { activeNavObserver.disconnect(); activeNavObserver = null; }
    activeNavbarRefresh = null;
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
    formLoading.dismiss();
    content.textContent = 'Failed to load form.';
    return;
  }

  content.innerHTML = formHtml;
  // The destination form exists now — drop the loading tile so the form is
  // interactive immediately; slower sub-content (e.g. capture preview blobs)
  // falls back to its own in-container "Loading…" labels.
  formLoading.dismiss();

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
    // No form element — delegate action buttons (close / back / module fns).
    // Delegation (vs per-button binding) keeps working when a form re-renders
    // its own toolbar after createForm has run.
    // No formLoading.show() here — this path handles simple close/back/module
    // actions on formless overlays; slow programmatic opens from this path are
    // the spec's noted future opt-in.
    const mod = window.__mbActionsModule;
    content.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn || !content.contains(btn)) return;
      const steps = btn.getAttribute('data-action').split(',').map(s => s.trim());
      for (const step of steps) {
        if (step === 'close') { resetHistory(); cleanup(); continue; }
        if (step === 'back') { await navigateBack(); continue; }
        let [stepName, stepParam] = step.includes(':') ? step.split(':') : [step, null];
        const fn = mod && typeof mod[stepName] === 'function' ? mod[stepName] : null;
        if (fn) { cleanup(); await fn(stepParam); }
        else { console.warn(`createForm: Unknown action step "${stepName}"`); }
      }
    });
    return { overlay, content, formEl: null };
  }

  const storageKey = formEl.getAttribute('data-storage-key') || 'defaultStorageKey';

  // Browser-style navbar (back/forward arrows + breadcrumb) for forms that opt
  // in with data-nav. Sits above the scrolling <form> as a pinned chrome bar.
  if (formEl.hasAttribute('data-nav')) {
    const labelFromHeading = () => {
      const h2 = formEl.querySelector('h2');
      if (!h2) return '';
      const clone = h2.cloneNode(true);
      clone.querySelectorAll('.more-buttons-icon').forEach(el => el.remove());
      return clone.textContent.trim();
    };
    const isPlaceholder = (t) => !t || /^loading/i.test(t) || t === '…';
    const labelFor = (entry) => entry.label || FORM_LABELS[entry.formName] || entry.formName || '…';

    const renderNavbar = () => {
      const nav = document.createElement('div');
      nav.className = 'more-buttons-navbar';

      const arrows = document.createElement('div');
      arrows.className = 'more-buttons-nav-arrows';
      [['back', 'arrow_back', cursor <= 0],
       ['forward', 'arrow_forward', cursor >= history.length - 1]].forEach(([action, icon, disabled]) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'more-buttons-nav-arrow';
        btn.dataset.navAction = action;
        btn.disabled = disabled;
        btn.setAttribute('aria-label', action);
        btn.innerHTML = `<span class="more-buttons-icon">${icon}</span>`;
        arrows.appendChild(btn);
      });

      const crumbs = document.createElement('nav');
      crumbs.className = 'more-buttons-breadcrumb';
      crumbs.setAttribute('aria-label', 'Breadcrumb');
      for (let i = 0; i <= cursor; i++) {
        if (i > 0) {
          const sep = document.createElement('span');
          sep.className = 'more-buttons-crumb-sep';
          sep.textContent = '›';
          crumbs.appendChild(sep);
        }
        const text = labelFor(history[i]);
        if (i === cursor) {
          const cur = document.createElement('span');
          cur.className = 'more-buttons-crumb --current';
          cur.setAttribute('aria-current', 'page');
          cur.textContent = text;
          crumbs.appendChild(cur);
        } else {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'more-buttons-crumb';
          btn.dataset.crumbIndex = String(i);
          btn.textContent = text;
          crumbs.appendChild(btn);
        }
      }

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'more-buttons-nav-arrow more-buttons-nav-close';
      closeBtn.dataset.navAction = 'close';
      closeBtn.setAttribute('aria-label', 'Close');
      closeBtn.innerHTML = '<span class="more-buttons-icon">close</span>';

      nav.append(arrows, crumbs, closeBtn);
      const existing = content.querySelector('.more-buttons-navbar');
      if (existing) existing.replaceWith(nav);
      else content.prepend(nav);
    };

    activeNavbarRefresh = renderNavbar;

    // Resolve this view's label from its heading, falling back to the map.
    // Skip if an explicit label was locked in (e.g. via setCrumbLabel on replay).
    const initial = labelFromHeading();
    if (history[cursor] && !history[cursor].labelLocked) {
      history[cursor].label = isPlaceholder(initial) ? '' : initial;
    }
    renderNavbar();

    // Async titles (e.g. guides set <h2 data-guide-title> after fetch): update
    // the crumb when the heading resolves, unless an explicit label is locked.
    const h2 = formEl.querySelector('h2');
    if (h2) {
      activeNavObserver = new MutationObserver(() => {
        if (history[cursor]?.labelLocked) return;
        const t = labelFromHeading();
        if (!isPlaceholder(t) && history[cursor] && history[cursor].label !== t) {
          history[cursor].label = t;
          renderNavbar();
        }
      });
      activeNavObserver.observe(h2, { childList: true, characterData: true, subtree: true });
    }

    content.addEventListener('click', async (e) => {
      const arrow = e.target.closest('[data-nav-action]');
      if (arrow && content.contains(arrow)) {
        const action = arrow.dataset.navAction;
        if (!confirmDiscardIfDirty(formEl)) return;
        if (action === 'back') await navigateBack();
        else if (action === 'forward') await navigateForward();
        else if (action === 'close') { resetHistory(); cleanup(); }
        return;
      }
      const crumb = e.target.closest('[data-crumb-index]');
      if (crumb && content.contains(crumb)) {
        if (!confirmDiscardIfDirty(formEl)) return;
        await navigateTo(parseInt(crumb.dataset.crumbIndex, 10));
      }
    });
  }

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
    back: () => navigateBack(),
    close: () => { resetHistory(); cleanup(); return Promise.resolve(); },
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

  // Delegated so buttons injected after createForm runs (e.g. a toolbar a form
  // re-renders into its actions bar) still trigger their actions.
  content.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn || !content.contains(btn)) return;
    if (btn.hasAttribute('data-validate') && !validateForm()) return;

    const steps = btn.getAttribute('data-action').split(',').map(s => s.trim());
    // Slow navigations (GitHub fetches, parent-form saves) get a "Loading…"
    // tile if still in flight after the grace period; createForm() drops it
    // as soon as the destination form renders. The finally covers actions
    // that throw or never open a form. Bonus: the veil covers the tile and
    // blocks stray clicks once the grace period elapses.
    formLoading.show();
    try {
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
    } finally {
      formLoading.dismiss();
    }
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

      formLoading.show();
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
      } finally {
        formLoading.dismiss();
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

    // Upgrade opted-in Description textareas to the rich-text editor. Runs here,
    // after hydration set textarea.value, and before the dirty-guard snapshot so
    // the snapshot still sees the original markdown (no false-dirty).
    formEl.querySelectorAll('textarea[data-richtext]').forEach(ta =>
      upgradeTextarea(ta, { inline: ta.dataset.richtext === 'inline' }));

    // Snapshot baseline for dirty-guard forms after hydration completes so
    // later edits can be detected when the user tries to navigate away.
    if (formEl.hasAttribute('data-dirty-guard')) {
      formEl._initialSnapshot = readFormValues(formEl);
    }
    // Wire the informational save-state button (no-op for forms without one).
    bindSaveStateButton(formEl);
  });

  // Return handles in case caller wants them
  return { overlay, content, formEl };
}
