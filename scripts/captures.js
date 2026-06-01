/**
 * captures.js — Capture markdown round-trip + per-form list rendering.
 *
 * The actual selector / screenshot lifecycle now lives in captureMode.js
 * (the Capture Mode controller). This module is now only the "form glue":
 *
 *   - parseExistingCaptures / stripCaptureLines / buildCaptureLines
 *       round-trip the `![](../assets/...)` markdown body.
 *   - `captures` — a single ordered array describing what the currently open
 *       form is editing. Each entry is either:
 *         - existing  (no `lightDataUrl`): came from markdown, edits update
 *           dim mode / dim value in place.
 *         - pending   (has `lightDataUrl`/`darkDataUrl`): captured this
 *           session. Carries an `addToLibrary` flag.
 *       Safe as module state because only one capture-bearing form is open
 *       at a time.
 *   - updateCapturesList renders the list with admonition-style "insert here"
 *     zones between rows + an empty-state CTA.
 *   - resolveCaptures / pushCaptures publish them to GitHub.
 *   - clicking an insert zone (or empty CTA) hands off to Capture Mode and,
 *     when it returns, splices the captured rows at that index.
 */

import { registerFormAction } from './formActions.js';
import { snapshotFormStack, replayFormStack } from './form.js';
import { enterCaptureMode } from './captureMode.js';
import { githubPushImageIfNotExists } from './github.js';
import { assetCdnUrl } from './repoClient.js';
import { escapeHtml } from './cardRenderer.js';
import { generateUUID } from './admonitions.js';

// ── Module-level capture state ────────────────────────────────────────────────
export const captures = [];

export function resetCaptureState() {
  captures.length = 0;
}

export function setExistingCaptures(list) {
  captures.length = 0;
  if (list?.length) captures.push(...list);
}

// ── Parsing ───────────────────────────────────────────────────────────────────

export function parseExistingCaptures(body) {
  const out = [];
  const re = /!\[\]\(\.\.\/assets\/([^)#]+)#only-light\)(?:\{\s*([^}]+?)\s*\})?/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const lightFilename = m[1];
    const darkFilename = lightFilename.replace('-light-mode', '-dark-mode');
    const attrs = m[2];
    if (!attrs) {
      out.push({ lightFilename, darkFilename, dimMode: 'none', dimValue: null });
      continue;
    }
    const heightMatch = attrs.match(/height:\s*(\d+)px/);
    const widthMatch = attrs.match(/width="(\d+)"/);
    const dimMode = widthMatch ? 'width' : 'height';
    const dimValue = widthMatch ? parseInt(widthMatch[1]) : (heightMatch ? parseInt(heightMatch[1]) : 50);
    out.push({ lightFilename, darkFilename, dimMode, dimValue });
  }
  return out;
}

export function stripCaptureLines(body) {
  return (body ?? '')
    .replace(/\n?\s*!\[\]\(\.\.\/assets\/[^)]+#only-(light|dark)\)(?:\{[^}]*\})?/g, '');
}

export function buildCaptureLines(list = []) {
  return list.flatMap(c => {
    const light = `![](../assets/${c.lightFilename}#only-light)`;
    const dark  = `![](../assets/${c.darkFilename}#only-dark)`;
    if (c.dimMode === 'none') {
      return ['', light, dark];
    }
    const v = c.dimValue ?? 50;
    const dimAttr = c.dimMode === 'width' ? `width="${v}"` : `style="height: ${v}px"`;
    return [
      '',
      `${light}{ ${dimAttr} loading=lazy }`,
      `${dark}{ ${dimAttr} loading=lazy }`,
    ];
  });
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function captureRowHtml(c, i) {
  const isPending = !!c.lightDataUrl;
  const imgSrc = isPending
    ? c.lightDataUrl
    : assetCdnUrl('docs/assets/' + c.lightFilename);
  const isAuto = c.dimMode === 'none';
  const libraryCheckbox = isPending ? `
        <label class="more-buttons-capture-library">
          <input type="checkbox" data-add-to-library="${i}" ${c.addToLibrary !== false ? 'checked' : ''} />
          Add to library
        </label>` : '';
  return `
    <div class="more-buttons-capture-row">
      <img class="more-buttons-capture-thumb" src="${escapeHtml(imgSrc)}" alt="" />
      <div class="more-buttons-capture-controls">
        <div class="more-buttons-capture-dim${isAuto ? ' --auto' : ''}">
          <select class="more-buttons-capture-dim-mode" data-dim-mode="${i}">
            <option value="height" ${c.dimMode === 'height' ? 'selected' : ''}>Height</option>
            <option value="width" ${c.dimMode === 'width' ? 'selected' : ''}>Width</option>
            <option value="none" ${isAuto ? 'selected' : ''}>Auto</option>
          </select>
          <input class="more-buttons-capture-dim-value" type="number" data-dim-value="${i}" value="${c.dimValue ?? 50}" min="1" ${isAuto ? 'disabled' : ''} />
          <span class="more-buttons-capture-dim-unit">px</span>
        </div>${libraryCheckbox}
        <button type="button" class="more-buttons-capture-remove" data-remove-capture="${i}" aria-label="Remove capture">
          <span class="more-buttons-icon">close</span>
        </button>
      </div>
    </div>`;
}

function captureInsertZone(idx) {
  return `<button type="button" class="mb-adm-insert" data-capture-insert-at="${idx}" aria-label="Insert new capture"><span class="mb-adm-insert__pill">+ Insert New Capture</span></button>`;
}

function captureEmptyCta() {
  return `<button type="button" class="mb-adm-empty" data-capture-insert-at="0"><span class="mb-adm-empty__icon">+</span> Add a capture</button>`;
}

function applyDimAutoState(sel) {
  const dim = sel.closest('.more-buttons-capture-dim');
  if (!dim) return;
  const isAuto = sel.value === 'none';
  dim.classList.toggle('--auto', isAuto);
  const valueInput = dim.querySelector('.more-buttons-capture-dim-value');
  if (valueInput) valueInput.disabled = isAuto;
}

/**
 * Re-renders the captures list inside `formEl`'s container.
 *
 * @param {HTMLElement} formEl
 * @param {string} [containerId]
 */
export function updateCapturesList(formEl, containerId) {
  const container = containerId
    ? formEl.querySelector(`#${containerId}`)
    : (formEl.querySelector('[data-captures-container]')
        || formEl.querySelector('#log-update-captures, #edit-update-captures, #guide-admonition-captures'));
  if (!container) return;

  if (captures.length === 0) {
    container.innerHTML = captureEmptyCta();
  } else {
    const parts = [];
    captures.forEach((c, i) => {
      parts.push(captureInsertZone(i));
      parts.push(captureRowHtml(c, i));
    });
    parts.push(captureInsertZone(captures.length));
    container.innerHTML = parts.join('');
  }

  container.querySelectorAll('[data-dim-mode]').forEach(sel => {
    sel.addEventListener('change', () => {
      captures[parseInt(sel.dataset.dimMode)].dimMode = sel.value;
      applyDimAutoState(sel);
    });
  });
  container.querySelectorAll('[data-dim-value]').forEach(inp => {
    inp.addEventListener('input', () => {
      captures[parseInt(inp.dataset.dimValue)].dimValue = parseInt(inp.value) || 50;
    });
  });
  container.querySelectorAll('[data-remove-capture]').forEach(btn => {
    btn.addEventListener('click', () => {
      captures.splice(parseInt(btn.dataset.removeCapture), 1);
      updateCapturesList(formEl, containerId);
    });
  });
  container.querySelectorAll('[data-add-to-library]').forEach(cb => {
    cb.addEventListener('change', () => {
      captures[parseInt(cb.dataset.addToLibrary)].addToLibrary = cb.checked;
    });
  });
  container.querySelectorAll('[data-capture-insert-at]').forEach(btn => {
    btn.addEventListener('click', () => {
      const insertAt = parseInt(btn.dataset.captureInsertAt, 10);
      const overlay = formEl.closest('.more-buttons-overlay');
      if (!overlay) return;
      runCaptureFlow({ formEl, overlay, insertAtIndex: insertAt, containerId });
    });
  });
}

// ── Publish ───────────────────────────────────────────────────────────────────

export function resolveCaptures(list) {
  return list.map(c => {
    if (c.lightDataUrl && c.addToLibrary === false) {
      const id = generateUUID();
      return {
        ...c,
        lightFilename: `occ-captures/uncategorised/${id}-light-mode.png`,
        darkFilename:  `occ-captures/uncategorised/${id}-dark-mode.png`,
      };
    }
    return c;
  });
}

export async function pushCaptures(list = [], onProgress) {
  for (const c of list) {
    if (!c.lightDataUrl) continue;
    await githubPushImageIfNotExists(`docs/assets/${c.lightFilename}`, c.lightDataUrl.split(',')[1], onProgress);
    await githubPushImageIfNotExists(`docs/assets/${c.darkFilename}`, c.darkDataUrl.split(',')[1], onProgress);
  }
}

function persistFormToStorage(formEl) {
  const storageKey = formEl?.dataset?.storageKey;
  if (!storageKey) return;
  const formData = {};
  const inputs = formEl.querySelectorAll('input, select, textarea');
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
      if (input.checked) formData[input.name] = input.value;
    } else if (input.type === 'checkbox') {
      const group = checkboxGroups[input.name];
      if (group && group.length > 1) {
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
  chrome.storage.local.set({ [storageKey]: formData });
}

// ── Capture flow handoff ─────────────────────────────────────────────────────

function runCaptureFlow({ formEl, overlay, insertAtIndex, containerId }) {
  const resolvedContainerId = containerId
    || formEl.querySelector('[data-captures-container]')?.id
    || (formEl.querySelector('#log-update-captures') ? 'log-update-captures'
       : formEl.querySelector('#edit-update-captures') ? 'edit-update-captures'
       : formEl.querySelector('#guide-admonition-captures') ? 'guide-admonition-captures'
       : null);

  const formStackSnapshot = snapshotFormStack();
  persistFormToStorage(formEl);

  overlay.style.display = 'none';
  const prevBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = '';

  // Clamp insertAt against current captures length when the buffer returns;
  // captures may have changed during async work (it shouldn't, but be safe).
  const targetIndex = insertAtIndex;

  enterCaptureMode({
    saveTarget: 'session',
    formStackSnapshot,
    returnTo: {
      onComplete: async (sessionBuffer) => {
        const insertAt = Math.max(0, Math.min(targetIndex, captures.length));

        if (formEl.isConnected) {
          if (sessionBuffer.length) captures.splice(insertAt, 0, ...sessionBuffer);
          overlay.style.display = '';
          document.body.style.overflow = prevBodyOverflow;
          updateCapturesList(formEl, resolvedContainerId);
          return;
        }
        if (!formStackSnapshot?.length) {
          if (sessionBuffer.length) {
            console.warn('[MB capture] form detached during capture and no form-stack snapshot available — dropping captures to avoid wrong-form attachment.');
          }
          return;
        }
        try {
          const ok = await replayFormStack(formStackSnapshot);
          if (!ok || !sessionBuffer.length) return;
          // After replay, splice at the original target index (clamped).
          const idx = Math.max(0, Math.min(targetIndex, captures.length));
          captures.splice(idx, 0, ...sessionBuffer);
          const reopenedFormEl = document.querySelector('.more-buttons-overlay form[data-storage-key]');
          if (reopenedFormEl) updateCapturesList(reopenedFormEl);
        } catch (e) {
          console.error('[MB capture] auto-reopen after Turbo nav failed:', e);
        }
      },
    },
  });
}

// Legacy form-action: any remaining `data-action="startCapture"` button
// appends a new capture at the end of the list.
registerFormAction('startCapture', ({ formEl, overlay }) => {
  runCaptureFlow({ formEl, overlay, insertAtIndex: captures.length });
});
