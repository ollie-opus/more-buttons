/**
 * mergeSave.js — conflict-aware save loop shared by all scalar forms.
 *
 * The merge runs INSIDE the githubFetchAndPushFile builder, against the same
 * fresh fetch the PUT commits with — so there is no read-then-write window.
 * On unresolved conflicts the builder throws ConflictNeeded; we surface the
 * inline resolver, record the user's choices, and retry. A recorded choice is
 * re-applied only while "theirs" is unchanged; if it moved again we re-prompt.
 */

import { mergeFields, ConflictNeeded } from './formMerge.js';
import { showConflictResolver } from './conflictResolver.js';
import { githubFetchAndPushFile } from './github.js';
import { readFormValues, resetDirtyBaseline } from './form.js';

/**
 * @param {Object} opts
 * @param {HTMLElement} opts.formEl
 * @param {string} opts.file - repo path to fetch + push
 * @param {Array<{name,type,label}>} opts.fieldSpecs
 * @param {(md:string)=>Object} opts.readFresh - parse fresh field values from md
 * @param {(md:string, resolved:Object)=>string} opts.build - build updated md
 * @param {(msg:string)=>void} [opts.onProgress]
 * @returns {Promise<Object>} the resolved values that were written
 */
export async function mergeSave({ formEl, file, fieldSpecs, readFresh, build, onProgress = () => {} }) {
  const snap = formEl._initialSnapshot ?? {};
  const resolutions = {};
  let lastResolved = null;

  for (;;) {
    try {
      await githubFetchAndPushFile(file, onProgress, md => {
        const cur = readFormValues(formEl);
        const fresh = readFresh(md);
        const { resolved, conflicts } = mergeFields(snap, cur, fresh, fieldSpecs, resolutions);
        if (conflicts.length) throw new ConflictNeeded(conflicts);
        lastResolved = resolved;
        return build(md, resolved);
      });
      break;
    } catch (e) {
      if (e instanceof ConflictNeeded) {
        const choices = await showConflictResolver(formEl, e.conflicts);
        for (const c of e.conflicts) {
          resolutions[c.field] = { choice: choices[c.field], theirsShown: c.theirs };
        }
        continue;
      }
      throw e;
    }
  }

  rehydrateFields(formEl, fieldSpecs, lastResolved);
  resetDirtyBaseline(formEl);
  return lastResolved;
}

/** Push merged scalar values back into the form inputs so the view isn't stale. */
function rehydrateFields(formEl, fieldSpecs, resolved) {
  if (!resolved) return;
  for (const spec of fieldSpecs) {
    if (spec.type !== 'scalar') continue;
    const val = resolved[spec.name];
    if (val === undefined) continue;
    const els = formEl.querySelectorAll(`[name="${spec.name}"]`);
    if (els.length && els[0].type === 'radio') {
      els.forEach(r => { r.checked = (r.value === String(val)); });
    } else if (els[0]) {
      els[0].value = val ?? '';
    }
  }
}
